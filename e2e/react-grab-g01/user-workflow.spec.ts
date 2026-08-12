/**
 * Goal 06 — full user-workflow E2E on the fixture (nested SVG, Shadow DOM,
 * marker lifecycle), driving the REAL StudioToolbar through its public
 * capture UI. The dev-only task/screenshot endpoints are stubbed at the
 * HTTP layer (page.route) with a stateful in-memory task, so the exact
 * product code path runs: Pick → composer → save → toast → marker layer →
 * reload → locator rehydration → unresolved-on-fingerprint-mismatch →
 * editor edit/complete/reopen/delete.
 *
 * These flows are fixture-owned complements to the portal-studio.spec.ts
 * workflow suite (which covers table-cell targets on the real portal).
 */

import { expect, test } from "@playwright/test";

import type { ReactGrabG01Api } from "./fixture";

type StubTask = {
  schemaVersion: number;
  taskId: string;
  createdAt: string;
  url: string;
  title: string;
  annotations: unknown[];
  businessContext: unknown[];
  redaction: { droppedKeys: unknown[]; redactedValues: number; truncatedValues: number };
};

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

/**
 * Stateful stub of the dev-only task endpoints. The browser's real fetch
 * calls are intercepted; the task accumulates annotations exactly like the
 * server artifact would, and survives reloads for the given page object.
 */
const stubStudioEndpoints = (
  page: import("@playwright/test").Page
): { readTask: () => StubTask } => {
  let task: StubTask = {
    schemaVersion: 6,
    taskId: "fixture-workflow-task",
    createdAt: new Date().toISOString(),
    url: "http://127.0.0.1:4174/e2e/react-grab-g01/",
    title: "Fixture",
    annotations: [],
    businessContext: [],
    redaction: { droppedKeys: [], redactedValues: 0, truncatedValues: 0 },
  };
  let revision = 1;
  const fulfill = (
    route: import("@playwright/test").Route,
    payload: unknown,
    status = 200
  ) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(payload),
    });

  page.route("**/__portal-studio/tasks", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      await fulfill(route, { task });
      return;
    }
    // Save POST: the browser sends the whole v6 task.
    const body = request.postDataJSON() as StubTask;
    if (body && body.schemaVersion === 6 && body.taskId) {
      task = { ...body, taskRevision: revision };
      revision += 1;
    }
    await fulfill(route, {
      ok: true,
      taskId: task.taskId,
      taskRevision: revision,
    });
  });
  page.route("**/__portal-studio/screenshots", async (route) => {
    await fulfill(route, { ok: true, file: "screenshots/stub.png" });
  });
  page.route("**/__portal-studio/mutate", async (route) => {
    const request = route.request();
    const body = request.postDataJSON() as {
      operations: Array<{
        op: string;
        annotationId?: string;
        comment?: string;
        hidden?: boolean;
      }>;
    };
    for (const operation of body.operations ?? []) {
      if (operation.op === "updateComment") {
        task = {
          ...task,
          annotations: task.annotations.map((annotation) =>
            (annotation as { annotationId: string }).annotationId ===
            operation.annotationId
              ? { ...(annotation as object), comment: operation.comment }
              : annotation
          ),
        };
      }
      if (operation.op === "complete") {
        task = {
          ...task,
          annotations: task.annotations.map((annotation) =>
            (annotation as { annotationId: string }).annotationId ===
            operation.annotationId
              ? {
                  ...(annotation as object),
                  status: "completed",
                  completedAt: new Date().toISOString(),
                }
              : annotation
          ),
        };
      }
      if (operation.op === "reopen") {
        task = {
          ...task,
          annotations: task.annotations.map((annotation) =>
            (annotation as { annotationId: string }).annotationId ===
            operation.annotationId
              ? { ...(annotation as object), status: "open" }
              : annotation
          ),
        };
      }
      if (operation.op === "remove") {
        task = {
          ...task,
          annotations: task.annotations.filter(
            (annotation) =>
              (annotation as { annotationId: string }).annotationId !==
              operation.annotationId
          ),
        };
      }
    }
    revision += 1;
    await fulfill(route, {
      ok: true,
      taskRevision: revision,
      task,
    });
  });
  return { readTask: () => task };
};

const saveComment = async (page: import("@playwright/test").Page, comment: string) => {
  const composer = page
    .locator("[data-portal-studio-root]")
    .getByRole("dialog", { name: "Annotation" });
  await expect(composer).toBeVisible();
  await composer.locator("textarea").fill(comment);
  // The Save button is disabled while the async inspection pipeline runs.
  const save = composer.getByRole("button", {
    name: /Save|Inspecting|Saving/,
  });
  await expect(save).toBeEnabled({ timeout: 20000 });
  await save.click();
  await expect(
    page.locator("[data-portal-studio-root] .ps-save-toast", {
      hasText: /Annotation saved|Unable to save|screenshot/i,
    })
  ).toBeVisible({ timeout: 20000 });
};

