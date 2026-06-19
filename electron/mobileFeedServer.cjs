const http = require("node:http");
const os = require("node:os");
const crypto = require("node:crypto");
const localtunnel = require("localtunnel");

let mobileFeedServer = null;
let mobileFeedSession = createMobileFeedSession();
let mobileFeedTunnel = null;
let mobileFeedTunnelPromise = null;
let mobileFeedTunnelError = "";

const jsonHeaders = {
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-cache",
  "Content-Type": "application/json; charset=utf-8"
};

function createMobileFeedSession() {
  return {
    id: crypto.randomBytes(4).toString("hex"),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    offer: null,
    answer: null,
    receiverCandidates: [],
    senderCandidates: [],
    connectedAt: 0,
    lastSenderHeartbeatAt: 0
  };
}

function getLocalIPv4Addresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((address) => address && address.family === "IPv4" && !address.internal)
    .map((address) => address.address);
}

function getMobileFeedUrls() {
  const address = mobileFeedServer?.address();
  if (!address || typeof address === "string") return [];

  return getLocalIPv4Addresses().map((ipAddress) => `http://${ipAddress}:${address.port}/mobile/${mobileFeedSession.id}`);
}

function getSecureMobileFeedUrl() {
  return mobileFeedTunnel?.url ? `${mobileFeedTunnel.url}/mobile/${mobileFeedSession.id}` : "";
}

function withTimeout(promise, timeoutMs, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs);
    })
  ]);
}

async function ensureMobileFeedTunnel(port) {
  if (mobileFeedTunnel?.url) {
    return mobileFeedTunnel;
  }

  if (mobileFeedTunnelPromise) {
    return mobileFeedTunnelPromise;
  }

  mobileFeedTunnelError = "";
  mobileFeedTunnelPromise = withTimeout(
    localtunnel({
      port,
      local_host: "127.0.0.1"
    }),
    9000,
    "Secure mobile pairing tunnel timed out."
  )
    .then((tunnel) => {
      mobileFeedTunnel = tunnel;
      tunnel.on("close", () => {
        if (mobileFeedTunnel === tunnel) {
          mobileFeedTunnel = null;
        }
      });
      tunnel.on("error", (error) => {
        mobileFeedTunnelError = error instanceof Error ? error.message : "Secure mobile pairing tunnel failed.";
      });
      return tunnel;
    })
    .catch((error) => {
      mobileFeedTunnelError = error instanceof Error ? error.message : "Secure mobile pairing tunnel failed.";
      return null;
    })
    .finally(() => {
      mobileFeedTunnelPromise = null;
    });

  return mobileFeedTunnelPromise;
}

function readJsonRequest(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Request body too large."));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, jsonHeaders);
  response.end(JSON.stringify(payload));
}

function sendHtml(response, html) {
  response.writeHead(200, {
    "Cache-Control": "no-cache",
    "Content-Type": "text/html; charset=utf-8"
  });
  response.end(html);
}

function assertSession(url) {
  const sessionMatch = url.pathname.match(/^\/api\/mobile-feed\/session\/([^/]+)/);
  return sessionMatch?.[1] === mobileFeedSession.id;
}

async function handleApiRequest(request, response, url) {
  if (request.method === "OPTIONS") {
    response.writeHead(204, jsonHeaders);
    response.end();
    return;
  }

  if (!assertSession(url)) {
    sendJson(response, 404, { ok: false, reason: "Mobile feed session not found." });
    return;
  }

  if (request.method === "GET" && /^\/api\/mobile-feed\/session\/[^/]+$/.test(url.pathname)) {
    sendJson(response, 200, {
      ok: true,
      sessionId: mobileFeedSession.id,
      offer: mobileFeedSession.offer,
      hasAnswer: Boolean(mobileFeedSession.answer),
      receiverCandidateCount: mobileFeedSession.receiverCandidates.length,
      senderCandidateCount: mobileFeedSession.senderCandidates.length,
      connected: isMobileFeedConnected(),
      updatedAt: mobileFeedSession.updatedAt
    });
    return;
  }

  if (request.method === "POST" && /\/answer$/.test(url.pathname)) {
    const body = await readJsonRequest(request);
    mobileFeedSession.answer = body.answer ?? null;
    mobileFeedSession.updatedAt = Date.now();
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && /\/candidate$/.test(url.pathname)) {
    const body = await readJsonRequest(request);
    if (body.candidate) {
      mobileFeedSession.senderCandidates.push(body.candidate);
      mobileFeedSession.updatedAt = Date.now();
    }
    sendJson(response, 200, { ok: true, cursor: mobileFeedSession.senderCandidates.length });
    return;
  }

  if (request.method === "GET" && /\/receiver-candidates$/.test(url.pathname)) {
    const cursor = Number(url.searchParams.get("cursor") ?? "0");
    sendJson(response, 200, {
      ok: true,
      cursor: mobileFeedSession.receiverCandidates.length,
      candidates: mobileFeedSession.receiverCandidates.slice(Number.isFinite(cursor) ? cursor : 0)
    });
    return;
  }

  if (request.method === "POST" && /\/heartbeat$/.test(url.pathname)) {
    const now = Date.now();
    mobileFeedSession.lastSenderHeartbeatAt = now;
    mobileFeedSession.connectedAt ||= now;
    mobileFeedSession.updatedAt = now;
    sendJson(response, 200, { ok: true });
    return;
  }

  sendJson(response, 404, { ok: false, reason: "Mobile feed endpoint not found." });
}

