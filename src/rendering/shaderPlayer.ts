import type { MotionFrame, Vec2 } from "../tracking/types";

export type ShaderMotionSource =
  | "manual"
  | "confidence"
  | "handOpen"
  | "pinch"
  | "velocity"
  | "handsUp"
  | "faceCover"
  | "openPalm"
  | "noseX"
  | "noseY";

export type ShaderParameterDefinition = {
  id: string;
  label: string;
  min: number;
  max: number;
  defaultValue: number;
  motionDefault: ShaderMotionSource;
};

export type ShaderParameterSettings = {
  value: number;
  source: ShaderMotionSource;
  depth: number;
};

export type ShaderScene = {
  id: string;
  label: string;
  detail: string;
  fragment: string;
  parameters: ShaderParameterDefinition[];
  author?: string;
  imported?: boolean;
  license?: string;
  source?: "builtin" | "file" | "preset" | "raw" | "shadertoy";
  sourceUrl?: string;
};

type MotionUniforms = {
  motion: [number, number, number, number];
  pose: [number, number, number, number];
  gestures: [number, number, number, number];
};

const VERTEX_SHADER = `
attribute vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const shaderPrelude = `
precision highp float;
uniform vec3 iResolution;
uniform float iTime;
uniform int iFrame;
uniform vec4 iMouse;
uniform vec4 fvMotion;
uniform vec4 fvPose;
uniform vec4 fvGestures;
uniform vec4 fvParamA;
uniform vec4 fvParamB;
uniform vec4 fvParamC;
uniform vec4 fvParamD;
uniform vec4 fvParamE;
uniform vec4 fvParamF;
uniform vec4 fvParamG;
uniform vec4 fvParamH;
uniform float fvParams[32];
`;

export const shaderMotionSources: Array<{ id: ShaderMotionSource; label: string }> = [
  { id: "manual", label: "Manual" },
  { id: "confidence", label: "Confidence" },
  { id: "handOpen", label: "Hand open" },
  { id: "pinch", label: "Pinch" },
  { id: "velocity", label: "Velocity" },
  { id: "handsUp", label: "Hands up" },
  { id: "faceCover", label: "Face cover" },
  { id: "openPalm", label: "Open palm" },
  { id: "noseX", label: "Nose X" },
  { id: "noseY", label: "Nose Y" }
];

export const SHADER_LIBRARY_STORAGE_KEY = "faceviz.shaderLibrary.v1";

export type StoredShaderScene = Pick<
  ShaderScene,
  "author" | "detail" | "fragment" | "id" | "imported" | "label" | "license" | "parameters" | "source" | "sourceUrl"
>;

export type ImportedShaderInput = {
  author?: string;
  fragment: string;
  label: string;
  license?: string;
  parameters?: ShaderParameterDefinition[];
  source?: "file" | "preset" | "raw" | "shadertoy";
  sourceUrl?: string;
};

export const FACEVIZ_SHADER_PRESET_SCHEMA = "faceviz.shader.v1";

export type INFINIGHTCaptureShaderPreset = {
  schema: typeof FACEVIZ_SHADER_PRESET_SCHEMA;
  name: string;
  fragment: string;
  author?: string;
  license?: string;
  source?: ShaderScene["source"];
  sourceUrl?: string;
  parameters?: ShaderParameterDefinition[];
  mappings?: Record<string, ShaderParameterSettings>;
};

export const shaderScenes: ShaderScene[] = [
  {
    id: "aurora",
    label: "Aurora Fields",
    detail: "Soft bands for confidence, hands, and face motion",
    parameters: [
      { id: "flow", label: "Flow", min: 0, max: 1, defaultValue: 0.54, motionDefault: "velocity" },
      { id: "bloom", label: "Bloom", min: 0, max: 1, defaultValue: 0.68, motionDefault: "handOpen" },
      { id: "hue", label: "Hue", min: 0, max: 1, defaultValue: 0.38, motionDefault: "noseX" },
      { id: "grain", label: "Grain", min: 0, max: 1, defaultValue: 0.2, motionDefault: "confidence" }
    ],
    fragment: `
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

