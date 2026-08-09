/**
 * Portal Studio — shared task formatter (zero dependencies, G04, D-033 #15).
 *
 * The SINGLE Markdown/JSON renderer for the agent-facing artifact, used by:
 *  1. the browser Copy action (bundled, browser-safe),
 *  2. `scripts/portal-studio-print.mjs` (Node 22 imports this module with an
 *     explicit `.ts` specifier — type stripping keeps it standalone),
 *  3. the MCP `print_task` tool.
 *
 * Contract: accepts v4 or v5 artifacts via `normalizeTask` (D-033 #17
 * normalize-on-read); output is byte-identical across all three consumers
 * (golden-tested). Erasable-syntax-only (no enums/namespaces) so Node's
 * type stripping works; NO runtime imports beyond the pure task model.
 */

import { normalizeTask } from "./task-model.ts";
import type {
  Annotation,
  ElementCapture,
  PortalStudioTask,
} from "./types";

const formatElementLines = (elements: ElementCapture[]): string[] => {
  const lines: string[] = [];
  for (const [index, element] of elements.entries()) {
    const label =
      elements.length > 1
        ? `Element ${index + 1}: <${element.tagName}>`
        : `Element: <${element.tagName}>`;
    lines.push(`### ${label}`, "");
    lines.push("#### Selector candidates");
    lines.push(
      ...element.selectorCandidates.map(
        (candidate) => `- [${candidate.kind}] ${candidate.selector}`
      )
    );
    lines.push("", "#### Component candidates");
    lines.push(
      ...(element.componentCandidates.length
        ? element.componentCandidates
            .slice(0, 20)
            .map(
              (candidate) =>
                `- ${candidate.name ?? "(unknown)"}${
                  candidate.kind ? ` (${candidate.kind})` : ""
                }`
            )
        : ["- (none — DOM fallback)"])
    );
    lines.push("", "#### Source candidates");
    lines.push(
      ...(element.sourceCandidates.length
        ? element.sourceCandidates.map(
            (source) =>
              `- ${source.file}${
                typeof source.line === "number" ? `:${source.line}` : ""
              }`
          )
        : ["- (none)"])
    );
    lines.push("", "#### Snapshot");
    lines.push(
      `- text: ${element.snapshot.text.slice(0, 200) || "(empty)"}`
    );
    if (element.snapshot.domOutline) {
      lines.push(`- domOutline: ${element.snapshot.domOutline}`);
    }
    if (element.snapshot.computedStyle) {
      lines.push(
        `- computedStyle: ${JSON.stringify(element.snapshot.computedStyle)}`
      );
    }
    lines.push(
      `- attributes: ${JSON.stringify(element.snapshot.attributes)}`
    );
    lines.push(`- childCount: ${element.snapshot.childCount}`);
    lines.push("");
  }
  return lines;
};

const formatAnnotation = (annotation: Annotation): string[] => {
  const lines: string[] = [];
  if (annotation.region) {
    lines.push(
      `- region: ${annotation.region.x},${annotation.region.y} ${annotation.region.width}x${annotation.region.height}`
    );
  }
  if (annotation.status === "completed") {
    lines.push(
      `- status: completed${
        annotation.completedAt ? ` @ ${annotation.completedAt}` : ""
      }`
    );
  }
  if (annotation.hidden === true) {
    lines.push("- status: hidden");
  }
  if (annotation.elements && annotation.elements.length) {
    lines.push(...formatElementLines(annotation.elements));
  }
  return lines;
};

/**
 * Render the canonical (v5-normalized) task as Markdown — the single
 * agent-facing format shared by Copy, the print CLI, and MCP.
 *
 * Goal 04: one shared formatter with an explicit all-mode option.
 * The DEFAULT (no option) renders ALL annotations (existing behavior —
 * golden output and the print CLI unchanged). `includeCompleted: false`
 * renders only OPEN annotations (the browser Copy default); the print
 * CLI passes `{ includeCompleted: true }` explicitly for all-mode (MCP's
 * print_task renders the artifact as JSON via formatTaskJson).
 */
