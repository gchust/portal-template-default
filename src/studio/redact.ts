/**
 * Portal Studio — task redaction.
 *
 * Baseline: `redactPortalErrorText` from the nocobase-error-boundary registry
 * item (reused per contract §3.1). Extensions: deep secret-key dropping and
 * length caps for artifact payloads. Secrets are never captured by default
 * (contract §2 invariant 3).
 */

import { redactPortalErrorText } from "@/extensions/nocobase-error-boundary/error-diagnostics";

const SECRET_KEY_PATTERN =
  /(?:^|[-_.])(?:token|secret|password|authorization|cookie|api[-_.]?key)(?:$|[-_.]|$)/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const MAX_STRING_LENGTH = 2000;
const MAX_ATTRIBUTE_LENGTH = 200;
const MAX_OBJECT_DEPTH = 6;

export const DEFAULT_REDACTION_CAPS = {
  string: MAX_STRING_LENGTH,
  attribute: MAX_ATTRIBUTE_LENGTH,
  depth: MAX_OBJECT_DEPTH,
} as const;

export type RedactionCaps = {
  string?: number;
  attribute?: number;
  depth?: number;
};

/**
 * Baseline extension: bare `token=…` / `secret=…` assignments inside plain
 * text (not only URL query strings) are redacted as well.
 */
const BARE_SECRET_ASSIGNMENT_PATTERN =
  /(^|[\s&;?,])(token|secret|password|api[_-]?key)\s*[:=]\s*[^\s&;,"']+/gi;

/** Redact a single text value: strip credentials, truncate, keep type. */
export function redactTextValue(
  value: string,
  caps: RedactionCaps = {}
): string {
  const limit = caps.string ?? DEFAULT_REDACTION_CAPS.string;
  const baseline = redactPortalErrorText(value);
  const redacted = baseline.replace(
    BARE_SECRET_ASSIGNMENT_PATTERN,
    "$1$2=[REDACTED]"
  );
  return redacted.length > limit
    ? `${redacted.slice(0, limit)}…[truncated]`
    : redacted;
}

/**
 * Recursively drop keys that look like secrets and redact/truncate all string
 * leaves. Returns a new plain object; the input is never mutated.
 */
export function sanitizeArtifact(
  value: unknown,
  caps: RedactionCaps = {}
): unknown {
  const limit = caps.string ?? DEFAULT_REDACTION_CAPS.string;
  const depthLimit = caps.depth ?? DEFAULT_REDACTION_CAPS.depth;

  const visit = (current: unknown, depth: number): unknown => {
    if (typeof current === "string") {
      return redactTextValue(current, { ...caps, string: limit });
    }
    if (typeof current === "number" || typeof current === "boolean") {
      return current;
    }
    if (current === null || current === undefined) {
      return null;
    }
    if (Array.isArray(current)) {
      return depth >= depthLimit
        ? "[truncated]"
        : current.map((item) => visit(item, depth + 1));
    }
    if (isRecord(current)) {
      if (depth >= depthLimit) return "[truncated]";
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(current)) {
        if (SECRET_KEY_PATTERN.test(key)) continue;
        result[key] = visit(value, depth + 1);
      }
      return result;
    }
    return null;
  };

  return visit(value, 0);
}

/** Redact an attribute map with the stricter per-attribute cap. */
export function sanitizeAttributeMap(
  attributes: Record<string, string>,
  caps: RedactionCaps = {}
): Record<string, string> {
  const attributeLimit =
    caps.attribute ?? DEFAULT_REDACTION_CAPS.attribute;
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (SECRET_KEY_PATTERN.test(key)) continue;
    result[key] = redactTextValue(value, {
      ...caps,
      string: attributeLimit,
    });
  }
  return result;
}
