/**
 * Portal Studio — bounded region target sampling (Goal 03/04 Area cutover).
 *
 * Replaces the old full-DOM `document.body.querySelectorAll("*")`
 * collector with React Grab point-stack sampling across the marquee
 * region. Goal 04 formalizes the collector:
 *
 * - deterministic sample points for the same rectangle/viewport:
 *   `columns = clamp(ceil(width / 120), 2, 8)`,
 *   `rows = clamp(ceil(height / 120), 2, 8)`;
 *   each cell center, plus the rectangle center and four inset corners;
 *   rounded coordinates are deduplicated; maximum 69 points;
 * - target cap remains 50 and inspection concurrency remains exactly 4;
 * - there is NO full-DOM scan path.
 *
 * Target scoring (documented priority order):
 *   1. `data-ai-page-element` and meaningful `data-nb-*` business markers;
 *   2. interactive/ARIA elements;
 *   3. user-owned source component frame — the deterministic live proxy is
 *      a stable identity (`id`), the same signal the v6 capture persists
 *      as a strong identity fingerprint;
 *   4. meaningful text / accessibility name (textContent, aria-label,
 *      alt, title);
 *   5. specificity: smaller semantic target over layout-only ancestor
 *      (smaller bounding area, then deeper composed DOM).
 *
 * Pruning: exact duplicates are removed (live identity); ancestors that
 * add no unique business/text context are removed; distinct sibling
 * cards/cells are kept; selection order is preserved deterministically.
 */

import { inspectionEngine, isInteractiveControl } from "./react-grab-engine";
import type { Region } from "../types";

export const MAX_REGION_SAMPLE_POINTS = 69;
export const MAX_REGION_TARGETS = 50;
export const REGION_GRID_DIVISOR = 120;
export const REGION_GRID_MIN = 2;
export const REGION_GRID_MAX = 8;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const normalizedText = (element: Element): string =>
  (element.textContent ?? "").replace(/\s+/g, " ").trim();

const hasBusinessAttribute = (element: Element): boolean => {
  if (element.hasAttribute("data-ai-page-element")) return true;
  for (const attribute of Array.from(element.attributes)) {
    if (attribute.name.startsWith("data-nb-") && attribute.value.trim()) {
      return true;
    }
  }
  return false;
};

const hasAccessibleName = (element: Element): boolean =>
  ["aria-label", "aria-labelledby", "alt", "title"].some((name) => {
    const value = element.getAttribute(name);
    return !!value && value.trim().length > 0;
  });

/** Deterministic live-element signals in the documented priority order. */
export type RegionTargetSignal = {
  /** data-ai-page-element / meaningful data-nb-* */
  business: boolean;
  /** interactive control or explicit ARIA role/attributes */
  interactive: boolean;
  /** stable id (source-adjacent identity the v6 capture persists) */
  identity: boolean;
  /** meaningful text or accessibility name */
  content: boolean;
};

export function targetSignal(element: Element): RegionTargetSignal {
  const interactive =
    isInteractiveControl(element) ||
    element.hasAttribute("role") ||
    element.hasAttribute("aria-label") ||
    element.hasAttribute("aria-labelledby");
  return {
    business: hasBusinessAttribute(element),
    interactive,
    identity: !!element.id,
    content: normalizedText(element).length > 0 || hasAccessibleName(element),
  };
}

const signalArray = (signal: RegionTargetSignal): number[] => [
  signal.business ? 1 : 0,
  signal.interactive ? 1 : 0,
  signal.identity ? 1 : 0,
  signal.content ? 1 : 0,
];

const areaOf = (element: Element): number => {
  const rect = element.getBoundingClientRect();
  return rect.width * rect.height;
};

const composedDepth = (element: Element): number => {
  let depth = 0;
  for (let current: Element | null = element; current; current = composedParentOf(current)) {
    depth += 1;
  }
  return depth;
};

const composedParentOf = (element: Element): Element | null => {
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
};

/**
 * Deterministic preference between two ancestor/descendant targets:
 * lexicographic over the documented signal tiers, then smaller area, then
 * deeper composed DOM, then stable (first-seen) order.
 */
export function preferRegionTarget(a: Element, b: Element): Element {
  const signalsA = signalArray(targetSignal(a));
  const signalsB = signalArray(targetSignal(b));
  for (let index = 0; index < signalsA.length; index += 1) {
    if (signalsA[index] !== signalsB[index]) {
      return signalsA[index] > signalsB[index] ? a : b;
    }
  }
  const areaA = areaOf(a);
  const areaB = areaOf(b);
  if (areaA !== areaB) return areaA < areaB ? a : b;
  const depthA = composedDepth(a);
  const depthB = composedDepth(b);
  if (depthA !== depthB) return depthA > depthB ? a : b;
  return a;
}

/**
 * Weighted integer score (kept for diagnostics and back-compat; the prune
 * uses `preferRegionTarget`'s tiered comparison). Business +6, interactive
 * +3, content +2, id +1.
 */
export function semanticTargetScore(element: Element): number {
  const signal = targetSignal(element);
  return (
    (signal.business ? 6 : 0) +
    (signal.interactive ? 3 : 0) +
    (signal.content ? 2 : 0) +
    (signal.identity ? 1 : 0)
  );
}

