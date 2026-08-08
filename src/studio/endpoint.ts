/**
 * Portal Studio — dev endpoint helpers (server side, node only).
 *
 * Pure, testable pieces used by the serve-only Vite plugin (`vite.ts`):
 * constant-time session token verification, task validation/sanitization
 * (v1 and v2 payloads, normalized to schema v2), path-traversal-safe file
 * naming, atomic task/screenshot writes, and the clear lifecycle.
 *
 * Security invariants (contract §7): loopback dev server only, random
 * per-session token (≥ 32 bytes CSPRNG), constant-time comparison, body and
 * path bounds, path-traversal guard, temp file + rename atomic writes, and
 * secrets never written into artifacts. The server runs its own sanitization
 * pass (defense in depth) and produces the authoritative redaction manifest.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  TASK_FILENAME,
  TASK_SCHEMA_VERSION,
  TASK_SCHEMA_VERSION_V1,
  TASK_SCHEMA_VERSION_V2,
  TASK_SCHEMA_VERSION_V4,
  type Annotation,
  type BusinessContextItem,
  type DiagnosticEntry,
  type DiagnosticSource,
  type ElementCapture,
  type HeartbeatReport,
  type HeartbeatState,
  type PortalStudioTask,
  type PortalStudioTaskV1,
  type RedactionManifest,
  type Region,
  type RevisionInfo,
  type RevisionState,
  type ScreenshotRef,
  type SelectorCandidateKind,
} from "./types";
import { MAX_ANNOTATIONS } from "./task-model";

export const SESSION_TOKEN_BYTES = 32;
export const MAX_TASK_BODY_BYTES = 256 * 1024;
export const MAX_ARTIFACT_BYTES = 256 * 1024;
export const MAX_SCREENSHOT_BODY_BYTES = 2_800_000;
export const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;
export const TASKS_DIRECTORY = "tasks";
export const SCREENSHOTS_DIRECTORY = "screenshots";
export const SESSION_FILENAME = "session.json";

// Diagnostics caps (schema v3): ring buffer bounds, per-entry limits, dedup
// window, and total serialized budget (Decision Log D-014).
export const MAX_DIAGNOSTIC_ENTRIES = 100;
export const MAX_DIAGNOSTICS_BYTES = 64 * 1024;
export const MAX_DIAGNOSTIC_MESSAGE = 2000;
export const MAX_DIAGNOSTIC_STACK = 4000;
export const MAX_DIAGNOSTIC_URL = 2000;
export const MAX_OCCURRENCE_COUNT = 1_000_000;

// Heartbeat thresholds (Decision Log D-015): the server derives the state
// from the last client report time and never trusts the browser's self
// report alone.
export const ONLINE_WINDOW_MS = 10_000;
export const STALE_WINDOW_MS = 30_000;

export const DIAGNOSTIC_SOURCES = new Set<string>([
  "console",
  "window",
  "promise",
  "fetch",
  "xhr",
]);

const isDiagnosticSource = (value: string): value is DiagnosticSource =>
  DIAGNOSTIC_SOURCES.has(value);

const TASK_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const SCREENSHOT_FILE_PATTERN = /^screenshots\/[a-zA-Z0-9][a-zA-Z0-9._-]*\.png$/;

const MAX_URL_LENGTH = 2000;
const MAX_TITLE_LENGTH = 500;
const MAX_INSTRUCTION_LENGTH = 2000;
const MAX_CANDIDATES = 50;
const MAX_SELECTORS = 10;
const MAX_ATTRIBUTES = 20;
const MAX_TEXT_LENGTH = 500;
const MAX_CHILD_COUNT = 1_000_000;
const MAX_ELEMENTS = 50;
const MAX_BUSINESS_CONTEXT_ITEMS = 20;
const MAX_STYLE_PROPERTIES = 30;
const MAX_STYLE_VALUE_LENGTH = 200;
const MAX_OUTLINE_LENGTH = 200;
const MAX_REGION_COORDINATE = 1_000_000;

const SELECTOR_KINDS = new Set<string>(["id", "attribute", "path"]);
const COMPONENT_KINDS = new Set<string>(["fiber", "dom"]);

const isSelectorKind = (value: string): value is SelectorCandidateKind =>
  SELECTOR_KINDS.has(value);

const isComponentKind = (
  value: string | undefined
): value is "fiber" | "dom" =>
  typeof value === "string" && COMPONENT_KINDS.has(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const readString = (value: unknown, maxLength: number): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
};

const readBoundedNumber = (
  value: unknown,
  max: number
): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(Math.max(0, Math.round(value)), max);
};

/**
 * Defense in depth: remove the dev-session token value from any serialized
 * artifact text, even if a user pasted it into an instruction or snapshot.
 * The token is base64url (no regex metacharacters), so plain replacement is
 * safe.
 */
