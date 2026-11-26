// The GPU side of model.ts. One four-channel pass; every draw decodes
// uPassIndex into a step of the schedule (model.ts schedule()), and draws
// past it copy the result through. The state:
//   x, y  the estimate as a half and its remainder, so about 22 bits;
//   z     the first convolution's sum (relative to the estimate here), then
//         the ratio less 1; a separable second convolution's result;
//   w     a separable first convolution's rows (relative to the estimate),
//         or the second convolution's sum.
// Values that half floats store are kept small (differences, ratios less 1),
// and every read is an exact fetch: hardware filtering rounds to half floats
// on some GPUs, which would undo the estimate's split. The final draw leaves
// the change of luminance in x and the luminance in y for the inline.
//
// D3D11 (ANGLE) shapes this code: no arrays, loops with literal bounds.

import {
  BLUR_FLOOR,
  FIXED_DRAWS,
  LAMBDA_PER_UNIT,
  LUMA,
  MIN_SIGMA,
  OBS_FLOOR,
  RANGES,
  ROW_SLACK,
  TAPS_PER_DRAW,
  TV_EPSILON,
} from "./model";

/** A GLSL float literal that always carries a decimal point. */
export function glslLiteral(v: number): string {
  const s = v.toPrecision(10);
  if (/e/i.test(s)) {
    const [mantissa, exponent] = s.split(/e/i);
    const m = mantissa.includes(".") ? mantissa : `${mantissa}.0`;
    return `${m}e${Number(exponent)}`;
  }
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, ".0") : `${s}.0`;
}

const lit = glslLiteral;

export const STEP = { prep: 0, convolve: 1, multiply: 2, final: 3, copy: 4, zero: 5 } as const;
export const AXIS = { plane: 0, rows: 1, columns: 2 } as const;

/** A disc's rows at most: the largest radius at full size, its edge's half
 *  texel, both sides and the centre. */
export const MAX_ROWS = 2 * Math.floor(RANGES.focusRadius.max + 0.5) + 1;
/** The most texels of a disc's row that a texel of weight below 1 can
 *  reach past the full ones, generously: the rim is about sqrt(2R) wide at
 *  the poles. */
export const MAX_RIM = Math.ceil(Math.sqrt(2 * (RANGES.focusRadius.max + 0.5))) + 2;

const LUMA_GLSL = `vec3(${LUMA.map(lit).join(", ")})`;

