/**
 * Goal 02 — task-model: v4→v5 normalize-on-read (D-033 #17), display
 * numbers as live order index (D-034 #4), element counting/flattening.
 */
import { describe, expect, it, vi } from "vitest";

import {
  annotationDisplayNumber,
  normalizeElementCaptureV5,
  normalizeTask,
  normalizeV4ToV5,
} from "@/studio/task-model";
import type { PortalStudioTask, PortalStudioTaskV4 } from "@/studio/types";

const v4Task = (overrides: Partial<PortalStudioTaskV4> = {}): PortalStudioTaskV4 => ({
  schemaVersion: 4,
  taskId: "v4-task-1",
  createdAt: "2026-08-08T00:00:00.000Z",
  url: "http://127.0.0.1:4173/users",
  title: "Users",
  instruction: "Make the header bolder",
  elements: [
    {
      tagName: "h1",
      selectorCandidates: [{ kind: "path", selector: "main > h1" }],
      componentCandidates: [],
      sourceCandidates: [],
      snapshot: { text: "Users", attributes: {}, childCount: 0 },
    },
  ],
  region: { x: 10, y: 20, width: 100, height: 40 },
  businessContext: [],
  redaction: { droppedKeys: [], redactedValues: 0, truncatedValues: 0 },
  ...overrides,
});

const v5Task = (overrides: Partial<PortalStudioTask> = {}): PortalStudioTask => ({
  schemaVersion: 5,
  taskId: "v5-task-1",
  createdAt: "2026-08-08T00:00:00.000Z",
  url: "http://127.0.0.1:4173/users",
  title: "Users",
  annotations: [
    {
      annotationId: "ann-1",
      kind: "element",
      comment: "Bold the header",
      createdAt: "2026-08-08T00:00:00.000Z",
      status: "open",
      elements: [
        {
          tagName: "h1",
          selectorCandidates: [{ kind: "path", selector: "main > h1" }],
          componentCandidates: [],
          sourceCandidates: [],
          snapshot: { text: "Users", attributes: {}, childCount: 0 },
        },
      ],
    },
  ],
  businessContext: [],
  redaction: { droppedKeys: [], redactedValues: 0, truncatedValues: 0 },
  ...overrides,
});