export function redactSessionToken(text: string, sessionToken: string): string {
  if (!sessionToken) return text;
  return text.split(sessionToken).join("[REDACTED]");
}

const SECRET_KEY_PATTERN =
  /(?:^|[-_.])(?:token|secret|password|authorization|cookie|api[-_.]?key)(?:$|[-_.]|$)/i;

const SERVER_REDACTION_PATTERNS: Array<[RegExp, string]> = [
  [/\bBearer\s+[^\s"']+/gi, "Bearer [REDACTED]"],
  [/^(\s*(?:authorization|cookie|set-cookie)\s*:).*$/gim, "$1 [REDACTED]"],
  [
    /([?&](?:access[_-]?token|refresh[_-]?token|token|api[_-]?key|password|secret)=)[^&#\s]+/gi,
    "$1[REDACTED]",
  ],
  [
    /((?:access[_-]?token|refresh[_-]?token|api[_-]?key|password|secret)\s*[:=]\s*)[^,;\n]+/gi,
    "$1[REDACTED]",
  ],
  [/(https?:\/\/[^\s?#]+)\?[^#\s]*/gi, "$1?[REDACTED]"],
  // Bare assignments in plain text (extension beyond the client baseline).
  [
    /(^|[\s&;?,])(token|secret|password|api[_-]?key)\s*[:=]\s*[^\s&;,"']+/gi,
    "$1$2=[REDACTED]",
  ],
];

const MAX_SERVER_STRING = 2000;
const MAX_SERVER_ATTRIBUTE = 200;
const MAX_SERVER_DEPTH = 6;

export type ServerRecorder = {
  droppedKeys: Set<string>;
  redactedValues: number;
  truncatedValues: number;
};

export const createServerRecorder = (): ServerRecorder => ({
  droppedKeys: new Set<string>(),
  redactedValues: 0,
  truncatedValues: 0,
});

const toServerManifest = (recorder: ServerRecorder): RedactionManifest => ({
  droppedKeys: [...recorder.droppedKeys].sort(),
  redactedValues: recorder.redactedValues,
  truncatedValues: recorder.truncatedValues,
});

function serverRedactText(
  value: string,
  limit: number,
  recorder?: ServerRecorder
): string {
  let redacted = value;
  for (const [pattern, replacement] of SERVER_REDACTION_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }
  const truncated =
    redacted.length > limit
      ? `${redacted.slice(0, limit)}…[truncated]`
      : redacted;
  if (recorder) {
    if (truncated !== value) recorder.redactedValues += 1;
    if (truncated.length !== redacted.length) recorder.truncatedValues += 1;
  }
  return truncated;
}

function sanitizeServerValue(
  value: unknown,
  depth: number,
  recorder: ServerRecorder
): unknown {
  if (typeof value === "string") {
    return serverRedactText(value, MAX_SERVER_STRING, recorder);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value === null || value === undefined) {
    return null;
  }
  if (Array.isArray(value)) {
    if (depth >= MAX_SERVER_DEPTH) {
      recorder.truncatedValues += 1;
      return "[truncated]";
    }
    return value.map((item) => sanitizeServerValue(item, depth + 1, recorder));
  }
  if (isRecord(value)) {
    if (depth >= MAX_SERVER_DEPTH) {
      recorder.truncatedValues += 1;
      return "[truncated]";
    }
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (SECRET_KEY_PATTERN.test(key)) {
        recorder.droppedKeys.add(key);
        continue;
      }
      result[key] = sanitizeServerValue(entry, depth + 1, recorder);
    }
    return result;
  }
  return null;
}

function sanitizeServerAttributes(
  attributes: Record<string, string>,
  recorder: ServerRecorder
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      recorder.droppedKeys.add(key);
      continue;
    }
    result[key] = serverRedactText(value, MAX_SERVER_ATTRIBUTE, recorder);
  }
  return result;
}

/** Hash-then-compare so lengths do not leak through timing. */
export function verifySessionToken(
  provided: string | undefined,
  expected: string | undefined
): boolean {
  if (!provided || !expected) return false;
  const left = createHash("sha256").update(provided).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

/** Generate a new random session token (≥ 32 bytes CSPRNG). */
export function generateSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
}

/** Path-traversal guard for task file names. */
export function isSafeTaskFileName(name: string): boolean {
  return TASK_ID_PATTERN.test(name) && !name.includes("..");
}

/** Resolve a task file path under the tasks directory, traversal-safe. */
export function resolveTaskFilePath(
  studioRoot: string,
  fileName: string
): string | undefined {
  if (!isSafeTaskFileName(fileName)) return undefined;
  const resolved = path.resolve(studioRoot, TASKS_DIRECTORY, fileName);
  if (!resolved.startsWith(path.resolve(studioRoot, TASKS_DIRECTORY))) {
    return undefined;
  }
  return resolved;
}

const sanitizeComponentCandidates = (input: unknown) => {
  if (!Array.isArray(input)) return [];
  return input.slice(0, MAX_CANDIDATES).flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const name = readString(entry.name, 200) ?? null;
    const key = readString(entry.key, 200) ?? null;
    const kind = readString(entry.kind, 16);
    return [
      {
        name,
        key,
        ...(isComponentKind(kind) ? { kind } : {}),
      },
    ];
  });
};

const sanitizeElementCapture = (
  input: unknown,
  recorder: ServerRecorder
): ElementCapture | null => {
  if (!isRecord(input)) return null;
  const tagName = readString(input.tagName, 64);
  if (!tagName) return null;

  const selectorCandidates = Array.isArray(input.selectorCandidates)
    ? input.selectorCandidates
        .slice(0, MAX_SELECTORS)
        .flatMap((candidate) => {
          if (!isRecord(candidate)) return [];
          const selector = readString(candidate.selector, 200);
          const kind = readString(candidate.kind, 32);
          if (!selector || !kind || !isSelectorKind(kind)) return [];
          return [{ kind, selector }];
        })
    : [];

  const componentCandidates = sanitizeComponentCandidates(
    input.componentCandidates
  );

  const snapshot = isRecord(input.snapshot) ? input.snapshot : null;
  const snapshotText = snapshot
    ? (readString(snapshot.text, MAX_TEXT_LENGTH) ?? "")
    : "";
  const rawAttributes =
    snapshot && isRecord(snapshot.attributes) ? snapshot.attributes : {};
  const attributes = Object.fromEntries(
    Object.entries(rawAttributes)
      .slice(0, MAX_ATTRIBUTES)
      .map(([key, value]) => [key, typeof value === "string" ? value : ""])
  );
  const childCount =
    typeof snapshot?.childCount === "number" &&
    Number.isFinite(snapshot.childCount) &&
    snapshot.childCount >= 0
      ? Math.min(snapshot.childCount, MAX_CHILD_COUNT)
      : 0;

  const rawStyle =
    snapshot && isRecord(snapshot.computedStyle) ? snapshot.computedStyle : {};
  const computedStyle: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawStyle)) {
    if (Object.keys(computedStyle).length >= MAX_STYLE_PROPERTIES) break;
    if (typeof value !== "string") continue;
    computedStyle[key] = serverRedactText(
      value.slice(0, MAX_STYLE_VALUE_LENGTH),
      MAX_STYLE_VALUE_LENGTH,
      recorder
    );
  }

  const domOutline = snapshot
    ? serverRedactText(
        readString(snapshot.domOutline, MAX_OUTLINE_LENGTH) ?? "",
        MAX_OUTLINE_LENGTH,
        recorder
      )
    : "";

  return {
    tagName,
    selectorCandidates,
    componentCandidates,
    // Source candidates are server-resolved (module graph) and merged by the
    // plugin before the write; client-supplied ones are dropped.
    sourceCandidates: [],
    snapshot: {
      text: String(sanitizeServerValue(snapshotText, 0, recorder)),
      attributes: sanitizeServerAttributes(attributes, recorder),
      childCount,
      ...(domOutline ? { domOutline } : {}),
      ...(Object.keys(computedStyle).length ? { computedStyle } : {}),
    },
  };
};

