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
  leftEye?: Vec2;
  rightEye?: Vec2;
  mouthLeft?: Vec2;
  mouthRight?: Vec2;
  upperLip?: Vec2;
  lowerLip?: Vec2;
  mouthOpenness: number;
  smile: number;
};

export type GestureState = {
  handsUp: boolean;
  faceCover: boolean;
  pinch: boolean;
  openPalm: boolean;
  fastMotion: boolean;
  neutral: boolean;
};

export type MotionFrame = {
  timestamp: number;
  hands: TrackedHand[];
  pose?: TrackedPose;
  face?: TrackedFace;
  gestures: GestureState;
  confidence: number;
  landmarkCount: number;
  dominantIntent: string;
};

export type PreviousHandSample = {
  wrist: Vec2;
  timestamp: number;
};
