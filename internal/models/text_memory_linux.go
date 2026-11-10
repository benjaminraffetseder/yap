package models

import "golang.org/x/sys/unix"

func RecommendedTextContext() int {
	var status unix.Sysinfo_t
	if err := unix.Sysinfo(&status); err != nil {
		return 4096
	}
	return recommendedTextContextForMemory(uint64(status.Totalram) * uint64(status.Unit))
}
