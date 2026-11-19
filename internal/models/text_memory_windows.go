package models

import (
	"unsafe"

	"golang.org/x/sys/windows"
)

func RecommendedTextContext() int {
	var status struct {
		Length, Load                                                                          uint32
		TotalPhys, AvailPhys, TotalPage, AvailPage, TotalVirtual, AvailVirtual, AvailExtended uint64
	}
	status.Length = uint32(unsafe.Sizeof(status))
	ok, _, _ := windows.NewLazySystemDLL("kernel32.dll").NewProc("GlobalMemoryStatusEx").Call(uintptr(unsafe.Pointer(&status)))
	if ok == 0 {
		return 4096
	}
	return recommendedTextContextForMemory(status.TotalPhys)
}
