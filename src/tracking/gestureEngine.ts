import type {
  FaceGestureCalibration,
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
import { createGestureControlFrame } from "./gestureStateMachine";

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
const FACE_LEFT_EYE_INNER = 133;
const FACE_RIGHT_EYE_INNER = 362;
const FACE_LEFT_EYE_UPPER = 159;
const FACE_LEFT_EYE_LOWER = 145;
const FACE_RIGHT_EYE_UPPER = 386;
const FACE_RIGHT_EYE_LOWER = 374;
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

export const defaultFaceGestureCalibration: FaceGestureCalibration = {
  mouthOpenThreshold: 0.48,
  smileThreshold: 0.52,
  frownThreshold: 0.46,
  eyesClosedThreshold: 0.64,
  earPullRadius: 0.28,
  earPullPinchThreshold: 0.42,
  chinPullRadius: 0.24,
  chinPullLiftThreshold: 0.16
};

export const resolveFaceGestureCalibration = (
  calibration?: Partial<FaceGestureCalibration>
): FaceGestureCalibration => ({
  ...defaultFaceGestureCalibration,
  ...calibration
});

const midpoint = (a: Vec2, b: Vec2): Vec2 => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2
});

const getEyeClosure = (outer: Vec2 | undefined, inner: Vec2 | undefined, upper: Vec2 | undefined, lower: Vec2 | undefined) => {
  if (!outer || !inner || !upper || !lower) {
    return 0;
  }

  const eyeWidth = distance(outer, inner);
  const eyeOpenRatio = distance(upper, lower) / Math.max(0.01, eyeWidth);
  return clamp01((0.22 - eyeOpenRatio) * 5.5);
};

const handLandmarksNearPoint = (hand: TrackedHand, point: Vec2, radius: number) =>
  hand.landmarks.filter((landmark) => distance(landmark, point) < radius).length;

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
  const faceWidth = bounds.maxX - bounds.minX;
  const faceHeight = bounds.maxY - bounds.minY;
  const mouthCenter = upperLip && lowerLip ? midpoint(upperLip, lowerLip) : undefined;
  const mouthCornerY = mouthLeft && mouthRight ? (mouthLeft.y + mouthRight.y) / 2 : undefined;
  const mouthDroop = mouthCenter && mouthCornerY !== undefined ? (mouthCornerY - mouthCenter.y) / Math.max(0.01, mouthWidth) : 0;
  const leftEyeClosure = getEyeClosure(
    landmarks[FACE_LEFT_EYE],
    landmarks[FACE_LEFT_EYE_INNER],
    landmarks[FACE_LEFT_EYE_UPPER],
    landmarks[FACE_LEFT_EYE_LOWER]
  );
  const rightEyeClosure = getEyeClosure(
    landmarks[FACE_RIGHT_EYE],
    landmarks[FACE_RIGHT_EYE_INNER],
    landmarks[FACE_RIGHT_EYE_UPPER],
    landmarks[FACE_RIGHT_EYE_LOWER]
  );
  const earY = landmarks[FACE_LEFT_EYE] && mouthLeft
    ? midpoint(landmarks[FACE_LEFT_EYE], mouthLeft).y
    : bounds.minY + faceHeight * 0.48;

  return {
    landmarks,
    center: averagePoint(landmarks),
    bounds,
    nose: landmarks[FACE_NOSE],
    forehead: landmarks[FACE_FOREHEAD],
    chin: landmarks[FACE_CHIN],
    leftCheek: landmarks[FACE_LEFT_CHEEK],
    rightCheek: landmarks[FACE_RIGHT_CHEEK],
    leftEar: { x: bounds.minX - faceWidth * 0.04, y: earY },
    rightEar: { x: bounds.maxX + faceWidth * 0.04, y: earY },
    leftEye: landmarks[FACE_LEFT_EYE],
    rightEye: landmarks[FACE_RIGHT_EYE],
    mouthLeft,
    mouthRight,
    upperLip,
    lowerLip,
    mouthOpenness: clamp01((mouthOpen / Math.max(0.01, mouthWidth) - 0.1) * 4.5),
    smile: clamp01((mouthWidth - faceWidth * 0.28) * 8),
    frown: clamp01((mouthDroop - 0.02) * 8),
    leftEyeClosure,
    rightEyeClosure,
    eyeClosure: Math.max(leftEyeClosure, rightEyeClosure)
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
  const velocityVector = previous
    ? {
        x: (wrist.x - previous.wrist.x) / deltaSeconds,
        y: (wrist.y - previous.wrist.y) / deltaSeconds
      }
    : { x: 0, y: 0 };

  return {
    handedness,
    landmarks,
    centroid,
    wrist,
    openness,
    pinch,
    velocity,
    velocityVector
  };
};

