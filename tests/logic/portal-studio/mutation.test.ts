/**
 * Goal 06 — typed revision-aware atomic mutation contract (pure).
 * Every operation, validation, field preservation, and the fully-
 * completed lifecycle condition.
 */
import { describe, expect, it } from "vitest";

import {
  applyMutationOperations,
  isFullyCompletedTask,
  parseMutationRequest,
  type MutationRequest,
} from "@/studio/mutation";
import type { Annotation, PortalStudioTask } from "@/studio/types";

const baseTask = (annotations: Annotation[] = []): PortalStudioTask => ({
  schemaVersion: 5,
  taskId: "task-mut-1",
  createdAt: "2026-08-09T00:00:00.000Z",
  url: "http://127.0.0.1:4173/users",
  title: "Users",
  annotations,
  businessContext: [],
  redaction: { droppedKeys: [], redactedValues: 0, truncatedValues: 0 },
});

const openAnn = (id = "ann-a", comment = "c"): Annotation => ({
  annotationId: id,
  kind: "element",
  comment,
  createdAt: "2026-08-09T00:00:00.000Z",
  status: "open",
  elements: [],
});

const doneAnn = (id = "ann-b"): Annotation => ({
  ...openAnn(id, "done"),
  status: "completed",
  completedAt: "2026-08-09T01:00:00.000Z",
});

describe("isFullyCompletedTask", () => {
  it("true only when at least one annotation exists and all are completed", () => {
    expect(isFullyCompletedTask(baseTask([doneAnn()]))).toBe(true);
    expect(isFullyCompletedTask(baseTask([openAnn()]))).toBe(false);
    expect(isFullyCompletedTask(baseTask([openAnn(), doneAnn()]))).toBe(false);
    expect(isFullyCompletedTask(baseTask([]))).toBe(false);
  });

  it("sticky completedAt keeps a removed-clean task fully completed", () => {
    expect(
      isFullyCompletedTask({
        ...baseTask([]),
        completedAt: "2026-08-09T02:00:00.000Z",
      })
    ).toBe(true);
    expect(isFullyCompletedTask({ ...baseTask([]), completedAt: "" })).toBe(
      false
    );
  });
});

