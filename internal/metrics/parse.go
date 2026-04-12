package metrics

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

var (
	wholeDiskSD   = regexp.MustCompile(`^sd[a-z]+$`)
	wholeDiskVD   = regexp.MustCompile(`^vd[a-z]+$`)
	wholeDiskNVMe = regexp.MustCompile(`^nvme\d+n\d+$`)
	wholeDiskMMC  = regexp.MustCompile(`^mmcblk\d+$`)
)

func isWholeDisk(name string) bool {
	return wholeDiskSD.MatchString(name) ||
		wholeDiskVD.MatchString(name) ||
		wholeDiskNVMe.MatchString(name) ||
		wholeDiskMMC.MatchString(name)
}

func readProcFile(procRoot, name string) ([]byte, error) {
	p := filepath.Join(procRoot, name)
	return os.ReadFile(p)
}

var perCPUName = regexp.MustCompile(`^cpu[0-9]+$`)

// parseAggregateCPU returns idle+jowait (for total non-idle CPU%), raw iowait jiffies, and total jiffies.
func parseAggregateCPU(stat []byte) (idleAll, iowait, total uint64, err error) {
	sc := bufio.NewScanner(strings.NewReader(string(stat)))
	for sc.Scan() {
		line := sc.Text()
		fields := strings.Fields(line)
		if len(fields) < 2 || fields[0] != "cpu" {
			continue
		}
		idleA, io, tot, e := jiffiesFromCPUFields(fields)
		if e != nil {
			return 0, 0, 0, e
		}
		return idleA, io, tot, nil
	}
	if err := sc.Err(); err != nil {
		return 0, 0, 0, err
	}
	return 0, 0, 0, fmt.Errorf("no aggregate cpu line in stat")
}

func jiffiesFromCPUFields(fields []string) (idleAll, iowait, total uint64, err error) {
	if len(fields) < 6 {
		return 0, 0, 0, fmt.Errorf("cpu line too short")
	}
	var idleVal uint64
	for i := 1; i < len(fields); i++ {
		v, e := strconv.ParseUint(fields[i], 10, 64)
		if e != nil {
			return 0, 0, 0, fmt.Errorf("cpu field %d: %w", i, e)
		}
		total += v
		switch i {
		case 4:
			idleVal = v
		case 5:
			iowait = v
		}
	}
	idleAll = idleVal + iowait
	return idleAll, iowait, total, nil
}

// parseCPUTimes returns idle jiffies and total jiffies from the aggregate "cpu" line in /proc/stat.
func parseCPUTimes(stat []byte) (idle, total uint64, err error) {
	idleA, _, tot, err := parseAggregateCPU(stat)
	return idleA, tot, err
}

// parsePerCoreJiffies returns idle+wait and total jiffies per logical CPU, in core index order.
func parsePerCoreJiffies(stat []byte) (idle []uint64, total []uint64, err error) {
	sc := bufio.NewScanner(strings.NewReader(string(stat)))
	for sc.Scan() {
		fields := strings.Fields(sc.Text())
		if len(fields) < 2 || !perCPUName.MatchString(fields[0]) {
			continue
		}
		idleA, _, tot, e := jiffiesFromCPUFields(fields)
		if e != nil {
			return nil, nil, e
		}
		idle = append(idle, idleA)
		total = append(total, tot)
	}
	if err := sc.Err(); err != nil {
		return nil, nil, err
	}
	if len(idle) == 0 {
		return nil, nil, fmt.Errorf("no per-cpu lines in stat")
	}
	return idle, total, nil
}

func parseMemPercents(meminfo []byte) (ramUsedPct, swapUsedPct float64, err error) {
	_, _, _, _, ramUsedPct, swapUsedPct, err = parseMeminfo(meminfo)
	if err != nil {
		return 0, 0, err
	}
	return ramUsedPct, swapUsedPct, nil
}

