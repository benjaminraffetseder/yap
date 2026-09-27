//go:build darwin && cgo

#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#include <stdint.h>

extern void yapIndicatorAction(uintptr_t handle, int action);

static void onIndicatorMain(dispatch_block_t block) {
    if (NSThread.isMainThread) { block(); }
    else { dispatch_sync(dispatch_get_main_queue(), block); }
}

@interface YapStatusPanel : NSPanel
@property(nonatomic) BOOL positioned;
@end
@implementation YapStatusPanel
- (BOOL)canBecomeKeyWindow { return NO; }
- (BOOL)canBecomeMainWindow { return NO; }
@end

@interface YapStatusContent : NSView
@end
@implementation YapStatusContent
- (BOOL)acceptsFirstMouse:(NSEvent *)event { return YES; }
- (void)mouseDown:(NSEvent *)event {
    ((YapStatusPanel *)self.window).positioned = YES;
    [self.window performWindowDragWithEvent:event];
}
- (void)resetCursorRects {
    [self addCursorRect:NSMakeRect(0, 0, 216, NSHeight(self.bounds)) cursor:NSCursor.openHandCursor];
}
@end

// Noninteractive status views pass pointer events through to the drag surface.
// They remain in the accessibility tree; buttons keep their own mouse handling.
@interface YapStatusLabel : NSTextField
@end
@implementation YapStatusLabel
- (NSView *)hitTest:(NSPoint)point { return nil; }
@end

@interface YapStatusButton : NSButton
@end
@implementation YapStatusButton
- (BOOL)needsPanelToBecomeKey { return NO; }
- (BOOL)acceptsFirstResponder { return NO; }
- (BOOL)acceptsFirstMouse:(NSEvent *)event { return YES; }
@end

@interface YapStatusMeter : NSView
@property(nonatomic) double level;
@property(nonatomic) BOOL working;
@end
@implementation YapStatusMeter
- (NSView *)hitTest:(NSPoint)point { return nil; }
- (void)drawRect:(NSRect)dirty {
    [[NSColor colorWithCalibratedRed:0.36 green:0.77 blue:0.57 alpha:1] setFill];
    for (int i = 0; i < 4; i++) {
        double height = self.working ? 5 + ((NSInteger)(NSDate.date.timeIntervalSince1970 * 7) + i) % 4 * 3 : 4 + self.level * 12;
        NSRectFill(NSMakeRect(i * 4, (20-height)/2, 2, height));
    }
}
@end

@interface YapStatusController : NSObject
@property(nonatomic) uintptr_t callback;
@property(nonatomic, strong) YapStatusPanel *panel;
@property(nonatomic, strong) NSTextField *label;
@property(nonatomic, strong) YapStatusButton *stop;
@property(nonatomic, strong) YapStatusButton *cancel;
@property(nonatomic, strong) YapStatusMeter *meter;
@end

@implementation YapStatusController
- (void)action:(NSButton *)sender {
    if (self.callback) { yapIndicatorAction(self.callback, (int)sender.tag); }
}
- (YapStatusButton *)button:(NSString *)title x:(double)x tag:(NSInteger)tag {
    YapStatusButton *button = [[YapStatusButton alloc] initWithFrame:NSMakeRect(x, 16, 72, 32)];
    button.title = title;
    button.bezelStyle = NSBezelStyleRounded;
    button.font = [NSFont systemFontOfSize:13];
    button.tag = tag;
    button.target = self;
    button.action = @selector(action:);
    [self.panel.contentView addSubview:button];
    return button;
}
@end

