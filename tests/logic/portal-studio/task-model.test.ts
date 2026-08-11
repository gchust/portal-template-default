import { describe, expect, it } from "vitest";

import {
  describeUnsupportedSchema,
  normalizeTask,
} from "@/studio/task-model";
import type { PortalStudioTask } from "@/studio/types";

const v6Task = (overrides: Record<string, unknown> = {}): PortalStudioTask => ({
  schemaVersion: 6,
  taskId: "task-1",
  createdAt: "2026-08-11T00:00:00.000Z",
  url: "http://localhost/users",
  title: "Users",
  annotations: [],
  businessContext: [],
  redaction: { droppedKeys: [], redactedValues: 0, truncatedValues: 0 },
  ...overrides,
});

const v6Annotation = {
  annotationId: "ann-1",
  kind: "element" as const,
  comment: "Increase padding",
  createdAt: "2026-08-11T00:00:00.000Z",
  status: "open" as const,
  elements: [
    {
      tagName: "button",
      selector: "#save",
      bounds: { x: 10, y: 20, width: 100, height: 44 },
      componentName: "SaveButton",
      source: {
        filePath: "src/save.tsx",
        lineNumber: 12,
        columnNumber: 4,
        componentName: "SaveButton",
      },
      sourceStack: [
        {
          filePath: "src/save.tsx",
          lineNumber: 12,
          columnNumber: 4,
          componentName: "SaveButton",
        },
      ],
      htmlPreview: "<button id=\"save\">Save</button>",
      styleText: "",
      fingerprint: {
        tagName: "button",
        role: "",
        accessibleName: "",
        text: "Save",
        identityAttributes: { id: "save" },
        childCount: 0,
        parent: { tagName: "section", role: "" },
      },
    },
  ],
  pageContext: {
    url: "http://localhost/users",
    routeKey: "/users",
    title: "Users",
    viewport: { width: 1440, height: 900 },
    scroll: { x: 0, y: 0 },
    businessContext: [],
  },
};

describe("normalizeTask (v6 only)", () => {
  it("returns v6 tasks as-is after a shape check", () => {
    const task = v6Task({ annotations: [v6Annotation] });
    expect(normalizeTask(task)).toEqual(task);
  });

  it("rejects non-v6 schema versions", () => {
    expect(normalizeTask({ schemaVersion: 5, annotations: [] })).toBeNull();
    expect(normalizeTask({ schemaVersion: 4, annotations: [] })).toBeNull();
    expect(normalizeTask({ schemaVersion: 1, element: {} })).toBeNull();
    expect(normalizeTask({})).toBeNull();
    expect(normalizeTask(null)).toBeNull();
  });

  it("rejects v6 payloads without an annotations array", () => {
    expect(normalizeTask({ schemaVersion: 6 })).toBeNull();
  });
});

describe("describeUnsupportedSchema (shared typed old-schema result)", () => {
  it("returns the typed result for every removed schema version", () => {
    for (const version of [1, 2, 3, 4, 5]) {
      const result = describeUnsupportedSchema({ schemaVersion: version });
      expect(result).toMatchObject({
        status: "unsupported_schema",
        schemaVersion: version,
        expectedSchemaVersion: 6,
      });
      expect(result?.clearInstruction).toContain("v6");
      expect(result?.clearPath).toBe("tasks/active-task.json");
    }
  });

  it("returns null for v6 tasks and non-task inputs", () => {
    expect(describeUnsupportedSchema(v6Task())).toBeNull();
    expect(describeUnsupportedSchema({})).toBeNull();
    expect(describeUnsupportedSchema(null)).toBeNull();
    expect(describeUnsupportedSchema("task")).toBeNull();
  });
});
