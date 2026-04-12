//go:build linux

package metrics

import (
	"runtime"
	"sync"
	"time"
)

// Collector reads Linux /proc metrics and produces Samples on a wall-clock delta basis.
type Collector struct {
	ProcPath string // e.g. "/proc"; for tests use a fixture directory with same leaf names.
	RootPath string // path for statfs, default "/"

	mu sync.Mutex

	hasPrev bool
	lastAt  time.Time

	prevIdle      uint64
	prevTotal     uint64
	prevIOWait    uint64
	prevNetRx     uint64
	prevNetTx     uint64
	prevDiskRd    uint64
	prevDiskWr    uint64
	prevCoreIdle  []uint64
	prevCoreTotal []uint64
}

// NewCollector returns a collector with production defaults.
func NewCollector() *Collector {
	return &Collector{
		ProcPath: "/proc",
		RootPath: "/",
	}
}

// Collect gathers a Sample. The first call establishes baselines; rates (cpu, net, disk) may be zero.
func (c *Collector) Collect() (Sample, error) {
	now := time.Now()

	stat, err := readProcFile(c.ProcPath, "stat")
	if err != nil {
		return Sample{}, err
	}
	idle, iowait, total, err := parseAggregateCPU(stat)
	if err != nil {
		return Sample{}, err
	}
	coreIdle, coreTotal, errCore := parsePerCoreJiffies(stat)
	ncpu := runtime.NumCPU()
	if errCore == nil && len(coreIdle) > 0 {
		ncpu = len(coreIdle)
	}

	meminfo, err := readProcFile(c.ProcPath, "meminfo")
	if err != nil {
		return Sample{}, err
	}
	memTotal, cachedKb, buffersKb, _, ramPct, swapPct, err := parseMeminfo(meminfo)
	if err != nil {
		return Sample{}, err
	}
	cachedPct := 100 * cachedKb / memTotal
	buffersPct := 100 * buffersKb / memTotal

	loadRaw, err := readProcFile(c.ProcPath, "loadavg")
	if err != nil {
		return Sample{}, err
	}
	l1, l5, l15, err := parseLoadAvg(loadRaw)
	if err != nil {
		return Sample{}, err
	}
	procsRun, procsTotal, _ := parseLoadavgProcs(loadRaw)

	uptimeSec := 0.0
	if upRaw, e := readProcFile(c.ProcPath, "uptime"); e == nil {
		if u, e2 := parseUptime(upRaw); e2 == nil {
			uptimeSec = u
		}
	}

	netRaw, err := readProcFile(c.ProcPath, "net/dev")
	if err != nil {
		return Sample{}, err
	}
	netRx, netTx, err := parseNetDevTotals(netRaw)
	if err != nil {
		return Sample{}, err
	}

	diskRaw, err := readProcFile(c.ProcPath, "diskstats")
	if err != nil {
		return Sample{}, err
	}
	rdSec, wrSec, err := parseDiskStatsTotals(diskRaw)
	if err != nil {
		return Sample{}, err
	}

	rootPct, err := rootUsedPercent(c.RootPath)
	if err != nil {
		return Sample{}, err
	}

	load1Pct := 0.0
	if ncpu > 0 {
		load1Pct = 100 * l1 / float64(ncpu)
		if load1Pct > 999 {
			load1Pct = 999
		}
	}

	s := Sample{
		T:          now.UnixMilli(),
		RAM:        ramPct,
		Swap:       swapPct,
		Cached:     cachedPct,
		Buffers:    buffersPct,
		Load1:      l1,
		Load5:      l5,
		Load15:     l15,
		Load1Pct:   load1Pct,
		RootPct:    rootPct,
		Uptime:     uptimeSec,
		ProcsRun:   procsRun,
		ProcsTotal: procsTotal,
		NCPU:       ncpu,
	}

	if errCore == nil && len(coreIdle) > 0 {
		s.CPUs = make([]float64, len(coreIdle))
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	if !c.hasPrev {
		c.hasPrev = true
		c.lastAt = now
		c.prevIdle = idle
		c.prevTotal = total
		c.prevIOWait = iowait
		c.prevNetRx = netRx
		c.prevNetTx = netTx
		c.prevDiskRd = rdSec
		c.prevDiskWr = wrSec
		if errCore == nil {
			c.prevCoreIdle = append([]uint64(nil), coreIdle...)
			c.prevCoreTotal = append([]uint64(nil), coreTotal...)
		}
		return s, nil
	}

	dt := now.Sub(c.lastAt).Seconds()
	if dt <= 0 {
		dt = 1
	}
	c.lastAt = now

	dIdle := idle - c.prevIdle
	dTotal := total - c.prevTotal
	dIOWait := iowait - c.prevIOWait
	c.prevIdle = idle
	c.prevTotal = total
	c.prevIOWait = iowait

	if dTotal > 0 {
		s.CPU = 100 * (1 - float64(dIdle)/float64(dTotal))
		if s.CPU < 0 {
			s.CPU = 0
		}
		if s.CPU > 100 {
			s.CPU = 100
		}
		s.IOWait = 100 * float64(dIOWait) / float64(dTotal)
		if s.IOWait < 0 {
			s.IOWait = 0
		}
		if s.IOWait > 100 {
			s.IOWait = 100
		}
	}

	dRx := int64(netRx - c.prevNetRx)
	dTx := int64(netTx - c.prevNetTx)
	c.prevNetRx = netRx
	c.prevNetTx = netTx
	if dRx < 0 {
		dRx = 0
	}
	if dTx < 0 {
		dTx = 0
	}
	s.NetRx = float64(dRx) / dt
	s.NetTx = float64(dTx) / dt

	dDskRd := int64(rdSec - c.prevDiskRd)
	dDskWr := int64(wrSec - c.prevDiskWr)
	c.prevDiskRd = rdSec
	c.prevDiskWr = wrSec
	if dDskRd < 0 {
		dDskRd = 0
	}
	if dDskWr < 0 {
		dDskWr = 0
	}
	s.DskRd = float64(dDskRd) * sectorSize / dt
	s.DskWr = float64(dDskWr) * sectorSize / dt

	if errCore == nil && len(coreIdle) == len(c.prevCoreIdle) && len(coreTotal) == len(c.prevCoreTotal) {
		for i := range coreIdle {
			dCi := int64(coreIdle[i] - c.prevCoreIdle[i])
			dCt := int64(coreTotal[i] - c.prevCoreTotal[i])
			if dCt > 0 {
				p := 100 * (1 - float64(dCi)/float64(dCt))
				if p < 0 {
					p = 0
				}
				if p > 100 {
					p = 100
				}
				s.CPUs[i] = p
			}
		}
		c.prevCoreIdle = append(c.prevCoreIdle[:0], coreIdle...)
		c.prevCoreTotal = append(c.prevCoreTotal[:0], coreTotal...)
	} else if errCore == nil && len(coreIdle) > 0 {
		c.prevCoreIdle = append([]uint64(nil), coreIdle...)
		c.prevCoreTotal = append([]uint64(nil), coreTotal...)
		s.CPUs = make([]float64, len(coreIdle))
	}

	return s, nil
}
