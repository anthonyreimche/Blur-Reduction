// Where an edit goes: the scope a panel was handed (the photo's bag in the
// dock, a mask's in the Masking panel). A live change writes the keys it
// touched and the draw count; a gesture ends with one commit, one undo step.
// Each change reads the scope as it is now, as drags outrun renders.

import type { Params } from "./model";
import { bagPatch, readParams, type EditKey } from "./params";
import type { ParamScope } from "./safelight";

export const TITLE = "Blur Reduction";

export const read = (scope: ParamScope): Params => readParams(scope.getParams());

export function write(scope: ParamScope, next: Params, keys: readonly EditKey[]): void {
  scope.setParams(bagPatch(next, keys));
}

export const commit = (scope: ParamScope, what: string): void => scope.commit(`${TITLE}: ${what}`);
