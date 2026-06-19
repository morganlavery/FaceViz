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
  ctx.fillStyle = "rgba(2, 8, 15, 0.08)";
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
    ctx.strokeStyle = "rgba(0, 231, 255, 0.08)";
    ctx.stroke();
  }

  const points = 34;
  for (let index = 0; index < points; index += 1) {
    const phase = index * 0.74;
    const x = width * (0.08 + ((Math.sin(t * 1.8 + phase) + 1) * 0.42));
    const y = height * (0.1 + ((Math.cos(t * 1.4 + phase * 1.3) + 1) * 0.4));
    const radius = 1.4 + ((index % 5) * 0.65);
    ctx.fillStyle =
      index % 3 === 0 ? "rgba(17, 109, 255, 0.52)" : "rgba(0, 231, 255, 0.42)";
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));

function drawRoundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawPanel(ctx, x, y, width, height, title, accent = "#00e7ff") {
  drawRoundRect(ctx, x, y, width, height, 8);
  const gradient = ctx.createLinearGradient(x, y, x + width, y + height);
  gradient.addColorStop(0, "rgba(4, 20, 31, 0.88)");
  gradient.addColorStop(1, "rgba(2, 8, 15, 0.68)");
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.strokeStyle = "rgba(0, 231, 255, 0.25)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = accent;
  ctx.font = "800 10px ui-sans-serif, system-ui";
  ctx.textBaseline = "top";
  ctx.fillText(title, x + 10, y + 9, width - 20);
}

function drawTinyBar(ctx, x, y, width, label, value, accent) {
  ctx.fillStyle = "rgba(145, 173, 186, 0.86)";
  ctx.font = "700 9px ui-sans-serif, system-ui";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x, y + 5, width * 0.42);

  const barX = x + width * 0.48;
  const barW = width * 0.48;
  drawRoundRect(ctx, barX, y, barW, 10, 5);
  ctx.fillStyle = "rgba(0, 231, 255, 0.1)";
  ctx.fill();
  drawRoundRect(ctx, barX, y, barW * clamp(value), 10, 5);
  ctx.fillStyle = accent;
  ctx.fill();
}

function drawChip(ctx, x, y, label, active, accent = "#00e7ff") {
  const width = Math.max(34, ctx.measureText(label).width + 16);
  drawRoundRect(ctx, x, y, width, 18, 9);
  ctx.fillStyle = active ? "rgba(0, 231, 255, 0.18)" : "rgba(145, 173, 186, 0.08)";
  ctx.fill();
  ctx.strokeStyle = active ? accent : "rgba(145, 173, 186, 0.22)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = active ? "#eefbff" : "rgba(145, 173, 186, 0.88)";
  ctx.font = "800 8px ui-sans-serif, system-ui";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + 8, y + 9);
  return width;
}

function drawConnector(ctx, fromX, fromY, toX, toY, pulse, color = "rgba(0, 231, 255, 0.72)") {
  ctx.strokeStyle = "rgba(0, 231, 255, 0.22)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.bezierCurveTo((fromX + toX) / 2, fromY, (fromX + toX) / 2, toY, toX, toY);
  ctx.stroke();

  const dotT = (pulse % 1);
  const x = fromX + (toX - fromX) * dotT;
  const y = fromY + (toY - fromY) * dotT + Math.sin(dotT * Math.PI) * ((fromY - toY) * 0.08);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, 2.6, 0, Math.PI * 2);
  ctx.fill();
}