describe("applyMutationOperations — every operation", () => {
  it("add appends a new annotation and preserves unrelated fields", () => {
    const task = baseTask([openAnn()]);
    const result = applyMutationOperations(task, [
      { op: "add", annotation: openAnn("ann-c", "new") },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.task.annotations).toHaveLength(2);
    expect(result.task.taskId).toBe("task-mut-1");
    expect(result.task.url).toBe(task.url);
    expect(result.task.redaction).toEqual(task.redaction);
  });

  it("updateComment replaces only the target comment", () => {
    const result = applyMutationOperations(
      baseTask([openAnn("a", "old"), openAnn("b", "keep")]),
      [{ op: "updateComment", annotationId: "a", comment: "new" }]
    );
    if (!result.ok) return;
    expect(result.task.annotations[0].comment).toBe("new");
    expect(result.task.annotations[1].comment).toBe("keep");
  });

  it("setHidden toggles only the target annotation", () => {
    const result = applyMutationOperations(
      baseTask([openAnn("a"), openAnn("b")]),
      [{ op: "setHidden", annotationId: "a", hidden: true }]
    );
    if (!result.ok) return;
    expect(result.task.annotations[0].hidden).toBe(true);
    expect(result.task.annotations[1].hidden).toBeUndefined();
  });

  it("complete stamps status/completedAt without double-stamping", () => {
    const result = applyMutationOperations(
      baseTask([openAnn("a"), doneAnn("b")]),
      [{ op: "complete", annotationId: "a" }]
    );
    if (!result.ok) return;
    expect(result.task.annotations[0].status).toBe("completed");
    expect(typeof result.task.annotations[0].completedAt).toBe("string");
    // Already-completed stays untouched (no double-stamp).
    expect(result.task.annotations[1].completedAt).toBe(
      doneAnn("b").completedAt
    );
  });

  it("complete with evidence records the additive Goal 05 evidence", () => {
    const result = applyMutationOperations(
      baseTask([openAnn("a")]),
      [
        {
          op: "complete",
          annotationId: "a",
          evidence: { verified: true, summary: "fixed", source: "cli" },
        },
      ]
    );
    if (!result.ok) return;
    expect(result.task.annotations[0].completedEvidence).toEqual({
      verified: true,
      summary: "fixed",
      source: "cli",
      completedAt: result.task.annotations[0].completedAt,
    });
  });

  it("reopen clears completedAt and evidence", () => {
    const task = baseTask([doneAnn("a")]);
    const result = applyMutationOperations(task, [
      { op: "reopen", annotationId: "a" },
    ]);
    if (!result.ok) return;
    expect(result.task.annotations[0].status).toBe("open");
    expect(result.task.annotations[0].completedAt).toBeUndefined();
    expect(result.task.annotations[0].completedEvidence).toBeUndefined();
  });

  it("remove deletes only the target annotation", () => {
    const result = applyMutationOperations(
      baseTask([openAnn("a"), openAnn("b")]),
      [{ op: "remove", annotationId: "a" }]
    );
    if (!result.ok) return;
    expect(result.task.annotations.map((a) => a.annotationId)).toEqual(["b"]);
  });

  it("removeCompleted removes only completed annotations", () => {
    const result = applyMutationOperations(
      baseTask([openAnn("a"), doneAnn("b"), openAnn("c")]),
      [{ op: "removeCompleted" }]
    );
    if (!result.ok) return;
    expect(result.task.annotations.map((a) => a.annotationId)).toEqual([
      "a",
      "c",
    ]);
  });

  it("completing the last open annotation stamps the sticky task completedAt", () => {
    const result = applyMutationOperations(baseTask([openAnn("a")]), [
      { op: "complete", annotationId: "a" },
    ]);
    if (!result.ok) return;
    expect(result.task.annotations[0].status).toBe("completed");
    expect(typeof result.task.completedAt).toBe("string");
    expect(isFullyCompletedTask(result.task)).toBe(true);
  });

  it("removeCompleted preserves the sticky completedAt of a fully completed task", () => {
    const completed = applyMutationOperations(baseTask([openAnn("a")]), [
      { op: "complete", annotationId: "a" },
    ]);
    if (!completed.ok) return;
    const removed = applyMutationOperations(completed.task, [
      { op: "removeCompleted" },
    ]);
    if (!removed.ok) return;
    expect(removed.task.annotations).toEqual([]);
    expect(removed.task.completedAt).toBe(completed.task.completedAt);
    expect(isFullyCompletedTask(removed.task)).toBe(true);
  });

  it("a batched complete+removeCompleted request still stamps the sticky marker", () => {
    // The browser debounces the final Complete and Remove completed into
    // ONE atomic request — the completed state never exists in an
    // intermediate result, so the transition must be inferred from the
    // operations themselves.
    const result = applyMutationOperations(baseTask([openAnn("a")]), [
      { op: "complete", annotationId: "a" },
      { op: "removeCompleted" },
    ]);
    if (!result.ok) return;
    expect(result.task.annotations).toEqual([]);
    expect(typeof result.task.completedAt).toBe("string");
    expect(isFullyCompletedTask(result.task)).toBe(true);
  });

  it("removeCompleted on a partially completed task never stamps completedAt", () => {
    const result = applyMutationOperations(
      baseTask([openAnn("a"), doneAnn("b")]),
      [{ op: "removeCompleted" }]
    );
    if (!result.ok) return;
    expect(result.task.annotations.map((a) => a.annotationId)).toEqual(["a"]);
    expect(result.task.completedAt).toBeUndefined();
    expect(isFullyCompletedTask(result.task)).toBe(false);
  });

  it("reopen after a sticky completion clears the task completedAt", () => {
    const completed = applyMutationOperations(baseTask([openAnn("a")]), [
      { op: "complete", annotationId: "a" },
    ]);
    if (!completed.ok) return;
    const reopened = applyMutationOperations(completed.task, [
      { op: "reopen", annotationId: "a" },
    ]);
    if (!reopened.ok) return;
    expect(reopened.task.annotations[0].status).toBe("open");
    expect(reopened.task.completedAt).toBeUndefined();
    expect(isFullyCompletedTask(reopened.task)).toBe(false);
  });

  it("add and clear after a sticky completion clear the task completedAt", () => {
    const completed = applyMutationOperations(baseTask([openAnn("a")]), [
      { op: "complete", annotationId: "a" },
    ]);
    if (!completed.ok) return;
    const added = applyMutationOperations(completed.task, [
      { op: "add", annotation: openAnn("b", "fresh") },
    ]);
    if (!added.ok) return;
    expect(added.task.completedAt).toBeUndefined();
    const cleared = applyMutationOperations(completed.task, [{ op: "clear" }]);
    if (!cleared.ok) return;
    expect(cleared.task.completedAt).toBeUndefined();
  });

  it("bookkeeping ops on a sticky task preserve completedAt (complete no-op)", () => {
    const completed = applyMutationOperations(baseTask([openAnn("a")]), [
      { op: "complete", annotationId: "a" },
    ]);
    if (!completed.ok) return;
    const noop = applyMutationOperations(completed.task, [
      { op: "complete", annotationId: "a" },
      { op: "setHidden", annotationId: "a", hidden: true },
    ]);
    if (!noop.ok) return;
    expect(noop.task.completedAt).toBe(completed.task.completedAt);
    expect(isFullyCompletedTask(noop.task)).toBe(true);
  });

  it("clear produces a valid empty annotation list", () => {
    const result = applyMutationOperations(
      baseTask([openAnn("a"), doneAnn("b")]),
      [{ op: "clear" }]
    );
    if (!result.ok) return;
    expect(result.task.annotations).toEqual([]);
  });

  it("applies multiple operations in order", () => {
    const result = applyMutationOperations(
      baseTask([openAnn("a")]),
      [
        { op: "updateComment", annotationId: "a", comment: "edited" },
        { op: "complete", annotationId: "a" },
      ]
    );
    if (!result.ok) return;
    expect(result.task.annotations[0].comment).toBe("edited");
    expect(result.task.annotations[0].status).toBe("completed");
  });
});

describe("add op annotation bound (P3-3 review)", () => {
  it("rejects an add beyond MAX_ANNOTATIONS", () => {
    const many = Array.from({ length: 50 }, (_, i) => openAnn(`a${i}`));
    const result = applyMutationOperations(baseTask(many), [
      { op: "add", annotation: openAnn("overflow") },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("annotation_limit");
  });

  it("accepts an add up to MAX_ANNOTATIONS", () => {
    const many = Array.from({ length: 49 }, (_, i) => openAnn(`a${i}`));
    const result = applyMutationOperations(baseTask(many), [
      { op: "add", annotation: openAnn("fits") },
    ]);
    expect(result.ok).toBe(true);
  });
});

describe("applyMutationOperations — rejections", () => {
  it("rejects empty operation lists", () => {
    const result = applyMutationOperations(baseTask([openAnn()]), []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("empty_operations");
  });

  it("rejects operations on unknown annotation ids", () => {
    for (const op of [
      { op: "updateComment", annotationId: "ghost", comment: "x" },
      { op: "setHidden", annotationId: "ghost", hidden: true },
      { op: "complete", annotationId: "ghost" },
      { op: "reopen", annotationId: "ghost" },
      { op: "remove", annotationId: "ghost" },
    ] as const) {
      const result = applyMutationOperations(baseTask([openAnn("a")]), [op]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("annotation_not_found");
    }
  });
});

describe("parseMutationRequest", () => {
  const valid: MutationRequest = {
    taskId: "task-1",
    expectedTaskRevision: 3,
    operations: [{ op: "clear" }],
  };

  it("accepts a well-formed request", () => {
    expect(parseMutationRequest(valid)).toEqual(valid);
  });

  it("accepts all operation shapes including complete-with-evidence", () => {
    const request: MutationRequest = {
      taskId: "t",
      expectedTaskRevision: 1,
      operations: [
        { op: "add", annotation: openAnn() },
        { op: "updateComment", annotationId: "a", comment: "c" },
        { op: "setHidden", annotationId: "a", hidden: false },
        { op: "complete", annotationId: "a" },
        {
          op: "complete",
          annotationId: "a",
          evidence: { verified: true, summary: "s", source: "cli" },
        },
        { op: "reopen", annotationId: "a" },
        { op: "remove", annotationId: "a" },
        { op: "removeCompleted" },
        { op: "clear" },
      ],
    };
    const parsed = parseMutationRequest(request);
    expect(parsed).toEqual(request);
  });

  it("rejects malformed payloads", () => {
    expect(parseMutationRequest(null)).toBeNull();
    expect(parseMutationRequest({})).toBeNull();
    expect(parseMutationRequest({ taskId: "t", expectedTaskRevision: "1", operations: [] })).toBeNull();
    expect(
      parseMutationRequest({ taskId: "t", expectedTaskRevision: 1, operations: [{ op: "frobnicate" }] })
    ).toBeNull();
    expect(
      parseMutationRequest({
        taskId: "t",
        expectedTaskRevision: 1,
        operations: [{ op: "complete", annotationId: 42 }],
      })
    ).toBeNull();
    expect(
      parseMutationRequest({
        taskId: "t",
        expectedTaskRevision: 1,
        operations: [{ op: "complete", annotationId: "a", evidence: { verified: false, summary: "x", source: "cli" } }],
      })
    ).toBeNull();
  });
});
