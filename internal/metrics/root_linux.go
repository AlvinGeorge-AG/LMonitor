//go:build linux

package metrics

import (
	"fmt"

	"golang.org/x/sys/unix"
)

func rootUsedPercent(path string) (float64, error) {
	var st unix.Statfs_t
	if err := unix.Statfs(path, &st); err != nil {
		return 0, err
	}
	bs := uint64(st.Bsize)
	if bs == 0 {
		return 0, fmt.Errorf("statfs: zero block size")
	}
	blocks := uint64(st.Blocks)
	if blocks == 0 {
		return 0, fmt.Errorf("statfs: zero total blocks")
	}
	total := blocks * bs
	availBlocks := uint64(st.Bavail)
	if availBlocks == 0 && st.Bfree > 0 {
		availBlocks = uint64(st.Bfree)
	}
	avail := availBlocks * bs
	if avail > total {
		avail = total
	}
	used := total - avail
	return 100 * float64(used) / float64(total), nil
}
