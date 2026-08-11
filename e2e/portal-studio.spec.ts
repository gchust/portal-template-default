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
    componentCandidates: Array<{ name: string | null; kind?: string }>;
    sourceCandidates: Array<{ file: string; line?: number }>;
    snapshot: {
      text: string;
      attributes: Record<string, string>;
      domOutline?: string;
      computedStyle?: Record<string, string>;
    };
  }>;
  region?: { x: number; y: number; width: number; height: number };
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
  await page
    .locator("#portal-studio-root")
    .getByRole("button", { name: "Collapse toolbar" })
    .click();
  await expect(
    page.locator("#portal-studio-root [role='toolbar']")
  ).toHaveCount(0);
};

/** Expand (if collapsed) and open the annotation-list panel. */
const openList = async (page: import("@playwright/test").Page) => {
  await openStudio(page);
  const list = page.locator("#portal-studio-root .ps-list-panel");
  if ((await list.count()) === 0) {
    await page
      .locator("#portal-studio-root")
      .getByRole("button", { name: "Annotation list" })
      .click();
  }
  await expect(list).toBeVisible();
};

/** The open count lives in the COLLAPSED chip's status slot. Collapse
 *  (presentation only), assert, then restore the expanded/list state. */
const expectOpenCount = async (
  root: import("@playwright/test").Locator,
  expected: string,
  options?: { timeout?: number }
) => {
  const bar = root.locator("[role='toolbar']");
  const list = root.locator(".ps-list-panel");
  const listWasOpen = (await list.count()) > 0;
  if ((await bar.count()) > 0) {
    await root
      .getByRole("button", { name: "Collapse toolbar" })
      .click();
  }
  await expect(root.locator(".ps-status-slot")).toHaveText(
    expected,
    options ?? {}
  );
  await root.locator(".ps-chip-open").click();
  await expect(bar).toBeVisible();
  if (listWasOpen) {
    await root
      .getByRole("button", { name: "Annotation list" })
      .click();
    await expect(list).toBeVisible();
  }
};

/** Zero open annotations: the collapsed chip shows the feedback ICON in
 *  the status slot — no count text, no detached badge. */
const expectNoOpenCount = async (
  root: import("@playwright/test").Locator
) => {
  const bar = root.locator("[role='toolbar']");
  const list = root.locator(".ps-list-panel");
  const listWasOpen = (await list.count()) > 0;
  if ((await bar.count()) > 0) {
    await root
      .getByRole("button", { name: "Collapse toolbar" })
      .click();
  }
  await expect(root.locator(".ps-status-slot")).not.toHaveText(/\d/);
  await root.locator(".ps-chip-open").click();
  await expect(bar).toBeVisible();
  if (listWasOpen) {
    await root
      .getByRole("button", { name: "Annotation list" })
      .click();
    await expect(list).toBeVisible();
  }
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
  await expect(
    page.locator("#portal-studio-root .ps-status-panel", {
      hasText: "Hover an element",
    })
  ).toBeVisible();
};

