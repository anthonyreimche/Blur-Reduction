import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { activate, deactivate } from "../src/index";
import { DEFAULT_PARAMS, drawCount } from "../src/model";
import { BlurPanel } from "../src/Panel";
import { bagPatch, qualified } from "../src/params";
import { React } from "../src/rt";
import { fakeApi, MaskContext } from "./support/fake-api";

function setup(params: Record<string, unknown> = {}) {
  const rig = fakeApi(params);
  activate(rig.api);
  const view = render(<BlurPanel />);
  const labels = () => rig.sliders(view.container).map((s) => s.label);
  const slider = (label: string) => {
    const found = rig.sliders(view.container).find((s) => s.label === label);
    if (!found) throw new Error(`no slider ${label}`);
    return found;
  };
  const button = (label: string) => {
    const found = [...view.container.querySelectorAll("button")].find((b) => b.textContent === label);
    if (!found) throw new Error(`no button ${label}`);
    return found;
  };
  const toggle = () => view.container.querySelector("label input") as HTMLInputElement;
  return { rig, view, labels, slider, button, toggle };
}

afterEach(() => {
  cleanup();
  deactivate();
});

const on = bagPatch({ ...DEFAULT_PARAMS, on: true });

describe("the panel", () => {
  it("shows Motion's controls, a trace button and the shared ones", () => {
    const { labels, view } = setup();
    expect(labels()).toEqual(["Length", "Angle", "Iterations", "Noise suppression", "Amount"]);
    expect([...view.container.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Motion", "Focus", "Gaussian", "Trace streak"]);
    expect(view.container.querySelector("label")?.textContent).toBe("Enabled");
  });

  it("shows the defaults and ranges", () => {
    const { slider } = setup();
    expect(slider("Length")).toMatchObject({ value: 10, min: 0, max: 100, step: 0.5, defaultValue: 10 });
    expect(slider("Angle")).toMatchObject({ value: 0, min: -90, max: 90 });
    expect(slider("Iterations")).toMatchObject({ value: 20, min: 1, max: 100, step: 1 });
    expect(slider("Amount")).toMatchObject({ value: 100, min: 0, max: 100 });
  });

  it("switches on in one undo step, and only then draws", () => {
    const { rig, toggle } = setup();
    act(() => void fireEvent.click(toggle()));
    expect(rig.params()[qualified("on")]).toBe(true);
    expect(rig.params()[qualified("draws")]).toBe(drawCount({ ...DEFAULT_PARAMS, on: true }));
    expect(rig.commits).toEqual(["Blur Reduction: on"]);
  });

  it("changes the blur, showing its own radius", () => {
    const { rig, button, labels } = setup(on);
    act(() => void fireEvent.click(button("Focus")));
    expect(rig.params()[qualified("kind")]).toBe(1);
    expect(rig.params()[qualified("draws")]).toBe(drawCount({ ...DEFAULT_PARAMS, on: true, kind: "focus" }));
    expect(labels()).toEqual(["Radius", "Iterations", "Noise suppression", "Amount"]);
    expect(rig.commits).toEqual(["Blur Reduction: focus blur"]);
    act(() => void fireEvent.click(button("Gaussian")));
    expect(rig.params()[qualified("kind")]).toBe(2);
    expect(rig.commits.at(-1)).toBe("Blur Reduction: gaussian blur");
  });

  it("writes a drag live with its draw count and commits on release", () => {
    const { rig, slider } = setup(on);
    act(() => slider("Length").onChange(25));
    act(() => slider("Length").onChange(30));
    expect(rig.params()[qualified("streakLength")]).toBe(30);
    expect(rig.params()[qualified("draws")]).toBe(drawCount({ ...DEFAULT_PARAMS, on: true, streakLength: 30 }));
    expect(rig.commits).toEqual([]);
    act(() => slider("Length").onCommit?.());
    expect(rig.commits).toEqual(["Blur Reduction: length"]);
  });

  it("clamps what a typed value puts out of range", () => {
    const { rig, slider } = setup(on);
    act(() => slider("Angle").onChange(400));
    expect(rig.params()[qualified("streakAngle")]).toBe(90);
  });
});

describe("tracing a streak", () => {
  const drag = (el: Element, from: [number, number], to: [number, number]) => {
    fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: from[0], clientY: from[1] });
    fireEvent.pointerMove(el, { pointerId: 1, buttons: 1, clientX: to[0], clientY: to[1] });
    fireEvent.pointerUp(el, { pointerId: 1, clientX: to[0], clientY: to[1] });
  };

  function armed(params: Record<string, unknown> = {}) {
    const s = setup(params);
    act(() => void fireEvent.click(s.button("Trace streak")));
    const tool = s.rig.tool();
    if (!tool) throw new Error("the trace didn't take the canvas");
    const overlay = render(React.createElement(tool.overlay, { rect: { x: 0, y: 0, w: 100, h: 100 } }));
    const surface = () => overlay.container.querySelector("[data-trace-surface]") as Element;
    return { ...s, tool, surface };
  }

  it("takes the canvas, zoomable, and shows the button held", () => {
    const { tool, button } = armed();
    expect(tool.zoomable).toBe(true);
    expect(button("Trace streak").getAttribute("data-active")).toBe("true");
    expect(button("Trace streak").getAttribute("title")).toMatch(/Drag along a streak/);
  });

  it("sets Motion's length and angle from a drag, switches it on, and lets the canvas go", () => {
    const { rig, surface } = armed(bagPatch({ ...DEFAULT_PARAMS, streakLength: 3 }));
    // 1 % across and 1.5 % up of a 6000 x 4000 photo: 60 px right, 60 px up.
    act(() => drag(surface(), [100, 500], [110, 485]));
    expect(rig.params()[qualified("on")]).toBe(true);
    expect(rig.params()[qualified("kind")]).toBe(0);
    expect(rig.params()[qualified("streakLength")]).toBe(Math.round(Math.hypot(60, 60) * 2) / 2);
    expect(rig.params()[qualified("streakAngle")]).toBe(45);
    expect(rig.params()[qualified("draws")]).toBeGreaterThan(0);
    expect(rig.commits).toEqual(["Blur Reduction: trace streak"]);
    expect(rig.tool()).toBeNull();
  });

  it("ignores a click and stays armed", () => {
    const { rig, surface } = armed(on);
    act(() => drag(surface(), [100, 500], [102, 501]));
    expect(rig.commits).toEqual([]);
    expect(rig.tool()).not.toBeNull();
  });

  it("stands down when Escape or another tool takes the canvas", () => {
    const first = armed(on);
    act(() => first.tool.onEscape?.());
    act(() => first.rig.takeCanvas());
    expect(first.button("Trace streak").getAttribute("data-active")).toBe("false");
    act(() => void fireEvent.click(first.button("Trace streak")));
    expect(first.rig.tool()).not.toBeNull();
    act(() => first.rig.takeCanvas());
    expect(first.button("Trace streak").getAttribute("data-active")).toBe("false");
  });

  it("lets the canvas go when the button is pressed again", () => {
    const { rig, button } = armed(on);
    act(() => void fireEvent.click(button("Trace streak")));
    expect(rig.tool()).toBeNull();
  });
});

