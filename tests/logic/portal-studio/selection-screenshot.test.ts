import { describe, expect, it } from "vitest";

import {
  buildScreenshotSvg,
  computeScreenshotScale,
  scaleAnnotations,
  stripSecretAttributes,
} from "@/studio/screenshot";
import {
  commitRegion,
  EMPTY_SELECTION,
  normalizeRegion,
  replaceSelection,
  toggleInSelection,
} from "@/studio/selection";

describe("selection model", () => {
  const makeElement = (tag = "div") => {
    const element = document.createElement(tag);
    document.body.appendChild(element);
    return element;
  };

  it("replaces the selection with a single element", () => {
    const a = makeElement();
    const b = makeElement();
    const replaced = replaceSelection(replaceSelection(EMPTY_SELECTION, a), b);
    expect(replaced.elements).toEqual([b]);
  });

  it("toggles elements in multi-selection with a cap", () => {
    const elements = Array.from({ length: 55 }, () => makeElement());
    let state = EMPTY_SELECTION;
    for (const element of elements) {
      state = toggleInSelection(state, element);
    }
    expect(state.elements).toHaveLength(50);
    // Toggling an existing element removes it.
    state = toggleInSelection(state, elements[0]);
    expect(state.elements).toHaveLength(49);
    expect(state.elements.includes(elements[0])).toBe(false);
  });

  it("normalizes marquee rects into viewport-bounded regions", () => {
    const region = normalizeRegion(
      { x: -10, y: 5, width: 500, height: 400 },
      { width: 320, height: 200 }
    );
    expect(region).toEqual({ x: 0, y: 5, width: 320, height: 195 });
  });

  it("commits a region by intersecting bounding rects", () => {
    const inside = makeElement();
    const outside = makeElement();
    // jsdom has no layout: provide explicit rects.
    const rect = (left: number, top: number, width: number, height: number) =>
      ({
        left,
        top,
        right: left + width,
        bottom: top + height,
        width,
        height,
        x: left,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect;
    Object.defineProperty(inside, "getBoundingClientRect", {
      value: () => rect(10, 10, 40, 40),
    });
    Object.defineProperty(outside, "getBoundingClientRect", {
      value: () => rect(500, 500, 40, 40),
    });
    const state = commitRegion([inside, outside], {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
    expect(state.elements).toEqual([inside]);
    expect(state.region).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });
});

describe("screenshot helpers", () => {
  it("fits the viewport into the bounded canvas", () => {
    expect(computeScreenshotScale(800, 600)).toBe(1);
    expect(computeScreenshotScale(4000, 2000)).toBe(0.4);
    expect(computeScreenshotScale(2000, 4000)).toBe(0.3);
    expect(computeScreenshotScale(0, 0)).toBe(1);
  });

  it("builds a standalone SVG with an XHTML foreignObject", () => {
    const svg = buildScreenshotSvg("<div>hi</div>", 640, 480);
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain("<foreignObject");
    expect(svg).toContain("<div>hi</div>");
    expect(svg.endsWith("</svg>")).toBe(true);
  });

  it("keeps valid attribute spacing between height and viewBox (regression)", () => {
    // A missing space here produced `height="480"viewBox="…"`, an invalid
    // SVG attribute sequence that made `new Image()` fail to rasterize the
    // data-URL (image.onerror) and the whole screenshot capture return null.
    const svg = buildScreenshotSvg("<div>hi</div>", 640, 480);
    expect(svg).toContain('height="480" viewBox="0 0 640 480"');
    expect(svg).not.toMatch(/height="\d+"viewBox/);
    // The whole opening tag must be well-formed XML.
    const opening = svg.slice(0, svg.indexOf(">") + 1);
    expect(opening).toMatch(/^<svg [^>]+>$/);
    expect(() => new DOMParser().parseFromString(svg, "image/svg+xml")).not.toThrow();
    const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
    expect(parsed.querySelector("parsererror")).toBeNull();
    expect(parsed.documentElement.getAttribute("viewBox")).toBe("0 0 640 480");
  });

  it("strips secret-bearing attributes", () => {
    const element = document.createElement("a");
    element.setAttribute("href", "/x");
    element.setAttribute("data-token", "secret");
    element.setAttribute("aria-label", "ok");
    stripSecretAttributes(element);
    expect(element.getAttribute("href")).toBe("/x");
    expect(element.getAttribute("data-token")).toBeNull();
    expect(element.getAttribute("aria-label")).toBe("ok");
  });

  it("clamps annotations into the canvas space", () => {
    const markers = scaleAnnotations(
      [
        { x: 10, y: 20, width: 100, height: 50 },
        { x: 5000, y: 5000, width: 100, height: 50 },
      ],
      0.5,
      640,
      480
    );
    expect(markers[0]).toEqual({ x: 5, y: 10, width: 50, height: 25 });
    expect(markers[1].x).toBe(640);
    expect(markers[1].y).toBe(480);
  });
});