test("G06 workflow: nested-SVG Pick saves the BUTTON target and renders a Marker", async ({
  page,
}) => {
  await openFixture(page);
  const { readTask } = stubStudioEndpoints(page);
  await callApi(page, "setOverlayVisible", [false]);
  await callApi(page, "startCaptureMode", ["pick"]);
  await callApi(page, "clickTargetAt", ["fixture-svg-path"]);
  await saveComment(page, "G06 nested svg comment");
  // The saved capture is the meaningful BUTTON, not the raw <path>.
  const annotation = readTask().annotations.at(-1) as {
    elements: Array<{ tagName: string; selector: string }>;
  };
  expect(annotation.elements).toHaveLength(1);
  expect(annotation.elements[0].tagName).toBe("button");
  // The marker for the SVG button renders.
  await expect(
    page.locator("[data-portal-studio-root] .ps-marker-anchor")
  ).toHaveCount(1);
  await callApi(page, "cancelCapture");
});

test("G06 workflow: open Shadow DOM target — Pick, save, Marker rehydrates after reload", async ({
  page,
}) => {
  await openFixture(page);
  const { readTask } = stubStudioEndpoints(page);
  await callApi(page, "setOverlayVisible", [false]);
  await callApi(page, "startCaptureMode", ["pick"]);
  // The shadow button lives inside an OPEN shadow root — dispatch the click
  // on the shadow-internal element (the engine's coordinate hit-testing
  // pierces the shadow, so the pick handler resolves the button).
  await page.evaluate(() => {
    const host = document.getElementById("fixture-shadow-host");
    const button = host?.shadowRoot?.getElementById("fixture-shadow-button");
    if (!button) throw new Error("missing shadow button");
    const rect = button.getBoundingClientRect();
    button.dispatchEvent(
      new MouseEvent("click", {
        clientX: rect.x + rect.width / 2,
        clientY: rect.y + rect.height / 2,
        bubbles: true,
        cancelable: true,
        // Shadow-internal events must propagate to the document listeners.
        composed: true,
      })
    );
  });
  await saveComment(page, "G06 shadow comment");
  const annotation = readTask().annotations.at(-1) as {
    elements: Array<{ tagName: string; selector: string }>;
  };
  expect(annotation.elements).toHaveLength(1);
  expect(annotation.elements[0].selector).toContain(">>>");
  await callApi(page, "cancelCapture");

  // Reload: the GET serves the persisted task; the locator must rehydrate
  // the marker THROUGH the open shadow root.
  await page.reload();
  await expect(page.locator("#fixture-ready")).toBeVisible();
  await expect(
    page.locator("[data-portal-studio-root] .ps-marker-anchor")
  ).toHaveCount(1);
});

test("G06 workflow: fingerprint mismatch makes the Marker unresolved, never wrong", async ({
  page,
}) => {
  await openFixture(page);
  const { readTask } = stubStudioEndpoints(page);
  await callApi(page, "setOverlayVisible", [false]);
  await callApi(page, "startCaptureMode", ["pick"]);
  // The same-origin IFRAME button is plain HTML — a persistent DOM
  // mutation there is deterministic (no React reconciliation to restore
  // it), and the engine's hit testing pierces same-origin iframes.
  await page.evaluate(() => {
    const frame = document.getElementById("fixture-iframe") as
      | HTMLIFrameElement
      | null;
    const button = frame?.contentDocument?.getElementById(
      "fixture-iframe-button"
    );
    if (!button) throw new Error("missing iframe button");
    const buttonRect = button.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    // The click is dispatched on the IFRAME ELEMENT in the MAIN document
    // (iframe-internal events do not propagate to the parent document)
    // with MAIN-document coordinates (frame offset + button offset); the
    // pick handler hit-tests by coordinates and the engine pierces
    // same-origin iframes.
    frame.dispatchEvent(
      new MouseEvent("click", {
        clientX: frameRect.x + buttonRect.x + buttonRect.width / 2,
        clientY: frameRect.y + buttonRect.y + buttonRect.height / 2,
        bubbles: true,
        cancelable: true,
      })
    );
  });
  await saveComment(page, "G06 mutable target");
  await callApi(page, "cancelCapture");
  const annotation = readTask().annotations.at(-1) as {
    elements: Array<{ selector: string }>;
  };
  expect(annotation.elements).toHaveLength(1);
  expect(annotation.elements[0].selector).toContain(">>iframe>>");

  // The marker rehydrates after the reload (locator crosses the iframe)…
  await page.reload();
  await expect(page.locator("#fixture-ready")).toBeVisible();
  await expect(
    page.locator("[data-portal-studio-root] .ps-marker-anchor")
  ).toHaveCount(1);
  // …then mutate the live target's strong identity inside the iframe: the
  // marker must become unresolved — never reattached to another element.
  await page.evaluate(() => {
    const frame = document.getElementById("fixture-iframe") as
      | HTMLIFrameElement
      | null;
    const button = frame?.contentDocument?.getElementById(
      "fixture-iframe-button"
    );
    if (button) button.id = "fixture-iframe-button-renamed";
    // The re-resolution trigger (scroll/resize listeners).
    window.dispatchEvent(new Event("resize"));
  });
  await expect(
    page.locator("[data-portal-studio-root] .ps-marker-anchor")
  ).toHaveCount(0);
  // …and the list shows the annotation as unresolved (not attached).
  // The chip's accessible label carries the open count when annotations
  // exist ("Annotation tools (1 open)"), so match by prefix.
  await page.evaluate(() => {
    const chip = document.querySelector(
      "[data-portal-studio-root] button[aria-label^='Annotation tools']"
    ) as HTMLButtonElement | null;
    chip?.click();
  });
  await expect(
    page.locator("[data-portal-studio-root] [role='toolbar']")
  ).toBeVisible();
  await page.evaluate(() => {
    const list = document.querySelector(
      "[data-portal-studio-root] button[aria-label='Annotation list']"
    ) as HTMLButtonElement | null;
    list?.click();
  });
  await expect(
    page.locator("[data-portal-studio-root] .ps-annotation-item")
  ).toHaveCount(1);
  await expect(
    page.locator("[data-portal-studio-root] .ps-unresolved")
  ).toHaveCount(1);
});

