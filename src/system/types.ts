import type { OutputTarget } from "../output/outputTargets";

export type SystemOutputStatus = {
  target: OutputTarget;
  available: boolean;
  state: "bridge-ready" | "shell-required" | "unavailable" | "publishing" | "error";
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
  };
  outputs: SystemOutputStatus[];
  syphon?: SystemSyphonStatus;
};

export type CameraAccessResult = {
  granted: boolean;
  status: SystemStatus["cameraAccess"];
};

export type FaceVizSystemBridge = {
  getStatus: () => Promise<SystemStatus>;
  requestCameraAccess: () => Promise<CameraAccessResult>;
  startOutput: (target: OutputTarget) => Promise<{ ok: boolean; target: OutputTarget; reason?: string }>;
  stopOutput: (target: OutputTarget) => Promise<{ ok: boolean; target: OutputTarget }>;
  publishOutputFrame: (
    target: OutputTarget,
    frame: { width: number; height: number; pixels: ArrayBuffer }
  ) => Promise<{ ok: boolean; target: OutputTarget; reason?: string }>;
};
