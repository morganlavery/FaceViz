const { app, BrowserWindow, session, shell } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { registerSystemBridge } = require("./systemBridge.cjs");

let packagedAppOrigin = "";
let staticServer = null;

const getOrigin = (value = "") => {
  try {
    return new URL(value).origin;
  } catch {
    return value;
  }
};

const isTrustedAppOrigin = (origin = "") => {
  const normalizedOrigin = getOrigin(origin);
  return (
    normalizedOrigin === "http://127.0.0.1:5173" ||
    normalizedOrigin === "http://localhost:5173" ||
    (packagedAppOrigin && normalizedOrigin === packagedAppOrigin) ||
    origin.startsWith("file://")
  );
};

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".webp": "image/webp"
};

const createStaticServer = (rootDir) =>
  new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      const pathname = decodeURIComponent(url.pathname);
      const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
      const filePath = path.normalize(path.join(rootDir, relativePath));

      if (!filePath.startsWith(rootDir)) {
        response.writeHead(403);
        response.end("Forbidden");
        return;
      }

      fs.readFile(filePath, (error, data) => {
        if (error) {
          response.writeHead(404);
          response.end("Not found");
          return;
        }

        response.writeHead(200, {
          "Cache-Control": "no-cache",
          "Content-Type": contentTypes[path.extname(filePath).toLowerCase()] ?? "application/octet-stream"
        });
        response.end(data);
      });
    });

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      staticServer = server;
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to bind packaged app server."));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });

const loadPackagedApp = async (win) => {
  if (!staticServer) {
    const distPath = path.normalize(path.join(__dirname, "../dist"));
    packagedAppOrigin = await createStaticServer(distPath);
  }

  await win.loadURL(`${packagedAppOrigin}/index.html`);
};

const shutdownStaticServer = () => {
  if (!staticServer) return;
  try {
    staticServer.close();
  } catch {
    // Ignore shutdown errors.
  }
  staticServer = null;
};

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

const createWindow = async () => {
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

  await loadPackagedApp(win);
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
  shutdownStaticServer();
  if (process.platform !== "darwin") {
    app.quit();
  }
});
