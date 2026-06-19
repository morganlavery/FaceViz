import { getOutputStatuses, type OutputTarget } from "../output/outputTargets";
import type {
  CameraAccessResult,
  INFINIGHTCaptureSystemBridge,
  MobileFeedSignal,
  MobileFeedStatus,
  NativeOutputBridgeContract,
  SystemStatus
} from "./types";

declare global {
  interface Window {
    infinightCaptureSystem?: INFINIGHTCaptureSystemBridge;
  }
}

const platformLabel = () => {
  const platform = navigator.platform || "browser";
  if (/Mac/i.test(platform)) return "darwin";
  if (/Win/i.test(platform)) return "win32";
  if (/Linux/i.test(platform)) return "linux";
  return platform.toLowerCase();
};

export const nativeOutputBridgeContract: NativeOutputBridgeContract = {
  protocol: "infinightcapture.raw-rgba.v1",
  lengthPrefix: "uint32be",
  frameHeaderBytes: 16,
  magic: "FVZ1",
  pixelFormat: "rgba8",
  byteOrder: "rgba",
  bytesPerPixel: 4,
  orientation: "top-left"
};

export const getBrowserSystemStatus = (): SystemStatus => ({
  runtime: "browser",
  platform: platformLabel(),
  cameraAccess: "unknown",
  nativeBridge: {
    available: false,
    framePublisher: "unavailable",
    outputContract: nativeOutputBridgeContract
  },
  outputs: getOutputStatuses().map((status) => ({
    target: status.target,
    available: false,
    state: status.available ? "shell-required" : "unavailable",
    detail: status.available ? "Requires the Electron system shell" : status.detail
  })),
  nativeOutputs: getOutputStatuses().map((status) => ({
    target: status.target,
    label: status.label,
    outputName: "INFINIGHTCapture Output",
    inputName: "INFINIGHTCapture Input",
    supportedPlatform: status.available,
    bridgeAvailable: false,
    helperBuilt: false,
    runtimeAvailable: false,
    running: false,
    blocked: false,
    missing: false,
    state: status.available ? "shell-required" : "unsupported",
    detail: status.available ? "Requires the Electron system shell" : status.detail,
    updatedAt: Date.now(),
    outputConsumers: [],
    inputSources: []
  })),
  syphon: {
    outputName: "INFINIGHTCapture Output",
    inputName: "INFINIGHTCapture Input",
    hasOutputClients: false,
    outputConsumers: [],
    inputSources: [],
    detail: "Open the Electron app to inspect native output signal state.",
    updatedAt: Date.now()
  }
});

export const getSystemStatus = async (): Promise<SystemStatus> => {
  if (window.infinightCaptureSystem) {
    return window.infinightCaptureSystem.getStatus();
  }

  return getBrowserSystemStatus();
};

export const requestSystemCameraAccess = async (): Promise<CameraAccessResult> => {
  if (window.infinightCaptureSystem) {
    return window.infinightCaptureSystem.requestCameraAccess();
  }

  return {
    granted: true,
    status: "unknown"
  };
};

export const startSystemOutput = async (target: OutputTarget) => {
  if (!window.infinightCaptureSystem) {
    return {
      ok: false,
      target,
      reason: "Open the Electron app to publish native output."
    };
  }

  return window.infinightCaptureSystem.startOutput(target);
};

export const stopSystemOutput = async (target: OutputTarget) => {
  if (!window.infinightCaptureSystem) {
    return {
      ok: true,
      target
    };
  }

  return window.infinightCaptureSystem.stopOutput(target);
};

export const publishSystemOutputFrame = async (
  target: OutputTarget,
  frame: { width: number; height: number; pixels: ArrayBuffer }
) => {
  if (!window.infinightCaptureSystem) {
    return {
      ok: false,
      target,
      reason: "Open the Electron app to publish native output."
    };
  }

  return window.infinightCaptureSystem.publishOutputFrame(target, frame);
};

const unavailableMobileFeedStatus = (): MobileFeedStatus => ({
  available: false,
  sessionId: "",
  port: 0,
  urls: [],
  primaryUrl: "",
  connected: false,
  hasOffer: false,
  hasAnswer: false,
  senderCandidateCount: 0,
  receiverCandidateCount: 0,
  updatedAt: Date.now()
});

export const getMobileFeedStatus = async (): Promise<MobileFeedStatus> => {
  if (!window.infinightCaptureSystem) {
    return unavailableMobileFeedStatus();
  }

  return window.infinightCaptureSystem.getMobileFeedStatus();
};

export const prepareMobileFeedOffer = async (offer: RTCSessionDescriptionInit): Promise<MobileFeedStatus> => {
  if (!window.infinightCaptureSystem) {
    return unavailableMobileFeedStatus();
  }

  return window.infinightCaptureSystem.prepareMobileFeedOffer(offer);
};

export const addMobileFeedReceiverCandidate = async (candidate: RTCIceCandidateInit) => {
  if (!window.infinightCaptureSystem) {
    return {
      ok: false,
      cursor: 0
    };
  }

  return window.infinightCaptureSystem.addMobileFeedReceiverCandidate(candidate);
};

export const pollMobileFeedSignal = async (senderCandidateCursor: number): Promise<MobileFeedSignal> => {
  if (!window.infinightCaptureSystem) {
    return {
      ok: false,
      answer: null,
      candidates: [],
      cursor: senderCandidateCursor,
      connected: false,
      updatedAt: Date.now()
    };
  }

  return window.infinightCaptureSystem.pollMobileFeedSignal(senderCandidateCursor);
};

export const resetMobileFeedSession = async (): Promise<MobileFeedStatus> => {
  if (!window.infinightCaptureSystem) {
    return unavailableMobileFeedStatus();
  }

  return window.infinightCaptureSystem.resetMobileFeedSession();
};

export const openExternalUrl = (url: string) => {
  if (!window.infinightCaptureSystem) {
    window.open(url, "_blank", "noopener,noreferrer");
    return Promise.resolve({ ok: true });
  }

  return window.infinightCaptureSystem.openExternalUrl(url);
};
