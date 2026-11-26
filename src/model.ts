// The edit and the CPU model of the pass (glsl.ts): Richardson-Lucy
// deconvolution of linear luminance with a known blur, regularized by total
// variation (Dey et al., "Richardson-Lucy algorithm with total variation
// regularization for 3D confocal microscope deconvolution", 2006):
//
//   est <- est * K (x) (obs / K (x) est) / (1 - lambda * div(grad est / |grad est|))
//
// The kernels are symmetric, so K's adjoint is K. The model runs the GPU's
// schedule draw by draw, with the same chunks, channels and order, so a
// `store` hook can round each stored value as a half-float target does.

export type Kind = "motion" | "focus" | "gaussian";
export const KINDS: readonly Kind[] = ["motion", "focus", "gaussian"];

export interface Params {
  on: boolean;
  kind: Kind;
  /** The streak's length, in the full-size photo's pixels. */
  streakLength: number;
  /** The streak's direction in degrees, counter-clockwise from horizontal. */
  streakAngle: number;
  /** The blur disc's radius, in the full-size photo's pixels. */
  focusRadius: number;
  /** The Gaussian's standard deviation, in the full-size photo's pixels. */
  gaussRadius: number;
  iterations: number;
  /** The total-variation weight, 0 to 100. */
  suppression: number;
  /** How much of the change is applied, 0 to 100. */
  amount: number;
}

export type NumericKey = Exclude<keyof Params, "on" | "kind">;

export interface Range {
  min: number;
  max: number;
  step: number;
}

export const RANGES: Record<NumericKey, Range> = {
  streakLength: { min: 0, max: 100, step: 0.5 },
  streakAngle: { min: -90, max: 90, step: 0.5 },
  focusRadius: { min: 0, max: 15, step: 0.1 },
  gaussRadius: { min: 0, max: 15, step: 0.1 },
  iterations: { min: 1, max: 100, step: 1 },
  suppression: { min: 0, max: 100, step: 1 },
  amount: { min: 0, max: 100, step: 1 },
};

export const DEFAULT_PARAMS: Params = {
  on: false,
  kind: "motion",
  streakLength: 10,
  streakAngle: 0,
  focusRadius: 3,
  gaussRadius: 2,
  iterations: 20,
  suppression: 20,
  amount: 100,
};

/** The most draws a pass may make. */
export const MAX_DRAWS = 1024;
/** Kernel taps a draw reads, one exact fetch each. */
export const TAPS_PER_DRAW = 48;
/** The prep draw and the final one. */
export const FIXED_DRAWS = 2;
/** The least luminance deconvolved: RL needs positive values. */
export const OBS_FLOOR = 1e-4;
/** The least blurred estimate a ratio divides by. */
export const BLUR_FLOOR = 1e-6;
/** Total variation's floor on the gradient's length, in linear luminance. */
export const TV_EPSILON = 1e-3;
/** Total variation's weight for each unit of `suppression`. */
export const LAMBDA_PER_UNIT = 2e-4;
/** Below this sigma a Gaussian blur is no blur. */
export const MIN_SIGMA = 0.1;
/** Slack on a disc row's half-width, so float rounding never drops a tap. */
export const ROW_SLACK = 1e-4;
/** Rec.709 luminance. */
export const LUMA = [0.2126, 0.7152, 0.0722] as const;

export const luminance = (r: number, g: number, b: number): number => LUMA[0] * r + LUMA[1] * g + LUMA[2] * b;

export interface Tap {
  dx: number;
  dy: number;
  w: number;
}

/** A blur at a render's scale. A separable kernel's taps run along a row
 *  (dy 0) and are applied along rows, then columns. Weights are unnormalized:
 *  the pass divides by `weightSum` once a convolution is complete. */
