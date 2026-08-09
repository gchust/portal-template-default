/**
 * Goal 06 — per-annotation page context and route-key gating.
 *
 * Each annotation captures the page context (url, stable routeKey, title,
 * viewport, scroll, businessContext) at creation time. Markers for an
 * annotation only resolve/render when the CURRENT routeKey matches the
 * annotation's — an annotation made on /users must never render markers
 * over a /dev/ai-chat page. Legacy annotations WITHOUT pageContext keep
 * rendering everywhere (backward compatible).
 */

import type { Annotation, BusinessContextItem } from "./types";

export type PageContext = NonNullable<Annotation["pageContext"]>;

/** Stable route key: the SPA pathname (query/hash excluded). */
export function currentRouteKey(): string {
  return window.location.pathname;
}

/** Capture the page context at annotation-creation time. */
export function capturePageContext(
  businessContext: BusinessContextItem[]
): PageContext {
  return {
    url: window.location.href,
    routeKey: currentRouteKey(),
    title: document.title,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    scroll: { x: window.scrollX, y: window.scrollY },
    businessContext,
  };
}

/**
 * Whether the annotation's markers may render on the current route.
 * Absent pageContext (legacy annotations) always matches; otherwise the
 * routeKey must equal the current one.
 */
export function annotationMatchesRoute(annotation: Annotation): boolean {
  const routeKey = annotation.pageContext?.routeKey;
  if (!routeKey) return true;
  return routeKey === currentRouteKey();
}
