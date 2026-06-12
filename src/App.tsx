import { FilesetResolver, HandLandmarker, PoseLandmarker } from "@mediapipe/tasks-vision";
import {
  Activity,
  Aperture,
  BadgeCheck,
  Camera,
  Cpu,
  Expand,
  Fingerprint,
  Flame,
  Hand,
  Leaf,
  Loader2,
  Maximize2,
  MonitorCog,
  Orbit,
  Pause,
  Play,
  RadioTower,
  ScanFace,
  Settings2,
  ShieldAlert,
  Sparkles,
  Star,
  Waves
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { getOutputStatuses, getPreferredOutput, type OutputTarget } from "./output/outputTargets";
import { renderFrame } from "./rendering/compositor";
import {
  getSystemStatus,
  publishSystemOutputFrame,
  requestSystemCameraAccess,
  startSystemOutput,
  stopSystemOutput
} from "./system/systemBridge";
import type { SystemStatus, SystemSyphonPeer } from "./system/types";
import { analyzeMotion, buildTrackedHand, buildTrackedPose } from "./tracking/gestureEngine";
import type { Handedness, Landmark, MotionFrame, PreviousHandSample } from "./tracking/types";

type CaptureState = "idle" | "loading" | "running" | "error";
type CameraIssue = "blocked" | "missing" | "browser" | null;
type WorkspaceTab = "preview" | "signal";
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

const effects = [
  { id: "auto", label: "Auto", icon: Sparkles },
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
  { id: "signal", label: "Signal" }
];

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
      message: "Camera access is blocked for FaceViz."
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
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const poseLandmarkerRef = useRef<PoseLandmarker | null>(null);
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
  const compositorOptionsRef = useRef({
    showRig: true,
    effectAmount: 0.82,
    selectedEffect: "auto"
  });
  const outputCompositorOptionsRef = useRef({
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
  const [showRigInOutput, setShowRigInOutput] = useState(true);
  const [outputPerformanceMode, setOutputPerformanceMode] = useState<OutputPerformanceMode>("max");
  const [effectAmount, setEffectAmount] = useState(0.82);
  const [selectedEffect, setSelectedEffect] = useState("auto");
  const [outputTarget, setOutputTarget] = useState<OutputTarget>(getPreferredOutput);
  const [isOutputStreaming, setIsOutputStreaming] = useState(false);
  const [outputError, setOutputError] = useState("");
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceTab>("preview");
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
      poseLandmarkerRef.current
    ) {
      lastVideoTimeRef.current = video.currentTime;
      try {
        const handResults = handLandmarkerRef.current.detectForVideo(video, now);
        const poseResults = poseLandmarkerRef.current.detectForVideo(video, now);
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
        const nextMotion = analyzeMotion(hands, pose, now);
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
        const error = new DOMException("Camera access is blocked for FaceViz.", "NotAllowedError");
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

      if (!handLandmarkerRef.current || !poseLandmarkerRef.current) {
        const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
        const [handLandmarker, poseLandmarker] = await Promise.all([
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
          })
        ]);
        handLandmarkerRef.current = handLandmarker;
        poseLandmarkerRef.current = poseLandmarker;
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
    outputTargetRef.current = outputTarget;
  }, [outputTarget]);

  useEffect(() => {
    outputFrameIntervalRef.current = 1000 / selectedPerformanceMode.fps;
  }, [selectedPerformanceMode.fps]);

  useEffect(() => {
    compositorOptionsRef.current = {
      showRig,
      effectAmount: reducedMotion ? Math.min(effectAmount, 0.4) : effectAmount,
      selectedEffect
    };
    outputCompositorOptionsRef.current = {
      showRig: showRigInOutput,
      effectAmount: reducedMotion ? Math.min(effectAmount, 0.4) : effectAmount,
      selectedEffect
    };
  }, [effectAmount, reducedMotion, selectedEffect, showRig, showRigInOutput]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(renderLoop);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      handLandmarkerRef.current?.close();
      poseLandmarkerRef.current?.close();
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
        style={{ width: selectedPerformanceMode.width, height: selectedPerformanceMode.height }}
        aria-hidden="true"
      />

      <section className="workspace">
        <header className="topbar">
          <div className="brand-lockup">
            <div className="brand-mark">
              <ScanFace size={22} />
            </div>
            <div>
              <p className="eyebrow">FaceViz</p>
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
          {workspaceTabs.map((tab) => (
            <button
              key={tab.id}
              className={activeWorkspace === tab.id ? "workspace-tab active" : "workspace-tab"}
              onClick={() => setActiveWorkspace(tab.id)}
              type="button"
            >
              {tab.id === "preview" ? <ScanFace size={15} /> : <Activity size={15} />}
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>

        <section
          className={activeWorkspace === "preview" ? "stage-panel" : "stage-panel preview-stage-hidden"}
          aria-hidden={activeWorkspace !== "preview"}
        >
          <div className="stage-toolbar">
            <div className="hud-badge">
              <span>Authority</span>
              <strong>{selectedOutput?.label ?? "Output"}</strong>
            </div>
            <div className="hud-badge align-right">
              <span>Mode</span>
              <strong>{mode === "upper" ? "Upper Body" : "Full Body"}</strong>
            </div>
          </div>
          <canvas ref={canvasRef} className="preview-canvas" aria-label="FaceViz composited preview" />
          {captureState !== "running" && <EmptyState captureState={captureState} cameraIssue={cameraIssue} />}
        </section>

        {activeWorkspace === "preview" ? (
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
                    <li>Reload FaceViz, then press Start again.</li>
                    <li>For the desktop shell, allow camera access for Electron or FaceViz in macOS settings.</li>
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
          <label className="toggle-row">
            <span>Wireframe in Syphon</span>
            <input
              type="checkbox"
              checked={showRigInOutput}
              onChange={(event) => setShowRigInOutput(event.target.checked)}
            />
          </label>
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
            <span>Effects</span>
            <Sparkles size={16} />
          </div>
          <div className="effect-list">
            {effects.map((effect) => {
              const Icon = effect.icon;
              return (
                <button
                  key={effect.id}
                  className={selectedEffect === effect.id ? "effect-button active" : "effect-button"}
                  onClick={() => setSelectedEffect(effect.id)}
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
    (isOutputStreaming ? "FaceViz Output is visible on the Syphon bus." : "Waiting for FaceViz Output.");
  const outputState = selectedSystemOutput?.state ?? (isOutputStreaming ? "publishing" : "bridge-ready");
  const outputName = syphon?.outputName ?? "FaceViz Output";
  const inputName = syphon?.inputName ?? "FaceViz Input";
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
          eyebrow="FaceViz"
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
