//go:build windows

package metrics

import (
	"fmt"
	stdnet "net"
	"os"
	"runtime"
	"strings"
	"sync"
	"time"

	gcpu "github.com/shirou/gopsutil/v4/cpu"
	gdisk "github.com/shirou/gopsutil/v4/disk"
	ghost "github.com/shirou/gopsutil/v4/host"
	gload "github.com/shirou/gopsutil/v4/load"
	gmem "github.com/shirou/gopsutil/v4/mem"
	gnet "github.com/shirou/gopsutil/v4/net"
	gprocess "github.com/shirou/gopsutil/v4/process"
)

// Collector reads host metrics on Windows and produces Samples on a wall-clock delta basis.
type Collector struct {
	RootPath string // drive root for disk usage, e.g. "C:\\"

	mu sync.Mutex

	hasPrev bool
	lastAt  time.Time

	prevCPU    gcpu.TimesStat
	prevCore   []gcpu.TimesStat
	prevNetRx  uint64
	prevNetTx  uint64
	prevDiskRd uint64
	prevDiskWr uint64
}

// NewCollector returns a collector with production defaults.
func NewCollector() *Collector {
	return &Collector{
		RootPath: windowsRootPath(),
	}
}

// Collect gathers a Sample. The first call establishes baselines; rates may be zero.
func (c *Collector) Collect() (Sample, error) {
	now := time.Now()

	aggTimes, err := gcpu.Times(false)
	if err != nil {
		return Sample{}, fmt.Errorf("cpu times: %w", err)
	}
	if len(aggTimes) == 0 {
		return Sample{}, fmt.Errorf("cpu times: no aggregate sample")
	}
	perCoreTimes, errPerCore := gcpu.Times(true)

	vm, err := gmem.VirtualMemory()
	if err != nil {
		return Sample{}, fmt.Errorf("virtual memory: %w", err)
	}

	swapPct := 0.0
	if sw, err := gmem.SwapMemory(); err == nil && sw != nil {
		swapPct = sw.UsedPercent
	}

	load1, load5, load15 := 0.0, 0.0, 0.0
	if avg, err := gload.Avg(); err == nil && avg != nil {
		load1 = avg.Load1
		load5 = avg.Load5
		load15 = avg.Load15
	}

	uptimeSec := 0.0
	if up, err := ghost.Uptime(); err == nil {
		uptimeSec = float64(up)
	}

	netRx, netTx, err := windowsNetTotals()
	if err != nil {
		return Sample{}, fmt.Errorf("network counters: %w", err)
	}

	diskRd, diskWr := uint64(0), uint64(0)
	if rd, wr, err := windowsDiskTotals(); err == nil {
		diskRd = rd
		diskWr = wr
	}

	rootPct := 0.0
	if usage, err := gdisk.Usage(c.RootPath); err == nil && usage != nil {
		rootPct = usage.UsedPercent
	}

	procsTotal := 0
	if pids, err := gprocess.Pids(); err == nil {
		procsTotal = len(pids)
	}

	ncpu := runtime.NumCPU()
	if errPerCore == nil && len(perCoreTimes) > 0 {
		ncpu = len(perCoreTimes)
	}

	cachedPct := 0.0
	buffersPct := 0.0
	if vm.Total > 0 {
		cachedPct = 100 * float64(vm.Cached) / float64(vm.Total)
		buffersPct = 100 * float64(vm.Buffers) / float64(vm.Total)
	}

	load1Pct := 0.0
	if ncpu > 0 {
		load1Pct = 100 * load1 / float64(ncpu)
		if load1Pct > 999 {
			load1Pct = 999
		}
	}

	s := Sample{
		T:          now.UnixMilli(),
		RAM:        vm.UsedPercent,
		Swap:       swapPct,
		Cached:     cachedPct,
		Buffers:    buffersPct,
		Load1:      load1,
		Load5:      load5,
		Load15:     load15,
		Load1Pct:   load1Pct,
		RootPct:    rootPct,
		Uptime:     uptimeSec,
		ProcsTotal: procsTotal,
		NCPU:       ncpu,
	}

	if errPerCore == nil && len(perCoreTimes) > 0 {
		s.CPUs = make([]float64, len(perCoreTimes))
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	if !c.hasPrev {
		c.hasPrev = true
		c.lastAt = now
		c.prevCPU = aggTimes[0]
		c.prevNetRx = netRx
		c.prevNetTx = netTx
		c.prevDiskRd = diskRd
		c.prevDiskWr = diskWr
		if errPerCore == nil {
			c.prevCore = append([]gcpu.TimesStat(nil), perCoreTimes...)
		}
		return s, nil
	}

	dt := now.Sub(c.lastAt).Seconds()
	if dt <= 0 {
		dt = 1
	}
	c.lastAt = now

	s.CPU, s.IOWait = windowsCPUPercent(c.prevCPU, aggTimes[0])
	c.prevCPU = aggTimes[0]

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

	dRd := int64(diskRd - c.prevDiskRd)
	dWr := int64(diskWr - c.prevDiskWr)
	c.prevDiskRd = diskRd
	c.prevDiskWr = diskWr
	if dRd < 0 {
		dRd = 0
	}
	if dWr < 0 {
		dWr = 0
	}
	s.DskRd = float64(dRd) / dt
	s.DskWr = float64(dWr) / dt

	if errPerCore == nil && len(perCoreTimes) == len(c.prevCore) {
		for i := range perCoreTimes {
			pct, _ := windowsCPUPercent(c.prevCore[i], perCoreTimes[i])
			s.CPUs[i] = pct
		}
		c.prevCore = append(c.prevCore[:0], perCoreTimes...)
	} else if errPerCore == nil && len(perCoreTimes) > 0 {
		c.prevCore = append([]gcpu.TimesStat(nil), perCoreTimes...)
		s.CPUs = make([]float64, len(perCoreTimes))
	}

	return s, nil
}

func windowsRootPath() string {
	drive := strings.TrimSpace(os.Getenv("SystemDrive"))
	if drive == "" {
		return `C:\`
	}
	if strings.HasSuffix(drive, `\`) || strings.HasSuffix(drive, `/`) {
		return drive
	}
	return drive + `\`
}

func windowsNetTotals() (rx, tx uint64, err error) {
	ifaces, err := stdnet.Interfaces()
	if err != nil {
		return 0, 0, err
	}
	loopback := make(map[string]struct{}, len(ifaces))
	for _, iface := range ifaces {
		if iface.Flags&stdnet.FlagLoopback != 0 {
			loopback[iface.Name] = struct{}{}
		}
	}

	counters, err := gnet.IOCounters(true)
	if err != nil {
		return 0, 0, err
	}
	for _, c := range counters {
		if _, skip := loopback[c.Name]; skip {
			continue
		}
		rx += c.BytesRecv
		tx += c.BytesSent
	}
	return rx, tx, nil
}

func windowsDiskTotals() (readBytes, writeBytes uint64, err error) {
	counters, err := gdisk.IOCounters()
	if err != nil {
		return 0, 0, err
	}
	for _, c := range counters {
		readBytes += c.ReadBytes
		writeBytes += c.WriteBytes
	}
	return readBytes, writeBytes, nil
}

func windowsCPUPercent(prev, curr gcpu.TimesStat) (cpuPct, ioWaitPct float64) {
	prevTotal := prev.Total()
	currTotal := curr.Total()
	dTotal := currTotal - prevTotal
	if dTotal <= 0 {
		return 0, 0
	}

	prevBusy := prevTotal - prev.Idle - prev.Iowait
	currBusy := currTotal - curr.Idle - curr.Iowait

	cpuPct = 100 * (currBusy - prevBusy) / dTotal
	ioWaitPct = 100 * (curr.Iowait - prev.Iowait) / dTotal

	if cpuPct < 0 {
		cpuPct = 0
	}
	if cpuPct > 100 {
		cpuPct = 100
	}
	if ioWaitPct < 0 {
		ioWaitPct = 0
	}
	if ioWaitPct > 100 {
		ioWaitPct = 100
	}

	return cpuPct, ioWaitPct
}
