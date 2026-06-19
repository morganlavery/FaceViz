#import <Cocoa/Cocoa.h>
#import <ImageIO/ImageIO.h>
#import <OpenGL/gl.h>
#import "SyphonOpenGLServer.h"
#import "SyphonPrivate.h"

#define INFINIGHTCAPTURE_RAW_FRAME_MAGIC 0x46565A31U

static BOOL readFully(NSFileHandle *input, void *buffer, NSUInteger length) {
    uint8_t *cursor = buffer;
    NSUInteger remaining = length;
    while (remaining > 0) {
        @autoreleasepool {
            NSData *chunk = [input readDataOfLength:remaining];
            if (chunk.length == 0) {
                return NO;
            }
            memcpy(cursor, chunk.bytes, chunk.length);
            cursor += chunk.length;
            remaining -= chunk.length;
        }
    }
    return YES;
}

static BOOL decodeFrame(NSData *encoded, NSMutableData **rgbaOut, size_t *widthOut, size_t *heightOut) {
    CGImageSourceRef source = CGImageSourceCreateWithData((__bridge CFDataRef)encoded, NULL);
    if (!source) {
        return NO;
    }

    CGImageRef image = CGImageSourceCreateImageAtIndex(source, 0, NULL);
    CFRelease(source);
    if (!image) {
        return NO;
    }

    const size_t width = CGImageGetWidth(image);
    const size_t height = CGImageGetHeight(image);
    NSMutableData *rgba = [NSMutableData dataWithLength:width * height * 4];
    CGColorSpaceRef colorSpace = CGColorSpaceCreateDeviceRGB();
    CGContextRef context = CGBitmapContextCreate(
        rgba.mutableBytes,
        width,
        height,
        8,
        width * 4,
        colorSpace,
        kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big
    );
    CGColorSpaceRelease(colorSpace);

    if (!context) {
        CGImageRelease(image);
        return NO;
    }

    CGContextClearRect(context, CGRectMake(0, 0, width, height));
    CGContextDrawImage(context, CGRectMake(0, 0, width, height), image);
    CGContextRelease(context);
    CGImageRelease(image);

    *rgbaOut = rgba;
    *widthOut = width;
    *heightOut = height;
    return YES;
}

@interface INFINIGHTCaptureSyphonPublisher : NSObject
@property(nonatomic, strong) NSOpenGLContext *context;
@property(nonatomic, strong) SyphonOpenGLServer *server;
@property(nonatomic, strong) NSTimer *announceTimer;
@property(nonatomic) GLuint texture;
@property(nonatomic) size_t width;
@property(nonatomic) size_t height;
@property(nonatomic) BOOL lastReportedHasClients;
@property(nonatomic) NSUInteger publishedFrames;
@property(nonatomic) CFTimeInterval lastFpsReportTime;
- (BOOL)start;
- (void)announceServer;
- (void)reportClientStateIfChanged;
- (void)publishEncodedFrame:(NSData *)encodedFrame;
- (void)publishRawFrame:(const uint8_t *)pixels width:(size_t)nextWidth height:(size_t)nextHeight;
@end

@implementation INFINIGHTCaptureSyphonPublisher

- (BOOL)start {
    NSOpenGLPixelFormatAttribute attributes[] = {
        NSOpenGLPFAAccelerated,
        NSOpenGLPFADoubleBuffer,
        0
    };
    NSOpenGLPixelFormat *pixelFormat = [[NSOpenGLPixelFormat alloc] initWithAttributes:attributes];
    if (!pixelFormat) {
        fprintf(stderr, "INFINIGHTCapture Syphon: failed to create OpenGL pixel format\n");
        return NO;
    }

    self.context = [[NSOpenGLContext alloc] initWithFormat:pixelFormat shareContext:nil];
    if (!self.context) {
        fprintf(stderr, "INFINIGHTCapture Syphon: failed to create OpenGL context\n");
        return NO;
    }

    [self.context makeCurrentContext];
    glGenTextures(1, &_texture);
    glBindTexture(GL_TEXTURE_2D, self.texture);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);

    self.server = [[SyphonOpenGLServer alloc] initWithName:@"INFINIGHTCapture Output" context:[self.context CGLContextObj] options:nil];
    if (!self.server) {
        fprintf(stderr, "INFINIGHTCapture Syphon: failed to create Syphon server\n");
        return NO;
    }

    fprintf(stderr, "INFINIGHTCapture Syphon: publishing as \"INFINIGHTCapture Output\"\n");
    fprintf(stderr, "INFINIGHTCapture Syphon: clients=0\n");
    self.lastFpsReportTime = CFAbsoluteTimeGetCurrent();
    [self announceServer];
    self.announceTimer = [NSTimer scheduledTimerWithTimeInterval:2.0
                                                          target:self
                                                        selector:@selector(announceServer)
                                                        userInfo:nil
                                                         repeats:YES];
    return YES;
}

- (void)announceServer {
    [self reportClientStateIfChanged];
    NSDictionary *description = self.server.serverDescription;
    NSString *uuid = [description objectForKey:SyphonServerDescriptionUUIDKey];
    if (!uuid) {
        return;
    }

    [[NSDistributedNotificationCenter defaultCenter] postNotificationName:SyphonServerAnnounce
                                                                   object:uuid
                                                                 userInfo:description
                                                                       deliverImmediately:YES];
}

- (void)reportClientStateIfChanged {
    BOOL hasClients = self.server.hasClients;
    if (hasClients != self.lastReportedHasClients) {
        self.lastReportedHasClients = hasClients;
        fprintf(stderr, "INFINIGHTCapture Syphon: clients=%d\n", hasClients ? 1 : 0);
    }
}

