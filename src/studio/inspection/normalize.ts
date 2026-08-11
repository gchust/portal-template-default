/**
 * Portal Studio — v6 inspection normalization and redaction.
 *
 * Normalizes the structural upstream context (`RawInspectionContext`) plus a
 * live element into the persisted-safe `InspectedElement` contract (shared
 * contract §5). Removes live `element`/`fiber`/upstream objects, bounds every
 * string, redacts secret-looking assignments, and omits source paths that are
 * external, inside `node_modules`, or traversal-like. A valid element with
 * `source: null` stays `null` — this module never guesses with a custom
 * resolver.
 *
 * Source-path rules (G02-AC05): absolute paths become workspace-relative
 * POSIX paths by stripping the leading slash / Windows drive prefix; paths
 * containing `node_modules`, URL origins, or `..` traversal segments are
 * omitted. The client cannot know the server workspace root; the endpoint's
 * authoritative sanitization (unchanged in this Goal) remains the final
 * defense for persisted artifacts.
 */

import { composedParent } from "./hierarchy";
import {
  INSPECTION_ACCESSIBLE_NAME_LIMIT,
  INSPECTION_COMPONENT_NAME_LIMIT,
  INSPECTION_HTML_PREVIEW_LIMIT,
  INSPECTION_IDENTITY_ATTRIBUTES_LIMIT,
  INSPECTION_IDENTITY_VALUE_LIMIT,
  INSPECTION_ROLE_LIMIT,
  INSPECTION_SELECTOR_LIMIT,
  INSPECTION_STACK_FRAMES_LIMIT,
  INSPECTION_STYLE_TEXT_LIMIT,
  INSPECTION_TEXT_LIMIT,
  InspectionError,
} from "./types";
import type {
  ElementFingerprint,
  InspectedElement,
  RawInspectionContext,
  RawSourceFrame,
  SourceFrame,
  ViewportRect,
} from "./types";

