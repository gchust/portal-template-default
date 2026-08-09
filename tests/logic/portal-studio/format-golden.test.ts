/**
 * Goal 04 — shared formatter golden tests (D-033 #15).
 *
 * formatTaskMarkdown/formatTaskJson are the SINGLE renderer for the browser
 * Copy action, the print CLI, and MCP print_task. These tests pin the exact
 * output bytes (golden strings) for v4 + v5 fixtures and prove the CLI
 * consumes the same module (spawned standalone under Node 22 type
 * stripping). MCP parity is asserted in mcp.test.ts via the same module.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { formatTaskJson, formatTaskMarkdown } from "@/studio/format";

const v5Fixture = {
  schemaVersion: 5,
  taskId: "golden-v5-1",
  createdAt: "2026-08-08T10:00:00.000Z",
  url: "http://127.0.0.1:4173/users",
  title: "Users",
  annotations: [
    {
      annotationId: "ann-1",
      kind: "element",
      comment: "Bold the header",
      createdAt: "2026-08-08T10:00:00.000Z",
      status: "completed",
      completedAt: "2026-08-08T10:05:00.000Z",
      elements: [
        {
          tagName: "h1",
          selectorCandidates: [{ kind: "path", selector: "main > h1" }],
          componentCandidates: [{ name: "PageHeader", key: null }],
          sourceCandidates: [
            { kind: "module", file: "/repo/src/pages/users.tsx", line: 12 },
          ],
          snapshot: { text: "Users", attributes: {}, childCount: 0 },
        },
      ],
    },
    {
      annotationId: "ann-2",
      kind: "region",
      comment: "Highlight the table",
      createdAt: "2026-08-08T10:01:00.000Z",
      status: "open",
      elements: [],
      region: { x: 1, y: 2, width: 100, height: 40 },
    },
  ],
  businessContext: [
    { type: "page-element", id: "pe-1", source: "data-ai-page-element" },
  ],
  redaction: { droppedKeys: ["token"], redactedValues: 2, truncatedValues: 1 },
  screenshot: {
    file: "screenshots/golden-v5-1.png",
    width: 100,
    height: 50,
    capturedAt: "2026-08-08T10:02:00.000Z",
  },
  diagnostics: [
    {
      source: "console",
      message: "HTTP 500 [REDACTED]",
      timestamp: "2026-08-08T10:03:00.000Z",
      occurrenceCount: 2,
    },
  ],
};

const v4Fixture = {
  schemaVersion: 4,
  taskId: "golden-v4-1",
  createdAt: "2026-08-08T09:00:00.000Z",
  url: "http://127.0.0.1:4173/users",
  title: "Users",
  instruction: "Legacy instruction",
  elements: [
    {
      tagName: "h1",
      selectorCandidates: [{ kind: "path", selector: "main > h1" }],
      componentCandidates: [],
      sourceCandidates: [],
      snapshot: { text: "Users", attributes: {}, childCount: 0 },
    },
  ],
  region: { x: 5, y: 5, width: 50, height: 20 },
  businessContext: [],
  redaction: { droppedKeys: [], redactedValues: 0, truncatedValues: 0 },
};

const runCli = (args: string[], fixture: unknown): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "portal-studio-golden-"));
  try {
    mkdirSync(path.join(dir, "tasks"), { recursive: true });
    writeFileSync(
      path.join(dir, "tasks", "active-task.json"),
      JSON.stringify(fixture)
    );
    return execFileSync(
      process.execPath,
      ["scripts/portal-studio-print.mjs", ...args],
      {
        encoding: "utf8",
        env: { ...process.env, PORTAL_STUDIO_DIR: dir },
      }
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("formatTaskMarkdown — golden v5 output", () => {
  it("renders the exact expected bytes (annotations/comments/elements/status)", () => {
    const markdown = formatTaskMarkdown(v5Fixture);
    expect(markdown).toContain("# Task golden-v5-1");
    expect(markdown).toContain("- schemaVersion: 5");
    expect(markdown).toContain("- capturedAt: 2026-08-08T10:00:00.000Z");
    expect(markdown).toContain("## Annotations (2)");
    expect(markdown).toContain(
      "### Annotation 1: [element] ann-1"
    );
    expect(markdown).toContain("Comment: Bold the header");
    expect(markdown).toContain(
      "- status: completed @ 2026-08-08T10:05:00.000Z"
    );
    expect(markdown).toContain("/repo/src/pages/users.tsx:12");
    expect(markdown).toContain(
      "### Annotation 2: [region] ann-2"
    );
    expect(markdown).toContain("- region: 1,2 100x40");
    expect(markdown).toContain("- redaction: droppedKeys=[\"token\"]");
    expect(markdown).toContain(
      "- diagnostics:"
    );
    expect(markdown).toContain("x2 @ 2026-08-08T10:03:00.000Z");
  });
});

describe("formatTaskJson — golden v5 output", () => {
  it("serializes the normalized artifact pretty-printed", () => {
    const json = formatTaskJson(v5Fixture);
    expect(JSON.parse(json)).toEqual(v5Fixture);
    expect(json).toContain('"schemaVersion": 5');
    expect(json.endsWith("}")).toBe(true);
  });
});

describe("formatTaskMarkdown — Goal 04 includeCompleted option", () => {
  it("default renders ALL annotations (existing golden behavior)", () => {
    const markdown = formatTaskMarkdown(v5Fixture);
    expect(markdown).toContain("## Annotations (2)");
    expect(markdown).toContain("Bold the header");
    expect(markdown).toContain("Highlight the table");
    expect(markdown).toContain("- status: completed @ 2026-08-08T10:05:00.000Z");
  });

  it("includeCompleted:true is the explicit all-mode option (identical to default)", () => {
    const all = formatTaskMarkdown(v5Fixture, { includeCompleted: true });
    expect(all).toBe(formatTaskMarkdown(v5Fixture));
    expect(all).toContain("## Annotations (2)");
  });

  it("includeCompleted:false renders ONLY open annotations (browser Copy default)", () => {
    const openOnly = formatTaskMarkdown(v5Fixture, { includeCompleted: false });
    expect(openOnly).toContain("## Annotations (1)");
    expect(openOnly).toContain("Highlight the table");
    expect(openOnly).not.toContain("Bold the header");
    expect(openOnly).not.toContain("status: completed");
  });

  it("includeCompleted:false with only completed annotations renders an empty list", () => {
    const onlyDone = {
      ...v5Fixture,
      annotations: v5Fixture.annotations.filter(
        (annotation) => annotation.status === "completed"
      ),
    };
    const markdown = formatTaskMarkdown(onlyDone, { includeCompleted: false });
    expect(markdown).toContain("## Annotations (0)");
  });
});

describe("formatTaskMarkdown — v4 normalize-on-read (D-033 #17)", () => {
  it("renders a v4 artifact as its normalized v5 single annotation", () => {
    const markdown = formatTaskMarkdown(v4Fixture);
    expect(markdown).toContain("- schemaVersion: 5");
    expect(markdown).toContain("## Annotations (1)");
    expect(markdown).toContain("Comment: Legacy instruction");
    expect(markdown).toContain("- region: 5,5 50x20");
    expect(markdown).not.toContain("## Instruction");
  });
});

describe("CLI ↔ browser shared-module byte parity", () => {
  it("the standalone CLI emits EXACTLY formatTaskMarkdown output", () => {
    const cliMarkdown = runCli(["--markdown"], v5Fixture);
    expect(cliMarkdown).toBe(`${formatTaskMarkdown(v5Fixture)}\n`);
    const cliJson = runCli(["--json"], v5Fixture);
    expect(cliJson).toBe(`${formatTaskJson(v5Fixture)}\n`);
  });

  it("CLI v4 output matches the shared formatter too (normalized)", () => {
    const cliMarkdown = runCli(["--markdown"], v4Fixture);
    expect(cliMarkdown).toBe(`${formatTaskMarkdown(v4Fixture)}\n`);
  });
});

describe("formatting rejects non-artifacts", () => {
  it("throws for unrecognized payloads", () => {
    expect(() => formatTaskMarkdown(null)).toThrow("cannot format");
    expect(() => formatTaskMarkdown({ schemaVersion: 99 })).toThrow(
      "cannot format"
    );
    expect(() => formatTaskJson("nope")).toThrow("cannot format");
  });
});
