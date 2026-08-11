import { beforeAll, describe, expect, it } from "vitest";

import { resolveUsefulTarget } from "@/studio/inspection";

/**
 * Goal 01/02 — G01-AC06 deterministic semantic target-promotion proof,
 * consumed through the repository-owned inspection adapter (shared contract
 * §4: no test may import upstream directly after Goal 02).
 *
 * jsdom 30 implements no layout engine: `Document.prototype.elementFromPoint`
 * and `elementsFromPoint` are absent, so the REAL public react-grab
 * primitives cannot hit-test. This file installs a minimal, deterministic
 * containment shim for those two DOM APIs (deepest element first) and per-
 * element `getBoundingClientRect` rect stubs (jsdom returns zero rects), then
 * lets the real adapter, the real primitives and the real promotion rule run
 * against ordinary DOM. The authoritative browser proof lives in
 * `e2e/react-grab-g01/react-grab.contract.ts`; this unit proof pins the rule
 * logic and its negative properties.
 */

type Rect = { x: number; y: number; width: number; height: number };

const setRect = (element: Element, rect: Rect) => {
  const domRect = new DOMRect(rect.x, rect.y, rect.width, rect.height);
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => domRect,
  });
};

const installHitTestShim = () => {
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
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
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
  DocumentPrototype.elementFromPoint = function elementFromPoint(
    this: Document,
    x: number,
    y: number
  ) {
    return hitChain(this, x, y)[0] ?? null;
  };
  DocumentPrototype.elementsFromPoint = function elementsFromPoint(
    this: Document,
    x: number,
    y: number
  ) {
    return hitChain(this, x, y);
  };
};

const buildFixture = () => {
  const main = document.createElement("main");
  main.id = "fixture-ready";
  setRect(main, { x: 0, y: 0, width: 1200, height: 800 });

  // Mirrors e2e/react-grab-g01/fixture.tsx: path -> svg -> button.
  const svgSection = document.createElement("section");
  setRect(svgSection, { x: 0, y: 0, width: 400, height: 100 });
  const svgButton = document.createElement("button");
  svgButton.id = "fixture-svg-button";
  setRect(svgButton, { x: 10, y: 10, width: 200, height: 60 });
  const svg = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg"
  );
  setRect(svg, { x: 20, y: 20, width: 60, height: 40 });
  const path = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "path"
  );
  path.id = "fixture-svg-path";
  setRect(path, { x: 22, y: 22, width: 56, height: 36 });
  svg.append(path);
  svgButton.append(svg, document.createTextNode("SVG button"));
  svgSection.append(svgButton);

  // Standalone decorative SVG shape with no interactive ancestor.
  const standaloneSection = document.createElement("section");
  setRect(standaloneSection, { x: 0, y: 120, width: 400, height: 100 });
  const standaloneSvg = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg"
  );
  setRect(standaloneSvg, { x: 10, y: 130, width: 120, height: 40 });
  const standalonePath = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "path"
  );
  standalonePath.id = "fixture-svg-standalone-path";
  setRect(standalonePath, { x: 12, y: 132, width: 116, height: 36 });
  standaloneSvg.append(standalonePath);
  standaloneSection.append(standaloneSvg);

  // Nearest interactive ancestor is the link.
  const linkSection = document.createElement("section");
  setRect(linkSection, { x: 0, y: 240, width: 400, height: 100 });
  const link = document.createElement("a");
  link.id = "fixture-svg-link";
  link.href = "#fixture";
  setRect(link, { x: 10, y: 250, width: 200, height: 60 });
  const linkSvg = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg"
  );
  setRect(linkSvg, { x: 20, y: 260, width: 60, height: 40 });
  const linkPath = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "path"
  );
  linkPath.id = "fixture-svg-link-path";
  setRect(linkPath, { x: 22, y: 262, width: 56, height: 36 });
  linkSvg.append(linkPath);
  link.append(linkSvg);
  linkSection.append(link);

  // Nearest interactive ancestor is the BUTTON inside the link; the walk must
  // cross the non-interactive span and must not jump to the link.
  const nestedSection = document.createElement("section");
  setRect(nestedSection, { x: 0, y: 360, width: 400, height: 100 });
  const nestedLink = document.createElement("a");
  nestedLink.id = "fixture-svg-link-button";
  nestedLink.href = "#fixture";
  setRect(nestedLink, { x: 10, y: 370, width: 200, height: 80 });
  const span = document.createElement("span");
  setRect(span, { x: 20, y: 380, width: 180, height: 60 });
  const nestedButton = document.createElement("button");
  nestedButton.id = "fixture-svg-link-button-btn";
  setRect(nestedButton, { x: 30, y: 390, width: 160, height: 40 });
  const nestedSvg = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg"
  );
  setRect(nestedSvg, { x: 40, y: 395, width: 50, height: 30 });
  const nestedPath = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "path"
  );
  nestedPath.id = "fixture-svg-link-button-path";
  setRect(nestedPath, { x: 42, y: 397, width: 46, height: 26 });
  nestedSvg.append(nestedPath);
  nestedButton.append(nestedSvg);
  span.append(nestedButton);
  nestedLink.append(span);
  nestedSection.append(nestedLink);

  // Plain button: the direct hit must stay untouched.
  const plainSection = document.createElement("section");
  setRect(plainSection, { x: 0, y: 480, width: 400, height: 100 });
  const plainButton = document.createElement("button");
  plainButton.id = "fixture-plain-button";
  setRect(plainButton, { x: 10, y: 490, width: 200, height: 60 });
  plainButton.textContent = "Plain React button";
  plainSection.append(plainButton);

  // SVG shape inside a non-interactive span, overlapped by a NON-ancestor
  // interactive element later in document order: the composed-parent guard
  // must stop the walk instead of jumping to that sibling.
  const guardSection = document.createElement("section");
  setRect(guardSection, { x: 420, y: 0, width: 400, height: 100 });
  const guardSpan = document.createElement("span");
  setRect(guardSpan, { x: 430, y: 10, width: 200, height: 60 });
  const guardSvg = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg"
  );
  setRect(guardSvg, { x: 440, y: 20, width: 60, height: 40 });
  const guardPath = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "path"
  );
  guardPath.id = "fixture-svg-guard-path";
  setRect(guardPath, { x: 442, y: 22, width: 56, height: 36 });
  guardSvg.append(guardPath);
  guardSpan.append(guardSvg);
  const guardSibling = document.createElement("div");
  guardSibling.id = "fixture-svg-guard-sibling";
  guardSibling.setAttribute("role", "button");
  setRect(guardSibling, { x: 430, y: 10, width: 200, height: 60 });
  guardSection.append(guardSpan, guardSibling);

  main.append(
    svgSection,
    standaloneSection,
    linkSection,
    nestedSection,
    plainSection,
    guardSection
  );
  document.body.append(main);

  return {
    svgPath: path,
    svgButton,
    standalonePath,
    linkPath,
    link,
    nestedPath,
    nestedButton,
    nestedLink,
    plainButton,
    guardPath,
    guardSibling,
  };
};

