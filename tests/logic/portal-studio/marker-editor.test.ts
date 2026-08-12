/**
 * Goal 03 — marker-local editor geometry (pure, testable).
 * resolveMarkerEditorPosition: prefers bottom-right, flips above when
 * there is no room below, clamps inside the viewport on every edge.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  MARKER_EDITOR_GAP,
  MARKER_EDITOR_HEIGHT,
  MARKER_EDITOR_WIDTH,
  MARKER_FOOTPRINT,
  resolveMarkerCollisions,
  resolveMarkerEditorPosition,
  resolveAnnotationTargets,
} from "@/studio/markers";
import type { Annotation } from "@/studio/types";

const VIEWPORT = { width: 1280, height: 720 };
const EDITOR = { width: MARKER_EDITOR_WIDTH, height: MARKER_EDITOR_HEIGHT };

const markerAt = (left: number, top: number, width = 100, height = 40) => ({
  left,
  top,
  width,
  height,
});

describe("resolveMarkerEditorPosition — default bottom-right preference", () => {
  it("places the editor below-right of a marker in the middle of the page", () => {
    const pos = resolveMarkerEditorPosition(
      markerAt(600, 300),
      VIEWPORT,
      EDITOR
    );
    // Below the marker (top = marker bottom + gap) and right-aligned
    // (left = marker right − editor width).
    expect(pos.top).toBe(300 + 40 + MARKER_EDITOR_GAP);
    expect(pos.left).toBe(600 + 100 - EDITOR.width);
  });

  it("right-aligns without exceeding the viewport right edge", () => {
    const pos = resolveMarkerEditorPosition(
      markerAt(1100, 100),
      VIEWPORT,
      EDITOR
    );
    expect(pos.left + EDITOR.width).toBeLessThanOrEqual(VIEWPORT.width);
  });
});

describe("resolveMarkerEditorPosition — viewport edges", () => {
  it("flips ABOVE the marker when there is no room below (bottom edge)", () => {
    const pos = resolveMarkerEditorPosition(
      markerAt(600, 700 - 40),
      VIEWPORT,
      EDITOR
    );
    // Below would overflow → flip above the marker.
    expect(pos.top + EDITOR.height).toBeLessThanOrEqual(VIEWPORT.height);
    expect(pos.top).toBeLessThan(700 - 40);
  });

  it("clamps to the top edge when even flipping above overflows", () => {
    const pos = resolveMarkerEditorPosition(markerAt(600, 0), VIEWPORT, EDITOR);
    expect(pos.top).toBeGreaterThanOrEqual(0);
    expect(pos.top + EDITOR.height).toBeLessThanOrEqual(VIEWPORT.height);
  });

  it("clamps the left edge for markers at the left boundary", () => {
    const pos = resolveMarkerEditorPosition(
      markerAt(0, 100),
      VIEWPORT,
      EDITOR
    );
    // The SHARED placement path clamps inside the viewport with its
    // standard margin (Goal 03 E — one placement utility for every
    // surface, including the marker editor).
    expect(pos.left).toBeGreaterThanOrEqual(0);
    expect(pos.left).toBeLessThanOrEqual(4);
    expect(pos.left + EDITOR.width).toBeLessThanOrEqual(VIEWPORT.width);
  });

  it("clamps the right edge for markers at the right boundary", () => {
    const pos = resolveMarkerEditorPosition(
      markerAt(VIEWPORT.width - 10, 100),
      VIEWPORT,
      EDITOR
    );
    expect(pos.left + EDITOR.width).toBeLessThanOrEqual(VIEWPORT.width);
    // Right-aligned near the marker's right edge via the shared path
    // (the shared helper insets the clamp by its standard margin).
    expect(pos.left).toBeGreaterThan(VIEWPORT.width - EDITOR.width - 8);
  });

  it("stays fully inside a very small viewport", () => {
    // Slightly larger than the editor itself so a full fit is possible.
    const tiny = { width: 320, height: 240 };
    const pos = resolveMarkerEditorPosition(markerAt(150, 100), tiny, EDITOR);
    expect(pos.left).toBeGreaterThanOrEqual(0);
    expect(pos.top).toBeGreaterThanOrEqual(0);
    expect(pos.left + EDITOR.width).toBeLessThanOrEqual(tiny.width);
    expect(pos.top + EDITOR.height).toBeLessThanOrEqual(tiny.height);
  });

  it("stays on-viewport for viewports SMALLER than the editor", () => {
    // The pure geometry cannot shrink the box — the shared path clamps
    // the anchor inside the viewport (its margin); the actual fit
    // (max-width/max-height + scroll) is the dialog CSS, proven by the
    // small-viewport Playwright test.
    const tiny = { width: 200, height: 150 };
    const pos = resolveMarkerEditorPosition(markerAt(100, 50), tiny, EDITOR);
    // The shared path keeps the ANCHOR on-viewport (the pure geometry
    // cannot shrink the box; the actual fit is the dialog CSS, proven by
    // the small-viewport Playwright test).
    expect(pos.left).toBeGreaterThanOrEqual(0);
    expect(pos.top).toBeGreaterThanOrEqual(0);
  });
});

describe("resolveAnnotationTargets — multi-target resolution", () => {
  /** v6 capture whose selector + fingerprint match the live element. */
  const makeCapture = (element: Element) => {
    const parent = element.parentElement;
    return {
      tagName: element.tagName.toLowerCase(),
      selector: `#${element.id}`,
      bounds: { x: 0, y: 0, width: 10, height: 10 },
      componentName: null,
      source: null,
      sourceStack: [],
      htmlPreview: "",
      styleText: "",
      fingerprint: {
        tagName: element.tagName.toLowerCase(),
        role: "",
        accessibleName: "",
        text: (element.textContent ?? "").replace(/\s+/g, " ").trim(),
        identityAttributes: { id: element.id },
        childCount: element.children.length,
        parent: parent
          ? { tagName: parent.tagName.toLowerCase(), role: "" }
          : { tagName: "", role: "" },
      },
    };
  };

  const makeAnnotation = (elements: Annotation["elements"]): Annotation => ({
    annotationId: "multi-1",
    kind: "multi",
    comment: "group",
    createdAt: "2026-08-08T00:00:00.000Z",
    status: "open",
    elements,
    pageContext: {
      url: "http://localhost/",
      routeKey: "/",
      title: "",
      viewport: { width: 1440, height: 900 },
      scroll: { x: 0, y: 0 },
      businessContext: [],
    },
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("resolves every captured member that still exists in the DOM", () => {
    const a = document.createElement("td");
    a.id = "a";
    const b = document.createElement("td");
    b.id = "b";
    document.body.appendChild(a);
    document.body.appendChild(b);
    const annotation = makeAnnotation([makeCapture(a), makeCapture(b)]);
    expect(resolveAnnotationTargets(annotation)).toEqual([a, b]);
  });

  it("never crashes on a malformed element record without a selector", () => {
    document.body.innerHTML = "<tr id='row-a'><td>Alice</td></tr>";
    const malformed = {
      tagName: "tr",
      fingerprint: {
        tagName: "tr",
        role: "",
        accessibleName: "",
        text: "Alice",
        identityAttributes: {},
        childCount: 1,
        parent: { tagName: "tbody", role: "" },
      },
    } as unknown as Annotation["elements"][number];
    // Missing selector → unresolved, not a throw.
    expect(resolveAnnotationTargets(makeAnnotation([malformed]))).toEqual([]);
  });

  it("skips members whose selector no longer matches", () => {
    const a = document.createElement("td");
    a.id = "a";
    document.body.appendChild(a);
    const ghost = document.createElement("td");
    ghost.id = "ghost";
    // Captured but REMOVED from the DOM: selector resolves nothing.
    const annotation = makeAnnotation([makeCapture(a), makeCapture(ghost)]);
    ghost.remove();
    expect(resolveAnnotationTargets(annotation)).toEqual([a]);
  });

  it("returns unresolved when the fingerprint no longer matches", () => {
    const a = document.createElement("td");
    a.id = "a";
    document.body.appendChild(a);
    const capture = makeCapture(a);
    // The live element changes its strong identity: hard mismatch.
    a.id = "changed";
    const annotation = makeAnnotation([capture]);
    expect(resolveAnnotationTargets(annotation)).toEqual([]);
  });

  it("returns [] for region annotations", () => {
    const annotation: Annotation = {
      annotationId: "r",
      kind: "region",
      comment: "area",
      createdAt: "2026-08-08T00:00:00.000Z",
      status: "open",
      pageContext: {
        url: "http://localhost/",
        routeKey: "/",
        title: "",
        viewport: { width: 1440, height: 900 },
        scroll: { x: 0, y: 0 },
        businessContext: [],
      },
      elements: [],
      region: { x: 0, y: 0, width: 100, height: 100 },
    };
    expect(resolveAnnotationTargets(annotation)).toEqual([]);
  });
});

