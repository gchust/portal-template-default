/**
 * Goal 01 v5 review — focused logic tests for the shared anchored-placement
 * math (placement.ts): anchored-panel flipping/clamping and tooltip
 * above/below placement. Pure math over plain rects.
 */
import { describe, expect, it } from "vitest";

import {
  PLACEMENT_MARGIN,
  resolveAnchoredPlacement,
  resolveTooltipPlacement,
} from "@/studio/placement";

const VIEWPORT = { width: 1280, height: 800 };
const trigger = {
  left: 400,
  top: 300,
  right: 440,
  bottom: 330,
  width: 40,
  height: 30,
};

describe("resolveAnchoredPlacement", () => {
  it("places BELOW the trigger by default", () => {
    const p = resolveAnchoredPlacement({
      trigger,
      viewport: VIEWPORT,
      width: 300,
      maxHeight: 400,
    });
    expect(p.top).toBe(330 + 8);
    expect(p.left).toBe(400);
    expect(p.width).toBe(300);
    expect(p.maxHeight).toBe(400);
  });

  it("flips ABOVE when there is not enough room below", () => {
    const nearBottom = {
      ...trigger,
      top: 700,
      bottom: 730,
    };
    const p = resolveAnchoredPlacement({
      trigger: nearBottom,
      viewport: VIEWPORT,
      width: 300,
      maxHeight: 400,
    });
    // Above: panel bottom sits at trigger top − gap.
    expect(p.top + p.maxHeight).toBe(700 - 8);
    expect(p.top).toBeGreaterThanOrEqual(PLACEMENT_MARGIN);
  });

  it("near-right trigger RIGHT-ALIGNS to the trigger when that placement fits (round-6 blocker 1)", () => {
    const rightEdge = {
      ...trigger,
      left: 1200,
      right: 1240,
    };
    const p = resolveAnchoredPlacement({
      trigger: rightEdge,
      viewport: VIEWPORT,
      width: 300,
      maxHeight: 400,
    });
    // 1200 + 300 would overflow (1500 > 1276), so the panel's RIGHT edge
    // aligns to the trigger's right edge (1240) — and it fits.
    expect(p.left).toBe(1240 - 300);
    expect(p.left + p.width).toBe(1240);
    expect(p.left + p.width).toBeLessThanOrEqual(VIEWPORT.width);
  });

  it("a trigger fully OFF the right viewport still clamps the panel inside (round-6 blocker 1)", () => {
    const offScreen = {
      ...trigger,
      left: 5000,
      right: 5040,
    };
    const p = resolveAnchoredPlacement({
      trigger: offScreen,
      viewport: VIEWPORT,
      width: 300,
      maxHeight: 400,
    });
    expect(p.left).toBeGreaterThanOrEqual(0);
    expect(p.left + p.width).toBeLessThanOrEqual(VIEWPORT.width);
  });

  it("caps the width and maxHeight to the viewport", () => {
    const p = resolveAnchoredPlacement({
      trigger,
      viewport: { width: 100, height: 60 },
      width: 500,
      maxHeight: 500,
    });
    expect(p.width).toBeLessThanOrEqual(100 - PLACEMENT_MARGIN * 2);
    expect(p.maxHeight).toBeLessThanOrEqual(60 - PLACEMENT_MARGIN * 2);
    expect(p.left).toBeGreaterThanOrEqual(0);
    expect(p.top).toBeGreaterThanOrEqual(0);
  });

  it("never leaves the viewport in any direction", () => {
    for (const pos of [
      { left: -500, top: -500, right: -460, bottom: -470, width: 40, height: 30 },
      { left: 2000, top: 3000, right: 2040, bottom: 3030, width: 40, height: 30 },
      { left: 600, top: 400, right: 640, bottom: 430, width: 40, height: 30 },
    ]) {
      const p = resolveAnchoredPlacement({
        trigger: pos,
        viewport: VIEWPORT,
        width: 320,
        maxHeight: 300,
      });
      expect(p.left).toBeGreaterThanOrEqual(0);
      expect(p.top).toBeGreaterThanOrEqual(0);
      expect(p.left + p.width).toBeLessThanOrEqual(VIEWPORT.width);
      expect(p.top + p.maxHeight).toBeLessThanOrEqual(VIEWPORT.height);
    }
  });
});

