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
  ChevronDown,
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
import type { CSSProperties, ReactNode } from "react";
import { getOutputStatuses, getPreferredOutput, type OutputTarget } from "./output/outputTargets";
import {
  renderFrame,
  type CompositorOptions,
  type TrackingPreviewMode,
  type VisualDrumPadOverlayPad
} from "./rendering/compositor";
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
import {
  analyzeMotion,
  buildTrackedFace,
  buildTrackedHand,
  buildTrackedPose,
  defaultFaceGestureCalibration
} from "./tracking/gestureEngine";
import {
  createGestureStateMachineMemory,
  defaultGestureStateMachineConfig,
  gestureControlIds,
  updateGestureStateMachine,
  type GestureStateMachineMemory
} from "./tracking/gestureStateMachine";
import type {
  FaceGestureCalibration,
  GestureControlId,
  GestureControlState,
  GestureStateMachineConfig,
  Handedness,
  Landmark,
  MotionFrame,
  PreviousHandSample
} from "./tracking/types";

type CaptureState = "idle" | "loading" | "running" | "error";
type CameraIssue = "blocked" | "missing" | "browser" | null;
type WorkspaceTab = "preview" | "shader" | "mapping" | "signal";
type VisualMode = "camera" | "shader";
type OutputCompositionMode = "shader" | "shaderWire" | "shaderWireCamera";
type OutputPerformanceMode = "max" | "turbo" | "live" | "sharp";
type RailSectionId = "output" | "system" | "shader" | "effects" | "face" | "tracking";
type GestureActionTrigger = "started" | "held" | "released" | "repeated" | "latched";
type GestureActionType = "shaderParameter" | "effect" | "outputMode" | "keyboard" | "midi" | "osc";
type GestureActionCurve = "linear" | "easeIn" | "easeOut" | "snap";
type GestureActionRoute = {
  id: string;
  enabled: boolean;
  gestureId: GestureControlId;
  trigger: GestureActionTrigger;
  actionType: GestureActionType;
  shaderParameterId: string;
  effectId: string;
  outputMode: OutputCompositionMode;
  min: number;
  max: number;
  invert: boolean;
  curve: GestureActionCurve;
  holdMs: number;
};
type GestureActionMatrixPreset = {
  schema: typeof GESTURE_ACTION_MATRIX_PRESET_SCHEMA;
  name: string;
  routes: GestureActionRoute[];
};
type VisualDrumPadMapping = {
  id: string;
  label: string;
  enabled: boolean;
  parameterId: string;
  value: number;
  velocityThreshold: number;
};
type VisualDrumPadRuntime = {
  cooldownUntil: number;
  intensity: number;
  lastHitAt: number;
};
type VisualDrumPadStrikeSample = {
  point: {
    x: number;
    y: number;
  };
  timestamp: number;
};
type SignalNodeId = "camera" | "tracker" | "core" | "output" | "consumer" | "input";
type SignalNodePosition = {
  x: number;
  y: number;
};
type SignalGraphSize = {
  width: number;
  height: number;
};
type WorkspaceLayout = {
  railWidth: number;
  stageHeight: number;
};
type WorkspaceResizeTarget = "rail" | "stage";
type WorkspaceResizeDrag = {
  target: WorkspaceResizeTarget;
  startX: number;
  startY: number;
  startRailWidth: number;
  startStageHeight: number;
  shellWidth: number;
  workspaceHeight: number;
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

const trackingPreviewModes: Array<{ id: TrackingPreviewMode; label: string; hudLabel: string; icon: typeof Activity }> = [
  { id: "upper", label: "Head + Shoulders", hudLabel: "Upper Body", icon: ScanFace },
  { id: "full", label: "Full Body", hudLabel: "Full Body", icon: Expand },
  { id: "face", label: "Face Gestures", hudLabel: "Face Gestures", icon: Smile },
  { id: "handsFace", label: "Hands + Face", hudLabel: "Hands + Face", icon: Hand }
];

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

const signalNodeIds: SignalNodeId[] = ["camera", "tracker", "core", "output", "consumer", "input"];

const signalGraphViewBox: SignalGraphSize = {
  width: 1000,
  height: 520
};

const signalNodeDimensions: Record<SignalNodeId, { width: number; height: number }> = {
  camera: { width: 190, height: 116 },
  tracker: { width: 190, height: 116 },
  core: { width: 210, height: 116 },
  output: { width: 190, height: 116 },
  consumer: { width: 190, height: 116 },
  input: { width: 190, height: 116 }
};

const gestureLabels: Record<keyof MotionFrame["gestures"], string> = {
  handsUp: "Hands up",
  faceCover: "Face cover",
  pinch: "Pinch",
  openPalm: "Open palm",
  fastMotion: "Fast motion",
  mouthOpen: "Mouth open",
  smile: "Smile",
  frown: "Frown",
  eyesClosed: "Eyes closed",
  earPull: "Ear pull",
  chinPull: "Chin lift",
  neutral: "Neutral"
};

const FACE_GESTURE_CALIBRATION_STORAGE_KEY = "faceviz.faceGestureCalibration.v1";
const GESTURE_STATE_MACHINE_STORAGE_KEY = "faceviz.gestureStateMachine.v1";
const GESTURE_ACTION_MATRIX_STORAGE_KEY = "faceviz.gestureActionMatrix.v1";
const VISUAL_DRUM_PAD_STORAGE_KEY = "faceviz.visualDrumPads.v1";
const WORKSPACE_LAYOUT_STORAGE_KEY = "faceviz.workspaceLayout.v1";
const GESTURE_ACTION_MATRIX_PRESET_SCHEMA = "faceviz.gestureActionMatrix.v1";
const defaultWorkspaceLayout: WorkspaceLayout = {
  railWidth: 310,
  stageHeight: 420
};

const VISUAL_DRUM_PAD_COUNT = 6;
const VISUAL_DRUM_PAD_COOLDOWN_MS = 180;
const VISUAL_DRUM_PAD_TIP_INDICES = [8, 12, 16, 20];
const visualDrumPadLayout: Array<Pick<VisualDrumPadOverlayPad, "height" | "width" | "x" | "y">> = Array.from(
  { length: VISUAL_DRUM_PAD_COUNT },
  (_, index) => {
    const padsPerBank = VISUAL_DRUM_PAD_COUNT / 2;
    const isRightBank = index >= padsPerBank;
    const row = index % padsPerBank;
    const width = 0.145;
    const height = 0.11;
    const gap = 0.036;
    const top = 0.28;
    return {
      x: isRightBank ? 0.88 - width : 0.12,
      y: top + row * (height + gap),
      width,
      height
    };
  }
);

const createDefaultVisualDrumPads = (): VisualDrumPadMapping[] =>
  Array.from({ length: VISUAL_DRUM_PAD_COUNT }, (_, index) => ({
    id: `pad-${index + 1}`,
    label: `Pad ${index + 1}`,
    enabled: true,
    parameterId: "",
    value: index % 3 === 0 ? 1 : 0.3 + ((index % 3) / 2) * 0.48,
    velocityThreshold: 0.26
  }));

const faceSignalControls: Array<{
  id: keyof Pick<
    FaceGestureCalibration,
    "mouthOpenThreshold" | "smileThreshold" | "frownThreshold" | "eyesClosedThreshold"
  >;
  label: string;
  signal: "mouthOpenness" | "smile" | "frown" | "eyeClosure";
  min: number;
  max: number;
  neutralMargin: number;
}> = [
  { id: "mouthOpenThreshold", label: "Mouth Open", signal: "mouthOpenness", min: 0.08, max: 0.95, neutralMargin: 0.14 },
  { id: "smileThreshold", label: "Smile", signal: "smile", min: 0.08, max: 0.95, neutralMargin: 0.12 },
  { id: "frownThreshold", label: "Frown", signal: "frown", min: 0.08, max: 0.95, neutralMargin: 0.12 },
  { id: "eyesClosedThreshold", label: "Eyes Closed", signal: "eyeClosure", min: 0.12, max: 0.96, neutralMargin: 0.18 }
];

const faceTouchControls: Array<{
  id: keyof Pick<FaceGestureCalibration, "earPullRadius" | "earPullPinchThreshold" | "chinPullRadius" | "chinPullLiftThreshold">;
  label: string;
  min: number;
  max: number;
  step: number;
}> = [
  { id: "earPullRadius", label: "Ear Reach", min: 0.16, max: 0.5, step: 0.01 },
  { id: "earPullPinchThreshold", label: "Ear Grip", min: 0.1, max: 0.8, step: 0.01 },
  { id: "chinPullRadius", label: "Chin Reach", min: 0.14, max: 0.42, step: 0.01 },
  { id: "chinPullLiftThreshold", label: "Chin Lift Speed", min: 0.04, max: 0.36, step: 0.01 }
];

const gestureMachineControls: Array<{
  id: keyof Omit<GestureStateMachineConfig, "latchGestures">;
  label: string;
  min: number;
  max: number;
  step: number;
  suffix: string;
}> = [
  { id: "debounceMs", label: "Debounce", min: 0, max: 420, step: 10, suffix: "ms" },
  { id: "releaseDebounceMs", label: "Release", min: 0, max: 520, step: 10, suffix: "ms" },
  { id: "holdMs", label: "Hold", min: 0, max: 1600, step: 20, suffix: "ms" },
  { id: "cooldownMs", label: "Cooldown", min: 0, max: 1600, step: 20, suffix: "ms" },
  { id: "repeatMs", label: "Repeat", min: 0, max: 3200, step: 50, suffix: "ms" },
  { id: "smoothing", label: "Smoothing", min: 0, max: 0.95, step: 0.01, suffix: "" }
];

const gestureActionTriggers: Array<{ id: GestureActionTrigger; label: string }> = [
  { id: "started", label: "Started" },
  { id: "held", label: "Held" },
  { id: "released", label: "Released" },
  { id: "repeated", label: "Repeat" },
  { id: "latched", label: "Latched" }
];

const gestureActionTypes: Array<{ id: GestureActionType; label: string }> = [
  { id: "shaderParameter", label: "Shader Parameter" },
  { id: "effect", label: "Effect" },
  { id: "outputMode", label: "Output Mode" },
  { id: "keyboard", label: "Keyboard" },
  { id: "midi", label: "MIDI" },
  { id: "osc", label: "OSC" }
];

const gestureActionCurves: Array<{ id: GestureActionCurve; label: string }> = [
  { id: "linear", label: "Linear" },
  { id: "easeIn", label: "Ease In" },
  { id: "easeOut", label: "Ease Out" },
  { id: "snap", label: "Snap" }
];

const createGestureActionRoute = (
  id: string,
  gestureId: GestureControlId,
  trigger: GestureActionTrigger,
  actionType: GestureActionType
): GestureActionRoute => ({
  id,
  enabled: true,
  gestureId,
  trigger,
  actionType,
  shaderParameterId: "",
  effectId: "auto",
  outputMode: "shaderWire",
  min: 0,
  max: 1,
  invert: false,
  curve: "linear",
  holdMs: 0
});

const createDefaultGestureActionMatrix = (): GestureActionRoute[] => [
  {
    ...createGestureActionRoute("smile-bloom", "smile", "started", "shaderParameter"),
    shaderParameterId: "bloom",
    min: 0.72,
    max: 1
  },
  {
    ...createGestureActionRoute("mouth-open-effect", "mouthOpen", "started", "effect"),
    effectId: "bloom"
  },
  {
    ...createGestureActionRoute("eyes-closed-output", "eyesClosed", "started", "outputMode"),
    outputMode: "shader"
  }
];

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
    throw new Error("That Shadertoy uses multipass, sound, VR, or buffer passes that this app cannot run yet.");
  }

  const pass =
    shader?.renderpass?.find((renderPass) => renderPass.type === "image" && renderPass.code?.includes("mainImage")) ??
    shader?.renderpass?.find((renderPass) => renderPass.code?.includes("mainImage"));

  if (!pass?.code) {
    throw new Error("No image pass with mainImage was found in that Shadertoy.");
  }
  if (pass.inputs?.length) {
    const inputTypes = Array.from(new Set(pass.inputs.map((input) => input.ctype ?? "asset"))).join(", ");
    throw new Error(`That Shadertoy uses ${inputTypes} inputs. URL import currently supports single-pass procedural shaders.`);
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

const clampNumber = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const stripVisibleAppName = (value: string) => value.replace(/\bINFINIGHTCapture\s*/g, "").trim();

const normalizeFaceGestureCalibration = (value: unknown): FaceGestureCalibration => {
  if (!isRecord(value)) {
    return defaultFaceGestureCalibration;
  }

  const next = { ...defaultFaceGestureCalibration };
  for (const key of Object.keys(defaultFaceGestureCalibration) as Array<keyof FaceGestureCalibration>) {
    const rawValue = value[key];
    if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      next[key] = clampNumber(rawValue);
    }
  }

  return next;
};

