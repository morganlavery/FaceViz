import { FaceLandmarker, FilesetResolver, HandLandmarker, PoseLandmarker } from "@mediapipe/tasks-vision";
import {
  Activity,
  Aperture,
  BadgeCheck,
  Bot,
  Camera,
  Code2,
  Cpu,
  Crown,
  ChevronsUpDown,
  Download,
  Expand,
  FileUp,
  Fingerprint,
  Flame,
  FlipHorizontal2,
  Hand,
  Leaf,
  Link2,
  Loader2,
  Maximize2,
  MonitorCog,
  MountainSnow,
  Orbit,
  Pause,
  Play,
  Rabbit,
  RadioTower,
  ScanFace,
  ScanLine,
  Settings2,
  SlidersHorizontal,
  Smile,
  Sprout,
  Trash2,
  ShieldAlert,
  Sparkles,
  Star,
  Swords,
  Trees,
  Waves
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { getOutputStatuses, getPreferredOutput, type OutputTarget } from "./output/outputTargets";
import { renderFrame, type CompositorOptions } from "./rendering/compositor";
import {
  FACEVIZ_SHADER_PRESET_SCHEMA,
  SHADER_LIBRARY_STORAGE_KEY,
  createImportedShaderScene,
  createDefaultShaderSettings,
  extractShadertoyId,
  getShaderSceneFromLibrary,
  getMotionSignalValue,
  isStoredShaderScene,
  resolveShaderParameterValues,
  shaderMotionSources,
  shaderScenes,
  type INFINIGHTCaptureShaderPreset,
  type ShaderScene,
  type ShaderParameterDefinition,
  type ShaderParameterSettings
} from "./rendering/shaderPlayer";
import {
  getSystemStatus,
  publishSystemOutputFrame,
  requestSystemCameraAccess,
  startSystemOutput,
  stopSystemOutput
} from "./system/systemBridge";
import type { SystemStatus, SystemSyphonPeer } from "./system/types";
import { analyzeMotion, buildTrackedFace, buildTrackedHand, buildTrackedPose } from "./tracking/gestureEngine";
import type { Handedness, Landmark, MotionFrame, PreviousHandSample } from "./tracking/types";

type CaptureState = "idle" | "loading" | "running" | "error";
type CameraIssue = "blocked" | "missing" | "browser" | null;
type WorkspaceTab = "preview" | "shader" | "mapping" | "signal";
type VisualMode = "camera" | "shader";
type OutputCompositionMode = "shader" | "shaderWire" | "shaderWireCamera";
type OutputPerformanceMode = "max" | "turbo" | "live" | "sharp";
type SignalNodeId = "camera" | "tracker" | "core" | "output" | "consumer" | "input";
type SignalNodePosition = {
  x: number;
  y: number;
};

const WASM_ROOT = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const HAND_MODEL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const POSE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task";
const FACE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task";

const effects = [
  { id: "auto", label: "Auto", icon: Sparkles },
  { id: "cyberbot", label: "Cyber Bot", icon: Bot },
  { id: "popidol", label: "Pop Idol", icon: Crown },
  { id: "comic", label: "Comic Hero", icon: Star },
  { id: "toonkit", label: "Toon Kit", icon: Smile },
  { id: "bigbuck", label: "Big Buck", icon: Rabbit },
  { id: "sintel", label: "Sintel", icon: Swords },
  { id: "spring", label: "Spring", icon: Sprout },
  { id: "spritefright", label: "Sprite Fright", icon: Trees },
  { id: "caminandes", label: "Caminandes", icon: MountainSnow },
  { id: "mirror", label: "Mirror", icon: FlipHorizontal2 },
  { id: "edge", label: "Edges", icon: ScanLine },
  { id: "leaves", label: "Leaves", icon: Leaf },
  { id: "fire", label: "Fire", icon: Flame },
  { id: "stickers", label: "Stickers", icon: Star },
  { id: "melt", label: "Melt", icon: Waves },
  { id: "contour", label: "Contour", icon: ScanFace },
  { id: "warp", label: "Warp", icon: Aperture },
  { id: "orbit", label: "Orbit", icon: Orbit },
  { id: "bloom", label: "Bloom", icon: Fingerprint }
];

const workspaceTabs: Array<{ id: WorkspaceTab; label: string }> = [
  { id: "preview", label: "Preview" },
  { id: "shader", label: "Shader" },
  { id: "mapping", label: "Mapping" },
  { id: "signal", label: "Signal" }
];

const workspaceTabIcons: Record<WorkspaceTab, typeof Activity> = {
  preview: ScanFace,
  shader: Sparkles,
  mapping: SlidersHorizontal,
  signal: Activity
};

const defaultShaderImportSource = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = (fragCoord * 2.0 - iResolution.xy) / iResolution.y;
  float t = iTime * (0.4 + fvParamA.z);
  float hand = fvParamA.x;
  float pinch = fvParamA.y;
  vec2 mouse = (iMouse.xy / iResolution.xy) * 2.0 - 1.0;
  mouse.x *= iResolution.x / iResolution.y;

  float rings = 0.0;
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    vec2 p = uv - mouse * (0.2 + hand * 0.35);
    p.x += sin(t + fi) * 0.18;
    p.y += cos(t * 0.82 + fi * 1.7) * 0.12;
    rings += 0.012 / abs(length(p) - (0.16 + fi * 0.08 + pinch * 0.14));
  }

  vec3 color = vec3(0.12, 0.95, 0.72) * rings;
  color += vec3(1.0, 0.62, 0.22) * smoothstep(0.7, 2.4, rings) * fvParamA.w;
  color *= smoothstep(1.55, 0.18, length(uv));
  fragColor = vec4(color, 1.0);
}`;

const outputPerformanceModes: Array<{
  id: OutputPerformanceMode;
  label: string;
  width: number;
  height: number;
  fps: number;
}> = [
  { id: "max", label: "Max", width: 480, height: 270, fps: 60 },
  { id: "turbo", label: "Turbo", width: 640, height: 360, fps: 60 },
  { id: "live", label: "Live", width: 960, height: 540, fps: 60 },
  { id: "sharp", label: "Sharp", width: 1280, height: 720, fps: 30 }
];

const outputCompositionModes: Array<{
  id: OutputCompositionMode;
  label: string;
  detail: string;
  showRig: boolean;
  includeCameraFeed: boolean;
}> = [
  {
    id: "shader",
    label: "Shader",
    detail: "Shader only",
    showRig: false,
    includeCameraFeed: false
  },
  {
    id: "shaderWire",
    label: "Shader + Wire",
    detail: "Shader with mocap wireframe",
    showRig: true,
    includeCameraFeed: false
  },
  {
    id: "shaderWireCamera",
    label: "Full Composite",
    detail: "Shader, wireframe, and live feed",
    showRig: true,
    includeCameraFeed: true
  }
];

const defaultSignalNodePositions: Record<SignalNodeId, SignalNodePosition> = {
  camera: { x: 5, y: 12 },
  tracker: { x: 27, y: 23 },
  core: { x: 48, y: 38 },
  output: { x: 75, y: 16 },
  consumer: { x: 73, y: 64 },
  input: { x: 10, y: 62 }
};

const signalNodeDimensions: Record<SignalNodeId, { width: number; height: number }> = {
  camera: { width: 215, height: 128 },
  tracker: { width: 215, height: 128 },
  core: { width: 238, height: 128 },
  output: { width: 215, height: 128 },
  consumer: { width: 215, height: 128 },
  input: { width: 215, height: 128 }
};

const shaderPresetFilePattern = /\.(infinightcaptureshader|facevizshader)(?:$|[?#])/i;
const shaderSourceFilePattern = /\.(infinightcaptureshader|facevizshader|frag|fs|glsl|json|txt)$/i;

type ShadertoyApiResponse = {
  Error?: string;
  Shader?: {
    info?: {
      license?: string;
      name?: string;
      username?: string;
    };
    renderpass?: Array<{
      code?: string;
      inputs?: Array<{
        ctype?: string;
        src?: string;
      }>;
      name?: string;
      type?: string;
    }>;
  };
};

const getShadertoyApiKey = () =>
  ((import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_SHADERTOY_API_KEY ?? "").trim();

const fetchShadertoyImport = async (linkOrId: string) => {
  const id = extractShadertoyId(linkOrId);
  if (!id) {
    throw new Error("Paste a Shadertoy URL like https://www.shadertoy.com/view/XXXXXX.");
  }

  const apiKey = getShadertoyApiKey();
  if (!apiKey) {
    throw new Error("Set VITE_SHADERTOY_API_KEY in the app environment, or paste the shader's mainImage code below.");
  }

  const response = await fetch(`https://www.shadertoy.com/api/v1/shaders/${id}?key=${encodeURIComponent(apiKey)}`);
  if (!response.ok) {
    throw new Error(`Shadertoy returned ${response.status}. Check the shader link or API key.`);
  }

  const data = (await response.json()) as ShadertoyApiResponse;
  if (data.Error) {
    throw new Error(data.Error);
  }

  const shader = data.Shader;
  const unsupportedPasses =
    shader?.renderpass?.filter((renderPass) => renderPass.type && !["common", "image"].includes(renderPass.type)) ?? [];
  if (unsupportedPasses.length > 0) {
    throw new Error("That Shadertoy uses multipass, sound, VR, or buffer passes that INFINIGHTCapture cannot run yet.");
  }

  const pass =
    shader?.renderpass?.find((renderPass) => renderPass.type === "image" && renderPass.code?.includes("mainImage")) ??
    shader?.renderpass?.find((renderPass) => renderPass.code?.includes("mainImage"));

  if (!pass?.code) {
    throw new Error("No image pass with mainImage was found in that Shadertoy.");
  }
  if (pass.inputs?.length) {
    const inputTypes = Array.from(new Set(pass.inputs.map((input) => input.ctype ?? "asset"))).join(", ");
    throw new Error(`That Shadertoy uses ${inputTypes} inputs. INFINIGHTCapture URL import currently supports single-pass procedural shaders.`);
  }

  return {
    author: shader?.info?.username ?? "",
    fragment: pass.code,
    label: shader?.info?.name ?? `Shadertoy ${id}`,
    license: shader?.info?.license ?? "Check Shadertoy license",
    sourceUrl: `https://www.shadertoy.com/view/${id}`
  };
};

