//go:build linux

package server

import "testing"

func TestJournalRecordToEntry(t *testing.T) {
	raw := map[string]any{
		"__CURSOR":             "cursor:123",
		"__REALTIME_TIMESTAMP": "1776093232806701",
		"PRIORITY":             "3",
		"MESSAGE":              "disk quota exceeded",
		"SYSLOG_IDENTIFIER":    "kernel",
		"_SYSTEMD_UNIT":        "ssh.service",
		"_HOSTNAME":            "demo-host",
		"_PID":                 "99",
	}

	entry, cursor, ok := journalRecordToEntry(raw)
	if !ok {
		t.Fatal("journalRecordToEntry returned ok=false")
	}
	if cursor != "cursor:123" {
		t.Fatalf("cursor = %q, want %q", cursor, "cursor:123")
	}
	if entry.Origin != "system" {
		t.Fatalf("Origin = %q, want %q", entry.Origin, "system")
	}
	if entry.Source != "kernel" {
		t.Fatalf("Source = %q, want %q", entry.Source, "kernel")
	}
	if entry.Unit != "ssh.service" {
		t.Fatalf("Unit = %q, want %q", entry.Unit, "ssh.service")
	}
	if entry.Level != "error" {
		t.Fatalf("Level = %q, want %q", entry.Level, "error")
	}
	if entry.Message != "disk quota exceeded" {
		t.Fatalf("Message = %q, want %q", entry.Message, "disk quota exceeded")
	}
	if entry.T != 1776093232806 {
		t.Fatalf("T = %d, want %d", entry.T, int64(1776093232806))
	}
}

func TestJournalPriorityLevel(t *testing.T) {
	tests := map[string]string{
		"0": "high",
		"2": "high",
		"3": "error",
		"4": "warning",
		"6": "good",
		"7": "debug",
	}

	for in, want := range tests {
		if got := journalPriorityLevel(in); got != want {
			t.Fatalf("journalPriorityLevel(%q) = %q, want %q", in, got, want)
		}
	}
}
