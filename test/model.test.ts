import { describe, expect, it } from "vitest";
import {
  DEFAULT_PARAMS,
  MAX_DRAWS,
  TAPS_PER_DRAW,
  blurLuminance,
  deblurImage,
  deblurLuminance,
  drawCount,
  isActive,
  kernelAt,
  luminance,
  schedule,
  type Image,
  type Params,
} from "../src/model";

const on = (p: Partial<Params>): Params => ({ ...DEFAULT_PARAMS, on: true, ...p });

/** Sum of a kernel's weights, as the pass normalizes them. */
function weights(p: Params, scale = 1): number {
  const k = kernelAt(p, scale);
  if (!k) return 1;
  return k.taps.reduce((s, t) => s + t.w, 0) / k.weightSum;
}

/** A sharp scene: bars, a disc and soft texture, linear 0.02 to 0.8. */
function sharpScene(width: number, height: number): Float64Array {
  const out = new Float64Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let v = 0.08 + 0.3 * (x / width);
      if (x % 12 < 4 && y > height * 0.15 && y < height * 0.5) v = 0.7;
      if ((x - width * 0.7) ** 2 + (y - height * 0.7) ** 2 < (height * 0.15) ** 2) v = 0.03;
      if (y > height * 0.75 && x < width * 0.4 && (x + y) % 6 < 2) v += 0.2;
      out[y * width + x] = v;
    }
  }
  return out;
}

const rmse = (a: Float64Array, b: Float64Array, width: number, height: number, margin: number) => {
  let s = 0;
  let n = 0;
  for (let y = margin; y < height - margin; y++) {
    for (let x = margin; x < width - margin; x++) {
      s += (a[y * width + x] - b[y * width + x]) ** 2;
      n++;
    }
  }
  return Math.sqrt(s / n);
};

describe("kernels", () => {
  it("sum to 1 for every blur, angle and size", () => {
    for (const angle of [0, 17, 45, 63.5, 90, -30, -90]) {
      for (const length of [1.2, 3, 10.5, 37, 100]) expect(weights(on({ kind: "motion", streakLength: length, streakAngle: angle }))).toBeCloseTo(1, 12);
    }
    for (const focusRadius of [0.6, 1, 2.3, 7.5, 15]) expect(weights(on({ kind: "focus", focusRadius }))).toBeCloseTo(1, 12);
    for (const gaussRadius of [0.15, 0.5, 2, 9.7, 15]) expect(weights(on({ kind: "gaussian", gaussRadius }))).toBeCloseTo(1, 6);
  });

  it("lays a horizontal streak along the row, its ends fractional", () => {
    const k = kernelAt(on({ kind: "motion", streakLength: 5, streakAngle: 0 }), 1);
    expect(k?.separable).toBe(false);
    const placed = k!.taps.filter((t) => t.w > 0);
    expect(placed.every((t) => t.dy === 0)).toBe(true);
    expect(placed.map((t) => t.dx).sort((a, b) => a - b)).toEqual([-2, -1, 0, 1, 2]);
    expect(k!.weightSum).toBeCloseTo(5, 12);
  });

  it("turns the streak counter-clockwise as the angle grows, image rows running down", () => {
    const k = kernelAt(on({ kind: "motion", streakLength: 9, streakAngle: 45 }), 1)!;
    const placed = k.taps.filter((t) => t.w > 1e-9);
    // Up and to the right: x and row move opposite ways.
    expect(placed.every((t) => t.dx === 0 || Math.sign(t.dx) === -Math.sign(t.dy))).toBe(true);
    const vertical = kernelAt(on({ kind: "motion", streakLength: 7, streakAngle: 90 }), 1)!;
    expect(vertical.taps.filter((t) => t.w > 1e-9).every((t) => t.dx === 0)).toBe(true);
  });

  it("is a soft-edged disc for focus blur", () => {
    const k = kernelAt(on({ kind: "focus", focusRadius: 3 }), 1)!;
    const at = (dx: number, dy: number) => k.taps.find((t) => t.dx === dx && t.dy === dy)?.w ?? 0;
    expect(at(0, 0)).toBe(1);
    expect(at(3, 0)).toBeCloseTo(0.5, 12);
    expect(at(2, 2)).toBeCloseTo(3.5 - Math.hypot(2, 2), 12);
    expect(at(4, 0)).toBe(0);
  });

  it("is separable for Gaussian blur", () => {
    const k = kernelAt(on({ kind: "gaussian", gaussRadius: 2 }), 1)!;
    expect(k.separable).toBe(true);
    expect(k.taps.length).toBe(2 * 6 + 1);
  });

  it("scales with the render, and is trivial below a pixel", () => {
    expect(kernelAt(on({ kind: "motion", streakLength: 20 }), 0.5)!.weightSum).toBeCloseTo(10, 12);
    expect(kernelAt(on({ kind: "motion", streakLength: 0.9 }), 1)).toBeNull();
    expect(kernelAt(on({ kind: "motion", streakLength: 20 }), 0.04)).toBeNull();
    expect(kernelAt(on({ kind: "focus", focusRadius: 0.4 }), 1)).toBeNull();
    expect(kernelAt(on({ kind: "gaussian", gaussRadius: 0.05 }), 1)).toBeNull();
  });
});

