// Copyright 2021 The golang.design Initiative Authors.
// All rights reserved. Use of this source code is governed
// by a MIT license that can be found in the LICENSE file.
//
// Written by Changkun Ou <changkun.de>

//go:build darwin

#include <stdint.h>
#import <ApplicationServices/ApplicationServices.h>
#import <Cocoa/Cocoa.h>
#import <Carbon/Carbon.h>

extern void keydownCallback(uintptr_t handle);
extern void keyupCallback(uintptr_t handle);

// isAXTrusted reports whether the process is trusted for Accessibility
// (Input Monitoring), which a keyboard event tap requires.
int isAXTrusted() { return AXIsProcessTrusted() ? 1 : 0; }

// onMain runs block on the main thread and waits for it. On the main thread
// it runs block at once: a dispatch_sync onto the queue one is already on
// never returns, and libdispatch traps it, which crashed a Register or
// Unregister called from the main thread, as within a GUI toolkit's event
// loop or through mainthread.Call.
static void onMain(dispatch_block_t block) {
	if ([NSThread isMainThread]) {
		block();
		return;
	}
	dispatch_sync(dispatch_get_main_queue(), block);
}

// onMainProbe runs a block through onMain and reports that it ran, for the
// tests.
int onMainProbe() {
	__block int ran = 0;
	onMain(^{
		ran = 1;
	});
	return ran;
}

// All hotkeys (regular and media) are delivered through a CGEventTap rather
// than Carbon RegisterEventHotKey, so a single mechanism handles both and the
// tap can consume the event. This requires Accessibility (Input Monitoring)
// permission; see registerTap.

#define NX_SYSDEFINED 14

// The modifier bits we match on (ignoring CapsLock, Fn, numeric pad, etc.).
#define HOTKEY_MOD_MASK                                                        \
	(kCGEventFlagMaskShift | kCGEventFlagMaskControl |                     \
	 kCGEventFlagMaskAlternate | kCGEventFlagMaskCommand)

typedef struct {
	uintptr_t handle;
	int isMedia;       // 1: NSSystemDefined media key; 0: regular key
	int code;          // NX_KEYTYPE code (media) or CG keycode (regular)
	int logicalLetter; // ASCII A-Z, translated through the active layout
	int heldCode;      // preserve physical release across an input-source change
	uint64_t flags;    // required modifier mask (regular keys only)
	int down;          // a keydown was delivered and not yet matched by keyup
	CFMachPortRef tap;
	CFRunLoopSourceRef source;
} eventTap;

static int resolveLogicalLetter(int letter) {
	TISInputSourceRef source = TISCopyCurrentKeyboardLayoutInputSource();
	if (!source) { return -1; }
	CFDataRef data = TISGetInputSourceProperty(source, kTISPropertyUnicodeKeyLayoutData);
	int found = -1;
	if (data) {
		const UCKeyboardLayout *layout = (const UCKeyboardLayout *)CFDataGetBytePtr(data);
		for (UInt16 code = 0; code < 128; code++) {
			UInt32 dead = 0;
			UniChar chars[4];
			UniCharCount count = 0;
			OSStatus result = UCKeyTranslate(layout, code, kUCKeyActionDown, 0, LMGetKbdType(), kUCKeyTranslateNoDeadKeysMask, &dead, 4, &count, chars);
			if (result == noErr && count == 1 && (chars[0] == letter || chars[0] == letter + ('a' - 'A'))) { found = code; break; }
		}
	}
	CFRelease(source);
	return found;
}

static void layoutChanged(CFNotificationCenterRef center, void *observer, CFStringRef name, const void *object, CFDictionaryRef info) {
	eventTap *t = (eventTap *)observer;
	t->code = resolveLogicalLetter(t->logicalLetter);
}

