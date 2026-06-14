const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("infinightCaptureSystem", {
  getStatus: () => ipcRenderer.invoke("infinightcapture:system-status"),
  requestCameraAccess: () => ipcRenderer.invoke("infinightcapture:request-camera-access"),
  startOutput: (target) => ipcRenderer.invoke("infinightcapture:output-start", target),
  stopOutput: (target) => ipcRenderer.invoke("infinightcapture:output-stop", target),
  publishOutputFrame: (target, frame) => ipcRenderer.invoke("infinightcapture:output-frame", target, frame),
  openExternalUrl: (url) => ipcRenderer.invoke("infinightcapture:open-external-url", url)
});
