//go:build !linux

package metrics

import "fmt"

func rootUsedPercent(path string) (float64, error) {
	_ = path
	return 0, fmt.Errorf("root disk usage only supported on linux")
}
