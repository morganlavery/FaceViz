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

## First Native Target

macOS Syphon sender:

- Input: compositor frame named `INFINIGHTCapture Output`
- Initial transport: frame snapshots from the renderer while the bridge is proven
- Final transport: shared GPU texture from the compositor
- Public controls: start, stop, status, output name

## Windows Target

Windows Spout sender should implement the same bridge contract after the Syphon sender is working.