const summarize = (element: Element | null) =>
  element ? { id: element.id, tagName: element.tagName.toLowerCase() } : null;

describe("react-grab semantic target promotion (Goal 01 G01-AC06)", () => {
  let fixture: ReturnType<typeof buildFixture>;

  beforeAll(() => {
    installHitTestShim();
    fixture = buildFixture();
  });

  it("promotes a nested SVG path to its nearest useful button target", () => {
    const result = resolveUsefulTarget(30, 30);

    // Honest upstream observation, preserved: the raw public selection is the
    // grabbable SVG path — the first entry of the public stack.
    expect(result.hit).toBe(fixture.svgPath);
    expect(result.stack[0]).toBe(fixture.svgPath);

    // A naive "first arbitrary stack item" rule would keep the raw path; the
    // deterministic rule promotes to the nearest interactive control.
    expect(result.target).toBe(fixture.svgButton);
    expect(result.promoted).toBe(true);
    expect(result.reason).toBe("svg-geometry-promotion");
    expect(result.stack.indexOf(fixture.svgButton)).toBeGreaterThan(
      result.stack.indexOf(fixture.svgPath)
    );
  });

  it("keeps a plain button hit direct", () => {
    const result = resolveUsefulTarget(30, 500);

    expect(result.hit).toBe(fixture.plainButton);
    expect(result.target).toBe(fixture.plainButton);
    expect(result.promoted).toBe(false);
    expect(result.reason).toBe("direct");
  });

  it("does not jump a standalone SVG shape to an unrelated ancestor", () => {
    const result = resolveUsefulTarget(30, 140);

    expect(result.hit).toBe(fixture.standalonePath);
    expect(result.target).toBe(fixture.standalonePath);
    expect(result.promoted).toBe(false);
    // The walk ran (geometry hit) but found no interactive control ancestor.
    expect(result.reason).toBe("svg-geometry-promotion");
  });

  it("promotes a nested SVG path to the nearest interactive link", () => {
    const result = resolveUsefulTarget(30, 270);

    expect(result.hit).toBe(fixture.linkPath);
    expect(result.target).toBe(fixture.link);
    expect(result.promoted).toBe(true);
    expect(result.reason).toBe("svg-geometry-promotion");
  });

  it("never skips a nearer interactive control on the way up", () => {
    const result = resolveUsefulTarget(50, 400);

    expect(result.hit).toBe(fixture.nestedPath);
    // The walk crosses the non-interactive span and stops at the button; it
    // must NOT jump over it to the enclosing link.
    expect(result.target).toBe(fixture.nestedButton);
    expect(result.target).not.toBe(fixture.nestedLink);
    expect(result.promoted).toBe(true);
    expect(result.reason).toBe("svg-geometry-promotion");
  });

  it("stops at the first non-ancestor instead of jumping to an interactive sibling", () => {
    const result = resolveUsefulTarget(450, 30);

    // The overlapping interactive sibling sits later in the public stack, but
    // it is NOT a composed ancestor: the walk must break and keep the shape.
    expect(result.hit).toBe(fixture.guardPath);
    expect(result.stack).toContain(fixture.guardSibling);
    expect(result.target).toBe(fixture.guardPath);
    expect(result.target).not.toBe(fixture.guardSibling);
    expect(result.promoted).toBe(false);
    expect(result.reason).toBe("svg-geometry-promotion");
  });

  it("reports no-target when nothing is grabbable at the point", () => {
    // Outside every fixture rect, including <main> (0,0,1200,800).
    const result = resolveUsefulTarget(1250, 850);

    expect(result.target).toBeNull();
    expect(result.promoted).toBe(false);
    expect(result.reason).toBe("no-target");
    expect(summarize(result.hit)).toBeNull();
  });
});
