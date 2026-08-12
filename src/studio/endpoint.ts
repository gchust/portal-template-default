/**
 * Portal Studio — dev endpoint helpers (server side, node only).
 *
 * Pure, testable pieces used by the serve-only Vite plugin (`vite.ts`):
 * constant-time session token verification, v6 task validation/
 * sanitization, path-traversal-safe file naming, atomic task/screenshot
 * writes, and the clear lifecycle.
 *
 * Security invariants (contract §7): loopback dev server only, random
 * per-session token (≥ 32 bytes CSPRNG), constant-time comparison, body and
 * path bounds, path-traversal guard, temp file + rename atomic writes, and
 * secrets never written into artifacts. The server runs its own sanitization
 * pass (defense in depth) and produces the authoritative redaction manifest.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import path from "node:path";

import {
  TASK_FILENAME,
  TASK_SCHEMA_VERSION,
  type Annotation,
  type BusinessContextItem,
  type DiagnosticEntry,
  type DiagnosticSource,
  type ElementCapture,
  type ElementFingerprint,
  type HeartbeatReport,
  type HeartbeatState,
  type PortalStudioTask,
  type RedactionManifest,
  type Region,
  type RevisionInfo,
  type RevisionState,
  type ScreenshotRef,
  type SourceFrame,
} from "./types.ts";
import {
  MAX_ANNOTATIONS,
  MAX_COMPLETION_SUMMARY_LENGTH,
} from "./task-model.ts";

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
const MAX_ELEMENTS = 50;
const MAX_BUSINESS_CONTEXT_ITEMS = 20;
const MAX_REGION_COORDINATE = 10_000_000;
const MAX_SELECTOR_LENGTH = 4096;
const MAX_STACK_FRAMES = 12;
const MAX_HTML_PREVIEW_LENGTH = 4000;
const MAX_STYLE_TEXT_LENGTH = 6000;
const MAX_ACCESSIBLE_NAME_LENGTH = 500;
const MAX_TEXT_LENGTH = 1000;
const MAX_IDENTITY_ATTRIBUTES = 30;
const MAX_IDENTITY_VALUE_LENGTH = 500;
const MAX_COMPONENT_NAME_LENGTH = 200;
const MAX_ROLE_LENGTH = 200;

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

const sanitizeSourceFrame = (
  input: unknown
): SourceFrame | null => {
  if (!isRecord(input)) return null;
  const filePath = readString(input.filePath, 512);
  // v6 source paths are workspace-relative POSIX only (shared contract §9):
  // absolute, drive-letter, backslash and traversal shapes are rejected.
  if (
    !filePath ||
    filePath.includes("node_modules") ||
    filePath.includes("..") ||
    filePath.startsWith("/") ||
    /^[a-zA-Z]:\//.test(filePath) ||
    filePath.includes("\\")
  ) {
    return null;
  }
  const lineNumber = readBoundedNumber(input.lineNumber, 10_000_000);
  const columnNumber = readBoundedNumber(input.columnNumber, 10_000_000);
  if (
    lineNumber === undefined ||
    lineNumber < 1 ||
    columnNumber === undefined ||
    columnNumber < 0
  ) {
    return null;
  }
  const componentName = readString(input.componentName, MAX_COMPONENT_NAME_LENGTH);
  return {
    filePath,
    lineNumber,
    columnNumber,
    componentName: componentName ?? null,
  };
};

const sanitizeFingerprint = (
  input: unknown,
  recorder: ServerRecorder
): ElementFingerprint | null => {
  if (!isRecord(input)) return null;
  const tagName = readString(input.tagName, 64);
  if (!tagName) return null;
  const role = serverRedactText(
    readString(input.role, MAX_ROLE_LENGTH) ?? "",
    MAX_ROLE_LENGTH,
    recorder
  );
  const accessibleName = serverRedactText(
    readString(input.accessibleName, MAX_ACCESSIBLE_NAME_LENGTH) ?? "",
    MAX_ACCESSIBLE_NAME_LENGTH,
    recorder
  );
  const text = serverRedactText(
    readString(input.text, MAX_TEXT_LENGTH) ?? "",
    MAX_TEXT_LENGTH,
    recorder
  );
  const rawIdentity = isRecord(input.identityAttributes)
    ? input.identityAttributes
    : {};
  const identityAttributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawIdentity)) {
    if (Object.keys(identityAttributes).length >= MAX_IDENTITY_ATTRIBUTES) break;
    if (key !== "id" && key !== "data-ai-page-element" && !key.startsWith("data-nb-")) {
      recorder.droppedKeys.add(key);
      continue;
    }
    if (/(?:^|[-_.])(?:token|secret|password|authorization|cookie|api[-_.]?key)(?:$|[-_.])/i.test(key)) {
      recorder.droppedKeys.add(key);
      continue;
    }
    if (typeof value !== "string") continue;
    identityAttributes[key] = serverRedactText(
      value.slice(0, MAX_IDENTITY_VALUE_LENGTH),
      MAX_IDENTITY_VALUE_LENGTH,
      recorder
    );
  }
  const childCount = readBoundedNumber(input.childCount, MAX_REGION_COORDINATE) ?? 0;
  const rawParent = isRecord(input.parent) ? input.parent : undefined;
  const parent = {
    tagName: readString(rawParent?.tagName, 64) ?? "",
    role: serverRedactText(
      readString(rawParent?.role, MAX_ROLE_LENGTH) ?? "",
      MAX_ROLE_LENGTH,
      recorder
    ),
  };
  return { tagName, role, accessibleName, text, identityAttributes, childCount, parent };
};

const sanitizeElementCapture = (
  input: unknown,
  recorder: ServerRecorder
): ElementCapture | null => {
  if (!isRecord(input)) return null;
  const tagName = readString(input.tagName, 64);
  if (!tagName) return null;
  // v6: exactly ONE React Grab selector; no candidate arrays. Over-limit
  // selectors are rejected BEFORE truncation (the v6 limit is normative).
  const rawSelector = input.selector;
  if (
    typeof rawSelector !== "string" ||
    rawSelector.length === 0 ||
    rawSelector.length > MAX_SELECTOR_LENGTH
  ) {
    return null;
  }
  const selector = readString(rawSelector, MAX_SELECTOR_LENGTH);
  if (!selector) return null;

  const rawBounds = isRecord(input.bounds) ? input.bounds : undefined;
  const bounds = {
    x: readBoundedNumber(rawBounds?.x, MAX_REGION_COORDINATE) ?? 0,
    y: readBoundedNumber(rawBounds?.y, MAX_REGION_COORDINATE) ?? 0,
    width: readBoundedNumber(rawBounds?.width, MAX_REGION_COORDINATE) ?? 0,
    height: readBoundedNumber(rawBounds?.height, MAX_REGION_COORDINATE) ?? 0,
  };
  const componentName = readString(
    input.componentName,
    MAX_COMPONENT_NAME_LENGTH
  );
  const source = isRecord(input.source)
    ? sanitizeSourceFrame(input.source)
    : null;
  const sourceStack: SourceFrame[] = [];
  if (Array.isArray(input.sourceStack)) {
    for (const frame of input.sourceStack.slice(0, MAX_STACK_FRAMES)) {
      const sanitized = sanitizeSourceFrame(frame);
      if (sanitized) sourceStack.push(sanitized);
    }
  }
  const htmlPreview = serverRedactText(
    readString(input.htmlPreview, MAX_HTML_PREVIEW_LENGTH) ?? "",
    MAX_HTML_PREVIEW_LENGTH,
    recorder
  );
  const styleText = serverRedactText(
    readString(input.styleText, MAX_STYLE_TEXT_LENGTH) ?? "",
    MAX_STYLE_TEXT_LENGTH,
    recorder
  );
  const fingerprint = sanitizeFingerprint(input.fingerprint, recorder);
  if (!fingerprint) return null;
  return {
    tagName,
    selector,
    bounds,
    componentName: componentName ?? null,
    source,
    sourceStack,
    htmlPreview,
    styleText,
    fingerprint,
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
  // v6: regions are document-relative (shared contract §5).
  if (input.coordinateSpace !== "document") return undefined;
  const x = readBoundedNumber(input.x, MAX_REGION_COORDINATE);
  const y = readBoundedNumber(input.y, MAX_REGION_COORDINATE);
  const width = readBoundedNumber(input.width, MAX_REGION_COORDINATE);
  const height = readBoundedNumber(input.height, MAX_REGION_COORDINATE);
  if (x === undefined || y === undefined || width === undefined || height === undefined) {
    return undefined;
  }
  return { coordinateSpace: "document", x, y, width, height };
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
  const capturedAt = readString(input.capturedAt, 64);
  return {
    file,
    width,
    height,
    // Preserve capturedAt through mutation rewrites (F-2): the MCP
    // current_screenshot freshness check depends on it.
    ...(capturedAt !== undefined && !Number.isNaN(Date.parse(capturedAt))
      ? { capturedAt }
      : {}),
  };
};

/** Validate a heartbeat report carried by a client re-POST (F-2). */
function sanitizeHeartbeatReport(input: unknown): HeartbeatReport | undefined {
  if (!isRecord(input)) return undefined;
  const state = readString(input.state, 16);
  if (state !== "online" && state !== "stale" && state !== "offline") {
    return undefined;
  }
  const reportedAt = readString(input.reportedAt, 64);
  const checkedAt = readString(input.checkedAt, 64);
  if (!reportedAt || !checkedAt) return undefined;
  if (Number.isNaN(Date.parse(reportedAt)) || Number.isNaN(Date.parse(checkedAt))) {
    return undefined;
  }
  const lastOnlineAt = readString(input.lastOnlineAt, 64);
  return {
    state,
    reportedAt,
    checkedAt,
    ...(lastOnlineAt !== undefined &&
    !Number.isNaN(Date.parse(lastOnlineAt))
      ? { lastOnlineAt }
      : {}),
  };
}

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
  // Goal 04 B / §13: the evidence merge runs inside the SAME
  // cross-process write lock as every other authoritative writer (the
  // locked read → merge → revision/updatedAt stamp → atomic persist is
  // one critical section), so a concurrent browser save or CLI
  // completion can never be overwritten by a stale evidence write.
  return withActiveTaskLock(studioRoot, () => {
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
  // Goal 05: every successful server-side evidence mutation bumps the
  // server-owned monotonic taskRevision (distinct from task.revision).
  stampTaskRevision(task, studioRoot);

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
  });
}