const saveTask = async (
  page: import("@playwright/test").Page,
  instruction: string
) => {
  await page.locator("#portal-studio-root textarea").fill(instruction);
  await page
    .locator("#portal-studio-root")
    .getByRole("button", { name: "Save", exact: true })
    .click();
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
  await row.hover();
  await row.click();
  // Goal 02: the target-side composer opens beside the capture.
  await expect(
    page
      .locator("#portal-studio-root")
      .getByRole("dialog", { name: "Annotation" })
  ).toBeVisible();
  await saveTask(page, "E2E single: increase row padding");

  let task = readActiveTask();
  expect(task.schemaVersion).toBe(5);
  expect(task.annotations).toHaveLength(1);
  const firstAnnotation = task.annotations[0];
  expect(firstAnnotation.kind).toBe("element");
  expect(firstAnnotation.elements).toHaveLength(1);
  const names = firstAnnotation.elements[0].componentCandidates
    .map((candidate) => candidate.name)
    .filter((name): name is string => typeof name === "string");
  expect(names).toContain("TableRow");
  const sources = firstAnnotation.elements[0].sourceCandidates.map((s) => s.file);
  expect(
    sources.some((file) => file.includes("users-example") || file.includes("src/"))
  ).toBe(true);
  // Business context, redaction manifest, and screenshot ref are present.
  expect(Array.isArray(task.businessContext)).toBe(true);
  expect(task.redaction.redactedValues).toBeGreaterThanOrEqual(0);
  expect(task.screenshot).toBeDefined();
  expect(task.screenshot?.file).toMatch(/^screenshots\/.+\.png$/);

  // Screenshot exists on disk with valid PNG magic.
  const screenshotPath = path.join(studioDir, task.screenshot!.file);
  const png = readFileSync(screenshotPath);
  expect(png.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  expect(png.length).toBeGreaterThan(100);

  // Shell parity: print CLI renders the v2 artifact.
  const printed = execFileSync(
    process.execPath,
    ["scripts/portal-studio-print.mjs", "--json", "--task", task.taskId],
    { encoding: "utf8" }
  );
  expect(JSON.parse(printed)).toEqual(task);
  await closeStudio(page);

  // Round 2 — TRUE Multi-select of two cells within the first row (the
  // sandbox users table has a single row). Review P1: Pick is strictly
  // single-target; Multi is the only multi-target path.
  await openStudio(page);
  await page
    .locator("#portal-studio-root")
    .getByRole("button", { name: "Multi-select" })
    .click();
  const firstRow = page.locator("tbody tr").nth(0);
  const cellA = firstRow.locator("td").nth(0);
  const cellB = firstRow.locator("td").nth(1);
  await cellA.hover();
  await cellA.click();
  await expect(
    page.locator("#portal-studio-root .ps-status-panel", {
      hasText: "Selected",
    })
  ).toBeVisible();
  await cellB.hover();
  await cellB.click();
  await expect(
    page.locator("#portal-studio-root .ps-status-panel", {
      hasText: "Selected",
    })
  ).toBeVisible();
  // Finish the group: ONE annotation carrying BOTH targets.
  await page
    .locator("#portal-studio-root")
    .getByRole("button", { name: "Finish group" })
    .click();
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
  await page
    .locator("#portal-studio-root")
    .getByRole("button", { name: "Select region" })
    .click();
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
  expect(task.screenshot).toBeDefined();
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
  await page
    .locator("#portal-studio-root")
    .getByRole("button", { name: "Cancel" })
    .click();

  // True Multi mode is the ONLY multi-target path: keyboard Space toggles
  // targets into ONE group, Enter opens the comment editor.
  await page
    .locator("#portal-studio-root")
    .getByRole("button", { name: "Multi-select" })
    .click();
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
  const agentTask = {
    schemaVersion: 4,
    taskId: "agent-task-2",
    createdAt: new Date().toISOString(),
    url: single.url,
    title: "Agent write",
    instruction: "Agent-side v4 task (normalized to v5 on write)",
    elements: [
      {
        tagName: "div",
        selectorCandidates: [{ kind: "path", selector: "body > div" }],
        componentCandidates: [],
        snapshot: {
          text: "agent",
          attributes: { class: "x" },
          childCount: 0,
          domOutline: "div.x",
          computedStyle: { display: "block" },
        },
      },
    ],
    businessContext: [],
    redaction: { droppedKeys: [], redactedValues: 0, truncatedValues: 0 },
  };
  const response = await page.request.post(
    resolvePortalTestURL(environment, "__portal-studio/tasks"),
    {
      headers: { "X-Portal-Studio-Token": token },
      data: agentTask,
    }
  );
  expect(response.status()).toBe(200);
  await expect
    .poll(() => readActiveTask().taskId)
    .toBe("agent-task-2");

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
  await page
    .locator("#portal-studio-root")
    .getByRole("button", { name: "Pick element" })
    .click();
  const row = page.locator("tbody tr").first();
  await row.hover();
  await row.click();
  await page
    .locator("#portal-studio-root textarea")
    .fill("diagnostics baseline");
  await page
    .locator("#portal-studio-root")
    .getByRole("button", { name: "Save", exact: true })
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
  await page
    .locator("#portal-studio-root")
    .getByRole("button", { name: "Pick element" })
    .click();
  const row = page.locator("tbody tr").first();
  await row.hover();
  await row.click();
  await page
    .locator("#portal-studio-root textarea")
    .fill("verify loop baseline");
  await page
    .locator("#portal-studio-root")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await expect(
    page.locator("#portal-studio-root .ps-save-toast", {
      hasText: /Annotation saved|批注已保存/,
    })
  ).toBeVisible();

  const token = await page.evaluate(
    () => window.__PORTAL_STUDIO_CONFIG__?.token
  );
  const baseline = readActiveTask();
  expect(baseline.revision).toBeDefined();
  const baselineSourceRevision = baseline.revision!.sourceRevision;

  // REAL edit: touch the referenced source file (HMR will serve the update).
  const targetFile = path.resolve("src/components/ui/table.tsx");
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
  await page
    .locator("#portal-studio-root")
    .getByRole("button", { name: "Collapse toolbar" })
    .click();

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
  await root.locator(".ps-chip-open").click();
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
  const root = page.locator("#portal-studio-root");
  await openStudio(page);

  // Continuous annotation 1: pick the first table row, Ctrl+Enter saves.
  await startPicking(page);
  const row1 = page.locator("tbody tr").first();
  await row1.hover();
  await row1.click();
  await page.locator("#portal-studio-root textarea").fill("First annotation");
  await page.keyboard.press("Control+Enter");
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
  await expectOpenCount(root, "1");
  await expect(root.locator(".ps-marker-anchor")).toHaveCount(1);
  // Marker is INSIDE the shadow host: never in the page DOM.
  expect(await page.locator("body > .ps-marker-anchor").count()).toBe(0);
  // The annotation list is the anchored panel behind the List icon.
  await openList(page);
  await expect(root.locator(".ps-annotation-item")).toHaveCount(1);
  // Close the list so the capture status surface is available again.
  await page
    .locator("#portal-studio-root")
    .getByRole("button", { name: "Annotation list" })
    .click();
  await expect(root.locator(".ps-list-panel")).toHaveCount(0);

  // Continuous annotation 2: every plain pick appends a NEW annotation
  // (the sandbox users table has a single row — pick a second cell).
  await startPicking(page);
  const row2 = page.locator("tbody tr").first().locator("td").nth(1);
  await row2.hover();
  await row2.click();
  await page
    .locator("#portal-studio-root textarea")
    .fill("Second annotation");
  await page.keyboard.press("Control+Enter");
  await expectOpenCount(root, "2");
  const task = readActiveTask();
  expect(task.schemaVersion).toBe(5);
  expect(task.annotations).toHaveLength(2);
  expect(task.annotations[1].comment).toBe("Second annotation");
  expect(task.annotations[1].annotationId).not.toBe(
    task.annotations[0].annotationId
  );

  // Reload → markers persist and re-resolve against the live DOM.
  await page.reload();
  await expectOpenCount(root, "2");
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
  const root = page.locator("#portal-studio-root");
  await openStudio(page);

  // One element annotation to act on.
  await startPicking(page);
  const row = page.locator("tbody tr").first();
  await row.hover();
  await row.click();
  await page.locator("#portal-studio-root textarea").fill("G03 marker note");
  await page.keyboard.press("Control+Enter");
  await expectOpenCount(root, "1");

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
  await textarea.fill("G03 marker edited");
  await editor.locator(".ps-button.ps-primary").click();
  await expect(editor).toHaveCount(0);
  await expect
    .poll(() => readActiveTask().annotations[0]?.comment)
    .toBe("G03 marker edited");

  // Complete from the marker editor (open → completed).
  await marker.click();
  await expect(editor).toBeVisible();
  await editor
    .locator(".ps-button:not(.ps-primary):not(.ps-danger)")
    .click();
  await expect(editor).toHaveCount(0);
  await expect
    .poll(() => readActiveTask().annotations[0]?.status)
    .toBe("completed");

  // Reopen from the marker editor (completed → open). Goal 04: the
  // completed marker is hidden from the default Open view — open the list
  // panel and switch to All first so the marker is reachable again.
  await openList(page);
  await page
    .locator("#portal-studio-root")
    .getByRole("button", { name: "All", exact: true })
    .click();
  await marker.click();
  await expect(editor).toBeVisible();
  await editor
    .locator(".ps-button:not(.ps-primary):not(.ps-danger)")
    .click();
  await expect(editor).toHaveCount(0);
  await expect
    .poll(() => readActiveTask().annotations[0]?.status)
    .toBe("open");
  // Back to the default Open view for the remaining assertions. The
  // marker click above closed the list (outside click) — reopen it.
  await openList(page);
  await page
    .locator("#portal-studio-root")
    .getByRole("button", { name: "Open", exact: true })
    .click();
  await page
    .locator("#portal-studio-root")
    .getByRole("button", { name: "Annotation list" })
    .click();

  // Esc closes the editor and restores focus to the marker button.
  await marker.click();
  await expect(editor).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
  await expect(marker).toBeFocused();

  // Delete requires lightweight confirmation, then removes the annotation.
  await marker.click();
  await editor.locator(".ps-button.ps-danger").click();
  await expect(editor.locator(".ps-annotation-confirm")).toBeVisible();
  await editor.locator(".ps-button.ps-danger").click();
  await expect(editor).toHaveCount(0);
  await expect.poll(() => readActiveTask().annotations.length).toBe(0);
  await expect(root.locator(".ps-marker-anchor button")).toHaveCount(0);
});