const sanitizeBusinessContext = (input: unknown): BusinessContextItem[] => {
  if (!Array.isArray(input)) return [];
  return input
    .slice(0, MAX_BUSINESS_CONTEXT_ITEMS)
    .flatMap((entry) => {
      if (!isRecord(entry)) return [];
      const type = readString(entry.type, 32);
      const source = readString(entry.source, 64);
      if (!type || !source) return [];
      const id = readString(entry.id, 200);
      return [{ type, source, ...(id ? { id } : {}) }];
    });
};

const sanitizeRegion = (input: unknown): Region | undefined => {
  if (!isRecord(input)) return undefined;
  const x = readBoundedNumber(input.x, MAX_REGION_COORDINATE);
  const y = readBoundedNumber(input.y, MAX_REGION_COORDINATE);
  const width = readBoundedNumber(input.width, MAX_REGION_COORDINATE);
  const height = readBoundedNumber(input.height, MAX_REGION_COORDINATE);
  if (x === undefined || y === undefined || width === undefined || height === undefined) {
    return undefined;
  }
  return { x, y, width, height };
};

const sanitizeScreenshotRef = (
  input: unknown,
  studioRoot: string
): ScreenshotRef | undefined => {
  if (!isRecord(input)) return undefined;
  const file = readString(input.file, 200);
  if (!file || !SCREENSHOT_FILE_PATTERN.test(file)) return undefined;
  const resolved = path.resolve(studioRoot, file);
  if (!resolved.startsWith(path.resolve(studioRoot, SCREENSHOTS_DIRECTORY))) {
    return undefined;
  }
  if (!existsSync(resolved)) return undefined;
  const width = readBoundedNumber(input.width, MAX_REGION_COORDINATE) ?? 0;
  const height = readBoundedNumber(input.height, MAX_REGION_COORDINATE) ?? 0;
  return { file, width, height };
};

