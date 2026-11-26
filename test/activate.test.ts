import { describe, expect, it } from "vitest";
import { PANEL_ID, activate, deactivate } from "../src/index";
import { DEFAULT_PARAMS, drawCount } from "../src/model";
import { STAGE_ID, qualified } from "../src/params";
import { fakeApi } from "./support/fake-api";

describe("activate", () => {
  it("registers the stage and a panel titled Blur Reduction that also edits masks", () => {
    const rig = fakeApi();
    activate(rig.api);
    expect(rig.stages.map((s) => s.id)).toEqual([STAGE_ID]);
    expect(rig.panels.map((p) => [p.id, p.title])).toEqual([[PANEL_ID, "Blur Reduction"]]);
    expect(rig.panels[0].mask?.owns).toContain(qualified("draws"));
    expect(rig.panels[0].mask?.owns).toContain(qualified("streakAngle"));
    deactivate();
  });

  it("resets to the defaults, off, in one undo step", () => {
    const rig = fakeApi({ [qualified("on")]: true, [qualified("streakLength")]: 40 });
    activate(rig.api);
    rig.panels[0].onReset?.();
    expect(rig.params()[qualified("on")]).toBe(false);
    expect(rig.params()[qualified("streakLength")]).toBe(DEFAULT_PARAMS.streakLength);
    expect(rig.params()[qualified("draws")]).toBe(0);
    expect(rig.commits).toEqual(["Blur Reduction reset"]);
    deactivate();
  });

  it("re-derives the draw count of a pasted edit, and a mask's", () => {
    const rig = fakeApi();
    activate(rig.api);
    rig.replace({ [qualified("on")]: true, [qualified("kind")]: 1, [qualified("iterations")]: 40 });
    expect(rig.params()[qualified("draws")]).toBe(drawCount({ ...DEFAULT_PARAMS, on: true, kind: "focus", iterations: 40 }));
    rig.setMasks([{ id: "m1", bag: { [qualified("on")]: true, [qualified("streakLength")]: 30 } }]);
    expect(rig.maskBag("m1")?.[qualified("draws")]).toBe(drawCount({ ...DEFAULT_PARAMS, on: true, streakLength: 30 }));
    deactivate();
  });

  it("stops re-deriving once deactivated", () => {
    const rig = fakeApi();
    activate(rig.api);
    deactivate();
    rig.replace({ [qualified("on")]: true });
    expect(rig.params()[qualified("draws")]).toBeUndefined();
  });
});