test("marker-local editor (G03): fits viewports smaller than the editor", async ({
  page,
}) => {
  await signIn(page);
  const root = page.locator("#portal-studio-root");
  // Create the annotation at the default viewport, THEN shrink to a size
  // SMALLER than the editor's nominal 264x232.
  await openStudio(page);
  await startPicking(page);
  const row = page.locator("tbody tr").first();
  await row.hover();
  await row.click();
  await page.locator("#portal-studio-root textarea").fill("G03 small viewport");
  await page.keyboard.press("Control+Enter");
  await expectOpenCount(root, "1");
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
  await editor.locator(".ps-button.ps-primary").click();
  await expect(editor).toHaveCount(0);
  await expect
    .poll(() => readActiveTask().annotations[0]?.comment)
    .toBe("G03 small viewport");

  // Delete (with its confirmation) remains reachable too.
  await marker.evaluate((el) => (el as HTMLButtonElement).click());
  await expect(editor).toBeVisible();
  await editor.locator(".ps-button.ps-danger").click();
  await expect(editor.locator(".ps-annotation-confirm")).toBeVisible();
  await editor.locator(".ps-button.ps-danger").click();
  await expect(editor).toHaveCount(0);
  await expect.poll(() => readActiveTask().annotations.length).toBe(0);
  await expect(root.locator(".ps-marker-anchor button")).toHaveCount(0);
});

test("marker-local editor (G03): multi highlight, region boundary, save failure, event isolation", async ({
  page,
}) => {
  await signIn(page);
  const root = page.locator("#portal-studio-root");
  await openStudio(page);

  // Multi annotation: two cells in ONE group.
  await page
    .locator("#portal-studio-root")
    .getByRole("button", { name: "Multi-select" })
    .click();
  const cellA = page.locator("tbody tr").first().locator("td").nth(0);
  const cellB = page.locator("tbody tr").first().locator("td").nth(1);
  await cellA.hover();
  await cellA.click();
  await cellB.hover();
  await cellB.click();
  await page
    .locator("#portal-studio-root")
    .getByRole("button", { name: "Finish group" })
    .click();
  await page
    .locator("#portal-studio-root textarea")
    .fill("G03 multi marker");
  await page.keyboard.press("Control+Enter");
  await expectOpenCount(root, "1");
  const task = readActiveTask();
  expect(task.annotations[0].kind).toBe("multi");

  // Opening the multi marker highlights every captured target.
  const multiMarker = root.locator(".ps-marker-anchor button").first();
  await multiMarker.click();
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
  await multiMarker.click();
  const editor = root.locator(".ps-marker-editor");
  await editor.locator("textarea").fill("G03 doomed text");
  await editor.locator(".ps-button.ps-primary").click();
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
  await multiMarker.click();
  await expect(root.locator(".ps-marker-editor")).toBeVisible();
  await editor.locator("textarea").click();
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
  await page
    .locator("#portal-studio-root")
    .getByRole("button", { name: "Select region" })
    .click();
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
  await page.keyboard.press("Control+Enter");
  await expect
    .poll(() => readActiveTask().annotations.at(-1)?.kind)
    .toBe("region");

  const regionMarker = root.locator(".ps-marker-region-chip");
  await expect(regionMarker).toHaveCount(1);
  await regionMarker.click();
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
    await root
      .locator(".ps-annotation-confirm button", { hasText: "Delete" })
      .click();
    await expect
      .poll(() => readActiveTask().annotations.length)
      .toBe(count - index - 1);
  }
  await expectNoOpenCount(root);
});

