package metrics

import (
	"os"
	"path/filepath"
	"testing"
)

func TestParseCPUTimes(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "proc", "stat"))
	if err != nil {
		t.Fatal(err)
	}
	idle, total, err := parseCPUTimes(b)
	if err != nil {
		t.Fatal(err)
	}
	if idle == 0 || total == 0 || idle >= total {
		t.Fatalf("unexpected idle=%d total=%d", idle, total)
	}
}

func TestParseMemPercents(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "proc", "meminfo"))
	if err != nil {
		t.Fatal(err)
	}
	ram, swap, err := parseMemPercents(b)
	if err != nil {
		t.Fatal(err)
	}
	if ram < 0 || ram > 100 {
		t.Fatalf("ram %% out of range: %v", ram)
	}
	if swap < 0 || swap > 100 {
		t.Fatalf("swap %% out of range: %v", swap)
	}
}

func TestParseLoadAvg(t *testing.T) {
	b := []byte("0.52 0.58 0.59 2/841 12345\n")
	l1, l5, l15, err := parseLoadAvg(b)
	if err != nil {
		t.Fatal(err)
	}
	if l1 != 0.52 || l5 != 0.58 || l15 != 0.59 {
		t.Fatalf("got %v %v %v", l1, l5, l15)
	}
}

func TestParseNetDevTotals(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "proc", "net", "dev"))
	if err != nil {
		t.Fatal(err)
	}
	rx, tx, err := parseNetDevTotals(b)
	if err != nil {
		t.Fatal(err)
	}
	if rx == 0 && tx == 0 {
		t.Fatal("expected non-zero aggregate")
	}
}

func TestParseDiskStatsTotals(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "proc", "diskstats"))
	if err != nil {
		t.Fatal(err)
	}
	rd, wr, err := parseDiskStatsTotals(b)
	if err != nil {
		t.Fatal(err)
	}
	if rd == 0 && wr == 0 {
		t.Fatal("expected non-zero sectors for fixture disks")
	}
}

func TestParseUptime(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "proc", "uptime"))
	if err != nil {
		t.Fatal(err)
	}
	u, err := parseUptime(b)
	if err != nil || u < 86450 || u > 86451 {
		t.Fatalf("uptime: %v err %v", u, err)
	}
}

func TestParseLoadavgProcs(t *testing.T) {
	b := []byte("0.52 0.58 0.59 2/841 12345\n")
	r, tot, err := parseLoadavgProcs(b)
	if err != nil || r != 2 || tot != 841 {
		t.Fatalf("got %d/%d err %v", r, tot, err)
	}
}

func TestParsePerCoreJiffies(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "proc", "stat"))
	if err != nil {
		t.Fatal(err)
	}
	idle, tot, err := parsePerCoreJiffies(b)
	if err != nil {
		t.Fatal(err)
	}
	if len(idle) < 1 || len(idle) != len(tot) {
		t.Fatalf("cores: idle=%d total=%d", len(idle), len(tot))
	}
}

func TestIsWholeDisk(t *testing.T) {
	cases := map[string]bool{
		"sda":       true,
		"sda1":      false,
		"nvme0n1":   true,
		"nvme0n1p1": false,
		"loop0":     false,
		"vdz":       true,
	}
	for name, want := range cases {
		if got := isWholeDisk(name); got != want {
			t.Errorf("%q: got %v want %v", name, got, want)
		}
	}
}