/**
 * Sanitize a diagnostics array (server-authoritative): shape whitelist (no
 * request/response body fields can exist), per-entry redaction + caps, ≤100
 * entries, and a total serialized budget. Returns null when over budget.
 */
export function sanitizeDiagnostics(
  input: unknown,
  recorder: ServerRecorder
): DiagnosticEntry[] | null {
  if (!Array.isArray(input)) return input === undefined ? [] : null;
  if (input.length > MAX_DIAGNOSTIC_ENTRIES) return null;
  const entries: DiagnosticEntry[] = [];
  for (const raw of input) {
    // Strict: any malformed entry rejects the WHOLE payload (4xx at the
    // caller) instead of being silently dropped or downgraded to [].
    if (!isRecord(raw)) return null;
    const source = readString(raw.source, 16);
    if (!source || !isDiagnosticSource(source)) return null;
    const message = serverRedactText(
      readString(raw.message, MAX_DIAGNOSTIC_MESSAGE) ?? "",
      MAX_DIAGNOSTIC_MESSAGE,
      recorder
    );
    if (!message.trim()) return null;
    const stack = readString(raw.stack, MAX_DIAGNOSTIC_STACK)
      ? serverRedactText(
          readString(raw.stack, MAX_DIAGNOSTIC_STACK) as string,
          MAX_DIAGNOSTIC_STACK,
          recorder
        )
      : undefined;
    const url = readString(raw.url, MAX_DIAGNOSTIC_URL)
      ? serverRedactText(
          readString(raw.url, MAX_DIAGNOSTIC_URL) as string,
          MAX_DIAGNOSTIC_URL,
          recorder
        )
      : undefined;
    const timestamp = readString(raw.timestamp, 64);
    if (!timestamp || Number.isNaN(Date.parse(timestamp))) return null;
    if (
      raw.occurrenceCount !== undefined &&
      (typeof raw.occurrenceCount !== "number" ||
        !Number.isInteger(raw.occurrenceCount) ||
        raw.occurrenceCount < 1)
    ) {
      return null;
    }
    const occurrenceCount =
      raw.occurrenceCount === undefined
        ? 1
        : Math.min(raw.occurrenceCount, MAX_OCCURRENCE_COUNT);
    entries.push({
      source,
      message,
      ...(stack ? { stack } : {}),
      ...(url ? { url } : {}),
      timestamp,
      occurrenceCount,
    });
  }
  if (Buffer.byteLength(JSON.stringify(entries), "utf8") > MAX_DIAGNOSTICS_BYTES) {
    return null;
  }
  return entries;
}

/**
 * Heartbeat receipt (D-016): the server receipt time is the ONLY
 * authoritative clock for liveness. The client-supplied `ts` is ignored
 * entirely — a future/old/invalid client timestamp must never influence
 * online/stale/offline derivation, otherwise a forged future ts could keep a
 * disconnected tab falsely online.
 */
export function parseHeartbeatPayload(
  payload: unknown,
  receivedAtMs: number
): { ok: boolean; receivedAtMs: number } {
  if (!isRecord(payload)) return { ok: false, receivedAtMs };
  return { ok: true, receivedAtMs };
}

/** Server-authoritative heartbeat state derivation (contract §10, D-015). */
export function deriveHeartbeatState(
  lastReportAtMs: number | undefined,
  nowMs: number
): HeartbeatState {
  if (lastReportAtMs === undefined) return "offline";
  const age = nowMs - lastReportAtMs;
  if (age <= ONLINE_WINDOW_MS) return "online";
  if (age <= STALE_WINDOW_MS) return "stale";
  return "offline";
}

export function buildHeartbeatReport(
  lastReportAtMs: number | undefined,
  nowMs: number,
  previous?: HeartbeatReport
): HeartbeatReport {
  const state = deriveHeartbeatState(lastReportAtMs, nowMs);
  const lastOnlineAt =
    state === "online"
      ? new Date(nowMs).toISOString()
      : previous?.lastOnlineAt;
  return {
    state,
    reportedAt:
      lastReportAtMs === undefined
        ? previous?.reportedAt ?? new Date(nowMs).toISOString()
        : new Date(lastReportAtMs).toISOString(),
    checkedAt: new Date(nowMs).toISOString(),
    ...(lastOnlineAt ? { lastOnlineAt } : {}),
  };
}