function drawFaceRigPreview(ctx, cx, cy, scale, t) {
  const smile = 0.58 + Math.sin(t * 1.2) * 0.12;
  const mouth = 0.4 + Math.sin(t * 1.6 + 0.8) * 0.14;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = "rgba(0, 231, 255, 0.66)";
  ctx.lineWidth = 1.2 * scale;

  for (let ring = 0; ring < 4; ring += 1) {
    ctx.beginPath();
    ctx.ellipse(0, 0, scale * (34 + ring * 7), scale * (45 + ring * 5), Math.sin(t * 0.4) * 0.08, 0, Math.PI * 2);
    ctx.stroke();
  }

  const points = [
    [-20, -16],
    [-8, -18],
    [8, -18],
    [20, -16],
    [-18, 6],
    [0, 16],
    [18, 6],
    [-10, 31],
    [0, 35 + mouth * 5],
    [10, 31]
  ];
  ctx.fillStyle = "#00e7ff";
  points.forEach(([x, y], index) => {
    ctx.beginPath();
    ctx.arc(x * scale, y * scale, (index > 6 ? 2.4 : 2) * scale, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.strokeStyle = "rgba(255, 209, 125, 0.9)";
  ctx.lineWidth = 1.6 * scale;
  ctx.beginPath();
  ctx.arc(0, scale * (20 + mouth * 5), scale * (10 + smile * 8), 0.14 * Math.PI, 0.86 * Math.PI);
  ctx.stroke();

  ctx.restore();
}

function drawHandPreview(ctx, x, y, handedness, scale, t) {
  const side = handedness === "left" ? -1 : 1;
  const palm = { x, y };
  const tips = [
    { x: x + side * scale * 6, y: y - scale * 40 },
    { x: x + side * scale * 28, y: y - scale * 34 + Math.sin(t * 1.5) * scale * 6 },
    { x: x + side * scale * 42, y: y - scale * 12 },
    { x: x + side * scale * 38, y: y + scale * 9 },
    { x: x + side * scale * 24, y: y + scale * 26 }
  ];

  ctx.strokeStyle = "rgba(183, 251, 255, 0.62)";
  ctx.lineWidth = 1.4 * scale;
  tips.forEach((tip) => {
    ctx.beginPath();
    ctx.moveTo(palm.x, palm.y);
    ctx.quadraticCurveTo((palm.x + tip.x) / 2, palm.y - scale * 6, tip.x, tip.y);
    ctx.stroke();
  });

  ctx.fillStyle = "#ffd17d";
  [palm, ...tips].forEach((point, index) => {
    ctx.beginPath();
    ctx.arc(point.x, point.y, (index === 0 ? 4 : 3) * scale, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawPosePreview(ctx, cx, cy, scale, t) {
  const joints = {
    neck: [cx, cy - 48 * scale],
    chest: [cx, cy + 26 * scale],
    leftShoulder: [cx - 58 * scale, cy - 34 * scale],
    rightShoulder: [cx + 58 * scale, cy - 34 * scale],
    leftElbow: [cx - 88 * scale, cy + Math.sin(t * 1.7) * 14 * scale],
    rightElbow: [cx + 94 * scale, cy - 18 * scale + Math.cos(t * 1.4) * 16 * scale],
    leftHand: [cx - 118 * scale, cy - 48 * scale + Math.sin(t * 1.9) * 22 * scale],
    rightHand: [cx + 126 * scale, cy - 66 * scale + Math.cos(t * 1.7) * 20 * scale],
    leftHip: [cx - 36 * scale, cy + 94 * scale],
    rightHip: [cx + 36 * scale, cy + 94 * scale]
  };
  const bones = [
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

  ctx.strokeStyle = "rgba(183, 251, 255, 0.72)";
  ctx.lineWidth = 2 * scale;
  ctx.lineCap = "round";
  bones.forEach(([from, to]) => {
    ctx.beginPath();
    ctx.moveTo(...joints[from]);
    ctx.lineTo(...joints[to]);
    ctx.stroke();
  });

  Object.entries(joints).forEach(([name, [x, y]]) => {
    ctx.fillStyle = name.includes("Hand") ? "#ffd17d" : "#00e7ff";
    ctx.beginPath();
    ctx.arc(x, y, (name.includes("Hand") ? 4.8 : 3.4) * scale, 0, Math.PI * 2);
    ctx.fill();
  });

  drawFaceRigPreview(ctx, cx, cy - 96 * scale, scale, t);
  drawHandPreview(ctx, joints.leftHand[0], joints.leftHand[1], "left", scale * 0.56, t);
  drawHandPreview(ctx, joints.rightHand[0], joints.rightHand[1], "right", scale * 0.56, t + 0.7);
}

function drawPadBank(ctx, x, y, width, height, t) {
  drawPanel(ctx, x, y, width, height, "PADS + XY ZONES", "#ffd17d");
  const gap = 5;
  const padW = (width - 28 - gap * 2) / 3;
  const padH = (height - 42 - gap) / 2;
  for (let row = 0; row < 2; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      const index = row * 3 + col;
      const px = x + 10 + col * (padW + gap);
      const py = y + 28 + row * (padH + gap);
      const active = (Math.floor(t * 1.7) + index) % 5 === 0;
      drawRoundRect(ctx, px, py, padW, padH, 6);
      ctx.fillStyle = active ? "rgba(255, 209, 125, 0.22)" : "rgba(0, 231, 255, 0.08)";
      ctx.fill();
      ctx.strokeStyle = active ? "rgba(255, 209, 125, 0.78)" : "rgba(0, 231, 255, 0.2)";
      ctx.stroke();
      if (index === 2 || index === 4) {
        ctx.strokeStyle = "rgba(183, 251, 255, 0.28)";
        ctx.beginPath();
        ctx.moveTo(px + padW * 0.5, py + 5);
        ctx.lineTo(px + padW * 0.5, py + padH - 5);
        ctx.moveTo(px + 5, py + padH * 0.5);
        ctx.lineTo(px + padW - 5, py + padH * 0.5);
        ctx.stroke();
        ctx.fillStyle = "#00e7ff";
        ctx.beginPath();
        ctx.arc(px + padW * (0.35 + Math.sin(t + index) * 0.18), py + padH * (0.5 + Math.cos(t + index) * 0.22), 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

function drawActionMatrix(ctx, x, y, width, height, t) {
  drawPanel(ctx, x, y, width, height, "GESTURE ACTION MATRIX", "#4df8ff");
  const routes = [
    ["Smile", "Bloom"],
    ["Pinch", "Warp"],
    ["Hands up", "Output"],
    ["Mouth", "Fire"]
  ];
  const leftX = x + 14;
  const rightX = x + width - 72;
  routes.forEach(([gesture, action], index) => {
    const rowY = y + 32 + index * ((height - 46) / 4);
    ctx.fillStyle = "rgba(145, 173, 186, 0.82)";
    ctx.font = "800 8px ui-sans-serif, system-ui";
    ctx.textBaseline = "middle";
    ctx.fillText(gesture, leftX, rowY);
    ctx.fillStyle = "#eefbff";
    ctx.fillText(action, rightX, rowY);
    drawConnector(ctx, leftX + 54, rowY, rightX - 8, rowY, (t * 0.24 + index * 0.18) % 1, index % 2 ? "#ffd17d" : "#00e7ff");
  });
}

function drawOutputStack(ctx, x, y, width, height, t) {
  drawPanel(ctx, x, y, width, height, "LIVE OUTPUT", "#116dff");
  const modes = ["Shader", "+Wire", "+Cam"];
  const buses = ["Syphon", "Spout", "NDI"];
  modes.forEach((mode, index) => {
    const py = y + 30 + index * 23;
    const active = (Math.floor(t * 0.9) + index) % 3 === 1;
    drawChip(ctx, x + 10, py, mode, active, "#00e7ff");
  });
  buses.forEach((bus, index) => {
    const py = y + 41 + index * 24;
    ctx.fillStyle = index === 2 ? "#ffd17d" : "#00e7ff";
    ctx.beginPath();
    ctx.arc(x + width - 64, py, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(238, 251, 255, 0.9)";
    ctx.font = "800 9px ui-sans-serif, system-ui";
    ctx.textBaseline = "middle";
    ctx.fillText(bus, x + width - 55, py);
    ctx.strokeStyle = "rgba(0, 231, 255, 0.2)";
    ctx.beginPath();
    ctx.moveTo(x + width - 20, py);
    ctx.lineTo(x + width - 13, py);
    ctx.stroke();
  });
}

function drawPreview(ctx, width, height, time) {
  const t = time * 0.001;
  ctx.clearRect(0, 0, width, height);

  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#02080f");
  gradient.addColorStop(0.45, "#06151e");
  gradient.addColorStop(1, "#081536");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  for (let y = 0; y < height; y += 5) {
    const shift = Math.sin(y * 0.033 + t * 2) * 16;
    ctx.fillStyle = y % 20 === 0 ? "rgba(17, 109, 255, 0.12)" : "rgba(0, 231, 255, 0.07)";
    ctx.fillRect(shift, y, width, 1.5);
  }

  const usableHeight = Math.max(260, height - 45);
  const compact = width < 520;
  const stageScale = clamp(Math.min(width / 640, usableHeight / 380), 0.72, 1.18);
  const cx = width * (compact ? 0.5 : 0.52);
  const cy = usableHeight * (compact ? 0.48 : 0.5);

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 7; i += 1) {
    const size = stageScale * (76 + i * 21 + Math.sin(t * 2 + i) * 5);
    ctx.beginPath();
    ctx.ellipse(cx, cy - 28 * stageScale, size, size * 0.42, t * 0.08, 0, Math.PI * 2);
    ctx.strokeStyle = i % 2 ? "rgba(0, 231, 255, 0.32)" : "rgba(17, 109, 255, 0.34)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();

  drawPosePreview(ctx, cx, cy + 18 * stageScale, stageScale, t);

  if (!compact) {
    drawPanel(ctx, 14, 16, 158, 118, "FACIAL CAPTURE", "#4df8ff");
    drawTinyBar(ctx, 24, 45, 136, "Smile", 0.74 + Math.sin(t * 1.2) * 0.08, "#00e7ff");
    drawTinyBar(ctx, 24, 66, 136, "Mouth", 0.58 + Math.cos(t * 1.4) * 0.1, "#ffd17d");
    drawTinyBar(ctx, 24, 87, 136, "Eyes", 0.42 + Math.sin(t * 0.9) * 0.12, "#116dff");
    drawTinyBar(ctx, 24, 108, 136, "Touch", 0.64 + Math.cos(t * 1.1) * 0.08, "#00e7ff");

    drawPanel(ctx, width - 178, 16, 164, 118, "SHADER UNIFORMS", "#ffd17d");
    drawTinyBar(ctx, width - 166, 45, 140, "fvMotion", 0.82, "#00e7ff");
    drawTinyBar(ctx, width - 166, 66, 140, "fvFace", 0.68 + Math.sin(t) * 0.12, "#ffd17d");
    drawTinyBar(ctx, width - 166, 87, 140, "fvGestures", 0.9, "#116dff");
    drawTinyBar(ctx, width - 166, 108, 140, "Presets", 0.54 + Math.cos(t * 0.8) * 0.08, "#00e7ff");

    drawPadBank(ctx, 14, usableHeight - 128, 168, 112, t);
    drawActionMatrix(ctx, width * 0.34, usableHeight - 122, width * 0.32, 106, t);
    drawOutputStack(ctx, width - 178, usableHeight - 128, 164, 112, t);

    drawConnector(ctx, 172, 75, cx - 96 * stageScale, cy - 40 * stageScale, (t * 0.17) % 1);
    drawConnector(ctx, cx + 96 * stageScale, cy - 42 * stageScale, width - 178, 78, (t * 0.19 + 0.3) % 1, "#ffd17d");
    drawConnector(ctx, cx - 42 * stageScale, cy + 92 * stageScale, width * 0.34, usableHeight - 68, (t * 0.21 + 0.1) % 1);
    drawConnector(ctx, width * 0.66, usableHeight - 68, width - 178, usableHeight - 72, (t * 0.2 + 0.4) % 1, "#116dff");
  } else {
    drawPanel(ctx, 12, 14, width - 24, 76, "FACE / HANDS / POSE SIGNALS", "#4df8ff");
    drawTinyBar(ctx, 24, 42, width - 48, "Smile", 0.74 + Math.sin(t * 1.2) * 0.08, "#00e7ff");
    drawTinyBar(ctx, 24, 63, width - 48, "Pinch", 0.66 + Math.cos(t) * 0.1, "#ffd17d");

    const chipY = usableHeight - 72;
    let chipX = 14;
    ctx.font = "800 8px ui-sans-serif, system-ui";
    ["Matrix", "Pads", "Shader", "Syphon", "Spout", "NDI"].forEach((label, index) => {
      const chipWidth = drawChip(ctx, chipX, chipY + (index > 2 ? 24 : 0), label, index % 2 === Math.floor(t) % 2, index > 2 ? "#116dff" : "#00e7ff");
      chipX += chipWidth + 5;
      if (index === 2) chipX = 14;
    });
  }
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
