package models

func recommendedTextContextForMemory(bytes uint64) int {
	if bytes < 12<<30 {
		return 4096
	}
	if bytes < 24<<30 {
		return 8192
	}
	return 16384
}
