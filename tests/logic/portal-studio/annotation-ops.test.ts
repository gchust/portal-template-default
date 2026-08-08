/**
 * Goal 03 — pure annotation ops (D-033 #5/#10/#11, D-034 #4).
 * Group toggle bounds, remove + live renumbering, hide/unhide round-trip,
 * comment updates, clear-all → valid empty v5 list, add bound.
 */
import { describe, expect, it } from "vitest";

import {
  addAnnotation,
  annotationDisplayNumber,
  clearAnnotations,
  groupToggleElement,
  MAX_ANNOTATIONS,
  removeAnnotation,
  toggleAnnotationHidden,
  updateAnnotationComment,
} from "@/studio/task-model";
import { MAX_GROUP_ELEMENTS } from "@/studio/task-model";
import type { Annotation } from "@/studio/types";

const makeAnnotation = (id: string, comment = "c"): Annotation => ({
  annotationId: id,
  kind: "element",
  comment,
  createdAt: "2026-08-08T00:00:00.000Z",
  status: "open",
  elements: [],
});

describe("groupToggleElement (true multi-select group)", () => {
  it("adds elements in order and toggles existing ones out", () => {
    const a = document.createElement("td");
    const b = document.createElement("td");
    let group: Element[] = [];
    group = groupToggleElement(group, a);
    group = groupToggleElement(group, b);
    expect(group).toEqual([a, b]);
    group = groupToggleElement(group, a);
    expect(group).toEqual([b]);
  });

  it("is bounded by MAX_GROUP_ELEMENTS", () => {
    const elements = Array.from({ length: MAX_GROUP_ELEMENTS + 5 }, () =>
      document.createElement("td")
    );
    let group: Element[] = [];
    for (const element of elements) {
      group = groupToggleElement(group, element);
    }
    expect(group).toHaveLength(MAX_GROUP_ELEMENTS);
  });
});

describe("addAnnotation", () => {
  it("appends and respects MAX_ANNOTATIONS", () => {
    const one = addAnnotation([], makeAnnotation("a"));
    expect(one).toHaveLength(1);
    const full = Array.from({ length: MAX_ANNOTATIONS }, (_, i) =>
      makeAnnotation(`a${i}`)
    );
    expect(addAnnotation(full, makeAnnotation("extra"))).toHaveLength(
      MAX_ANNOTATIONS
    );
  });
});

describe("removeAnnotation + live renumbering (D-034 #4)", () => {
  it("removes by stable id and shifts display numbers", () => {
    const annotations = [
      makeAnnotation("a"),
      makeAnnotation("b"),
      makeAnnotation("c"),
    ];
    const after = removeAnnotation(annotations, "b");
    expect(after.map((a) => a.annotationId)).toEqual(["a", "c"]);
    expect(annotationDisplayNumber(after, "a")).toBe(1);
    expect(annotationDisplayNumber(after, "c")).toBe(2);
    // Stable ids never change.
    expect(after[1].annotationId).toBe("c");
  });

  it("leaves the list unchanged for a missing id", () => {
    const annotations = [makeAnnotation("a")];
    expect(removeAnnotation(annotations, "zzz")).toEqual(annotations);
  });
});

describe("toggleAnnotationHidden (hide without delete, D-033 #11)", () => {
  it("flips hidden and back, preserving everything else", () => {
    const annotations = [makeAnnotation("a", "comment-a")];
    const hidden = toggleAnnotationHidden(annotations, "a");
    expect(hidden[0].hidden).toBe(true);
    expect(hidden[0].comment).toBe("comment-a");
    const shown = toggleAnnotationHidden(hidden, "a");
    expect(shown[0].hidden).toBe(false);
    expect(shown[0].annotationId).toBe("a");
  });
});

describe("updateAnnotationComment (inline edit)", () => {
  it("replaces the comment of one annotation only", () => {
    const annotations = [makeAnnotation("a", "old"), makeAnnotation("b")];
    const after = updateAnnotationComment(annotations, "a", "new text");
    expect(after[0].comment).toBe("new text");
    expect(after[1].comment).toBe("c");
  });
});

describe("clearAnnotations (valid empty v5 task)", () => {
  it("returns an empty list that the server accepts", () => {
    expect(clearAnnotations()).toEqual([]);
  });
});
