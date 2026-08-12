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

const waitFrozen = async (
  page: import("@playwright/test").Page,
  expected: boolean,
  label: string
) => {
  let last: boolean | null = null;
  for (let i = 0; i < 50; i += 1) {
    last = await callApi<boolean>(page, "isFrozen");
    if (last === expected) return;
    await page.waitForTimeout(100);
  }
  throw new Error(`${label}: expected frozen=${expected} but stayed ${last}`);
};

const openFixture = async (page: import("@playwright/test").Page) => {
  await page.goto("./");
  await expect(page.locator("#fixture-ready")).toBeVisible();
  await expect(page.locator("#fixture-plain-button")).toBeVisible();
};

const expectSourceContext = (
  proof: ElementProof,
  expectedComponent: string
) => {
  expect(proof.filePath).not.toBeNull();
  expect(
    path.resolve(
      "e2e/react-grab-g01",
      proof.filePath!.replace(/\?.*$/, "")
    )
  ).toBe(path.resolve("e2e/react-grab-g01/fixture.tsx"));
  expect(proof.lineNumber).toEqual(expect.any(Number));
  expect(proof.lineNumber).toBeGreaterThan(0);
  expect(proof.columnNumber).toEqual(expect.any(Number));
  expect(proof.columnNumber).toBeGreaterThanOrEqual(0);
  expect(proof.filePath).not.toContain("node_modules");

  const componentEvidence = [
    proof.componentName,
    ...proof.stack.map((frame) => frame.componentName),
  ]
    .filter(Boolean)
    .join(" ");
  expect(componentEvidence).toContain(expectedComponent);
  expect(
    proof.stack.some(
      (frame) =>
        path.resolve(
          "e2e/react-grab-g01",
          frame.filePath.replace(/\?.*$/, "")
        ) === path.resolve("e2e/react-grab-g01/fixture.tsx") &&
        !frame.filePath.includes("node_modules")
    )
  ).toBe(true);
};

test.beforeAll(() => {
  mkdirSync(screenshotsRoot, { recursive: true });
});

