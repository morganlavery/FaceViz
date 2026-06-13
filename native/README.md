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

## Native Targets

macOS Syphon sender:

- Input: compositor frame named `INFINIGHTCapture Output`
- Initial transport: frame snapshots from the renderer while the bridge is proven
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
