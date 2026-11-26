//#region src/model.ts
var e = [
	"motion",
	"focus",
	"gaussian"
], t = {
	streakLength: {
		min: 0,
		max: 100,
		step: .5
	},
	streakAngle: {
		min: -90,
		max: 90,
		step: .5
	},
	focusRadius: {
		min: 0,
		max: 15,
		step: .1
	},
	gaussRadius: {
		min: 0,
		max: 15,
		step: .1
	},
	iterations: {
		min: 1,
		max: 100,
		step: 1
	},
	suppression: {
		min: 0,
		max: 100,
		step: 1
	},
	amount: {
		min: 0,
		max: 100,
		step: 1
	}
}, n = {
	on: !1,
	kind: "motion",
	streakLength: 10,
	streakAngle: 0,
	focusRadius: 3,
	gaussRadius: 2,
	iterations: 20,
	suppression: 20,
	amount: 100
}, r = 1024, i = 1e-4, a = 1e-6, o = .001, s = 2e-4, c = .1, l = 1e-4, u = [
	.2126,
	.7152,
	.0722
], d = (e, t, n) => Math.min(Math.max(e, t), n);
function f(e) {
	let t = Math.abs(e), n = 1 / (1 + .3275911 * t), r = n * (.254829592 + n * (-.284496736 + n * (1.421413741 + n * (-1.453152027 + n * 1.061405429))));
	return Math.sign(e) * (1 - r * Math.exp(-t * t));
}
function p(e, t) {
	let n = t * Math.PI / 180, r = Math.cos(n), i = -Math.sin(n), a = Math.abs(r) >= Math.abs(i), o = a ? r : i, s = (a ? i : r) / o, c = e / 2 * Math.abs(o);
	if (c <= .5) return null;
	let l = Math.ceil(c + .5) - 1, u = [];
	for (let e = -l; e <= l; e++) {
		let t = d(Math.min(e + .5, c) - Math.max(e - .5, -c), 0, 1), n = e * s, r = Math.floor(n), i = n - r;
		for (let [n, o] of [[r, t * (1 - i)], [r + 1, t * i]]) u.push(a ? {
			dx: e,
			dy: n,
			w: o
		} : {
			dx: n,
			dy: e,
			w: o
		});
	}
	return {
		separable: !1,
		taps: u,
		weightSum: 2 * c
	};
}
var m = (e, t) => Math.floor(Math.sqrt(Math.max(e * e - t * t, 0)) + l);
function ee(e) {
	if (e < .5) return null;
	let t = e + .5, n = Math.floor(t), r = [], i = 0;
	for (let e = -n; e <= n; e++) {
		let n = m(t, e);
		for (let a = -n; a <= n; a++) {
			let n = d(t - Math.hypot(a, e), 0, 1);
			r.push({
				dx: a,
				dy: e,
				w: n
			}), i += n;
		}
	}
	return {
		separable: !1,
		taps: r,
		weightSum: i
	};
}
function h(e) {
	if (e < .1) return null;
	let t = Math.ceil(3 * e), n = 1 / (e * Math.SQRT2), r = [];
	for (let e = -t; e <= t; e++) r.push({
		dx: e,
		dy: 0,
		w: .5 * (f((e + .5) * n) - f((e - .5) * n))
	});
	return {
		separable: !0,
		taps: r,
		weightSum: f((t + .5) * n)
	};
}
function g(e, t) {
	return e.kind === "motion" ? p(e.streakLength * t, e.streakAngle) : e.kind === "focus" ? ee(e.focusRadius * t) : h(e.gaussRadius * t);
}
function te(e, t, n) {
	let r = g(e, t);
	if (!r) return {
		chunks: 0,
		perIteration: 0,
		iterations: 0,
		total: 2
	};
	let i = Math.ceil(r.taps.length / 48), a = r.separable ? 2 * i : i, o = 2 * a + 1, s = Math.min(e.iterations, Math.floor(Math.max(n - 2, 0) / o));
	return {
		chunks: a,
		perIteration: o,
		iterations: s,
		total: 2 + s * o
	};
}
var ne = (e) => e.on && e.amount > 0 && g(e, 1) !== null;
function _(e) {
	return ne(e) ? Math.min(te(e, 1, Infinity).total, r) : 0;
}
//#endregion
//#region src/params.ts
var v = "blur-reduction", y = `${v}.deblur`, b = [
	"on",
	"kind",
	"streakLength",
	"streakAngle",
	"focusRadius",
	"gaussRadius",
	"iterations",
	"suppression",
	"amount"
], re = [
	"kind",
	"streakLength",
	"streakAngle",
	"focusRadius",
	"gaussRadius",
	"iterations",
	"suppression"
], x = "draws", S = {
	on: "Enabled",
	kind: "Blur",
	streakLength: "Length",
	streakAngle: "Angle",
	focusRadius: "Focus radius",
	gaussRadius: "Gaussian radius",
	iterations: "Iterations",
	suppression: "Noise suppression",
	amount: "Amount"
}, ie = {
	focusRadius: "Radius",
	gaussRadius: "Radius"
}, ae = /* @__PURE__ */ new Set([
	"iterations",
	"suppression",
	"amount"
]), C = (e) => `${y}.${e}`, w = (e) => typeof e == "number" && Number.isFinite(e);
function T(e, n) {
	let { min: r, max: i } = t[e], a = Math.min(Math.max(n, r), i);
	return ae.has(e) ? Math.round(a) : a;
}
function E(t) {
	let r = { ...n };
	for (let n of b) {
		let i = t[C(n)];
		if (n === "on") typeof i == "boolean" ? r.on = i : w(i) && (r.on = i >= .5);
		else if (w(i)) n === "kind" ? r.kind = e[Math.min(Math.max(Math.round(i), 0), e.length - 1)] : r[n] = T(n, i);
		else continue;
	}
	return r;
}
function D(t, n) {
	return n === "kind" ? e.indexOf(t.kind) : t[n];
}
function O(e, t = b) {
	let n = {};
	for (let r of t) n[C(r)] = D(e, r);
	return n[C(x)] = _(e), n;
}
function k(e) {
	if (!(C("draws") in e) && !b.some((t) => C(t) in e)) return null;
	let t = _(E(e));
	return e[C("draws")] === t ? null : { [C(x)]: t };
}
var oe = () => O(n), A = "Blur Reduction", j = (e) => E(e.getParams());
function M(e, t, n) {
	e.setParams(O(t, n));
}
var N = (e, t) => e.commit(`${A}: ${t}`), P, F;
function se(e) {
	F = e, P = e.react;
}
var I = (e, t) => Math.round(e / t) * t || 0;
function ce(e, n, r, i) {
	if (!(r > 0 && i > 0)) return null;
	let a = (n.x - e.x) * r, o = (n.y - e.y) * i, s = Math.hypot(a, o);
	if (!(s >= 1)) return null;
	let c = Math.atan2(-o, a) * 180 / Math.PI;
	return c > 90 ? c -= 180 : c <= -90 && (c += 180), {
		streakLength: T("streakLength", I(s, t.streakLength.step)),
		streakAngle: T("streakAngle", I(c, t.streakAngle.step))
	};
}
//#endregion
//#region src/Trace.tsx
var L = null, R = /* @__PURE__ */ new Set();
function z(e) {
	L = e;
	for (let e of R) e();
}
var le = (e) => (R.add(e), () => void R.delete(e));
function ue(e) {
	z(e), F.develop.setCanvasTool({
		overlay: fe,
		zoomable: !0,
		onEscape: () => z(null)
	});
}
function B(e) {
	L && L.maskId === e && (z(null), F.develop.setCanvasTool(null));
}
function V() {
	L && z(null);
}
function H(e) {
	return P.useSyncExternalStore(le, () => L !== null && L.maskId === e);
}
var de = 4;
function fe(e) {
	let t = F.develop.useDevelopOverlay(), n = P.useRef(null), [r, i] = P.useState(null), a = (e) => F.develop.framePoint(e.currentTarget, e.clientX, e.clientY), o = (e, n) => {
		let r = L, i = t.toImage;
		if (!r || !i || Math.hypot(n.x - e.x, n.y - e.y) < de) return;
		let { fullWidth: a, fullHeight: o } = F.stores.useDevelopStore.getState().sourceSize, s = ce(i(e.x, e.y), i(n.x, n.y), a, o);
		s && (M(r, {
			...j(r),
			...s,
			on: !0,
			kind: "motion"
		}, [
			"on",
			"kind",
			"streakLength",
			"streakAngle"
		]), N(r, "trace streak"), B(r.maskId));
	};
	return /* @__PURE__ */ P.createElement("div", {
		"data-trace-surface": "",
		style: {
			position: "absolute",
			inset: 0,
			cursor: F.cursors.resolve("crosshair"),
			pointerEvents: "auto",
			touchAction: "none"
		},
		onPointerDown: (e) => {
			if (e.button !== 0) return;
			e.preventDefault(), e.currentTarget.setPointerCapture?.(e.pointerId);
			let t = a(e);
			n.current = {
				from: t,
				to: t,
				pointerId: e.pointerId
			}, i({
				from: t,
				to: t
			});
		},
		onPointerMove: (e) => {
			let t = n.current;
			t && t.pointerId === e.pointerId && (t.to = a(e), i({
				from: t.from,
				to: t.to
			}));
		},
		onPointerUp: (e) => {
			let t = n.current;
			t && t.pointerId === e.pointerId && (n.current = null, i(null), o(t.from, a(e)));
		},
		onPointerCancel: () => {
			n.current = null, i(null);
		}
	}, r ? /* @__PURE__ */ P.createElement("svg", {
		width: "100%",
		height: "100%",
		style: {
			position: "absolute",
			inset: 0,
			overflow: "visible",
			pointerEvents: "none"
		}
	}, /* @__PURE__ */ P.createElement("line", {
		x1: r.from.x,
		y1: r.from.y,
		x2: r.to.x,
		y2: r.to.y,
		stroke: "rgba(0,0,0,0.8)",
		strokeWidth: 3,
		strokeLinecap: "round"
	}), /* @__PURE__ */ P.createElement("line", {
		x1: r.from.x,
		y1: r.from.y,
		x2: r.to.x,
		y2: r.to.y,
		stroke: "rgba(255,255,255,0.9)",
		strokeWidth: 1,
		strokeLinecap: "round"
	})) : null);
}
//#endregion
//#region src/Panel.tsx
var U = {
	motion: "Motion",
	focus: "Focus",
	gaussian: "Gaussian"
}, pe = {
	motion: "A streak: the camera or the subject moved during the exposure",
	focus: "A disc: the photo is out of focus",
	gaussian: "A soft, even blur, as from a weak lens or a soft filter"
}, me = {
	motion: ["streakLength", "streakAngle"],
	focus: ["focusRadius"],
	gaussian: ["gaussRadius"]
}, he = [
	"iterations",
	"suppression",
	"amount"
];
function W() {
	let { Slider: r } = F.components, { Button: i, SegmentedControl: a, Stack: o, Toggle: s } = F.ui, c = F.develop.useParamScope(), l = F.develop.useCanvasToolHeld(), u = j(c);
	P.useEffect(() => {
		l || V();
	}, [l]);
	let d = c.maskId;
	P.useEffect(() => () => B(d), [d]);
	let f = H(d) && l, p = (e) => {
		let i = t[e];
		return /* @__PURE__ */ P.createElement(r, {
			key: e,
			label: ie[e] ?? S[e],
			value: u[e],
			min: i.min,
			max: i.max,
			step: i.step,
			defaultValue: n[e],
			onChange: (t) => M(c, {
				...j(c),
				[e]: Math.min(Math.max(t, i.min), i.max)
			}, [e]),
			onCommit: () => N(c, S[e].toLowerCase())
		});
	}, m = (e, t) => {
		M(c, {
			...j(c),
			...e
		}, Object.keys(e)), N(c, t);
	};
	return /* @__PURE__ */ P.createElement(o, {
		gap: 6,
		style: { padding: 8 }
	}, /* @__PURE__ */ P.createElement(s, {
		checked: u.on,
		label: S.on,
		onChange: (e) => m({ on: e }, `${e ? "on" : "off"}`)
	}), /* @__PURE__ */ P.createElement("div", { title: pe[u.kind] }, /* @__PURE__ */ P.createElement(a, {
		size: "sm",
		value: u.kind,
		options: e.map((e) => ({
			value: e,
			label: U[e]
		})),
		onChange: (t) => {
			let n = e.find((e) => e === t) ?? "motion";
			n !== "motion" && B(d), m({ kind: n }, `${U[n].toLowerCase()} blur`);
		}
	})), me[u.kind].map(p), u.kind === "motion" ? /* @__PURE__ */ P.createElement(i, {
		size: "sm",
		variant: "secondary",
		active: f,
		title: "Drag along a streak in the photo, from one end to the other, to set its length and angle. Esc cancels.",
		onClick: () => f ? B(d) : ue(c)
	}, "Trace streak") : null, he.map(p));
}
//#endregion
//#region src/glsl.ts
function ge(e) {
	let t = e.toPrecision(10);
	if (/e/i.test(t)) {
		let [e, n] = t.split(/e/i);
		return `${e.includes(".") ? e : `${e}.0`}e${Number(n)}`;
	}
	return t.includes(".") ? t.replace(/0+$/, "").replace(/\.$/, ".0") : `${t}.0`;
}
var G = ge, K = {
	prep: 0,
	convolve: 1,
	multiply: 2,
	final: 3,
	copy: 4,
	zero: 5
}, q = {
	plane: 0,
	rows: 1,
	columns: 2
}, J = 2 * Math.floor(t.focusRadius.max + .5) + 1, _e = Math.ceil(Math.sqrt(2 * (t.focusRadius.max + .5))) + 2, Y = `vec3(${u.map(G).join(", ")})`, ve = `
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
float brObserved(vec3 rgb) { return max(dot(rgb, ${Y}), ${G(i)}); }
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
  return int(floor(sqrt(max(outer * outer - fy * fy, 0.0)) + ${G(l)}));
}
int brDiscTaps(float outer) {
  int rows = int(floor(outer));
  int total = 0;
  for (int r = 0; r < ${J}; r++) {
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
  for (int r = 0; r < ${J}; r++) {
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
  for (int r = 0; r < ${J}; r++) {
    if (r > 2 * rows) break;
    int dy = r - rows;
    float fy = float(dy);
    int hw = brDiscRow(outer, dy);
    int full = inner * inner - fy * fy >= 0.0 ? min(int(floor(sqrt(inner * inner - fy * fy))), hw) : -1;
    if (full >= 0) total += float(2 * full + 1);
    for (int j = 0; j < ${_e}; j++) {
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
    trivial = sigma < ${G(c)};
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
  int perAxis = (taps + 47) / 48;
  int chunks = separable ? 2 * perAxis : perAxis;
  int per = 2 * chunks + 1;
  int iters = trivial ? 0 : min(int(iterations + 0.5), max(uPassCount - 2, 0) / per);
  total = 2 + iters * per;
  role = 0;
  axis = ${q.plane};
  chunk = 0;
  last = false;
  ivec2 size = brSize();
  if (size.x < 8 || size.y < 8 || total > uPassCount) {
    stepKind = uPassIndex == 0 ? ${K.zero} : ${K.copy};
    total = 1;
    return;
  }
  int i = uPassIndex;
  if (i == 0) { stepKind = ${K.prep}; return; }
  i -= 1;
  if (i < iters * per) {
    int k = i - (i / per) * per;
    if (k == per - 1) { stepKind = ${K.multiply}; return; }
    stepKind = ${K.convolve};
    role = k < chunks ? 1 : 2;
    int kk = k - (role - 1) * chunks;
    if (separable) {
      axis = kk < perAxis ? ${q.rows} : ${q.columns};
      chunk = kk < perAxis ? kk : kk - perAxis;
    } else {
      chunk = kk;
    }
    last = chunk == perAxis - 1;
    return;
  }
  stepKind = i == iters * per ? ${K.final} : ${K.copy};
}

// Every draw of the schedule writes the whole frame; of the copies past it,
// only the first changes anything.
ivec4 brRegion() {
  int stepKind, role, axis, chunk, total;
  bool last;
  brPlan(stepKind, role, axis, chunk, last, total);
  if (stepKind == ${K.copy} && uPassIndex > total) return ivec4(0);
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
  bool columns = axis == ${q.columns};
  vec4 pick = role == 1 ? (columns ? vec4(1.0, 1.0, 0.0, 1.0) : vec4(1.0, 1.0, 0.0, 0.0)) : (columns ? vec4(0.0, 0.0, 0.0, 1.0) : vec4(0.0, 0.0, 1.0, 0.0));
  float less = role == 1 ? estP : 0.0;
  bool toW = role == 1 ? axis == ${q.rows} : !columns;
  float acc = chunk == 0 ? 0.0 : (toW ? t.w : t.z);

  bool xMajor = true;
  float slope = 0.0, e = 0.0, outer = 0.0, gs = 0.0, weightSum = 1.0;
  int n = 0, taps = 0, dy = 0, dx = 0, hw = 0;
  int t0 = chunk * 48;
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
    gs = 1.0 / (sigma * ${G(Math.SQRT2)});
    weightSum = brErf((float(n) + 0.5) * gs);
  }

  for (int i = 0; i < 48; i++) {
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
    if (role == 1 && axis != ${q.rows}) acc = obs / max(estP + acc / weightSum, ${G(a)}) - 1.0;
    else acc /= weightSum;
  }
  return toW ? vec4(t.xyz, acc) : vec4(t.xy, acc, t.w);
}

float brE(ivec2 q) {
  vec4 v = brAt(q);
  return v.x + v.y;
}
vec2 brUnit(float gx, float gy) { return vec2(gx, gy) / sqrt(gx * gx + gy * gy + ${G(o * o)}); }

// The estimate times the ratio blurred back, over total variation's
// divergence term: forward differences for the gradient, backward ones for
// the divergence.
vec4 brMultiply(ivec2 p, vec4 t) {
  float est = t.x + t.y;
  float kr = brKind() == 2 ? t.z : t.w;
  float lambda = suppression * ${G(s)};
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
  bool needsObserved = stepKind == ${K.prep} || stepKind == ${K.final} || (stepKind == ${K.convolve} && role == 1 && axis != ${q.rows} && last);
  float obs = needsObserved ? brObserved(fetchInput(p)) : 0.0;
  if (stepKind == ${K.prep}) return brSplit(obs);
  if (stepKind == ${K.final}) return vec4(t.x + t.y - obs, obs, 0.0, 0.0);
  if (stepKind == ${K.multiply}) return brMultiply(p, t);
  return brConvolve(role, axis, chunk, last, p, t, obs);
}
`, ye = `
int brStep, brRole, brAxis, brChunk, brTotal;
bool brLast;
brPlan(brStep, brRole, brAxis, brChunk, brLast, brTotal);
if (brStep == ${K.zero}) c = vec4(0.0);
else if (brStep != ${K.copy}) c = brDraw(brStep, brRole, brAxis, brChunk, brLast, ivec2(gl_FragCoord.xy), c);
`, X = "return brRegion();", be = `
if (draws > 0) {
  float brDelta = stageResult.x * amount * 0.01;
  float brY = dot(lin, ${Y});
  if (brY > ${G(i)}) lin *= max(brY + brDelta, 0.0) / brY;
  else lin += vec3(brDelta);
}
`, Z = (r) => {
	let i = {
		key: r,
		default: D(n, r),
		label: S[r]
	};
	return r === "on" ? {
		...i,
		glslType: "bool"
	} : r === "kind" ? {
		...i,
		glslType: "float",
		range: {
			min: 0,
			max: e.length - 1,
			step: 1
		}
	} : {
		...i,
		glslType: "float",
		range: { ...t[r] }
	};
}, xe = {
	key: x,
	glslType: "int",
	default: 0
};
function Se() {
	return {
		id: y,
		name: "Blur Reduction",
		phase: "scene-linear",
		priority: 20,
		reads: "current",
		space: {
			encoding: "linear",
			primaries: "rec709"
		},
		glsl: be,
		uniforms: [...b.map(Z), xe],
		passes: [{
			channels: 4,
			glsl: ye,
			helpers: ve,
			region: X,
			iterations: {
				key: x,
				max: r
			},
			uniforms: re.map(Z)
		}],
		dormantWhen: { [x]: 0 },
		mask: { maskable: !0 }
	};
}
//#endregion
//#region src/index.tsx
var Q = `${v}.panel`, $ = null;
function Ce() {
	let e = F.stores.useDevelopStore.getState();
	e.setDynParams(oe()), e.commitEdit(`${A} reset`);
}
function we(e) {
	se(e), e.registerProcessingStage(Se()), e.registerPanel({
		id: Q,
		title: A,
		component: W,
		defaultDock: {
			module: "develop",
			direction: "right",
			width: 280
		},
		onReset: Ce,
		mask: {
			component: W,
			owns: [...b.map(C), C(x)]
		}
	}), $?.(), $ = e.stores.useDevelopStore.subscribe((e, t) => {
		if (e.params.masks !== t.params.masks) for (let n of e.params.masks) {
			if (t.params.masks.some((e) => e.id === n.id && e.bag === n.bag)) continue;
			let r = n.bag ? k(n.bag) : null;
			r && e.updateMaskBag(n.id, r);
		}
		if (e.paramBag === t.paramBag) return;
		let n = k(e.paramBag);
		n && e.setDynParams(n);
	});
}
function Te() {
	$?.(), $ = null, V();
}
//#endregion
export { Q as PANEL_ID, we as activate, Te as deactivate };

//# sourceMappingURL=index.js.map