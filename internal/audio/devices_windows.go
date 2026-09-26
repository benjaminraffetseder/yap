package audio

import (
	"fmt"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

var waveNumDevices = winmm.NewProc("waveInGetNumDevs")
var waveCapabilities = winmm.NewProc("waveInGetDevCapsW")
var waveMessage = winmm.NewProc("waveInMessage")

type waveInputCaps struct {
	Manufacturer, Product uint16
	Version               uint32
	Name                  [32]uint16
	Formats               uint32
	Channels, Reserved    uint16
}

type waveInput struct {
	Device
	index uintptr
}

func waveInputs() ([]waveInput, error) {
	count, _, _ := waveNumDevices.Call()
	devices := make([]waveInput, 0, count)
	for index := uintptr(0); index < count; index++ {
		var caps waveInputCaps
		if err := mmCall(waveCapabilities, index, uintptr(unsafe.Pointer(&caps)), unsafe.Sizeof(caps)); err != nil {
			return nil, err
		}
		// DRV_QUERYDEVICEINTERFACESIZE and DRV_QUERYDEVICEINTERFACE return a
		// stable PnP interface name. Never persist the mutable waveIn index.
		var size uint32
		if err := mmCall(waveMessage, index, 0x080D, uintptr(unsafe.Pointer(&size)), 0); err != nil {
			return nil, err
		}
		if size < 2 || size > 65536 || size%2 != 0 {
			return nil, fmt.Errorf("microphone %s has no stable device identifier", windows.UTF16ToString(caps.Name[:]))
		}
		buffer := make([]uint16, size/2)
		if err := mmCall(waveMessage, index, 0x080C, uintptr(unsafe.Pointer(&buffer[0])), uintptr(size)); err != nil {
			return nil, err
		}
		id := strings.ToLower(windows.UTF16ToString(buffer))
		if id == "" {
			return nil, fmt.Errorf("microphone has an empty device identifier")
		}
		devices = append(devices, waveInput{Device: Device{ID: id, Name: windows.UTF16ToString(caps.Name[:])}, index: index})
	}
	return devices, nil
}

func Devices() ([]Device, error) {
	inputs, err := waveInputs()
	if err != nil {
		return nil, err
	}
	devices := make([]Device, 0, len(inputs))
	for _, input := range inputs {
		devices = append(devices, input.Device)
	}
	return devices, nil
}

func waveDeviceIndex(id string) (uintptr, error) {
	if id == "" {
		return 0xFFFFFFFF, nil // WAVE_MAPPER follows the system default.
	}
	inputs, err := waveInputs()
	if err != nil {
		return 0, err
	}
	return findWaveDevice(id, inputs)
}

func findWaveDevice(id string, inputs []waveInput) (uintptr, error) {
	for _, input := range inputs {
		if input.ID == id {
			return input.index, nil
		}
	}
	return 0, fmt.Errorf("selected microphone is disconnected; choose another microphone in Settings")
}
