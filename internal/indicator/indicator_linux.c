//go:build linux && cgo

// The compositor's native Wayland protocol cannot place an always-on-top
// non-activating window on GNOME. Keep just the indicator on X11/XWayland.
// GTK/WebKit still own its contents, events, and lifetime.
#include "indicator_linux.h"
// GTK 4.18 deprecated its entire X11 backend. It remains necessary for GNOME's
// non-activating overlay; there is no native Wayland equivalent available here.
#define GDK_DISABLE_DEPRECATION_WARNINGS
#include <gtk/gtk.h>
#if GTK_MAJOR_VERSION >= 4
#include <gdk/x11/gdkx.h>
#else
#include <gdk/gdkx.h>
#endif
#include <X11/Xatom.h>
#include <X11/extensions/shape.h>
#include <math.h>

typedef struct {
    Display *display;
    Window window;
    int scale;
} Native;

typedef struct {
    bool active, moved;
    int offset_x, offset_y;
} Drag;

static bool native_window(void *pointer, Native *out) {
    if (!pointer) return false;
#if GTK_MAJOR_VERSION >= 4
    GdkSurface *surface = gtk_native_get_surface(GTK_NATIVE(pointer));
    if (!surface || !GDK_IS_X11_SURFACE(surface)) return false;
    GdkDisplay *display = gdk_surface_get_display(surface);
    out->window = gdk_x11_surface_get_xid(surface);
    out->scale = gdk_surface_get_scale_factor(surface);
#else
    GdkWindow *surface = gtk_widget_get_window(GTK_WIDGET(pointer));
    if (!surface || !GDK_IS_X11_WINDOW(surface)) return false;
    GdkDisplay *display = gdk_window_get_display(surface);
    out->window = gdk_x11_window_get_xid(surface);
    out->scale = gdk_window_get_scale_factor(surface);
#endif
    out->display = gdk_x11_display_get_xdisplay(display);
    return true;
}

bool yap_indicator_supported(void) {
    const char *name = g_getenv("DISPLAY");
    if (!name || !*name) return false;
    Display *display = XOpenDisplay(name);
    if (!display) return false;
    XCloseDisplay(display);
    return true;
}

static void protect_focus(Native n) {
    XWMHints *hints = XGetWMHints(n.display, n.window);
    if (!hints) hints = XAllocWMHints();
    if (hints) {
        hints->flags |= InputHint;
        hints->input = False;
        XSetWMHints(n.display, n.window, hints);
        XFree(hints);
    }
    Atom *protocols = NULL;
    int count = 0;
    Atom take_focus = XInternAtom(n.display, "WM_TAKE_FOCUS", False);
    if (XGetWMProtocols(n.display, n.window, &protocols, &count)) {
        int keep = 0;
        for (int i = 0; i < count; i++)
            if (protocols[i] != take_focus) protocols[keep++] = protocols[i];
        XSetWMProtocols(n.display, n.window, protocols, keep);
        XFree(protocols);
    }
}

bool yap_indicator_configure(void *pointer) {
    if (!pointer) return false;
    GtkWindow *window = GTK_WINDOW(pointer);
    GdkDisplay *display = gtk_widget_get_display(GTK_WIDGET(window));
    if (!GDK_IS_X11_DISPLAY(display)) {
        // Reuse the process's X11 display on reload/recreation. GDK owns its
        // lifetime, alongside the main window's original Wayland display.
        GSList *displays = gdk_display_manager_list_displays(gdk_display_manager_get());
        GdkDisplay *x11 = NULL;
        for (GSList *item = displays; item; item = item->next)
            if (GDK_IS_X11_DISPLAY(item->data)) { x11 = item->data; break; }
        g_slist_free(displays);
#if GTK_MAJOR_VERSION >= 4
        if (!x11) x11 = gdk_x11_display_open(g_getenv("DISPLAY"));
#else
        if (!x11) x11 = gdk_display_open(g_getenv("DISPLAY"));
#endif
        if (!x11) return false;
#if GTK_MAJOR_VERSION >= 4
        gtk_window_set_display(window, x11);
#else
        gtk_window_set_screen(window, gdk_display_get_default_screen(x11));
#endif
    }
    gtk_window_set_decorated(window, FALSE);
#if GTK_MAJOR_VERSION < 4
    gtk_window_set_accept_focus(window, FALSE);
    gtk_window_set_focus_on_map(window, FALSE);
    gtk_window_set_skip_taskbar_hint(window, TRUE);
    gtk_window_set_skip_pager_hint(window, TRUE);
#endif
    gtk_widget_realize(GTK_WIDGET(window));
    Native n;
    if (!native_window(pointer, &n)) return false;
    // Unmanaged windows are absent from Alt+Tab and cannot be activated by
    // the window manager when mapped or clicked. No input grabs are used.
    XSetWindowAttributes attrs = { .override_redirect = True };
    XChangeWindowAttributes(n.display, n.window, CWOverrideRedirect, &attrs);
    Atom type = XInternAtom(n.display, "_NET_WM_WINDOW_TYPE_NOTIFICATION", False);
    XChangeProperty(n.display, n.window, XInternAtom(n.display, "_NET_WM_WINDOW_TYPE", False),
                    XA_ATOM, 32, PropModeReplace, (unsigned char *)&type, 1);
    protect_focus(n);
    XFlush(n.display);
    return true;
}