test("annotations: multi-select group, delete renumbers, hide and clear-all persist (G03)", async ({
  page,
}) => {
  await signIn(page);
  const root = page.locator("#portal-studio-root");
  await openStudio(page);

  // Multi-select group: seed pick + toggle a second element into ONE group.
  await page
    .locator("#portal-studio-root")
    .getByRole("button", { name: "Multi-select" })
    .click();
  const cellA = page.locator("tbody tr").first().locator("td").nth(0);
  const cellB = page.locator("tbody tr").first().locator("td").nth(1);
  await cellA.hover();
  await cellA.click();
  await cellB.hover();
  await cellB.click();
  await page
    .locator("#portal-studio-root")
    .getByRole("button", { name: "Finish group" })
    .click();
  await page
    .locator("#portal-studio-root textarea")
    .fill("G03 group annotation");
  await page.keyboard.press("Control+Enter");
  await expectOpenCount(root, "1");
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
  await page
    .locator("#portal-studio-root")
    .getByRole("button", { name: "Pick element" })
    .click();
  const row2 = page.locator("tbody tr").first().locator("td").nth(2);
  await row2.hover();
  await row2.click();
  await page
    .locator("#portal-studio-root textarea")
    .fill("G03 second annotation");
  await page.keyboard.press("Control+Enter");
  await expectOpenCount(root, "2");
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
  await root
    .locator(".ps-annotation-confirm button", { hasText: "Delete" })
    .click();
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
  await root.locator(".ps-annotation-item [aria-label='Hide']").click();
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
  await expectOpenCount(root, "1");
  await openList(page);
  await expect(root.locator(".ps-annotation-item")).toHaveCount(1);
  await expect(root.locator(".ps-annotation-item")).toContainText(/hidden/i);

  // Delete the remaining annotation via inline confirm → valid empty v5 task.
  const remainingDelete = root.locator(
    ".ps-annotation-item [aria-label='Delete']"
  );
  await remainingDelete.click();
  await expect(root.locator(".ps-annotation-confirm")).toBeVisible();
  await root
    .locator(".ps-annotation-confirm button", { hasText: "Delete" })
    .click();
  await expect(root.locator(".ps-annotation-item")).toHaveCount(0);
  await expectNoOpenCount(root);
  await expect
    .poll(() => readActiveTask().annotations.length)
    .toBe(0);
  task = readActiveTask();
  expect(task.schemaVersion).toBe(5);
  expect(task.annotations).toEqual([]);

  // Reload after delete-all: still empty, nothing resurrects.
  await page.reload();
  await expectNoOpenCount(root);
});

test("copy parity, explicit Complete with verify exit 0, Clear-task removed (G04)", async ({
  page,
}) => {
  await signIn(page);
  const root = page.locator("#portal-studio-root");
  await openStudio(page);

  // One annotation to work with.
  await startPicking(page);
  const row = page.locator("tbody tr").first();
  await row.hover();
  await row.click();
  await page.locator("#portal-studio-root textarea").fill("G04 complete me");
  await page.keyboard.press("Control+Enter");
  await expectOpenCount(root, "1");

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
        await root.locator("[aria-label='Copy annotations']").click();
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
  await root.locator(".ps-annotation-item [aria-label='Complete']").click();
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
  await expectNoOpenCount(root);
  await openList(page);
  // It is NOT deleted: the All view shows the completed item.
  await page
    .locator("#portal-studio-root")
    .getByRole("button", { name: "All", exact: true })
    .click();
  await expect(root.locator(".ps-annotation-item")).toContainText(
    /completed/i
  );
  // Cleanup: remove the completed item via the dock control.
  await page
    .locator("#portal-studio-root")
    .getByRole("button", { name: /Remove completed \(1\)/ })
    .click();
  await page
    .locator("#portal-studio-root")
    .getByRole("button", { name: "Remove", exact: true })
    .click();
  await expect
    .poll(() => readActiveTask().annotations.length)
    .toBe(0);
  await expectNoOpenCount(root);
});