// parseMeminfo returns memTotal (kB), cached and buffers (kB), avail (kB), and percentage fields.
func parseMeminfo(meminfo []byte) (memTotal, cached, buffers, memAvail, ramUsedPct, swapUsedPct float64, err error) {
	var swapTotal, swapFree float64
	sc := bufio.NewScanner(strings.NewReader(string(meminfo)))
	for sc.Scan() {
		line := sc.Text()
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		key := strings.TrimSuffix(fields[0], ":")
		val, e := strconv.ParseFloat(fields[1], 64)
		if e != nil {
			continue
		}
		switch key {
		case "MemTotal":
			memTotal = val
		case "MemAvailable":
			memAvail = val
		case "Cached":
			cached = val
		case "Buffers":
			buffers = val
		case "SwapTotal":
			swapTotal = val
		case "SwapFree":
			swapFree = val
		}
	}
	if err = sc.Err(); err != nil {
		return 0, 0, 0, 0, 0, 0, err
	}
	if memTotal <= 0 {
		return 0, 0, 0, 0, 0, 0, fmt.Errorf("MemTotal missing or zero")
	}
	if memAvail == 0 {
		return 0, 0, 0, 0, 0, 0, fmt.Errorf("MemAvailable missing")
	}
	ramUsedPct = 100 * (memTotal - memAvail) / memTotal
	if swapTotal > 0 {
		swapUsedPct = 100 * (swapTotal - swapFree) / swapTotal
	}
	return memTotal, cached, buffers, memAvail, ramUsedPct, swapUsedPct, nil
}

// parseUptime returns system uptime in seconds (first field of /proc/uptime).
func parseUptime(data []byte) (float64, error) {
	fields := strings.Fields(string(data))
	if len(fields) < 1 {
		return 0, fmt.Errorf("uptime: empty")
	}
	return strconv.ParseFloat(fields[0], 64)
}

// parseLoadavgProcs parses the "running/total" task counts from /proc/loadavg.
func parseLoadavgProcs(data []byte) (running, total int, err error) {
	fields := strings.Fields(string(data))
	if len(fields) < 4 {
		return 0, 0, fmt.Errorf("loadavg: want procs field")
	}
	parts := strings.Split(fields[3], "/")
	if len(parts) != 2 {
		return 0, 0, fmt.Errorf("loadavg: bad procs field %q", fields[3])
	}
	running, err = strconv.Atoi(parts[0])
	if err != nil {
		return 0, 0, err
	}
	total, err = strconv.Atoi(parts[1])
	if err != nil {
		return 0, 0, err
	}
	return running, total, nil
}

func parseLoadAvg(data []byte) (l1, l5, l15 float64, err error) {
	fields := strings.Fields(string(data))
	if len(fields) < 3 {
		return 0, 0, 0, fmt.Errorf("loadavg: want 3 fields, got %d", len(fields))
	}
	l1, err = strconv.ParseFloat(fields[0], 64)
	if err != nil {
		return 0, 0, 0, err
	}
	l5, err = strconv.ParseFloat(fields[1], 64)
	if err != nil {
		return 0, 0, 0, err
	}
	l15, err = strconv.ParseFloat(fields[2], 64)
	if err != nil {
		return 0, 0, 0, err
	}
	return l1, l5, l15, nil
}

// parseNetDevTotals returns aggregate rx and tx bytes (sum of non-loopback interfaces).
func parseNetDevTotals(dev []byte) (rx, tx uint64, err error) {
	sc := bufio.NewScanner(strings.NewReader(string(dev)))
	lineN := 0
	for sc.Scan() {
		lineN++
		if lineN <= 2 {
			continue
		}
		line := strings.TrimSpace(sc.Text())
		idx := strings.IndexByte(line, ':')
		if idx < 0 {
			continue
		}
		iface := strings.TrimSpace(line[:idx])
		if iface == "" || iface == "lo" {
			continue
		}
		rest := strings.TrimSpace(line[idx+1:])
		fields := strings.Fields(rest)
		if len(fields) < 9 {
			continue
		}
		rxb, e1 := strconv.ParseUint(fields[0], 10, 64)
		txb, e2 := strconv.ParseUint(fields[8], 10, 64)
		if e1 != nil || e2 != nil {
			continue
		}
		rx += rxb
		tx += txb
	}
	if err = sc.Err(); err != nil {
		return 0, 0, err
	}
	return rx, tx, nil
}

// parseDiskStatsTotals returns aggregate sectors read and written for whole-disk devices only.
func parseDiskStatsTotals(diskstats []byte) (rdSectors, wrSectors uint64, err error) {
	sc := bufio.NewScanner(strings.NewReader(string(diskstats)))
	for sc.Scan() {
		fields := strings.Fields(sc.Text())
		if len(fields) < 11 {
			continue
		}
		name := fields[2]
		if !isWholeDisk(name) {
			continue
		}
		rs, e1 := strconv.ParseUint(fields[5], 10, 64)
		ws, e2 := strconv.ParseUint(fields[9], 10, 64)
		if e1 != nil || e2 != nil {
			continue
		}
		rdSectors += rs
		wrSectors += ws
	}
	if err = sc.Err(); err != nil {
		return 0, 0, err
	}
	return rdSectors, wrSectors, nil
}

const sectorSize = 512
