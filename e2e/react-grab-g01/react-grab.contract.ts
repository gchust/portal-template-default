import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import type {
  ElementProof,
  HitProof,
  ReactGrabG01Api,
} from "./fixture";

const evidenceRoot = path.resolve(
  ".portal-studio-evidence/react-grab-g01"
);
const screenshotsRoot = path.join(evidenceRoot, "screenshots");

const callApi = async <T>(
  page: import("@playwright/test").Page,
  method: keyof ReactGrabG01Api,
  args: unknown[] = []
) =>
  page.evaluate(
    async ({ method, args }) => {
      const fixture = window.__REACT_GRAB_G01__;
      if (!fixture) throw new Error("React Grab fixture API is not ready");
      const value = fixture[method];
      if (typeof value !== "function") return value;
      return await (value as (...values: unknown[]) => unknown)(...args);
    },
    { method, args }
  ) as Promise<Awaited<T>>;

const openFixture = async (page: import("@playwright/test").Page) => {
  await page.goto("./");
  await expect(page.locator("#fixture-ready")).toBeVisible();
  await expect(page.locator("#fixture-plain-button")).toBeVisible();
};

const expectSourceContext = (
  proof: ElementProof,
  expectedComponent: string
) => {
  expect(proof.context.filePath).not.toBeNull();
  expect(
    path.resolve(
      "e2e/react-grab-g01",
      proof.context.filePath!.replace(/\?.*$/, "")
    )
  ).toBe(path.resolve("e2e/react-grab-g01/fixture.tsx"));
  expect(proof.context.lineNumber).toEqual(expect.any(Number));
  expect(proof.context.lineNumber).toBeGreaterThan(0);
  expect(proof.context.columnNumber).toEqual(expect.any(Number));
  expect(proof.context.columnNumber).toBeGreaterThanOrEqual(0);
  expect(proof.context.filePath).not.toContain("node_modules");

  const componentEvidence = [
    proof.context.componentName,
    ...proof.context.stack.map((frame) => frame.functionName),
  ]
    .filter(Boolean)
    .join(" ");
  expect(componentEvidence).toContain(expectedComponent);
  expect(
    proof.context.stack.some(
      (frame) =>
        !!frame.fileName &&
        path.resolve(
          "e2e/react-grab-g01",
          frame.fileName.replace(/\?.*$/, "")
        ) === path.resolve("e2e/react-grab-g01/fixture.tsx") &&
        !frame.fileName.includes("node_modules")
    )
  ).toBe(true);
};

test.beforeAll(() => {
  mkdirSync(screenshotsRoot, { recursive: true });
});

test("exports all public primitives without mounting the default UI", async ({
  page,
}) => {
  await openFixture(page);
  const callableTypes = await callApi<Record<string, string>>(
    page,
    "callableTypes"
  );
  const ui = await callApi<ReturnType<ReactGrabG01Api["uiState"]>>(
    page,
    "uiState"
  );

  expect(Object.keys(callableTypes).sort()).toEqual(
    [
      "disposeBaselineStyles",
      "freeze",
      "getElementAtPoint",
      "getElementBounds",
      "getElementContext",
      "getElementSelector",
      "getElementsAtPoint",
      "isElementGrabbable",
      "isFreezeActive",
      "unfreeze",
    ].sort()
  );
  expect(Object.values(callableTypes)).toEqual(
    Array(10).fill("function")
  );
  expect(ui).toMatchObject({
    mountedUiAttributes: [],
    clipboardWrites: 0,
    copyEventAllowed: true,
    hotkeyEventAllowed: true,
  });
});

test("returns workspace source context for authored React targets", async ({
  page,
}) => {
  await openFixture(page);
  const expected = [
    ["fixture-plain-button", "PlainButton"],
    ["fixture-memo-button", "MemoButton"],
    ["fixture-forward-ref-button", "ForwardRefButton"],
    ["fixture-mapped-item-2", "MappedItem"],
    ["fixture-portal-dialog-action", "PortalDialogAction"],
  ] as const;
  const results: Record<string, ElementProof> = {};

  for (const [id, component] of expected) {
    const proof = await callApi<ElementProof>(page, "inspect", [id]);
    expectSourceContext(proof, component);
    results[id] = proof;
  }

  writeFileSync(
    path.join(evidenceRoot, "source-context-results.json"),
    `${JSON.stringify(results, null, 2)}\n`
  );
});

test("inspects the template shadcn button target", async ({ page }) => {
  await openFixture(page);
  const proof = await callApi<ElementProof>(
    page,
    "inspect",
    ["fixture-shadcn-button"]
  );

  expect(proof.id).toBe("fixture-shadcn-button");
  expect(proof.tagName).toBe("button");
  expect(proof.grabbable).toBe(true);
  expect(proof.selector).toBeTruthy();
  expect(proof.bounds.width).toBeGreaterThan(0);
  expect(proof.bounds.height).toBeGreaterThan(0);
});

test("promotes a nested SVG point to its nearest useful button target", async ({
  page,
}) => {
  await openFixture(page);
  const svg = await callApi<HitProof>(page, "hit", [
    "fixture-svg-path",
    true,
  ]);

  writeFileSync(
    path.join(evidenceRoot, "svg-results.json"),
    `${JSON.stringify(svg, null, 2)}\n`
  );

  // Honest upstream observation, preserved: with ordinary pointer events the
  // native hit and the raw public selection are both the grabbable SVG path.
  expect(svg.nativeTarget).toEqual({
    id: "fixture-svg-path",
    tagName: "path",
    grabbable: true,
  });
  expect(svg.selectedStack[0]).toEqual({
    id: "fixture-svg-path",
    tagName: "path",
  });

  // The deterministic semantic rule promotes to the nearest useful target.
  expect(svg.selectedTarget).toEqual({
    id: "fixture-svg-button",
    tagName: "button",
  });
  expect(svg.promoted).toBe(true);
  expect(svg.promotionReason).toBe("svg-geometry-promotion");
  // The promoted button is a real composed ancestor present in the public
  // stack, never an arbitrary or unrelated element.
  const stackIds = svg.selectedStack.map((entry) => entry.id);
  expect(stackIds.indexOf("fixture-svg-button")).toBeGreaterThan(
    stackIds.indexOf("fixture-svg-path")
  );
});

