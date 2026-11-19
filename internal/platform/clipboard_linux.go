//go:build linux && cgo

package platform

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"yap/internal/fileutil"

	"github.com/godbus/dbus/v5"
	"github.com/google/uuid"
)

const (
	remoteDesktopInterface   = "org.freedesktop.portal.RemoteDesktop"
	clipboardPortalInterface = "org.freedesktop.portal.Clipboard"
)

var waylandClipboard struct {
	sync.Mutex
	session *portalClipboard
}

type portalClipboard struct {
	conn    *dbus.Conn
	session dbus.ObjectPath
	mu      sync.RWMutex
	text    string
	closed  atomic.Bool
}

// GTK cannot reliably own the Wayland selection when dictation finishes while
// another app has focus. The portal grants background clipboard and keyboard
// access together, and that grant/session is reused for subsequent dictations.
func SetClipboard(text string) (bool, error) {
	return SetClipboardContext(context.Background(), text)
}

func SetClipboardContext(parent context.Context, text string) (bool, error) {
	if !waylandSession() {
		return false, nil
	}
	waylandClipboard.Lock()
	defer waylandClipboard.Unlock()
	if err := parent.Err(); err != nil {
		return true, err
	}
	if waylandClipboard.session == nil || waylandClipboard.session.closed.Load() || !waylandClipboard.session.conn.Connected() {
		if waylandClipboard.session != nil {
			waylandClipboard.session.Close()
			waylandClipboard.session = nil
		}
		root, err := os.UserConfigDir()
		if err != nil {
			return true, err
		}
		executable, err := os.Executable()
		if err != nil {
			return true, err
		}
		if err := ensurePortalDesktopEntry(executable); err != nil {
			return true, err
		}
		conn, err := dbus.ConnectSessionBus(dbus.WithSignalHandler(dbus.NewSequentialSignalHandler()))
		if err != nil {
			return true, err
		}
		ctx, cancel := context.WithTimeout(parent, 2*time.Minute)
		session, err := newPortalClipboard(ctx, conn, filepath.Join(root, "yap", "wayland-input-token"))
		cancel()
		if err != nil {
			conn.Close()
			return true, fmt.Errorf("allow Remote Interaction in Yap's desktop permission dialog to copy and paste on Wayland: %w", err)
		}
		waylandClipboard.session = session
	}
	return true, waylandClipboard.session.SetText(text)
}

func newPortalClipboard(ctx context.Context, conn *dbus.Conn, tokenPath string) (_ *portalClipboard, resultErr error) {
	conn.Object(shortcutPortalBus, shortcutPortalPath).CallWithContext(ctx, portalRegistryInterface+".Register", 0, "com.yap.desktop", map[string]dbus.Variant{})
	signals := make(chan *dbus.Signal, 32)
	conn.Signal(signals)
	for _, iface := range []string{portalRequestInterface, clipboardPortalInterface, portalSessionInterface} {
		if err := conn.AddMatchSignalContext(ctx, dbus.WithMatchSender(shortcutPortalBus), dbus.WithMatchInterface(iface)); err != nil {
			return nil, err
		}
	}
	if err := conn.AddMatchSignalContext(ctx, dbus.WithMatchInterface("org.freedesktop.DBus"), dbus.WithMatchMember("NameOwnerChanged"), dbus.WithMatchArg(0, shortcutPortalBus)); err != nil {
		return nil, err
	}
	request := func(method string, args ...any) (map[string]dbus.Variant, error) {
		return desktopPortalRequest(ctx, conn, signals, remoteDesktopInterface, method, args...)
	}
	result, err := request("CreateSession", map[string]dbus.Variant{"session_handle_token": dbus.MakeVariant("yap_" + strings.ReplaceAll(uuid.NewString(), "-", ""))})
	if err != nil {
		return nil, err
	}
	path, _ := result["session_handle"].Value().(string)
	p := &portalClipboard{conn: conn, session: dbus.ObjectPath(path)}
	if !p.session.IsValid() {
		return nil, fmt.Errorf("desktop returned an invalid clipboard session")
	}
	defer func() {
		if resultErr != nil {
			p.Close()
		}
	}()
	options := map[string]dbus.Variant{"types": dbus.MakeVariant(uint32(1)), "persist_mode": dbus.MakeVariant(uint32(2))}
	if token, err := os.ReadFile(tokenPath); err == nil && len(token) > 0 {
		options["restore_token"] = dbus.MakeVariant(string(token))
	}
	if _, err := request("SelectDevices", p.session, options); err != nil {
		return nil, err
	}
	if err := p.call(ctx, clipboardPortalInterface+".RequestClipboard", p.session, map[string]dbus.Variant{}).Err; err != nil {
		return nil, err
	}
	result, err = request("Start", p.session, "", map[string]dbus.Variant{})
	if err != nil {
		return nil, err
	}
	if enabled, _ := result["clipboard_enabled"].Value().(bool); !enabled {
		return nil, fmt.Errorf("desktop did not grant clipboard access")
	}
	if devices, _ := result["devices"].Value().(uint32); devices&1 == 0 {
		return nil, fmt.Errorf("desktop did not grant keyboard access")
	}
	if token, _ := result["restore_token"].Value().(string); token != "" {
		if err := os.MkdirAll(filepath.Dir(tokenPath), 0700); err == nil {
			_ = fileutil.WriteAtomic(tokenPath, []byte(token))
		}
	}
	go p.serve(signals)
	return p, nil
}

