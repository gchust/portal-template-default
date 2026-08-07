/**
 * Portal Studio — selection model (pure, testable).
 *
 * Single / multi / region selection state with replace, toggle, clear, and
 * marquee-commit semantics. The state holds live DOM element references (the
 * toolbar owns the only instance); every transition is a pure function.
 */

import { isStudioElement } from "./capture";
import type { Region } from "./types";

export const MAX_SELECTED_ELEMENTS = 50;

export type SelectionState = {
  elements: Element[];
  region?: Region;
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

/** Normalize a raw marquee rect into a bounded viewport-aligned region. */
export function normalizeRegion(
  raw: { x: number; y: number; width: number; height: number },
  viewport: { width: number; height: number }
): Region {
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
