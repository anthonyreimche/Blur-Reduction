// Blur Reduction, a Safelight extension (GPL-3.0-or-later).
//
// Undoes motion, focus and Gaussian blur by Richardson-Lucy deconvolution of
// linear luminance with total-variation regularization. Registers the
// scene-linear stage (stage.ts) and the Develop panel (Panel.tsx), which also
// edits a mask's in the Masking panel, so a moving subject can be fixed on
// its own.

import { TITLE } from "./edit";
import { BlurPanel } from "./Panel";
import { DRAWS_KEY, EDIT_KEYS, EXT_ID, qualified, rederivePatch, resetPatch } from "./params";
import { api, initRuntime } from "./rt";
import type { DevelopState, SafelightAPI } from "./safelight";
import { deblurStage } from "./stage";
import { forgetTrace } from "./Trace";

export const PANEL_ID = `${EXT_ID}.panel`;

let unsubscribe: (() => void) | null = null;

function reset(): void {
  const dev = api.stores.useDevelopStore.getState();
  dev.setDynParams(resetPatch());
  void dev.commitEdit(`${TITLE} reset`);
}

export function activate(host: SafelightAPI): void {
  initRuntime(host);
  host.registerProcessingStage(deblurStage());
  host.registerPanel({
    id: PANEL_ID,
    title: TITLE,
    component: BlurPanel,
    defaultDock: { module: "develop", direction: "right", width: 280 },
    modules: ["develop"],
    onReset: reset,
    mask: { component: BlurPanel, owns: [...EDIT_KEYS.map(qualified), qualified(DRAWS_KEY)] },
  });

  unsubscribe?.();
  // A bag whose draw count disagrees with its edit (a preset or paste that
  // carried only some keys) is re-derived live, the photo's and each mask's.
  unsubscribe = host.stores.useDevelopStore.subscribe((state: DevelopState, prev: DevelopState) => {
    if (state.params.masks !== prev.params.masks) {
      for (const mask of state.params.masks) {
        if (prev.params.masks.some((m) => m.id === mask.id && m.bag === mask.bag)) continue;
        const patch = mask.bag ? rederivePatch(mask.bag) : null;
        if (patch) state.updateMaskBag(mask.id, patch);
      }
    }
    if (state.paramBag === prev.paramBag) return;
    const patch = rederivePatch(state.paramBag);
    if (patch) state.setDynParams(patch);
  });
}

/** The host sweeps the stage, the panel and the canvas tool after every deactivate. */
export function deactivate(): void {
  unsubscribe?.();
  unsubscribe = null;
  forgetTrace();
}
