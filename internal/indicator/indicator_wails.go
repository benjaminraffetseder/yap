//go:build windows || (darwin && cgo)

package indicator

import (
	"errors"
	"math"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

const windowName = "indicator"

// frame contains presentation only, without transcripts or main-window data.
type frame struct {
	Revision  uint64  `json:"revision"`
	Phase     string  `json:"phase"`
	Label     string  `json:"label"`
	Primary   string  `json:"primary"`
	Secondary string  `json:"secondary"`
	Level     float64 `json:"level"`
	Dark      bool    `json:"dark"`
}

type pointerDrag struct {
	ID     uint64
	Action string
	X, Y   float64 // Pointer-down offset as a fraction of the webview size.
}

type wailsIndicator struct {
	mu                                       sync.Mutex
	state                                    State
	actions                                  Actions
	level                                    float64
	dark                                     bool
	revision                                 uint64
	expires                                  time.Time
	dismissed, closed, ready, queued, active bool
	// Only render accesses these fields, on the Wails UI thread.
	visible          bool
	last             frame
	positionRevision uint64
	dragID           uint64
	dragEnded        bool
	enqueue          func(func())
	focused          func() bool
	place            func(bool)
	show, hide       func()
	send             func(frame)
	drag             func(pointerDrag)
	destroy          func()
	stop             chan struct{}
	unsubscribe      []func()
}

// New configures a separate Wails window before App.Run. It never mounts the
// main frontend or its recording, model-management and update-check effects.
func New(app *application.App, actions Actions, dataDir string) (Controller, error) {
	if app == nil {
		return nil, errors.New("floating indicator requires a Wails application")
	}
	c := newWailsIndicator(actions, application.InvokeAsync)
	options := application.WebviewWindowOptions{
		Name: windowName, Title: "Yap — Dictation status", URL: "/indicator.html",
		Width: 316, Height: 40, Hidden: true, Frameless: true,
		AlwaysOnTop: true, DisableResize: true, DefaultContextMenuDisabled: true,
		BackgroundColour:    application.NewRGB(40, 41, 43),
		MinimiseButtonState: application.ButtonHidden,
		MaximiseButtonState: application.ButtonHidden,
		CloseButtonState:    application.ButtonHidden,
	}
	configureOptions(&options)
	window := app.Window.NewWithOptions(options)
	platform := newPlatformWindow(app, window, dataDir)
	c.focused, c.place, c.drag = platform.focused, platform.place, platform.drag
	c.show = func() { window.Show() }
	c.hide = func() { window.Hide() }
	c.send = func(f frame) { app.Event.Emit("indicator:frame", f) }
	c.destroy = func() {
		application.InvokeSync(func() { platform.drag(pointerDrag{Action: "end"}); platform.close(); window.Close() })
	}
	window.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
		c.mu.Lock()
		closed := c.closed
		if !closed {
			c.dismissed = true
		}
		c.mu.Unlock()
		if !closed {
			e.Cancel()
			c.schedule()
		}
	})
	c.unsubscribe = append(c.unsubscribe,
		app.Event.On("indicator:ready", func(e *application.CustomEvent) {
			if e.Sender != windowName {
				return
			}
			// Reloading needs a fresh frame even when state has not changed.
			c.enqueue(func() {
				c.mu.Lock()
				closed := c.closed
				c.mu.Unlock()
				if closed {
					return
				}
				platform.configure()
				c.mu.Lock()
				c.ready = true
				c.mu.Unlock()
				c.last = frame{}
				c.render()
			})
		}),
		app.Event.On("indicator:action", func(e *application.CustomEvent) {
			if e.Sender != windowName {
				return
			}
			data, ok := e.Data.(map[string]any)
			if !ok {
				return
			}
			action, _ := data["action"].(string)
			revision, _ := data["revision"].(float64)
			c.dispatch(action, uint64(revision))
		}),
		app.Event.On("indicator:drag", func(e *application.CustomEvent) {
			if e.Sender != windowName {
				return
			}
			data, ok := e.Data.(map[string]any)
			if !ok {
				return
			}
			action, _ := data["action"].(string)
			id, _ := data["id"].(float64)
			x, _ := data["x"].(float64)
			y, _ := data["y"].(float64)
			if id <= 0 || x < 0 || x > 1 || y < 0 || y > 1 {
				return
			}
			drag := pointerDrag{ID: uint64(id), Action: action, X: x, Y: y}
			c.enqueue(func() { c.handleDrag(drag) })
		}),
	)
	go func() {
		ticker := time.NewTicker(100 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-c.stop:
				return
			case <-ticker.C:
				c.mu.Lock()
				active := c.active
				c.mu.Unlock()
				if active {
					c.schedule()
				}
			}
		}
	}()
	return c, nil
}