export function formatTaskMarkdown(
  input: unknown,
  options: { includeCompleted?: boolean } = {}
): string {
  const task = normalizeTask(input);
  if (!task) {
    throw new Error("cannot format: unrecognized task artifact");
  }
  const annotations =
    options.includeCompleted === false
      ? task.annotations.filter((annotation) => annotation.status === "open")
      : task.annotations;
  const lines: string[] = [
    `# Task ${task.taskId}`,
    "",
    `- schemaVersion: ${task.schemaVersion}`,
    `- url: ${task.url}`,
    `- title: ${task.title}`,
    `- capturedAt: ${task.createdAt}`,
  ];
  if (task.screenshot) {
    const capturedAt = task.screenshot.capturedAt
      ? ` capturedAt=${task.screenshot.capturedAt}`
      : "";
    lines.push(
      `- screenshot: ${task.screenshot.file} (${task.screenshot.width}x${task.screenshot.height}${capturedAt})`
    );
  }
  if (task.heartbeat) {
    lines.push(
      `- heartbeat: ${task.heartbeat.state} reportedAt=${task.heartbeat.reportedAt} checkedAt=${task.heartbeat.checkedAt}` +
        (task.heartbeat.lastOnlineAt
          ? ` lastOnlineAt=${task.heartbeat.lastOnlineAt}`
          : "")
    );
  }
  if (task.revision) {
    lines.push(
      `- revision: source=${task.revision.sourceRevision.slice(
        0,
        12
      )} browser=${task.revision.browserRevision} state=${
        task.revision.state
      } hmrAck=${task.revision.hmrAck}` +
        (task.revision.expectedAfter
          ? ` expectedAfter=${task.revision.expectedAfter}`
          : "") +
        ` checkedAt=${task.revision.checkedAt}`
    );
  }
  if (Array.isArray(task.diagnostics) && task.diagnostics.length) {
    lines.push("- diagnostics:");
    for (const entry of task.diagnostics.slice(0, 20)) {
      const urlPart = entry.url ? ` url=${entry.url}` : "";
      lines.push(
        `  - [${entry.source}] x${entry.occurrenceCount} @ ${entry.timestamp}: ${entry.message.slice(0, 160)}${urlPart}`
      );
    }
    if (task.diagnostics.length > 20) {
      lines.push(`  - … ${task.diagnostics.length - 20} more`);
    }
  }
  if (task.businessContext && task.businessContext.length) {
    lines.push("- businessContext:");
    lines.push(
      ...task.businessContext
        .slice(0, 20)
        .map(
          (item) =>
            `  - [${item.type}] ${item.id ?? ""} (source: ${item.source})`
        )
    );
  }
  if (task.redaction) {
    lines.push(
      `- redaction: droppedKeys=${JSON.stringify(
        task.redaction.droppedKeys
      )} redactedValues=${task.redaction.redactedValues} truncatedValues=${
        task.redaction.truncatedValues
      }`
    );
  }
  lines.push("", `## Annotations (${annotations.length})`, "");
  annotations.forEach((annotation, index) => {
    lines.push(
      `### Annotation ${index + 1}: [${annotation.kind}] ${annotation.annotationId}`,
      ""
    );
    lines.push(`Comment: ${annotation.comment || "(empty)"}`, "");
    lines.push(...formatAnnotation(annotation));
    // Goal 05: copied Markdown carries the stable annotationId and the
    // EXACT verified-completion command template for a local Code Agent.
    lines.push(
      `Complete (verified): pnpm studio:complete -- ${annotation.annotationId} --verified --summary "what changed and how it was verified"`,
      ""
    );
  });
  return lines.join("\n");
}

/**
 * Render the canonical (v5-normalized) task as pretty-printed JSON — used
 * by the print CLI `--json` and MCP `print_task` so all consumers see the
 * exact same artifact (v4 files are served normalized, D-033 #17).
 */
export function formatTaskJson(input: unknown): string {
  const task = normalizeTask(input);
  if (!task) {
    throw new Error("cannot format: unrecognized task artifact");
  }
  return JSON.stringify(task, null, 2);
}

/** Whether every annotation is completed (for verify semantics, G04). */
export function isTaskCompleted(task: PortalStudioTask): boolean {
  // Defensive: only canonical v5 artifacts have annotations[] (F-4); a
  // manually-dropped legacy file must never 500 the verify endpoint.
  if (!Array.isArray(task.annotations)) return false;
  return (
    task.annotations.length > 0 &&
    task.annotations.every((annotation) => annotation.status === "completed")
  );
}
