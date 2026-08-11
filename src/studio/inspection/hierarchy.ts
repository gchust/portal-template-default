/**
 * Portal Studio — composed hierarchy navigation.
 *
 * Replaces the old generic `collectTargetStack` contract with a helper that
 * starts from a React Grab-selected target and walks composed parents
 * (light-DOM parent or open shadow host). Every returned element must pass
 * the caller-supplied inclusion predicate (the engine injects grabbability
 * plus Studio exclusion). This module NEVER performs hit testing — it is a
 * hierarchy walker only.
 */

/** Ordinary composed-parent relationship (light DOM parent or shadow host). */
export function composedParent(element: Element): Element | null {
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

export type AncestorWalkOptions = {
  /**
   * Inclusion predicate applied to the start element and every ancestor.
   * The engine injects `isInspectionCandidate` (grabbability + Studio/root/
   * disconnected exclusion).
   */
  isIncluded: (element: Element) => boolean;
  /** Bounded walk depth (inclusive of the start element). Default 8. */
  maxDepth?: number;
};

/**
 * Walk the composed ancestor chain of a React Grab-selected target.
 * Returns the start element followed by each included composed ancestor,
 * stopping at the first excluded element or the depth bound. Deterministic
 * and bounded; never falls back to any other perception mechanism.
 */
export function walkComposedAncestors(
  element: Element,
  options: AncestorWalkOptions
): Element[] {
  const maxDepth = options.maxDepth ?? 8;
  const result: Element[] = [];
  let current: Element | null = element;
  for (let depth = 0; current && depth < maxDepth; depth += 1) {
    if (!options.isIncluded(current)) break;
    result.push(current);
    current = composedParent(current);
  }
  return result;
}
