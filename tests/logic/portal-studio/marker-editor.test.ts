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
    expect(pos.left).toBe(0);
  });

  it("clamps the right edge for markers at the right boundary", () => {
    const pos = resolveMarkerEditorPosition(
      markerAt(VIEWPORT.width - 10, 100),
      VIEWPORT,
      EDITOR
    );
    expect(pos.left + EDITOR.width).toBeLessThanOrEqual(VIEWPORT.width);
    expect(pos.left).toBe(VIEWPORT.width - EDITOR.width);
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

  it("clamps to the origin for viewports SMALLER than the editor", () => {
    // The pure geometry cannot shrink the box — it must never place the
    // anchor off-viewport; the actual fit (max-width/max-height + scroll)
    // is the dialog CSS, proven by the small-viewport Playwright test.
    const tiny = { width: 200, height: 150 };
    const pos = resolveMarkerEditorPosition(markerAt(100, 50), tiny, EDITOR);
    expect(pos.left).toBe(0);
    expect(pos.top).toBe(0);
  });
});

describe("resolveAnnotationTargets — multi-target resolution", () => {
  const makeCapture = (id: string) => ({
    tagName: "td",
    selectorCandidates: [{ kind: "id" as const, selector: `#${id}` }],
    componentCandidates: [],
    sourceCandidates: [],
    snapshot: { text: id, attributes: {}, childCount: 0 },
  });

  const makeAnnotation = (elements: Annotation["elements"]): Annotation => ({
    annotationId: "multi-1",
    kind: "multi",
    comment: "group",
    createdAt: "2026-08-08T00:00:00.000Z",
    status: "open",
    elements,
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
    const annotation = makeAnnotation([makeCapture("a"), makeCapture("b")]);
    expect(resolveAnnotationTargets(annotation)).toEqual([a, b]);
  });

  it("skips members whose selector no longer matches", () => {
    const a = document.createElement("td");
    a.id = "a";
    document.body.appendChild(a);
    const annotation = makeAnnotation([makeCapture("a"), makeCapture("ghost")]);
    expect(resolveAnnotationTargets(annotation)).toEqual([a]);
  });

  it("returns [] for region annotations", () => {
    const annotation: Annotation = {
      annotationId: "r",
      kind: "region",
      comment: "area",
      createdAt: "2026-08-08T00:00:00.000Z",
      status: "open",
      elements: [],
      region: { x: 0, y: 0, width: 100, height: 100 },
    };
    expect(resolveAnnotationTargets(annotation)).toEqual([]);
  });
});
