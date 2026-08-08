/**
 * Portal Studio — marker target resolution (client side).
 *
 * Goal 02 (D-033 #8/#9): numbered markers persist across reload/routes and
 * FOLLOW their targets — each element capture carries selector candidates
 * (id / data-ai-page-element / role / bounded path); on render and on
 * route/scroll/resize the first matching candidate re-resolves to the live
 * DOM. Unresolved targets are RETAINED (the list entry stays, marked
 * unresolved; no page anchor is drawn). Region annotations are viewport
 * rects and always render.
 *
 * Mounting rule (D-034 #3): the marker overlay renders INSIDE the Studio
 * shadow host, so markers can never pollute evidence screenshots (shadow
 * content is not part of the screenshot DOM clone) and can never be
 * annotated by Studio itself (isStudioElement covers the host).
 */

import type { Annotation, ElementCapture } from "./types";

/** Resolve the live DOM target of an annotation, or null when unresolved. */
export function resolveAnnotationTarget(
  annotation: Annotation
): Element | null {
  if (annotation.kind === "region") return null;
  for (const element of annotation.elements) {
    const target = resolveElementTarget(element);
    if (target) return target;
  }
  return null;
}

/** First selector candidate that matches something in the live document. */
export function resolveElementTarget(
  element: ElementCapture
): Element | null {
  for (const candidate of element.selectorCandidates) {
    try {
      const found = document.querySelector(candidate.selector);
      if (found) return found;
    } catch {
      // Invalid selector: try the next candidate.
    }
  }
  return null;
}

/** True when the annotation has no resolvable page target. */
export function isAnnotationUnresolved(annotation: Annotation): boolean {
  if (annotation.kind === "region") return false;
  return resolveAnnotationTarget(annotation) === null;
}
