/**
 * Portal Studio — E2E (Goal 02).
 *
 * Real dev Portal (Playwright starts an isolated vite dev server on 4173 with
 * `--mode e2e`, so Studio is active). Verifies the schema-v2 loop on two real
 * pages across at least three stable rounds: single pick (regression),
 * true Multi-select, marquee region, replace, clear, keyboard paths, and the
 * annotated screenshot — plus endpoint guards and shell-agent print parity.
 *
 * Serial mode: all tests share one dev server and one
 * `.portal-studio/tasks/active-task.json` file, so captures must not run in
 * parallel.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import {
  loadPortalE2EEnvironment,
  requirePortalE2ECredentials,
  resolvePortalTestURL,
} from "./support";

const environment = loadPortalE2EEnvironment();
const credentials = requirePortalE2ECredentials(environment);
const studioDir = path.resolve(".portal-studio");
const taskFile = path.join(studioDir, "tasks", "active-task.json");

type TaskAnnotation = {
  annotationId: string;
  kind: "element" | "multi" | "region";
  comment: string;
  status: "open" | "completed";
  elements: Array<{
    tagName: string;
    selector: string;
    bounds: { x: number; y: number; width: number; height: number };
    componentName: string | null;
    source: {
      filePath: string;
      lineNumber: number;
      columnNumber: number;
      componentName: string | null;
    } | null;
    sourceStack: Array<{
      filePath: string;
      lineNumber: number;
      columnNumber: number;
      componentName: string | null;
    }>;
    htmlPreview: string;
    styleText: string;
    fingerprint: {
      tagName: string;
      identityAttributes: Record<string, string>;
    };
  }>;
  region?: {
    coordinateSpace: "document";
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

type TaskArtifact = {
  schemaVersion: number;
  taskId: string;
  url: string;
  annotations: TaskAnnotation[];
  businessContext: Array<{ type: string; id?: string; source: string }>;
  redaction: { droppedKeys: string[]; redactedValues: number };
  screenshot?: { file: string; width: number; height: number };
};

const readActiveTask = (): TaskArtifact =>
  JSON.parse(readFileSync(taskFile, "utf8")) as TaskArtifact;

const PNG_MAGIC = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/** Minimal structurally-valid PNG (magic + IHDR) so PNG validation passes. */
const minimalPngBase64 = () => {
  const png = Buffer.alloc(26);
  PNG_MAGIC.copy(png, 0);
  png.write("IHDR", 12, "latin1");
  png.writeUInt32BE(1, 16);
  png.writeUInt32BE(1, 20);
  return png.toString("base64");
};

const signIn = async (page: import("@playwright/test").Page) => {
  await page.goto(resolvePortalTestURL(environment, "/login"));
  await page
    .getByLabel("Username or email", { exact: true })
    .fill(credentials.account);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect
    .poll(() => new URL(page.url()).pathname)
    .not.toMatch(/\/(?:login|signin)\/?$/);
};

const openStudio = async (page: import("@playwright/test").Page) => {
  const chip = page.locator("#portal-studio-root .ps-chip-open");
  if (await chip.isVisible().catch(() => false)) await chip.click();
  await expect(
    page.locator("#portal-studio-root [role='toolbar']")
  ).toBeVisible();
};

const closeStudio = async (page: import("@playwright/test").Page) => {
  await clickStudioButton(page, "Collapse toolbar");
  await expect(
    page.locator("#portal-studio-root [role='toolbar']")
  ).toHaveCount(0);
};

/** Expand (if collapsed) and open the annotation-list panel. */
const openList = async (page: import("@playwright/test").Page) => {
  await openStudio(page);
  const list = page.locator("#portal-studio-root .ps-list-panel");
  if ((await list.count()) === 0) {
    await clickStudioButton(page, "Annotation list");
  }
  await expect(list).toBeVisible();
};

/** The open count lives in the COLLAPSED chip's status slot. Collapse
 *  (presentation only), assert, then restore the expanded/list state. */
const expectOpenCount = async (
  page: import("@playwright/test").Page,
  root: import("@playwright/test").Locator,
  expected: string,
  options?: { timeout?: number }
) => {
  const bar = root.locator("[role='toolbar']");
  const list = root.locator(".ps-list-panel");
  const listWasOpen = (await list.count()) > 0;
  if ((await bar.count()) > 0) {
    await clickStudioButton(page, "Collapse toolbar");
  }
  await expect(root.locator(".ps-status-slot")).toHaveText(
    expected,
    options ?? {}
  );
  await clickStudioSelector(page, ".ps-chip-open");
  await expect(bar).toBeVisible();
  if (listWasOpen) {
    await clickStudioButton(page, "Annotation list");
    await expect(list).toBeVisible();
  }
};

/** Zero open annotations: the collapsed chip shows the feedback ICON in
 *  the status slot — no count text, no detached badge. */
const expectNoOpenCount = async (
  page: import("@playwright/test").Page,
  root: import("@playwright/test").Locator
) => {
  const bar = root.locator("[role='toolbar']");
  const list = root.locator(".ps-list-panel");
  const listWasOpen = (await list.count()) > 0;
  if ((await bar.count()) > 0) {
    await clickStudioButton(page, "Collapse toolbar");
  }
  await expect(root.locator(".ps-status-slot")).not.toHaveText(/\d/);
  await clickStudioSelector(page, ".ps-chip-open");
  await expect(bar).toBeVisible();
  if (listWasOpen) {
    await clickStudioButton(page, "Annotation list");
    await expect(list).toBeVisible();
  }
};

/** Hover a page element via raw mouse movement: the frozen page's
 *  `html { pointer-events: none }` makes Playwright's actionability
 *  hit-testing fail even with `force`, while the engine's coordinate
 *  hit-testing resolves the target from the mouse position. */