describe("schedule", () => {
  it("is a prep, the iterations and a final draw", () => {
    const p = on({ kind: "motion", streakLength: 10, iterations: 20 });
    const s = schedule(p, 1, MAX_DRAWS);
    const taps = kernelAt(p, 1)!.taps.length;
    expect(s.chunks).toBe(Math.ceil(taps / TAPS_PER_DRAW));
    expect(s.perIteration).toBe(2 * s.chunks + 1);
    expect(s.iterations).toBe(20);
    expect(s.total).toBe(2 + 20 * s.perIteration);
  });

  it("splits a Gaussian into rows then columns", () => {
    const s = schedule(on({ kind: "gaussian", gaussRadius: 15 }), 1, MAX_DRAWS);
    expect(s.chunks).toBe(2 * Math.ceil(91 / TAPS_PER_DRAW));
  });

  it("drops the iterations that don't fit the draws it has", () => {
    const p = on({ kind: "focus", focusRadius: 15, iterations: 100 });
    const s = schedule(p, 1, drawCount(p));
    expect(drawCount(p)).toBe(MAX_DRAWS);
    expect(s.total).toBeLessThanOrEqual(MAX_DRAWS);
    expect(s.iterations).toBe(Math.floor((MAX_DRAWS - 2) / s.perIteration));
    // A smaller render needs fewer draws an iteration, so all of them fit.
    expect(schedule(p, 0.25, drawCount(p)).iterations).toBe(100);
  });

  it("draws nothing while off, at no amount, or for a trivial blur", () => {
    expect(drawCount(DEFAULT_PARAMS)).toBe(0);
    expect(drawCount(on({ amount: 0 }))).toBe(0);
    expect(drawCount(on({ kind: "motion", streakLength: 0.5 }))).toBe(0);
    expect(isActive(on({}))).toBe(true);
    expect(drawCount(on({}))).toBeGreaterThan(2);
  });

  it("runs no iterations where the render shrinks the blur to nothing", () => {
    const p = on({ kind: "motion", streakLength: 10 });
    expect(schedule(p, 0.05, drawCount(p))).toMatchObject({ iterations: 0, total: 2 });
  });
});

