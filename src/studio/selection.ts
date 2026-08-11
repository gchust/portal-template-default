/**
 * Portal Studio — selection model (pure, testable).
 *
 * Single / multi / region selection state with replace, toggle, clear, and
 * marquee-commit semantics. The state holds live DOM element references (the
 * toolbar owns the only instance); every transition is a pure function.
 */

import { isStudioElement } from "./inspection";
import type { Region } from "./types";

/** Viewport-space marquee rect carried by the live selection state. */
export type ViewportRect = { x: number; y: number; width: number; height: number };

export const MAX_SELECTED_ELEMENTS = 50;

export type SelectionState = {
  elements: Element[];
  region?: ViewportRect;
};

export const EMPTY_SELECTION: SelectionState = { elements: [] };

export function replaceSelection(
  _state: SelectionState,
  element: Element
): SelectionState {
  return { elements: [element] };
}

export function toggleInSelection(
  state: SelectionState,
  element: Element
): SelectionState {
  const exists = state.elements.includes(element);
  const elements = exists
    ? state.elements.filter((entry) => entry !== element)
    : state.elements.length >= MAX_SELECTED_ELEMENTS
      ? state.elements
      : [...state.elements, element];
  return { ...state, elements };
}

export function clearSelection(): SelectionState {
  return EMPTY_SELECTION;
}

export function setRegion(
  state: SelectionState,
  region: Region | undefined
): SelectionState {
  return { ...state, region };
}

/** Normalize a raw marquee rect into a bounded viewport-aligned rect. */
export function normalizeRegion(
  raw: { x: number; y: number; width: number; height: number },
  viewport: { width: number; height: number }
): { x: number; y: number; width: number; height: number } {
  const clamp = (value: number) => Math.max(0, Math.round(value));
  const x = clamp(raw.x);
  const y = clamp(raw.y);
  const width = Math.min(
    Math.max(0, Math.round(raw.width)),
    Math.max(0, viewport.width - x)
  );
  const height = Math.min(
    Math.max(0, Math.round(raw.height)),
    Math.max(0, viewport.height - y)
  );
  return { x, y, width, height };
}

/**
 * Convert a viewport-aligned marquee rect into the v6 document-relative
 * region (shared contract §5: region coordinates are document-relative so
 * scrolling never moves the saved region).
 */
export function toDocumentRegion(
  rect: { x: number; y: number; width: number; height: number },
  scroll: { x: number; y: number }
): Region {
  return {
    coordinateSpace: "document",
    x: Math.round(rect.x + scroll.x),
    y: Math.round(rect.y + scroll.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

/** Convert a document-relative v6 region back to viewport coordinates. */
export function toViewportRegion(
  region: Region,
  scroll: { x: number; y: number }
): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.round(region.x - scroll.x),
    y: Math.round(region.y - scroll.y),
    width: Math.round(region.width),
    height: Math.round(region.height),
  };
}

const intersects = (rect: DOMRect, region: Region) =>
  rect.left < region.x + region.width &&
  rect.right > region.x &&
  rect.top < region.y + region.height &&
  rect.bottom > region.y;

/**
 * Commit a marquee region: select the elements whose bounding rect
 * intersects it (bounded, in document order, studio elements excluded).
 */
export function commitRegion(
  candidates: Element[],
  region: Region
): SelectionState {
  const selected: Element[] = [];
  for (const element of candidates) {
    if (selected.length >= MAX_SELECTED_ELEMENTS) break;
    if (isStudioElement(element)) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    if (intersects(rect, region)) selected.push(element);
  }
  return { elements: selected, region };
}
