# INFINIGHTCapture Native Core

This folder is reserved for the platform-specific frame publisher.

The Electron app now has a stable system bridge:

```text
renderer
  -> window.infinightCaptureSystem
  -> electron/preload.cjs
  -> electron/systemBridge.cjs
  -> native publisher
```

## Native Output Bridge Contract

Syphon, Spout, and NDI must expose the same app-facing contract. The renderer never sends target-specific payloads:

- Protocol: `infinightcapture.raw-rgba.v1`
- Packet: `uint32be length`, then a 16-byte frame header, then RGBA pixels
- Header: `FVZ1` magic, `uint32be width`, `uint32be height`, `uint32be pixelLength`
- Pixels: `rgba8`, 4 bytes per pixel, top-left origin from the renderer canvas
- Output name: `INFINIGHTCapture Output`
- Public controls: start, stop, status, publish frame
- Status states: available, built, running, blocked, missing, unsupported, shell-required

Native helpers can use different platform APIs internally, but the Electron bridge and renderer status UI must treat Syphon, Spout, and NDI identically through this contract.

## Native Targets

macOS Syphon sender:

- Input: compositor frame named `INFINIGHTCapture Output`
- Transport: length-prefixed RGBA snapshots from the renderer
- Final transport: shared GPU texture from the compositor
- Public controls: start, stop, status, output name

Windows Spout sender:

- Input: compositor frame named `INFINIGHTCapture Output`
- Transport: length-prefixed RGBA snapshots from the renderer
- Runtime: `SpoutFramePublisher.exe` loads `SpoutLibrary.dll` from the Spout2 SDK
- Public controls: start, stop, status, output name

Build the Windows helper from a Visual Studio Developer PowerShell:

```powershell
npm run native:build:win
```

Set `SPOUT_LIBRARY_DLL` to the full path of `SpoutLibrary.dll`, or copy it to `native/vendor/Spout2/SpoutLibrary.dll`, before building or packaging the Windows app.

Cross-platform NDI sender:

- Input: compositor frame named `INFINIGHTCapture Output`
- Transport: length-prefixed RGBA snapshots from the renderer
- Runtime: official NDI SDK/runtime library discovered beside `NDIFramePublisher`, in system library paths, or via `NDI_RUNTIME_DIR`
- Public controls: start, stop, status, output name

Build the optional NDI helper after installing the NDI SDK:

```bash
NDI_SDK_DIR="/path/to/NDI SDK" npm run native:build:ndi
```

For custom SDK layouts, set `NDI_INCLUDE_DIR`, `NDI_LIBRARY_PATH`, and `NDI_RUNTIME_LIBRARY`.
