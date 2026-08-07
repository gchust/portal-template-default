import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { TASK_SCHEMA_VERSION } from "@/studio/types";

const SCRIPT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../scripts/portal-studio-print.mjs"
);

const sampleTask = {
  schemaVersion: TASK_SCHEMA_VERSION,
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
    const stdout = execFileSync(
      process.execPath,
      [SCRIPT, ...args],
      {
        encoding: "utf8",
        env: { ...process.env, PORTAL_STUDIO_DIR: studioDir },
      }
    );
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

const makeStudioDir = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "portal-studio-print-"));
  mkdirSync(path.join(dir, "tasks"), { recursive: true });
  writeFileSync(
    path.join(dir, "tasks", "active-task.json"),
    JSON.stringify(sampleTask, null, 2)
  );
  return dir;
};

describe("portal-studio-print CLI", () => {
  it("prints JSON by default and exits 0", () => {
    const dir = makeStudioDir();
    const result = run(["--json"], dir);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      taskId: "task-print-1",
      instruction: "Increase padding.",
    });
    rmSync(dir, { recursive: true, force: true });
  });

  it("prints markdown with a readable summary", () => {
    const dir = makeStudioDir();
    const result = run(["--markdown"], dir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("# Task task-print-1");
    expect(result.stdout).toContain("Increase padding.");
    expect(result.stdout).toContain("TableRow");
    expect(result.stdout).toContain("/repo/registry/users/list.tsx:42");
    rmSync(dir, { recursive: true, force: true });
  });

  it("matches a requested task id", () => {
    const dir = makeStudioDir();
    expect(run(["--task", "task-print-1"], dir).status).toBe(0);
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
    const dir = makeStudioDir();
    const result = run(["--bogus"], dir);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Unknown argument");
    expect(run(["--task", "../evil"], dir).status).toBe(2);
    rmSync(dir, { recursive: true, force: true });
  });
});
