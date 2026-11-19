//go:build linux && cgo

package platform

import (
	"context"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/ebitengine/purego"
)

// Exercise the native X server's repeat events, rather than only replaying
// already-ordered Go events. Can also run under xvfb-run in CI.
func TestX11ShortcutRepeatIntegration(t *testing.T) {
	if os.Getenv("YAP_X11_SHORTCUT_INTEGRATION") != "1" {
		t.Skip("set YAP_X11_SHORTCUT_INTEGRATION=1 on an X11 desktop with auto-repeat enabled")
	}
	if os.Getenv("XDG_SESSION_TYPE") != "x11" || os.Getenv("DISPLAY") == "" {
		t.Fatal("the native repeat test requires an X11 session")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	run := func(name string, args ...string) string {
		t.Helper()
		data, err := exec.CommandContext(ctx, name, args...).CombinedOutput()
		if err != nil {
			t.Fatalf("%s %v: %v: %s", name, args, err, data)
		}
		return string(data)
	}
	settings := run("xset", "-q")
	if !regexp.MustCompile(`auto repeat:\s+on`).MatchString(settings) {
		t.Fatal("enable X11 auto-repeat before running the repeat regression")
	}
	match := regexp.MustCompile(`auto repeat delay:\s+([0-9]+)`).FindStringSubmatch(settings)
	if len(match) != 2 {
		t.Fatal("could not read the X11 repeat delay")
	}
	delay, err := strconv.Atoi(match[1])
	if err != nil || delay > 5000 {
		t.Fatalf("unsupported repeat delay: %q", match[1])
	}
	value := os.Getenv("YAP_SHORTCUT_TEST_KEY")
	if value == "" {
		value = "Ctrl+Shift+F12"
	}
	mods, key, err := ParseShortcut(value)
	if err != nil {
		t.Fatal(err)
	}
	for i := range mods {
		mods[i] = strings.ToLower(mods[i])
	}
	if key == "Space" || len(key) == 1 {
		key = strings.ToLower(key)
	}
	chord := strings.Join(append(mods, key), "+")
	// Inject physical keycodes. Keysym-based tools may add implicit modifiers
	// for function keys, which would test a different chord than the one grabbed.
	x11, err := purego.Dlopen("libX11.so.6", purego.RTLD_NOW|purego.RTLD_LOCAL)
	if err != nil {
		t.Fatal(err)
	}
	defer purego.Dlclose(x11)
	xtst, err := purego.Dlopen("libXtst.so.6", purego.RTLD_NOW|purego.RTLD_LOCAL)
	if err != nil {
		t.Fatal(err)
	}
	defer purego.Dlclose(xtst)
	var open func(uintptr) uintptr
	var closeDisplay func(uintptr) int32
	var keysym func(string) uintptr
	var keycode func(uintptr, uintptr) uint8
	var fakeKey func(uintptr, uint32, int32, uintptr) int32
	var flush func(uintptr) int32
	purego.RegisterLibFunc(&open, x11, "XOpenDisplay")
	purego.RegisterLibFunc(&closeDisplay, x11, "XCloseDisplay")
	purego.RegisterLibFunc(&keysym, x11, "XStringToKeysym")
	purego.RegisterLibFunc(&keycode, x11, "XKeysymToKeycode")
	purego.RegisterLibFunc(&flush, x11, "XFlush")
	purego.RegisterLibFunc(&fakeKey, xtst, "XTestFakeKeyEvent")
	display := open(0)
	if display == 0 {
		t.Fatal("could not open the X11 test input connection")
	}
	defer closeDisplay(display)
	var codes []uint32
	for _, mod := range mods {
		name := map[string]string{"ctrl": "Control_L", "alt": "Alt_L", "shift": "Shift_L"}[mod]
		codes = append(codes, uint32(keycode(display, keysym(name))))
	}
	codes = append(codes, uint32(keycode(display, keysym(key))))
	press := func() {
		for _, code := range codes {
			fakeKey(display, code, 1, 0)
		}
		flush(display)
	}
	release := func() {
		for i := len(codes) - 1; i >= 0; i-- {
			fakeKey(display, codes[i], 0, 0)
		}
		flush(display)
	}
	edges := make(chan string, 32)
	s, err := Register(value, func() { edges <- "down" }, func() { edges <- "up" })
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	defer release()
	want := func(edge string) {
		t.Helper()
		select {
		case got := <-edges:
			if got != edge {
				t.Fatalf("got %s, want %s", got, edge)
			}
		case <-ctx.Done():
			t.Fatal("missing native shortcut edge", edge)
		}
	}
	press()
	want("down")
	select {
	case edge := <-edges:
		t.Fatalf("held shortcut delivered %s before physical release (repeat delay %d ms)", edge, delay)
	case <-time.After(time.Duration(delay+250) * time.Millisecond):
	}
	release()
	want("up")
	for range 3 {
		press()
		time.Sleep(15 * time.Millisecond)
		release()
		want("down")
		want("up")
	}
	t.Logf("%s stayed held across auto-repeat and delivered all three quick taps", chord)
}
