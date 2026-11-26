// A stand-in Safelight API for unit tests, over real React and zustand. It has
// only what this extension uses: reading any other member throws, naming it,
// so a test shows what to add here when the extension starts using more.
//
// The photo's edit is a param bag in a zustand store, so a panel re-renders
// when it changes. Core's Slider is a stub that keeps the props it was last
// drawn with, so a test can drive a drag and its release; the kit's controls
// are plain DOM. The canvas tool is held in a store too, so the panel sees it
// taken and let go. A panel drawn inside MaskContext gets that mask's scope,
// as a mask's Adjust tab would give it. The canvas tool's overlay maps a frame point (x, y) to source UV
// (x / 1000, y / 1000), and framePoint passes client coordinates through.

import * as React from "react";
import { create } from "zustand";
import type {
  ButtonProps,
  CanvasTool,
  DevelopOverlayState,
  PanelContribution,
  ParamScope,
  ProcessingStageContribution,
  SafelightAPI,
  SegmentedControlProps,
  SliderProps,
  StackProps,
  ToggleProps,
} from "../../src/safelight";
import { EXT_ID as EXTENSION_ID } from "../../src/params";

/** The members of SafelightAPI this fake implements, typed against the real thing. */
type FakeMembers = Pick<
  SafelightAPI,
  "version" | "extensionId" | "react" | "registerPanel" | "registerProcessingStage" | "unregisterProcessingStage"
> & {
  components: Pick<SafelightAPI["components"], "Slider">;
  develop: Pick<SafelightAPI["develop"], "useParamScope" | "setCanvasTool" | "useCanvasToolHeld" | "useDevelopOverlay" | "framePoint">;
  ui: Pick<SafelightAPI["ui"], "Button" | "SegmentedControl" | "Stack" | "Toggle">;
  stores: Pick<SafelightAPI["stores"], "create" | "useDevelopStore">;
  cursors: Pick<SafelightAPI["cursors"], "resolve">;
};

/** The develop store's members this extension touches. */
interface FakeDevelop {
  paramBag: Record<string, unknown>;
  params: { masks: { id: string; bag?: Record<string, unknown> }[] };
  sourceSize: { width: number; height: number; fullWidth: number; fullHeight: number; native: boolean };
  setDynParams(patch: Record<string, unknown>): void;
  updateMaskBag(id: string, patch: Record<string, unknown>): void;
  commitEdit(label: string): Promise<void>;
}

export interface Rig {
  api: SafelightAPI;
  panels: PanelContribution[];
  stages: ProcessingStageContribution[];
  /** The photo's param bag, by qualified key, without defaults. */
  params(): Readonly<Record<string, unknown>>;
  /** The labels of the undo steps the extension made, in order. */
  commits: string[];
  /** The latest props of each slider drawn in `root`, in document order. */
  sliders(root: ParentNode): SliderProps[];
  /** Replaces the photo's bag from outside the panel, as an undo or a paste would. */
  replace(params: Record<string, unknown>): void;
  /** Replaces the photo's masks, as adding one or pasting into one would. */
  setMasks(masks: { id: string; bag?: Record<string, unknown> }[]): void;
  maskBag(id: string): Readonly<Record<string, unknown>> | undefined;
  /** The canvas tool the extension holds, or null. */
  tool(): CanvasTool | null;
  /** Another extension or core takes the canvas. */
  takeCanvas(): void;
}

