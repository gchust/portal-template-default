/**
 * Portal Studio — NocoBase context enrichment boundary.
 *
 * One function enriches an inspected element with bounded, deduplicated
 * business hints from the current `data-ai-page-element` / `data-nb-*`
 * conventions plus route context. This module never reads Fiber, source
 * modules, or any perception mechanism — it is DOM-attribute collection only
 * (shared contract §7 keeps business-context collection as product
 * normalization).
 *
 * The walker follows the same convention as the older capture module
 * (`collectBusinessContext`) — same hint shapes, dedup, and 20-item cap —
 * re-implemented locally with stricter per-value caps so the inspection
 * domain never depends on that module's dependency chain; Goal 05 will
 * remove the older copy.
 */

import type { BusinessContextItem } from "../types";
import type { EnrichedTarget, InspectedElement, RouteContext } from "./types";

const PAGE_ELEMENT_ATTRIBUTE = "data-ai-page-element";
const NB_ATTRIBUTE_PREFIX = "data-nb-";

const MAX_BUSINESS_CONTEXT_ITEMS = 20;
const MAX_CONTEXT_ANCESTORS = 3;
const MAX_ID_LENGTH = 200;
const MAX_SOURCE_LENGTH = 64;
const MAX_URL_LENGTH = 2000;
const MAX_ROUTE_KEY_LENGTH = 512;
const MAX_TITLE_LENGTH = 500;

/**
 * Collect bounded, deduplicated business-context hints from the element plus
 * up to `MAX_CONTEXT_ANCESTORS - 1` composed ancestors (element included).
 * Same convention as the product's existing extraction.
 */
export function collectInspectionBusinessContext(
  element: Element
): BusinessContextItem[] {
  const items: BusinessContextItem[] = [];
  const seen = new Set<string>();
  let current: Element | null = element;
  for (let depth = 0; current && depth < MAX_CONTEXT_ANCESTORS; depth += 1) {
    const pageElementId = current.getAttribute(PAGE_ELEMENT_ATTRIBUTE);
    if (pageElementId) {
      const key = `page-element:${pageElementId}`;
      if (!seen.has(key)) {
        seen.add(key);
        items.push({
          type: "page-element",
          id: pageElementId.slice(0, MAX_ID_LENGTH),
          source: PAGE_ELEMENT_ATTRIBUTE,
        });
      }
    }
    for (const attribute of Array.from(current.attributes)) {
      if (!attribute.name.startsWith(NB_ATTRIBUTE_PREFIX)) continue;
      const key = `${attribute.name}:${attribute.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        type: "data-attribute",
        id: attribute.value.slice(0, MAX_ID_LENGTH),
        source: attribute.name.slice(0, MAX_SOURCE_LENGTH),
      });
      if (items.length >= MAX_BUSINESS_CONTEXT_ITEMS) return items;
    }
    current = composedParentOf(current);
  }
  return items.slice(0, MAX_BUSINESS_CONTEXT_ITEMS);
}

const composedParentOf = (element: Element): Element | null => {
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
};

/** Bound a route context value so persisted enrichment stays bounded. */
export function boundRouteContext(route: RouteContext): RouteContext {
  return {
    url: String(route.url ?? "").slice(0, MAX_URL_LENGTH),
    routeKey: String(route.routeKey ?? "").slice(0, MAX_ROUTE_KEY_LENGTH),
    title: String(route.title ?? "").slice(0, MAX_TITLE_LENGTH),
  };
}

/**
 * The single enrichment boundary: inspected element + business hints + route
 * context. Pure, deterministic, bounded; no Fiber or source-module access.
 */
export function enrichInspectedElement(
  element: Element,
  inspected: InspectedElement,
  route: RouteContext
): EnrichedTarget {
  return {
    ...inspected,
    businessContext: collectInspectionBusinessContext(element),
    route: boundRouteContext(route),
  };
}

export type { BusinessContextItem };
