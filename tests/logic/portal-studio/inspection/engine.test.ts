import { beforeAll, describe, expect, it } from "vitest";

import {
  InspectionError,
  createInspectionEngine,
  ensureStudioHostIgnored,
  inspectionEngine,
  isInspectionCandidate,
  resolveUsefulTarget,
} from "@/studio/inspection";

/**
 * jsdom 30 has no layout engine: `elementFromPoint`/`elementsFromPoint` are
 * absent, so the REAL react-grab primitives cannot hit-test. This file
 * installs a minimal deterministic containment shim for those two DOM APIs
 * (deepest element first) plus per-element `getBoundingClientRect` rect
 * stubs, then exercises the real engine, the real primitives, and the real
 * promotion rule. The authoritative browser proof lives in
 * `e2e/react-grab-g01/react-grab.contract.ts`.
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
  document.body.innerHTML = "";
  const main = document.createElement("main");
  main.id = "fixture-ready";
  setRect(main, { x: 0, y: 0, width: 1200, height: 800 });

  const svgSection = document.createElement("section");
  setRect(svgSection, { x: 0, y: 0, width: 400, height: 100 });
  const svgButton = document.createElement("button");
  svgButton.id = "fixture-svg-button";
  setRect(svgButton, { x: 10, y: 10, width: 200, height: 60 });
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  setRect(svg, { x: 20, y: 20, width: 60, height: 40 });
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.id = "fixture-svg-path";
  setRect(path, { x: 22, y: 22, width: 56, height: 36 });
  svg.append(path);
  svgButton.append(svg, document.createTextNode("SVG button"));
  svgSection.append(svgButton);

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

  const plainSection = document.createElement("section");
  setRect(plainSection, { x: 0, y: 240, width: 400, height: 100 });
  const plainButton = document.createElement("button");
  plainButton.id = "fixture-plain-button";
  setRect(plainButton, { x: 10, y: 250, width: 200, height: 60 });
  plainButton.textContent = "Plain React button";
  plainSection.append(plainButton);

  const studioHost = document.createElement("div");
  studioHost.id = "portal-studio-root";
  setRect(studioHost, { x: 0, y: 360, width: 400, height: 100 });
  const studioButton = document.createElement("button");
  studioButton.id = "fixture-studio-button";
  setRect(studioButton, { x: 20, y: 370, width: 160, height: 40 });
  studioHost.append(studioButton);

  main.append(svgSection, standaloneSection, plainSection, studioHost);
  document.body.append(main);

  return {
    svgButton,
    svgPath: path,
    standalonePath,
    plainButton,
    studioHost,
    studioButton,
  };
};

describe("inspection engine — surface and ownership", () => {
  beforeAll(() => {
    installHitTestShim();
  });

  it("exposes the repository-owned adapter surface with one implementation", () => {
    const engine = createInspectionEngine();
    expect(typeof engine.getTargetAtPoint).toBe("function");
    expect(typeof engine.getTargetsAtPoint).toBe("function");
    expect(typeof engine.getBounds).toBe("function");
    expect(typeof engine.inspect).toBe("function");
    expect(typeof engine.freeze).toBe("function");
    expect(typeof engine.unfreeze).toBe("function");
    expect(typeof engine.isFrozen).toBe("function");
    expect(typeof resolveUsefulTarget).toBe("function");
    // Singleton and factory are the same implementation shape.
    expect(typeof inspectionEngine.getTargetAtPoint).toBe("function");
    // No default React Grab UI mounts by merely importing the adapter.
    expect(document.querySelector("[data-react-grab-toolbar]")).toBeNull();
    expect(document.querySelector("[data-react-grab-overlay-canvas]")).toBeNull();
  });

  it("marks the Studio host as ignored idempotently", () => {
    const fixture = buildFixture();
    // The engine marks hosts present at creation; calling the helper again
    // on a freshly built host is idempotent.
    ensureStudioHostIgnored();
    expect(fixture.studioHost.hasAttribute("data-react-grab-ignore")).toBe(true);
    ensureStudioHostIgnored();
    expect(fixture.studioHost.getAttribute("data-react-grab-ignore")).toBe("");
  });
});

describe("isInspectionCandidate — target filter", () => {
  it("accepts a connected plain element and rejects roots/disconnected/Studio", () => {
    const fixture = buildFixture();
    expect(isInspectionCandidate(fixture.plainButton)).toBe(true);
    expect(isInspectionCandidate(fixture.studioButton)).toBe(false);
    expect(isInspectionCandidate(document.body)).toBe(false);
    expect(isInspectionCandidate(document.documentElement)).toBe(false);
    expect(isInspectionCandidate(document.createElement("button"))).toBe(false);
  });

  it("rejects hidden elements and data-react-grab-ignore subtrees", () => {
    const fixture = buildFixture();
    const hidden = document.createElement("button");
    hidden.style.display = "none";
    document.body.append(hidden);
    expect(isInspectionCandidate(hidden)).toBe(false);

    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-react-grab-ignore", "");
    const inside = document.createElement("button");
    wrapper.append(inside);
    document.body.append(wrapper);
    expect(isInspectionCandidate(inside)).toBe(false);
  });
});

describe("engine hit testing — promotion and exclusion (real primitives)", () => {
  let fixture: ReturnType<typeof buildFixture>;

  beforeAll(() => {
    fixture = buildFixture();
  });

  it("promotes a nested SVG point to the nearest useful button target", () => {
    const engine = createInspectionEngine();
    const result = resolveUsefulTarget(30, 30);

    expect(result.hit).toBe(fixture.svgPath);
    expect(result.stack[0]).toBe(fixture.svgPath);
    expect(result.target).toBe(fixture.svgButton);
    expect(result.promoted).toBe(true);
    expect(result.reason).toBe("svg-geometry-promotion");
    // The adapter entry point applies the same promotion.
    expect(engine.getTargetAtPoint(30, 30)).toBe(fixture.svgButton);
    expect(engine.getTargetsAtPoint(30, 30)).toContain(fixture.svgPath);
    expect(engine.getTargetsAtPoint(30, 30)).toContain(fixture.svgButton);
  });

  it("keeps a plain button hit direct", () => {
    const result = resolveUsefulTarget(30, 260);
    expect(result.target).toBe(fixture.plainButton);
    expect(result.promoted).toBe(false);
    expect(result.reason).toBe("direct");
  });

  it("does not jump a standalone SVG shape to an unrelated ancestor", () => {
    const result = resolveUsefulTarget(30, 140);
    expect(result.target).toBe(fixture.standalonePath);
    expect(result.promoted).toBe(false);
    expect(result.reason).toBe("svg-geometry-promotion");
  });

  it("never returns a Studio element as the target", () => {
    // A point covered ONLY by the Studio subtree resolves to no target.
    document.body.innerHTML = "";
    const studioHost = document.createElement("div");
    studioHost.id = "portal-studio-root";
    studioHost.setAttribute("data-react-grab-ignore", "");
    setRect(studioHost, { x: 0, y: 0, width: 400, height: 100 });
    const studioButton = document.createElement("button");
    studioButton.id = "fixture-studio-button";
    setRect(studioButton, { x: 20, y: 10, width: 160, height: 40 });
    studioHost.append(studioButton);
    document.body.append(studioHost);

    const engine = createInspectionEngine();
    const result = resolveUsefulTarget(30, 20);
    expect(result.stack).toEqual([]);
    expect(result.hit).toBeNull();
    expect(result.target).toBeNull();
    expect(result.reason).toBe("no-target");
    expect(engine.getTargetAtPoint(30, 20)).toBeNull();
    expect(engine.getTargetsAtPoint(30, 20)).toEqual([]);
  });

  it("reports no-target outside every element", () => {
    const result = resolveUsefulTarget(1250, 850);
    expect(result.target).toBeNull();
    expect(result.reason).toBe("no-target");
    expect(result.hit).toBeNull();
  });
});

describe("engine inspect — normalization and typed errors", () => {
  it("returns a bounded v6 capture with honest source-null in jsdom", async () => {
    const fixture = buildFixture();
    const inspected = await inspectionEngine.inspect(fixture.plainButton);
    expect(inspected.tagName).toBe("button");
    expect(inspected.selector).toBeTruthy();
    expect(inspected.bounds).toMatchObject({ width: expect.any(Number) });
    expect(inspected.source).toBeNull(); // no React source in jsdom: honest null
    expect(inspected.sourceStack).toEqual([]);
    expect(inspected.htmlPreview.length).toBeLessThanOrEqual(4000);
    expect(inspected.styleText.length).toBeLessThanOrEqual(6000);
    expect(inspected.fingerprint.tagName).toBe("button");
    expect(inspected.fingerprint.text).toBe("Plain React button");
    expect(inspected.fingerprint.identityAttributes).toEqual({
      id: "fixture-plain-button",
    });
  });

  it("surfaces a typed error for a non-element input", async () => {
    await expect(
      inspectionEngine.inspect(
        document.createTextNode("x") as unknown as Element
      )
    ).rejects.toBeInstanceOf(InspectionError);
    await expect(
      inspectionEngine.inspect(
        document.createTextNode("x") as unknown as Element
      )
    ).rejects.toMatchObject({ code: "not_an_element" });
  });

  it("wraps upstream freeze failure in a typed error (jsdom limitation)", () => {
    // jsdom cannot freeze a page; the adapter must surface the upstream
    // failure as a typed InspectionError, never a raw upstream object.
    expect(() => inspectionEngine.freeze()).toThrowError(InspectionError);
    expect(() => inspectionEngine.freeze()).toThrowError(
      expect.objectContaining({ code: "upstream_error" })
    );
    expect(inspectionEngine.isFrozen()).toBe(false);
  });
});
