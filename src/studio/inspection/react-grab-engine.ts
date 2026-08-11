/**
 * Portal Studio — sole React Grab engine (the ONLY active source file that
 * imports the upstream public primitives module; shared contract §4).
 *
 * Responsibilities:
 * - hit testing with the repository target filter (grabbable, connected,
 *   outside Studio/root elements, `data-react-grab-ignore` honored);
 * - the user-approved deterministic nested-SVG target promotion (shared
 *   contract §3a), moved verbatim from the Goal 01 test-only proof;
 * - bounds, v6 normalization (via `normalize.ts`) and typed errors;
 * - freeze/unfreeze passthrough.
 *
 * There is exactly one implementation. No alternate adapter, engine registry,
 * private import, package patch, alternate source-lookup package, default
 * UI, custom Fiber or source resolver exists in this domain.
 */

import {
  freeze,
  getElementAtPoint,
  getElementBounds,
  getElementContext,
  getElementSelector,
  getElementsAtPoint,
  isElementGrabbable,
  isFreezeActive,
  unfreeze,
} from "react-grab/primitives";

import { composedParent } from "./hierarchy";
import { normalizeInspectedElement } from "./normalize";
import { InspectionError } from "./types";
import type {
  InspectionEngine,
  PromotionReason,
  PromotionResult,
  ViewportRect,
} from "./types";

const STUDIO_HOST_SELECTOR = "#portal-studio-root, [data-portal-studio-root]";
const ROOT_TAG_NAMES = new Set(["html", "body"]);
const IGNORED_SUBTREE_SELECTOR = "[data-react-grab-ignore]";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const SVG_GEOMETRY_TAGS = new Set([
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
]);

/** Interactive controls the promotion walk may land on (§3a step 4). */
const INTERACTIVE_CONTROL_SELECTOR = [
  "button",
  "a[href]",
  "input:not([type='hidden'])",
  "select",
  "textarea",
  "summary",
  "iframe",
  "audio[controls]",
  "video[controls]",
  "embed",
  "object",
  "[role='button']",
  "[role='link']",
  "[role='tab']",
  "[role='menuitem']",
  "[role='menuitemcheckbox']",
  "[role='menuitemradio']",
  "[contenteditable]:not([contenteditable='false'])",
].join(",");

/** True when the element belongs to the Studio overlay itself. */
export function isStudioElement(element: Element | null): boolean {
  if (!element) return false;
  if (element.id === "portal-studio-root") return true;
  return element.closest(STUDIO_HOST_SELECTOR) !== null;
}

/**
 * Ensure the Studio host carries `data-react-grab-ignore` (shared contract
 * §9) so upstream hit testing skips the Studio subtree. Idempotent.
 */
export function ensureStudioHostIgnored(): void {
  const host = document.querySelector(STUDIO_HOST_SELECTOR);
  if (host && !host.hasAttribute("data-react-grab-ignore")) {
    host.setAttribute("data-react-grab-ignore", "");
  }
}

/** Pure SVG geometry shape (no interactive semantics of its own). */
export function isSvgGeometry(element: Element): boolean {
  return (
    element.namespaceURI === SVG_NAMESPACE &&
    SVG_GEOMETRY_TAGS.has(element.tagName.toLowerCase())
  );
}

/** Ordinary HTML/ARIA interactive control vocabulary (§3a step 4). */
export function isInteractiveControl(element: Element): boolean {
  return element.matches(INTERACTIVE_CONTROL_SELECTOR);
}

/**
 * The repository target filter: grabbable, connected, outside the Studio
 * host/subtree and `data-react-grab-ignore` subtrees, never `html`/`body`.
 */
export function isInspectionCandidate(element: Element): boolean {
  if (!element.isConnected) return false;
  if (ROOT_TAG_NAMES.has(element.tagName.toLowerCase())) return false;
  if (isStudioElement(element)) return false;
  if (element.closest(IGNORED_SUBTREE_SELECTOR) !== null) return false;
  return isElementGrabbable(element);
}

const hitStack = (x: number, y: number): Element[] =>
  getElementsAtPoint(x, y, { filter: isInspectionCandidate });

const rawHit = (x: number, y: number): Element | null =>
  getElementAtPoint(x, y, { filter: isInspectionCandidate });