export const PASS_HELPERS = `
// Every int below is highp: the programs' ints are mediump, 16 bits on a
// driver that honours it (Mesa), and tap indices pass that.
precision highp int;

ivec2 brSize() { return ivec2(floor(1.0 / uTexel + 0.5)); }
// The render's size over the source's: sizes in source pixels, never above
// 1, which the draw count is sized for.
float brScale() {
  vec2 size = vec2(brSize());
  float src = max(uSourceSize.x, uSourceSize.y);
  return src > 0.0 ? min(max(size.x, size.y) / src, 1.0) : 1.0;
}
vec4 brAt(ivec2 t) { return fetchPrev4(clamp(t, ivec2(0), brSize() - 1)); }
float brObserved(vec3 rgb) { return max(dot(rgb, ${LUMA_GLSL}), ${lit(OBS_FLOOR)}); }
// The estimate as a half and its remainder.
vec4 brSplit(float v) {
  float hi = unpackHalf2x16(packHalf2x16(vec2(v, 0.0))).x;
  return vec4(hi, v - hi, 0.0, 0.0);
}
float brErf(float x) {
  float a = abs(x);
  float t = 1.0 / (1.0 + 0.3275911 * a);
  float poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return sign(x) * (1.0 - poly * exp(-a * a));
}

int brKind() { return int(kind + 0.5); }

// Motion: the streak's major axis, its minor offset per step, its half
// extent along the major axis and the steps either side of the centre.
void brMotionShape(float s, out bool xMajor, out float slope, out float e, out int n) {
  float theta = radians(streakAngle);
  float ux = cos(theta);
  float uy = -sin(theta);
  xMajor = abs(ux) >= abs(uy);
  float major = xMajor ? ux : uy;
  slope = (xMajor ? uy : ux) / major;
  e = streakLength * s * 0.5 * abs(major);
  n = int(ceil(e + 0.5)) - 1;
}

int brDiscRow(float outer, int dy) {
  float fy = float(dy);
  return int(floor(sqrt(max(outer * outer - fy * fy, 0.0)) + ${lit(ROW_SLACK)}));
}
int brDiscTaps(float outer) {
  int rows = int(floor(outer));
  int total = 0;
  for (int r = 0; r < ${MAX_ROWS}; r++) {
    if (r > 2 * rows) break;
    total += 2 * brDiscRow(outer, r - rows) + 1;
  }
  return total;
}
// The row and column of the disc's tap t0, and that row's half-width.
void brDiscStart(float outer, int t0, out int dy, out int dx, out int hw) {
  int rows = int(floor(outer));
  int before = 0;
  dy = -rows;
  hw = brDiscRow(outer, dy);
  for (int r = 0; r < ${MAX_ROWS}; r++) {
    if (before + 2 * hw + 1 > t0) break;
    before += 2 * hw + 1;
    dy += 1;
    hw = brDiscRow(outer, dy);
  }
  dx = t0 - before - hw;
}
float brDiscWeight(float outer, int dx, int dy) {
  return clamp(outer - length(vec2(float(dx), float(dy))), 0.0, 1.0);
}
// The disc's weights summed: a row's texels within outer - 1 weigh 1, the
// rim's by depth.
float brDiscWeightSum(float outer) {
  int rows = int(floor(outer));
  float inner = outer - 1.0;
  float total = 0.0;
  for (int r = 0; r < ${MAX_ROWS}; r++) {
    if (r > 2 * rows) break;
    int dy = r - rows;
    float fy = float(dy);
    int hw = brDiscRow(outer, dy);
    int full = inner * inner - fy * fy >= 0.0 ? min(int(floor(sqrt(inner * inner - fy * fy))), hw) : -1;
    if (full >= 0) total += float(2 * full + 1);
    for (int j = 0; j < ${MAX_RIM}; j++) {
      int dx = full + 1 + j;
      if (dx > hw) break;
      total += (dx == 0 ? 1.0 : 2.0) * brDiscWeight(outer, dx, dy);
    }
  }
  return total;
}

// The kernel at this render: whether it is separable, whether it blurs at
// all, and its taps (a separable kernel's along one axis).
void brKernel(out bool separable, out bool trivial, out int taps) {
  float s = brScale();
  int k = brKind();
  separable = k == 2;
  if (k == 0) {
    bool xMajor;
    float slope, e;
    int n;
    brMotionShape(s, xMajor, slope, e, n);
    trivial = e <= 0.5;
    taps = 2 * (2 * n + 1);
  } else if (k == 1) {
    float radius = focusRadius * s;
    trivial = radius < 0.5;
    taps = trivial ? 0 : brDiscTaps(radius + 0.5);
  } else {
    float sigma = gaussRadius * s;
    trivial = sigma < ${lit(MIN_SIGMA)};
    taps = 2 * int(ceil(3.0 * sigma)) + 1;
  }
}

// Which step this draw runs (STEP in glsl.ts), and for a convolution its
// role (1: the estimate blurred, 2: the ratio blurred back), axis, chunk and
// whether the chunk is the axis's last; the schedule's draw count.
void brPlan(out int stepKind, out int role, out int axis, out int chunk, out bool last, out int total) {
  bool separable, trivial;
  int taps;
  brKernel(separable, trivial, taps);
  int perAxis = (taps + ${TAPS_PER_DRAW - 1}) / ${TAPS_PER_DRAW};
  int chunks = separable ? 2 * perAxis : perAxis;
  int per = 2 * chunks + 1;
  int iters = trivial ? 0 : min(int(iterations + 0.5), max(uPassCount - ${FIXED_DRAWS}, 0) / per);
  total = ${FIXED_DRAWS} + iters * per;
  role = 0;
  axis = ${AXIS.plane};
  chunk = 0;
  last = false;
  ivec2 size = brSize();
  if (size.x < 8 || size.y < 8 || total > uPassCount) {
    stepKind = uPassIndex == 0 ? ${STEP.zero} : ${STEP.copy};
    total = 1;
    return;
  }
  int i = uPassIndex;
  if (i == 0) { stepKind = ${STEP.prep}; return; }
  i -= 1;
  if (i < iters * per) {
    int k = i - (i / per) * per;
    if (k == per - 1) { stepKind = ${STEP.multiply}; return; }
    stepKind = ${STEP.convolve};
    role = k < chunks ? 1 : 2;
    int kk = k - (role - 1) * chunks;
    if (separable) {
      axis = kk < perAxis ? ${AXIS.rows} : ${AXIS.columns};
      chunk = kk < perAxis ? kk : kk - perAxis;
    } else {
      chunk = kk;
    }
    last = chunk == perAxis - 1;
    return;
  }
  stepKind = i == iters * per ? ${STEP.final} : ${STEP.copy};
}

// Every draw of the schedule writes the whole frame; of the copies past it,
// only the first changes anything.
ivec4 brRegion() {
  int stepKind, role, axis, chunk, total;
  bool last;
  brPlan(stepKind, role, axis, chunk, last, total);
  if (stepKind == ${STEP.copy} && uPassIndex > total) return ivec4(0);
  return ivec4(0, 0, brSize());
}

// One draw's chunk of a convolution, added to what earlier chunks summed.
// Role 1 reads the estimate (plus, down the columns, the rows' result) less
// the estimate here; role 2 reads the ratio less 1 (down the columns, the
// rows' result). The last chunk normalizes, and role 1's turns the blurred
// estimate into the ratio less 1.
vec4 brConvolve(int role, int axis, int chunk, bool last, ivec2 p, vec4 t, float obs) {
  float s = brScale();
  int k = brKind();
  float estP = t.x + t.y;
  bool columns = axis == ${AXIS.columns};
  vec4 pick = role == 1 ? (columns ? vec4(1.0, 1.0, 0.0, 1.0) : vec4(1.0, 1.0, 0.0, 0.0)) : (columns ? vec4(0.0, 0.0, 0.0, 1.0) : vec4(0.0, 0.0, 1.0, 0.0));
  float less = role == 1 ? estP : 0.0;
  bool toW = role == 1 ? axis == ${AXIS.rows} : !columns;
  float acc = chunk == 0 ? 0.0 : (toW ? t.w : t.z);

  bool xMajor = true;
  float slope = 0.0, e = 0.0, outer = 0.0, gs = 0.0, weightSum = 1.0;
  int n = 0, taps = 0, dy = 0, dx = 0, hw = 0;
  int t0 = chunk * ${TAPS_PER_DRAW};
  if (k == 0) {
    brMotionShape(s, xMajor, slope, e, n);
    taps = 2 * (2 * n + 1);
    weightSum = 2.0 * e;
  } else if (k == 1) {
    outer = focusRadius * s + 0.5;
    taps = brDiscTaps(outer);
    brDiscStart(outer, t0, dy, dx, hw);
  } else {
    float sigma = gaussRadius * s;
    n = int(ceil(3.0 * sigma));
    taps = 2 * n + 1;
    gs = 1.0 / (sigma * ${lit(Math.SQRT2)});
    weightSum = brErf((float(n) + 0.5) * gs);
  }

  for (int i = 0; i < ${TAPS_PER_DRAW}; i++) {
    int tap = t0 + i;
    if (tap >= taps) break;
    ivec2 off;
    float w;
    if (k == 0) {
      int st = tap / 2;
      int side = tap - 2 * st;
      int along = st - n;
      float fa = float(along);
      float cover = clamp(min(fa + 0.5, e) - max(fa - 0.5, -e), 0.0, 1.0);
      float m = fa * slope;
      float b = floor(m);
      float f = m - b;
      int across = int(b) + side;
      w = cover * (side == 0 ? 1.0 - f : f);
      off = xMajor ? ivec2(along, across) : ivec2(across, along);
    } else if (k == 1) {
      off = ivec2(dx, dy);
      w = brDiscWeight(outer, dx, dy);
      dx += 1;
      if (dx > hw) {
        dy += 1;
        hw = brDiscRow(outer, dy);
        dx = -hw;
      }
    } else {
      int d = tap - n;
      float fd = float(d);
      w = 0.5 * (brErf((fd + 0.5) * gs) - brErf((fd - 0.5) * gs));
      off = columns ? ivec2(0, d) : ivec2(d, 0);
    }
    acc += w * (dot(brAt(p + off), pick) - less);
  }

  if (last) {
    if (k == 1) weightSum = brDiscWeightSum(outer);
    if (role == 1 && axis != ${AXIS.rows}) acc = obs / max(estP + acc / weightSum, ${lit(BLUR_FLOOR)}) - 1.0;
    else acc /= weightSum;
  }
  return toW ? vec4(t.xyz, acc) : vec4(t.xy, acc, t.w);
}

float brE(ivec2 q) {
  vec4 v = brAt(q);
  return v.x + v.y;
}
vec2 brUnit(float gx, float gy) { return vec2(gx, gy) / sqrt(gx * gx + gy * gy + ${lit(TV_EPSILON * TV_EPSILON)}); }

// The estimate times the ratio blurred back, over total variation's
// divergence term: forward differences for the gradient, backward ones for
// the divergence.
vec4 brMultiply(ivec2 p, vec4 t) {
  float est = t.x + t.y;
  float kr = brKind() == 2 ? t.z : t.w;
  float lambda = suppression * ${lit(LAMBDA_PER_UNIT)};
  float denom = 1.0;
  if (lambda > 0.0) {
    float right = brE(p + ivec2(1, 0));
    float down = brE(p + ivec2(0, 1));
    float left = brE(p + ivec2(-1, 0));
    float leftDown = brE(p + ivec2(-1, 1));
    float rightUp = brE(p + ivec2(1, -1));
    float up = brE(p + ivec2(0, -1));
    vec2 g = brUnit(right - est, down - est);
    float gxLeft = brUnit(est - left, leftDown - left).x;
    float gyUp = brUnit(rightUp - up, est - up).y;
    denom = 1.0 - lambda * (g.x - gxLeft + g.y - gyUp);
  }
  return brSplit(max(est * (1.0 + kr) / denom, 0.0));
}

vec4 brDraw(int stepKind, int role, int axis, int chunk, bool last, ivec2 p, vec4 t) {
  bool needsObserved = stepKind == ${STEP.prep} || stepKind == ${STEP.final} || (stepKind == ${STEP.convolve} && role == 1 && axis != ${AXIS.rows} && last);
  float obs = needsObserved ? brObserved(fetchInput(p)) : 0.0;
  if (stepKind == ${STEP.prep}) return brSplit(obs);
  if (stepKind == ${STEP.final}) return vec4(t.x + t.y - obs, obs, 0.0, 0.0);
  if (stepKind == ${STEP.multiply}) return brMultiply(p, t);
  return brConvolve(role, axis, chunk, last, p, t, obs);
}
`;

export const PASS_GLSL = `
int brStep, brRole, brAxis, brChunk, brTotal;
bool brLast;
brPlan(brStep, brRole, brAxis, brChunk, brLast, brTotal);
if (brStep == ${STEP.zero}) c = vec4(0.0);
else if (brStep != ${STEP.copy}) c = brDraw(brStep, brRole, brAxis, brChunk, brLast, ivec2(gl_FragCoord.xy), c);
`;

export const REGION_GLSL = "return brRegion();";

/** The inline: the pixel's linear RGB scaled so its luminance moves by the
 *  amount's share of the change; a pixel too dark to scale is lifted evenly
 *  (model.ts applyDelta). */
export const INLINE_GLSL = `
if (draws > 0) {
  float brDelta = stageResult.x * amount * 0.01;
  float brY = dot(lin, ${LUMA_GLSL});
  if (brY > ${lit(OBS_FLOOR)}) lin *= max(brY + brDelta, 0.0) / brY;
  else lin += vec3(brDelta);
}
`;