function getMobileFeedPage(sessionId) {
  const escapedSessionId = JSON.stringify(sessionId);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>INFINIGHTCapture Mobile Feed</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #02080f;
        color: #effdff;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100svh;
        display: grid;
        grid-template-rows: minmax(0, 1fr) auto;
        background:
          linear-gradient(rgba(0, 231, 255, 0.04) 1px, transparent 1px),
          linear-gradient(90deg, rgba(17, 109, 255, 0.04) 1px, transparent 1px),
          linear-gradient(135deg, #02080f, #06151e 55%, #090b13);
        background-size: 28px 28px, 28px 28px, auto;
      }
      video {
        width: 100%;
        height: 100%;
        min-height: 0;
        object-fit: cover;
        background: #000;
      }
      .panel {
        display: grid;
        gap: 12px;
        padding: 14px max(14px, env(safe-area-inset-right)) max(18px, env(safe-area-inset-bottom)) max(14px, env(safe-area-inset-left));
        border-top: 1px solid rgba(0, 231, 255, 0.28);
        background: rgba(3, 10, 17, 0.94);
      }
      .brand {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      h1 {
        margin: 0;
        color: #f8fbff;
        font-size: 0.95rem;
        letter-spacing: 0;
      }
      .status {
        display: inline-flex;
        align-items: center;
        min-height: 28px;
        padding: 0 10px;
        border: 1px solid rgba(0, 231, 255, 0.36);
        border-radius: 999px;
        color: #b7fbff;
        background: rgba(4, 15, 23, 0.9);
        font-size: 0.72rem;
        font-weight: 900;
        text-transform: uppercase;
        white-space: nowrap;
      }
      .controls {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 10px;
      }
      button {
        min-height: 46px;
        border: 1px solid rgba(0, 231, 255, 0.58);
        border-radius: 8px;
        color: #effdff;
        background: linear-gradient(135deg, rgba(0, 128, 164, 0.9), rgba(17, 109, 255, 0.58));
        font: inherit;
        font-size: 0.82rem;
        font-weight: 900;
        text-transform: uppercase;
      }
      button.secondary {
        min-width: 92px;
        border-color: rgba(0, 231, 255, 0.28);
        background: rgba(4, 15, 23, 0.9);
      }
      .note {
        margin: 0;
        color: #91adba;
        font-size: 0.78rem;
        line-height: 1.35;
      }
      .error {
        color: #ffdce1;
      }
    </style>
  </head>
  <body>
    <video id="preview" playsinline muted autoplay></video>
    <section class="panel">
      <div class="brand">
        <h1>INFINIGHTCapture Mobile Feed</h1>
        <span class="status" id="status">Standby</span>
      </div>
      <div class="controls">
        <button id="start" type="button">Start Camera</button>
        <button class="secondary" id="flip" type="button">Flip</button>
      </div>
      <p class="note" id="note">Keep this phone on the same Wi-Fi as the desktop. Some mobile browsers require HTTPS before they allow camera access.</p>
    </section>
    <script>
      const sessionId = ${escapedSessionId};
      const preview = document.getElementById("preview");
      const statusEl = document.getElementById("status");
      const noteEl = document.getElementById("note");
      const startButton = document.getElementById("start");
      const flipButton = document.getElementById("flip");
      let facingMode = "environment";
      let stream = null;
      let peer = null;
      let videoSender = null;
      let receiverCandidateCursor = 0;
      let receiverCandidateTimer = 0;
      let heartbeatTimer = 0;

      const setStatus = (value, error = false) => {
        statusEl.textContent = value;
        noteEl.classList.toggle("error", error);
      };

      const api = (path, options) => fetch("/api/mobile-feed/session/" + sessionId + path, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...(options && options.headers ? options.headers : {})
        }
      }).then(async (response) => {
        const payload = await response.json();
        if (!response.ok || payload.ok === false) {
          throw new Error(payload.reason || "Mobile feed request failed.");
        }
        return payload;
      });

      const stopPeer = () => {
        window.clearInterval(receiverCandidateTimer);
        window.clearInterval(heartbeatTimer);
        receiverCandidateTimer = 0;
        heartbeatTimer = 0;
        if (peer) {
          peer.onicecandidate = null;
          peer.close();
        }
        peer = null;
        videoSender = null;
      };

      const startCamera = async () => {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error(
            window.isSecureContext
              ? "This browser does not expose camera access. Open the QR link in Safari."
              : "iPhone requires secure HTTPS pairing before camera access is available. Refresh the desktop QR and scan the secure code."
          );
        }
        if (stream) {
          stream.getTracks().forEach((track) => track.stop());
        }
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode,
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30, max: 30 }
          },
          audio: false
        });
        preview.srcObject = stream;
        await preview.play();
      };

      const pollForOffer = async () => {
        setStatus("Pairing");
        const deadline = Date.now() + 120000;
        while (Date.now() < deadline) {
          const session = await api("");
          if (session.offer) return session.offer;
          await new Promise((resolve) => setTimeout(resolve, 700));
        }
        throw new Error("Desktop is not waiting for a mobile feed. Press Start in INFINIGHTCapture.");
      };

      const startFeed = async () => {
        try {
          startButton.disabled = true;
          stopPeer();
          setStatus("Camera");
          noteEl.textContent = "Requesting camera permission.";
          await startCamera();

          const offer = await pollForOffer();
          setStatus("Linking");
          peer = new RTCPeerConnection();
          const [videoTrack] = stream.getVideoTracks();
          videoSender = peer.addTrack(videoTrack, stream);
          peer.onicecandidate = (event) => {
            if (event.candidate) {
              api("/candidate", {
                method: "POST",
                body: JSON.stringify({ candidate: event.candidate.toJSON() })
              }).catch(() => {});
            }
          };
          peer.onconnectionstatechange = () => {
            if (!peer) return;
            if (peer.connectionState === "connected") {
              setStatus("Live");
              noteEl.textContent = "Streaming to the desktop.";
            }
            if (peer.connectionState === "failed" || peer.connectionState === "disconnected") {
              setStatus("Retry");
            }
          };

          await peer.setRemoteDescription(offer);
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          await api("/answer", {
            method: "POST",
            body: JSON.stringify({ answer: peer.localDescription.toJSON() })
          });

          receiverCandidateTimer = window.setInterval(async () => {
            if (!peer) return;
            const payload = await api("/receiver-candidates?cursor=" + receiverCandidateCursor);
            receiverCandidateCursor = payload.cursor;
            for (const candidate of payload.candidates) {
              await peer.addIceCandidate(candidate);
            }
          }, 650);

          heartbeatTimer = window.setInterval(() => {
            api("/heartbeat", { method: "POST", body: "{}" }).catch(() => {});
          }, 2000);
          api("/heartbeat", { method: "POST", body: "{}" }).catch(() => {});
          setStatus("Connecting");
          noteEl.textContent = "Waiting for the WebRTC link to settle.";
        } catch (error) {
          setStatus("Blocked", true);
          noteEl.textContent = error instanceof Error ? error.message : "Unable to start the mobile feed.";
          startButton.disabled = false;
        }
      };

      startButton.addEventListener("click", startFeed);
      flipButton.addEventListener("click", async () => {
        try {
          facingMode = facingMode === "environment" ? "user" : "environment";
          if (!stream) return;
          await startCamera();
          const [videoTrack] = stream.getVideoTracks();
          if (peer && videoSender && videoTrack) {
            await videoSender.replaceTrack(videoTrack);
          }
        } catch (error) {
          setStatus("Blocked", true);
          noteEl.textContent = error instanceof Error ? error.message : "Unable to flip the camera.";
        }
      });
    </script>
  </body>
