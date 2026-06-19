import { pointToCanvas } from "../tracking/gestureEngine";
import type { Landmark, MotionFrame, TrackedFace, TrackedPose, Vec2 } from "../tracking/types";
import {
  MotionShaderPlayer,
  resolveShaderParameterValues,
  type ShaderParameterSettings,
  type ShaderScene
} from "./shaderPlayer";

const HAND_CONNECTIONS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [0, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [0, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20]
];

const UPPER_POSE_CONNECTIONS = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [0, 11],
  [0, 12]
];

const FULL_POSE_CONNECTIONS = [
  ...UPPER_POSE_CONNECTIONS,
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [27, 29],
  [27, 31],
  [29, 31],
  [24, 26],
  [26, 28],
  [28, 30],
  [28, 32],
  [30, 32]
];

const FACE_CONNECTIONS = [
  [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109, 10],
  [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246, 33],
  [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466, 263],
  [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95, 61],
  [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 78],
  [70, 63, 105, 66, 107],
  [336, 296, 334, 293, 300]
];

const FACE_KEY_INDICES = [1, 10, 13, 14, 33, 61, 152, 234, 263, 291, 454];
const FACE_LEFT_EYE_INDICES = [33, 133, 145, 153, 159, 160, 161, 163, 173, 246];
const FACE_RIGHT_EYE_INDICES = [263, 362, 374, 380, 386, 387, 388, 390, 398, 466];
const HAND_TIP_INDICES = [4, 8, 12, 16, 20];
const HAND_GRAPHIC_ANCHORS = [0, 4, 8, 12, 16, 20];
const GUM_FINGER_TIPS = [8, 12, 16, 20] as const;
const GUM_FINGER_ROOTS: Record<(typeof GUM_FINGER_TIPS)[number], number> = {
  8: 5,
  12: 9,
  16: 13,
  20: 17
};
const GUM_PINCH_ENGAGE = 0.52;
const GUM_PINCH_RELEASE = 0.28;
const GUM_ATTACH_RADIUS = 0.12;
const GUM_CHEEK_ATTACH_RADIUS = 0.18;
const GUM_FACE_ATTACH_RADIUS = 0.16;
const GUM_SNAP_DURATION = 340;

export type TrackingPreviewMode = "none" | "upper" | "full" | "face" | "handsFace";

export type VisualDrumPadOverlayPad = {
  id: string;
  label: string;
  parameterLabel: string;
  xParameterLabel?: string;
  yParameterLabel?: string;
  value: number;
  enabled: boolean;
  intensity: number;
  active?: boolean;
  holdIntensity?: number;
  modulationDepth?: number;
  pressure?: number;
  pressureEnabled?: boolean;
  pressureVelocity?: number;
  zone?: "center" | "top" | "bottom" | "left" | "right";
  zoneEnabled?: boolean;
  xyEnabled?: boolean;
  xyX?: number;
  xyY?: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CompositorOptions = {
  showRig: boolean;
  showGestureOverlays?: boolean;
  effectAmount: number;
  selectedEffect: string;
  expressionPersonas?: boolean;
  liveMaskMode?: string;
  includeCameraFeed?: boolean;
  watermark?: {
    enabled: boolean;
    label: string;
    strength?: "subtle" | "strong";
  };
  trackingMode?: TrackingPreviewMode;
  visualMode?: "camera" | "shader";
  shaderScene?: ShaderScene;
  shaderParameters?: Record<string, ShaderParameterSettings>;
  visualDrumPads?: VisualDrumPadOverlayPad[];
};

let motionShaderPlayer: MotionShaderPlayer | null = null;

const maskEffectIds = new Set([
  "chromeMask",
  "wireSkull",
  "thermalFace",
  "crackedPorcelain",
  "cyberVisor",
  "contourPaint",
  "creatureFace"
]);

const bodyEffectIds = new Set(["bodyWire", "bodyThermal", "cyberSuit"]);

const expressionPersonaFrameCache = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();

type GumStretchTarget = {
  anchor: Vec2;
  tip: Vec2;
  label: "hand" | "face";
  strength: number;
};

type GumStretchMode = "any" | "hand" | "face";

type GumStretchRuntime = {
  phase: "idle" | "stretching" | "snapping";
  anchor: Vec2;
  tip: Vec2;
  smoothedTip: Vec2;
  snapStartTip: Vec2;
  snapStartedAt: number;
  targetLabel: "hand" | "face";
};

const gumStretchRuntimes = new WeakMap<HTMLCanvasElement, GumStretchRuntime>();

type NosePullRuntime = {
  phase: "idle" | "stretching" | "snapping";
  anchor: Vec2;
  smoothedTip: Vec2;
  snapStartTip: Vec2;
  snapStartedAt: number;
  strength: number;
};

const nosePullRuntimes = new WeakMap<HTMLCanvasElement, NosePullRuntime>();

const drawLine = (
  ctx: CanvasRenderingContext2D,
  a: Vec2,
  b: Vec2,
  width: number,
  stroke: string,
  glow = "transparent"
) => {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = width;
  ctx.strokeStyle = stroke;
  ctx.shadowColor = glow;
  ctx.shadowBlur = glow === "transparent" ? 0 : width * 3;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.restore();
};

const drawPoint = (ctx: CanvasRenderingContext2D, point: Vec2, radius: number, fill: string) => {
  ctx.save();
  ctx.fillStyle = fill;
  ctx.shadowColor = fill;
  ctx.shadowBlur = radius * 2.2;
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
};

const randomUnit = (seed: number) => {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

const drawRoundedRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) => {
  const nextRadius = Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2);
  ctx.beginPath();
  ctx.moveTo(x + nextRadius, y);
  ctx.lineTo(x + width - nextRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + nextRadius);
  ctx.lineTo(x + width, y + height - nextRadius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - nextRadius, y + height);
  ctx.lineTo(x + nextRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - nextRadius);
  ctx.lineTo(x, y + nextRadius);
  ctx.quadraticCurveTo(x, y, x + nextRadius, y);
  ctx.closePath();
};

const drawWatermark = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  label: string,
  strength: "subtle" | "strong" = "strong"
) => {
  const margin = Math.max(12, Math.round(Math.min(width, height) * 0.035));
  const fontSize = Math.max(14, Math.round(Math.min(width, height) * 0.042));
  const paddingX = Math.round(fontSize * 0.75);
  const paddingY = Math.round(fontSize * 0.5);
  const maxTextWidth = width - margin * 2 - paddingX * 2;
  const alpha = strength === "subtle" ? 0.62 : 0.86;

  ctx.save();
  ctx.font = `900 ${fontSize}px Inter, system-ui, sans-serif`;
  const measuredWidth = Math.min(ctx.measureText(label).width, maxTextWidth);
  const boxWidth = measuredWidth + paddingX * 2;
  const boxHeight = fontSize + paddingY * 2;
  const x = margin;
  const y = height - margin - boxHeight;

  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = alpha;
  drawRoundedRect(ctx, x, y, boxWidth, boxHeight, Math.max(8, Math.round(fontSize * 0.35)));
  ctx.fillStyle = "rgba(2, 8, 15, 0.78)";
  ctx.fill();
  ctx.strokeStyle = "rgba(198, 244, 93, 0.72)";
  ctx.lineWidth = Math.max(1, fontSize * 0.06);
  ctx.stroke();

  ctx.globalAlpha = Math.min(1, alpha + 0.08);
  ctx.fillStyle = "rgba(247, 243, 234, 0.96)";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + paddingX, y + boxHeight / 2, maxTextWidth);
  ctx.restore();
};

const gradientDisc = (
  ctx: CanvasRenderingContext2D,
  center: Vec2,
  radius: number,
  stops: Array<[number, string]>,
  operation: GlobalCompositeOperation = "screen"
) => {
  const gradient = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, radius);
  stops.forEach(([offset, color]) => gradient.addColorStop(offset, color));
  ctx.save();
  ctx.globalCompositeOperation = operation;
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
};

const drawLeafShape = (
  ctx: CanvasRenderingContext2D,
  point: Vec2,
  length: number,
  angle: number,
  fill: string,
  stroke: string,
  alpha: number
) => {
  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.rotate(angle);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = Math.max(1, length * 0.045);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(length * 0.48, -length * 0.16, length * 0.5, -length * 0.78, 0, -length);
  ctx.bezierCurveTo(-length * 0.5, -length * 0.78, -length * 0.48, -length * 0.16, 0, 0);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -length * 0.08);
  ctx.lineTo(0, -length * 0.78);
  ctx.stroke();
  ctx.restore();
};

const drawStarShape = (
  ctx: CanvasRenderingContext2D,
  point: Vec2,
  radius: number,
  rotation: number,
  fill: string,
  stroke: string,
  alpha: number
) => {
  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.rotate(rotation);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = Math.max(1, radius * 0.12);
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const nextRadius = i % 2 === 0 ? radius : radius * 0.42;
    const x = Math.cos(angle) * nextRadius;
    const y = Math.sin(angle) * nextRadius;
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
};

const drawMirrorComposite = (ctx: CanvasRenderingContext2D, width: number, height: number, amount: number) => {
  const split = Math.round(width / 2);

  ctx.save();
  ctx.beginPath();
  ctx.rect(split, 0, width - split, height);
  ctx.clip();
  ctx.translate(width, 0);
  ctx.scale(-1, 1);
  ctx.globalAlpha = 0.98;
  ctx.drawImage(ctx.canvas, 0, 0, split, height, 0, 0, split, height);
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = Math.min(0.34, 0.12 + amount * 0.12);
  ctx.drawImage(ctx.canvas, Math.max(0, split - 90), 0, Math.min(180, width), height, split - 58, 0, 116, height);
  ctx.drawImage(ctx.canvas, Math.max(0, split - 42), 0, Math.min(84, width), height, split - 24, 0, 48, height);
  ctx.restore();

  const seam = ctx.createLinearGradient(split - 28, 0, split + 28, 0);
  seam.addColorStop(0, "rgba(0, 0, 0, 0)");
  seam.addColorStop(0.48, `rgba(128, 255, 224, ${0.12 + amount * 0.12})`);
  seam.addColorStop(0.52, `rgba(255, 240, 142, ${0.1 + amount * 0.1})`);
  seam.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = seam;
  ctx.fillRect(split - 28, 0, 56, height);
  ctx.restore();
};

const drawEdgeDetectPass = (ctx: CanvasRenderingContext2D, width: number, height: number, amount: number) => {
  const offset = Math.max(1, Math.round(1 + amount * 2));

  ctx.save();
  ctx.globalCompositeOperation = "difference";
  ctx.globalAlpha = Math.min(0.86, 0.48 + amount * 0.2);
  ctx.drawImage(ctx.canvas, -offset, 0, width, height);
  ctx.drawImage(ctx.canvas, offset, 0, width, height);
  ctx.drawImage(ctx.canvas, 0, -offset, width, height);
  ctx.drawImage(ctx.canvas, 0, offset, width, height);
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = `rgba(84, 255, 221, ${0.12 + amount * 0.08})`;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = `rgba(255, 243, 132, ${0.18 + amount * 0.16})`;
  ctx.lineWidth = Math.max(1, 1.4 * amount);
  for (let y = 0; y < height; y += Math.max(14, Math.round(34 - amount * 10))) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(width, y + 0.5);
    ctx.stroke();
  }
  ctx.restore();
};

const drawFireFace = (ctx: CanvasRenderingContext2D, motion: MotionFrame, width: number, height: number, amount: number) => {
  if (!motion.pose?.nose) return;
  const nose = pointToCanvas(motion.pose.nose, width, height);
  const t = motion.timestamp / 1000;
  gradientDisc(ctx, nose, 120 * amount, [
    [0, `rgba(255, 244, 146, ${0.52 * amount})`],
    [0.25, `rgba(255, 92, 32, ${0.42 * amount})`],
    [0.63, `rgba(228, 18, 72, ${0.18 * amount})`],
    [1, "rgba(0, 0, 0, 0)"]
  ]);

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < 28; i += 1) {
    const phase = t * (1.4 + (i % 7) * 0.17) + i * 1.9;
    const x = nose.x + Math.sin(phase) * (24 + (i % 6) * 8) * amount;
    const y = nose.y - 28 - ((i * 17 + t * 80) % 120) * amount;
    const radius = 10 + ((i * 11) % 24);
    const alpha = 0.08 + ((i % 5) / 18);
    ctx.fillStyle = `rgba(255, ${80 + (i % 5) * 32}, 32, ${alpha * amount})`;
    ctx.beginPath();
    ctx.ellipse(x, y, radius * 0.62, radius * 1.4, Math.sin(phase), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
};

const drawLeafSprouts = (ctx: CanvasRenderingContext2D, motion: MotionFrame, width: number, height: number, amount: number) => {
  const t = motion.timestamp / 1000;
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  motion.hands.forEach((hand, handIndex) => {
    const direction = hand.handedness === "Left" ? -1 : 1;
    HAND_GRAPHIC_ANCHORS.forEach((anchorIndex) => {
      const landmark = hand.landmarks[anchorIndex];
      if (!landmark) return;
      const anchor = pointToCanvas(landmark, width, height);
      const seed = handIndex * 30 + anchorIndex * 7;
      const stemLength = (34 + randomUnit(seed) * 46 + hand.velocity * 34) * amount;
      const stemAngle = -Math.PI / 2 + direction * (0.18 + randomUnit(seed + 1) * 0.7) + Math.sin(t * 1.7 + seed) * 0.18;
      const tip = {
        x: anchor.x + Math.cos(stemAngle) * stemLength,
        y: anchor.y + Math.sin(stemAngle) * stemLength
      };
      const alpha = Math.min(0.9, (0.36 + hand.openness * 0.3 + amount * 0.22) * amount);

      ctx.strokeStyle = `rgba(122, 255, 159, ${alpha * 0.58})`;
      ctx.lineWidth = Math.max(1.2, 2.8 * amount);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(anchor.x, anchor.y);
      ctx.quadraticCurveTo(
        anchor.x + Math.cos(stemAngle - 0.6) * stemLength * 0.35,
        anchor.y + Math.sin(stemAngle - 0.6) * stemLength * 0.35,
        tip.x,
        tip.y
      );
      ctx.stroke();

      for (let leaf = 0; leaf < 3; leaf += 1) {
        const along = 0.42 + leaf * 0.2;
        const side = leaf % 2 === 0 ? -1 : 1;
        const point = {
          x: anchor.x + (tip.x - anchor.x) * along,
          y: anchor.y + (tip.y - anchor.y) * along
        };
        const leafLength = (12 + randomUnit(seed + leaf + 2) * 18) * amount;
        drawLeafShape(
          ctx,
          point,
          leafLength,
          stemAngle + side * (0.82 + randomUnit(seed + leaf + 5) * 0.34),
          leaf % 2 === 0 ? "#76ff9e" : "#d3ff78",
          "rgba(230, 255, 196, 0.72)",
          alpha
        );
      }
    });
  });

  if (motion.pose?.nose) {
    const nose = pointToCanvas(motion.pose.nose, width, height);
    for (let i = 0; i < 10; i += 1) {
      const angle = -Math.PI + (i / 9) * Math.PI * 2 + Math.sin(t * 0.9 + i) * 0.12;
      const radius = (42 + randomUnit(i + 4) * 42) * amount;
      const point = {
        x: nose.x + Math.cos(angle) * radius,
        y: nose.y + Math.sin(angle) * radius * 0.72
      };
      drawLeafShape(
        ctx,
        point,
        (13 + randomUnit(i + 9) * 19) * amount,
        angle + Math.PI / 2,
        i % 2 === 0 ? "#6fffaa" : "#f0ff8f",
        "rgba(235, 255, 203, 0.72)",
        0.28 * amount
      );
    }
  }
  ctx.restore();
};

const drawHandMelt = (ctx: CanvasRenderingContext2D, motion: MotionFrame, width: number, height: number, amount: number) => {
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  motion.hands.forEach((hand, handIndex) => {
    hand.landmarks.forEach((landmark, index) => {
      if (!HAND_TIP_INDICES.includes(index)) return;
      const point = pointToCanvas(landmark, width, height);
      const length = (70 + hand.velocity * 160 + index * 4) * amount;
      const hue = handIndex === 0 ? 178 : 48;
      const gradient = ctx.createLinearGradient(point.x, point.y, point.x, point.y + length);
      gradient.addColorStop(0, `hsla(${hue}, 100%, 64%, ${0.42 * amount})`);
      gradient.addColorStop(1, `hsla(${hue + 28}, 100%, 50%, 0)`);
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 10;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
      ctx.bezierCurveTo(
        point.x + Math.sin(motion.timestamp / 280 + index) * 24,
        point.y + length * 0.28,
        point.x - Math.cos(motion.timestamp / 340 + index) * 20,
        point.y + length * 0.74,
        point.x,
        point.y + length
      );
      ctx.stroke();
    });
  });
  ctx.restore();
};

const drawStickerBurst = (ctx: CanvasRenderingContext2D, motion: MotionFrame, width: number, height: number, amount: number) => {
  const palette = [
    ["#fff06f", "rgba(255, 255, 210, 0.92)"],
    ["#ff7ac8", "rgba(255, 221, 247, 0.9)"],
    ["#73f7ff", "rgba(216, 253, 255, 0.9)"],
    ["#b3ff7a", "rgba(235, 255, 210, 0.9)"]
  ] as const;
  const t = motion.timestamp / 1000;

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  motion.hands.forEach((hand, handIndex) => {
    const burst = Math.max(0.42, hand.openness + hand.velocity * 0.6) * amount;
    HAND_TIP_INDICES.forEach((index, tipOrder) => {
      const landmark = hand.landmarks[index];
      if (!landmark) return;
      const point = pointToCanvas(landmark, width, height);
      for (let i = 0; i < 3; i += 1) {
        const seed = handIndex * 80 + index * 11 + i;
        const driftAngle = randomUnit(seed) * Math.PI * 2 + t * (0.2 + i * 0.07);
        const drift = (12 + i * 17 + hand.velocity * 42) * amount;
        const stickerPoint = {
          x: point.x + Math.cos(driftAngle) * drift,
          y: point.y + Math.sin(driftAngle) * drift
        };
        const [fill, stroke] = palette[(tipOrder + i + handIndex) % palette.length];
        drawStarShape(
          ctx,
          stickerPoint,
          (8 + randomUnit(seed + 3) * 13) * burst,
          t * (0.8 + i * 0.18) + seed,
          fill,
          stroke,
          Math.min(0.86, 0.26 + burst * 0.4)
        );
      }
    });
  });
  ctx.restore();
};

const drawPinchWarp = (ctx: CanvasRenderingContext2D, motion: MotionFrame, width: number, height: number, amount: number) => {
  motion.hands.forEach((hand) => {
    if (hand.pinch < 0.24) return;
    const thumb = hand.landmarks[4];
    const index = hand.landmarks[8];
    if (!thumb || !index) return;
    const center = pointToCanvas(
      {
        x: (thumb.x + index.x) / 2,
        y: (thumb.y + index.y) / 2
      },
      width,
      height
    );
    const strength = hand.pinch * amount;
    gradientDisc(ctx, center, 96 * strength, [
      [0, `rgba(154, 255, 244, ${0.36 * strength})`],
      [0.45, `rgba(81, 134, 255, ${0.2 * strength})`],
      [1, "rgba(0, 0, 0, 0)"]
    ]);

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.strokeStyle = `rgba(204, 255, 246, ${0.48 * strength})`;
    ctx.lineWidth = 2;
    for (let i = 0; i < 7; i += 1) {
      ctx.beginPath();
      ctx.arc(center.x, center.y, 18 + i * 13, motion.timestamp / 600 + i, Math.PI * 1.5 + motion.timestamp / 700 + i);
      ctx.stroke();
    }
    ctx.restore();
  });
};

const midpoint = (a: Vec2, b: Vec2): Vec2 => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2
});

