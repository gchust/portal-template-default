/**
 * Portal Studio — element capture (client side, schema v2).
 *
 * Builds schema-v2 captures for picked DOM elements: selector candidates,
 * explainable component candidates (React Grab, kind: "fiber"), bounded DOM
 * outline, curated computed-style excerpts, business context items
 * (data-ai-page-element / data-nb-*), and redacted minimal snapshots. Source
 * candidates are resolved by the dev server (module graph) at write time.
 */

import { collectComponentChain, readFiberTypeName } from "./grab";
import { redactTextValue, sanitizeAttributeMap } from "./redact";
import type {
  BusinessContextItem,
  ElementCapture,
  ElementSnapshot,
  SelectorCandidate,
} from "./types";

const PAGE_ELEMENT_ATTRIBUTE = "data-ai-page-element";
const NB_ATTRIBUTE_PREFIX = "data-nb-";

const MAX_SNAPSHOT_TEXT = 500;
const MAX_SELECTOR_DEPTH = 3;
const MAX_ATTRIBUTES = 20;
const MAX_ATTRIBUTE_LENGTH = 200;
const MAX_OUTLINE_LENGTH = 160;
const MAX_BUSINESS_CONTEXT_ITEMS = 20;
const MAX_CONTEXT_ANCESTORS = 3;

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

/** Curated computed-style properties (bounded, no full style dumps). */
const COMPUTED_STYLE_PROPERTIES = [
  "display",
  "position",
  "visibility",
  "opacity",
  "boxSizing",
  "width",
  "height",
  "minWidth",
  "minHeight",
  "overflow",
  "color",
  "backgroundColor",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "lineHeight",
  "textAlign",
  "whiteSpace",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  "borderTopWidth",
  "borderRadius",
  "flexDirection",
] as const;

export const MAX_COMPUTED_STYLE_PROPERTIES = 30;
export const MAX_COMPUTED_STYLE_VALUE_LENGTH = 200;

const escapeCss = (value: string) =>
  typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(value)
    : value;

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
            ? // The first class is CSS-escaped: classes such as Tailwind's
              // "group/button" contain selector-special characters that
              // otherwise produce an INVALID selector and make the marker
              // unresolvable (acceptance-found, D-044).
              `.${escapeCss(String(current.className).trim().split(/\s+/)[0])}`
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

/** Bounded DOM outline: tag#id.first-class[role=…] etc. */
export function collectDomOutline(element: Element): string {
  const parts: string[] = [element.tagName.toLowerCase()];
  const id = element.getAttribute("id");
  if (id) parts.push(`#${id}`);
  const className = element.getAttribute("class");
  if (className) {
    parts.push(`.${className.trim().split(/\s+/).slice(0, 3).join(".")}`);
  }
  for (const attribute of ["role", "type", "aria-label"]) {
    const value = element.getAttribute(attribute);
    if (value) parts.push(`[${attribute}=${JSON.stringify(value)}]`);
  }
  const outline = parts.join("");
  return outline.length > MAX_OUTLINE_LENGTH
    ? `${outline.slice(0, MAX_OUTLINE_LENGTH)}…[truncated]`
    : outline;
}

/** Curated computed-style excerpt, redacted and bounded. */
export function collectComputedStyleExcerpt(
  element: Element,
  maxProperties: number = MAX_COMPUTED_STYLE_PROPERTIES
): Record<string, string> {
  const style = element instanceof HTMLElement
    ? getComputedStyle(element)
    : undefined;
  if (!style) return {};
  const excerpt: Record<string, string> = {};
  for (const property of COMPUTED_STYLE_PROPERTIES) {
    if (Object.keys(excerpt).length >= maxProperties) break;
    const value = style.getPropertyValue(property).trim();
    if (!value) continue;
    excerpt[property] = redactTextValue(
      value.slice(0, MAX_COMPUTED_STYLE_VALUE_LENGTH)
    );
  }
  return excerpt;
}

/** Business context from data-ai-page-element and data-nb-* attributes. */
export function collectBusinessContext(element: Element): BusinessContextItem[] {
  const items: BusinessContextItem[] = [];
  const seen = new Set<string>();
  const walk: Array<Element | null> = [element];
  let current: Element | null = element;
  for (let depth = 0; current && depth < MAX_CONTEXT_ANCESTORS; depth += 1) {
    walk.push(current);
    current = current.parentElement;
  }
  for (const candidate of walk) {
    if (!candidate) continue;
    const pageElementId = candidate.getAttribute(PAGE_ELEMENT_ATTRIBUTE);
    if (pageElementId) {
      const key = `page-element:${pageElementId}`;
      if (!seen.has(key)) {
        seen.add(key);
        items.push({
          type: "page-element",
          id: pageElementId,
          source: PAGE_ELEMENT_ATTRIBUTE,
        });
      }
    }
    for (const attribute of Array.from(candidate.attributes)) {
      if (!attribute.name.startsWith(NB_ATTRIBUTE_PREFIX)) continue;
      const key = `${attribute.name}:${attribute.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        type: "data-attribute",
        id: attribute.value,
        source: attribute.name,
      });
      if (items.length >= MAX_BUSINESS_CONTEXT_ITEMS) return items;
    }
  }
  return items.slice(0, MAX_BUSINESS_CONTEXT_ITEMS);
}

/** Capture an element into a redacted schema-v2 capture. */
export function captureElement(
  element: Element,
  options: { includeStyles?: boolean } = {}
): ElementCapture {
  const attributes = sanitizeAttributeMap(readAttributes(element));
  const text = redactTextValue(
    (element.textContent ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_SNAPSHOT_TEXT)
  );
  const snapshot: ElementSnapshot = {
    text,
    attributes,
    childCount: element.children.length,
    domOutline: redactTextValue(collectDomOutline(element), {
      string: MAX_OUTLINE_LENGTH,
    }),
  };
  if (options.includeStyles !== false) {
    snapshot.computedStyle = collectComputedStyleExcerpt(element);
  }

  return {
    tagName: element.tagName.toLowerCase(),
    selectorCandidates: collectSelectorCandidates(element),
    componentCandidates: collectComponentCandidates(element),
    sourceCandidates: [],
    snapshot,
  };
}

/**
 * Capture a full selection (multi / region) into schema-v2 pieces. Elements
 * are captured in order; business context is deduped across the selection and
 * bounded; a region (viewport rect) is carried through.
 */
export function captureSelection(
  elements: Element[]
): {
  elements: ElementCapture[];
  businessContext: BusinessContextItem[];
} {
  const captures = elements.map((element) => captureElement(element));
  const seen = new Set<string>();
  const businessContext: BusinessContextItem[] = [];
  for (const element of elements) {
    for (const item of collectBusinessContext(element)) {
      const key = `${item.type}:${item.id ?? ""}:${item.source}`;
      if (seen.has(key)) continue;
      seen.add(key);
      businessContext.push(item);
      if (businessContext.length >= MAX_BUSINESS_CONTEXT_ITEMS) break;
    }
    if (businessContext.length >= MAX_BUSINESS_CONTEXT_ITEMS) break;
  }
  return { elements: captures, businessContext };
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