/**
 * Atomically refresh the active task's evidence: screenshot ref (with
 * capturedAt), diagnostics, and heartbeat. Transaction-safe replace of the
 * superseded screenshot: read the old ref before the write, delete only
 * after the write succeeds, and only when the path differs.
 */
export function updateActiveTaskEvidence(
  studioRoot: string,
  patch: {
    screenshot?: ScreenshotRef;
    diagnostics?: DiagnosticEntry[];
    heartbeat?: HeartbeatReport;
    revision?: RevisionInfo;
  },
  options: { writeTaskFile?: (serialized: string) => void } = {}
): {
  ok: boolean;
  error?: "no_active_task" | "artifact_too_large" | "write_failed";
} {
  const taskPath = resolveActiveTaskPath(studioRoot);
  if (!existsSync(taskPath)) return { ok: false, error: "no_active_task" };
  let task: PortalStudioTask;
  try {
    task = JSON.parse(readFileSync(taskPath, "utf8")) as PortalStudioTask;
  } catch {
    return { ok: false, error: "no_active_task" };
  }

  const supersededScreenshot = readReferencedScreenshot(studioRoot, taskPath);
  if (patch.screenshot) {
    task.screenshot = patch.screenshot;
  }
  if (patch.diagnostics) {
    task.diagnostics = patch.diagnostics;
  }
  if (patch.heartbeat) {
    task.heartbeat = patch.heartbeat;
  }
  if (patch.revision) {
    task.revision = patch.revision;
  }

  // Final artifact cap: the merged task (screenshot + diagnostics +
  // heartbeat) must stay within the 256 KB budget — limiting only the
  // diagnostics subset is not enough.
  const serialized = JSON.stringify(task, null, 2);
  if (Buffer.byteLength(serialized, "utf8") > MAX_ARTIFACT_BYTES) {
    return { ok: false, error: "artifact_too_large" };
  }

  try {
    if (options.writeTaskFile) {
      // Injectable failure seam (tests): simulates the atomic task write
      // failing AFTER the PNG was already persisted.
      options.writeTaskFile(serialized);
    } else {
      atomicWriteTaskFile(studioRoot, "active-task.json", serialized);
    }
  } catch {
    return { ok: false, error: "write_failed" };
  }

  if (
    supersededScreenshot &&
    patch.screenshot &&
    supersededScreenshot !== patch.screenshot.file
  ) {
    removeScreenshotFile(studioRoot, supersededScreenshot);
  }
  return { ok: true };
}

// Revision tracking (contract §10, schema v4, Decision Log D-019).
export const DEFAULT_WAIT_TIMEOUT_MS = 10_000;
export const MAX_WAIT_TIMEOUT_MS = 30_000;
export const MAX_SOURCE_REVISION_FILES = 20;

/**
 * Content hash of the task-referenced source files (sorted, stable). Files
 * that no longer exist hash as their path with a missing marker, so edits
 * and deletions both change the revision.
 */
export function computeSourceRevision(
  files: Array<{ file: string; content: string }>
): string {
  const sorted = [...files].sort((left, right) =>
    left.file.localeCompare(right.file)
  );
  const hash = createHash("sha256");
  for (const entry of sorted) {
    hash.update(entry.file);
    hash.update("\0");
    hash.update(entry.content);
    hash.update("\0");
  }
  return hash.digest("hex");
}

export type RevisionMatchInput = {
  browserRevision: number;
  baselineBrowserRevision: number | undefined;
  hmrAck: boolean;
  heartbeatOnline: boolean;
};

/**
 * Honest match semantics (contract §10): the authoritative success signal is
 * a reload bump (browserRevision above the baseline); the HMR ack is
 * informational and only counts together with a live (online) browser. Never
 * silently trusted otherwise.
 */
export function evaluateRevisionMatch(input: RevisionMatchInput): boolean {
  if (
    input.baselineBrowserRevision !== undefined &&
    input.browserRevision > input.baselineBrowserRevision
  ) {
    return true;
  }
  return input.hmrAck && input.heartbeatOnline;
}

/**
 * Bounded wait with injectable clock/state/sleep (fake-timer testable):
 * polls the match state until the deadline; the outcome is either matched
 * (reload bump authoritative, or HMR ack + online) or stale — never a
 * silent pass.
 */
export async function performBoundedWait(input: {
  timeoutMs: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  readState: () => RevisionMatchInput;
}): Promise<{ matched: boolean; attempts: number }> {
  const startMs = input.now();
  let matched = false;
  let attempts = 0;
  while (input.now() - startMs < input.timeoutMs) {
    attempts += 1;
    matched = evaluateRevisionMatch(input.readState());
    if (matched) break;
    await input.sleep(250);
  }
  return { matched, attempts };
}

