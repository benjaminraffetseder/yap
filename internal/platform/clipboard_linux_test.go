//go:build linux && cgo

package platform

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/godbus/dbus/v5"
)

type testClipboardPortal struct {
	*testShortcutPortal
	grant    atomic.Bool
	starts   atomic.Int32
	selected chan map[string]dbus.Variant
	readers  chan *os.File
	done     chan bool
	keys     chan [2]int32
	filesMu  sync.Mutex
	files    []*os.File
}

func (p *testClipboardPortal) SelectDevices(sender dbus.Sender, session dbus.ObjectPath, options map[string]dbus.Variant) (dbus.ObjectPath, *dbus.Error) {
	p.selected <- options
	return p.respond(sender, options, 0, map[string]dbus.Variant{}), nil
}

func (p *testClipboardPortal) RequestClipboard(session dbus.ObjectPath, options map[string]dbus.Variant) *dbus.Error {
	return nil
}

func (p *testClipboardPortal) Start(sender dbus.Sender, session dbus.ObjectPath, parent string, options map[string]dbus.Variant) (dbus.ObjectPath, *dbus.Error) {
	p.starts.Add(1)
	return p.respond(sender, options, 0, map[string]dbus.Variant{"clipboard_enabled": dbus.MakeVariant(p.grant.Load()), "devices": dbus.MakeVariant(uint32(1)), "restore_token": dbus.MakeVariant("replacement-token")}), nil
}

func (p *testClipboardPortal) SetSelection(session dbus.ObjectPath, options map[string]dbus.Variant) *dbus.Error {
	if session != p.session || options["mime_types"].Signature().String() != "as" {
		return dbus.MakeFailedError(fmt.Errorf("invalid clipboard selection"))
	}
	return nil
}

func (p *testClipboardPortal) SelectionWrite(session dbus.ObjectPath, serial uint32) (dbus.UnixFD, *dbus.Error) {
	r, w, err := os.Pipe()
	if err != nil {
		return 0, dbus.MakeFailedError(err)
	}
	p.filesMu.Lock()
	p.files = append(p.files, r, w)
	p.filesMu.Unlock()
	p.readers <- r
	return dbus.UnixFD(w.Fd()), nil
}

func (p *testClipboardPortal) SelectionWriteDone(session dbus.ObjectPath, serial uint32, success bool) *dbus.Error {
	p.done <- success
	return nil
}

func (p *testClipboardPortal) NotifyKeyboardKeysym(session dbus.ObjectPath, options map[string]dbus.Variant, key int32, state uint32) *dbus.Error {
	p.keys <- [2]int32{key, int32(state)}
	return nil
}

func newTestClipboardPortal(t *testing.T) (*testClipboardPortal, *dbus.Conn) {
	t.Helper()
	base, conn := newTestShortcutPortal(t)
	p := &testClipboardPortal{testShortcutPortal: base, selected: make(chan map[string]dbus.Variant, 1), readers: make(chan *os.File, 4), done: make(chan bool, 4), keys: make(chan [2]int32, 8)}
	p.grant.Store(true)
	for _, iface := range []string{remoteDesktopInterface, clipboardPortalInterface} {
		if err := p.conn.Export(p, shortcutPortalPath, iface); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() {
		p.filesMu.Lock()
		defer p.filesMu.Unlock()
		for _, file := range p.files {
			file.Close()
		}
	})
	return p, conn
}

func TestWaylandClipboardDeliversNewTextAndReusesPermission(t *testing.T) {
	p, conn := newTestClipboardPortal(t)
	tokenPath := filepath.Join(t.TempDir(), "token")
	if err := os.WriteFile(tokenPath, []byte("previous-token"), 0600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	writer, err := newPortalClipboard(ctx, conn, tokenPath)
	if err != nil {
		t.Fatal(err)
	}
	waylandClipboard.Lock()
	waylandClipboard.session = writer
	waylandClipboard.Unlock()
	t.Cleanup(CloseClipboard)
	t.Setenv("XDG_SESSION_TYPE", "wayland")
	options := <-p.selected
	if options["types"].Value() != uint32(1) || options["persist_mode"].Value() != uint32(2) || options["restore_token"].Value() != "previous-token" {
		t.Fatal("clipboard permission did not request keyboard-only persistent access", options)
	}
	for i, text := range []string{"First transcript.", "Neue Transkription — äöü."} {
		if handled, err := SetClipboard(text); !handled || err != nil {
			t.Fatal("copy failed", handled, err)
		}
		if err := p.conn.Emit(shortcutPortalPath, clipboardPortalInterface+".SelectionTransfer", p.session, "text/plain;charset=utf-8", uint32(i+1)); err != nil {
			t.Fatal(err)
		}
		select {
		case success := <-p.done:
			if !success {
				t.Fatal("clipboard transfer failed")
			}
		case <-ctx.Done():
			t.Fatal("clipboard transfer was not served")
		}
		reader := <-p.readers
		data := make([]byte, len(text))
		if _, err := io.ReadFull(reader, data); err != nil || string(data) != text {
			t.Fatalf("clipboard contains stale text: %q, %v", data, err)
		}
	}
	if err := pasteWaylandClipboard(); err != nil {
		t.Fatal(err)
	}
	got := [][2]int32{}
	for range 4 {
		got = append(got, <-p.keys)
	}
	if want := [][2]int32{{0xffe3, 1}, {'v', 1}, {'v', 0}, {0xffe3, 0}}; !reflect.DeepEqual(got, want) {
		t.Fatal("incorrect native paste events", got)
	}
	if p.starts.Load() != 1 {
		t.Fatal("a second transcription requested a new permission session")
	}
	if data, err := os.ReadFile(tokenPath); err != nil || string(data) != "replacement-token" {
		t.Fatal("updated restore token was not saved", err)
	}
	if info, err := os.Stat(tokenPath); err != nil || info.Mode().Perm() != 0600 {
		t.Fatal("restore token is not private", err)
	}
}

func TestWaylandClipboardDenialNeverReportsSuccessfulCopy(t *testing.T) {
	p, conn := newTestClipboardPortal(t)
	p.grant.Store(false)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if writer, err := newPortalClipboard(ctx, conn, filepath.Join(t.TempDir(), "token")); writer != nil || err == nil {
		t.Fatal("missing clipboard permission was reported as a successful copy")
	}
	if p.closed.Load() != 1 {
		t.Fatal("denied clipboard session was left open")
	}
}