describe("normalizeV4ToV5", () => {
  it("maps instruction → comment, elements → captures, region → rect, losslessly", () => {
    const task = normalizeV4ToV5(v4Task());
    expect(task.schemaVersion).toBe(5);
    expect(task.taskId).toBe("v4-task-1");
    expect(task.annotations).toHaveLength(1);
    const annotation = task.annotations[0];
    expect(annotation.comment).toBe("Make the header bolder");
    expect(annotation.kind).toBe("element");
    expect(annotation.elements[0].snapshot.text).toBe("Users");
    expect(annotation.region).toEqual({ x: 10, y: 20, width: 100, height: 40 });
    expect(annotation.status).toBe("open");
    // Bookkeeping carried through untouched.
    expect(task.url).toBe("http://127.0.0.1:4173/users");
    expect(task.redaction).toEqual({
      droppedKeys: [],
      redactedValues: 0,
      truncatedValues: 0,
    });
  });

  it("uses kind=region for a v4 payload with no elements", () => {
    const task = normalizeV4ToV5(v4Task({ elements: [] }));
    expect(task.annotations[0].kind).toBe("region");
    expect(task.annotations[0].elements).toEqual([]);
  });

  it("upgrades pre-v5 element records (id/tag/text era) without data loss", () => {
    const task = normalizeV4ToV5(
      v4Task({
        elements: [
          {
            id: "row-a",
            tag: "tr",
            text: "Alice",
            attributes: {},
            snapshot: { text: "Alice", attributes: {} },
            sourceCandidates: [{ file: "src/pages/users.tsx", line: 12 }],
          } as unknown as PortalStudioTaskV4["elements"][number],
        ],
      })
    );
    const element = task.annotations[0].elements[0];
    expect(element.tagName).toBe("tr");
    expect(element.selectorCandidates).toEqual([
      { kind: "id", selector: "#row-a" },
    ]);
    expect(element.componentCandidates).toEqual([]);
    expect(element.sourceCandidates).toEqual([
      { file: "src/pages/users.tsx", line: 12 },
    ]);
    expect(element.snapshot.text).toBe("Alice");
  });

  it("preserves legacy attributes and CSS-escapes the id selector (P2 review)", () => {
    const escapeSpy = vi.fn((value: string) => value.replace(/[^a-zA-Z0-9]/g, "\\$&"));
    vi.stubGlobal("CSS", { escape: escapeSpy });
    const task = normalizeV4ToV5(
      v4Task({
        elements: [
          {
            id: "row.a:1",
            tag: "tr",
            text: "Alice",
            attributes: { "data-ai-page-element": "user-row" },
            sourceCandidates: [],
          } as unknown as PortalStudioTaskV4["elements"][number],
        ],
      })
    );
    const element = task.annotations[0].elements[0];
    // The id-derived candidate is CSS-escaped (D-044 pattern) so dots and
    // colons cannot misresolve or throw.
    expect(element.selectorCandidates).toEqual([
      { kind: "id", selector: "#row\\.a\\:1" },
    ]);
    expect(escapeSpy).toHaveBeenCalledWith("row.a:1");
    // The legacy top-level attributes survive into the fallback snapshot.
    expect(element.snapshot).toEqual({
      text: "Alice",
      attributes: { "data-ai-page-element": "user-row" },
      childCount: 0,
    });
    vi.unstubAllGlobals();
  });

  it("normalizeElementCaptureV5 passes v5 records through and maps missing arrays", () => {
    const v5shape = v4Task().elements[0];
    expect(normalizeElementCaptureV5(v5shape)).toEqual(v5shape);
    const bare = normalizeElementCaptureV5({ tagName: "td" });
    expect(bare).toEqual({
      tagName: "td",
      selectorCandidates: [],
      componentCandidates: [],
      sourceCandidates: [],
      snapshot: { text: "", attributes: {}, childCount: 0 },
    });
    expect(normalizeElementCaptureV5(null)).toBeNull();
    expect(normalizeElementCaptureV5("x")).toBeNull();
  });
});

describe("normalizeTask", () => {
  it("returns v5 payloads as-is after a shape check", () => {
    const task = v5Task();
    expect(normalizeTask(task)).toBe(task);
    expect(normalizeTask({ ...task, annotations: "nope" })).toBeNull();
  });

  it("normalizes v4 payloads to v5", () => {
    const normalized = normalizeTask(v4Task());
    expect(normalized?.schemaVersion).toBe(5);
    expect(normalized?.annotations[0].comment).toBe("Make the header bolder");
  });

  it("rejects unknown versions and malformed payloads", () => {
    expect(normalizeTask({ schemaVersion: 3 })).toBeNull();
    expect(normalizeTask({ schemaVersion: 99 })).toBeNull();
    expect(normalizeTask(null)).toBeNull();
    expect(normalizeTask("task")).toBeNull();
    expect(normalizeTask({ schemaVersion: 4, instruction: "x" })).toBeNull();
  });
});

describe("annotationDisplayNumber", () => {
  it("returns the live 1-based order index, never stored", () => {
    const annotations = [
      { ...v5Task().annotations[0], annotationId: "a" },
      { ...v5Task().annotations[0], annotationId: "b" },
      { ...v5Task().annotations[0], annotationId: "c" },
    ];
    expect(annotationDisplayNumber(annotations, "a")).toBe(1);
    expect(annotationDisplayNumber(annotations, "c")).toBe(3);
    expect(annotationDisplayNumber(annotations, "missing")).toBeUndefined();
    expect(annotationDisplayNumber([], "a")).toBeUndefined();
  });
});