// Revision tracking (contract §10).
export const DEFAULT_WAIT_TIMEOUT_MS = 10_000;

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
 * Validate and normalize a raw v6 task payload (server-authoritative):
 * every field is re-sanitized with the authoritative recorder — the
 * server never trusts client redaction. Schema v1-v5 artifacts get the
 * shared typed unsupported_schema result (see describeUnsupportedSchema)
 * — never normalized, never migrated.
 */
export function sanitizeTask(
  input: unknown,
  options: { studioRoot?: string } = {}
): PortalStudioTask | null {
  if (!isRecord(input)) return null;
  // v6 only: schema v1-v5 artifacts get the shared typed unsupported_schema
  // result (see describeUnsupportedSchema) — never normalized, never
  // migrated.
  if (input.schemaVersion !== TASK_SCHEMA_VERSION) return null;

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
  // Task-level sticky completion marker (taskId lifecycle): validated and
  // preserved so mutation re-POSTs keep the fully-completed state that
  // grants the next batch a fresh taskId.
  const completedAt = readString(input.completedAt, 64);
  if (completedAt !== undefined && Number.isNaN(Date.parse(completedAt))) {
    return null;
  }
  // Goal 04 C: updatedAt is part of the server-authoritative task — the
  // rebuild must PRESERVE it so the monotonic stamp keeps flooring
  // against the previous value on EVERY subsequent mutation (e.g. two
  // same-millisecond mutate writes).
  const updatedAt = readString(input.updatedAt, 64);
  if (updatedAt !== undefined && Number.isNaN(Date.parse(updatedAt))) {
    return null;
  }
  const screenshot = options.studioRoot
    ? sanitizeScreenshotRef(input.screenshot, options.studioRoot)
    : undefined;
  // Mutation re-POSTs carry the last-known heartbeat; preserve it so the
  // artifact's liveness state survives edit/delete/hide rewrites (F-2).
  const heartbeat = sanitizeHeartbeatReport(input.heartbeat);
  const diagnostics = sanitizeDiagnostics(input.diagnostics, recorder);
  if (diagnostics === null) return null;

  // An EMPTY annotations array is a VALID v6 task (the clear-all action
  // produces one).
  if (!Array.isArray(input.annotations)) {
    return null;
  }
  if (input.annotations.length > MAX_ANNOTATIONS) return null;
  const annotations: Annotation[] = [];
  for (const rawAnnotation of input.annotations.slice(0, MAX_ANNOTATIONS)) {
    const annotation = sanitizeAnnotation(rawAnnotation, recorder);
    if (!annotation) return null;
    annotations.push(annotation);
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
    ...(heartbeat ? { heartbeat } : {}),
    ...(completedAt ? { completedAt } : {}),
    ...(updatedAt !== undefined ? { updatedAt } : {}),
  };

  const serialized = JSON.stringify(task);
  if (Buffer.byteLength(serialized, "utf8") > MAX_ARTIFACT_BYTES) {
    return null;
  }
  return task;
}