test("a11y keyboard walkthrough: dock, horizontal bar, Esc focus return (G05)", async ({
  page,
}) => {
  await signIn(page);
  const root = page.locator("#portal-studio-root");
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
  await page
    .locator("#portal-studio-root")
    .getByRole("button", { name: "Pick element" })
    .click();
  const row = page.locator("tbody tr").first();
  await row.hover();
  await row.click();
  await page.locator("#portal-studio-root textarea").fill("G05 a11y");
  await page.keyboard.press("Control+Enter");
  await expectOpenCount(root, "1");
  await openList(page);
  // aria-pressed reflects the toggle states (P3-1): hide/complete are
  // not pressed initially.
  await expect(
    root.locator(".ps-annotation-item [aria-label='Hide']")
  ).toHaveAttribute("aria-pressed", "false");
  await expect(
    root.locator(".ps-annotation-item [aria-label='Complete']")
  ).toHaveAttribute("aria-pressed", "false");
  await root.locator(".ps-annotation-item [aria-label='Delete']").click();
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
  const root = page.locator("#portal-studio-root");
  await openStudio(page);

  // Two OPEN annotations.
  await startPicking(page);
  const row = page.locator("tbody tr").first();
  await row.hover();
  await row.click();
  await page.locator("#portal-studio-root textarea").fill("G04 open one");
  await page.keyboard.press("Control+Enter");
  // Goal 02: no Done; Pick resumed — startPicking reuses the session.
  await expect(root.getByRole("button", { name: "Done" })).toHaveCount(0);
  await startPicking(page);
  await row.hover();
  await row.click();
  await page.locator("#portal-studio-root textarea").fill("G04 open two");
  await page.keyboard.press("Control+Enter");
  await expectOpenCount(root, "2");

  // Complete ONE via the list → launcher counts OPEN only (1).
  await openList(page);
  await root.locator(".ps-annotation-item [aria-label='Complete']").first().click();
  await expectOpenCount(root, "1");
  // Open view hides the completed item; All shows both with Reopen.
  await expect(root.locator(".ps-annotation-item")).toHaveCount(1);
  await page
    .locator("#portal-studio-root")
    .getByRole("button", { name: "All", exact: true })
    .click();
  await expect(root.locator(".ps-annotation-item")).toHaveCount(2);
  await expect(root.locator(".ps-annotation-item-completed")).toHaveCount(1);
  await expect(
    root.locator(".ps-annotation-item [aria-label='Reopen']")
  ).toHaveCount(1);

  // Reopen moves it back → launcher back to 2 open.
  await root.locator(".ps-annotation-item [aria-label='Reopen']").click();
  await expect
    .poll(() => readActiveTask().annotations.filter((a) => a.status === "open").length)
    .toBe(2);

  // Browser Copy is OPEN-ONLY while print --markdown is explicit ALL-mode.
  // Complete one item first so the Copy assertion is discriminating
  // (mixed open + completed data).
  await root.locator(".ps-annotation-item [aria-label='Complete']").first().click();
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
        await page
          .locator("#portal-studio-root")
          .getByRole("button", { name: "Copy annotations" })
          .click();
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
  await page
    .locator("#portal-studio-root")
    .getByRole("button", { name: "Open", exact: true })
    .click();
  await expectOpenCount(root, "1");
  await root.locator(".ps-annotation-item [aria-label='Complete']").click();
  await expectNoOpenCount(root);
  await expect(root.locator(".ps-annotation-item")).toHaveCount(0);
  await expect(
    root.locator(".ps-list-panel .ps-hint", { hasText: "No open annotations" })
  ).toBeVisible();

  // Remove completed: cancel keeps items; confirm removes ONLY completed.
  await page
    .locator("#portal-studio-root")
    .getByRole("button", { name: "All", exact: true })
    .click();
  await page
    .locator("#portal-studio-root")
    .getByRole("button", { name: "Remove completed (2)" })
    .click();
  await page
    .locator("#portal-studio-root")
    .getByRole("button", { name: "Cancel" })
    .click();
  await expect.poll(() => readActiveTask().annotations.length).toBe(2);
  await page
    .locator("#portal-studio-root")
    .getByRole("button", { name: "Remove completed (2)" })
    .click();
  await page
    .locator("#portal-studio-root")
    .getByRole("button", { name: "Remove", exact: true })
    .click();
  await expect.poll(() => readActiveTask().annotations.length).toBe(0);
  await expectNoOpenCount(root);
  // TaskId lifecycle (G06): the task was FULLY completed before
  // removeCompleted; a new batch must still start a FRESH taskId (the
  // sticky task-level completedAt survives removeCompleted).
  const clearedTaskId = readActiveTask().taskId;
  // Close the list so the capture status surface is available again.
  await page
    .locator("#portal-studio-root")
    .getByRole("button", { name: "Annotation list" })
    .click();
  await expect(root.locator(".ps-list-panel")).toHaveCount(0);
  await startPicking(page);
  await row.hover();
  await row.click();
  await page.locator("#portal-studio-root textarea").fill("G04 after remove");
  await page.keyboard.press("Control+Enter");
  await expectOpenCount(root, "1");
  await expect
    .poll(() => readActiveTask().taskId)
    .not.toBe(clearedTaskId);
  const fresh = readActiveTask();
  expect(fresh.annotations).toHaveLength(1);
  expect(fresh.completedAt).toBeUndefined();
  // Cleanup: delete the fresh annotation so later tests start empty.
  await openList(page);
  await root.locator(".ps-annotation-item [aria-label='Delete']").click();
  await root.locator(".ps-annotation-confirm").waitFor();
  await root.locator(".ps-annotation-confirm button", { hasText: "Delete" }).click();
  await expect.poll(() => readActiveTask().annotations.length).toBe(0);
  await expectNoOpenCount(root);
});

test("agent CLI complete/reopen sync to the browser within two seconds (G05)", async ({
  page,
}) => {
  await signIn(page);
  const root = page.locator("#portal-studio-root");
  await openStudio(page);

  // One open annotation to act on.
  await startPicking(page);
  const row = page.locator("tbody tr").first();
  await row.hover();
  await row.click();
  await page.locator("#portal-studio-root textarea").fill("G05 sync me");
  await page.keyboard.press("Control+Enter");
  await expectOpenCount(root, "1");
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

  // Goal 05: the OPEN view removes the CLI-completed item within TWO
  // seconds (revision-gated polling — no HMR/source/timestamp inference).
  await expect(root.locator(".ps-annotation-item")).toHaveCount(0, {
    timeout: 2000,
  });
  await expectNoOpenCount(root);
  // All view shows it as completed (evidence preserved in the artifact).
  await page
    .locator("#portal-studio-root")
    .getByRole("button", { name: "All", exact: true })
    .click();
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
  await root.locator(".ps-annotation-item [aria-label='Hide']").click();
  await expect
    .poll(() => readActiveTask().annotations[0]?.hidden)
    .toBe(true);
  const afterHide = readActiveTask();
  expect(afterHide.annotations[0].completedEvidence?.verified).toBe(true);
  expect(afterHide.annotations[0].completedEvidence?.summary).toContain(
    "G05 verified via reload"
  );
  // Un-hide so the reopen flow below is unaffected.
  await root.locator(".ps-annotation-item [aria-label='Hide']").click();
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
  await page
    .locator("#portal-studio-root")
    .getByRole("button", { name: "Open", exact: true })
    .click();
  await expect(root.locator(".ps-annotation-item")).toHaveCount(1, {
    timeout: 2000,
  });
  await expectOpenCount(root, "1");
  expect(readActiveTask().annotations[0].status).toBe("open");
  expect(
    readActiveTask().annotations[0].completedEvidence
  ).toBeUndefined();

  // Cleanup: remove the annotation so later tests start empty.
  await root.locator(".ps-annotation-item [aria-label='Delete']").click();
  await root.locator(".ps-annotation-confirm").waitFor();
  await root
    .locator(".ps-annotation-confirm button", { hasText: "Delete" })
    .click();
  await expect.poll(() => readActiveTask().annotations.length).toBe(0);
});