/**
 * User-approved deterministic nested-SVG target promotion (shared contract
 * §3a). Returns the useful target, the raw public selection, the grabbable
 * public stack, and the promotion flags. Bounded: the walk only ever
 * considers composed ancestors already present in the public stack, and
 * stops at the first non-ancestor — it can never jump to an unrelated
 * element or take the first arbitrary stack item.
 */
export function resolveUsefulTarget(
  x: number,
  y: number
): PromotionResult {
  const stack = hitStack(x, y);
  const hit = rawHit(x, y);
  if (!hit) {
    return { target: null, promoted: false, reason: "no-target", stack, hit };
  }
  if (!isSvgGeometry(hit) || isInteractiveControl(hit)) {
    return { target: hit, promoted: false, reason: "direct", stack, hit };
  }
  const startIndex = stack.indexOf(hit);
  if (startIndex === -1) {
    return { target: hit, promoted: false, reason: "direct", stack, hit };
  }
  let current: Element = hit;
  for (let index = startIndex + 1; index < stack.length; index += 1) {
    const candidate = stack[index];
    if (composedParent(current) !== candidate) break;
    if (isInteractiveControl(candidate) && isInspectionCandidate(candidate)) {
      return {
        target: candidate,
        promoted: true,
        reason: "svg-geometry-promotion",
        stack,
        hit,
      };
    }
    current = candidate;
  }
  return {
    target: hit,
    promoted: false,
    reason: "svg-geometry-promotion",
    stack,
    hit,
  };
}

const toViewportRect = (bounds: {
  x: number;
  y: number;
  width: number;
  height: number;
}): ViewportRect => ({
  x: bounds.x,
  y: bounds.y,
  width: bounds.width,
  height: bounds.height,
});

/**
 * Realm-agnostic element check: an element from a same-origin iframe
 * document is not an `instanceof` the parent realm's `Element`.
 */
const isElementLike = (value: unknown): value is Element =>
  !!value &&
  typeof value === "object" &&
  (value as { nodeType?: unknown }).nodeType === 1;

/** Create the inspection engine (one implementation; singleton below). */
export function createInspectionEngine(): InspectionEngine {
  ensureStudioHostIgnored();
  return {
    getTargetAtPoint: (clientX, clientY) =>
      resolveUsefulTarget(clientX, clientY).target,
    getTargetsAtPoint: (clientX, clientY) => hitStack(clientX, clientY),
    getBounds: (element) => {
      try {
        return toViewportRect(getElementBounds(element));
      } catch (cause) {
        throw new InspectionError(
          "upstream_error",
          "React Grab bounds lookup failed",
          cause
        );
      }
    },
    inspect: async (element) => {
      if (!isElementLike(element)) {
        throw new InspectionError(
          "not_an_element",
          "inspect requires a DOM Element"
        );
      }
      let context: Awaited<ReturnType<typeof getElementContext>>;
      let selector: string | null;
      let bounds: ReturnType<typeof getElementBounds>;
      try {
        [context, selector, bounds] = await Promise.all([
          getElementContext(element),
          Promise.resolve().then(() => getElementSelector(element)),
          Promise.resolve().then(() => getElementBounds(element)),
        ]);
      } catch (cause) {
        // Only upstream calls run inside this try; normalization failures
        // (typed InspectionError) propagate from outside the try below.
        throw new InspectionError(
          "upstream_error",
          "React Grab inspection failed",
          cause
        );
      }
      return normalizeInspectedElement(
        element,
        {
          htmlPreview: context.htmlPreview,
          stack: context.stack,
          componentName: context.componentName,
          filePath: context.filePath,
          lineNumber: context.lineNumber,
          columnNumber: context.columnNumber,
          selector,
          styles: context.styles,
        },
        toViewportRect(bounds)
      );
    },
    freeze: (elements) => {
      try {
        freeze(elements);
      } catch (cause) {
        throw new InspectionError(
          "upstream_error",
          "React Grab freeze failed",
          cause
        );
      }
    },
    unfreeze: () => {
      try {
        unfreeze();
      } catch (cause) {
        throw new InspectionError(
          "upstream_error",
          "React Grab unfreeze failed",
          cause
        );
      }
    },
    isFrozen: () => isFreezeActive(),
  };
}

/** Canonical singleton; production and tests share this one instance. */
export const inspectionEngine: InspectionEngine = createInspectionEngine();

export type { PromotionReason, PromotionResult };