/** Validate a single v6 annotation (server-authoritative). */
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
  // The additive verified-completion evidence is preserved across the
  // browser POST path (sanitized, bounded, never trusted raw). status and
  // completedAt remain the canonical completion fields.
  let completedEvidence: Annotation["completedEvidence"];
  const rawEvidence = isRecord(input.completedEvidence)
    ? input.completedEvidence
    : undefined;
  if (rawEvidence) {
    const evidenceVerified = rawEvidence.verified === true;
    const evidenceSummary = serverRedactText(
      readString(rawEvidence.summary, MAX_COMPLETION_SUMMARY_LENGTH) ?? "",
      MAX_COMPLETION_SUMMARY_LENGTH,
      recorder
    );
    const evidenceSource = readString(rawEvidence.source, 16);
    const evidenceCompletedAt = readString(rawEvidence.completedAt, 64);
    if (
      evidenceSummary &&
      evidenceSource === "cli" &&
      evidenceCompletedAt &&
      !Number.isNaN(Date.parse(evidenceCompletedAt))
    ) {
      completedEvidence = {
        verified: evidenceVerified,
        summary: evidenceSummary,
        source: "cli",
        completedAt: evidenceCompletedAt,
      };
    }
  }
  if (!Array.isArray(input.elements)) return null;
  const elements: ElementCapture[] = [];
  for (const rawElement of input.elements.slice(0, MAX_ELEMENTS)) {
    const element = sanitizeElementCapture(rawElement, recorder);
    if (!element) return null;
    elements.push(element);
  }
  const region = sanitizeRegion(input.region);
  // Goal 06: preserve the backward-compatible per-annotation page context
  // v6: pageContext is REQUIRED on every annotation (shared contract §5).
  // Sanitized and bounded like every other field; a malformed context
  // rejects the annotation.
  const rawContext = isRecord(input.pageContext) ? input.pageContext : undefined;
  if (!rawContext) return null;
  const pageUrl = serverRedactText(
    readString(rawContext.url, MAX_URL_LENGTH) ?? "",
    MAX_URL_LENGTH,
    recorder
  );
  const routeKey = serverRedactText(
    readString(rawContext.routeKey, 200) ?? "",
    200,
    recorder
  );
  const pageTitle = serverRedactText(
    readString(rawContext.title, MAX_TITLE_LENGTH) ?? "",
    MAX_TITLE_LENGTH,
    recorder
  );
  const viewport = isRecord(rawContext.viewport) ? rawContext.viewport : undefined;
  const scroll = isRecord(rawContext.scroll) ? rawContext.scroll : undefined;
  if (
    !pageUrl ||
    !routeKey ||
    !viewport ||
    !scroll ||
    typeof viewport.width !== "number" ||
    typeof viewport.height !== "number" ||
    typeof scroll.x !== "number" ||
    typeof scroll.y !== "number"
  ) {
    return null;
  }
  const pageContext: Annotation["pageContext"] = {
    url: pageUrl,
    routeKey,
    title: pageTitle,
    viewport: { width: viewport.width, height: viewport.height },
    scroll: { x: scroll.x, y: scroll.y },
    businessContext: sanitizeBusinessContext(rawContext.businessContext),
  };
  return {
    annotationId,
    kind,
    comment,
    createdAt,
    status,
    ...(completedAt ? { completedAt } : {}),
    ...(completedEvidence ? { completedEvidence } : {}),
    pageContext,
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

// ---------------------------------------------------------------------------
// Goal 05: server-owned monotonic taskRevision
// ---------------------------------------------------------------------------

/**
 * Read the current server-owned taskRevision from the active task file
 * (0 when absent). The revision is persisted IN the artifact so CLI and
 * server writes share one monotonic sequence regardless of which process
 * performed the last mutation (Goal 06 makes this path fully atomic).
 */
export function readTaskRevision(studioRoot: string): number {
  const task = readActiveTask(studioRoot);
  const revision = task?.taskRevision;
  return typeof revision === "number" && Number.isFinite(revision)
    ? revision
    : 0;
}

// ---------------------------------------------------------------------------
// Goal 04 B / shared contract §13 — cross-process serialized task writes.
// The active task has ONE authoritative writer at a time: the lock is
// acquired ATOMICALLY (O_EXCL) before the authoritative read, so the
// critical section spans read → expected-revision validation → typed
// apply/merge → revision+updatedAt stamping → atomic persistence. Two
// concurrent writers (CLI + dev server) can no longer stamp equal
// revisions or last-writer-wins; a STALE writer (expected revision
// mismatch against the locked read) fails with a conflict and never
// writes stale whole-task JSON.
// ---------------------------------------------------------------------------

const LOCK_DIRECTORY = "locks";
const LOCK_FILE_NAME = "active-task.lock";
const LOCK_RETRY_MS = 8;
const LOCK_DEFAULT_TIMEOUT_MS = 3000;
const LOCK_STALE_MS = 15000;

/** Raised when the write lock cannot be acquired within the timeout. */
export class TaskWriteLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskWriteLockError";
  }
}

