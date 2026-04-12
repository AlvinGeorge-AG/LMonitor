//go:build !linux && !windows

package metrics

import "fmt"

// Collector is a stub for platforms that do not yet have a metrics backend.
type Collector struct{}

// NewCollector returns an unsupported collector placeholder.
func NewCollector() *Collector {
	return &Collector{}
}

// Collect reports that metrics collection is unavailable on this platform.
func (c *Collector) Collect() (Sample, error) {
	return Sample{}, fmt.Errorf("metrics collection is supported on linux and windows only")
}