const mixPoint = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t
});

const getPinchPoint = (hand: MotionFrame["hands"][number]): Vec2 | undefined => {
  const thumb = hand.landmarks[4];
  const index = hand.landmarks[8];
  return thumb && index ? midpoint(thumb, index) : undefined;
};

const getBestGumStretchTarget = (motion: MotionFrame, mode: GumStretchMode = "any"): GumStretchTarget | null => {
  const pinchingHands = motion.hands
    .map((hand, index) => ({ hand, index, pinchPoint: getPinchPoint(hand) }))
    .filter((entry) => entry.pinchPoint && entry.hand.pinch > GUM_PINCH_ENGAGE)
    .sort((a, b) => b.hand.pinch - a.hand.pinch);

  if (mode !== "face") {
    for (const grabber of pinchingHands) {
      let best:
        | {
            distance: number;
            anchor: Vec2;
            tip: Vec2;
          }
        | undefined;

      motion.hands.forEach((bodyHand, bodyIndex) => {
        GUM_FINGER_TIPS.forEach((tipIndex) => {
          if (bodyIndex === grabber.index && tipIndex === 8) return;
          const grabbedTip = bodyHand.landmarks[tipIndex];
          const anchor = bodyHand.landmarks[GUM_FINGER_ROOTS[tipIndex]];
          if (!grabbedTip || !anchor || !grabber.pinchPoint) return;
          const grabDistance = distance(grabbedTip, grabber.pinchPoint);
          const attachRadius = bodyIndex === grabber.index ? GUM_ATTACH_RADIUS * 0.82 : GUM_ATTACH_RADIUS;
          if (grabDistance < attachRadius && (!best || grabDistance < best.distance)) {
            best = {
              distance: grabDistance,
              anchor,
              tip: grabber.pinchPoint
            };
          }
        });
      });

      if (best) {
        return {
          anchor: best.anchor,
          tip: best.tip,
          label: "hand",
          strength: grabber.hand.pinch
        };
      }
    }
  }

  if (mode === "hand") {
    return null;
  }

  const faceAnchors = motion.face
    ? [
        { anchor: motion.face.nose, radius: GUM_FACE_ATTACH_RADIUS },
        { anchor: motion.face.chin, radius: GUM_FACE_ATTACH_RADIUS },
        { anchor: motion.face.leftCheek, radius: GUM_CHEEK_ATTACH_RADIUS },
        { anchor: motion.face.rightCheek, radius: GUM_CHEEK_ATTACH_RADIUS },
        { anchor: motion.face.leftEar, radius: GUM_CHEEK_ATTACH_RADIUS },
        { anchor: motion.face.rightEar, radius: GUM_CHEEK_ATTACH_RADIUS }
      ].filter((entry): entry is { anchor: Vec2; radius: number } => Boolean(entry.anchor))
    : motion.pose?.nose
      ? [{ anchor: motion.pose.nose, radius: GUM_FACE_ATTACH_RADIUS }]
      : [];

  for (const grabber of pinchingHands) {
    if (!grabber.pinchPoint) continue;
    const faceTarget = faceAnchors
      .map((entry) => ({ ...entry, distance: distance(entry.anchor, grabber.pinchPoint as Vec2) }))
      .filter((entry) => entry.distance < entry.radius)
      .sort((a, b) => a.distance - b.distance)[0];
    if (faceTarget) {
      return {
        anchor: faceTarget.anchor,
        tip: grabber.pinchPoint,
        label: "face",
        strength: grabber.hand.pinch
      };
    }
  }

  return null;
};

const easeSpring = (t: number) => {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 1 - Math.exp(-2.2 * t) * Math.cos(2.4 * Math.PI * t);
};

const drawGumTube = (
  ctx: CanvasRenderingContext2D,
  anchor: Vec2,
  tip: Vec2,
  width: number,
  height: number,
  amount: number,
  strength: number,
  label: "hand" | "face"
) => {
  const start = pointToCanvas(anchor, width, height);
  const end = pointToCanvas(tip, width, height);
  const length = distance(start, end);
  if (length < 8) return;

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const invLength = 1 / Math.max(0.001, length);
  const normal = { x: -dy * invLength, y: dx * invLength };
  const handedBulge = label === "face" ? -1 : 1;
  const bulge = Math.min(length * 0.16, 72 * amount) * handedBulge;
  const control = {
    x: (start.x + end.x) / 2 + normal.x * bulge,
    y: (start.y + end.y) / 2 + normal.y * bulge
  };
  const thinning = 1 / (1 + length / 540);
  const rootWidth = Math.max(6, 34 * amount * thinning * (0.78 + strength * 0.32));
  const tipWidth = Math.max(4, rootWidth * 0.38);
  const samples = 30;
  const left: Vec2[] = [];
  const right: Vec2[] = [];
  const centers: Vec2[] = [];

  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    const a = mixPoint(start, control, t);
    const b = mixPoint(control, end, t);
    const center = mixPoint(a, b, t);
    const nextT = Math.min(1, t + 1 / samples);
    const nextA = mixPoint(start, control, nextT);
    const nextB = mixPoint(control, end, nextT);
    const nextCenter = mixPoint(nextA, nextB, nextT);
    const tangent = {
      x: nextCenter.x - center.x || dx,
      y: nextCenter.y - center.y || dy
    };
    const tangentLength = Math.max(0.001, Math.hypot(tangent.x, tangent.y));
    const localNormal = { x: -tangent.y / tangentLength, y: tangent.x / tangentLength };
    const tubeWidth = rootWidth + (tipWidth - rootWidth) * t;
    left.push({ x: center.x + localNormal.x * tubeWidth, y: center.y + localNormal.y * tubeWidth });
    right.push({ x: center.x - localNormal.x * tubeWidth, y: center.y - localNormal.y * tubeWidth });
    centers.push(center);
  }

  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.shadowColor = "rgba(255, 76, 112, 0.55)";
  ctx.shadowBlur = Math.max(12, rootWidth * 1.2);
  ctx.beginPath();
  [...left, ...right.reverse()].forEach((point, index) => {
    if (index === 0) {
      ctx.moveTo(point.x, point.y);
    } else {
      ctx.lineTo(point.x, point.y);
    }
  });
  ctx.closePath();
  ctx.fillStyle = label === "face" ? "rgba(255, 104, 138, 0.88)" : "rgba(237, 62, 88, 0.9)";
  ctx.fill();
  ctx.strokeStyle = "rgba(116, 18, 34, 0.68)";
  ctx.lineWidth = Math.max(2, rootWidth * 0.12);
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.globalCompositeOperation = "screen";
  ctx.strokeStyle = "rgba(255, 226, 214, 0.58)";
  ctx.lineWidth = Math.max(2, tipWidth * 0.42);
  ctx.beginPath();
  centers.forEach((center, index) => {
    const highlight = {
      x: center.x + normal.x * rootWidth * 0.28,
      y: center.y + normal.y * rootWidth * 0.28
    };
    if (index === 0) {
      ctx.moveTo(highlight.x, highlight.y);
    } else {
      ctx.lineTo(highlight.x, highlight.y);
    }
  });
  ctx.stroke();

  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "rgba(255, 214, 92, 0.92)";
  ctx.shadowColor = "rgba(255, 214, 92, 0.62)";
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.arc(start.x, start.y, Math.max(5, rootWidth * 0.24), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
};

const drawGumStretch = (
  ctx: CanvasRenderingContext2D,
  motion: MotionFrame,
  width: number,
  height: number,
  amount: number,
  mode: GumStretchMode = "any"
) => {
  const now = motion.timestamp;
  const target = getBestGumStretchTarget(motion, mode);
  const runtime = gumStretchRuntimes.get(ctx.canvas) ?? {
    phase: "idle",
    anchor: { x: 0.5, y: 0.5 },
    tip: { x: 0.5, y: 0.5 },
    smoothedTip: { x: 0.5, y: 0.5 },
    snapStartTip: { x: 0.5, y: 0.5 },
    snapStartedAt: 0,
    targetLabel: "hand" as const
  };

  const anyPinchHeld = motion.hands.some((hand) => hand.pinch > GUM_PINCH_RELEASE);
  if (target) {
    const wasStretching = runtime.phase === "stretching";
    runtime.phase = "stretching";
    runtime.anchor = target.anchor;
    runtime.tip = target.tip;
    runtime.smoothedTip = wasStretching ? mixPoint(runtime.smoothedTip, target.tip, 0.48) : target.tip;
    runtime.targetLabel = target.label;
  } else if (runtime.phase === "stretching" && !anyPinchHeld) {
    runtime.phase = "snapping";
    runtime.snapStartedAt = now;
    runtime.snapStartTip = runtime.smoothedTip;
  }

  if (runtime.phase === "stretching") {
    drawGumTube(ctx, runtime.anchor, runtime.smoothedTip, width, height, amount, target?.strength ?? 1, runtime.targetLabel);
  } else if (runtime.phase === "snapping") {
    const progress = clamp((now - runtime.snapStartedAt) / GUM_SNAP_DURATION, 0, 1);
    const eased = easeSpring(progress);
    const snapTip = mixPoint(runtime.snapStartTip, runtime.anchor, eased);
    drawGumTube(ctx, runtime.anchor, snapTip, width, height, amount, 1 - progress * 0.35, runtime.targetLabel);
    if (progress >= 1) {
      runtime.phase = "idle";
    }
  }

  gumStretchRuntimes.set(ctx.canvas, runtime);
};

const drawContourBands = (ctx: CanvasRenderingContext2D, motion: MotionFrame, width: number, height: number, amount: number) => {
  const t = motion.timestamp / 1000;

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (motion.pose?.nose) {
    const nose = pointToCanvas(motion.pose.nose, width, height);
    const shoulderSpan =
      motion.pose.leftShoulder && motion.pose.rightShoulder
        ? Math.abs(motion.pose.leftShoulder.x - motion.pose.rightShoulder.x) * width
        : width * 0.22;
    for (let i = 0; i < 5; i += 1) {
      const radiusX = (shoulderSpan * (0.22 + i * 0.06) + 20) * amount;
      const radiusY = radiusX * (0.72 + i * 0.03);
      ctx.strokeStyle = `hsla(${166 + i * 24}, 100%, ${66 + i * 2}%, ${0.16 + amount * 0.12})`;
      ctx.lineWidth = Math.max(1, (2.2 - i * 0.12) * amount);
      ctx.beginPath();
      ctx.ellipse(
        nose.x + Math.sin(t * 1.1 + i) * 3 * amount,
        nose.y + 16 * amount,
        radiusX,
        radiusY,
        Math.sin(t * 0.45) * 0.08,
        Math.PI * (0.08 + i * 0.03),
        Math.PI * (1.92 - i * 0.03)
      );
      ctx.stroke();
    }
  }

  motion.hands.forEach((hand, handIndex) => {
    const center = pointToCanvas(hand.centroid, width, height);
    HAND_CONNECTIONS.forEach(([start, end], segmentIndex) => {
      const a = hand.landmarks[start];
      const b = hand.landmarks[end];
      if (!a || !b || segmentIndex % 2 !== handIndex % 2) return;
      const pointA = pointToCanvas(a, width, height);
      const pointB = pointToCanvas(b, width, height);
      const wobble = Math.sin(t * 2.2 + segmentIndex) * 8 * amount;
      ctx.strokeStyle = hand.handedness === "Left" ? "rgba(255, 234, 111, 0.34)" : "rgba(109, 255, 213, 0.34)";
      ctx.lineWidth = Math.max(1, 3 * amount);
      ctx.beginPath();
      ctx.moveTo(pointA.x, pointA.y);
      ctx.quadraticCurveTo(center.x + wobble, center.y - wobble, pointB.x, pointB.y);
      ctx.stroke();
    });
  });

  ctx.restore();
};

const drawPalmBloom = (ctx: CanvasRenderingContext2D, motion: MotionFrame, width: number, height: number, amount: number) => {
  motion.hands.forEach((hand) => {
    if (hand.openness < 0.38) return;
    const center = pointToCanvas(hand.centroid, width, height);
    gradientDisc(ctx, center, 130 * hand.openness * amount, [
      [0, `rgba(177, 255, 185, ${0.22 * hand.openness * amount})`],
      [0.5, `rgba(72, 255, 201, ${0.2 * amount})`],
      [1, "rgba(0, 0, 0, 0)"]
    ]);
  });
};

const drawOrbitOverlays = (ctx: CanvasRenderingContext2D, motion: MotionFrame, width: number, height: number, amount: number) => {
  const t = motion.timestamp / 1000;
  const centers = motion.hands.map((hand) => pointToCanvas(hand.centroid, width, height));
  if (motion.pose?.nose) {
    centers.push(pointToCanvas(motion.pose.nose, width, height));
  }

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  centers.forEach((center, centerIndex) => {
    const baseRadius = (38 + centerIndex * 13) * amount;
    for (let ring = 0; ring < 3; ring += 1) {
      const radiusX = baseRadius + ring * 22 * amount;
      const radiusY = radiusX * (0.38 + ring * 0.1);
      const rotation = t * (0.38 + ring * 0.12) + centerIndex;
      ctx.strokeStyle = `hsla(${188 + ring * 34 + centerIndex * 24}, 100%, 70%, ${0.16 + amount * 0.16})`;
      ctx.lineWidth = Math.max(1, (2.4 - ring * 0.2) * amount);
      ctx.beginPath();
      ctx.ellipse(center.x, center.y, radiusX, radiusY, rotation, 0, Math.PI * 2);
      ctx.stroke();

      const dotAngle = t * (1.3 + ring * 0.34) + centerIndex * 1.7 + ring;
      drawPoint(
        ctx,
        {
          x: center.x + Math.cos(dotAngle) * radiusX,
          y: center.y + Math.sin(dotAngle) * radiusY
        },
        Math.max(2, 4.6 * amount),
        ring % 2 === 0 ? "rgba(248, 255, 139, 0.82)" : "rgba(115, 247, 255, 0.82)"
      );
    }
  });
  ctx.restore();
};

type CharacterFrame = {
  center: Vec2;
  width: number;
  height: number;
  angle: number;
  face?: TrackedFace;
};

const getCharacterFrame = (motion: MotionFrame, width: number, height: number): CharacterFrame | undefined => {
  if (motion.face) {
    const face = motion.face;
    const center = pointToCanvas(face.center, width, height);
    const leftEye = face.leftEye ? pointToCanvas(face.leftEye, width, height) : undefined;
    const rightEye = face.rightEye ? pointToCanvas(face.rightEye, width, height) : undefined;
    const angle = leftEye && rightEye ? Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x) : 0;
    const faceWidth = Math.max(72, Math.abs(face.bounds.maxX - face.bounds.minX) * width);
    const faceHeight = Math.max(92, Math.abs(face.bounds.maxY - face.bounds.minY) * height);
    return {
      center: {
        x: center.x,
        y: center.y + faceHeight * 0.03
      },
      width: faceWidth,
      height: faceHeight,
      angle,
      face
    };
  }

  if (motion.pose?.nose) {
    const nose = pointToCanvas(motion.pose.nose, width, height);
    const shoulderSpan =
      motion.pose.leftShoulder && motion.pose.rightShoulder
        ? Math.abs(motion.pose.leftShoulder.x - motion.pose.rightShoulder.x) * width
        : width * 0.22;
    const faceWidth = Math.max(76, shoulderSpan * 0.44);
    return {
      center: {
        x: nose.x,
        y: nose.y + faceWidth * 0.22
      },
      width: faceWidth,
      height: faceWidth * 1.2,
      angle: 0
    };
  }

  return undefined;
};

const withCharacterFrame = (
  ctx: CanvasRenderingContext2D,
  frame: CharacterFrame,
  draw: (frameWidth: number, frameHeight: number) => void
) => {
  ctx.save();
  ctx.translate(frame.center.x, frame.center.y);
  ctx.rotate(frame.angle);
  draw(frame.width, frame.height);
  ctx.restore();
};