export const analyzeMotion = (
  hands: TrackedHand[],
  pose: TrackedPose | undefined,
  face: TrackedFace | undefined,
  timestamp: number,
  calibrationInput?: Partial<FaceGestureCalibration>
): MotionFrame => {
  const calibration = resolveFaceGestureCalibration(calibrationInput);
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
  const faceWidth = face ? face.bounds.maxX - face.bounds.minX : 0;
  const faceHeight = face ? face.bounds.maxY - face.bounds.minY : 0;
  const faceTouchRadius = Math.min(0.18, Math.max(0.055, faceWidth * calibration.earPullRadius));
  const mouthOpen = (face?.mouthOpenness ?? 0) > calibration.mouthOpenThreshold;
  const smile = (face?.smile ?? 0) > calibration.smileThreshold;
  const frown = (face?.frown ?? 0) > calibration.frownThreshold;
  const eyesClosed = (face?.eyeClosure ?? 0) > calibration.eyesClosedThreshold;
  const earPull =
    Boolean(face?.leftEar && face.rightEar) &&
    hands.some((hand) => {
      if (!face?.leftEar || !face.rightEar) return false;
      const nearLeftEar = handLandmarksNearPoint(hand, face.leftEar, faceTouchRadius) >= 2;
      const nearRightEar = handLandmarksNearPoint(hand, face.rightEar, faceTouchRadius) >= 2;
      return (nearLeftEar || nearRightEar) && (hand.pinch > calibration.earPullPinchThreshold || hand.openness > 0.42);
    });
  const chinPull =
    Boolean(face?.chin) &&
    hands.some((hand) => {
      if (!face?.chin) return false;
      const nearChin =
        handLandmarksNearPoint(hand, face.chin, Math.min(0.17, Math.max(0.055, faceWidth * calibration.chinPullRadius))) >= 2 ||
        distance(hand.centroid, face.chin) < Math.min(0.2, Math.max(0.075, faceWidth * (calibration.chinPullRadius + 0.06)));
      const underChin = hand.centroid.y > face.chin.y - faceHeight * 0.06;
      const lifting = hand.velocityVector.y < -calibration.chinPullLiftThreshold || hand.velocity > 0.28;
      return nearChin && underChin && lifting;
    });
  const neutral =
    !handsUp &&
    !faceCover &&
    !pinch &&
    !openPalm &&
    !fastMotion &&
    !mouthOpen &&
    !smile &&
    !frown &&
    !eyesClosed &&
    !earPull &&
    !chinPull;
  const gestures: GestureState = {
    handsUp,
    faceCover,
    pinch,
    openPalm,
    fastMotion,
    mouthOpen,
    smile,
    frown,
    eyesClosed,
    earPull,
    chinPull,
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
    gestureControls: createGestureControlFrame(),
    confidence,
    landmarkCount,
    dominantIntent: getDominantIntent(gestures)
  };
};

export const getDominantIntent = (gestures: GestureState) => {
  if (gestures.earPull) return "Ear pull";
  if (gestures.chinPull) return "Chin lift";
  if (gestures.mouthOpen) return "Mouth open";
  if (gestures.smile) return "Smile trigger";
  if (gestures.frown) return "Frown trigger";
  if (gestures.eyesClosed) return "Eyes closed";
  if (gestures.faceCover) return "Face ignition";
  if (gestures.handsUp) return "Lift melt";
  if (gestures.pinch) return "Pinch warp";
  if (gestures.fastMotion) return "Velocity trails";
  if (gestures.openPalm) return "Palm bloom";
  return "Neutral stance";
};