/** Blocking sleep without yielding the event loop (sync writers). */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Run `critical` while holding the cross-process active-task write lock.
 * Acquisition is an atomic O_EXCL create carrying a unique token; waits
 * (bounded) when another writer holds it, breaks locks older than
 * `staleMs` (crash recovery), and only the token holder releases.
 */
export function withActiveTaskLock<T>(
  studioRoot: string,
  critical: () => T,
  options: { timeoutMs?: number; staleMs?: number } = {}
): T {
  const lockDirectory = path.join(studioRoot, LOCK_DIRECTORY);
  mkdirSync(lockDirectory, { recursive: true, mode: 0o700 });
  const lockPath = path.join(lockDirectory, LOCK_FILE_NAME);
  const token = `${process.pid}-${randomBytes(8).toString("hex")}`;
  const timeoutMs = options.timeoutMs ?? LOCK_DEFAULT_TIMEOUT_MS;
  const staleMs = options.staleMs ?? LOCK_STALE_MS;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const descriptor = openSync(lockPath, "wx", 0o600);
      writeSync(descriptor, token);
      closeSync(descriptor);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // Crash recovery: a lock older than the staleness threshold is
      // broken (the previous holder died mid-write).
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > staleMs) {
          unlinkSync(lockPath);
          continue;
        }
      } catch {
        // The lock vanished between stat and unlink — retry.
      }
      if (Date.now() >= deadline) {
        throw new TaskWriteLockError(
          `timed out waiting for the active-task write lock at ${lockPath}`
        );
      }
      sleepSync(LOCK_RETRY_MS);
    }
  }
  try {
    return critical();
  } finally {
    try {
      if (readFileSync(lockPath, "utf8") === token) {
        unlinkSync(lockPath);
      }
    } catch {
      // Lock already released/removed — nothing to do.
    }
  }
}