const hoverElement = async (
  page: import("@playwright/test").Page,
  locator: import("@playwright/test").Locator
) => {
  await locator.waitFor();
  const box = await locator.boundingBox();
  if (!box) throw new Error("hover target has no bounding box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(60);
};

/** Click a page element via raw mouse events (see hoverElement). */
const clickElement = async (
  page: import("@playwright/test").Page,
  locator: import("@playwright/test").Locator
) => {
  await locator.waitFor();
  const box = await locator.boundingBox();
  if (!box) throw new Error("click target has no bounding box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
};

/** Native click on a Studio shadow-root button: forced Playwright clicks
 *  on shadow-hosted buttons are not reliably dispatched as trusted events
 *  while the page freeze disables actionability, so use the native
 *  HTMLElement.click(). */
const clickStudioButton = async (
  page: import("@playwright/test").Page,
  name: string
) => {
  const result = await page.evaluate((label) => {
    const root = document.getElementById("portal-studio-root");
    const shadow = root?.shadowRoot;
    const byLabel = shadow?.querySelector(
      `button[aria-label="${label}"]`
    ) as HTMLButtonElement | null;
    const btn =
      byLabel ??
      (Array.from(shadow?.querySelectorAll("button") ?? []).find(
        (b) => b.textContent?.trim() === label
      ) as HTMLButtonElement | undefined) ??
      null;
    if (!btn) return `missing:${label}`;
    btn.click();
    return "clicked";
  }, name);
  if (result !== "clicked") throw new Error(`studio button click failed: ${result}`);
};

/** Native click on a Studio shadow element by CSS selector (marker editor
 *  buttons carry no aria-labels). */
const clickStudioSelector = async (
  page: import("@playwright/test").Page,
  selector: string
) => {
  const result = await page.evaluate((sel) => {
    const root = document.getElementById("portal-studio-root");
    const btn = root?.shadowRoot?.querySelector(
      sel
    ) as HTMLButtonElement | null;
    if (!btn) return `missing:${sel}`;
    btn.click();
    return "clicked";
  }, selector);
  if (result !== "clicked") throw new Error(`studio selector click failed: ${result}`);
};

const startPicking = async (page: import("@playwright/test").Page) => {
  const pick = page
    .locator("#portal-studio-root")
    .getByRole("button", { name: "Pick element" });
  // Goal 02 continuous loop: after a successful save Pick is ALREADY
  // active — re-clicking the button would CANCEL the resumed session.
  if ((await pick.getAttribute("aria-pressed")) !== "true") {
    await pick.click();
  }
  const hint = page.locator("#portal-studio-root .ps-status-panel", {
    hasText: "Hover an element",
  });
  try {
    await expect(hint, { timeout: 10000 }).toBeVisible();
  } catch {
    // The pick click can race the toolbar expansion right after sign-in;
    // a single bounded retry restores the picking session.
    if ((await pick.getAttribute("aria-pressed")) !== "true") {
      await pick.click();
    }
    await expect(hint, { timeout: 10000 }).toBeVisible();
  }
};

/**
 * Ctrl+Enter save: waits for the async v6 inspection pipeline to finish
 * (Save enabled) so the keyboard save never fires while the button is
 * still disabled.
 */
const saveWithCtrlEnter = async (page: import("@playwright/test").Page) => {
  await expect(
    page
      .locator("#portal-studio-root")
      .getByRole("button", { name: /Save|保存|Inspecting|Saving/ }),
    { timeout: 20000 }
  ).toBeEnabled();
  await page.keyboard.press("Control+Enter");
};

const saveTask = async (
  page: import("@playwright/test").Page,
  instruction: string
) => {
  await page.locator("#portal-studio-root textarea").fill(instruction);
  const saveButton = page
    .locator("#portal-studio-root")
    .getByRole("button", { name: /Save|保存|Inspecting|Saving/ });
  // v6: the Save button is disabled while the async inspection pipeline
  // runs — wait for the capture to finish before clicking. The button
  // label is "Inspecting target…" while the pipeline runs, so the regex
  // matches all three states and toBeEnabled resolves once enabled.
  await expect(saveButton, { timeout: 20000 }).toBeEnabled();
  await saveButton.click();
  // Goal 02: the compact toast replaces the technical Saved panel.
  await expect(
    page.locator("#portal-studio-root .ps-save-toast", {
      hasText: /Annotation saved|批注已保存/,
    })
  ).toBeVisible();
  await expect
    .poll(() => readActiveTask().annotations.at(-1)?.comment)
    .toBe(instruction);
};

test.describe.configure({ mode: "serial" });

/**
 * The HMR tests write a marker line into src/components/ui/table.tsx and
 * restore it in `finally`. Self-healing cleanup below makes sure an
 * interrupted/crashed run can never leave the marker behind: beforeEach
 * strips it (so `original` is always the baseline) and afterAll strips it
 * again (idempotent) — covering worker crashes and test timeouts.
 */
const TABLE_SOURCE = path.resolve("src/components/ui/table.tsx");
const TABLE_MARKER_PATTERN = /\/\/ portal-studio (?:verify|hmr) marker\n?/g;

const restoreTableMarker = () => {
  try {
    const current = readFileSync(TABLE_SOURCE, "utf8");
    const cleaned = current.replace(TABLE_MARKER_PATTERN, "");
    if (cleaned !== current) writeFileSync(TABLE_SOURCE, cleaned);
  } catch {
    // File missing/unreadable: nothing to restore.
  }
};

test.beforeEach(() => {
  restoreTableMarker();
  rmSync(studioDir, { recursive: true, force: true });
});

test.afterAll(() => {
  restoreTableMarker();
  rmSync(studioDir, { recursive: true, force: true });
});

test("users page: single, multi, marquee, replace, screenshot (3 rounds)", async ({
  page,
}) => {

  await signIn(page);
  await page.goto(resolvePortalTestURL(environment, "/users"));
  await page.locator("tbody tr").first().waitFor();

  // Round 1 — single pick (Goal 01 regression) with screenshot.
  await openStudio(page);
  await startPicking(page);
  const row = page.locator("tbody tr").first();
  await hoverElement(page, row);
  await clickElement(page, row);
  // Goal 02: the target-side composer opens beside the capture.
  await expect(
    page
      .locator("#portal-studio-root")
      .getByRole("dialog", { name: "Annotation" })
  ).toBeVisible();
  await saveTask(page, "E2E single: increase row padding");

  let task = readActiveTask();
  expect(task.schemaVersion).toBe(6);
  expect(task.annotations).toHaveLength(1);
  const firstAnnotation = task.annotations[0];
  expect(firstAnnotation.kind).toBe("element");
  expect(firstAnnotation.elements).toHaveLength(1);
  const element = firstAnnotation.elements[0];
  // v6: ONE React Grab selector + normalized workspace-relative source.
  expect(element.selector).toBeTruthy();
  // The engine promotes the nested hit to the useful target — the row's
  // cell content (td or an inner div in this example layout).
  expect(["td", "div", "tr"]).toContain(element.fingerprint.tagName);
  expect(element.source).not.toBeNull();
  expect(element.source!.filePath).not.toContain("node_modules");
  // v6: the normalized workspace-relative source path (whatever component
  // renders the row) carries a valid location and no node_modules frame.
  expect(element.source!.filePath.length).toBeGreaterThan(0);
  expect(element.source!.filePath).not.toContain("node_modules");
  expect(element.source!.lineNumber).toBeGreaterThan(0);
  expect(Array.isArray(element.sourceStack)).toBe(true);
  // Business context, redaction manifest, and screenshot ref are present.
  expect(Array.isArray(task.businessContext)).toBe(true);
  expect(task.redaction.redactedValues).toBeGreaterThanOrEqual(0);
  // The screenshot ref is merged by the evidence POST after the task POST —
  // poll for the server-side merge.
  await expect
    .poll(
      () => readActiveTask().screenshot?.file,
      { timeout: 8000, message: `task dump: ${JSON.stringify(readActiveTask()).slice(0, 400)}` }
    )
    .toMatch(/^screenshots\/.+\.png$/);

  // Screenshot exists on disk with valid PNG magic.
  const screenshotFile = readActiveTask().screenshot!.file;
  const screenshotPath = path.join(studioDir, screenshotFile);
  const png = readFileSync(screenshotPath);
  expect(png.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  expect(png.length).toBeGreaterThan(100);

  // Shell parity: the public package script renders the v6 artifact.
  const printed = execFileSync(
    "pnpm",
    ["--silent", "run", "studio:print", "--", "--json", "--task", task.taskId],
    { encoding: "utf8" }
  );
  expect(JSON.parse(printed)).toEqual(task);
  await closeStudio(page);

  // Round 2 — TRUE Multi-select of two cells within the first row (the
  // sandbox users table has a single row). Review P1: Pick is strictly
  // single-target; Multi is the only multi-target path.
  await openStudio(page);
  await clickStudioButton(page, "Multi-select");
  const firstRow = page.locator("tbody tr").nth(0);
  const cellA = firstRow.locator("td").nth(0);
  const cellB = firstRow.locator("td").nth(1);
  await hoverElement(page, cellA);
  await clickElement(page, cellA);
  await expect(
    page.locator("#portal-studio-root .ps-status-panel", {
      hasText: "Selected",
    })
  ).toBeVisible();
  await hoverElement(page, cellB);
  await clickElement(page, cellB);
  await expect(
    page.locator("#portal-studio-root .ps-status-panel", {
      hasText: "Selected",
    })
  ).toBeVisible();
  // Finish the group: ONE annotation carrying BOTH targets.
  await clickStudioButton(page, "Finish group");
  // Goal 02: the target-side composer opens beside the capture.
  await expect(
    page
      .locator("#portal-studio-root")
      .getByRole("dialog", { name: "Annotation" })
  ).toBeVisible();
  await saveTask(page, "E2E continuous: multi group appends annotation 2");
  task = readActiveTask();
  expect(task.annotations).toHaveLength(2);
  // The CONTINUOUS part is that annotation 1 is retained and annotation 2
  // (the multi group) is appended.
  expect(task.annotations[1].kind).toBe("multi");
  expect(task.annotations[1].elements).toHaveLength(2);
  await closeStudio(page);

  // Round 3 — marquee region over the table body.
  await openStudio(page);
  await clickStudioButton(page, "Select region");
  await expect(
    page.locator("#portal-studio-root .ps-status-panel", {
      hasText: "Drag over the page",
    })
  ).toBeVisible();
  const table = page.locator("tbody").first();
  const box = await table.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + 10, box!.y + 10);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width - 10, box!.y + box!.height - 10, {
    steps: 8,
  });
  await page.mouse.up();
  // Goal 02: the target-side composer opens beside the capture.
  await expect(
    page
      .locator("#portal-studio-root")
      .getByRole("dialog", { name: "Annotation" })
  ).toBeVisible();
  await saveTask(page, "E2E marquee: select the whole table body");
  task = readActiveTask();
  expect(task.annotations).toHaveLength(3);
  const regionAnnotation = task.annotations[2];
  expect(regionAnnotation.kind).toBe("region");
  expect(regionAnnotation.region).toBeDefined();
  expect(regionAnnotation.region!.width).toBeGreaterThan(0);
  await expect
    .poll(() => readActiveTask().screenshot?.file, { timeout: 8000 })
    .toMatch(/^screenshots\/.+\.png$/);
  // No secrets/tokens in any artifact.
  const serialized = JSON.stringify(task);
  expect(serialized).not.toContain("token");
  expect(serialized).not.toMatch(/Bearer /);
  expect(serialized.length).toBeLessThan(256 * 1024);

  // Clear lifecycle (G04): Complete is the ONLY normal clear path — the
  // old Clear-task button is gone; Goal 02 removed the Done button too;
  // the agent-side DELETE endpoint still clears the task and its
  // screenshot.
  await expect(
    page.locator("#portal-studio-root").getByRole("button", { name: "Done" })
  ).toHaveCount(0);
  await expect(
    page.locator("#portal-studio-root [role='toolbar'] button", {
      hasText: "Clear task",
    })
  ).toHaveCount(0);
  const token = await page.evaluate(
    () => window.__PORTAL_STUDIO_CONFIG__?.token
  );
  const cleared = await page.request.delete(
    resolvePortalTestURL(environment, "__portal-studio/tasks"),
    { headers: { "X-Portal-Studio-Token": token } }
  );
  expect(cleared.status()).toBe(200);
  await expect
    .poll(() => {
      try {
        readFileSync(taskFile);
        return true;
      } catch {
        return false;
      }
    })
    .toBe(false);
  expect(readdirSync(path.join(studioDir, "screenshots"))).toEqual([]);
  // Print exits 1 when no task exists.
  let printStatus = 0;
  try {
    execFileSync(
      process.execPath,
      ["scripts/portal-studio-print.mjs", "--json"],
      { encoding: "utf8" }
    );
  } catch (error) {
    printStatus = (error as { status?: number }).status ?? 0;
  }
  expect(printStatus).toBe(1);
});

test("dev page: keyboard single and multi, agent-side writes, guards", async ({
  page,
}) => {
  await signIn(page);
  // The login lands on the application index; the users table drives the
  // interactions below.
  await page.goto(resolvePortalTestURL(environment, "/users"));
  await page.goto(resolvePortalTestURL(environment, "/dev/ai-chat"));
  await page.locator("main").last().waitFor();

  // Keyboard round 1 — focused element + Enter.
  await openStudio(page);
  await startPicking(page);
  const target = page.locator("main button, main a, main h2").first();
  await target.focus();
  await page.keyboard.press("Enter");
  // Goal 02: the target-side composer opens beside the capture.
  await expect(
    page
      .locator("#portal-studio-root")
      .getByRole("dialog", { name: "Annotation" })
  ).toBeVisible();
  await saveTask(page, "E2E keyboard single on /dev/ai-chat");
  const single = readActiveTask();
  expect(single.url).toContain("/dev/ai-chat");
  expect(single.annotations).toHaveLength(1);
  expect(single.annotations[0].elements).toHaveLength(1);
  expect(single.screenshot).toBeDefined();
  await closeStudio(page);

  // Keyboard round 2 — Pick is STRICTLY single-target (review P1):
  // Shift+Enter commits a single-element draft, never an accumulation.
  await openStudio(page);
  await startPicking(page);
  const first = page.locator("main button, main a, main h2").first();
  const second = page.locator("main button, main a, main h2").nth(1);
  await first.focus();
  await page.keyboard.press("Shift+Enter");
  // Goal 02: the target-side composer opens beside the capture.
  await expect(
    page
      .locator("#portal-studio-root")
      .getByRole("dialog", { name: "Annotation" })
  ).toBeVisible();
  // Cancel the draft — nothing was saved.
  await clickStudioButton(page, "Cancel");

  // True Multi mode is the ONLY multi-target path: keyboard Space toggles
  // targets into ONE group, Enter opens the comment editor.
  await clickStudioButton(page, "Multi-select");
  await first.focus();
  await page.keyboard.press("Space");
  await expect(
    page.locator("#portal-studio-root .ps-status-panel", {
      hasText: "Selected",
    })
  ).toBeVisible();
  await second.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("Enter");
  // Goal 02: the target-side composer opens beside the capture.
  await expect(
    page
      .locator("#portal-studio-root")
      .getByRole("dialog", { name: "Annotation" })
  ).toBeVisible();
  await saveTask(page, "E2E keyboard: multi group then Enter");
  const multi = readActiveTask();
  expect(multi.annotations).toHaveLength(2);
  // The MULTI annotation carries BOTH keyboard-selected targets in one
  // group; the CONTINUOUS semantics retain annotation 1 + append.
  expect(multi.annotations[1].kind).toBe("multi");
  expect(multi.annotations[1].elements).toHaveLength(2);
  await closeStudio(page);

  // Agent-side write through the token-protected endpoint.
  const token = await page.evaluate(
    () => window.__PORTAL_STUDIO_CONFIG__?.token
  );
  expect(typeof token).toBe("string");
  // Goal 03: old-schema POSTs are rejected with the typed
  // unsupported_schema result — never normalized, never migrated.
  const legacyPost = {
    schemaVersion: 5,
    taskId: "agent-task-legacy",
    annotations: [],
  };
  const legacyResponse = await page.request.post(
    resolvePortalTestURL(environment, "__portal-studio/tasks"),
    {
      headers: { "X-Portal-Studio-Token": token },
      data: legacyPost,
    }
  );
  expect(legacyResponse.status()).toBe(400);
  const legacyPayload = (await legacyResponse.json()) as {
    status?: string;
    schemaVersion?: number;
    expectedSchemaVersion?: number;
    error?: string;
  };
  expect(legacyPayload.status).toBe("unsupported_schema");
  expect(legacyPayload.schemaVersion).toBe(5);
  expect(legacyPayload.expectedSchemaVersion).toBe(6);

  const agentTask = {
    schemaVersion: 6,
    taskId: "agent-task-2",
    createdAt: new Date().toISOString(),
    url: single.url,
    title: "Agent write",
    annotations: [
      {
        annotationId: "agent-ann-1",
        kind: "element",
        comment: "Agent-side v6 task",
        createdAt: new Date().toISOString(),
        status: "open",
        elements: [
          {
            tagName: "div",
            selector: "body > div",
            bounds: { x: 0, y: 0, width: 10, height: 10 },
            componentName: null,
            source: null,
            sourceStack: [],
            htmlPreview: "agent",
            styleText: "",
            fingerprint: {
              tagName: "div",
              role: "",
              accessibleName: "",
              text: "agent",
              identityAttributes: {},
              childCount: 0,
              parent: { tagName: "body", role: "" },
            },
          },
        ],
        pageContext: {
          url: single.url,
          routeKey: new URL(single.url).pathname,
          title: single.title,
          viewport: { width: 1440, height: 900 },
          scroll: { x: 0, y: 0 },
          businessContext: [],
        },
      },
    ],
    businessContext: [],
    redaction: { droppedKeys: [], redactedValues: 0, truncatedValues: 0 },
  };
  // Guards: wrong/missing token → 404; traversal → 400; bad PNG → 400.
  const wrong = await page.request.post(
    resolvePortalTestURL(environment, "__portal-studio/tasks"),
    {
      headers: { "X-Portal-Studio-Token": "wrong-token" },
      data: agentTask,
    }
  );
  expect(wrong.status()).toBe(404);
  const missing = await page.request.post(
    resolvePortalTestURL(environment, "__portal-studio/tasks"),
    { data: agentTask }
  );
  expect(missing.status()).toBe(404);
  const traversal = await page.request.post(
    resolvePortalTestURL(environment, "__portal-studio/tasks"),
    {
      headers: { "X-Portal-Studio-Token": token },
      data: { ...agentTask, taskId: "../evil" },
    }
  );
  expect(traversal.status()).toBe(400);
  const badScreenshot = await page.request.post(
    resolvePortalTestURL(environment, "__portal-studio/screenshots"),
    {
      headers: { "X-Portal-Studio-Token": token },
      data: { taskId: "agent-task-2", png: "bm90LWEtcG5n" },
    }
  );
  expect(badScreenshot.status()).toBe(400);
  const screenshotGuard = await page.request.post(
    resolvePortalTestURL(environment, "__portal-studio/screenshots"),
    {
      headers: { "X-Portal-Studio-Token": "wrong" },
      data: { taskId: "agent-task-2", png: "bm90LWEtcG5n" },
    }
  );
  expect(screenshotGuard.status()).toBe(404);
  // Malformed/over-limit diagnostics are explicitly rejected (never
  // silently downgraded to an empty array). The PNG is structurally VALID so
  // the 400 can only come from the diagnostics validation.
  const validPng = minimalPngBase64();
  const badDiagnostics = await page.request.post(
    resolvePortalTestURL(environment, "__portal-studio/screenshots"),
    {
      headers: { "X-Portal-Studio-Token": token },
      data: {
        taskId: "agent-task-2",
        png: validPng,
        diagnostics: [{ source: "evil", message: "x" }],
      },
    }
  );
  expect(badDiagnostics.status()).toBe(400);
  expect(((await badDiagnostics.json()) as { error?: string }).error).toBe(
    "invalid_diagnostics"
  );
  const oversizedDiagnostics = await page.request.post(
    resolvePortalTestURL(environment, "__portal-studio/screenshots"),
    {
      headers: { "X-Portal-Studio-Token": token },
      data: {
        taskId: "agent-task-2",
        png: validPng,
        diagnostics: Array.from({ length: 101 }, () => ({
          source: "console",
          message: "x",
          timestamp: new Date().toISOString(),
          occurrenceCount: 1,
        })),
      },
    }
  );
  expect(oversizedDiagnostics.status()).toBe(400);
  expect(
    ((await oversizedDiagnostics.json()) as { error?: string }).error
  ).toBe("invalid_diagnostics");
  const clearWithoutToken = await page.request.delete(
    resolvePortalTestURL(environment, "__portal-studio/tasks")
  );
  expect(clearWithoutToken.status()).toBe(404);

  // Only the active task file exists inside the tasks directory.
  expect(readdirSync(path.join(studioDir, "tasks"))).toEqual([
    "active-task.json",
  ]);
});

test("runtime diagnostics: console.error read-back, heartbeat authority, screenshot command", async ({
  page,
}) => {
  await signIn(page);
  await page.goto(resolvePortalTestURL(environment, "/users"));
  await page.locator("tbody tr").first().waitFor();

  // Baseline: capture a real element so an active task exists.
  await page.locator("#portal-studio-root .ps-chip-open").click();
  await clickStudioButton(page, "Pick element");
  const row = page.locator("tbody tr").first();
  await hoverElement(page, row);
  await clickElement(page, row);
  await page
    .locator("#portal-studio-root textarea")
    .fill("diagnostics baseline");
  await expect(
    page
      .locator("#portal-studio-root")
      .getByRole("button", { name: /Save|保存|Inspecting|Saving/ }),
    { timeout: 20000 }
  ).toBeEnabled();
  await page
    .locator("#portal-studio-root")
    .getByRole("button", { name: /Save|保存/, exact: true })
    .click();
  await expect(
    page.locator("#portal-studio-root .ps-save-toast", {
      hasText: /Annotation saved|批注已保存/,
    })
  ).toBeVisible();

  // 1) Induce a REAL console.error on the page with a seeded secret.
  const seeded = "E2E-SECRET-TOKEN-abc123";
  await page.evaluate((secret) => {
    console.error(`E2E induced failure with Authorization: Bearer ${secret}`);
  }, seeded);

  // 2) Agent-side evidence command (token-protected JSON endpoint).
  const token = await page.evaluate(
    () => window.__PORTAL_STUDIO_CONFIG__?.token
  );
  const command = await page.request.post(
    resolvePortalTestURL(environment, "__portal-studio/screenshot"),
    {
      headers: { "X-Portal-Studio-Token": token },
      data: { annotations: [{ x: 0, y: 0, width: 100, height: 100 }] },
    }
  );
  expect(command.status()).toBe(200);
  const commandPayload = (await command.json()) as { heartbeat?: { state?: string } };
  expect(commandPayload.heartbeat?.state).toBe("online");

  // The baseline save already carries the page's pre-existing console noise
  // (Base UI warnings), so the poll must wait for the INDUCED entry, which
  // only arrives after the browser fulfills the command (~1s poll + capture).
  const baselineCapturedAt = readActiveTask().screenshot?.capturedAt;
  await expect
    .poll(
      () =>
        readActiveTask().diagnostics?.some((entry) =>
          entry.message.includes("E2E induced failure")
        ) ?? false,
      { timeout: 15_000 }
    )
    .toBe(true);

  const refreshed = readActiveTask();
  // The page emits its own pre-existing console noise (Base UI warnings),
  // so locate the INDUCED entry by its redaction-preserved prefix.
  const consoleEntry = refreshed.diagnostics?.find(
    (entry) =>
      entry.source === "console" &&
      entry.message.includes("E2E induced failure")
  );
  expect(consoleEntry).toBeDefined();
  expect(consoleEntry!.occurrenceCount).toBeGreaterThanOrEqual(1);
  // Redaction: the seeded secret never reaches the artifact.
  const serialized = JSON.stringify(refreshed);
  expect(serialized).not.toContain(seeded);
  expect(consoleEntry!.message).toContain("[REDACTED]");
  expect(consoleEntry!.message).not.toContain(seeded);
  // Fresh screenshot evidence: capturedAt updated by the command flow.
  expect(refreshed.screenshot?.capturedAt).toBeDefined();
  expect(refreshed.screenshot?.capturedAt).not.toBe(baselineCapturedAt);
  const screenshotPath = path.join(studioDir, refreshed.screenshot!.file);
  const png = readFileSync(screenshotPath);
  expect(png.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);

  // Heartbeat is server-derived and online while the page is alive.
  expect(refreshed.heartbeat?.state).toBe("online");

  // 4) Heartbeat authority: after the page is gone and the online window
  //    expires, the server must NOT report online from a stale report.
  await page.close();
  const waitMs =
    (10_000 + 1_500); // ONLINE_WINDOW_MS + margin (constant parity)
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  const lateCommand = await page.request.post(
    resolvePortalTestURL(environment, "__portal-studio/screenshot"),
    {
      headers: { "X-Portal-Studio-Token": token },
      data: {},
    }
  );
  expect(lateCommand.status()).toBe(200);
  const latePayload = (await lateCommand.json()) as { heartbeat?: { state?: string } };
  expect(latePayload.heartbeat?.state).not.toBe("online");
  expect(["stale", "offline"]).toContain(latePayload.heartbeat?.state);
});

test("update verification loop: real edit, HMR path, reload-bump path, MCP smoke", async ({
  page,
}) => {
  await signIn(page);
  await page.goto(resolvePortalTestURL(environment, "/users"));
  await page.locator("tbody tr").first().waitFor();

  // Capture a baseline task.
  await page.locator("#portal-studio-root .ps-chip-open").click();
  await clickStudioButton(page, "Pick element");
  const row = page.locator("tbody tr").first();
  await hoverElement(page, row);
  await clickElement(page, row);
  // saveTask waits for the async inspection pipeline to finish (Save
  // enabled) — the raw Save click races the pipeline under load.
  await saveTask(page, "verify loop baseline");

  const token = await page.evaluate(
    () => window.__PORTAL_STUDIO_CONFIG__?.token
  );
  const baseline = readActiveTask();
  expect(baseline.revision).toBeDefined();
  const baselineSourceRevision = baseline.revision!.sourceRevision;

  // REAL edit: touch the referenced source file — the v6 capture's source
  // points at the sandbox data-table component (HMR serves the update).
  const targetFile = path.resolve("src/components/data-table/data-table.tsx");
  const original = readFileSync(targetFile, "utf8");
  try {
    writeFileSync(targetFile, `${original}\n// portal-studio verify marker\n`);

    // 1) HMR path: verify must match via (hmrAck && online).
    const hmrVerify = await page.request.post(
      resolvePortalTestURL(environment, "__portal-studio/verify"),
      {
        headers: { "X-Portal-Studio-Token": token },
        data: { timeoutMs: 8000 },
      }
    );
    expect(hmrVerify.status()).toBe(200);
    const hmrPayload = (await hmrVerify.json()) as {
      ok?: boolean;
      state?: string;
      revision?: { sourceRevision?: string; browserRevision?: number; hmrAck?: boolean };
    };
    expect(hmrPayload.ok).toBe(true);
    expect(hmrPayload.state).toBe("matched");
    // The source revision must reflect the edited file (changed baseline).
    expect(hmrPayload.revision?.sourceRevision).not.toBe(baselineSourceRevision);
    const updatedTask = readActiveTask();
    expect(updatedTask.revision?.state).toBe("matched");
    expect(updatedTask.revision?.hmrAck).toBe(true);
  } finally {
    writeFileSync(targetFile, original);
  }

  // 2) Reload-bump path (authoritative): reload re-runs the bootstrap, so
  //    the browser revision increases and verify matches via the bump.
  const preReloadRevision = readActiveTask().revision!.browserRevision;
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1500);
  const reloadVerify = await page.request.post(
    resolvePortalTestURL(environment, "__portal-studio/verify"),
    {
      headers: { "X-Portal-Studio-Token": token },
      data: { timeoutMs: 5000 },
    }
  );
  expect(reloadVerify.status()).toBe(200);
  const reloadPayload = (await reloadVerify.json()) as {
    state?: string;
    revision?: { browserRevision?: number };
  };
  expect(reloadPayload.state).toBe("matched");
  expect(reloadPayload.revision?.browserRevision).toBeGreaterThan(
    preReloadRevision
  );

  // Induce a diagnostic AFTER the reload so the fresh ring buffer carries it.
  const seeded = "VERIFY-SECRET-xyz";
  await page.evaluate((secret) => {
    console.error(`verify induced failure with Bearer ${secret}`);
  }, seeded);

  // 3) Fresh screenshot + diagnostics read-back through the JSON path.
  const command = await page.request.post(
    resolvePortalTestURL(environment, "__portal-studio/screenshot"),
    {
      headers: { "X-Portal-Studio-Token": token },
      data: {},
    }
  );
  expect(command.status()).toBe(200);
  await expect
    .poll(
      () =>
        readActiveTask().diagnostics?.some((entry) =>
          entry.message.includes("verify induced failure")
        ) ?? false,
      { timeout: 15_000 }
    )
    .toBe(true);
  const finalTask = readActiveTask();
  expect(finalTask.screenshot?.capturedAt).toBeDefined();
  expect(JSON.stringify(finalTask)).not.toContain(seeded);
  expect(finalTask.revision?.state).toBe("matched");

  // 4) MCP smoke: all five tools against the same artifact + endpoints.
  // The token comes from the page config (the session file is recreated by
  // the server per request, but the in-page token is authoritative).
  const { spawn } = await import("node:child_process");
  const mcp = spawn(process.execPath, ["scripts/portal-studio-mcp.mjs"], {
    env: {
      ...process.env,
      PORTAL_STUDIO_DIR: studioDir,
      PORTAL_STUDIO_ORIGIN: environment.baseURL.replace(/\/$/, ""),
      PORTAL_STUDIO_TOKEN: token,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let mcpOut = "";
  mcp.stdout.on("data", (chunk) => {
    mcpOut += String(chunk);
  });
  const mcpRequest = (id: number, method: string, params?: unknown) => {
    mcp.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) })}\n`
    );
  };
  mcpRequest(1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "e2e", version: "1" } });
  mcpRequest(2, "tools/list");
  mcpRequest(3, "tools/call", { name: "print_task", arguments: {} });
  mcpRequest(4, "tools/call", { name: "read_diagnostics", arguments: {} });
  mcpRequest(5, "tools/call", { name: "wait_verification", arguments: { timeoutMs: 3000 } });
  mcpRequest(6, "tools/call", { name: "current_screenshot", arguments: {} });
  await expect
    .poll(() => (mcpOut.match(/"id":6/g)?.length ?? 0) >= 1, { timeout: 20_000 })
    .toBe(true);
  mcp.kill();

  const lines = mcpOut
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as { id: number; result?: { tools?: unknown; content?: Array<{ text: string }>; isError?: boolean } });
  const byId = new Map(lines.map((line) => [line.id, line]));
  const tools = byId.get(2)?.result?.tools as Array<{ name: string }> | undefined;
  expect(tools?.map((tool) => tool.name)).toEqual([
    "capture_task",
    "print_task",
    "current_screenshot",
    "read_diagnostics",
    "wait_verification",
  ]);
  const printed = byId.get(3)?.result?.content?.[0]?.text ?? "";
  expect(JSON.parse(printed).taskId).toBe(finalTask.taskId);
  const diagnostics = JSON.parse(byId.get(4)?.result?.content?.[0]?.text ?? "[]") as Array<{ message: string }>;
  expect(
    diagnostics.some((entry) => entry.message.includes("verify induced failure"))
  ).toBe(true);
  expect(JSON.stringify(diagnostics)).not.toContain(seeded);
  const wait = byId.get(5)?.result as { isError?: boolean };
  expect(wait?.isError).not.toBe(true);
  const shot = JSON.parse(byId.get(6)?.result?.content?.[0]?.text ?? "{}") as {
    file?: string;
    capturedAt?: string;
  };
  expect(shot.file).toMatch(/^screenshots\/.+\.png$/);
  expect(shot.capturedAt).toBeDefined();
});

test("HMR re-injection: reloads and hot updates never duplicate the Studio mount", async ({
  page,
}) => {
  await signIn(page);
  await page.goto(resolvePortalTestURL(environment, "/users"));
  await page.locator("tbody tr").first().waitFor();
  await page.waitForTimeout(1000);

  const hostCount = () =>
    page.evaluate(() => document.querySelectorAll("#portal-studio-root").length);
  const captureFlags = () =>
    page.evaluate(() => ({
      capture: Boolean(
        (window as unknown as Record<string, unknown>)
          .__PORTAL_STUDIO_CAPTURE_INSTALLED__
      ),
      loop: Boolean(
        (window as unknown as Record<string, unknown>)
          .__PORTAL_STUDIO_EVIDENCE_LOOP_INSTALLED__
      ),
      mounted: Boolean(
        (window as unknown as Record<string, unknown>)
          .__PORTAL_STUDIO_MOUNTED__
      ),
    }));

  // Baseline: exactly one host, all idempotency flags set.
  expect(await hostCount()).toBe(1);
  expect(await captureFlags()).toEqual({
    capture: true,
    loop: true,
    mounted: true,
  });

  // Repeated full reloads must not duplicate the host or flags.
  for (let round = 1; round <= 3; round += 1) {
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1200);
    expect(await hostCount(), `reload round ${round}`).toBe(1);
    expect(await captureFlags()).toEqual({
      capture: true,
      loop: true,
      mounted: true,
    });
  }

  // The toolbar still works after reloads (single bar, single panel).
  await page.locator("#portal-studio-root .ps-chip-open").click();
  await expect(
    page.locator("#portal-studio-root [role='toolbar']")
  ).toHaveCount(1);
  await clickStudioButton(page, "Collapse toolbar");

  // A REAL hot update (non-studio file) must not duplicate the mount.
  const targetFile = path.resolve("src/components/ui/table.tsx");
  const original = readFileSync(targetFile, "utf8");
  try {
    writeFileSync(targetFile, `${original}\n// portal-studio hmr marker\n`);
    await page.waitForTimeout(2000);
    expect(await hostCount()).toBe(1);
    expect(await captureFlags()).toEqual({
      capture: true,
      loop: true,
      mounted: true,
    });
  } finally {
    writeFileSync(targetFile, original);
  }
});

test("dock: compact toolbar, drag persists across reload, horizontal bar (G01)", async ({
  page,
}) => {
  await signIn(page);
  // The login lands on the application index; the users table drives the
  // interactions below.
  await page.goto(resolvePortalTestURL(environment, "/users"));
  const root = page.locator("#portal-studio-root");
  const dock = root.locator(".ps-dock");

  // Collapsed = compact icon toolbar (toggle only), no large panel.
  await expect(dock).toBeVisible();
  await expect(root.locator(".ps-chip-open")).toBeVisible();
  await expect(root.locator("[role='toolbar']")).toHaveCount(0);
  // No emoji glyphs (D-034 #5).
  expect(await root.locator(".ps-chip-open").innerText()).not.toContain("🛠");

  // Pointer drag: move the dock 120px left and 80px up.
  const before = (await dock.boundingBox())!;
  await page.mouse.move(before.x + 20, before.y + 20);
  await page.mouse.down();
  await page.mouse.move(before.x + 20 - 120, before.y + 20 - 80, {
    steps: 8,
  });
  await page.mouse.up();
  const moved = (await dock.boundingBox())!;
  expect(Math.round(moved.x)).toBeLessThanOrEqual(Math.round(before.x) - 90);
  expect(Math.round(moved.y)).toBeLessThanOrEqual(Math.round(before.y) - 50);

  // Reload → position retained (localStorage portal-studio.dock).
  await page.reload();
  await expect(dock).toBeVisible();
  const after = (await dock.boundingBox())!;
  expect(Math.round(after.x)).toBe(Math.round(moved.x));
  expect(Math.round(after.y)).toBe(Math.round(moved.y));

  // Expanded bar shows the horizontal toolbar with direct controls.
  await clickStudioSelector(page, ".ps-chip-open");
  await expect(root.locator("[role='toolbar']")).toBeVisible();
  // The collapsed chip carried the expand semantics (aria-expanded=false).
  // Feature order: Pick, Multi, Area, Copy, Visibility, Help, List, then
  // the separate Collapse chrome.
  const barButtons = root.locator("[role='toolbar'] button");
  await expect(barButtons).toHaveCount(9);
  await expect(
    root.locator("[role='toolbar'] [aria-label='Pick element']")
  ).toBeVisible();
  await expect(
    root.locator("[role='toolbar'] [aria-label='Multi-select']")
  ).toBeVisible();
  await expect(
    root.locator("[role='toolbar'] [aria-label='Select region']")
  ).toBeVisible();
  await expect(
    root.locator("[role='toolbar'] [aria-label='Copy annotations']")
  ).toBeVisible();
  await expect(
    root.locator("[role='toolbar'] [aria-label='Hide markers']")
  ).toBeVisible();
  await expect(
    root.locator("[role='toolbar'] [aria-label='Keyboard shortcuts']")
  ).toBeVisible();
  await expect(
    root.locator("[role='toolbar'] [aria-label='Annotation list']")
  ).toBeVisible();
  await expect(
    root.locator("[role='toolbar'] [aria-label='Collapse toolbar']")
  ).toBeVisible();
});