export function buildRevisionInfo(
  sourceRevision: string,
  browserRevision: number,
  hmrAck: boolean,
  state: RevisionState,
  nowMs: number,
  expectedAfter?: string
): RevisionInfo {
  return {
    sourceRevision,
    browserRevision,
    hmrAck,
    ...(expectedAfter ? { expectedAfter } : {}),
    state,
    checkedAt: new Date(nowMs).toISOString(),
  };
}

/**
 * Validate and normalize a raw v1–v5 task payload into a safe v5 task
 * (schema evolution, D-033 #14/#17): v1–v4 payloads are accepted and
 * normalized into a single v5 annotation; v5 payloads validate their
 * `annotations[]` in place. The server never trusts client redaction —
 * every field is re-sanitized with the authoritative recorder.
 */
export function sanitizeTask(
  input: unknown,
  options: { studioRoot?: string } = {}
): PortalStudioTask | null {
  if (!isRecord(input)) return null;
  const isV1 = input.schemaVersion === TASK_SCHEMA_VERSION_V1;
  const isV2 = input.schemaVersion === TASK_SCHEMA_VERSION_V2;
  const isV3 = input.schemaVersion === 3;
  const isV4 = input.schemaVersion === TASK_SCHEMA_VERSION_V4;
  const isV5 = input.schemaVersion === TASK_SCHEMA_VERSION;
  if (!isV1 && !isV2 && !isV3 && !isV4 && !isV5) return null;

  const recorder = createServerRecorder();
  const taskId = readString(input.taskId, 64);
  if (!taskId || !isSafeTaskFileName(taskId)) return null;
  const url = serverRedactText(
    readString(input.url, MAX_URL_LENGTH) ?? "",
    MAX_URL_LENGTH,
    recorder
  );
  if (!url) return null;
  const createdAt = readString(input.createdAt, 64);
  if (!createdAt || Number.isNaN(Date.parse(createdAt))) return null;
  const title = serverRedactText(
    readString(input.title, MAX_TITLE_LENGTH) ?? "",
    MAX_TITLE_LENGTH,
    recorder
  );
  const businessContext = sanitizeBusinessContext(input.businessContext);
  const screenshot = isV1
    ? undefined
    : options.studioRoot
      ? sanitizeScreenshotRef(input.screenshot, options.studioRoot)
      : undefined;
  let diagnostics: DiagnosticEntry[] = [];
  if (!isV1 && !isV2) {
    // Diagnostics present but invalid/over-budget must reject the task, not
    // silently degrade to an empty array.
    const sanitized = sanitizeDiagnostics(input.diagnostics, recorder);
    if (sanitized === null) return null;
    diagnostics = sanitized;
  }

  let annotations: Annotation[];
  if (isV5) {
    if (!Array.isArray(input.annotations) || input.annotations.length < 1) {
      return null;
    }
    if (input.annotations.length > MAX_ANNOTATIONS) return null;
    annotations = [];
    for (const rawAnnotation of input.annotations.slice(0, MAX_ANNOTATIONS)) {
      const annotation = sanitizeAnnotation(rawAnnotation, recorder);
      if (!annotation) return null;
      annotations.push(annotation);
    }
    // Per-annotation element cap (MAX_ELEMENTS) bounds each capture; the
    // total is bounded by the 256 KB artifact cap below (per-annotation
    // caps cannot be summed across accumulated annotations).
  } else {
    // v1–v4 → a single v5 annotation (normalize-on-read, D-033 #17).
    const instruction = serverRedactText(
      readString(input.instruction, MAX_INSTRUCTION_LENGTH) ?? "",
      MAX_INSTRUCTION_LENGTH,
      recorder
    );
    let elementsInput: unknown;
    if (isV1) {
      const v1 = input as unknown as PortalStudioTaskV1;
      elementsInput = [v1.element];
    } else {
      elementsInput = input.elements;
    }
    if (!Array.isArray(elementsInput) || elementsInput.length < 1) {
      return null;
    }
    const elements: ElementCapture[] = [];
    for (const rawElement of elementsInput.slice(0, MAX_ELEMENTS)) {
      const element = sanitizeElementCapture(rawElement, recorder);
      if (!element) return null;
      elements.push(element);
    }
    const region = isV1 ? undefined : sanitizeRegion(input.region);
    annotations = [
      {
        annotationId: `${taskId}-v4`,
        kind: elements.length > 0 ? "element" : "region",
        comment: instruction,
        createdAt,
        status: "open",
        elements,
        ...(region ? { region } : {}),
      },
    ];
  }

  const task: PortalStudioTask = {
    schemaVersion: TASK_SCHEMA_VERSION,
    taskId,
    createdAt,
    url,
    title,
    annotations,
    businessContext,
    redaction: toServerManifest(recorder),
    ...(screenshot ? { screenshot } : {}),
    ...(diagnostics.length ? { diagnostics } : {}),
  };

  const serialized = JSON.stringify(task);
  if (Buffer.byteLength(serialized, "utf8") > MAX_ARTIFACT_BYTES) {
    return null;
  }
  return task;
}