func newWailsIndicator(actions Actions, enqueue func(func())) *wailsIndicator {
	return &wailsIndicator{actions: actions, enqueue: enqueue, dark: true, stop: make(chan struct{})}
}

func (c *wailsIndicator) Update(s State) {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return
	}
	c.state, c.dismissed = s, false
	c.revision++ // Repeated errors refresh the notification and invalidate old buttons.
	c.expires = time.Time{}
	if duration := presentation(s, time.Now()).dismissAfter; duration > 0 {
		c.expires = time.Now().Add(duration)
	}
	c.mu.Unlock()
	c.schedule()
}

func (c *wailsIndicator) SetLevel(level float64) {
	if math.IsNaN(level) || math.IsInf(level, 0) {
		level = 0
	}
	c.mu.Lock()
	c.level = max(0, min(1, level))
	c.mu.Unlock()
	// The 100ms refresh coalesces audio samples without filling the UI queue.
}

func (c *wailsIndicator) SetTheme(dark bool) {
	c.mu.Lock()
	c.dark = dark
	c.mu.Unlock()
	c.schedule()
}

func (c *wailsIndicator) schedule() {
	c.mu.Lock()
	if c.closed || c.queued {
		c.mu.Unlock()
		return
	}
	c.queued = true
	c.mu.Unlock()
	// Recording callbacks may hold App.mu; never wait for the UI thread here.
	c.enqueue(c.render)
}

func (c *wailsIndicator) render() {
	c.mu.Lock()
	c.queued = false
	if c.closed {
		c.mu.Unlock()
		return
	}
	now := time.Now()
	v := presentation(c.state, now)
	want := c.ready && v.visible && !c.dismissed && (c.expires.IsZero() || now.Before(c.expires))
	c.active = want // Poll focus only while there is a live notification.
	f := frame{c.revision, c.state.Phase, v.label, v.stop, v.cancel, c.level, c.dark}
	c.mu.Unlock()
	if want {
		want = !c.focused()
	}
	if !want {
		if c.visible {
			c.drag(pointerDrag{Action: "end"})
			c.dragEnded = true
			c.hide()
			c.visible = false
		}
		return
	}
	c.place(!c.visible || f.Phase == "recording" && c.positionRevision != f.Revision)
	c.positionRevision = f.Revision
	if f != c.last || !c.visible {
		c.send(f)
		c.last = f
	}
	if !c.visible {
		c.show()
		c.visible = true
	}
}

func (c *wailsIndicator) handleDrag(d pointerDrag) {
	c.mu.Lock()
	closed := c.closed
	c.mu.Unlock()
	if closed || !c.visible || d.ID < c.dragID || d.ID == c.dragID && c.dragEnded {
		return
	}
	if d.Action != "start" && d.Action != "move" && d.Action != "end" {
		return
	}
	// Wails dispatches custom-event callbacks concurrently. Every message carries
	// the original anchor, so even an end arriving before start can finish safely.
	if d.ID != c.dragID {
		c.drag(pointerDrag{Action: "end"})
		c.dragID, c.dragEnded = d.ID, false
		start := d
		start.Action = "start"
		c.drag(start)
	}
	if d.Action == "move" || d.Action == "end" {
		move := d
		move.Action = "move"
		c.drag(move)
	}
	if d.Action == "end" {
		c.drag(d)
		c.dragEnded = true
	}
}

func (c *wailsIndicator) dispatch(action string, revision uint64) {
	c.mu.Lock()
	if c.closed || c.dismissed || revision != c.revision || !c.expires.IsZero() && !time.Now().Before(c.expires) {
		c.mu.Unlock()
		return
	}
	v := presentation(c.state, time.Now())
	sessionID := c.state.SessionID
	var callback func(string)
	switch action {
	case "primary":
		if v.stop == "Stop" {
			callback = c.actions.Stop
		} else if v.stop == "Open Yap" {
			if show := c.actions.Show; show != nil {
				callback = func(string) { show() }
			}
		}
	case "secondary":
		if v.cancel == "Cancel" {
			callback = c.actions.Cancel
		} else if v.cancel == "Dismiss" {
			c.dismissed = true
		}
	}
	c.mu.Unlock()
	if callback != nil {
		go callback(sessionID)
	}
	c.schedule()
}

func (c *wailsIndicator) Close() {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return
	}
	c.closed = true
	close(c.stop)
	c.mu.Unlock()
	for _, off := range c.unsubscribe {
		off()
	}
	// Queued work observes closed. No worker waits on the main thread at exit.
	if c.destroy != nil {
		c.destroy()
	}
}
