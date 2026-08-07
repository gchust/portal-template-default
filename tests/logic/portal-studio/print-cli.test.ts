import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  TASK_SCHEMA_VERSION,
  TASK_SCHEMA_VERSION_V1,
  TASK_SCHEMA_VERSION_V2,
} from "@/studio/types";

const SCRIPT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../scripts/portal-studio-print.mjs"
);

const sampleV2Task = {
  schemaVersion: TASK_SCHEMA_VERSION_V2,
  taskId: "task-print-2",
  createdAt: "2026-08-07T12:00:00.000Z",
  url: "http://127.0.0.1:5176/users",
  title: "Users",
  instruction: "Increase padding.",
  elements: [
    {
      tagName: "tr",
      selectorCandidates: [{ kind: "path", selector: "tbody > tr" }],
      componentCandidates: [
        { name: "TableRow", key: "1", kind: "fiber" },
        { name: "DataTable", key: null },
      ],
      sourceCandidates: [
        { kind: "module", file: "/repo/registry/users/list.tsx", line: 42 },
      ],
      snapshot: {
        text: "Alice",
        attributes: { class: "row" },
        childCount: 4,
        domOutline: "tr#row-1.row",
        computedStyle: { display: "table-row" },
      },
    },
  ],
  region: { x: 10, y: 20, width: 300, height: 120 },
  businessContext: [
    { type: "page-element", id: "pe-1", source: "data-ai-page-element" },
  ],
  redaction: { droppedKeys: [], redactedValues: 1, truncatedValues: 0 },
  screenshot: {
    file: "screenshots/task-print-2.png",
    width: 1200,
    height: 800,
  },
};

const sampleV3Task = {
  schemaVersion: TASK_SCHEMA_VERSION,
  taskId: "task-print-3",
  createdAt: "2026-08-07T12:00:00.000Z",
  url: "http://127.0.0.1:5176/users",
  title: "Users",
  instruction: "Increase padding.",
  elements: [
    {
      tagName: "tr",
      selectorCandidates: [{ kind: "path", selector: "tbody > tr" }],
      componentCandidates: [{ name: "TableRow", key: "1", kind: "fiber" }],
      sourceCandidates: [
        { kind: "module", file: "/repo/registry/users/list.tsx", line: 42 },
      ],
      snapshot: {
        text: "Alice",
        attributes: { class: "row" },
        childCount: 4,
      },
    },
  ],
  businessContext: [],
  redaction: { droppedKeys: [], redactedValues: 0, truncatedValues: 0 },
  screenshot: {
    file: "screenshots/task-print-3.png",
    width: 1200,
    height: 800,
    capturedAt: "2026-08-07T12:00:05.000Z",
  },
  diagnostics: [
    {
      source: "console",
      message: "boom",
      timestamp: "2026-08-07T12:00:04.000Z",
      occurrenceCount: 3,
    },
    {
      source: "fetch",
      message: "HTTP 500",
      url: "http://x/api",
      timestamp: "2026-08-07T12:00:04.500Z",
      occurrenceCount: 1,
    },
  ],
  heartbeat: {
    state: "stale",
    reportedAt: "2026-08-07T12:00:05.000Z",
    checkedAt: "2026-08-07T12:00:20.000Z",
    lastOnlineAt: "2026-08-07T12:00:05.000Z",
  },
};

const sampleV1Task = {
  schemaVersion: TASK_SCHEMA_VERSION_V1,
  taskId: "task-print-1",
  createdAt: "2026-08-07T12:00:00.000Z",
  url: "http://127.0.0.1:5176/users",
  title: "Users",
  instruction: "Increase padding.",
  element: {
    tagName: "tr",
    selectorCandidates: [{ kind: "path", selector: "tbody > tr" }],
    componentCandidates: [
      { name: "TableRow", key: "1" },
      { name: "DataTable", key: null },
    ],
    sourceCandidates: [
      { kind: "module", file: "/repo/registry/users/list.tsx", line: 42 },
    ],
    snapshot: {
      text: "Alice",
      attributes: { class: "row" },
      childCount: 4,
    },
  },
};

const run = (
  args: string[],
  studioDir: string
): { stdout: string; stderr: string; status: number } => {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      encoding: "utf8",
      env: { ...process.env, PORTAL_STUDIO_DIR: studioDir },
    });
    return { stdout, stderr: "", status: 0 };
  } catch (error) {
    const failed = error as {
      stdout?: string;
      stderr?: string;
      status?: number;
    };
    return {
      stdout: String(failed.stdout ?? ""),
      stderr: String(failed.stderr ?? ""),
      status: failed.status ?? 1,
    };
  }
};