const normalizeGestureStateMachineConfig = (value: unknown): GestureStateMachineConfig => {
  if (!isRecord(value)) {
    return defaultGestureStateMachineConfig;
  }

  const next = { ...defaultGestureStateMachineConfig };
  for (const control of gestureMachineControls) {
    const rawValue = value[control.id];
    if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      next[control.id] = clampNumber(rawValue, control.min, control.max);
    }
  }

  const latchGestures = isRecord(value.latchGestures) ? value.latchGestures : {};
  next.latchGestures = { ...defaultGestureStateMachineConfig.latchGestures };
  for (const id of gestureControlIds) {
    const rawLatch = latchGestures[id];
    if (typeof rawLatch === "boolean") {
      next.latchGestures[id] = rawLatch;
    }
  }

  return next;
};

const gestureActionTriggerIds = new Set<GestureActionTrigger>(gestureActionTriggers.map((trigger) => trigger.id));
const gestureActionTypeIds = new Set<GestureActionType>(gestureActionTypes.map((type) => type.id));
const gestureActionCurveIds = new Set<GestureActionCurve>(gestureActionCurves.map((curve) => curve.id));
const gestureControlIdSet = new Set<GestureControlId>(gestureControlIds);
const outputCompositionModeIds = new Set<OutputCompositionMode>(outputCompositionModes.map((mode) => mode.id));

const normalizeGestureActionRoute = (value: unknown, fallback: GestureActionRoute): GestureActionRoute => {
  if (!isRecord(value)) return fallback;

  const gestureId = typeof value.gestureId === "string" && gestureControlIdSet.has(value.gestureId as GestureControlId)
    ? value.gestureId as GestureControlId
    : fallback.gestureId;
  const trigger = typeof value.trigger === "string" && gestureActionTriggerIds.has(value.trigger as GestureActionTrigger)
    ? value.trigger as GestureActionTrigger
    : fallback.trigger;
  const actionType = typeof value.actionType === "string" && gestureActionTypeIds.has(value.actionType as GestureActionType)
    ? value.actionType as GestureActionType
    : fallback.actionType;
  const curve = typeof value.curve === "string" && gestureActionCurveIds.has(value.curve as GestureActionCurve)
    ? value.curve as GestureActionCurve
    : fallback.curve;
  const outputMode = typeof value.outputMode === "string" && outputCompositionModeIds.has(value.outputMode as OutputCompositionMode)
    ? value.outputMode as OutputCompositionMode
    : fallback.outputMode;

  return {
    id: typeof value.id === "string" && value.id.trim() ? value.id.trim() : fallback.id,
    enabled: typeof value.enabled === "boolean" ? value.enabled : fallback.enabled,
    gestureId,
    trigger,
    actionType,
    shaderParameterId: typeof value.shaderParameterId === "string" ? value.shaderParameterId : fallback.shaderParameterId,
    effectId: typeof value.effectId === "string" ? value.effectId : fallback.effectId,
    outputMode,
    min: typeof value.min === "number" && Number.isFinite(value.min) ? clampNumber(value.min) : fallback.min,
    max: typeof value.max === "number" && Number.isFinite(value.max) ? clampNumber(value.max) : fallback.max,
    invert: typeof value.invert === "boolean" ? value.invert : fallback.invert,
    curve,
    holdMs: typeof value.holdMs === "number" && Number.isFinite(value.holdMs) ? clampNumber(value.holdMs, 0, 5000) : fallback.holdMs
  };
};

const normalizeGestureActionMatrix = (value: unknown): GestureActionRoute[] => {
  const defaults = createDefaultGestureActionMatrix();
  const routes = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.routes) ? value.routes : defaults;
  return routes.map((route, index) =>
    normalizeGestureActionRoute(
      route,
      defaults[index] ?? createGestureActionRoute(`route-${index + 1}`, gestureControlIds[index % gestureControlIds.length], "started", "shaderParameter")
    )
  );
};

const normalizeVisualDrumPads = (value: unknown): VisualDrumPadMapping[] => {
  const defaults = createDefaultVisualDrumPads();
  const pads = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.pads) ? value.pads : defaults;
  return defaults.map((fallback, index) => {
    const pad = pads[index];
    if (!isRecord(pad)) return fallback;

    return {
      id: typeof pad.id === "string" && pad.id.trim() ? pad.id.trim() : fallback.id,
      label: typeof pad.label === "string" && pad.label.trim() ? pad.label.trim().slice(0, 16) : fallback.label,
      enabled: typeof pad.enabled === "boolean" ? pad.enabled : fallback.enabled,
      parameterId: typeof pad.parameterId === "string" ? pad.parameterId : fallback.parameterId,
      value: typeof pad.value === "number" && Number.isFinite(pad.value) ? clampNumber(pad.value) : fallback.value,
      velocityThreshold:
        typeof pad.velocityThreshold === "number" && Number.isFinite(pad.velocityThreshold)
          ? clampNumber(pad.velocityThreshold, 0, 0.8)
          : fallback.velocityThreshold
    };
  });
};

const getVisualDrumPadParameter = (scene: ShaderScene, pad: VisualDrumPadMapping, index: number) => {
  if (scene.parameters.length === 0) return undefined;
  return scene.parameters.find((parameter) => parameter.id === pad.parameterId) ?? scene.parameters[index % scene.parameters.length];
};

const visualDrumPointInsidePad = (
  point: { x: number; y: number },
  pad: Pick<VisualDrumPadOverlayPad, "height" | "width" | "x" | "y">
) =>
  point.x >= pad.x &&
  point.x <= pad.x + pad.width &&
  point.y >= pad.y &&
  point.y <= pad.y + pad.height;

