//go:build darwin && cgo

#import <AppKit/AppKit.h>
#include <string.h>

char* yap_profile_active_application(void) {
    @autoreleasepool {
        NSRunningApplication* app = NSWorkspace.sharedWorkspace.frontmostApplication;
        if (!app || app.processIdentifier == NSProcessInfo.processInfo.processIdentifier || !app.bundleIdentifier) return strdup("");
        return strdup([[@"darwin:" stringByAppendingString:app.bundleIdentifier] UTF8String]);
    }
}

char* yap_profile_applications(void) {
    @autoreleasepool {
        NSMutableArray* apps = [NSMutableArray array];
        for (NSRunningApplication* app in NSWorkspace.sharedWorkspace.runningApplications) {
            if (app.activationPolicy != NSApplicationActivationPolicyRegular || !app.bundleIdentifier || app.processIdentifier == NSProcessInfo.processInfo.processIdentifier) continue;
            [apps addObject:@{@"id": [@"darwin:" stringByAppendingString:app.bundleIdentifier], @"name": app.localizedName ?: app.bundleIdentifier}];
        }
        NSData* json = [NSJSONSerialization dataWithJSONObject:apps options:0 error:nil];
        return strdup(json ? [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding].UTF8String : "[]");
    }
}
