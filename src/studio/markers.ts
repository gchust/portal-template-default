/**
 * Portal Studio — marker target resolution (client side).
 *
 * Goal 03 (React Grab migration): numbered markers persist across
 * reload/routes and FOLLOW their targets — each v6 element capture carries
 * ONE React Grab selector; on render and on route/scroll/resize the
 * selector resolves through the strict Goal 02 locator and the captured
 * fingerprint is validated exactly. Unresolved targets are RETAINED (the
 * list entry stays, marked unresolved; no page anchor is drawn). Region
 * annotations are document-relative rects and always render.
 *
 * Mounting rule (D-034 #3): the marker overlay renders INSIDE the Studio
 * shadow host, so markers can never pollute evidence screenshots (shadow
 * content is not part of the screenshot DOM clone) and can never be
 * annotated by Studio itself (isStudioElement covers the host).
 */

import { resolveAnchoredPlacement } from "./placement";
import { resolveSelector } from "./inspection";
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

/**
 * Resolve the ONE persisted React Grab selector through the Goal 02 locator
 * and validate the captured fingerprint exactly (shared contract §6). Any
 * missing/ambiguous/boundary/fingerprint-mismatch result is unresolved —
 * the first vague match is NEVER chosen, and no alternate selector is ever
 * generated.
 */
export function resolveElementTarget(
  element: ElementCapture
): Element | null {
  if (!element.selector) return null;
  const result = resolveSelector(element.selector, element.fingerprint);
  return result.status === "resolved" ? result.element : null;
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
  // Goal 03 E: the marker editor uses the SAME viewport-aware anchored
  // placement path as every other surface (tooltips, Help, List,
  // composer, Copy surface) — resolveAnchoredPlacement owns the
  // right-align/flip/clamp math. The trigger is built so the preferred
  // placement is right-aligned with the marker's right edge and below it.
  const placement = resolveAnchoredPlacement({
    trigger: {
      left: markerRect.left + markerRect.width - editor.width,
      top: markerRect.top,
      right: markerRect.left + markerRect.width,
      bottom: markerRect.top + markerRect.height,
      width: markerRect.width,
      height: markerRect.height,
    },
    viewport,
    width: editor.width,
    maxHeight: editor.height,
    gap,
    preferredSide: "below",
    surfaceHeight: editor.height,
  });
  return { left: placement.left, top: placement.top };
}

// ---------------------------------------------------------------------------
// Goal 05 follow-up (manual-test finding): marker collision resolution.
// Two annotations can legitimately resolve to targets whose anchors overlap
// (adjacent small cells). The markers must never cover each other: the
// later marker is nudged along a diagonal until its footprint is free,
// while the FIRST annotation keeps its exact anchor.
// ---------------------------------------------------------------------------

/** Marker footprint (the ≈30px hit box, incl. the ::before extension). */
export const MARKER_FOOTPRINT = 30;

export type MarkerAnchorInput = {
  annotationId: string;
  left: number;
  top: number;
};

export type MarkerAnchorOutput = {
  left: number;
  top: number;
};

const footprintIntersects = (
  a: { left: number; top: number },
  b: { left: number; top: number }
): boolean =>
  !(
    a.left + MARKER_FOOTPRINT <= b.left ||
    b.left + MARKER_FOOTPRINT <= a.left ||
    a.top + MARKER_FOOTPRINT <= b.top ||
    b.top + MARKER_FOOTPRINT <= a.top
  );

/**
 * Resolve a list of marker anchors so that no two footprints intersect.
 * Anchors are processed in annotation order (the earlier annotation keeps
 * its exact position); a colliding marker is nudged one footprint along a
 * down-right diagonal until free (bounded — after MAX_MARKER_STEPS it
 * stops, keeping the anchor on-screen rather than pushing it off).
 */
export function resolveMarkerCollisions(
  anchors: MarkerAnchorInput[]
): Map<string, MarkerAnchorOutput> {
  const placed: Array<{ left: number; top: number }> = [];
  const result = new Map<string, MarkerAnchorOutput>();
  const MAX_MARKER_STEPS = 6;
  for (const anchor of anchors) {
    let step = 0;
    let left = anchor.left;
    let top = anchor.top;
    while (
      step < MAX_MARKER_STEPS &&
      placed.some((existing) =>
        footprintIntersects(existing, { left, top })
      )
    ) {
      step += 1;
      left = anchor.left + step * MARKER_FOOTPRINT;
      top = anchor.top + step * MARKER_FOOTPRINT;
    }
    placed.push({ left, top });
    result.set(anchor.annotationId, { left, top });
  }
  return result;
}