const makeStudioDir = (task: unknown) => {
  const dir = mkdtempSync(path.join(tmpdir(), "portal-studio-print-"));
  mkdirSync(path.join(dir, "tasks"), { recursive: true });
  writeFileSync(
    path.join(dir, "tasks", "active-task.json"),
    JSON.stringify(task, null, 2)
  );
  return dir;
};

describe("portal-studio-print CLI", () => {
  it("prints v2 JSON by default and exits 0", () => {
    const dir = makeStudioDir(sampleV2Task);
    const result = run(["--json"], dir);
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toMatchObject({
      schemaVersion: 2,
      taskId: "task-print-2",
      instruction: "Increase padding.",
    });
    expect(parsed.elements).toHaveLength(1);
    expect(parsed.redaction.redactedValues).toBe(1);
    expect(parsed.screenshot.file).toBe("screenshots/task-print-2.png");
    rmSync(dir, { recursive: true, force: true });
  });

  it("prints v2 markdown with the full artifact summary", () => {
    const dir = makeStudioDir(sampleV2Task);
    const result = run(["--markdown"], dir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("# Task task-print-2");
    expect(result.stdout).toContain("Increase padding.");
    expect(result.stdout).toContain("TableRow (fiber)");
    expect(result.stdout).toContain("/repo/registry/users/list.tsx:42");
    expect(result.stdout).toContain("region: 10,20 300x120");
    expect(result.stdout).toContain("screenshot: screenshots/task-print-2.png");
    expect(result.stdout).toContain("page-element");
    expect(result.stdout).toContain("redaction:");
    expect(result.stdout).toContain("domOutline: tr#row-1.row");
    rmSync(dir, { recursive: true, force: true });
  });

  it("renders v3 diagnostics, heartbeat, and capturedAt in markdown", () => {
    const dir = makeStudioDir(sampleV3Task);
    const json = run(["--json"], dir);
    expect(json.status).toBe(0);
    const parsed = JSON.parse(json.stdout);
    expect(parsed.schemaVersion).toBe(3);
    expect(parsed.diagnostics).toHaveLength(2);
    expect(parsed.heartbeat.state).toBe("stale");
    expect(parsed.screenshot.capturedAt).toBe("2026-08-07T12:00:05.000Z");

    const markdown = run(["--markdown"], dir);
    expect(markdown.status).toBe(0);
    expect(markdown.stdout).toContain("heartbeat: stale");
    expect(markdown.stdout).toContain("[console] x3");
    expect(markdown.stdout).toContain("[fetch] x1");
    expect(markdown.stdout).toContain("capturedAt=2026-08-07T12:00:05.000Z");
    rmSync(dir, { recursive: true, force: true });
  });

  it("renders v2 artifacts without diagnostics sections", () => {
    const v2Task = {
      ...sampleV2Task,
      schemaVersion: TASK_SCHEMA_VERSION_V2,
    };
    const dir = makeStudioDir(v2Task);
    const json = run(["--json"], dir);
    expect(JSON.parse(json.stdout).schemaVersion).toBe(2);
    expect(run(["--markdown"], dir).stdout).not.toContain("heartbeat:");
    rmSync(dir, { recursive: true, force: true });
  });

  it("renders v1 artifacts through the same markdown path", () => {
    const dir = makeStudioDir(sampleV1Task);
    const json = run(["--json"], dir);
    expect(json.status).toBe(0);
    expect(JSON.parse(json.stdout).schemaVersion).toBe(1);
    const markdown = run(["--markdown"], dir);
    expect(markdown.status).toBe(0);
    expect(markdown.stdout).toContain("TableRow");
    expect(markdown.stdout).toContain("/repo/registry/users/list.tsx:42");
    rmSync(dir, { recursive: true, force: true });
  });

  it("matches a requested task id", () => {
    const dir = makeStudioDir(sampleV2Task);
    expect(run(["--task", "task-print-2"], dir).status).toBe(0);
    const missing = run(["--task", "other-id"], dir);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("not found");
    rmSync(dir, { recursive: true, force: true });
  });

  it("exits 1 with a clear message when no task exists", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "portal-studio-print-empty-"));
    const result = run([], dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no task found");
    rmSync(dir, { recursive: true, force: true });
  });

  it("exits 2 on invalid arguments", () => {
    const dir = makeStudioDir(sampleV2Task);
    const result = run(["--bogus"], dir);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Unknown argument");
    expect(run(["--task", "../evil"], dir).status).toBe(2);
    rmSync(dir, { recursive: true, force: true });
  });
});