vec3 palette(float t) {
  return 0.52 + 0.48 * cos(6.28318 * (vec3(0.0, 0.23, 0.58) + t));
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = (fragCoord * 2.0 - iResolution.xy) / iResolution.y;
  float flow = fvParamA.x;
  float bloom = fvParamA.y;
  float hue = fvParamA.z + fvPose.x * 0.18;
  float grain = fvParamA.w;
  float t = iTime * (0.12 + flow * 0.8);
  float open = fvMotion.x;
  float pinch = fvMotion.y;
  float velocity = fvMotion.z;

  float field = 0.0;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    vec2 waveUv = uv;
    waveUv.x += sin(uv.y * (1.8 + fi * 0.42) + t * (1.2 + fi * 0.28)) * (0.18 + bloom * 0.22);
    waveUv.y += cos(uv.x * (1.3 + fi * 0.36) - t * (1.0 + fi * 0.2)) * (0.12 + open * 0.22);
    field += 0.035 / abs(sin(waveUv.y * (2.3 + fi * 0.35) + t + fi) - waveUv.x * (0.12 + pinch * 0.2));
  }

  float vignette = smoothstep(1.7, 0.18, length(uv));
  vec3 color = palette(hue + field * 0.16 + velocity * 0.12);
  color *= field * (0.26 + bloom * 0.62) * vignette;
  color += vec3(0.03, 0.08, 0.07) * (0.65 + fvMotion.w);
  color += (hash(fragCoord + iTime) - 0.5) * grain * 0.06;
  color *= 0.35 + fvAmount * 0.75;
  fragColor = vec4(color, 1.0);
}
`
  },
  {
    id: "kineticRings",
    label: "Kinetic Rings",
    detail: "Pinch and hand lift become orbiting rings",
    parameters: [
      { id: "radius", label: "Radius", min: 0, max: 1, defaultValue: 0.46, motionDefault: "pinch" },
      { id: "spin", label: "Spin", min: 0, max: 1, defaultValue: 0.52, motionDefault: "velocity" },
      { id: "split", label: "Split", min: 0, max: 1, defaultValue: 0.22, motionDefault: "handsUp" },
      { id: "pulse", label: "Pulse", min: 0, max: 1, defaultValue: 0.58, motionDefault: "openPalm" }
    ],
    fragment: `
float ring(vec2 p, float r, float width) {
  return smoothstep(width, 0.0, abs(length(p) - r));
}

