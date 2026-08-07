/**
 * Portal Studio — element capture (client side).
 *
 * Builds the schema-v1 element capture for a picked DOM element: selector
 * candidates, component candidates (React Grab), and a redacted minimal
 * snapshot. Source candidates are resolved by the dev server (module graph)
 * at write time and merged in `vite.ts`.
 */

import { collectComponentChain, readFiberTypeName } from "./grab";
import { redactTextValue, sanitizeAttributeMap } from "./redact";
import type { ElementCapture, SelectorCandidate } from "./types";

const PAGE_ELEMENT_ATTRIBUTE = "data-ai-page-element";

const escapeCss = (value: string) =>
  typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(value)
    : value;

const MAX_SNAPSHOT_TEXT = 500;
const MAX_SELECTOR_DEPTH = 3;
const MAX_ATTRIBUTES = 20;
const MAX_ATTRIBUTE_LENGTH = 200;

const ATTRIBUTE_ALLOWLIST = new Set([
  "id",
  "class",
  "type",
  "role",
  "name",
  "placeholder",
  "aria-label",
  "data-ai-page-element",
]);

function readAttributes(element: Element): Record<string, string> {
  const attributes: Record<string, string> = {};
  let collected = 0;
  for (const attribute of Array.from(element.attributes)) {
    if (!ATTRIBUTE_ALLOWLIST.has(attribute.name)) continue;
    if (collected >= MAX_ATTRIBUTES) break;
    attributes[attribute.name] = attribute.value.slice(
      0,
      MAX_ATTRIBUTE_LENGTH
    );
    collected += 1;
  }
  return attributes;
}

/** Build CSS-path selector candidates, bounded in depth. */
export function collectSelectorCandidates(
  element: Element
): SelectorCandidate[] {
  const candidates: SelectorCandidate[] = [];
  const id = element.getAttribute("id");
  if (id) {
    candidates.push({ kind: "id", selector: `#${escapeCss(id)}` });
  }
  const pageElementId = element.getAttribute(PAGE_ELEMENT_ATTRIBUTE);
  if (pageElementId) {
    candidates.push({
      kind: "attribute",
      selector: `[${PAGE_ELEMENT_ATTRIBUTE}="${escapeCss(pageElementId)}"]`,
    });
  }
  const role = element.getAttribute("role");
  if (role) {
    candidates.push({
      kind: "attribute",
      selector: `[role="${escapeCss(role)}"]`,
    });
  }

  const pathParts: string[] = [];
  let current: Element | null = element;
  for (let depth = 0; current && depth < MAX_SELECTOR_DEPTH; depth += 1) {
    const tag = current.tagName.toLowerCase();
    const partId = current.getAttribute("id");
    const part = partId
      ? `${tag}#${escapeCss(partId)}`
      : `${tag}${
          current.className
            ? `.${String(current.className).trim().split(/\s+/)[0]}`
            : ""
        }`;
    pathParts.unshift(part);
    current = current.parentElement;
  }
  candidates.push({ kind: "path", selector: pathParts.join(" > ") });
  return candidates;
}

/** Read component candidates from the React fiber chain (fails closed). */
export function collectComponentCandidates(
  element: Element
): ElementCapture["componentCandidates"] {
  return collectComponentChain(element);
}

/** Read the nearest host component name of an element (toolbar display). */
export function readHostComponentName(element: Element): string | null {
  const fiberKey = Object.keys(element).find((key) =>
    key.startsWith("__reactFiber$")
  );
  if (!fiberKey) return null;
  const fiber = (element as unknown as Record<string, unknown>)[fiberKey] as
    | { type?: unknown; return?: { type?: unknown } | null }
    | undefined;
  const name = readFiberTypeName(fiber?.type);
  if (name) return name;
  return readFiberTypeName(fiber?.return?.type);
}

/** Capture an element into a redacted schema-v1 capture. */
export function captureElement(element: Element): ElementCapture {
  const attributes = sanitizeAttributeMap(readAttributes(element));
  const text = redactTextValue(
    (element.textContent ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_SNAPSHOT_TEXT)
  );

  return {
    tagName: element.tagName.toLowerCase(),
    selectorCandidates: collectSelectorCandidates(element),
    componentCandidates: collectComponentCandidates(element),
    sourceCandidates: [],
    snapshot: {
      text,
      attributes,
      childCount: element.children.length,
    },
  };
}

/** True when the element belongs to the Studio overlay itself. */
export function isStudioElement(element: Element | null): boolean {
  if (!element) return false;
  if (element.id === "portal-studio-root") return true;
  // The data attribute lives inside the shadow tree, so `closest` works from
  // within; the id check covers the shadow host itself.
  return element.closest("#portal-studio-root, [data-portal-studio-root]") !== null;
}

/**
 * Build the hover target stack: deepest element + ancestors, bounded.
 * Elements owned by the Studio overlay are excluded.
 */
export function collectTargetStack(
  element: Element,
  maxDepth: number = 4
): Element[] {
  const stack: Element[] = [];
  let current: Element | null = element;
  for (let depth = 0; current && depth < maxDepth; depth += 1) {
    if (isStudioElement(current)) break;
    stack.push(current);
    current = current.parentElement;
  }
  return stack;
}
