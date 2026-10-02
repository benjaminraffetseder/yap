//go:build windows || cgo

package platform

import (
	"fmt"
	"golang.design/x/hotkey"
)

type Shortcut struct {
	key  *hotkey.Hotkey
	stop chan struct{}
}

func Register(value string, down, up func()) (*Shortcut, error) {
	mods, key, err := ParseShortcut(value)
	if err != nil {
		return nil, err
	}
	m := []hotkey.Modifier{}
	for _, v := range mods {
		switch v {
		case "Ctrl":
			m = append(m, hotkey.ModCtrl)
		case "Alt":
			m = append(m, altModifier())
		case "Shift":
			m = append(m, hotkey.ModShift)
		}
	}
	keys := map[string]hotkey.Key{"Space": hotkey.KeySpace, "A": hotkey.KeyA, "B": hotkey.KeyB, "C": hotkey.KeyC, "D": hotkey.KeyD, "E": hotkey.KeyE, "F": hotkey.KeyF, "G": hotkey.KeyG, "H": hotkey.KeyH, "I": hotkey.KeyI, "J": hotkey.KeyJ, "K": hotkey.KeyK, "L": hotkey.KeyL, "M": hotkey.KeyM, "N": hotkey.KeyN, "O": hotkey.KeyO, "P": hotkey.KeyP, "Q": hotkey.KeyQ, "R": hotkey.KeyR, "S": hotkey.KeyS, "T": hotkey.KeyT, "U": hotkey.KeyU, "V": hotkey.KeyV, "W": hotkey.KeyW, "X": hotkey.KeyX, "Y": hotkey.KeyY, "Z": hotkey.KeyZ}
	fkeys := []hotkey.Key{hotkey.KeyF1, hotkey.KeyF2, hotkey.KeyF3, hotkey.KeyF4, hotkey.KeyF5, hotkey.KeyF6, hotkey.KeyF7, hotkey.KeyF8, hotkey.KeyF9, hotkey.KeyF10, hotkey.KeyF11, hotkey.KeyF12}
	for i, k := range fkeys {
		keys[fmt.Sprintf("F%d", i+1)] = k
	}
	h := hotkey.New(m, keys[key])
	if err = h.Register(); err != nil {
		return nil, err
	}
	s := &Shortcut{key: h, stop: make(chan struct{})}
	go dispatchShortcutEvents(h.Keydown(), h.Keyup(), s.stop, down, up)
	return s, nil
}

func dispatchShortcutEvents(presses, releases <-chan hotkey.Event, stop <-chan struct{}, down, up func()) {
	held, next := false, uint64(1)
	pending := map[uint64]bool{}
	for {
		select {
		case event, ok := <-presses:
			if !ok {
				return
			}
			pending[event.Sequence] = true
		case event, ok := <-releases:
			if !ok {
				return
			}
			pending[event.Sequence] = false
		case <-stop:
			return
		}
		// The two dependency queues may arrive in either order. Native source
		// numbers let us replay complete taps and ignore only actual repeats.
		for {
			pressed, ok := pending[next]
			if !ok {
				break
			}
			select {
			case <-stop:
				return
			default:
			}
			delete(pending, next)
			next++
			if pressed != held {
				held = pressed
				if pressed {
					down()
				} else {
					up()
				}
			}
		}
	}
}
func (s *Shortcut) Close() { close(s.stop); s.key.Unregister() }
