import { pointToCanvas } from "../tracking/gestureEngine";
import type { Landmark, MotionFrame, TrackedFace, Vec2 } from "../tracking/types";
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
const GUM_PINCH_ENGAGE = 0.64;
const GUM_PINCH_RELEASE = 0.38;
const GUM_ATTACH_RADIUS = 0.085;
const GUM_CHEEK_ATTACH_RADIUS = 0.13;
const GUM_FACE_ATTACH_RADIUS = 0.105;
const GUM_SNAP_DURATION = 340;

export type TrackingPreviewMode = "upper" | "full" | "face" | "handsFace";

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
  effectAmount: number;
  selectedEffect: string;
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

type GumStretchTarget = {
  anchor: Vec2;
  tip: Vec2;
  label: "hand" | "face";
  strength: number;
};

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

const getBestGumStretchTarget = (motion: MotionFrame): GumStretchTarget | null => {
  const pinchingHands = motion.hands
    .map((hand, index) => ({ hand, index, pinchPoint: getPinchPoint(hand) }))
    .filter((entry) => entry.pinchPoint && entry.hand.pinch > GUM_PINCH_ENGAGE)
    .sort((a, b) => b.hand.pinch - a.hand.pinch);

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
        const attachRadius = bodyIndex === grabber.index ? GUM_ATTACH_RADIUS * 0.68 : GUM_ATTACH_RADIUS;
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

  if (!motion.face) {
    return null;
  }

  const faceAnchors = [
    { anchor: motion.face.nose, radius: GUM_FACE_ATTACH_RADIUS },
    { anchor: motion.face.chin, radius: GUM_FACE_ATTACH_RADIUS },
    { anchor: motion.face.leftCheek, radius: GUM_CHEEK_ATTACH_RADIUS },
    { anchor: motion.face.rightCheek, radius: GUM_CHEEK_ATTACH_RADIUS },
    { anchor: motion.face.leftEar, radius: GUM_CHEEK_ATTACH_RADIUS },
    { anchor: motion.face.rightEar, radius: GUM_CHEEK_ATTACH_RADIUS }
  ].filter((entry): entry is { anchor: Vec2; radius: number } => Boolean(entry.anchor));
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

const drawGumStretch = (ctx: CanvasRenderingContext2D, motion: MotionFrame, width: number, height: number, amount: number) => {
  const now = motion.timestamp;
  const target = getBestGumStretchTarget(motion);
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
  if (options.visualMode === "shader") {
    if (motion && options.showRig) {
      const trackingMode = options.trackingMode ?? "upper";
      if (shouldDrawHandGestureMarkers(trackingMode)) {
        drawHandGestureMarkers(ctx, motion, width, height, baseAmount);
      }
      drawRig(ctx, motion, width, height, trackingMode);
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

  if (isCharacterEffect) {
    drawCharacterFilter(ctx, motion, width, height, gestureAmount, options.selectedEffect);
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
  if (options.selectedEffect === "gumstretch") {
    drawGumStretch(ctx, motion, width, height, gestureAmount);
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
  if (options.showRig) {
    const trackingMode = options.trackingMode ?? "upper";
    if (shouldDrawHandGestureMarkers(trackingMode)) {
      drawHandGestureMarkers(ctx, motion, width, height, gestureAmount);
    }
    drawRig(ctx, motion, width, height, trackingMode);
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