const shaderMotionSourceIds = new Set<string>(shaderMotionSources.map((source) => source.id));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const normalizeShaderParameterDefinition = (value: unknown): ShaderParameterDefinition | null => {
  if (!isRecord(value)) return null;
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const label = typeof value.label === "string" ? value.label.trim() : id;
  const min = typeof value.min === "number" ? value.min : 0;
  const max = typeof value.max === "number" ? value.max : 1;
  const defaultValue = typeof value.defaultValue === "number" ? value.defaultValue : min + (max - min) * 0.5;
  const motionDefault = typeof value.motionDefault === "string" && shaderMotionSourceIds.has(value.motionDefault as ShaderParameterDefinition["motionDefault"])
    ? value.motionDefault
    : "manual";

  if (!id || max <= min) return null;
  return {
    id,
    label,
    min,
    max,
    defaultValue: Math.min(Math.max(defaultValue, min), max),
    motionDefault: motionDefault as ShaderParameterDefinition["motionDefault"]
  };
};

const normalizeShaderSettings = (
  scene: ShaderScene,
  settings: Record<string, ShaderParameterSettings> | undefined
) => {
  const defaults = createDefaultShaderSettings(scene);
  if (!settings) return defaults;

  return Object.fromEntries(
    scene.parameters.map((parameter) => {
      const setting = settings[parameter.id];
      if (!setting) return [parameter.id, defaults[parameter.id]];
      const source = shaderMotionSourceIds.has(setting.source) ? setting.source : defaults[parameter.id].source;
      return [
        parameter.id,
        {
          value: Math.min(Math.max(setting.value, parameter.min), parameter.max),
          source,
          depth: Math.min(Math.max(setting.depth, 0), 1)
        }
      ];
    })
  );
};

const parseINFINIGHTCaptureShaderPreset = (value: string, sourceUrl = "") => {
  const parsed = JSON.parse(value) as unknown;
  if (!isRecord(parsed) || parsed.schema !== FACEVIZ_SHADER_PRESET_SCHEMA) {
    throw new Error("That file is not an INFINIGHTCapture shader preset.");
  }

  const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
  const fragment = typeof parsed.fragment === "string" ? parsed.fragment : "";
  if (!name || !fragment.includes("mainImage")) {
    throw new Error("INFINIGHTCapture presets need a name and a mainImage fragment.");
  }

  const parameters = Array.isArray(parsed.parameters)
    ? parsed.parameters
        .map(normalizeShaderParameterDefinition)
        .filter((parameter): parameter is ShaderParameterDefinition => Boolean(parameter))
    : undefined;
  const mappings = isRecord(parsed.mappings) ? parsed.mappings as Record<string, ShaderParameterSettings> : undefined;

  return {
    author: typeof parsed.author === "string" ? parsed.author : "",
    fragment,
    label: name,
    license: typeof parsed.license === "string" ? parsed.license : "INFINIGHTCapture preset",
    mappings,
    parameters,
    source: "preset" as const,
    sourceUrl: typeof parsed.sourceUrl === "string" ? parsed.sourceUrl : sourceUrl
  };
};

const isLikelyINFINIGHTCapturePreset = (source: string, sourceUrl = "") => {
  if (shaderPresetFilePattern.test(sourceUrl)) return true;
  try {
    const parsed = JSON.parse(source) as unknown;
    return isRecord(parsed) && parsed.schema === FACEVIZ_SHADER_PRESET_SCHEMA;
  } catch {
    return false;
  }
};

const getRawShaderUrl = (value: string) => {
  const trimmed = value.trim();
  const url = new URL(trimmed);
  if (url.hostname === "github.com") {
    const parts = url.pathname.split("/").filter(Boolean);
    const blobIndex = parts.indexOf("blob");
    if (parts.length > 4 && blobIndex === 2) {
      const [owner, repo] = parts;
      const branch = parts[3];
      const path = parts.slice(4).join("/");
      return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
    }
  }
  if (url.hostname === "gist.github.com") {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length >= 2) {
      return `https://gist.githubusercontent.com/${parts[0]}/${parts[1]}/raw`;
    }
  }
  return url.toString();
};

const inferShaderLabelFromUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    const lastPart = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() ?? "").trim();
    return lastPart.replace(/\.(infinightcaptureshader|facevizshader|frag|fs|glsl|txt|json)$/i, "") || parsed.hostname;
  } catch {
    return "Raw Shader";
  }
};

const fetchRawShaderImport = async (link: string) => {
  const rawUrl = getRawShaderUrl(link);
  const response = await fetch(rawUrl);
  if (!response.ok) {
    throw new Error(`Raw shader URL returned ${response.status}.`);
  }

  const source = await response.text();
  if (isLikelyINFINIGHTCapturePreset(source, rawUrl)) {
    return parseINFINIGHTCaptureShaderPreset(source, rawUrl);
  }
  if (!source.includes("mainImage")) {
    throw new Error("Raw shader URLs need a mainImage fragment or an .infinightcaptureshader preset.");
  }

  return {
    author: "",
    fragment: source,
    label: inferShaderLabelFromUrl(rawUrl),
    license: "Raw URL import",
    source: "raw" as const,
    sourceUrl: rawUrl
  };
};

const getHandedness = (result: unknown, index: number): Handedness => {
  const handednesses = (result as { handednesses?: Array<Array<{ categoryName?: string }>> }).handednesses;
  const name = handednesses?.[index]?.[0]?.categoryName;
  if (name === "Left" || name === "Right") return name;
  return "Unknown";
};

const isCameraBlockedError = (error: unknown) =>
  error instanceof DOMException && ["NotAllowedError", "PermissionDeniedError", "SecurityError"].includes(error.name);

const getCaptureError = (error: unknown) => {
  if (isCameraBlockedError(error)) {
    return {
      issue: "blocked" as CameraIssue,
      message: "Camera access is blocked for INFINIGHTCapture."
    };
  }

  if (error instanceof DOMException && ["NotFoundError", "DevicesNotFoundError"].includes(error.name)) {
    return {
      issue: "missing" as CameraIssue,
      message: "No camera was found. Connect a webcam or enable your built-in camera."
    };
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    return {
      issue: "browser" as CameraIssue,
      message: "This browser surface does not expose webcam capture."
    };
  }

  return {
    issue: null,
    message: error instanceof Error ? error.message : "Unable to start camera."
  };
};

const useReducedMotion = () => {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const update = () => setReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return reduced;
};