export type SerializedWriteResult =
  | { ok: true; revision: number; noop?: boolean }
  | {
      ok: false;
      error: string;
      taskRevision?: number;
      task?: PortalStudioTask | null;
    };

/**
 * The ONE authoritative task write boundary (Goal 04 B / §13): under the
 * cross-process lock it reads the authoritative active task, validates the
 * expected revision (a stale writer gets a conflict and NEVER writes),
 * runs the typed apply/merge against the locked read, stamps the next
 * taskRevision + monotonic updatedAt INSIDE the lock (so equal revisions
 * are impossible), and persists atomically.
 */
export function writeActiveTaskSerialized(
  studioRoot: string,
  input: {
    expectedTaskRevision?: number;
    apply: (
      authoritative: PortalStudioTask | null
    ) => { ok: boolean; error?: string; task?: PortalStudioTask };
  },
  options: { timeoutMs?: number } = {}
): SerializedWriteResult {
  try {
    return withActiveTaskLock(studioRoot, () => {
      const current = readActiveTask(studioRoot);
      const currentRevision = readTaskRevision(studioRoot);
      if (
        input.expectedTaskRevision !== undefined &&
        input.expectedTaskRevision !== currentRevision
      ) {
        return {
          ok: false,
          error: "revision_conflict",
          taskRevision: currentRevision,
          task: current,
        };
      }
      const applied = input.apply(current);
      if (!applied.ok) {
        return { ok: false, error: applied.error ?? "invalid_task" };
      }
      if (!applied.task) {
        // Authoritative no-op (e.g. CLI "already completed"): no write.
        return { ok: true, revision: currentRevision, noop: true };
      }
      const revision = stampTaskRevision(applied.task, studioRoot);
      try {
        atomicWriteTaskFile(
          studioRoot,
          "active-task.json",
          JSON.stringify(applied.task)
        );
      } catch {
        return { ok: false, error: "write_failed" };
      }
      return { ok: true, revision };
    }, options);
  } catch (error) {
    if (error instanceof TaskWriteLockError) {
      return { ok: false, error: "lock_timeout" };
    }
    throw error;
  }
}

