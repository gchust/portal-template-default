#!/usr/bin/env node
/**
 * Portal Studio — agent CLI (zero runtime dependencies).
 *
 * Lets any local Code Agent list annotations and explicitly mark a
 * verified fix complete (or reopen it) through ordinary pnpm commands:
 *
 *   pnpm studio:list
 *   pnpm studio:complete -- <annotation-id> --verified --summary "what changed and how it was verified"
 *   pnpm studio:reopen -- <annotation-id>
 *
 * The CLI reads/writes the LOCAL task artifact through the same atomic
 * write path as the dev server, stamping the server-owned monotonic
 * taskRevision on every successful mutation (Goal 05). Completion is
 * NEVER inferred from HMR, source revision, timestamps or tests — it is
 * an explicit, verified command.
 *
 * Environment:
 *   PORTAL_STUDIO_DIR  studio runtime directory (default: ./.portal-studio)
 *
 * Exit codes: 0 success, 1 invalid task/annotation id, 2 invalid options.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { ANNOTATION_ID_PATTERN, MAX_COMPLETION_SUMMARY_LENGTH, normalizeTask } from "../src/studio/task-model.ts";
import {
  readTaskRevision,
  writeActiveTaskSerialized,
} from "../src/studio/endpoint.ts";
import { applyMutationOperations } from "../src/studio/mutation.ts";

const TASK_FILENAME = "active-task.json";

function studioRoot() {
  return process.env.PORTAL_STUDIO_DIR
    ? path.resolve(process.env.PORTAL_STUDIO_DIR)
    : path.resolve(".portal-studio");
}

function readTask() {
  const taskPath = path.join(studioRoot(), "tasks", TASK_FILENAME);
  try {
    const parsed = JSON.parse(readFileSync(taskPath, "utf8"));
    // Normalize legacy v1-v4 artifacts on read (like the browser and the
    // print CLI) so the IDs the CLI addresses match what users see; the
    // write then persists the lossless v5 form (D-033 #17).
    return normalizeTask(parsed);
  } catch {
    return null;
  }
}

function fail(message, code) {
  process.stderr.write(`[portal-studio] ${message}\n`);
  process.exitCode = code;
}

function printList() {
  const task = readTask();
  if (!task) {
    fail(`no task found at ${path.join(studioRoot(), "tasks", TASK_FILENAME)}`, 1);
    return;
  }
  const annotations = Array.isArray(task.annotations) ? task.annotations : [];
  if (annotations.length === 0) {
    process.stdout.write("No annotations.\n");
    return;
  }
  annotations.forEach((annotation, index) => {
    const state = annotation.status === "completed" ? "completed" : "open";
    process.stdout.write(
      `${index + 1}. [${state}] ${annotation.annotationId}: ${annotation.comment || "(empty)"}\n`
    );
    if (annotation.completedEvidence) {
      process.stdout.write(
        `   verified: ${annotation.completedEvidence.verified} summary: ${annotation.completedEvidence.summary}\n`
      );
    }
  });
}

function findAnnotation(task, annotationId) {
  if (!Array.isArray(task?.annotations)) return null;
  return task.annotations.find((a) => a.annotationId === annotationId) ?? null;
}

function parseCompleteArgs(args) {
  const options = { annotationId: undefined, verified: false, summary: undefined };
  // Skip the standard "--" separator pnpm forwards after the script name.
  const cleanArgs = args[0] === "--" ? args.slice(1) : args;
  for (let index = 0; index < cleanArgs.length; index += 1) {
    const argument = cleanArgs[index];
    if (argument === "--verified") {
      options.verified = true;
    } else if (argument === "--summary") {
      const value = cleanArgs[index + 1];
      if (value === undefined) return { error: "--summary requires a value" };
      options.summary = value;
      index += 1;
    } else if (argument.startsWith("-")) {
      return { error: `unknown option: ${argument}` };
    } else if (options.annotationId === undefined) {
      options.annotationId = argument;
    } else {
      return { error: `unexpected argument: ${argument}` };
    }
  }
  return { options };
}

function printUsage() {
  process.stdout.write(
    [
      "Portal Studio — agent CLI",
      "",
      "Usage:",
      "  node scripts/portal-studio-agent.mjs list",
      "  node scripts/portal-studio-agent.mjs complete -- <annotation-id> --verified --summary \"...\"",
      "  node scripts/portal-studio-agent.mjs reopen -- <annotation-id>",
      "",
      "Commands:",
      "  list       print all annotations (id, status, comment, evidence)",
      "  complete   mark an annotation completed; requires --verified and a",
      "             non-empty --summary (bounded to " + MAX_COMPLETION_SUMMARY_LENGTH + " chars)",
      "  reopen     move a completed annotation back to open",
      "",
      "Exit codes: 0 success, 1 invalid task/id, 2 invalid options.",
      "",
    ].join("\n")
  );
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help") {
    printUsage();
    return;
  }
  const command = argv[0];
  const args = argv.slice(1);

  if (command === "list") {
    printList();
    return;
  }

  if (command !== "complete" && command !== "reopen") {
    fail(`unknown command "${command}" — use list, complete or reopen (see --help)`, 2);
    return;
  }

  if (command === "complete") {
    const parsed = parseCompleteArgs(args);
    if (parsed.error) {
      fail(parsed.error, 2);
      return;
    }
    const { annotationId, verified, summary } = parsed.options;
    if (!annotationId) {
      fail("complete requires an annotation id (pnpm studio:complete -- <id> --verified --summary \"...\")", 2);
      return;
    }
    if (!ANNOTATION_ID_PATTERN.test(annotationId)) {
      fail(`invalid annotation id: ${annotationId}`, 1);
      return;
    }
    if (!verified) {
      fail("complete requires --verified (completion is never inferred from HMR, source revision, timestamps or tests)", 2);
      return;
    }
    if (typeof summary !== "string" || summary.trim().length === 0) {
      fail("complete requires a non-empty --summary describing what changed and how it was verified", 2);
      return;
    }
    if (summary.length > MAX_COMPLETION_SUMMARY_LENGTH) {
      fail(`--summary must be at most ${MAX_COMPLETION_SUMMARY_LENGTH} characters (got ${summary.length})`, 2);
      return;
    }
    const expectedTaskRevision = readTaskRevision(studioRoot());
    // Goal 04 B / shared contract §13: the ONE authoritative write
    // boundary. The cross-process lock makes the locked read, the
    // expected-revision validation, the typed apply, the
    // revision/updatedAt stamp and the atomic persist ONE critical
    // section — a stale writer (revision moved since this command read
    // it) fails explicitly and NEVER writes.
    const result = writeActiveTaskSerialized(studioRoot(), {
      expectedTaskRevision,
      apply: (authoritative) => {
        if (!authoritative) return { ok: false, error: "no_active_task" };
        // Legacy v1-v4 artifacts normalize on read (like the browser).
        const normalized = normalizeTask(authoritative);
        if (!normalized) return { ok: false, error: "invalid_task" };
        const annotation = findAnnotation(normalized, annotationId);
        if (!annotation) {
          return { ok: false, error: "annotation_not_found" };
        }
        if (annotation.status === "completed") {
          // Authoritative no-op: already completed — no write.
          return { ok: true };
        }
        return applyMutationOperations(normalized, [
          {
            op: "complete",
            annotationId,
            evidence: { verified: true, summary, source: "cli" },
          },
        ]);
      },
    });
    if (!result.ok) {
      if (result.error === "revision_conflict") {
        fail(
          `revision conflict: the task changed on disk since this command read it (expected ${expectedTaskRevision}). Re-run the command against the current state.`,
          1
        );
        return;
      }
      if (result.error === "no_active_task") {
        fail(`no task found at ${path.join(studioRoot(), "tasks", TASK_FILENAME)}`, 1);
        return;
      }
      if (result.error === "lock_timeout") {
        fail(
          "write lock timed out — another writer (the dev server or a browser) is busy; re-run the command.",
          1
        );
        return;
      }
      fail(
        result.error === "annotation_not_found"
          ? `annotation "${annotationId}" not found in the active task`
          : `apply failed: ${result.error}`,
        1
      );
      return;
    }
    if (result.noop) {
      process.stdout.write(
        `annotation ${annotationId} is already completed (no change).\n`
      );
      return;
    }
    process.stdout.write(
      `completed ${annotationId} (taskRevision ${result.revision}) — evidence recorded additively.\n`
    );
    return;
  }

  // reopen
  const cleanArgs = args[0] === "--" ? args.slice(1) : args;
  const annotationId = cleanArgs[0];
  if (cleanArgs.length !== 1 || !annotationId) {
    fail("reopen requires exactly one annotation id (pnpm studio:reopen -- <id>)", 2);
    return;
  }
  if (!ANNOTATION_ID_PATTERN.test(annotationId)) {
    fail(`invalid annotation id: ${annotationId}`, 1);
    return;
  }
  const expectedTaskRevision = readTaskRevision(studioRoot());
  // Goal 04 B / §13: the authoritative serialized write boundary (see
  // complete — identical critical-section semantics).
  const result = writeActiveTaskSerialized(studioRoot(), {
    expectedTaskRevision,
    apply: (authoritative) => {
      if (!authoritative) return { ok: false, error: "no_active_task" };
      const normalized = normalizeTask(authoritative);
      if (!normalized) return { ok: false, error: "invalid_task" };
      const annotation = findAnnotation(normalized, annotationId);
      if (!annotation) {
        return { ok: false, error: "annotation_not_found" };
      }
      if (annotation.status !== "completed") {
        // Authoritative no-op: already open — no write.
        return { ok: true };
      }
      return applyMutationOperations(normalized, [
        { op: "reopen", annotationId },
      ]);
    },
  });
  if (!result.ok) {
    if (result.error === "revision_conflict") {
      fail(
        `revision conflict: the task changed on disk since this command read it (expected ${expectedTaskRevision}). Re-run the command against the current state.`,
        1
      );
      return;
    }
    if (result.error === "no_active_task") {
      fail(`no task found at ${path.join(studioRoot(), "tasks", TASK_FILENAME)}`, 1);
      return;
    }
    if (result.error === "lock_timeout") {
      fail(
        "write lock timed out — another writer (the dev server or a browser) is busy; re-run the command.",
        1
      );
      return;
    }
    fail(
      result.error === "annotation_not_found"
        ? `annotation "${annotationId}" not found in the active task`
        : `apply failed: ${result.error}`,
      1
    );
    return;
  }
  if (result.noop) {
    process.stdout.write(
      `annotation ${annotationId} is already open (no change).\n`
    );
    return;
  }
  process.stdout.write(
    `reopened ${annotationId} (taskRevision ${result.revision}).\n`
  );
}

main();
