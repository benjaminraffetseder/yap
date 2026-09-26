//go:build darwin && cgo

#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>

// Read the actual application at insertion time; never activate a saved target.
int yap_frontmost_pid(void) {
    @autoreleasepool {
        return NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier;
    }
}

int yap_paste(int target) {
    @autoreleasepool {
        if (!AXIsProcessTrusted()) { return 2; }
        CGEventRef down = CGEventCreateKeyboardEvent(NULL, 9, true); // kVK_ANSI_V
        CGEventRef up = CGEventCreateKeyboardEvent(NULL, 9, false);
        if (!down || !up) {
            if (down) { CFRelease(down); }
            if (up) { CFRelease(up); }
            return 3;
        }
        CGEventSetFlags(down, kCGEventFlagMaskCommand);
        CGEventSetFlags(up, kCGEventFlagMaskCommand);
        if (yap_frontmost_pid() != target) {
            CFRelease(down); CFRelease(up);
            return 1;
        }
        CGEventPost(kCGHIDEventTap, down);
        CGEventPost(kCGHIDEventTap, up);
        CFRelease(down); CFRelease(up);
        return 0;
    }
}
