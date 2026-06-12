const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("faceVizSystem", {
  getStatus: () => ipcRenderer.invoke("faceviz:system-status"),
  requestCameraAccess: () => ipcRenderer.invoke("faceviz:request-camera-access"),
  startOutput: (target) => ipcRenderer.invoke("faceviz:output-start", target),
  stopOutput: (target) => ipcRenderer.invoke("faceviz:output-stop", target),
  publishOutputFrame: (target, frame) => ipcRenderer.invoke("faceviz:output-frame", target, frame)
});
