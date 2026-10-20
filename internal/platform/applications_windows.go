package platform

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

var windowProcess = user32.NewProc("GetWindowThreadProcessId")
var enumWindows = user32.NewProc("EnumWindows")
var windowVisible = user32.NewProc("IsWindowVisible")

// NewCallback allocations live for the process lifetime. Reuse one callback for
// the synchronous enumeration instead of allocating one per UI refresh.
var applicationsMu sync.Mutex
var enumeratedApplications map[string]Application
var applicationCallback = syscall.NewCallback(func(window, _ uintptr) uintptr {
	visible, _, _ := windowVisible.Call(window)
	if visible != 0 {
		app := windowApplication(window)
		if app.ID != "" {
			enumeratedApplications[app.ID] = app
		}
	}
	return 1
})

func windowApplication(window uintptr) Application {
	var pid uint32
	windowProcess.Call(window, uintptr(unsafe.Pointer(&pid)))
	if pid == 0 || pid == uint32(os.Getpid()) {
		return Application{}
	}
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return Application{}
	}
	defer windows.CloseHandle(h)
	buffer := make([]uint16, 32768)
	size := uint32(len(buffer))
	if windows.QueryFullProcessImageName(h, 0, &buffer[0], &size) != nil {
		return Application{}
	}
	name := filepath.Base(windows.UTF16ToString(buffer[:size]))
	return Application{ID: "windows:" + strings.ToLower(name), Name: name}
}

func ActiveApplication() string {
	window, _, _ := foreground.Call()
	return windowApplication(window).ID
}

func Applications() ([]Application, error) {
	applicationsMu.Lock()
	defer applicationsMu.Unlock()
	enumeratedApplications = map[string]Application{}
	defer func() { enumeratedApplications = nil }()
	result, _, err := enumWindows.Call(applicationCallback, 0)
	if result == 0 {
		return nil, fmt.Errorf("could not list open applications: %w", err)
	}
	return sortedApplications(enumeratedApplications), nil
}