func (p *portalClipboard) call(ctx context.Context, method string, args ...any) *dbus.Call {
	return p.conn.Object(shortcutPortalBus, shortcutPortalPath).CallWithContext(ctx, method, 0, args...)
}

func (p *portalClipboard) SetText(text string) error {
	p.mu.Lock()
	previous := p.text
	p.text = text
	p.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	err := p.call(ctx, clipboardPortalInterface+".SetSelection", p.session, map[string]dbus.Variant{"mime_types": dbus.MakeVariant([]string{"text/plain;charset=utf-8", "text/plain", "UTF8_STRING"})}).Err
	if err != nil {
		p.mu.Lock()
		p.text = previous
		p.mu.Unlock()
	}
	return err
}

func (p *portalClipboard) serve(signals <-chan *dbus.Signal) {
	defer p.closed.Store(true)
	defer p.conn.Close()
	for signal := range signals {
		if signal.Name == portalSessionInterface+".Closed" && signal.Path == p.session || portalOwnerLost(signal) {
			return
		}
		if signal.Name != clipboardPortalInterface+".SelectionTransfer" || len(signal.Body) != 3 || signal.Body[0] != p.session {
			continue
		}
		serial, ok := signal.Body[2].(uint32)
		if !ok {
			continue
		}
		p.mu.RLock()
		text := p.text
		p.mu.RUnlock()
		go p.transfer(serial, text)
	}
}

func (p *portalClipboard) transfer(serial uint32, text string) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var fd dbus.UnixFD
	err := p.call(ctx, clipboardPortalInterface+".SelectionWrite", p.session, serial).Store(&fd)
	if err == nil {
		file := os.NewFile(uintptr(fd), "wayland-clipboard")
		_ = file.SetWriteDeadline(time.Now().Add(5 * time.Second))
		_, err = file.WriteString(text)
		if closeErr := file.Close(); err == nil {
			err = closeErr
		}
	}
	p.call(ctx, clipboardPortalInterface+".SelectionWriteDone", p.session, serial, err == nil)
}

func pasteWaylandClipboard() error {
	waylandClipboard.Lock()
	defer waylandClipboard.Unlock()
	p := waylandClipboard.session
	if p == nil || p.closed.Load() {
		return fmt.Errorf("Wayland clipboard session unavailable; copy the transcript again")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for _, event := range []struct{ key, state uint32 }{{0xffe3, 1}, {'v', 1}, {'v', 0}, {0xffe3, 0}} {
		if err := p.call(ctx, remoteDesktopInterface+".NotifyKeyboardKeysym", p.session, map[string]dbus.Variant{}, int32(event.key), event.state).Err; err != nil {
			// Release any injected keys even when an intermediate call fails.
			cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 2*time.Second)
			for _, key := range []int32{'v', 0xffe3} {
				p.call(cleanupCtx, remoteDesktopInterface+".NotifyKeyboardKeysym", p.session, map[string]dbus.Variant{}, key, uint32(0))
			}
			cleanupCancel()
			return err
		}
	}
	return nil
}

func (p *portalClipboard) Close() {
	if p.closed.Swap(true) {
		p.conn.Close()
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	p.conn.Object(shortcutPortalBus, p.session).CallWithContext(ctx, portalSessionInterface+".Close", 0)
	p.conn.Close()
}

func CloseClipboard() {
	waylandClipboard.Lock()
	defer waylandClipboard.Unlock()
	if waylandClipboard.session != nil {
		waylandClipboard.session.Close()
		waylandClipboard.session = nil
	}
}
