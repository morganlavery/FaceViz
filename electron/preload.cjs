const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("infinightCaptureSystem", {
  getStatus: () => ipcRenderer.invoke("infinightcapture:system-status"),
  requestCameraAccess: () => ipcRenderer.invoke("infinightcapture:request-camera-access"),
  startOutput: (target) => ipcRenderer.invoke("infinightcapture:output-start", target),
  stopOutput: (target) => ipcRenderer.invoke("infinightcapture:output-stop", target),
  publishOutputFrame: (target, frame) => ipcRenderer.invoke("infinightcapture:output-frame", target, frame),
  getMobileFeedStatus: () => ipcRenderer.invoke("infinightcapture:mobile-feed-status"),
  prepareMobileFeedOffer: (offer) => ipcRenderer.invoke("infinightcapture:mobile-feed-offer", offer),
  addMobileFeedReceiverCandidate: (candidate) => ipcRenderer.invoke("infinightcapture:mobile-feed-receiver-candidate", candidate),
  pollMobileFeedSignal: (senderCandidateCursor) =>
    ipcRenderer.invoke("infinightcapture:mobile-feed-signal", senderCandidateCursor),
  resetMobileFeedSession: () => ipcRenderer.invoke("infinightcapture:mobile-feed-reset"),
  openExternalUrl: (url) => ipcRenderer.invoke("infinightcapture:open-external-url", url)
});
