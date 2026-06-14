# INFINIGHTCapture

Gesture-reactive webcam mocap compositor for VJ workflows.

INFINIGHTCapture is being built as a standalone app that tracks upper-body pose, hands, and fingers from a webcam, turns those landmarks into gesture signals, drives real-time visual effects, and prepares output paths for Syphon on macOS, Spout on Windows, and NDI across desktop platforms.

## Current MVP

- Webcam capture surface
- MediaPipe hand and pose tracking
- Upper-body and face tracking overlay
- Gesture analysis for face cover, hands up, pinch, open palm, fast motion, mouth open, smile, frown, eyes closed, ear pull, and chin lift
- Canvas compositor with fire, melt, warp, and bloom effects
- Syphon/Spout/NDI output target UI scaffold
- Electron shell for standalone desktop packaging
- Electron preload/main-process system bridge
- Runtime status panel for browser preview vs desktop shell
- macOS camera permission bridge for the desktop shell
- Motion-reactive shader player with saved Shadertoy-style, raw URL, file, and preset imports
- Facial gesture sources for shader mappings and GLSL uniforms
- Face Control panel for persisted gesture threshold calibration and touch-gesture tuning
- Gesture state machine for started, held, released, repeated, cooldown, smoothing, and latch states
- Gesture action matrix for routing gesture events to shader parameters, camera effects, output composition, and exportable/importable matrix presets
- Syphon/Spout/NDI output composition options for shader-only, shader plus wireframe, or shader plus wireframe plus live feed

## Run

```bash
git submodule update --init --recursive
npm install
npm run dev
```

Open `http://127.0.0.1:5173/`.

Shader import paths:

- Paste Shadertoy-style `mainImage(out vec4 fragColor, in vec2 fragCoord)` code in the Advanced importer.
- Drag `.frag`, `.fs`, `.glsl`, `.txt`, or `.infinightcaptureshader` files onto the Shader Player importer.
- Paste a Shadertoy URL, GitHub raw/blob URL, Gist URL, raw GLSL URL, or `.infinightcaptureshader` URL into Shader URL.
- Export the active shader as an `.infinightcaptureshader` preset to preserve shader code, metadata, parameters, and mocap mappings.

To import directly from a Shadertoy URL, set `VITE_SHADERTOY_API_KEY` in your local environment before starting Vite. Shadertoy API keys are free, but Shadertoy currently requires a Silver or Gold account, limits usage to 1500 requests per month, and only exposes shaders set to Public + API. INFINIGHTCapture saves imported shader code locally, so the API is only called when adding a new Shadertoy link.

INFINIGHTCapture uses Shadertoy.com API. Respect the license attached to each shader. URL import currently supports single-pass procedural shaders; Shadertoys that rely on texture, video, sound, webcam, VR, or multipass buffer inputs need a future asset/channel implementation. Without an API key, use the Advanced importer and paste the shader's `mainImage` code.

For the desktop shell:

```bash
npm run electron:dev
```

## Build

```bash
npm run build
```

## Package

### Downloads From GitHub

You can develop on macOS and let GitHub build the public demo downloads. The installer workflow runs on GitHub-hosted macOS and Windows machines, then uploads:

- `INFINIGHTCapture-Demo-0.1.0-mac-arm64.dmg` for Mac users
- `INFINIGHTCapture-Demo-Setup-0.1.0-win-x64.exe` for Windows users

For public downloads, create and push a version tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The workflow attaches the demo DMG and demo Windows setup EXE to that GitHub Release. Non-developers can download the installer from Releases; they do not need Visual Studio, Node, npm, Xcode, or the Spout SDK unless they want to build from source.

macOS Apple Silicon:

```bash
npm run package:mac
```

Windows x64:

```powershell
npm run package:win
```

The Windows package uses `native/SpoutFramePublisher.cpp` plus the Spout2 SDK runtime. Download the Spout2 SDK binaries from the official Spout2 project and either set `SPOUT_LIBRARY_DLL` to the full path of `SpoutLibrary.dll` or place the DLL at `native/vendor/Spout2/SpoutLibrary.dll` before running `npm run native:build:win` or `npm run package:win`.

Optional NDI sender:

```bash
NDI_SDK_DIR="/path/to/NDI SDK" npm run native:build:ndi
```

You can also set `NDI_INCLUDE_DIR`, `NDI_LIBRARY_PATH`, and `NDI_RUNTIME_LIBRARY` directly. The build copies `NDIFramePublisher` plus the NDI runtime library into `native/build`, where the Electron bridge will discover it.

NDI packaging scripts bundle the optional helper and runtime when the SDK is available:

```bash
npm run package:mac:ndi
npm run package:linux:ndi
```

```powershell
npm run package:win:ndi
```

## Character Filters And Licensing

INFINIGHTCapture character filters are drawn procedurally in `src/rendering/compositor.ts`; the app does not bundle third-party character images or production assets.

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
  -> INFINIGHTCapture system bridge
      browser preview: UI and tracking only
      Electron shell: native permissions and output control
      native core: Syphon/Spout/NDI frame publisher
```

The system boundary is intentionally thin:

- `src/system` defines the renderer-side bridge contract.
- `electron/preload.cjs` safely exposes the bridge to the UI.
- `electron/systemBridge.cjs` owns OS-level status, permissions, and native output commands.
- `native` is reserved for the Syphon/Spout/NDI frame publisher implementation.

## Next Milestones

1. Replace the canvas frame-copy output transport with a shared GPU texture path.
2. Add a Spout receiver/input path behind the same output interface.
3. Replace the canvas effects with a WebGL shader graph so landmarks become shader uniforms.
4. Add a gesture-to-parameter modulation matrix.
5. Add saveable presets for Resolume/VDMX/TouchDesigner performance setups.
