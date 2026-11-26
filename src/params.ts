// The param-bag contract: the edit under the stage's qualified keys, the
// switch as a boolean and the blur as its index in KINDS. One derived key,
// `draws`, is the pass's draw count: 0 while the edit changes nothing, so an
// untouched photo never runs the pass.

import { DEFAULT_PARAMS, KINDS, RANGES, drawCount, type NumericKey, type Params } from "./model";

export const EXT_ID = "blur-reduction";
export const STAGE_ID = `${EXT_ID}.deblur`;

export type EditKey = keyof Params;
export const EDIT_KEYS: readonly EditKey[] = ["on", "kind", "streakLength", "streakAngle", "focusRadius", "gaussRadius", "iterations", "suppression", "amount"];
/** What the pass reads; the switch and the amount only reach the inline. */
export const PASS_KEYS: readonly EditKey[] = ["kind", "streakLength", "streakAngle", "focusRadius", "gaussRadius", "iterations", "suppression"];
export const NUMERIC_KEYS: readonly NumericKey[] = ["streakLength", "streakAngle", "focusRadius", "gaussRadius", "iterations", "suppression", "amount"];
export const DRAWS_KEY = "draws" as const;

/** The labels the stage's uniforms carry (history, presets). */
export const LABELS: Record<EditKey, string> = {
  on: "Enabled",
  kind: "Blur",
  streakLength: "Length",
  streakAngle: "Angle",
  focusRadius: "Focus radius",
  gaussRadius: "Gaussian radius",
  iterations: "Iterations",
  suppression: "Noise suppression",
  amount: "Amount",
};

/** Where the panel shows one blur's controls at a time, its radii read short. */
export const PANEL_LABELS: Partial<Record<EditKey, string>> = {
  focusRadius: "Radius",
  gaussRadius: "Radius",
};

const WHOLE: ReadonlySet<NumericKey> = new Set<NumericKey>(["iterations", "suppression", "amount"]);

export const qualified = (key: EditKey | typeof DRAWS_KEY): string => `${STAGE_ID}.${key}`;

type Bag = Readonly<Record<string, unknown>>;
export type Patch = Record<string, number | boolean>;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function clampTo(key: NumericKey, v: number): number {
  const { min, max } = RANGES[key];
  const clamped = Math.min(Math.max(v, min), max);
  return WHOLE.has(key) ? Math.round(clamped) : clamped;
}

/** `bag` is the host's untyped per-photo bag; a missing or non-finite value reads as the default. */
export function readParams(bag: Bag): Params {
  const out: Params = { ...DEFAULT_PARAMS };
  for (const key of EDIT_KEYS) {
    const v = bag[qualified(key)];
    if (key === "on") {
      if (typeof v === "boolean") out.on = v;
      else if (finite(v)) out.on = v >= 0.5;
    } else if (!finite(v)) continue;
    else if (key === "kind") out.kind = KINDS[Math.min(Math.max(Math.round(v), 0), KINDS.length - 1)];
    else out[key] = clampTo(key, v);
  }
  return out;
}

/** A param as the bag holds it. */
export function bagValue(p: Params, key: EditKey): number | boolean {
  if (key === "kind") return KINDS.indexOf(p.kind);
  return p[key];
}

/** `keys` of the edit and its draw count. */
export function bagPatch(p: Params, keys: readonly EditKey[] = EDIT_KEYS): Patch {
  const out: Patch = {};
  for (const key of keys) out[qualified(key)] = bagValue(p, key);
  out[qualified(DRAWS_KEY)] = drawCount(p);
  return out;
}

/** The draw count the bag's edit needs, when the bag holds a different one. */
export function rederivePatch(bag: Bag): Patch | null {
  if (!(qualified(DRAWS_KEY) in bag) && !EDIT_KEYS.some((key) => qualified(key) in bag)) return null;
  const draws = drawCount(readParams(bag));
  return bag[qualified(DRAWS_KEY)] === draws ? null : { [qualified(DRAWS_KEY)]: draws };
}

export const resetPatch = (): Patch => bagPatch(DEFAULT_PARAMS);
