/**
 * Portal Studio — task redaction (client side).
 *
 * Baseline: `redactPortalErrorText` from the nocobase-error-boundary registry
 * item (reused per contract §3.1). Extensions: deep secret-key dropping,
 * length caps, and a redaction manifest recording what was stripped — the
 * artifact carries the manifest so agents can explain redactions. Secrets are
 * never captured by default (contract §2 invariant 3). The server re-runs its
 * own independent sanitization pass and builds the authoritative manifest
 * (defense in depth; the client manifest is never trusted).
 */

import { redactPortalErrorText } from "@/extensions/nocobase-error-boundary/error-diagnostics";
import type { RedactionManifest } from "./types";

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

/** Mutable accumulator used while redacting; converts to a manifest. */
export type RedactionRecorder = {
  droppedKeys: Set<string>;
  redactedValues: number;
  truncatedValues: number;
};

export const createRedactionRecorder = (): RedactionRecorder => ({
  droppedKeys: new Set<string>(),
  redactedValues: 0,
  truncatedValues: 0,
});

export function toRedactionManifest(
  recorder: RedactionRecorder
): RedactionManifest {
  return {
    droppedKeys: [...recorder.droppedKeys].sort(),
    redactedValues: recorder.redactedValues,
    truncatedValues: recorder.truncatedValues,
  };
}

/**
 * Baseline extension: bare `token=…` / `secret=…` assignments inside plain
 * text (not only URL query strings) are redacted as well.
 */
const BARE_SECRET_ASSIGNMENT_PATTERN =
  /(^|[\s&;?,])(token|secret|password|api[_-]?key)\s*[:=]\s*[^\s&;,"']+/gi;

/** Redact a single text value: strip credentials, truncate, keep type. */
export function redactTextValue(
  value: string,
  caps: RedactionCaps = {},
  recorder?: RedactionRecorder
): string {
  const limit = caps.string ?? DEFAULT_REDACTION_CAPS.string;
  const baseline = redactPortalErrorText(value);
  const redacted = baseline.replace(
    BARE_SECRET_ASSIGNMENT_PATTERN,
    "$1$2=[REDACTED]"
  );
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

/**
 * Recursively drop keys that look like secrets and redact/truncate all string
 * leaves. Returns a new plain object; the input is never mutated.
 */
export function sanitizeArtifact(
  value: unknown,
  caps: RedactionCaps = {},
  recorder?: RedactionRecorder
): unknown {
  const limit = caps.string ?? DEFAULT_REDACTION_CAPS.string;
  const depthLimit = caps.depth ?? DEFAULT_REDACTION_CAPS.depth;

  const visit = (current: unknown, depth: number): unknown => {
    if (typeof current === "string") {
      return redactTextValue(current, { ...caps, string: limit }, recorder);
    }
    if (typeof current === "number" || typeof current === "boolean") {
      return current;
    }
    if (current === null || current === undefined) {
      return null;
    }
    if (Array.isArray(current)) {
      if (depth >= depthLimit) {
        if (recorder) recorder.truncatedValues += 1;
        return "[truncated]";
      }
      return current.map((item) => visit(item, depth + 1));
    }
    if (isRecord(current)) {
      if (depth >= depthLimit) {
        if (recorder) recorder.truncatedValues += 1;
        return "[truncated]";
      }
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(current)) {
        if (SECRET_KEY_PATTERN.test(key)) {
          if (recorder) recorder.droppedKeys.add(key);
          continue;
        }
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
  caps: RedactionCaps = {},
  recorder?: RedactionRecorder
): Record<string, string> {
  const attributeLimit = caps.attribute ?? DEFAULT_REDACTION_CAPS.attribute;
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      if (recorder) recorder.droppedKeys.add(key);
      continue;
    }
    result[key] = redactTextValue(
      value,
      { ...caps, string: attributeLimit },
      recorder
    );
  }
  return result;
}

export { SECRET_KEY_PATTERN };
