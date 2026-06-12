const { app, ipcMain, systemPreferences } = require("electron");
const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

let syphonProcess = null;
let syphonLastError = "";
let syphonHasClients = false;
let syphonClientSignalAt = 0;
let syphonWriteBusy = false;

const isSyphonRunning = () => Boolean(syphonProcess && !syphonProcess.killed && syphonProcess.exitCode === null);

const logNativeOutput = (message) => {
  const logPath = path.join(app.getPath("logs"), "syphon.log");
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`);
};

const knownSyphonConsumers = [
  { appName: "Resolume", patterns: [/Resolume/i] },
  { appName: "TouchDesigner", patterns: [/TouchDesigner/i] },
  { appName: "VDMX", patterns: [/VDMX/i] },
  { appName: "MadMapper", patterns: [/MadMapper/i] },
  { appName: "Millumin", patterns: [/Millumin/i] },
  { appName: "QLab", patterns: [/QLab/i] }
];

const getRunningProcessNames = () => {
  if (process.platform !== "darwin") {
    return [];
  }

  try {
    return execFileSync("/bin/ps", ["-axo", "comm="], { encoding: "utf8", timeout: 800 })
      .split("\n")
      .map((line) => path.basename(line.trim()))
      .filter(Boolean);
  } catch (error) {
    logNativeOutput(`[process-scan-error] ${error.message}`);
    return [];
  }
};

const getRunningSyphonConsumers = () => {
  const processNames = getRunningProcessNames();
  return knownSyphonConsumers
    .filter((consumer) => processNames.some((name) => consumer.patterns.some((pattern) => pattern.test(name))))
    .map((consumer) => consumer.appName);
};

const syphonPeer = ({ appName, status, source, detail, serverName = "FaceViz Output" }) => ({
  id: `${appName}:${serverName}:${status}`,
  appName,
  serverName,
  status,
  source,
  detail
});

const getSyphonStatus = () => {
  const runningConsumers = getRunningSyphonConsumers();
  const outputConsumers = [];

  if (syphonHasClients) {
    if (runningConsumers.length > 0) {
      outputConsumers.push(
        ...runningConsumers.map((appName) =>
          syphonPeer({
            appName,
            status: "connected",
            source: "inferred",
            detail: "Syphon reports an attached client while this app is running."
          })
        )
      );
    } else {
      outputConsumers.push(
        syphonPeer({
          appName: "Unknown Syphon client",
          status: "connected",
          source: "native",
          detail: "Syphon reports a client attached to FaceViz Output."
        })
      );
    }
  } else if (runningConsumers.length > 0) {
    outputConsumers.push(
      ...runningConsumers.map((appName) =>
        syphonPeer({
          appName,
          status: "watching",
          source: "inferred",
          detail: "App is running; no attached FaceViz Output client reported yet."
        })
      )
    );
  }

  return {
    outputName: "FaceViz Output",
    inputName: "FaceViz Input",
    hasOutputClients: syphonHasClients,
    outputConsumers,
    inputSources: [],
    detail: isSyphonRunning()
      ? syphonHasClients
        ? "FaceViz Output has at least one attached Syphon client."
        : "FaceViz Output is publishing and waiting for a Syphon client."
      : "Start Syphon Output to publish FaceViz Output.",
    updatedAt: syphonClientSignalAt || Date.now()
  };
};

const findSyphonHelper = () => {
  const candidates = [
    path.join(process.resourcesPath || "", "SyphonFramePublisher"),
    path.join(app.getAppPath(), "native/build/SyphonFramePublisher"),
    path.join(__dirname, "../native/build/SyphonFramePublisher"),
    path.join(process.cwd(), "native/build/SyphonFramePublisher")
  ];

  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
};

const outputStatusForPlatform = () => {
  const platform = process.platform;

  return [
    {
      target: "syphon",
      available: platform === "darwin",
      state: platform === "darwin" ? (isSyphonRunning() ? "publishing" : "bridge-ready") : "unavailable",
      detail:
        platform === "darwin"
          ? isSyphonRunning()
            ? "Publishing as FaceViz Output"
            : "Ready to publish FaceViz Output"
          : "Syphon is macOS-only"
    },
    {
      target: "spout",
      available: platform === "win32",
      state: platform === "win32" ? "bridge-ready" : "unavailable",
      detail: platform === "win32" ? "Windows native sender boundary ready" : "Spout is Windows-only"
    }
  ];
};

const getCameraAccessStatus = () => {
  if (process.platform !== "darwin") {
    return "system-managed";
  }

  return systemPreferences.getMediaAccessStatus("camera");
};

const getSystemStatus = () => ({
  runtime: "electron",
  appVersion: app.getVersion(),
  isPackaged: app.isPackaged,
  platform: process.platform,
  arch: process.arch,
  cameraAccess: getCameraAccessStatus(),
  nativeBridge: {
    available: true,
    version: 1,
    framePublisher: isSyphonRunning() ? "active" : "planned"
  },
  outputs: outputStatusForPlatform(),
  syphon: getSyphonStatus()
});

const requestCameraAccess = async () => {
  if (process.platform !== "darwin") {
    return {
      granted: true,
      status: "system-managed"
    };
  }

  const status = systemPreferences.getMediaAccessStatus("camera");
  if (status === "granted") {
    return {
      granted: true,
      status
    };
  }

  if (status === "denied" || status === "restricted") {
    return {
      granted: false,
      status
    };
  }

  const granted = await systemPreferences.askForMediaAccess("camera");
  return {
    granted,
    status: systemPreferences.getMediaAccessStatus("camera")
  };
};

const startSyphonOutput = () => {
  if (process.platform !== "darwin") {
    return {
      ok: false,
      target: "syphon",
      reason: "Syphon output is only available on macOS."
    };
  }

  if (isSyphonRunning()) {
    return {
      ok: true,
      target: "syphon"
    };
  }

  const helper = findSyphonHelper();
  if (!helper) {
    syphonLastError = "SyphonFramePublisher is missing. Run npm run native:build.";
    return {
      ok: false,
      target: "syphon",
      reason: syphonLastError
    };
  }

  syphonLastError = "";
  syphonHasClients = false;
  syphonClientSignalAt = Date.now();
  syphonWriteBusy = false;
  logNativeOutput(`[spawn] ${helper}`);
  syphonProcess = spawn(helper, [], {
    stdio: ["pipe", "ignore", "pipe"],
    env: {
      ...process.env,
      FACEVIZ_SYPHON_NAME: "FaceViz Output"
    }
  });
  logNativeOutput(`[pid] ${syphonProcess.pid}`);

  syphonProcess.stderr.on("data", (chunk) => {
    const message = String(chunk).trimEnd();
    logNativeOutput(message);
    for (const line of message.split("\n")) {
      const match = line.match(/clients=(0|1)/);
      if (match) {
        syphonHasClients = match[1] === "1";
        syphonClientSignalAt = Date.now();
      }
    }
  });
  syphonProcess.on("error", (error) => {
    syphonLastError = error.message;
    logNativeOutput(`[error] ${error.message}`);
  });
  syphonProcess.on("exit", (code, signal) => {
    logNativeOutput(`[exit] code=${code} signal=${signal}`);
    syphonProcess = null;
    syphonWriteBusy = false;
  });

  return {
    ok: true,
    target: "syphon"
  };
};

const stopSyphonOutput = () => {
  if (syphonProcess) {
    syphonProcess.stdin.end();
    syphonProcess.kill();
    syphonProcess = null;
  }

  syphonHasClients = false;
  syphonClientSignalAt = Date.now();
  syphonWriteBusy = false;

  return {
    ok: true,
    target: "syphon"
  };
};

const publishSyphonFrame = (frame) => {
  if (!isSyphonRunning()) {
    return {
      ok: false,
      target: "syphon",
      reason: syphonLastError || "Syphon output is not running."
    };
  }

  if (syphonWriteBusy) {
    return {
      ok: true,
      target: "syphon"
    };
  }

  const width = Number(frame?.width);
  const height = Number(frame?.height);
  const pixels = frame?.pixels;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || !pixels) {
    return {
      ok: false,
      target: "syphon",
      reason: "Syphon frame payload is invalid."
    };
  }

  const pixelBuffer = Buffer.from(pixels);
  const expectedBytes = width * height * 4;
  if (pixelBuffer.length !== expectedBytes) {
    return {
      ok: false,
      target: "syphon",
      reason: `Syphon frame byte count mismatch: expected ${expectedBytes}, got ${pixelBuffer.length}.`
    };
  }

  const header = Buffer.allocUnsafe(16);
  header.writeUInt32BE(0x46565a31, 0);
  header.writeUInt32BE(width, 4);
  header.writeUInt32BE(height, 8);
  header.writeUInt32BE(pixelBuffer.length, 12);
  const buffer = Buffer.concat([header, pixelBuffer], header.length + pixelBuffer.length);
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(buffer.length, 0);
  syphonWriteBusy = true;
  const flushed = syphonProcess.stdin.write(Buffer.concat([length, buffer], length.length + buffer.length));
  if (flushed) {
    setImmediate(() => {
      syphonWriteBusy = false;
    });
  } else {
    syphonProcess.stdin.once("drain", () => {
      syphonWriteBusy = false;
    });
  }

  return {
    ok: true,
    target: "syphon"
  };
};

const registerSystemBridge = () => {
  ipcMain.handle("faceviz:system-status", () => getSystemStatus());
  ipcMain.handle("faceviz:request-camera-access", () => requestCameraAccess());
  ipcMain.handle("faceviz:output-start", (_event, target) =>
    target === "syphon" ? startSyphonOutput() : { ok: false, target, reason: "Spout is not implemented yet." }
  );
  ipcMain.handle("faceviz:output-stop", (_event, target) =>
    target === "syphon" ? stopSyphonOutput() : { ok: true, target }
  );
  ipcMain.handle("faceviz:output-frame", (_event, target, frame) =>
    target === "syphon" ? publishSyphonFrame(frame) : { ok: false, target, reason: "Spout is not implemented yet." }
  );
};

module.exports = {
  getSystemStatus,
  registerSystemBridge
};
