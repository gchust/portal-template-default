/**
 * Shared v6 task/capture fixtures for Goal 03 tests.
 */

import type {
  Annotation,
  ElementCapture,
  PortalStudioTask,
} from "@/studio/types";

/** v6 capture whose selector + fingerprint match a live element. */
export function captureForElement(element: Element): ElementCapture {
  const parent = element.parentElement;
  const tagName = element.tagName.toLowerCase();
  return {
    tagName,
    selector: element.id ? `#${element.id}` : tagName,
    bounds: { x: 0, y: 0, width: 100, height: 44 },
    componentName: null,
    source: null,
    sourceStack: [],
    htmlPreview: "",
    styleText: "",
    fingerprint: {
      tagName,
      role: (element.getAttribute("role") ?? "").trim(),
      accessibleName: "",
      text: (element.textContent ?? "").replace(/\s+/g, " ").trim(),
      identityAttributes: element.id ? { id: element.id } : {},
      childCount: element.children.length,
      parent: parent
        ? {
            tagName: parent.tagName.toLowerCase(),
            role: (parent.getAttribute("role") ?? "").trim(),
          }
        : { tagName: "", role: "" },
    },
  };
}

export function annotationFixture(
  overrides: Partial<Annotation> = {}
): Annotation {
  return {
    annotationId: "ann-1",
    kind: "element",
    comment: "Bold the header",
    createdAt: "2026-08-11T00:00:00.000Z",
    status: "open",
    elements: [],
    pageContext: {
      url: "http://127.0.0.1:4173/users",
      routeKey: "/users",
      title: "Users",
      viewport: { width: 1440, height: 900 },
      scroll: { x: 0, y: 0 },
      businessContext: [],
    },
    ...overrides,
  };
}

export function taskFixture(
  overrides: Partial<PortalStudioTask> = {}
): PortalStudioTask {
  return {
    schemaVersion: 6,
    taskId: "task-1",
    createdAt: "2026-08-11T00:00:00.000Z",
    url: "http://127.0.0.1:4173/users",
    title: "Users",
    annotations: [],
    businessContext: [],
    redaction: { droppedKeys: [], redactedValues: 0, truncatedValues: 0 },
    ...overrides,
  };
}

/** One full v6 element capture (selector/source/stack/fingerprint). */
export function v6ElementCapture(): ElementCapture {
  return {
    tagName: "tr",
    selector: "#row-a",
    bounds: { x: 10, y: 20, width: 300, height: 40 },
    componentName: "TableRow",
    source: {
      filePath: "src/pages/users.tsx",
      lineNumber: 12,
      columnNumber: 4,
      componentName: "TableRow",
    },
    sourceStack: [
      {
        filePath: "src/pages/users.tsx",
        lineNumber: 12,
        columnNumber: 4,
        componentName: "TableRow",
      },
    ],
    htmlPreview: "<tr id=\"row-a\">Alice</tr>",
    styleText: "display: table-row;",
    fingerprint: {
      tagName: "tr",
      role: "",
      accessibleName: "",
      text: "Alice",
      identityAttributes: { id: "row-a" },
      childCount: 0,
      parent: { tagName: "tbody", role: "" },
    },
  };
}

/** Task with one open element annotation that sanitization accepts. */
export function v6TaskWithAnnotation(): PortalStudioTask {
  return taskFixture({
    taskId: "task-san-1",
    annotations: [
      annotationFixture({
        annotationId: "ann-1",
        kind: "element",
        comment: "Make the row text larger.",
        elements: [v6ElementCapture()],
        pageContext: {
          url: "http://127.0.0.1:4173/users",
          routeKey: "/users",
          title: "Users",
          viewport: { width: 1440, height: 900 },
          scroll: { x: 0, y: 0 },
          businessContext: [
            { type: "page-element", id: "pe-1", source: "data-ai-page-element" },
          ],
        },
      }),
    ],
    businessContext: [
      { type: "page-element", id: "pe-1", source: "data-ai-page-element" },
    ],
  });
}