/**
 * Stamp the next monotonic taskRevision onto a task object in place and
 * return the stamped revision. Pure bookkeeping — does not write.
 *
 * The counter is file-derived (read current + 1), so the stored sequence
 * never decreases even with stale task objects. Callers at the
 * AUTHORITATIVE write boundary MUST invoke this inside
 * writeActiveTaskSerialized / withActiveTaskLock — the locked read makes
 * the read+1-+stamp-+persist span atomic, so concurrent writers can no
 * longer stamp equal revisions or last-writer-wins.
 */
export function stampTaskRevision(
  task: PortalStudioTask,
  studioRoot: string
): number {
  const next = readTaskRevision(studioRoot) + 1;
  task.taskRevision = next;
  // Goal 04 C: updatedAt changes on EVERY successful mutation — stamped
  // in the single shared write path (server, CLI, evidence merges). The
  // monotonic floor is derived from BOTH sources: the incoming task's own
  // updatedAt (when present) and the AUTHORITATIVE persisted active task
  // on disk — the GREATEST valid parsed timestamp wins. The stamp is then
  // max(current clock, floor + 1 ms), so two successful writes that
  // observe the same (or an earlier, e.g. clock-adjusted) millisecond
  // still persist strictly increasing timestamps. Tasks (and persisted
  // tasks) without updatedAt (older artifacts or a fresh creation) fall
  // back to the current time.
  const floorMs = [task.updatedAt, readActiveTask(studioRoot)?.updatedAt]
    .map((candidate) => (candidate ? Date.parse(candidate) : Number.NaN))
    // Malformed or out-of-range timestamps parse to NaN — ignore them;
    // values beyond the ECMAScript Date range are not representable.
    .filter(
      (parsed) =>
        Number.isFinite(parsed) && Math.abs(parsed) <= MAX_DATE_MS
    )
    .reduce(
      (greatest, parsed) => Math.max(greatest, parsed),
      Number.NEGATIVE_INFINITY
    );
  const now = Date.now();
  // Guard the +1 ms floor against Date range overflow: the stamp is
  // clamped to the max representable instant, so toISOString can never
  // throw. At the representational ceiling the value saturates (strict
  // monotonicity is bounded by the ISO-8601 Date format).
  const stampMs = Number.isFinite(floorMs)
    ? Math.min(Math.max(now, floorMs + 1), MAX_DATE_MS)
    : Math.min(now, MAX_DATE_MS);
  task.updatedAt = new Date(stampMs).toISOString();
  return next;
}

/** ECMAScript Date range bound: ±8,640,000,000,000,000 ms (years ±275760);
 *  beyond it `new Date(...).toISOString()` throws "Invalid time value". */
const MAX_DATE_MS = 8_640_000_000_000_000;

/**
 * Atomically write the active task with a freshly incremented
 * taskRevision. Shared by the dev-server middleware and the agent CLI so
 * every successful mutation bumps the revision exactly once (single
 * atomic write path — Goal 06 can harden it further).
 */
export function writeActiveTaskWithRevision(
  studioRoot: string,
  task: PortalStudioTask
): {
  ok: boolean;
  error?: "artifact_too_large" | "write_failed";
  revision?: number;
} {
  const revision = stampTaskRevision(task, studioRoot);
  const serialized = JSON.stringify(task, null, 2);
  if (Buffer.byteLength(serialized, "utf8") > MAX_ARTIFACT_BYTES) {
    return { ok: false, error: "artifact_too_large" };
  }
  try {
    atomicWriteTaskFile(studioRoot, "active-task.json", serialized);
  } catch {
    return { ok: false, error: "write_failed" };
  }
  return { ok: true, revision };
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
