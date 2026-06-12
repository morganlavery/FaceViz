#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NATIVE_DIR="$ROOT_DIR/native"
SYPHON_DIR="$NATIVE_DIR/vendor/Syphon-Framework"
BUILD_DIR="$NATIVE_DIR/build"
INCLUDE_DIR="$BUILD_DIR/include"

mkdir -p "$BUILD_DIR" "$INCLUDE_DIR"
rm -rf "$INCLUDE_DIR/Syphon"
mkdir -p "$INCLUDE_DIR/Syphon"

find "$SYPHON_DIR" -maxdepth 1 -name '*.h' -exec cp {} "$INCLUDE_DIR/Syphon/" \;
cat > "$BUILD_DIR/SyphonPrefix.h" <<EOF
#import "$SYPHON_DIR/Syphon_Prefix.pch"
#import <CoreVideo/CoreVideo.h>
#import <Foundation/Foundation.h>
#import "$SYPHON_DIR/SyphonPrivate.h"
#import <libkern/OSAtomic.h>
EOF

OBJC_SOURCES=(
  "$NATIVE_DIR/SyphonFramePublisher.m"
  "$SYPHON_DIR/SyphonCFMessageReceiver.m"
  "$SYPHON_DIR/SyphonCFMessageSender.m"
  "$SYPHON_DIR/SyphonClientBase.m"
  "$SYPHON_DIR/SyphonClientConnectionManager.m"
  "$SYPHON_DIR/SyphonGLShader.m"
  "$SYPHON_DIR/SyphonGLVertices.m"
  "$SYPHON_DIR/SyphonIOSurfaceImageCore.m"
  "$SYPHON_DIR/SyphonIOSurfaceImageLegacy.m"
  "$SYPHON_DIR/SyphonImageBase.m"
  "$SYPHON_DIR/SyphonMessageQueue.m"
  "$SYPHON_DIR/SyphonMessageReceiver.m"
  "$SYPHON_DIR/SyphonMessageSender.m"
  "$SYPHON_DIR/SyphonMessaging.m"
  "$SYPHON_DIR/SyphonOpenGLImage.m"
  "$SYPHON_DIR/SyphonOpenGLServer.m"
  "$SYPHON_DIR/SyphonPrivate.m"
  "$SYPHON_DIR/SyphonServerBase.m"
  "$SYPHON_DIR/SyphonServerConnectionManager.m"
  "$SYPHON_DIR/SyphonServerDirectory.m"
  "$SYPHON_DIR/SyphonServerGLShader.m"
  "$SYPHON_DIR/SyphonServerGLVertices.m"
  "$SYPHON_DIR/SyphonServerRendererCoreGL.m"
  "$SYPHON_DIR/SyphonServerRendererGL.m"
  "$SYPHON_DIR/SyphonServerRendererLegacyGL.m"
)

C_SOURCES=(
  "$SYPHON_DIR/SyphonCGL.c"
  "$SYPHON_DIR/SyphonDispatch.c"
  "$SYPHON_DIR/SyphonOpenGLFunctions.c"
)

COMMON_FLAGS=(
  -fblocks \
  -mmacosx-version-min=11.0 \
  -DGL_SILENCE_DEPRECATION=1 \
  -DSYPHON_CORE_RESTORE=1 \
  -include "$BUILD_DIR/SyphonPrefix.h" \
  -I"$SYPHON_DIR" \
  -I"$INCLUDE_DIR"
)

OBJECTS=()
rm -f "$BUILD_DIR"/*.o

for source in "${OBJC_SOURCES[@]}"; do
  object="$BUILD_DIR/$(basename "${source%.*}").o"
  clang -x objective-c -fobjc-arc "${COMMON_FLAGS[@]}" -c "$source" -o "$object"
  OBJECTS+=("$object")
done

for source in "${C_SOURCES[@]}"; do
  object="$BUILD_DIR/$(basename "${source%.*}").o"
  clang -x objective-c "${COMMON_FLAGS[@]}" -c "$source" -o "$object"
  OBJECTS+=("$object")
done

clang \
  "${OBJECTS[@]}" \
  -framework Cocoa \
  -framework Foundation \
  -framework AppKit \
  -framework OpenGL \
  -framework IOSurface \
  -framework CoreVideo \
  -framework CoreGraphics \
  -framework ImageIO \
  -o "$BUILD_DIR/SyphonFramePublisher"

echo "Built $BUILD_DIR/SyphonFramePublisher"