mat2 rotate2d(float a) {
  float s = sin(a);
  float c = cos(a);
  return mat2(c, -s, s, c);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = (fragCoord * 2.0 - iResolution.xy) / iResolution.y;
  float radius = fvParamA.x;
  float spin = fvParamA.y;
  float split = fvParamA.z;
  float pulse = fvParamA.w;
  float t = iTime * (0.35 + spin * 1.8);

  vec2 left = uv + vec2(0.36 + split * 0.34, 0.0);
  vec2 right = uv - vec2(0.36 + split * 0.34, 0.0);
  left = rotate2d(t) * left;
  right = rotate2d(-t * 0.82) * right;

  float beat = 0.06 * sin(iTime * (2.0 + pulse * 6.0));
  float rings = 0.0;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float r = 0.14 + radius * 0.22 + fi * 0.095 + beat;
    rings += ring(left, r, 0.014 + fvMotion.y * 0.018);
    rings += ring(right, r * (0.82 + fvMotion.x * 0.28), 0.012 + fvMotion.z * 0.024);
  }

  float center = ring(uv, 0.22 + fvGestures.x * 0.18, 0.016 + fvMotion.w * 0.018);
  vec3 cyan = vec3(0.24, 1.0, 0.78);
  vec3 gold = vec3(1.0, 0.78, 0.24);
  vec3 rose = vec3(1.0, 0.22, 0.54);
  vec3 color = rings * mix(cyan, gold, smoothstep(-0.8, 0.8, uv.x));
  color += center * rose * (0.65 + pulse);
  color *= smoothstep(1.6, 0.2, length(uv));
  color += vec3(0.015, 0.018, 0.03);
  color *= 0.35 + fvAmount * 0.75;
  fragColor = vec4(color, 1.0);
}
`
  },
  {
    id: "signalBloom",
    label: "Signal Bloom",
    detail: "Procedural plasma pushed by landmark confidence",
    parameters: [
      { id: "scale", label: "Scale", min: 0, max: 1, defaultValue: 0.5, motionDefault: "handOpen" },
      { id: "react", label: "React", min: 0, max: 1, defaultValue: 0.64, motionDefault: "confidence" },
      { id: "flare", label: "Flare", min: 0, max: 1, defaultValue: 0.36, motionDefault: "faceCover" },
      { id: "drift", label: "Drift", min: 0, max: 1, defaultValue: 0.42, motionDefault: "noseY" },
      { id: "contrast", label: "Contrast", min: 0, max: 1, defaultValue: 0.7, motionDefault: "pinch" }
    ],
    fragment: `
