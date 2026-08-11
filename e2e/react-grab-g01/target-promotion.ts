/**
 * Goal 01 — deterministic semantic target promotion (G01-AC06).
 *
 * User-authorized contract amendment: a nested SVG geometry hit returned by
 * `getElementAtPoint()` is no longer by itself a promotion blocker when the
 * same public primitives provide a deterministic useful target through
 * `getElementsAtPoint()`.
 *
 * This module is TEST-ONLY. It consumes exclusively the public
 * `react-grab/primitives` surface (via `./primitives`) plus ordinary DOM
 * semantics. It is the exact rule Goal 02 must later implement inside the
 * sole production adapter.
 *
 * Rule (bounded and deterministic):
 * 1. Ask the public primitives for the grabbable hit stack at the point:
 *    `getElementsAtPoint()` returns every grabbable element in paint order,
 *    topmost first, crossing open shadow roots and same-origin iframes.
 * 2. The raw selection is `getElementAtPoint()` (the first grabbable entry).
 * 3. If the raw hit is not an SVG geometry shape, it is already the useful
 *    target (plain buttons, overlay resolution, Shadow DOM and iframe hits
 *    stay exactly as the primitive reports them).
 * 4. If the raw hit IS an SVG geometry shape (`path`, `rect`, `circle`,
 *    `ellipse`, `line`, `polyline`, `polygon`) and is not itself an
 *    interactive control, walk the public stack outward and promote to the
 *    FIRST entry that (a) is the composed DOM parent of the previous entry,
 *    (b) is an interactive control, and (c) passes `isElementGrabbable()`.
 *    The composed-parent guard makes the walk stop at the first non-ancestor,
 *    so the rule can never jump to an unrelated element.
 * 5. If no interactive control ancestor exists, the raw hit is kept — a
 *    standalone decorative SVG shape stays selected instead of jumping to an
 *    unrelated ancestor.
 *
 * The rule never searches the page, never persists candidates, never falls
 * back to another selector, and never touches private React Grab paths.
 */

import type { reactGrabPrimitives } from "./primitives";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/** Pure vector geometry that carries no interactive semantics of its own. */
const SVG_GEOMETRY_TAGS = new Set([
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
]);

/**
 * Interactive controls the promotion walk may land on. This is the ordinary
 * HTML/ARIA interactive element vocabulary; a plain `section`/`main`/`div`
 * ancestor never matches.
 */
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

export type PromotionReason =
  | "no-target"
  | "direct"
  | "svg-geometry-promotion";

export type PromotionResult = {
  /** The resolved useful target, or null when nothing is grabbable. */
  target: Element | null;
  /** True only when an SVG geometry hit was promoted to an ancestor control. */
  promoted: boolean;
  reason: PromotionReason;
  /** Raw public-primitive stack (grabbable elements, topmost first). */
  stack: Element[];
  /** Raw public-primitive selection at the point. */
  hit: Element | null;
};

export const isSvgGeometry = (element: Element): boolean =>
  element.namespaceURI === SVG_NAMESPACE &&
  SVG_GEOMETRY_TAGS.has(element.tagName.toLowerCase());

export const isInteractiveControl = (element: Element): boolean =>
  element.matches(INTERACTIVE_CONTROL_SELECTOR);

/** Ordinary composed-parent relationship (light DOM parent or shadow host). */
export const composedParent = (element: Element): Element | null => {
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
};

export const resolveUsefulTarget = (
  x: number,
  y: number,
  primitives: typeof reactGrabPrimitives
): PromotionResult => {
  const stack = primitives.getElementsAtPoint(x, y);
  const hit = primitives.getElementAtPoint(x, y);
  if (!hit) {
    return { target: null, promoted: false, reason: "no-target", stack, hit };
  }
  if (!isSvgGeometry(hit) || isInteractiveControl(hit)) {
    return { target: hit, promoted: false, reason: "direct", stack, hit };
  }
  const startIndex = stack.indexOf(hit);
  if (startIndex === -1) {
    // The primitive stack does not contain the raw hit: keep it untouched.
    return { target: hit, promoted: false, reason: "direct", stack, hit };
  }
  let current: Element = hit;
  for (let index = startIndex + 1; index < stack.length; index += 1) {
    const candidate = stack[index];
    if (composedParent(current) !== candidate) break;
    if (
      isInteractiveControl(candidate) &&
      primitives.isElementGrabbable(candidate)
    ) {
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
};