export interface Kernel {
  separable: boolean;
  taps: Tap[];
  weightSum: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Abramowitz and Stegun 7.1.26, as the pass computes it. */
export function erf(x: number): number {
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return Math.sign(x) * (1 - poly * Math.exp(-a * a));
}

/** A streak through the centre: steps along its major axis, each step's
 *  weight its overlap with the streak, its minor offset lerped between two
 *  texels. Image rows run down, so the angle turns it counter-clockwise. */
function motionKernel(length: number, angle: number): Kernel | null {
  const theta = (angle * Math.PI) / 180;
  const ux = Math.cos(theta);
  const uy = -Math.sin(theta);
  const xMajor = Math.abs(ux) >= Math.abs(uy);
  const major = xMajor ? ux : uy;
  const slope = (xMajor ? uy : ux) / major;
  const e = (length / 2) * Math.abs(major);
  if (e <= 0.5) return null;
  const n = Math.ceil(e + 0.5) - 1;
  const taps: Tap[] = [];
  for (let k = -n; k <= n; k++) {
    const cover = clamp(Math.min(k + 0.5, e) - Math.max(k - 0.5, -e), 0, 1);
    const m = k * slope;
    const b = Math.floor(m);
    const f = m - b;
    for (const [off, w] of [
      [b, cover * (1 - f)],
      [b + 1, cover * f],
    ]) {
      taps.push(xMajor ? { dx: k, dy: off, w } : { dx: off, dy: k, w });
    }
  }
  return { separable: false, taps, weightSum: 2 * e };
}

/** A disc's row half-width: the farthest texel any of whose weight may show. */
export const discRow = (outer: number, dy: number): number => Math.floor(Math.sqrt(Math.max(outer * outer - dy * dy, 0)) + ROW_SLACK);

/** A disc with an anti-aliased edge: each texel weighs its centre's depth
 *  inside the radius plus a half, up to 1. */
function focusKernel(radius: number): Kernel | null {
  if (radius < 0.5) return null;
  const outer = radius + 0.5;
  const rows = Math.floor(outer);
  const taps: Tap[] = [];
  let weightSum = 0;
  for (let dy = -rows; dy <= rows; dy++) {
    const hw = discRow(outer, dy);
    for (let dx = -hw; dx <= hw; dx++) {
      const w = clamp(outer - Math.hypot(dx, dy), 0, 1);
      taps.push({ dx, dy, w });
      weightSum += w;
    }
  }
  return { separable: false, taps, weightSum };
}

/** A Gaussian's mass over each texel, out to three sigma. */
function gaussianKernel(sigma: number): Kernel | null {
  if (sigma < MIN_SIGMA) return null;
  const n = Math.ceil(3 * sigma);
  const s = 1 / (sigma * Math.SQRT2);
  const taps: Tap[] = [];
  for (let d = -n; d <= n; d++) taps.push({ dx: d, dy: 0, w: 0.5 * (erf((d + 0.5) * s) - erf((d - 0.5) * s)) });
  return { separable: true, taps, weightSum: erf((n + 0.5) * s) };
}

/** The edit's blur at `scale` render pixels to the photo's; null where it
 *  blurs nothing. */
export function kernelAt(p: Params, scale: number): Kernel | null {
  if (p.kind === "motion") return motionKernel(p.streakLength * scale, p.streakAngle);
  if (p.kind === "focus") return focusKernel(p.focusRadius * scale);
  return gaussianKernel(p.gaussRadius * scale);
}

export interface Schedule {
  /** Draws a convolution takes: its chunks, rows then columns when separable. */
  chunks: number;
  /** Two convolutions and the multiply. */
  perIteration: number;
  iterations: number;
  total: number;
}

/** The draws at `scale`, with `passCount` draws to spend. Iterations that
 *  don't fit are dropped. */
export function schedule(p: Params, scale: number, passCount: number): Schedule {
  const k = kernelAt(p, scale);
  if (!k) return { chunks: 0, perIteration: 0, iterations: 0, total: FIXED_DRAWS };
  const perAxis = Math.ceil(k.taps.length / TAPS_PER_DRAW);
  const chunks = k.separable ? 2 * perAxis : perAxis;
  const perIteration = 2 * chunks + 1;
  const iterations = Math.min(p.iterations, Math.floor(Math.max(passCount - FIXED_DRAWS, 0) / perIteration));
  return { chunks, perIteration, iterations, total: FIXED_DRAWS + iterations * perIteration };
}

/** Whether the edit changes anything on a full-size render. */
export const isActive = (p: Params): boolean => p.on && p.amount > 0 && kernelAt(p, 1) !== null;

/** The pass's draw count, sized for a full-size render: a smaller render
 *  needs fewer, and copies through the rest. */
export function drawCount(p: Params): number {
  return isActive(p) ? Math.min(schedule(p, 1, Infinity).total, MAX_DRAWS) : 0;
}

// ── The pass, draw by draw ───────────────────────────────────────────────────

/** Round to the nearest half float (normal range), as the pass splits the
 *  estimate into a half and its remainder. */
export function toHalf(v: number): number {
  if (v === 0 || !Number.isFinite(v)) return v;
  const e = Math.max(Math.floor(Math.log2(Math.abs(v))), -14);
  const q = 2 ** (e - 10);
  return Math.round(v / q) * q;
}

export interface PassOptions {
  /** Render pixels to the photo's, at most 1. */
  scale: number;
  /** The bag's draw count; the edit's own by default. */
  passCount?: number;
  /** What a stored value becomes (a half-float target's rounding). */
  store?: (v: number) => number;
}

interface State {
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  w: Float64Array;
}

const stateOf = (n: number): State => ({ x: new Float64Array(n), y: new Float64Array(n), z: new Float64Array(n), w: new Float64Array(n) });

/** The final draw's channels: x the change of luminance, y the luminance the
 *  pass deconvolved (floored). Both 0 change where the pass doesn't run. */
export function runPass(lum: Float64Array, width: number, height: number, p: Params, opts: PassOptions): { delta: Float64Array; observed: Float64Array } {
  const n = width * height;
  const passCount = opts.passCount ?? drawCount(p);
  const store = opts.store ?? ((v: number) => v);
  const observed = lum.map((v) => Math.max(v, OBS_FLOOR));
  const s = schedule(p, opts.scale, passCount);
  if (passCount === 0 || width < 8 || height < 8 || s.total > passCount) return { delta: new Float64Array(n), observed };
  const k = kernelAt(p, opts.scale);

  let cur = stateOf(n);
  const finish = (next: State) => {
    for (const ch of [next.x, next.y, next.z, next.w]) for (let i = 0; i < n; i++) ch[i] = store(ch[i]);
    cur = next;
  };
  const split = (next: State, i: number, est: number) => {
    const hi = toHalf(est);
    next.x[i] = hi;
    next.y[i] = est - hi;
  };
  const at = (x: number, y: number) => clamp(y, 0, height - 1) * width + clamp(x, 0, width - 1);

  // Prep: the observed luminance as the first estimate.
  {
    const next = stateOf(n);
    for (let i = 0; i < n; i++) split(next, i, observed[i]);
    finish(next);
  }

  type Axis = "2d" | "rows" | "columns";
  const convolve = (role: 1 | 2, axis: Axis, chunk: number, last: boolean, kernel: Kernel) => {
    const target: keyof State = role === 1 ? (axis === "rows" ? "w" : "z") : axis === "columns" ? "z" : "w";
    const next: State = { x: cur.x.slice(), y: cur.y.slice(), z: cur.z.slice(), w: cur.w.slice() };
    const from = chunk * TAPS_PER_DRAW;
    const to = Math.min(from + TAPS_PER_DRAW, kernel.taps.length);
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const i = py * width + px;
        const estP = cur.x[i] + cur.y[i];
        let acc = chunk === 0 ? 0 : cur[target][i];
        for (let t = from; t < to; t++) {
          const tap = kernel.taps[t];
          const q = axis === "columns" ? at(px, py + tap.dx) : at(px + tap.dx, py + tap.dy);
          const v = role === 1 ? (axis === "columns" ? cur.w[q] : 0) + cur.x[q] + cur.y[q] - estP : axis === "columns" ? cur.w[q] : cur.z[q];
          acc += tap.w * v;
        }
        if (last) {
          if (role === 1 && axis !== "rows") acc = observed[i] / Math.max(estP + acc / kernel.weightSum, BLUR_FLOOR) - 1;
          else acc /= kernel.weightSum;
        }
        next[target][i] = acc;
      }
    }
    finish(next);
  };

  const lambda = p.suppression * LAMBDA_PER_UNIT;
  const multiply = (separable: boolean) => {
    const next = stateOf(n);
    const e = (x: number, y: number) => {
      const q = at(x, y);
      return cur.x[q] + cur.y[q];
    };
    const unit = (gx: number, gy: number) => {
      const len = Math.sqrt(gx * gx + gy * gy + TV_EPSILON * TV_EPSILON);
      return [gx / len, gy / len];
    };
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const i = py * width + px;
        const est = cur.x[i] + cur.y[i];
        const kr = separable ? cur.z[i] : cur.w[i];
        let denom = 1;
        if (lambda > 0) {
          // The divergence of the unit gradient: forward differences for the
          // gradient, backward ones for the divergence.
          const c = e(px, py);
          const [gx, gy] = unit(e(px + 1, py) - c, e(px, py + 1) - c);
          const [gxLeft] = unit(c - e(px - 1, py), e(px - 1, py + 1) - e(px - 1, py));
          const [, gyUp] = unit(e(px + 1, py - 1) - e(px, py - 1), c - e(px, py - 1));
          denom = 1 - lambda * (gx - gxLeft + gy - gyUp);
        }
        split(next, i, Math.max((est * (1 + kr)) / denom, 0));
      }
    }
    finish(next);
  };

  if (k) {
    const perAxis = k.separable ? s.chunks / 2 : s.chunks;
    for (let it = 0; it < s.iterations; it++) {
      for (const role of [1, 2] as const) {
        if (k.separable) {
          for (let c = 0; c < perAxis; c++) convolve(role, "rows", c, c === perAxis - 1, k);
          for (let c = 0; c < perAxis; c++) convolve(role, "columns", c, c === perAxis - 1, k);
        } else {
          for (let c = 0; c < perAxis; c++) convolve(role, "2d", c, c === perAxis - 1, k);
        }
      }
      multiply(k.separable);
    }
  }

  // Final: the change, and the luminance it changes.
  const delta = new Float64Array(n);
  for (let i = 0; i < n; i++) delta[i] = store(cur.x[i] + cur.y[i] - observed[i]);
  return { delta, observed: observed.map(store) };
}