static CGEventRef tapCallback(CGEventTapProxy proxy, CGEventType type,
                              CGEventRef event, void *userInfo) {
	eventTap *t = (eventTap *)userInfo;

	// The system disables a tap that is too slow or interrupted; re-enable it.
	if (type == kCGEventTapDisabledByTimeout ||
	    type == kCGEventTapDisabledByUserInput) {
		if (t->tap != NULL) {
			CGEventTapEnable(t->tap, true);
		}
		return event;
	}

	if (t->isMedia) {
		NSEvent *e = [NSEvent eventWithCGEvent:event];
		if (e == nil || [e type] != NSEventTypeSystemDefined ||
		    [e subtype] != 8) {
			return event;
		}
		int data1 = (int)[e data1];
		int keyCode = (data1 & 0xffff0000) >> 16;
		if (keyCode != t->code) {
			return event; // not the key this hotkey wants
		}
		int keyState = (data1 & 0x0000ff00) >> 8; // 0xA: down, 0xB: up
		if (keyState == 0x0a) {
			keydownCallback(t->handle);
		} else if (keyState == 0x0b) {
			keyupCallback(t->handle);
		}
		return NULL; // consume
	}

	// Regular key.
	if (type != kCGEventKeyDown && type != kCGEventKeyUp) {
		return event;
	}
	int keycode =
		(int)CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode);
	if (type == kCGEventKeyUp && t->down && keycode == t->heldCode) {
		t->down = 0;
		keyupCallback(t->handle);
		return NULL;
	}
	if (keycode != t->code) {
		return event;
	}
	if (type == kCGEventKeyDown) {
		uint64_t flags = CGEventGetFlags(event) & HOTKEY_MOD_MASK;
		if (flags != t->flags) {
			return event; // modifiers do not match this hotkey
		}
		// The tap repeats keyDown while the key is held; fire once.
		if (!t->down) {
			t->down = 1;
			t->heldCode = keycode;
			keydownCallback(t->handle);
		}
		return NULL; // consume
	}
	// keyUp: fire only if we delivered the matching keydown.
	if (t->down) {
		t->down = 0;
		keyupCallback(t->handle);
		return NULL;
	}
	return event;
}

// registerTap installs a CGEventTap. isMedia 1 selects NSSystemDefined;
// -1 resolves an ASCII letter through the active layout; 0 uses a physical
// CG keycode. Regular keys match the required modifier mask.
// Returns NULL if the process is not trusted for Accessibility (Input
// Monitoring) or the tap cannot be created.
void* registerTap(uintptr_t handle, int isMedia, int code, uint64_t flags) {
	// A keyboard event tap requires Accessibility trust. Check explicitly:
	// CGEventTapCreate can otherwise return a non-NULL but inert tap when
	// untrusted, which would look like success but never fire.
	if (!AXIsProcessTrusted()) {
		return NULL;
	}

	eventTap *t = malloc(sizeof(eventTap));
	t->handle = handle;
	t->isMedia = isMedia == 1;
	t->logicalLetter = isMedia == -1 ? code : 0;
	t->heldCode = -1;
	t->code = code;
	t->flags = flags;
	t->down = 0;
	t->tap = NULL;
	t->source = NULL;
	onMain(^{
		if (t->logicalLetter) {
			t->code = resolveLogicalLetter(t->logicalLetter);
			if (t->code < 0) { return; }
		}
		CGEventMask mask =
			t->isMedia ? CGEventMaskBit(NX_SYSDEFINED)
			        : (CGEventMaskBit(kCGEventKeyDown) |
			           CGEventMaskBit(kCGEventKeyUp));
		CFMachPortRef tap = CGEventTapCreate(
			kCGSessionEventTap, kCGHeadInsertEventTap,
			kCGEventTapOptionDefault, mask, tapCallback, t);
		if (tap == NULL) {
			return;
		}
		t->tap = tap;
		t->source =
			CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0);
		CFRunLoopAddSource(CFRunLoopGetMain(), t->source,
		                   kCFRunLoopCommonModes);
		CGEventTapEnable(tap, true);
		if (t->logicalLetter) {
			CFNotificationCenterAddObserver(CFNotificationCenterGetDistributedCenter(), t, layoutChanged, kTISNotifySelectedKeyboardInputSourceChanged, NULL, CFNotificationSuspensionBehaviorDeliverImmediately);
		}
	});
	if (t->tap == NULL) {
		free(t);
		return NULL;
	}
	return t;
}

void unregisterTap(void* p) {
	if (p == NULL) {
		return;
	}
	eventTap *t = (eventTap *)p;
	onMain(^{
		if (t->logicalLetter) { CFNotificationCenterRemoveEveryObserver(CFNotificationCenterGetDistributedCenter(), t); }
		if (t->tap != NULL) {
			CGEventTapEnable(t->tap, false);
		}
		if (t->source != NULL) {
			CFRunLoopRemoveSource(CFRunLoopGetMain(), t->source,
			                      kCFRunLoopCommonModes);
			CFRelease(t->source);
		}
		if (t->tap != NULL) {
			CFRelease(t->tap);
		}
	});
	free(t);
}
