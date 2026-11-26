// The processing stage: the deconvolution in one four-channel pass
// (glsl.ts), and the inline that moves each pixel's luminance by the pass's
// result. Blur is a convolution of light, so the stage works on scene-linear
// values, early in that phase: after exposure and noise reduction, ahead of
// every tone mapping.

import { INLINE_GLSL, PASS_GLSL, PASS_HELPERS, REGION_GLSL } from "./glsl";
import { DEFAULT_PARAMS, KINDS, MAX_DRAWS, RANGES } from "./model";
import { DRAWS_KEY, EDIT_KEYS, LABELS, PASS_KEYS, STAGE_ID, bagValue, type EditKey } from "./params";
import type { ProcessingStageContribution, UniformDeclaration } from "./safelight";

export const PRIORITY = 20;

const edit = (key: EditKey): UniformDeclaration => {
  const base = { key, default: bagValue(DEFAULT_PARAMS, key), label: LABELS[key] };
  if (key === "on") return { ...base, glslType: "bool" };
  if (key === "kind") return { ...base, glslType: "float", range: { min: 0, max: KINDS.length - 1, step: 1 } };
  return { ...base, glslType: "float", range: { ...RANGES[key] } };
};

const DRAWS: UniformDeclaration = { key: DRAWS_KEY, glslType: "int", default: 0 };

export function deblurStage(): ProcessingStageContribution {
  return {
    id: STAGE_ID,
    name: "Blur Reduction",
    phase: "scene-linear",
    priority: PRIORITY,
    reads: "current",
    space: { encoding: "linear", primaries: "rec709" },
    glsl: INLINE_GLSL,
    uniforms: [...EDIT_KEYS.map(edit), DRAWS],
    passes: [
      {
        channels: 4,
        glsl: PASS_GLSL,
        helpers: PASS_HELPERS,
        region: REGION_GLSL,
        iterations: { key: DRAWS_KEY, max: MAX_DRAWS },
        uniforms: PASS_KEYS.map(edit),
      },
    ],
    dormantWhen: { [DRAWS_KEY]: 0 },
    mask: { maskable: true },
  };
}
