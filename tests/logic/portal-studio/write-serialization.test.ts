/**
 * Goal 04 (G04-02 / shared contract §13) — DETERMINISTIC PROCESS-LEVEL
 * concurrency regressions for the cross-process serialized task write
 * boundary. Real child processes (via the tsx loader) force OVERLAPPING
 * browser/CLI-equivalent writers against one task artifact and prove:
 *   - a stale writer (expected-revision mismatch against the LOCKED
 *     authoritative read) fails with a conflict and NEVER writes;
 *   - both non-conflicting operations survive through a safe retry;
 *   - equal taskRevision stamps are impossible (burst of 4 → exactly one
 *     winner, then the retried losers land sequentially at rev 2..4).
 */
import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const FIXTURE = path.resolve(
  "tests/logic/portal-studio/fixtures/serialized-writer-child.mjs"
);

const baseTask = (annotationIds: string[]) => ({
  schemaVersion: 6,
  taskId: "task-serialized-1",
  createdAt: "2026-08-11T00:00:00.000Z",
  url: "http://127.0.0.1:4173/users",
  title: "Users",
  annotations: annotationIds.map((annotationId) => ({
    annotationId,
    kind: "element",
    comment: `comment ${annotationId}`,
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
  })),
  businessContext: [],
  redaction: { droppedKeys: [], redactedValues: 0, truncatedValues: 0 },
});

let dir: string;

