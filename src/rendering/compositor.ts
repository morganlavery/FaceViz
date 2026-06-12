import { pointToCanvas } from "../tracking/gestureEngine";
import type { Landmark, MotionFrame, Vec2 } from "../tracking/types";

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

const POSE_CONNECTIONS = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [0, 11],
  [0, 12]
];

const HAND_TIP_INDICES = [4, 8, 12, 16, 20];
const HAND_GRAPHIC_ANCHORS = [0, 4, 8, 12, 16, 20];

type CompositorOptions = {
  showRig: boolean;
  effectAmount: number;
  selectedEffect: string;
};

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

const drawRig = (ctx: CanvasRenderingContext2D, motion: MotionFrame, width: number, height: number) => {
  if (motion.pose?.landmarks) {
    POSE_CONNECTIONS.forEach(([start, end]) => {
      const a = motion.pose?.landmarks[start];
      const b = motion.pose?.landmarks[end];
      if (!a || !b) return;
      drawLine(ctx, pointToCanvas(a, width, height), pointToCanvas(b, width, height), 4, "rgba(54, 238, 247, 0.9)", "#36eef7");
    });
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

const resizeCanvas = (canvas: HTMLCanvasElement) => {
  const rect = canvas.getBoundingClientRect();
  const ratio = canvas.classList.contains("output-canvas") ? 1 : window.devicePixelRatio || 1;
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

  if (video?.videoWidth && video.videoHeight) {
    ctx.save();
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, width, height);
    ctx.restore();
  } else {
    drawIdleStage(ctx, width, height);
  }

  ctx.fillStyle = "rgba(4, 8, 8, 0.08)";
  ctx.fillRect(0, 0, width, height);

  if (!motion) {
    return;
  }

  const gestureAmount = Math.max(0.22, options.effectAmount);
  if (motion.gestures.faceCover || options.selectedEffect === "leaves") {
    drawLeafSprouts(ctx, motion, width, height, gestureAmount);
  }
  if (motion.gestures.faceCover || options.selectedEffect === "fire") {
    drawFireFace(ctx, motion, width, height, gestureAmount);
  }
  if (motion.gestures.handsUp || motion.gestures.fastMotion || options.selectedEffect === "melt") {
    drawHandMelt(ctx, motion, width, height, gestureAmount);
  }
  if (motion.gestures.openPalm || motion.gestures.fastMotion || options.selectedEffect === "stickers") {
    drawStickerBurst(ctx, motion, width, height, gestureAmount);
  }
  if (motion.gestures.pinch || options.selectedEffect === "warp") {
    drawPinchWarp(ctx, motion, width, height, gestureAmount);
  }
  if (motion.gestures.openPalm || options.selectedEffect === "bloom") {
    drawPalmBloom(ctx, motion, width, height, gestureAmount);
  }
  if (motion.gestures.handsUp || options.selectedEffect === "contour") {
    drawContourBands(ctx, motion, width, height, gestureAmount);
  }
  if (motion.gestures.pinch || options.selectedEffect === "orbit") {
    drawOrbitOverlays(ctx, motion, width, height, gestureAmount);
  }
  if (options.showRig) {
    drawRig(ctx, motion, width, height);
  }
};

export const landmarkToUniform = (landmark: Landmark | undefined) => {
  if (!landmark) return [0.5, 0.5, 0] as const;
  return [landmark.x, landmark.y, landmark.z ?? 0] as const;
};
