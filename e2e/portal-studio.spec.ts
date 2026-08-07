/**
 * Portal Studio — E2E smoke (Goal 01).
 *
 * Real dev Portal (Playwright starts an isolated vite dev server on 4173 with
 * `--mode e2e`, so `import.meta.env.DEV` is true and Studio is active).
 * Verifies the full loop: pick a real element (mouse and keyboard) →
 * instruction → save → atomic task file → shell-agent print command parity,
 * plus direct endpoint writes with the session token.
 *
 * Serial mode: all tests share one dev server and one
 * `.portal-studio/tasks/active-task.json` file, so captures must not run in
 * parallel.
 */

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

const readActiveTask = () => {
  const raw = readFileSync(taskFile, "utf8");
  return JSON.parse(raw) as {
    schemaVersion: number;
    taskId: string;
    url: string;
    instruction: string;
    element: {
      tagName: string;
      componentCandidates: Array<{ name: string | null }>;
      sourceCandidates: Array<{ file: string; line?: number }>;
      snapshot: { text: string; attributes: Record<string, string> };
    };
  };
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
  await page.locator("#portal-studio-root .ps-toggle").click();
  await expect(
    page.locator("#portal-studio-root [role='toolbar']")
  ).toBeVisible();
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
  await page
    .locator("#portal-studio-root textarea")
    .fill(instruction);
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

test("picks real elements on the users page and writes printable tasks (3 repetitions)", async ({
  page,
}) => {
  await signIn(page);
  await page.goto(resolvePortalTestURL(environment, "/users"));
  await page.locator("tbody tr").first().waitFor();

  for (let iteration = 1; iteration <= 3; iteration += 1) {
    await openStudio(page);
    await startPicking(page);

    // Mouse flow: hover the first data row, click to confirm the pick.
    const row = page.locator("tbody tr").first();
    await row.hover();
    await expect
      .poll(async () =>
        page.locator("#portal-studio-root .ps-outline").isVisible()
      )
      .toBe(true);
    await row.click();

    await expect(
      page.locator("#portal-studio-root [role='toolbar']", {
        hasText: "Captured",
      })
    ).toBeVisible();

    const instruction = `E2E iteration ${iteration}: increase row padding`;
    await saveTask(page, instruction);

    const task = readActiveTask();
    expect(task.schemaVersion).toBe(1);
    expect(task.url).toContain("/users");
    expect(task.element.componentCandidates.length).toBeGreaterThan(0);
    const names = task.element.componentCandidates
      .map((candidate) => candidate.name)
      .filter((name): name is string => typeof name === "string");
    expect(names).toContain("TableRow");

    // Server-side module-graph resolution produced real file:line candidates.
    expect(task.element.sourceCandidates.length).toBeGreaterThan(0);
    const sources = task.element.sourceCandidates.map((source) => source.file);
    expect(
      sources.some((file) => file.includes("users-example") || file.includes("src/"))
    ).toBe(true);

    // Secrets never land in the artifact.
    const serialized = JSON.stringify(task);
    expect(serialized).not.toContain("token");
    expect(serialized).not.toMatch(/Bearer /);
    expect(serialized.length).toBeLessThan(64 * 1024);

    // Shell-agent parity: the zero-dependency print command reads the same file.
    const { execFileSync } = await import("node:child_process");
    const printed = execFileSync(
      process.execPath,
      [
        "scripts/portal-studio-print.mjs",
        "--json",
        "--task",
        task.taskId,
      ],
      { encoding: "utf8" }
    );
    expect(JSON.parse(printed)).toEqual(task);

    // Close the panel so the next iteration starts clean.
    await page.locator("#portal-studio-root .ps-toggle").click();
  }
});

test("picks an element with the keyboard on a second page and verifies the loop", async ({
  page,
}) => {
  await signIn(page);
  await page.goto(resolvePortalTestURL(environment, "/dev/ai-chat"));
  await page.locator("main").last().waitFor();

  for (let iteration = 1; iteration <= 2; iteration += 1) {
    await openStudio(page);
    await startPicking(page);

    // Keyboard flow: focus a page element (non-Studio), confirm with Enter.
    const target = page.locator("main button, main a, main h2").first();
    await target.focus();
    await page.keyboard.press("Enter");

    await expect(
      page.locator("#portal-studio-root [role='toolbar']", {
        hasText: "Captured",
      })
    ).toBeVisible();

    const instruction = `E2E keyboard ${iteration}: adjust the header spacing`;
    await saveTask(page, instruction);

    const task = readActiveTask();
    expect(task.url).toContain("/dev/ai-chat");
    expect(task.instruction).toBe(instruction);
    expect(task.element.tagName.length).toBeGreaterThan(0);

    // Direct agent-side write through the token-protected endpoint.
    const token = await page.evaluate(
      () => window.__PORTAL_STUDIO_CONFIG__?.token
    );
    expect(typeof token).toBe("string");
    const agentTask = {
      schemaVersion: 1,
      taskId: `agent-task-${iteration}`,
      createdAt: new Date().toISOString(),
      url: task.url,
      title: "Agent write",
      instruction: `Agent-side task ${iteration}`,
      element: {
        tagName: "div",
        selectorCandidates: [{ kind: "path", selector: "body > div" }],
        componentCandidates: [],
        snapshot: { text: "agent", attributes: { class: "x" }, childCount: 0 },
      },
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
      .toBe(`agent-task-${iteration}`);

    await page.locator("#portal-studio-root .ps-toggle").click();
  }

  // Guard checks on a live dev server: wrong/missing token and traversal.
  const token = await page.evaluate(
    () => window.__PORTAL_STUDIO_CONFIG__?.token
  );
  const wrong = await page.request.post(
    resolvePortalTestURL(environment, "__portal-studio/tasks"),
    {
      headers: { "X-Portal-Studio-Token": "wrong-token" },
      data: { schemaVersion: 1 },
    }
  );
  expect(wrong.status()).toBe(404);
  const missing = await page.request.post(
    resolvePortalTestURL(environment, "__portal-studio/tasks"),
    { data: { schemaVersion: 1 } }
  );
  expect(missing.status()).toBe(404);
  const traversal = await page.request.post(
    resolvePortalTestURL(environment, "__portal-studio/tasks"),
    {
      headers: { "X-Portal-Studio-Token": token },
      data: {
        schemaVersion: 1,
        taskId: "../evil",
        createdAt: new Date().toISOString(),
        url: "http://x/",
        title: "t",
        instruction: "i",
        element: { tagName: "div" },
      },
    }
  );
  expect(traversal.status()).toBe(400);

  // Only the active task file exists inside the tasks directory.
  expect(readdirSync(path.join(studioDir, "tasks"))).toEqual([
    "active-task.json",
  ]);
});
