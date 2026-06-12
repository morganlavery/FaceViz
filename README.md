# FaceViz

Gesture-reactive webcam mocap compositor for VJ workflows.

FaceViz is being built as a standalone app that tracks upper-body pose, hands, and fingers from a webcam, turns those landmarks into gesture signals, drives real-time visual effects, and prepares a GPU output path for Syphon on macOS and Spout on Windows.

## Current MVP

- Webcam capture surface
- MediaPipe hand and pose tracking
- Upper-body tracking overlay
- Gesture analysis for face cover, hands up, pinch, open palm, and fast motion
- Canvas compositor with fire, melt, warp, and bloom effects
- Syphon/Spout output target UI scaffold
- Electron shell for standalone desktop packaging
- Electron preload/main-process system bridge
- Runtime status panel for browser preview vs desktop shell
- macOS camera permission bridge for the desktop shell

## Run

```bash
git submodule update --init --recursive
npm install
npm run dev
```

Open `http://127.0.0.1:5173/`.

For the desktop shell:

```bash
npm run electron:dev
```

## Build

```bash
npm run build
```

## Architecture

```text
webcam
  -> MediaPipe hand + pose tracking
  -> gesture engine
  -> canvas shader/effect compositor
  -> FaceViz system bridge
      browser preview: UI and tracking only
      Electron shell: native permissions and output control
      native core: Syphon/Spout frame publisher
```

The system boundary is intentionally thin:

- `src/system` defines the renderer-side bridge contract.
- `electron/preload.cjs` safely exposes the bridge to the UI.
- `electron/systemBridge.cjs` owns OS-level status, permissions, and native output commands.
- `native` is reserved for the Syphon/Spout frame publisher implementation.

## Next Milestones

1. Add a real macOS Syphon sender behind `electron/systemBridge.cjs`.
2. Add a Windows Spout sender behind the same output interface.
3. Replace the canvas effects with a WebGL shader graph so landmarks become shader uniforms.
4. Add a gesture-to-parameter modulation matrix.
5. Add saveable presets for Resolume/VDMX/TouchDesigner performance setups.