const applyGestureActionCurve = (value: number, curve: GestureActionCurve) => {
  const next = clampNumber(value);
  if (curve === "easeIn") return next * next;
  if (curve === "easeOut") return 1 - (1 - next) * (1 - next);
  if (curve === "snap") return next >= 0.5 ? 1 : 0;
  return next;
};

const routeMatchesTrigger = (control: GestureControlState, route: GestureActionRoute) => {
  if (route.trigger === "started") return control.started;
  if (route.trigger === "held") return control.held && control.heldMs >= route.holdMs;
  if (route.trigger === "released") return control.released;
  if (route.trigger === "repeated") return control.repeated;
  if (route.trigger === "latched") return control.latched;
  return false;
};

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
    throw new Error("That file is not a compatible shader preset.");
  }

  const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
  const fragment = typeof parsed.fragment === "string" ? parsed.fragment : "";
  if (!name || !fragment.includes("mainImage")) {
    throw new Error("Shader presets need a name and a mainImage fragment.");
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
    license: typeof parsed.license === "string" ? parsed.license : "Local preset",
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
      message: "Camera access is blocked for this app."
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
  const gestureActionFileInputRef = useRef<HTMLInputElement | null>(null);
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const poseLandmarkerRef = useRef<PoseLandmarker | null>(null);
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const previousHandsRef = useRef<Map<string, PreviousHandSample>>(new Map());
  const motionRef = useRef<MotionFrame | null>(null);
  const faceGestureCalibrationRef = useRef<FaceGestureCalibration>(defaultFaceGestureCalibration);
  const gestureStateMachineRef = useRef<GestureStateMachineMemory>(createGestureStateMachineMemory());
  const gestureStateMachineConfigRef = useRef<GestureStateMachineConfig>(defaultGestureStateMachineConfig);
  const gestureActionMatrixRef = useRef<GestureActionRoute[]>(createDefaultGestureActionMatrix());
  const visualDrumPadsRef = useRef<VisualDrumPadMapping[]>(createDefaultVisualDrumPads());
  const visualDrumPadRuntimeRef = useRef<Record<string, VisualDrumPadRuntime>>({});
  const visualDrumPadInsideRef = useRef<Set<string>>(new Set());
  const visualDrumPadOverlayRef = useRef<VisualDrumPadOverlayPad[]>([]);
  const visualDrumPadStrikeSamplesRef = useRef<Map<string, VisualDrumPadStrikeSample>>(new Map());
  const activeShaderSceneRef = useRef<ShaderScene>(shaderScenes[0]);
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
  const workspaceResizeDragRef = useRef<WorkspaceResizeDrag | null>(null);
  const reducedMotion = useReducedMotion();

  const [captureState, setCaptureState] = useState<CaptureState>("idle");
  const [error, setError] = useState("");
  const [cameraIssue, setCameraIssue] = useState<CameraIssue>(null);
  const [motion, setMotion] = useState<MotionFrame | null>(null);
  const [fps, setFps] = useState(0);
  const [latency, setLatency] = useState(0);
  const [mode, setMode] = useState<TrackingPreviewMode>("upper");
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
  const [collapsedRailSections, setCollapsedRailSections] = useState<Record<RailSectionId, boolean>>({
    output: false,
    system: false,
    shader: false,
    effects: false,
    face: false,
    tracking: false
  });
  const [faceGestureCalibration, setFaceGestureCalibration] = useState<FaceGestureCalibration>(() => {
    try {
      return normalizeFaceGestureCalibration(window.localStorage.getItem(FACE_GESTURE_CALIBRATION_STORAGE_KEY)
        ? JSON.parse(window.localStorage.getItem(FACE_GESTURE_CALIBRATION_STORAGE_KEY) ?? "{}")
        : defaultFaceGestureCalibration);
    } catch {
      return defaultFaceGestureCalibration;
    }
  });
  const [gestureStateMachineConfig, setGestureStateMachineConfig] = useState<GestureStateMachineConfig>(() => {
    try {
      const stored = window.localStorage.getItem(GESTURE_STATE_MACHINE_STORAGE_KEY);
      return normalizeGestureStateMachineConfig(stored ? JSON.parse(stored) : defaultGestureStateMachineConfig);
    } catch {
      return defaultGestureStateMachineConfig;
    }
  });
  const [gestureActionMatrix, setGestureActionMatrix] = useState<GestureActionRoute[]>(() => {
    try {
      const stored = window.localStorage.getItem(GESTURE_ACTION_MATRIX_STORAGE_KEY);
      return normalizeGestureActionMatrix(stored ? JSON.parse(stored) : createDefaultGestureActionMatrix());
    } catch {
      return createDefaultGestureActionMatrix();
    }
  });
  const [visualDrumPads, setVisualDrumPads] = useState<VisualDrumPadMapping[]>(() => {
    try {
      const stored = window.localStorage.getItem(VISUAL_DRUM_PAD_STORAGE_KEY);
      return normalizeVisualDrumPads(stored ? JSON.parse(stored) : createDefaultVisualDrumPads());
    } catch {
      return createDefaultVisualDrumPads();
    }
  });
  const [gestureActionNotice, setGestureActionNotice] = useState("");
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
  const [workspaceLayout, setWorkspaceLayout] = useState<WorkspaceLayout>(() => {
    try {
      const stored = window.localStorage.getItem(WORKSPACE_LAYOUT_STORAGE_KEY);
      if (!stored) return defaultWorkspaceLayout;
      const parsed = JSON.parse(stored) as Partial<WorkspaceLayout>;
      return {
        railWidth: typeof parsed.railWidth === "number"
          ? clamp(parsed.railWidth, 250, 560)
          : defaultWorkspaceLayout.railWidth,
        stageHeight: typeof parsed.stageHeight === "number"
          ? clamp(parsed.stageHeight, 280, 760)
          : defaultWorkspaceLayout.stageHeight
      };
    } catch {
      return defaultWorkspaceLayout;
    }
  });
  const [workspaceResizeTarget, setWorkspaceResizeTarget] = useState<WorkspaceResizeTarget | null>(null);
  const outputStatuses = useMemo(() => getOutputStatuses(), []);
  const displayOutputStatuses = outputStatuses.map((status) => {
    const systemOutput = systemStatus?.outputs.find((output) => output.target === status.target);
    return {
      ...status,
      available: systemOutput?.available ?? status.available,
      detail: stripVisibleAppName(systemOutput?.detail ?? status.detail)
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
  const activeTrackingMode = trackingPreviewModes.find((previewMode) => previewMode.id === mode) ?? trackingPreviewModes[0];
  const appShellStyle = {
    "--control-rail-width": `${workspaceLayout.railWidth}px`,
    "--stage-panel-height": `${workspaceLayout.stageHeight}px`
  } as CSSProperties;

  const startWorkspaceResize = useCallback((target: WorkspaceResizeTarget, event: ReactPointerEvent<HTMLElement>) => {
    if (target === "rail" && window.matchMedia("(max-width: 1000px)").matches) {
      return;
    }

    const shell = document.querySelector<HTMLElement>(".app-shell");
    const workspace = document.querySelector<HTMLElement>(".workspace");
    const shellRect = shell?.getBoundingClientRect();
    const workspaceRect = workspace?.getBoundingClientRect();
    if (!shellRect || !workspaceRect) return;

    event.preventDefault();
    workspaceResizeDragRef.current = {
      target,
      startX: event.clientX,
      startY: event.clientY,
      startRailWidth: workspaceLayout.railWidth,
      startStageHeight: workspaceLayout.stageHeight,
      shellWidth: shellRect.width,
      workspaceHeight: workspaceRect.height
    };
    setWorkspaceResizeTarget(target);
  }, [workspaceLayout]);

  const toggleRailSection = useCallback((sectionId: RailSectionId) => {
    setCollapsedRailSections((current) => ({
      ...current,
      [sectionId]: !current[sectionId]
    }));
  }, []);

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
    gestureStateMachineRef.current = createGestureStateMachineMemory();
    visualDrumPadInsideRef.current = new Set();
    visualDrumPadStrikeSamplesRef.current = new Map();
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

  const executeGestureActionRoutes = useCallback((controls: MotionFrame["gestureControls"]) => {
    const routes = gestureActionMatrixRef.current;
    const scene = activeShaderSceneRef.current;

    for (const route of routes) {
      if (!route.enabled) continue;
      const control = controls[route.gestureId];
      if (!control || !routeMatchesTrigger(control, route)) continue;

      if (route.actionType === "shaderParameter") {
        const parameter = scene.parameters.find((candidate) => candidate.id === route.shaderParameterId) ?? scene.parameters[0];
        if (!parameter) continue;
        const baseSignal =
          route.trigger === "started" || route.trigger === "released" || route.trigger === "repeated"
            ? 1
            : route.trigger === "latched"
              ? control.latched ? 1 : 0
              : control.smooth;
        const shaped = applyGestureActionCurve(route.invert ? 1 - baseSignal : baseSignal, route.curve);
        const normalizedValue = route.min + shaped * (route.max - route.min);
        const mappedValue = parameter.min + normalizedValue * (parameter.max - parameter.min);

        setShaderSettings((current) => {
          const currentSetting = current[parameter.id] ?? {
            value: parameter.defaultValue,
            source: parameter.motionDefault,
            depth: 0
          };
          if (
            currentSetting.source === "manual" &&
            currentSetting.depth === 0 &&
            Math.abs(currentSetting.value - mappedValue) < 0.005
          ) {
            return current;
          }

          return {
            ...current,
            [parameter.id]: {
              ...currentSetting,
              value: mappedValue,
              source: "manual",
              depth: 0
            }
          };
        });
        continue;
      }

      if (route.actionType === "effect") {
        setSelectedEffect(route.effectId);
        setVisualMode("camera");
        continue;
      }

      if (route.actionType === "outputMode") {
        setOutputCompositionMode(route.outputMode);
      }
    }
  }, []);

  const updateVisualDrumPadOverlay = useCallback((now = performance.now()) => {
    const scene = activeShaderSceneRef.current;
    const runtime = visualDrumPadRuntimeRef.current;
    visualDrumPadOverlayRef.current = visualDrumPadsRef.current.map((pad, index) => {
      const padRuntime = runtime[pad.id] ?? { cooldownUntil: 0, intensity: 0, lastHitAt: 0 };
      const parameter = getVisualDrumPadParameter(scene, pad, index);
      const layout = visualDrumPadLayout[index] ?? visualDrumPadLayout[0];
      const ageMs = padRuntime.lastHitAt > 0 ? now - padRuntime.lastHitAt : Number.POSITIVE_INFINITY;
      const intensity = padRuntime.lastHitAt > 0 ? Math.max(0, Math.exp(-ageMs / 420) * padRuntime.intensity) : 0;
      runtime[pad.id] = {
        ...padRuntime,
        intensity
      };

      return {
        id: pad.id,
        label: pad.label,
        parameterLabel: parameter?.label ?? "No target",
        value: pad.value,
        enabled: pad.enabled && Boolean(parameter),
        intensity,
        ...layout
      };
    });

    compositorOptionsRef.current.visualDrumPads = visualDrumPadOverlayRef.current;
    outputCompositorOptionsRef.current.visualDrumPads = visualDrumPadOverlayRef.current;
  }, []);

  const processVisualDrumPadHits = useCallback((nextMotion: MotionFrame) => {
    const scene = activeShaderSceneRef.current;
    const pads = visualDrumPadsRef.current;
    if (scene.parameters.length === 0 || pads.every((pad) => !pad.enabled)) {
      visualDrumPadInsideRef.current = new Set();
      visualDrumPadStrikeSamplesRef.current = new Map();
      updateVisualDrumPadOverlay(nextMotion.timestamp);
      return;
    }

    const nextInside = new Set<string>();
    const previousSamples = visualDrumPadStrikeSamplesRef.current;
    const nextSamples = new Map<string, VisualDrumPadStrikeSample>();
    const hits: Array<{ parameter: ShaderParameterDefinition; value: number; pad: VisualDrumPadMapping }> = [];
    const strikePoints = nextMotion.hands.flatMap((hand, handIndex) => {
      const points = VISUAL_DRUM_PAD_TIP_INDICES.map((tipIndex) => ({
        id: `${hand.handedness}-${handIndex}-tip-${tipIndex}`,
        point: hand.landmarks[tipIndex],
        fallbackImpact: hand.velocity
      })).filter((candidate): candidate is { id: string; point: Landmark; fallbackImpact: number } => Boolean(candidate.point));

      points.push({
        id: `${hand.handedness}-${handIndex}-center`,
        point: hand.centroid,
        fallbackImpact: hand.velocity
      });

      return points.map((candidate) => {
        const displayPoint = {
          x: 1 - candidate.point.x,
          y: candidate.point.y
        };
        const previous = previousSamples.get(candidate.id);
        const deltaSeconds = previous ? Math.max(0.001, (nextMotion.timestamp - previous.timestamp) / 1000) : 1;
        const pointSpeed = previous
          ? clampNumber(
              Math.hypot(displayPoint.x - previous.point.x, displayPoint.y - previous.point.y) / deltaSeconds / 1.25,
              0,
              1
            )
          : 0;
        nextSamples.set(candidate.id, {
          point: displayPoint,
          timestamp: nextMotion.timestamp
        });
        return {
          ...candidate,
          displayPoint,
          impact: Math.max(pointSpeed, candidate.fallbackImpact * 0.82)
        };
      });
    });

    pads.forEach((pad, index) => {
      if (!pad.enabled) return;
      const layout = visualDrumPadLayout[index];
      const parameter = getVisualDrumPadParameter(scene, pad, index);
      if (!layout || !parameter) return;

      const impacts = strikePoints
        .filter((candidate) => visualDrumPointInsidePad(candidate.displayPoint, layout))
        .map((candidate) => candidate.impact);
      if (impacts.length === 0) return;
      nextInside.add(pad.id);
      const impact = Math.max(...impacts);

      const runtime = visualDrumPadRuntimeRef.current[pad.id] ?? {
        cooldownUntil: 0,
        intensity: 0,
        lastHitAt: 0
      };
      if (impact >= pad.velocityThreshold && nextMotion.timestamp >= runtime.cooldownUntil) {
        const mappedValue = parameter.min + pad.value * (parameter.max - parameter.min);
        hits.push({ parameter, value: mappedValue, pad });
        visualDrumPadRuntimeRef.current[pad.id] = {
          cooldownUntil: nextMotion.timestamp + VISUAL_DRUM_PAD_COOLDOWN_MS,
          intensity: Math.max(0.86, impact),
          lastHitAt: nextMotion.timestamp
        };
      }
    });

    visualDrumPadInsideRef.current = nextInside;
    visualDrumPadStrikeSamplesRef.current = nextSamples;
    if (hits.length > 0) {
      setShaderSettings((current) => {
        let changed = false;
        const next = { ...current };
        for (const hit of hits) {
          const currentSetting = next[hit.parameter.id] ?? {
            value: hit.parameter.defaultValue,
            source: hit.parameter.motionDefault,
            depth: 0
          };
          if (
            currentSetting.source === "manual" &&
            currentSetting.depth === 0 &&
            Math.abs(currentSetting.value - hit.value) < 0.005
          ) {
            continue;
          }
          changed = true;
          next[hit.parameter.id] = {
            ...currentSetting,
            value: hit.value,
            source: "manual",
            depth: 0
          };
        }
        return changed ? next : current;
      });
    }

    updateVisualDrumPadOverlay(nextMotion.timestamp);
  }, [updateVisualDrumPadOverlay]);

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
        const rawMotion = analyzeMotion(hands, pose, face, now, faceGestureCalibrationRef.current);
        const gestureControls = updateGestureStateMachine(
          gestureStateMachineRef.current,
          rawMotion.gestures,
          now,
          gestureStateMachineConfigRef.current
        );
        const nextMotion = {
          ...rawMotion,
          gestureControls
        };
        motionRef.current = nextMotion;
        executeGestureActionRoutes(gestureControls);
        processVisualDrumPadHits(nextMotion);
        setMotion(nextMotion);
        setLatency(performance.now() - frameStartRef.current);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Tracking failed.");
        setCaptureState("error");
        runningRef.current = false;
      }
    }

    updateVisualDrumPadOverlay(now);
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
  }, [executeGestureActionRoutes, processVisualDrumPadHits, updateVisualDrumPadOverlay]);

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
        const error = new DOMException("Camera access is blocked for this app.", "NotAllowedError");
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
      visualDrumPadInsideRef.current = new Set();
      visualDrumPadStrikeSamplesRef.current = new Map();
      gestureStateMachineRef.current = createGestureStateMachineMemory();
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
    window.localStorage.setItem(WORKSPACE_LAYOUT_STORAGE_KEY, JSON.stringify(workspaceLayout));
  }, [workspaceLayout]);

  useEffect(() => {
    if (!workspaceResizeTarget) return;

    const moveResize = (event: PointerEvent) => {
      const drag = workspaceResizeDragRef.current;
      if (!drag) return;

      if (drag.target === "rail") {
        const deltaX = event.clientX - drag.startX;
        const maxRailWidth = Math.max(250, Math.min(560, drag.shellWidth - 520));
        setWorkspaceLayout((current) => ({
          ...current,
          railWidth: clamp(drag.startRailWidth - deltaX, 250, maxRailWidth)
        }));
        return;
      }

      const deltaY = event.clientY - drag.startY;
      setWorkspaceLayout((current) => ({
        ...current,
        stageHeight: clamp(drag.startStageHeight + deltaY, 280, 920)
      }));
    };

    const stopResize = () => {
      workspaceResizeDragRef.current = null;
      setWorkspaceResizeTarget(null);
    };

    document.body.classList.add("layout-resizing", `layout-resizing-${workspaceResizeTarget}`);
    window.addEventListener("pointermove", moveResize);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);

    return () => {
      document.body.classList.remove("layout-resizing", `layout-resizing-${workspaceResizeTarget}`);
      window.removeEventListener("pointermove", moveResize);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };
  }, [workspaceResizeTarget]);

  useEffect(() => {
    faceGestureCalibrationRef.current = faceGestureCalibration;
    window.localStorage.setItem(FACE_GESTURE_CALIBRATION_STORAGE_KEY, JSON.stringify(faceGestureCalibration));
  }, [faceGestureCalibration]);

  useEffect(() => {
    gestureStateMachineConfigRef.current = gestureStateMachineConfig;
    window.localStorage.setItem(GESTURE_STATE_MACHINE_STORAGE_KEY, JSON.stringify(gestureStateMachineConfig));
  }, [gestureStateMachineConfig]);

  useEffect(() => {
    gestureActionMatrixRef.current = gestureActionMatrix;
    window.localStorage.setItem(GESTURE_ACTION_MATRIX_STORAGE_KEY, JSON.stringify(gestureActionMatrix));
  }, [gestureActionMatrix]);

  useEffect(() => {
    visualDrumPadsRef.current = visualDrumPads;
    window.localStorage.setItem(VISUAL_DRUM_PAD_STORAGE_KEY, JSON.stringify(visualDrumPads));
  }, [visualDrumPads]);

  useEffect(() => {
    activeShaderSceneRef.current = activeShaderScene;
  }, [activeShaderScene]);

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
      trackingMode: mode,
      shaderScene: activeShaderScene,
      shaderParameters: shaderSettings,
      visualDrumPads: visualDrumPadOverlayRef.current
    };
    outputCompositorOptionsRef.current = {
      showRig: selectedOutputComposition.showRig,
      effectAmount: reducedMotion ? Math.min(effectAmount, 0.4) : effectAmount,
      selectedEffect,
      includeCameraFeed: selectedOutputComposition.includeCameraFeed,
      trackingMode: mode,
      visualMode: "shader",
      shaderScene: activeShaderScene,
      shaderParameters: shaderSettings,
      visualDrumPads: visualDrumPadOverlayRef.current
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
    mode,
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

  const updateFaceGestureCalibration = useCallback((patch: Partial<FaceGestureCalibration>) => {
    setFaceGestureCalibration((current) => normalizeFaceGestureCalibration({ ...current, ...patch }));
  }, []);

  const updateGestureStateMachineConfig = useCallback((patch: Partial<GestureStateMachineConfig>) => {
    setGestureStateMachineConfig((current) => normalizeGestureStateMachineConfig({ ...current, ...patch }));
  }, []);

  const resetGestureStateMachineConfig = useCallback(() => {
    setGestureStateMachineConfig(defaultGestureStateMachineConfig);
    gestureStateMachineRef.current = createGestureStateMachineMemory();
  }, []);

  const toggleGestureLatch = useCallback((gestureId: GestureControlId) => {
    setGestureStateMachineConfig((current) =>
      normalizeGestureStateMachineConfig({
        ...current,
        latchGestures: {
          ...current.latchGestures,
          [gestureId]: !current.latchGestures[gestureId]
        }
      })
    );
  }, []);

  const resetFaceGestureCalibration = useCallback(() => {
    setFaceGestureCalibration(defaultFaceGestureCalibration);
  }, []);

  const captureNeutralFaceCalibration = useCallback(() => {
    const face = motionRef.current?.face;
    if (!face) return;

    updateFaceGestureCalibration(
      Object.fromEntries(
        faceSignalControls.map((control) => [
          control.id,
          clampNumber((face[control.signal] ?? 0) + control.neutralMargin, control.min, control.max)
        ])
      ) as Partial<FaceGestureCalibration>
    );
  }, [updateFaceGestureCalibration]);

  const captureLiveFaceThreshold = useCallback((control: (typeof faceSignalControls)[number]) => {
    const face = motionRef.current?.face;
    if (!face) return;

    const value = face[control.signal] ?? 0;
    updateFaceGestureCalibration({
      [control.id]: clampNumber(value * 0.72, control.min, control.max)
    } as Partial<FaceGestureCalibration>);
  }, [updateFaceGestureCalibration]);

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

  const updateGestureActionRoute = useCallback((routeId: string, patch: Partial<GestureActionRoute>) => {
    setGestureActionMatrix((current) =>
      current.map((route) => route.id === routeId ? normalizeGestureActionRoute({ ...route, ...patch }, route) : route)
    );
  }, []);

  const addGestureActionRoute = useCallback(() => {
    setGestureActionMatrix((current) => [
      ...current,
      {
        ...createGestureActionRoute(`route-${Date.now().toString(36)}`, "smile", "started", "shaderParameter"),
        shaderParameterId: activeShaderSceneRef.current.parameters[0]?.id ?? ""
      }
    ]);
    setGestureActionNotice("Route added.");
  }, []);

  const deleteGestureActionRoute = useCallback((routeId: string) => {
    setGestureActionMatrix((current) => current.filter((route) => route.id !== routeId));
    setGestureActionNotice("Route deleted.");
  }, []);

  const resetGestureActionMatrix = useCallback(() => {
    setGestureActionMatrix(createDefaultGestureActionMatrix());
    setGestureActionNotice("Matrix reset.");
  }, []);

  const updateVisualDrumPad = useCallback((padId: string, patch: Partial<VisualDrumPadMapping>) => {
    setVisualDrumPads((current) =>
      normalizeVisualDrumPads(current.map((pad) => pad.id === padId ? { ...pad, ...patch } : pad))
    );
  }, []);

  const resetVisualDrumPads = useCallback(() => {
    setVisualDrumPads(createDefaultVisualDrumPads());
    visualDrumPadRuntimeRef.current = {};
    visualDrumPadInsideRef.current = new Set();
    visualDrumPadStrikeSamplesRef.current = new Map();
  }, []);

  const exportGestureActionMatrix = useCallback(() => {
    const preset: GestureActionMatrixPreset = {
      schema: GESTURE_ACTION_MATRIX_PRESET_SCHEMA,
      name: `${activeShaderScene.label} Gesture Matrix`,
      routes: gestureActionMatrix
    };
    const filename = `${preset.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "gesture-action-matrix"}.facevizgesturematrix`;
    const blob = new Blob([JSON.stringify(preset, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    setGestureActionNotice("Matrix exported.");
  }, [activeShaderScene.label, gestureActionMatrix]);

  const importGestureActionMatrix = useCallback(async (file: File) => {
    try {
      const source = await file.text();
      const parsed = JSON.parse(source);
      setGestureActionMatrix(normalizeGestureActionMatrix(parsed));
      setGestureActionNotice("Matrix imported.");
    } catch {
      setGestureActionNotice("Unable to import matrix.");
    }
  }, []);

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
        .map(([name]) => gestureLabels[name as keyof MotionFrame["gestures"]] ?? name)
    : ["Idle"];

  return (
    <main
      className={workspaceResizeTarget ? `app-shell resizing-${workspaceResizeTarget}` : "app-shell"}
      style={appShellStyle}
    >
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
          <div className="brand-lockup" aria-label="INFINIGHTCapture">
            <img
              className="brand-logo"
              src="brand/infinightcapture_horizontal_logo.png"
              alt="INFINIGHTCapture"
            />
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
              <strong>{visualMode === "shader" ? "Mocap Shader" : activeTrackingMode.hudLabel}</strong>
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

        {activeWorkspace !== "signal" && (
          <button
            className="layout-resize-handle stage-resize-handle"
            onPointerDown={(event) => startWorkspaceResize("stage", event)}
            title="Resize preview vertically"
            type="button"
            aria-label="Resize preview vertically"
          >
            <span />
          </button>
        )}

        {activeWorkspace !== "signal" ? (
          <>
            <section className="transport-row" aria-label="Capture controls">
              {trackingPreviewModes.map((previewMode) => {
                const ModeIcon = previewMode.icon;
                return (
                  <button
                    className={mode === previewMode.id ? "mode-button active" : "mode-button"}
                    key={previewMode.id}
                    onClick={() => setMode(previewMode.id)}
                    type="button"
                  >
                    <ModeIcon size={16} />
                    <span>{previewMode.label}</span>
                  </button>
                );
              })}
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
                    <li>Reload the app, then press Start again.</li>
                    <li>For the desktop shell, allow camera access for Electron or this app in macOS settings.</li>
                  </ol>
                )}
              </div>
            )}

            <section className="telemetry-grid">
              <Metric icon={Activity} label="Confidence" value={`${Math.round((motion?.confidence ?? 0) * 100)}%`} />
              <Metric icon={Cpu} label="Latency" value={`${Math.round(latency)} ms`} />
              <Metric icon={RadioTower} label="Rate" value={`${fps} fps`} />
              <Metric icon={Hand} label="Hands" value={`${motion?.hands.length ?? 0}/2`} />
              <Metric icon={ScanFace} label="Face" value={motion?.face ? "Active" : "None"} />
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
                <VisualDrumPadEditor
                  activeScene={activeShaderScene}
                  onReset={resetVisualDrumPads}
                  onUpdate={updateVisualDrumPad}
                  pads={visualDrumPads}
                />
                <GestureActionMatrixEditor
                  activeScene={activeShaderScene}
                  fileInputRef={gestureActionFileInputRef}
                  matrix={gestureActionMatrix}
                  motion={motion}
                  notice={gestureActionNotice}
                  onAdd={addGestureActionRoute}
                  onDelete={deleteGestureActionRoute}
                  onExport={exportGestureActionMatrix}
                  onImport={importGestureActionMatrix}
                  onReset={resetGestureActionMatrix}
                  onUpdate={updateGestureActionRoute}
                />
              </section>
            )}

            {(activeWorkspace === "shader" || activeWorkspace === "mapping") && (
              <section className="shader-parameter-dock" aria-label="Shader parameters">
                <div className="shader-parameter-dock-header">
                  <div>
                    <p className="eyebrow">Shader Parameters</p>
                    <h2>{activeShaderScene.label}</h2>
                  </div>
                  <div className="mapping-summary">
                    <span>{activeShaderScene.parameters.length} controls</span>
                    <strong>{activeShaderScene.imported ? "Imported" : "Built-in"}</strong>
                  </div>
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

      <button
        className="layout-resize-handle rail-resize-handle"
        onPointerDown={(event) => startWorkspaceResize("rail", event)}
        title="Resize panels horizontally"
        type="button"
        aria-label="Resize panels horizontally"
      >
        <span />
      </button>

      <aside className="control-rail">
        <CollapsibleRailSection
          collapsed={collapsedRailSections.output}
          icon={RadioTower}
          id="output"
          onToggle={() => toggleRailSection("output")}
          title="Output"
        >
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
              Stop {selectedOutput?.label ?? "Native"} Output
            </button>
          ) : (
            <button className="output-action" onClick={startOutput} disabled={!selectedOutput?.available}>
              <RadioTower size={16} />
              Start {selectedOutput?.label ?? "Native"} Output
            </button>
          )}
          <div className="output-composition-options" role="group" aria-label="Output composition">
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
            <div className="performance-options" role="group" aria-label="Output speed">
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
        </CollapsibleRailSection>

        <CollapsibleRailSection
          collapsed={collapsedRailSections.system}
          icon={MonitorCog}
          id="system"
          onToggle={() => toggleRailSection("system")}
          title="System Core"
        >
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
        </CollapsibleRailSection>

        <CollapsibleRailSection
          collapsed={collapsedRailSections.shader}
          icon={SlidersHorizontal}
          id="shader"
          onToggle={() => toggleRailSection("shader")}
          title="Shader Player"
        >
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
        </CollapsibleRailSection>

        <CollapsibleRailSection
          collapsed={collapsedRailSections.effects}
          icon={Sparkles}
          id="effects"
          onToggle={() => toggleRailSection("effects")}
          title="Camera Effects"
        >
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
        </CollapsibleRailSection>

        <CollapsibleRailSection
          collapsed={collapsedRailSections.face}
          icon={Smile}
          id="face"
          onToggle={() => toggleRailSection("face")}
          title="Face Control"
        >
          <FaceCalibrationPanel
            calibration={faceGestureCalibration}
            motion={motion}
            onCaptureLive={captureLiveFaceThreshold}
            onCaptureNeutral={captureNeutralFaceCalibration}
            onReset={resetFaceGestureCalibration}
            onUpdate={updateFaceGestureCalibration}
          />
        </CollapsibleRailSection>

        <CollapsibleRailSection
          collapsed={collapsedRailSections.tracking}
          icon={ScanFace}
          id="tracking"
          onToggle={() => toggleRailSection("tracking")}
          title="Tracking"
        >
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
          <GestureStateMachinePanel
            config={gestureStateMachineConfig}
            controls={motion?.gestureControls}
            onReset={resetGestureStateMachineConfig}
            onToggleLatch={toggleGestureLatch}
            onUpdate={updateGestureStateMachineConfig}
          />
        </CollapsibleRailSection>
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

type FaceCalibrationPanelProps = {
  calibration: FaceGestureCalibration;
  motion: MotionFrame | null;
  onCaptureLive: (control: (typeof faceSignalControls)[number]) => void;
  onCaptureNeutral: () => void;
  onReset: () => void;
  onUpdate: (patch: Partial<FaceGestureCalibration>) => void;
};

type GestureStateMachinePanelProps = {
  config: GestureStateMachineConfig;
  controls: MotionFrame["gestureControls"] | undefined;
  onReset: () => void;
  onToggleLatch: (gestureId: GestureControlId) => void;
  onUpdate: (patch: Partial<GestureStateMachineConfig>) => void;
};

const getGestureControlPriority = (control: GestureControlState) => {
  if (control.started) return 0;
  if (control.repeated) return 1;
  if (control.released) return 2;
  if (control.held) return 3;
  if (control.latched) return 4;
  if (control.active) return 5;
  return 6;
};

const formatGestureMs = (value: number) => `${Math.round(value)} ms`;

function GestureStateMachinePanel({
  config,
  controls,
  onReset,
  onToggleLatch,
  onUpdate
}: GestureStateMachinePanelProps) {
  const activeControls = controls
    ? gestureControlIds
        .map((id) => controls[id])
        .filter((control) => control && (control.phase !== "idle" || control.latched))
        .sort((a, b) => getGestureControlPriority(a) - getGestureControlPriority(b))
        .slice(0, 6)
    : [];

  return (
    <div className="gesture-machine-panel">
      <div className="gesture-machine-header">
        <span>Event Machine</span>
        <button onClick={onReset} type="button">Reset</button>
      </div>

      <div className="gesture-machine-controls">
        {gestureMachineControls.map((control) => (
          <label className="gesture-machine-control" key={control.id}>
            <span>{control.label}</span>
            <input
              type="range"
              min={control.min}
              max={control.max}
              step={control.step}
              value={config[control.id]}
              onChange={(event) => onUpdate({ [control.id]: Number(event.target.value) } as Partial<GestureStateMachineConfig>)}
            />
            <strong>{control.suffix ? `${Math.round(config[control.id])} ${control.suffix}` : config[control.id].toFixed(2)}</strong>
          </label>
        ))}
      </div>

      <div className="gesture-latch-grid" aria-label="Latch gesture toggles">
        {gestureControlIds.map((id) => (
          <button
            className={config.latchGestures[id] ? "active" : ""}
            key={id}
            onClick={() => onToggleLatch(id)}
            type="button"
          >
            {gestureLabels[id]}
          </button>
        ))}
      </div>

      <div className="gesture-event-stack" aria-label="Gesture event state">
        {activeControls.length > 0 ? (
          activeControls.map((control) => (
            <div className={`gesture-event-row ${control.phase}`} key={control.id}>
              <span>{gestureLabels[control.id]}</span>
              <strong>
                {control.started
                  ? "started"
                  : control.repeated
                    ? "repeat"
                    : control.released
                      ? "released"
                      : control.latched
                        ? "latched"
                        : control.held
                          ? "held"
                          : control.phase}
              </strong>
              <small>{control.active ? formatGestureMs(control.activeMs) : `${Math.round(control.smooth * 100)}%`}</small>
            </div>
          ))
        ) : (
          <div className="gesture-event-empty">No gesture events</div>
        )}
      </div>
    </div>
  );
}

function FaceCalibrationPanel({
  calibration,
  motion,
  onCaptureLive,
  onCaptureNeutral,
  onReset,
  onUpdate
}: FaceCalibrationPanelProps) {
  const face = motion?.face;
  const hasFace = Boolean(face);

  return (
    <div className="face-calibration-panel">
      <div className="face-calibration-actions">
        <button onClick={onCaptureNeutral} type="button" disabled={!hasFace}>
          Guard Neutral
        </button>
        <button onClick={onReset} type="button">
          Reset
        </button>
      </div>

      <div className="face-signal-stack" aria-label="Face gesture thresholds">
        {faceSignalControls.map((control) => {
          const value = face?.[control.signal] ?? 0;
          const threshold = calibration[control.id];
          const active = value >= threshold && hasFace;

          return (
            <div className={active ? "face-signal-control active" : "face-signal-control"} key={control.id}>
              <div className="face-signal-header">
                <span>{control.label}</span>
                <strong>{value.toFixed(2)}</strong>
              </div>
              <div className="face-meter" aria-hidden="true">
                <i style={{ width: `${Math.round(value * 100)}%` }} />
                <b style={{ left: `${Math.round(threshold * 100)}%` }} />
              </div>
              <label>
                <span>Threshold</span>
                <input
                  type="range"
                  min={control.min}
                  max={control.max}
                  step="0.01"
                  value={threshold}
                  onChange={(event) => onUpdate({ [control.id]: Number(event.target.value) } as Partial<FaceGestureCalibration>)}
                />
                <strong>{threshold.toFixed(2)}</strong>
              </label>
              <button onClick={() => onCaptureLive(control)} type="button" disabled={!hasFace}>
                Use Live
              </button>
            </div>
          );
        })}
      </div>

      <div className="face-touch-stack" aria-label="Face touch gesture tuning">
        {faceTouchControls.map((control) => (
          <label className="face-touch-control" key={control.id}>
            <span>{control.label}</span>
            <input
              type="range"
              min={control.min}
              max={control.max}
              step={control.step}
              value={calibration[control.id]}
              onChange={(event) => onUpdate({ [control.id]: Number(event.target.value) } as Partial<FaceGestureCalibration>)}
            />
            <strong>{calibration[control.id].toFixed(2)}</strong>
          </label>
        ))}
      </div>
    </div>
  );
}

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
  const nodeElementsRef = useRef<Partial<Record<SignalNodeId, HTMLElement>>>({});
  const dragRef = useRef<{
    nodeId: SignalNodeId;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const [graphSize, setGraphSize] = useState<SignalGraphSize>(signalGraphViewBox);
  const [nodeDimensions, setNodeDimensions] = useState(signalNodeDimensions);
  const [nodePositions, setNodePositions] = useState(defaultSignalNodePositions);
  const syphon = systemStatus?.syphon;
  const outputConsumers = syphon?.outputConsumers ?? [];
  const inputSources = syphon?.inputSources ?? [];
  const primaryConsumer = outputConsumers[0];
  const outputBusLabel = outputTarget === "syphon" ? "Syphon" : "Spout";
  const consumerStatus = primaryConsumer?.status ?? (syphon?.hasOutputClients ? "connected" : "inactive");
  const consumerLabel = primaryConsumer?.appName ?? (syphon?.hasOutputClients ? `${outputBusLabel} Client` : "Resolume / VJ App");
  const consumerDetail =
    primaryConsumer?.detail ??
    (isOutputStreaming ? `Output is visible on the ${outputBusLabel} bus.` : "Waiting for output.");
  const outputState = selectedSystemOutput?.state ?? (isOutputStreaming ? "publishing" : "bridge-ready");
  const outputName = syphon?.outputName ?? "INFINIGHTCapture Output";
  const inputName = syphon?.inputName ?? "INFINIGHTCapture Input";
  const outputNodeLabel = outputName.replace(/^INFINIGHTCapture\s+/i, "");
  const inputNodeLabel = inputName.replace(/^INFINIGHTCapture\s+/i, "");
  const outputNodeDetail = stripVisibleAppName(selectedSystemOutput?.detail ?? syphon?.detail ?? "Output bridge pending");
  const signalTokens = [
    `${Math.round((motion?.confidence ?? 0) * 100)}% confidence`,
    `${motion?.hands.length ?? 0}/2 hands`,
    motion?.face ? "face active" : "no face",
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

  const setSignalNodeElement = useCallback((nodeId: SignalNodeId, element: HTMLElement | null) => {
    if (element) {
      nodeElementsRef.current[nodeId] = element;
      return;
    }

    delete nodeElementsRef.current[nodeId];
  }, []);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;

    const updateMeasurements = () => {
      const rect = graph.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setGraphSize((current) => {
          if (Math.abs(current.width - rect.width) < 0.5 && Math.abs(current.height - rect.height) < 0.5) {
            return current;
          }

          return { width: rect.width, height: rect.height };
        });
      }

      setNodeDimensions((current) => {
        let changed = false;
        const next = { ...current };

        for (const nodeId of signalNodeIds) {
          const node = nodeElementsRef.current[nodeId];
          if (!node) continue;

          const nodeRect = node.getBoundingClientRect();
          if (nodeRect.width <= 0 || nodeRect.height <= 0) continue;

          if (
            Math.abs(current[nodeId].width - nodeRect.width) >= 0.5 ||
            Math.abs(current[nodeId].height - nodeRect.height) >= 0.5
          ) {
            next[nodeId] = { width: nodeRect.width, height: nodeRect.height };
            changed = true;
          }
        }

        return changed ? next : current;
      });
    };

    updateMeasurements();

    const resizeObserver = new ResizeObserver(updateMeasurements);
    resizeObserver.observe(graph);
    for (const nodeId of signalNodeIds) {
      const node = nodeElementsRef.current[nodeId];
      if (node) resizeObserver.observe(node);
    }

    return () => resizeObserver.disconnect();
  }, []);

  const moveNode = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    const graph = graphRef.current;
    if (!drag || !graph) return;

    const rect = graph.getBoundingClientRect();
    const nextX = ((event.clientX - rect.left - drag.offsetX) / rect.width) * 100;
    const nextY = ((event.clientY - rect.top - drag.offsetY) / rect.height) * 100;
    const dimensions = nodeDimensions[drag.nodeId];
    const maxX = Math.max(0, 100 - (dimensions.width / rect.width) * 100);
    const maxY = Math.max(0, 100 - (dimensions.height / rect.height) * 100);

    setNodePositions((current) => ({
      ...current,
      [drag.nodeId]: {
        x: clamp(nextX, 0, maxX),
        y: clamp(nextY, 0, maxY)
      }
    }));
  }, [nodeDimensions]);

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
    <section className="signal-workspace" aria-label={`${outputBusLabel} signal graph`}>
      <div className="signal-graph" ref={graphRef}>
        <svg
          className="signal-wires"
          viewBox={`0 0 ${signalGraphViewBox.width} ${signalGraphViewBox.height}`}
          preserveAspectRatio="none"
          role="presentation"
          aria-hidden="true"
        >
          <defs>
            <marker
              id="signal-arrow"
              markerHeight="12"
              markerUnits="userSpaceOnUse"
              markerWidth="14"
              orient="auto"
              refX="12"
              refY="6"
            >
              <path d="M1,1 L13,6 L1,11 Z" className="signal-arrow" />
            </marker>
          </defs>
          {wires.map((wire) => (
            <g key={wire.id}>
              <path
                className={`signal-wire ${wire.className}`}
                d={signalWirePath(nodePositions, nodeDimensions, graphSize, wire.from, wire.to)}
                markerEnd="url(#signal-arrow)"
              />
              {["0s", "-0.72s"].map((begin) => (
                <circle className={`signal-pulse ${wire.className}`} key={begin} r="4.5">
                  <animateMotion
                    begin={begin}
                    dur={wire.className === "pending" ? "2.1s" : wire.className === "input" ? "1.75s" : "1.45s"}
                    path={signalWirePath(nodePositions, nodeDimensions, graphSize, wire.from, wire.to)}
                    repeatCount="indefinite"
                  />
                </circle>
              ))}
            </g>
          ))}
        </svg>

        <SignalNode
          className="node-camera"
          id="camera"
          detail={`${fps} fps`}
          eyebrow="Source"
          label="Webcam"
          onMeasureNode={setSignalNodeElement}
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
          onMeasureNode={setSignalNodeElement}
          onPointerDown={startNodeDrag}
          onPointerMove={moveNode}
          onPointerUp={stopNodeDrag}
          position={nodePositions.tracker}
          status={motion ? "tracking" : "standby"}
          value={motion ? "Pose + Hands + Face" : "No frame"}
        />
        <SignalNode
          className="node-core"
          id="core"
          detail={signalTokens.join("  /  ")}
          eyebrow="Core"
          label="Gesture Core"
          onMeasureNode={setSignalNodeElement}
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
          detail={outputNodeDetail}
          eyebrow={selectedOutputLabel}
          label={outputNodeLabel}
          onMeasureNode={setSignalNodeElement}
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
          onMeasureNode={setSignalNodeElement}
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
          label={inputSources[0]?.serverName ? stripVisibleAppName(inputSources[0].serverName) : inputNodeLabel}
          onMeasureNode={setSignalNodeElement}
          onPointerDown={startNodeDrag}
          onPointerMove={moveNode}
          onPointerUp={stopNodeDrag}
          position={nodePositions.input}
          status={inputSources[0]?.status ?? "inactive"}
          value={inputSources[0]?.appName ?? `${outputBusLabel} Input`}
        />
      </div>

      <div className="signal-inspector">
        <GraphStatusRow label="Output name" value={outputNodeLabel} />
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