export function fakeApi(initial: Record<string, unknown> = {}, source = { fullWidth: 6000, fullHeight: 4000 }): Rig {
  const panels: PanelContribution[] = [];
  const stages: ProcessingStageContribution[] = [];
  const commits: string[] = [];
  const develop = create<FakeDevelop>()((set) => ({
    paramBag: { ...initial },
    params: { masks: [] },
    sourceSize: { width: 1500, height: 1000, ...source, native: false },
    setDynParams: (patch) => set((s) => ({ paramBag: { ...s.paramBag, ...patch } })),
    updateMaskBag: (id, patch) =>
      set((s) => ({
        params: { masks: s.params.masks.map((m) => (m.id === id ? { ...m, bag: { ...m.bag, ...patch } } : m)) },
      })),
    commitEdit: async (label) => void commits.push(label),
  }));
  const canvas = create<{ tool: CanvasTool | null }>()(() => ({ tool: null }));
  const sliderProps = new Map<number, SliderProps>();
  let nextSlider = 0;

  function useParamScope(): ParamScope {
    const maskId = React.useContext(MaskContext);
    develop((s) => (maskId ? s.params.masks.find((m) => m.id === maskId)?.bag : s.paramBag));
    if (maskId) {
      const bag = () => develop.getState().params.masks.find((m) => m.id === maskId)?.bag ?? {};
      return {
        maskId,
        getParam: (key) => bag()[key],
        getParams: () => bag(),
        setParams: (patch) => develop.getState().updateMaskBag(maskId, patch),
        commit: (label) => void commits.push(label),
      };
    }
    return {
      maskId: null,
      getParam: (key) => develop.getState().paramBag[key],
      getParams: () => develop.getState().paramBag,
      setParams: (patch) => develop.getState().setDynParams(patch),
      commit: (label) => void commits.push(label),
    };
  }

  function Slider(props: SliderProps) {
    const id = React.useRef(nextSlider++).current;
    sliderProps.set(id, props);
    return React.createElement("div", { "data-slider": id }, `${props.label} ${props.value}`);
  }

  const overlayState = {
    rect: { x: 0, y: 0, w: 1000, h: 1000 },
    imageRect: { x: 0, y: 0, w: 1000, h: 1000 },
    nonce: 0,
    toScreen: (u: number, v: number) => ({ x: u * 1000, y: v * 1000 }),
    toImage: (x: number, y: number) => ({ x: x / 1000, y: y / 1000 }),
  } as unknown as DevelopOverlayState;

  const members: FakeMembers = {
    version: 1,
    extensionId: EXTENSION_ID,
    react: React,
    registerPanel: (c) => void panels.push(c),
    registerProcessingStage: (c) => void stages.push(c),
    unregisterProcessingStage: () => {},
    components: { Slider },
    develop: {
      useParamScope,
      setCanvasTool: (tool) => canvas.setState({ tool }),
      useCanvasToolHeld: () => canvas((s) => s.tool !== null),
      useDevelopOverlay: () => overlayState,
      framePoint: (_el, clientX, clientY) => ({ x: clientX, y: clientY }),
    },
    ui: ui as unknown as FakeMembers["ui"],
    stores: { create, useDevelopStore: develop as unknown as SafelightAPI["stores"]["useDevelopStore"] },
    cursors: { resolve: (token) => token },
  };

  return {
    api: strict(members, "api") as unknown as SafelightAPI,
    panels,
    stages,
    params: () => develop.getState().paramBag,
    commits,
    replace: (params) => develop.setState({ paramBag: { ...params } }),
    setMasks: (masks) => develop.setState({ params: { masks } }),
    maskBag: (id) => develop.getState().params.masks.find((m) => m.id === id)?.bag,
    sliders: (root) =>
      [...root.querySelectorAll("[data-slider]")].map((el) => {
        const props = sliderProps.get(Number(el.getAttribute("data-slider")));
        if (!props) throw new Error("a slider without props");
        return props;
      }),
    tool: () => canvas.getState().tool,
    takeCanvas: () => canvas.setState({ tool: null }),
  };
}

const e = React.createElement;

/** The mask whose Adjust tab a panel is drawn in, or null for the photo's own panel. */
export const MaskContext = React.createContext<string | null>(null);

const ui = {
  Stack: (props: StackProps) => e("div", { "data-stack": "" }, props.children),
  Button: ({ active, variant, size, full, ...rest }: ButtonProps) => e("button", { ...rest, "data-active": String(!!active), "data-variant": variant, "data-size": size, "data-full": full }),
  Toggle: (props: ToggleProps) =>
    e(
      "label",
      null,
      e("input", { type: "checkbox", checked: props.checked, onChange: (ev: { target: { checked: boolean } }) => props.onChange(ev.target.checked) }),
      props.label,
    ),
  SegmentedControl: (props: SegmentedControlProps) =>
    e(
      "div",
      { role: "radiogroup" },
      props.options.map((o) =>
        e("button", { key: o.value, role: "radio", "aria-checked": o.value === props.value, onClick: () => props.onChange(o.value) }, o.label),
      ),
    ),
};

/** Wraps a plain object so reading a member it lacks throws, naming the member. */
function strict<T extends object>(target: T, path: string): T {
  return new Proxy(target, {
    get(obj, key, receiver) {
      if (typeof key === "symbol" || key === "then" || key === "toJSON") return Reflect.get(obj, key, receiver);
      if (!(key in obj)) throw new Error(`The fake API has no ${path}.${key}. Add it to test/support/fake-api.ts.`);
      const value: unknown = Reflect.get(obj, key, receiver);
      const isPlainObject = typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype;
      return isPlainObject && key !== "react" ? strict(value, `${path}.${key}`) : value;
    },
  });
}
