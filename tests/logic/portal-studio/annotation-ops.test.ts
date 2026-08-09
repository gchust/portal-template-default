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
  completeAllAnnotations,
  completeAnnotation,
  completeAnnotationVerified,
  countOpenAnnotations,
  MAX_COMPLETION_SUMMARY_LENGTH,
  groupToggleElement,
  MAX_ANNOTATIONS,
  removeAnnotation,
  removeCompletedAnnotations,
  reopenAnnotation,
  selectCompletedAnnotations,
  selectOpenAnnotations,
  selectVisibleAnnotations,
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

describe("completeAnnotation / completeAllAnnotations (G04, D-033 #13)", () => {
  it("stamps status=completed + completedAt once, never double-stamps", () => {
    const annotations = [makeAnnotation("a"), makeAnnotation("b")];
    const done = completeAnnotation(annotations, "a");
    expect(done[0].status).toBe("completed");
    expect(typeof done[0].completedAt).toBe("string");
    expect(done[1].status).toBe("open");
    // A second complete on the same annotation leaves it untouched.
    const twice = completeAnnotation(done, "a");
    expect(twice[0].completedAt).toBe(done[0].completedAt);
    // Unknown ids leave the list unchanged.
    expect(completeAnnotation(annotations, "zzz")).toEqual(annotations);
  });

  it("completes ALL annotations without double-stamping already-done ones", () => {
    const annotations = [
      { ...makeAnnotation("a"), status: "completed" as const, completedAt: "x" },
      makeAnnotation("b"),
    ];
    const all = completeAllAnnotations(annotations);
    expect(all[0].completedAt).toBe("x");
    expect(all[1].status).toBe("completed");
    expect(typeof all[1].completedAt).toBe("string");
  });
});

describe("completeAnnotationVerified (Goal 05 agent CLI)", () => {
  it("completes with additive evidence and preserves unrelated fields", () => {
    const annotation = { ...makeAnnotation("a"), extra: "keep" };
    const done = completeAnnotationVerified([annotation], "a", {
      verified: true,
      summary: "Fixed; verified via reload",
      source: "cli",
    });
    expect(done[0].status).toBe("completed");
    expect(done[0].extra).toBe("keep");
    expect(done[0].completedEvidence).toEqual({
      verified: true,
      summary: "Fixed; verified via reload",
      source: "cli",
      completedAt: expect.any(String),
    });
  });

  it("does not double-stamp an already-completed annotation", () => {
    const annotation = {
      ...makeAnnotation("a"),
      status: "completed" as const,
      completedAt: "2026-08-09T00:00:00.000Z",
    };
    const done = completeAnnotationVerified([annotation], "a", {
      verified: true,
      summary: "again",
      source: "cli",
    });
    expect(done[0]).toEqual(annotation);
  });

  it("reopen clears the additive evidence", () => {
    const completed = completeAnnotationVerified([makeAnnotation("a")], "a", {
      verified: true,
      summary: "done",
      source: "cli",
    });
    const reopened = reopenAnnotation(completed, "a");
    expect(reopened[0].status).toBe("open");
    expect(reopened[0].completedEvidence).toBeUndefined();
    expect(reopened[0].completedAt).toBeUndefined();
  });

  it("MAX_COMPLETION_SUMMARY_LENGTH bounds the summary", () => {
    expect(MAX_COMPLETION_SUMMARY_LENGTH).toBe(2000);
  });
});

describe("reopenAnnotation (Goal 03 marker editor)", () => {
  it("reopens a completed annotation and clears completedAt", () => {
    const annotations = [
      { ...makeAnnotation("a"), status: "completed" as const, completedAt: "2026-08-08T00:00:00.000Z" },
      makeAnnotation("b"),
    ];
    const reopened = reopenAnnotation(annotations, "a");
    expect(reopened[0].status).toBe("open");
    expect(reopened[0].completedAt).toBeUndefined();
    expect(reopened[1]).toEqual(annotations[1]);
  });

  it("leaves open annotations and unknown ids untouched", () => {
    const annotations = [makeAnnotation("a"), makeAnnotation("b")];
    expect(reopenAnnotation(annotations, "a")).toEqual(annotations);
    expect(reopenAnnotation(annotations, "zzz")).toEqual(annotations);
  });
});
describe("Goal 04 — view-filter selectors", () => {
  const completed = (id: string, comment = "c") =>
    ({
      ...makeAnnotation(id, comment),
      status: "completed" as const,
      completedAt: "2026-08-08T00:00:00.000Z",
    });

  const list = [makeAnnotation("open-a"), completed("done-a"), makeAnnotation("open-b")];

  it("selectOpenAnnotations returns only open items, preserving order", () => {
    expect(selectOpenAnnotations(list).map((a) => a.annotationId)).toEqual([
      "open-a",
      "open-b",
    ]);
  });

  it("selectCompletedAnnotations returns only completed items", () => {
    expect(selectCompletedAnnotations(list).map((a) => a.annotationId)).toEqual([
      "done-a",
    ]);
  });

  it("selectVisibleAnnotations: open view filters completed; all view returns everything", () => {
    expect(
      selectVisibleAnnotations(list, "open").map((a) => a.annotationId)
    ).toEqual(["open-a", "open-b"]);
    expect(
      selectVisibleAnnotations(list, "all").map((a) => a.annotationId)
    ).toEqual(["open-a", "done-a", "open-b"]);
  });

  it("countOpenAnnotations counts open only, independent of the view", () => {
    expect(countOpenAnnotations(list)).toBe(2);
    expect(countOpenAnnotations([])).toBe(0);
    expect(countOpenAnnotations([completed("only-done")])).toBe(0);
  });

  it("removeCompletedAnnotations removes ONLY completed items", () => {
    const remaining = removeCompletedAnnotations(list);
    expect(remaining.map((a) => a.annotationId)).toEqual(["open-a", "open-b"]);
    // Empty + all-completed lists behave sanely.
    expect(removeCompletedAnnotations([])).toEqual([]);
    expect(removeCompletedAnnotations([completed("x")])).toEqual([]);
  });

  it("hidden is independent: selectors do not consider the hidden flag", () => {
    const hiddenOpen = { ...makeAnnotation("h"), hidden: true };
    expect(selectOpenAnnotations([hiddenOpen])).toHaveLength(1);
    expect(selectVisibleAnnotations([hiddenOpen], "open")).toHaveLength(1);
  });
});