/** Validate a single v5 annotation (server-authoritative). */
function sanitizeAnnotation(
  input: unknown,
  recorder: ServerRecorder
): Annotation | null {
  if (!isRecord(input)) return null;
  const annotationId = readString(input.annotationId, 64);
  if (!annotationId || !isSafeTaskFileName(annotationId)) return null;
  const kind = readString(input.kind, 16);
  if (kind !== "element" && kind !== "multi" && kind !== "region") {
    return null;
  }
  const comment = serverRedactText(
    readString(input.comment, MAX_INSTRUCTION_LENGTH) ?? "",
    MAX_INSTRUCTION_LENGTH,
    recorder
  );
  const createdAt = readString(input.createdAt, 64);
  if (!createdAt || Number.isNaN(Date.parse(createdAt))) return null;
  const status = readString(input.status, 16) ?? "open";
  if (status !== "open" && status !== "completed") return null;
  const completedAt = readString(input.completedAt, 64);
  if (completedAt !== undefined && Number.isNaN(Date.parse(completedAt))) {
    return null;
  }
  const hidden =
    typeof input.hidden === "boolean" ? (input.hidden as boolean) : undefined;
  if (!Array.isArray(input.elements)) return null;
  const elements: ElementCapture[] = [];
  for (const rawElement of input.elements.slice(0, MAX_ELEMENTS)) {
    const element = sanitizeElementCapture(rawElement, recorder);
    if (!element) return null;
    elements.push(element);
  }
  const region = sanitizeRegion(input.region);
  return {
    annotationId,
    kind,
    comment,
    createdAt,
    status,
    ...(completedAt ? { completedAt } : {}),
    ...(hidden !== undefined ? { hidden } : {}),
    elements,
    ...(region ? { region } : {}),
  };
}

/**
 * Atomically write the session file (tmp + rename, mode 0600): every token
 * rotation lands a complete, readable session file — never a torn one that
 * could be read by shell agents as the live token while matching no server.
 */
