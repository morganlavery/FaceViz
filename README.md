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

## Character Filters And Licensing

FaceViz character filters are drawn procedurally in `src/rendering/compositor.ts`; the app does not bundle third-party character images or production assets.

- Toon Kit is a CC0-style original filter inspired by public-domain/CC0 game-asset conventions such as Kenney's CC0 character packs. No third-party artwork is embedded.
- Big Buck, Sintel, Spring, Sprite Fright, and Caminandes are procedural tribute filters inspired by Blender open movie characters and motifs. They do not copy source production files, but they should be credited as inspired by Blender open movie projects when distributed.

Attribution references:

- Big Buck Bunny, Blender Foundation, CC BY 3.0: https://peach.blender.org/about/
- Sintel / Durian Open Movie Project, Blender Foundation, CC BY 3.0: https://durian.blender.org/sharing/
- Spring Open Movie, Blender Studio, CC BY 4.0: https://studio.blender.org/projects/spring/pages/about/
- Sprite Fright, Blender Studio, Creative Commons Attribution: https://studio.blender.org/projects/sprite-fright/pages/about/
- Caminandes, Blender Foundation, CC BY 3.0: https://commons.wikimedia.org/wiki/File:Caminandes_3_-_Llamigos_-_Blender_Animated_Short.webm
- Kenney assets, CC0/public domain asset policy: https://kenney.nl/support

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
