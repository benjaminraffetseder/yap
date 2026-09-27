//go:build darwin && cgo

#import <AppKit/AppKit.h>
#include <stdint.h>

extern void yapTrayAction(uintptr_t handle, int action);

static void onTrayMain(dispatch_block_t block) {
    if (NSThread.isMainThread) { block(); }
    else { dispatch_sync(dispatch_get_main_queue(), block); }
}

// Forward existing Wails delegate callbacks. Intercept only the window close
// button and Dock reopen; application termination still reaches Wails normally.
@interface YapTrayController : NSObject <NSWindowDelegate, NSApplicationDelegate>
@property(nonatomic) uintptr_t callback;
@property(nonatomic, strong) NSStatusItem *item;
@property(nonatomic, strong) NSWindow *window;
@property(nonatomic, strong) id<NSWindowDelegate> windowDelegate;
@property(nonatomic, strong) id<NSApplicationDelegate> appDelegate;
@property(nonatomic, strong) NSMenuItem *status;
@property(nonatomic, strong) NSMenuItem *record;
@property(nonatomic, strong) NSMenuItem *cancel;
@end

@implementation YapTrayController
- (BOOL)respondsToSelector:(SEL)selector {
    return [super respondsToSelector:selector] || [self.windowDelegate respondsToSelector:selector] || [self.appDelegate respondsToSelector:selector];
}
- (id)forwardingTargetForSelector:(SEL)selector {
    if ([self.windowDelegate respondsToSelector:selector]) { return self.windowDelegate; }
    if ([self.appDelegate respondsToSelector:selector]) { return self.appDelegate; }
    return [super forwardingTargetForSelector:selector];
}
- (BOOL)windowShouldClose:(NSWindow *)sender {
    // Hide only the main window: keep the recording panel visible and the
    // current typing target focused. Do not hide the entire application.
    [sender orderOut:nil];
    return NO;
}
- (BOOL)applicationShouldHandleReopen:(NSApplication *)sender hasVisibleWindows:(BOOL)visible {
    if (self.callback) { yapTrayAction(self.callback, 1); }
    return NO; // The callback restores our existing window; skip document creation.
}
- (void)action:(NSMenuItem *)sender {
    if (self.callback) { yapTrayAction(self.callback, (int)sender.tag); }
}
- (NSMenuItem *)add:(NSString *)title tag:(NSInteger)tag to:(NSMenu *)menu {
    NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:title action:@selector(action:) keyEquivalent:@""];
    item.target = self;
    item.tag = tag;
    [menu addItem:item];
    return item;
}
@end

void *yap_tray_new(uintptr_t callback) {
    __block YapTrayController *controller = nil;
    onTrayMain(^{
        if (!NSApp || !NSApp.delegate) { return; }
        NSWindow *window = NSApp.mainWindow;
        if (!window) {
            for (NSWindow *candidate in NSApp.windows) {
                if (![candidate isKindOfClass:NSPanel.class] && candidate.canBecomeMainWindow && candidate.delegate) { window = candidate; break; }
            }
        }
        if (!window) { return; }
        controller = [YapTrayController new];
        controller.callback = callback;
        controller.window = window;
        controller.windowDelegate = window.delegate;
        controller.appDelegate = NSApp.delegate;
        controller.item = [NSStatusBar.systemStatusBar statusItemWithLength:NSSquareStatusItemLength];
        if (!controller.item || !controller.item.button) { controller = nil; return; }
        controller.item.button.image = [NSImage imageWithSystemSymbolName:@"mic.fill" accessibilityDescription:@"Yap"];
        controller.item.button.image.template = YES;
        controller.item.button.toolTip = @"Yap";
        NSMenu *menu = [[NSMenu alloc] initWithTitle:@"Yap"];
        menu.autoenablesItems = NO;
        controller.status = [controller add:@"Set up a speech model" tag:0 to:menu];
        controller.status.enabled = NO;
        [menu addItem:NSMenuItem.separatorItem];
        [controller add:@"Open Yap" tag:1 to:menu];
        controller.record = [controller add:@"Start recording" tag:2 to:menu];
        controller.record.enabled = NO;
        controller.cancel = [controller add:@"Cancel" tag:3 to:menu];
        controller.cancel.enabled = NO;
        [menu addItem:NSMenuItem.separatorItem];
        [controller add:@"Quit Yap" tag:4 to:menu];
        controller.item.menu = menu;
        window.delegate = controller;
        NSApp.delegate = controller;
    });
    return (__bridge_retained void *)controller;
}

void yap_tray_update(void *item, const char *status, const char *record, int record_enabled, int cancel_enabled, int recording) {
    YapTrayController *controller = (__bridge YapTrayController *)item;
    onTrayMain(^{
        controller.status.title = [NSString stringWithUTF8String:status];
        controller.record.title = [NSString stringWithUTF8String:record];
        controller.record.enabled = record_enabled != 0;
        controller.cancel.enabled = cancel_enabled != 0;
        controller.item.button.toolTip = [@"Yap — " stringByAppendingString:controller.status.title];
        [controller.item.button setAccessibilityLabel:controller.item.button.toolTip];
        controller.item.button.image = [NSImage imageWithSystemSymbolName:recording ? @"record.circle.fill" : @"mic.fill" accessibilityDescription:@"Yap"];
        controller.item.button.image.template = YES;
    });
}

void yap_tray_close(void *item) {
    YapTrayController *controller = (__bridge_transfer YapTrayController *)item;
    onTrayMain(^{
        controller.callback = 0;
        if (controller.window.delegate == controller) { controller.window.delegate = controller.windowDelegate; }
        if (NSApp.delegate == controller) { NSApp.delegate = controller.appDelegate; }
        controller.item.menu = nil;
        [NSStatusBar.systemStatusBar removeStatusItem:controller.item];
    });
}