describe("tracing with the photo's panel and a mask's panel both open", () => {
  function both() {
    const rig = fakeApi(on);
    rig.setMasks([{ id: "m1", bag: on }]);
    activate(rig.api);
    const photo = render(<BlurPanel />);
    const mask = render(
      <MaskContext.Provider value="m1">
        <BlurPanel />
      </MaskContext.Provider>,
    );
    const traceButton = (view: typeof photo) => {
      const found = [...view.container.querySelectorAll("button")].find((b) => b.textContent === "Trace streak");
      if (!found) throw new Error("no Trace streak button");
      return found;
    };
    const held = (view: typeof photo) => traceButton(view).getAttribute("data-active");
    return { rig, photo, mask, traceButton, held };
  }

  it("shows only the panel that armed it as held, and hands over when the other arms", () => {
    const { photo, mask, traceButton, held } = both();
    act(() => void fireEvent.click(traceButton(mask)));
    expect([held(photo), held(mask)]).toEqual(["false", "true"]);
    act(() => void fireEvent.click(traceButton(photo)));
    expect([held(photo), held(mask)]).toEqual(["true", "false"]);
  });

  it("keeps the mask's trace armed when the photo's panel goes away or changes blur", () => {
    const { rig, photo, mask, traceButton, held } = both();
    act(() => void fireEvent.click(traceButton(mask)));
    const focus = [...photo.container.querySelectorAll("button")].find((b) => b.textContent === "Focus");
    act(() => void fireEvent.click(focus as Element));
    photo.unmount();
    expect(rig.tool()).not.toBeNull();
    expect(held(mask)).toBe("true");
  });
});
