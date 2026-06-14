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
let ndiProcess = null;
let ndiLastError = "";
let ndiWriteBusy = false;
let ndiPublishedAt = 0;

const OUTPUT_NAME = "INFINIGHTCapture Output";
const INPUT_NAME = "INFINIGHTCapture Input";
const nativeOutputBridgeContract = {
  protocol: "infinightcapture.raw-rgba.v1",
  lengthPrefix: "uint32be",
  frameHeaderBytes: 16,
  magic: "FVZ1",
  pixelFormat: "rgba8",
  byteOrder: "rgba",
  bytesPerPixel: 4,
  orientation: "top-left"
};

const isSyphonRunning = () => Boolean(syphonProcess && !syphonProcess.killed && syphonProcess.exitCode === null);
const isSpoutRunning = () => Boolean(spoutProcess && !spoutProcess.killed && spoutProcess.exitCode === null);
const isNdiRunning = () => Boolean(ndiProcess && !ndiProcess.killed && ndiProcess.exitCode === null);

const outputLabel = (target) => {
  if (target === "syphon") return "Syphon";
  if (target === "spout") return "Spout";
  if (target === "ndi") return "NDI";
  return "Output";
};

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

const nativePeer = ({ appName, status, source, detail, serverName = OUTPUT_NAME }) => ({
  id: `${appName}:${serverName}:${status}`,
  appName,
  serverName,
  status,
  source,
  detail
});