describe("deconvolution", () => {
  const W = 72;
  const H = 56;
  const sharp = sharpScene(W, H);

  for (const [name, p] of [
    ["motion 7 px at 30°", on({ kind: "motion", streakLength: 7, streakAngle: 30, suppression: 0 })],
    ["motion 9 px vertical", on({ kind: "motion", streakLength: 9, streakAngle: 90, suppression: 0 })],
    ["focus 3 px", on({ kind: "focus", focusRadius: 3, suppression: 0 })],
    ["gaussian 1.5 px", on({ kind: "gaussian", gaussRadius: 1.5, suppression: 0 })],
  ] as const) {
    it(`brings a ${name} blur back toward the sharp scene`, () => {
      const blurred = blurLuminance(sharp, W, H, p, 1);
      const before = rmse(blurred, sharp, W, H, 10);
      const after = rmse(deblurLuminance(blurred, W, H, p, { scale: 1 }), sharp, W, H, 10);
      expect(after).toBeLessThan(0.8 * before);
    });
  }

  it("does better with more iterations on a noiseless blur", () => {
    const p = on({ kind: "motion", streakLength: 8, streakAngle: 0, suppression: 0 });
    const blurred = blurLuminance(sharp, W, H, p, 1);
    const err = (iterations: number) => rmse(deblurLuminance(blurred, W, H, { ...p, iterations }, { scale: 1 }), sharp, W, H, 10);
    expect(err(40)).toBeLessThan(err(10));
  });

  it("keeps the estimate positive and its mean", () => {
    const p = on({ kind: "focus", focusRadius: 4, iterations: 60 });
    const blurred = blurLuminance(sharp, W, H, p, 1);
    const est = deblurLuminance(blurred, W, H, p, { scale: 1 });
    expect(Math.min(...est)).toBeGreaterThanOrEqual(0);
    const mean = (a: Float64Array) => a.reduce((s, v) => s + v, 0) / a.length;
    expect(mean(est)).toBeCloseTo(mean(blurred), 2);
  });

  it("smooths noise more with noise suppression", () => {
    const p = on({ kind: "gaussian", gaussRadius: 1.2, iterations: 40, suppression: 0 });
    const blurred = blurLuminance(sharp, W, H, p, 1);
    const noisy = blurred.map((v, i) => v * (1 + 0.04 * Math.sin(i * 12.9898) * Math.cos(i * 4.1414)));
    const tv = (a: Float64Array) => {
      let s = 0;
      for (let y = 0; y < H; y++) for (let x = 1; x < W; x++) s += Math.abs(a[y * W + x] - a[y * W + x - 1]);
      return s;
    };
    const plain = tv(deblurLuminance(noisy, W, H, p, { scale: 1 }));
    const suppressed = tv(deblurLuminance(noisy, W, H, { ...p, suppression: 100 }, { scale: 1 }));
    expect(suppressed).toBeLessThan(0.97 * plain);
  });
});

describe("deblurImage", () => {
  const W = 24;
  const H = 18;
  const img: Image = { width: W, height: H, data: new Float32Array(W * H * 3) };
  for (let k = 0; k < W * H; k++) {
    const v = 0.1 + 0.5 * ((k % W) > W / 2 ? 1 : 0);
    img.data.set([v * 1.2, v, v * 0.6], 3 * k);
  }

  it("leaves the photo alone at no amount", () => {
    const out = deblurImage(img, on({ kind: "focus", focusRadius: 2, amount: 0 }), { scale: 1 });
    expect([...out.data]).toEqual([...img.data]);
  });

  it("moves luminance and keeps each pixel's colour ratios", () => {
    const out = deblurImage(img, on({ kind: "focus", focusRadius: 2 }), { scale: 1 });
    let moved = 0;
    for (let k = 0; k < W * H; k++) {
      const [r, g, b] = out.data.subarray(3 * k, 3 * k + 3);
      const [r0, g0, b0] = img.data.subarray(3 * k, 3 * k + 3);
      moved = Math.max(moved, Math.abs(luminance(r, g, b) - luminance(r0, g0, b0)));
      expect(r / g).toBeCloseTo(r0 / g0, 4);
      expect(b / g).toBeCloseTo(b0 / g0, 4);
    }
    expect(moved).toBeGreaterThan(0.01);
  });
});