float blob(vec2 p, vec2 c, float r) {
  return r / max(0.018, dot(p - c, p - c));
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = (fragCoord * 2.0 - iResolution.xy) / iResolution.y;
  float scale = fvParamA.x;
  float react = fvParamA.y;
  float flare = fvParamA.z;
  float drift = fvParamA.w;
  float contrast = fvParamB.x;
  float t = iTime * (0.18 + drift * 1.15);
  float field = 0.0;

  for (int i = 0; i < 9; i++) {
    float fi = float(i);
    vec2 c = vec2(
      sin(t * (0.72 + fi * 0.09) + fi * 1.7),
      cos(t * (0.62 + fi * 0.11) + fi * 1.31)
    );
    c *= 0.18 + scale * 0.62;
    c.x += (fvPose.x - 0.5) * 0.5;
    c.y += (fvPose.y - 0.5) * 0.35;
    field += blob(uv, c, 0.018 + react * 0.038 + fi * 0.002);
  }

  float light = smoothstep(0.45, 1.9 + contrast * 3.2, field);
  vec3 low = vec3(0.02, 0.05, 0.08);
  vec3 high = vec3(0.2 + flare * 0.55, 0.95, 0.74 + fvMotion.x * 0.18);
  vec3 accent = vec3(1.0, 0.52, 0.24) * smoothstep(2.2, 6.8, field) * (0.25 + fvGestures.y);
  vec3 color = mix(low, high, light) + accent;
  color *= smoothstep(1.8, 0.16, length(uv));
  color *= 0.35 + fvAmount * 0.75;
  fragColor = vec4(color, 1.0);
}
`
  }
];

export const getShaderScene = (sceneId: string) => shaderScenes.find((scene) => scene.id === sceneId) ?? shaderScenes[0];

export const getShaderSceneFromLibrary = (sceneId: string, library: ShaderScene[]) =>
  library.find((scene) => scene.id === sceneId) ?? library[0] ?? shaderScenes[0];

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);

export const normalizeShadertoyFragment = (source: string) =>
  source
    .replace(/^\s*#version\s+.+$/gm, "")
    .replace(/^\s*precision\s+(?:lowp|mediump|highp)\s+(?:float|int)\s*;\s*$/gm, "")
    .replace(
      /^\s*uniform\s+(?:float|int|vec[234]|sampler2D|samplerCube)\s+i(?:Resolution|Time|Frame|Mouse|ChannelTime|ChannelResolution|Date|SampleRate|Channel[0-3])\s*(?:\[[^\]]+\])?\s*;\s*$/gm,
      ""
    )
    .trim();

export const extractShadertoyId = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const directId = /^[a-zA-Z0-9]{6,12}$/.test(trimmed) ? trimmed : "";
  if (directId) return directId;

  try {
    const url = new URL(trimmed);
    const viewMatch = url.pathname.match(/\/view\/([a-zA-Z0-9]+)/);
    if (viewMatch?.[1]) return viewMatch[1];
    const id = url.searchParams.get("id") ?? url.searchParams.get("shader");
    return id && /^[a-zA-Z0-9]{6,12}$/.test(id) ? id : "";
  } catch {
    return "";
  }
};

export const createImportedShaderScene = ({
  author,
  fragment,
  label,
  license,
  parameters,
  source = "shadertoy",
  sourceUrl
}: ImportedShaderInput): ShaderScene => {
  const normalized = normalizeShadertoyFragment(fragment);
  const fallbackLabel = label.trim() || "Imported Shader";
  const id = `imported-${slugify(fallbackLabel) || "shader"}-${Date.now().toString(36)}`;
  const detail =
    source === "file"
      ? `Imported from ${sourceUrl?.trim() || "shader file"}`
      : source === "raw"
        ? `Imported from ${sourceUrl?.trim() || "raw GLSL URL"}`
        : source === "preset"
          ? `Imported from ${sourceUrl?.trim() || "INFINIGHTCapture preset"}`
          : author?.trim()
            ? `Imported from ${author.trim()}`
            : "Imported Shadertoy-style scene";

  return {
    id,
    label: fallbackLabel,
    detail,
    author: author?.trim() || undefined,
    fragment: normalized,
    imported: true,
    license: license?.trim() || undefined,
    source,
    sourceUrl: sourceUrl?.trim() || undefined,
    parameters: parameters?.length ? parameters : [
      { id: "mocapA", label: "Mocap A", min: 0, max: 1, defaultValue: 0.5, motionDefault: "handOpen" },
      { id: "mocapB", label: "Mocap B", min: 0, max: 1, defaultValue: 0.5, motionDefault: "pinch" },
      { id: "mocapC", label: "Mocap C", min: 0, max: 1, defaultValue: 0.5, motionDefault: "velocity" },
      { id: "mocapD", label: "Mocap D", min: 0, max: 1, defaultValue: 0.5, motionDefault: "noseX" }
    ]
  };
};

export const isStoredShaderScene = (value: unknown): value is StoredShaderScene => {
  if (!value || typeof value !== "object") return false;
  const scene = value as Partial<StoredShaderScene>;
  return (
    typeof scene.id === "string" &&
    typeof scene.label === "string" &&
    typeof scene.detail === "string" &&
    typeof scene.fragment === "string" &&
    Array.isArray(scene.parameters)
  );
};

export const createDefaultShaderSettings = (scene: ShaderScene): Record<string, ShaderParameterSettings> =>
  Object.fromEntries(
    scene.parameters.map((parameter) => [
      parameter.id,
      {
        value: parameter.defaultValue,
        source: parameter.motionDefault,
        depth: parameter.motionDefault === "manual" ? 0 : 0.82
      }
    ])
  );

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

const average = (values: number[]) => (values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0);

const pointOrCenter = (point: Vec2 | undefined): Vec2 => point ?? { x: 0.5, y: 0.5 };

const getMotionUniforms = (motion: MotionFrame | null): MotionUniforms => {
  if (!motion) {
    return {
      motion: [0, 0, 0, 0],
      pose: [0.5, 0.5, 0, 0],
      gestures: [0, 0, 0, 1]
    };
  }

  const openness = clamp(average(motion.hands.map((hand) => hand.openness)));
  const pinch = clamp(Math.max(0, ...motion.hands.map((hand) => hand.pinch)));
  const velocity = clamp(Math.max(0, ...motion.hands.map((hand) => hand.velocity)));
  const nose = pointOrCenter(motion.pose?.nose);
  const shoulderSpan =
    motion.pose?.leftShoulder && motion.pose.rightShoulder
      ? Math.abs(motion.pose.leftShoulder.x - motion.pose.rightShoulder.x)
      : 0;

  return {
    motion: [openness, pinch, velocity, clamp(motion.confidence)],
    pose: [nose.x, nose.y, clamp(shoulderSpan * 4), clamp(motion.landmarkCount / 100)],
    gestures: [
      motion.gestures.handsUp ? 1 : 0,
      motion.gestures.faceCover ? 1 : 0,
      motion.gestures.openPalm ? 1 : 0,
      motion.gestures.fastMotion ? 1 : 0
    ]
  };
};

export const getMotionSignalValue = (source: ShaderMotionSource, motion: MotionFrame | null) => {
  const uniforms = getMotionUniforms(motion);
  switch (source) {
    case "confidence":
      return uniforms.motion[3];
    case "handOpen":
      return uniforms.motion[0];
    case "pinch":
      return uniforms.motion[1];
    case "velocity":
      return uniforms.motion[2];
    case "handsUp":
      return uniforms.gestures[0];
    case "faceCover":
      return uniforms.gestures[1];
    case "openPalm":
      return uniforms.gestures[2];
    case "noseX":
      return uniforms.pose[0];
    case "noseY":
      return uniforms.pose[1];
    case "manual":
    default:
      return 0;
  }
};

export const resolveShaderParameterValues = (
  scene: ShaderScene,
  settings: Record<string, ShaderParameterSettings>,
  motion: MotionFrame | null
) =>
  scene.parameters.map((parameter) => {
    const setting = settings[parameter.id] ?? {
      value: parameter.defaultValue,
      source: parameter.motionDefault,
      depth: 0
    };
    if (setting.source === "manual") {
      return setting.value;
    }

    const signal = getMotionSignalValue(setting.source, motion);
    const mappedValue = parameter.min + signal * (parameter.max - parameter.min);
    return clamp(setting.value * (1 - setting.depth) + mappedValue * setting.depth, parameter.min, parameter.max);
  });

export class MotionShaderPlayer {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGLRenderingContext;
  private buffer: WebGLBuffer | null = null;
  private frame = 0;
  private lastError = "";
  private program: WebGLProgram | null = null;
  private sceneId = "";
  private startedAt = performance.now();

  constructor() {
    this.canvas = document.createElement("canvas");
    const gl = this.canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      depth: false,
      preserveDrawingBuffer: true,
      stencil: false
    });
    if (!gl) {
      throw new Error("WebGL is not available for the shader player.");
    }
    this.gl = gl;
  }

  renderToCanvas(
    target: CanvasRenderingContext2D,
    scene: ShaderScene,
    motion: MotionFrame | null,
    parameters: number[],
    amount: number
  ) {
    const width = target.canvas.width;
    const height = target.canvas.height;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }

    if (this.sceneId !== scene.id || !this.program) {
      this.compileScene(scene);
    }
    if (!this.program) return false;

    const gl = this.gl;
    const uniforms = getMotionUniforms(motion);
    const shaderParams = Array.from({ length: 32 }, (_, index) => parameters[index] ?? 0);
    const paramA = shaderParams.slice(0, 4) as [number, number, number, number];
    const paramB = shaderParams.slice(4, 8) as [number, number, number, number];
    const paramC = shaderParams.slice(8, 12) as [number, number, number, number];
    const paramD = shaderParams.slice(12, 16) as [number, number, number, number];
    const paramE = shaderParams.slice(16, 20) as [number, number, number, number];
    const paramF = shaderParams.slice(20, 24) as [number, number, number, number];
    const paramG = shaderParams.slice(24, 28) as [number, number, number, number];
    const paramH = shaderParams.slice(28, 32) as [number, number, number, number];

    gl.viewport(0, 0, width, height);
    gl.useProgram(this.program);
    gl.uniform3f(gl.getUniformLocation(this.program, "iResolution"), width, height, 1);
    gl.uniform1f(gl.getUniformLocation(this.program, "iTime"), (performance.now() - this.startedAt) / 1000);
    gl.uniform1i(gl.getUniformLocation(this.program, "iFrame"), this.frame);
    gl.uniform4f(
      gl.getUniformLocation(this.program, "iMouse"),
      uniforms.pose[0] * width,
      (1 - uniforms.pose[1]) * height,
      uniforms.motion[1] * width,
      uniforms.gestures[0] * height
    );
    gl.uniform4f(gl.getUniformLocation(this.program, "fvMotion"), uniforms.motion[0], uniforms.motion[1], uniforms.motion[2], uniforms.motion[3]);
    gl.uniform4f(gl.getUniformLocation(this.program, "fvPose"), uniforms.pose[0], uniforms.pose[1], uniforms.pose[2], uniforms.pose[3]);
    gl.uniform4f(
      gl.getUniformLocation(this.program, "fvGestures"),
      uniforms.gestures[0],
      uniforms.gestures[1],
      uniforms.gestures[2],
      uniforms.gestures[3]
    );
    gl.uniform4f(gl.getUniformLocation(this.program, "fvParamA"), paramA[0], paramA[1], paramA[2], paramA[3]);
    gl.uniform4f(gl.getUniformLocation(this.program, "fvParamB"), paramB[0], paramB[1], paramB[2], paramB[3]);
    gl.uniform4f(gl.getUniformLocation(this.program, "fvParamC"), paramC[0], paramC[1], paramC[2], paramC[3]);
    gl.uniform4f(gl.getUniformLocation(this.program, "fvParamD"), paramD[0], paramD[1], paramD[2], paramD[3]);
    gl.uniform4f(gl.getUniformLocation(this.program, "fvParamE"), paramE[0], paramE[1], paramE[2], paramE[3]);
    gl.uniform4f(gl.getUniformLocation(this.program, "fvParamF"), paramF[0], paramF[1], paramF[2], paramF[3]);
    gl.uniform4f(gl.getUniformLocation(this.program, "fvParamG"), paramG[0], paramG[1], paramG[2], paramG[3]);
    gl.uniform4f(gl.getUniformLocation(this.program, "fvParamH"), paramH[0], paramH[1], paramH[2], paramH[3]);
    gl.uniform1fv(gl.getUniformLocation(this.program, "fvParams[0]"), new Float32Array(shaderParams));
    gl.uniform1f(gl.getUniformLocation(this.program, "fvAmount"), amount);

    const position = gl.getAttribLocation(this.program, "aPosition");
    if (!this.buffer) {
      this.buffer = gl.createBuffer();
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.frame += 1;

    target.drawImage(this.canvas, 0, 0, width, height);
    return true;
  }

  getError() {
    return this.lastError;
  }

  private compileScene(scene: ShaderScene) {
    const gl = this.gl;
    const fragmentSource = `${shaderPrelude}\nuniform float fvAmount;\n${scene.fragment}\nvoid main() { mainImage(gl_FragColor, gl_FragCoord.xy); }\n`;
    const vertex = this.createShader(gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = this.createShader(gl.FRAGMENT_SHADER, fragmentSource);

    if (!vertex || !fragment) {
      this.program = null;
      return;
    }

    const program = gl.createProgram();
    if (!program) {
      this.program = null;
      return;
    }

    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      this.lastError = gl.getProgramInfoLog(program) ?? "Unable to link shader program.";
      console.warn(this.lastError);
      gl.deleteProgram(program);
      this.program = null;
      return;
    }

    this.sceneId = scene.id;
    this.lastError = "";
    this.program = program;
  }

  private createShader(type: number, source: string) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      this.lastError = gl.getShaderInfoLog(shader) ?? "Unable to compile shader.";
      console.warn(this.lastError);
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }
}
