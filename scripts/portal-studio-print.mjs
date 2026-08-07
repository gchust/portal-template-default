#!/usr/bin/env node
/**
 * Portal Studio — print command (zero runtime dependencies).
 *
 * Reads the local task artifact and prints it for any shell agent
 * (Pi/OpenCode/Codex/plain shell). No NocoBase, no Studio UI, no token
 * required — the task file is local and the token is never read here.
 *
 * Usage:
 *   node scripts/portal-studio-print.mjs [--json|--markdown] [--task <id>]
 *
 * Options:
 *   --json       pretty-printed task JSON (default)
 *   --markdown   compact human-readable summary
 *   --task <id>  print the task with this id (from active-task.json)
 *
 * Environment:
 *   PORTAL_STUDIO_DIR  studio runtime directory (default: ./.portal-studio)
 *
 * Exit codes: 0 success, 1 task missing/unreadable, 2 invalid arguments.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const TASK_FILENAME = "active-task.json";
const TASK_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

function parseArguments(argv) {
  const options = { format: "json", taskId: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json" || argument === "--markdown") {
      options.format = argument.slice(2);
    } else if (argument === "--task") {
      const value = argv[index + 1];
      if (!value || !TASK_ID_PATTERN.test(value) || value.includes("..")) {
        throw new Error(`Invalid --task id: ${value}`);
      }
      options.taskId = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

function resolveStudioRoot() {
  const configured = process.env.PORTAL_STUDIO_DIR;
  return configured ? path.resolve(configured) : path.resolve(".portal-studio");
}

function readTask(studioRoot, taskId) {
  const taskPath = path.join(studioRoot, "tasks", TASK_FILENAME);
  const raw = readFileSync(taskPath, "utf8");
  const task = JSON.parse(raw);
  if (taskId !== undefined && task.taskId !== taskId) {
    throw new TaskNotFoundError(
      `Task "${taskId}" not found (active task is "${task.taskId}").`
    );
  }
  return task;
}

class TaskNotFoundError extends Error {}

function formatMarkdown(task) {
  const lines = [
    `# Task ${task.taskId}`,
    "",
    `- schemaVersion: ${task.schemaVersion}`,
    `- url: ${task.url}`,
    `- title: ${task.title}`,
    `- capturedAt: ${task.createdAt}`,
    "",
    "## Instruction",
    task.instruction || "(empty)",
    "",
    `## Element: <${task.element.tagName}>`,
    "",
    "### Selector candidates",
    ...task.element.selectorCandidates.map(
      (candidate) => `- [${candidate.kind}] ${candidate.selector}`
    ),
    "",
    "### Component candidates",
    ...(task.element.componentCandidates.length
      ? task.element.componentCandidates
          .slice(0, 20)
          .map((candidate) => `- ${candidate.name ?? "(unknown)"}`)
      : ["- (none — DOM fallback)"]),
    "",
    "### Source candidates",
    ...(task.element.sourceCandidates.length
      ? task.element.sourceCandidates.map((source) =>
          `- ${source.file}${typeof source.line === "number" ? `:${source.line}` : ""}`
        )
      : ["- (none)"]),
    "",
    "### Snapshot",
    `- text: ${task.element.snapshot.text.slice(0, 200) || "(empty)"}`,
    `- attributes: ${JSON.stringify(task.element.snapshot.attributes)}`,
    `- childCount: ${task.element.snapshot.childCount}`,
    "",
  ];
  return lines.join("\n");
}

function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
    const studioRoot = resolveStudioRoot();
    const task = readTask(studioRoot, options.taskId);
    if (options.format === "markdown") {
      process.stdout.write(formatMarkdown(task));
    } else {
      process.stdout.write(`${JSON.stringify(task, null, 2)}\n`);
    }
    process.exitCode = 0;
  } catch (error) {
    if (error instanceof TaskNotFoundError || error.code === "ENOENT") {
      process.stderr.write(
        `[portal-studio] no task found at ${resolveStudioRoot()}/tasks/${TASK_FILENAME}` +
          (error.message ? ` (${error.message})` : "") +
          "\n"
      );
      process.exitCode = 1;
    } else if (error instanceof SyntaxError) {
      process.stderr.write(
        `[portal-studio] task file is not valid JSON: ${error.message}\n`
      );
      process.exitCode = 1;
    } else {
      process.stderr.write(`[portal-studio] ${error.message}\n`);
      process.exitCode = 2;
    }
  }
}

main();
