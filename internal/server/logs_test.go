package server

import "testing"

func TestParseAppLogLineStructured(t *testing.T) {
	entry := parseAppLogLine("2026/04/13 20:47:23.574587 WARN websocket upgrade: boom")

	if entry.Origin != "app" {
		t.Fatalf("Origin = %q, want %q", entry.Origin, "app")
	}
	if entry.Source != "lmonitor" {
		t.Fatalf("Source = %q, want %q", entry.Source, "lmonitor")
	}
	if entry.Level != "warning" {
		t.Fatalf("Level = %q, want %q", entry.Level, "warning")
	}
	if entry.Message != "websocket upgrade: boom" {
		t.Fatalf("Message = %q, want %q", entry.Message, "websocket upgrade: boom")
	}
	if entry.T <= 0 {
		t.Fatalf("T = %d, want > 0", entry.T)
	}
}

func TestNormalizeLogEntryDefaults(t *testing.T) {
	entry, ok := normalizeLogEntry(LogEntry{
		Source:  "lmonitor",
		Message: "INFO startup complete",
	})
	if !ok {
		t.Fatal("normalizeLogEntry returned ok=false")
	}
	if entry.Level != "good" {
		t.Fatalf("Level = %q, want %q", entry.Level, "good")
	}
	if entry.Origin != "app" {
		t.Fatalf("Origin = %q, want %q", entry.Origin, "app")
	}
	if entry.Source != "lmonitor" {
		t.Fatalf("Source = %q, want %q", entry.Source, "lmonitor")
	}
}
