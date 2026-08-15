import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  loadPortalE2EEnvironment,
  requirePortalE2ECredentials,
  resolvePortalTestURL,
} from "./support";
import { getPortalStorageKey } from "./support/session";

const environment = loadPortalE2EEnvironment();
const credentials = requirePortalE2ECredentials(environment);
const runtimeRoot = path.resolve(".agent-annotations");
const taskPath = path.join(runtimeRoot, "tasks/active-task.json");
const evidenceRoot = process.env.AGENT_ANNOTATIONS_EVIDENCE;
const shadow = (page: Page, selector: string) =>
  page.locator(`#agent-annotations-root >> ${selector}`);
const readTask = () => JSON.parse(readFileSync(taskPath, "utf8")) as {
  annotations: Array<{
    annotationId: string;
    comment: string;
    status: "open" | "completed";
    extensions: Record<string, unknown>;
  }>;
};
const cli = (...args: string[]) =>
  execFileSync("pnpm", ["exec", "agent-annotations", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

async function signIn(page: Page) {
  await page.goto(resolvePortalTestURL(environment, "/login"));
  await page.getByLabel("Username or email", { exact: true }).fill(credentials.account);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect.poll(() => new URL(page.url()).pathname).not.toMatch(/\/(?:login|signin)\/?$/);
}

async function saveElement(page: Page, action: "pick" | "multi", targets: Locator[], comment: string) {
  await shadow(page, `[data-action-id="${action}"]`).click();
  for (const target of targets) await target.click();
  if (action === "multi") await page.keyboard.press("Enter");
  await shadow(page, '[aria-label="Annotation comment"]').fill(comment);
  await shadow(page, 'button[aria-label="Save annotation"]').click();
  await expect.poll(() => readTask().annotations.some((entry) => entry.comment === comment)).toBe(true);
}

test.describe.configure({ mode: "serial" });

test("G08 real Portal thin integration, locale, capture, CLI and browser sync", async ({ page, context }) => {
  rmSync(runtimeRoot, { recursive: true, force: true });
  await signIn(page);
  await page.goto(resolvePortalTestURL(environment, "/users"));
  const localeKey = getPortalStorageKey(environment, "locale");
  await expect(page.locator("main").last()).toBeVisible();
  await expect(page.locator("#agent-annotations-root")).toHaveCount(1);
  await expect(shadow(page, ".aa-dock")).toBeVisible();
  await expect(shadow(page, '[data-action-id="pick"]')).toHaveAttribute("aria-label", /^(Pick|选取) \(/);
  await expect(shadow(page, '[data-action-id="pick"] svg')).toHaveCount(1);
  if (evidenceRoot) {
    mkdirSync(evidenceRoot, { recursive: true });
    await page.screenshot({ path: path.join(evidenceRoot, "portal-toolbar.png") });
  }

  const heading = page.locator("main h1, main h2").first();
  const create = page.getByRole("link", { name: "Create", exact: true }).first();
  await expect(heading).toBeVisible();
  await expect(create).toBeVisible();
  await heading.evaluate((element) => {
    element.setAttribute("data-ai-page-element", "users-heading");
    element.setAttribute("data-nb-resource", "users");
    element.setAttribute("data-nb-view", "list");
  });

  await saveElement(page, "pick", [heading], "G08 pick");
  expect(readTask().annotations[0]?.extensions).toEqual({
    "nocobase.portal": {
      context: {
        strong: {
          "data-ai-page-element": "users-heading",
          "data-nb-resource": "users",
        },
        contextual: { "data-nb-view": "list" },
      },
    },
  });

  await saveElement(page, "multi", [heading, create], "G08 multi");
  await shadow(page, '[data-action-id="area"]').click();
  const box = await page.locator("main").last().boundingBox();
  if (!box) throw new Error("Portal main surface has no bounds");
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 100, { steps: 4 });
  await page.mouse.up();
  await shadow(page, '[aria-label="Annotation comment"]').fill("G08 area");
  await shadow(page, 'button[aria-label="Save annotation"]').click();
  await expect.poll(() => readTask().annotations).toHaveLength(3);

  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await shadow(page, '[data-action-id="copy"]').click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("G08 pick");

  const browserCompleteId = readTask().annotations[0]!.annotationId;
  await shadow(page, '[data-action-id="list"]').click();
  await shadow(page, '.aa-panel button[aria-label="Edit annotation 1"]').click();
  await shadow(page, 'button[aria-label="Complete"]').click();
  await expect.poll(() => readTask().annotations.find((entry) => entry.annotationId === browserCompleteId)?.status)
    .toBe("completed");

  const agentCompleteId = readTask().annotations[1]!.annotationId;
  expect(cli("list")).toContain(agentCompleteId);
  expect(cli("print", "--markdown")).toContain("G08 multi");
  cli("complete", agentCompleteId, "--verified", "--summary", "G08 browser verified");
  await expect(shadow(page, `[data-annotation-id="${agentCompleteId}"]`)).toBeHidden({
    timeout: 10_000,
  });

  await page.evaluate(
    ({ key, storageType }) => window[storageType].setItem(key, "zh-CN"),
    { key: localeKey, storageType: environment.storageType }
  );
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(shadow(page, '[data-action-id="pick"]')).toHaveAttribute("aria-label", /^选取 \(/);
  if (evidenceRoot) {
    await page.screenshot({ path: path.join(evidenceRoot, "portal-toolbar-zh-CN.png") });
  }
  await page.evaluate(
    ({ key, storageType }) => window[storageType].setItem(key, "en-US"),
    { key: localeKey, storageType: environment.storageType }
  );
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
  await expect(shadow(page, '[data-action-id="pick"]')).toHaveAttribute("aria-label", /^Pick \(/);
  await expect(page.locator("#agent-annotations-root")).toHaveCount(1);
});
