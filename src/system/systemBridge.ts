import { getOutputStatuses } from "../output/outputTargets";
import type { CameraAccessResult, FaceVizSystemBridge, SystemStatus } from "./types";

declare global {
  interface Window {
    faceVizSystem?: FaceVizSystemBridge;
  }
}

const platformLabel = () => {
  const platform = navigator.platform || "browser";
  if (/Mac/i.test(platform)) return "darwin";
  if (/Win/i.test(platform)) return "win32";
  if (/Linux/i.test(platform)) return "linux";
  return platform.toLowerCase();
};

export const getBrowserSystemStatus = (): SystemStatus => ({
  runtime: "browser",
  platform: platformLabel(),
  cameraAccess: "unknown",
  nativeBridge: {
    available: false,
    framePublisher: "unavailable"
  },
  outputs: getOutputStatuses().map((status) => ({
    target: status.target,
    available: false,
    state: status.available ? "shell-required" : "unavailable",
    detail: status.available ? "Requires the Electron system shell" : status.detail
  })),
  syphon: {
    outputName: "FaceViz Output",
    inputName: "FaceViz Input",
    hasOutputClients: false,
    outputConsumers: [],
    inputSources: [],
    detail: "Open the Electron app to inspect native Syphon signal state.",
    updatedAt: Date.now()
  }
});

export const getSystemStatus = async (): Promise<SystemStatus> => {
  if (window.faceVizSystem) {
    return window.faceVizSystem.getStatus();
  }

  return getBrowserSystemStatus();
};

export const requestSystemCameraAccess = async (): Promise<CameraAccessResult> => {
  if (window.faceVizSystem) {
    return window.faceVizSystem.requestCameraAccess();
  }

  return {
    granted: true,
    status: "unknown"
  };
};

export const startSystemOutput = async (target: "syphon" | "spout") => {
  if (!window.faceVizSystem) {
    return {
      ok: false,
      target,
      reason: "Open the Electron app to publish Syphon or Spout output."
    };
  }

  return window.faceVizSystem.startOutput(target);
};

export const stopSystemOutput = async (target: "syphon" | "spout") => {
  if (!window.faceVizSystem) {
    return {
      ok: true,
      target
    };
  }

  return window.faceVizSystem.stopOutput(target);
};

export const publishSystemOutputFrame = async (
  target: "syphon" | "spout",
  frame: { width: number; height: number; pixels: ArrayBuffer }
) => {
  if (!window.faceVizSystem) {
    return {
      ok: false,
      target,
      reason: "Open the Electron app to publish Syphon or Spout output."
    };
  }

  return window.faceVizSystem.publishOutputFrame(target, frame);
};