test("mutating a legacy v1-v4 artifact through the typed endpoint does not crash (G06 P2-2)", async ({
  page,
}) => {
  // Seed a v4 artifact directly (like the pre-upgrade agent flow), then
  // mutate it from the BROWSER through the mutate endpoint — the server
  // must normalize on read instead of crashing on a missing annotations[].
  const v4 = {
    schemaVersion: 4,
    taskId: "legacy-v4-mutate",
    createdAt: "2026-08-09T00:00:00.000Z",
    url: resolvePortalTestURL(environment, "/users"),
    title: "Users",
    instruction: "Legacy annotation",
    elements: [],
    businessContext: [],
    redaction: { droppedKeys: [], redactedValues: 0, truncatedValues: 0 },
  };
  mkdirSync(path.dirname(taskFile), { recursive: true });
  writeFileSync(taskFile, JSON.stringify(v4, null, 2));

  await signIn(page);
  await page.goto(resolvePortalTestURL(environment, "/users"));
  await page.locator("tbody tr").first().waitFor();
  const root = page.locator("#portal-studio-root");
  await openList(page);
  // The browser normalized the v4 artifact on read — the annotation is in
  // the list even though the FILE is still v4.
  await expect(root.locator(".ps-annotation-item")).toHaveCount(1);
  // Hide the normalized annotation — the mutate endpoint must normalize on
  // read and apply the op (no 500), persisting a v5 artifact with hidden.
  await root.locator(".ps-annotation-item [aria-label='Hide']").click();
  await expect
    .poll(
      () =>
        (readActiveTask() as unknown as {
          annotations?: Array<{ hidden?: boolean }>;
        }).annotations?.[0]?.hidden
    )
    .toBe(true);
  expect(readActiveTask().schemaVersion).toBe(5);
  expect(readActiveTask().annotations[0].annotationId).toBe(
    "legacy-v4-mutate-v4"
  );

  // Cleanup: delete the annotation so later tests start empty.
  await root.locator(".ps-annotation-item [aria-label='Delete']").click();
  await root.locator(".ps-annotation-confirm").waitFor();
  await root
    .locator(".ps-annotation-confirm button", { hasText: "Delete" })
    .click();
  await expect.poll(() => readActiveTask().annotations.length).toBe(0);
});

test("interleaved browser/CLI mutations keep stable taskId and revision-aware consistency (G06)", async ({
  page,
}) => {
  await signIn(page);
  const root = page.locator("#portal-studio-root");
  await openStudio(page);

  // Browser creates the first annotation (taskId A).
  await startPicking(page);
  const row = page.locator("tbody tr").first();
  await row.hover();
  await row.click();
  await page.locator("#portal-studio-root textarea").fill("G06 browser one");
  await page.keyboard.press("Control+Enter");
  await expectOpenCount(root, "1");
  const taskIdA = readActiveTask().taskId;

  // Browser adds a second annotation — SAME taskId A (Pick resumed).
  await expect(root.getByRole("button", { name: "Done" })).toHaveCount(0);
  await startPicking(page);
  await row.hover();
  await row.click();
  await page.locator("#portal-studio-root textarea").fill("G06 browser two");
  await page.keyboard.press("Control+Enter");
  await expectOpenCount(root, "2");
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
  await expectOpenCount(root, "1", {
    timeout: 2000,
  });

  // Browser mutates while the CLI-completed state exists (hide the open
  // one) — the typed mutation preserves the CLI evidence and taskId.
  await page
    .locator("#portal-studio-root")
    .getByRole("button", { name: "All", exact: true })
    .click();
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
    await root
      .locator(".ps-annotation-confirm button", { hasText: "Delete" })
      .click();
    await expect
      .poll(() => readActiveTask().annotations.length)
      .toBe(count - index - 1);
  }
  await expectNoOpenCount(root);
});

test("large task (>64KB) mutations persist via the plain POST (D-043 regression)", async ({
  page,
}) => {
  await signIn(page);
  const root = page.locator("#portal-studio-root");
  await root.locator(".ps-dock").waitFor();

  // Seed a LARGE task (>64 KB — beyond the keepalive budget) through the
  // documented agent-side write path.
  const token = await page.evaluate(
    () => window.__PORTAL_STUDIO_CONFIG__?.token
  );
  const bigElements = Array.from({ length: 30 }, (_, i) => ({
    tagName: "div",
    selectorCandidates: [{ kind: "path", selector: `body > div:nth(${i})` }],
    componentCandidates: [],
    sourceCandidates: [],
    snapshot: {
      text: "L".repeat(2600),
      attributes: {},
      childCount: 0,
    },
  }));
  const bigTask = {
    schemaVersion: 5,
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
  await expectOpenCount(root, "1");
  await closeStudio(page);

  // UI hide mutation must persist (the keepalive-only path would have
  // failed with "Failed to fetch" for this >64 KB task — D-043).
  await openList(page);
  await root.locator(".ps-annotation-item [aria-label='Hide']").click();
  await expect
    .poll(() => readActiveTask().annotations[0]?.hidden)
    .toBe(true);
  await page.reload();
  await expectOpenCount(root, "1");
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
  await root.locator(".ps-chip-open").click();
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
    await targets[index].hover();
    await targets[index].click();
    await page
      .locator("#portal-studio-root textarea")
      .fill(`G01 v5 annotation ${index + 1}`);
    await page.keyboard.press("Control+Enter");
    await expectOpenCount(root, String(index + 1));
    await expect(
      page
        .locator("#portal-studio-root")
        .getByRole("button", { name: "Done" })
    ).toHaveCount(0);
  }
  // Collapse with annotations present: count chip, nothing cleared.
  await page
    .locator("#portal-studio-root")
    .getByRole("button", { name: "Collapse toolbar" })
    .click();
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
  await root.locator(".ps-chip-open").click();
  await root
    .getByRole("button", { name: "Annotation list" })
    .click();
  await expect(root.locator(".ps-list-panel")).toBeVisible();
  const deletes = root.locator(".ps-annotation-item [aria-label='Delete']");
  const count = await deletes.count();
  for (let index = 0; index < count; index += 1) {
    await deletes.first().click();
    await root.locator(".ps-annotation-confirm").waitFor();
    await root
      .locator(".ps-annotation-confirm button", { hasText: "Delete" })
      .click();
    await expect
      .poll(() => readActiveTask().annotations.length)
      .toBe(count - index - 1);
  }
  await expectNoOpenCount(root);
});