</html>`;
}

function createMobileFeedServer() {
  return http.createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");

    if (url.pathname === "/") {
      response.writeHead(302, {
        "Cache-Control": "no-cache",
        Location: `/mobile/${mobileFeedSession.id}`
      });
      response.end();
      return;
    }

    if (url.pathname === `/mobile/${mobileFeedSession.id}`) {
      sendHtml(response, getMobileFeedPage(mobileFeedSession.id));
      return;
    }

    if (url.pathname.startsWith("/api/mobile-feed/session/")) {
      handleApiRequest(request, response, url).catch((error) => {
        sendJson(response, 400, { ok: false, reason: error instanceof Error ? error.message : "Bad request." });
      });
      return;
    }

    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  });
}

function ensureMobileFeedServer() {
  if (mobileFeedServer?.listening) {
    const address = mobileFeedServer.address();
    if (address && typeof address !== "string") {
      return ensureMobileFeedTunnel(address.port).then(() => getMobileFeedStatus());
    }
    return Promise.resolve(getMobileFeedStatus());
  }

  mobileFeedServer = createMobileFeedServer();
  return new Promise((resolve, reject) => {
    mobileFeedServer.once("error", reject);
    mobileFeedServer.listen(0, "0.0.0.0", async () => {
      const address = mobileFeedServer.address();
      if (address && typeof address !== "string") {
        await ensureMobileFeedTunnel(address.port);
      }
      resolve(getMobileFeedStatus());
    });
  });
}

function isMobileFeedConnected() {
  return Date.now() - mobileFeedSession.lastSenderHeartbeatAt < 6500;
}

function getMobileFeedStatus() {
  const address = mobileFeedServer?.address();
  const port = address && typeof address !== "string" ? address.port : 0;
  const localUrls = getMobileFeedUrls();
  const secureUrl = getSecureMobileFeedUrl();
  const urls = secureUrl ? [secureUrl, ...localUrls] : localUrls;
  return {
    available: Boolean(mobileFeedServer?.listening && port),
    sessionId: mobileFeedSession.id,
    port,
    urls,
    localUrls,
    secureUrl,
    primaryUrl: urls[0] ?? "",
    tunnelError: mobileFeedTunnelError,
    connected: isMobileFeedConnected(),
    hasOffer: Boolean(mobileFeedSession.offer),
    hasAnswer: Boolean(mobileFeedSession.answer),
    senderCandidateCount: mobileFeedSession.senderCandidates.length,
    receiverCandidateCount: mobileFeedSession.receiverCandidates.length,
    updatedAt: mobileFeedSession.updatedAt
  };
}

function prepareMobileFeedOffer(offer) {
  mobileFeedSession.offer = offer;
  mobileFeedSession.answer = null;
  mobileFeedSession.receiverCandidates = [];
  mobileFeedSession.senderCandidates = [];
  mobileFeedSession.connectedAt = 0;
  mobileFeedSession.lastSenderHeartbeatAt = 0;
  mobileFeedSession.updatedAt = Date.now();
  return getMobileFeedStatus();
}

function addMobileFeedReceiverCandidate(candidate) {
  if (candidate) {
    mobileFeedSession.receiverCandidates.push(candidate);
    mobileFeedSession.updatedAt = Date.now();
  }
  return {
    ok: true,
    cursor: mobileFeedSession.receiverCandidates.length
  };
}

function pollMobileFeedSignal(senderCandidateCursor = 0) {
  const cursor = Number.isFinite(Number(senderCandidateCursor)) ? Number(senderCandidateCursor) : 0;
  return {
    ok: true,
    answer: mobileFeedSession.answer,
    candidates: mobileFeedSession.senderCandidates.slice(cursor),
    cursor: mobileFeedSession.senderCandidates.length,
    connected: isMobileFeedConnected(),
    updatedAt: mobileFeedSession.updatedAt
  };
}

function resetMobileFeedSession() {
  mobileFeedSession = createMobileFeedSession();
  return getMobileFeedStatus();
}

function shutdownMobileFeedServer() {
  if (mobileFeedTunnel) {
    try {
      mobileFeedTunnel.close();
    } catch {
      // Ignore tunnel shutdown errors.
    }
  }
  mobileFeedTunnel = null;
  mobileFeedTunnelPromise = null;
  if (!mobileFeedServer) return;
  try {
    mobileFeedServer.close();
  } catch {
    // Ignore shutdown errors.
  }
  mobileFeedServer = null;
}

module.exports = {
  addMobileFeedReceiverCandidate,
  ensureMobileFeedServer,
  getMobileFeedStatus,
  pollMobileFeedSignal,
  prepareMobileFeedOffer,
  resetMobileFeedSession,
  shutdownMobileFeedServer
};