export function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const outputCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const shaderFileInputRef = useRef<HTMLInputElement | null>(null);
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const poseLandmarkerRef = useRef<PoseLandmarker | null>(null);
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const previousHandsRef = useRef<Map<string, PreviousHandSample>>(new Map());
  const motionRef = useRef<MotionFrame | null>(null);
  const outputTargetRef = useRef<OutputTarget>(getPreferredOutput());
  const outputStreamingRef = useRef(false);
  const outputFrameInFlightRef = useRef(false);
  const outputLastSendAtRef = useRef(0);
  const outputFrameIntervalRef = useRef(1000 / 60);
  const outputTimerRef = useRef<number | null>(null);
  const compositorOptionsRef = useRef<CompositorOptions>({
    showRig: true,
    effectAmount: 0.82,
    selectedEffect: "auto"
  });
  const outputCompositorOptionsRef = useRef<CompositorOptions>({
    showRig: true,
    effectAmount: 0.82,
    selectedEffect: "auto"
  });
  const lastVideoTimeRef = useRef(-1);
  const lastFpsSampleRef = useRef({ timestamp: performance.now(), frames: 0 });
  const frameStartRef = useRef(performance.now());
  const runningRef = useRef(false);
  const reducedMotion = useReducedMotion();

  const [captureState, setCaptureState] = useState<CaptureState>("idle");
  const [error, setError] = useState("");
  const [cameraIssue, setCameraIssue] = useState<CameraIssue>(null);
  const [motion, setMotion] = useState<MotionFrame | null>(null);
  const [fps, setFps] = useState(0);
  const [latency, setLatency] = useState(0);
  const [mode, setMode] = useState<"upper" | "full">("upper");
  const [showRig, setShowRig] = useState(true);
  const [outputCompositionMode, setOutputCompositionMode] = useState<OutputCompositionMode>("shaderWire");
  const [outputPerformanceMode, setOutputPerformanceMode] = useState<OutputPerformanceMode>("max");
  const [effectAmount, setEffectAmount] = useState(0.82);
  const [selectedEffect, setSelectedEffect] = useState("auto");
  const [outputTarget, setOutputTarget] = useState<OutputTarget>(getPreferredOutput);
  const [isOutputStreaming, setIsOutputStreaming] = useState(false);
  const [outputError, setOutputError] = useState("");
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceTab>("preview");
  const [visualMode, setVisualMode] = useState<VisualMode>("camera");
  const [importedShaderScenes, setImportedShaderScenes] = useState<ShaderScene[]>(() => {
    try {
      const stored = window.localStorage.getItem(SHADER_LIBRARY_STORAGE_KEY);
      if (!stored) return [];
      const parsed = JSON.parse(stored);
      return Array.isArray(parsed) ? parsed.filter(isStoredShaderScene) : [];
    } catch {
      return [];
    }
  });
  const [shaderSceneId, setShaderSceneId] = useState(shaderScenes[0].id);
  const [shaderSettings, setShaderSettings] = useState<Record<string, ShaderParameterSettings>>(() =>
    createDefaultShaderSettings(shaderScenes[0])
  );
  const [shaderImportName, setShaderImportName] = useState("Imported Shader");
  const [shaderImportAuthor, setShaderImportAuthor] = useState("");
  const [shaderImportLicense, setShaderImportLicense] = useState("");
  const [shaderImportLink, setShaderImportLink] = useState("");
  const [shaderImportSource, setShaderImportSource] = useState(defaultShaderImportSource);
  const [shaderImportError, setShaderImportError] = useState("");
  const [shaderImportNotice, setShaderImportNotice] = useState("");
  const [shaderImportBusy, setShaderImportBusy] = useState(false);
  const [shaderFileDragActive, setShaderFileDragActive] = useState(false);
  const [showShaderCodeImport, setShowShaderCodeImport] = useState(false);
  const outputStatuses = useMemo(() => getOutputStatuses(), []);
  const displayOutputStatuses = outputStatuses.map((status) => {
    const systemOutput = systemStatus?.outputs.find((output) => output.target === status.target);
    return {
      ...status,
      available: systemOutput?.available ?? status.available,
      detail: systemOutput?.detail ?? status.detail
    };
  });
  const selectedOutput = displayOutputStatuses.find((status) => status.target === outputTarget) ?? displayOutputStatuses[0];
  const selectedSystemOutput = systemStatus?.outputs.find((status) => status.target === outputTarget);
  const selectedPerformanceMode =
    outputPerformanceModes.find((performanceMode) => performanceMode.id === outputPerformanceMode) ??
    outputPerformanceModes[0];
  const selectedOutputComposition =
    outputCompositionModes.find((compositionMode) => compositionMode.id === outputCompositionMode) ??
    outputCompositionModes[0];
  const shaderLibrary = useMemo(() => [...shaderScenes, ...importedShaderScenes], [importedShaderScenes]);
  const activeShaderScene = useMemo(() => getShaderSceneFromLibrary(shaderSceneId, shaderLibrary), [shaderLibrary, shaderSceneId]);
  const shaderValues = useMemo(
    () => resolveShaderParameterValues(activeShaderScene, shaderSettings, motion),
    [activeShaderScene, motion, shaderSettings]
  );

  const stopCapture = useCallback(() => {
    runningRef.current = false;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraIssue(null);
    setCaptureState("idle");
  }, []);

  const pumpOutputFrame = useCallback(async () => {
    if (!outputStreamingRef.current) {
      return;
    }

    const canvas = outputCanvasRef.current ?? canvasRef.current;
    const now = performance.now();
    if (
      canvas &&
      canvas.width > 1 &&
      canvas.height > 1 &&
      !outputFrameInFlightRef.current &&
      now - outputLastSendAtRef.current >= outputFrameIntervalRef.current
    ) {
      outputFrameInFlightRef.current = true;
      outputLastSendAtRef.current = now;
      try {
        const context = canvas.getContext("2d", { willReadFrequently: true });
        const frame = context?.getImageData(0, 0, canvas.width, canvas.height);
        if (frame) {
          const pixels = frame.data.buffer.slice(0);
          const result = await publishSystemOutputFrame(outputTargetRef.current, {
            width: frame.width,
            height: frame.height,
            pixels
          });
          setOutputError(result.ok ? "" : result.reason ?? "Unable to publish output frame.");
        }
      } catch (nextError) {
        setOutputError(nextError instanceof Error ? nextError.message : "Unable to publish output frame.");
      } finally {
        outputFrameInFlightRef.current = false;
      }
    }

    outputTimerRef.current = window.setTimeout(pumpOutputFrame, 8);
  }, []);

  const startOutput = useCallback(async () => {
    setOutputError("");
    const result = await startSystemOutput(outputTarget);
    if (!result.ok) {
      setOutputError(result.reason ?? `Unable to start ${outputTarget} output.`);
      return;
    }

    outputTargetRef.current = outputTarget;
    outputLastSendAtRef.current = 0;
    outputStreamingRef.current = true;
    setIsOutputStreaming(true);
    pumpOutputFrame();
    setSystemStatus(await getSystemStatus());
  }, [outputTarget, pumpOutputFrame]);

  const stopOutput = useCallback(async () => {
    outputStreamingRef.current = false;
    outputFrameInFlightRef.current = false;
    if (outputTimerRef.current !== null) {
      window.clearTimeout(outputTimerRef.current);
      outputTimerRef.current = null;
    }
    await stopSystemOutput(outputTargetRef.current);
    setIsOutputStreaming(false);
    setSystemStatus(await getSystemStatus());
  }, []);

  const renderLoop = useCallback(() => {
    const canvas = canvasRef.current;
    const outputCanvas = outputCanvasRef.current;
    const video = videoRef.current;
    if (!canvas) return;

    const now = performance.now();
    frameStartRef.current = now;

    if (
      runningRef.current &&
      video &&
      video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      video.currentTime !== lastVideoTimeRef.current &&
      handLandmarkerRef.current &&
      poseLandmarkerRef.current &&
      faceLandmarkerRef.current
    ) {
      lastVideoTimeRef.current = video.currentTime;
      try {
        const handResults = handLandmarkerRef.current.detectForVideo(video, now);
        const poseResults = poseLandmarkerRef.current.detectForVideo(video, now);
        const faceResults = faceLandmarkerRef.current.detectForVideo(video, now);
        const previous = previousHandsRef.current;
        const nextPrevious = new Map<string, PreviousHandSample>();
        const hands = (handResults.landmarks as Landmark[][]).map((landmarks, index) => {
          const handedness = getHandedness(handResults, index);
          const key = `${handedness}-${index}`;
          const hand = buildTrackedHand(landmarks, handedness, previous.get(key), now);
          nextPrevious.set(key, { wrist: hand.wrist, timestamp: now });
          return hand;
        });
        previousHandsRef.current = nextPrevious;
        const pose = buildTrackedPose((poseResults.landmarks?.[0] as Landmark[] | undefined) ?? undefined);
        const face = buildTrackedFace((faceResults.faceLandmarks?.[0] as Landmark[] | undefined) ?? undefined);
        const nextMotion = analyzeMotion(hands, pose, face, now);
        motionRef.current = nextMotion;
        setMotion(nextMotion);
        setLatency(performance.now() - frameStartRef.current);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Tracking failed.");
        setCaptureState("error");
        runningRef.current = false;
      }
    }

    renderFrame(canvas, video, motionRef.current, compositorOptionsRef.current);
    if (outputCanvas) {
      renderFrame(outputCanvas, video, motionRef.current, outputCompositorOptionsRef.current);
    }

    const fpsSample = lastFpsSampleRef.current;
    fpsSample.frames += 1;
    if (now - fpsSample.timestamp > 500) {
      setFps(Math.round((fpsSample.frames * 1000) / (now - fpsSample.timestamp)));
      lastFpsSampleRef.current = { timestamp: now, frames: 0 };
    }

    rafRef.current = requestAnimationFrame(renderLoop);
  }, []);

  const startCapture = useCallback(async () => {
    if (captureState === "loading" || captureState === "running") return;
    setError("");
    setCameraIssue(null);
    setCaptureState("loading");

    try {
      const video = videoRef.current;
      if (!video) {
        throw new Error("Preview video is not ready.");
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("This browser surface does not expose webcam capture.");
      }

      const systemCameraAccess = await requestSystemCameraAccess();
      if (!systemCameraAccess.granted) {
        const error = new DOMException("Camera access is blocked for INFINIGHTCapture.", "NotAllowedError");
        throw error;
      }
      setSystemStatus((current) => (current ? { ...current, cameraAccess: systemCameraAccess.status } : current));

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 60, max: 60 },
          facingMode: "user"
        },
        audio: false
      });
      streamRef.current = stream;
      video.srcObject = stream;
      await video.play();

      if (!handLandmarkerRef.current || !poseLandmarkerRef.current || !faceLandmarkerRef.current) {
        const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
        const [handLandmarker, poseLandmarker, faceLandmarker] = await Promise.all([
          HandLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: HAND_MODEL,
              delegate: "GPU"
            },
            runningMode: "VIDEO",
            numHands: 2,
            minHandDetectionConfidence: 0.45,
            minHandPresenceConfidence: 0.45,
            minTrackingConfidence: 0.45
          }),
          PoseLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: POSE_MODEL,
              delegate: "GPU"
            },
            runningMode: "VIDEO",
            numPoses: 1,
            minPoseDetectionConfidence: 0.4,
            minPosePresenceConfidence: 0.4,
            minTrackingConfidence: 0.4
          }),
          FaceLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: FACE_MODEL,
              delegate: "GPU"
            },
            runningMode: "VIDEO",
            numFaces: 1,
            minFaceDetectionConfidence: 0.45,
            minFacePresenceConfidence: 0.45,
            minTrackingConfidence: 0.45
          })
        ]);
        handLandmarkerRef.current = handLandmarker;
        poseLandmarkerRef.current = poseLandmarker;
        faceLandmarkerRef.current = faceLandmarker;
      }

      runningRef.current = true;
      lastVideoTimeRef.current = -1;
      previousHandsRef.current.clear();
      setCaptureState("running");
    } catch (nextError) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      const captureError = getCaptureError(nextError);
      setCameraIssue(captureError.issue);
      setError(captureError.message);
      setCaptureState("error");
      runningRef.current = false;
    }
  }, [captureState]);

  useEffect(() => {
    let cancelled = false;

    const updateSystemStatus = async () => {
      const nextStatus = await getSystemStatus();
      if (!cancelled) {
        setSystemStatus(nextStatus);
      }
    };

    updateSystemStatus();
    const interval = window.setInterval(updateSystemStatus, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem(SHADER_LIBRARY_STORAGE_KEY, JSON.stringify(importedShaderScenes));
  }, [importedShaderScenes]);

  useEffect(() => {
    outputTargetRef.current = outputTarget;
  }, [outputTarget]);

  useEffect(() => {
    outputFrameIntervalRef.current = 1000 / selectedPerformanceMode.fps;
  }, [selectedPerformanceMode.fps]);

  useEffect(() => {
    compositorOptionsRef.current = {
      showRig,
      effectAmount: reducedMotion ? Math.min(effectAmount, 0.4) : effectAmount,
      selectedEffect,
      visualMode,
      shaderScene: activeShaderScene,
      shaderParameters: shaderSettings
    };
    outputCompositorOptionsRef.current = {
      showRig: selectedOutputComposition.showRig,
      effectAmount: reducedMotion ? Math.min(effectAmount, 0.4) : effectAmount,
      selectedEffect,
      includeCameraFeed: selectedOutputComposition.includeCameraFeed,
      visualMode: "shader",
      shaderScene: activeShaderScene,
      shaderParameters: shaderSettings
    };
  }, [
    activeShaderScene,
    effectAmount,
    reducedMotion,
    selectedEffect,
    selectedOutputComposition.includeCameraFeed,
    selectedOutputComposition.showRig,
    shaderSettings,
    showRig,
    visualMode
  ]);

  useEffect(() => {
    setShaderSettings((current) => {
      const defaults = createDefaultShaderSettings(activeShaderScene);
      return Object.fromEntries(
        activeShaderScene.parameters.map((parameter) => [
          parameter.id,
          current[parameter.id] ?? defaults[parameter.id]
        ])
      );
    });
  }, [activeShaderScene]);

  const updateShaderSetting = useCallback((parameterId: string, patch: Partial<ShaderParameterSettings>) => {
    setShaderSettings((current) => ({
      ...current,
      [parameterId]: {
        ...current[parameterId],
        ...patch
      }
    }));
  }, []);

  const addImportedShaderScene = useCallback((input: {
    author?: string;
    fragment: string;
    label: string;
    license?: string;
    mappings?: Record<string, ShaderParameterSettings>;
    parameters?: ShaderParameterDefinition[];
    source?: "file" | "preset" | "raw" | "shadertoy";
    sourceUrl?: string;
  }) => {
    const nextScene = createImportedShaderScene(input);
    const nextSettings = normalizeShaderSettings(nextScene, input.mappings);
    setImportedShaderScenes((current) => [...current, nextScene]);
    setShaderSceneId(nextScene.id);
    setShaderSettings(nextSettings);
    setVisualMode("shader");
    setActiveWorkspace("shader");
    return nextScene;
  }, []);

  const importShaderScene = useCallback(() => {
    setShaderImportError("");
    setShaderImportNotice("");
    if (!shaderImportName.trim()) {
      setShaderImportError("Name required.");
      return;
    }
    if (!shaderImportSource.includes("mainImage")) {
      setShaderImportError("mainImage required.");
      return;
    }

    addImportedShaderScene({
      author: shaderImportAuthor,
      fragment: shaderImportSource,
      label: shaderImportName,
      license: shaderImportLicense,
      sourceUrl: shaderImportLink
    });
    setShaderImportNotice("Shader added.");
  }, [addImportedShaderScene, shaderImportAuthor, shaderImportLicense, shaderImportLink, shaderImportName, shaderImportSource]);

  const importShaderLink = useCallback(async () => {
    setShaderImportError("");
    setShaderImportNotice("");
    setShaderImportBusy(true);
    try {
      const trimmedLink = shaderImportLink.trim();
      const isShadertoy =
        /^[a-zA-Z0-9]{6,12}$/.test(trimmedLink) || /^https?:\/\/(?:www\.)?shadertoy\.com\//i.test(trimmedLink);
      const fetched = isShadertoy ? await fetchShadertoyImport(trimmedLink) : await fetchRawShaderImport(trimmedLink);
      setShaderImportName(fetched.label);
      setShaderImportAuthor("author" in fetched ? fetched.author : "");
      setShaderImportLicense(fetched.license);
      setShaderImportSource(fetched.fragment);
      addImportedShaderScene(fetched);
      setShaderImportNotice(isShadertoy ? "Shader added from Shadertoy." : "Shader added from URL.");
    } catch (nextError) {
      setShaderImportError(nextError instanceof Error ? nextError.message : "Unable to import shader URL.");
    } finally {
      setShaderImportBusy(false);
    }
  }, [addImportedShaderScene, shaderImportLink]);

  const importShaderFiles = useCallback(async (files: FileList | File[]) => {
    const shaderFiles = Array.from(files).filter((file) =>
      shaderSourceFilePattern.test(file.name) || /json|shader|glsl|text/i.test(file.type)
    );

    if (shaderFiles.length === 0) {
      setShaderImportNotice("");
      setShaderImportError("Drop a .frag, .glsl, or .infinightcaptureshader file.");
      return;
    }

    setShaderImportError("");
    setShaderImportNotice("");
    setShaderImportBusy(true);
    try {
      let importedCount = 0;
      for (const file of shaderFiles) {
        const source = await file.text();
        if (shaderPresetFilePattern.test(file.name) || isLikelyINFINIGHTCapturePreset(source, file.name)) {
          const preset = parseINFINIGHTCaptureShaderPreset(source, file.name);
          const scene = addImportedShaderScene(preset);
          setShaderImportName(scene.label);
          setShaderImportLicense(scene.license ?? "");
          setShaderImportSource(scene.fragment);
          importedCount += 1;
          continue;
        }

        if (!source.includes("mainImage")) {
          throw new Error(`${file.name} does not include mainImage.`);
        }

        const label = file.name.replace(/\.(frag|fs|glsl|txt)$/i, "").trim() || "Dropped Shader";
        const scene = addImportedShaderScene({
          fragment: source,
          label,
          license: "File import",
          source: "file",
          sourceUrl: file.name
        });
        setShaderImportName(scene.label);
        setShaderImportLicense(scene.license ?? "");
        setShaderImportSource(scene.fragment);
        importedCount += 1;
      }
      setShaderImportNotice(importedCount > 1 ? `Imported ${importedCount} shaders.` : "Shader file imported.");
    } catch (nextError) {
      setShaderImportNotice("");
      setShaderImportError(nextError instanceof Error ? nextError.message : "Unable to import shader file.");
    } finally {
      setShaderImportBusy(false);
      setShaderFileDragActive(false);
    }
  }, [addImportedShaderScene]);

  const exportActiveShaderPreset = useCallback(() => {
    const defaults = createDefaultShaderSettings(activeShaderScene);
    const mappings = Object.fromEntries(
      activeShaderScene.parameters.map((parameter) => [
        parameter.id,
        shaderSettings[parameter.id] ?? defaults[parameter.id]
      ])
    );
    const preset: INFINIGHTCaptureShaderPreset = {
      schema: FACEVIZ_SHADER_PRESET_SCHEMA,
      name: activeShaderScene.label,
      fragment: activeShaderScene.fragment,
      author: activeShaderScene.author,
      license: activeShaderScene.license,
      source: activeShaderScene.source,
      sourceUrl: activeShaderScene.sourceUrl,
      parameters: activeShaderScene.parameters,
      mappings
    };
    const filename = `${activeShaderScene.label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "infinightcapture-shader"}.infinightcaptureshader`;
    const blob = new Blob([JSON.stringify(preset, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    setShaderImportError("");
    setShaderImportNotice("Preset exported.");
  }, [activeShaderScene, shaderSettings]);

  const deleteShaderScene = useCallback((sceneId: string) => {
    setImportedShaderScenes((current) => current.filter((scene) => scene.id !== sceneId));
    if (shaderSceneId === sceneId) {
      const fallback = shaderScenes[0];
      setShaderSceneId(fallback.id);
      setShaderSettings(createDefaultShaderSettings(fallback));
    }
  }, [shaderSceneId]);

  const selectWorkspace = useCallback((tab: WorkspaceTab) => {
    setActiveWorkspace(tab);
    if (tab === "preview") {
      setVisualMode("camera");
    }
    if (tab === "shader" || tab === "mapping") {
      setVisualMode("shader");
    }
  }, []);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(renderLoop);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      handLandmarkerRef.current?.close();
      poseLandmarkerRef.current?.close();
      faceLandmarkerRef.current?.close();
      outputStreamingRef.current = false;
      if (outputTimerRef.current !== null) {
        window.clearTimeout(outputTimerRef.current);
      }
      stopSystemOutput(outputTargetRef.current);
    };
  }, [renderLoop]);

  const activeGestures = motion
    ? Object.entries(motion.gestures)
        .filter(([, active]) => active)
        .map(([name]) => name)
    : ["idle"];

  return (
    <main className="app-shell">
      <video ref={videoRef} className="source-video" playsInline muted />
      <canvas
        ref={outputCanvasRef}
        className="output-canvas"
        width={selectedPerformanceMode.width}
        height={selectedPerformanceMode.height}
        aria-hidden="true"
      />

      <section className="workspace">
        <header className="topbar">
          <div className="brand-lockup">
            <div className="brand-mark">
              <ScanFace size={22} />
            </div>
            <div>
              <p className="eyebrow brand-name">INFINIGHTCapture</p>
              <h1>Gesture Mocap Sender</h1>
            </div>
          </div>

          <div className="topbar-actions">
            <div className="status-pill" data-state={captureState}>
              {captureState === "loading" ? <Loader2 size={15} className="spin" /> : <BadgeCheck size={15} />}
              <span>{captureState === "running" ? "Tracking" : captureState}</span>
            </div>
            <button className="icon-button" aria-label="Settings">
              <Settings2 size={18} />
            </button>
            <button className="icon-button" aria-label="Fullscreen preview">
              <Maximize2 size={18} />
            </button>
          </div>
        </header>

        <nav className="workspace-tabs" aria-label="Workspace tabs">
          {workspaceTabs.map((tab) => {
            const TabIcon = workspaceTabIcons[tab.id];
            return (
              <button
                key={tab.id}
                className={activeWorkspace === tab.id ? "workspace-tab active" : "workspace-tab"}
                onClick={() => selectWorkspace(tab.id)}
                type="button"
              >
                <TabIcon size={15} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        <section
          className={activeWorkspace !== "signal" ? "stage-panel" : "stage-panel preview-stage-hidden"}
          aria-hidden={activeWorkspace === "signal"}
        >
          <div className="stage-toolbar">
            <div className="hud-badge">
              <span>{visualMode === "shader" ? "Scene" : "Authority"}</span>
              <strong>{visualMode === "shader" ? activeShaderScene.label : selectedOutput?.label ?? "Output"}</strong>
            </div>
            <div className="hud-badge align-right">
              <span>Mode</span>
              <strong>{visualMode === "shader" ? "Mocap Shader" : mode === "upper" ? "Upper Body" : "Full Body"}</strong>
            </div>
          </div>
          <canvas ref={canvasRef} className="preview-canvas" aria-label="INFINIGHTCapture composited preview" />
          <ViewerMotionHud
            motion={motion}
            scene={activeShaderScene}
            settings={shaderSettings}
            shaderValues={shaderValues}
            visualMode={visualMode}
          />
          {visualMode === "camera" && captureState !== "running" && (
            <EmptyState captureState={captureState} cameraIssue={cameraIssue} />
          )}
        </section>

        {activeWorkspace !== "signal" ? (
          <>
            <section className="transport-row" aria-label="Capture controls">
              <button className={mode === "upper" ? "mode-button active" : "mode-button"} onClick={() => setMode("upper")}>
                Head + Shoulders
              </button>
              <button className={mode === "full" ? "mode-button active" : "mode-button"} onClick={() => setMode("full")}>
                Full Body
              </button>
              {captureState === "running" ? (
                <button className="stop-button" onClick={stopCapture}>
                  <Pause size={17} />
                  Stop
                </button>
              ) : (
                <button className="start-button" onClick={startCapture} disabled={captureState === "loading"}>
                  {captureState === "loading" ? <Loader2 size={17} className="spin" /> : <Play size={17} />}
                  Start
                </button>
              )}
            </section>

            {error && (
              <div className="error-strip">
                <strong>{error}</strong>
                {cameraIssue === "blocked" && (
                  <ol>
                    <li>Reset camera permission for 127.0.0.1:5173 in the browser controls.</li>
                    <li>Reload INFINIGHTCapture, then press Start again.</li>
                    <li>For the desktop shell, allow camera access for Electron or INFINIGHTCapture in macOS settings.</li>
                  </ol>
                )}
              </div>
            )}

            <section className="telemetry-grid">
              <Metric icon={Activity} label="Confidence" value={`${Math.round((motion?.confidence ?? 0) * 100)}%`} />
              <Metric icon={Cpu} label="Latency" value={`${Math.round(latency)} ms`} />
              <Metric icon={RadioTower} label="Rate" value={`${fps} fps`} />
              <Metric icon={Hand} label="Hands" value={`${motion?.hands.length ?? 0}/2`} />
              <Metric icon={Expand} label="Landmarks" value={`${motion?.landmarkCount ?? 0}`} />
              <Metric icon={Fingerprint} label="Intent" value={motion?.dominantIntent ?? "Neutral stance"} />
            </section>

            {activeWorkspace === "mapping" && (
              <section className="mapping-workspace" aria-label="Motion parameter mapping">
                <div className="mapping-header">
                  <div>
                    <p className="eyebrow">Mocap Mapping</p>
                    <h2>{activeShaderScene.label}</h2>
                  </div>
                  <div className="mapping-summary">
                    <span>{activeShaderScene.parameters.length} parameters</span>
                    <strong>{activeShaderScene.imported ? "Imported" : "Built-in"}</strong>
                  </div>
                </div>
                <div className="mapping-signal-strip" aria-label="Live motion signals">
                  {shaderMotionSources
                    .filter((source) => source.id !== "manual")
                    .map((source) => (
                      <div className="mapping-signal" key={source.id}>
                        <span>{source.label}</span>
                        <strong>{getMotionSignalValue(source.id, motion).toFixed(2)}</strong>
                      </div>
                    ))}
                </div>
                <ShaderParameterMapper
                  motion={motion}
                  onUpdate={updateShaderSetting}
                  scene={activeShaderScene}
                  settings={shaderSettings}
                  shaderValues={shaderValues}
                />
              </section>
            )}
          </>
        ) : (
          <SignalGraph
            captureState={captureState}
            fps={fps}
            isOutputStreaming={isOutputStreaming}
            latency={latency}
            motion={motion}
            outputTarget={outputTarget}
            selectedOutputLabel={selectedOutput?.label ?? "Output"}
            selectedSystemOutput={selectedSystemOutput}
            systemStatus={systemStatus}
          />
        )}
      </section>

      <aside className="control-rail">
        <section className="rail-section">
          <div className="section-heading">
            <span>Output</span>
            <RadioTower size={16} />
          </div>
          <div className="output-switcher">
            {displayOutputStatuses.map((status) => (
              <button
                key={status.target}
                className={outputTarget === status.target ? "output-card active" : "output-card"}
                onClick={() => setOutputTarget(status.target)}
              >
                <strong>{status.label}</strong>
                <span>{status.detail}</span>
              </button>
            ))}
          </div>
          {isOutputStreaming ? (
            <button className="output-action stop" onClick={stopOutput}>
              <Pause size={16} />
              Stop Syphon Output
            </button>
          ) : (
            <button className="output-action" onClick={startOutput} disabled={!selectedOutput?.available}>
              <RadioTower size={16} />
              Start Syphon Output
            </button>
          )}
          <div className="output-composition-options" role="group" aria-label="Syphon output composition">
            {outputCompositionModes.map((compositionMode) => (
              <button
                key={compositionMode.id}
                className={
                  compositionMode.id === outputCompositionMode
                    ? "output-composition-option active"
                    : "output-composition-option"
                }
                onClick={() => setOutputCompositionMode(compositionMode.id)}
                type="button"
              >
                <strong>{compositionMode.label}</strong>
                <span>{compositionMode.detail}</span>
              </button>
            ))}
          </div>
          <div className="performance-control">
            <div className="performance-options" role="group" aria-label="Syphon speed">
              {outputPerformanceModes.map((performanceMode) => (
                <button
                  key={performanceMode.id}
                  className={performanceMode.id === outputPerformanceMode ? "performance-option active" : "performance-option"}
                  onClick={() => setOutputPerformanceMode(performanceMode.id)}
                  type="button"
                >
                  <strong>{performanceMode.label}</strong>
                  <span>
                    {performanceMode.width}x{performanceMode.height} / {performanceMode.fps}
                  </span>
                </button>
              ))}
            </div>
          </div>
          {outputError && <div className="output-error">{outputError}</div>}
        </section>

        <section className="rail-section">
          <div className="section-heading">
            <span>System Core</span>
            <MonitorCog size={16} />
          </div>
          <div className="system-stack">
            <SystemRow label="Runtime" value={systemStatus?.runtime === "electron" ? "Electron shell" : "Browser preview"} />
            <SystemRow label="Platform" value={systemStatus?.platform ?? "Detecting"} />
            <SystemRow label="Camera" value={systemStatus?.cameraAccess ?? "unknown"} />
            <SystemRow
              label="Native bridge"
              value={systemStatus?.nativeBridge.available ? `v${systemStatus.nativeBridge.version ?? 1}` : "Unavailable"}
            />
            <SystemRow label={`${selectedOutput?.label ?? "Output"} sender`} value={selectedSystemOutput?.state ?? "pending"} />
          </div>
        </section>

        <section className="rail-section">
          <div className="section-heading">
            <span>Shader Player</span>
            <SlidersHorizontal size={16} />
          </div>
          <div className="shader-scene-list">
            {shaderLibrary.map((scene) => (
              <div className="shader-scene-row" key={scene.id}>
                <button
                  className={activeShaderScene.id === scene.id ? "shader-scene-button active" : "shader-scene-button"}
                  onClick={() => {
                    setShaderSceneId(scene.id);
                    setVisualMode("shader");
                    setActiveWorkspace(activeWorkspace === "mapping" ? "mapping" : "shader");
                  }}
                  type="button"
                >
                  <strong>{scene.label}</strong>
                  <span>{scene.imported ? scene.license || scene.author || scene.detail : scene.detail}</span>
                </button>
                {scene.imported && (
                  <button
                    className="shader-delete-button"
                    onClick={() => deleteShaderScene(scene.id)}
                    type="button"
                    aria-label={`Delete ${scene.label}`}
                    title="Delete shader"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="shader-importer">
            <div className="api-credit">
              <Link2 size={14} />
              <span>Uses Shadertoy.com API</span>
            </div>
            <button
              className={shaderFileDragActive ? "shader-drop-zone active" : "shader-drop-zone"}
              onClick={() => shaderFileInputRef.current?.click()}
              onDragEnter={(event) => {
                event.preventDefault();
                setShaderFileDragActive(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                setShaderFileDragActive(false);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setShaderFileDragActive(true);
              }}
              onDrop={(event) => {
                event.preventDefault();
                importShaderFiles(event.dataTransfer.files);
              }}
              type="button"
            >
              <FileUp size={18} />
              <strong>Drop Shader Or Preset</strong>
              <span>.frag, .glsl, .infinightcaptureshader</span>
            </button>
            <input
              ref={shaderFileInputRef}
              accept=".infinightcaptureshader,.facevizshader,.frag,.fs,.glsl,.json,.txt,application/json,text/plain"
              className="shader-file-input"
              onChange={(event) => {
                if (event.target.files) {
                  importShaderFiles(event.target.files);
                }
                event.target.value = "";
              }}
              type="file"
              multiple
            />
            <label className="shader-link-control">
              <span>Shader URL</span>
              <input
                value={shaderImportLink}
                onChange={(event) => setShaderImportLink(event.target.value)}
                placeholder="Shadertoy, GitHub, Gist, or raw GLSL URL"
              />
            </label>
            <button
              className="shader-import-button"
              onClick={importShaderLink}
              type="button"
              disabled={shaderImportBusy || !shaderImportLink.trim()}
            >
              {shaderImportBusy ? <Loader2 size={16} className="spin" /> : <Link2 size={16} />}
              Add From URL
            </button>
            <button className="shader-import-button secondary" onClick={exportActiveShaderPreset} type="button">
              <Download size={16} />
              Export Active Preset
            </button>
            <button
              className="shader-advanced-toggle"
              onClick={() => setShowShaderCodeImport((current) => !current)}
              type="button"
            >
              <ChevronsUpDown size={15} />
              <span>Advanced</span>
            </button>
            {showShaderCodeImport && (
              <div className="shader-code-import-panel">
                <div className="shader-import-grid">
                  <label>
                    <span>Name</span>
                    <input value={shaderImportName} onChange={(event) => setShaderImportName(event.target.value)} />
                  </label>
                  <label>
                    <span>Author</span>
                    <input value={shaderImportAuthor} onChange={(event) => setShaderImportAuthor(event.target.value)} />
                  </label>
                </div>
                <label className="shader-import-license">
                  <span>License</span>
                  <input value={shaderImportLicense} onChange={(event) => setShaderImportLicense(event.target.value)} />
                </label>
                <label className="shader-source-control">
                  <span>mainImage</span>
                  <textarea
                    spellCheck={false}
                    value={shaderImportSource}
                    onChange={(event) => setShaderImportSource(event.target.value)}
                  />
                </label>
                <button className="shader-import-button" onClick={importShaderScene} type="button">
                  <Code2 size={16} />
                  Add From Code
                </button>
              </div>
            )}
            {shaderImportError && <div className="shader-import-error">{shaderImportError}</div>}
            {shaderImportNotice && <div className="shader-import-notice">{shaderImportNotice}</div>}
          </div>
          <ShaderParameterMapper
            compact
            motion={motion}
            onUpdate={updateShaderSetting}
            scene={activeShaderScene}
            settings={shaderSettings}
            shaderValues={shaderValues}
          />
        </section>

        <section className="rail-section">
          <div className="section-heading">
            <span>Camera Effects</span>
            <Sparkles size={16} />
          </div>
          <div className="effect-list">
            {effects.map((effect) => {
              const Icon = effect.icon;
              return (
                <button
                  key={effect.id}
                  className={selectedEffect === effect.id ? "effect-button active" : "effect-button"}
                  onClick={() => {
                    setSelectedEffect(effect.id);
                    setVisualMode("camera");
                    setActiveWorkspace("preview");
                  }}
                  title={effect.label}
                >
                  <Icon size={17} />
                  <span>{effect.label}</span>
                </button>
              );
            })}
          </div>
          <label className="range-control">
            <span>Amount</span>
            <input
              type="range"
              min="0"
              max="1.4"
              step="0.01"
              value={effectAmount}
              onChange={(event) => setEffectAmount(Number(event.target.value))}
            />
          </label>
        </section>

        <section className="rail-section">
          <div className="section-heading">
            <span>Tracking</span>
            <ScanFace size={16} />
          </div>
          <label className="toggle-row">
            <span>Preview wireframe</span>
            <input type="checkbox" checked={showRig} onChange={(event) => setShowRig(event.target.checked)} />
          </label>
          <div className="gesture-stack">
            {activeGestures.map((gesture) => (
              <span key={gesture} className="gesture-token">
                {gesture}
              </span>
            ))}
          </div>
        </section>
      </aside>
    </main>
  );
}

type SignalGraphProps = {
  captureState: CaptureState;
  fps: number;
  isOutputStreaming: boolean;
  latency: number;
  motion: MotionFrame | null;
  outputTarget: OutputTarget;
  selectedOutputLabel: string;
  selectedSystemOutput: SystemStatus["outputs"][number] | undefined;
  systemStatus: SystemStatus | null;
};

function SignalGraph({
  captureState,
  fps,
  isOutputStreaming,
  latency,
  motion,
  outputTarget,
  selectedOutputLabel,
  selectedSystemOutput,
  systemStatus
}: SignalGraphProps) {
  const graphRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    nodeId: SignalNodeId;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const [nodePositions, setNodePositions] = useState(defaultSignalNodePositions);
  const syphon = systemStatus?.syphon;
  const outputConsumers = syphon?.outputConsumers ?? [];
  const inputSources = syphon?.inputSources ?? [];
  const primaryConsumer = outputConsumers[0];
  const consumerStatus = primaryConsumer?.status ?? (syphon?.hasOutputClients ? "connected" : "inactive");
  const consumerLabel = primaryConsumer?.appName ?? (syphon?.hasOutputClients ? "Syphon Client" : "Resolume / VJ App");
  const consumerDetail =
    primaryConsumer?.detail ??
    (isOutputStreaming ? "INFINIGHTCapture Output is visible on the Syphon bus." : "Waiting for INFINIGHTCapture Output.");
  const outputState = selectedSystemOutput?.state ?? (isOutputStreaming ? "publishing" : "bridge-ready");
  const outputName = syphon?.outputName ?? "INFINIGHTCapture Output";
  const inputName = syphon?.inputName ?? "INFINIGHTCapture Input";
  const signalTokens = [
    `${Math.round((motion?.confidence ?? 0) * 100)}% confidence`,
    `${motion?.hands.length ?? 0}/2 hands`,
    `${motion?.landmarkCount ?? 0} landmarks`,
    `${Math.round(latency)} ms`
  ];
  const wires = [
    { id: "camera-tracker", from: "camera" as const, to: "tracker" as const, className: "live" },
    { id: "tracker-core", from: "tracker" as const, to: "core" as const, className: "live" },
    { id: "core-output", from: "core" as const, to: "output" as const, className: "live" },
    {
      id: "output-consumer",
      from: "output" as const,
      to: "consumer" as const,
      className: consumerStatus === "connected" ? "live" : "pending"
    },
    { id: "input-core", from: "input" as const, to: "core" as const, className: "input" }
  ];

  const moveNode = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    const graph = graphRef.current;
    if (!drag || !graph) return;

    const rect = graph.getBoundingClientRect();
    const nextX = ((event.clientX - rect.left - drag.offsetX) / rect.width) * 100;
    const nextY = ((event.clientY - rect.top - drag.offsetY) / rect.height) * 100;
    const dimensions = signalNodeDimensions[drag.nodeId];
    const maxX = Math.max(0, 100 - (dimensions.width / 1000) * 100);
    const maxY = Math.max(0, 100 - (dimensions.height / 520) * 100);

    setNodePositions((current) => ({
      ...current,
      [drag.nodeId]: {
        x: clamp(nextX, 0, maxX),
        y: clamp(nextY, 0, maxY)
      }
    }));
  }, []);

  const startNodeDrag = useCallback((nodeId: SignalNodeId, event: ReactPointerEvent<HTMLElement>) => {
    const graph = graphRef.current;
    if (!graph) return;

    const graphRect = graph.getBoundingClientRect();
    const position = nodePositions[nodeId];
    const nodeLeft = graphRect.left + graphRect.width * (position.x / 100);
    const nodeTop = graphRect.top + graphRect.height * (position.y / 100);

    dragRef.current = {
      nodeId,
      offsetX: event.clientX - nodeLeft,
      offsetY: event.clientY - nodeTop
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [nodePositions]);

  const stopNodeDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  return (
    <section className="signal-workspace" aria-label="Syphon signal graph">
      <div className="signal-graph" ref={graphRef}>
        <svg className="signal-wires" viewBox="0 0 1000 520" role="presentation" aria-hidden="true">
          <defs>
            <marker id="signal-arrow" markerHeight="8" markerWidth="8" orient="auto" refX="7" refY="4">
              <path d="M0,0 L8,4 L0,8 Z" className="signal-arrow" />
            </marker>
          </defs>
          {wires.map((wire) => (
            <path
              key={wire.id}
              className={`signal-wire ${wire.className}`}
              d={signalWirePath(nodePositions, wire.from, wire.to)}
              markerEnd="url(#signal-arrow)"
            />
          ))}
        </svg>

        <SignalNode
          className="node-camera"
          id="camera"
          detail={`${fps} fps`}
          eyebrow="Source"
          label="Webcam"
          onPointerDown={startNodeDrag}
          onPointerMove={moveNode}
          onPointerUp={stopNodeDrag}
          position={nodePositions.camera}
          status={captureState === "running" ? "live" : captureState}
          value={captureState === "running" ? "Video" : "Idle"}
        />
        <SignalNode
          className="node-tracker"
          id="tracker"
          detail={`${motion?.landmarkCount ?? 0} landmarks`}
          eyebrow="Analyze"
          label="MediaPipe"
          onPointerDown={startNodeDrag}
          onPointerMove={moveNode}
          onPointerUp={stopNodeDrag}
          position={nodePositions.tracker}
          status={motion ? "tracking" : "standby"}
          value={motion ? "Pose + Hands" : "No frame"}
        />
        <SignalNode
          className="node-core"
          id="core"
          detail={signalTokens.join("  /  ")}
          eyebrow="INFINIGHTCapture"
          label="Gesture Core"
          onPointerDown={startNodeDrag}
          onPointerMove={moveNode}
          onPointerUp={stopNodeDrag}
          position={nodePositions.core}
          status={motion?.dominantIntent ?? "Neutral stance"}
          value={motion?.dominantIntent ?? "Neutral stance"}
        />
        <SignalNode
          className="node-output"
          id="output"
          detail={selectedSystemOutput?.detail ?? syphon?.detail ?? "Output bridge pending"}
          eyebrow={selectedOutputLabel}
          label={outputName}
          onPointerDown={startNodeDrag}
          onPointerMove={moveNode}
          onPointerUp={stopNodeDrag}
          position={nodePositions.output}
          status={outputState}
          value={outputTarget === "syphon" ? "Syphon Output" : "Spout Output"}
        />
        <SignalNode
          className="node-consumer"
          id="consumer"
          detail={consumerDetail}
          eyebrow="Consumer"
          label={consumerLabel}
          onPointerDown={startNodeDrag}
          onPointerMove={moveNode}
          onPointerUp={stopNodeDrag}
          position={nodePositions.consumer}
          status={consumerStatus}
          value={primaryConsumer?.source === "inferred" ? "Inferred link" : consumerStatus === "connected" ? "Connected" : "Watching"}
        />
        <SignalNode
          className="node-input"
          id="input"
          detail={inputSources[0]?.detail ?? "Receiver path is reserved in the graph."}
          eyebrow="Input"
          label={inputSources[0]?.serverName ?? inputName}
          onPointerDown={startNodeDrag}
          onPointerMove={moveNode}
          onPointerUp={stopNodeDrag}
          position={nodePositions.input}
          status={inputSources[0]?.status ?? "inactive"}
          value={inputSources[0]?.appName ?? "Syphon Input"}
        />
      </div>

      <div className="signal-inspector">
        <GraphStatusRow label="Output name" value={outputName} />
        <GraphStatusRow label="Client link" value={syphon?.hasOutputClients ? "attached" : "none"} />
        <GraphStatusRow label="Consumer" value={formatPeerList(outputConsumers)} />
        <GraphStatusRow label="Input source" value={formatPeerList(inputSources)} />
      </div>
    </section>
  );
}

type ShaderParameterMapperProps = {
  compact?: boolean;
  motion: MotionFrame | null;
  onUpdate: (parameterId: string, patch: Partial<ShaderParameterSettings>) => void;
  scene: ShaderScene;
  settings: Record<string, ShaderParameterSettings>;
  shaderValues: number[];
};

function ShaderParameterMapper({
  compact = false,
  motion,
  onUpdate,
  scene,
  settings,
  shaderValues
}: ShaderParameterMapperProps) {
  return (
    <div className={compact ? "shader-param-stack" : "mapping-param-grid"}>
      {scene.parameters.map((parameter, index) => {
        const setting = settings[parameter.id] ?? {
          value: parameter.defaultValue,
          source: parameter.motionDefault,
          depth: 0
        };
        const signalValue = getMotionSignalValue(setting.source, motion);

        return (
          <div className={compact ? "shader-param" : "shader-param mapping-param"} key={parameter.id}>
            <div className="shader-param-header">
              <span>{parameter.label}</span>
              <strong>{shaderValues[index].toFixed(2)}</strong>
            </div>
            <label className="mapping-base">
              <span>Base</span>
              <input
                type="range"
                min={parameter.min}
                max={parameter.max}
                step="0.01"
                value={setting.value}
                onChange={(event) => onUpdate(parameter.id, { value: Number(event.target.value) })}
                aria-label={`${parameter.label} base value`}
              />
            </label>
            <div className="shader-map-row">
              <select
                value={setting.source}
                onChange={(event) => onUpdate(parameter.id, { source: event.target.value as ShaderParameterSettings["source"] })}
                aria-label={`${parameter.label} motion source`}
              >
                {shaderMotionSources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.label}
                  </option>
                ))}
              </select>
              <span>{signalValue.toFixed(2)}</span>
            </div>
            <label className="shader-depth">
              <span>Depth</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={setting.depth}
                onChange={(event) => onUpdate(parameter.id, { depth: Number(event.target.value) })}
              />
            </label>
          </div>
        );
      })}
    </div>
  );
}

type ViewerMotionHudProps = {
  motion: MotionFrame | null;
  scene: ShaderScene;
  settings: Record<string, ShaderParameterSettings>;
  shaderValues: number[];
  visualMode: VisualMode;
};

const isSignalActive = (source: ShaderParameterSettings["source"], value: number) => {
  switch (source) {
    case "pinch":
      return value > 0.58;
    case "velocity":
      return value > 0.34;
    case "handOpen":
    case "openPalm":
    case "confidence":
      return value > 0.5;
    case "handsUp":
    case "faceCover":
      return value > 0.5;
    case "noseX":
    case "noseY":
      return Math.abs(value - 0.5) > 0.18;
    case "manual":
    default:
      return false;
  }
};

function ViewerMotionHud({ motion, scene, settings, shaderValues, visualMode }: ViewerMotionHudProps) {
  const signalRows = shaderMotionSources.filter((source) => source.id !== "manual");
  const parameterRows = scene.parameters.map((parameter, index) => {
    const setting = settings[parameter.id] ?? {
      value: parameter.defaultValue,
      source: parameter.motionDefault,
      depth: 0
    };
    const source = shaderMotionSources.find((motionSource) => motionSource.id === setting.source);
    const signalValue = getMotionSignalValue(setting.source, motion);

    return {
      id: parameter.id,
      label: parameter.label,
      sourceLabel: source?.label ?? "Manual",
      signalValue,
      value: shaderValues[index] ?? parameter.defaultValue
    };
  });

  return (
    <div className={visualMode === "shader" ? "viewer-motion-hud shader" : "viewer-motion-hud"} aria-label="Live mocap parameters">
      <div className="viewer-signal-row">
        {signalRows.map((source) => {
          const value = getMotionSignalValue(source.id, motion);
          return (
            <div className={isSignalActive(source.id, value) ? "viewer-signal active" : "viewer-signal"} key={source.id}>
              <span>{source.label}</span>
              <strong>{isSignalActive(source.id, value) ? "active" : value.toFixed(2)}</strong>
              <i style={{ transform: `scaleX(${Math.max(0.02, value)})` }} />
            </div>
          );
        })}
      </div>
      <div className="viewer-param-row">
        {parameterRows.map((parameter) => (
          <div className={parameter.signalValue > 0.5 ? "viewer-param active" : "viewer-param"} key={parameter.id}>
            <span>{parameter.label}</span>
            <strong>{parameter.value.toFixed(2)}</strong>
            <small>{parameter.sourceLabel}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

type SignalNodeProps = {
  className: string;
  detail: string;
  eyebrow: string;
  id: SignalNodeId;
  label: string;
  onPointerDown: (nodeId: SignalNodeId, event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  position: SignalNodePosition;
  status: string;
  value: string;
};

function SignalNode({
  className,
  detail,
  eyebrow,
  id,
  label,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  position,
  status,
  value
}: SignalNodeProps) {
  return (
    <article
      className={`signal-node ${className}`}
      onPointerCancel={onPointerUp}
      onPointerDown={(event) => onPointerDown(id, event)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{ left: `${position.x}%`, top: `${position.y}%` }}
    >
      <div className="signal-node-header">
        <span>{eyebrow}</span>
        <i>{status}</i>
      </div>
      <strong>{label}</strong>
      <p>{value}</p>
      <small>{detail}</small>
    </article>
  );
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const signalNodeAnchor = (
  positions: Record<SignalNodeId, SignalNodePosition>,
  nodeId: SignalNodeId,
  side: "left" | "right"
) => {
  const position = positions[nodeId];
  const dimensions = signalNodeDimensions[nodeId];
  const x = position.x * 10 + (side === "right" ? dimensions.width : 0);
  const y = position.y * 5.2 + dimensions.height / 2;
  return { x, y };
};

const signalWirePath = (
  positions: Record<SignalNodeId, SignalNodePosition>,
  from: SignalNodeId,
  to: SignalNodeId
) => {
  const start = signalNodeAnchor(positions, from, "right");
  const end = signalNodeAnchor(positions, to, "left");
  const distance = Math.max(80, Math.abs(end.x - start.x) * 0.48);
  const direction = end.x >= start.x ? 1 : -1;
  const controlStartX = start.x + distance * direction;
  const controlEndX = end.x - distance * direction;
  return `M${start.x} ${start.y} C${controlStartX} ${start.y} ${controlEndX} ${end.y} ${end.x} ${end.y}`;
};

function GraphStatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="graph-status-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatPeerList(peers: SystemSyphonPeer[]) {
  if (peers.length === 0) return "none";
  return peers.map((peer) => `${peer.appName}${peer.source === "inferred" ? " inferred" : ""}`).join(", ");
}

function EmptyState({ captureState, cameraIssue }: { captureState: CaptureState; cameraIssue: CameraIssue }) {
  if (cameraIssue === "blocked") {
    return (
      <div className="empty-state">
        <ShieldAlert size={36} />
        <strong>Camera permission blocked</strong>
        <span>Reset this site&apos;s camera permission, then start capture again.</span>
      </div>
    );
  }

  return (
    <div className="empty-state">
      <Camera size={36} />
      <strong>{captureState === "loading" ? "Opening camera" : "Camera standing by"}</strong>
      <span>{captureState === "loading" ? "Waiting for the webcam stream" : "Start capture to activate landmarks and effects"}</span>
    </div>
  );
}

type MetricProps = {
  icon: typeof Activity;
  label: string;
  value: string;
};

function Metric({ icon: Icon, label, value }: MetricProps) {
  return (
    <div className="metric-card">
      <Icon size={16} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SystemRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="system-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
