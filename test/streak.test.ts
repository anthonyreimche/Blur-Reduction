import { describe, expect, it } from "vitest";
import { streakFrom } from "../src/streak";

const W = 6000;
const H = 4000;
const uv = (x: number, y: number) => ({ x: x / W, y: y / H });

describe("streakFrom", () => {
  it("measures the length in the full-size photo's pixels", () => {
    expect(streakFrom(uv(100, 100), uv(130, 140), W, H)?.streakLength).toBe(50);
  });

  it("turns counter-clockwise from horizontal, rows running down", () => {
    expect(streakFrom(uv(0, 0), uv(40, 0), W, H)?.streakAngle).toBe(0);
    expect(streakFrom(uv(0, 100), uv(40, 60), W, H)?.streakAngle).toBe(45);
    expect(streakFrom(uv(0, 0), uv(40, 40), W, H)?.streakAngle).toBe(-45);
    expect(streakFrom(uv(0, 100), uv(0, 0), W, H)?.streakAngle).toBe(90);
  });

  it("reads a streak the same either way along it", () => {
    expect(streakFrom(uv(40, 60), uv(0, 100), W, H)).toEqual(streakFrom(uv(0, 100), uv(40, 60), W, H));
    expect(streakFrom(uv(0, 0), uv(0, 100), W, H)?.streakAngle).toBe(90);
    expect(streakFrom(uv(40, 0), uv(0, 0), W, H)?.streakAngle).toBe(0);
  });

  it("snaps to the sliders' steps and clamps to their ranges", () => {
    expect(streakFrom(uv(0, 0), uv(12.3, 0), W, H)).toEqual({ streakLength: 12.5, streakAngle: 0 });
    expect(streakFrom(uv(0, 0), uv(500, 0), W, H)?.streakLength).toBe(100);
    expect(Object.is(streakFrom(uv(0, 0), uv(40, 0.01), W, H)?.streakAngle, -0)).toBe(false);
  });

  it("refuses a trace under a pixel, or without a photo size", () => {
    expect(streakFrom(uv(0, 0), uv(0.5, 0.5), W, H)).toBeNull();
    expect(streakFrom({ x: 0, y: 0 }, { x: 0.5, y: 0 }, 0, 0)).toBeNull();
  });
});
