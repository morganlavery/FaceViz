const { app, ipcMain, systemPreferences } = require("electron");
const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

let syphonProcess = null;
let syphonLastError = "";
let syphonHasClients = false;
let syphonClientSignalAt = 0;
let syphonWriteBusy = false;
let spoutProcess = null;
let spoutLastError = "";
let spoutWriteBusy = false;
let spoutPublishedAt = 0;

const isSyphonRunning = () => Boolean(syphonProcess && !syphonProcess.killed && syphonProcess.exitCode === null);
const isSpoutRunning = () => Boolean(spoutProcess && !spoutProcess.killed && spoutProcess.exitCode === null);

const logNativeOutput = (target, message) => {
  const logPath = path.join(app.getPath("logs"), `${target}.log`);
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
    logNativeOutput("syphon", `[process-scan-error] ${error.message}`);
    return [];
  }
};

const getRunningSyphonConsumers = () => {
  const processNames = getRunningProcessNames();
  return knownSyphonConsumers
    .filter((consumer) => processNames.some((name) => consumer.patterns.some((pattern) => pattern.test(name))))
    .map((consumer) => consumer.appName);
};

const syphonPeer = ({ appName, status, source, detail, serverName = "INFINIGHTCapture Output" }) => ({
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
          detail: "Syphon reports a client attached to INFINIGHTCapture Output."
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
          detail: "App is running; no attached INFINIGHTCapture Output client reported yet."
        })
      )
    );
  }

  return {
    outputName: "INFINIGHTCapture Output",
    inputName: "INFINIGHTCapture Input",
    hasOutputClients: syphonHasClients,
    outputConsumers,
    inputSources: [],
    detail: isSyphonRunning()
      ? syphonHasClients
        ? "INFINIGHTCapture Output has at least one attached Syphon client."
        : "INFINIGHTCapture Output is publishing and waiting for a Syphon client."
      : "Start Syphon Output to publish INFINIGHTCapture Output.",
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

const findSpoutHelper = () => {
  const candidates = [
    path.join(process.resourcesPath || "", "SpoutFramePublisher.exe"),
    path.join(app.getAppPath(), "native/build/SpoutFramePublisher.exe"),
    path.join(__dirname, "../native/build/SpoutFramePublisher.exe"),
    path.join(process.cwd(), "native/build/SpoutFramePublisher.exe")
  ];

  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
};

const findSpoutLibraryDirectory = () => {
  const candidates = [
    process.resourcesPath || "",
    path.join(app.getAppPath(), "native/build"),
    path.join(__dirname, "../native/build"),
    path.join(process.cwd(), "native/build"),
    path.join(app.getAppPath(), "native/vendor/Spout2"),
    path.join(process.cwd(), "native/vendor/Spout2")
  ];

  return candidates.find((candidate) => candidate && fs.existsSync(path.join(candidate, "SpoutLibrary.dll")));
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
            ? "Publishing as INFINIGHTCapture Output"
            : "Ready to publish INFINIGHTCapture Output"
          : "Syphon is macOS-only"
    },
    {
      target: "spout",
      available: platform === "win32",
      state: platform === "win32" ? (isSpoutRunning() ? "publishing" : "bridge-ready") : "unavailable",
      detail:
        platform === "win32"
          ? isSpoutRunning()
            ? "Publishing as INFINIGHTCapture Output"
            : "Ready to publish INFINIGHTCapture Output"
          : "Spout is Windows-only"
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
    framePublisher: isSyphonRunning() || isSpoutRunning() ? "active" : "planned"
  },
  outputs: outputStatusForPlatform(),
  syphon: getSyphonStatus()
});

const validateFrame = (target, frame) => {
  const width = Number(frame?.width);
  const height = Number(frame?.height);
  const pixels = frame?.pixels;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || !pixels) {
    return {
      ok: false,
      target,
      reason: `${target === "syphon" ? "Syphon" : "Spout"} frame payload is invalid.`
    };
  }

  const pixelBuffer = Buffer.from(pixels);
  const expectedBytes = width * height * 4;
  if (pixelBuffer.length !== expectedBytes) {
    return {
      ok: false,
      target,
      reason: `${target === "syphon" ? "Syphon" : "Spout"} frame byte count mismatch: expected ${expectedBytes}, got ${pixelBuffer.length}.`
    };
  }

  return {
    ok: true,
    width,
    height,
    pixelBuffer
  };
};

