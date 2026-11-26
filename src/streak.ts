// A streak traced on the photo, as Motion's length and angle. The ends are in
// source UV (0 to 1 across the upright photo, rows running down); the size is
// the full-size photo's, so the length is in its pixels whatever the zoom.

import { RANGES } from "./model";
import { clampTo } from "./params";

export interface Point {
  x: number;
  y: number;
}

/** Shorter traces than this, in the photo's pixels, are taken for a click. */
export const MIN_TRACE = 1;

const toStep = (v: number, step: number) => Math.round(v / step) * step || 0;

/** The streak from `a` to `b`: its length, and its direction folded into
 *  (-90, 90] degrees counter-clockwise from horizontal, either way along it
 *  being the same blur. Null for a trace too short to mean one. */
export function streakFrom(a: Point, b: Point, width: number, height: number): { streakLength: number; streakAngle: number } | null {
  if (!(width > 0 && height > 0)) return null;
  const dx = (b.x - a.x) * width;
  const dy = (b.y - a.y) * height;
  const length = Math.hypot(dx, dy);
  if (!(length >= MIN_TRACE)) return null;
  let angle = (Math.atan2(-dy, dx) * 180) / Math.PI;
  if (angle > 90) angle -= 180;
  else if (angle <= -90) angle += 180;
  return {
    streakLength: clampTo("streakLength", toStep(length, RANGES.streakLength.step)),
    streakAngle: clampTo("streakAngle", toStep(angle, RANGES.streakAngle.step)),
  };
}
