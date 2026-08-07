/**
 * Portal Studio — React Grab adapter (fiber chain read).
 *
 * Evidence-documented adapter (contract §8, Decision Log D-006): React 19.1
 * dev builds attach per-DOM-node fiber references under `__reactFiber$<id>`
 * keys; walking `fiber.return` yields stable component names. The public
 * React DevTools global hook is present in this template (installed by the
 * react-refresh preamble) but inert (no renderer registered, no
 * `getFiberRoots`), so it is not usable for tree access. `_debugSource` and
 * `__source` are absent from fibers in this Vite dev setup, so file/line
 * source candidates are resolved server-side against the Vite module graph
 * (see `vite.ts`).
 *
 * Version pinning: React 19.1.0 (`package.json`). If the fiber key prefix
 * changes in a future React version, this adapter fails closed (returns an
 * empty chain) instead of throwing.
 */

import type { ComponentCandidate } from "./types";

const FIBER_KEY_PREFIX = "__reactFiber$";

const MAX_CHAIN_DEPTH = 40;

type FiberLike = {
  tag?: number;
  key?: unknown;
  type?: unknown;
  return?: FiberLike | null;
};

/** Find the React fiber reference key on a DOM element, if any. */
export function findFiberKey(element: Element): string | undefined {
  return Object.keys(element).find((key) => key.startsWith(FIBER_KEY_PREFIX));
}

/** Read a fiber's host type as a display name. */
export function readFiberTypeName(type: unknown): string | null {
  if (typeof type === "string") return type;
  if (type && typeof type === "object") {
    const candidate = type as { displayName?: unknown; name?: unknown };
    if (typeof candidate.displayName === "string") {
      return candidate.displayName;
    }
    if (typeof candidate.name === "string") {
      return candidate.name;
    }
  }
  if (typeof type === "function") {
    return type.name || null;
  }
  return null;
}

/**
 * Walk the fiber `return` chain of a DOM element and collect component
 * candidates. Fails closed: any error yields an empty chain.
 */
export function collectComponentChain(
  element: Element,
  maxDepth: number = MAX_CHAIN_DEPTH
): ComponentCandidate[] {
  try {
    const fiberKey = findFiberKey(element);
    if (!fiberKey) return [];
    const rootFiber = (element as unknown as Record<string, unknown>)[
      fiberKey
    ] as FiberLike | undefined;
    if (!rootFiber) return [];

    const chain: ComponentCandidate[] = [];
    let fiber: FiberLike | null = rootFiber;
    let hops = 0;
    let lastName: string | null = null;
    while (fiber && hops < maxDepth) {
      hops += 1;
      const name = readFiberTypeName(fiber.type);
      // Collapse consecutive duplicates (e.g. host tags between components).
      if (name !== lastName) {
        chain.push({
          name,
          key: typeof fiber.key === "string" ? fiber.key : null,
        });
        lastName = name;
      }
      fiber = fiber.return ?? null;
    }
    return chain;
  } catch {
    return [];
  }
}