describe("resolveMarkerCollisions — markers never cover each other (manual-test finding)", () => {
  it("keeps the FIRST annotation at its exact anchor when a later marker collides", () => {
    const resolved = resolveMarkerCollisions([
      { annotationId: "a", left: 100, top: 100 },
      { annotationId: "b", left: 100, top: 100 },
    ]);
    expect(resolved.get("a")).toEqual({ left: 100, top: 100 });
    const b = resolved.get("b")!;
    // The second marker is nudged one footprint down-right.
    expect(b.left).toBe(100 + MARKER_FOOTPRINT);
    expect(b.top).toBe(100 + MARKER_FOOTPRINT);
    // No footprint intersection remains.
    const hit = (l: number, t: number) =>
      l >= 100 && l < 100 + MARKER_FOOTPRINT && t >= 100 && t < 100 + MARKER_FOOTPRINT;
    expect(hit(b.left, b.top)).toBe(false);
  });

  it("stacks three overlapping markers diagonally without intersections", () => {
    const resolved = resolveMarkerCollisions([
      { annotationId: "a", left: 50, top: 50 },
      { annotationId: "b", left: 50, top: 50 },
      { annotationId: "c", left: 50, top: 50 },
    ]);
    const positions = ["a", "b", "c"].map(
      (id) => resolved.get(id)!
    );
    for (let i = 0; i < positions.length; i += 1) {
      for (let j = i + 1; j < positions.length; j += 1) {
        const p = positions[i];
        const q = positions[j];
        const intersects =
          p.left < q.left + MARKER_FOOTPRINT &&
          q.left < p.left + MARKER_FOOTPRINT &&
          p.top < q.top + MARKER_FOOTPRINT &&
          q.top < p.top + MARKER_FOOTPRINT;
        expect(intersects).toBe(false);
      }
    }
  });

  it("does not move markers that already do not collide", () => {
    const resolved = resolveMarkerCollisions([
      { annotationId: "a", left: 100, top: 100 },
      { annotationId: "b", left: 400, top: 300 },
    ]);
    expect(resolved.get("a")).toEqual({ left: 100, top: 100 });
    expect(resolved.get("b")).toEqual({ left: 400, top: 300 });
  });
});