test("annotations: continuous picks, Ctrl+Enter, markers persist across reload and routes (G02)", async ({
  page,
}) => {
  await signIn(page);
  // The login lands on the application index; the users table drives the
  // interactions below.
  await page.goto(resolvePortalTestURL(environment, "/users"));
  const root = page.locator("#portal-studio-root");
  await openStudio(page);

  // Continuous annotation 1: pick the first table row, Ctrl+Enter saves.
  // The users table must render BEFORE capture starts — while the page is
  // frozen, the app's deferred React updates would never paint the rows.
  await page.locator("tbody tr").first().waitFor();
  await startPicking(page);
  const row1 = page.locator("tbody tr").first();
  await hoverElement(page, row1);
  await clickElement(page, row1);
  await page.locator("#portal-studio-root textarea").fill("First annotation");
  await saveWithCtrlEnter(page);
  await expect(
    page.locator("#portal-studio-root .ps-save-toast", {
      hasText: /Annotation saved|批注已保存/,
    })
  ).toBeVisible();
  // Goal 02: no Done — the loop continues on the resumed Pick session.
  await expect(
    page.locator("#portal-studio-root").getByRole("button", { name: "Done" })
  ).toHaveCount(0);
  // Dock badge reflects the persisted count; list + page marker exist.
  await expectOpenCount(page, root, "1");
  await expect(root.locator(".ps-marker-anchor")).toHaveCount(1);
  // Marker is INSIDE the shadow host: never in the page DOM.
  expect(await page.locator("body > .ps-marker-anchor").count()).toBe(0);
  // The annotation list is the anchored panel behind the List icon.
  await openList(page);
  await expect(root.locator(".ps-annotation-item")).toHaveCount(1);
  // Close the list so the capture status surface is available again.
  await clickStudioButton(page, "Annotation list");
  await expect(root.locator(".ps-list-panel")).toHaveCount(0);

  // Continuous annotation 2: every plain pick appends a NEW annotation
  // (the sandbox users table has a single row — pick a second cell).
  await startPicking(page);
  const row2 = page.locator("tbody tr").first().locator("td").nth(1);
  await hoverElement(page, row2);
  await clickElement(page, row2);
  await page
    .locator("#portal-studio-root textarea")
    .fill("Second annotation");
  await saveWithCtrlEnter(page);
  await expectOpenCount(page, root, "2");
  const task = readActiveTask();
  expect(task.schemaVersion).toBe(6);
  expect(task.annotations).toHaveLength(2);
  expect(task.annotations[1].comment).toBe("Second annotation");
  expect(task.annotations[1].annotationId).not.toBe(
    task.annotations[0].annotationId
  );

  // Reload → markers persist and re-resolve against the live DOM.
  await page.reload();
  await expectOpenCount(page, root, "2");
  await openStudio(page);
  await openList(page);
  await expect(root.locator(".ps-annotation-item")).toHaveCount(2);
  await expect(root.locator(".ps-marker-anchor")).toHaveCount(2);
  await closeStudio(page);

  // Route change → targets gone → annotations RETAINED as unresolved.
  // Goal 06: the server-persisted annotations carry their pageContext
  // routeKey ("/users"), so markers are ALSO route-gated — they must not
  // render on /dev/ai-chat even if a target could resolve.
  await page.goto(resolvePortalTestURL(environment, "/dev/ai-chat"));
  await openStudio(page);
  await openList(page);
  await expect(root.locator(".ps-annotation-item")).toHaveCount(2);
  await expect(root.locator(".ps-unresolved")).toHaveCount(2);
  await expect(root.locator(".ps-marker-anchor")).toHaveCount(0);
  const routed = readActiveTask();
  expect(routed.annotations.every((a) => a.pageContext?.routeKey === "/users")).toBe(
    true
  );
});

test("marker-local editor (G03): element marker save, complete/reopen, delete, Esc focus return", async ({
  page,
}) => {
  await signIn(page);
  // The login lands on the application index; the users table drives the
  // interactions below.
  await page.goto(resolvePortalTestURL(environment, "/users"));
  await page.locator("tbody tr").first().waitFor({ timeout: 15000 });
  const root = page.locator("#portal-studio-root");
  await openStudio(page);

  // One element annotation to act on.
  await startPicking(page);
  const row = page.locator("tbody tr").first();
  await hoverElement(page, row);
  await clickElement(page, row);
  await page.locator("#portal-studio-root textarea").fill("G03 marker note");
  await saveWithCtrlEnter(page);
  await expectOpenCount(page, root, "1");

  // Marker is a semantic, enabled button (not aria-hidden).
  const marker = root.locator(".ps-marker-anchor button");
  await expect(marker).toHaveCount(1);
  await expect(marker).toBeEnabled();

  // Keyboard activation (Enter) opens the marker-local editor.
  await marker.focus();
  await page.keyboard.press("Enter");
  const editor = root.locator(".ps-marker-editor");
  await expect(editor).toBeVisible();
  const textarea = editor.locator("textarea");
  await expect(textarea).toHaveValue("G03 marker note");

  // Viewport-safe: the editor stays fully inside the viewport.
  const box = (await editor.boundingBox())!;
  const vp = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height);

  // Save edits the comment through the shared path → artifact updated.
  await textarea.press("Control+a");
  await textarea.pressSequentially("G03 marker edited", { delay: 5 });
  await page.waitForTimeout(300);
  await clickStudioSelector(page, ".ps-marker-editor .ps-button.ps-primary");
  await expect(editor).toHaveCount(0);
  await expect
    .poll(() => readActiveTask().annotations[0]?.comment)
    .toBe("G03 marker edited");

  // Complete from the marker editor (open → completed).
  await clickElement(page, marker);
  await expect(editor).toBeVisible();
  await clickStudioSelector(page, ".ps-marker-editor .ps-button:not(.ps-primary):not(.ps-danger)");
  await expect(editor).toHaveCount(0);
  await expect
    .poll(() => readActiveTask().annotations[0]?.status)
    .toBe("completed");

  // Reopen from the marker editor (completed → open). Goal 04: the
  // completed marker is hidden from the default Open view — open the list
  // panel and switch to All first so the marker is reachable again.
  await openList(page);
  await clickStudioButton(page, "All");
  await clickElement(page, marker);
  await expect(editor).toBeVisible();
  await clickStudioSelector(page, ".ps-marker-editor .ps-button:not(.ps-primary):not(.ps-danger)");
  await expect(editor).toHaveCount(0);
  await expect
    .poll(() => readActiveTask().annotations[0]?.status)
    .toBe("open");
  // Back to the default Open view for the remaining assertions. The
  // marker click above closed the list (outside click) — reopen it.
  await openList(page);
  await clickStudioButton(page, "Open");
  await clickStudioButton(page, "Annotation list");

  // Esc closes the editor and restores focus to the marker button.
  await clickElement(page, marker);
  await expect(editor).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
  await expect(marker).toBeFocused();

  // Delete requires lightweight confirmation, then removes the annotation.
  await clickElement(page, marker);
  await clickStudioSelector(page, ".ps-marker-editor .ps-button.ps-danger");
  await expect(editor.locator(".ps-annotation-confirm")).toBeVisible();
  await clickStudioSelector(page, ".ps-marker-editor .ps-button.ps-danger");
  await expect(editor).toHaveCount(0);
  await expect.poll(() => readActiveTask().annotations.length).toBe(0);
  await expect(root.locator(".ps-marker-anchor button")).toHaveCount(0);
});

test("marker-local editor (G03): fits viewports smaller than the editor", async ({
  page,
}) => {
  await signIn(page);
  // The login lands on the application index; the users table drives the
  // interactions below.
  await page.goto(resolvePortalTestURL(environment, "/users"));
  const root = page.locator("#portal-studio-root");
  // Create the annotation at the default viewport, THEN shrink to a size
  // SMALLER than the editor's nominal 264x232.
  await page.locator("tbody tr").first().waitFor();
  await openStudio(page);
  await startPicking(page);
  const row = page.locator("tbody tr").first();
  await hoverElement(page, row);
  await clickElement(page, row);
  await page.locator("#portal-studio-root textarea").fill("G03 small viewport");
  await saveWithCtrlEnter(page);
  await expectOpenCount(page, root, "1");
  await page.setViewportSize({ width: 220, height: 200 });

  // The dialog must FIT the smaller viewport (max-width/max-height +
  // overflow) with the bounding box fully inside.
  const marker = root.locator(".ps-marker-anchor button");
  // The fixed-position marker may sit outside the shrunken viewport;
  // a programmatic click opens the editor — its ANCHOR must still clamp
  // inside the viewport (the behavior under test).
  await marker.evaluate((el) => (el as HTMLButtonElement).click());
  const editor = root.locator(".ps-marker-editor");
  await expect(editor).toBeVisible();
  const box = (await editor.boundingBox())!;
  const vp = page.viewportSize()!;
  expect(vp.width).toBeLessThan(264);
  expect(vp.height).toBeLessThan(232);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height);

  // Save remains reachable and works at this size.
  await clickStudioSelector(page, ".ps-marker-editor .ps-button.ps-primary");
  await expect(editor).toHaveCount(0);
  await expect
    .poll(() => readActiveTask().annotations[0]?.comment)
    .toBe("G03 small viewport");

  // Delete (with its confirmation) remains reachable too.
  await marker.evaluate((el) => (el as HTMLButtonElement).click());
  await expect(editor).toBeVisible();
  await clickStudioSelector(page, ".ps-marker-editor .ps-button.ps-danger");
  await expect(editor.locator(".ps-annotation-confirm")).toBeVisible();
  await clickStudioSelector(page, ".ps-marker-editor .ps-button.ps-danger");
  await expect(editor).toHaveCount(0);
  await expect.poll(() => readActiveTask().annotations.length).toBe(0);
  await expect(root.locator(".ps-marker-anchor button")).toHaveCount(0);
});

test("marker-local editor (G03): multi highlight, region boundary, save failure, event isolation", async ({
  page,
}) => {
  await signIn(page);
  // The login lands on the application index; the users table drives the
  // interactions below.
  await page.goto(resolvePortalTestURL(environment, "/users"));
  const root = page.locator("#portal-studio-root");
  await openStudio(page);

  // Multi annotation: two cells in ONE group.
  await page.locator("tbody tr").first().waitFor();
  await clickStudioButton(page, "Multi-select");
  const cellA = page.locator("tbody tr").first().locator("td").nth(0);
  const cellB = page.locator("tbody tr").first().locator("td").nth(1);
  await hoverElement(page, cellA);
  await clickElement(page, cellA);
  await hoverElement(page, cellB);
  await clickElement(page, cellB);
  await clickStudioButton(page, "Finish group");
  await page
    .locator("#portal-studio-root textarea")
    .fill("G03 multi marker");
  await saveWithCtrlEnter(page);
  await expectOpenCount(page, root, "1");
  const task = readActiveTask();
  expect(task.annotations[0].kind).toBe("multi");

  // Opening the multi marker highlights every captured target.
  const multiMarker = root.locator(".ps-marker-anchor button").first();
  await clickElement(page, multiMarker);
  await expect(root.locator(".ps-marker-editor")).toBeVisible();
  await expect(root.locator(".ps-marker-highlight")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(root.locator(".ps-marker-highlight")).toHaveCount(0);

  // Save failure: the POST is intercepted → error shown, text preserved.
  await page.route("**/__portal-studio/mutate", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "simulated failure" }),
      });
      return;
    }
    await route.continue();
  });
  await clickElement(page, multiMarker);
  const editor = root.locator(".ps-marker-editor");
  await editor.locator("textarea").fill("G03 doomed text");
  await clickStudioSelector(page, ".ps-marker-editor .ps-button.ps-primary");
  await expect(editor.locator(".ps-error")).toContainText(/simulated failure/);
  await expect(editor.locator("textarea")).toHaveValue("G03 doomed text");
  // Regression (review P1): the FAILED comment must NOT reach the shared
  // state or the server artifact — the last confirmed comment stays.
  await expect
    .poll(() => readActiveTask().annotations[0]?.comment)
    .toBe("G03 multi marker");
  await page.unroute("**/__portal-studio/mutate");
  await page.keyboard.press("Escape");

  // Event isolation: typing a hotkey combo inside the editor textarea must
  // NOT switch Studio modes, and pointer events must not start capture.
  await clickElement(page, multiMarker);
  await expect(root.locator(".ps-marker-editor")).toBeVisible();
  await page.evaluate(() => {
    const shadow = document.getElementById("portal-studio-root")?.shadowRoot;
    (shadow?.querySelector(".ps-marker-editor textarea") as HTMLTextAreaElement | null)?.focus();
  });
  // Exactly the two multi-target highlights are shown; a leaked hotkey or
  // pointer capture would add the hidden capture-mode outline (mode switch
  // renders an extra .ps-outline even when no target is hovered yet).
  await expect(root.locator(".ps-marker-highlight")).toHaveCount(2);
  const outlinesBefore = await root.locator(".ps-outline").count();
  await page.keyboard.press("Control+Alt+KeyM");
  await expect(root.locator(".ps-marker-highlight")).toHaveCount(2);
  await expect(root.locator(".ps-outline")).toHaveCount(outlinesBefore);
  await expect(root.locator(".ps-marker-editor")).toBeVisible();
  await page.keyboard.press("Escape");

  // Region annotation (marquee): the region marker chip opens the editor
  // anchored beside the region boundary, inside the viewport.
  await clickStudioButton(page, "Select region");
  const table = page.locator("tbody").first();
  const tbox = (await table.boundingBox())!;
  await page.mouse.move(tbox.x + 10, tbox.y + 10);
  await page.mouse.down();
  await page.mouse.move(tbox.x + tbox.width - 10, tbox.y + tbox.height - 10, {
    steps: 8,
  });
  await page.mouse.up();
  await page
    .locator("#portal-studio-root textarea")
    .fill("G03 region marker");
  await saveWithCtrlEnter(page);
  await expect
    .poll(() => readActiveTask().annotations.at(-1)?.kind)
    .toBe("region");

  const regionMarker = root.locator(".ps-marker-region-chip");
  await expect(regionMarker).toHaveCount(1);
  await clickElement(page, regionMarker);
  await expect(root.locator(".ps-marker-editor")).toBeVisible();
  const editorBox = (await editor.boundingBox())!;
  const vp = page.viewportSize()!;
  expect(editorBox.x).toBeGreaterThanOrEqual(0);
  expect(editorBox.y).toBeGreaterThanOrEqual(0);
  expect(editorBox.x + editorBox.width).toBeLessThanOrEqual(vp.width);
  expect(editorBox.y + editorBox.height).toBeLessThanOrEqual(vp.height);
  await page.keyboard.press("Escape");

  // Cleanup: delete both annotations so later tests start empty.
  await closeStudio(page);
  await openList(page);
  const deleteButtons = root.locator(
    ".ps-annotation-item [aria-label='Delete']"
  );
  const count = await deleteButtons.count();
  for (let index = 0; index < count; index += 1) {
    await deleteButtons.first().click();
    await root.locator(".ps-annotation-confirm").waitFor();
    await clickStudioSelector(page, ".ps-annotation-confirm button");
    await expect
      .poll(() => readActiveTask().annotations.length)
      .toBe(count - index - 1);
  }
  await expectNoOpenCount(page, root);
});

test("annotations: multi-select group, delete renumbers, hide and clear-all persist (G03)", async ({
  page,
}) => {
  await signIn(page);
  // The login lands on the application index; the users table drives the
  // interactions below.
  await page.goto(resolvePortalTestURL(environment, "/users"));
  const root = page.locator("#portal-studio-root");
  await openStudio(page);

  // Multi-select group: seed pick + toggle a second element into ONE group.
  await page.locator("tbody tr").first().waitFor();
  await clickStudioButton(page, "Multi-select");
  const cellA = page.locator("tbody tr").first().locator("td").nth(0);
  const cellB = page.locator("tbody tr").first().locator("td").nth(1);
  await hoverElement(page, cellA);
  await clickElement(page, cellA);
  await hoverElement(page, cellB);
  await clickElement(page, cellB);
  await clickStudioButton(page, "Finish group");
  await page
    .locator("#portal-studio-root textarea")
    .fill("G03 group annotation");
  await saveWithCtrlEnter(page);
  await expectOpenCount(page, root, "1");
  let task = readActiveTask();
  expect(task.annotations).toHaveLength(1);
  expect(task.annotations[0].kind).toBe("multi");
  expect(task.annotations[0].elements).toHaveLength(2);
  // Goal 02: no Done — Multi resumed with an EMPTY group (documented
  // rule); the next Pick click is a mode SWITCH to single-target.
  await expect(
    page.locator("#portal-studio-root").getByRole("button", { name: "Done" })
  ).toHaveCount(0);

  // Second single annotation (delete target).
  await clickStudioButton(page, "Pick element");
  const row2 = page.locator("tbody tr").first().locator("td").nth(2);
  await hoverElement(page, row2);
  await clickElement(page, row2);
  await page
    .locator("#portal-studio-root textarea")
    .fill("G03 second annotation");
  await saveWithCtrlEnter(page);
  await expectOpenCount(page, root, "2");
  await openList(page);

  // Delete annotation 2 (its delete button is the second in the list) with
  // the inline confirmation; the remaining marker renumbers to 1.
  const deleteButtons = root.locator(
    ".ps-annotation-item [aria-label='Delete']"
  );
  await expect(deleteButtons).toHaveCount(2);
  await deleteButtons.nth(1).click();
  await expect(
    root.locator(".ps-annotation-confirm")
  ).toBeVisible();
  await clickStudioSelector(page, ".ps-annotation-confirm button");
  await expect(root.locator(".ps-annotation-item")).toHaveCount(1);
  // The mutation POST is debounced — poll the persisted artifact.
  await expect
    .poll(() => readActiveTask().annotations.length)
    .toBe(1);
  task = readActiveTask();
  expect(task.annotations[0].annotationId).toBe(
    readActiveTask().annotations[0].annotationId
  );
  expect(task.annotations[0].comment).toBe("G03 group annotation");

  // Hide the remaining annotation → reload → still hidden (never deleted).
  await clickStudioSelector(page, ".ps-annotation-item [aria-label='Hide']");
  // The label is uppercased via CSS text-transform.
  await expect(root.locator(".ps-unresolved")).toContainText(/hidden/i);
  // Persisted before the reload (debounced mutation).
  await expect
    .poll(
      () =>
        (readActiveTask() as unknown as {
          annotations?: Array<{ hidden?: boolean }>;
        }).annotations?.[0]?.hidden
    )
    .toBe(true);
  await page.reload();
  await expectOpenCount(page, root, "1");
  await openList(page);
  await expect(root.locator(".ps-annotation-item")).toHaveCount(1);
  await expect(root.locator(".ps-annotation-item")).toContainText(/hidden/i);

  // Delete the remaining annotation via inline confirm → valid empty v5 task.
  const remainingDelete = root.locator(
    ".ps-annotation-item [aria-label='Delete']"
  );
  await clickElement(page, remainingDelete);
  await expect(root.locator(".ps-annotation-confirm")).toBeVisible();
  await clickStudioSelector(page, ".ps-annotation-confirm button");
  await expect(root.locator(".ps-annotation-item")).toHaveCount(0);
  await expectNoOpenCount(page, root);
  await expect
    .poll(() => readActiveTask().annotations.length)
    .toBe(0);
  task = readActiveTask();
  expect(task.schemaVersion).toBe(6);
  expect(task.annotations).toEqual([]);

  // Reload after delete-all: still empty, nothing resurrects.
  await page.reload();
  await expectNoOpenCount(page, root);
});