describe("resolveAnchoredPlacement — rendered surfaceHeight anchoring (round-4 finding 5)", () => {
  it("above-flip uses the RENDERED surface height, not maxHeight, so the panel hugs the trigger", () => {
    const nearBottom = { ...trigger, top: 700, bottom: 730 };
    // maxHeight is 400 but the real surface is only 120 tall: the panel
    // bottom must sit exactly gap above the trigger top (700 - 8),
    // NOT 400 - 8 above it.
    const p = resolveAnchoredPlacement({
      trigger: nearBottom,
      viewport: VIEWPORT,
      width: 300,
      maxHeight: 400,
      surfaceHeight: 120,
    });
    expect(p.top + 120).toBe(700 - 8);
    expect(p.top).toBeGreaterThan(700 - 8 - 400);
  });

  it("explicit above preference with a short surface anchors its bottom at the trigger top", () => {
    const p = resolveAnchoredPlacement({
      trigger,
      viewport: VIEWPORT,
      width: 300,
      maxHeight: 400,
      surfaceHeight: 90,
      preferredSide: "above",
    });
    expect(p.top + 90).toBe(300 - 8);
  });

  it("below placement is unchanged by surfaceHeight (bottom edge + gap)", () => {
    const p = resolveAnchoredPlacement({
      trigger,
      viewport: VIEWPORT,
      width: 300,
      maxHeight: 400,
      surfaceHeight: 90,
    });
    expect(p.top).toBe(330 + 8);
  });

  it("clamps the above anchor with the surface height inside the viewport", () => {
    const nearTop = { ...trigger, top: 30, bottom: 60 };
    const p = resolveAnchoredPlacement({
      trigger: nearTop,
      viewport: VIEWPORT,
      width: 300,
      maxHeight: 400,
      surfaceHeight: 300,
      preferredSide: "above",
    });
    expect(p.top).toBeGreaterThanOrEqual(PLACEMENT_MARGIN);
    expect(p.top + 300).toBeLessThanOrEqual(VIEWPORT.height);
  });
});

describe("resolveTooltipPlacement", () => {
  it("places ABOVE the trigger when there is room", () => {
    const p = resolveTooltipPlacement({
      trigger,
      viewport: VIEWPORT,
      tooltipWidth: 120,
      tooltipHeight: 28,
    });
    expect(p.top + 28).toBe(300 - 6);
    // Horizontally centered on the trigger.
    expect(p.left).toBe(400 + 20 - 60);
  });

  it("flips BELOW near the top edge", () => {
    const nearTop = { ...trigger, top: 4, bottom: 34 };
    const p = resolveTooltipPlacement({
      trigger: nearTop,
      viewport: VIEWPORT,
      tooltipWidth: 120,
      tooltipHeight: 28,
    });
    expect(p.top).toBe(34 + 6);
  });

  it("clamps horizontally at both edges", () => {
    const atLeft = { ...trigger, left: 0, right: 40 };
    const leftP = resolveTooltipPlacement({
      trigger: atLeft,
      viewport: VIEWPORT,
      tooltipWidth: 120,
      tooltipHeight: 28,
    });
    expect(leftP.left).toBeGreaterThanOrEqual(PLACEMENT_MARGIN);

    const atRight = { ...trigger, left: VIEWPORT.width - 40, right: VIEWPORT.width };
    const rightP = resolveTooltipPlacement({
      trigger: atRight,
      viewport: VIEWPORT,
      tooltipWidth: 120,
      tooltipHeight: 28,
    });
    expect(rightP.left + 120).toBeLessThanOrEqual(VIEWPORT.width - PLACEMENT_MARGIN + 1);
  });
});