test("keeps a plain button hit direct and unpromoted", async ({ page }) => {
  await openFixture(page);
  const plain = await callApi<HitProof>(page, "hit", [
    "fixture-plain-button",
    true,
  ]);

  expect(plain.nativeTarget).toEqual({
    id: "fixture-plain-button",
    tagName: "button",
    grabbable: true,
  });
  expect(plain.selectedTarget).toEqual({
    id: "fixture-plain-button",
    tagName: "button",
  });
  expect(plain.promoted).toBe(false);
  expect(plain.promotionReason).toBe("direct");
});

test("does not jump a standalone SVG shape to an unrelated ancestor", async ({
  page,
}) => {
  await openFixture(page);
  const standalone = await callApi<HitProof>(page, "hit", [
    "fixture-svg-standalone-path",
    true,
  ]);

  writeFileSync(
    path.join(evidenceRoot, "standalone-svg-results.json"),
    `${JSON.stringify(standalone, null, 2)}\n`
  );

  expect(standalone.nativeTarget).toEqual({
    id: "fixture-svg-standalone-path",
    tagName: "path",
    grabbable: true,
  });
  // No interactive control ancestor exists, so the raw shape is kept instead
  // of jumping to the surrounding section/main container.
  expect(standalone.selectedTarget).toEqual({
    id: "fixture-svg-standalone-path",
    tagName: "path",
  });
  expect(standalone.promoted).toBe(false);
  expect(standalone.promotionReason).toBe("svg-geometry-promotion");
});

test("skips the transparent non-grabbable overlay", async ({ page }) => {
  await openFixture(page);
  const overlay = await callApi<HitProof>(page, "hit", [
    "fixture-overlay-button",
  ]);

  writeFileSync(
    path.join(evidenceRoot, "overlay-results.json"),
    `${JSON.stringify(overlay, null, 2)}\n`
  );

  expect(overlay.nativeTarget).toMatchObject({
    id: "fixture-overlay",
    grabbable: false,
  });
  expect(overlay.selectedTarget).toEqual({
    id: "fixture-overlay-button",
    tagName: "button",
  });
});

test("crosses an open Shadow Root for hit testing, bounds and selector", async ({
  page,
}) => {
  await openFixture(page);
  await expect
    .poll(() => callApi<ElementProof>(page, "inspectShadow").then(Boolean))
    .toBe(true);
  const proof = await callApi<ElementProof>(page, "inspectShadow");
  const hit = await callApi<HitProof>(page, "hitShadow", [true]);

  expect(proof.id).toBe("fixture-shadow-button");
  expect(proof.selector).toContain(">>>");
  expect(proof.bounds.width).toBeGreaterThan(0);
  expect(proof.bounds.height).toBeGreaterThan(0);
  expect(hit.nativeTarget?.id).toBe("fixture-shadow-host");
  expect(hit.selectedTarget?.id).toBe("fixture-shadow-button");

  writeFileSync(
    path.join(evidenceRoot, "shadow-results.json"),
    `${JSON.stringify({ proof, hit }, null, 2)}\n`
  );
});

test("crosses a same-origin iframe and returns top-level bounds", async ({
  page,
}) => {
  await openFixture(page);
  await expect(
    page
      .frameLocator("#fixture-iframe")
      .locator("#fixture-iframe-button")
  ).toBeVisible();
  const proof = await callApi<ElementProof>(page, "inspectIframe");
  const hit = await callApi<HitProof>(page, "hitIframe", [true]);
  const frameBounds = await page.locator("#fixture-iframe").boundingBox();

  expect(proof.id).toBe("fixture-iframe-button");
  expect(proof.selector).toContain(">>iframe>>");
  expect(proof.bounds.width).toBeGreaterThan(0);
  expect(proof.bounds.height).toBeGreaterThan(0);
  expect(frameBounds).not.toBeNull();
  expect(proof.bounds.x).toBeGreaterThan(frameBounds!.x);
  expect(proof.bounds.y).toBeGreaterThan(frameBounds!.y);
  expect(proof.bounds.x + proof.bounds.width).toBeLessThan(
    frameBounds!.x + frameBounds!.width
  );
  expect(proof.bounds.y + proof.bounds.height).toBeLessThan(
    frameBounds!.y + frameBounds!.height
  );
  expect(hit.nativeTarget?.id).toBe("fixture-iframe");
  expect(hit.selectedTarget?.id).toBe("fixture-iframe-button");

  writeFileSync(
    path.join(evidenceRoot, "iframe-results.json"),
    `${JSON.stringify({ proof, hit, frameBounds }, null, 2)}\n`
  );
});

test("freezes, unfreezes and safely disposes baseline styles", async ({ page }) => {
  await openFixture(page);
  const result = await callApi<
    ReturnType<ReactGrabG01Api["freezeCycle"]>
  >(page, "freezeCycle");

  expect(result).toEqual({
    before: false,
    during: true,
    after: false,
    consoleErrors: [],
  });
  await page.screenshot({
    path: path.join(screenshotsRoot, "react-grab-g01-fixture.png"),
    fullPage: true,
  });
});