void *yap_indicator_new(uintptr_t callback) {
    __block YapStatusController *controller = nil;
    onIndicatorMain(^{
        if (!NSApp) { return; }
        controller = [YapStatusController new];
        controller.callback = callback;
        controller.panel = [[YapStatusPanel alloc] initWithContentRect:NSMakeRect(0, 0, 376, 64)
            styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel
            backing:NSBackingStoreBuffered defer:NO];
        controller.panel.title = @"Yap — Dictation status";
        controller.panel.movable = YES;
        controller.panel.level = NSStatusWindowLevel;
        controller.panel.floatingPanel = YES;
        controller.panel.becomesKeyOnlyIfNeeded = YES;
        controller.panel.hidesOnDeactivate = NO;
        controller.panel.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorFullScreenAuxiliary;
        controller.panel.releasedWhenClosed = NO;
        controller.panel.opaque = NO;
        controller.panel.backgroundColor = NSColor.clearColor;
        controller.panel.hasShadow = YES;
        controller.panel.appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
        NSView *content = [[YapStatusContent alloc] initWithFrame:NSMakeRect(0, 0, 376, 64)];
        controller.panel.contentView = content;
        content.wantsLayer = YES;
        content.layer.backgroundColor = [NSColor colorWithCalibratedWhite:0.13 alpha:1].CGColor;
        content.layer.cornerRadius = 12;
        controller.label = [YapStatusLabel labelWithString:@""];
        controller.label.frame = NSMakeRect(40, 22, 168, 20);
        controller.label.font = [NSFont systemFontOfSize:14];
        controller.label.textColor = NSColor.whiteColor;
        [content addSubview:controller.label];
        controller.meter = [[YapStatusMeter alloc] initWithFrame:NSMakeRect(16, 22, 16, 20)];
        [content addSubview:controller.meter];
        controller.stop = [controller button:@"Stop" x:216 tag:1];
        controller.cancel = [controller button:@"Cancel" x:296 tag:2];
    });
    return (__bridge_retained void *)controller;
}

void yap_indicator_update(void *pointer, const char *label, const char *stop, const char *cancel, int visible, int move, int working, double level) {
    YapStatusController *controller = (__bridge YapStatusController *)pointer;
    onIndicatorMain(^{
        if (!visible) { [controller.panel orderOut:nil]; return; }
        controller.label.stringValue = [NSString stringWithUTF8String:label];
        controller.stop.hidden = stop[0] == '\0';
        controller.stop.title = [NSString stringWithUTF8String:stop];
        controller.cancel.title = [NSString stringWithUTF8String:cancel];
        controller.meter.level = level;
        controller.meter.working = working;
        controller.meter.needsDisplay = YES;
        if (!controller.panel.visible || (move && !controller.panel.positioned)) {
            NSScreen *screen = controller.panel.screen ?: NSScreen.mainScreen;
            if (!controller.panel.positioned) {
                NSPoint mouse = NSEvent.mouseLocation;
                for (NSScreen *candidate in NSScreen.screens) {
                    if (NSPointInRect(mouse, candidate.frame)) { screen = candidate; break; }
                }
            }
            NSRect area = screen.visibleFrame;
            NSPoint origin = NSMakePoint(NSMidX(area)-188, NSMinY(area)+24);
            if (controller.panel.positioned) {
                NSRect frame = controller.panel.frame;
                origin.x = MAX(NSMinX(area), MIN(NSMinX(frame), NSMaxX(area)-NSWidth(frame)));
                origin.y = MAX(NSMinY(area), MIN(NSMinY(frame), NSMaxY(area)-NSHeight(frame)));
            }
            [controller.panel setFrameOrigin:origin];
            [controller.panel orderFrontRegardless]; // Preserve the insertion target's focus.
        }
    });
}

void yap_indicator_close(void *pointer) {
    onIndicatorMain(^{
        // Transfer the final ownership on the main thread so AppKit views are
        // also deallocated there, after the Go renderer has stopped.
        YapStatusController *controller = (__bridge_transfer YapStatusController *)pointer;
        controller.callback = 0;
        controller.stop.target = nil;
        controller.cancel.target = nil;
        [controller.panel orderOut:nil];
        [controller.panel close];
        controller.panel = nil;
        controller.label = nil;
        controller.stop = nil;
        controller.cancel = nil;
        controller.meter = nil;
    });
}