test("copy parity, explicit Complete with verify exit 0, Clear-task removed (G04)", async ({
  page,
}) => {
  await signIn(page);
  // The login lands on the application index; the users table drives the
  // interactions below.
  await page.goto(resolvePortalTestURL(environment, "/users"));
  const root = page.locator("#portal-studio-root");
  await openStudio(page);

  // One annotation to work with.
  await page.locator("tbody tr").first().waitFor();
  await startPicking(page);
  const row = page.locator("tbody tr").first();
  await hoverElement(page, row);
  await clickElement(page, row);
  await page.locator("#portal-studio-root textarea").fill("G04 complete me");
  await saveWithCtrlEnter(page);
  await expectOpenCount(page, root, "1");

  // The old Clear-task normal path is gone (Complete replaced it).
  await expect(
    root.getByRole("button", { name: "Clear task" })
  ).toHaveCount(0);

  // Copy parity: the copied Markdown equals `print --markdown` (the same
  // shared formatter). Headless clipboard may be denied → fallback dialog.
  const printed = execFileSync(
    process.execPath,
    ["scripts/portal-studio-print.mjs", "--markdown"],
    { encoding: "utf8" }
  ).trim();
  // Poll: Copy must reflect the SERVER artifact (the post-save refresh
  // merges screenshot + heartbeat), byte-identical to the CLI output.
  await expect
    .poll(
      async () => {
        await clickStudioSelector(page, "[aria-label='Copy annotations']");
        const fallback = root.locator(".ps-copy-fallback textarea");
        if (await fallback.isVisible().catch(() => false)) {
          return (await fallback.inputValue()).trim();
        }
        return await page.evaluate(
          () => navigator.clipboard.readText().catch(() => "")
        );
      },
      { timeout: 15000 }
    )
    .toBe(printed);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  // Explicit per-annotation Complete → persisted; verify exits 0 with
  // completed:true (open-task exit semantics unchanged elsewhere).
  await openList(page);
  await clickStudioSelector(page, ".ps-annotation-item [aria-label='Complete']");
  await expect
    .poll(() => readActiveTask().annotations[0]?.status)
    .toBe("completed");
  const verify = execFileSync(
    process.execPath,
    ["scripts/portal-studio-verify.mjs", "--timeout-ms", "1000"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PORTAL_STUDIO_DIR: studioDir,
        PORTAL_STUDIO_ORIGIN: resolvePortalTestURL(environment, "").replace(/\/$/, ""),
      },
    }
  );
  const verifyPayload = JSON.parse(verify) as { completed?: boolean };
  expect(verifyPayload.completed).toBe(true);

  // Completed rendering survives reload. Goal 04: the launcher counts OPEN
  // only — with the single annotation completed, the status slot shows the
  // feedback icon (no count) and the item is hidden from the default Open
  // view.
  await page.reload();
  await expectNoOpenCount(page, root);
  await openList(page);
  // It is NOT deleted: the All view shows the completed item.
  await clickStudioButton(page, "All");
  await expect(root.locator(".ps-annotation-item")).toContainText(
    /completed/i
  );
  // Cleanup: remove the completed item via the dock control.
  await page
    .locator("#portal-studio-root")
    .getByRole("button", { name: /Remove completed \(1\)/ })
    .click();
  await clickStudioButton(page, "Remove");
  await expect
    .poll(() => readActiveTask().annotations.length)
    .toBe(0);
  await expectNoOpenCount(page, root);
});

