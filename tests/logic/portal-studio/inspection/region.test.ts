import { describe, expect, it } from "vitest";

import {
  MAX_REGION_SAMPLE_POINTS,
  MAX_REGION_TARGETS,
  pruneRegionTargets,
  sampleRegionPoints,
  semanticTargetScore,
} from "@/studio/inspection";
import { setElementRect } from "../../../setup/hit-test-shim";

describe("sampleRegionPoints", () => {
  it("always includes the corners and the center", () => {
    const points = sampleRegionPoints({ x: 100, y: 100, width: 200, height: 100 });
    expect(points).toContainEqual({ x: 100, y: 100 });
    expect(points).toContainEqual({ x: 299, y: 100 });
    expect(points).toContainEqual({ x: 100, y: 199 });
    expect(points).toContainEqual({ x: 299, y: 199 });
    expect(points).toContainEqual({ x: 200, y: 150 });
  });

  it("bounded adaptive grid never exceeds the point cap", () => {
    const points = sampleRegionPoints({ x: 0, y: 0, width: 5000, height: 5000 });
    expect(points.length).toBeLessThanOrEqual(MAX_REGION_SAMPLE_POINTS);
    expect(points.length).toBeGreaterThan(5);
  });

  it("returns only corners/center for tiny regions", () => {
    const points = sampleRegionPoints({ x: 0, y: 0, width: 1, height: 1 });
    expect(points).toHaveLength(5);
  });
});

describe("semanticTargetScore", () => {
  it("prefers business elements, interactive targets and id-bearing elements", () => {
    const business = document.createElement("div");
    business.setAttribute("data-nb-resource", "users");
    const interactive = document.createElement("button");
    const plain = document.createElement("div");
    plain.id = "plain";
    const bare = document.createElement("div");
    expect(semanticTargetScore(business)).toBeGreaterThan(
      semanticTargetScore(interactive)
    );
    expect(semanticTargetScore(interactive)).toBeGreaterThan(
      semanticTargetScore(plain)
    );
    expect(semanticTargetScore(plain)).toBeGreaterThan(
      semanticTargetScore(bare)
    );
  });
});

describe("pruneRegionTargets", () => {
  it("keeps the descendant when an ancestor and descendant are both sampled", () => {
    const section = document.createElement("section");
    const button = document.createElement("button");
    section.append(button);
    document.body.append(section);
    const pruned = pruneRegionTargets([section, button]);
    expect(pruned).toEqual([button]);
  });

  it("keeps the higher-scored ancestor when it is more semantic", () => {
    const section = document.createElement("section");
    section.setAttribute("data-nb-resource", "users");
    const button = document.createElement("button");
    section.append(button);
    document.body.append(section);
    const pruned = pruneRegionTargets([section, button]);
    expect(pruned).toEqual([section]);
  });

  it("keeps unrelated siblings untouched and bounded", () => {
    const a = document.createElement("button");
    const b = document.createElement("button");
    document.body.append(a, b);
    const pruned = pruneRegionTargets([a, b]);
    expect(pruned).toEqual([a, b]);
    expect(pruned.length).toBeLessThanOrEqual(MAX_REGION_TARGETS);
  });
});

describe("pruneRegionTargets — tie-break keeps the descendant in both orders", () => {
  const tieFixture = () => {
    // Exact tie at 3: section has a business attribute (+3); the button is
    // interactive (+2) with an id (+1).
    const section = document.createElement("section");
    section.setAttribute("data-nb-resource", "users");
    const button = document.createElement("button");
    button.id = "btn";
    section.append(button);
    document.body.append(section);
    return { section, button };
  };

  it("keeps the descendant when scores tie (ancestor first)", () => {
    const { section, button } = tieFixture();
    expect(semanticTargetScore(section)).toBe(semanticTargetScore(button));
    const pruned = pruneRegionTargets([section, button]);
    expect(pruned).toEqual([button]);
  });

  it("keeps the descendant when scores tie (descendant first)", () => {
    const { section, button } = tieFixture();
    expect(semanticTargetScore(section)).toBe(semanticTargetScore(button));
    const pruned = pruneRegionTargets([button, section]);
    expect(pruned).toEqual([button]);
  });
});
