import type {
  GestureControlFrame,
  GestureControlId,
  GestureControlState,
  GestureState,
  GestureStateMachineConfig
} from "./types";

export const gestureControlIds: GestureControlId[] = [
  "handsUp",
  "faceCover",
  "pinch",
  "openPalm",
  "fastMotion",
  "mouthOpen",
  "smile",
  "frown",
  "eyesClosed",
  "earPull",
  "chinPull"
];

export const defaultGestureStateMachineConfig: GestureStateMachineConfig = {
  debounceMs: 90,
  releaseDebounceMs: 120,
  holdMs: 420,
  cooldownMs: 260,
  repeatMs: 850,
  smoothing: 0.58,
  latchGestures: {
    smile: true,
    eyesClosed: true
  }
};

export type GestureStateMachineMemory = {
  controls: GestureControlFrame;
  lastTimestamp: number;
  pendingActiveSince: Partial<Record<GestureControlId, number>>;
  pendingReleaseSince: Partial<Record<GestureControlId, number>>;
  nextRepeatAt: Partial<Record<GestureControlId, number>>;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const createGestureControlState = (id: GestureControlId): GestureControlState => ({
  id,
  active: false,
  phase: "idle",
  started: false,
  held: false,
  released: false,
  repeated: false,
  latched: false,
  repeats: 0,
  activeMs: 0,
  heldMs: 0,
  cooldownMsRemaining: 0,
  smooth: 0
});

export const createGestureControlFrame = (): GestureControlFrame =>
  Object.fromEntries(gestureControlIds.map((id) => [id, createGestureControlState(id)])) as GestureControlFrame;

export const createGestureStateMachineMemory = (): GestureStateMachineMemory => ({
  controls: createGestureControlFrame(),
  lastTimestamp: 0,
  pendingActiveSince: {},
  pendingReleaseSince: {},
  nextRepeatAt: {}
});

export const resolveGestureStateMachineConfig = (
  config?: Partial<GestureStateMachineConfig>
): GestureStateMachineConfig => ({
  ...defaultGestureStateMachineConfig,
  ...config,
  latchGestures: {
    ...defaultGestureStateMachineConfig.latchGestures,
    ...config?.latchGestures
  }
});

export const updateGestureStateMachine = (
  memory: GestureStateMachineMemory,
  gestures: GestureState,
  timestamp: number,
  configInput?: Partial<GestureStateMachineConfig>
) => {
  const config = resolveGestureStateMachineConfig(configInput);
  const previousTimestamp = memory.lastTimestamp || timestamp;
  const deltaMs = Math.max(0, timestamp - previousTimestamp);
  const smoothing = clamp01(config.smoothing);
  const activationThreshold = 0.5;
  const nextControls = createGestureControlFrame();

  for (const id of gestureControlIds) {
    const previous = memory.controls[id] ?? createGestureControlState(id);
    const rawActive = Boolean(gestures[id]);
    const target = rawActive ? 1 : 0;
    const smooth = clamp01(previous.smooth * smoothing + target * (1 - smoothing));
    const signalActive = smooth >= activationThreshold;
    const wasActive = previous.active;
    const cooldownMsRemaining = Math.max(0, (previous.cooldownMsRemaining ?? 0) - deltaMs);
    const inCooldown = cooldownMsRemaining > 0 && !wasActive;
    const startSince = signalActive ? memory.pendingActiveSince[id] ?? timestamp : timestamp;
    const releaseSince = signalActive ? timestamp : memory.pendingReleaseSince[id] ?? timestamp;
    const started = !wasActive && !inCooldown && signalActive && timestamp - startSince >= config.debounceMs;
    const released =
      wasActive && !signalActive && releaseSince !== undefined && timestamp - releaseSince >= config.releaseDebounceMs;
    const nextRepeatAt = memory.nextRepeatAt[id] ?? timestamp + config.repeatMs;
    const repeated = wasActive && signalActive && config.repeatMs > 0 && timestamp >= nextRepeatAt;
    const active = released ? false : started ? true : wasActive;
    const activeMs = active ? (started ? 0 : previous.activeMs + deltaMs) : 0;
    const held = active && activeMs >= config.holdMs;
    const nextPhase =
      started ? "started" :
      released ? "released" :
      active && held ? "held" :
      active ? "debouncing" :
      inCooldown ? "cooldown" :
      signalActive ? "debouncing" :
      "idle";
    const latched =
      config.latchGestures[id] && started
        ? !previous.latched
        : config.latchGestures[id]
          ? previous.latched
          : false;

    if (signalActive) {
      memory.pendingReleaseSince[id] = undefined;
      memory.pendingActiveSince[id] = startSince;
    } else {
      memory.pendingActiveSince[id] = undefined;
      memory.pendingReleaseSince[id] = releaseSince;
    }

    if (started || repeated) {
      memory.nextRepeatAt[id] = timestamp + config.repeatMs;
    }
    if (released) {
      memory.nextRepeatAt[id] = undefined;
    }

    nextControls[id] = {
      id,
      active,
      phase: nextPhase,
      started,
      held,
      released,
      repeated,
      latched,
      repeats: repeated ? previous.repeats + 1 : active ? previous.repeats : 0,
      activeMs,
      heldMs: held ? Math.max(0, activeMs - config.holdMs) : 0,
      cooldownMsRemaining: released ? config.cooldownMs : cooldownMsRemaining,
      smooth
    };
  }

  memory.controls = nextControls;
  memory.lastTimestamp = timestamp;
  return nextControls;
};