const getSyphonPeers = () => {
  const runningConsumers = getRunningSyphonConsumers();
  const outputConsumers = [];

  if (syphonHasClients) {
    if (runningConsumers.length > 0) {
      outputConsumers.push(
        ...runningConsumers.map((appName) =>
          nativePeer({
            appName,
            status: "connected",
            source: "inferred",
            detail: "Syphon reports an attached client while this app is running."
          })
        )
      );
    } else {
      outputConsumers.push(
        nativePeer({
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
        nativePeer({
          appName,
          status: "watching",
          source: "inferred",
          detail: "App is running; no attached INFINIGHTCapture Output client reported yet."
        })
      )
    );
  }

  return outputConsumers;
};

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

const findSpoutLibraryPath = () => {
  const directory = findSpoutLibraryDirectory();
  return directory ? path.join(directory, "SpoutLibrary.dll") : "";
};

const ndiExecutableName = () => (process.platform === "win32" ? "NDIFramePublisher.exe" : "NDIFramePublisher");

const findNdiHelper = () => {
  const executableName = ndiExecutableName();
  const candidates = [
    path.join(process.resourcesPath || "", executableName),
    path.join(app.getAppPath(), "native/build", executableName),
    path.join(__dirname, "../native/build", executableName),
    path.join(process.cwd(), "native/build", executableName)
  ];

  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
};

const getNdiRuntimeCandidates = () => {
  if (process.platform === "win32") {
    return [
      path.join(process.resourcesPath || "", "Processing.NDI.Lib.x64.dll"),
      path.join(app.getAppPath(), "native/build/Processing.NDI.Lib.x64.dll"),
      path.join(__dirname, "../native/build/Processing.NDI.Lib.x64.dll"),
      path.join(process.cwd(), "native/build/Processing.NDI.Lib.x64.dll"),
      path.join(process.env.NDI_RUNTIME_DIR || "", "Processing.NDI.Lib.x64.dll")
    ];
  }

  if (process.platform === "darwin") {
    return [
      path.join(process.resourcesPath || "", "libndi.dylib"),
      path.join(app.getAppPath(), "native/build/libndi.dylib"),
      path.join(__dirname, "../native/build/libndi.dylib"),
      path.join(process.cwd(), "native/build/libndi.dylib"),
      path.join(process.env.NDI_RUNTIME_DIR || "", "libndi.dylib"),
      "/usr/local/lib/libndi.dylib",
      "/opt/homebrew/lib/libndi.dylib"
    ];
  }

  return [
    path.join(process.resourcesPath || "", "libndi.so"),
    path.join(app.getAppPath(), "native/build/libndi.so"),
    path.join(__dirname, "../native/build/libndi.so"),
    path.join(process.cwd(), "native/build/libndi.so"),
    path.join(process.env.NDI_RUNTIME_DIR || "", "libndi.so"),
    "/usr/local/lib/libndi.so",
    "/usr/lib/libndi.so"
  ];
};

const findNdiRuntimePath = () => getNdiRuntimeCandidates().find((candidate) => candidate && fs.existsSync(candidate)) || "";

const isSupportedOutputPlatform = (target) => {
  if (target === "syphon") return process.platform === "darwin";
  if (target === "spout") return process.platform === "win32";
  if (target === "ndi") return process.platform === "darwin" || process.platform === "win32" || process.platform === "linux";
  return false;
};

const getOutputHelperPath = (target) => {
  if (target === "syphon") return findSyphonHelper();
  if (target === "spout") return findSpoutHelper();
  if (target === "ndi") return findNdiHelper();
  return "";
};

const getOutputRuntimePath = (target, helperPath) => {
  if (target === "syphon") return helperPath;
  if (target === "spout") return findSpoutLibraryPath();
  if (target === "ndi") return findNdiRuntimePath();
  return "";
};

const isOutputRunning = (target) => {
  if (target === "syphon") return isSyphonRunning();
  if (target === "spout") return isSpoutRunning();
  if (target === "ndi") return isNdiRunning();
  return false;
};

const getOutputLastError = (target) => {
  if (target === "syphon") return syphonLastError;
  if (target === "spout") return spoutLastError;
  if (target === "ndi") return ndiLastError;
  return "";
};

const getOutputLastFrameAt = (target) => {
  if (target === "syphon") return syphonClientSignalAt || undefined;
  if (target === "spout") return spoutPublishedAt || undefined;
  if (target === "ndi") return ndiPublishedAt || undefined;
  return undefined;
};

const getOutputPlatformDetail = (target) => {
  if (target === "syphon") return "macOS-only";
  if (target === "spout") return "Windows-only";
  if (target === "ndi") return "available on macOS, Windows, and Linux";
  return "unsupported";
};

const getOutputHelperName = (target) => {
  if (target === "syphon") return "SyphonFramePublisher";
  if (target === "spout") return "SpoutFramePublisher.exe";
  if (target === "ndi") return ndiExecutableName();
  return "native output helper";
};

const getMissingRuntimeDetail = (target) => {
  if (target === "spout") return "SpoutLibrary.dll is missing.";
  if (target === "ndi") return "NDI runtime library is missing. Install the NDI SDK/runtime or copy it to native/build.";
  return `${outputLabel(target)} runtime is missing.`;
};

const getNativeOutputStatus = (target) => {
  const isSyphon = target === "syphon";
  const label = outputLabel(target);
  const supportedPlatform = isSupportedOutputPlatform(target);
  const helperPath = getOutputHelperPath(target);
  const runtimePath = getOutputRuntimePath(target, helperPath);
  const helperBuilt = Boolean(helperPath);
  const runtimeAvailable = target === "syphon" ? helperBuilt : Boolean(runtimePath);
  const running = isOutputRunning(target);
  const lastError = getOutputLastError(target);
  const missing = supportedPlatform && (!helperBuilt || !runtimeAvailable);
  const blocked = supportedPlatform && !running && !missing && Boolean(lastError);
  const outputConsumers = isSyphon ? getSyphonPeers() : [];
  const lastFrameAt = getOutputLastFrameAt(target);

  let state = "unsupported";
  if (supportedPlatform) {
    if (running) {
      state = "running";
    } else if (blocked) {
      state = "blocked";
    } else if (missing) {
      state = "missing";
    } else if (helperBuilt && runtimeAvailable) {
      state = "built";
    } else {
      state = "available";
    }
  }

  let detail = `${label} is ${getOutputPlatformDetail(target)}.`;
  if (supportedPlatform) {
    if (running) {
      detail = `${label} is publishing as ${OUTPUT_NAME}.`;
    } else if (blocked) {
      detail = lastError;
    } else if (!helperBuilt) {
      detail = `${getOutputHelperName(target)} is missing.`;
    } else if (!runtimeAvailable) {
      detail = getMissingRuntimeDetail(target);
    } else {
      detail = `${label} helper is built and ready.`;
    }
  }

  return {
    target,
    label,
    outputName: OUTPUT_NAME,
    inputName: INPUT_NAME,
    supportedPlatform,
    bridgeAvailable: true,
    helperBuilt,
    runtimeAvailable,
    running,
    blocked,
    missing,
    state,
    detail,
    helperPath: helperPath || undefined,
    runtimePath: runtimePath || undefined,
    lastError: lastError || undefined,
    lastFrameAt,
    updatedAt: Date.now(),
    outputConsumers,
    inputSources: []
  };
};

const getNativeOutputStatuses = () => [
  getNativeOutputStatus("syphon"),
  getNativeOutputStatus("spout"),
  getNativeOutputStatus("ndi")
];

const outputStatusForPlatform = () => {
  return getNativeOutputStatuses().map((status) => ({
    target: status.target,
    available:
      status.supportedPlatform &&
      status.bridgeAvailable &&
      status.helperBuilt &&
      status.runtimeAvailable &&
      !status.blocked,
    state:
      status.state === "running"
        ? "publishing"
        : status.state === "built" || status.state === "available"
          ? "bridge-ready"
          : status.state === "unsupported"
            ? "unavailable"
            : status.state,
    detail: status.detail
  }));
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
    version: 2,
    framePublisher: isSyphonRunning() || isSpoutRunning() || isNdiRunning() ? "active" : "planned",
    outputContract: nativeOutputBridgeContract
  },
  outputs: outputStatusForPlatform(),
  nativeOutputs: getNativeOutputStatuses(),
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
      reason: `${outputLabel(target)} frame payload is invalid.`
    };
  }

  const pixelBuffer = Buffer.from(pixels);
  const expectedBytes = width * height * 4;
  if (pixelBuffer.length !== expectedBytes) {
    return {
      ok: false,
      target,
      reason: `${outputLabel(target)} frame byte count mismatch: expected ${expectedBytes}, got ${pixelBuffer.length}.`
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
      INFINIGHTCAPTURE_SYPHON_NAME: OUTPUT_NAME
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
      INFINIGHTCAPTURE_SPOUT_NAME: OUTPUT_NAME
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

const startNdiOutput = () => {
  if (!isSupportedOutputPlatform("ndi")) {
    return {
      ok: false,
      target: "ndi",
      reason: "NDI output is available on macOS, Windows, and Linux."
    };
  }

  if (isNdiRunning()) {
    return {
      ok: true,
      target: "ndi"
    };
  }

  const helper = findNdiHelper();
  if (!helper) {
    ndiLastError = "NDIFramePublisher is missing. Run npm run native:build:ndi after installing the NDI SDK.";
    return {
      ok: false,
      target: "ndi",
      reason: ndiLastError
    };
  }

  const ndiRuntimePath = findNdiRuntimePath();
  if (!ndiRuntimePath) {
    ndiLastError = "NDI runtime library is missing. Install the NDI runtime or copy it to native/build.";
    return {
      ok: false,
      target: "ndi",
      reason: ndiLastError
    };
  }

  ndiLastError = "";
  ndiWriteBusy = false;
  ndiPublishedAt = Date.now();
  const ndiRuntimeDirectory = path.dirname(ndiRuntimePath);
  logNativeOutput("ndi", `[spawn] ${helper}`);
  ndiProcess = spawn(helper, [], {
    cwd: path.dirname(helper),
    stdio: ["pipe", "ignore", "pipe"],
    env: {
      ...process.env,
      PATH: `${ndiRuntimeDirectory}${path.delimiter}${process.env.PATH || ""}`,
      LD_LIBRARY_PATH: `${ndiRuntimeDirectory}${path.delimiter}${process.env.LD_LIBRARY_PATH || ""}`,
      DYLD_LIBRARY_PATH: `${ndiRuntimeDirectory}${path.delimiter}${process.env.DYLD_LIBRARY_PATH || ""}`,
      INFINIGHTCAPTURE_NDI_NAME: OUTPUT_NAME
    }
  });
  logNativeOutput("ndi", `[pid] ${ndiProcess.pid}`);

  ndiProcess.stderr.on("data", (chunk) => {
    const message = String(chunk).trimEnd();
    logNativeOutput("ndi", message);
    if (/published-frame/i.test(message)) {
      ndiPublishedAt = Date.now();
    }
  });
  ndiProcess.on("error", (error) => {
    ndiLastError = error.message;
    logNativeOutput("ndi", `[error] ${error.message}`);
  });
  ndiProcess.on("exit", (code, signal) => {
    logNativeOutput("ndi", `[exit] code=${code} signal=${signal}`);
    ndiProcess = null;
    ndiWriteBusy = false;
  });

  return {
    ok: true,
    target: "ndi"
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

const stopNdiOutput = () => {
  if (ndiProcess) {
    ndiProcess.stdin.end();
    ndiProcess.kill();
    ndiProcess = null;
  }

  ndiWriteBusy = false;
  ndiPublishedAt = Date.now();

  return {
    ok: true,
    target: "ndi"
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

const publishNdiFrame = (frame) => {
  if (!isNdiRunning()) {
    return {
      ok: false,
      target: "ndi",
      reason: ndiLastError || "NDI output is not running."
    };
  }

  const result = writeFramePacket({
    target: "ndi",
    processHandle: ndiProcess,
    frame,
    busy: () => ndiWriteBusy,
    setBusy: (value) => {
      ndiWriteBusy = value;
    }
  });
  if (result.ok) {
    ndiPublishedAt = Date.now();
  }
  return result;
};

const registerSystemBridge = () => {
  ipcMain.handle("infinightcapture:system-status", () => getSystemStatus());
  ipcMain.handle("infinightcapture:request-camera-access", () => requestCameraAccess());
  ipcMain.handle("infinightcapture:output-start", (_event, target) => {
    if (target === "syphon") return startSyphonOutput();
    if (target === "spout") return startSpoutOutput();
    if (target === "ndi") return startNdiOutput();
    return { ok: false, target, reason: "Unknown output target." };
  });
  ipcMain.handle("infinightcapture:output-stop", (_event, target) => {
    if (target === "syphon") return stopSyphonOutput();
    if (target === "spout") return stopSpoutOutput();
    if (target === "ndi") return stopNdiOutput();
    return { ok: false, target };
  });
  ipcMain.handle("infinightcapture:output-frame", (_event, target, frame) => {
    if (target === "syphon") return publishSyphonFrame(frame);
    if (target === "spout") return publishSpoutFrame(frame);
    if (target === "ndi") return publishNdiFrame(frame);
    return { ok: false, target, reason: "Unknown output target." };
  });
};

module.exports = {
  getSystemStatus,
  registerSystemBridge
};
