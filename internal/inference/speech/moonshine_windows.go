package speech

import "golang.org/x/sys/windows"

func openMoonshine(path string) (uintptr, func(), error) {
	// Restrict dependency lookup to the verified runtime and system folders.
	h, err := windows.LoadLibraryEx(path, 0, windows.LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|windows.LOAD_LIBRARY_SEARCH_DEFAULT_DIRS)
	if err != nil {
		return 0, nil, err
	}
	return uintptr(h), func() { _ = windows.FreeLibrary(h) }, nil
}
