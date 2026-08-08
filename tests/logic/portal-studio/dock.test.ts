/**
 * Goal 01 — dock geometry & persistence (D-033 #2/#3, D-034 #5/#6).
 * Pure math over plain objects: clamping (edges/oversized), keyboard
 * moves, load/save round-trips (incl. invalid stored values), defaults,
 * and the expanded-panel layout (above-anchored with bottom-flip).
 */
import { describe, expect, it } from "vitest";

import {
  clampDockPosition,
  defaultDockPosition,
  DOCK_STORAGE_KEY,
  KEYBOARD_FAST_STEP_PX,
  KEYBOARD_STEP_PX,
  loadDockPosition,
  moveDockPosition,
  resolveDockLayout,
  saveDockPosition,
  TOGGLE_SIZE,
} from "@/studio/dock";

const VIEWPORT = { width: 1280, height: 720 };
const DOCK_WIDTH = 112;

const memoryStorage = (initial?: Record<string, string>) => {
  const data: Record<string, string> = { ...(initial ?? {}) };
  return {
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
    dump: () => data,
  };
};

describe("defaultDockPosition", () => {
  it("anchors bottom-right with the standard margin", () => {
    expect(defaultDockPosition(VIEWPORT, DOCK_WIDTH)).toEqual({
      x: 1280 - DOCK_WIDTH - 16,
      y: 720 - TOGGLE_SIZE - 16,
    });
  });

  it("never goes negative on tiny viewports", () => {
    expect(defaultDockPosition({ width: 50, height: 30 }, DOCK_WIDTH)).toEqual({
      x: 0,
      y: 0,
    });
  });
});

describe("clampDockPosition", () => {
  it("clamps beyond the right/bottom edges (whole row stays visible)", () => {
    expect(
      clampDockPosition({ x: 99999, y: 99999 }, VIEWPORT, DOCK_WIDTH)
    ).toEqual({ x: VIEWPORT.width - DOCK_WIDTH, y: VIEWPORT.height - TOGGLE_SIZE });
  });

  it("clamps negative coordinates to 0", () => {
    expect(clampDockPosition({ x: -40, y: -10 }, VIEWPORT, DOCK_WIDTH)).toEqual({
      x: 0,
      y: 0,
    });
  });

  it("rounds fractional input and keeps in-viewport positions", () => {
    expect(
      clampDockPosition({ x: 10.6, y: 20.4 }, VIEWPORT, DOCK_WIDTH)
    ).toEqual({ x: 11, y: 20 });
  });

  it("treats a viewport smaller than the dock as a zero anchor", () => {
    expect(
      clampDockPosition({ x: 5, y: 5 }, { width: 40, height: 30 }, DOCK_WIDTH)
    ).toEqual({ x: 0, y: 0 });
  });
});

describe("moveDockPosition (keyboard)", () => {
  it("moves by the normal step and clamps", () => {
    const start = { x: 500, y: 500 };
    expect(
      moveDockPosition(start, { dx: -1, dy: 0 }, VIEWPORT, KEYBOARD_STEP_PX, DOCK_WIDTH)
    ).toEqual({ x: 500 - KEYBOARD_STEP_PX, y: 500 });
    expect(
      moveDockPosition(start, { dx: 0, dy: 1 }, VIEWPORT, KEYBOARD_STEP_PX, DOCK_WIDTH)
    ).toEqual({ x: 500, y: 500 + KEYBOARD_STEP_PX });
  });

  it("uses the larger Shift step and never escapes the viewport", () => {
    const nearEdge = { x: 0, y: 0 };
    expect(
      moveDockPosition(nearEdge, { dx: -1, dy: -1 }, VIEWPORT, KEYBOARD_FAST_STEP_PX, DOCK_WIDTH)
    ).toEqual({ x: 0, y: 0 });
    const atRight = { x: VIEWPORT.width - DOCK_WIDTH, y: 0 };
    expect(
      moveDockPosition(atRight, { dx: 1, dy: 0 }, VIEWPORT, KEYBOARD_FAST_STEP_PX, DOCK_WIDTH)
    ).toEqual(atRight);
  });
});

describe("persistence (portal-studio.dock)", () => {
  it("round-trips a valid position", () => {
    const storage = memoryStorage();
    saveDockPosition(storage, { x: 123, y: 456 });
    expect(storage.dump()[DOCK_STORAGE_KEY]).toBe('{"x":123,"y":456}');
    expect(loadDockPosition(storage)).toEqual({ x: 123, y: 456 });
  });

  it("returns null for missing, malformed, or invalid values", () => {
    expect(loadDockPosition(memoryStorage())).toBeNull();
    expect(loadDockPosition(memoryStorage({ [DOCK_STORAGE_KEY]: "not json" }))).toBeNull();
    expect(loadDockPosition(memoryStorage({ [DOCK_STORAGE_KEY]: '{"x":"a","y":1}' }))).toBeNull();
    expect(loadDockPosition(memoryStorage({ [DOCK_STORAGE_KEY]: '{"x":1}' }))).toBeNull();
    expect(loadDockPosition(memoryStorage({ [DOCK_STORAGE_KEY]: '{"x":Infinity,"y":1}' }))).toBeNull();
  });

  it("degrades silently when storage throws (privacy mode)", () => {
    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(loadDockPosition(throwing)).toBeNull();
    expect(() => saveDockPosition(throwing, { x: 1, y: 2 })).not.toThrow();
  });

  it("accepts null/undefined storage", () => {
    expect(loadDockPosition(null)).toBeNull();
    expect(loadDockPosition(undefined)).toBeNull();
    expect(() => saveDockPosition(null, { x: 1, y: 2 })).not.toThrow();
  });
});

describe("resolveDockLayout", () => {
  const input = {
    position: { x: 100, y: 400 },
    viewport: VIEWPORT,
    expanded: true,
    dockWidth: DOCK_WIDTH,
  };

  it("clamps the toggle into the viewport", () => {
    const layout = resolveDockLayout({
      ...input,
      position: { x: -50, y: 99999 },
    });
    expect(layout.toggle).toEqual({ left: 0, top: VIEWPORT.height - TOGGLE_SIZE });
  });

  it("anchors the panel ABOVE the toggle when there is space", () => {
    const layout = resolveDockLayout(input);
    // panel bottom = toggle top − gap, expressed via `bottom` in fixed terms
    expect(layout.panel.bottom).toBe(VIEWPORT.height - 400 + 8);
    expect(layout.panel.maxHeight).toBe(400 - 16);
  });

  it("flips the panel BELOW the toggle at the top of the viewport", () => {
    const layout = resolveDockLayout({
      ...input,
      position: { x: 100, y: 0 },
    });
    expect(layout.panel.top).toBe(0 + TOGGLE_SIZE + 8);
    expect(layout.panel.bottom).toBeUndefined();
    expect(layout.panel.maxHeight).toBe(VIEWPORT.height - (TOGGLE_SIZE + 8) - 8);
  });

  it("clamps the panel left so it never overflows the right edge", () => {
    const layout = resolveDockLayout({
      ...input,
      position: { x: VIEWPORT.width - 10, y: 400 },
    });
    expect(layout.panel.left).toBe(VIEWPORT.width - 320);
  });

  it("collapsed layout carries the toggle position only", () => {
    const layout = resolveDockLayout({ ...input, expanded: false });
    expect(layout.toggle).toEqual({ left: 100, top: 400 });
  });
});