type GestureActionMatrixEditorProps = {
  activeScene: ShaderScene;
  fileInputRef: { current: HTMLInputElement | null };
  matrix: GestureActionRoute[];
  motion: MotionFrame | null;
  notice: string;
  onAdd: () => void;
  onDelete: (routeId: string) => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onReset: () => void;
  onUpdate: (routeId: string, patch: Partial<GestureActionRoute>) => void;
};

type VisualDrumPadEditorProps = {
  activeScene: ShaderScene;
  onReset: () => void;
  onUpdate: (padId: string, patch: Partial<VisualDrumPadMapping>) => void;
  pads: VisualDrumPadMapping[];
};

function VisualDrumPadEditor({ activeScene, onReset, onUpdate, pads }: VisualDrumPadEditorProps) {
  return (
    <div className="visual-drum-pad-editor" aria-label="Visual drum pad mapping">
      <div className="visual-drum-pad-toolbar">
        <div>
          <p className="eyebrow">Visual Drum Pad</p>
          <h3>{pads.length} Pad Surface</h3>
        </div>
        <button onClick={onReset} type="button">Reset</button>
      </div>
      <div className="visual-drum-pad-grid">
        {pads.map((pad, index) => {
          const parameter = getVisualDrumPadParameter(activeScene, pad, index);
          return (
            <article className={pad.enabled ? "visual-drum-pad-card" : "visual-drum-pad-card muted"} key={pad.id}>
              <div className="visual-drum-pad-card-header">
                <label>
                  <input
                    checked={pad.enabled}
                    onChange={(event) => onUpdate(pad.id, { enabled: event.target.checked })}
                    type="checkbox"
                  />
                  <span>{pad.label}</span>
                </label>
                <strong>{parameter?.label ?? "None"}</strong>
              </div>
              <label className="visual-drum-pad-target">
                <span>Target</span>
                <select
                  value={activeScene.parameters.some((candidate) => candidate.id === pad.parameterId) ? pad.parameterId : ""}
                  onChange={(event) => onUpdate(pad.id, { parameterId: event.target.value })}
                >
                  <option value="">Auto</option>
                  {activeScene.parameters.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>{candidate.label}</option>
                  ))}
                </select>
              </label>
              <label className="visual-drum-pad-range">
                <span>Value</span>
                <input
                  max="1"
                  min="0"
                  onChange={(event) => onUpdate(pad.id, { value: Number(event.target.value) })}
                  step="0.01"
                  type="range"
                  value={pad.value}
                />
                <strong>{pad.value.toFixed(2)}</strong>
              </label>
              <label className="visual-drum-pad-range">
                <span>Strike</span>
                <input
                  max="1"
                  min="0"
                  onChange={(event) => onUpdate(pad.id, { velocityThreshold: Number(event.target.value) })}
                  step="0.01"
                  type="range"
                  value={pad.velocityThreshold}
                />
                <strong>{pad.velocityThreshold.toFixed(2)}</strong>
              </label>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function GestureActionMatrixEditor({
  activeScene,
  fileInputRef,
  matrix,
  motion,
  notice,
  onAdd,
  onDelete,
  onExport,
  onImport,
  onReset,
  onUpdate
}: GestureActionMatrixEditorProps) {
  return (
    <div className="gesture-action-matrix" aria-label="Gesture action matrix">
      <div className="gesture-action-toolbar">
        <div>
          <p className="eyebrow">Action Matrix</p>
          <h3>Gesture Routes</h3>
        </div>
        <div className="gesture-action-buttons">
          <button onClick={onAdd} type="button">Add</button>
          <button onClick={onReset} type="button">Reset</button>
          <button onClick={onExport} type="button">Export</button>
          <button onClick={() => fileInputRef.current?.click()} type="button">Import</button>
          <input
            ref={fileInputRef}
            accept=".facevizgesturematrix,.json,application/json"
            className="gesture-action-file-input"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onImport(file);
              event.target.value = "";
            }}
            type="file"
          />
        </div>
      </div>
      {notice && <div className="gesture-action-notice">{notice}</div>}
      <div className="gesture-action-route-grid">
        {matrix.map((route) => {
          const control = motion?.gestureControls[route.gestureId];
          const active = control ? routeMatchesTrigger(control, route) : false;
          const externalReserved = route.actionType === "keyboard" || route.actionType === "midi" || route.actionType === "osc";

          return (
            <article className={active ? "gesture-action-route active" : "gesture-action-route"} key={route.id}>
              <div className="gesture-action-route-header">
                <label className="gesture-action-enabled">
                  <input
                    checked={route.enabled}
                    onChange={(event) => onUpdate(route.id, { enabled: event.target.checked })}
                    type="checkbox"
                  />
                  <span>{gestureLabels[route.gestureId]}</span>
                </label>
                <strong>{active ? "firing" : route.trigger}</strong>
                <button onClick={() => onDelete(route.id)} type="button" aria-label={`Delete ${gestureLabels[route.gestureId]} route`}>
                  <Trash2 size={14} />
                </button>
              </div>

              <div className="gesture-action-route-fields">
                <label>
                  <span>Gesture</span>
                  <select
                    value={route.gestureId}
                    onChange={(event) => onUpdate(route.id, { gestureId: event.target.value as GestureControlId })}
                  >
                    {gestureControlIds.map((id) => (
                      <option key={id} value={id}>{gestureLabels[id]}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Event</span>
                  <select
                    value={route.trigger}
                    onChange={(event) => onUpdate(route.id, { trigger: event.target.value as GestureActionTrigger })}
                  >
                    {gestureActionTriggers.map((trigger) => (
                      <option key={trigger.id} value={trigger.id}>{trigger.label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Action</span>
                  <select
                    value={route.actionType}
                    onChange={(event) => onUpdate(route.id, { actionType: event.target.value as GestureActionType })}
                  >
                    {gestureActionTypes.map((type) => (
                      <option key={type.id} value={type.id}>{type.label}</option>
                    ))}
                  </select>
                </label>
                {route.actionType === "shaderParameter" && (
                  <label>
                    <span>Target</span>
                    <select
                      value={activeScene.parameters.some((parameter) => parameter.id === route.shaderParameterId) ? route.shaderParameterId : ""}
                      onChange={(event) => onUpdate(route.id, { shaderParameterId: event.target.value })}
                    >
                      <option value="">First parameter</option>
                      {activeScene.parameters.map((parameter) => (
                        <option key={parameter.id} value={parameter.id}>{parameter.label}</option>
                      ))}
                    </select>
                  </label>
                )}
                {route.actionType === "effect" && (
                  <label>
                    <span>Target</span>
                    <select value={route.effectId} onChange={(event) => onUpdate(route.id, { effectId: event.target.value })}>
                      {effects.map((effect) => (
                        <option key={effect.id} value={effect.id}>{effect.label}</option>
                      ))}
                    </select>
                  </label>
                )}
                {route.actionType === "outputMode" && (
                  <label>
                    <span>Target</span>
                    <select
                      value={route.outputMode}
                      onChange={(event) => onUpdate(route.id, { outputMode: event.target.value as OutputCompositionMode })}
                    >
                      {outputCompositionModes.map((mode) => (
                        <option key={mode.id} value={mode.id}>{mode.label}</option>
                      ))}
                    </select>
                  </label>
                )}
                {externalReserved && (
                  <div className="gesture-action-reserved">
                    <span>Reserved</span>
                    <strong>Bridge pending</strong>
                  </div>
                )}
              </div>

              <div className="gesture-action-shape">
                <label>
                  <span>Min</span>
                  <input
                    max="1"
                    min="0"
                    onChange={(event) => onUpdate(route.id, { min: Number(event.target.value) })}
                    step="0.01"
                    type="range"
                    value={route.min}
                  />
                  <strong>{route.min.toFixed(2)}</strong>
                </label>
                <label>
                  <span>Max</span>
                  <input
                    max="1"
                    min="0"
                    onChange={(event) => onUpdate(route.id, { max: Number(event.target.value) })}
                    step="0.01"
                    type="range"
                    value={route.max}
                  />
                  <strong>{route.max.toFixed(2)}</strong>
                </label>
                <label>
                  <span>Hold</span>
                  <input
                    max="5000"
                    min="0"
                    onChange={(event) => onUpdate(route.id, { holdMs: Number(event.target.value) })}
                    step="50"
                    type="range"
                    value={route.holdMs}
                  />
                  <strong>{Math.round(route.holdMs)} ms</strong>
                </label>
                <label>
                  <span>Curve</span>
                  <select value={route.curve} onChange={(event) => onUpdate(route.id, { curve: event.target.value as GestureActionCurve })}>
                    {gestureActionCurves.map((curve) => (
                      <option key={curve.id} value={curve.id}>{curve.label}</option>
                    ))}
                  </select>
                </label>
                <label className="gesture-action-invert">
                  <span>Invert</span>
                  <input
                    checked={route.invert}
                    onChange={(event) => onUpdate(route.id, { invert: event.target.checked })}
                    type="checkbox"
                  />
                </label>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

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
    case "mouthOpen":
    case "smile":
    case "frown":
    case "confidence":
      return value > 0.5;
    case "handsUp":
    case "faceCover":
    case "eyesClosed":
    case "earPull":
    case "chinPull":
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
  onMeasureNode: (nodeId: SignalNodeId, element: HTMLElement | null) => void;
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
  onMeasureNode,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  position,
  status,
  value
}: SignalNodeProps) {
  const nodeRef = useCallback((element: HTMLElement | null) => {
    onMeasureNode(id, element);
  }, [id, onMeasureNode]);

  return (
    <article
      className={`signal-node ${className}`}
      onPointerCancel={onPointerUp}
      onPointerDown={(event) => onPointerDown(id, event)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      ref={nodeRef}
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
  dimensionsByNode: Record<SignalNodeId, { width: number; height: number }>,
  graphSize: SignalGraphSize,
  nodeId: SignalNodeId,
  side: "left" | "right"
) => {
  const position = positions[nodeId];
  const dimensions = dimensionsByNode[nodeId];
  const nodeWidth = graphSize.width > 0 ? (dimensions.width / graphSize.width) * signalGraphViewBox.width : 0;
  const nodeHeight = graphSize.height > 0 ? (dimensions.height / graphSize.height) * signalGraphViewBox.height : 0;
  const x = (position.x / 100) * signalGraphViewBox.width + (side === "right" ? nodeWidth : 0);
  const y = (position.y / 100) * signalGraphViewBox.height + nodeHeight / 2;
  return { x, y };
};

const signalWirePath = (
  positions: Record<SignalNodeId, SignalNodePosition>,
  dimensionsByNode: Record<SignalNodeId, { width: number; height: number }>,
  graphSize: SignalGraphSize,
  from: SignalNodeId,
  to: SignalNodeId
) => {
  const start = signalNodeAnchor(positions, dimensionsByNode, graphSize, from, "right");
  const end = signalNodeAnchor(positions, dimensionsByNode, graphSize, to, "left");
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
  return peers.map((peer) => `${stripVisibleAppName(peer.appName)}${peer.source === "inferred" ? " inferred" : ""}`).join(", ");
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

type CollapsibleRailSectionProps = {
  children: ReactNode;
  collapsed: boolean;
  icon: typeof Activity;
  id: RailSectionId;
  onToggle: () => void;
  title: string;
};

function CollapsibleRailSection({ children, collapsed, icon: Icon, id, onToggle, title }: CollapsibleRailSectionProps) {
  const bodyId = `rail-section-${id}`;

  return (
    <section className={collapsed ? "rail-section collapsed" : "rail-section"}>
      <button
        aria-controls={bodyId}
        aria-expanded={!collapsed}
        className="section-heading section-toggle"
        onClick={onToggle}
        title={`${collapsed ? "Show" : "Hide"} ${title}`}
        type="button"
      >
        <span>{title}</span>
        <span className="section-heading-icons">
          <Icon size={16} />
          <ChevronDown className="section-chevron" size={15} />
        </span>
      </button>
      {!collapsed && (
        <div className="rail-section-body" id={bodyId}>
          {children}
        </div>
      )}
    </section>
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
