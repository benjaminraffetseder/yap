//go:build darwin && cgo

#import <AVFoundation/AVFoundation.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>

@interface YapAudioCapture : NSObject <AVAudioRecorderDelegate>
@property(nonatomic, strong) AVAudioRecorder *recorder;
@property(nonatomic, strong) NSError *failure;
@end

@implementation YapAudioCapture
- (void)audioRecorderEncodeErrorDidOccur:(AVAudioRecorder *)recorder error:(NSError *)error {
    @synchronized(self) { self.failure = error; }
}
@end

static void captureError(char **output, NSString *message) {
    *output = strdup(message.UTF8String);
}

void *yap_capture_start(const char *path, char **error) {
    @autoreleasepool {
        AVAuthorizationStatus status = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio];
        if (status == AVAuthorizationStatusNotDetermined) {
            dispatch_semaphore_t answer = dispatch_semaphore_create(0);
            [AVCaptureDevice requestAccessForMediaType:AVMediaTypeAudio completionHandler:^(BOOL granted) {
                dispatch_semaphore_signal(answer);
            }];
            dispatch_semaphore_wait(answer, DISPATCH_TIME_FOREVER);
            status = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio];
        }
        if (status != AVAuthorizationStatusAuthorized) {
            captureError(error, @"Allow Yap in System Settings → Privacy & Security → Microphone, then try again.");
            return NULL;
        }
        @try {
            YapAudioCapture *capture = [YapAudioCapture new];
            NSDictionary *settings = @{
                AVFormatIDKey: @(kAudioFormatLinearPCM),
                AVSampleRateKey: @16000,
                AVNumberOfChannelsKey: @1,
                AVLinearPCMBitDepthKey: @16,
                AVLinearPCMIsFloatKey: @NO,
                AVLinearPCMIsBigEndianKey: @NO,
                AVLinearPCMIsNonInterleaved: @NO
            };
            NSError *failure = nil;
            NSURL *url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:path]];
            capture.recorder = [[AVAudioRecorder alloc] initWithURL:url settings:settings error:&failure];
            capture.recorder.delegate = capture;
            capture.recorder.meteringEnabled = YES;
            if (!capture.recorder || ![capture.recorder prepareToRecord] || ![capture.recorder record]) {
                captureError(error, failure.localizedDescription ?: @"Microphone unavailable; check the default input device in System Settings → Sound.");
                return NULL;
            }
            return (__bridge_retained void *)capture;
        } @catch (NSException *exception) {
            captureError(error, exception.reason ?: @"Microphone capture could not start.");
            return NULL;
        }
    }
}

double yap_capture_level(void *pointer) {
    @autoreleasepool {
        YapAudioCapture *capture = (__bridge YapAudioCapture *)pointer;
        [capture.recorder updateMeters];
        return fmin(1, pow(10, [capture.recorder averagePowerForChannel:0] / 20.0) * 5);
    }
}

double yap_capture_stop(void *pointer, char **error) {
    @autoreleasepool {
        YapAudioCapture *capture = (__bridge_transfer YapAudioCapture *)pointer;
        double duration = capture.recorder.currentTime;
        [capture.recorder stop];
        capture.recorder.delegate = nil;
        @synchronized(capture) {
            if (capture.failure) { captureError(error, capture.failure.localizedDescription); }
        }
        return duration;
    }
}
