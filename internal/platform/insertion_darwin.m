//go:build darwin && cgo

#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#include <pthread.h>
#include <stdint.h>

// Read the actual application at insertion time; never activate a saved target.
static int frontmostPID(void) {
    @autoreleasepool {
        return NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier;
    }
}

static pthread_mutex_t targetLock = PTHREAD_MUTEX_INITIALIZER;
static uint64_t targetSerial = 0;
static int targetPID = 0;
static AXUIElementRef targetWindow = NULL;

static AXUIElementRef focusedWindow(int pid) {
    if (pid <= 0 || !AXIsProcessTrusted()) { return NULL; }
    AXUIElementRef application = AXUIElementCreateApplication(pid);
    AXUIElementSetMessagingTimeout(application, 0.5);
    CFTypeRef window = NULL;
    AXError result = AXUIElementCopyAttributeValue(application, kAXFocusedWindowAttribute, &window);
    CFRelease(application);
    if (result != kAXErrorSuccess || !window || CFGetTypeID(window) != AXUIElementGetTypeID()) {
        if (window) { CFRelease(window); }
        return NULL;
    }
    return (AXUIElementRef)window; // owned Copy reference
}

uint64_t yap_paste_target(void) {
    @autoreleasepool {
        pthread_mutex_lock(&targetLock);
        if (targetWindow) { CFRelease(targetWindow); }
        targetPID = frontmostPID();
        targetWindow = focusedWindow(targetPID);
        targetSerial++;
        if (targetSerial == 0) { targetSerial++; }
        uint64_t serial = targetPID > 0 ? targetSerial : 0;
        pthread_mutex_unlock(&targetLock);
        return serial;
    }
}

static int pasteToWindow(int pid, AXUIElementRef expected) {
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
        AXUIElementRef actual = focusedWindow(frontmostPID());
        BOOL matches = expected && actual && frontmostPID() == pid && CFEqual(expected, actual);
        if (actual) { CFRelease(actual); }
        if (!matches) {
            CFRelease(down); CFRelease(up);
            return 1;
        }
        CGEventPost(kCGHIDEventTap, down);
        CGEventPost(kCGHIDEventTap, up);
        CFRelease(down); CFRelease(up);
        return 0;
    }
}

int yap_paste(uint64_t serial) {
    pthread_mutex_lock(&targetLock);
    if (serial == 0 || serial != targetSerial) {
        pthread_mutex_unlock(&targetLock);
        return 1;
    }
    int pid = targetPID;
    AXUIElementRef expected = targetWindow;
    targetWindow = NULL;
    targetPID = 0;
    pthread_mutex_unlock(&targetLock);
    int result = pasteToWindow(pid, expected);
    if (expected) { CFRelease(expected); }
    return result;
}
