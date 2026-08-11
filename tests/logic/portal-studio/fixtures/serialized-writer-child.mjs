/**
 * Goal 04 (G04-02 / §13) — child-process fixture for the cross-process
 * write-serialization regressions. Runs via `node --import tsx` so it can
 * import the shared .ts modules.
 *
 * Usage: <studioRoot> <mode> <annotationId> <expectedRevision|undefined>
 *   mode "hold":    acquire the write lock, write a "locked" marker, WAIT
 *                   for a "release" marker, then perform the authoritative
 *                   read→apply→stamp→persist INSIDE the held lock, print
 *                   the outcome as JSON.
 *   mode "attempt": writeActiveTaskSerialized (complete op) with the given
 *                   expected revision, print the outcome as JSON.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  atomicWriteTaskFile,
  readActiveTask,
  readTaskRevision,
  stampTaskRevision,
  withActiveTaskLock,
  writeActiveTaskSerialized,
} from "../../../../src/studio/endpoint.ts";
import { applyMutationOperations } from "../../../../src/studio/mutation.ts";
import { normalizeTask } from "../../../../src/studio/task-model.ts";

const [studioRoot, mode, annotationId, expectedRaw] = process.argv.slice(2);
const expected =
  expectedRaw === "undefined" ? undefined : Number(expectedRaw);
const markerDir = path.join(studioRoot, "test-markers");
mkdirSync(markerDir, { recursive: true });
const marker = (name) => path.join(markerDir, name);

const operations = [
  {
    op: "complete",
    annotationId,
    evidence: {
      verified: true,
      summary: "serialized child",
      source: "cli",
    },
  },
];

if (mode === "hold") {
  const outcome = withActiveTaskLock(studioRoot, () => {
    writeFileSync(marker("locked"), "1");
    const deadline = Date.now() + 10000;
    while (!existsSync(marker("release")) && Date.now() < deadline) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
    // The authoritative critical section, INSIDE the held lock: locked
    // read → expected-revision validation → typed apply → stamp →
    // atomic persist.
    const current = readActiveTask(studioRoot);
    if (!current) return { ok: false, error: "no_active_task" };
    const currentRevision = readTaskRevision(studioRoot);
    if (expected !== undefined && expected !== currentRevision) {
      return {
        ok: false,
        error: "revision_conflict",
        taskRevision: currentRevision,
      };
    }
    const applied = applyMutationOperations(
      normalizeTask(current),
      operations
    );
    if (!applied.ok) return { ok: false, error: applied.error };
    const revision = stampTaskRevision(applied.task, studioRoot);
    atomicWriteTaskFile(
      studioRoot,
      "active-task.json",
      JSON.stringify(applied.task)
    );
    return { ok: true, revision };
  });
  process.stdout.write(JSON.stringify(outcome));
  process.exit(0);
}

const runAttempt = () => {
  const outcome = writeActiveTaskSerialized(studioRoot, {
    expectedTaskRevision: expected,
    apply: (authoritative) => {
      if (!authoritative) return { ok: false, error: "no_active_task" };
      return applyMutationOperations(normalizeTask(authoritative), operations);
    },
  });
  if (outcome.ok) {
    // Read back the persisted updatedAt so tests can assert STRICTLY
    // advancing timestamps across process-level retries.
    let updatedAt;
    try {
      updatedAt = JSON.parse(
        readFileSync(path.join(studioRoot, "tasks", "active-task.json"), "utf8")
      ).updatedAt;
    } catch {
      updatedAt = undefined;
    }
    return { ...outcome, updatedAt };
  }
  return outcome;
};

if (mode === "attempt") {
  process.stdout.write(JSON.stringify(runAttempt()));
  process.exit(0);
}

if (mode === "attempt-gated") {
  // Wait for the GO barrier so a whole BURST of writers really overlaps:
  // every child is already running (and signals readiness) before any of
  // them attempts the write — they race for the lock concurrently.
  writeFileSync(marker(`ready-${annotationId}`), "1");
  const deadline = Date.now() + 10000;
  while (!existsSync(marker("go")) && Date.now() < deadline) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
  process.stdout.write(JSON.stringify(runAttempt()));
  process.exit(0);
}

process.stderr.write(`unknown mode: ${mode}\n`);
process.exit(2);
