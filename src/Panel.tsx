// The panel: the switch, the blur's shape and its own controls, then what
// every blur shares. Motion's length and angle can also be traced on the
// photo. It edits whatever useParamScope hands it: the photo's bag in the
// dock, a mask's in the Masking panel. A drag writes the value and the draw
// count live and commits on release, so one gesture is one undo step; the
// switch and the blur commit at once.

import { TITLE, commit, read, write } from "./edit";
import { DEFAULT_PARAMS, KINDS, RANGES, type Kind, type NumericKey, type Params } from "./model";
import { LABELS, PANEL_LABELS } from "./params";
import { React, api } from "./rt";
import { armTrace, disarmTrace, forgetTrace, useTracingFor } from "./Trace";

export { TITLE };

const KIND_LABELS: Record<Kind, string> = { motion: "Motion", focus: "Focus", gaussian: "Gaussian" };
const KIND_HINTS: Record<Kind, string> = {
  motion: "A streak: the camera or the subject moved during the exposure",
  focus: "A disc: the photo is out of focus",
  gaussian: "A soft, even blur, as from a weak lens or a soft filter",
};

const OWN_CONTROLS: Record<Kind, NumericKey[]> = {
  motion: ["streakLength", "streakAngle"],
  focus: ["focusRadius"],
  gaussian: ["gaussRadius"],
};
const SHARED: NumericKey[] = ["iterations", "suppression", "amount"];

export function BlurPanel() {
  const { Slider } = api.components;
  const { Button, SegmentedControl, Stack, Toggle } = api.ui;
  const scope = api.develop.useParamScope();
  const held = api.develop.useCanvasToolHeld();
  const p = read(scope);

  // Another tool or a picker took the canvas: the trace stands down.
  React.useEffect(() => {
    if (!held) forgetTrace();
  }, [held]);
  const maskId = scope.maskId;
  React.useEffect(() => () => disarmTrace(maskId), [maskId]);

  const tracing = useTracingFor(maskId) && held;

  const slider = (key: NumericKey) => {
    const range = RANGES[key];
    return (
      <Slider
        key={key}
        label={PANEL_LABELS[key] ?? LABELS[key]}
        value={p[key]}
        min={range.min}
        max={range.max}
        step={range.step}
        defaultValue={DEFAULT_PARAMS[key]}
        onChange={(v) => write(scope, { ...read(scope), [key]: Math.min(Math.max(v, range.min), range.max) }, [key])}
        onCommit={() => commit(scope, LABELS[key].toLowerCase())}
      />
    );
  };

  const set = (next: Partial<Params>, what: string) => {
    write(scope, { ...read(scope), ...next }, Object.keys(next) as (keyof Params)[]);
    commit(scope, what);
  };

  return (
    <Stack gap={6} style={{ padding: 8 }}>
      <Toggle checked={p.on} label={LABELS.on} onChange={(on) => set({ on }, `${on ? "on" : "off"}`)} />
      <div title={KIND_HINTS[p.kind]}>
        <SegmentedControl
          size="sm"
          value={p.kind}
          options={KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] }))}
          onChange={(v) => {
            const kind = KINDS.find((k) => k === v) ?? "motion";
            if (kind !== "motion") disarmTrace(maskId);
            set({ kind }, `${KIND_LABELS[kind].toLowerCase()} blur`);
          }}
        />
      </div>
      {OWN_CONTROLS[p.kind].map(slider)}
      {p.kind === "motion" ? (
        <Button
          size="sm"
          variant="secondary"
          active={tracing}
          title="Drag along a streak in the photo, from one end to the other, to set its length and angle. Esc cancels."
          onClick={() => (tracing ? disarmTrace(maskId) : armTrace(scope))}
        >
          Trace streak
        </Button>
      ) : null}
      {SHARED.map(slider)}
    </Stack>
  );
}
