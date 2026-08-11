/**
 * Test-only jsdom hit-test shim (Goal 03).
 *
 * jsdom 30 has no layout engine: `elementFromPoint`/`elementsFromPoint`
 * are absent, so the REAL react-grab primitives cannot hit-test in Vitest.
 * This module installs a minimal deterministic containment shim for those
 * two DOM APIs (deepest element first) plus a `setElementRect` helper for
 * per-element bounding rects (jsdom returns zero rects). The shim is
 * installed automatically by `tests/setup/vitest.ts`; the browser contract
 * spec remains the authoritative hit-testing proof.
 */

export type TestRect = { x: number; y: number; width: number; height: number };

export function setElementRect(element: Element, rect: TestRect): void {
  const domRect = new DOMRect(rect.x, rect.y, rect.width, rect.height);
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    writable: true,
    value: () => domRect,
  });
}

export function installHitTestShim(): void {
  const hitChain = (root: Document, x: number, y: number): Element[] => {
    const contained: Element[] = [];
    for (const element of root.querySelectorAll("*")) {
      const rect = element.getBoundingClientRect();
      if (
        x >= rect.left &&
        x <= rect.right &&
        y >= rect.top &&
        y <= rect.bottom
      ) {
        contained.push(element);
      }
    }
    const depth = (element: Element): number => {
      let count = 0;
      for (
        let parent = element.parentElement;
        parent;
        parent = parent.parentElement
      ) {
        count += 1;
      }
      return count;
    };
    return contained.sort((a, b) => depth(b) - depth(a));
  };

  const DocumentPrototype = document.defaultView!.Document.prototype as {
    elementFromPoint?: (x: number, y: number) => Element | null;
    elementsFromPoint?: (x: number, y: number) => Element[];
  };
  if (!DocumentPrototype.elementFromPoint) {
    DocumentPrototype.elementFromPoint = function elementFromPoint(
      this: Document,
      x: number,
      y: number
    ) {
      return hitChain(this, x, y)[0] ?? null;
    };
  }
  if (!DocumentPrototype.elementsFromPoint) {
    DocumentPrototype.elementsFromPoint = function elementsFromPoint(
      this: Document,
      x: number,
      y: number
    ) {
      return hitChain(this, x, y);
    };
  }
}