const writeFramePacket = ({ target, processHandle, frame, busy, setBusy }) => {
  if (busy()) {
    return {
      ok: true,
      target
    };
  }

  const validated = validateFrame(target, frame);
  if (!validated.ok) {
    return validated;
  }

  const prefix = Buffer.allocUnsafe(20);
  prefix.writeUInt32BE(16 + validated.pixelBuffer.length, 0);
  prefix.writeUInt32BE(0x46565a31, 4);
  prefix.writeUInt32BE(validated.width, 8);
  prefix.writeUInt32BE(validated.height, 12);
  prefix.writeUInt32BE(validated.pixelBuffer.length, 16);
  setBusy(true);
  processHandle.stdin.write(prefix);
  const flushed = processHandle.stdin.write(validated.pixelBuffer);
  if (flushed) {
    setImmediate(() => {
      setBusy(false);
    });
  } else {
    processHandle.stdin.once("drain", () => {
      setBusy(false);
    });
  }

  return {
    ok: true,
    target
  };
};

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
  logNativeOutput("syphon", `[spawn] ${helper}`);
  syphonProcess = spawn(helper, [], {
    stdio: ["pipe", "ignore", "pipe"],
    env: {
      ...process.env,
      INFINIGHTCAPTURE_SYPHON_NAME: "INFINIGHTCapture Output"
    }
  });
  logNativeOutput("syphon", `[pid] ${syphonProcess.pid}`);

  syphonProcess.stderr.on("data", (chunk) => {
    const message = String(chunk).trimEnd();
    logNativeOutput("syphon", message);
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
    logNativeOutput("syphon", `[error] ${error.message}`);
  });
  syphonProcess.on("exit", (code, signal) => {
    logNativeOutput("syphon", `[exit] code=${code} signal=${signal}`);
    syphonProcess = null;
    syphonWriteBusy = false;
  });

  return {
    ok: true,
    target: "syphon"
  };
};

const startSpoutOutput = () => {
  if (process.platform !== "win32") {
    return {
      ok: false,
      target: "spout",
      reason: "Spout output is only available on Windows."
    };
  }

  if (isSpoutRunning()) {
    return {
      ok: true,
      target: "spout"
    };
  }

  const helper = findSpoutHelper();
  if (!helper) {
    spoutLastError = "SpoutFramePublisher.exe is missing. Run npm run native:build:win on Windows.";
    return {
      ok: false,
      target: "spout",
      reason: spoutLastError
    };
  }

  const spoutLibraryDirectory = findSpoutLibraryDirectory();
  if (!spoutLibraryDirectory) {
    spoutLastError = "SpoutLibrary.dll is missing. Copy it to native/build or native/vendor/Spout2 before packaging.";
    return {
      ok: false,
      target: "spout",
      reason: spoutLastError
    };
  }

  spoutLastError = "";
  spoutWriteBusy = false;
  spoutPublishedAt = Date.now();
  logNativeOutput("spout", `[spawn] ${helper}`);
  spoutProcess = spawn(helper, [], {
    cwd: path.dirname(helper),
    stdio: ["pipe", "ignore", "pipe"],
    env: {
      ...process.env,
      PATH: `${spoutLibraryDirectory}${path.delimiter}${process.env.PATH || ""}`,
      INFINIGHTCAPTURE_SPOUT_NAME: "INFINIGHTCapture Output"
    }
  });
  logNativeOutput("spout", `[pid] ${spoutProcess.pid}`);

  spoutProcess.stderr.on("data", (chunk) => {
    const message = String(chunk).trimEnd();
    logNativeOutput("spout", message);
    if (/published-frame/i.test(message)) {
      spoutPublishedAt = Date.now();
    }
  });
  spoutProcess.on("error", (error) => {
    spoutLastError = error.message;
    logNativeOutput("spout", `[error] ${error.message}`);
  });
  spoutProcess.on("exit", (code, signal) => {
    logNativeOutput("spout", `[exit] code=${code} signal=${signal}`);
    spoutProcess = null;
    spoutWriteBusy = false;
  });

  return {
    ok: true,
    target: "spout"
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

const stopSpoutOutput = () => {
  if (spoutProcess) {
    spoutProcess.stdin.end();
    spoutProcess.kill();
    spoutProcess = null;
  }

  spoutWriteBusy = false;
  spoutPublishedAt = Date.now();

  return {
    ok: true,
    target: "spout"
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

  return writeFramePacket({
    target: "syphon",
    processHandle: syphonProcess,
    frame,
    busy: () => syphonWriteBusy,
    setBusy: (value) => {
      syphonWriteBusy = value;
    }
  });
};

const publishSpoutFrame = (frame) => {
  if (!isSpoutRunning()) {
    return {
      ok: false,
      target: "spout",
      reason: spoutLastError || "Spout output is not running."
    };
  }

  const result = writeFramePacket({
    target: "spout",
    processHandle: spoutProcess,
    frame,
    busy: () => spoutWriteBusy,
    setBusy: (value) => {
      spoutWriteBusy = value;
    }
  });
  if (result.ok) {
    spoutPublishedAt = Date.now();
  }
  return result;
};

const registerSystemBridge = () => {
  ipcMain.handle("infinightcapture:system-status", () => getSystemStatus());
  ipcMain.handle("infinightcapture:request-camera-access", () => requestCameraAccess());
  ipcMain.handle("infinightcapture:output-start", (_event, target) => {
    if (target === "syphon") return startSyphonOutput();
    if (target === "spout") return startSpoutOutput();
    return { ok: false, target, reason: "Unknown output target." };
  });
  ipcMain.handle("infinightcapture:output-stop", (_event, target) => {
    if (target === "syphon") return stopSyphonOutput();
    if (target === "spout") return stopSpoutOutput();
    return { ok: false, target };
  });
  ipcMain.handle("infinightcapture:output-frame", (_event, target, frame) => {
    if (target === "syphon") return publishSyphonFrame(frame);
    if (target === "spout") return publishSpoutFrame(frame);
    return { ok: false, target, reason: "Unknown output target." };
  });
};

module.exports = {
  getSystemStatus,
  registerSystemBridge
};
