/**
 * Goal 05 — agent CLI unit tests (studio:list / studio:complete /
 * studio:reopen). Spawns the real script against a fixture studio dir.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../scripts/portal-studio-agent.mjs"
);

const baseTask = {
  schemaVersion: 5,
  taskId: "agent-test-1",
  createdAt: "2026-08-09T00:00:00.000Z",
  url: "http://127.0.0.1:4173/users",
  title: "Users",
  annotations: [
    {
      annotationId: "ann-a",
      kind: "element",
      comment: "Fix the header",
      createdAt: "2026-08-09T00:00:00.000Z",
      status: "open",
      elements: [],
    },
    {
      annotationId: "ann-b",
      kind: "region",
      comment: "Done item",
      createdAt: "2026-08-09T00:00:00.000Z",
      status: "completed",
      completedAt: "2026-08-09T01:00:00.000Z",
      elements: [],
    },
  ],
  businessContext: [],
  redaction: { droppedKeys: [], redactedValues: 0, truncatedValues: 0 },
};

let root: string;

const readTask = () =>
  JSON.parse(
    readFileSync(path.join(root, "tasks", "active-task.json"), "utf8")
  ) as {
    taskRevision?: number;
    annotations: Array<{
      annotationId: string;
      status: string;
      comment: string;
      extra?: string;
      completedEvidence?: { verified: boolean; summary: string; source: string };
    }>;
  };

const run = (args: string[]) => {
  try {
    return {
      status: 0,
      stdout: execFileSync(process.execPath, [SCRIPT, ...args], {
        encoding: "utf8",
        env: { ...process.env, PORTAL_STUDIO_DIR: root },
      }),
      stderr: "",
    };
  } catch (error) {
    const e = error as {
      status?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      status: e.status ?? 1,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
    };
  }
};

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "ps-agent-cli-"));
  mkdirSync(path.join(root, "tasks"), { recursive: true });
  writeFileSync(
    path.join(root, "tasks", "active-task.json"),
    JSON.stringify(baseTask, null, 2)
  );
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("studio:list", () => {
  it("prints every annotation with id, status and comment (exit 0)", () => {
    const result = run(["list"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("ann-a");
    expect(result.stdout).toContain("ann-b");
    expect(result.stdout).toContain("[open]");
    expect(result.stdout).toContain("[completed]");
    expect(result.stdout).toContain("Fix the header");
  });

  it("exits 1 when no task exists", () => {
    rmSync(path.join(root, "tasks", "active-task.json"));
    const result = run(["list"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no task found");
  });
});

describe("studio:complete", () => {
  it("completes with --verified + summary, records evidence additively, bumps taskRevision (exit 0)", () => {
    const result = run([
      "complete",
      "--",
      "ann-a",
      "--verified",
      "--summary",
      "Fixed header; verified via reload",
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("completed ann-a");
    const task = readTask();
    expect(task.taskRevision).toBe(1);
    const annotation = task.annotations[0];
    expect(annotation.status).toBe("completed");
    expect(annotation.completedEvidence).toEqual({
      verified: true,
      summary: "Fixed header; verified via reload",
      source: "cli",
      completedAt: expect.any(String),
    });
  });

  it("preserves unrelated fields and other annotations", () => {
    const taskWithExtra = structuredClone(baseTask);
    taskWithExtra.annotations[0].extra = "keep-me";
    taskWithExtra.annotations[1].comment = "edited comment";
    writeFileSync(
      path.join(root, "tasks", "active-task.json"),
      JSON.stringify(taskWithExtra, null, 2)
    );
    run(["complete", "--", "ann-a", "--verified", "--summary", "done"]);
    const task = readTask();
    expect(task.annotations[0].extra).toBe("keep-me");
    expect(task.annotations[0].status).toBe("completed");
    // The OTHER annotation is untouched.
    expect(task.annotations[1].status).toBe("completed");
    expect(task.annotations[1].comment).toBe("edited comment");
    expect(task.annotations[1].completedEvidence).toBeUndefined();
  });

  it("exits 2 without --verified", () => {
    const result = run(["complete", "--", "ann-a", "--summary", "x"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--verified");
  });

  it("exits 2 with an empty summary", () => {
    const result = run(["complete", "--", "ann-a", "--verified", "--summary", "  "]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("non-empty --summary");
  });

  it("exits 2 with a summary over the bound", () => {
    const result = run([
      "complete",
      "--",
      "ann-a",
      "--verified",
      "--summary",
      "x".repeat(2001),
    ]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("at most 2000");
  });

  it("exits 1 for an unknown annotation id", () => {
    const result = run([
      "complete",
      "--",
      "no-such-id",
      "--verified",
      "--summary",
      "x",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("not found");
  });

  it("is a no-op (no write) for an already-completed annotation", () => {
    run(["complete", "--", "ann-a", "--verified", "--summary", "first"]);
    const afterFirst = readTask();
    const result = run(["complete", "--", "ann-a", "--verified", "--summary", "again"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("already completed");
    const afterSecond = readTask();
    expect(afterSecond.taskRevision).toBe(afterFirst.taskRevision);
    expect(afterSecond.annotations[0].completedEvidence?.summary).toBe("first");
  });
});

describe("studio:reopen", () => {
  it("reopens a completed annotation, clears evidence, bumps taskRevision (exit 0)", () => {
    run(["complete", "--", "ann-a", "--verified", "--summary", "done"]);
    const result = run(["reopen", "--", "ann-a"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("reopened ann-a");
    const task = readTask();
    expect(task.taskRevision).toBe(2);
    expect(task.annotations[0].status).toBe("open");
    expect(task.annotations[0].completedEvidence).toBeUndefined();
    expect(task.annotations[0].completedAt).toBeUndefined();
  });

  it("exits 1 for an unknown annotation id", () => {
    const result = run(["reopen", "--", "no-such-id"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("not found");
  });

  it("exits 2 with wrong arity", () => {
    const result = run(["reopen", "--"]);
    expect(result.status).toBe(2);
  });

  it("is a no-op (no write) for an already-open annotation", () => {
    const before = readTask();
    const result = run(["reopen", "--", "ann-a"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("already open");
    expect(readTask().taskRevision).toBe(before.taskRevision);
  });
});

describe("legacy v1-v4 artifact normalization (review P2)", () => {
  it("list shows the normalized v5 annotation and complete addresses the browser-visible id", () => {
    const v4 = {
      schemaVersion: 4,
      taskId: "legacy-task",
      createdAt: "2026-08-09T00:00:00.000Z",
      url: "http://127.0.0.1:4173/users",
      title: "Users",
      instruction: "Fix the header",
      elements: [],
      businessContext: [],
      redaction: { droppedKeys: [], redactedValues: 0, truncatedValues: 0 },
    };
    writeFileSync(
      path.join(root, "tasks", "active-task.json"),
      JSON.stringify(v4, null, 2)
    );
    const listed = run(["list"]);
    expect(listed.status).toBe(0);
    // normalizeV4ToV5 produces the browser-visible id `${taskId}-v4`.
    expect(listed.stdout).toContain("legacy-task-v4");
    const result = run([
      "complete",
      "--",
      "legacy-task-v4",
      "--verified",
      "--summary",
      "Fixed; verified",
    ]);
    expect(result.status).toBe(0);
    const task = readTask();
    expect(task.schemaVersion).toBe(5);
    expect(task.annotations[0].status).toBe("completed");
    expect(task.annotations[0].completedEvidence?.summary).toBe("Fixed; verified");
  });
});

describe("CLI argument handling", () => {
  it("prints usage and exits 0 for --help", () => {
    const result = run(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage:");
  });

  it("exits 2 for an unknown command", () => {
    const result = run(["frobnicate"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("unknown command");
  });
});