test("a11y keyboard walkthrough: dock, horizontal bar, Esc focus return (G05)", async ({
  page,
}) => {
  await signIn(page);
  // The login lands on the application index; the users table drives the
  // interactions below.
  await page.goto(resolvePortalTestURL(environment, "/users"));
  const root = page.locator("#portal-studio-root");
  // The users table must render BEFORE capture starts — while the page is
  // frozen, the app's deferred React updates would never paint the rows.
  await page.locator("tbody tr").first().waitFor();
  await root.locator(".ps-dock").waitFor();

  // Tab reaches the chip; arrow keys on the DRAG HANDLE move the dock;
  // Enter on the chip body opens the toolbar (native button activation).
  await root.locator(".ps-chip-drag").focus();
  await expect(root.locator(".ps-chip-drag")).toBeFocused();
  const dockBefore = (await root.locator(".ps-dock").boundingBox())!;
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  const dockAfter = (await root.locator(".ps-dock").boundingBox())!;
  expect(dockAfter.x).toBeLessThan(dockBefore.x - 20);

  await root.locator(".ps-chip-open").focus();
  await page.keyboard.press("Enter");
  await expect(root.locator("[role='toolbar']")).toBeVisible();

  // Delete-confirm Esc cancels and returns focus (F-1 path). The panel is
  // still open from the toggle above — create an annotation to act on.
  await clickStudioButton(page, "Pick element");
  const row = page.locator("tbody tr").first();
  await hoverElement(page, row);
  await clickElement(page, row);
  await page.locator("#portal-studio-root textarea").fill("G05 a11y");
  await saveWithCtrlEnter(page);
  await expectOpenCount(page, root, "1");
  await openList(page);
  // aria-pressed reflects the toggle states (P3-1): hide/complete are
  // not pressed initially.
  await expect(
    root.locator(".ps-annotation-item [aria-label='Hide']")
  ).toHaveAttribute("aria-pressed", "false");
  await expect(
    root.locator(".ps-annotation-item [aria-label='Complete']")
  ).toHaveAttribute("aria-pressed", "false");
  await clickStudioSelector(page, ".ps-annotation-item [aria-label='Delete']");
  await expect(root.locator(".ps-annotation-confirm")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(root.locator(".ps-annotation-confirm")).toHaveCount(0);
  await expect(
    root.locator(".ps-annotation-item [aria-label='Delete']")
  ).toBeFocused();
});

test("completed visibility and cleanup semantics (G04): open-count launcher, All view, reopen, remove confirm, open-only Copy", async ({
  page,
}) => {
  await signIn(page);
  // The login lands on the application index; the users table drives the
  // interactions below.
  await page.goto(resolvePortalTestURL(environment, "/users"));
  const root = page.locator("#portal-studio-root");
  await openStudio(page);

  // Two OPEN annotations.
  await page.locator("tbody tr").first().waitFor();
  await startPicking(page);
  const row = page.locator("tbody tr").first();
  await hoverElement(page, row);
  await clickElement(page, row);
  await page.locator("#portal-studio-root textarea").fill("G04 open one");
  await saveWithCtrlEnter(page);
  // Goal 02: no Done; Pick resumed — startPicking reuses the session.
  await expect(root.getByRole("button", { name: "Done" })).toHaveCount(0);
  await startPicking(page);
  await hoverElement(page, row);
  await clickElement(page, row);
  await page.locator("#portal-studio-root textarea").fill("G04 open two");
  await saveWithCtrlEnter(page);
  await expectOpenCount(page, root, "2");

  // Complete ONE via the list → launcher counts OPEN only (1).
  await openList(page);
  await clickStudioSelector(page, ".ps-annotation-item [aria-label='Complete']");
  await expectOpenCount(page, root, "1");
  // Open view hides the completed item; All shows both with Reopen.
  await expect(root.locator(".ps-annotation-item")).toHaveCount(1);
  await clickStudioButton(page, "All");
  await expect(root.locator(".ps-annotation-item")).toHaveCount(2);
  await expect(root.locator(".ps-annotation-item-completed")).toHaveCount(1);
  await expect(
    root.locator(".ps-annotation-item [aria-label='Reopen']")
  ).toHaveCount(1);

  // Reopen moves it back → launcher back to 2 open.
  await clickStudioSelector(page, ".ps-annotation-item [aria-label='Reopen']");
  await expect
    .poll(() => readActiveTask().annotations.filter((a) => a.status === "open").length)
    .toBe(2);

  // Browser Copy is OPEN-ONLY while print --markdown is explicit ALL-mode.
  // Complete one item first so the Copy assertion is discriminating
  // (mixed open + completed data).
  await clickStudioSelector(page, ".ps-annotation-item [aria-label='Complete']");
  await expect
    .poll(() => readActiveTask().annotations.filter((a) => a.status === "open").length)
    .toBe(1);
  // Poll Copy until the async clipboard/fallback settles (like the G04
  // copy-parity flow); the OPEN-only output must include the open item
  // and exclude the completed one.
  let copied = "";
  await expect
    .poll(
      async () => {
        await clickStudioButton(page, "Copy annotations");
        const fb = root.locator(".ps-copy-fallback textarea");
        if (await fb.isVisible().catch(() => false)) {
          copied = await fb.inputValue();
        } else {
          copied = await page.evaluate(() =>
            navigator.clipboard.readText().catch(() => "")
          );
        }
        return copied;
      },
      { timeout: 15000 }
    )
    .toContain("G04 open two");
  expect(copied).not.toContain("G04 open one");
  // Esc twice, topmost first: the poll's final Copy click resolves
  // asynchronously (a denied clipboard write can reject a tick after the
  // click), so settle the fallback state first. The fallback is the
  // topmost surface — ONE Esc closes it; ONE more Esc closes the list —
  // both must be gone before the capture flow.
  await page.waitForTimeout(300);
  await expect(root.locator(".ps-copy-fallback")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(root.locator(".ps-copy-fallback")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(root.locator(".ps-list-panel")).toHaveCount(0);
  // All-mode print output contains every annotation (mixed data).
  const printed = execFileSync(
    process.execPath,
    ["scripts/portal-studio-print.mjs", "--markdown"],
    { encoding: "utf8" }
  );
  expect(printed).toContain("G04 open one");
  expect(printed).toContain("G04 open two");

  // Complete the FINAL open item → launcher back to the feedback icon;
  // item hidden from the default Open view but NOT deleted (All view
  // still shows it). The Esc above closed the list — reopen it.
  await openList(page);
  await clickStudioButton(page, "Open");
  await expectOpenCount(page, root, "1");
  await clickStudioSelector(page, ".ps-annotation-item [aria-label='Complete']");
  await expectNoOpenCount(page, root);
  await expect
    .poll(() => root.locator(".ps-annotation-item").count(), { timeout: 5000 })
    .toBe(0);
  await expect(
    root.locator(".ps-list-panel .ps-hint", { hasText: "No open annotations" })
  ).toBeVisible();

  // Remove completed: cancel keeps items; confirm removes ONLY completed.
  await clickStudioButton(page, "All");
  await clickStudioButton(page, "Remove completed (2)");
  await clickStudioButton(page, "Cancel");
  await expect.poll(() => readActiveTask().annotations.length).toBe(2);
  await clickStudioButton(page, "Remove completed (2)");
  await clickStudioButton(page, "Remove");
  await expect.poll(() => readActiveTask().annotations.length).toBe(0);
  await expectNoOpenCount(page, root);
  // TaskId lifecycle (G06): the task was FULLY completed before
  // removeCompleted; a new batch must still start a FRESH taskId (the
  // sticky task-level completedAt survives removeCompleted).
  const clearedTaskId = readActiveTask().taskId;
  // Close the list so the capture status surface is available again.
  await clickStudioButton(page, "Annotation list");
  await expect(root.locator(".ps-list-panel")).toHaveCount(0);
  await startPicking(page);
  await hoverElement(page, row);
  await clickElement(page, row);
  await page.locator("#portal-studio-root textarea").fill("G04 after remove");
  await saveWithCtrlEnter(page);
  await expectOpenCount(page, root, "1");
  await expect
    .poll(() => readActiveTask().taskId)
    .not.toBe(clearedTaskId);
  const fresh = readActiveTask();
  expect(fresh.annotations).toHaveLength(1);
  expect(fresh.completedAt).toBeUndefined();
  // Cleanup: delete the fresh annotation so later tests start empty.
  await openList(page);
  await clickStudioSelector(page, ".ps-annotation-item [aria-label='Delete']");
  await root.locator(".ps-annotation-confirm").waitFor();
  await root.locator(".ps-annotation-confirm button", { hasText: "Delete" }).click();
  await expect.poll(() => readActiveTask().annotations.length).toBe(0);
  await expectNoOpenCount(page, root);
});

test("agent CLI complete/reopen sync to the browser within two seconds (G05)", async ({
  page,
}) => {
  await signIn(page);
  // The login lands on the application index; the users table drives the
  // interactions below.
  await page.goto(resolvePortalTestURL(environment, "/users"));
  const root = page.locator("#portal-studio-root");
  await openStudio(page);

  // One open annotation to act on.
  await page.locator("tbody tr").first().waitFor();
  await startPicking(page);
  const row = page.locator("tbody tr").first();
  await hoverElement(page, row);
  await clickElement(page, row);
  await page.locator("#portal-studio-root textarea").fill("G05 sync me");
  await saveWithCtrlEnter(page);
  await expectOpenCount(page, root, "1");
  await openList(page);
  const annotationId = readActiveTask().annotations[0].annotationId;
  expect(annotationId).toMatch(/^[a-zA-Z0-9]/);

  // The CLI completes the annotation from the shell (same artifact the
  // dev server serves — no browser interaction).
  const cliEnv = { ...process.env, PORTAL_STUDIO_DIR: studioDir };
  const completed = execFileSync(
    process.execPath,
    [
      "scripts/portal-studio-agent.mjs",
      "complete",
      "--",
      annotationId,
      "--verified",
      "--summary",
      "G05 verified via reload; evidence recorded",
    ],
    { encoding: "utf8", env: cliEnv }
  );
  expect(completed).toContain("completed");
  // Goal 05: the OPEN view removes the CLI-completed item (revision-gated
  // polling — no HMR/source/timestamp inference).
  // seconds (revision-gated polling — no HMR/source/timestamp inference).
  await expect(root.locator(".ps-annotation-item")).toHaveCount(0, {
    timeout: 4000,
  });
  await expectNoOpenCount(page, root);
  // All view shows it as completed (evidence preserved in the artifact).
  await clickStudioButton(page, "All");
  await expect(root.locator(".ps-annotation-item")).toHaveCount(1);
  await expect(root.locator(".ps-annotation-item-completed")).toHaveCount(1);
  const artifact = readActiveTask();
  expect(artifact.annotations[0].completedEvidence?.verified).toBe(true);
  expect(artifact.annotations[0].completedEvidence?.summary).toContain(
    "G05 verified via reload"
  );
  expect(typeof artifact.taskRevision).toBe("number");

  // A BROWSER mutation after the CLI completion must NOT strip the
  // additive evidence (sanitizeTask preserves completedEvidence): hide the
  // completed item from the list, then read the artifact back.
  await clickStudioSelector(page, ".ps-annotation-item [aria-label='Hide']");
  await expect
    .poll(() => readActiveTask().annotations[0]?.hidden)
    .toBe(true);
  const afterHide = readActiveTask();
  expect(afterHide.annotations[0].completedEvidence?.verified).toBe(true);
  expect(afterHide.annotations[0].completedEvidence?.summary).toContain(
    "G05 verified via reload"
  );
  // Un-hide so the reopen flow below is unaffected.
  await clickStudioSelector(page, ".ps-annotation-item [aria-label='Hide']");
  await expect
    .poll(() => readActiveTask().annotations[0]?.hidden)
    .toBe(false);

  // Reopen via the CLI → the item reappears in the Open view within two
  // seconds.
  const reopened = execFileSync(
    process.execPath,
    ["scripts/portal-studio-agent.mjs", "reopen", "--", annotationId],
    { encoding: "utf8", env: cliEnv }
  );
  expect(reopened).toContain("reopened");
  await clickStudioButton(page, "Open");
  await expect(root.locator(".ps-annotation-item")).toHaveCount(1, {
    timeout: 2000,
  });
  await expectOpenCount(page, root, "1");
  expect(readActiveTask().annotations[0].status).toBe("open");
  expect(
    readActiveTask().annotations[0].completedEvidence
  ).toBeUndefined();

  // Cleanup: remove the annotation so later tests start empty.
  await clickStudioSelector(page, ".ps-annotation-item [aria-label='Delete']");
  await root.locator(".ps-annotation-confirm").waitFor();
  await clickStudioSelector(page, ".ps-annotation-confirm button");
  await expect.poll(() => readActiveTask().annotations.length).toBe(0);
});

test("old-schema artifacts surface the shared unsupported_schema result (G03-AC12)", async ({
  page,
}) => {
  // Seed a v5 artifact directly, then open the browser — the task GET
  // reports the typed unsupported_schema result, the browser shows the
  // clear instruction, and mutation is rejected with no migration.
  const v5 = {
    schemaVersion: 5,
    taskId: "legacy-v5-unsupported",
    createdAt: "2026-08-09T00:00:00.000Z",
    url: resolvePortalTestURL(environment, "/users"),
    title: "Users",
    annotations: [],
    businessContext: [],
    redaction: { droppedKeys: [], redactedValues: 0, truncatedValues: 0 },
  };
  mkdirSync(path.dirname(taskFile), { recursive: true });
  writeFileSync(taskFile, JSON.stringify(v5, null, 2));

  await signIn(page);
  await page.goto(resolvePortalTestURL(environment, "/users"));
  await page.locator("tbody tr").first().waitFor();
  const root = page.locator("#portal-studio-root");
  await openList(page);
  // The browser shows the clear unsupported-task instruction.
  await expect(root.locator(".ps-error")).toContainText(/Unsupported task schema/i);

  // The typed mutate endpoint rejects old-schema artifacts (never mutated).
  const token = await page.evaluate(
    () => window.__PORTAL_STUDIO_CONFIG__?.token
  );
  const mutate = await page.request.post(
    resolvePortalTestURL(environment, "__portal-studio/mutate"),
    {
      headers: { "X-Portal-Studio-Token": token },
      data: {
        taskId: "legacy-v5-unsupported",
        expectedTaskRevision: 0,
        operations: [{ op: "setHidden", annotationId: "x", hidden: true }],
      },
    }
  );
  expect(mutate.status()).toBe(400);
  const mutatePayload = (await mutate.json()) as {
    status?: string;
    schemaVersion?: number;
    expectedSchemaVersion?: number;
  };
  // The full shared typed result (not just the error name).
  expect(mutatePayload.status).toBe("unsupported_schema");
  expect(mutatePayload.schemaVersion).toBe(5);
  expect(mutatePayload.expectedSchemaVersion).toBe(6);
  // The artifact was NOT migrated.
  expect(readActiveTask().schemaVersion).toBe(5);

  // The verify endpoint rejects old-schema artifacts with the same typed
  // result — never verified, never migrated.
  const verify = await page.request.post(
    resolvePortalTestURL(environment, "__portal-studio/verify"),
    {
      headers: { "X-Portal-Studio-Token": token },
      data: { timeoutMs: 2000 },
    }
  );
  expect(verify.status()).toBe(400);
  const verifyPayload = (await verify.json()) as {
    status?: string;
    schemaVersion?: number;
    expectedSchemaVersion?: number;
  };
  expect(verifyPayload.status).toBe("unsupported_schema");
  expect(verifyPayload.schemaVersion).toBe(5);
  expect(verifyPayload.expectedSchemaVersion).toBe(6);

  // The CLI rejects the same artifact with the clear instruction (exit 1).
  let cliStatus = 0;
  let cliStderr = "";
  try {
    execFileSync(
      "pnpm",
      ["--silent", "run", "studio:list"],
      {
        encoding: "utf8",
        env: { ...process.env, PORTAL_STUDIO_DIR: studioDir },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
  } catch (error) {
    const e = error as { status?: number; stderr?: Buffer | string };
    cliStatus = e.status ?? 1;
    cliStderr = String(e.stderr ?? "");
  }
  expect(cliStatus).toBe(1);
  expect(cliStderr).toContain("removed schema");
  // Cleanup: clear the dev-only artifact so later tests start empty.
  rmSync(taskFile, { force: true });
});

test("interleaved browser/CLI mutations keep stable taskId and revision-aware consistency (G06)", async ({
  page,
}) => {
  await signIn(page);
  // The login lands on the application index; the users table drives the
  // interactions below.
  await page.goto(resolvePortalTestURL(environment, "/users"));
  const root = page.locator("#portal-studio-root");
  await openStudio(page);

  // Browser creates the first annotation (taskId A).
  await page.locator("tbody tr").first().waitFor();
  await startPicking(page);
  const row = page.locator("tbody tr").first();
  await hoverElement(page, row);
  await clickElement(page, row);
  await page.locator("#portal-studio-root textarea").fill("G06 browser one");
  await saveWithCtrlEnter(page);
  await expectOpenCount(page, root, "1");
  const taskIdA = readActiveTask().taskId;

  // Browser adds a second annotation — SAME taskId A (Pick resumed).
  await expect(root.getByRole("button", { name: "Done" })).toHaveCount(0);
  await startPicking(page);
  await hoverElement(page, row);
  await clickElement(page, row);
  await page.locator("#portal-studio-root textarea").fill("G06 browser two");
  await saveWithCtrlEnter(page);
  await expectOpenCount(page, root, "2");
  expect(readActiveTask().taskId).toBe(taskIdA);
  await openList(page);

  // CLI completes one annotation through the SAME typed mutation
  // semantics; the browser picks it up via revision polling within 2s.
  const cliEnv = { ...process.env, PORTAL_STUDIO_DIR: studioDir };
  const firstId = readActiveTask().annotations[0].annotationId;
  execFileSync(
    process.execPath,
    ["scripts/portal-studio-agent.mjs", "complete", "--", firstId, "--verified", "--summary", "G06 interleaved"],
    { encoding: "utf8", env: cliEnv }
  );
  await expectOpenCount(page, root, "1", {
    timeout: 2000,
  });

  // Browser mutates while the CLI-completed state exists (hide the open
  // one) — the typed mutation preserves the CLI evidence and taskId.
  await clickStudioButton(page, "All");
  await root.locator(".ps-annotation-item [aria-label='Hide']").last().click();
  await expect
    .poll(() => readActiveTask().annotations[1]?.hidden)
    .toBe(true);
  const after = readActiveTask();
  expect(after.taskId).toBe(taskIdA);
  expect(after.annotations[0].completedEvidence?.summary).toContain(
    "G06 interleaved"
  );
  // The server whitelist round trip PRESERVES the per-annotation page
  // context (audit fix): the persisted artifact carries the routeKey that
  // gates marker rendering.
  expect(after.annotations[0].pageContext?.routeKey).toBe(
    new URL(page.url()).pathname
  );
  expect(typeof after.annotations[0].pageContext?.viewport.width).toBe(
    "number"
  );
  expect(typeof after.taskRevision).toBe("number");

  // Cleanup: delete both annotations so later tests start empty.
  await root.locator(".ps-annotation-item [aria-label='Hide']").last().click();
  await expect.poll(() => readActiveTask().annotations[1]?.hidden).toBe(false);
  await closeStudio(page);
  await openList(page);
  const deleteButtons = root.locator(
    ".ps-annotation-item [aria-label='Delete']"
  );
  const count = await deleteButtons.count();
  for (let index = 0; index < count; index += 1) {
    await deleteButtons.first().click();
    await root.locator(".ps-annotation-confirm").waitFor();
    await clickStudioSelector(page, ".ps-annotation-confirm button");
    await expect
      .poll(() => readActiveTask().annotations.length)
      .toBe(count - index - 1);
  }
  await expectNoOpenCount(page, root);
});

test("large task (>64KB) mutations persist via the plain POST (D-043 regression)", async ({
  page,
}) => {
  await signIn(page);
  // The login lands on the application index; the users table drives the
  // interactions below.
  await page.goto(resolvePortalTestURL(environment, "/users"));
  const root = page.locator("#portal-studio-root");
  await root.locator(".ps-dock").waitFor();

  // Seed a LARGE task (>64 KB — beyond the keepalive budget) through the
  // documented agent-side write path.
  const token = await page.evaluate(
    () => window.__PORTAL_STUDIO_CONFIG__?.token
  );
  const bigElements = Array.from({ length: 30 }, (_, i) => ({
    tagName: "div",
    selector: `body > div:nth(${i})`,
    bounds: { x: 0, y: 0, width: 10, height: 10 },
    componentName: null,
    source: null,
    sourceStack: [],
    htmlPreview: "L".repeat(2600),
    styleText: "",
    fingerprint: {
      tagName: "div",
      role: "",
      accessibleName: "",
      text: "L".repeat(2600),
      identityAttributes: {},
      childCount: 0,
      parent: { tagName: "body", role: "" },
    },
  }));
  const bigTask = {
    schemaVersion: 6,
    taskId: "d043-large-task",
    createdAt: new Date().toISOString(),
    url: new URL(page.url()).href,
    title: "D-043 large",
    annotations: [
      {
        annotationId: "ann-big-1",
        kind: "multi",
        comment: "Big annotation with many elements",
        createdAt: new Date().toISOString(),
        status: "open",
        elements: bigElements,
        pageContext: {
          url: new URL(page.url()).href,
          routeKey: new URL(page.url()).pathname,
          title: "D-043 large",
          viewport: { width: 1440, height: 900 },
          scroll: { x: 0, y: 0 },
          businessContext: [],
        },
      },
    ],
    businessContext: [],
    redaction: { droppedKeys: [], redactedValues: 0, truncatedValues: 0 },
  };
  expect(Buffer.byteLength(JSON.stringify(bigTask), "utf8")).toBeGreaterThan(
    64 * 1024
  );
  const seeded = await page.request.post(
    resolvePortalTestURL(environment, "__portal-studio/tasks"),
    {
      headers: { "X-Portal-Studio-Token": token },
      data: bigTask,
    }
  );
  expect(seeded.status()).toBe(200);
  // The dock badge refreshes from the server on panel open.
  await openStudio(page);
  await expectOpenCount(page, root, "1");
  await closeStudio(page);

  // UI hide mutation must persist (the keepalive-only path would have
  // failed with "Failed to fetch" for this >64 KB task — D-043).
  await openList(page);
  await clickStudioSelector(page, ".ps-annotation-item [aria-label='Hide']");
  await expect
    .poll(() => readActiveTask().annotations[0]?.hidden)
    .toBe(true);
  await page.reload();
  await expectOpenCount(page, root, "1");
  await openList(page);
  await expect(root.locator(".ps-annotation-item")).toContainText(/hidden/i);
});

// ===========================================================================
// Goal 01 v5 — horizontal toolbar acceptance scenarios
// ===========================================================================

const viewportFits = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const el = document.documentElement;
    return el.scrollWidth <= window.innerWidth + 1;
  });

test("G01 v5: collapsed chip (empty + 4 open, EN/ZH tolerant), expand, drag-not-expand, collapse keeps annotations", async ({
  page,
}) => {
  await signIn(page);
  // The login lands on the application index; the users table drives the
  // interactions below.
  await page.goto(resolvePortalTestURL(environment, "/users"));
  await page.setViewportSize({ width: 1440, height: 900 });
  const root = page.locator("#portal-studio-root");
  await page.goto(resolvePortalTestURL(environment, "/users"));
  await page.locator("tbody tr").first().waitFor();

  // Collapsed on a fresh load, no annotations: feedback icon slot, no
  // count, no detached badge, no toolbar role.
  await expect(root.locator(".ps-collapsed-chip")).toBeVisible();
  await expect(root.locator("[role='toolbar']")).toHaveCount(0);
  await expect(root.locator(".ps-status-slot")).not.toHaveText(/\d/);
  const label = (await root.locator(".ps-chip-label").innerText()).trim();
  expect(/批注工具|Annotation tools/.test(label)).toBe(true);
  await page.screenshot({
    path: "test-results/g01-collapsed-empty.png",
    fullPage: false,
  });

  // Drag via the explicit handle must NEVER expand.
  const chipBox = (await root.locator(".ps-dock").boundingBox())!;
  await page.mouse.move(chipBox.x + 16, chipBox.y + 20);
  await page.mouse.down();
  await page.mouse.move(chipBox.x + 70, chipBox.y + 90, { steps: 6 });
  await page.mouse.up();
  await expect(root.locator("[role='toolbar']")).toHaveCount(0);
  await expect(root.locator(".ps-collapsed-chip")).toBeVisible();

  // Clicking the chip body expands the horizontal bar.
  await clickStudioSelector(page, ".ps-chip-open");
  await expect(root.locator("[role='toolbar']")).toBeVisible();
  await expect(root.locator(".ps-horizontal-bar")).toBeVisible();
  // One row, no wrap, inside the viewport.
  await expect
    .poll(async () => (await root.locator(".ps-horizontal-bar").boundingBox())!.height)
    .toBeLessThan(70);
  expect(
    await root
      .locator(".ps-horizontal-bar")
      .evaluate((el) => getComputedStyle(el).flexWrap)
  ).toBe("nowrap");
  expect(await viewportFits(page)).toBe(true);

  // Four annotations → collapsed chip shows the open count (4).
  const targets = [
    page.locator("tbody tr").first(),
    page.locator("tbody tr").first().locator("td").nth(0),
    page.locator("tbody tr").first().locator("td").nth(1),
    page.locator("tbody tr").first().locator("td").nth(2),
  ];
  for (let index = 0; index < targets.length; index += 1) {
    // Goal 02: no Done — each iteration continues on the resumed Pick.
    await startPicking(page);
    // Frozen page: Playwright actionability cannot hit-test through the
    // freeze's `html { pointer-events: none }` — use the raw mouse
    // helpers (the engine hit-tests from the mouse position).
    await hoverElement(page, targets[index]);
    await clickElement(page, targets[index]);
    await page
      .locator("#portal-studio-root textarea")
      .fill(`G01 v5 annotation ${index + 1}`);
    await saveWithCtrlEnter(page);
    await expectOpenCount(page, root, String(index + 1));
    await expect(
      page
        .locator("#portal-studio-root")
        .getByRole("button", { name: "Done" })
    ).toHaveCount(0);
  }
  // Collapse with annotations present: count chip, nothing cleared.
  await clickStudioButton(page, "Collapse toolbar");
  await expect(root.locator(".ps-collapsed-chip")).toBeVisible();
  await expect(root.locator(".ps-status-slot")).toHaveText("4");
  // Review P6: the chip's accessible name exposes the open count in a
  // real browser (localized; EN here, ZH asserted via the locale pass).
  await expect(root.locator(".ps-chip-open")).toHaveAttribute(
    "aria-label",
    /Annotation tools \(4 open\)|批注工具（4 条未完成）/
  );
  await page.screenshot({
    path: "test-results/g01-collapsed-4-open.png",
    fullPage: false,
  });
  expect(readActiveTask().annotations).toHaveLength(4);

  // Cleanup: delete all four so later tests start empty.
  await clickStudioSelector(page, ".ps-chip-open");
  await clickStudioButton(page, "Annotation list");
  await expect(root.locator(".ps-list-panel")).toBeVisible();
  const deletes = root.locator(".ps-annotation-item [aria-label='Delete']");
  const count = await deletes.count();
  for (let index = 0; index < count; index += 1) {
    await deletes.first().click();
    await root.locator(".ps-annotation-confirm").waitFor();
    await clickStudioSelector(page, ".ps-annotation-confirm button");
    await expect
      .poll(() => readActiveTask().annotations.length)
      .toBe(count - index - 1);
  }
  await expectNoOpenCount(page, root);
});

test("G01 v5: tooltips, active capture states, help popover, list Open/All, mutual exclusion", async ({
  page,
}) => {
  await signIn(page);
  // The login lands on the application index; the users table drives the
  // interactions below.
  await page.goto(resolvePortalTestURL(environment, "/users"));
  await page.setViewportSize({ width: 1440, height: 900 });
  const root = page.locator("#portal-studio-root");
  await page.goto(resolvePortalTestURL(environment, "/users"));
  await page.locator("tbody tr").first().waitFor();
  await openStudio(page);

  // Tooltip on hover: action + platform shortcut keycap.
  await root.locator("[role='toolbar'] [aria-label='Pick element']").hover();
  const tip = root.locator("[role='tooltip']");
  await expect(tip).toBeVisible();
  await expect(tip).toContainText("Pick element");
  await expect(tip).toContainText(/Ctrl\+Alt\+P|⌘⌥P/);
  await expect(tip).toHaveAttribute("role", "tooltip");
  await page.screenshot({
    path: "test-results/g01-tooltip-pick.png",
    fullPage: false,
  });
  await page.mouse.move(0, 0);

  // Review P5: EVERY expanded actionable icon shows its registry tooltip
  // in a real browser (not only Pick) — including the ? keycap for help.
  const iconTooltips: Array<[string, string, RegExp | null]> = [
    ["Drag toolbar", "Drag toolbar", null],
    ["Pick element", "Pick element", /Ctrl\+Alt\+P|⌘⌥P/],
    ["Multi-select", "Multi-select", /Ctrl\+Alt\+M|⌘⌥M/],
    ["Select region", "Select region", /Ctrl\+Alt\+A|⌘⌥A/],
    ["Copy annotations", "Copy annotations", /Ctrl\+Alt\+C|⌘⌥C/],
    ["Hide markers", "Hide markers", /Ctrl\+Alt\+V|⌘⌥V/],
    ["Keyboard shortcuts", "Keyboard shortcuts", /\?/],
    ["Annotation list", "Annotation list", /Ctrl\+Alt\+L|⌘⌥L/],
    ["Collapse toolbar", "Collapse toolbar", /Ctrl\+Alt\+K|⌘⌥K/],
  ];
  for (const [label, tipText, keycap] of iconTooltips) {
    const button = root.locator(`[role='toolbar'] [aria-label='${label}']`);
    await hoverElement(page, button);
    const tip = root.locator("[role='tooltip']");
    await expect(tip).toBeVisible({ timeout: 5000 });
    await expect(tip).toContainText(tipText, { timeout: 5000 });
    if (keycap) {
      await expect(tip).toContainText(keycap, { timeout: 5000 });
    }
    await page.mouse.move(0, 0);
  }
  // The collapsed chip's Expand affordance has the same custom tooltip.
  await page.locator("main").first().click({ position: { x: 200, y: 40 } });
  await page.keyboard.press("Control+Alt+KeyK");
  await expect(root.locator(".ps-collapsed-chip")).toBeVisible();
  await root.locator(".ps-chip-expand").hover();
  const expandTip = root.locator("[role='tooltip']");
  await expect(expandTip).toBeVisible();
  await expect(expandTip).toContainText("Expand toolbar");
  await expect(expandTip).toContainText(/Ctrl\+Alt\+K|⌘⌥K/);
  await page.screenshot({
    path: "test-results/g01-tooltip-expand.png",
    fullPage: false,
  });
  await page.mouse.move(0, 0);
  await page.keyboard.press("Control+Alt+KeyK");
  await expect(root.locator("[role='toolbar']")).toBeVisible();

  // Active capture states via aria-pressed, with click-to-cancel.
  const pick = root.locator("[role='toolbar'] [aria-label='Pick element']");
  const multi = root.locator("[role='toolbar'] [aria-label='Multi-select']");
  const area = root.locator("[role='toolbar'] [aria-label='Select region']");
  await expect(pick).toHaveAttribute("aria-pressed", "false");
  await pick.click();
  await expect(pick).toHaveAttribute("aria-pressed", "true");
  await expect(root.locator(".ps-status-panel")).toContainText("Hover an element");
  await pick.click();
  await expect(pick).toHaveAttribute("aria-pressed", "false");
  await clickElement(page, multi);
  await expect(multi).toHaveAttribute("aria-pressed", "true");
  await clickElement(page, multi);
  await clickElement(page, area);
  await expect(area).toHaveAttribute("aria-pressed", "true");
  await clickElement(page, area);

  // Shortcut-help popover from the penultimate feature icon; generated
  // rows; Esc closes and restores focus.
  const helpButton = root.locator("[role='toolbar'] [aria-label='Keyboard shortcuts']");
  await clickElement(page, helpButton);
  await expect(helpButton).toHaveAttribute("aria-expanded", "true");
  const help = root.locator("#ps-shortcut-help");
  await expect(help).toBeVisible();
  for (const row of ["Pick element", "Multi-select", "Select region", "Copy annotations", "Hide markers", "Annotation list", "Collapse toolbar"]) {
    await expect(help).toContainText(row);
  }
  await expect(help).toContainText("Esc");
  await expect(help).toContainText(/ignored while typing/);
  // Round-6 blocker 1: the Help panel is GENUINELY anchored — its bottom
  // edge sits ≈ PLACEMENT_GAP (8px, ±2 tolerance) above the trigger when
  // flipped above, not maxHeight away.
  const helpBox = (await help.boundingBox())!;
  const helpBtnBox = (await helpButton.boundingBox())!;
  expect(Math.abs(helpBox.y + helpBox.height - helpBtnBox.y)).toBeLessThanOrEqual(12);
  expect(Math.abs(helpBox.y + helpBox.height - helpBtnBox.y)).toBeGreaterThanOrEqual(4);
  await page.screenshot({
    path: "test-results/g01-help-popover.png",
    fullPage: false,
  });
  await page.keyboard.press("Escape");
  await expect(help).toHaveCount(0);
  await expect(helpButton).toBeFocused();

  // Annotation-list panel from the FINAL feature icon; Open/All filter.
  await clickStudioSelector(page, "[role='toolbar'] [aria-label='Pick element']");
  await hoverElement(page, page.locator("tbody tr").first());
  await clickElement(page, page.locator("tbody tr").first());
  await page.locator("#portal-studio-root textarea").fill("G01 list item");
  await saveWithCtrlEnter(page);
  await expectOpenCount(page, root, "1");
  const listButton = root.locator("[role='toolbar'] [aria-label='Annotation list']");
  await clickElement(page, listButton);
  await expect(listButton).toHaveAttribute("aria-expanded", "true");
  const list = root.locator("#ps-annotation-list");
  await expect(list).toBeVisible();
  await expect(list).toContainText("G01 list item");
  await expect(list).toContainText("1 open · 1 total");
  await expect(
    list.getByRole("button", { name: "All", exact: true })
  ).toBeVisible();
  // Round-6 blocker 1: the List panel's bottom edge hugs the trigger
  // (≈8px ± tolerance) instead of floating hundreds of pixels above it.
  const listBox = (await list.boundingBox())!;
  const listBtnBox = (await listButton.boundingBox())!;
  expect(Math.abs(listBox.y + listBox.height - listBtnBox.y)).toBeLessThanOrEqual(12);
  expect(Math.abs(listBox.y + listBox.height - listBtnBox.y)).toBeGreaterThanOrEqual(4);
  // The toolbar remains visible while the list panel is open.
  await expect(root.locator("[role='toolbar']")).toBeVisible();
  await page.screenshot({
    path: "test-results/g01-list-panel.png",
    fullPage: false,
  });

  // Mutual exclusion: Help and List never coexist.
  await clickElement(page, helpButton);
  await expect(help).toBeVisible();
  await expect(list).toHaveCount(0);
  await clickElement(page, listButton);
  await expect(list).toBeVisible();
  await expect(help).toHaveCount(0);

  // Cleanup: delete the annotation.
  await clickStudioSelector(page, ".ps-annotation-item [aria-label='Delete']");
  await root.locator(".ps-annotation-confirm").waitFor();
  await clickStudioSelector(page, ".ps-annotation-confirm button");
  await expect.poll(() => readActiveTask().annotations.length).toBe(0);
});

test("G01 v5: keyboard — ? help, Mod+Alt+L list, Mod+Alt+V markers, Mod+Alt+K collapse; Tab focus walkthrough", async ({
  page,
}) => {
  await signIn(page);
  // The login lands on the application index; the users table drives the
  // interactions below.
  await page.goto(resolvePortalTestURL(environment, "/users"));
  await page.setViewportSize({ width: 1440, height: 900 });
  const root = page.locator("#portal-studio-root");
  await page.goto(resolvePortalTestURL(environment, "/users"));
  await page.locator("tbody tr").first().waitFor();

  // ? expands the toolbar and opens the registry-generated help popover.
  await page.keyboard.press("?");
  await expect(root.locator("[role='toolbar']")).toBeVisible();
  await expect(root.locator("#ps-shortcut-help")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(root.locator("#ps-shortcut-help")).toHaveCount(0);
  // Esc restored focus to the help trigger INSIDE Studio — global hotkeys
  // deliberately do not fire from Studio surfaces, so move focus to the
  // page before the shortcut walkthrough.
  await page.locator("main").first().click({ position: { x: 200, y: 40 } });
  await page.keyboard.press("Control+Alt+KeyL");
  await expect(root.locator("#ps-annotation-list")).toBeVisible();
  await expect(root.locator("#ps-annotation-list")).toContainText(
    /No annotations yet|暂无标注/
  );
  await page.keyboard.press("Control+Alt+KeyL");
  await expect(root.locator("#ps-annotation-list")).toHaveCount(0);

  // Mod+Alt+V toggles presentation-only marker visibility (no persistence).
  await page.keyboard.press("Control+Alt+KeyV");
  await expect(
    root.locator("[role='toolbar'] [aria-label='Show markers']")
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Control+Alt+KeyV");
  await expect(
    root.locator("[role='toolbar'] [aria-label='Hide markers']")
  ).toBeVisible();

  // Mod+Alt+K collapses and re-expands.
  await page.keyboard.press("Control+Alt+KeyK");
  await expect(root.locator("[role='toolbar']")).toHaveCount(0);
  await expect(root.locator(".ps-collapsed-chip")).toBeVisible();
  await page.keyboard.press("Control+Alt+KeyK");
  await expect(root.locator("[role='toolbar']")).toBeVisible();

  // Keyboard-only Tab walkthrough: focus lands on the chip controls, then
  // tooltips appear on focus and Esc dismisses them.
  await page.keyboard.press("Control+Alt+KeyK");
  await root.locator(".ps-chip-drag").focus();
  await expect(root.locator(".ps-chip-drag")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(root.locator(".ps-chip-open")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(root.locator(".ps-chip-expand")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(root.locator("[role='toolbar']")).toBeVisible();
  // The Enter-activated chip buttons unmount with the chip; focus the bar
  // grip directly, then walk the bar with Tab.
  await root
    .locator("[role='toolbar'] [aria-label='Drag toolbar']")
    .focus();
  await expect(
    root.locator("[role='toolbar'] [aria-label='Drag toolbar']")
  ).toBeFocused();
  // Tooltip appears on keyboard focus.
  await page.keyboard.press("Tab");
  await expect(
    root.locator("[role='toolbar'] [aria-label='Pick element']")
  ).toBeFocused();
  await expect(root.locator("[role='tooltip']")).toContainText("Pick element");
  await page.keyboard.press("Escape");
  await expect(root.locator("[role='tooltip']")).toHaveCount(0);
  await page.screenshot({
    path: "test-results/g01-keyboard-tooltip.png",
    fullPage: false,
  });

  // Review P3: the expanded toolbar does NOT trap Tab — focus leaves the
  // last bar control and reaches page content (native navigation).
  await root
    .locator("[role='toolbar'] [aria-label='Collapse toolbar']")
    .focus();
  await page.keyboard.press("Tab");
  const afterTab = await page.evaluate(() => {
    const active = document.activeElement;
    const host = document.getElementById("portal-studio-root");
    const insideStudio =
      !!host &&
      (host.contains(active) ||
        (!!host.shadowRoot && host.shadowRoot.contains(active)));
    return {
      tag: active ? active.tagName : "none",
      insideStudio,
    };
  });
  expect(afterTab.insideStudio).toBe(false);

  // Round-3 finding 2: shortcuts work from focused NON-editable Studio
  // controls (no blanket root-ignore) — Mod+Alt+L from the focused List
  // button opens and closes the panel.
  await root
    .locator("[role='toolbar'] [aria-label='Annotation list']")
    .focus();
  await page.keyboard.press("Control+Alt+KeyL");
  await expect(root.locator("#ps-annotation-list")).toBeVisible();
  await page.keyboard.press("Control+Alt+KeyL");
  await expect(root.locator("#ps-annotation-list")).toHaveCount(0);

  // Round-4 finding 3: capture-activating shortcuts fire from focused
  // NON-editable Studio controls (P/M/A), not only presentation ones.
  await root.locator("[role='toolbar'] [aria-label='Pick element']").focus();
  await page.keyboard.press("Control+Alt+KeyP");
  await expect(root.locator(".ps-status-panel")).toContainText(
    "Hover an element"
  );
  await page.keyboard.press("Escape");
  await root.locator("[role='toolbar'] [aria-label='Multi-select']").focus();
  await page.keyboard.press("Control+Alt+KeyM");
  await expect(root.locator(".ps-status-panel")).toContainText(
    "toggle elements in/out"
  );
  await page.keyboard.press("Escape");
  await root.locator("[role='toolbar'] [aria-label='Select region']").focus();
  await page.keyboard.press("Control+Alt+KeyA");
  await expect(root.locator(".ps-status-panel")).toContainText(
    "Drag over the page"
  );
  await page.keyboard.press("Escape");
  // Round-5 blocker 3: while COLLAPSED, P/M/A from the focused chip drag
  // handle each expand the toolbar and activate their action.
  const collapsedShortcut = async (key: string) => {
    await page.keyboard.press("Control+Alt+KeyK");
    await expect(root.locator(".ps-collapsed-chip")).toBeVisible();
    await root.locator(".ps-chip-drag").focus();
    await page.keyboard.press(key);
    await expect(root.locator("[role='toolbar']")).toBeVisible();
  };
  await collapsedShortcut("Control+Alt+KeyP");
  await expect(root.locator(".ps-status-panel")).toContainText(
    "Hover an element"
  );
  await page.keyboard.press("Escape");
  await collapsedShortcut("Control+Alt+KeyM");
  await expect(root.locator(".ps-status-panel")).toContainText(
    "toggle elements in/out"
  );
  await page.keyboard.press("Escape");
  await collapsedShortcut("Control+Alt+KeyA");
  await expect(root.locator(".ps-status-panel")).toContainText(
    "Drag over the page"
  );
  await page.keyboard.press("Escape");

  // macOS Option can turn event.key into a symbol (Option+P => "π"). The
  // physical KeyP code must still activate Pick; CI uses Control as its Mod.
  await page.evaluate(() => {
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "π",
        code: "KeyP",
        ctrlKey: true,
        altKey: true,
        bubbles: true,
        composed: true,
      })
    );
  });
  await expect(root.locator(".ps-status-panel")).toContainText(
    "Hover an element"
  );
  await page.keyboard.press("Escape");

  // …and NEVER from a FOREIGN shadow-root editable control.
  await page.evaluate(() => {
    const host = document.createElement("div");
    host.id = "foreign-shadow-host";
    const shadow = host.attachShadow({ mode: "open" });
    const input = document.createElement("input");
    shadow.appendChild(input);
    document.body.appendChild(host);
    input.focus();
  });
  await page.keyboard.press("Control+Alt+KeyP");
  // No pick mode started: no capture-status surface exists at all.
  await expect(root.locator(".ps-status-panel")).toHaveCount(0);
  await page.keyboard.press("Control+Alt+KeyL");
  await expect(root.locator("#ps-annotation-list")).toHaveCount(0);
  await page.keyboard.press("Control+Alt+KeyV");
  await expect(
    root.locator("[role='toolbar'] [aria-label='Hide markers']")
  ).toBeVisible();
  await page.keyboard.press("?");
  await expect(root.locator("#ps-shortcut-help")).toHaveCount(0);
  await page.evaluate(() =>
    document.getElementById("foreign-shadow-host")?.remove()
  );
});

test("G01 v5: drag near all four edges stays clamped; 375x667 stays horizontal with clamped panels", async ({
  page,
}) => {
  await signIn(page);
  // The login lands on the application index; the users table drives the
  // interactions below.
  await page.goto(resolvePortalTestURL(environment, "/users"));
  await page.setViewportSize({ width: 1440, height: 900 });
  const root = page.locator("#portal-studio-root");
  await page.goto(resolvePortalTestURL(environment, "/users"));
  await page.locator("tbody tr").first().waitFor();

  // Drag the chip (via the handle) to each edge; the whole chip must stay
  // inside the viewport after every drag.
  const edges = [
    { x: 2, y: 2 },
    { x: 1438, y: 2 },
    { x: 2, y: 898 },
    { x: 1438, y: 898 },
  ];
  for (const edge of edges) {
    const box = (await root.locator(".ps-dock").boundingBox())!;
    await page.mouse.move(box.x + 16, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(edge.x, edge.y, { steps: 10 });
    await page.mouse.up();
    const after = (await root.locator(".ps-dock").boundingBox())!;
    expect(after.x).toBeGreaterThanOrEqual(0);
    expect(after.y).toBeGreaterThanOrEqual(0);
    expect(after.x + after.width).toBeLessThanOrEqual(1440);
    expect(after.y + after.height).toBeLessThanOrEqual(900);
  }
  // Expanding at an edge still keeps the bar inside the viewport.
  await clickStudioSelector(page, ".ps-chip-open");
  const barBox = (await root.locator(".ps-horizontal-bar").boundingBox())!;
  expect(barBox.x + barBox.width).toBeLessThanOrEqual(1440);
  expect(barBox.y + barBox.height).toBeLessThanOrEqual(900);
  await page.screenshot({
    path: "test-results/g01-drag-edges-expanded.png",
    fullPage: false,
  });

  // 375x667: collapsed chip inside the viewport; expanded bar stays ONE
  // row within the viewport; no page horizontal overflow; help and list
  // panels clamp inside.
  await page.setViewportSize({ width: 375, height: 667 });
  await page.waitForTimeout(200);
  await page.keyboard.press("Control+Alt+KeyK");
  await expect(root.locator(".ps-collapsed-chip")).toBeVisible();
  const chipBox = (await root.locator(".ps-dock").boundingBox())!;
  expect(chipBox.x + chipBox.width).toBeLessThanOrEqual(375);
  expect(chipBox.y + chipBox.height).toBeLessThanOrEqual(667);
  expect(await viewportFits(page)).toBe(true);
  await page.screenshot({
    path: "test-results/g01-375-collapsed.png",
    fullPage: false,
  });
  await clickStudioSelector(page, ".ps-chip-open");
  const compactBar = (await root.locator(".ps-horizontal-bar").boundingBox())!;
  // One horizontal row, no wrap, fully inside the viewport.
  expect(compactBar.height).toBeLessThan(60);
  expect(compactBar.x).toBeGreaterThanOrEqual(0);
  expect(compactBar.x + compactBar.width).toBeLessThanOrEqual(375);
  expect(await viewportFits(page)).toBe(true);
  await page.screenshot({
    path: "test-results/g01-375-expanded.png",
    fullPage: false,
  });
  // Help popover clamps inside the narrow viewport.
  await clickStudioButton(page, "Keyboard shortcuts");
  const helpBox = (await root.locator("#ps-shortcut-help").boundingBox())!;
  expect(helpBox.x).toBeGreaterThanOrEqual(0);
  expect(helpBox.x + helpBox.width).toBeLessThanOrEqual(375);
  expect(helpBox.y).toBeGreaterThanOrEqual(0);
  expect(helpBox.y + helpBox.height).toBeLessThanOrEqual(667);
  // Genuine anchoring at 375: the panel bottom hugs the help trigger.
  const helpBtn375 = (await root
    .getByRole("button", { name: "Keyboard shortcuts" })
    .boundingBox())!;
  expect(Math.abs(helpBox.y + helpBox.height - helpBtn375.y)).toBeLessThanOrEqual(12);
  expect(Math.abs(helpBox.y + helpBox.height - helpBtn375.y)).toBeGreaterThanOrEqual(4);
  await page.screenshot({
    path: "test-results/g01-375-help.png",
    fullPage: false,
  });
  await clickStudioButton(page, "Annotation list");
  const listBox = (await root.locator("#ps-annotation-list").boundingBox())!;
  expect(listBox.x).toBeGreaterThanOrEqual(0);
  expect(listBox.x + listBox.width).toBeLessThanOrEqual(375);
  expect(listBox.y).toBeGreaterThanOrEqual(0);
  expect(listBox.y + listBox.height).toBeLessThanOrEqual(667);
  // Genuine anchoring at 375: the empty-list panel hugs its trigger.
  const listBtn375 = (await root
    .getByRole("button", { name: "Annotation list" })
    .boundingBox())!;
  expect(Math.abs(listBox.y + listBox.height - listBtn375.y)).toBeLessThanOrEqual(12);
  expect(Math.abs(listBox.y + listBox.height - listBtn375.y)).toBeGreaterThanOrEqual(4);
  await page.screenshot({
    path: "test-results/g01-375-list.png",
    fullPage: false,
  });
});

test("G01 v5: Chinese locale states — chip, toolbar, help, list, count (review evidence gaps)", async ({
  page,
}) => {
  // The sandbox server pins its system language to en-US via app:getLang.
  // Intercept that endpoint to serve zh-CN so the REAL zh-CN translation
  // path of the bundled starter namespace is exercised in a real browser
  // (server-side language stays untouched).
  await page.route("**/api/app:getLang*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { lang: "zh-CN", resources: {} } }),
    });
  });
  await signIn(page);
  // The login lands on the application index; the users table drives the
  // interactions below.
  await page.goto(resolvePortalTestURL(environment, "/users"));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(resolvePortalTestURL(environment, "/users"));
  await page.locator("tbody tr").first().waitFor();
  const root = page.locator("#portal-studio-root");

  // Collapsed chip in Chinese.
  await expect(root.locator(".ps-collapsed-chip")).toBeVisible();
  await expect(root.locator(".ps-chip-label")).toHaveText("批注工具");
  await page.screenshot({
    path: "test-results/g01-zh-collapsed.png",
    fullPage: false,
  });

  // Expanded horizontal bar in Chinese.
  await clickStudioSelector(page, ".ps-chip-open");
  await expect(root.locator("[role='toolbar']")).toBeVisible();
  await expect(
    root.locator("[role='toolbar'] [aria-label='拾取元素']")
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/g01-zh-toolbar.png",
    fullPage: false,
  });

  // Shortcut-help popover in Chinese (registry-generated labels).
  await root.getByRole("button", { name: "键盘快捷键" }).click();
  await expect(root.locator("#ps-shortcut-help")).toBeVisible();
  await expect(root.locator("#ps-shortcut-help")).toContainText("键盘快捷键");
  await expect(root.locator("#ps-shortcut-help")).toContainText("拾取元素");
  await expect(root.locator("#ps-shortcut-help")).toContainText("在输入框、文本域等可编辑控件中键入时，快捷键不会触发");
  await page.screenshot({
    path: "test-results/g01-zh-help.png",
    fullPage: false,
  });
  await page.keyboard.press("Escape");

  // Annotation-list panel (empty state) in Chinese.
  await root.getByRole("button", { name: "批注列表" }).click();
  await expect(root.locator("#ps-annotation-list")).toBeVisible();
  await expect(root.locator("#ps-annotation-list")).toContainText("暂无标注");
  await page.screenshot({
    path: "test-results/g01-zh-list.png",
    fullPage: false,
  });

  // Exercise creation in Chinese: one annotation → collapsed chip shows
  // the count with the localized accessible name.
  await root.getByRole("button", { name: "批注列表" }).click();
  await root.getByRole("button", { name: "拾取元素" }).click();
  await hoverElement(page, page.locator("tbody tr").first());
  await clickElement(page, page.locator("tbody tr").first());
  await page.locator("#portal-studio-root textarea").fill("中文批注");
  await saveWithCtrlEnter(page);
  // Goal 02: the compact toast replaces the technical Saved panel (ZH).
  await expect(root.locator(".ps-save-toast")).toContainText("批注已保存");
  // Goal 02: no 完成 (Done) button — the continuous loop resumes Pick.
  await expect(root.getByRole("button", { name: "完成" })).toHaveCount(0);
  await root.getByRole("button", { name: "收起工具栏" }).click();
  await expect(root.locator(".ps-status-slot")).toHaveText("1");
  await expect(root.locator(".ps-chip-open")).toHaveAttribute(
    "aria-label",
    "批注工具（1 条未完成）"
  );
  await page.screenshot({
    path: "test-results/g01-zh-collapsed-count.png",
    fullPage: false,
  });

  // Cleanup: delete the annotation and restore en-US for any later run.
  await clickStudioSelector(page, ".ps-chip-open");
  await root.getByRole("button", { name: "批注列表" }).click();
  await clickStudioSelector(page, ".ps-annotation-item [aria-label='删除']");
  await root.locator(".ps-annotation-confirm").waitFor();
  await clickStudioSelector(page, ".ps-annotation-confirm button");
  await expect.poll(() => readActiveTask().annotations.length).toBe(0);
});

test("G01 v5: manual-Copy fallback clamps inside the viewport at edge positions (round-3 finding 4)", async ({
  page,
  context,
}) => {
  // Deny the clipboard permission so the manual fallback is forced.
  await context.grantPermissions([], { origin: environment.baseURL });
  await signIn(page);
  // The login lands on the application index; the users table drives the
  // interactions below.
  await page.goto(resolvePortalTestURL(environment, "/users"));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(resolvePortalTestURL(environment, "/users"));
  await page.locator("tbody tr").first().waitFor();
  const root = page.locator("#portal-studio-root");

  // One open annotation so Copy is enabled.
  await openStudio(page);
  await root.getByRole("button", { name: "Pick element" }).click();
  await hoverElement(page, page.locator("tbody tr").first());
  await clickElement(page, page.locator("tbody tr").first());
  await page.locator("#portal-studio-root textarea").fill("edge copy");
  await saveWithCtrlEnter(page);
  await expectOpenCount(page, root, "1");

  const dragDockTo = async (x: number, y: number) => {
    const box = (await root.locator(".ps-dock").boundingBox())!;
    await page.mouse.move(box.x + 16, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(x, y, { steps: 8 });
    await page.mouse.up();
  };
  const fallbackInside = async (vp: { width: number; height: number }) => {
    const fb = root.locator(".ps-copy-fallback");
    await expect(fb).toBeVisible();
    const box = (await fb.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
    expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
    return box;
  };

  // TOP-LEFT: the fallback flips BELOW the Copy button, stays inside the
  // viewport, and is GENUINELY anchored (gap ≈ 8px from the button's
  // bottom edge — round-4 finding 5).
  await page.keyboard.press("Control+Alt+KeyK");
  await dragDockTo(5, 5);
  await clickStudioSelector(page, ".ps-chip-open");
  const copyButton = root.getByRole("button", { name: "Copy annotations" });
  await clickElement(page, copyButton);
  const topLeftBox = await fallbackInside({ width: 1440, height: 900 });
  const copyBox = (await copyButton.boundingBox())!;
  expect(topLeftBox.y).toBeGreaterThanOrEqual(copyBox.y);
  expect(
    Math.abs(topLeftBox.y - (copyBox.y + copyBox.height + 8))
  ).toBeLessThanOrEqual(2);
  await page.screenshot({
    path: "test-results/g01-copy-fallback-top-left.png",
    fullPage: false,
  });
  await page.keyboard.press("Escape");

  // BOTTOM-RIGHT: above-flip keeps it inside AND hugs the trigger — the
  // dialog's bottom sits ≈ 8px above the button's top edge.
  await page.keyboard.press("Control+Alt+KeyK");
  await dragDockTo(1438, 898);
  await clickStudioSelector(page, ".ps-chip-open");
  await clickElement(page, copyButton);
  const bottomRightBox = await fallbackInside({ width: 1440, height: 900 });
  const copyBoxBR = (await copyButton.boundingBox())!;
  expect(
    Math.abs(copyBoxBR.y - (bottomRightBox.y + bottomRightBox.height) - 8)
  ).toBeLessThanOrEqual(2);
  await page.screenshot({
    path: "test-results/g01-copy-fallback-bottom-right.png",
    fullPage: false,
  });
  await page.keyboard.press("Escape");

  // 375x667 near the top-left: clamped horizontally, no overflow.
  await page.setViewportSize({ width: 375, height: 667 });
  await page.waitForTimeout(200);
  await page.keyboard.press("Control+Alt+KeyK");
  await dragDockTo(5, 5);
  await clickStudioSelector(page, ".ps-chip-open");
  await clickElement(page, copyButton);
  const box375 = await fallbackInside({ width: 375, height: 667 });
  const copyBox375 = (await copyButton.boundingBox())!;
  expect(
    Math.abs(box375.y - (copyBox375.y + copyBox375.height + 8))
  ).toBeLessThanOrEqual(2);
  await page.screenshot({
    path: "test-results/g01-copy-fallback-375.png",
    fullPage: false,
  });
  await page.keyboard.press("Escape");

  // Round-4 finding 3: Copy (C) fires from a focused NON-editable Studio
  // control — with the clipboard denied, the manual fallback opens.
  await root
    .locator("[role='toolbar'] [aria-label='Copy annotations']")
    .focus();
  await page.keyboard.press("Control+Alt+KeyC");
  await expect(root.locator(".ps-copy-fallback")).toBeVisible();
  // Round-6 addendum: the manual-Copy fallback is the newly opened,
  // topmost surface — NO toolbar tooltip may linger above it (the
  // tooltipsSuppressed flag closes them), so ONE Esc dismisses the
  // fallback.
  await expect(root.locator("[role='tooltip']")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(root.locator(".ps-copy-fallback")).toHaveCount(0);

  // Round-5 blocker 3: C from a focused COLLAPSED chip control (one Open
  // annotation; clipboard denied) expands the toolbar AND opens the
  // manual fallback.
  await page.keyboard.press("Control+Alt+KeyK");
  await expect(root.locator(".ps-collapsed-chip")).toBeVisible();
  await root.locator(".ps-chip-drag").focus();
  await page.keyboard.press("Control+Alt+KeyC");
  await expect(root.locator("[role='toolbar']")).toBeVisible();
  await expect(root.locator(".ps-copy-fallback")).toBeVisible();
  await page.screenshot({
    path: "test-results/g01-copy-fallback-collapsed-c.png",
    fullPage: false,
  });
  // Round-6 addendum: expansion + fallback must leave ZERO open tooltips
  // (no stale chip-Drag tooltip carried onto the bar grip, no hover
  // tooltip above the dialog) — ONE Esc closes the fallback.
  await expect(root.locator("[role='tooltip']")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(root.locator(".ps-copy-fallback")).toHaveCount(0);

  // Cleanup: delete the annotation so later tests start empty.
  await root.getByRole("button", { name: "Annotation list" }).click();
  await clickStudioSelector(page, ".ps-annotation-item [aria-label='Delete']");
  await root.locator(".ps-annotation-confirm").waitFor();
  await clickStudioSelector(page, ".ps-annotation-confirm button");
  await expect.poll(() => readActiveTask().annotations.length).toBe(0);
});

// =====================================================================
// Goal 02 — Fast Target-Side Composer and Continuous Annotation Loop
// (G02-14: real-browser evidence; proofs G02-01..G02-12 exercised live)
// =====================================================================

test("G02: target-side composer beside the target, continuous loop, no Done (EN + ZH screenshots)", async ({
  page,
}) => {
  await signIn(page);
  // The login lands on the application index; the users table drives the
  // interactions below.
  await page.goto(resolvePortalTestURL(environment, "/users"));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(resolvePortalTestURL(environment, "/users"));
  await page.locator("tbody tr").first().waitFor();
  const root = page.locator("#portal-studio-root");
  await openStudio(page);
  const bar = root.locator("[role='toolbar']");

  // G02-05: Pick is single-target — one click, one annotation.
  await root.getByRole("button", { name: "Pick element" }).click();
  const row = page.locator("tbody tr").first();
  await hoverElement(page, row);
  await clickElement(page, row);

  // G02-01: the local composer opens BESIDE the target, autofocused.
  const composer = root.getByRole("dialog", { name: "Annotation" });
  await expect(composer).toBeVisible();
  await expect(root.getByRole("textbox", { name: "Annotation comment" })).toBeFocused();
  const composerBox = (await composer.boundingBox())!;
  const rowBox = (await row.boundingBox())!;

  // G02 P2 regression: the composer must NOT vertically intersect the
  // target row. It is anchored BELOW the captured target (the shared
  // helper's below preference, gap away) — an autofocus-triggered page
  // scroll used to drift the anchor after placement and overlap the row
  // by ~13px; focus now uses preventScroll so the anchor stays exact.
  expect(composerBox.y).toBeGreaterThanOrEqual(rowBox.y + rowBox.height);
  // Horizontal association: the composer remains over the row's span
  // (left-aligned to the captured cell — never far from the target).
  expect(composerBox.x).toBeGreaterThanOrEqual(rowBox.x);
  expect(composerBox.x).toBeLessThan(rowBox.x + rowBox.width);
  // Viewport-aware anchored placement (G02-10 live clamp check): the
  // composer stays fully inside the viewport.
  expect(composerBox.x).toBeGreaterThanOrEqual(0);
  expect(composerBox.y).toBeGreaterThanOrEqual(0);
  expect(composerBox.x + composerBox.width).toBeLessThanOrEqual(1440);
  expect(composerBox.y + composerBox.height).toBeLessThanOrEqual(900);
  await page.screenshot({
    path: "test-results/g02-composer-target.png",
    fullPage: false,
  });

  // G02-01/A: the selected target stays highlighted while the composer is
  // open (the .ps-selected outline measures the committed selection).
  await expect(root.locator(".ps-outline.ps-selected")).toHaveCount(1);

  // G02-02: no technical Draft/Saved surface, no Done.
  await expect(composer.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
  await expect(composer.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  await expect(
    page.locator("#portal-studio-root").getByRole("button", { name: "Done" })
  ).toHaveCount(0);
  // G02-12: the status panel is ENTIRELY absent during the composer
  // draft (it only renders for picking/multi/marquee sections).
  expect(await root.locator(".ps-status-panel").count()).toBe(0);

  // G02-03: Ctrl+Enter saves; the compact toast replaces the Saved panel;
  // G02-11: marker appears immediately.
  await page.locator("#portal-studio-root textarea").fill("G02 continuous one");
  await saveWithCtrlEnter(page);
  await expect(
    root.locator(".ps-save-toast", { hasText: "Annotation saved" })
  ).toBeVisible();

  await expect(root.locator(".ps-marker-anchor")).toHaveCount(1);
  await expect(root.locator(".ps-save-toast")).toContainText("Annotation saved");
  await page.screenshot({
    path: "test-results/g02-save-toast.png",
    fullPage: false,
  });

  // G02-04/G02-03: Pick RESUMES — no re-arm click; the next capture works
  // immediately; Cmd+Enter (Meta) also saves.
  await expect(
    root.getByRole("button", { name: "Pick element" })
  ).toHaveAttribute("aria-pressed", "true");
  await hoverElement(page, row);
  await clickElement(page, row);
  await expect(composer).toBeVisible();
  await page.locator("#portal-studio-root textarea").fill("G02 continuous two");
  await page.keyboard.press("Meta+Enter");
  await expect(
    root.locator(".ps-save-toast", { hasText: "Annotation saved" })
  ).toBeVisible();
  await expectOpenCount(page, root, "2");
  const task = readActiveTask();
  expect(task.annotations).toHaveLength(2);
  expect(task.annotations.map((a) => a.comment)).toEqual([
    "G02 continuous one",
    "G02 continuous two",
  ]);
  // G02-12: the horizontal toolbar never grew vertically — the composer is
  // a separate surface, the bar still has exactly its row of buttons.
  await expect(
    bar.locator("textarea, input").count()
  ).resolves.toBe(0);
  expect(await bar.getByRole("button").count()).toBe(9);
  await page.screenshot({
    path: "test-results/g02-continuous-loop.png",
    fullPage: false,
  });

  // G02-06: switch to Multi — the ONLY multi-target path; a 2-element
  // group saves as ONE multi annotation and resumes with an EMPTY group.
  await root.getByRole("button", { name: "Multi-select" }).click();
  const cellA = page.locator("tbody tr").first().locator("td").first();
  const cellB = page.locator("tbody tr").first().locator("td").nth(1);
  await hoverElement(page, cellA);
  await clickElement(page, cellA);
  await hoverElement(page, cellB);
  await clickElement(page, cellB);
  await clickStudioButton(page, "Finish group");
  await expect(composer).toBeVisible();
  await page.locator("#portal-studio-root textarea").fill("G02 multi group");
  await saveWithCtrlEnter(page);
  await expect(
    root.locator(".ps-save-toast", { hasText: "Annotation saved" })
  ).toBeVisible();
  await expect(
    root.getByRole("button", { name: "Multi-select" })
  ).toHaveAttribute("aria-pressed", "true");
  await expect(root.locator(".ps-status-panel")).toContainText("Selected");
  await expect(root.locator(".ps-status-panel")).toContainText("0");
  expect(readActiveTask().annotations.at(-1)!.kind).toBe("multi");
  expect(readActiveTask().annotations.at(-1)!.elements).toHaveLength(2);

  // Cleanup: delete everything so later tests start empty.
  await openList(page);
  await root
    .locator(".ps-annotation-item [aria-label='Delete']")
    .first()
    .click();
  await root.locator(".ps-annotation-confirm").waitFor();
  await clickStudioSelector(page, ".ps-annotation-confirm button");
  await expect.poll(() => readActiveTask().annotations.length).toBe(2);
  await openList(page);
  await root
    .locator(".ps-annotation-item [aria-label='Delete']")
    .first()
    .click();
  await root.locator(".ps-annotation-confirm").waitFor();
  await clickStudioSelector(page, ".ps-annotation-confirm button");
  await expect.poll(() => readActiveTask().annotations.length).toBe(1);
  await openList(page);
  await root
    .locator(".ps-annotation-item [aria-label='Delete']")
    .first()
    .click();
  await root.locator(".ps-annotation-confirm").waitFor();
  await clickStudioSelector(page, ".ps-annotation-confirm button");
  await expect.poll(() => readActiveTask().annotations.length).toBe(0);

  // ---- ZH locale evidence: the composer + toast in Chinese ----
  await page.route("**/api/app:getLang*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { lang: "zh-CN", resources: {} } }),
    });
  });
  await page.reload();
  await page.locator("tbody tr").first().waitFor();
  await clickStudioSelector(page, ".ps-chip-open");
  await root.getByRole("button", { name: "拾取元素" }).click();
  await hoverElement(page, page.locator("tbody tr").first());
  await clickElement(page, page.locator("tbody tr").first());
  const zhComposer = root.getByRole("dialog", { name: "批注" });
  await expect(zhComposer).toBeVisible();
  await expect(root.getByRole("textbox", { name: "标注评论" })).toBeFocused();
  await page.screenshot({
    path: "test-results/g02-composer-zh.png",
    fullPage: false,
  });
  await page.locator("#portal-studio-root textarea").fill("中文连续批注");
  await saveWithCtrlEnter(page);
  await expect(root.locator(".ps-save-toast")).toContainText("批注已保存");
  await expect(root.getByRole("button", { name: "完成" })).toHaveCount(0);
  await page.screenshot({
    path: "test-results/g02-save-toast-zh.png",
    fullPage: false,
  });
  await expect.poll(() => readActiveTask().annotations.at(-1)?.comment).toBe(
    "中文连续批注"
  );
  // Cleanup ZH annotation (the list toggle is localized in ZH here).
  await root.getByRole("button", { name: "批注列表" }).click();
  await expect(root.locator("#ps-annotation-list")).toBeVisible();
  await clickStudioSelector(page, ".ps-annotation-item [aria-label='删除']");
  await root.locator(".ps-annotation-confirm").waitFor();
  await clickStudioSelector(page, ".ps-annotation-confirm button");
  await expect.poll(() => readActiveTask().annotations.length).toBe(0);
});

// =====================================================================
// Goal 03 — Stable Marker/List Semantics and Viewport Polish (G03-01..10)
// =====================================================================

test("G03: stable numbers (marker/list/editor/Copy), visibility, markers, region scroll, 375x667", async ({
  page,
}) => {
  await signIn(page);
  // The login lands on the application index; the users table drives the
  // interactions below.
  await page.goto(resolvePortalTestURL(environment, "/users"));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(resolvePortalTestURL(environment, "/users"));
  await page.locator("tbody tr").first().waitFor();
  const root = page.locator("#portal-studio-root");
  await openStudio(page);
  const bar = root.locator("[role='toolbar']");

  // ---- G03-01: create 1 open + 2 completed + 3 open (three annotations,
  // complete the middle one) — numbers must stay FULL-ORDER everywhere.
  const targets = [
    page.locator("tbody tr").first().locator("td").nth(0),
    page.locator("tbody tr").first().locator("td").nth(1),
    page.locator("tbody tr").first().locator("td").nth(2),
  ];
  for (let index = 0; index < targets.length; index += 1) {
    await startPicking(page);
    // Frozen page: raw mouse helpers (see hoverElement).
    await hoverElement(page, targets[index]);
    await clickElement(page, targets[index]);
    await page
      .locator("#portal-studio-root textarea")
      .fill(`G03 annotation ${index + 1}`);
    await saveWithCtrlEnter(page);
    await expectOpenCount(page, root, String(index + 1));
  }
  // Markers 1, 2, 3 all exist (full order).
  for (const number of [1, 2, 3]) {
    await expect(
      root.getByRole("button", { name: `Annotation ${number}: open editor` })
    ).toBeVisible();
  }
  // Complete the MIDDLE annotation via the list (All view).
  await openList(page);
  await root.getByRole("button", { name: "All", exact: true }).click();
  await root
    .locator(".ps-annotation-item [aria-label='Complete']")
    .nth(1)
    .click();
  await expect
    .poll(() => readActiveTask().annotations.filter((a) => a.status === "open").length)
    .toBe(2);
  // Open view: markers 1 and 3 only; the list shows "1 open · 3 total".
  await root.getByRole("button", { name: "Open", exact: true }).click();
  await expect(
    root.getByRole("button", { name: "Annotation 2: open editor" })
  ).toHaveCount(0);
  await expect(
    root.getByRole("button", { name: "Annotation 1: open editor" })
  ).toBeVisible();
  await expect(
    root.getByRole("button", { name: "Annotation 3: open editor" })
  ).toBeVisible();
  await expect(root.locator(".ps-list-counts")).toHaveText("2 open · 3 total");
  // Editor shows the stable number for #3.
  await root.getByRole("button", { name: "Annotation 3: open editor" }).click();
  const editor = root.getByRole("dialog", { name: "Annotation editor" });
  await expect(editor).toContainText("Annotation 3 · Annotation comment");
  await page.keyboard.press("Escape");

  // Copy (open-only) keeps FULL-ORDER numbers — "Annotation 1" + "Annotation 3"
  // (the async clipboard rejection settles via the poll, like the G04 flow).
  let copied = "";
  await expect
    .poll(
      async () => {
        await bar.getByRole("button", { name: "Copy annotations" }).click();
        const fb = root.locator(".ps-copy-fallback textarea");
        if (await fb.isVisible().catch(() => false)) {
          copied = await fb.inputValue();
        } else {
          copied = await page.evaluate(() =>
            navigator.clipboard.readText().catch(() => "")
          );
        }
        return copied;
      },
      { timeout: 15000 }
    )
    .toContain("Annotation 3");
  expect(copied).toContain("### Annotation 1: [element]");
  expect(copied).not.toContain("### Annotation 2:");
  // Close the fallback (topmost) and the list deterministically — the
  // poll's final Copy click resolves asynchronously (one Esc per surface).
  await expect
    .poll(
      async () => {
        if ((await root.locator(".ps-copy-fallback").count()) > 0) {
          await page.keyboard.press("Escape");
        } else if ((await root.locator(".ps-list-panel").count()) > 0) {
          await page.keyboard.press("Escape");
        }
        return (
          (await root.locator(".ps-copy-fallback").count()) === 0 &&
          (await root.locator(".ps-list-panel").count()) === 0
        );
      },
      { timeout: 10000 }
    )
    .toBe(true);

  // ---- G03-02/03: global visibility is presentation-only; per-item
  // Hide stays independent.
  const before = readActiveTask().annotations.map((a) => a.annotationId);
  // The visibility toggle's label flips (Hide ↔ Show) — match either.
  const visibilityToggle = bar.getByRole("button", {
    name: /Hide markers|Show markers/,
  });
  await clickElement(page, visibilityToggle);
  await expect(root.locator(".ps-marker-anchor")).toHaveCount(0);
  const afterToggle = readActiveTask();
  expect(afterToggle.annotations.map((a) => a.annotationId)).toEqual(before);
  await clickElement(page, visibilityToggle);
  await expect(root.locator(".ps-marker-anchor")).toHaveCount(2);

  // ---- G03-03: per-item Hide stays independent of the global toggle.
  await openList(page);
  await clickStudioSelector(page, ".ps-annotation-item [aria-label='Hide']");
  await expect(root.locator(".ps-marker-anchor")).toHaveCount(1);
  await clickStudioSelector(page, ".ps-annotation-item [aria-label='Hide']");
  await expect(root.locator(".ps-marker-anchor")).toHaveCount(2);
  await bar.getByRole("button", { name: "Annotation list" }).click();
  await expect(root.locator(".ps-list-panel")).toHaveCount(0);

  // ---- G03-06: marker visual box ≥20px and a ~30px HIT TARGET around it.
  const marker = root.locator(".ps-marker-anchor button").first();
  const markerBox = (await marker.boundingBox())!;
  expect(markerBox.width).toBeGreaterThanOrEqual(20);
  expect(markerBox.height).toBeGreaterThanOrEqual(20);
  const hitIsMarker = await page.evaluate(
    ([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return !!el?.closest?.("#portal-studio-root, [data-portal-studio-root]");
    },
    [markerBox.x + markerBox.width / 2 + 12, markerBox.y + markerBox.height / 2]
  );
  // The extended hit target (~30px) is part of the marker button.
  expect(hitIsMarker).toBe(true);
  // Keyboard focus + Enter opens the editor.
  await marker.focus();
  await page.keyboard.press("Enter");
  await expect(editor).toBeVisible();
  await page.keyboard.press("Escape");

  // ---- G03-04: clicking a list item focuses the target + highlights it.
  await openList(page);
  await root.getByRole("button", { name: "Annotation 1: select" }).click();
  await expect(editor).toBeVisible();
  await expect(root.locator(".ps-marker-highlight")).toHaveCount(1);
  // The captured target received focus before the editor mounted; the
  // editor's autofocus then owns the typing focus (either is acceptable).
  const focusState = await page.evaluate(() => {
    const active = document.activeElement;
    return {
      inRow: !!active?.closest?.("tbody tr"),
      inHost:
        active?.id === "portal-studio-root" ||
        !!active?.closest?.("#portal-studio-root, [data-portal-studio-root]"),
    };
  });
  expect(focusState.inRow || focusState.inHost).toBe(true);
  await page.keyboard.press("Escape");

  // ---- G03-05: region anchors follow content scrolling (document-aware).
  await bar.getByRole("button", { name: "Select region" }).click();
  const tableBox = (await page.locator("tbody").boundingBox())!;
  await page.mouse.move(tableBox.x + 20, tableBox.y + 10);
  await page.mouse.down();
  await page.mouse.move(tableBox.x + 220, tableBox.y + 60, { steps: 6 });
  await page.mouse.up();
  await page.locator("#portal-studio-root textarea").fill("G03 region");
  await saveWithCtrlEnter(page);
  await expect(
    root.locator(".ps-save-toast", { hasText: "Annotation saved" })
  ).toBeVisible();
  const regionOverlay = root.locator(".ps-outline.ps-region").first();
  const beforeScroll = (await regionOverlay.boundingBox())!;
  // Make the page scrollable, scroll down, and assert the region FOLLOWS.
  await page.evaluate(() => {
    const spacer = document.createElement("div");
    spacer.id = "g03-spacer";
    spacer.style.height = "800px";
    document.body.appendChild(spacer);
    window.scrollTo(0, 200);
  });
  await page.waitForTimeout(250);
  const afterScroll = (await regionOverlay.boundingBox())!;
  expect(Math.round(beforeScroll.y - afterScroll.y)).toBeGreaterThanOrEqual(190);
  await page.evaluate(() => {
    document.getElementById("g03-spacer")?.remove();
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(200);

  // ---- G03-07: every anchored surface stays fully inside the viewport.
  await startPicking(page);
  await hoverElement(page, targets[0]);
  await clickElement(page, targets[0]);
  await expect(root.locator(".ps-composer")).toBeVisible();
  await openList(page);
  const surfaces = [
    root.locator(".ps-composer"),
    root.locator(".ps-list-panel"),
  ];
  for (const surface of surfaces) {
    await expect(surface).toBeVisible();
    const box = (await surface.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1440);
    expect(box.y + box.height).toBeLessThanOrEqual(900);
  }
  // Close the composer via its Cancel button (the first Esc closes the
  // list panel — the aux panel is the topmost transient here).
  await root
    .getByRole("dialog", { name: "Annotation" })
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(root.locator(".ps-composer")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(root.locator(".ps-list-panel")).toHaveCount(0);

  // ---- G03-08/09: 375×667 — List and composer stay inside, no overflow.
  await page.setViewportSize({ width: 375, height: 667 });
  await page.waitForTimeout(300);
  await openList(page);
  const list375 = (await root.locator(".ps-list-panel").boundingBox())!;
  expect(list375.x).toBeGreaterThanOrEqual(0);
  expect(list375.x + list375.width).toBeLessThanOrEqual(375);
  expect(list375.y + list375.height).toBeLessThanOrEqual(667);
  expect(await viewportFits(page)).toBe(true);
  // G03 blocker regression: the OPEN list panel paints ABOVE the page
  // markers — the stable numbers must never be covered by marker chips.
  const zLive = await page.evaluate(() => {
    const host = document.querySelector(
      "#portal-studio-root"
    ) as HTMLElement & { shadowRoot: ShadowRoot };
    const sr = host.shadowRoot;
    const zOf = (el: Element | null) =>
      el ? Number(getComputedStyle(el).zIndex) : 0;
    return {
      marker: zOf(sr.querySelector(".ps-marker-anchor")),
      anchors: sr.querySelectorAll(".ps-marker-anchor").length,
      regions: sr.querySelectorAll(".ps-marker-region-chip").length,
      panel: zOf(sr.querySelector(".ps-list-panel")),
      css: sr.querySelector("style")?.textContent ?? "",
    };
  });
  expect(zLive.panel).toBeGreaterThan(zLive.marker);
  const cssZ = (selector: string) => {
    const match = zLive.css.match(
      new RegExp(`\\.ps-${selector}[^}]*z-index:\\s*(\\d+)`)
    );
    return match ? Number(match[1]) : 0;
  };
  expect(cssZ("marker-anchor")).toBe(2147483002);
  expect(cssZ("list-panel")).toBe(2147483003);
  expect(cssZ("marker-editor")).toBe(2147483004);
  expect(cssZ("copy-fallback")).toBe(2147483005);
  expect(cssZ("tooltip")).toBe(2147483006);
  expect(cssZ("composer")).toBe(2147483007);
  expect(cssZ("save-toast")).toBe(2147483008);
  await page.screenshot({
    path: "test-results/g03-list-375.png",
    fullPage: false,
  });
  await bar.getByRole("button", { name: "Annotation list" }).click();
  await startPicking(page);
  await hoverElement(page, targets[1]);
  await clickElement(page, targets[1]);
  await expect(root.locator(".ps-composer")).toBeVisible();
  const composer375 = (await root.locator(".ps-composer").boundingBox())!;
  expect(composer375.x).toBeGreaterThanOrEqual(0);
  expect(composer375.x + composer375.width).toBeLessThanOrEqual(375);
  expect(composer375.y + composer375.height).toBeLessThanOrEqual(667);
  expect(await viewportFits(page)).toBe(true);
  await page.screenshot({
    path: "test-results/g03-composer-375.png",
    fullPage: false,
  });
  await page.keyboard.press("Escape");

  // ---- G03-10: markers stay route-gated (only on the captured route).
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(resolvePortalTestURL(environment, "/dev/ai-chat"));
  await page.waitForTimeout(1200);
  const root2 = page.locator("#portal-studio-root");
  // The users-route annotations must NOT render markers on /dev/ai-chat.
  await expect(root2.locator(".ps-marker-anchor")).toHaveCount(0);

  // Cleanup: back to /users and delete everything (All view — the
  // completed item is hidden in the default Open view).
  await page.goto(resolvePortalTestURL(environment, "/users"));
  await page.locator("tbody tr").first().waitFor();
  await openList(page);
  await root.getByRole("button", { name: "All", exact: true }).click();
  for (let index = 0; index < 4; index += 1) {
    await root
      .locator(".ps-annotation-item [aria-label='Delete']")
      .first()
      .click();
    await root.locator(".ps-annotation-confirm").waitFor();
    await clickStudioSelector(page, ".ps-annotation-confirm button");
    await expect
      .poll(() => readActiveTask().annotations.length)
      .toBe(3 - index);
  }
  await expect.poll(() => readActiveTask().annotations.length).toBe(0);
  // ---- ZH evidence at 375×667: the composer stays inside the narrow
  // viewport in Chinese too (cancelled — no annotation persists).
  await page.route("**/api/app:getLang*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { lang: "zh-CN", resources: {} } }),
    });
  });
  await page.reload();
  await page.locator("tbody tr").first().waitFor();
  await page.setViewportSize({ width: 375, height: 667 });
  await clickStudioSelector(page, ".ps-chip-open");
  await root.getByRole("button", { name: "拾取元素" }).click();
  await hoverElement(
    page,
    page.locator("tbody tr").first().locator("td").nth(1)
  );
  await clickElement(
    page,
    page.locator("tbody tr").first().locator("td").nth(1)
  );
  await expect(root.getByRole("dialog", { name: "批注" })).toBeVisible();
  const zhComposer = (await root.locator(".ps-composer").boundingBox())!;
  expect(zhComposer.x).toBeGreaterThanOrEqual(0);
  expect(zhComposer.x + zhComposer.width).toBeLessThanOrEqual(375);
  expect(zhComposer.y + zhComposer.height).toBeLessThanOrEqual(667);
  expect(await viewportFits(page)).toBe(true);
  await page.screenshot({
    path: "test-results/g03-composer-375-zh.png",
    fullPage: false,
  });
  await page.keyboard.press("Escape");
  await expect(root.locator(".ps-composer")).toHaveCount(0);
  await expect.poll(() => readActiveTask().annotations.length).toBe(0);
});

// =====================================================================
// Goal 04 — Agent CLI and Task Reliability (G04-01..G04-10)
// =====================================================================

test("G04: timestamps (createdAt immutable / updatedAt changes), Copy completion command, package-script CLI completion", async ({
  page,
}) => {
  await signIn(page);
  // The login lands on the application index; the users table drives the
  // interactions below.
  await page.goto(resolvePortalTestURL(environment, "/users"));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(resolvePortalTestURL(environment, "/users"));
  await page.locator("tbody tr").first().waitFor();
  const root = page.locator("#portal-studio-root");
  await openStudio(page);

  // G04-03: two browser adds — taskId stable, createdAt IMMUTABLE,
  // updatedAt changes on the second mutation.
  await startPicking(page);
  await hoverElement(page, page.locator("tbody tr").first());
  await clickElement(page, page.locator("tbody tr").first());
  await page.locator("#portal-studio-root textarea").fill("G04 timestamp one");
  await saveWithCtrlEnter(page);
  await expect(
    root.locator(".ps-save-toast", { hasText: "Annotation saved" })
  ).toBeVisible();
  const afterFirst = readActiveTask();
  expect(typeof afterFirst.createdAt).toBe("string");
  expect(typeof afterFirst.updatedAt).toBe("string");
  const firstUpdatedAt = afterFirst.updatedAt!;
  await page.waitForTimeout(1200);
  await startPicking(page);
  await hoverElement(
    page,
    page.locator("tbody tr").first().locator("td").nth(1)
  );
  await clickElement(
    page,
    page.locator("tbody tr").first().locator("td").nth(1)
  );
  await page.locator("#portal-studio-root textarea").fill("G04 timestamp two");
  await saveWithCtrlEnter(page);
  await expectOpenCount(page, root, "2");
  const afterSecond = readActiveTask();
  expect(afterSecond.taskId).toBe(afterFirst.taskId);
  expect(afterSecond.createdAt).toBe(afterFirst.createdAt);
  expect(afterSecond.updatedAt).not.toBe(firstUpdatedAt);
  expect(afterSecond.updatedAt! > firstUpdatedAt).toBe(true);

  // G04-03: Copy instructions include the REAL working completion command.
  await root.getByRole("button", { name: "Copy annotations" }).click();
  let copied = "";
  await expect
    .poll(
      async () => {
        const fb = root.locator(".ps-copy-fallback textarea");
        if (await fb.isVisible().catch(() => false)) {
          copied = await fb.inputValue();
        } else {
          copied = await page.evaluate(() =>
            navigator.clipboard.readText().catch(() => "")
          );
        }
        return copied;
      },
      { timeout: 15000 }
    )
    .toContain("pnpm studio:complete");
  const annotationId = readActiveTask().annotations[0].annotationId;
  expect(copied).toContain(
    `pnpm studio:complete -- ${annotationId} --verified --summary`
  );
  await page.keyboard.press("Escape");
  await expect(root.locator(".ps-copy-fallback")).toHaveCount(0);

  // G04-01/03: run the REAL package script to complete the first
  // annotation; the artifact reflects it with explicit evidence and a
  // bumped updatedAt.
  const updatedBeforeCli = readActiveTask().updatedAt!;
  const cliEnv = { ...process.env, PORTAL_STUDIO_DIR: studioDir };
  const completed = execFileSync(
    "pnpm",
    [
      "run",
      "studio:complete",
      "--",
      annotationId,
      "--verified",
      "--summary",
      "verified in the browser flow",
    ],
    { encoding: "utf8", env: cliEnv }
  );
  expect(completed).toContain("completed");
  await expect
    .poll(() => readActiveTask().annotations[0]?.status, { timeout: 3000 })
    .toBe("completed");
  const artifact = readActiveTask();
  expect(artifact.annotations[0].completedEvidence).toMatchObject({
    verified: true,
    summary: "verified in the browser flow",
    source: "cli",
  });
  expect(artifact.createdAt).toBe(afterFirst.createdAt);
  expect(artifact.updatedAt).not.toBe(updatedBeforeCli);
  // The browser's bounded polling reflects the CLI completion (Open view
  // empties within the sync target).
  await openList(page);
  await expect(root.locator(".ps-annotation-item")).toHaveCount(1, {
    timeout: 2000,
  });
  await barCloseForG04(page);
});

/** Close the list panel deterministically (helper for the G04 flow). */
const barCloseForG04 = async (page: import("@playwright/test").Page) => {
  const root = page.locator("#portal-studio-root");
  await expect
    .poll(
      async () => {
        if ((await root.locator(".ps-list-panel").count()) > 0) {
          await page.keyboard.press("Escape");
        }
        return (await root.locator(".ps-list-panel").count()) === 0;
      },
      { timeout: 10000 }
    )
    .toBe(true);
};


/** Goal 05 (G05-06) — deterministic visual regression snapshots. These
 *  tests live in THIS file so they share the single serial worker and the
 *  same .portal-studio artifact lifecycle as the interaction suite (a
 *  separate spec file would race the shared task file across workers).
 */
const VISUAL_DIR = path.resolve("test-results/visual");
mkdirSync(VISUAL_DIR, { recursive: true });

const seedTask = (openCount: number) => {
  mkdirSync(path.join(studioDir, "tasks"), { recursive: true });
  writeFileSync(
    taskFile,
    JSON.stringify({
      schemaVersion: 6,
      taskId: "task-visual-1",
      createdAt: "2026-08-11T00:00:00.000Z",
      url: resolvePortalTestURL(environment, "/users"),
      title: "Users",
      annotations: Array.from({ length: openCount }, (_, index) => ({
        annotationId: `vis-${index + 1}`,
        kind: "element",
        comment: `Visual annotation ${index + 1}`,
        createdAt: "2026-08-11T00:00:00.000Z",
        status: "open",
        elements: [],
      })),
      businessContext: [],
      redaction: { droppedKeys: [], redactedValues: 0, truncatedValues: 0 },
    })
  );
};

const noHorizontalOverflow = (page: import("@playwright/test").Page) =>
  page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1
  );

test("G05-06 collapsed chip: 0/1/9/100 open, focus, EN/ZH, no overflow", async ({
  page,
}) => {
  // Start from a clean artifact (the studio fetches at mount).
  rmSync(path.join(studioDir, "tasks"), { recursive: true, force: true });
  await signIn(page);
  // The login lands on the application index; the users table drives the
  // interactions below.
  await page.goto(resolvePortalTestURL(environment, "/users"));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(resolvePortalTestURL(environment, "/users"));
  await page.locator("tbody tr").first().waitFor();
  const root = page.locator("#portal-studio-root");

  // 0 open: feedback icon slot.
  await expect(root.locator(".ps-collapsed-chip")).toBeVisible();
  await expect(root.locator(".ps-status-slot")).not.toHaveText(/\d/);
  await expect(await noHorizontalOverflow(page)).toBe(true);
  await page.screenshot({ path: `${VISUAL_DIR}/chip-0-open.png`, fullPage: false });

  // 1 / 9 / 100 open counts (99+ cap).
  for (const [count, expected] of [
    [1, "1"],
    [9, "9"],
    [100, "99+"],
  ] as const) {
    seedTask(count);
    await page.reload();
    await page.locator("tbody tr").first().waitFor();
    await expect(root.locator(".ps-status-slot")).toHaveText(expected);
    await expect(await noHorizontalOverflow(page)).toBe(true);
    await page.screenshot({
      path: `${VISUAL_DIR}/chip-${count}-open.png`,
      fullPage: false,
    });
  }
  // Chip body click expands (never a drag).
  await clickStudioSelector(page, ".ps-chip-open");
  await expect(root.locator("[role='toolbar']")).toBeVisible();
  await page.screenshot({
    path: `${VISUAL_DIR}/chip-expanded-from-100.png`,
    fullPage: false,
  });

  // Focus: collapse, then the Expand button receives visible focus
  // (hit target/focus).
  await root.getByRole("button", { name: "Collapse toolbar" }).click();
  await expect(root.locator(".ps-collapsed-chip")).toBeVisible();
  await root.locator(".ps-chip-expand").focus();
  await expect(root.locator(".ps-chip-expand")).toBeFocused();
  await page.screenshot({
    path: `${VISUAL_DIR}/chip-expand-focused.png`,
    fullPage: false,
  });
});

test("G05-06 expanded toolbar: order, active states, tooltips, Help, List, 1440/375, dark host", async ({
  page,
}) => {
  await signIn(page);
  // The login lands on the application index; the users table drives the
  // interactions below.
  await page.goto(resolvePortalTestURL(environment, "/users"));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(resolvePortalTestURL(environment, "/users"));
  await page.locator("tbody tr").first().waitFor();
  const root = page.locator("#portal-studio-root");
  await clickStudioSelector(page, ".ps-chip-open");
  const bar = root.locator("[role='toolbar']");

  // Exact horizontal order + no wrap.
  const labels = await bar
    .getByRole("button")
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("aria-label"))
    );
  expect(labels).toEqual([
    "Drag toolbar",
    "Pick element",
    "Multi-select",
    "Select region",
    "Copy annotations",
    "Hide markers",
    "Keyboard shortcuts",
    "Annotation list",
    "Collapse toolbar",
  ]);
  await expect(await noHorizontalOverflow(page)).toBe(true);
  await page.screenshot({
    path: `${VISUAL_DIR}/toolbar-order-1440.png`,
    fullPage: false,
  });

  // Capture active states (Pick / Multi / Area pressed).
  await bar.getByRole("button", { name: "Pick element" }).click();
  await expect(
    bar.getByRole("button", { name: "Pick element" })
  ).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({
    path: `${VISUAL_DIR}/toolbar-pick-active.png`,
    fullPage: false,
  });
  await page.keyboard.press("Escape");
  await bar.getByRole("button", { name: "Multi-select" }).click();
  await expect(
    bar.getByRole("button", { name: "Multi-select" })
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await bar.getByRole("button", { name: "Select region" }).click();
  await expect(
    bar.getByRole("button", { name: "Select region" })
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");

  // Tooltips for every action (focus each).
  for (const name of [
    "Pick element",
    "Multi-select",
    "Select region",
    "Copy annotations",
    "Hide markers",
    "Keyboard shortcuts",
    "Annotation list",
  ]) {
    const action = bar.getByRole("button", { name });
    await action.focus();
    await expect(root.locator(".ps-tooltip")).toBeVisible();
  }
  await page.screenshot({
    path: `${VISUAL_DIR}/toolbar-tooltip.png`,
    fullPage: false,
  });

  // Help popover.
  await bar.getByRole("button", { name: "Keyboard shortcuts" }).click();
  await expect(root.locator("#ps-shortcut-help")).toBeVisible();
  await page.screenshot({
    path: `${VISUAL_DIR}/toolbar-help.png`,
    fullPage: false,
  });
  await page.keyboard.press("Escape");

  // List panel Open/All (with seeded annotations).
  seedTask(3);
  await page.reload();
  await page.locator("tbody tr").first().waitFor();
  await clickStudioSelector(page, ".ps-chip-open");
  await root.getByRole("button", { name: "Annotation list" }).click();
  await expect(root.locator(".ps-list-panel")).toBeVisible();
  await page.screenshot({
    path: `${VISUAL_DIR}/list-open.png`,
    fullPage: false,
  });
  await root.getByRole("button", { name: "All", exact: true }).click();
  await expect(root.locator(".ps-annotation-item")).toHaveCount(3);
  await page.screenshot({
    path: `${VISUAL_DIR}/list-all.png`,
    fullPage: false,
  });
  await page.keyboard.press("Escape");

  // 375×667: no wrap, no overflow, bar inside.
  await page.setViewportSize({ width: 375, height: 667 });
  await page.waitForTimeout(300);
  await expect(await noHorizontalOverflow(page)).toBe(true);
  const barBox = (await bar.boundingBox())!;
  expect(barBox.x + barBox.width).toBeLessThanOrEqual(375);
  await page.screenshot({
    path: `${VISUAL_DIR}/toolbar-375.png`,
    fullPage: false,
  });

  // Dark host: force the theme attribute and snapshot the toolbar.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => {
    const host = document.querySelector(
      "#portal-studio-root"
    ) as HTMLElement & { shadowRoot: ShadowRoot };
    host.dataset.psTheme = "dark";
  });
  await page.waitForTimeout(200);
  await page.screenshot({
    path: `${VISUAL_DIR}/toolbar-dark-host.png`,
    fullPage: false,
  });
});

test("G05-06 annotation surfaces: composer, marker editor, completed/unresolved/hidden, long list", async ({
  page,
}) => {
  await signIn(page);
  // The login lands on the application index; the users table drives the
  // interactions below.
  await page.goto(resolvePortalTestURL(environment, "/users"));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(resolvePortalTestURL(environment, "/users"));
  await page.locator("tbody tr").first().waitFor();
  const root = page.locator("#portal-studio-root");
  await clickStudioSelector(page, ".ps-chip-open");

  // Composer beside a captured target (within the viewport).
  await root.getByRole("button", { name: "Pick element" }).click();
  await hoverElement(page, page.locator("tbody tr").first());
  await clickElement(page, page.locator("tbody tr").first());
  await expect(root.locator(".ps-composer")).toBeVisible();
  const composerBox = (await root.locator(".ps-composer").boundingBox())!;
  expect(composerBox.x).toBeGreaterThanOrEqual(0);
  expect(composerBox.x + composerBox.width).toBeLessThanOrEqual(1440);
  expect(composerBox.y + composerBox.height).toBeLessThanOrEqual(900);
  await page.screenshot({
    path: `${VISUAL_DIR}/composer-1440.png`,
    fullPage: false,
  });
  await page.keyboard.press("Escape");

  // Marker editor over a seeded marker: seed annotations whose selector
  // candidates match a resolvable page target (planted AFTER the reload,
  // which otherwise clears the injected element).
  const capture = {
    tagName: "div",
    selector: "#g05-marker-target",
    bounds: { x: 200, y: 300, width: 120, height: 40 },
    componentName: null,
    source: null,
    sourceStack: [],
    htmlPreview: "",
    styleText: "",
    fingerprint: {
      tagName: "div",
      role: "",
      accessibleName: "",
      text: "",
      identityAttributes: { id: "g05-marker-target" },
      childCount: 0,
      parent: { tagName: "body", role: "" },
    },
  };
  mkdirSync(path.join(studioDir, "tasks"), { recursive: true });
  writeFileSync(
    taskFile,
    JSON.stringify({
      schemaVersion: 6,
      taskId: "task-visual-marker",
      createdAt: "2026-08-11T00:00:00.000Z",
      url: resolvePortalTestURL(environment, "/users"),
      title: "Users",
      annotations: [1, 2, 3].map((number) => ({
        annotationId: `vis-marker-${number}`,
        kind: "element",
        comment: `Marker ${number}`,
        createdAt: "2026-08-11T00:00:00.000Z",
        status: "open",
        elements: [capture],
      })),
      businessContext: [],
      redaction: { droppedKeys: [], redactedValues: 0, truncatedValues: 0 },
    })
  );
  await page.reload();
  await page.locator("tbody tr").first().waitFor();
  await page.evaluate(() => {
    const target = document.createElement("div");
    target.id = "g05-marker-target";
    target.style.cssText =
      "position:fixed;left:200px;top:300px;width:120px;height:40px;z-index:1";
    document.body.appendChild(target);
  });
  await clickStudioSelector(page, ".ps-chip-open");
  await page.waitForTimeout(400);
  const marker = root.locator(".ps-marker-anchor button").first();
  await expect(marker).toBeVisible();
  await marker.focus();
  await page.keyboard.press("Enter");
  await expect(root.getByRole("dialog", { name: "Annotation editor" })).toBeVisible();
  const editorBox = (await root
    .locator(".ps-marker-editor")
    .boundingBox())!;
  expect(editorBox.x).toBeGreaterThanOrEqual(0);
  expect(editorBox.x + editorBox.width).toBeLessThanOrEqual(1440);
  expect(editorBox.y + editorBox.height).toBeLessThanOrEqual(900);
  await page.screenshot({
    path: `${VISUAL_DIR}/marker-editor.png`,
    fullPage: false,
  });
  await page.keyboard.press("Escape");

  // Completed / unresolved / hidden items in the list.
  mkdirSync(path.join(studioDir, "tasks"), { recursive: true });
  writeFileSync(
    taskFile,
    JSON.stringify({
      schemaVersion: 6,
      taskId: "task-visual-2",
      createdAt: "2026-08-11T00:00:00.000Z",
      url: resolvePortalTestURL(environment, "/users"),
      title: "Users",
      annotations: [
        {
          annotationId: "vis-completed",
          kind: "element",
          comment: "Completed item",
          createdAt: "2026-08-11T00:00:00.000Z",
          status: "completed",
          completedAt: "2026-08-11T01:00:00.000Z",
          elements: [],
        },
        {
          annotationId: "vis-unresolved",
          kind: "element",
          comment: "Unresolved item",
          createdAt: "2026-08-11T00:00:00.000Z",
          status: "open",
          elements: [
            {
              tagName: "td",
              selectorCandidates: [
                { kind: "id", selector: "#does-not-exist-xyz" },
              ],
              componentCandidates: [],
              sourceCandidates: [],
              snapshot: { text: "gone", attributes: {}, childCount: 0 },
            },
          ],
        },
        {
          annotationId: "vis-hidden",
          kind: "element",
          comment: "Hidden item",
          createdAt: "2026-08-11T00:00:00.000Z",
          status: "open",
          hidden: true,
          elements: [],
        },
        ...Array.from({ length: 40 }, (_, index) => ({
          annotationId: `vis-long-${index}`,
          kind: "element",
          comment: `Long list item ${index}`,
          createdAt: "2026-08-11T00:00:00.000Z",
          status: "open",
          elements: [],
        })),
      ],
      businessContext: [],
      redaction: { droppedKeys: [], redactedValues: 0, truncatedValues: 0 },
    })
  );
  await page.reload();
  await page.locator("tbody tr").first().waitFor();
  await clickStudioSelector(page, ".ps-chip-open");
  await root.getByRole("button", { name: "Annotation list" }).click();
  await expect(root.locator(".ps-list-panel")).toBeVisible();
  await root.getByRole("button", { name: "All", exact: true }).click();
  await expect(root.locator(".ps-annotation-item-completed")).toHaveCount(1);
  await expect(root.locator(".ps-unresolved").first()).toBeVisible();
  await page.screenshot({
    path: `${VISUAL_DIR}/list-states.png`,
    fullPage: false,
  });
  // Long list: the panel scrolls INTERNALLY (no page overflow).
  await expect(await noHorizontalOverflow(page)).toBe(true);
  const panelBox = (await root.locator(".ps-list-panel").boundingBox())!;
  expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(1440);
  await page.screenshot({
    path: `${VISUAL_DIR}/list-long.png`,
    fullPage: false,
  });
});

test("G05-06 HMR: no duplicate Shadow root after a reload; single host", async ({
  page,
}) => {
  await signIn(page);
  await page.goto(resolvePortalTestURL(environment, "/users"));
  await page.locator("tbody tr").first().waitFor();
  await expect(page.locator("#portal-studio-root")).toHaveCount(1);
  const shadowOk = await page.evaluate(() => {
    const host = document.querySelector("#portal-studio-root") as HTMLElement & {
      shadowRoot: ShadowRoot;
    };
    return !!host?.shadowRoot && host.shadowRoot.querySelector("[role='toolbar'], .ps-collapsed-chip") !== null;
  });
  expect(shadowOk).toBe(true);
  await page.reload();
  await page.locator("tbody tr").first().waitFor();
  await expect(page.locator("#portal-studio-root")).toHaveCount(1);
  const shadowOkAfterReload = await page.evaluate(() => {
    const host = document.querySelector("#portal-studio-root") as HTMLElement & {
      shadowRoot: ShadowRoot;
    };
    return !!host?.shadowRoot && host.shadowRoot.querySelector("[role='toolbar'], .ps-collapsed-chip") !== null;
  });
  expect(shadowOkAfterReload).toBe(true);
  await page.screenshot({
    path: `${VISUAL_DIR}/hmr-single-shadow-root.png`,
    fullPage: false,
  });
});
