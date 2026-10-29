//go:build darwin && cgo

// Wails owns the NSPanel and WKWebView. These helpers only preserve focus and
// existing AppKit saved geometry; all controls and drawing live in the frontend.
#import <AppKit/AppKit.h>
#import <objc/runtime.h>
#include <stdbool.h>

static NSString *const FrameName = @"YapDictationIndicator";
static BOOL denyKey(id self, SEL selector) { return NO; }
static BOOL acceptFirstMouse(id self, SEL selector, NSEvent *event) { return YES; }
static NSPoint dragOffset;

static void configureWebview(NSView *view) {
    if ([view isKindOfClass:NSClassFromString(@"WKWebView")]) {
        // WebKit normally rejects the first mouse event in a background window.
        // This panel stays non-key, so its controls must accept that first click.
        Class guard = NSClassFromString(@"YapIndicatorWebview");
        if (!guard) {
            Class base = object_getClass(view);
            guard = objc_allocateClassPair(base, "YapIndicatorWebview", 0);
            class_addMethod(guard, @selector(acceptsFirstMouse:), (IMP)acceptFirstMouse,
                method_getTypeEncoding(class_getInstanceMethod(base, @selector(acceptsFirstMouse:))));
            class_addMethod(guard, @selector(needsPanelToBecomeKey), (IMP)denyKey,
                method_getTypeEncoding(class_getInstanceMethod(base, @selector(needsPanelToBecomeKey))));
            objc_registerClassPair(guard);
        }
        object_setClass(view, guard);
        return;
    }
    for (NSView *child in view.subviews) { configureWebview(child); }
}

bool yap_indicator_configure(void *pointer) {
    NSPanel *panel = (__bridge NSPanel *)pointer;
    // Wails panels can become key windows. This indicator has no text inputs
    // and must keep keyboard input in the app receiving the dictation.
    Class guard = NSClassFromString(@"YapIndicatorWebviewPanel");
    if (!guard) {
        Class base = object_getClass(panel);
        guard = objc_allocateClassPair(base, "YapIndicatorWebviewPanel", 0);
        class_addMethod(guard, @selector(canBecomeKeyWindow), (IMP)denyKey,
            method_getTypeEncoding(class_getInstanceMethod(base, @selector(canBecomeKeyWindow))));
        class_addMethod(guard, @selector(canBecomeMainWindow), (IMP)denyKey,
            method_getTypeEncoding(class_getInstanceMethod(base, @selector(canBecomeMainWindow))));
        objc_registerClassPair(guard);
    }
    object_setClass(panel, guard);
    configureWebview(panel.contentView);
    BOOL restored = [panel setFrameUsingName:FrameName force:YES];
    [panel setContentSize:NSMakeSize(376, 64)];
    return restored;
}

bool yap_indicator_focused(void *pointer) {
    NSWindow *focused = NSApp.keyWindow;
    return NSApp.active && focused && focused != (__bridge NSWindow *)pointer && focused.visible && !focused.miniaturized;
}

void yap_indicator_place(void *pointer, bool positioned) {
    NSWindow *window = (__bridge NSWindow *)pointer;
    NSScreen *screen = window.screen ?: NSScreen.mainScreen;
    if (!positioned) {
        NSPoint mouse = NSEvent.mouseLocation;
        for (NSScreen *candidate in NSScreen.screens) {
            if (NSPointInRect(mouse, candidate.frame)) { screen = candidate; break; }
        }
    }
    NSRect area = screen.visibleFrame, frame = window.frame;
    NSPoint origin = positioned ? frame.origin : NSMakePoint(NSMidX(area)-NSWidth(frame)/2, NSMinY(area)+24);
    origin.x = MAX(NSMinX(area), MIN(origin.x, NSMaxX(area)-NSWidth(frame)));
    origin.y = MAX(NSMinY(area), MIN(origin.y, NSMaxY(area)-NSHeight(frame)));
    if (!NSEqualPoints(origin, frame.origin)) { [window setFrameOrigin:origin]; }
}

bool yap_indicator_drag(void *pointer, int action, double x, double y) {
    NSWindow *window = (__bridge NSWindow *)pointer;
    NSPoint mouse = NSEvent.mouseLocation;
    if (action == 0) {
        dragOffset = NSMakePoint(x*NSWidth(window.frame), (1-y)*NSHeight(window.frame));
    } else if (action == 1) {
        NSPoint origin = NSMakePoint(mouse.x-dragOffset.x, mouse.y-dragOffset.y);
        if (!NSEqualPoints(origin, window.frame.origin)) { [window setFrameOrigin:origin]; return true; }
    } else {
        yap_indicator_place(pointer, true);
        [window saveFrameUsingName:FrameName];
    }
    return false;
}
