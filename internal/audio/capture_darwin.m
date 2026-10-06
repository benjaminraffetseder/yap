//go:build darwin && cgo

#import <AVFoundation/AVFoundation.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>

@interface YapAudioCapture : NSObject <AVCaptureFileOutputRecordingDelegate>
@property(nonatomic, strong) AVCaptureSession *session;
@property(nonatomic, strong) AVCaptureAudioFileOutput *output;
@property(nonatomic, strong) NSError *failure;
@property(nonatomic, strong) dispatch_semaphore_t started;
@property(nonatomic, strong) dispatch_semaphore_t finished;
@property(nonatomic) double duration;
@end

@implementation YapAudioCapture
- (void)captureOutput:(AVCaptureFileOutput *)output didStartRecordingToOutputFileAtURL:(NSURL *)url fromConnections:(NSArray<AVCaptureConnection *> *)connections {
    dispatch_semaphore_signal(self.started);
}
- (void)captureOutput:(AVCaptureFileOutput *)output didFinishRecordingToOutputFileAtURL:(NSURL *)url fromConnections:(NSArray<AVCaptureConnection *> *)connections error:(NSError *)error {
    @synchronized(self) {
        self.failure = error;
        double duration = CMTimeGetSeconds(output.recordedDuration);
        self.duration = isfinite(duration) ? duration : 0;
    }
    // Wake Start even if a device fails before producing its first sample.
    dispatch_semaphore_signal(self.started);
    dispatch_semaphore_signal(self.finished);
}
@end

static void captureError(char **output, NSString *message) {
    *output = strdup(message.UTF8String);
}

char *yap_capture_devices(char **error) {
    @autoreleasepool {
        NSMutableArray *devices = [NSMutableArray new];
        for (AVCaptureDevice *device in [AVCaptureDevice devicesWithMediaType:AVMediaTypeAudio]) {
            if (device.connected) {
                [devices addObject:@{@"id": device.uniqueID, @"name": device.localizedName}];
            }
        }
        NSError *failure = nil;
        NSData *json = [NSJSONSerialization dataWithJSONObject:devices options:0 error:&failure];
        if (!json) {
            captureError(error, failure.localizedDescription ?: @"Microphones could not be listed.");
            return NULL;
        }
        return strdup([[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding].UTF8String);
    }
}

void *yap_capture_start(const char *path, const char *deviceID, char **error) {
    @autoreleasepool {
        AVAuthorizationStatus status = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio];
        if (status == AVAuthorizationStatusNotDetermined) {
            // Never wait for a person while Go owns the app lock. Completing
            // this prompt changes permission only; it cannot start late capture.
            static BOOL permissionRequested = NO;
            @synchronized([YapAudioCapture class]) {
                if (!permissionRequested) {
                    permissionRequested = YES;
                    [AVCaptureDevice requestAccessForMediaType:AVMediaTypeAudio completionHandler:^(BOOL granted) {
                        @synchronized([YapAudioCapture class]) { permissionRequested = NO; }
                    }];
                }
            }
            captureError(error, @"Complete the macOS microphone permission prompt, then try recording or testing again.");
            return NULL;
        }
        if (status != AVAuthorizationStatusAuthorized) {
            captureError(error, @"Allow Yap in System Settings → Privacy & Security → Microphone, then try again.");
            return NULL;
        }
        YapAudioCapture *capture = [YapAudioCapture new];
        @try {
            NSString *identifier = [NSString stringWithUTF8String:deviceID];
            AVCaptureDevice *device = identifier.length ? [AVCaptureDevice deviceWithUniqueID:identifier] : [AVCaptureDevice defaultDeviceWithMediaType:AVMediaTypeAudio];
            if (!device || !device.connected || ![device hasMediaType:AVMediaTypeAudio]) {
                captureError(error, @"Microphone unavailable; choose a connected microphone in Settings.");
                return NULL;
            }
            NSError *failure = nil;
            AVCaptureDeviceInput *input = [AVCaptureDeviceInput deviceInputWithDevice:device error:&failure];
            if (!input) {
                captureError(error, failure.localizedDescription ?: @"Microphone capture could not start.");
                return NULL;
            }
            capture.session = [AVCaptureSession new];
            capture.output = [AVCaptureAudioFileOutput new];
            capture.started = dispatch_semaphore_create(0);
            capture.finished = dispatch_semaphore_create(0);
            if (![capture.session canAddInput:input]) {
                captureError(error, @"Microphone input is unavailable.");
                return NULL;
            }
            [capture.session addInput:input];
            if (![capture.session canAddOutput:capture.output] || ![[AVCaptureAudioFileOutput availableOutputFileTypes] containsObject:AVFileTypeWAVE]) {
                captureError(error, @"Microphone cannot record a WAV file.");
                return NULL;
            }
            [capture.session addOutput:capture.output];
            capture.output.audioSettings = @{
                AVFormatIDKey: @(kAudioFormatLinearPCM),
                AVSampleRateKey: @16000,
                AVNumberOfChannelsKey: @1,
                AVLinearPCMBitDepthKey: @16,
                AVLinearPCMIsFloatKey: @NO,
                AVLinearPCMIsBigEndianKey: @NO,
                AVLinearPCMIsNonInterleaved: @NO
            };
            [capture.session startRunning];
            NSURL *url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:path]];
            [capture.output startRecordingToOutputFileURL:url outputFileType:AVFileTypeWAVE recordingDelegate:capture];
            if (dispatch_semaphore_wait(capture.started, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC)) != 0 || !capture.output.recording) {
                [capture.output stopRecording];
                [capture.session stopRunning];
                @synchronized(capture) {
                    captureError(error, capture.failure.localizedDescription ?: @"Microphone did not start recording; check the selected input device.");
                }
                return NULL;
            }
            return (__bridge_retained void *)capture;
        } @catch (NSException *exception) {
            [capture.output stopRecording];
            [capture.session stopRunning];
            captureError(error, exception.reason ?: @"Microphone capture could not start.");
            return NULL;
        }
    }
}

double yap_capture_level(void *pointer) {
    @autoreleasepool {
        YapAudioCapture *capture = (__bridge YapAudioCapture *)pointer;
        double level = 0;
        for (AVCaptureConnection *connection in capture.output.connections) {
            for (AVCaptureAudioChannel *channel in connection.audioChannels) {
                level = fmax(level, pow(10, channel.averagePowerLevel / 20.0) * 5);
            }
        }
        return fmin(1, level);
    }
}

double yap_capture_stop(void *pointer, char **error) {
    @autoreleasepool {
        YapAudioCapture *capture = (__bridge_transfer YapAudioCapture *)pointer;
        [capture.output stopRecording];
        // Wait for WAV finalization before Whisper reads the file or Go deletes it.
        long timeout = dispatch_semaphore_wait(capture.finished, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC));
        [capture.session stopRunning];
        if (timeout) {
            captureError(error, @"Microphone did not finish recording.");
            return 0;
        }
        @synchronized(capture) {
            if (capture.failure) { captureError(error, capture.failure.localizedDescription); }
            return capture.duration;
        }
    }
}
