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

/**
 * Resolve EVERY live DOM target of an annotation (Goal 03): multi
 * annotations return one element per captured member that still resolves;
 * region annotations return []. Used for the temporary multi-target
 * highlight when a marker's editor is opened.
 */
export function resolveAnnotationTargets(
  annotation: Annotation
): Element[] {
  if (annotation.kind === "region") return [];
  const targets: Element[] = [];
  for (const element of annotation.elements) {
    const target = resolveElementTarget(element);
    if (target) targets.push(target);
  }
  return targets;
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

// ---------------------------------------------------------------------------
// Goal 03: marker-local editor geometry (pure, testable)
// ---------------------------------------------------------------------------

/** Default editor size estimate used by the viewport-safe positioning. */
export const MARKER_EDITOR_WIDTH = 264;
/** Estimate includes the error/delete-confirm rows (taller than base). */
export const MARKER_EDITOR_HEIGHT = 232;
export const MARKER_EDITOR_GAP = 8;

export type MarkerEditorPosition = { left: number; top: number };

/**
 * Viewport-safe editor anchor relative to a marker rect: prefers the
 * bottom-right corner (below the marker, right-aligned), flips ABOVE the
 * marker when there is no room below, and clamps inside the viewport on
 * every edge (right/bottom/top/left). Pure math — unit-testable.
 */
export function resolveMarkerEditorPosition(
  markerRect: {
    left: number;
    top: number;
    width: number;
    height: number;
  },
  viewport: { width: number; height: number },
  editor: { width: number; height: number } = {
    width: MARKER_EDITOR_WIDTH,
    height: MARKER_EDITOR_HEIGHT,
  },
  gap: number = MARKER_EDITOR_GAP
): MarkerEditorPosition {
  // Right-align the editor with the marker's right edge (preferred).
  let left = markerRect.left + markerRect.width - editor.width;
  if (left < 0) left = 0;
  if (left + editor.width > viewport.width) {
    left = Math.max(0, viewport.width - editor.width);
  }
  // Prefer below the marker; flip above when there is no room below.
  const below = markerRect.top + markerRect.height + gap;
  const above = markerRect.top - gap - editor.height;
  let top = below + editor.height <= viewport.height ? below : above;
  if (top < 0) top = 0;
  if (top + editor.height > viewport.height) {
    top = Math.max(0, viewport.height - editor.height);
  }
  return { left: Math.round(left), top: Math.round(top) };
}
