// The trace tool: while armed it holds the Develop canvas, and a drag along a
// streak in the photo sets Motion's length and angle in the scope that armed
// it, switches Motion on, and lets the canvas go. A click is ignored, and
// Escape or another tool taking the canvas disarms it. Zoom and pan still
// work, so a fine streak can be traced zoomed in.

import { commit, read, write } from "./edit";
import { React, api } from "./rt";
import type { OverlayRect, ParamScope } from "./safelight";
import { streakFrom, type Point } from "./streak";

/** The scope the trace writes to while armed. Panels are told when it changes. */
let pending: ParamScope | null = null;
const listeners = new Set<() => void>();

function setPending(next: ParamScope | null): void {
  pending = next;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export function armTrace(scope: ParamScope): void {
  setPending(scope);
  api.develop.setCanvasTool({
    overlay: TraceOverlay,
    zoomable: true,
    onEscape: () => setPending(null),
  });
}

/** Lets the canvas go if the trace is armed for `maskId` (null: the photo's own panel). */
export function disarmTrace(maskId: string | null): void {
  if (!pending || pending.maskId !== maskId) return;
  setPending(null);
  api.develop.setCanvasTool(null);
}

/** Another tool took the canvas: forget the scope without touching the tool. */
export function forgetTrace(): void {
  if (pending) setPending(null);
}

/** Whether the trace is armed for this panel's mask (null: the photo's own panel). */
export function useTracingFor(maskId: string | null): boolean {
  return React.useSyncExternalStore(subscribe, () => pending !== null && pending.maskId === maskId);
}

/** A drag shorter than this, in screen pixels, is a click. */
const CLICK_PX = 4;

export function TraceOverlay(_props: { rect: OverlayRect }) {
  const overlay = api.develop.useDevelopOverlay();
  // The gesture lives in a ref, as pointer events can outrun renders; the
  // state only draws the line.
  const drag = React.useRef<{ from: Point; to: Point; pointerId: number } | null>(null);
  const [line, setLine] = React.useState<{ from: Point; to: Point } | null>(null);

  const at = (e: React.PointerEvent<Element>): Point => api.develop.framePoint(e.currentTarget, e.clientX, e.clientY);

  const finish = (from: Point, to: Point) => {
    const scope = pending;
    const toImage = overlay.toImage;
    if (!scope || !toImage || Math.hypot(to.x - from.x, to.y - from.y) < CLICK_PX) return;
    const { fullWidth, fullHeight } = api.stores.useDevelopStore.getState().sourceSize;
    const streak = streakFrom(toImage(from.x, from.y), toImage(to.x, to.y), fullWidth, fullHeight);
    if (!streak) return;
    write(scope, { ...read(scope), ...streak, on: true, kind: "motion" }, ["on", "kind", "streakLength", "streakAngle"]);
    commit(scope, "trace streak");
    disarmTrace(scope.maskId);
  };

  return (
    <div
      data-trace-surface=""
      style={{ position: "absolute", inset: 0, cursor: api.cursors.resolve("crosshair"), pointerEvents: "auto", touchAction: "none" }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        const p = at(e);
        drag.current = { from: p, to: p, pointerId: e.pointerId };
        setLine({ from: p, to: p });
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.pointerId !== e.pointerId) return;
        d.to = at(e);
        setLine({ from: d.from, to: d.to });
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        if (!d || d.pointerId !== e.pointerId) return;
        drag.current = null;
        setLine(null);
        finish(d.from, at(e));
      }}
      onPointerCancel={() => {
        drag.current = null;
        setLine(null);
      }}
    >
      {line ? (
        <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, overflow: "visible", pointerEvents: "none" }}>
          <line x1={line.from.x} y1={line.from.y} x2={line.to.x} y2={line.to.y} stroke="rgba(0,0,0,0.8)" strokeWidth={3} strokeLinecap="round" />
          <line x1={line.from.x} y1={line.from.y} x2={line.to.x} y2={line.to.y} stroke="rgba(255,255,255,0.9)" strokeWidth={1} strokeLinecap="round" />
        </svg>
      ) : null}
    </div>
  );
}
