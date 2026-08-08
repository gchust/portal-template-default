import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudioToolbar } from "@/studio/toolbar";

vi.mock("@/studio/screenshot", () => ({
  captureViewportPng: vi.fn(async () => ({
    dataUrl: "data:image/png;base64,QUFBQQ==",
    width: 100,
    height: 50,
  })),
}));

const config = {
  token: "test-token",
  endpoint: "/__portal-studio/tasks",
  screenshotsEndpoint: "/__portal-studio/screenshots",
};

const makePageElement = (text = "Hello row", id = "") => {
  const row = document.createElement("tr");
  row.setAttribute("tabindex", "-1");
  if (id) row.id = id;
  row.textContent = text;
  document.body.appendChild(row);
  return row;
};

const jsonResponse = (payload: unknown, ok = true) => ({
  ok,
  json: async () => payload,
});

/**
 * URL-routed fetch mock: the panel's status GET and the save-flow POSTs are
 * dispatched by URL so mock ordering never depends on effect timing.
 */
const mockFetchRoutes = (
  routes: Array<{
    url: string;
    method: string;
    respond: () => Promise<{ ok: boolean; json: () => Promise<unknown> }>;
  }>
) => {
  const fetchMock = vi.fn(
    (input: string | URL | Request, init?: { method?: string }) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      const route = routes.find(
        (candidate) =>
          candidate.url === url && candidate.method.toUpperCase() === method
      );
      return Promise.resolve(
        route
          ? route.respond()
          : { ok: false, json: async () => ({ error: "unexpected" }) }
      );
    }
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const openAndPick = async (
  user: ReturnType<typeof userEvent.setup>,
  element: Element
) => {
  await user.click(
    screen.getByRole("button", { name: "Open Portal Studio" })
  );
  await user.click(screen.getByRole("button", { name: "Pick element" }));
  element.focus();
};

beforeEach(async () => {
  vi.mocked(
    (await import("@/studio/screenshot")).captureViewportPng
  ).mockClear();
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("StudioToolbar", () => {
  it("opens the panel and starts picking", async () => {
    const user = userEvent.setup();
    render(<StudioToolbar config={config} />);
    await user.click(
      screen.getByRole("button", { name: "Open Portal Studio" })
    );
    expect(
      screen.getByRole("toolbar", { name: "Portal Studio" })
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Pick element" }));
    expect(
      screen.getByText(/Hover an element, then click or press Enter/)
    ).toBeInTheDocument();
  });

  it("cancels picking with Escape", async () => {
    const user = userEvent.setup();
    render(<StudioToolbar config={config} />);
    await user.click(
      screen.getByRole("button", { name: "Open Portal Studio" })
    );
    await user.click(screen.getByRole("button", { name: "Pick element" }));
    await user.keyboard("{Escape}");
    expect(
      screen.queryByText(/Hover an element, then click or press Enter/)
    ).not.toBeInTheDocument();
  });

  it("shows the revision status when the active task has one", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        task: {
          schemaVersion: 5,
          taskId: "task-rev-1",
          createdAt: "2026-08-07T12:00:00.000Z",
          url: "http://127.0.0.1:4173/users",
          title: "Users",
          annotations: [
            {
              annotationId: "ann-1",
              kind: "element",
              comment: "c",
              createdAt: "2026-08-07T12:00:00.000Z",
              status: "open",
              elements: [],
            },
          ],
          businessContext: [],
          redaction: { droppedKeys: [], redactedValues: 0, truncatedValues: 0 },
          revision: {
            sourceRevision: "ab".repeat(32),
            browserRevision: 7,
            hmrAck: true,
            state: "matched",
            checkedAt: "2026-08-07T12:00:00.000Z",
          },
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<StudioToolbar config={config} />);
    await user.click(
      screen.getByRole("button", { name: "Open Portal Studio" })
    );
    expect(await screen.findByText(/Revision/)).toBeInTheDocument();
    expect(screen.getByText("abababab", { selector: "code" })).toBeInTheDocument();
    expect(screen.getByText("7", { selector: "code" })).toBeInTheDocument();
    expect(screen.getByText(/matched/)).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      { headers: Record<string, string> }
    ];
    expect(url).toBe("/__portal-studio/tasks");
    expect(init.headers["X-Portal-Studio-Token"]).toBe("test-token");
  });

  it("starts region marquee mode and cancels with Escape", async () => {
    const user = userEvent.setup();
    render(<StudioToolbar config={config} />);
    await user.click(
      screen.getByRole("button", { name: "Open Portal Studio" })
    );
    await user.click(screen.getByRole("button", { name: "Select region" }));
    expect(
      screen.getByText(/Drag over the page to select everything/)
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(
      screen.queryByText(/Drag over the page to select everything/)
    ).not.toBeInTheDocument();
  });

  it("picks a single element with the keyboard, saves a v2 task with a screenshot ref", async () => {
    const user = userEvent.setup();
    const row = makePageElement("Alice", "row-a");
    const fetchMock = mockFetchRoutes([
      {
        url: "/__portal-studio/tasks",
        method: "POST",
        respond: async () =>
          jsonResponse({
            ok: true,
            taskId: "task-1",
            file: "/repo/.portal-studio/tasks/active-task.json",
            sourceCandidates: [
              { kind: "module", file: "/repo/registry/users/list.tsx", line: 42 },
            ],
          }),
      },
      {
        url: "/__portal-studio/screenshots",
        method: "POST",
        respond: async () =>
          jsonResponse({
            ok: true,
            file: "screenshots/task-1.png",
            width: 100,
            height: 50,
          }),
      },
    ]);

    render(<StudioToolbar config={config} />);
    await openAndPick(user, row);
    await user.keyboard("{Enter}");

    expect(screen.getByText(/Captured/)).toBeInTheDocument();
    expect(screen.getByText("tr")).toBeInTheDocument();

    await user.type(
      screen.getByLabelText("Annotation comment"),
      "Increase padding"
    );
    await user.click(screen.getByRole("button", { name: "Save task" }));

    await waitFor(() => {
      expect(screen.getByText(/Task saved/)).toBeInTheDocument();
    });
    const postCalls = fetchMock.mock.calls.filter(
      (call) => (call[1] as { method?: string } | undefined)?.method === "POST"
    );
    expect(postCalls).toHaveLength(2);

    const [taskUrl, taskInit] = postCalls[0] as [
      string,
      { headers: Record<string, string>; body: string }
    ];
    expect(taskUrl).toBe("/__portal-studio/tasks");
    expect(taskInit.headers["X-Portal-Studio-Token"]).toBe("test-token");
    const taskPayload = JSON.parse(taskInit.body);
    expect(taskPayload.taskId).toBeTruthy();

    const [shotUrl, shotInit] = postCalls[1] as [
      string,
      { headers: Record<string, string>; body: string }
    ];
    expect(shotUrl).toBe("/__portal-studio/screenshots");
    expect(JSON.parse(shotInit.body).taskId).toBeTruthy();
    const payload = JSON.parse(taskInit.body);
    expect(payload.schemaVersion).toBe(5);
    expect(payload.annotations).toHaveLength(1);
    expect(payload.annotations[0].comment).toBe("Increase padding");
    expect(payload.annotations[0].kind).toBe("element");
    expect(payload.annotations[0].elements).toHaveLength(1);
    expect(payload.diagnostics).toEqual([]);
    expect(payload.annotations[0].elements[0].tagName).toBe("tr");
    expect(payload.annotations[0].elements[0].snapshot.domOutline).toContain("tr");
    expect(
      payload.annotations[0].elements[0].snapshot.computedStyle
    ).toBeDefined();
    expect(payload.businessContext).toEqual([]);
    expect(payload.redaction).toEqual({
      droppedKeys: [],
      redactedValues: 0,
      truncatedValues: 0,
    });
    // The screenshot ref is merged by the evidence POST, not the task POST.
    expect(payload.screenshot).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain("test-token");
  });

  it("supports Shift+Enter multi-select and plain Enter replace", async () => {
    const user = userEvent.setup();
    const a = makePageElement("A", "row-a");
    const b = makePageElement("B", "row-b");
    render(<StudioToolbar config={config} />);
    await openAndPick(user, a);
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    // Additive picks stay in picking mode and update the counter.
    expect(screen.getByText(/Selected/)).toBeInTheDocument();
    expect(screen.getByText("1", { selector: "strong" })).toBeInTheDocument();

    b.focus();
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect(screen.getByText("2", { selector: "strong" })).toBeInTheDocument();

    // Plain Enter commits the draft with a replaced (single) selection.
    a.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByText(/Captured/)).toBeInTheDocument();
    expect(screen.getByText("1", { selector: "strong" })).toBeInTheDocument();
  });

  it("starts a new picking session with a clean selection after close/reopen", async () => {
    const user = userEvent.setup();
    const row = makePageElement("Alice", "row-a");
    mockFetchRoutes([
      {
        url: "/__portal-studio/tasks",
        method: "POST",
        respond: async () => jsonResponse({ ok: true, taskId: "task-1", sourceCandidates: [] }),
      },
      {
        url: "/__portal-studio/screenshots",
        method: "POST",
        respond: async () =>
          jsonResponse({
            ok: true,
            file: "screenshots/task-1.png",
            width: 100,
            height: 50,
          }),
      },
    ]);

    render(<StudioToolbar config={config} />);
    await openAndPick(user, row);
    await user.keyboard("{Enter}");
    await user.type(
      screen.getByLabelText("Annotation comment"),
      "do it"
    );
    await user.click(screen.getByRole("button", { name: "Save task" }));
    await waitFor(() => {
      expect(screen.getByText(/Task saved/)).toBeInTheDocument();
    });

    // Close and reopen the panel (no Done click): the stale selection from
    // the saved round must be gone, so Shift+Enter on the SAME element adds
    // it (counter 1) instead of toggling it out of an old selection.
    await user.click(screen.getByRole("button", { name: "Close Portal Studio" }));
    await user.click(screen.getByRole("button", { name: "Open Portal Studio" }));
    await user.click(screen.getByRole("button", { name: "Pick element" }));
    row.focus();
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect(screen.getByText(/Selected/)).toBeInTheDocument();
    expect(screen.getByText("1", { selector: "strong" })).toBeInTheDocument();
  });

  it("clears the selection when closing the panel mid-draft", async () => {
    const user = userEvent.setup();
    const row = makePageElement("Alice", "row-a");
    render(<StudioToolbar config={config} />);
    await openAndPick(user, row);
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect(screen.getByText(/Selected/)).toBeInTheDocument();

    // Close the panel while picking with a non-empty selection, then reopen:
    // the session must be fully reset (no stale selection).
    await user.click(screen.getByRole("button", { name: "Close Portal Studio" }));
    await user.click(screen.getByRole("button", { name: "Open Portal Studio" }));
    await user.click(screen.getByRole("button", { name: "Pick element" }));
    row.focus();
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect(screen.getByText("1", { selector: "strong" })).toBeInTheDocument();
  });

  it("resets the selection after a successful save", async () => {
    const user = userEvent.setup();
    const row = makePageElement("Alice", "row-a");
    const fetchMock = mockFetchRoutes([
      {
        url: "/__portal-studio/tasks",
        method: "POST",
        respond: async () => jsonResponse({ ok: true, taskId: "task-1", sourceCandidates: [] }),
      },
      {
        url: "/__portal-studio/screenshots",
        method: "POST",
        respond: async () =>
          jsonResponse({
            ok: true,
            file: "screenshots/task-1.png",
            width: 100,
            height: 50,
          }),
      },
    ]);
    void fetchMock;

    render(<StudioToolbar config={config} />);
    await openAndPick(user, row);
    await user.keyboard("{Enter}");
    await user.type(
      screen.getByLabelText("Annotation comment"),
      "do it"
    );
    await user.click(screen.getByRole("button", { name: "Save task" }));
    await waitFor(() => {
      expect(screen.getByText(/Task saved/)).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "Done" }));
    await user.click(screen.getByRole("button", { name: "Pick element" }));
    // The stale selection must be gone: Shift+Enter on the same element adds
    // it (counter 1) instead of toggling it out of an old selection.
    row.focus();
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect(screen.getByText(/Selected/)).toBeInTheDocument();
    expect(screen.getByText("1", { selector: "strong" })).toBeInTheDocument();
  });

  it("clears the task through the DELETE endpoint", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetchRoutes([
      {
        url: "/__portal-studio/tasks",
        method: "DELETE",
        respond: async () => jsonResponse({ ok: true, clearedTask: true }),
      },
    ]);
    void fetchMock;
    render(<StudioToolbar config={config} />);
    await user.click(
      screen.getByRole("button", { name: "Open Portal Studio" })
    );
    await user.click(screen.getByRole("button", { name: "Clear task" }));
    await waitFor(() => {
      expect(screen.getByText("Task cleared")).toBeInTheDocument();
    });
    const deleteCall = fetchMock.mock.calls.find(
      (call) => (call[1] as { method?: string } | undefined)?.method === "DELETE"
    ) as [string, { method: string; headers: Record<string, string> }];
    expect(deleteCall[0]).toBe("/__portal-studio/tasks");
    expect(deleteCall[1].method).toBe("DELETE");
    expect(deleteCall[1].headers["X-Portal-Studio-Token"]).toBe("test-token");
  });

  it("shows an error when the save fails", async () => {
    const user = userEvent.setup();
    const row = makePageElement();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ ok: false, error: "invalid_task" }),
      })
    );
    render(<StudioToolbar config={config} />);
    await openAndPick(user, row);
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: "Save task" }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByRole("alert").textContent).toContain(
      "Unable to save task"
    );
  });

  // ---- Goal 02 annotations (D-033 #4/#7, D-034 #1/#2) ----

  it("renders the loaded annotation list with live numbers", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        task: {
          schemaVersion: 5,
          taskId: "task-list-1",
          createdAt: "2026-08-07T12:00:00.000Z",
          url: "http://127.0.0.1:4173/users",
          title: "Users",
          annotations: [
            {
              annotationId: "ann-a",
              kind: "element",
              comment: "Bold the header",
              createdAt: "2026-08-07T12:00:00.000Z",
              status: "open",
              elements: [],
            },
            {
              annotationId: "ann-b",
              kind: "region",
              comment: "Highlight the table",
              createdAt: "2026-08-07T12:00:00.000Z",
              status: "open",
              elements: [],
              region: { x: 1, y: 2, width: 10, height: 10 },
            },
          ],
          businessContext: [],
          redaction: { droppedKeys: [], redactedValues: 0, truncatedValues: 0 },
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<StudioToolbar config={config} />);
    await user.click(
      screen.getByRole("button", { name: "Open Portal Studio" })
    );
    await waitFor(() => {
      expect(screen.getAllByRole("listitem")).toHaveLength(2);
    });
    const list = screen.getByText("Annotations (2)");
    expect(list).toBeInTheDocument();
    expect(screen.getByText("Bold the header")).toBeInTheDocument();
    expect(screen.getByText("Highlight the table")).toBeInTheDocument();
  });

  it("Enter inserts a newline; Ctrl+Enter saves (D-034 #1)", async () => {
    const user = userEvent.setup();
    const row = makePageElement("Row", "row-enter");
    const fetchMock = mockFetchRoutes([
      {
        url: "/__portal-studio/tasks",
        method: "POST",
        respond: async () =>
          jsonResponse({
            ok: true,
            taskId: "task-enter-1",
            file: "/repo/.portal-studio/tasks/active-task.json",
          }),
      },
      {
        url: "/__portal-studio/screenshots",
        method: "POST",
        respond: async () =>
          jsonResponse({ ok: true, file: "screenshots/task-enter-1.png" }),
      },
    ]);
    render(<StudioToolbar config={config} />);
    await openAndPick(user, row);
    await user.keyboard("{Enter}");
    const textarea = screen.getByLabelText("Annotation comment");
    await user.type(textarea, "line one");
    await user.keyboard("{Enter}");
    expect((textarea as HTMLTextAreaElement).value).toBe("line one\n");
    await user.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() => {
      expect(screen.getByText(/Task saved/)).toBeInTheDocument();
    });
    const taskPost = fetchMock.mock.calls.find(
      (call) =>
        (call[1] as { method?: string } | undefined)?.method === "POST" &&
        String(call[0]).includes("/tasks")
    );
    const payload = JSON.parse((taskPost![1] as { body: string }).body);
    expect(payload.annotations[0].comment).toBe("line one\n");
  });

  it("capture failure keeps the annotation with a non-blocking notice (D-034 #2)", async () => {
    const user = userEvent.setup();
    const row = makePageElement("Row", "row-capture");
    const fetchMock = mockFetchRoutes([
      {
        url: "/__portal-studio/tasks",
        method: "POST",
        respond: async () =>
          jsonResponse({
            ok: true,
            taskId: "task-cap-1",
            file: "/repo/.portal-studio/tasks/active-task.json",
          }),
      },
    ]);
    vi.mocked(
      (await import("@/studio/screenshot")).captureViewportPng
    ).mockResolvedValueOnce(null);
    render(<StudioToolbar config={config} />);
    await openAndPick(user, row);
    await user.keyboard("{Enter}");
    await user.type(
      screen.getByLabelText("Annotation comment"),
      "keep me"
    );
    await user.click(screen.getByRole("button", { name: "Save task" }));
    await waitFor(() => {
      expect(screen.getByText(/Task saved/)).toBeInTheDocument();
    });
    // The notice is non-blocking; the annotation is NOT rolled back.
    expect(
      screen.getByRole("alert").textContent
    ).toContain("screenshot capture failed");
    expect(
      screen.getByText("keep me")
    ).toBeInTheDocument();
    const taskPost = fetchMock.mock.calls.find(
      (call) =>
        (call[1] as { method?: string } | undefined)?.method === "POST"
    );
    expect(taskPost).toBeDefined();
  });

  it("closes the panel from the toolbar header", async () => {
    const user = userEvent.setup();
    render(<StudioToolbar config={config} />);
    await user.click(
      screen.getByRole("button", { name: "Open Portal Studio" })
    );
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(
      screen.queryByRole("toolbar", { name: "Portal Studio" })
    ).not.toBeInTheDocument();
  });

  // ---- Goal 01 dock (G01 AC3/AC4/AC5/AC7) ----

  it("collapsed state renders the compact icon toolbar without the large panel", () => {
    render(<StudioToolbar config={config} />);
    expect(
      screen.getByRole("button", { name: "Open Portal Studio" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Annotations" })).toBeInTheDocument();
    expect(
      screen.queryByRole("toolbar", { name: "Portal Studio" })
    ).not.toBeInTheDocument();
    // No emoji glyphs in the toolbar (D-034 #5).
    expect(
      document.querySelector("#portal-studio-root")
    ).toBeNull(); // jsdom render has no host; check the root text instead
    const dock = document.querySelector(".ps-dock");
    expect(dock?.textContent).not.toContain("🛠");
  });

  it("expanding sets aria-expanded and shows the panel anchored above the dock", async () => {
    const user = userEvent.setup();
    render(<StudioToolbar config={config} />);
    const toggle = screen.getByRole("button", { name: "Open Portal Studio" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const panel = screen.getByRole("toolbar", { name: "Portal Studio" });
    // Panel layout comes from resolveDockLayout (inline left/top/bottom);
    // position:fixed lives in the shadow stylesheet (not loaded in jsdom).
    expect(panel.style.left).not.toBe("");
    expect(panel.style.width).not.toBe("");
  });

  it("keyboard arrows move the dock; Shift moves by the larger step", async () => {
    const user = userEvent.setup();
    render(<StudioToolbar config={config} />);
    const toggle = screen.getByRole("button", { name: "Open Portal Studio" });
    const dock = document.querySelector(".ps-dock") as HTMLElement;
    const before = { left: Number(dock.style.left.replace("px", "")), top: Number(dock.style.top.replace("px", "")) };
    toggle.focus();
    await user.keyboard("{ArrowLeft}");
    await user.keyboard("{Shift>}{ArrowLeft}{/Shift}");
    await waitFor(() => {
      const after = { left: Number(dock.style.left.replace("px", "")), top: Number(dock.style.top.replace("px", "")) };
      expect(after.left).toBe(before.left - 8 - 24);
      expect(after.top).toBe(before.top);
    });
  });

  it("keyboard drag never moves the dock outside the viewport", async () => {
    const user = userEvent.setup();
    render(<StudioToolbar config={config} />);
    const toggle = screen.getByRole("button", { name: "Open Portal Studio" });
    const dock = document.querySelector(".ps-dock") as HTMLElement;
    toggle.focus();
    for (let index = 0; index < 200; index += 1) {
      await user.keyboard("{ArrowLeft}");
    }
    expect(Number(dock.style.left.replace("px", ""))).toBe(0);
    for (let index = 0; index < 200; index += 1) {
      await user.keyboard("{ArrowUp}");
    }
    expect(Number(dock.style.top.replace("px", ""))).toBe(0);
  });

  it("More menu opens, Esc closes it and returns focus to the More button", async () => {
    const user = userEvent.setup();
    render(<StudioToolbar config={config} />);
    const more = screen.getByRole("button", { name: "More" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    await user.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    const menu = screen.getByRole("menu");
    expect(menu.textContent).toContain("Reset dock position");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(more).toHaveFocus();
  });

  it("Reset dock position restores the default bottom-right anchor", async () => {
    const user = userEvent.setup();
    render(<StudioToolbar config={config} />);
    const toggle = screen.getByRole("button", { name: "Open Portal Studio" });
    const dock = document.querySelector(".ps-dock") as HTMLElement;
    toggle.focus();
    await user.keyboard("{ArrowLeft}");
    await user.keyboard("{ArrowLeft}");
    const movedLeft = Number(dock.style.left.replace("px", ""));
    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(screen.getByRole("menuitem", { name: /Reset dock position/ }));
    await waitFor(() => {
      expect(Number(dock.style.left.replace("px", ""))).toBeGreaterThan(movedLeft);
    });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
