//go:build darwin && cgo

package platform

/*
#include <stdlib.h>
char* yap_profile_applications(void);
char* yap_profile_active_application(void);
*/
import "C"

import (
	"encoding/json"
	"strings"
	"unsafe"
)

func ActiveApplication() string {
	value := C.yap_profile_active_application()
	defer C.free(unsafe.Pointer(value))
	return strings.ToLower(C.GoString(value))
}

func Applications() ([]Application, error) {
	value := C.yap_profile_applications()
	defer C.free(unsafe.Pointer(value))
	var result []Application
	if err := json.Unmarshal([]byte(C.GoString(value)), &result); err != nil {
		return nil, err
	}
	apps := map[string]Application{}
	for _, app := range result {
		app.ID = strings.ToLower(app.ID)
		apps[app.ID] = app
	}
	return sortedApplications(apps), nil
}