const SECRET_ASSIGNMENT_PATTERN =
  /(^|[\s&;?,])(token|secret|password|api[_-]?key)\s*[:=]\s*[^\s&;,"']+/gi;

const SECRET_KEY_PATTERN =
  /(?:^|[-_.])(?:token|secret|password|authorization|cookie|api[-_.]?key)(?:$|[-_.])/i;

const COLLAPSE_WHITESPACE_PATTERN = /\s+/g;

const collapseWhitespace = (value: string): string =>
  value.replace(COLLAPSE_WHITESPACE_PATTERN, " ").trim();

/** Redact secret-looking assignments and bound a text value. */
export function redactInspectionText(value: string, limit: number): string {
  const redacted = value.replace(SECRET_ASSIGNMENT_PATTERN, "$1$2=[REDACTED]");
  return redacted.length > limit ? redacted.slice(0, limit) : redacted;
}

/**
 * Shared text normalization for capture AND rehydration comparison: trim,
 * collapse whitespace, apply the same length bound used at capture time
 * (shared contract §6).
 */
export function normalizeComparedText(value: string, limit: number): string {
  return collapseWhitespace(value ?? "").slice(0, limit);
}

/**
 * Workspace-relative POSIX source path, or null when the path must be
 * omitted (node_modules, external URL, traversal, empty).
 */
export function toWorkspaceRelativePosix(
  filePath: string | null | undefined
): string | null {
  if (!filePath) return null;
  const trimmed = filePath.trim();
  if (!trimmed) return null;
  if (trimmed.includes("node_modules")) return null;
  if (/^https?:\/\//i.test(trimmed)) return null;
  let candidate = trimmed;
  if (/^[a-zA-Z]:[\\/]/.test(candidate)) {
    candidate = candidate.replace(/^[a-zA-Z]:[\\/]+/, "");
  }
  const posix = candidate.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = posix.split("/").filter((part) => part !== "" && part !== ".");
  if (parts.some((part) => part === "..")) return null;
  const resolved = parts.join("/");
  return resolved || null;
}

/** Normalize one raw source frame into the v6 `SourceFrame`, or null. */
export function normalizeSourceFrame(
  frame: RawSourceFrame
): SourceFrame | null {
  const filePath = toWorkspaceRelativePosix(frame.fileName);
  if (!filePath) return null;
  const lineNumber = frame.lineNumber;
  const columnNumber = frame.columnNumber;
  if (
    typeof lineNumber !== "number" ||
    !Number.isInteger(lineNumber) ||
    lineNumber <= 0 ||
    typeof columnNumber !== "number" ||
    !Number.isInteger(columnNumber) ||
    columnNumber < 0
  ) {
    return null;
  }
  return {
    filePath,
    lineNumber,
    columnNumber,
    componentName: frame.functionName
      ? String(frame.functionName).slice(0, INSPECTION_COMPONENT_NAME_LIMIT)
      : null,
  };
}

/** Normalize the primary source location; a valid null stays null. */
export function normalizeSource(
  filePath: string | null,
  lineNumber: number | null,
  columnNumber: number | null,
  componentName: string | null
): SourceFrame | null {
  const resolved = toWorkspaceRelativePosix(filePath);
  if (!resolved) return null;
  if (
    typeof lineNumber !== "number" ||
    !Number.isInteger(lineNumber) ||
    lineNumber <= 0 ||
    typeof columnNumber !== "number" ||
    !Number.isInteger(columnNumber) ||
    columnNumber < 0
  ) {
    return null;
  }
  return {
    filePath: resolved,
    lineNumber,
    columnNumber,
    componentName: componentName
      ? String(componentName).slice(0, INSPECTION_COMPONENT_NAME_LIMIT)
      : null,
  };
}

/** Bound a viewport rect; non-finite values become zero (never throw). */
export function sanitizeViewportRect(
  bounds: Partial<ViewportRect> | null | undefined
): ViewportRect {
  const finite = (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value) ? value : 0;
  return {
    x: finite(bounds?.x),
    y: finite(bounds?.y),
    width: Math.max(0, finite(bounds?.width)),
    height: Math.max(0, finite(bounds?.height)),
  };
}

/**
 * Accessible-name extraction in ARIA precedence order: aria-labelledby
 * (resolved in the element's document), aria-label, alt, title. Bounded to
 * the v6 accessible-name limit.
 */
export function extractAccessibleName(element: Element): string {
  const limit = INSPECTION_ACCESSIBLE_NAME_LIMIT;
  const labelledby = element.getAttribute("aria-labelledby");
  if (labelledby) {
    const documentRef = element.ownerDocument;
    const ids = labelledby
      .split(/\s+/)
      .map((id) => id.trim())
      .filter(Boolean);
    if (ids.length && documentRef) {
      const names: string[] = [];
      for (const id of ids) {
        const reference = documentRef.getElementById(id);
        if (reference) names.push(collapseWhitespace(reference.textContent ?? ""));
        if (names.join(" ").length >= limit) break;
      }
      const joined = names.join(" ").trim();
      if (joined) return joined.slice(0, limit);
    }
  }
  for (const attribute of ["aria-label", "alt", "title"]) {
    const value = element.getAttribute(attribute);
    if (value) return collapseWhitespace(value).slice(0, limit);
  }
  return "";
}

/**
 * Strong identity attributes: `id`, `data-ai-page-element`, and safe
 * (non-secret) `data-nb-*` keys. Bounded to 30 entries, values to 500 chars.
 */
export function extractIdentityAttributes(
  element: Element
): Record<string, string> {
  const result: Record<string, string> = {};
  const put = (name: string, value: string) => {
    if (Object.keys(result).length >= INSPECTION_IDENTITY_ATTRIBUTES_LIMIT) {
      return;
    }
    if (!value) return;
    result[name] = value.slice(0, INSPECTION_IDENTITY_VALUE_LIMIT);
  };
  put("id", element.getAttribute("id") ?? "");
  put("data-ai-page-element", element.getAttribute("data-ai-page-element") ?? "");
  for (const attribute of Array.from(element.attributes)) {
    if (!attribute.name.startsWith("data-nb-")) continue;
    if (SECRET_KEY_PATTERN.test(attribute.name)) continue;
    put(attribute.name, attribute.value);
  }
  return result;
}

/** Extract the deterministic v6 fingerprint from a live element. */
export function extractFingerprint(element: Element): ElementFingerprint {
  const tagName = element.tagName.toLowerCase();
  const role = collapseWhitespace(element.getAttribute("role") ?? "").slice(
    0,
    INSPECTION_ROLE_LIMIT
  );
  const accessibleName = extractAccessibleName(element);
  const text = collapseWhitespace(element.textContent ?? "").slice(
    0,
    INSPECTION_TEXT_LIMIT
  );
  const parent = composedParent(element);
  return {
    tagName,
    role,
    accessibleName,
    text,
    identityAttributes: extractIdentityAttributes(element),
    childCount: element.children.length,
    parent: parent
      ? {
          tagName: parent.tagName.toLowerCase(),
          role: collapseWhitespace(parent.getAttribute("role") ?? "").slice(
            0,
            INSPECTION_ROLE_LIMIT
          ),
        }
      : { tagName: "", role: "" },
  };
}

/**
 * Normalize a raw upstream inspection result into the persisted-safe v6
 * contract. Throws a typed `InspectionError` when the selector is empty or
 * over the v6 limit; every other bound is applied (never thrown).
 */
export function normalizeInspectedElement(
  element: Element,
  raw: RawInspectionContext,
  bounds: ViewportRect
): InspectedElement {
  const selector = (raw.selector ?? "").trim();
  if (!selector) {
    throw new InspectionError(
      "invalid_selector",
      "React Grab returned an empty selector; inspection failed"
    );
  }
  if (selector.length > INSPECTION_SELECTOR_LIMIT) {
    throw new InspectionError(
      "invalid_selector",
      `React Grab selector exceeds the ${INSPECTION_SELECTOR_LIMIT}-character limit`
    );
  }
  const sourceStack: SourceFrame[] = [];
  for (const frame of raw.stack ?? []) {
    const normalized = normalizeSourceFrame(frame);
    if (normalized) sourceStack.push(normalized);
    if (sourceStack.length >= INSPECTION_STACK_FRAMES_LIMIT) break;
  }
  return {
    tagName: element.tagName.toLowerCase(),
    selector,
    bounds: sanitizeViewportRect(bounds),
    componentName: raw.componentName
      ? String(raw.componentName).slice(0, INSPECTION_COMPONENT_NAME_LIMIT)
      : null,
    source: normalizeSource(
      raw.filePath,
      raw.lineNumber,
      raw.columnNumber,
      raw.componentName
    ),
    sourceStack,
    htmlPreview: redactInspectionText(
      String(raw.htmlPreview ?? ""),
      INSPECTION_HTML_PREVIEW_LIMIT
    ),
    styleText: redactInspectionText(
      String(raw.styles ?? ""),
      INSPECTION_STYLE_TEXT_LIMIT
    ),
    fingerprint: extractFingerprint(element),
  };
}
