//go:build !linux

package server

// StartSystemLogCollector is a no-op on platforms without journalctl support.
func StartSystemLogCollector(h *LogHub) {}