test("G01 v5: tooltips, active capture states, help popover, list Open/All, mutual exclusion", async ({
  page,
}) => {
  await signIn(page);
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
    await button.hover();
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
  await multi.click();
  await expect(multi).toHaveAttribute("aria-pressed", "true");
  await multi.click();
  await area.click();
  await expect(area).toHaveAttribute("aria-pressed", "true");
  await area.click();

  // Shortcut-help popover from the penultimate feature icon; generated
  // rows; Esc closes and restores focus.
  const helpButton = root.locator("[role='toolbar'] [aria-label='Keyboard shortcuts']");
  await helpButton.click();
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
  await root.locator("[role='toolbar'] [aria-label='Pick element']").click();
  await page.locator("tbody tr").first().hover();
  await page.locator("tbody tr").first().click();
  await page.locator("#portal-studio-root textarea").fill("G01 list item");
  await page.keyboard.press("Control+Enter");
  await expectOpenCount(root, "1");
  const listButton = root.locator("[role='toolbar'] [aria-label='Annotation list']");
  await listButton.click();
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
  await helpButton.click();
  await expect(help).toBeVisible();
  await expect(list).toHaveCount(0);
  await listButton.click();
  await expect(list).toBeVisible();
  await expect(help).toHaveCount(0);

  // Cleanup: delete the annotation.
  await root.locator(".ps-annotation-item [aria-label='Delete']").click();
  await root.locator(".ps-annotation-confirm").waitFor();
  await root
    .locator(".ps-annotation-confirm button", { hasText: "Delete" })
    .click();
  await expect.poll(() => readActiveTask().annotations.length).toBe(0);
});

test("G01 v5: keyboard — ? help, Mod+Alt+L list, Mod+Alt+V markers, Mod+Alt+K collapse; Tab focus walkthrough", async ({
  page,
}) => {
  await signIn(page);
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
  await root.locator(".ps-chip-open").click();
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
  await root.locator(".ps-chip-open").click();
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
  await page
    .locator("#portal-studio-root")
    .getByRole("button", { name: "Keyboard shortcuts" })
    .click();
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
  await page
    .locator("#portal-studio-root")
    .getByRole("button", { name: "Annotation list" })
    .click();
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
  await root.locator(".ps-chip-open").click();
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
  await page.locator("tbody tr").first().hover();
  await page.locator("tbody tr").first().click();
  await page.locator("#portal-studio-root textarea").fill("中文批注");
  await page.keyboard.press("Control+Enter");
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
  await root.locator(".ps-chip-open").click();
  await root.getByRole("button", { name: "批注列表" }).click();
  await root.locator(".ps-annotation-item [aria-label='删除']").click();
  await root.locator(".ps-annotation-confirm").waitFor();
  await root
    .locator(".ps-annotation-confirm button", { hasText: "删除" })
    .click();
  await expect.poll(() => readActiveTask().annotations.length).toBe(0);
});

