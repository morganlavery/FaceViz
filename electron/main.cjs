const { app, BrowserWindow, session, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { registerSystemBridge } = require("./systemBridge.cjs");

const isTrustedAppOrigin = (origin = "") =>
  origin.startsWith("http://127.0.0.1:5173") ||
  origin.startsWith("http://localhost:5173") ||
  origin.startsWith("file://");

const configurePermissions = () => {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details = {}) => {
    const origin = details.requestingUrl || webContents.getURL();
    const wantsCamera =
      permission === "media" &&
      (!Array.isArray(details.mediaTypes) || details.mediaTypes.length === 0 || details.mediaTypes.includes("video"));
    callback(isTrustedAppOrigin(origin) && wantsCamera);
  });

  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details = {}) => {
    const origin = requestingOrigin || details.requestingUrl || webContents.getURL();
    return isTrustedAppOrigin(origin) && permission === "media";
  });
};

const createWindow = () => {
  const logPath = path.join(app.getPath("logs"), "renderer.log");
  const appendLog = (message) => {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`);
  };

  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 700,
    title: "INFINIGHTCapture",
    backgroundColor: "#060908",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
      sandbox: true
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    appendLog(`[console:${level}] ${message} (${sourceId}:${line})`);
  });
  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    appendLog(`[did-fail-load] ${errorCode} ${errorDescription} ${validatedURL}`);
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    appendLog(`[render-process-gone] ${details.reason} exitCode=${details.exitCode}`);
  });
  win.webContents.on("did-finish-load", () => {
    appendLog(`[did-finish-load] ${win.webContents.getURL()}`);
  });

  const shouldLoadBuiltApp =
    app.isPackaged ||
    process.env.INFINIGHTCAPTURE_LOAD_DIST === "1" ||
    process.env.FACEVIZ_LOAD_DIST === "1" ||
    process.argv.includes("--infinightcapture-load-dist") ||
    process.argv.includes("--faceviz-load-dist");
  if (!shouldLoadBuiltApp) {
    const devUrl = process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5173";
    win.loadURL(devUrl);
    return;
  }

  win.loadFile(path.join(__dirname, "../dist/index.html"));
};

app.whenReady().then(() => {
  configurePermissions();
  registerSystemBridge();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
