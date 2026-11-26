import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS, drawCount } from "../src/model";
import { EDIT_KEYS, STAGE_ID, bagPatch, qualified, readParams, rederivePatch, resetPatch } from "../src/params";

describe("params", () => {
  it("names keys under the stage", () => {
    expect(STAGE_ID).toBe("blur-reduction.deblur");
    expect(qualified("streakLength")).toBe("blur-reduction.deblur.streakLength");
  });

  it("reads an empty bag as the defaults", () => {
    expect(readParams({})).toEqual(DEFAULT_PARAMS);
  });

  it("round-trips an edit through the bag", () => {
    const p = { ...DEFAULT_PARAMS, on: true, kind: "focus" as const, focusRadius: 4.2, iterations: 35, suppression: 0, amount: 70 };
    expect(readParams(bagPatch(p))).toEqual(p);
  });

  it("clamps, rounds and ignores what isn't a number", () => {
    const p = readParams({
      [qualified("streakLength")]: 400,
      [qualified("streakAngle")]: -120,
      [qualified("iterations")]: 12.6,
      [qualified("kind")]: 7,
      [qualified("amount")]: Number.NaN,
      [qualified("on")]: 1,
    });
    expect(p).toMatchObject({ streakLength: 100, streakAngle: -90, iterations: 13, kind: "gaussian", amount: 100, on: true });
  });

  it("writes the draw count with every patch", () => {
    const p = { ...DEFAULT_PARAMS, on: true };
    expect(bagPatch(p, ["streakLength"])).toEqual({ [qualified("streakLength")]: 10, [qualified("draws")]: drawCount(p) });
    expect(resetPatch()[qualified("draws")]).toBe(0);
    expect(Object.keys(resetPatch())).toHaveLength(EDIT_KEYS.length + 1);
  });

  it("re-derives a draw count that disagrees with the edit", () => {
    expect(rederivePatch({})).toBeNull();
    expect(rederivePatch({ [qualified("on")]: true })).toEqual({ [qualified("draws")]: drawCount({ ...DEFAULT_PARAMS, on: true }) });
    expect(rederivePatch(bagPatch({ ...DEFAULT_PARAMS, on: true }))).toBeNull();
    expect(rederivePatch({ [qualified("draws")]: 9 })).toEqual({ [qualified("draws")]: 0 });
  });
});