bool yap_indicator_focused(void *pointer) {
    GList *windows = gtk_window_list_toplevels();
    bool focused = false;
    for (GList *item = windows; item; item = item->next) {
        GtkWindow *window = GTK_WINDOW(item->data);
        if (window == pointer || !gtk_widget_get_visible(GTK_WIDGET(window)) || !gtk_window_is_active(window)) continue;
#if GTK_MAJOR_VERSION >= 4
        GdkSurface *surface = gtk_native_get_surface(GTK_NATIVE(window));
        if (surface && (gdk_toplevel_get_state(GDK_TOPLEVEL(surface)) & GDK_TOPLEVEL_STATE_MINIMIZED)) continue;
#else
        GdkWindow *surface = gtk_widget_get_window(GTK_WIDGET(window));
        if (surface && (gdk_window_get_state(surface) & GDK_WINDOW_STATE_ICONIFIED)) continue;
#endif
        focused = true;
        break;
    }
    g_list_free(windows);
    return focused;
}

bool yap_indicator_geometry(void *pointer, int *x, int *y, int *width, int *height) {
    Native n;
    if (!native_window(pointer, &n)) return false;
    XWindowAttributes attrs;
    if (!XGetWindowAttributes(n.display, n.window, &attrs)) return false;
    Window child;
    XTranslateCoordinates(n.display, n.window, DefaultRootWindow(n.display), 0, 0, x, y, &child);
    *width = attrs.width;
    *height = attrs.height;
    // A hidden GTK4 window initially has a 1x1 surface, until its first layout.
    // Place and shape its intended size before mapping to avoid a visible jump.
    if (!gtk_widget_get_mapped(GTK_WIDGET(pointer))) {
        int default_width, default_height;
        gtk_window_get_default_size(GTK_WINDOW(pointer), &default_width, &default_height);
        if (default_width > 0) *width = default_width * n.scale;
        if (default_height > 0) *height = default_height * n.scale;
    }
    return true;
}

static bool cursor(Native n, int *x, int *y) {
    Window root, child;
    int win_x, win_y;
    unsigned int mask;
    return XQueryPointer(n.display, DefaultRootWindow(n.display), &root, &child, x, y, &win_x, &win_y, &mask);
}

static GdkRectangle workarea(void *pointer, int x, int y, int scale) {
    GdkDisplay *display = gtk_widget_get_display(GTK_WIDGET(pointer));
    Display *xdisplay = gdk_x11_display_get_xdisplay(display);
    int screen = DefaultScreen(xdisplay);
    GdkRectangle area = {0, 0, DisplayWidth(xdisplay, screen), DisplayHeight(xdisplay, screen)};
#if GTK_MAJOR_VERSION >= 4
    GListModel *monitors = gdk_display_get_monitors(display);
    int count = g_list_model_get_n_items(monitors);
#else
    int count = gdk_display_get_n_monitors(display);
#endif
    for (int i = 0; i < count; i++) {
#if GTK_MAJOR_VERSION >= 4
        GdkMonitor *monitor = g_list_model_get_item(monitors, i);
#else
        GdkMonitor *monitor = gdk_display_get_monitor(display, i);
#endif
        GdkRectangle bounds;
        GdkRectangle geometry;
        gdk_monitor_get_geometry(monitor, &geometry);
        geometry.x *= scale; geometry.y *= scale;
        geometry.width *= scale; geometry.height *= scale;
        // GDK's X11 work area accounts for the desktop's dock and panel.
#if GTK_MAJOR_VERSION >= 4
        gdk_x11_monitor_get_workarea(monitor, &bounds);
#else
        gdk_monitor_get_workarea(monitor, &bounds);
#endif
        bounds.x *= scale; bounds.y *= scale;
        bounds.width *= scale; bounds.height *= scale;
        if (i == 0 || (x >= geometry.x && x < geometry.x + geometry.width && y >= geometry.y && y < geometry.y + geometry.height))
            area = bounds;
#if GTK_MAJOR_VERSION >= 4
        g_object_unref(monitor);
#endif
    }
    return area;
}

