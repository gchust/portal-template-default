/**
 * Portal Studio — dev endpoint helpers (server side, node only).
 *
 * Pure, testable pieces used by the serve-only Vite plugin (`vite.ts`):
 * constant-time session token verification, task validation/sanitization,
 * path-traversal-safe file naming, and atomic task writes.
 *
 * Security invariants (contract §7): loopback dev server only, random
 * per-session token (≥ 32 bytes CSPRNG), constant-time comparison, body and
 * path bounds, path-traversal guard, temp file + rename atomic writes, and
 * secrets never written into artifacts.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

// Server-side redaction is self-contained on purpose: `vite.config.ts` is
// bundled without the project's `@/extensions` alias at config-load time, so
// the node-only chain (endpoint -> vite plugin) must not import the client
// redaction module. Patterns mirror the client baseline
// (`redactPortalErrorText`, see `redact.ts`) plus secret-key dropping. The
// server never trusts client-side redaction (defense in depth).
import {
  TASK_FILENAME,
  TASK_SCHEMA_VERSION,
  type PortalStudioTask,
  type SelectorCandidateKind,
} from "./types";

export const SESSION_TOKEN_BYTES = 32;
export const MAX_TASK_BODY_BYTES = 256 * 1024;
export const TASKS_DIRECTORY = "tasks";
export const SESSION_FILENAME = "session.json";

const TASK_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const MAX_URL_LENGTH = 2000;
const MAX_TITLE_LENGTH = 500;
const MAX_INSTRUCTION_LENGTH = 2000;
const MAX_CANDIDATES = 50;
const MAX_SELECTORS = 10;
const MAX_ATTRIBUTES = 20;
const MAX_TEXT_LENGTH = 500;
const MAX_CHILD_COUNT = 1_000_000;

const SELECTOR_KINDS = new Set<string>(["id", "attribute", "path"]);

const isSelectorKind = (value: string): value is SelectorCandidateKind =>
  SELECTOR_KINDS.has(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

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

function serverRedactText(value: string, limit: number): string {
  let redacted = value;
  for (const [pattern, replacement] of SERVER_REDACTION_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted.length > limit
    ? `${redacted.slice(0, limit)}…[truncated]`
    : redacted;
}

function sanitizeServerValue(value: unknown, depth: number): unknown {
  if (typeof value === "string") {
    return serverRedactText(value, MAX_SERVER_STRING);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value === null || value === undefined) {
    return null;
  }
  if (Array.isArray(value)) {
    return depth >= MAX_SERVER_DEPTH
      ? "[truncated]"
      : value.map((item) => sanitizeServerValue(item, depth + 1));
  }
  if (isRecord(value)) {
    if (depth >= MAX_SERVER_DEPTH) return "[truncated]";
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (SECRET_KEY_PATTERN.test(key)) continue;
      result[key] = sanitizeServerValue(entry, depth + 1);
    }
    return result;
  }
  return null;
}

function sanitizeServerAttributes(
  attributes: Record<string, string>
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (SECRET_KEY_PATTERN.test(key)) continue;
    result[key] = serverRedactText(value, MAX_SERVER_ATTRIBUTE);
  }
  return result;
}

const readString = (
  value: unknown,
  maxLength: number
): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
};

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

/** Validate and normalize a raw task payload into a safe schema-v1 task. */
export function sanitizeTask(input: unknown): PortalStudioTask | null {
  if (!isRecord(input)) return null;
  if (input.schemaVersion !== TASK_SCHEMA_VERSION) return null;

  const taskId = readString(input.taskId, 64);
  if (!taskId || !isSafeTaskFileName(taskId)) return null;
  const url = readString(input.url, MAX_URL_LENGTH);
  if (!url) return null;
  const createdAt = readString(input.createdAt, 64);
  if (!createdAt || Number.isNaN(Date.parse(createdAt))) return null;
  const title = serverRedactText(
    readString(input.title, MAX_TITLE_LENGTH) ?? "",
    MAX_TITLE_LENGTH
  );
  const instruction = serverRedactText(
    readString(input.instruction, MAX_INSTRUCTION_LENGTH) ?? "",
    MAX_INSTRUCTION_LENGTH
  );

  const element = isRecord(input.element) ? input.element : null;
  if (!element) return null;
  const tagName = readString(element.tagName, 64);
  if (!tagName) return null;

  const selectorCandidates = Array.isArray(element.selectorCandidates)
    ? element.selectorCandidates
        .slice(0, MAX_SELECTORS)
        .flatMap((candidate) => {
          if (!isRecord(candidate)) return [];
          const selector = readString(candidate.selector, 200);
          const kind = readString(candidate.kind, 32);
          if (!selector || !kind || !isSelectorKind(kind)) return [];
          return [{ kind, selector }];
        })
    : [];

  const componentCandidates = Array.isArray(element.componentCandidates)
    ? element.componentCandidates.slice(0, MAX_CANDIDATES).flatMap((entry) => {
        if (!isRecord(entry)) return [];
        const name = readString(entry.name, 200) ?? null;
        const key = readString(entry.key, 200) ?? null;
        return [{ name, key }];
      })
    : [];

  const snapshot = isRecord(element.snapshot) ? element.snapshot : null;
  const snapshotText = snapshot
    ? (readString(snapshot.text, MAX_TEXT_LENGTH) ?? "")
    : "";
  const rawAttributes = snapshot && isRecord(snapshot.attributes)
    ? snapshot.attributes
    : {};
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

  const safeAttributes = sanitizeServerAttributes(attributes);

  return {
    schemaVersion: TASK_SCHEMA_VERSION,
    taskId,
    createdAt,
    url,
    title,
    instruction,
    element: {
      tagName,
      selectorCandidates,
      componentCandidates,
      // Source candidates are server-resolved (module graph) and merged by
      // the plugin before the write; client-supplied ones are dropped.
      sourceCandidates: [],
      snapshot: {
        text: String(sanitizeServerValue(snapshotText, 0)),
        attributes: safeAttributes,
        childCount,
      },
    },
  };
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

export { TASK_FILENAME };