test("exposes the repository-owned adapter without mounting the default UI", async ({
  page,
}) => {
  await openFixture(page);
  const surface = await callApi<Record<string, string>>(
    page,
    "engineSurface"
  );
  const ui = await callApi<ReturnType<ReactGrabG01Api["uiState"]>>(
    page,
    "uiState"
  );

  expect(Object.keys(surface).sort()).toEqual(
    [
      "freeze",
      "getBounds",
      "getTargetAtPoint",
      "getTargetsAtPoint",
      "inspect",
      "isFrozen",
      "resolveUsefulTarget",
      "unfreeze",
    ].sort()
  );
  expect(Object.values(surface)).toEqual(Array(8).fill("function"));
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

  // The deterministic semantic rule promotes to the nearest useful target,
  // and the adapter entry point agrees with the exported rule.
  expect(svg.selectedTarget).toEqual({
    id: "fixture-svg-button",
    tagName: "button",
  });
  expect(svg.engineTarget).toEqual(svg.selectedTarget);
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
  expect(plain.engineTarget).toEqual(plain.selectedTarget);
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
  expect(standalone.engineTarget).toEqual(standalone.selectedTarget);
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

test("freezes, unfreezes and stays clean through the adapter", async ({ page }) => {
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

// ===========================================================================
// Goal 04 — freeze lifecycle, hover/animation stability, region quality,
// and deterministic call-count budgets (real Chromium fixture).
// ===========================================================================

test("G04: capture modes freeze the page and every exit path unfreezes", async ({
  page,
}) => {
  await openFixture(page);
  await callApi(page, "setOverlayVisible", [false]);
  await callApi(page, "resetInspectionStats");

  // Entering Pick freezes AFTER the mode activates.
  await callApi(page, "startCaptureMode", ["pick"]);
  await waitFrozen(page, true, "pick entry");

  // Esc exits and unfreezes exactly.
  await callApi(page, "cancelCapture");
  await waitFrozen(page, false, "esc exit");

  // Re-entering after an exit works.
  await callApi(page, "startCaptureMode", ["pick"]);
  await waitFrozen(page, true, "pick re-entry");

  // A mode switch within capture keeps the freeze (still capturing).
  await callApi(page, "startCaptureMode", ["multi"]);
  await waitFrozen(page, true, "mode switch");
  await callApi(page, "cancelCapture");
  await waitFrozen(page, false, "esc exit 2");

  // Toolbar collapse unfreezes (listeners pause, no invisible freeze).
  await callApi(page, "startCaptureMode", ["pick"]);
  await waitFrozen(page, true, "pick entry 3");
  await callApi(page, "collapseToolbar");
  await waitFrozen(page, false, "collapse exit");
  // Re-expanding the toolbar resumes the PENDING pick session (AC5 pause
  // semantics, not a mode reset) — the freeze follows the resumed flow.
  await callApi(page, "expandToolbar");
  await waitFrozen(page, true, "re-expand resumes pick");
  await callApi(page, "cancelCapture");
  await waitFrozen(page, false, "cancel exits resumed pick");

  // Browser exit (pagehide) unfreezes.
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await waitFrozen(page, false, "pagehide exit");
  await callApi(page, "cancelCapture");
});

test("G04: Studio controls remain interactive while the page is frozen", async ({
  page,
}) => {
  await openFixture(page);
  await callApi(page, "setOverlayVisible", [false]);
  await callApi(page, "startCaptureMode", ["pick"]);
  await expect.poll(() => callApi(page, "isFrozen")).toBe(true);
  // The Studio host regains pointer events during freeze: opening the
  // shortcut-help panel from the toolbar must work.
  await page
    .locator("[data-portal-studio-root] button[aria-label='Keyboard shortcuts']")
    .click();
  await expect(
    page.locator("[data-portal-studio-root] #ps-shortcut-help")
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await callApi(page, "cancelCapture");
  await expect.poll(() => callApi(page, "isFrozen")).toBe(false);
});

test("G04: hover-only popover remains visible and annotatable during Pick", async ({
  page,
}) => {
  await openFixture(page);
  await callApi(page, "setOverlayVisible", [false]);
  const triggerCenter = await callApi<{ x: number; y: number }>(
    page,
    "mouseMoveTo",
    ["fixture-hover-trigger"]
  );
  await page.mouse.move(triggerCenter.x, triggerCenter.y);
  await expect
    .poll(() => callApi(page, "hoverState").then((state) => state.popoverVisible))
    .toBe(true);

  await callApi(page, "startCaptureMode", ["pick"]);
  await expect.poll(() => callApi(page, "isFrozen")).toBe(true);
  // The hover-only menu stays open while the page is frozen.
  const popover = await callApi<
    { popoverVisible: boolean }
  >(page, "hoverState");
  expect(popover.popoverVisible).toBe(true);
  // The trigger itself is annotatable: engine hit testing still resolves it.
  const hit = await callApi(page, "hit", ["fixture-hover-trigger", true]);
  expect(hit.selectedTarget?.id).toBe("fixture-hover-trigger");
  await callApi(page, "cancelCapture");
  await expect.poll(() => callApi(page, "isFrozen")).toBe(false);
});

test("G04: CSS/JS animation targets stay stable during capture and resume", async ({
  page,
}) => {
  await openFixture(page);
  await callApi(page, "setOverlayVisible", [false]);
  const readCss = async () =>
    (await callApi<{ opacity: number }>(page, "cssAnimationState")).opacity;
  const readJs = async () =>
    (await callApi<{ x: number }>(page, "jsAnimationState")).x;

  await callApi(page, "startCaptureMode", ["pick"]);
  await expect.poll(() => callApi(page, "isFrozen")).toBe(true);
  const styleState = await page.evaluate(() => {
    const style = document.getElementById("portal-studio-freeze-safe");
    const pause = style
      ? style.textContent?.includes("animation-play-state") ?? false
      : false;
    const anim = getComputedStyle(
      document.getElementById("fixture-css-animation")!
    ).animationPlayState;
    return { pauseRule: pause, playState: anim };
  });
  expect(styleState.pauseRule).toBe(true);
  expect(styleState.playState).toBe("paused");

  // Stability within the frozen window: the animation may legitimately move
  // between the pre-freeze read and the freeze moment, but once frozen the
  // value must not change while the capture mode is active.
  const cssFrozen1 = await readCss();
  const jsFrozen1 = await readJs();
  await page.waitForTimeout(700);
  expect(await readCss()).toBe(cssFrozen1);
  expect(await readJs()).toBe(jsFrozen1);

  await callApi(page, "cancelCapture");
  await expect.poll(() => callApi(page, "isFrozen")).toBe(false);
  await page.waitForTimeout(700);
  // Resumed: both animations move again.
  expect(await readJs()).not.toBe(jsFrozen1);
  expect(await readCss()).not.toBe(cssFrozen1);
});

test("G04: pointermove performs zero source-context inspections", async ({
  page,
}) => {
  await openFixture(page);
  await callApi(page, "setOverlayVisible", [false]);
  await callApi(page, "resetInspectionStats");
  await callApi(page, "startCaptureMode", ["pick"]);
  await expect.poll(() => callApi(page, "isFrozen")).toBe(true);
  // Move across several fixture targets while picking.
  for (const selector of [
    "#fixture-plain-button",
    "#fixture-memo-button",
    "#fixture-svg-button",
    "#fixture-hover-trigger",
  ]) {
    const box = await page.locator(selector).boundingBox();
    if (!box) throw new Error(`missing ${selector}`);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(60);
  }
  const calls = await callApi<number>(page, "inspectionStats");
  expect(calls).toBe(0);
  await callApi(page, "cancelCapture");
  await expect.poll(() => callApi(page, "isFrozen")).toBe(false);
});

test("G04: one Pick commit performs exactly one inspection", async ({
  page,
}) => {
  await openFixture(page);
  await callApi(page, "setOverlayVisible", [false]);
  await callApi(page, "resetInspectionStats");
  await callApi(page, "startCaptureMode", ["pick"]);
  await expect.poll(() => callApi(page, "isFrozen")).toBe(true);
  const button = page.locator("#fixture-plain-button");
  const center = await callApi<{ x: number; y: number }>(
    page,
    "mouseMoveTo",
    ["fixture-plain-button"]
  );
  await page.mouse.move(center.x, center.y);
  await callApi(page, "clickTargetAt", ["fixture-plain-button"]);
  await expect(
    page
      .locator("[data-portal-studio-root]")
      .getByRole("dialog", { name: "Annotation" })
  ).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator("[data-portal-studio-root]")
        .getByRole("button", { name: "Save", exact: true })
        .isEnabled()
    )
    .toBe(true);
  expect(await callApi<number>(page, "inspectionStats")).toBe(1);
  await callApi(page, "cancelCapture");
  await expect.poll(() => callApi(page, "isFrozen")).toBe(false);
});

test("G04: one Multi commit performs one inspection per distinct target", async ({
  page,
}) => {
  await openFixture(page);
  await callApi(page, "setOverlayVisible", [false]);
  await callApi(page, "resetInspectionStats");
  await callApi(page, "startCaptureMode", ["multi"]);
  await expect.poll(() => callApi(page, "isFrozen")).toBe(true);
  const firstCenter = await callApi<{ x: number; y: number }>(
    page,
    "mouseMoveTo",
    ["fixture-plain-button"]
  );
  await page.mouse.move(firstCenter.x, firstCenter.y);
  await callApi(page, "clickTargetAt", ["fixture-plain-button"]);
  const secondCenter = await callApi<{ x: number; y: number }>(
    page,
    "mouseMoveTo",
    ["fixture-memo-button"]
  );
  await page.mouse.move(secondCenter.x, secondCenter.y);
  await callApi(page, "clickTargetAt", ["fixture-memo-button"]);
  await page.keyboard.press("Enter");
  await expect(
    page
      .locator("[data-portal-studio-root]")
      .getByRole("dialog", { name: "Annotation" })
  ).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator("[data-portal-studio-root]")
        .getByRole("button", { name: "Save", exact: true })
        .isEnabled()
    )
    .toBe(true);
  expect(await callApi<number>(page, "inspectionStats")).toBe(2);
  await callApi(page, "cancelCapture");
  await expect.poll(() => callApi(page, "isFrozen")).toBe(false);
});

test("G04: Area sampling respects the 69-point and 50-target caps", async ({
  page,
}) => {
  await openFixture(page);
  await callApi(page, "setOverlayVisible", [false]);
  await page.locator("#fixture-dashboard").scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const dashboard = await page.locator("#fixture-dashboard").boundingBox();
  expect(dashboard).not.toBeNull();
  const sampled = await callApi<{
    points: number;
    targets: number;
    ids: string[];
  }>(page, "sampleRegion", [
    {
      x: dashboard!.x,
      y: dashboard!.y,
      width: dashboard!.width,
      height: dashboard!.height,
    },
  ]);
  expect(sampled.points).toBeLessThanOrEqual(69);
  expect(sampled.targets).toBeLessThanOrEqual(50);
  // No duplicates in the result; the dashboard tiles are the semantic
  // targets (the deterministic grid samples the region, so the tile count
  // is layout-aligned — the hard gates are the caps above).
  const unique = new Set(sampled.ids);
  expect(unique.size).toBe(sampled.ids.length);
  expect(
    sampled.ids.filter((id) => id.startsWith("fixture-tile-")).length
  ).toBeGreaterThanOrEqual(1);
});

test("G04: nested-card fixtures produce semantic targets, not wrapper explosion", async ({
  page,
}) => {
  await openFixture(page);
  await callApi(page, "setOverlayVisible", [false]);
  await page.locator(".fixture-region-cards").scrollIntoViewIfNeeded();
  await page.locator("#fixture-nested-section").scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const cards = await page.locator(".fixture-region-cards").boundingBox();
  const nested = await page.locator("#fixture-nested-section").boundingBox();
  expect(cards).not.toBeNull();
  expect(nested).not.toBeNull();

  const cardSample = await callApi<{ ids: string[] }>(page, "sampleRegion", [
    { x: cards!.x, y: cards!.y, width: cards!.width, height: cards!.height },
  ]);
  // The semantic cards (or their actions) are the sampled targets — the
  // layout-only page/root wrappers never dominate the region output.
  const cardIds = cardSample.ids.filter((id) => id.startsWith("fixture-card-"));
  expect(cardIds.length).toBeGreaterThanOrEqual(2);
  expect(new Set(cardIds).size).toBe(cardIds.length);

  const nestedSample = await callApi<
    { ids: string[]; centerStack: string[]; nativeCenter: string | null }
  >(page, "sampleRegion", [
    { x: nested!.x, y: nested!.y, width: nested!.width, height: nested!.height },
  ]);
  console.log("nested rect:", JSON.stringify(nested));
  console.log("nested center:", JSON.stringify({ stack: nestedSample.centerStack, native: nestedSample.nativeCenter }));
  // Identical-text wrappers are pruned; the deep button survives.
  expect(nestedSample.ids).toContain("fixture-nested-button");
  expect(nestedSample.ids).not.toContain("fixture-nested-1");
  expect(nestedSample.ids).not.toContain("fixture-nested-2");
  expect(nestedSample.ids).not.toContain("fixture-nested-3");
});

test("G04: adjacent table cells remain distinct", async ({ page }) => {
  await openFixture(page);
  await callApi(page, "setOverlayVisible", [false]);
  await page.locator(".fixture-region-table").scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const table = await page.locator(".fixture-region-table").boundingBox();
  expect(table).not.toBeNull();
  const sampled = await callApi<{ ids: string[] }>(page, "sampleRegion", [
    { x: table!.x, y: table!.y, width: table!.width, height: table!.height },
  ]);
  const cellIds = sampled.ids.filter((id) => id.startsWith("fixture-cell-"));
  const unique = new Set(cellIds);
  expect(unique.size).toBe(cellIds.length);
  expect(cellIds.length).toBeGreaterThanOrEqual(3);
});
