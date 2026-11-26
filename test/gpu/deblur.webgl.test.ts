// The stage on the real renderer. Run via `npm run test:gpu` (run.cjs copies
// this file into a SafeLight checkout and runs it under its headless
// Chromium + SwiftShader rig). What the CPU suite cannot check:
//  • the four-channel pass compiles with the host's namespacing, runs the
//    bag's draw count and copies past its schedule, and an idle edit leaves
//    the frame as it was;
//  • every blur (motion along and across the axes, focus, Gaussian, total
//    variation on and off) lands on the CPU model's result within what this
//    GPU's half floats cost;
//  • the streak turns the way the model turns it (rows running down);
//  • a render smaller than its source scales the blur.

import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS, applyDelta, blurLuminance, drawCount, luminance, runPass, type Params } from "@br/model";
import { bagPatch, resetPatch } from "@br/params";
import { deblurStage } from "@br/stage";
import { CURRENT_PROCESS_VERSION } from "@/catalog/process-version";
import { OPEN_PROBE, floatImage, identityParams, withRenderer, type FloatImage } from "@/rendering/webgl/webgl.test-support";

const W = 96;
const H = 72;
// The open probe hands `lin` out as the display value, so a capture as drawn
// is the linear image the stage works on (a "linear" capture would decode it
// once more).
const AS_DRAWN = { encoding: "perceptual", primaries: "rec709" } as const;

const full = (p: Partial<Params>): Params => ({ ...DEFAULT_PARAMS, on: true, ...p });

/** A deterministic hash in [0, 1). */
function hash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Linear: bars, a dark disc, a bright window, fine diagonal lines and
 *  per-pixel texture, tinted in two places, blurred by `blur`'s kernel. */
function scene(blur: Params, tinted = true): FloatImage {
  const lum = new Float64Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const v = y / H;
      let base = 0.05 + 0.35 * u;
      if (x % 11 < 4 && v > 0.12 && v < 0.45) base = 0.7;
      if ((u - 0.3) ** 2 + (v - 0.7) ** 2 < 0.02) base = 0.02;
      if (u > 0.62 && u < 0.85 && v > 0.55 && v < 0.85) base = 0.9;
      if (v > 0.85 && (x + 2 * y) % 7 < 2) base += 0.15;
      lum[y * W + x] = base * (1 + 0.1 * (hash(x, y) - 0.5));
    }
  }
  const blurred = blurLuminance(lum, W, H, blur, 1);
  return floatImage(W, H, (x, y) => {
    const u = x / W;
    const v = y / H;
    const t: [number, number, number] = !tinted ? [1, 1, 1] : (u - 0.8) ** 2 + (v - 0.25) ** 2 < 0.01 ? [1.25, 0.8, 0.5] : u < 0.15 && v > 0.6 ? [0.6, 0.85, 1.2] : [1, 1, 1];
    const l = blurred[y * W + x] / luminance(t[0], t[1], t[2]);
    return [l * t[0], l * t[1], l * t[2]];
  });
}

type Frames = Record<string, Float32Array>;

function render(image: FloatImage, bags: Record<string, Record<string, unknown>>, maxEdge?: number): { frames: Frames; width: number; height: number } {
  const frames: Frames = {};
  let width = 0;
  let height = 0;
  withRenderer({ stages: [deblurStage()], pipeline: OPEN_PROBE }, (renderer) => {
    if (maxEdge) renderer.setImage(image, maxEdge);
    else renderer.setImage(image);
    renderer.setParams(identityParams({ processVersion: CURRENT_PROCESS_VERSION }));
    for (const [name, bag] of Object.entries(bags)) {
      renderer.setContributedParams(bag);
      const frame = renderer.readFloatFrame("pre-output", Infinity, AS_DRAWN);
      if (!frame) throw new Error(`no frame for ${name}`);
      frames[name] = frame.data;
      width = frame.width;
      height = frame.height;
    }
  });
  return { frames, width, height };
}

type Rounding = "nearest" | "zero";