const isComposedAncestorOf = (ancestor: Element, descendant: Element): boolean => {
  let current: Element | null = composedParentOf(descendant);
  while (current) {
    if (current === ancestor) return true;
    current = composedParentOf(current);
  }
  return false;
};

/** True when the ancestor carries business/text context the descendant lacks. */
const hasUniqueContext = (ancestor: Element, descendant: Element): boolean => {
  if (hasBusinessAttribute(ancestor) && !hasBusinessAttribute(descendant)) {
    return true;
  }
  const ancestorText = normalizedText(ancestor);
  const descendantText = normalizedText(descendant);
  return ancestorText.length > 0 && ancestorText !== descendantText;
};

/**
 * Prune sampled targets (Goal 04, deterministic):
 * - exact duplicates are already removed by live identity at sampling;
 * - an ancestor/descendant pair keeps the PREFERRED element (tiered
 *   signals, then specificity);
 * - an ancestor that adds no unique business/text context is removed when
 *   the descendant is preferred;
 * - an ancestor WITH unique business/text context is kept alongside the
 *   preferred descendant (the context is not lost);
 * - distinct sibling cards/cells are never merged;
 * - first-seen order is preserved.
 */
export function pruneRegionTargets(targets: Element[]): Element[] {
  const kept: Element[] = [];
  for (const target of targets) {
    const ancestorIndex = kept.findIndex((other) =>
      isComposedAncestorOf(other, target)
    );
    if (ancestorIndex >= 0) {
      const ancestor = kept[ancestorIndex];
      const preferred = preferRegionTarget(target, ancestor);
      if (preferred === target) {
        if (hasUniqueContext(ancestor, target)) {
          kept.push(target); // ancestor context is unique: keep both
        } else {
          kept.splice(ancestorIndex, 1); // context-free ancestor removed
          kept.push(target);
        }
      }
      continue;
    }
    const descendantIndex = kept.findIndex((other) =>
      isComposedAncestorOf(target, other)
    );
    if (descendantIndex >= 0) {
      const descendant = kept[descendantIndex];
      const preferred = preferRegionTarget(target, descendant);
      if (preferred === target) {
        kept.splice(descendantIndex, 1); // preferred ancestor replaces it
        kept.push(target);
      } else if (hasUniqueContext(target, descendant)) {
        kept.push(target); // ancestor context is unique: keep both
      }
      continue;
    }
    kept.push(target);
  }
  // Final deterministic pass: multi-level chains can arrive in any point
  // order; remove any kept ancestor that adds no unique business/text
  // context relative to a kept descendant (fixpoint, bounded by the cap).
  let changed = true;
  while (changed) {
    changed = false;
    for (let index = 0; index < kept.length; index += 1) {
      const candidate = kept[index];
      const descendant = kept.find(
        (other) =>
          other !== candidate && isComposedAncestorOf(candidate, other)
      );
      if (descendant && !hasUniqueContext(candidate, descendant)) {
        kept.splice(index, 1);
        changed = true;
        break;
      }
    }
  }
  return kept;
}

/** Viewport-space sampling points: inset corners, center, cell centers. */
export function sampleRegionPoints(rect: {
  x: number;
  y: number;
  width: number;
  height: number;
}): Array<{ x: number; y: number }> {
  const left = rect.x;
  const top = rect.y;
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  const centerX = left + rect.width / 2;
  const centerY = top + rect.height / 2;
  const inset = Math.min(
    4,
    Math.max(1, Math.floor(Math.min(rect.width, rect.height) / 8))
  );
  // Inset corners, clamped inside the rectangle (tiny regions).
  const corner = (x: number, y: number) => ({
    x: Math.min(Math.max(x, left), Math.max(left, right - 1)),
    y: Math.min(Math.max(y, top), Math.max(top, bottom - 1)),
  });
  const points: Array<{ x: number; y: number }> = [
    corner(left + inset, top + inset),
    corner(right - inset, top + inset),
    corner(left + inset, bottom - inset),
    corner(right - inset, bottom - inset),
    { x: centerX, y: centerY },
  ];
  if (rect.width >= 2 && rect.height >= 2) {
    const columns = clamp(
      Math.ceil(rect.width / REGION_GRID_DIVISOR),
      REGION_GRID_MIN,
      REGION_GRID_MAX
    );
    const rows = clamp(
      Math.ceil(rect.height / REGION_GRID_DIVISOR),
      REGION_GRID_MIN,
      REGION_GRID_MAX
    );
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        points.push({
          x: left + ((column + 0.5) * rect.width) / columns,
          y: top + ((row + 0.5) * rect.height) / rows,
        });
      }
    }
  }
  // Deduplicate rounded coordinates; bounded at 69 points.
  const seen = new Set<string>();
  const unique: Array<{ x: number; y: number }> = [];
  for (const point of points) {
    const key = `${Math.round(point.x)},${Math.round(point.y)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(point);
    if (unique.length >= MAX_REGION_SAMPLE_POINTS) break;
  }
  return unique;
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

export type { Region };
