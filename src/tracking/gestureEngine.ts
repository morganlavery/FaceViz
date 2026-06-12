import type {
  GestureState,
  Handedness,
  Landmark,
  MotionFrame,
  PreviousHandSample,
  TrackedFace,
  TrackedHand,
  TrackedPose,
  Vec2
} from "./types";

const HAND_TIP_INDICES = [4, 8, 12, 16, 20];
const HAND_ROOT_INDICES = [2, 5, 9, 13, 17];
const POSE_NOSE = 0;
const POSE_LEFT_SHOULDER = 11;
const POSE_RIGHT_SHOULDER = 12;
const POSE_LEFT_WRIST = 15;
const POSE_RIGHT_WRIST = 16;
const FACE_FOREHEAD = 10;
const FACE_CHIN = 152;
const FACE_NOSE = 1;
const FACE_LEFT_CHEEK = 234;
const FACE_RIGHT_CHEEK = 454;
const FACE_LEFT_EYE = 33;
const FACE_RIGHT_EYE = 263;
const FACE_MOUTH_LEFT = 61;
const FACE_MOUTH_RIGHT = 291;
const FACE_UPPER_LIP = 13;
const FACE_LOWER_LIP = 14;

const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

const averagePoint = (points: Vec2[]): Vec2 => {
  if (!points.length) {
    return { x: 0.5, y: 0.5 };
  }

  return {
    x: points.reduce((total, point) => total + point.x, 0) / points.length,
    y: points.reduce((total, point) => total + point.y, 0) / points.length
  };
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export const pointToCanvas = (point: Vec2, width: number, height: number): Vec2 => ({
  x: (1 - point.x) * width,
  y: point.y * height
});

export const buildTrackedPose = (landmarks?: Landmark[]): TrackedPose | undefined => {
  if (!landmarks?.length) {
    return undefined;
  }

  return {
    landmarks,
    nose: landmarks[POSE_NOSE],
    leftShoulder: landmarks[POSE_LEFT_SHOULDER],
    rightShoulder: landmarks[POSE_RIGHT_SHOULDER],
    leftWrist: landmarks[POSE_LEFT_WRIST],
    rightWrist: landmarks[POSE_RIGHT_WRIST]
  };
};

export const buildTrackedFace = (landmarks?: Landmark[]): TrackedFace | undefined => {
  if (!landmarks?.length) {
    return undefined;
  }

  const bounds = landmarks.reduce(
    (current, point) => ({
      minX: Math.min(current.minX, point.x),
      minY: Math.min(current.minY, point.y),
      maxX: Math.max(current.maxX, point.x),
      maxY: Math.max(current.maxY, point.y)
    }),
    {
      minX: 1,
      minY: 1,
      maxX: 0,
      maxY: 0
    }
  );
  const mouthLeft = landmarks[FACE_MOUTH_LEFT];
  const mouthRight = landmarks[FACE_MOUTH_RIGHT];
  const upperLip = landmarks[FACE_UPPER_LIP];
  const lowerLip = landmarks[FACE_LOWER_LIP];
  const mouthWidth = mouthLeft && mouthRight ? distance(mouthLeft, mouthRight) : 0.08;
  const mouthOpen = upperLip && lowerLip ? distance(upperLip, lowerLip) : 0;

  return {
    landmarks,
    center: averagePoint(landmarks),
    bounds,
    nose: landmarks[FACE_NOSE],
    forehead: landmarks[FACE_FOREHEAD],
    chin: landmarks[FACE_CHIN],
    leftCheek: landmarks[FACE_LEFT_CHEEK],
    rightCheek: landmarks[FACE_RIGHT_CHEEK],
    leftEye: landmarks[FACE_LEFT_EYE],
    rightEye: landmarks[FACE_RIGHT_EYE],
    mouthLeft,
    mouthRight,
    upperLip,
    lowerLip,
    mouthOpenness: clamp01((mouthOpen / Math.max(0.01, mouthWidth) - 0.1) * 4.5),
    smile: clamp01((mouthWidth - (bounds.maxX - bounds.minX) * 0.28) * 8)
  };
};

export const buildTrackedHand = (
  landmarks: Landmark[],
  handedness: Handedness,
  previous?: PreviousHandSample,
  timestamp = performance.now()
): TrackedHand => {
  const wrist = landmarks[0] ?? { x: 0.5, y: 0.5 };
  const centroid = averagePoint(landmarks);
  const tipSpread =
    HAND_TIP_INDICES.reduce((total, index) => total + distance(wrist, landmarks[index] ?? wrist), 0) /
    HAND_TIP_INDICES.length;
  const rootSpread =
    HAND_ROOT_INDICES.reduce((total, index) => total + distance(wrist, landmarks[index] ?? wrist), 0) /
    HAND_ROOT_INDICES.length;
  const openness = clamp01((tipSpread - rootSpread * 0.9) * 5.2);
  const pinchDistance = distance(landmarks[4] ?? wrist, landmarks[8] ?? wrist);
  const pinch = clamp01(1 - pinchDistance / 0.09);
  const deltaSeconds = previous ? Math.max(0.001, (timestamp - previous.timestamp) / 1000) : 1;
  const velocity = previous ? clamp01(distance(wrist, previous.wrist) / deltaSeconds / 1.7) : 0;

  return {
    handedness,
    landmarks,
    centroid,
    wrist,
    openness,
    pinch,
    velocity
  };
};

export const analyzeMotion = (
  hands: TrackedHand[],
  pose: TrackedPose | undefined,
  face: TrackedFace | undefined,
  timestamp: number
): MotionFrame => {
  const shoulderLineY =
    pose?.leftShoulder && pose.rightShoulder ? (pose.leftShoulder.y + pose.rightShoulder.y) / 2 : undefined;
  const handsUp =
    shoulderLineY !== undefined &&
    hands.some((hand) => hand.wrist.y < shoulderLineY - 0.12 || hand.centroid.y < shoulderLineY - 0.16);
  const faceCover =
    Boolean(face?.nose ?? pose?.nose) &&
    hands.some((hand) => {
      const faceCenter = face?.nose ?? pose?.nose;
      const nearNose = hand.landmarks.filter((point) => faceCenter && distance(point, faceCenter) < 0.12).length;
      return nearNose >= 3 || (faceCenter ? distance(hand.centroid, faceCenter) < 0.13 : false);
    });
  const pinch = hands.some((hand) => hand.pinch > 0.64);
  const openPalm = hands.some((hand) => hand.openness > 0.56);
  const fastMotion = hands.some((hand) => hand.velocity > 0.36);
  const neutral = !handsUp && !faceCover && !pinch && !openPalm && !fastMotion;
  const gestures: GestureState = {
    handsUp,
    faceCover,
    pinch,
    openPalm,
    fastMotion,
    neutral
  };
  const landmarkCount = hands.reduce(
    (total, hand) => total + hand.landmarks.length,
    (pose?.landmarks.length ?? 0) + (face?.landmarks.length ?? 0)
  );
  const confidence = clamp01((hands.length ? 0.3 : 0) + (pose ? 0.26 : 0) + (face ? 0.34 : 0) + Math.min(0.1, landmarkCount / 720));

  return {
    timestamp,
    hands,
    pose,
    face,
    gestures,
    confidence,
    landmarkCount,
    dominantIntent: getDominantIntent(gestures)
  };
};

export const getDominantIntent = (gestures: GestureState) => {
  if (gestures.faceCover) return "Face ignition";
  if (gestures.handsUp) return "Lift melt";
  if (gestures.pinch) return "Pinch warp";
  if (gestures.fastMotion) return "Velocity trails";
  if (gestures.openPalm) return "Palm bloom";
  return "Neutral stance";
};
