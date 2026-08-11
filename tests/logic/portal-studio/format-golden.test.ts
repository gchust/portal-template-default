/**
 * Goal 03/04 — shared formatter golden tests (D-033 #15).
 *
 * formatTaskMarkdown/formatTaskJson are the SINGLE renderer for the browser
 * Copy action, the print CLI, and MCP print_task. These tests pin the exact
 * v6 output (selector/component/source/business context, no candidate
 * vocabulary), prove the shared typed unsupported_schema result for schema
 * v1-v5 artifacts, and verify the CLI consumes the same module through the
 * public package script.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  formatTaskJson,
  formatTaskMarkdown,
  formatUnsupportedSchemaMarkdown,
} from "@/studio/format";
import {
  annotationFixture,
  taskFixture,
} from "./fixtures/task-fixtures";

const v6Fixture = taskFixture({
  taskId: "golden-v6-1",
  annotations: [
    annotationFixture({
      annotationId: "ann-1",
      kind: "element",
      comment: "Bold the header",
      status: "completed",
      completedAt: "2026-08-11T10:05:00.000Z",
      elements: [
        {
          tagName: "h1",
          selector: "main > h1",
          bounds: { x: 10, y: 20, width: 200, height: 40 },
          componentName: "PageHeader",
          source: {
            filePath: "src/pages/users.tsx",
            lineNumber: 12,
            columnNumber: 4,
            componentName: "PageHeader",
          },
          sourceStack: [
            {
              filePath: "src/pages/users.tsx",
              lineNumber: 12,
              columnNumber: 4,
              componentName: "PageHeader",
            },
          ],
          htmlPreview: "<h1>Users</h1>",
          styleText: "font-weight: 700;",
          fingerprint: {
            tagName: "h1",
            role: "",
            accessibleName: "",
            text: "Users",
            identityAttributes: {},
            childCount: 0,
            parent: { tagName: "main", role: "" },
          },
        },
      ],
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
    annotationFixture({
      annotationId: "ann-2",
      kind: "region",
      comment: "Highlight the table",
      createdAt: "2026-08-11T10:01:00.000Z",
      elements: [],
      region: {
        coordinateSpace: "document",
        x: 1,
        y: 2,
        width: 100,
        height: 40,
      },
    }),
  ],
  businessContext: [
    { type: "page-element", id: "pe-1", source: "data-ai-page-element" },
  ],
  redaction: { droppedKeys: ["token"], redactedValues: 2, truncatedValues: 1 },
  screenshot: {
    file: "screenshots/golden-v6-1.png",
    width: 100,
    height: 50,
    capturedAt: "2026-08-11T10:02:00.000Z",
  },
  diagnostics: [
    {
      source: "console",
      message: "HTTP 500 [REDACTED]",
      timestamp: "2026-08-11T10:03:00.000Z",
      occurrenceCount: 2,
    },
  ],
});

const v5Fixture = {
  schemaVersion: 5,
  taskId: "old-v5-1",
  annotations: [],
};

const runCli = (args: string[], fixture: unknown): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "portal-studio-golden-"));
  try {
    mkdirSync(path.join(dir, "tasks"), { recursive: true });
    writeFileSync(
      path.join(dir, "tasks", "active-task.json"),
      JSON.stringify(fixture)
    );
    // Goal 03: process tests spawn the PUBLIC package script (tsx), never
    // raw node execution of the .mjs entrypoint.
    return execFileSync(
      "pnpm",
      ["--silent", "run", "studio:print", "--", ...args],
      {
        encoding: "utf8",
        env: { ...process.env, PORTAL_STUDIO_DIR: dir },
      }
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("formatTaskMarkdown — golden v6 output", () => {
  it("renders selector, component, source location and no candidate vocabulary", () => {
    const markdown = formatTaskMarkdown(v6Fixture);
    expect(markdown).toContain("# Task golden-v6-1");
    expect(markdown).toContain("- schemaVersion: 6");
    expect(markdown).toContain("## Annotations (2)");
    expect(markdown).toContain("### Annotation 1: [element] ann-1");
    expect(markdown).toContain("Comment: Bold the header");
    expect(markdown).toContain("- selector: main > h1");
    expect(markdown).toContain("- componentName: PageHeader");
    expect(markdown).toContain("- source: src/pages/users.tsx:12:4 (PageHeader)");
    expect(markdown).toContain("- sourceStack:");
    expect(markdown).toContain("  - src/pages/users.tsx:12:4 (PageHeader)");
    expect(markdown).toContain(
      "- bounds: 10,20 200x40"
    );
    expect(markdown).toContain("- fingerprint: tagName=h1");
    expect(markdown).toContain("- page: /users (Users)");
    expect(markdown).toContain("- businessContext:");
    expect(markdown).toContain(
      "  - [page-element] pe-1 (source: data-ai-page-element)"
    );
    expect(markdown).toContain(
      "- status: completed @ 2026-08-11T10:05:00.000Z"
    );
    expect(markdown).toContain("### Annotation 2: [region] ann-2");
    expect(markdown).toContain("- region: 1,2 100x40");
    // v6 vocabulary: NO candidate terminology.
    expect(markdown).not.toContain("Selector candidates");
    expect(markdown).not.toContain("Component candidates");
    expect(markdown).not.toContain("Source candidates");
    expect(markdown).not.toContain("snapshot");
  });

  it("shows unresolved source explicitly when null", () => {
    const fixture = taskFixture({
      annotations: [
        annotationFixture({
          elements: [
            {
              tagName: "button",
              selector: "#save",
              bounds: { x: 0, y: 0, width: 10, height: 10 },
              componentName: null,
              source: null,
              sourceStack: [],
              htmlPreview: "",
              styleText: "",
              fingerprint: {
                tagName: "button",
                role: "",
                accessibleName: "",
                text: "",
                identityAttributes: { id: "save" },
                childCount: 0,
                parent: { tagName: "div", role: "" },
              },
            },
          ],
        }),
      ],
    });
    const markdown = formatTaskMarkdown(fixture);
    expect(markdown).toContain("- componentName: (unresolved)");
    expect(markdown).toContain("- source: (unresolved)");
    expect(markdown).toContain("- sourceStack: (none)");
  });
});

describe("formatTaskMarkdown — includeCompleted option", () => {
  it("default renders ALL annotations", () => {
    const markdown = formatTaskMarkdown(v6Fixture);
    expect(markdown).toContain("## Annotations (2)");
  });

  it("includeCompleted:false renders ONLY open annotations (browser Copy default)", () => {
    const markdown = formatTaskMarkdown(v6Fixture, {
      includeCompleted: false,
    });
    expect(markdown).toContain("## Annotations (1)");
    expect(markdown).toContain("### Annotation 2: [region] ann-2");
    expect(markdown).not.toContain("ann-1");
  });

  it("includeCompleted:true is the explicit all-mode option (identical to default)", () => {
    const markdown = formatTaskMarkdown(v6Fixture, {
      includeCompleted: true,
    });
    expect(markdown).toContain("## Annotations (2)");
  });

  it("the OPEN-only copy keeps FULL-ORDER numbers (G03-01)", () => {
    const fixture = taskFixture({
      annotations: [
        annotationFixture({
          annotationId: "ann-1",
          status: "completed",
          completedAt: "2026-08-11T10:05:00.000Z",
        }),
        annotationFixture({
          annotationId: "ann-2",
          comment: "Open one",
        }),
        annotationFixture({
          annotationId: "ann-3",
          comment: "Open two",
        }),
      ],
    });
    const markdown = formatTaskMarkdown(fixture, { includeCompleted: false });
    expect(markdown).toContain("### Annotation 2: [element] ann-2");
    expect(markdown).toContain("### Annotation 3: [element] ann-3");
  });

  it("includeCompleted:false with only completed annotations renders an empty list", () => {
    const fixture = taskFixture({
      annotations: [
        annotationFixture({
          annotationId: "ann-1",
          status: "completed",
          completedAt: "2026-08-11T10:05:00.000Z",
        }),
      ],
    });
    const markdown = formatTaskMarkdown(fixture, { includeCompleted: false });
    expect(markdown).toContain("## Annotations (0)");
  });
});

describe("formatTaskMarkdown — completion command template", () => {
  it("includes the stable annotationId and the exact completion command", () => {
    const markdown = formatTaskMarkdown(v6Fixture);
    expect(markdown).toContain(
      "Complete (verified): pnpm studio:complete -- ann-1 --verified --summary \"what changed and how it was verified\""
    );
  });
});

describe("unsupported schema (shared typed result)", () => {
  it("renders v1-v5 artifacts as the unsupported_schema markdown, never normalized", () => {
    for (const version of [1, 2, 3, 4, 5]) {
      const markdown = formatTaskMarkdown({ schemaVersion: version });
      expect(markdown).toContain("# Unsupported task schema");
      expect(markdown).toContain(`- schemaVersion: ${version}`);
      expect(markdown).toContain("- expectedSchemaVersion: 6");
      expect(markdown).toContain("- clear: tasks/active-task.json");
    }
  });

  it("formatTaskJson renders the typed unsupported result", () => {
    const json = JSON.parse(formatTaskJson(v5Fixture));
    expect(json.status).toBe("unsupported_schema");
    expect(json.schemaVersion).toBe(5);
    expect(json.expectedSchemaVersion).toBe(6);
  });

  it("formatUnsupportedSchemaMarkdown renders the shared message", () => {
    const markdown = formatUnsupportedSchemaMarkdown({
      status: "unsupported_schema",
      schemaVersion: 5,
      expectedSchemaVersion: 6,
      clearInstruction: "clear it",
      clearPath: "tasks/active-task.json",
    });
    expect(markdown).toContain("# Unsupported task schema");
    expect(markdown).toContain("clear it");
  });
});

describe("formatTaskJson — golden v6 output", () => {
  it("serializes the artifact pretty-printed", () => {
    const json = formatTaskJson(v6Fixture);
    expect(json).toContain('"schemaVersion": 6');
    expect(JSON.parse(json).annotations).toHaveLength(2);
  });
});

describe("print CLI via the public package script", () => {
  it("prints the v6 task as JSON and exits 0", () => {
    const stdout = runCli(["--json"], v6Fixture);
    expect(JSON.parse(stdout).schemaVersion).toBe(6);
  });

  it("prints the v6 task as markdown and exits 0", () => {
    const stdout = runCli(["--markdown"], v6Fixture);
    expect(stdout).toContain("# Task golden-v6-1");
    expect(stdout).toContain("- selector: main > h1");
  });

  it("prints the unsupported_schema result for an old artifact and exits 0", () => {
    const stdout = runCli(["--markdown"], v5Fixture);
    expect(stdout).toContain("# Unsupported task schema");
    expect(stdout).toContain("- schemaVersion: 5");
  });
});