- (void)publishEncodedFrame:(NSData *)encodedFrame {
    NSMutableData *rgba = nil;
    size_t nextWidth = 0;
    size_t nextHeight = 0;
    if (!decodeFrame(encodedFrame, &rgba, &nextWidth, &nextHeight)) {
        fprintf(stderr, "INFINIGHTCapture Syphon: failed to decode frame\n");
        return;
    }

    [self publishRawFrame:rgba.bytes width:nextWidth height:nextHeight];
}

- (void)publishRawFrame:(const uint8_t *)pixels width:(size_t)nextWidth height:(size_t)nextHeight {
    if (!pixels || nextWidth == 0 || nextHeight == 0) {
        return;
    }

    [self.context makeCurrentContext];
    glBindTexture(GL_TEXTURE_2D, self.texture);
    glPixelStorei(GL_UNPACK_ALIGNMENT, 1);

    if (nextWidth != self.width || nextHeight != self.height) {
        self.width = nextWidth;
        self.height = nextHeight;
        glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, (GLsizei)self.width, (GLsizei)self.height, 0, GL_RGBA, GL_UNSIGNED_BYTE, pixels);
    } else {
        glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, (GLsizei)self.width, (GLsizei)self.height, GL_RGBA, GL_UNSIGNED_BYTE, pixels);
    }

    glFlush();
    [self.server publishFrameTexture:self.texture
                       textureTarget:GL_TEXTURE_2D
                         imageRegion:NSMakeRect(0, 0, self.width, self.height)
                   textureDimensions:NSMakeSize(self.width, self.height)
                              flipped:YES];
    [self reportClientStateIfChanged];
    self.publishedFrames += 1;
    CFTimeInterval now = CFAbsoluteTimeGetCurrent();
    if (now - self.lastFpsReportTime >= 2.0) {
        double fps = self.publishedFrames / (now - self.lastFpsReportTime);
        fprintf(stderr, "INFINIGHTCapture Syphon: output-fps=%.1f size=%zux%zu\n", fps, self.width, self.height);
        self.publishedFrames = 0;
        self.lastFpsReportTime = now;
    }
}

- (void)dealloc {
    [_announceTimer invalidate];
    if (_texture != 0) {
        glDeleteTextures(1, &_texture);
    }
    [_server stop];
}

@end

int main(int argc, const char * argv[]) {
    @autoreleasepool {
        [NSApplication sharedApplication];
        [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];

        INFINIGHTCaptureSyphonPublisher *publisher = [INFINIGHTCaptureSyphonPublisher new];
        if (![publisher start]) {
            return 1;
        }

        dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INTERACTIVE, 0), ^{
            NSFileHandle *input = [NSFileHandle fileHandleWithStandardInput];
            while (true) {
                @autoreleasepool {
                    uint8_t lengthBytes[4] = {0, 0, 0, 0};
                    if (!readFully(input, lengthBytes, sizeof(lengthBytes))) {
                        break;
                    }

                    uint32_t length =
                        ((uint32_t)lengthBytes[0] << 24) |
                        ((uint32_t)lengthBytes[1] << 16) |
                        ((uint32_t)lengthBytes[2] << 8) |
                        ((uint32_t)lengthBytes[3]);

                    if (length == 0 || length > 25 * 1024 * 1024) {
                        fprintf(stderr, "INFINIGHTCapture Syphon: invalid frame length %u\n", length);
                        break;
                    }

                    NSMutableData *frame = [NSMutableData dataWithLength:length];
                    if (!readFully(input, frame.mutableBytes, length)) {
                        break;
                    }

                    dispatch_sync(dispatch_get_main_queue(), ^{
                        if (frame.length >= 16) {
                            const uint8_t *bytes = frame.bytes;
                            uint32_t magic =
                                ((uint32_t)bytes[0] << 24) |
                                ((uint32_t)bytes[1] << 16) |
                                ((uint32_t)bytes[2] << 8) |
                                ((uint32_t)bytes[3]);
                            if (magic == INFINIGHTCAPTURE_RAW_FRAME_MAGIC) {
                                uint32_t width =
                                    ((uint32_t)bytes[4] << 24) |
                                    ((uint32_t)bytes[5] << 16) |
                                    ((uint32_t)bytes[6] << 8) |
                                    ((uint32_t)bytes[7]);
                                uint32_t height =
                                    ((uint32_t)bytes[8] << 24) |
                                    ((uint32_t)bytes[9] << 16) |
                                    ((uint32_t)bytes[10] << 8) |
                                    ((uint32_t)bytes[11]);
                                uint32_t pixelLength =
                                    ((uint32_t)bytes[12] << 24) |
                                    ((uint32_t)bytes[13] << 16) |
                                    ((uint32_t)bytes[14] << 8) |
                                    ((uint32_t)bytes[15]);
                                NSUInteger expectedLength = 16U + (NSUInteger)pixelLength;
                                NSUInteger expectedPixels = (NSUInteger)width * (NSUInteger)height * 4U;
                                if (expectedLength == frame.length && expectedPixels == pixelLength) {
                                    [publisher publishRawFrame:bytes + 16 width:width height:height];
                                } else {
                                    fprintf(stderr, "INFINIGHTCapture Syphon: invalid raw frame %ux%u bytes=%u packet=%lu\n", width, height, pixelLength, (unsigned long)frame.length);
                                }
                            } else {
                                [publisher publishEncodedFrame:frame];
                            }
                        } else {
                            [publisher publishEncodedFrame:frame];
                        }
                    });
                }
            }

            fprintf(stderr, "INFINIGHTCapture Syphon: input closed\n");
            dispatch_async(dispatch_get_main_queue(), ^{
                [NSApp terminate:nil];
            });
        });

        [NSApp run];
    }
    return 0;
}
