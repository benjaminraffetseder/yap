package tray

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/godbus/dbus/v5"
)

func checkTraySupport() error {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	conn, err := dbus.ConnectSessionBus(dbus.WithContext(ctx))
	if err != nil {
		return fmt.Errorf("Linux system tray needs a D-Bus desktop session: %w", err)
	}
	defer conn.Close()
	return checkStatusNotifierHost(ctx, conn)
}

func checkStatusNotifierHost(ctx context.Context, conn *dbus.Conn) error {
	var registered dbus.Variant
	err := conn.Object("org.kde.StatusNotifierWatcher", "/StatusNotifierWatcher").CallWithContext(
		ctx, "org.freedesktop.DBus.Properties.Get", 0,
		"org.kde.StatusNotifierWatcher", "IsStatusNotifierHostRegistered",
	).Store(&registered)
	if err != nil {
		return fmt.Errorf("Linux system tray needs a StatusNotifier host; enable AppIndicator support on GNOME: %w", err)
	}
	if available, ok := registered.Value().(bool); !ok || !available {
		return errors.New("Linux system tray host is unavailable; enable AppIndicator support on GNOME")
	}
	return nil
}
