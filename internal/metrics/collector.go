package metrics

import (
	"sync"
	"time"
)

// Collector reads Linux /proc metrics and produces Samples on a wall-clock delta basis.
type Collector struct {
	ProcPath string // e.g. "/proc"; for tests use a fixture directory with same leaf names.
	RootPath string // path for statfs, default "/"

	mu sync.Mutex

	hasPrev    bool
	lastAt     time.Time
	prevIdle   uint64
	prevTotal  uint64
	prevNetRx  uint64
	prevNetTx  uint64
	prevDiskRd uint64
	prevDiskWr uint64
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
	idle, total, err := parseCPUTimes(stat)
	if err != nil {
		return Sample{}, err
	}

	meminfo, err := readProcFile(c.ProcPath, "meminfo")
	if err != nil {
		return Sample{}, err
	}
	ramPct, swapPct, err := parseMemPercents(meminfo)
	if err != nil {
		return Sample{}, err
	}

	loadRaw, err := readProcFile(c.ProcPath, "loadavg")
	if err != nil {
		return Sample{}, err
	}
	l1, l5, l15, err := parseLoadAvg(loadRaw)
	if err != nil {
		return Sample{}, err
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

	s := Sample{
		T:       now.UnixMilli(),
		RAM:     ramPct,
		Swap:    swapPct,
		Load1:   l1,
		Load5:   l5,
		Load15:  l15,
		RootPct: rootPct,
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	if !c.hasPrev {
		c.hasPrev = true
		c.lastAt = now
		c.prevIdle = idle
		c.prevTotal = total
		c.prevNetRx = netRx
		c.prevNetTx = netTx
		c.prevDiskRd = rdSec
		c.prevDiskWr = wrSec
		return s, nil
	}

	dt := now.Sub(c.lastAt).Seconds()
	if dt <= 0 {
		dt = 1
	}
	c.lastAt = now

	dIdle := idle - c.prevIdle
	dTotal := total - c.prevTotal
	c.prevIdle = idle
	c.prevTotal = total
	if dTotal > 0 {
		s.CPU = 100 * (1 - float64(dIdle)/float64(dTotal))
		if s.CPU < 0 {
			s.CPU = 0
		}
		if s.CPU > 100 {
			s.CPU = 100
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

	return s, nil
}
