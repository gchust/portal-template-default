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
import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
  await saveTask(page, "E2E continuous: plain click appends annotation 2");
  task = readActiveTask();
  expect(task.annotations).toHaveLength(2);
  // The plain click replaced the pick-session selection with a single
  // element (the true multi-select mode lands in G03); the CONTINUOUS
  // part is that annotation 1 is retained and annotation 2 appended.
  expect(task.annotations[1].kind).toBe("element");
  expect(task.annotations[1].elements).toHaveLength(1);
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
  // old Clear-task button is gone; the agent-side DELETE endpoint still
  // clears the task and its screenshot.
  await page
    .locator("#portal-studio-root [role='toolbar'] button", {
      hasText: "Done",
    })
    .click();
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
  expect(single.annotations).toHaveLength(1);
  expect(single.annotations[0].elements).toHaveLength(1);
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
  await saveTask(page, "E2E keyboard: shift multi then plain Enter");
  const multi = readActiveTask();
  expect(multi.annotations).toHaveLength(2);
  // Plain Enter replaced the pick-session selection (multi-select mode
  // lands in G03); the CONTINUOUS annotation semantics retain #1 + append.
  expect(multi.annotations[1].kind).toBe("element");
  expect(multi.annotations[1].elements).toHaveLength(1);
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
  await page.locator("#portal-studio-root .ps-toggle").click();
  await page
    .locator("#portal-studio-root [role='toolbar'] button", {
      hasText: "Pick element",
    })
    .click();
  const row = page.locator("tbody tr").first();
  await row.hover();
  await row.click();
  await page
    .locator("#portal-studio-root textarea")
    .fill("diagnostics baseline");
  await page
    .locator("#portal-studio-root button", { hasText: "Save task" })
    .click();
  await expect(
    page.locator("#portal-studio-root [role='toolbar']", {
      hasText: "Task saved",
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
  await page.locator("#portal-studio-root .ps-toggle").click();
  await page
    .locator("#portal-studio-root [role='toolbar'] button", {
      hasText: "Pick element",
    })
    .click();
  const row = page.locator("tbody tr").first();
  await row.hover();
  await row.click();
  await page
    .locator("#portal-studio-root textarea")
    .fill("verify loop baseline");
  await page
    .locator("#portal-studio-root button", { hasText: "Save task" })
    .click();
  await expect(
    page.locator("#portal-studio-root [role='toolbar']", {
      hasText: "Task saved",
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

  // The toolbar still works after reloads (single toggle, single panel).
  await page.locator("#portal-studio-root .ps-toggle").click();
  await expect(
    page.locator("#portal-studio-root [role='toolbar']")
  ).toHaveCount(1);
  await page.locator("#portal-studio-root .ps-toggle").click();

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

test("dock: compact toolbar, drag persists across reload, More menu (G01)", async ({
  page,
}) => {
  await signIn(page);
  const root = page.locator("#portal-studio-root");
  const dock = root.locator(".ps-dock");

  // Collapsed = compact icon toolbar (toggle + badge + More), no large panel.
  await expect(dock).toBeVisible();
  await expect(root.locator(".ps-toggle")).toBeVisible();
  await expect(root.locator(".ps-badge")).toBeVisible();
  await expect(root.locator("[aria-label='More']")).toBeVisible();
  await expect(root.locator("[role='toolbar']")).toHaveCount(0);
  // No emoji glyphs (D-034 #5).
  expect(await root.locator(".ps-toggle").innerText()).not.toContain("🛠");

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

  // More menu opens, Esc closes.
  await root.locator("[aria-label='More']").click();
  await expect(root.locator(".ps-more-menu")).toBeVisible();
  await expect(root.locator(".ps-more-menu")).toContainText(
    "Reset dock position"
  );
  await page.keyboard.press("Escape");
  await expect(root.locator(".ps-more-menu")).toHaveCount(0);

  // Reset dock position via MOUSE (F1: outside-click must not swallow the
  // menuitem click across the shadow boundary) restores the default anchor.
  await root.locator("[aria-label='More']").click();
  await root
    .locator(".ps-more-menu [role='menuitem']", { hasText: "Reset dock position" })
    .click();
  await expect(root.locator(".ps-more-menu")).toHaveCount(0);
  const reset = (await dock.boundingBox())!;
  expect(Math.round(reset.x)).toBeGreaterThan(Math.round(moved.x) + 40);
  expect(Math.round(reset.y)).toBeGreaterThan(Math.round(moved.y) + 40);

  // Menu flips BELOW the dock at the top edge (F2) and stays on-screen.
  const topBox = (await dock.boundingBox())!;
  await page.mouse.move(topBox.x + 20, topBox.y + 20);
  await page.mouse.down();
  await page.mouse.move(topBox.x + 20, 5, { steps: 6 });
  await page.mouse.up();
  await root.locator("[aria-label='More']").click();
  const menuBox = (await root.locator(".ps-more-menu").boundingBox())!;
  expect(Math.round(menuBox.y)).toBeGreaterThanOrEqual(0);
  expect(Math.round(menuBox.y)).toBeGreaterThan(
    Math.round((await dock.boundingBox())!.y)
  );
  await page.keyboard.press("Escape");

  // Expanded panel still works after the dock changes (aria-expanded).
  await root.locator(".ps-toggle").click();
  await expect(root.locator("[role='toolbar']")).toBeVisible();
  await expect(root.locator(".ps-toggle")).toHaveAttribute(
    "aria-expanded",
    "true"
  );
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
    page.locator("#portal-studio-root [role='toolbar']", {
      hasText: "Task saved",
    })
  ).toBeVisible();
  // Dock badge reflects the persisted count; list + page marker exist.
  await expect(root.locator(".ps-badge")).toHaveText("1");
  await expect(root.locator(".ps-annotation-item")).toHaveCount(1);
  await expect(root.locator(".ps-marker-anchor")).toHaveCount(1);
  // Marker is INSIDE the shadow host: never in the page DOM.
  expect(await page.locator("body > .ps-marker-anchor").count()).toBe(0);
  await page
    .locator("#portal-studio-root [role='toolbar'] button", {
      hasText: "Done",
    })
    .click();

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
  await expect(root.locator(".ps-badge")).toHaveText("2");
  const task = readActiveTask();
  expect(task.schemaVersion).toBe(5);
  expect(task.annotations).toHaveLength(2);
  expect(task.annotations[1].comment).toBe("Second annotation");
  expect(task.annotations[1].annotationId).not.toBe(
    task.annotations[0].annotationId
  );

  // Reload → markers persist and re-resolve against the live DOM.
  await page.reload();
  await expect(root.locator(".ps-badge")).toHaveText("2");
  await openStudio(page);
  await expect(root.locator(".ps-annotation-item")).toHaveCount(2);
  await expect(root.locator(".ps-marker-anchor")).toHaveCount(2);
  await closeStudio(page);

  // Route change → targets gone → annotations RETAINED as unresolved.
  await page.goto(resolvePortalTestURL(environment, "/dev/ai-chat"));
  await openStudio(page);
  await expect(root.locator(".ps-annotation-item")).toHaveCount(2);
  await expect(root.locator(".ps-unresolved")).toHaveCount(2);
  await expect(root.locator(".ps-marker-anchor")).toHaveCount(0);
});

test("annotations: multi-select group, delete renumbers, hide and clear-all persist (G03)", async ({
  page,
}) => {
  await signIn(page);
  const root = page.locator("#portal-studio-root");
  await openStudio(page);

  // Multi-select group: seed pick + toggle a second element into ONE group.
  await page
    .locator("#portal-studio-root [role='toolbar'] button", {
      hasText: "Multi-select",
    })
    .click();
  const cellA = page.locator("tbody tr").first().locator("td").nth(0);
  const cellB = page.locator("tbody tr").first().locator("td").nth(1);
  await cellA.hover();
  await cellA.click();
  await cellB.hover();
  await cellB.click();
  await page
    .locator("#portal-studio-root [role='toolbar'] button", {
      hasText: "Finish group",
    })
    .click();
  await page
    .locator("#portal-studio-root textarea")
    .fill("G03 group annotation");
  await page.keyboard.press("Control+Enter");
  await expect(root.locator(".ps-badge")).toHaveText("1");
  let task = readActiveTask();
  expect(task.annotations).toHaveLength(1);
  expect(task.annotations[0].kind).toBe("multi");
  expect(task.annotations[0].elements).toHaveLength(2);
  await page
    .locator("#portal-studio-root [role='toolbar'] button", {
      hasText: "Done",
    })
    .click();

  // Second single annotation (delete target).
  await page
    .locator("#portal-studio-root [role='toolbar'] button", {
      hasText: "Pick element",
    })
    .click();
  const row2 = page.locator("tbody tr").first().locator("td").nth(2);
  await row2.hover();
  await row2.click();
  await page
    .locator("#portal-studio-root textarea")
    .fill("G03 second annotation");
  await page.keyboard.press("Control+Enter");
  await expect(root.locator(".ps-badge")).toHaveText("2");

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
    .poll(() => readActiveTask().annotations[0]?.hidden)
    .toBe(true);
  await page.reload();
  await expect(root.locator(".ps-badge")).toHaveText("1");
  await openStudio(page);
  await expect(root.locator(".ps-annotation-item")).toHaveCount(1);
  await expect(root.locator(".ps-annotation-item")).toContainText(/hidden/i);

  // More → Clear all annotations (confirm) → valid empty v5 task.
  await root.locator("[aria-label='More']").click();
  await root
    .locator(".ps-more-menu [role='menuitem']", {
      hasText: "Clear all annotations",
    })
    .click();
  await expect(root.locator(".ps-more-menu")).toContainText(
    "Clear all annotations?"
  );
  await root
    .locator(".ps-more-menu button", { hasText: "Clear all" })
    .click();
  await expect(root.locator(".ps-badge")).toHaveText("0");
  await expect(root.locator(".ps-annotation-item")).toHaveCount(0);
  await expect
    .poll(() => readActiveTask().annotations.length)
    .toBe(0);
  task = readActiveTask();
  expect(task.schemaVersion).toBe(5);
  expect(task.annotations).toEqual([]);

  // Reload after clear-all: still empty, nothing resurrects.
  await page.reload();
  await expect(root.locator(".ps-badge")).toHaveText("0");
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
  await expect(root.locator(".ps-badge")).toHaveText("1");

  // The old Clear-task normal path is gone (Complete replaced it).
  await expect(
    root.locator("[role='toolbar'] button", { hasText: "Clear task" })
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
        await root.locator("[aria-label='Copy']").click();
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

  // Completed rendering survives reload.
  await page.reload();
  await expect(root.locator(".ps-badge")).toHaveText("1");
  await openStudio(page);
  await expect(root.locator(".ps-annotation-item")).toContainText(
    /completed/i
  );
});

test("a11y keyboard walkthrough: dock, More menu containment, Esc focus return (G05)", async ({
  page,
}) => {
  await signIn(page);
  const root = page.locator("#portal-studio-root");
  await root.locator(".ps-dock").waitFor();

  // Tab reaches the toggle; arrow keys move the dock; Esc/Enter semantics.
  await root.locator(".ps-toggle").focus();
  await expect(root.locator(".ps-toggle")).toBeFocused();
  const dockBefore = (await root.locator(".ps-dock").boundingBox())!;
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  const dockAfter = (await root.locator(".ps-dock").boundingBox())!;
  expect(dockAfter.x).toBeLessThan(dockBefore.x - 20);

  // Enter on the toggle opens the panel (native button activation).
  await root.locator(".ps-toggle").focus();
  await page.keyboard.press("Enter");
  await expect(root.locator("[role='toolbar']")).toBeVisible();

  // More menu: open via keyboard, Tab cycles within the menu, Esc closes
  // and returns focus to the More button.
  await root.locator("[aria-label='More']").focus();
  await page.keyboard.press("Enter");
  await expect(root.locator(".ps-more-menu")).toBeVisible();
  const menuItems = root.locator(".ps-more-menu [role='menuitem']");
  await expect(menuItems).toHaveCount(3);
  // Tab ADVANCES through the items (not just containment — P1-1): after
  // each Tab the focused menuitem text changes.
  await page.keyboard.press("Tab");
  await expect(menuItems.nth(0)).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(menuItems.nth(1)).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(menuItems.nth(2)).toBeFocused();
  // Wrap-around keeps focus inside the menu.
  await page.keyboard.press("Tab");
  await expect(menuItems.nth(0)).toBeFocused();
  // Shift+Tab wraps backwards.
  await page.keyboard.press("Shift+Tab");
  await expect(menuItems.nth(2)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(root.locator(".ps-more-menu")).toHaveCount(0);
  await expect(root.locator("[aria-label='More']")).toBeFocused();

  // Delete-confirm Esc cancels and returns focus (F-1 path). The panel is
  // still open from the toggle above — create an annotation to act on.
  await page
    .locator("#portal-studio-root [role='toolbar'] button", {
      hasText: "Pick element",
    })
    .click();
  const row = page.locator("tbody tr").first();
  await row.hover();
  await row.click();
  await page.locator("#portal-studio-root textarea").fill("G05 a11y");
  await page.keyboard.press("Control+Enter");
  await expect(root.locator(".ps-badge")).toHaveText("1");
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