// A float written to a half-float target is rounded to nearest on
// SwiftShader and toward zero on D3D11 (see USM and RL Sharpening's spec).
function targetRounding(): Rounding {
  const gl = document.createElement("canvas").getContext("webgl2");
  if (!gl || !gl.getExtension("EXT_color_buffer_float")) throw new Error("no float render targets");
  const shader = (type: number, src: string) => {
    const s = gl.createShader(type);
    if (!s) throw new Error("no shader");
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const program = gl.createProgram();
  gl.attachShader(program, shader(gl.VERTEX_SHADER, "#version 300 es\nvoid main() { gl_Position = vec4(vec2(gl_VertexID & 1, gl_VertexID >> 1) * 4.0 - 1.0, 0.0, 1.0); }"));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, "#version 300 es\nprecision highp float;\nout vec4 o;\nvoid main() { o = vec4(1.0 + 0.75 * exp2(-10.0)); }"));
  gl.linkProgram(program);
  gl.useProgram(program);
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 1, 1, 0, gl.RGBA, gl.HALF_FLOAT, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer());
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.viewport(0, 0, 1, 1);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  const out = new Float32Array(4);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, out);
  if (out[0] === 1 + 2 ** -10) return "nearest";
  if (out[0] === 1) return "zero";
  throw new Error(`a half-float target stored ${out[0]}`);
}

function halfOf(v: number, rounding: Rounding): number {
  if (v === 0 || !Number.isFinite(v)) return v;
  const e = Math.max(Math.floor(Math.log2(Math.abs(v))), -14);
  const q = 2 ** (e - 10);
  return (rounding === "nearest" ? Math.round(v / q) : Math.trunc(v / q)) * q;
}

const ROUNDING = targetRounding();

/** The model's result for an input frame: the pass reads the frame through a
 *  half-float copy and stores half floats; the inline moves the frame's own
 *  values. */
function modelOf(input: Float32Array, width: number, height: number, p: Params, scale: number): Float32Array {
  const n = width * height;
  const lum = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const [r, g, b] = [0, 1, 2].map((c) => halfOf(input[4 * k + c], "nearest"));
    lum[k] = luminance(r, g, b);
  }
  const { delta } = runPass(lum, width, height, p, { scale, passCount: drawCount(p), store: (v) => halfOf(v, ROUNDING) });
  const out = new Float32Array(input);
  for (let k = 0; k < n; k++) out.set(applyDelta(input[4 * k], input[4 * k + 1], input[4 * k + 2], delta[k], p.amount), 4 * k);
  return out;
}

const lumAt = (f: Float32Array, k: number) => luminance(f[4 * k], f[4 * k + 1], f[4 * k + 2]);
const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

interface Stats {
  moved: number;
  p50: number;
  p99: number;
  max: number;
}

/** Luminance errors against the model, relative to the change it makes. */
function compare(input: Float32Array, got: Float32Array, want: Float32Array, n: number): Stats {
  const errors: number[] = [];
  const moved: number[] = [];
  for (let k = 0; k < n; k++) {
    errors.push(Math.abs(lumAt(got, k) - lumAt(want, k)));
    moved.push(Math.abs(lumAt(want, k) - lumAt(input, k)));
  }
  errors.sort((a, b) => a - b);
  moved.sort((a, b) => a - b);
  return { moved: quantile(moved, 0.99), p50: quantile(errors, 0.5), p99: quantile(errors, 0.99), max: errors[errors.length - 1] };
}

const report = (name: string, s: Stats) =>
  console.log(`${name}: moved p99 ${s.moved.toExponential(2)}; error p50 ${s.p50.toExponential(2)} p99 ${s.p99.toExponential(2)} max ${s.max.toExponential(2)}`);

const CASES: [string, Partial<Params>][] = [
  ["motion 9 px at 0°", { kind: "motion", streakLength: 9, streakAngle: 0 }],
  ["motion 12 px at 30°", { kind: "motion", streakLength: 12, streakAngle: 30 }],
  ["motion 15 px at -70°, no suppression", { kind: "motion", streakLength: 15, streakAngle: -70, suppression: 0 }],
  ["motion 60 px at 90°, 8 iterations", { kind: "motion", streakLength: 60, streakAngle: 90, iterations: 8 }],
  ["focus 3 px", { kind: "focus", focusRadius: 3 }],
  ["focus 6.4 px, suppression 60", { kind: "focus", focusRadius: 6.4, suppression: 60, iterations: 12 }],
  ["gaussian 1.5 px", { kind: "gaussian", gaussRadius: 1.5 }],
  ["gaussian 9 px, 6 iterations", { kind: "gaussian", gaussRadius: 9, iterations: 6 }],
  ["focus 4 px at amount 40", { kind: "focus", focusRadius: 4, amount: 40 }],
];