test("G01 v5: manual-Copy fallback clamps inside the viewport at edge positions (round-3 finding 4)", async ({
  page,
  context,
}) => {
  // Deny the clipboard permission so the manual fallback is forced.
  await context.grantPermissions([], { origin: environment.baseURL });
  await signIn(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(resolvePortalTestURL(environment, "/users"));
  await page.locator("tbody tr").first().waitFor();
  const root = page.locator("#portal-studio-root");

  // One open annotation so Copy is enabled.
  await openStudio(page);
  await root.getByRole("button", { name: "Pick element" }).click();
  await page.locator("tbody tr").first().hover();
  await page.locator("tbody tr").first().click();
  await page.locator("#portal-studio-root textarea").fill("edge copy");
  await page.keyboard.press("Control+Enter");
  await expectOpenCount(root, "1");

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
  await root.locator(".ps-chip-open").click();
  const copyButton = root.getByRole("button", { name: "Copy annotations" });
  await copyButton.click();
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
  await root.locator(".ps-chip-open").click();
  await copyButton.click();
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
  await root.locator(".ps-chip-open").click();
  await copyButton.click();
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
  await root.locator(".ps-annotation-item [aria-label='Delete']").click();
  await root.locator(".ps-annotation-confirm").waitFor();
  await root
    .locator(".ps-annotation-confirm button", { hasText: "Delete" })
    .click();
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
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(resolvePortalTestURL(environment, "/users"));
  await page.locator("tbody tr").first().waitFor();
  const root = page.locator("#portal-studio-root");
  await openStudio(page);
  const bar = root.locator("[role='toolbar']");

  // G02-05: Pick is single-target — one click, one annotation.
  await root.getByRole("button", { name: "Pick element" }).click();
  const row = page.locator("tbody tr").first();
  await row.hover();
  await row.click();

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
  await page.keyboard.press("Control+Enter");
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
  await row.hover();
  await row.click();
  await expect(composer).toBeVisible();
  await page.locator("#portal-studio-root textarea").fill("G02 continuous two");
  await page.keyboard.press("Meta+Enter");
  await expect(
    root.locator(".ps-save-toast", { hasText: "Annotation saved" })
  ).toBeVisible();
  await expectOpenCount(root, "2");
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
  await cellA.hover();
  await cellA.click();
  await cellB.hover();
  await cellB.click();
  await page
    .locator("#portal-studio-root")
    .getByRole("button", { name: "Finish group" })
    .click();
  await expect(composer).toBeVisible();
  await page.locator("#portal-studio-root textarea").fill("G02 multi group");
  await page.keyboard.press("Control+Enter");
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
  await root
    .locator(".ps-annotation-confirm button", { hasText: "Delete" })
    .click();
  await expect.poll(() => readActiveTask().annotations.length).toBe(2);
  await openList(page);
  await root
    .locator(".ps-annotation-item [aria-label='Delete']")
    .first()
    .click();
  await root.locator(".ps-annotation-confirm").waitFor();
  await root
    .locator(".ps-annotation-confirm button", { hasText: "Delete" })
    .click();
  await expect.poll(() => readActiveTask().annotations.length).toBe(1);
  await openList(page);
  await root
    .locator(".ps-annotation-item [aria-label='Delete']")
    .first()
    .click();
  await root.locator(".ps-annotation-confirm").waitFor();
  await root
    .locator(".ps-annotation-confirm button", { hasText: "Delete" })
    .click();
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
  await root.locator(".ps-chip-open").click();
  await root.getByRole("button", { name: "拾取元素" }).click();
  await page.locator("tbody tr").first().hover();
  await page.locator("tbody tr").first().click();
  const zhComposer = root.getByRole("dialog", { name: "批注" });
  await expect(zhComposer).toBeVisible();
  await expect(root.getByRole("textbox", { name: "标注评论" })).toBeFocused();
  await page.screenshot({
    path: "test-results/g02-composer-zh.png",
    fullPage: false,
  });
  await page.locator("#portal-studio-root textarea").fill("中文连续批注");
  await page.keyboard.press("Control+Enter");
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
  await root.locator(".ps-annotation-item [aria-label='删除']").click();
  await root.locator(".ps-annotation-confirm").waitFor();
  await root
    .locator(".ps-annotation-confirm button", { hasText: "删除" })
    .click();
  await expect.poll(() => readActiveTask().annotations.length).toBe(0);
});

// =====================================================================
// Goal 03 — Stable Marker/List Semantics and Viewport Polish (G03-01..10)
// =====================================================================

test("G03: stable numbers (marker/list/editor/Copy), visibility, markers, region scroll, 375x667", async ({
  page,
}) => {
  await signIn(page);
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
    await targets[index].hover();
    await targets[index].click();
    await page
      .locator("#portal-studio-root textarea")
      .fill(`G03 annotation ${index + 1}`);
    await page.keyboard.press("Control+Enter");
    await expectOpenCount(root, String(index + 1));
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
  await visibilityToggle.click();
  await expect(root.locator(".ps-marker-anchor")).toHaveCount(0);
  const afterToggle = readActiveTask();
  expect(afterToggle.annotations.map((a) => a.annotationId)).toEqual(before);
  await visibilityToggle.click();
  await expect(root.locator(".ps-marker-anchor")).toHaveCount(2);

  // ---- G03-03: per-item Hide stays independent of the global toggle.
  await openList(page);
  await root.locator(".ps-annotation-item [aria-label='Hide']").first().click();
  await expect(root.locator(".ps-marker-anchor")).toHaveCount(1);
  await root.locator(".ps-annotation-item [aria-label='Hide']").first().click();
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
  await page.keyboard.press("Control+Enter");
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
  await targets[0].hover();
  await targets[0].click();
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
  await targets[1].hover();
  await targets[1].click();
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
    await root
      .locator(".ps-annotation-confirm button", { hasText: "Delete" })
      .click();
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
  await root.locator(".ps-chip-open").click();
  await root.getByRole("button", { name: "拾取元素" }).click();
  await page.locator("tbody tr").first().locator("td").nth(1).hover();
  await page.locator("tbody tr").first().locator("td").nth(1).click();
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
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(resolvePortalTestURL(environment, "/users"));
  await page.locator("tbody tr").first().waitFor();
  const root = page.locator("#portal-studio-root");
  await openStudio(page);

  // G04-03: two browser adds — taskId stable, createdAt IMMUTABLE,
  // updatedAt changes on the second mutation.
  await startPicking(page);
  await page.locator("tbody tr").first().hover();
  await page.locator("tbody tr").first().click();
  await page.locator("#portal-studio-root textarea").fill("G04 timestamp one");
  await page.keyboard.press("Control+Enter");
  await expect(
    root.locator(".ps-save-toast", { hasText: "Annotation saved" })
  ).toBeVisible();
  const afterFirst = readActiveTask();
  expect(typeof afterFirst.createdAt).toBe("string");
  expect(typeof afterFirst.updatedAt).toBe("string");
  const firstUpdatedAt = afterFirst.updatedAt!;
  await page.waitForTimeout(1200);
  await startPicking(page);
  await page.locator("tbody tr").first().locator("td").nth(1).hover();
  await page.locator("tbody tr").first().locator("td").nth(1).click();
  await page.locator("#portal-studio-root textarea").fill("G04 timestamp two");
  await page.keyboard.press("Control+Enter");
  await expectOpenCount(root, "2");
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