beforeEach(() => {
  dir = path.join(
    os.tmpdir(),
    `g04-serialized-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(path.join(dir, "tasks"), { recursive: true });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const readTask = () =>
  JSON.parse(readFileSync(path.join(dir, "tasks", "active-task.json"), "utf8"));

/** Run the child fixture (a real separate process). */
const child = (
  mode: string,
  annotationId: string,
  expected: number | undefined
): { ok: boolean; error?: string; revision?: number; noop?: boolean } =>
  JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        FIXTURE,
        dir,
        mode,
        annotationId,
        expected === undefined ? "undefined" : String(expected),
      ],
      { encoding: "utf8" }
    )
  );

const waitForMarker = (name: string, timeoutMs = 8000) => {
  const marker = path.join(dir, "test-markers", name);
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(marker) && Date.now() < deadline) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
  expect(existsSync(marker), `marker ${name} should appear`).toBe(true);
};

/** Spawn a child WITHOUT blocking the test thread (barrier-driven). */
const spawnChild = (mode: string, annotationId: string, expected: number | undefined) => {
  const proc = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      FIXTURE,
      dir,
      mode,
      annotationId,
      expected === undefined ? "undefined" : String(expected),
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  let stdout = "";
  let stderr = "";
  proc.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  proc.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  return {
    proc,
    stdout: () => stdout,
    stderr: () => stderr,
  };
};

const awaitChildExit = (proc: ReturnType<typeof spawn>) =>
  new Promise<void>((resolve, reject) => {
    // The child may already have exited (e.g. a crash) before the
    // listener attached — never hang on a missed event.
    if (proc.exitCode !== null) {
      if (proc.exitCode === 0) resolve();
      else reject(new Error(`child exit code ${proc.exitCode}`));
      return;
    }
    proc.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`child exit code ${code}`));
    });
    proc.on("error", reject);
  });

describe("G04-02 — cross-process serialized task writes (deterministic, process-level)", () => {
  it("a STALE writer fails with a conflict while the lock holder's write survives (no lost data)", async () => {
    writeFileSync(
      path.join(dir, "tasks", "active-task.json"),
      JSON.stringify(baseTask(["ann-a", "ann-b"]))
    );
    // Writer A (browser/CLI-equivalent) acquires the lock and HOLDS it.
    const hold = spawnChild("hold", "ann-a", 0);
    waitForMarker("locked");
    // Writer B starts while the lock is held, with the SAME expected
    // revision 0 — it must block, then fail with a conflict once A's
    // write lands (rev 1 ≠ expected 0), writing NOTHING.
    const attempt = spawnChild("attempt", "ann-b", 0);
    await new Promise((resolve) => setTimeout(resolve, 200));
    writeFileSync(path.join(dir, "test-markers", "release"), "1");
    await awaitChildExit(hold.proc);
    await awaitChildExit(attempt.proc);
    const outcomeA = JSON.parse(hold.stdout());
    const outcomeB = JSON.parse(attempt.stdout());
    // A succeeded at rev 1; B conflicted and never wrote.
    expect(outcomeA.ok).toBe(true);
    expect(outcomeA.revision).toBe(1);
    expect(outcomeB.ok).toBe(false);
    expect(outcomeB.error).toBe("revision_conflict");
    const task = readTask();
    expect(task.taskRevision).toBe(1);
    expect(typeof task.updatedAt).toBe("string");
    const statuses = Object.fromEntries(
      task.annotations.map((annotation) => [
        annotation.annotationId,
        annotation.status,
      ])
    );
    // A's op landed; B's op did NOT overwrite anything (no lost data).
    expect(statuses["ann-a"]).toBe("completed");
    expect(statuses["ann-b"]).toBe("open");
  });

  it("the stale writer's operation survives through a SAFE RETRY with the fresh revision", async () => {
    writeFileSync(
      path.join(dir, "tasks", "active-task.json"),
      JSON.stringify(baseTask(["ann-a", "ann-b"]))
    );
    // Same race as above: A holds the lock and writes rev 1.
    const hold = spawnChild("hold", "ann-a", 0);
    waitForMarker("locked");
    const attempt = spawnChild("attempt", "ann-b", 0);
    await new Promise((resolve) => setTimeout(resolve, 200));
    writeFileSync(path.join(dir, "test-markers", "release"), "1");
    await awaitChildExit(hold.proc);
    await awaitChildExit(attempt.proc);
    const outcomeB = JSON.parse(attempt.stdout());
    expect(outcomeB.ok).toBe(false);
    expect(outcomeB.error).toBe("revision_conflict");
    // The conflict payload carries the current revision → safe retry.
    const retryRevision = readTask().taskRevision;
    expect(retryRevision).toBe(1);
    const retry = child("attempt", "ann-b", retryRevision);
    expect(retry.ok).toBe(true);
    expect(retry.revision).toBe(2);
    const task = readTask();
    const statuses = Object.fromEntries(
      task.annotations.map((annotation) => [
        annotation.annotationId,
        annotation.status,
      ])
    );
    // BOTH non-conflicting operations survived.
    expect(statuses["ann-a"]).toBe("completed");
    expect(statuses["ann-b"]).toBe("completed");
    expect(task.taskRevision).toBe(2);
    expect(typeof task.updatedAt).toBe("string");
  });

  it(
    "a burst of FOUR GENUINELY OVERLAPPING writers cannot stamp equal revisions — one winner, retried losers land sequentially",
    async () => {
    writeFileSync(
      path.join(dir, "tasks", "active-task.json"),
      JSON.stringify(baseTask(["ann-1", "ann-2", "ann-3", "ann-4"]))
    );
    // All four children are spawned CONCURRENTLY and each BLOCKS on the
    // GO barrier before attempting the write — they really overlap and
    // race for the cross-process lock at the same time (unlike the old
    // sequential execFileSync loop, which could never overlap and would
    // pass identically without the lock).
    const ids = ["ann-1", "ann-2", "ann-3", "ann-4"];
    const children = ids.map((id) => spawnChild("attempt-gated", id, 0));
    // Prove all four are RUNNING and waiting before releasing them.
    for (const id of ids) {
      waitForMarker(`ready-${id}`);
    }
    writeFileSync(path.join(dir, "test-markers", "go"), "1");
    for (const spawned of children) {
      await awaitChildExit(spawned.proc);
    }
    const outcomes = children.map((spawned) => JSON.parse(spawned.stdout()));
    const winners = outcomes.filter((outcome) => outcome.ok);
    const conflicts = outcomes.filter(
      (outcome) => !outcome.ok && outcome.error === "revision_conflict"
    );
    // WITHOUT the lock all four would succeed (each would read rev 0 and
    // stamp rev 1) — exactly one winner + three conflicts is only
    // possible because the burst is serialized.
    expect(winners).toHaveLength(1);
    expect(conflicts).toHaveLength(3);
    const afterBurst = readTask();
    expect(afterBurst.taskRevision).toBe(1);
    expect(typeof afterBurst.updatedAt).toBe("string");
    expect(
      afterBurst.annotations.filter((annotation) => annotation.status === "completed")
    ).toHaveLength(1);
    // Safe retry: the three LOSERS re-attempt their OWN annotation with
    // the fresh revision — all land sequentially with STRICTLY ADVANCING
    // taskRevision AND updatedAt across the process-level retries. The
    // retry targets derive from the conflict outcomes (whoever won the
    // burst, the other three are always the ones to retry).
    const retryIds = ids.filter((_, index) => !outcomes[index].ok);
    expect(retryIds).toHaveLength(3);
    const retried = retryIds.map((id) =>
      child("attempt", id, readTask().taskRevision)
    );
    expect(retried.every((outcome) => outcome.ok)).toBe(true);
    const revisions = retried.map((outcome) => outcome.revision);
    expect(revisions).toEqual([2, 3, 4]);
    const updatedAtChain = [
      winners[0].updatedAt as string,
      ...retried.map((outcome) => outcome.updatedAt as string),
    ];
    expect(updatedAtChain.every((value) => typeof value === "string")).toBe(true);
    for (let index = 1; index < updatedAtChain.length; index += 1) {
      expect(updatedAtChain[index] > updatedAtChain[index - 1]).toBe(true);
    }
    const finalTask = readTask();
    expect(finalTask.taskRevision).toBe(4);
    expect(
      finalTask.annotations.every((annotation) => annotation.status === "completed")
    ).toBe(true);
    },
    30000
  );
});
