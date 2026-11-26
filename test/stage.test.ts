// The stage contract the host relies on, and what a draw may cost. Unit tests
// can't run GLSL; the GPU spec (test/gpu) renders it.

import { describe, expect, it } from "vitest";
import { INLINE_GLSL, MAX_RIM, MAX_ROWS, PASS_GLSL, PASS_HELPERS, REGION_GLSL, glslLiteral } from "../src/glsl";
import { DEFAULT_PARAMS, MAX_DRAWS, RANGES, TAPS_PER_DRAW, discRow } from "../src/model";
import { DRAWS_KEY, EDIT_KEYS, LABELS, PASS_KEYS, STAGE_ID, bagValue } from "../src/params";
import { PRIORITY, deblurStage } from "../src/stage";
import { fetchBudget, inlineFetches } from "./support/fetch-budget";

const stage = deblurStage();
const pass = stage.passes![0];
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("the stage", () => {
  it("reads the edited image in linear Rec.709, early among the scene-linear stages", () => {
    expect(stage).toMatchObject({
      id: STAGE_ID,
      name: "Blur Reduction",
      phase: "scene-linear",
      reads: "current",
      space: { encoding: "linear", primaries: "rec709" },
      priority: PRIORITY,
    });
    expect(PRIORITY).toBeLessThan(100);
  });

  it("runs one four-channel pass for as many draws as the bag says", () => {
    expect(stage.passes).toHaveLength(1);
    expect(pass).toMatchObject({ channels: 4, iterations: { key: DRAWS_KEY, max: MAX_DRAWS }, region: REGION_GLSL });
  });

  it("gives the pass only what it reads, so the switch and the amount never rerun it", () => {
    expect(pass.uniforms?.map((u) => u.key).sort()).toEqual([...PASS_KEYS].sort());
    expect(PASS_KEYS).not.toContain("amount");
    expect(PASS_KEYS).not.toContain("on");
    expect(stage.uniforms.map((u) => u.key).sort()).toEqual([...EDIT_KEYS, DRAWS_KEY].sort());
    const inline = new Map(stage.uniforms.map((u) => [u.key, u]));
    for (const u of pass.uniforms ?? []) expect(inline.get(u.key)).toEqual(u);
  });

  it("declares each default as the bag holds it, and labels each control once", () => {
    for (const u of stage.uniforms) {
      if (u.key === DRAWS_KEY) continue;
      expect(u.default).toBe(bagValue(DEFAULT_PARAMS, u.key as (typeof EDIT_KEYS)[number]));
      expect(u.label).toBe(LABELS[u.key as (typeof EDIT_KEYS)[number]]);
    }
    const labels = stage.uniforms.filter((u) => u.key !== DRAWS_KEY).map((u) => u.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(stage.uniforms.find((u) => u.key === "on")).toMatchObject({ glslType: "bool", default: false });
  });

  it("is dormant while it draws nothing, and changes nothing until the pass has drawn", () => {
    expect(stage.dormantWhen).toEqual({ [DRAWS_KEY]: 0 });
    expect(INLINE_GLSL.trim().startsWith("if (draws > 0) {")).toBe(true);
  });

  it("can run inside masks", () => {
    expect(stage.mask).toEqual({ maskable: true });
  });
});

describe("the GLSL", () => {
  const all = code(PASS_GLSL + PASS_HELPERS + INLINE_GLSL);

  it("makes its ints highp, as Mesa honours mediump", () => {
    expect(PASS_HELPERS).toContain("precision highp int;");
  });

  // The host renames uniform keys wherever they appear as words, built-in
  // calls included, and GLSL ES reserves some plain words.
  it("names no uniform or local after a built-in or a reserved word", () => {
    const taken = ["length", "step", "sign", "clamp", "mix", "floor", "ceil", "half", "sample", "input", "output", "filter", "fixed", "active"];
    for (const key of [...EDIT_KEYS, DRAWS_KEY]) expect(taken).not.toContain(key);
    for (const word of ["half", "sample", "input", "output", "filter", "fixed", "active"]) {
      expect(new RegExp(`\\b(?:int|float|bool|vec[234]|ivec[234])\\s+${word}\\b`).test(all), word).toBe(false);
    }
    expect(/\b(?:int|float|bool)\s+step\b/.test(all)).toBe(false);
  });

  it("writes float constants with a decimal point", () => {
    for (const v of [1, 0, -3, 1e-4, 1e-6, 2.5e-7, 0.2126]) expect(glslLiteral(v)).toMatch(/\.|e/);
    expect(glslLiteral(1)).toBe("1.0");
  });

  it("sizes its loops for the largest disc", () => {
    const outer = RANGES.focusRadius.max + 0.5;
    expect(MAX_ROWS).toBe(2 * Math.floor(outer) + 1);
    let rim = 0;
    for (let dy = -Math.floor(outer); dy <= Math.floor(outer); dy++) {
      const hw = discRow(outer, dy);
      const inner = outer - 1;
      const full = inner * inner - dy * dy >= 0 ? Math.min(Math.floor(Math.sqrt(inner * inner - dy * dy)), hw) : -1;
      rim = Math.max(rim, hw - full);
    }
    expect(rim).toBeLessThanOrEqual(MAX_RIM);
  });
});

describe("a draw's cost", () => {
  it("reads at most 56 texels a pixel in any draw, every branch counted", () => {
    // The host's own read, the luminance's, a chunk's taps and the six
    // neighbours total variation reads.
    expect(fetchBudget(PASS_GLSL, PASS_HELPERS)).toBe(1 + 1 + TAPS_PER_DRAW + 6);
  });

  it("reads nothing in the inline beyond the host's stageResult", () => {
    expect(inlineFetches(INLINE_GLSL, "")).toBe(0);
  });

  // FXC inlines a function at every call site.
  it("reads the taps from one place", () => {
    expect((code(PASS_HELPERS).match(/\bbrAt\s*\(/g) ?? []).length).toBe(3);
  });
});