const drawFaceScaleWarp = (
  ctx: CanvasRenderingContext2D,
  motion: MotionFrame,
  width: number,
  height: number,
  amount: number,
  mode: "stretch" | "squash"
) => {
  const frame = getCharacterFrame(motion, width, height);
  if (!frame) return;

  const strength = clamp(amount, 0.18, 1.35);
  const sourceWidth = Math.min(width, frame.width * 1.2);
  const sourceHeight = Math.min(height, frame.height * 1.16);
  const sourceX = clamp(frame.center.x - sourceWidth / 2, 0, Math.max(0, width - sourceWidth));
  const sourceY = clamp(frame.center.y - sourceHeight / 2, 0, Math.max(0, height - sourceHeight));
  const scaleX = mode === "stretch" ? 1 - 0.14 * strength : 1 + 0.3 * strength;
  const scaleY = mode === "stretch" ? 1 + 0.34 * strength : Math.max(0.48, 1 - 0.26 * strength);
  const targetWidth = sourceWidth * scaleX;
  const targetHeight = sourceHeight * scaleY;
  const pulse = 0.04 * Math.sin(motion.timestamp / 180);

  withCharacterFrame(ctx, frame, () => {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(0, 0, (targetWidth / 2) * (1 + pulse), (targetHeight / 2) * (1 - pulse * 0.5), 0, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(ctx.canvas, sourceX, sourceY, sourceWidth, sourceHeight, -targetWidth / 2, -targetHeight / 2, targetWidth, targetHeight);

    ctx.globalCompositeOperation = "screen";
    ctx.strokeStyle = mode === "stretch" ? "rgba(118, 255, 235, 0.42)" : "rgba(255, 218, 112, 0.46)";
    ctx.lineWidth = Math.max(2, 3.4 * strength);
    ctx.beginPath();
    ctx.ellipse(0, 0, targetWidth / 2, targetHeight / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  });
};

const getNosePullTarget = (motion: MotionFrame) => {
  const nose = motion.face?.nose ?? motion.pose?.nose;
  if (!nose) return null;

  const grabber = motion.hands
    .map((hand) => ({ hand, pinchPoint: getPinchPoint(hand), distance: distance(hand.centroid, nose) }))
    .filter((entry): entry is { hand: MotionFrame["hands"][number]; pinchPoint: Vec2; distance: number } =>
      Boolean(entry.pinchPoint) && entry.hand.pinch > GUM_PINCH_ENGAGE && distance(entry.pinchPoint as Vec2, nose) < GUM_FACE_ATTACH_RADIUS
    )
    .sort((a, b) => b.hand.pinch - a.hand.pinch || a.distance - b.distance)[0];

  return grabber
    ? {
        anchor: nose,
        tip: grabber.pinchPoint,
        strength: grabber.hand.pinch
      }
    : null;
};

const drawNoseStretchPixels = (
  ctx: CanvasRenderingContext2D,
  motion: MotionFrame,
  anchor: Vec2,
  tip: Vec2,
  width: number,
  height: number,
  amount: number,
  strength: number
) => {
  const start = pointToCanvas(anchor, width, height);
  const rawEnd = pointToCanvas(tip, width, height);
  const dx = rawEnd.x - start.x;
  const dy = rawEnd.y - start.y;
  const pullLength = Math.hypot(dx, dy);
  if (pullLength < 8) return;

  const frame = getCharacterFrame(motion, width, height);
  const faceWidth = frame?.width ?? width * 0.12;
  const faceHeight = frame?.height ?? height * 0.18;
  const stretchLength = Math.min(pullLength, Math.max(42, faceWidth * (0.72 + amount * 0.38)));
  const unit = { x: dx / pullLength, y: dy / pullLength };
  const normal = { x: -unit.y, y: unit.x };
  const end = {
    x: start.x + unit.x * stretchLength,
    y: start.y + unit.y * stretchLength
  };
  const angle = Math.atan2(unit.y, unit.x);
  const snapshot = document.createElement("canvas");
  snapshot.width = width;
  snapshot.height = height;
  const snapshotCtx = snapshot.getContext("2d");
  if (!snapshotCtx) return;
  snapshotCtx.drawImage(ctx.canvas, 0, 0);

  const sourceWidth = clamp(faceWidth * 0.34, 28, 96);
  const sourceHeight = clamp(faceHeight * 0.22, 22, 76);
  const sourceX = clamp(start.x - sourceWidth * 0.5, 0, Math.max(0, width - sourceWidth));
  const sourceY = clamp(start.y - sourceHeight * 0.48, 0, Math.max(0, height - sourceHeight));
  const samples = 24;
  const stripLength = Math.max(7, stretchLength / samples * 1.85);
  const baseAcross = Math.max(16, sourceHeight * (0.72 + amount * 0.18));
  const lift = Math.min(18, stretchLength * 0.09) * Math.sin(motion.timestamp / 260) * 0.18;

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    const taper = 1 - t * 0.58;
    const center = {
      x: start.x + (end.x - start.x) * t + normal.x * Math.sin(t * Math.PI) * lift,
      y: start.y + (end.y - start.y) * t + normal.y * Math.sin(t * Math.PI) * lift
    };
    const across = Math.max(8, baseAcross * taper);
    const sourceInset = sourceWidth * Math.min(0.3, t * 0.24);

    ctx.save();
    ctx.translate(center.x, center.y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.ellipse(0, 0, stripLength * 0.82, across * 0.55, 0, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(
      snapshot,
      clamp(sourceX + sourceInset, 0, Math.max(0, width - sourceWidth + sourceInset)),
      sourceY,
      Math.max(1, sourceWidth - sourceInset),
      sourceHeight,
      -stripLength * 0.86,
      -across / 2,
      stripLength * 1.72,
      across
    );
    ctx.restore();
  }

  ctx.globalCompositeOperation = "screen";
  ctx.strokeStyle = `rgba(128, 255, 249, ${0.18 + strength * 0.14})`;
  ctx.lineWidth = Math.max(1.4, baseAcross * 0.05);
  ctx.shadowColor = "rgba(95, 247, 255, 0.45)";
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.moveTo(start.x + normal.x * baseAcross * 0.42, start.y + normal.y * baseAcross * 0.42);
  ctx.quadraticCurveTo(
    (start.x + end.x) / 2 + normal.x * (baseAcross * 0.34 + lift),
    (start.y + end.y) / 2 + normal.y * (baseAcross * 0.34 + lift),
    end.x + normal.x * baseAcross * 0.16,
    end.y + normal.y * baseAcross * 0.16
  );
  ctx.stroke();
  ctx.restore();
};

const drawNosePullWarp = (
  ctx: CanvasRenderingContext2D,
  motion: MotionFrame,
  width: number,
  height: number,
  amount: number
) => {
  const now = motion.timestamp;
  const target = getNosePullTarget(motion);
  const runtime = nosePullRuntimes.get(ctx.canvas) ?? {
    phase: "idle",
    anchor: { x: 0.5, y: 0.5 },
    smoothedTip: { x: 0.5, y: 0.5 },
    snapStartTip: { x: 0.5, y: 0.5 },
    snapStartedAt: 0,
    strength: 1
  };
  const anyPinchHeld = motion.hands.some((hand) => hand.pinch > GUM_PINCH_RELEASE);

  if (target) {
    const wasStretching = runtime.phase === "stretching";
    runtime.phase = "stretching";
    runtime.anchor = target.anchor;
    runtime.smoothedTip = wasStretching ? mixPoint(runtime.smoothedTip, target.tip, 0.46) : target.tip;
    runtime.strength = target.strength;
  } else if (runtime.phase === "stretching" && !anyPinchHeld) {
    runtime.phase = "snapping";
    runtime.snapStartedAt = now;
    runtime.snapStartTip = runtime.smoothedTip;
  }

  if (runtime.phase === "stretching") {
    drawNoseStretchPixels(ctx, motion, runtime.anchor, runtime.smoothedTip, width, height, amount, runtime.strength);
  } else if (runtime.phase === "snapping") {
    const progress = clamp((now - runtime.snapStartedAt) / GUM_SNAP_DURATION, 0, 1);
    const eased = easeSpring(progress);
    const snapTip = mixPoint(runtime.snapStartTip, runtime.anchor, eased);
    drawNoseStretchPixels(ctx, motion, runtime.anchor, snapTip, width, height, amount, 1 - progress * 0.35);
    if (progress >= 1) {
      runtime.phase = "idle";
    }
  }

  nosePullRuntimes.set(ctx.canvas, runtime);
};

const drawCharacterHalo = (
  ctx: CanvasRenderingContext2D,
  frame: CharacterFrame,
  amount: number,
  colors: Array<[number, string]>
) => {
  gradientDisc(ctx, frame.center, frame.width * (0.88 + amount * 0.2), colors, "screen");
};

const drawCyberBotFilter = (
  ctx: CanvasRenderingContext2D,
  motion: MotionFrame,
  width: number,
  height: number,
  amount: number
) => {
  const frame = getCharacterFrame(motion, width, height);
  if (!frame) return;
  const mouthOpen = frame.face?.mouthOpenness ?? 0;
  drawCharacterHalo(ctx, frame, amount, [
    [0, `rgba(103, 255, 229, ${0.18 * amount})`],
    [0.62, `rgba(86, 149, 255, ${0.12 * amount})`],
    [1, "rgba(0, 0, 0, 0)"]
  ]);

  withCharacterFrame(ctx, frame, (faceWidth, faceHeight) => {
    const plateWidth = faceWidth * (1.14 + amount * 0.08);
    const plateHeight = faceHeight * (1.02 + amount * 0.05);
    const corner = plateWidth * 0.11;

    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.shadowColor = "rgba(86, 255, 228, 0.52)";
    ctx.shadowBlur = 18 * amount;
    drawRoundedRect(ctx, -plateWidth / 2, -plateHeight / 2, plateWidth, plateHeight, corner);
    const plate = ctx.createLinearGradient(-plateWidth / 2, -plateHeight / 2, plateWidth / 2, plateHeight / 2);
    plate.addColorStop(0, `rgba(28, 57, 62, ${0.72 + amount * 0.12})`);
    plate.addColorStop(0.48, `rgba(12, 20, 24, ${0.74 + amount * 0.1})`);
    plate.addColorStop(1, `rgba(56, 76, 95, ${0.68 + amount * 0.12})`);
    ctx.fillStyle = plate;
    ctx.fill();
    ctx.lineWidth = Math.max(2, faceWidth * 0.025);
    ctx.strokeStyle = `rgba(156, 255, 233, ${0.72 * amount})`;
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(132, 255, 226, 0.9)";
    [-0.24, 0.24].forEach((offset) => {
      drawRoundedRect(ctx, offset * plateWidth - plateWidth * 0.14, -plateHeight * 0.12, plateWidth * 0.28, plateHeight * 0.13, 8);
      ctx.fill();
    });

    const mouthY = plateHeight * 0.2;
    const mouthHeight = plateHeight * (0.08 + mouthOpen * 0.08);
    drawRoundedRect(ctx, -plateWidth * 0.22, mouthY, plateWidth * 0.44, mouthHeight, 6);
    ctx.fillStyle = "rgba(3, 11, 14, 0.9)";
    ctx.fill();
    ctx.strokeStyle = "rgba(139, 255, 230, 0.7)";
    ctx.lineWidth = 2;
    ctx.stroke();
    for (let i = -2; i <= 2; i += 1) {
      ctx.beginPath();
      ctx.moveTo(i * plateWidth * 0.075, mouthY + 3);
      ctx.lineTo(i * plateWidth * 0.075, mouthY + mouthHeight - 3);
      ctx.stroke();
    }

    ctx.strokeStyle = `rgba(255, 239, 132, ${0.62 * amount})`;
    ctx.lineWidth = Math.max(2, faceWidth * 0.018);
    ctx.beginPath();
    ctx.moveTo(0, -plateHeight * 0.5);
    ctx.lineTo(0, -plateHeight * 0.72);
    ctx.stroke();
    drawPoint(ctx, { x: 0, y: -plateHeight * 0.76 }, Math.max(4, faceWidth * 0.055), "rgba(255, 239, 132, 0.92)");
    ctx.restore();
  });
};

const drawPopIdolFilter = (
  ctx: CanvasRenderingContext2D,
  motion: MotionFrame,
  width: number,
  height: number,
  amount: number
) => {
  const frame = getCharacterFrame(motion, width, height);
  if (!frame) return;
  const smile = frame.face?.smile ?? 0.35;
  const bob = Math.sin(motion.timestamp / 320) * frame.width * 0.015 * amount;
  drawCharacterHalo(ctx, frame, amount, [
    [0, `rgba(255, 126, 204, ${0.14 * amount})`],
    [0.58, `rgba(255, 236, 126, ${0.1 * amount})`],
    [1, "rgba(0, 0, 0, 0)"]
  ]);

  withCharacterFrame(ctx, { ...frame, center: { x: frame.center.x, y: frame.center.y + bob } }, (faceWidth, faceHeight) => {
    const glassWidth = faceWidth * 0.33;
    const glassHeight = faceHeight * 0.18;
    const eyeY = -faceHeight * 0.11;
    const eyeGap = faceWidth * 0.22;

    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.shadowColor = "rgba(255, 122, 203, 0.56)";
    ctx.shadowBlur = 16 * amount;

    [-1, 1].forEach((side) => {
      drawStarShape(
        ctx,
        { x: side * eyeGap, y: eyeY },
        glassWidth * 0.55,
        side * 0.22,
        side < 0 ? "#ff73c7" : "#fff174",
        "rgba(255, 255, 245, 0.88)",
        clamp(0.58 + amount * 0.18, 0, 0.92)
      );
      ctx.fillStyle = "rgba(5, 8, 15, 0.64)";
      ctx.beginPath();
      ctx.ellipse(side * eyeGap, eyeY, glassWidth * 0.36, glassHeight * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.strokeStyle = "rgba(255, 255, 245, 0.82)";
    ctx.lineWidth = Math.max(2, faceWidth * 0.022);
    ctx.beginPath();
    ctx.moveTo(-eyeGap + glassWidth * 0.28, eyeY);
    ctx.quadraticCurveTo(0, eyeY - faceHeight * 0.04, eyeGap - glassWidth * 0.28, eyeY);
    ctx.stroke();

    const crownY = -faceHeight * 0.56;
    ctx.fillStyle = "rgba(255, 226, 91, 0.88)";
    ctx.strokeStyle = "rgba(255, 255, 224, 0.8)";
    ctx.lineWidth = Math.max(1.5, faceWidth * 0.015);
    ctx.beginPath();
    ctx.moveTo(-faceWidth * 0.22, crownY + faceHeight * 0.1);
    ctx.lineTo(-faceWidth * 0.14, crownY - faceHeight * 0.06);
    ctx.lineTo(0, crownY + faceHeight * 0.04);
    ctx.lineTo(faceWidth * 0.14, crownY - faceHeight * 0.06);
    ctx.lineTo(faceWidth * 0.22, crownY + faceHeight * 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    [-1, 1].forEach((side) => {
      const cheekX = side * faceWidth * 0.31;
      const cheekY = faceHeight * 0.11;
      const blush = ctx.createRadialGradient(cheekX, cheekY, 0, cheekX, cheekY, faceWidth * 0.16);
      blush.addColorStop(0, `rgba(255, 118, 180, ${0.32 + smile * 0.18})`);
      blush.addColorStop(1, "rgba(255, 118, 180, 0)");
      ctx.fillStyle = blush;
      ctx.beginPath();
      ctx.arc(cheekX, cheekY, faceWidth * 0.16, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  });
};

const drawComicHeroFilter = (
  ctx: CanvasRenderingContext2D,
  motion: MotionFrame,
  width: number,
  height: number,
  amount: number
) => {
  const frame = getCharacterFrame(motion, width, height);
  if (!frame) return;

  if (motion.pose?.leftShoulder && motion.pose.rightShoulder) {
    const left = pointToCanvas(motion.pose.leftShoulder, width, height);
    const right = pointToCanvas(motion.pose.rightShoulder, width, height);
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = `rgba(34, 64, 141, ${0.42 + amount * 0.14})`;
    ctx.strokeStyle = `rgba(255, 235, 104, ${0.52 * amount})`;
    ctx.lineWidth = Math.max(2, frame.width * 0.025);
    ctx.beginPath();
    ctx.moveTo(left.x - frame.width * 0.22, left.y + frame.height * 0.2);
    ctx.quadraticCurveTo(frame.center.x, frame.center.y + frame.height * 0.62, right.x + frame.width * 0.22, right.y + frame.height * 0.2);
    ctx.lineTo(right.x - frame.width * 0.06, right.y + frame.height * 0.02);
    ctx.quadraticCurveTo(frame.center.x, frame.center.y + frame.height * 0.34, left.x + frame.width * 0.06, left.y + frame.height * 0.02);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  drawCharacterHalo(ctx, frame, amount, [
    [0, `rgba(255, 236, 91, ${0.14 * amount})`],
    [0.62, `rgba(75, 130, 255, ${0.1 * amount})`],
    [1, "rgba(0, 0, 0, 0)"]
  ]);

  withCharacterFrame(ctx, frame, (faceWidth, faceHeight) => {
    const maskWidth = faceWidth * 1.02;
    const maskHeight = faceHeight * 0.3;
    const maskY = -faceHeight * 0.16;

    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.shadowColor = "rgba(255, 235, 104, 0.45)";
    ctx.shadowBlur = 14 * amount;
    ctx.fillStyle = "rgba(19, 29, 75, 0.86)";
    ctx.strokeStyle = "rgba(255, 235, 104, 0.82)";
    ctx.lineWidth = Math.max(2, faceWidth * 0.022);
    ctx.beginPath();
    ctx.moveTo(-maskWidth / 2, maskY);
    ctx.quadraticCurveTo(-faceWidth * 0.18, maskY - maskHeight * 0.42, 0, maskY - maskHeight * 0.12);
    ctx.quadraticCurveTo(faceWidth * 0.18, maskY - maskHeight * 0.42, maskWidth / 2, maskY);
    ctx.lineTo(maskWidth * 0.42, maskY + maskHeight * 0.68);
    ctx.quadraticCurveTo(0, maskY + maskHeight, -maskWidth * 0.42, maskY + maskHeight * 0.68);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    [-1, 1].forEach((side) => {
      ctx.fillStyle = "rgba(232, 255, 250, 0.92)";
      ctx.beginPath();
      ctx.ellipse(side * faceWidth * 0.22, maskY + maskHeight * 0.32, faceWidth * 0.13, faceHeight * 0.045, side * -0.18, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.fillStyle = "rgba(255, 235, 104, 0.9)";
    ctx.beginPath();
    ctx.moveTo(0, -faceHeight * 0.53);
    ctx.lineTo(-faceWidth * 0.08, -faceHeight * 0.3);
    ctx.lineTo(faceWidth * 0.02, -faceHeight * 0.3);
    ctx.lineTo(-faceWidth * 0.04, -faceHeight * 0.1);
    ctx.lineTo(faceWidth * 0.12, -faceHeight * 0.36);
    ctx.lineTo(faceWidth * 0.02, -faceHeight * 0.36);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  });
};

const drawToonKitFilter = (
  ctx: CanvasRenderingContext2D,
  motion: MotionFrame,
  width: number,
  height: number,
  amount: number
) => {
  const frame = getCharacterFrame(motion, width, height);
  if (!frame) return;
  const smile = frame.face?.smile ?? 0.4;

  drawCharacterHalo(ctx, frame, amount, [
    [0, `rgba(255, 214, 96, ${0.14 * amount})`],
    [0.64, `rgba(89, 220, 255, ${0.1 * amount})`],
    [1, "rgba(0, 0, 0, 0)"]
  ]);

  withCharacterFrame(ctx, frame, (faceWidth, faceHeight) => {
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.shadowColor = "rgba(255, 236, 138, 0.42)";
    ctx.shadowBlur = 10 * amount;
    ctx.fillStyle = `rgba(255, 229, 128, ${0.36 + amount * 0.22})`;
    ctx.strokeStyle = "rgba(35, 28, 20, 0.92)";
    ctx.lineWidth = Math.max(2.2, faceWidth * 0.025);

    ctx.beginPath();
    ctx.ellipse(0, 0, faceWidth * 0.52, faceHeight * 0.54, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    [-1, 1].forEach((side) => {
      ctx.fillStyle = "rgba(255, 245, 232, 0.96)";
      ctx.beginPath();
      ctx.ellipse(side * faceWidth * 0.22, -faceHeight * 0.08, faceWidth * 0.14, faceHeight * 0.16, side * -0.08, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "rgba(14, 20, 24, 0.9)";
      ctx.beginPath();
      ctx.arc(side * faceWidth * (0.22 + smile * 0.018), -faceHeight * 0.06, faceWidth * 0.045, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.fillStyle = "rgba(255, 108, 126, 0.72)";
    ctx.beginPath();
    ctx.arc(-faceWidth * 0.32, faceHeight * 0.12, faceWidth * 0.09, 0, Math.PI * 2);
    ctx.arc(faceWidth * 0.32, faceHeight * 0.12, faceWidth * 0.09, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(35, 28, 20, 0.92)";
    ctx.lineWidth = Math.max(2, faceWidth * 0.02);
    ctx.beginPath();
    ctx.arc(0, faceHeight * 0.13, faceWidth * (0.16 + smile * 0.08), 0.12 * Math.PI, 0.88 * Math.PI);
    ctx.stroke();
    ctx.restore();
  });
};

const drawBigBuckFilter = (
  ctx: CanvasRenderingContext2D,
  motion: MotionFrame,
  width: number,
  height: number,
  amount: number
) => {
  const frame = getCharacterFrame(motion, width, height);
  if (!frame) return;
  const mouthOpen = frame.face?.mouthOpenness ?? 0;

  drawCharacterHalo(ctx, frame, amount, [
    [0, `rgba(255, 236, 190, ${0.16 * amount})`],
    [0.58, `rgba(151, 255, 159, ${0.08 * amount})`],
    [1, "rgba(0, 0, 0, 0)"]
  ]);

  withCharacterFrame(ctx, frame, (faceWidth, faceHeight) => {
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.shadowColor = "rgba(255, 246, 213, 0.38)";
    ctx.shadowBlur = 12 * amount;

    [-1, 1].forEach((side) => {
      ctx.fillStyle = "rgba(231, 176, 105, 0.88)";
      ctx.strokeStyle = "rgba(65, 40, 24, 0.9)";
      ctx.lineWidth = Math.max(2, faceWidth * 0.025);
      ctx.beginPath();
      ctx.ellipse(side * faceWidth * 0.25, -faceHeight * 0.58, faceWidth * 0.15, faceHeight * 0.46, side * -0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "rgba(255, 224, 186, 0.86)";
      ctx.beginPath();
      ctx.ellipse(side * faceWidth * 0.25, -faceHeight * 0.58, faceWidth * 0.075, faceHeight * 0.33, side * -0.18, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.fillStyle = "rgba(207, 137, 67, 0.58)";
    ctx.beginPath();
    ctx.ellipse(0, -faceHeight * 0.02, faceWidth * 0.54, faceHeight * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(255, 237, 205, 0.9)";
    ctx.strokeStyle = "rgba(74, 43, 24, 0.85)";
    ctx.lineWidth = Math.max(2, faceWidth * 0.018);
    ctx.beginPath();
    ctx.ellipse(0, faceHeight * 0.18, faceWidth * 0.3, faceHeight * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "rgba(62, 34, 20, 0.96)";
    ctx.beginPath();
    ctx.ellipse(0, faceHeight * 0.07, faceWidth * 0.09, faceHeight * 0.055, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(255, 255, 245, 0.96)";
    const toothHeight = faceHeight * (0.09 + mouthOpen * 0.08);
    [-0.045, 0.045].forEach((offset) => {
      drawRoundedRect(ctx, faceWidth * offset - faceWidth * 0.04, faceHeight * 0.2, faceWidth * 0.075, toothHeight, faceWidth * 0.015);
      ctx.fill();
      ctx.stroke();
    });
    ctx.restore();
  });
};

const drawSintelFilter = (
  ctx: CanvasRenderingContext2D,
  motion: MotionFrame,
  width: number,
  height: number,
  amount: number
) => {
  const frame = getCharacterFrame(motion, width, height);
  if (!frame) return;

  if (motion.pose?.leftShoulder && motion.pose.rightShoulder) {
    const left = pointToCanvas(motion.pose.leftShoulder, width, height);
    const right = pointToCanvas(motion.pose.rightShoulder, width, height);
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = `rgba(71, 31, 28, ${0.36 + amount * 0.14})`;
    ctx.strokeStyle = `rgba(226, 165, 96, ${0.55 * amount})`;
    ctx.lineWidth = Math.max(2, frame.width * 0.018);
    ctx.beginPath();
    ctx.moveTo(left.x - frame.width * 0.08, left.y - frame.height * 0.02);
    ctx.quadraticCurveTo(frame.center.x, frame.center.y + frame.height * 0.7, right.x + frame.width * 0.08, right.y - frame.height * 0.02);
    ctx.lineTo(right.x - frame.width * 0.12, right.y + frame.height * 0.22);
    ctx.quadraticCurveTo(frame.center.x, frame.center.y + frame.height * 0.48, left.x + frame.width * 0.12, left.y + frame.height * 0.22);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  withCharacterFrame(ctx, frame, (faceWidth, faceHeight) => {
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.shadowColor = "rgba(255, 190, 112, 0.32)";
    ctx.shadowBlur = 10 * amount;

    ctx.fillStyle = "rgba(75, 37, 28, 0.88)";
    ctx.strokeStyle = "rgba(238, 172, 91, 0.86)";
    ctx.lineWidth = Math.max(2, faceWidth * 0.022);
    drawRoundedRect(ctx, -faceWidth * 0.54, -faceHeight * 0.32, faceWidth * 1.08, faceHeight * 0.16, faceWidth * 0.035);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = "rgba(236, 162, 85, 0.72)";
    ctx.lineWidth = Math.max(2.2, faceWidth * 0.026);
    [-1, 1].forEach((side) => {
      ctx.beginPath();
      ctx.moveTo(side * faceWidth * 0.12, -faceHeight * 0.35);
      ctx.quadraticCurveTo(side * faceWidth * 0.34, -faceHeight * 0.52, side * faceWidth * 0.52, -faceHeight * 0.44);
      ctx.stroke();
    });

    ctx.strokeStyle = "rgba(255, 223, 155, 0.78)";
    ctx.lineWidth = Math.max(1.5, faceWidth * 0.012);
    ctx.beginPath();
    ctx.moveTo(-faceWidth * 0.22, faceHeight * 0.22);
    ctx.quadraticCurveTo(0, faceHeight * 0.34, faceWidth * 0.22, faceHeight * 0.22);
    ctx.stroke();
    ctx.restore();
  });
};

const drawSpringFilter = (
  ctx: CanvasRenderingContext2D,
  motion: MotionFrame,
  width: number,
  height: number,
  amount: number
) => {
  const frame = getCharacterFrame(motion, width, height);
  if (!frame) return;
  const t = motion.timestamp / 1000;

  drawCharacterHalo(ctx, frame, amount, [
    [0, `rgba(140, 255, 164, ${0.14 * amount})`],
    [0.6, `rgba(255, 210, 111, ${0.08 * amount})`],
    [1, "rgba(0, 0, 0, 0)"]
  ]);

  withCharacterFrame(ctx, frame, (faceWidth, faceHeight) => {
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = "rgba(96, 74, 39, 0.86)";
    ctx.lineWidth = Math.max(2, faceWidth * 0.018);

    for (let i = 0; i < 12; i += 1) {
      const side = i % 2 === 0 ? -1 : 1;
      const x = side * (faceWidth * (0.18 + randomUnit(i) * 0.38));
      const y = -faceHeight * (0.34 + randomUnit(i + 4) * 0.18);
      const stem = faceHeight * (0.1 + randomUnit(i + 2) * 0.12);
      ctx.beginPath();
      ctx.moveTo(x * 0.55, -faceHeight * 0.2);
      ctx.quadraticCurveTo(x * 0.8, y + stem * 0.4, x, y);
      ctx.stroke();
      drawLeafShape(
        ctx,
        { x, y: y + Math.sin(t + i) * faceHeight * 0.012 },
        faceWidth * (0.11 + randomUnit(i + 5) * 0.05),
        -Math.PI / 2 + side * (0.4 + randomUnit(i + 8) * 0.4),
        i % 3 === 0 ? "#d5ff80" : "#72e890",
        "rgba(238, 255, 211, 0.82)",
        0.75 * amount
      );
    }

    ctx.fillStyle = "rgba(92, 58, 34, 0.72)";
    ctx.strokeStyle = "rgba(236, 206, 139, 0.7)";
    drawRoundedRect(ctx, -faceWidth * 0.5, -faceHeight * 0.22, faceWidth, faceHeight * 0.18, faceWidth * 0.08);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  });
};

const drawSpriteFrightFilter = (
  ctx: CanvasRenderingContext2D,
  motion: MotionFrame,
  width: number,
  height: number,
  amount: number
) => {
  const frame = getCharacterFrame(motion, width, height);
  if (!frame) return;
  const mouthOpen = frame.face?.mouthOpenness ?? 0;

  drawCharacterHalo(ctx, frame, amount, [
    [0, `rgba(255, 122, 116, ${0.13 * amount})`],
    [0.55, `rgba(154, 99, 255, ${0.12 * amount})`],
    [1, "rgba(0, 0, 0, 0)"]
  ]);

  withCharacterFrame(ctx, frame, (faceWidth, faceHeight) => {
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.shadowColor = "rgba(255, 110, 96, 0.42)";
    ctx.shadowBlur = 14 * amount;
    ctx.fillStyle = "rgba(176, 48, 49, 0.88)";
    ctx.strokeStyle = "rgba(255, 226, 202, 0.9)";
    ctx.lineWidth = Math.max(2, faceWidth * 0.02);

    ctx.beginPath();
    ctx.ellipse(0, -faceHeight * 0.38, faceWidth * 0.58, faceHeight * 0.25, 0, Math.PI, 0);
    ctx.quadraticCurveTo(faceWidth * 0.42, -faceHeight * 0.18, 0, -faceHeight * 0.12);
    ctx.quadraticCurveTo(-faceWidth * 0.42, -faceHeight * 0.18, -faceWidth * 0.58, -faceHeight * 0.38);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    for (let i = 0; i < 9; i += 1) {
      const x = (-0.38 + i * 0.095) * faceWidth;
      const y = -faceHeight * (0.34 + randomUnit(i) * 0.13);
      ctx.fillStyle = "rgba(255, 238, 224, 0.94)";
      ctx.beginPath();
      ctx.arc(x, y, faceWidth * (0.035 + randomUnit(i + 2) * 0.035), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = "rgba(255, 231, 202, 0.72)";
    ctx.beginPath();
    ctx.ellipse(0, faceHeight * 0.03, faceWidth * 0.34, faceHeight * 0.36, 0, 0, Math.PI * 2);
    ctx.fill();

    [-1, 1].forEach((side) => {
      ctx.fillStyle = "rgba(33, 18, 24, 0.9)";
      ctx.beginPath();
      ctx.ellipse(side * faceWidth * 0.14, -faceHeight * 0.05, faceWidth * 0.055, faceHeight * (0.07 + mouthOpen * 0.03), 0, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  });
};

const drawCaminandesFilter = (
  ctx: CanvasRenderingContext2D,
  motion: MotionFrame,
  width: number,
  height: number,
  amount: number
) => {
  const frame = getCharacterFrame(motion, width, height);
  if (!frame) return;

  drawCharacterHalo(ctx, frame, amount, [
    [0, `rgba(255, 231, 172, ${0.12 * amount})`],
    [0.62, `rgba(126, 195, 255, ${0.08 * amount})`],
    [1, "rgba(0, 0, 0, 0)"]
  ]);

  withCharacterFrame(ctx, frame, (faceWidth, faceHeight) => {
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.shadowColor = "rgba(255, 240, 200, 0.34)";
    ctx.shadowBlur = 10 * amount;

    [-1, 1].forEach((side) => {
      ctx.fillStyle = "rgba(232, 204, 157, 0.84)";
      ctx.strokeStyle = "rgba(82, 58, 38, 0.86)";
      ctx.lineWidth = Math.max(2, faceWidth * 0.02);
      ctx.beginPath();
      ctx.ellipse(side * faceWidth * 0.28, -faceHeight * 0.45, faceWidth * 0.085, faceHeight * 0.28, side * 0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });

    ctx.fillStyle = "rgba(231, 211, 174, 0.6)";
    ctx.strokeStyle = "rgba(91, 66, 44, 0.82)";
    ctx.lineWidth = Math.max(2, faceWidth * 0.018);
    ctx.beginPath();
    ctx.ellipse(0, -faceHeight * 0.05, faceWidth * 0.38, faceHeight * 0.46, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "rgba(245, 226, 195, 0.92)";
    drawRoundedRect(ctx, -faceWidth * 0.2, faceHeight * 0.02, faceWidth * 0.4, faceHeight * 0.28, faceWidth * 0.12);
    ctx.fill();
    ctx.stroke();

    [-1, 1].forEach((side) => {
      ctx.fillStyle = "rgba(31, 25, 20, 0.94)";
      ctx.beginPath();
      ctx.ellipse(side * faceWidth * 0.08, faceHeight * 0.13, faceWidth * 0.028, faceHeight * 0.045, 0, 0, Math.PI * 2);
      ctx.fill();
      drawPoint(ctx, { x: side * faceWidth * 0.18, y: -faceHeight * 0.09 }, faceWidth * 0.035, "rgba(31, 25, 20, 0.9)");
    });

    ctx.strokeStyle = "rgba(255, 242, 210, 0.72)";
    ctx.lineWidth = Math.max(1.5, faceWidth * 0.012);
    for (let i = 0; i < 8; i += 1) {
      const x = (-0.31 + i * 0.09) * faceWidth;
      ctx.beginPath();
      ctx.moveTo(x, -faceHeight * 0.42);
      ctx.quadraticCurveTo(x + Math.sin(i) * faceWidth * 0.04, -faceHeight * 0.5, x + faceWidth * 0.02, -faceHeight * 0.58);
      ctx.stroke();
    }
    ctx.restore();
  });
};

const drawCharacterFilter = (
  ctx: CanvasRenderingContext2D,
  motion: MotionFrame,
  width: number,
  height: number,
  amount: number,
  selectedEffect: string
) => {
  if (selectedEffect === "cyberbot") {
    drawCyberBotFilter(ctx, motion, width, height, amount);
  } else if (selectedEffect === "popidol") {
    drawPopIdolFilter(ctx, motion, width, height, amount);
  } else if (selectedEffect === "comic") {
    drawComicHeroFilter(ctx, motion, width, height, amount);
  } else if (selectedEffect === "toonkit") {
    drawToonKitFilter(ctx, motion, width, height, amount);
  } else if (selectedEffect === "bigbuck") {
    drawBigBuckFilter(ctx, motion, width, height, amount);
  } else if (selectedEffect === "sintel") {
    drawSintelFilter(ctx, motion, width, height, amount);
  } else if (selectedEffect === "spring") {
    drawSpringFilter(ctx, motion, width, height, amount);
  } else if (selectedEffect === "spritefright") {
    drawSpriteFrightFilter(ctx, motion, width, height, amount);
  } else if (selectedEffect === "caminandes") {
    drawCaminandesFilter(ctx, motion, width, height, amount);
  }
};

const getFaceCanvasMetrics = (face: TrackedFace, width: number, height: number) => {
  const boundsMin = pointToCanvas({ x: face.bounds.maxX, y: face.bounds.minY }, width, height);
  const boundsMax = pointToCanvas({ x: face.bounds.minX, y: face.bounds.maxY }, width, height);
  const faceWidth = Math.max(24, boundsMax.x - boundsMin.x);
  const faceHeight = Math.max(24, boundsMax.y - boundsMin.y);
  const center = pointToCanvas(face.center, width, height);
  const leftEye = face.leftEye ? pointToCanvas(face.leftEye, width, height) : undefined;
  const rightEye = face.rightEye ? pointToCanvas(face.rightEye, width, height) : undefined;
  const angle = leftEye && rightEye ? Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x) : 0;

  return {
    angle,
    boundsMin,
    boundsMax,
    center,
    faceHeight,
    faceWidth,
    mouth: face.upperLip && face.lowerLip ? pointToCanvas({
      x: (face.upperLip.x + face.lowerLip.x) / 2,
      y: (face.upperLip.y + face.lowerLip.y) / 2
    }, width, height) : center
  };
};

const clipFaceOval = (
  ctx: CanvasRenderingContext2D,
  center: Vec2,
  faceWidth: number,
  faceHeight: number,
  scale = 1
) => {
  ctx.beginPath();
  ctx.ellipse(center.x, center.y, faceWidth * 0.58 * scale, faceHeight * 0.58 * scale, 0, 0, Math.PI * 2);
  ctx.clip();
};

const drawFaceConnectionPaths = (
  ctx: CanvasRenderingContext2D,
  face: TrackedFace,
  width: number,
  height: number,
  stroke: string,
  lineWidth: number
) => {
  FACE_CONNECTIONS.forEach((connection) => {
    ctx.beginPath();
    connection.forEach((index, pointIndex) => {
      const landmark = face.landmarks[index];
      if (!landmark) return;
      const point = pointToCanvas(landmark, width, height);
      if (pointIndex === 0) {
        ctx.moveTo(point.x, point.y);
      } else {
        ctx.lineTo(point.x, point.y);
      }
    });
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  });
};

const drawChromeMask = (
  ctx: CanvasRenderingContext2D,
  face: TrackedFace,
  motion: MotionFrame,
  width: number,
  height: number,
  amount: number
) => {
  const metrics = getFaceCanvasMetrics(face, width, height);
  const shine = 0.2 + motion.face!.smile * 0.3 + motion.face!.mouthOpenness * 0.28;

  ctx.save();
  clipFaceOval(ctx, metrics.center, metrics.faceWidth, metrics.faceHeight, 1.02);
  const chrome = ctx.createLinearGradient(
    metrics.boundsMin.x,
    metrics.boundsMin.y,
    metrics.boundsMax.x,
    metrics.boundsMax.y
  );
  chrome.addColorStop(0, `rgba(208, 255, 255, ${0.12 + amount * 0.18})`);
  chrome.addColorStop(0.26, `rgba(20, 42, 48, ${0.18 + amount * 0.22})`);
  chrome.addColorStop(0.48, `rgba(247, 255, 255, ${0.32 + shine})`);
  chrome.addColorStop(0.68, `rgba(74, 118, 132, ${0.18 + amount * 0.18})`);
  chrome.addColorStop(1, `rgba(255, 230, 162, ${0.1 + amount * 0.16})`);
  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = chrome;
  ctx.fillRect(metrics.boundsMin.x - metrics.faceWidth * 0.2, metrics.boundsMin.y, metrics.faceWidth * 1.4, metrics.faceHeight);
  ctx.globalCompositeOperation = "source-over";
  ctx.strokeStyle = "rgba(231, 255, 255, 0.88)";
  ctx.lineWidth = Math.max(1.5, metrics.faceWidth * 0.012);
  drawFaceConnectionPaths(ctx, face, width, height, "rgba(235, 255, 255, 0.32)", Math.max(1, metrics.faceWidth * 0.005));
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.strokeStyle = "rgba(180, 255, 255, 0.78)";
  ctx.shadowColor = "rgba(120, 248, 255, 0.72)";
  ctx.shadowBlur = 14 * amount;
  ctx.lineWidth = Math.max(2, metrics.faceWidth * 0.018);
  ctx.beginPath();
  ctx.ellipse(metrics.center.x, metrics.center.y, metrics.faceWidth * 0.58, metrics.faceHeight * 0.58, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
};

const drawWireSkullMask = (
  ctx: CanvasRenderingContext2D,
  face: TrackedFace,
  motion: MotionFrame,
  width: number,
  height: number,
  amount: number
) => {
  const metrics = getFaceCanvasMetrics(face, width, height);
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.shadowColor = "rgba(226, 255, 232, 0.9)";
  ctx.shadowBlur = 10 * amount;
  drawFaceConnectionPaths(ctx, face, width, height, "rgba(220, 255, 232, 0.82)", Math.max(1.2, metrics.faceWidth * 0.007));
  ctx.strokeStyle = "rgba(255, 238, 177, 0.78)";
  ctx.lineWidth = Math.max(1.8, metrics.faceWidth * 0.014);
  ctx.beginPath();
  ctx.ellipse(metrics.center.x, metrics.center.y - metrics.faceHeight * 0.03, metrics.faceWidth * 0.42, metrics.faceHeight * 0.47, 0, 0, Math.PI * 2);
  ctx.stroke();
  if (face.mouthLeft && face.mouthRight) {
    const left = pointToCanvas(face.mouthLeft, width, height);
    const right = pointToCanvas(face.mouthRight, width, height);
    for (let i = 0; i < 7; i += 1) {
      const x = left.x + ((right.x - left.x) * i) / 6;
      ctx.beginPath();
      ctx.moveTo(x, metrics.mouth.y - metrics.faceHeight * 0.035);
      ctx.lineTo(x, metrics.mouth.y + metrics.faceHeight * (0.05 + motion.face!.mouthOpenness * 0.05));
      ctx.stroke();
    }
  }
  ctx.restore();
};

const drawThermalFaceMask = (
  ctx: CanvasRenderingContext2D,
  face: TrackedFace,
  motion: MotionFrame,
  width: number,
  height: number,
  amount: number
) => {
  const metrics = getFaceCanvasMetrics(face, width, height);
  const heat = clamp(motion.face!.mouthOpenness * 0.44 + motion.face!.smile * 0.28 + motion.face!.frown * 0.24, 0, 1);

  ctx.save();
  clipFaceOval(ctx, metrics.center, metrics.faceWidth, metrics.faceHeight, 1.06);
  const thermal = ctx.createRadialGradient(metrics.mouth.x, metrics.mouth.y, 0, metrics.center.x, metrics.center.y, metrics.faceHeight * 0.72);
  thermal.addColorStop(0, `rgba(255, 245, 120, ${0.18 + heat * 0.42})`);
  thermal.addColorStop(0.25, `rgba(255, 82, 80, ${0.16 + amount * 0.22})`);
  thermal.addColorStop(0.58, `rgba(62, 216, 255, ${0.12 + amount * 0.2})`);
  thermal.addColorStop(1, "rgba(34, 22, 118, 0)");
  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = thermal;
  ctx.fillRect(metrics.boundsMin.x - metrics.faceWidth * 0.3, metrics.boundsMin.y - metrics.faceHeight * 0.2, metrics.faceWidth * 1.6, metrics.faceHeight * 1.4);
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < 8; i += 1) {
    const y = metrics.boundsMin.y + (metrics.faceHeight * (i + 1)) / 9;
    ctx.strokeStyle = `hsla(${198 - i * 18 + heat * 70}, 100%, 64%, ${0.18 + amount * 0.22})`;
    ctx.lineWidth = Math.max(1, metrics.faceWidth * 0.006);
    ctx.beginPath();
    ctx.ellipse(metrics.center.x, y, metrics.faceWidth * (0.18 + i * 0.035), metrics.faceHeight * 0.025, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
};

const drawCrackedPorcelainMask = (
  ctx: CanvasRenderingContext2D,
  face: TrackedFace,
  motion: MotionFrame,
  width: number,
  height: number,
  amount: number
) => {
  const metrics = getFaceCanvasMetrics(face, width, height);
  ctx.save();
  clipFaceOval(ctx, metrics.center, metrics.faceWidth, metrics.faceHeight, 1.02);
  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = `rgba(245, 248, 242, ${0.12 + amount * 0.24})`;
  ctx.fillRect(metrics.boundsMin.x, metrics.boundsMin.y, metrics.faceWidth, metrics.faceHeight);
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.strokeStyle = `rgba(22, 27, 30, ${0.28 + amount * 0.35})`;
  ctx.lineWidth = Math.max(1, metrics.faceWidth * 0.006);
  const crackEnergy = 0.6 + motion.face!.frown * 0.6 + motion.face!.mouthOpenness * 0.3;
  for (let i = 0; i < 12; i += 1) {
    const seed = i * 9.71;
    const start = {
      x: metrics.center.x + (randomUnit(seed) - 0.5) * metrics.faceWidth * 0.72,
      y: metrics.center.y + (randomUnit(seed + 2) - 0.5) * metrics.faceHeight * 0.78
    };
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    for (let step = 1; step < 4; step += 1) {
      ctx.lineTo(
        start.x + (randomUnit(seed + step * 3) - 0.5) * metrics.faceWidth * 0.28 * crackEnergy * step,
        start.y + (randomUnit(seed + step * 4) - 0.5) * metrics.faceHeight * 0.22 * crackEnergy * step
      );
    }
    ctx.stroke();
  }
  ctx.restore();
};

const drawCyberVisorMask = (
  ctx: CanvasRenderingContext2D,
  face: TrackedFace,
  motion: MotionFrame,
  width: number,
  height: number,
  amount: number
) => {
  const metrics = getFaceCanvasMetrics(face, width, height);
  const leftEye = averageFaceLandmarks(face, FACE_LEFT_EYE_INDICES);
  const rightEye = averageFaceLandmarks(face, FACE_RIGHT_EYE_INDICES);
  if (!leftEye || !rightEye) return;
  const left = pointToCanvas(leftEye, width, height);
  const right = pointToCanvas(rightEye, width, height);
  const eyeCenter = { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
  const visorWidth = Math.max(metrics.faceWidth * 0.76, Math.abs(right.x - left.x) * 1.55);
  const visorHeight = metrics.faceHeight * (0.16 + motion.face!.eyeClosure * 0.05);

  ctx.save();
  ctx.translate(eyeCenter.x, eyeCenter.y);
  ctx.rotate(metrics.angle);
  ctx.globalCompositeOperation = "screen";
  ctx.shadowColor = "rgba(42, 236, 255, 0.96)";
  ctx.shadowBlur = 18 * amount;
  const visor = ctx.createLinearGradient(-visorWidth / 2, 0, visorWidth / 2, 0);
  visor.addColorStop(0, "rgba(24, 255, 219, 0.12)");
  visor.addColorStop(0.5, `rgba(56, 244, 255, ${0.2 + amount * 0.42})`);
  visor.addColorStop(1, "rgba(255, 70, 196, 0.24)");
  ctx.fillStyle = visor;
  drawRoundedRect(ctx, -visorWidth / 2, -visorHeight / 2, visorWidth, visorHeight, visorHeight * 0.38);
  ctx.fill();
  ctx.strokeStyle = "rgba(117, 252, 255, 0.86)";
  ctx.lineWidth = Math.max(2, metrics.faceWidth * 0.014);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255, 88, 206, 0.62)";
  ctx.lineWidth = Math.max(1, metrics.faceWidth * 0.006);
  for (let line = -2; line <= 2; line += 1) {
    const y = line * visorHeight * 0.18 + Math.sin(motion.timestamp / 140 + line) * visorHeight * 0.05;
    ctx.beginPath();
    ctx.moveTo(-visorWidth * 0.43, y);
    ctx.lineTo(visorWidth * 0.43, y);
    ctx.stroke();
  }
  ctx.restore();
};

const drawContourPaintMask = (
  ctx: CanvasRenderingContext2D,
  face: TrackedFace,
  motion: MotionFrame,
  width: number,
  height: number,
  amount: number
) => {
  const metrics = getFaceCanvasMetrics(face, width, height);
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  const phase = motion.timestamp / 260;
  for (let i = 0; i < 9; i += 1) {
    const scale = 0.24 + i * 0.055 + Math.sin(phase + i) * 0.012;
    ctx.strokeStyle = `hsla(${(i * 34 + phase * 8) % 360}, 100%, ${58 + i * 3}%, ${0.16 + amount * 0.18})`;
    ctx.lineWidth = Math.max(1.4, metrics.faceWidth * (0.006 + i * 0.0008));
    ctx.beginPath();
    ctx.ellipse(metrics.center.x, metrics.center.y, metrics.faceWidth * scale, metrics.faceHeight * scale * 1.12, metrics.angle * 0.25, 0, Math.PI * 2);
    ctx.stroke();
  }
  drawFaceConnectionPaths(ctx, face, width, height, `rgba(255, 250, 190, ${0.18 + amount * 0.2})`, Math.max(1, metrics.faceWidth * 0.004));
  ctx.restore();
};

const drawCreatureFaceMask = (
  ctx: CanvasRenderingContext2D,
  face: TrackedFace,
  motion: MotionFrame,
  width: number,
  height: number,
  amount: number
) => {
  const metrics = getFaceCanvasMetrics(face, width, height);
  const mouthOpen = motion.face!.mouthOpenness;
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  const aura = ctx.createRadialGradient(metrics.center.x, metrics.center.y, 0, metrics.center.x, metrics.center.y, metrics.faceHeight * 0.8);
  aura.addColorStop(0, `rgba(132, 255, 126, ${0.08 + amount * 0.18})`);
  aura.addColorStop(0.58, `rgba(56, 216, 112, ${0.08 + mouthOpen * 0.22})`);
  aura.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = aura;
  ctx.fillRect(metrics.boundsMin.x - metrics.faceWidth * 0.3, metrics.boundsMin.y - metrics.faceHeight * 0.35, metrics.faceWidth * 1.6, metrics.faceHeight * 1.7);

  [-1, 1].forEach((side) => {
    ctx.fillStyle = "rgba(158, 255, 146, 0.42)";
    ctx.strokeStyle = "rgba(228, 255, 172, 0.9)";
    ctx.lineWidth = Math.max(1.5, metrics.faceWidth * 0.012);
    ctx.beginPath();
    ctx.moveTo(metrics.center.x + side * metrics.faceWidth * 0.16, metrics.center.y - metrics.faceHeight * 0.45);
    ctx.lineTo(metrics.center.x + side * metrics.faceWidth * 0.28, metrics.center.y - metrics.faceHeight * (0.78 + amount * 0.06));
    ctx.lineTo(metrics.center.x + side * metrics.faceWidth * 0.38, metrics.center.y - metrics.faceHeight * 0.37);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  });

  if (face.mouthLeft && face.mouthRight) {
    const left = pointToCanvas(face.mouthLeft, width, height);
    const right = pointToCanvas(face.mouthRight, width, height);
    ctx.strokeStyle = "rgba(255, 248, 220, 0.9)";
    ctx.lineWidth = Math.max(1.4, metrics.faceWidth * 0.01);
    for (let i = 0; i < 6; i += 1) {
      const x = left.x + ((right.x - left.x) * i) / 5;
      ctx.beginPath();
      ctx.moveTo(x, metrics.mouth.y - metrics.faceHeight * 0.02);
      ctx.lineTo(x + (i % 2 ? -1 : 1) * metrics.faceWidth * 0.015, metrics.mouth.y + metrics.faceHeight * (0.05 + mouthOpen * 0.12));
      ctx.stroke();
    }
  }
  ctx.restore();
};

const drawLiveMask = (
  ctx: CanvasRenderingContext2D,
  motion: MotionFrame,
  width: number,
  height: number,
  amount: number,
  selectedEffect: string
) => {
  if (!motion.face) return;
  if (selectedEffect === "chromeMask") {
    drawChromeMask(ctx, motion.face, motion, width, height, amount);
  } else if (selectedEffect === "wireSkull") {
    drawWireSkullMask(ctx, motion.face, motion, width, height, amount);
  } else if (selectedEffect === "thermalFace") {
    drawThermalFaceMask(ctx, motion.face, motion, width, height, amount);
  } else if (selectedEffect === "crackedPorcelain") {
    drawCrackedPorcelainMask(ctx, motion.face, motion, width, height, amount);
  } else if (selectedEffect === "cyberVisor") {
    drawCyberVisorMask(ctx, motion.face, motion, width, height, amount);
  } else if (selectedEffect === "contourPaint") {
    drawContourPaintMask(ctx, motion.face, motion, width, height, amount);
  } else if (selectedEffect === "creatureFace") {
    drawCreatureFaceMask(ctx, motion.face, motion, width, height, amount);
  }
};

const drawExpressionPersona = (
  ctx: CanvasRenderingContext2D,
  motion: MotionFrame,
  width: number,
  height: number,
  amount: number
) => {
  const face = motion.face;
  if (!face) return;

  const smile = clamp(face.smile * amount, 0, 1);
  const frown = clamp(face.frown * amount, 0, 1);
  const mouth = clamp(face.mouthOpenness * amount, 0, 1);
  const eyes = clamp(face.eyeClosure * amount, 0, 1);
  const metrics = getFaceCanvasMetrics(face, width, height);
  const cache = expressionPersonaFrameCache.get(ctx.canvas) ?? document.createElement("canvas");
  if (cache.width !== width || cache.height !== height) {
    cache.width = width;
    cache.height = height;
  }
  const cacheCtx = cache.getContext("2d");

  if (smile > 0.03) {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = 0.2 + smile * 0.45;
    ctx.filter = `blur(${Math.round(8 + smile * 18)}px) saturate(${1.25 + smile * 1.4})`;
    ctx.drawImage(ctx.canvas, -width * 0.01 * smile, -height * 0.01 * smile, width * (1 + smile * 0.02), height * (1 + smile * 0.02));
    ctx.filter = "none";
    const bloom = ctx.createRadialGradient(metrics.center.x, metrics.center.y, 0, metrics.center.x, metrics.center.y, metrics.faceHeight * 0.9);
    bloom.addColorStop(0, `rgba(255, 225, 122, ${0.22 * smile})`);
    bloom.addColorStop(0.52, `rgba(95, 255, 214, ${0.12 * smile})`);
    bloom.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = bloom;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  if (frown > 0.03) {
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = `rgba(8, 12, 18, ${0.08 + frown * 0.18})`;
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = "screen";
    for (let i = 0; i < 10; i += 1) {
      const y = Math.floor((height * i) / 10 + Math.sin(motion.timestamp / 90 + i) * 8);
      const sliceHeight = Math.max(3, Math.floor(height * (0.008 + frown * 0.014)));
      const shift = Math.sin(motion.timestamp / 70 + i * 2.1) * width * 0.026 * frown;
      ctx.globalAlpha = 0.12 + frown * 0.22;
      ctx.drawImage(ctx.canvas, 0, y, width, sliceHeight, shift, y, width, sliceHeight);
    }
    ctx.restore();
  }

  if (mouth > 0.03) {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const pulse = 0.5 + Math.sin(motion.timestamp / 55) * 0.5;
    for (let ring = 0; ring < 6; ring += 1) {
      const radius = metrics.faceWidth * (0.16 + ring * 0.12 + pulse * 0.04 * mouth);
      ctx.strokeStyle = `rgba(255, ${155 + ring * 12}, 94, ${0.2 * mouth * (1 - ring * 0.08)})`;
      ctx.lineWidth = Math.max(2, metrics.faceWidth * (0.01 + mouth * 0.012));
      ctx.beginPath();
      ctx.arc(metrics.mouth.x, metrics.mouth.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.16 + mouth * 0.22;
    ctx.filter = `blur(${Math.round(2 + mouth * 8)}px)`;
    ctx.drawImage(ctx.canvas, metrics.mouth.x - width * 0.52, metrics.mouth.y - height * 0.52, width * 1.04, height * 1.04);
    ctx.restore();
  }

  if (eyes > 0.03 && cacheCtx) {
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 0.18 + eyes * 0.42;
    ctx.filter = `blur(${Math.round(4 + eyes * 14)}px)`;
    ctx.drawImage(cache, 0, 0, width, height);
    ctx.filter = "none";
    ctx.fillStyle = `rgba(0, 0, 0, ${0.08 + eyes * 0.38})`;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  if (cacheCtx) {
    cacheCtx.clearRect(0, 0, width, height);
    cacheCtx.globalAlpha = 0.82;
    cacheCtx.drawImage(ctx.canvas, 0, 0, width, height);
    expressionPersonaFrameCache.set(ctx.canvas, cache);
  }
};

const drawMetricTag = (
  ctx: CanvasRenderingContext2D,
  point: Vec2,
  label: string,
  value: number,
  active: boolean,
  color: string
) => {
  const text = `${label} ${Math.round(value * 100)}%`;
  ctx.save();
  ctx.font = `${Math.max(11, Math.floor(ctx.canvas.width / 78))}px Inter, system-ui, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const tagWidth = Math.max(84, ctx.measureText(text).width + 18);
  const tagHeight = 24;
  const x = clamp(point.x, 8, Math.max(8, ctx.canvas.width - tagWidth - 8));
  const y = clamp(point.y, 8, Math.max(8, ctx.canvas.height - tagHeight - 8));
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = active ? "rgba(65, 44, 13, 0.82)" : "rgba(4, 13, 17, 0.76)";
  ctx.strokeStyle = active ? "rgba(255, 215, 123, 0.86)" : color;
  ctx.lineWidth = 1;
  drawRoundedRect(ctx, x, y, tagWidth, tagHeight, 7);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = active ? "#ffe39a" : "#d8fbff";
  ctx.fillText(text, x + 9, y + tagHeight / 2);
  ctx.restore();
};

const averageFaceLandmarks = (face: TrackedFace, indices: number[]): Vec2 | undefined => {
  const points = indices.map((index) => face.landmarks[index]).filter((point): point is Landmark => Boolean(point));
  if (!points.length) return undefined;
  return {
    x: points.reduce((total, point) => total + point.x, 0) / points.length,
    y: points.reduce((total, point) => total + point.y, 0) / points.length
  };
};

const drawInfinityEyePlaceholder = (
  ctx: CanvasRenderingContext2D,
  center: Vec2,
  size: number,
  angle: number,
  active: boolean
) => {
  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate(angle);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `900 ${size}px Inter, system-ui, sans-serif`;
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = active ? "rgba(0, 42, 52, 0.72)" : "rgba(2, 12, 16, 0.64)";
  ctx.strokeStyle = active ? "rgba(0, 229, 255, 0.98)" : "rgba(95, 247, 255, 0.9)";
  ctx.lineWidth = Math.max(1.4, size * 0.06);
  drawRoundedRect(ctx, -size * 0.72, -size * 0.35, size * 1.44, size * 0.7, size * 0.2);
  ctx.fill();
  ctx.stroke();

  ctx.globalCompositeOperation = "screen";
  ctx.shadowColor = "rgba(0, 229, 255, 0.98)";
  ctx.shadowBlur = size * (active ? 0.46 : 0.32);
  ctx.fillStyle = active ? "rgba(0, 229, 255, 1)" : "rgba(95, 247, 255, 0.98)";
  ctx.fillText("∞", 0, size * -0.03);
  ctx.restore();
};

const drawFaceEyePlaceholders = (
  ctx: CanvasRenderingContext2D,
  face: TrackedFace,
  motion: MotionFrame,
  width: number,
  height: number,
  faceWidth: number
) => {
  const leftEye = averageFaceLandmarks(face, FACE_LEFT_EYE_INDICES);
  const rightEye = averageFaceLandmarks(face, FACE_RIGHT_EYE_INDICES);
  if (!leftEye || !rightEye) return;

  const left = pointToCanvas(leftEye, width, height);
  const right = pointToCanvas(rightEye, width, height);
  const angle = Math.atan2(right.y - left.y, right.x - left.x);
  const symbolSize = Math.max(18, Math.min(58, faceWidth * 0.18));
  const active = motion.gestures.eyesClosed || motion.gestures.smile || motion.gestures.mouthOpen;

  drawInfinityEyePlaceholder(ctx, left, symbolSize, angle, active);
  drawInfinityEyePlaceholder(ctx, right, symbolSize, angle, active);
};

const drawFaceRig = (
  ctx: CanvasRenderingContext2D,
  face: TrackedFace,
  motion: MotionFrame,
  width: number,
  height: number,
  showEyePlaceholders = false
) => {
  const boundsMin = pointToCanvas({ x: face.bounds.maxX, y: face.bounds.minY }, width, height);
  const boundsMax = pointToCanvas({ x: face.bounds.minX, y: face.bounds.maxY }, width, height);
  const faceWidth = Math.max(24, boundsMax.x - boundsMin.x);
  const faceHeight = Math.max(24, boundsMax.y - boundsMin.y);
  const accent = motion.gestures.mouthOpen || motion.gestures.smile || motion.gestures.frown || motion.gestures.eyesClosed
    ? "rgba(255, 215, 123, 0.92)"
    : "rgba(96, 247, 255, 0.86)";

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.strokeStyle = "rgba(96, 247, 255, 0.36)";
  ctx.lineWidth = Math.max(1, Math.min(width, height) * 0.003);
  drawRoundedRect(ctx, boundsMin.x, boundsMin.y, faceWidth, faceHeight, Math.max(8, faceWidth * 0.08));
  ctx.stroke();

  FACE_CONNECTIONS.forEach((connection, connectionIndex) => {
    ctx.beginPath();
    connection.forEach((index, pointIndex) => {
      const landmark = face.landmarks[index];
      if (!landmark) return;
      const point = pointToCanvas(landmark, width, height);
      if (pointIndex === 0) {
        ctx.moveTo(point.x, point.y);
      } else {
        ctx.lineTo(point.x, point.y);
      }
    });
    ctx.strokeStyle = connectionIndex <= 2 ? "rgba(93, 244, 255, 0.72)" : "rgba(255, 218, 112, 0.74)";
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = 8;
    ctx.stroke();
  });

  face.landmarks.forEach((landmark, index) => {
    const point = pointToCanvas(landmark, width, height);
    const isKey = FACE_KEY_INDICES.includes(index);
    drawPoint(ctx, point, isKey ? 3.8 : 1.45, isKey ? accent : "rgba(185, 255, 247, 0.5)");
  });
  ctx.restore();

  if (showEyePlaceholders) {
    drawFaceEyePlaceholders(ctx, face, motion, width, height, faceWidth);
  }

  const tagX = boundsMax.x + 12;
  const tagY = boundsMin.y;
  drawMetricTag(ctx, { x: tagX, y: tagY }, "Mouth", face.mouthOpenness, motion.gestures.mouthOpen, "rgba(96, 247, 255, 0.74)");
  drawMetricTag(ctx, { x: tagX, y: tagY + 30 }, "Smile", face.smile, motion.gestures.smile, "rgba(96, 247, 255, 0.74)");
  drawMetricTag(ctx, { x: tagX, y: tagY + 60 }, "Frown", face.frown, motion.gestures.frown, "rgba(96, 247, 255, 0.74)");
  drawMetricTag(ctx, { x: tagX, y: tagY + 90 }, "Eyes", face.eyeClosure, motion.gestures.eyesClosed, "rgba(96, 247, 255, 0.74)");
};

const drawRig = (
  ctx: CanvasRenderingContext2D,
  motion: MotionFrame,
  width: number,
  height: number,
  trackingMode: TrackingPreviewMode = "upper"
) => {
  if (trackingMode === "none") return;

  const includePose = trackingMode === "upper" || trackingMode === "full";
  const includeHands = trackingMode === "upper" || trackingMode === "full" || trackingMode === "handsFace";
  const includeFace = trackingMode === "face" || trackingMode === "handsFace";

  if (includePose && motion.pose?.landmarks) {
    const poseConnections = trackingMode === "full" ? FULL_POSE_CONNECTIONS : UPPER_POSE_CONNECTIONS;
    poseConnections.forEach(([start, end]) => {
      const a = motion.pose?.landmarks[start];
      const b = motion.pose?.landmarks[end];
      if (!a || !b) return;
      drawLine(ctx, pointToCanvas(a, width, height), pointToCanvas(b, width, height), 4, "rgba(54, 238, 247, 0.9)", "#36eef7");
    });

    if (trackingMode === "full") {
      motion.pose.landmarks.forEach((landmark) => {
        if ((landmark.visibility ?? 1) < 0.25) return;
        drawPoint(ctx, pointToCanvas(landmark, width, height), 2.8, "rgba(205, 255, 248, 0.82)");
      });
    }
  }

  if (includeFace && motion.face) {
    drawFaceRig(ctx, motion.face, motion, width, height, trackingMode === "face");
  }

  if (!includeHands) {
    return;
  }

  motion.hands.forEach((hand) => {
    HAND_CONNECTIONS.forEach(([start, end]) => {
      const a = hand.landmarks[start];
      const b = hand.landmarks[end];
      if (!a || !b) return;
      const stroke = hand.handedness === "Left" ? "rgba(255, 218, 88, 0.94)" : "rgba(130, 255, 188, 0.94)";
      drawLine(ctx, pointToCanvas(a, width, height), pointToCanvas(b, width, height), 3, stroke, stroke);
    });

    hand.landmarks.forEach((landmark, index) => {
      const point = pointToCanvas(landmark, width, height);
      drawPoint(ctx, point, HAND_TIP_INDICES.includes(index) ? 4.5 : 2.8, index === 0 ? "#ffffff" : "#f8f16a");
    });
  });
};

const visiblePosePoint = (pose: TrackedPose, index: number) => {
  const point = pose.landmarks[index];
  if (!point || (point.visibility ?? 1) < 0.2) return undefined;
  return point;
};

const drawPosePolygon = (
  ctx: CanvasRenderingContext2D,
  pose: TrackedPose,
  indices: number[],
  width: number,
  height: number,
  fill: string,
  stroke: string,
  lineWidth: number
) => {
  const points = indices.map((index) => visiblePosePoint(pose, index)).filter((point): point is Landmark => Boolean(point));
  if (points.length < 3) return;

  ctx.beginPath();
  points.forEach((point, index) => {
    const canvasPoint = pointToCanvas(point, width, height);
    if (index === 0) {
      ctx.moveTo(canvasPoint.x, canvasPoint.y);
    } else {
      ctx.lineTo(canvasPoint.x, canvasPoint.y);
    }
  });
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.fill();
  ctx.stroke();
};

const drawPoseHeatDisc = (
  ctx: CanvasRenderingContext2D,
  center: Vec2,
  radius: number,
  innerColor: string,
  outerColor: string
) => {
  const glow = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, radius);
  glow.addColorStop(0, innerColor);
  glow.addColorStop(0.48, innerColor.replace("0.78", "0.28").replace("0.72", "0.24"));
  glow.addColorStop(1, outerColor);
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
  ctx.fill();
};

const drawBodyWireWrap = (ctx: CanvasRenderingContext2D, motion: MotionFrame, width: number, height: number, amount: number) => {
  const pose = motion.pose;
  if (!pose?.landmarks.length) return;

  const lineWidth = Math.max(1.4, Math.min(width, height) * 0.0045 * amount);
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.shadowColor = "rgba(84, 247, 255, 0.9)";
  ctx.shadowBlur = 12 * amount;

  drawPosePolygon(
    ctx,
    pose,
    [11, 12, 24, 23],
    width,
    height,
    `rgba(32, 248, 255, ${0.055 + amount * 0.05})`,
    `rgba(110, 252, 255, ${0.38 + amount * 0.22})`,
    lineWidth
  );

  FULL_POSE_CONNECTIONS.forEach(([start, end], index) => {
    const a = visiblePosePoint(pose, start);
    const b = visiblePosePoint(pose, end);
    if (!a || !b) return;
    const from = pointToCanvas(a, width, height);
    const to = pointToCanvas(b, width, height);
    const stroke = index % 3 === 0 ? "rgba(255, 224, 108, 0.86)" : "rgba(84, 247, 255, 0.88)";
    drawLine(ctx, from, to, lineWidth, stroke, stroke);

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length < 18) return;
    const normal = { x: -dy / length, y: dx / length };
    for (let band = 1; band <= 3; band += 1) {
      const t = band / 4;
      const wobble = Math.sin(motion.timestamp / 180 + index * 0.8 + band) * 0.35;
      const center = { x: from.x + dx * t, y: from.y + dy * t };
      const span = Math.max(8, Math.min(34, length * 0.12) * (0.9 + amount * 0.28));
      ctx.beginPath();
      ctx.moveTo(center.x - normal.x * span * (1 + wobble), center.y - normal.y * span * (1 - wobble));
      ctx.lineTo(center.x + normal.x * span * (1 - wobble), center.y + normal.y * span * (1 + wobble));
      ctx.strokeStyle = `rgba(180, 255, 244, ${0.16 + amount * 0.18})`;
      ctx.lineWidth = Math.max(1, lineWidth * 0.45);
      ctx.stroke();
    }
  });

  pose.landmarks.forEach((landmark, index) => {
    if ((landmark.visibility ?? 1) < 0.25) return;
    const point = pointToCanvas(landmark, width, height);
    const major = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28].includes(index);
    drawPoint(ctx, point, major ? 4.4 * amount : 2.4 * amount, major ? "rgba(255, 235, 142, 0.92)" : "rgba(194, 255, 248, 0.68)");
  });
  ctx.restore();
};

const drawBodyThermalMap = (ctx: CanvasRenderingContext2D, motion: MotionFrame, width: number, height: number, amount: number) => {
  const pose = motion.pose;
  if (!pose?.landmarks.length) return;

  const energy = clamp(0.42 + motion.confidence * 0.28 + motion.hands.reduce((total, hand) => total + hand.velocity, 0) * 0.22, 0, 1.35);
  const radiusBase = Math.max(34, Math.min(width, height) * (0.06 + amount * 0.035));

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.filter = `blur(${Math.round(3 + amount * 5)}px) saturate(${1.5 + amount * 0.6})`;

  drawPosePolygon(
    ctx,
    pose,
    [11, 12, 24, 23],
    width,
    height,
    `rgba(255, 83, 28, ${0.12 + energy * 0.16})`,
    `rgba(255, 224, 76, ${0.18 + energy * 0.18})`,
    Math.max(8, radiusBase * 0.16)
  );

  FULL_POSE_CONNECTIONS.forEach(([start, end], index) => {
    const a = visiblePosePoint(pose, start);
    const b = visiblePosePoint(pose, end);
    if (!a || !b) return;
    const from = pointToCanvas(a, width, height);
    const to = pointToCanvas(b, width, height);
    const gradient = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
    gradient.addColorStop(0, `rgba(22, 210, 255, ${0.2 + amount * 0.12})`);
    gradient.addColorStop(0.48, `rgba(255, 229, 74, ${0.24 + energy * 0.22})`);
    gradient.addColorStop(1, `rgba(255, 48, 91, ${0.22 + energy * 0.2})`);
    ctx.strokeStyle = gradient;
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(16, Math.min(width, height) * (0.025 + amount * 0.012));
    ctx.shadowColor = index % 2 ? "rgba(255, 70, 82, 0.72)" : "rgba(255, 214, 72, 0.72)";
    ctx.shadowBlur = radiusBase * 0.42;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  });

  [0, 11, 12, 15, 16, 23, 24, 27, 28].forEach((index, heatIndex) => {
    const landmark = visiblePosePoint(pose, index);
    if (!landmark) return;
    const point = pointToCanvas(landmark, width, height);
    const pulse = 0.82 + Math.sin(motion.timestamp / 160 + heatIndex) * 0.18;
    drawPoseHeatDisc(
      ctx,
      point,
      radiusBase * pulse,
      `rgba(255, ${index === 0 ? 238 : 128}, 52, ${0.42 + amount * 0.24})`,
      "rgba(0, 0, 0, 0)"
    );
  });

  ctx.filter = "none";
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = `rgba(3, 7, 13, ${0.08 + amount * 0.06})`;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
};

const drawCyberSuit = (ctx: CanvasRenderingContext2D, motion: MotionFrame, width: number, height: number, amount: number) => {
  const pose = motion.pose;
  if (!pose?.landmarks.length) return;

  const shoulderLeft = visiblePosePoint(pose, 11);
  const shoulderRight = visiblePosePoint(pose, 12);
  const hipLeft = visiblePosePoint(pose, 23);
  const hipRight = visiblePosePoint(pose, 24);
  if (!shoulderLeft || !shoulderRight) return;

  const core = hipLeft && hipRight
    ? {
        x: (shoulderLeft.x + shoulderRight.x + hipLeft.x + hipRight.x) / 4,
        y: (shoulderLeft.y + shoulderRight.y + hipLeft.y + hipRight.y) / 4
      }
    : { x: (shoulderLeft.x + shoulderRight.x) / 2, y: (shoulderLeft.y + shoulderRight.y) / 2 + 0.12 };
  const coreCanvas = pointToCanvas(core, width, height);
  const suitLine = Math.max(2, Math.min(width, height) * 0.006 * amount);

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.shadowColor = "rgba(0, 231, 255, 0.84)";
  ctx.shadowBlur = 14 * amount;

  drawPosePolygon(
    ctx,
    pose,
    [11, 12, 24, 23],
    width,
    height,
    `rgba(0, 231, 255, ${0.08 + amount * 0.07})`,
    `rgba(0, 231, 255, ${0.64 + amount * 0.18})`,
    suitLine
  );

  [
    [11, 13],
    [13, 15],
    [12, 14],
    [14, 16],
    [23, 25],
    [25, 27],
    [24, 26],
    [26, 28]
  ].forEach(([start, end], index) => {
    const a = visiblePosePoint(pose, start);
    const b = visiblePosePoint(pose, end);
    if (!a || !b) return;
    const from = pointToCanvas(a, width, height);
    const to = pointToCanvas(b, width, height);
    drawLine(ctx, from, to, suitLine * 1.6, index % 2 ? "rgba(255, 218, 94, 0.74)" : "rgba(94, 255, 207, 0.82)", "rgba(0, 231, 255, 0.8)");
    const plateCenter = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    const plateWidth = Math.max(18, distance(from, to) * 0.18);
    drawRoundedRect(ctx, plateCenter.x - plateWidth / 2, plateCenter.y - suitLine * 2.2, plateWidth, suitLine * 4.4, suitLine * 1.7);
    ctx.fillStyle = `rgba(5, 22, 28, ${0.38 + amount * 0.16})`;
    ctx.strokeStyle = "rgba(224, 255, 247, 0.58)";
    ctx.lineWidth = Math.max(1, suitLine * 0.42);
    ctx.fill();
    ctx.stroke();
  });

  const coreRadius = Math.max(20, Math.min(width, height) * (0.035 + amount * 0.018));
  const pulse = 0.76 + Math.sin(motion.timestamp / 120) * 0.24;
  drawPoseHeatDisc(ctx, coreCanvas, coreRadius * (1.4 + pulse * 0.35), `rgba(255, 222, 87, ${0.28 + amount * 0.18})`, "rgba(0, 0, 0, 0)");
  ctx.strokeStyle = "rgba(255, 241, 166, 0.92)";
  ctx.lineWidth = Math.max(2, suitLine);
  ctx.beginPath();
  ctx.arc(coreCanvas.x, coreCanvas.y, coreRadius * (0.58 + pulse * 0.12), 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(coreCanvas.x, coreCanvas.y, coreRadius, 0, Math.PI * 2);
  ctx.stroke();

  [11, 12, 15, 16, 23, 24, 27, 28].forEach((index) => {
    const landmark = visiblePosePoint(pose, index);
    if (!landmark) return;
    drawPoint(ctx, pointToCanvas(landmark, width, height), Math.max(4, suitLine * 1.6), "rgba(242, 255, 232, 0.9)");
  });
  ctx.restore();
};

const drawBodyEffect = (
  ctx: CanvasRenderingContext2D,
  motion: MotionFrame,
  width: number,
  height: number,
  amount: number,
  selectedEffect: string
) => {
  if (selectedEffect === "bodyWire") {
    drawBodyWireWrap(ctx, motion, width, height, amount);
  } else if (selectedEffect === "bodyThermal") {
    drawBodyThermalMap(ctx, motion, width, height, amount);
  } else if (selectedEffect === "cyberSuit") {
    drawCyberSuit(ctx, motion, width, height, amount);
  }
};

const drawGuideLabel = (ctx: CanvasRenderingContext2D, point: Vec2, label: string, color: string) => {
  ctx.save();
  ctx.font = `${Math.max(10, Math.floor(ctx.canvas.width / 92))}px Inter, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const labelWidth = Math.max(76, ctx.measureText(label).width + 18);
  const labelHeight = 23;
  const x = clamp(point.x - labelWidth / 2, 8, Math.max(8, ctx.canvas.width - labelWidth - 8));
  const y = clamp(point.y - labelHeight / 2, 8, Math.max(8, ctx.canvas.height - labelHeight - 8));
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "rgba(4, 13, 17, 0.82)";
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  drawRoundedRect(ctx, x, y, labelWidth, labelHeight, 7);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#e8fdff";
  ctx.fillText(label, x + labelWidth / 2, y + labelHeight / 2);
  ctx.restore();
};

const drawGuideArrow = (ctx: CanvasRenderingContext2D, start: Vec2, end: Vec2, color: string) => {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const head = 12;
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(end.x, end.y);
  ctx.lineTo(end.x - Math.cos(angle - 0.48) * head, end.y - Math.sin(angle - 0.48) * head);
  ctx.lineTo(end.x - Math.cos(angle + 0.48) * head, end.y - Math.sin(angle + 0.48) * head);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
};

const drawFingerPullGuide = (ctx: CanvasRenderingContext2D, motion: MotionFrame, width: number, height: number, amount: number) => {
  const color = "rgba(255, 226, 104, 0.92)";
  motion.hands.forEach((hand) => {
    const pinchPoint = getPinchPoint(hand);
    if (!pinchPoint) return;
    const pinch = pointToCanvas(pinchPoint, width, height);
    drawHandGestureFlash(ctx, pinch, "Pinch", color, Math.max(34, 42 * amount), motion.timestamp / 120);

    const targetTip = hand.landmarks[12] ?? hand.landmarks[16] ?? hand.landmarks[20] ?? hand.landmarks[8];
    const targetRoot = hand.landmarks[9] ?? hand.landmarks[13] ?? hand.landmarks[17] ?? hand.landmarks[5];
    if (!targetTip || !targetRoot) return;
    const tip = pointToCanvas(targetTip, width, height);
    const root = pointToCanvas(targetRoot, width, height);
    const direction = {
      x: tip.x - root.x,
      y: tip.y - root.y
    };
    const length = Math.max(0.001, Math.hypot(direction.x, direction.y));
    const arrowEnd = {
      x: tip.x + (direction.x / length) * Math.max(36, 54 * amount),
      y: tip.y + (direction.y / length) * Math.max(36, 54 * amount)
    };
    drawPoint(ctx, tip, Math.max(7, 8 * amount), color);
    drawGuideArrow(ctx, tip, arrowEnd, color);
    drawGuideLabel(ctx, { x: tip.x, y: tip.y - 34 }, "Pull fingertip", color);
  });
};

const drawNosePullGuide = (ctx: CanvasRenderingContext2D, motion: MotionFrame, width: number, height: number, amount: number) => {
  const nose = motion.face?.nose ?? motion.pose?.nose;
  if (!nose) return;

  const color = "rgba(101, 248, 255, 0.94)";
  const nosePoint = pointToCanvas(nose, width, height);
  const nearestHand = motion.hands
    .map((hand) => ({ hand, distance: distance(hand.centroid, nose) }))
    .sort((a, b) => a.distance - b.distance)[0]?.hand;
  const pinchPoint = nearestHand ? getPinchPoint(nearestHand) : undefined;
  const pullTarget = pinchPoint
    ? pointToCanvas(pinchPoint, width, height)
    : {
        x: nosePoint.x + Math.max(58, 72 * amount),
        y: nosePoint.y - Math.max(18, 24 * amount)
      };
  const dx = pullTarget.x - nosePoint.x;
  const dy = pullTarget.y - nosePoint.y;
  const length = Math.max(0.001, Math.hypot(dx, dy));
  const arrowEnd = {
    x: nosePoint.x + (dx / length) * Math.max(58, 82 * amount),
    y: nosePoint.y + (dy / length) * Math.max(58, 82 * amount)
  };

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.shadowColor = color;
  ctx.shadowBlur = 14;
  ctx.beginPath();
  ctx.arc(nosePoint.x, nosePoint.y, Math.max(18, 24 * amount), 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(nosePoint.x, nosePoint.y, Math.max(30, 42 * amount), 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  drawPoint(ctx, nosePoint, Math.max(7, 9 * amount), color);
  drawGuideArrow(ctx, nosePoint, arrowEnd, color);
  drawGuideLabel(ctx, { x: nosePoint.x, y: nosePoint.y - 48 }, "Pinch nose", color);
  drawGuideLabel(ctx, { x: arrowEnd.x, y: arrowEnd.y + 26 }, "Pull out", color);
};

const drawEffectGuideMarkers = (
  ctx: CanvasRenderingContext2D,
  motion: MotionFrame,
  width: number,
  height: number,
  amount: number,
  selectedEffect: string
) => {
  if (selectedEffect === "fingerpull") {
    drawFingerPullGuide(ctx, motion, width, height, amount);
  } else if (selectedEffect === "nosepull") {
    drawNosePullGuide(ctx, motion, width, height, amount);
  }
};

const handIsRaised = (motion: MotionFrame, hand: MotionFrame["hands"][number]) => {
  const shoulderLineY =
    motion.pose?.leftShoulder && motion.pose.rightShoulder
      ? (motion.pose.leftShoulder.y + motion.pose.rightShoulder.y) / 2
      : undefined;
  return shoulderLineY !== undefined && (hand.wrist.y < shoulderLineY - 0.12 || hand.centroid.y < shoulderLineY - 0.16);
};

const handCoversFace = (motion: MotionFrame, hand: MotionFrame["hands"][number]) => {
  const faceCenter = motion.face?.nose ?? motion.pose?.nose;
  if (!faceCenter) return false;
  const nearFaceLandmarks = hand.landmarks.filter((point) => distance(point, faceCenter) < 0.12).length;
  return nearFaceLandmarks >= 3 || distance(hand.centroid, faceCenter) < 0.13;
};

const drawHandGestureFlash = (
  ctx: CanvasRenderingContext2D,
  center: Vec2,
  label: string,
  color: string,
  radius: number,
  phase: number
) => {
  const pulse = 0.58 + Math.sin(phase) * 0.42;
  const glowRadius = radius * (0.82 + pulse * 0.34);

  gradientDisc(ctx, center, glowRadius, [
    [0, color.replace("0.92", `${0.26 + pulse * 0.24}`)],
    [0.58, color.replace("0.92", `${0.12 + pulse * 0.12}`)],
    [1, "rgba(0, 0, 0, 0)"]
  ]);

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, radius * 0.04);
  ctx.shadowColor = color;
  ctx.shadowBlur = radius * 0.22;
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius * (0.36 + pulse * 0.18), 0, Math.PI * 2);
  ctx.stroke();

  for (let ray = 0; ray < 8; ray += 1) {
    const angle = phase * 0.12 + (Math.PI * 2 * ray) / 8;
    const inner = radius * (0.46 + pulse * 0.08);
    const outer = radius * (0.62 + pulse * 0.22);
    ctx.beginPath();
    ctx.moveTo(center.x + Math.cos(angle) * inner, center.y + Math.sin(angle) * inner);
    ctx.lineTo(center.x + Math.cos(angle) * outer, center.y + Math.sin(angle) * outer);
    ctx.stroke();
  }

  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "rgba(5, 12, 11, 0.72)";
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.font = `${Math.max(10, Math.floor(radius * 0.18))}px Inter, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const textWidth = ctx.measureText(label).width;
  const labelWidth = textWidth + 16;
  const labelHeight = Math.max(22, radius * 0.28);
  const labelX = clamp(center.x - labelWidth / 2, 8, Math.max(8, ctx.canvas.width - labelWidth - 8));
  const labelY = clamp(center.y - radius * 0.72, 8, Math.max(8, ctx.canvas.height - labelHeight - 8));
  drawRoundedRect(ctx, labelX, labelY, labelWidth, labelHeight, 7);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fillText(label, labelX + labelWidth / 2, labelY + labelHeight / 2);
  ctx.restore();
};

const drawHandGestureMarkers = (ctx: CanvasRenderingContext2D, motion: MotionFrame, width: number, height: number, amount: number) => {
  const phase = performance.now() / 82;
  const baseRadius = Math.max(42, Math.min(width, height) * 0.09) * clamp(amount, 0.45, 1.35);

  motion.hands.forEach((hand, handIndex) => {
    const palm = pointToCanvas(hand.centroid, width, height);
    const pinchPoint =
      hand.landmarks[4] && hand.landmarks[8]
        ? pointToCanvas(
            {
              x: (hand.landmarks[4].x + hand.landmarks[8].x) / 2,
              y: (hand.landmarks[4].y + hand.landmarks[8].y) / 2
            },
            width,
            height
          )
        : palm;
    const offsetPhase = phase + handIndex * 0.9;

    if (motion.gestures.handsUp && handIsRaised(motion, hand)) {
      drawHandGestureFlash(ctx, palm, "HANDS UP", "rgba(255, 217, 105, 0.92)", baseRadius * 1.08, offsetPhase);
    }
    if (motion.gestures.openPalm && hand.openness > 0.56) {
      drawHandGestureFlash(ctx, palm, "OPEN PALM", "rgba(126, 255, 189, 0.92)", baseRadius * (0.86 + hand.openness * 0.34), offsetPhase + 1.6);
    }
    if (motion.gestures.pinch && hand.pinch > 0.64) {
      drawHandGestureFlash(ctx, pinchPoint, "PINCH", "rgba(255, 116, 190, 0.92)", baseRadius * 0.72, offsetPhase + 2.7);
    }
    if (motion.gestures.faceCover && handCoversFace(motion, hand)) {
      drawHandGestureFlash(ctx, palm, "FACE COVER", "rgba(122, 190, 255, 0.92)", baseRadius * 0.95, offsetPhase + 3.8);
    }
  });
};

const shouldDrawHandGestureMarkers = (trackingMode: TrackingPreviewMode) =>
  trackingMode === "upper" || trackingMode === "full" || trackingMode === "handsFace";

const drawIdleStage = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#07100e");
  gradient.addColorStop(0.5, "#0c1213");
  gradient.addColorStop(1, "#130b12");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.globalAlpha = 0.36;
  ctx.strokeStyle = "#1c3532";
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += 42) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y < height; y += 42) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.restore();
};

const drawShaderUnavailable = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
  drawIdleStage(ctx, width, height);
  ctx.save();
  ctx.fillStyle = "rgba(10, 18, 18, 0.82)";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#9fffc6";
  ctx.font = `${Math.max(14, Math.floor(width / 46))}px Inter, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText("WebGL shader player unavailable", width / 2, height / 2);
  ctx.restore();
};

const drawMirroredVideo = (ctx: CanvasRenderingContext2D, video: HTMLVideoElement, width: number, height: number) => {
  ctx.save();
  ctx.translate(width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, width, height);
  ctx.restore();
};

const drawVisualDrumPads = (
  ctx: CanvasRenderingContext2D,
  pads: VisualDrumPadOverlayPad[] | undefined,
  width: number,
  height: number
) => {
  if (!pads?.length) return;

  const time = performance.now() / 1000;
  ctx.save();
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";

  pads.forEach((pad, index) => {
    if (!pad.enabled) return;

    const x = pad.x * width;
    const y = pad.y * height;
    const padWidth = pad.width * width;
    const padHeight = pad.height * height;
    const radius = Math.max(7, Math.min(18, padHeight * 0.16));
    const intensity = clamp(pad.intensity, 0, 1);
    const holdIntensity = clamp(pad.holdIntensity ?? 0, 0, 1);
    const modulationDepth = clamp(pad.modulationDepth ?? 0, 0, 1);
    const pressure = clamp(pad.pressure ?? 0, 0, 1);
    const pressureVelocity = clamp(pad.pressureVelocity ?? 0, 0, 1);
    const xyX = clamp(pad.xyX ?? 0.5, 0, 1);
    const xyY = clamp(pad.xyY ?? 0.5, 0, 1);
    const cursorX = x + padWidth * xyX;
    const cursorY = y + padHeight * xyY;
    const hue = (172 + index * 31) % 360;
    const pressureHue = (hue + pad.value * 92 + pressureVelocity * 36) % 360;

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.shadowColor = `hsla(${hue}, 100%, 66%, ${0.28 + intensity * 0.42})`;
    ctx.shadowBlur = 8 + intensity * 30;
    drawRoundedRect(ctx, x, y, padWidth, padHeight, radius);
    const fill = ctx.createLinearGradient(x, y, x + padWidth, y + padHeight);
    fill.addColorStop(0, `hsla(${hue}, 88%, ${24 + intensity * 16}%, ${0.2 + intensity * 0.34})`);
    fill.addColorStop(1, `hsla(${(hue + 44) % 360}, 94%, ${18 + intensity * 18}%, ${0.26 + intensity * 0.38})`);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = `hsla(${hue}, 100%, ${64 + intensity * 14}%, ${0.44 + intensity * 0.5})`;
    ctx.lineWidth = Math.max(1.2, 1.8 + intensity * 3.2);
    ctx.stroke();

    if (pad.zoneEnabled) {
      const activeZone = pad.zone ?? "center";
      const zones: Array<{
        id: "center" | "top" | "bottom" | "left" | "right";
        label: string;
        rect: [number, number, number, number];
      }> = [
        { id: "top", label: "UP", rect: [x + padWidth * 0.28, y, padWidth * 0.44, padHeight * 0.28] },
        { id: "bottom", label: "DN", rect: [x + padWidth * 0.28, y + padHeight * 0.72, padWidth * 0.44, padHeight * 0.28] },
        { id: "left", label: "REV", rect: [x, y + padHeight * 0.28, padWidth * 0.28, padHeight * 0.44] },
        { id: "right", label: "RPT", rect: [x + padWidth * 0.72, y + padHeight * 0.28, padWidth * 0.28, padHeight * 0.44] },
        { id: "center", label: "HIT", rect: [x + padWidth * 0.28, y + padHeight * 0.28, padWidth * 0.44, padHeight * 0.44] }
      ];

      ctx.save();
      drawRoundedRect(ctx, x + 1, y + 1, padWidth - 2, padHeight - 2, Math.max(5, radius - 2));
      ctx.clip();
      ctx.globalCompositeOperation = "screen";
      zones.forEach((zone) => {
        const [zoneX, zoneY, zoneWidth, zoneHeight] = zone.rect;
        const active = zone.id === activeZone && pad.active;
        ctx.fillStyle = `hsla(${hue + (active ? 42 : 0)}, 100%, ${active ? 58 : 42}%, ${active ? 0.28 + pressure * 0.18 : 0.075})`;
        ctx.fillRect(zoneX, zoneY, zoneWidth, zoneHeight);
        ctx.strokeStyle = `hsla(${hue + 28}, 100%, 70%, ${active ? 0.38 : 0.14})`;
        ctx.lineWidth = Math.max(1, padHeight * 0.01);
        ctx.strokeRect(zoneX, zoneY, zoneWidth, zoneHeight);
        ctx.fillStyle = `rgba(230, 255, 247, ${active ? 0.74 : 0.28})`;
        ctx.font = `900 ${Math.max(7, Math.floor(padHeight * 0.095))}px Inter, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(zone.label, zoneX + zoneWidth * 0.5, zoneY + zoneHeight * 0.5);
      });
      ctx.restore();
    }

    if (pad.xyEnabled) {
      ctx.save();
      drawRoundedRect(ctx, x + 1, y + 1, padWidth - 2, padHeight - 2, Math.max(5, radius - 2));
      ctx.clip();
      ctx.globalCompositeOperation = "screen";
      ctx.strokeStyle = `hsla(${hue}, 100%, 72%, ${pad.active ? 0.2 : 0.11})`;
      ctx.lineWidth = Math.max(1, padHeight * 0.012);
      for (let line = 1; line < 3; line += 1) {
        const lineX = x + (padWidth * line) / 3;
        const lineY = y + (padHeight * line) / 3;
        ctx.beginPath();
        ctx.moveTo(lineX, y + padHeight * 0.12);
        ctx.lineTo(lineX, y + padHeight * 0.88);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x + padWidth * 0.1, lineY);
        ctx.lineTo(x + padWidth * 0.9, lineY);
        ctx.stroke();
      }

      if (pad.active || holdIntensity > 0.02) {
        ctx.strokeStyle = `hsla(${hue + 18}, 100%, 76%, ${0.46 + Math.max(intensity, holdIntensity) * 0.34})`;
        ctx.lineWidth = Math.max(1.2, padHeight * 0.018);
        ctx.beginPath();
        ctx.moveTo(cursorX, y + padHeight * 0.12);
        ctx.lineTo(cursorX, y + padHeight * 0.88);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x + padWidth * 0.1, cursorY);
        ctx.lineTo(x + padWidth * 0.9, cursorY);
        ctx.stroke();

        const cursorGlow = ctx.createRadialGradient(cursorX, cursorY, 0, cursorX, cursorY, padHeight * 0.46);
        cursorGlow.addColorStop(0, `hsla(${hue + 16}, 100%, 78%, ${0.34 + holdIntensity * 0.22})`);
        cursorGlow.addColorStop(0.55, `hsla(${hue}, 100%, 58%, ${0.12 + holdIntensity * 0.12})`);
        cursorGlow.addColorStop(1, `hsla(${hue}, 100%, 48%, 0)`);
        ctx.fillStyle = cursorGlow;
        ctx.beginPath();
        ctx.arc(cursorX, cursorY, padHeight * (0.32 + holdIntensity * 0.18), 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = `rgba(255, 250, 217, ${0.72 + holdIntensity * 0.22})`;
        ctx.beginPath();
        ctx.arc(cursorX, cursorY, Math.max(3, padHeight * (0.045 + holdIntensity * 0.025)), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    if (pad.pressureEnabled && pressure > 0.02) {
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      for (let ring = 0; ring < 3; ring += 1) {
        const ringEnergy = Math.max(0, pressure - ring * 0.16);
        if (ringEnergy <= 0) continue;
        const phase = time * (5.4 + modulationDepth * 5.6) + index * 1.7 + ring * 1.2;
        const wobbleX = Math.sin(phase) * padWidth * 0.018 * modulationDepth;
        const wobbleY = Math.cos(phase * 0.83) * padHeight * 0.024 * modulationDepth;
        const growth = ringEnergy * (0.11 + ring * 0.035) + pressureVelocity * 0.035;
        drawRoundedRect(
          ctx,
          x - padWidth * growth + wobbleX,
          y - padHeight * growth + wobbleY,
          padWidth * (1 + growth * 2),
          padHeight * (1 + growth * 2),
          radius + padHeight * (0.15 + modulationDepth * 0.2 + ring * 0.04)
        );
        ctx.strokeStyle = `hsla(${pressureHue + ring * 22}, 100%, ${66 + ringEnergy * 14}%, ${0.24 + ringEnergy * 0.38})`;
        ctx.lineWidth = Math.max(1.3, padHeight * (0.014 + ringEnergy * 0.034));
        ctx.shadowColor = `hsla(${pressureHue + ring * 18}, 100%, 66%, ${0.18 + ringEnergy * 0.24})`;
        ctx.shadowBlur = 8 + ringEnergy * 18;
        ctx.stroke();
      }
      ctx.restore();
    }

    if (holdIntensity > 0.02) {
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.strokeStyle = `hsla(${hue + 34}, 100%, 72%, ${0.22 + holdIntensity * 0.42})`;
      ctx.lineWidth = Math.max(1.4, padHeight * (0.02 + holdIntensity * 0.02));
      drawRoundedRect(
        ctx,
        x - padWidth * 0.02 * holdIntensity,
        y - padHeight * 0.03 * holdIntensity,
        padWidth * (1 + 0.04 * holdIntensity),
        padHeight * (1 + 0.06 * holdIntensity),
        radius + padHeight * 0.18 * holdIntensity
      );
      ctx.stroke();
      ctx.restore();
    }

    if (intensity > 0.02) {
      const centerX = pad.xyEnabled ? cursorX : x + padWidth * 0.5;
      const centerY = pad.xyEnabled ? cursorY : y + padHeight * 0.52;
      const flash = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, padHeight * (0.5 + intensity * 0.56));
      flash.addColorStop(0, `hsla(${hue + 16}, 100%, 78%, ${0.42 * intensity})`);
      flash.addColorStop(0.45, `hsla(${hue}, 100%, 58%, ${0.16 * intensity})`);
      flash.addColorStop(1, `hsla(${hue}, 100%, 44%, 0)`);
      ctx.fillStyle = flash;
      ctx.beginPath();
      ctx.arc(centerX, centerY, padHeight * (0.52 + intensity * 0.56), 0, Math.PI * 2);
      ctx.fill();

      for (let ring = 0; ring < 3; ring += 1) {
        const ringPulse = Math.max(0, intensity - ring * 0.18);
        if (ringPulse <= 0) continue;
        ctx.beginPath();
        ctx.arc(centerX, centerY, padHeight * (0.18 + ring * 0.22 + ringPulse * 0.48), 0, Math.PI * 2);
        ctx.strokeStyle = `hsla(${hue + 18 + ring * 18}, 100%, 74%, ${0.34 * ringPulse})`;
        ctx.lineWidth = Math.max(1.5, padHeight * (0.026 + ringPulse * 0.02));
        ctx.stroke();
      }

      ctx.fillStyle = `rgba(255, 248, 210, ${0.46 * intensity})`;
      ctx.beginPath();
      ctx.arc(centerX, centerY, Math.max(2, padHeight * (0.05 + intensity * 0.035)), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = `rgba(229, 255, 249, ${0.68 + intensity * 0.28})`;
    ctx.font = `800 ${Math.max(11, Math.floor(padHeight * 0.18))}px Inter, system-ui, sans-serif`;
    ctx.textAlign = "left";
    ctx.fillText(pad.label, x + padWidth * 0.1, y + padHeight * 0.28);
    ctx.fillStyle = `rgba(157, 255, 230, ${0.68 + intensity * 0.26})`;
    ctx.font = `900 ${Math.max(10, Math.floor(padHeight * 0.14))}px Inter, system-ui, sans-serif`;
    ctx.fillText(
      pad.xyEnabled ? `${pad.xParameterLabel ?? "X"} / ${pad.yParameterLabel ?? "Y"}` : pad.parameterLabel,
      x + padWidth * 0.1,
      y + padHeight * 0.56
    );
    ctx.textAlign = "right";
    ctx.fillStyle = `rgba(255, 236, 151, ${0.64 + intensity * 0.3})`;
    ctx.fillText(
      pad.zoneEnabled && pad.active
        ? (pad.zone ?? "center").toUpperCase()
        : pad.xyEnabled
          ? `${xyX.toFixed(2)} ${Math.max(0, 1 - xyY).toFixed(2)}`
          : pad.value.toFixed(2),
      x + padWidth * 0.9,
      y + padHeight * 0.78
    );
    ctx.restore();
  });

  ctx.restore();
};

const resizeCanvas = (canvas: HTMLCanvasElement) => {
  if (canvas.classList.contains("output-canvas")) {
    const width = Math.max(2, Number(canvas.getAttribute("width")) || canvas.width);
    const height = Math.max(2, Number(canvas.getAttribute("height")) || canvas.height);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(2, Math.floor(rect.width * ratio));
  const height = Math.max(2, Math.floor(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
};

export const renderFrame = (
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement | null,
  motion: MotionFrame | null,
  options: CompositorOptions
) => {
  resizeCanvas(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);

  if (options.visualMode === "shader" && options.shaderScene && options.shaderParameters) {
    const hasVideo = Boolean(video?.videoWidth && video.videoHeight);
    if (options.includeCameraFeed && video && hasVideo) {
      drawMirroredVideo(ctx, video, width, height);
      ctx.save();
      ctx.globalAlpha = 0.78;
      ctx.globalCompositeOperation = "screen";
    }

    try {
      motionShaderPlayer ??= new MotionShaderPlayer();
      const shaderValues = resolveShaderParameterValues(options.shaderScene, options.shaderParameters, motion);
      const rendered = motionShaderPlayer.renderToCanvas(ctx, options.shaderScene, motion, shaderValues, options.effectAmount);
      if (!rendered) {
        drawShaderUnavailable(ctx, width, height);
      }
    } catch (error) {
      console.warn(error);
      drawShaderUnavailable(ctx, width, height);
    } finally {
      if (options.includeCameraFeed && video && hasVideo) {
        ctx.restore();
      }
    }
  } else if (video?.videoWidth && video.videoHeight) {
    drawMirroredVideo(ctx, video, width, height);
  } else {
    drawIdleStage(ctx, width, height);
  }

  const baseAmount = Math.max(0.22, options.effectAmount);
  const showGestureOverlays = options.showGestureOverlays ?? options.showRig;
  const activeMaskMode = options.liveMaskMode && options.liveMaskMode !== "none" ? options.liveMaskMode : options.selectedEffect;
  if (options.visualMode === "shader") {
    if (motion && (options.expressionPersonas || options.selectedEffect === "expressionPersona")) {
      drawExpressionPersona(ctx, motion, width, height, baseAmount);
    }
    if (motion && maskEffectIds.has(activeMaskMode)) {
      drawLiveMask(ctx, motion, width, height, baseAmount, activeMaskMode);
    }
    if (motion && bodyEffectIds.has(options.selectedEffect)) {
      drawBodyEffect(ctx, motion, width, height, baseAmount, options.selectedEffect);
    }
    if (motion && (options.showRig || showGestureOverlays)) {
      const trackingMode = options.trackingMode ?? "upper";
      if (showGestureOverlays && shouldDrawHandGestureMarkers(trackingMode)) {
        drawHandGestureMarkers(ctx, motion, width, height, baseAmount);
      }
      if (options.showRig) {
        drawRig(ctx, motion, width, height, trackingMode);
      }
      if (showGestureOverlays) {
        drawEffectGuideMarkers(ctx, motion, width, height, baseAmount, options.selectedEffect);
      }
    }
    drawVisualDrumPads(ctx, options.visualDrumPads, width, height);
    if (options.watermark?.enabled) {
      drawWatermark(ctx, width, height, options.watermark.label, options.watermark.strength);
    }
    return;
  }

  if (options.selectedEffect === "mirror") {
    drawMirrorComposite(ctx, width, height, baseAmount);
  }

  ctx.fillStyle = "rgba(4, 8, 8, 0.08)";
  ctx.fillRect(0, 0, width, height);

  if (options.selectedEffect === "edge") {
    drawEdgeDetectPass(ctx, width, height, baseAmount);
  }

  if (!motion) {
    drawVisualDrumPads(ctx, options.visualDrumPads, width, height);
    if (options.watermark?.enabled) {
      drawWatermark(ctx, width, height, options.watermark.label, options.watermark.strength);
    }
    return;
  }

  const gestureAmount = baseAmount;
  const shouldRunGestureEffects = options.selectedEffect === "auto";
  const isCharacterEffect = [
    "cyberbot",
    "popidol",
    "comic",
    "toonkit",
    "bigbuck",
    "sintel",
    "spring",
    "spritefright",
    "caminandes"
  ].includes(options.selectedEffect);

  if (options.expressionPersonas || options.selectedEffect === "expressionPersona") {
    drawExpressionPersona(ctx, motion, width, height, gestureAmount);
  }
  if (isCharacterEffect) {
    drawCharacterFilter(ctx, motion, width, height, gestureAmount, options.selectedEffect);
  }
  if (maskEffectIds.has(activeMaskMode)) {
    drawLiveMask(ctx, motion, width, height, gestureAmount, activeMaskMode);
  }
  if (bodyEffectIds.has(options.selectedEffect)) {
    drawBodyEffect(ctx, motion, width, height, gestureAmount, options.selectedEffect);
  }
  if ((shouldRunGestureEffects && motion.gestures.faceCover) || options.selectedEffect === "leaves") {
    drawLeafSprouts(ctx, motion, width, height, gestureAmount);
  }
  if ((shouldRunGestureEffects && motion.gestures.faceCover) || options.selectedEffect === "fire") {
    drawFireFace(ctx, motion, width, height, gestureAmount);
  }
  if ((shouldRunGestureEffects && (motion.gestures.handsUp || motion.gestures.fastMotion)) || options.selectedEffect === "melt") {
    drawHandMelt(ctx, motion, width, height, gestureAmount);
  }
  if ((shouldRunGestureEffects && (motion.gestures.openPalm || motion.gestures.fastMotion)) || options.selectedEffect === "stickers") {
    drawStickerBurst(ctx, motion, width, height, gestureAmount);
  }
  if ((shouldRunGestureEffects && motion.gestures.pinch) || options.selectedEffect === "warp") {
    drawPinchWarp(ctx, motion, width, height, gestureAmount);
  }
  if (options.selectedEffect === "fingerpull") {
    drawGumStretch(ctx, motion, width, height, gestureAmount, "hand");
  }
  if (options.selectedEffect === "nosepull") {
    drawNosePullWarp(ctx, motion, width, height, gestureAmount);
  }
  if (options.selectedEffect === "gumstretch") {
    drawGumStretch(ctx, motion, width, height, gestureAmount, "any");
  }
  if (options.selectedEffect === "facestretch") {
    drawFaceScaleWarp(ctx, motion, width, height, gestureAmount, "stretch");
  }
  if (options.selectedEffect === "facesquash") {
    drawFaceScaleWarp(ctx, motion, width, height, gestureAmount, "squash");
  }
  if ((shouldRunGestureEffects && motion.gestures.openPalm) || options.selectedEffect === "bloom") {
    drawPalmBloom(ctx, motion, width, height, gestureAmount);
  }
  if ((shouldRunGestureEffects && motion.gestures.handsUp) || options.selectedEffect === "contour") {
    drawContourBands(ctx, motion, width, height, gestureAmount);
  }
  if ((shouldRunGestureEffects && motion.gestures.pinch) || options.selectedEffect === "orbit") {
    drawOrbitOverlays(ctx, motion, width, height, gestureAmount);
  }
  if (options.showRig || showGestureOverlays) {
    const trackingMode = options.trackingMode ?? "upper";
    if (showGestureOverlays && shouldDrawHandGestureMarkers(trackingMode)) {
      drawHandGestureMarkers(ctx, motion, width, height, gestureAmount);
    }
    if (options.showRig) {
      drawRig(ctx, motion, width, height, trackingMode);
    }
    if (showGestureOverlays) {
      drawEffectGuideMarkers(ctx, motion, width, height, gestureAmount, options.selectedEffect);
    }
  }
  drawVisualDrumPads(ctx, options.visualDrumPads, width, height);
  if (options.watermark?.enabled) {
    drawWatermark(ctx, width, height, options.watermark.label, options.watermark.strength);
  }
};

export const landmarkToUniform = (landmark: Landmark | undefined) => {
  if (!landmark) return [0.5, 0.5, 0] as const;
  return [landmark.x, landmark.y, landmark.z ?? 0] as const;
};