static void rounded(Native n, int width, int height) {
    int event, error;
    if (!XShapeQueryExtension(n.display, &event, &error)) return;
    int radius = MIN(12 * n.scale, MIN(width, height) / 2);
    if (radius <= 0) return;
    XRectangle *rects = g_new(XRectangle, height);
    for (int y = 0; y < height; y++) {
        int row = MIN(y, height - 1 - y);
        int inset = 0;
        if (row < radius) {
            double dy = radius - row - 0.5;
            inset = (int)ceil(radius - sqrt(radius * radius - dy * dy));
        }
        rects[y] = (XRectangle){inset, y, MAX(0, width - 2 * inset), 1};
    }
    XShapeCombineRectangles(n.display, n.window, ShapeBounding, 0, 0, rects, height, ShapeSet, YXBanded);
    g_free(rects);
}

void yap_indicator_place(void *pointer, bool keep, int *x, int *y) {
    Native n;
    int old_x, old_y, width, height;
    if (!native_window(pointer, &n) || !yap_indicator_geometry(pointer, &old_x, &old_y, &width, &height)) return;
    Drag *drag = g_object_get_data(G_OBJECT(pointer), "yap-indicator-drag");
    if (drag && drag->active) return;
    int anchor_x = *x + width / 2, anchor_y = *y + height / 2;
    if (!keep) cursor(n, &anchor_x, &anchor_y);
    GdkRectangle area = workarea(pointer, anchor_x, anchor_y, n.scale);
    if (!keep) {
        *x = area.x + (area.width - width) / 2;
        *y = area.y + area.height - height - 24 * n.scale;
    }
    *x = MAX(area.x, MIN(*x, area.x + MAX(0, area.width - width)));
    *y = MAX(area.y, MIN(*y, area.y + MAX(0, area.height - height)));
    if (*x != old_x || *y != old_y) XMoveWindow(n.display, n.window, *x, *y);
    rounded(n, width, height);
    XFlush(n.display);
}

void yap_indicator_show(void *pointer) {
    Native n;
    if (!native_window(pointer, &n)) return;
    gtk_widget_set_visible(GTK_WIDGET(pointer), TRUE);
    // GTK refreshes its normal input hints when mapping a toplevel.
    protect_focus(n);
    XRaiseWindow(n.display, n.window);
    XFlush(n.display);
}

bool yap_indicator_drag(void *pointer, int action, double x, double y, int *out_x, int *out_y) {
    Native n;
    int old_x, old_y, width, height;
    if (!native_window(pointer, &n) || !yap_indicator_geometry(pointer, &old_x, &old_y, &width, &height)) return false;
    Drag *drag = g_object_get_data(G_OBJECT(pointer), "yap-indicator-drag");
    if (!drag) {
        drag = g_new0(Drag, 1);
        g_object_set_data_full(G_OBJECT(pointer), "yap-indicator-drag", drag, g_free);
    }
    if (action == 0) {
        drag->active = true; drag->moved = false;
        drag->offset_x = (int)round(x * width); drag->offset_y = (int)round(y * height);
        return false;
    }
    if (!drag->active) return false;
    if (action == 1) {
        int mouse_x, mouse_y;
        if (cursor(n, &mouse_x, &mouse_y)) {
            *out_x = mouse_x - drag->offset_x; *out_y = mouse_y - drag->offset_y;
            if (*out_x != old_x || *out_y != old_y) {
                XMoveWindow(n.display, n.window, *out_x, *out_y);
                XFlush(n.display);
                drag->moved = true;
                return true;
            }
        }
        return false;
    }
    drag->active = false;
    if (!drag->moved) return false;
    *out_x = old_x; *out_y = old_y;
    yap_indicator_place(pointer, true, out_x, out_y);
    return true;
}

bool yap_indicator_safe(void *pointer) {
    Native n;
    if (!native_window(pointer, &n)) return false;
    XWindowAttributes attrs;
    if (!XGetWindowAttributes(n.display, n.window, &attrs) || !attrs.override_redirect) return false;
    XWMHints *hints = XGetWMHints(n.display, n.window);
    bool safe = hints && (hints->flags & InputHint) && !hints->input;
    if (hints) XFree(hints);
    Atom *protocols = NULL;
    int count = 0;
    Atom take_focus = XInternAtom(n.display, "WM_TAKE_FOCUS", False);
    if (XGetWMProtocols(n.display, n.window, &protocols, &count)) {
        for (int i = 0; i < count; i++)
            if (protocols[i] == take_focus) safe = false;
        XFree(protocols);
    }
    return safe;
}
