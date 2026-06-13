export type Vec2 = {
  x: number;
  y: number;
};

export type Landmark = Vec2 & {
  z?: number;
  visibility?: number;
};

export type Handedness = "Left" | "Right" | "Unknown";

export type TrackedHand = {
  handedness: Handedness;
  landmarks: Landmark[];
  centroid: Vec2;
  wrist: Vec2;
  openness: number;
  pinch: number;
  velocity: number;
  velocityVector: Vec2;
};

export type TrackedPose = {
  landmarks: Landmark[];
  nose?: Vec2;
  leftShoulder?: Vec2;
  rightShoulder?: Vec2;
  leftWrist?: Vec2;
  rightWrist?: Vec2;
};

export type TrackedFace = {
  landmarks: Landmark[];
  center: Vec2;
  bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
  nose?: Vec2;
  forehead?: Vec2;
  chin?: Vec2;
  leftCheek?: Vec2;
  rightCheek?: Vec2;
  leftEar?: Vec2;
  rightEar?: Vec2;
  leftEye?: Vec2;
  rightEye?: Vec2;
  mouthLeft?: Vec2;
  mouthRight?: Vec2;
  upperLip?: Vec2;
  lowerLip?: Vec2;
  mouthOpenness: number;
  smile: number;
  frown: number;
  leftEyeClosure: number;
  rightEyeClosure: number;
  eyeClosure: number;
};

export type GestureState = {
  handsUp: boolean;
  faceCover: boolean;
  pinch: boolean;
  openPalm: boolean;
  fastMotion: boolean;
  mouthOpen: boolean;
  smile: boolean;
  frown: boolean;
  eyesClosed: boolean;
  earPull: boolean;
  chinPull: boolean;
  neutral: boolean;
};

export type GestureControlId = Exclude<keyof GestureState, "neutral">;

export type GesturePhase = "idle" | "debouncing" | "started" | "held" | "released" | "cooldown";

export type GestureControlState = {
  id: GestureControlId;
  active: boolean;
  phase: GesturePhase;
  started: boolean;
  held: boolean;
  released: boolean;
  repeated: boolean;
  latched: boolean;
  repeats: number;
  activeMs: number;
  heldMs: number;
  cooldownMsRemaining: number;
  smooth: number;
};

export type GestureControlFrame = Record<GestureControlId, GestureControlState>;

export type GestureStateMachineConfig = {
  debounceMs: number;
  releaseDebounceMs: number;
  holdMs: number;
  cooldownMs: number;
  repeatMs: number;
  smoothing: number;
  latchGestures: Partial<Record<GestureControlId, boolean>>;
};

export type FaceGestureCalibration = {
  mouthOpenThreshold: number;
  smileThreshold: number;
  frownThreshold: number;
  eyesClosedThreshold: number;
  earPullRadius: number;
  earPullPinchThreshold: number;
  chinPullRadius: number;
  chinPullLiftThreshold: number;
};

export type MotionFrame = {
  timestamp: number;
  hands: TrackedHand[];
  pose?: TrackedPose;
  face?: TrackedFace;
  gestures: GestureState;
  gestureControls: GestureControlFrame;
  confidence: number;
  landmarkCount: number;
  dominantIntent: string;
};

export type PreviousHandSample = {
  wrist: Vec2;
  timestamp: number;
};
