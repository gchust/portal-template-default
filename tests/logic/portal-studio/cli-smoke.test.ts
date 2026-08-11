/**
 * Goal 04 (G04-01) — PROCESS-level smoke tests for the REAL package
 * scripts (`pnpm studio:list / studio:complete / studio:reopen`). These
 * launch the actual package-script command line (tsx on the agent CLI,
 * which imports the shared .ts modules) against a real task artifact —
 * not just imported-function tests.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const TASK_PATH = path.join("tasks", "active-task.json");

const baseTask = {
  schemaVersion: 5,
  taskId: "task-smoke-1",
  createdAt: "2026-08-11T00:00:00.000Z",
  url: "http://127.0.0.1:4173/users",
  title: "Users",
  annotations: [
    {
      annotationId: "ann-aaa",
      kind: "element",
      comment: "Fix the padding",
      createdAt: "2026-08-11T00:00:00.000Z",
      status: "open",
      elements: [],
    },
    {
      annotationId: "ann-bbb",
      kind: "region",
      comment: "Tighten the header",
      createdAt: "2026-08-11T00:00:00.000Z",
      status: "open",
      elements: [],
    },
  ],
  businessContext: [],
  redaction: { droppedKeys: [], redactedValues: 0, truncatedValues: 0 },
};

let dir: string;

beforeEach(() => {
  dir = path.join(os.tmpdir(), `g04-cli-smoke-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(path.join(dir, "tasks"), { recursive: true });
  process.env.PORTAL_STUDIO_DIR = dir;
});

afterEach(() => {
  delete process.env.PORTAL_STUDIO_DIR;
  rmSync(dir, { recursive: true, force: true });
});

/** Run the REAL package script (pnpm studio:<cmd> ...). */
const runScript = (script: string, args: string[] = []) => {
  try {
    const stdout = execFileSync("pnpm", ["run", script, "--", ...args], {
      encoding: "utf8",
      env: { ...process.env, PORTAL_STUDIO_DIR: dir },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout };
  } catch (error) {
    const e = error as {
      status?: number;
      stdout?: Buffer | string;
      stderr?: Buffer | string;
    };
    return {
      status: e.status ?? 1,
      stdout: String(e.stdout ?? ""),
      stderr: String(e.stderr ?? ""),
    };
  }
};

const readTask = () =>
  JSON.parse(readFileSync(path.join(dir, TASK_PATH), "utf8"));

describe("G04-01 — package-script CLI process smoke (tsx runtime, real task file)", () => {
  it("studio:list launches on the documented baseline WITHOUT experimental flags and prints the task", () => {
    writeFileSync(path.join(dir, TASK_PATH), JSON.stringify(baseTask));
    const result = runScript("studio:list");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("1. [open] ann-aaa: Fix the padding");
    expect(result.stdout).toContain("2. [open] ann-bbb: Tighten the header");
    // tsx runs the .mjs→.ts chain — no experimental flags involved.
    expect(result.stdout).not.toContain("experimental");
  });

  it("studio:list exits 1 with a clear message when no task exists", () => {
    const result = runScript("studio:list");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no task found");
  });

  it("studio:complete -- <id> --verified --summary end-to-end: exits 0, stamps evidence + taskRevision + updatedAt, preserves createdAt", () => {
    writeFileSync(path.join(dir, TASK_PATH), JSON.stringify(baseTask));
    const result = runScript("studio:complete", [
      "ann-aaa",
      "--verified",
      "--summary",
      "increased the row padding and verified visually",
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("completed ann-aaa");
    const task = readTask();
    expect(task.annotations[0].status).toBe("completed");
    expect(task.annotations[0].completedEvidence).toMatchObject({
      verified: true,
      summary: "increased the row padding and verified visually",
      source: "cli",
    });
    expect(task.taskRevision).toBe(1);
    expect(typeof task.updatedAt).toBe("string");
    // createdAt stays ORIGINAL (immutable identity).
    expect(task.createdAt).toBe(baseTask.createdAt);
  });

  it("studio:reopen -- <id> end-to-end: exits 0, clears evidence, bumps the revision", () => {
    const completed = {
      ...baseTask,
      annotations: baseTask.annotations.map((annotation) =>
        annotation.annotationId === "ann-aaa"
          ? {
              ...annotation,
              status: "completed",
              completedEvidence: {
                verified: true,
                summary: "done",
                source: "cli" as const,
                completedAt: "2026-08-11T01:00:00.000Z",
              },
            }
          : annotation
      ),
    };
    writeFileSync(path.join(dir, TASK_PATH), JSON.stringify(completed));
    const result = runScript("studio:reopen", ["ann-aaa"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("reopened ann-aaa");
    const task = readTask();
    expect(task.annotations[0].status).toBe("open");
    expect(task.annotations[0].completedEvidence).toBeUndefined();
    expect(task.taskRevision).toBe(1);
    expect(task.createdAt).toBe(baseTask.createdAt);
  });

  it("CLI rejects invalid ids (exit 1) and over-bounded summaries (exit 2)", () => {
    writeFileSync(path.join(dir, TASK_PATH), JSON.stringify(baseTask));
    const badId = runScript("studio:complete", [
      "nope",
      "--verified",
      "--summary",
      "x",
    ]);
    expect(badId.status).toBe(1);
    expect(badId.stderr).toContain('annotation "nope" not found');
    const malformedId = runScript("studio:complete", [
      "../etc/passwd",
      "--verified",
      "--summary",
      "x",
    ]);
    expect(malformedId.status).toBe(1);
    expect(malformedId.stderr).toContain("invalid annotation id");
    const tooLong = runScript("studio:complete", [
      "ann-aaa",
      "--verified",
      "--summary",
      "x".repeat(2001),
    ]);
    expect(tooLong.status).toBe(2);
    expect(tooLong.stderr).toContain("at most");
    const noVerified = runScript("studio:complete", ["ann-aaa", "--summary", "x"]);
    expect(noVerified.status).toBe(2);
    expect(noVerified.stderr).toContain("--verified");
  });

  it("CLI list output covers every annotation with its stable id and comment", () => {
    // Redundant with the launch smoke above but kept as an explicit
    // identity guarantee: the listing addresses the SAME ids the other
    // commands consume (complete/reopen resolve them).
    writeFileSync(path.join(dir, TASK_PATH), JSON.stringify(baseTask));
    const listed = runScript("studio:list");
    expect(listed.status).toBe(0);
    expect(listed.stdout).toContain("ann-aaa");
    expect(listed.stdout).toContain("ann-bbb");
    expect(listed.stdout).toContain("Fix the padding");
    expect(listed.stdout).toContain("Tighten the header");
  });
});
