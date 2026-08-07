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
  type BusinessContextItem,
  type ElementCapture,
  type PortalStudioTask,
  type PortalStudioTaskV1,
  type RedactionManifest,
  type Region,
  type ScreenshotRef,
  type SelectorCandidateKind,
} from "./types";

export const SESSION_TOKEN_BYTES = 32;
export const MAX_TASK_BODY_BYTES = 256 * 1024;
export const MAX_ARTIFACT_BYTES = 256 * 1024;
export const MAX_SCREENSHOT_BODY_BYTES = 2_800_000;
export const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;
export const TASKS_DIRECTORY = "tasks";
export const SCREENSHOTS_DIRECTORY = "screenshots";
export const SESSION_FILENAME = "session.json";

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

type ServerRecorder = {
  droppedKeys: Set<string>;
  redactedValues: number;
  truncatedValues: number;
};

const createServerRecorder = (): ServerRecorder => ({
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

/** Validate and normalize a raw v1/v2 task payload into a safe v2 task. */
export function sanitizeTask(
  input: unknown,
  options: { studioRoot?: string } = {}
): PortalStudioTask | null {
  if (!isRecord(input)) return null;
  const isV1 = input.schemaVersion === TASK_SCHEMA_VERSION_V1;
  const isV2 = input.schemaVersion === TASK_SCHEMA_VERSION;
  if (!isV1 && !isV2) return null;

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
  if (!Array.isArray(elementsInput) || elementsInput.length < 1) return null;

  const elements: ElementCapture[] = [];
  for (const rawElement of elementsInput.slice(0, MAX_ELEMENTS)) {
    const element = sanitizeElementCapture(rawElement, recorder);
    if (!element) return null;
    elements.push(element);
  }

  const businessContext = sanitizeBusinessContext(input.businessContext);
  const region = isV1 ? undefined : sanitizeRegion(input.region);
  const screenshot = isV1
    ? undefined
    : options.studioRoot
      ? sanitizeScreenshotRef(input.screenshot, options.studioRoot)
      : undefined;

  const task: PortalStudioTask = {
    schemaVersion: TASK_SCHEMA_VERSION,
    taskId,
    createdAt,
    url,
    title,
    instruction,
    elements,
    ...(region ? { region } : {}),
    businessContext,
    redaction: toServerManifest(recorder),
    ...(screenshot ? { screenshot } : {}),
  };

  const serialized = JSON.stringify(task);
  if (Buffer.byteLength(serialized, "utf8") > MAX_ARTIFACT_BYTES) {
    return null;
  }
  return task;
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