describe("Blur Reduction on the GPU", () => {
  for (const [name, edit] of CASES) {
    it(`matches the model: ${name}`, () => {
      const p = full(edit);
      const image = scene(p);
      const { frames, width, height } = render(image, { identity: resetPatch(), deblurred: bagPatch(p) });
      const n = width * height;
      const want = modelOf(frames.identity, width, height, p, 1);
      const s = compare(frames.identity, frames.deblurred, want, n);
      report(name, s);
      expect(s.moved).toBeGreaterThan(5e-3);
      expect(s.p99).toBeLessThan(0.02 * s.moved + 1e-4);
      expect(s.max).toBeLessThan(0.1 * s.moved + 1e-3);
    });
  }

  it("turns the streak the model's way", () => {
    const p = full({ kind: "motion", streakLength: 14, streakAngle: 35 });
    const { frames, width, height } = render(scene(p), { identity: resetPatch(), deblurred: bagPatch(p) });
    const n = width * height;
    const right = compare(frames.identity, frames.deblurred, modelOf(frames.identity, width, height, p, 1), n);
    const mirrored = compare(frames.identity, frames.deblurred, modelOf(frames.identity, width, height, { ...p, streakAngle: -35 }, 1), n);
    console.log(`orientation: p99 ${right.p99.toExponential(2)} against mirrored ${mirrored.p99.toExponential(2)}`);
    expect(right.p99 * 5).toBeLessThan(mirrored.p99);
  });

  it("keeps each pixel's colour", () => {
    const p = full({ kind: "focus", focusRadius: 3 });
    const { frames, width, height } = render(scene(p, true), { identity: resetPatch(), deblurred: bagPatch(p) });
    let worst = 0;
    let moved = 0;
    for (let k = 0; k < width * height; k++) {
      const [r0, g0, b0] = frames.identity.subarray(4 * k, 4 * k + 3);
      const [r, g, b] = frames.deblurred.subarray(4 * k, 4 * k + 3);
      if (g0 < 0.02 || g < 0.02) continue;
      moved = Math.max(moved, Math.abs(g / g0 - 1));
      worst = Math.max(worst, Math.abs(r / g - r0 / g0) / (r0 / g0), Math.abs(b / g - b0 / g0) / (b0 / g0));
    }
    console.log(`colour: moved ${moved.toExponential(2)}, ratio error ${worst.toExponential(2)}`);
    expect(moved).toBeGreaterThan(0.05);
    expect(worst).toBeLessThan(2e-3);
  });

  it("leaves the frame alone while off, or with nothing to undo", () => {
    const image = scene(full({ kind: "focus", focusRadius: 2 }));
    const { frames } = render(image, {
      identity: resetPatch(),
      off: bagPatch({ ...DEFAULT_PARAMS, focusRadius: 5 }),
      none: bagPatch(full({ kind: "motion", streakLength: 0.6 })),
    });
    expect([...frames.off]).toEqual([...frames.identity]);
    expect([...frames.none]).toEqual([...frames.identity]);
  });

  it("scales the blur with a render smaller than its source", () => {
    const p = full({ kind: "motion", streakLength: 16, streakAngle: 0, iterations: 10 });
    const image = scene(full({ kind: "motion", streakLength: 8, streakAngle: 0 }));
    const { frames, width, height } = render(image, { identity: resetPatch(), deblurred: bagPatch(p) }, 48);
    expect(width).toBe(48);
    const n = width * height;
    const s = compare(frames.identity, frames.deblurred, modelOf(frames.identity, width, height, p, width / W), n);
    report("motion 16 px at half size", s);
    expect(s.moved).toBeGreaterThan(5e-3);
    expect(s.p99).toBeLessThan(0.02 * s.moved + 1e-4);
  });
});
