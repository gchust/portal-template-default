/**
 * Goal 06 — per-annotation page context and route-key gating (pure logic).
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  annotationMatchesRoute,
  capturePageContext,
  currentRouteKey,
} from "@/studio/route-context";
import type { Annotation } from "@/studio/types";

const baseAnnotation = (overrides: Partial<Annotation> = {}): Annotation => ({
  annotationId: "ann-1",
  kind: "element",
  comment: "c",
  createdAt: "2026-08-09T00:00:00.000Z",
  status: "open",
  elements: [],
  ...overrides,
});

afterEach(() => {
  window.history.pushState({}, "", "/");
});

describe("currentRouteKey / capturePageContext", () => {
  it("routeKey is the SPA pathname (query/hash excluded)", () => {
    window.history.pushState({}, "", "/users?page=2#top");
    expect(currentRouteKey()).toBe("/users");
  });

  it("captures url, routeKey, title, viewport, scroll and businessContext", () => {
    window.history.pushState({}, "", "/users");
    const context = capturePageContext([
      { type: "page-element", id: "pe-1", source: "data-ai-page-element" },
    ]);
    expect(context.routeKey).toBe("/users");
    expect(context.url).toContain("/users");
    expect(typeof context.title).toBe("string");
    expect(context.viewport.width).toBeGreaterThan(0);
    expect(typeof context.scroll.x).toBe("number");
    expect(context.businessContext).toHaveLength(1);
  });
});

describe("annotationMatchesRoute", () => {
  it("legacy annotations WITHOUT pageContext always render (backward compatible)", () => {
    expect(annotationMatchesRoute(baseAnnotation())).toBe(true);
  });

  it("renders when the routeKey matches the current route", () => {
    window.history.pushState({}, "", "/users");
    const annotation = baseAnnotation({
      pageContext: {
        url: "http://x/users",
        routeKey: "/users",
        title: "Users",
        viewport: { width: 1280, height: 720 },
        scroll: { x: 0, y: 0 },
        businessContext: [],
      },
    });
    expect(annotationMatchesRoute(annotation)).toBe(true);
  });

  it("does NOT render on a different route", () => {
    window.history.pushState({}, "", "/dev/ai-chat");
    const annotation = baseAnnotation({
      pageContext: {
        url: "http://x/users",
        routeKey: "/users",
        title: "Users",
        viewport: { width: 1280, height: 720 },
        scroll: { x: 0, y: 0 },
        businessContext: [],
      },
    });
    expect(annotationMatchesRoute(annotation)).toBe(false);
  });
});
