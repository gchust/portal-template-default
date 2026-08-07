/**
 * Portal Studio — E2E (Goal 02).
 *
 * Real dev Portal (Playwright starts an isolated vite dev server on 4173 with
 * `--mode e2e`, so Studio is active). Verifies the schema-v2 loop on two real
 * pages across at least three stable rounds: single pick (regression),
 * Shift multi-select, marquee region, replace, clear, keyboard paths, and the
 * annotated screenshot — plus endpoint guards and shell-agent print parity.
 *
 * Serial mode: all tests share one dev server and one
 * `.portal-studio/tasks/active-task.json` file, so captures must not run in
 * parallel.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, rmSync } from "node:fs";
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

type TaskArtifact = {
  schemaVersion: number;
  taskId: string;
  url: string;
  instruction: string;
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
  businessContext: Array<{ type: string; id?: string; source: string }>;
  redaction: { droppedKeys: string[]; redactedValues: number };
  screenshot?: { file: string; width: number; height: number };
};

const readActiveTask = (): TaskArtifact =>
  JSON.parse(readFileSync(taskFile, "utf8")) as TaskArtifact;

const PNG_MAGIC = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

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
  await page.locator("#portal-studio-root .ps-toggle").click();
  await expect(
    page.locator("#portal-studio-root [role='toolbar']")
  ).toBeVisible();
};

const closeStudio = async (page: import("@playwright/test").Page) => {
  await page.locator("#portal-studio-root .ps-toggle").click();
  await expect(
    page.locator("#portal-studio-root [role='toolbar']")
  ).toHaveCount(0);
};

const startPicking = async (page: import("@playwright/test").Page) => {
  await page
    .locator("#portal-studio-root [role='toolbar'] button", {
      hasText: "Pick element",
    })
    .click();
  await expect(
    page.locator("#portal-studio-root [role='toolbar']", {
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
    .locator("#portal-studio-root button", { hasText: "Save task" })
    .click();
  await expect(
    page.locator("#portal-studio-root [role='toolbar']", {
      hasText: "Task saved",
    })
  ).toBeVisible();
  await expect
    .poll(() => readActiveTask().instruction)
    .toBe(instruction);
};

test.describe.configure({ mode: "serial" });

test.beforeEach(() => {
  rmSync(studioDir, { recursive: true, force: true });
});

test.afterAll(() => {
  rmSync(studioDir, { recursive: true, force: true });
});

test("users page: single, shift-multi, marquee, replace, screenshot (3 rounds)", async ({
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
  await expect(
    page.locator("#portal-studio-root [role='toolbar']", {
      hasText: "Captured",
    })
  ).toBeVisible();
  await saveTask(page, "E2E single: increase row padding");

  let task = readActiveTask();
  expect(task.schemaVersion).toBe(2);
  expect(task.elements).toHaveLength(1);
  const names = task.elements[0].componentCandidates
    .map((candidate) => candidate.name)
    .filter((name): name is string => typeof name === "string");
  expect(names).toContain("TableRow");
  const sources = task.elements[0].sourceCandidates.map((s) => s.file);
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

  // Round 2 — Shift multi-select of two cells within the first row (the
  // sandbox users table has a single row).
  await openStudio(page);
  await startPicking(page);
  const firstRow = page.locator("tbody tr").nth(0);
  const cellA = firstRow.locator("td").nth(0);
  const cellB = firstRow.locator("td").nth(1);
  await cellA.hover();
  await cellA.click({ modifiers: ["Shift"] });
  await expect(
    page.locator("#portal-studio-root [role='toolbar']", {
      hasText: "Selected",
    })
  ).toBeVisible();
  await cellB.hover();
  await cellB.click({ modifiers: ["Shift"] });
  await expect(
    page.locator("#portal-studio-root [role='toolbar']", {
      hasText: "Selected",
    })
  ).toBeVisible();
  // Plain click replaces the multi-selection with a single element.
  await cellA.hover();
  await cellA.click();
  await expect(
    page.locator("#portal-studio-root [role='toolbar']", {
      hasText: "Captured",
    })
  ).toBeVisible();
  await saveTask(page, "E2E replace: single again after shift-multi");
  task = readActiveTask();
  expect(task.elements).toHaveLength(1);
  await closeStudio(page);

  // Round 3 — marquee region over the table body.
  await openStudio(page);
  await page
    .locator("#portal-studio-root [role='toolbar'] button", {
      hasText: "Select region",
    })
    .click();
  await expect(
    page.locator("#portal-studio-root [role='toolbar']", {
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
  await expect(
    page.locator("#portal-studio-root [role='toolbar']", {
      hasText: "Captured",
    })
  ).toBeVisible();
  await saveTask(page, "E2E marquee: select the whole table body");
  task = readActiveTask();
  expect(task.elements.length).toBeGreaterThanOrEqual(3);
  expect(task.region).toBeDefined();
  expect(task.region!.width).toBeGreaterThan(0);
  expect(task.screenshot).toBeDefined();
  // No secrets/tokens in any artifact.
  const serialized = JSON.stringify(task);
  expect(serialized).not.toContain("token");
  expect(serialized).not.toMatch(/Bearer /);
  expect(serialized.length).toBeLessThan(256 * 1024);

  // Clear lifecycle: return to the idle panel, then DELETE the task and its
  // screenshot.
  await page
    .locator("#portal-studio-root [role='toolbar'] button", {
      hasText: "Done",
    })
    .click();
  await page
    .locator("#portal-studio-root [role='toolbar'] button", {
      hasText: "Clear task",
    })
    .click();
  await expect(
    page.locator("#portal-studio-root [role='toolbar']", {
      hasText: "Task cleared",
    })
  ).toBeVisible();
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

test("dev page: keyboard single and Shift+Enter multi, agent-side writes, guards", async ({
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
  await expect(
    page.locator("#portal-studio-root [role='toolbar']", {
      hasText: "Captured",
    })
  ).toBeVisible();
  await saveTask(page, "E2E keyboard single on /dev/ai-chat");
  const single = readActiveTask();
  expect(single.url).toContain("/dev/ai-chat");
  expect(single.elements).toHaveLength(1);
  expect(single.screenshot).toBeDefined();
  await closeStudio(page);

  // Keyboard round 2 — Shift+Enter multi-select.
  await openStudio(page);
  await startPicking(page);
  const first = page.locator("main button, main a, main h2").first();
  const second = page.locator("main button, main a, main h2").nth(1);
  await first.focus();
  await page.keyboard.press("Shift+Enter");
  await expect(
    page.locator("#portal-studio-root [role='toolbar']", {
      hasText: "Selected",
    })
  ).toBeVisible();
  await second.focus();
  await page.keyboard.press("Shift+Enter");
  await second.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.locator("#portal-studio-root [role='toolbar']", {
      hasText: "Captured",
    })
  ).toBeVisible();
  await saveTask(page, "E2E keyboard: shift multi then replace");
  const multi = readActiveTask();
  expect(multi.elements).toHaveLength(1);
  await closeStudio(page);

  // Agent-side write through the token-protected endpoint.
  const token = await page.evaluate(
    () => window.__PORTAL_STUDIO_CONFIG__?.token
  );
  expect(typeof token).toBe("string");
  const agentTask = {
    schemaVersion: 2,
    taskId: "agent-task-2",
    createdAt: new Date().toISOString(),
    url: single.url,
    title: "Agent write",
    instruction: "Agent-side v2 task",
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
  const clearWithoutToken = await page.request.delete(
    resolvePortalTestURL(environment, "__portal-studio/tasks")
  );
  expect(clearWithoutToken.status()).toBe(404);

  // Only the active task file exists inside the tasks directory.
  expect(readdirSync(path.join(studioDir, "tasks"))).toEqual([
    "active-task.json",
  ]);
});
