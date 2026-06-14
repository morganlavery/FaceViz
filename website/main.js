const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function setupCanvas(canvas, draw) {
  const context = canvas.getContext("2d");

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.floor(rect.width * scale));
    canvas.height = Math.max(1, Math.floor(rect.height * scale));
    context.setTransform(scale, 0, 0, scale, 0, 0);
  }

  resize();
  window.addEventListener("resize", resize);

  let frame = 0;
  function tick(time) {
    const rect = canvas.getBoundingClientRect();
    draw(context, rect.width, rect.height, prefersReducedMotion ? 1200 : time, frame);
    frame += 1;
    if (!prefersReducedMotion) {
      requestAnimationFrame(tick);
    }
  }

  requestAnimationFrame(tick);
}

function drawSignalField(ctx, width, height, time) {
  const t = time * 0.00018;
  ctx.clearRect(0, 0, width, height);
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "rgba(11, 13, 16, 0.08)";
  ctx.fillRect(0, 0, width, height);

  const grid = Math.max(28, Math.min(54, width / 22));
  ctx.lineWidth = 1;

  for (let x = -grid; x < width + grid; x += grid) {
    ctx.beginPath();
    for (let y = -grid; y < height + grid; y += 10) {
      const wave = Math.sin(y * 0.012 + t * 8 + x * 0.016) * 12;
      const px = x + wave;
      if (y === -grid) ctx.moveTo(px, y);
      else ctx.lineTo(px, y);
    }
    ctx.strokeStyle = "rgba(52, 210, 208, 0.08)";
    ctx.stroke();
  }

  const points = 34;
  for (let index = 0; index < points; index += 1) {
    const phase = index * 0.74;
    const x = width * (0.08 + ((Math.sin(t * 1.8 + phase) + 1) * 0.42));
    const y = height * (0.1 + ((Math.cos(t * 1.4 + phase * 1.3) + 1) * 0.4));
    const radius = 1.4 + ((index % 5) * 0.65);
    ctx.fillStyle =
      index % 3 === 0 ? "rgba(255, 119, 95, 0.52)" : "rgba(198, 244, 93, 0.42)";
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPreview(ctx, width, height, time) {
  const t = time * 0.001;
  ctx.clearRect(0, 0, width, height);

  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#0b0d10");
  gradient.addColorStop(0.45, "#182126");
  gradient.addColorStop(1, "#231412");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  for (let y = 0; y < height; y += 6) {
    const shift = Math.sin(y * 0.035 + t * 2) * 18;
    ctx.fillStyle = y % 18 === 0 ? "rgba(240, 90, 199, 0.12)" : "rgba(52, 210, 208, 0.08)";
    ctx.fillRect(shift, y, width, 2);
  }

  const cx = width * 0.52;
  const cy = height * 0.43;
  const pulse = Math.sin(t * 1.7) * 8;

  ctx.strokeStyle = "rgba(247, 243, 234, 0.76)";
  ctx.lineWidth = 2.4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const joints = {
    head: [cx, cy - 100 - pulse],
    neck: [cx, cy - 40],
    leftShoulder: [cx - 90, cy - 24],
    rightShoulder: [cx + 90, cy - 24],
    leftElbow: [cx - 142, cy + 26 + Math.sin(t * 2) * 26],
    rightElbow: [cx + 142, cy + 12 + Math.cos(t * 1.8) * 22],
    leftHand: [cx - 184, cy - 34 + Math.sin(t * 2.2) * 42],
    rightHand: [cx + 184, cy - 58 + Math.cos(t * 2.1) * 35],
    chest: [cx, cy + 50],
    leftHip: [cx - 58, cy + 128],
    rightHip: [cx + 58, cy + 128]
  };

  const bones = [
    ["head", "neck"],
    ["neck", "leftShoulder"],
    ["neck", "rightShoulder"],
    ["leftShoulder", "leftElbow"],
    ["leftElbow", "leftHand"],
    ["rightShoulder", "rightElbow"],
    ["rightElbow", "rightHand"],
    ["neck", "chest"],
    ["chest", "leftHip"],
    ["chest", "rightHip"],
    ["leftHip", "rightHip"]
  ];

  bones.forEach(([from, to]) => {
    ctx.beginPath();
    ctx.moveTo(...joints[from]);
    ctx.lineTo(...joints[to]);
    ctx.stroke();
  });

  Object.entries(joints).forEach(([name, [x, y]]) => {
    ctx.fillStyle = name.includes("Hand") ? "#c6f45d" : "#34d2d0";
    ctx.beginPath();
    ctx.arc(x, y, name.includes("Hand") ? 6 : 4, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.strokeStyle = "rgba(255, 119, 95, 0.82)";
  ctx.lineWidth = 1.4;
  for (let i = 0; i < 8; i += 1) {
    const size = 94 + i * 22 + Math.sin(t * 2 + i) * 7;
    ctx.beginPath();
    ctx.ellipse(cx, cy - 68, size, size * 0.38, t * 0.08, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(247, 243, 234, 0.86)";
  ctx.font = "700 13px ui-sans-serif, system-ui";
  ctx.fillText("gesture uniforms", 18, 28);
  ctx.fillStyle = "rgba(198, 244, 93, 0.9)";
  ctx.fillText("uSmile 0.82   uPinch 0.64   uMotion 0.91", 18, 52);
}

const signalCanvas = document.querySelector("#signal-canvas");
const previewCanvas = document.querySelector("#preview-canvas");

if (signalCanvas) {
  setupCanvas(signalCanvas, drawSignalField);
}

if (previewCanvas) {
  setupCanvas(previewCanvas, drawPreview);
}

const toast = document.querySelector("#toast");
let toastTimer = 0;

function showToast(message) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => {
    toast.classList.remove("is-visible");
  }, 4200);
}

document.querySelectorAll("[data-placeholder-link]").forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    showToast("This launch link is ready to connect once the first demo builds are published.");
  });
});

document.querySelectorAll("[data-checkout-button]").forEach((button) => {
  button.addEventListener("click", async () => {
    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = "Opening checkout";

    try {
      const response = await fetch("/api/create-checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          product: "infinightcapture-license"
        })
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload.url) {
        throw new Error(payload.error || "Checkout is not configured yet.");
      }

      window.location.href = payload.url;
    } catch (error) {
      showToast(error.message || "Checkout could not be opened yet.");
      button.disabled = false;
      button.textContent = originalLabel;
    }
  });
});