/** The deconvolved luminance (floored where the photo's is below the floor). */
export function deblurLuminance(lum: Float64Array, width: number, height: number, p: Params, opts: PassOptions): Float64Array {
  const { delta, observed } = runPass(lum, width, height, p, opts);
  return observed.map((v, i) => v + delta[i]);
}

/** Linear RGB, row-major from the top, 3 floats a pixel. */
export interface Image {
  width: number;
  height: number;
  data: Float32Array;
}

/** The inline: each pixel's linear RGB scaled so its luminance moves by the
 *  amount's share of the change; a pixel too dark to scale is lifted evenly. */
export function applyDelta(r: number, g: number, b: number, delta: number, amount: number): [number, number, number] {
  const d = delta * amount * 0.01;
  const y = luminance(r, g, b);
  if (y > OBS_FLOOR) {
    const f = Math.max(y + d, 0) / y;
    return [r * f, g * f, b * f];
  }
  return [r + d, g + d, b + d];
}

export function deblurImage(img: Image, p: Params, opts: PassOptions): Image {
  const n = img.width * img.height;
  const out = new Float32Array(img.data);
  if (!isActive(p) && opts.passCount === undefined) return { ...img, data: out };
  const lum = new Float64Array(n);
  for (let k = 0; k < n; k++) lum[k] = luminance(img.data[3 * k], img.data[3 * k + 1], img.data[3 * k + 2]);
  const { delta } = runPass(lum, img.width, img.height, p, opts);
  for (let k = 0; k < n; k++) out.set(applyDelta(img.data[3 * k], img.data[3 * k + 1], img.data[3 * k + 2], delta[k], p.amount), 3 * k);
  return { ...img, data: out };
}

/** `lum` blurred by the edit's kernel at `scale`, edges clamped: a test
 *  scene's blur, the same kernel the pass undoes. */
export function blurLuminance(lum: Float64Array, width: number, height: number, p: Params, scale: number): Float64Array {
  const k = kernelAt(p, scale);
  if (!k) return lum.slice();
  const at = (x: number, y: number) => clamp(y, 0, height - 1) * width + clamp(x, 0, width - 1);
  const pass = (src: Float64Array, col: boolean) => {
    const out = new Float64Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let acc = 0;
        for (const t of k.taps) acc += t.w * src[col ? at(x, y + t.dx) : at(x + t.dx, y + t.dy)];
        out[y * width + x] = acc / k.weightSum;
      }
    }
    return out;
  };
  return k.separable ? pass(pass(lum, false), true) : pass(lum, false);
}