export function atomicWriteSessionFile(target: string, content: string): string {
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.tmp-${randomBytes(6).toString("hex")}`
  );
  writeFileSync(temporary, content, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, target);
  return target;
}

/** Atomically write a task file: temp file + rename, mode 0600. */
export function atomicWriteTaskFile(
  studioRoot: string,
  fileName: string,
  content: string
): string {
  const target = resolveTaskFilePath(studioRoot, fileName);
  if (!target) {
    throw new Error(`Unsafe task file name: ${fileName}`);
  }
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = path.join(
    path.dirname(target),
    `.${fileName}.tmp-${randomBytes(6).toString("hex")}`
  );
  writeFileSync(temporary, content, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, target);
  return target;
}

/** Default active-task path relative to a studio root. */
export function resolveActiveTaskPath(studioRoot: string): string {
  return path.join(studioRoot, TASKS_DIRECTORY, TASK_FILENAME);
}

/** Read the active task as parsed JSON, or null when missing/unreadable. */
export function readActiveTask(
  studioRoot: string
): PortalStudioTask | null {
  const taskPath = resolveActiveTaskPath(studioRoot);
  try {
    if (!existsSync(taskPath)) return null;
    return JSON.parse(readFileSync(taskPath, "utf8")) as PortalStudioTask;
  } catch {
    return null;
  }
}

/** Validate a base64 PNG payload and extract IHDR dimensions. */
export function parseScreenshotPayload(
  base64: string
): { buffer: Buffer; width: number; height: number } | null {
  if (typeof base64 !== "string" || !base64) return null;
  const buffer = Buffer.from(base64, "base64");
  if (buffer.length < 24) return null;
  if (buffer.length > MAX_SCREENSHOT_BYTES) return null;
  const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buffer.subarray(0, 8).equals(PNG_MAGIC)) return null;
  // IHDR: width at offset 16, height at offset 20 (big-endian uint32).
  if (buffer.toString("latin1", 12, 16) !== "IHDR") return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    return null;
  }
  return { buffer, width, height };
}

/** Atomically write a screenshot PNG under screenshots/, traversal-safe. */
export function atomicWriteScreenshot(
  studioRoot: string,
  taskId: string,
  buffer: Buffer
): string {
  if (!isSafeTaskFileName(taskId)) {
    throw new Error(`Unsafe screenshot task id: ${taskId}`);
  }
  const directory = path.resolve(studioRoot, SCREENSHOTS_DIRECTORY);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const target = path.join(directory, `${taskId}.png`);
  const temporary = path.join(
    directory,
    `.${taskId}.png.tmp-${randomBytes(6).toString("hex")}`
  );
  writeFileSync(temporary, buffer, { mode: 0o600 });
  renameSync(temporary, target);
  return path.join(SCREENSHOTS_DIRECTORY, `${taskId}.png`);
}

/**
 * Read the screenshot reference of a task file (pattern + containment
 * checked). Read-only: never deletes.
 */
export function readReferencedScreenshot(
  studioRoot: string,
  taskPath: string
): string | undefined {
  try {
    if (!existsSync(taskPath)) return undefined;
    const raw = readFileSync(taskPath, "utf8");
    const task = JSON.parse(raw) as { screenshot?: { file?: unknown } };
    const file = task.screenshot?.file;
    if (typeof file !== "string" || !SCREENSHOT_FILE_PATTERN.test(file)) {
      return undefined;
    }
    const resolved = path.resolve(studioRoot, file);
    if (!resolved.startsWith(path.resolve(studioRoot, SCREENSHOTS_DIRECTORY))) {
      return undefined;
    }
    return file;
  } catch {
    return undefined;
  }
}

/** Delete a validated screenshot file (pattern + containment + exists). */
export function removeScreenshotFile(
  studioRoot: string,
  file: string
): boolean {
  if (!SCREENSHOT_FILE_PATTERN.test(file)) return false;
  const resolved = path.resolve(studioRoot, file);
  if (
    !resolved.startsWith(path.resolve(studioRoot, SCREENSHOTS_DIRECTORY)) ||
    !existsSync(resolved)
  ) {
    return false;
  }
  rmSync(resolved, { force: true });
  return true;
}

/** Remove the screenshot referenced by a task file (best effort, safe). */
export function removeReferencedScreenshot(
  studioRoot: string,
  taskPath: string
): boolean {
  const file = readReferencedScreenshot(studioRoot, taskPath);
  return file ? removeScreenshotFile(studioRoot, file) : false;
}

/**
 * Commit evidence atomically as a unit: write the fresh PNG, merge
 * screenshot/diagnostics/heartbeat into the active task (with the final
 * 256 KB re-check), and — when the task update fails for ANY reason —
 * remove the just-written PNG so no orphan file is left behind.
 */
export function commitEvidence(
  studioRoot: string,
  input: {
    taskId: string;
    pngBuffer: Buffer;
    width: number;
    height: number;
    diagnostics: DiagnosticEntry[];
    heartbeat: HeartbeatReport;
  },
  options: { writeTaskFile?: (serialized: string) => void } = {}
):
  | {
      ok: true;
      file: string;
      width: number;
      height: number;
      capturedAt: string;
    }
  | {
      ok: false;
      error: "invalid_task_id" | "no_active_task" | "artifact_too_large" | "write_failed";
    } {
  if (!isSafeTaskFileName(input.taskId)) {
    return { ok: false, error: "invalid_task_id" };
  }
  let file: string;
  try {
    file = atomicWriteScreenshot(studioRoot, input.taskId, input.pngBuffer);
  } catch {
    return { ok: false, error: "invalid_task_id" };
  }
  const capturedAt = new Date().toISOString();
  const update = updateActiveTaskEvidence(
    studioRoot,
    {
      screenshot: {
        file,
        width: input.width,
        height: input.height,
        capturedAt,
      },
      diagnostics: input.diagnostics,
      heartbeat: input.heartbeat,
    },
    options
  );
  if (!update.ok) {
    // No orphans: the PNG we just wrote must not outlive a failed update.
    removeScreenshotFile(studioRoot, file);
    return { ok: false, error: update.error ?? "write_failed" };
  }
  return { ok: true, file, width: input.width, height: input.height, capturedAt };
}

export type PendingEvidenceRequest = {
  requestId: string;
  taskId?: string;
};

/**
 * A pending evidence command is cleared ONLY when the incoming POST matches
 * the pending requestId AND taskId exactly; any mismatch keeps the pending
 * slot so the browser retries (or the agent re-issues).
 */
export function matchesPendingEvidence(
  pending: PendingEvidenceRequest | null,
  requestId: unknown,
  taskId: unknown
): boolean {
  if (pending === null) return false;
  if (typeof requestId !== "string" || requestId !== pending.requestId) {
    return false;
  }
  if (pending.taskId === undefined) return true;
  return typeof taskId === "string" && taskId === pending.taskId;
}

/** Clear the active task and its referenced screenshot (best effort). */
export function clearActiveTask(studioRoot: string): {
  clearedTask: boolean;
  clearedScreenshot: boolean;
} {
  const taskPath = resolveActiveTaskPath(studioRoot);
  const clearedTask = existsSync(taskPath);
  const clearedScreenshot = clearedTask
    ? removeReferencedScreenshot(studioRoot, taskPath)
    : false;
  if (clearedTask) rmSync(taskPath, { force: true });
  return { clearedTask, clearedScreenshot };
}

export { TASK_FILENAME };
