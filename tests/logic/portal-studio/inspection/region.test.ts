import { describe, expect, it } from "vitest";

import {
  MAX_REGION_SAMPLE_POINTS,
  MAX_REGION_TARGETS,
  preferRegionTarget,
  pruneRegionTargets,
  sampleRegionPoints,
  semanticTargetScore,
  targetSignal,
} from "@/studio/inspection";
import { setElementRect } from "../../../setup/hit-test-shim";

describe("sampleRegionPoints (Goal 04 deterministic formula)", () => {
  it("includes the inset corners, the center and the cell centers", () => {
    const points = sampleRegionPoints({ x: 100, y: 100, width: 200, height: 100 });
    // inset = min(4, max(1, floor(100/8)=12)) = 4
    expect(points).toContainEqual({ x: 104, y: 104 });
    expect(points).toContainEqual({ x: 296, y: 104 });
    expect(points).toContainEqual({ x: 104, y: 196 });
    expect(points).toContainEqual({ x: 296, y: 196 });
    expect(points).toContainEqual({ x: 200, y: 150 });
    // columns = clamp(ceil(200/120)=2, 2, 8) = 2; rows = clamp(1, 2, 8) = 2
    expect(points).toContainEqual({ x: 150, y: 125 });
    expect(points).toContainEqual({ x: 250, y: 125 });
    expect(points).toContainEqual({ x: 150, y: 175 });
    expect(points).toContainEqual({ x: 250, y: 175 });
    expect(points).toHaveLength(9);
  });

  it("uses columns/rows = clamp(ceil(dimension / 120), 2, 8)", () => {
    // 480x480 -> ceil(4)=4 columns and rows -> 16 cells + 5 = 21
    // (no coordinate coincides with the rectangle center, so no dedup).
    expect(sampleRegionPoints({ x: 0, y: 0, width: 480, height: 480 })).toHaveLength(21);
    // 500x500 -> 25 cells + 5, but the rectangle center coincides with a
    // cell center -> deduplicated to 29.
    expect(sampleRegionPoints({ x: 0, y: 0, width: 500, height: 500 })).toHaveLength(29);
    // 2000x2000 -> capped at 8x8 -> 64 cells + 5 = 69
    const large = sampleRegionPoints({ x: 0, y: 0, width: 2000, height: 2000 });
    expect(large).toHaveLength(69);
    expect(large.length).toBeLessThanOrEqual(MAX_REGION_SAMPLE_POINTS);
    // 50x50 -> clamp(ceil(0.42)=1, 2, 8) = 2 -> 4 cells + 5
    expect(sampleRegionPoints({ x: 0, y: 0, width: 50, height: 50 })).toHaveLength(9);
  });

  it("never exceeds the 69-point cap and deduplicates coordinates", () => {
    const points = sampleRegionPoints({ x: 0, y: 0, width: 5000, height: 5000 });
    expect(points.length).toBeLessThanOrEqual(MAX_REGION_SAMPLE_POINTS);
    const keys = new Set(points.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`));
    expect(keys.size).toBe(points.length);
  });

  it("keeps tiny-region points inside the rectangle", () => {
    const points = sampleRegionPoints({ x: 0, y: 0, width: 1, height: 1 });
    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(1);
      expect(point.y).toBeLessThanOrEqual(1);
    }
  });
});

describe("target signals and scoring (Goal 04 documented priority)", () => {
  it("tier 1: business attributes dominate", () => {
    const business = document.createElement("div");
    business.setAttribute("data-nb-resource", "users");
    const interactive = document.createElement("button");
    interactive.textContent = "Save";
    const businessSignal = targetSignal(business);
    expect(businessSignal.business).toBe(true);
    expect(semanticTargetScore(business)).toBeGreaterThan(
      semanticTargetScore(interactive)
    );
  });

  it("tier 2: interactive/ARIA beats plain content", () => {
    const interactive = document.createElement("button");
    interactive.textContent = "Save";
    const plain = document.createElement("div");
    plain.textContent = "Save";
    expect(targetSignal(interactive).interactive).toBe(true);
    expect(semanticTargetScore(interactive)).toBeGreaterThan(
      semanticTargetScore(plain)
    );
    const aria = document.createElement("div");
    aria.setAttribute("aria-label", "menu");
    expect(targetSignal(aria).interactive).toBe(true);
  });

  it("tier 3: identity and tier 4: content contribute", () => {
    const withId = document.createElement("div");
    withId.id = "card-1";
    const withText = document.createElement("div");
    withText.textContent = "meaningful";
    const bare = document.createElement("div");
    expect(semanticTargetScore(withId)).toBeGreaterThan(semanticTargetScore(bare));
    expect(semanticTargetScore(withText)).toBeGreaterThan(semanticTargetScore(bare));
    expect(targetSignal(withText).content).toBe(true);
  });

  it("preferRegionTarget: business > interactive > identity > content > specificity", () => {
    const section = document.createElement("section");
    section.setAttribute("data-nb-resource", "users");
    const button = document.createElement("button");
    button.id = "btn";
    button.textContent = "Save";
    // Business tier dominates even when the descendant has every other signal.
    expect(preferRegionTarget(button, section)).toBe(section);
    expect(preferRegionTarget(section, button)).toBe(section);

    const interactive = document.createElement("button");
    interactive.textContent = "Save";
    const identity = document.createElement("div");
    identity.id = "wrapper";
    expect(preferRegionTarget(identity, interactive)).toBe(interactive);

    // Exact signal ties: smaller area, then deeper, then first-seen.
    const outer = document.createElement("div");
    outer.id = "outer";
    const inner = document.createElement("div");
    inner.id = "inner";
    outer.append(inner);
    document.body.append(outer);
    setElementRect(outer, { x: 0, y: 0, width: 100, height: 100 });
    setElementRect(inner, { x: 10, y: 10, width: 20, height: 20 });
    expect(preferRegionTarget(outer, inner)).toBe(inner);
    expect(preferRegionTarget(inner, outer)).toBe(inner);
  });
});

describe("pruneRegionTargets", () => {
  it("keeps the semantic descendant over a layout-only ancestor", () => {
    const section = document.createElement("section");
    const button = document.createElement("button");
    button.textContent = "Save";
    section.append(button);
    document.body.append(section);
    const pruned = pruneRegionTargets([section, button]);
    expect(pruned).toEqual([button]);
  });

  it("keeps the business-marked ancestor over a plain interactive descendant", () => {
    const section = document.createElement("section");
    section.setAttribute("data-nb-resource", "users");
    const button = document.createElement("button");
    button.textContent = "Save";
    section.append(button);
    document.body.append(section);
    const pruned = pruneRegionTargets([section, button]);
    expect(pruned).toEqual([section]);
  });

  it("removes an ancestor that adds no unique business/text context", () => {
    const wrapper = document.createElement("div");
    const button = document.createElement("button");
    button.textContent = "Save";
    wrapper.append(button);
    document.body.append(wrapper);
    // wrapper text == button text and no business attrs → context-free.
    const pruned = pruneRegionTargets([wrapper, button]);
    expect(pruned).toEqual([button]);
  });

  it("keeps an ancestor whose text adds unique context", () => {
    const wrapper = document.createElement("div");
    wrapper.textContent = "Billing section";
    const button = document.createElement("button");
    button.textContent = "Save";
    wrapper.append(button);
    document.body.append(wrapper);
    const pruned = pruneRegionTargets([wrapper, button]);
    expect(pruned).toEqual([wrapper, button]);
  });

  it("keeps distinct sibling cards and preserves first-seen order", () => {
    const cardA = document.createElement("div");
    cardA.className = "card";
    const cardB = document.createElement("div");
    cardB.className = "card";
    document.body.append(cardA, cardB);
    const pruned = pruneRegionTargets([cardA, cardB]);
    expect(pruned).toEqual([cardA, cardB]);
    expect(pruned.length).toBeLessThanOrEqual(MAX_REGION_TARGETS);
  });

  it("keeps the descendant on exact signal ties (both input orders)", () => {
    const outer = document.createElement("div");
    outer.id = "outer";
    const inner = document.createElement("div");
    inner.id = "inner";
    outer.append(inner);
    document.body.append(outer);
    setElementRect(outer, { x: 0, y: 0, width: 100, height: 100 });
    setElementRect(inner, { x: 10, y: 10, width: 20, height: 20 });
    expect(pruneRegionTargets([outer, inner])).toEqual([inner]);
    expect(pruneRegionTargets([inner, outer])).toEqual([inner]);
  });
});

describe("pruneRegionTargets — multi-level chains (order independent)", () => {
  const buildNestedChain = () => {
    const n1 = document.createElement("div");
    n1.id = "nested-1";
    const n2 = document.createElement("div");
    n2.id = "nested-2";
    const n3 = document.createElement("div");
    n3.id = "nested-3";
    const button = document.createElement("button");
    button.id = "nested-button";
    button.textContent = "Deep button";
    n3.append(button);
    n2.append(n3);
    n1.append(n2);
    document.body.append(n1);
    setElementRect(n1, { x: 0, y: 0, width: 380, height: 170 });
    setElementRect(n2, { x: 10, y: 10, width: 360, height: 130 });
    setElementRect(n3, { x: 20, y: 20, width: 340, height: 90 });
    setElementRect(button, { x: 30, y: 30, width: 170, height: 44 });
    return { n1, n2, n3, button };
  };

  it("keeps only the deep button regardless of the input order", () => {
    const { n1, n2, n3, button } = buildNestedChain();
    // Browser-like order: layout ancestors can arrive before or after the
    // deepest elements depending on the sample points.
    expect(pruneRegionTargets([n1, n2, n3, button]).map((e) => e.id)).toEqual([
      "nested-button",
    ]);
    expect(pruneRegionTargets([button, n3, n2, n1]).map((e) => e.id)).toEqual([
      "nested-button",
    ]);
    expect(
      pruneRegionTargets([n2, n1, button, n3]).map((e) => e.id)
    ).toEqual(["nested-button"]);
  });
});
