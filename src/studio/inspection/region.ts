/**
 * Portal Studio — bounded region target sampling (Goal 03 Area cutover).
 *
 * Replaces the old full-DOM `document.body.querySelectorAll("*")`
 * collector with React Grab point-stack sampling across the marquee
 * region: corners, center and a bounded adaptive grid. Sampled targets
 * are deduplicated by live identity, pruned with a documented semantic
 * ancestor/descendant score, and capped at the safe selection limit.
 * There is NO full-DOM scan path.
 *
 * The region itself is preserved as a document-relative v6 `Region`
 * regardless of how many element targets were found.
 */

import { inspectionEngine, isInteractiveControl } from "./react-grab-engine";
import type { Region } from "../types";

export const MAX_REGION_SAMPLE_POINTS = 200;
export const MAX_REGION_TARGETS = 50;
export const REGION_GRID_STRIDE = 48;

/** Viewport-space sampling points: corners, center, bounded grid. */
export function sampleRegionPoints(rect: {
  x: number;
  y: number;
  width: number;
  height: number;
}): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  const left = rect.x;
  const top = rect.y;
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  const centerX = left + rect.width / 2;
  const centerY = top + rect.height / 2;
  // Always include the four corners and the center.
  points.push(
    { x: left, y: top },
    { x: right - 1, y: top },
    { x: left, y: bottom - 1 },
    { x: right - 1, y: bottom - 1 },
    { x: centerX, y: centerY }
  );
  if (rect.width < 2 || rect.height < 2) return points;
  // Bounded adaptive grid: sample every REGION_GRID_STRIDE px, capped.
  const columns = Math.min(
    Math.max(1, Math.ceil(rect.width / REGION_GRID_STRIDE)),
    24
  );
  const rows = Math.min(
    Math.max(1, Math.ceil(rect.height / REGION_GRID_STRIDE)),
    24
  );
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if (points.length >= MAX_REGION_SAMPLE_POINTS) return points;
      points.push({
        x: left + ((column + 0.5) * rect.width) / columns,
        y: top + ((row + 0.5) * rect.height) / rows,
      });
    }
  }
  return points;
}

/**
 * Documented semantic score for ancestor/descendant pruning (Goal 03):
 * NocoBase business elements (+3), interactive controls (+2), and
 * user-defined source components (+1) are preferred; ties keep the
 * deeper (more specific) element.
 */
export function semanticTargetScore(element: Element): number {
  let score = 0;
  if (
    element.hasAttribute("data-ai-page-element") ||
    Array.from(element.attributes).some((attribute) =>
      attribute.name.startsWith("data-nb-")
    )
  ) {
    score += 3;
  }
  if (isInteractiveControl(element)) score += 2;
  if (element.id) score += 1;
  return score;
}

const isComposedAncestorOf = (ancestor: Element, descendant: Element): boolean => {
  let current: Element | null = descendant.parentElement;
  while (current) {
    if (current === ancestor) return true;
    current = current.parentElement;
  }
  const root = descendant.getRootNode();
  if (root instanceof ShadowRoot) {
    let host: Element | null = root.host;
    while (host) {
      if (host === ancestor) return true;
      host = host.parentElement;
    }
  }
  return false;
};

/**
 * Prune sampled targets: when one target is a composed ancestor of
 * another, keep the one with the higher semantic score. Ties keep the
 * descendant (the more specific element). Deterministic and bounded.
 */
export function pruneRegionTargets(targets: Element[]): Element[] {
  const kept: Element[] = [];
  for (const target of targets) {
    // A kept element is a composed ancestor of the new target: keep the
    // descendant unless the ancestor scores STRICTLY higher.
    const ancestorIndex = kept.findIndex((other) =>
      isComposedAncestorOf(other, target)
    );
    if (ancestorIndex >= 0) {
      // The new target is a descendant of a kept ancestor: keep the
      // descendant when it scores at least as high (ties keep the
      // descendant).
      if (
        semanticTargetScore(target) >=
        semanticTargetScore(kept[ancestorIndex])
      ) {
        kept.splice(ancestorIndex, 1);
        kept.push(target);
      }
      continue;
    }
    // The new target is a composed ancestor of a kept element: replace the
    // descendant only when the ancestor scores strictly higher (ties keep
    // the descendant).
    const descendantIndex = kept.findIndex((other) =>
      isComposedAncestorOf(target, other)
    );
    if (descendantIndex >= 0) {
      if (
        semanticTargetScore(target) >
        semanticTargetScore(kept[descendantIndex])
      ) {
        kept.splice(descendantIndex, 1);
        kept.push(target);
      }
      continue;
    }
    kept.push(target);
  }
  return kept;
}

/**
 * Sample the marquee region with the engine's point stack, deduplicate by
 * live identity, prune ancestor/descendant duplicates semantically, and
 * cap at MAX_REGION_TARGETS. Never scans the full DOM.
 */
export function sampleRegionTargets(
  rect: { x: number; y: number; width: number; height: number }
): Element[] {
  const points = sampleRegionPoints(rect);
  const seen = new Set<Element>();
  const targets: Element[] = [];
  for (const point of points) {
    for (const element of inspectionEngine.getTargetsAtPoint(point.x, point.y)) {
      if (seen.has(element)) continue;
      seen.add(element);
      targets.push(element);
      if (targets.length >= MAX_REGION_TARGETS) break;
    }
    if (targets.length >= MAX_REGION_TARGETS) break;
  }
  return pruneRegionTargets(targets).slice(0, MAX_REGION_TARGETS);
}

