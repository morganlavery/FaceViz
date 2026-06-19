import type { OutputTarget } from "../output/outputTargets";

export type NativeOutputBridgeContract = {
  protocol: "infinightcapture.raw-rgba.v1";
  lengthPrefix: "uint32be";
  frameHeaderBytes: 16;
  magic: "FVZ1";
  pixelFormat: "rgba8";
  byteOrder: "rgba";
  bytesPerPixel: 4;
  orientation: "top-left";
};

export type SystemOutputStatus = {
  target: OutputTarget;
  available: boolean;
  state: "bridge-ready" | "shell-required" | "unavailable" | "publishing" | "error" | "missing" | "blocked";
  detail: string;
};

export type SystemSyphonPeer = {
  id: string;
  appName: string;
  serverName?: string;
  status: "connected" | "available" | "watching" | "inactive" | "unknown";
  source: "native" | "inferred" | "configured";
  detail: string;
};

export type SystemSyphonStatus = {
  outputName: string;
  inputName: string;
  hasOutputClients: boolean;
  outputConsumers: SystemSyphonPeer[];
  inputSources: SystemSyphonPeer[];
  detail: string;
  updatedAt: number;
};

export type SystemNativeOutputStatus = {
  target: OutputTarget;
  label: "Syphon" | "Spout" | "NDI";
  outputName: string;
  inputName: string;
  supportedPlatform: boolean;
  bridgeAvailable: boolean;
  helperBuilt: boolean;
  runtimeAvailable: boolean;
  running: boolean;
  blocked: boolean;
  missing: boolean;
  state: "available" | "built" | "running" | "blocked" | "missing" | "unsupported" | "shell-required";
  detail: string;
  helperPath?: string;
  runtimePath?: string;
  lastError?: string;
  lastFrameAt?: number;
  updatedAt: number;
  outputConsumers: SystemSyphonPeer[];
  inputSources: SystemSyphonPeer[];
};

export type SystemStatus = {
  runtime: "browser" | "electron";
  appVersion?: string;
  isPackaged?: boolean;
  platform: string;
  arch?: string;
  cameraAccess: "granted" | "denied" | "restricted" | "not-determined" | "system-managed" | "unknown";
  nativeBridge: {
    available: boolean;
    version?: number;
    framePublisher: "planned" | "active" | "unavailable";
    outputContract: NativeOutputBridgeContract;
  };
  outputs: SystemOutputStatus[];
  nativeOutputs: SystemNativeOutputStatus[];
  syphon?: SystemSyphonStatus;
};

export type CameraAccessResult = {
  granted: boolean;
  status: SystemStatus["cameraAccess"];
};

export type MobileFeedStatus = {
  available: boolean;
  sessionId: string;
  port: number;
  urls: string[];
  localUrls?: string[];
  secureUrl?: string;
  primaryUrl: string;
  tunnelError?: string;
  connected: boolean;
  hasOffer: boolean;
  hasAnswer: boolean;
  senderCandidateCount: number;
  receiverCandidateCount: number;
  updatedAt: number;
};

export type MobileFeedSignal = {
  ok: boolean;
  answer: RTCSessionDescriptionInit | null;
  candidates: RTCIceCandidateInit[];
  cursor: number;
  connected: boolean;
  updatedAt: number;
};

export type INFINIGHTCaptureSystemBridge = {
  getStatus: () => Promise<SystemStatus>;
  requestCameraAccess: () => Promise<CameraAccessResult>;
  startOutput: (target: OutputTarget) => Promise<{ ok: boolean; target: OutputTarget; reason?: string }>;
  stopOutput: (target: OutputTarget) => Promise<{ ok: boolean; target: OutputTarget }>;
  publishOutputFrame: (
    target: OutputTarget,
    frame: { width: number; height: number; pixels: ArrayBuffer }
  ) => Promise<{ ok: boolean; target: OutputTarget; reason?: string }>;
  getMobileFeedStatus: () => Promise<MobileFeedStatus>;
  prepareMobileFeedOffer: (offer: RTCSessionDescriptionInit) => Promise<MobileFeedStatus>;
  addMobileFeedReceiverCandidate: (candidate: RTCIceCandidateInit) => Promise<{ ok: boolean; cursor: number }>;
  pollMobileFeedSignal: (senderCandidateCursor: number) => Promise<MobileFeedSignal>;
  resetMobileFeedSession: () => Promise<MobileFeedStatus>;
  openExternalUrl: (url: string) => Promise<{ ok: boolean; reason?: string }>;
};