test("G06 workflow: Marker editor — edit, complete, reopen, delete", async ({
  page,
}) => {
  await openFixture(page);
  const { readTask } = stubStudioEndpoints(page);
  await callApi(page, "setOverlayVisible", [false]);
  await callApi(page, "startCaptureMode", ["pick"]);
  await callApi(page, "clickTargetAt", ["fixture-plain-button"]);
  await saveComment(page, "G06 editor original");
  await callApi(page, "cancelCapture");
  expect(readTask().annotations).toHaveLength(1);

  const marker = page.locator("[data-portal-studio-root] .ps-marker-anchor button");
  await expect(marker).toHaveCount(1);
  await marker.focus();
  await page.keyboard.press("Enter");
  const editor = page.locator("[data-portal-studio-root] .ps-marker-editor");
  await expect(editor).toBeVisible();
  await editor.locator("textarea").fill("G06 editor edited");
  await editor.locator(".ps-button.ps-primary").click();
  await expect
    .poll(() => (readTask().annotations[0] as { comment: string }).comment)
    .toBe("G06 editor edited");

  // Complete from the editor.
  await marker.focus();
  await page.keyboard.press("Enter");
  await expect(editor).toBeVisible();
  await editor
    .locator(".ps-button:not(.ps-primary):not(.ps-danger)")
    .click();
  await expect
    .poll(
      () =>
        (readTask().annotations[0] as { status?: string }).status ===
        "completed"
    )
    .toBe(true);
  // The completed annotation's MARKER renders in the ALL view only (the
  // Open view filters it out, like the portal list) — switch the view so
  // the marker stays interactive for the editor reopen.
  await page.evaluate(() => {
    const chip = document.querySelector(
      "[data-portal-studio-root] button[aria-label^='Annotation tools']"
    ) as HTMLButtonElement | null;
    chip?.click();
  });
  await expect(
    page.locator("[data-portal-studio-root] [role='toolbar']")
  ).toBeVisible();
  await page.evaluate(() => {
    const list = document.querySelector(
      "[data-portal-studio-root] button[aria-label='Annotation list']"
    ) as HTMLButtonElement | null;
    list?.click();
  });
  await expect(
    page.locator("[data-portal-studio-root] .ps-list-panel")
  ).toBeVisible();
  await page.evaluate(() => {
    const all = document.querySelector(
      "[data-portal-studio-root] .ps-view-toggle[aria-pressed='false']"
    ) as HTMLButtonElement | null;
    all?.click();
  });
  await expect
    .poll(() => page.locator("[data-portal-studio-root] .ps-marker-anchor").count())
    .toBe(1);

  // Reopen from the editor.
  await marker.focus();
  await page.keyboard.press("Enter");
  await expect(editor).toBeVisible();
  await editor
    .locator(".ps-button:not(.ps-primary):not(.ps-danger)")
    .click();
  await expect
    .poll(
      () =>
        (readTask().annotations[0] as { status?: string }).status === "open"
    )
    .toBe(true);

  // Delete with the lightweight confirmation.
  await marker.focus();
  await page.keyboard.press("Enter");
  await expect(editor).toBeVisible();
  await editor.locator(".ps-button.ps-danger").click();
  await expect(
    page.locator("[data-portal-studio-root] .ps-annotation-confirm")
  ).toBeVisible();
  await page
    .locator("[data-portal-studio-root] .ps-annotation-confirm button", {
      hasText: "Delete",
    })
    .click();
  await expect
    .poll(() => readTask().annotations.length)
    .toBe(0);
  await expect(
    page.locator("[data-portal-studio-root] .ps-marker-anchor")
  ).toHaveCount(0);
});
