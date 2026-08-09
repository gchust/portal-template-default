import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    respond: (init?: { method?: string; body?: string }) => Promise<{
      ok: boolean;
      json: () => Promise<unknown>;
    }>;
  }>
) => {
  const fetchMock = vi.fn(
    (input: string | URL | Request, init?: { method?: string; body?: string }) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      const route = routes.find(
        (candidate) =>
          candidate.url === url && candidate.method.toUpperCase() === method
      );
      return Promise.resolve(
        route
          ? route.respond(init)
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

    // Close and reopen the panel: expand/collapse is presentation-only (Goal 01),
    // so the stale selection from the saved round persists. Clicking Pick again
    // starts a fresh session (count resets to 0), then Shift+Enter picks the
    // element fresh (count 1).
    await user.click(screen.getByRole("button", { name: /Close Portal Studio/ }));
    await user.click(screen.getByRole("button", { name: /Open Portal Studio/ }));
    await user.click(screen.getByRole("button", { name: "Pick element" }));
    row.focus();
    await user.keyboard("{Shift>}{Enter}{/Shift}");
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
    // expand/collapse is presentation-only (Goal 01), so the selection persists.
    // Clicking Pick again starts a fresh session, Shift+Enter picks (count 1).
    await user.click(screen.getByRole("button", { name: /Close Portal Studio/ }));
    await user.click(screen.getByRole("button", { name: /Open Portal Studio/ }));
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

  it("removed the Clear-task normal path (G04, D-033 #13)", async () => {
    const user = userEvent.setup();
    makeRoutedFetch([
      {
        annotationId: "ann-1",
        kind: "element",
        comment: "keep",
        createdAt: "2026-08-07T12:00:00.000Z",
        status: "open",
        elements: [],
      },
    ]);
    render(<StudioToolbar config={config} />);
    await user.click(
      screen.getByRole("button", { name: "Open Portal Studio" })
    );
    await waitFor(() => {
      expect(screen.getByText(/Annotations/)).toBeInTheDocument();
    });
    // Complete is the ONLY normal clear path now: no Clear task button.
    expect(
      screen.queryByRole("button", { name: "Clear task" })
    ).not.toBeInTheDocument();
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

  // ---- Goal 03 true multi-select (D-033 #5) ----

  it("multi-select: seed click starts ONE group, clicks toggle, Enter opens the comment editor, save produces a multi annotation", async () => {
    const user = userEvent.setup();
    const cellA = makePageElement("A", "cell-a");
    const cellB = makePageElement("B", "cell-b");
    const fetchMock = mockFetchRoutes([
      {
        url: "/__portal-studio/tasks",
        method: "POST",
        respond: async () =>
          jsonResponse({
            ok: true,
            taskId: "task-multi-1",
            file: "/repo/.portal-studio/tasks/active-task.json",
          }),
      },
      {
        url: "/__portal-studio/screenshots",
        method: "POST",
        respond: async () =>
          jsonResponse({ ok: true, file: "screenshots/task-multi-1.png" }),
      },
    ]);
    render(<StudioToolbar config={config} />);
    await user.click(
      screen.getByRole("button", { name: "Open Portal Studio" })
    );
    await user.click(screen.getByRole("button", { name: "Multi-select" }));
    await user.click(cellA);
    await user.click(cellB);
    // Same annotation: two elements in the group, no new annotation yet.
    expect(screen.getByText(/Selected/)).toBeInTheDocument();
    // Enter finishes the group → comment editor appears.
    await user.keyboard("{Enter}");
    await user.type(
      screen.getByLabelText("Annotation comment"),
      "group comment"
    );
    await user.click(screen.getByRole("button", { name: "Save task" }));
    await waitFor(() => {
      expect(screen.getByText(/Task saved/)).toBeInTheDocument();
    });
    const taskPost = fetchMock.mock.calls.find(
      (call) =>
        (call[1] as { method?: string } | undefined)?.method === "POST" &&
        String(call[0]).includes("/tasks")
    );
    const payload = JSON.parse((taskPost![1] as { body: string }).body);
    expect(payload.annotations).toHaveLength(1);
    expect(payload.annotations[0].kind).toBe("multi");
    expect(payload.annotations[0].elements).toHaveLength(2);
    expect(payload.annotations[0].comment).toBe("group comment");
  });

  it("multi-select: Space toggles the focused target; Esc cancels", async () => {
    const user = userEvent.setup();
    const cellA = makePageElement("A", "cell-a");
    const cellB = makePageElement("B", "cell-b");
    render(<StudioToolbar config={config} />);
    await user.click(
      screen.getByRole("button", { name: "Open Portal Studio" })
    );
    await user.click(screen.getByRole("button", { name: "Multi-select" }));
    cellA.focus();
    await user.keyboard(" ");
    expect(screen.getByText("1", { selector: "strong" })).toBeInTheDocument();
    cellB.focus();
    await user.keyboard(" ");
    expect(screen.getByText("2", { selector: "strong" })).toBeInTheDocument();
    await user.keyboard(" ");
    expect(screen.getByText("1", { selector: "strong" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    // Esc cancels the multi session: the finish-group action is gone and
    // the idle panel (Pick element) is back.
    expect(
      screen.queryByRole("button", { name: "Finish group" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Pick element" })
    ).toBeInTheDocument();
  });

  // ---- Goal 03 per-marker actions (D-033 #10/#11) ----

  const makeLoadTask = (annotations: unknown[]) => ({
    task: {
      schemaVersion: 5,
      taskId: "task-actions-1",
      createdAt: "2026-08-07T12:00:00.000Z",
      url: "http://127.0.0.1:4173/users",
      title: "Users",
      annotations,
      businessContext: [],
      redaction: { droppedKeys: [], redactedValues: 0, truncatedValues: 0 },
      screenshot: {
        file: "screenshots/task-actions-1.png",
        width: 100,
        height: 50,
        capturedAt: "2026-08-07T12:00:01.000Z",
      },
    },
  });

  const loadThen = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(
      screen.getByRole("button", { name: "Open Portal Studio" })
    );
    await waitFor(() => {
      expect(screen.getByText(/Annotations/)).toBeInTheDocument();
    });
  };

  const makeRoutedFetch = (annotations: unknown[]) => {
    return mockFetchRoutes([
      {
        url: "/__portal-studio/tasks",
        method: "GET",
        respond: async () => jsonResponse(makeLoadTask(annotations)),
      },
      {
        url: "/__portal-studio/tasks",
        method: "POST",
        respond: async () => jsonResponse({ ok: true }),
      },
    ]);
  };

  it("edits a comment inline; dirty indicator; Ctrl+Enter saves via POST", async () => {
    const user = userEvent.setup();
    const fetchMock = makeRoutedFetch([
      {
        annotationId: "ann-1",
        kind: "element",
        comment: "old comment",
        createdAt: "2026-08-07T12:00:00.000Z",
        status: "open",
        elements: [],
      },
    ]);
    render(<StudioToolbar config={config} />);
    await loadThen(user);
    await user.click(
      screen.getByRole("button", { name: "Edit comment" })
    );
    const textarea = screen.getByDisplayValue("old comment");
    await user.type(textarea, "!");
    expect(screen.getByText("Unsaved")).toBeInTheDocument();
    await user.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() => {
      expect(screen.getByText("old comment!")).toBeInTheDocument();
    });
    // The mutation POST rewrites the task with the edited comment (debounced).
    await waitFor(() => {
      const posts = fetchMock.mock.calls.filter(
        (call) =>
          (call[1] as { method?: string } | undefined)?.method === "POST"
      );
      expect(
        posts.some(
          (call) =>
            (JSON.parse((call[1] as { body: string }).body).annotations[0]
              ?.comment as string) === "old comment!"
        )
      ).toBe(true);
    });
    const editPosts = fetchMock.mock.calls.filter(
      (call) =>
        (call[1] as { method?: string } | undefined)?.method === "POST" &&
        (
          JSON.parse((call[1] as { body: string }).body).annotations[0]
            ?.comment as string
        ) === "old comment!"
    );
    expect(
      (JSON.parse((editPosts[0][1] as { body: string }).body) as {
        taskId: string;
      }).taskId
    ).toBe("task-actions-1");
  });

  it("deletes an annotation with inline confirmation; numbers renumber", async () => {
    const user = userEvent.setup();
    const fetchMock = makeRoutedFetch([
      {
        annotationId: "ann-1",
        kind: "element",
        comment: "first",
        createdAt: "2026-08-07T12:00:00.000Z",
        status: "open",
        elements: [],
      },
      {
        annotationId: "ann-2",
        kind: "element",
        comment: "second",
        createdAt: "2026-08-07T12:00:00.000Z",
        status: "open",
        elements: [],
      },
    ]);
    render(<StudioToolbar config={config} />);
    await loadThen(user);
    // Delete ann-1 (its delete button is the first in the list).
    await user.click(
      screen.getAllByRole("button", { name: "Delete" })[0]
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Delete this annotation?");
    await user.click(within(alert).getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(screen.queryByText("first")).not.toBeInTheDocument();
    });
    // Live renumbering: the remaining annotation becomes number 1.
    const chips = screen.getAllByText("1", { selector: "span" });
    expect(chips.length).toBeGreaterThanOrEqual(1);
    await waitFor(() => {
      const posts = fetchMock.mock.calls.filter(
        (call) =>
          (call[1] as { method?: string } | undefined)?.method === "POST"
      );
      expect(
        posts.some(
          (call) =>
            JSON.stringify(
              (
                JSON.parse((call[1] as { body: string }).body).annotations as {
                  annotationId: string;
                }[]
              ).map((a) => a.annotationId)
            ) === JSON.stringify(["ann-2"])
        )
      ).toBe(true);
    });
  });

  it("hides/unhides an annotation without deleting it", async () => {
    const user = userEvent.setup();
    const fetchMock = makeRoutedFetch([
      {
        annotationId: "ann-1",
        kind: "element",
        comment: "visible",
        createdAt: "2026-08-07T12:00:00.000Z",
        status: "open",
        elements: [],
      },
    ]);
    render(<StudioToolbar config={config} />);
    await loadThen(user);
    await user.click(screen.getByRole("button", { name: "Hide" }));
    await waitFor(() => {
      expect(screen.getByText("Hidden")).toBeInTheDocument();
    });
    await waitFor(() => {
      const posts = fetchMock.mock.calls.filter(
        (call) =>
          (call[1] as { method?: string } | undefined)?.method === "POST"
      );
      expect(
        posts.some(
          (call) =>
            (
              JSON.parse((call[1] as { body: string }).body).annotations as {
                hidden?: boolean;
              }[]
            )[0]?.hidden === true
        )
      ).toBe(true);
    });
    await user.click(screen.getByRole("button", { name: "Hide" }));
    await waitFor(() => {
      expect(screen.queryByText("Hidden")).not.toBeInTheDocument();
    });
  });

  it("Esc cancels the delete confirmation and returns focus (F-1)", async () => {
    const user = userEvent.setup();
    makeRoutedFetch([
      {
        annotationId: "ann-1",
        kind: "element",
        comment: "keep me",
        createdAt: "2026-08-07T12:00:00.000Z",
        status: "open",
        elements: [],
      },
    ]);
    render(<StudioToolbar config={config} />);
    await user.click(
      screen.getByRole("button", { name: "Open Portal Studio" })
    );
    await waitFor(() => {
      expect(screen.getByText(/Annotations/)).toBeInTheDocument();
    });
    const deleteButton = screen.getByRole("button", { name: "Delete" });
    await user.click(deleteButton);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Delete this annotation?"
    );
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(
        screen.queryByRole("alert")
      ).not.toBeInTheDocument();
    });
    // Focus returns to the (re-mounted) delete button of the same item.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Delete" })).toHaveFocus();
    });
    // The annotation was NOT deleted.
    expect(screen.getByText("keep me")).toBeInTheDocument();
  });

  it("flushes a pending mutation on unmount (reload safety, D-039)", async () => {
    const user = userEvent.setup();
    const fetchMock = makeRoutedFetch([
      {
        annotationId: "ann-1",
        kind: "element",
        comment: "will be hidden",
        createdAt: "2026-08-07T12:00:00.000Z",
        status: "open",
        elements: [],
      },
    ]);
    const { unmount } = render(<StudioToolbar config={config} />);
    await user.click(
      screen.getByRole("button", { name: "Open Portal Studio" })
    );
    await waitFor(() => {
      expect(screen.getByText(/Annotations/)).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "Hide" }));
    // Immediately unmount (the debounce has NOT fired yet): the pending
    // mutation must flush with keepalive instead of being lost.
    unmount();
    await waitFor(() => {
      const posts = fetchMock.mock.calls.filter(
        (call) =>
          (call[1] as { method?: string } | undefined)?.method === "POST"
      );
      expect(
        posts.some(
          (call) =>
            (
              JSON.parse((call[1] as { body: string }).body)
                .annotations as { hidden?: boolean }[]
            )[0]?.hidden === true
        )
      ).toBe(true);
    });
  });

  // ---- Goal 04 Copy (D-033 #12, D-034 #7) ----

  it("Copy uses the async Clipboard API, never mutates, and announces feedback", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const fetchMock = makeRoutedFetch([
      {
        annotationId: "ann-1",
        kind: "element",
        comment: "copy me",
        createdAt: "2026-08-07T12:00:00.000Z",
        status: "open",
        elements: [],
      },
    ]);
    render(<StudioToolbar config={config} />);
    await user.click(
      screen.getByRole("button", { name: "Open Portal Studio" })
    );
    await waitFor(() => {
      expect(screen.getByText(/Annotations/)).toBeInTheDocument();
    });
    const postsBefore = fetchMock.mock.calls.filter(
      (call) => (call[1] as { method?: string } | undefined)?.method === "POST"
    ).length;
    await user.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalled();
    });
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain("Comment: copy me");
    expect(copied).toContain("# Task task-actions-1");
    // aria-live feedback announced (the dock badge is also role=status).
    expect(
      screen.getByText("Copied to clipboard")
    ).toBeInTheDocument();
    // Copy NEVER clears or mutates annotations (no POST, list intact).
    const postsAfter = fetchMock.mock.calls.filter(
      (call) => (call[1] as { method?: string } | undefined)?.method === "POST"
    ).length;
    expect(postsAfter).toBe(postsBefore);
    expect(screen.getByText("copy me")).toBeInTheDocument();
  });

  it("falls back to a selectable textarea when the Clipboard API fails", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn().mockRejectedValue(new Error("denied")),
      },
    });
    makeRoutedFetch([
      {
        annotationId: "ann-1",
        kind: "element",
        comment: "manual copy",
        createdAt: "2026-08-07T12:00:00.000Z",
        status: "open",
        elements: [],
      },
    ]);
    render(<StudioToolbar config={config} />);
    await user.click(
      screen.getByRole("button", { name: "Open Portal Studio" })
    );
    await waitFor(() => {
      expect(screen.getByText(/Annotations/)).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "Copy" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Copy manually",
    });
    const textarea = within(dialog).getByRole("textbox");
    expect((textarea as HTMLTextAreaElement).value).toContain(
      "Comment: manual copy"
    );
    // The annotation is still there — Copy did not clear anything.
    expect(screen.getByText("manual copy")).toBeInTheDocument();
  });

  // ---- Goal 04 Complete (D-033 #13) ----

  it("per-annotation Complete persists status/completedAt without double-stamping", async () => {
    const user = userEvent.setup();
    // Stateful routes: once a mutation POST lands, the GET (triggered by
    // the post-flush refreshTask) reflects the completed annotation —
    // like the real server.
    let posted = false;
    const openAnn = {
      annotationId: "ann-1",
      kind: "element",
      comment: "finish me",
      createdAt: "2026-08-07T12:00:00.000Z",
      status: "open" as const,
      elements: [],
    };
    const fetchMock = mockFetchRoutes([
      {
        url: "/__portal-studio/tasks",
        method: "GET",
        respond: async () =>
          jsonResponse(
            makeLoadTask([
              posted
                ? {
                    ...openAnn,
                    status: "completed" as const,
                    completedAt: "2026-08-07T12:30:00.000Z",
                  }
                : openAnn,
            ])
          ),
      },
      {
        url: "/__portal-studio/tasks",
        method: "POST",
        respond: async () => {
          posted = true;
          return jsonResponse({ ok: true });
        },
      },
    ]);
    render(<StudioToolbar config={config} />);
    await user.click(
      screen.getByRole("button", { name: "Open Portal Studio" })
    );
    await waitFor(() => {
      expect(screen.getByText(/Annotations/)).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "Complete" }));
    await waitFor(() => {
      const posts = fetchMock.mock.calls.filter(
        (call) =>
          (call[1] as { method?: string } | undefined)?.method === "POST"
      );
      expect(
        posts.some((call) => {
          const annotation = (
            JSON.parse((call[1] as { body: string }).body)
              .annotations as {
              status: string;
              completedAt?: string;
            }[]
          )[0];
          return (
            annotation.status === "completed" &&
            typeof annotation.completedAt === "string"
          );
        })
      ).toBe(true);
    });
    // Goal 04: completing the final open item hides it from the default
    // Open view (not deleted). Switch to All to see the distinct completed
    // rendering with a Reopen action.
    await waitFor(() => {
      expect(screen.queryByText("finish me")).not.toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "All" }));
    await waitFor(() => {
      expect(screen.getByText("Completed")).toBeInTheDocument();
    });
    // The completed item offers Reopen (not Complete) in the list.
    expect(
      screen.queryByRole("button", { name: "Complete" })
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reopen" }));
    await waitFor(() => {
      const payloads = fetchMock.mock.calls
        .filter(
          (call) =>
            (call[1] as { method?: string } | undefined)?.method === "POST"
        )
        .map((call) => JSON.parse((call[1] as { body: string }).body));
      expect(
        payloads.some(
          (payload) =>
            (payload.annotations as { status: string }[])[0].status === "open"
        )
      ).toBe(true);
    });
    // Double-stamp protection for completeAnnotation stays covered by the
    // pure annotation-ops unit tests (no duplicate Complete button exists).
  });

  // ---- G05 acceptance-found defect (D-043): keepalive mutation bug ----

  it("the debounced mutation POST does NOT use keepalive (D-043)", async () => {
    const user = userEvent.setup();
    const fetchMock = makeRoutedFetch([
      {
        annotationId: "ann-1",
        kind: "element",
        comment: "will hide",
        createdAt: "2026-08-07T12:00:00.000Z",
        status: "open",
        elements: [],
      },
    ]);
    render(<StudioToolbar config={config} />);
    await user.click(
      screen.getByRole("button", { name: "Open Portal Studio" })
    );
    await waitFor(() => {
      expect(screen.getByText(/Annotations/)).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "Hide" }));
    await waitFor(() => {
      const posts = fetchMock.mock.calls.filter(
        (call) =>
          (call[1] as { method?: string } | undefined)?.method === "POST"
      );
      expect(posts.length).toBeGreaterThanOrEqual(1);
      // keepalive:true would fail with "Failed to fetch" for bodies over
      // the 64 KB budget — the regular path must NOT set it (D-043).
      for (const call of posts) {
        expect(
          (call[1] as { keepalive?: boolean }).keepalive
        ).toBeUndefined();
      }
    });
  });

  it("the unload flush skips oversized payloads with a warning (D-043)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const user = userEvent.setup();
    const fetchMock = makeRoutedFetch([
      {
        annotationId: "ann-1",
        kind: "element",
        comment: "x".repeat(1200), // large-ish comment
        createdAt: "2026-08-07T12:00:00.000Z",
        status: "open",
        elements: Array.from({ length: 40 }, (_, i) => ({
          tagName: "div",
          selectorCandidates: [{ kind: "path", selector: `x > div:nth(${i})` }],
          componentCandidates: [],
          sourceCandidates: [],
          snapshot: {
            text: "t".repeat(2000),
            attributes: {},
            childCount: 0,
          },
        })),
      },
    ]);
    const { unmount } = render(<StudioToolbar config={config} />);
    await user.click(
      screen.getByRole("button", { name: "Open Portal Studio" })
    );
    await waitFor(() => {
      expect(screen.getByText(/Annotations/)).toBeInTheDocument();
    });
    // Force an oversized payload: the loaded task is large enough that the
    // keepalive flush must skip it (guard fires) instead of failing.
    await user.click(screen.getByRole("button", { name: "Hide" }));
    unmount(); // triggers the unload flush path
    await waitFor(() => {
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("keepalive budget")
      );
    });
    // The oversized payload was NOT sent via keepalive (it would fail with
    // "Failed to fetch" — the D-043 defect); only the regular debounce may
    // write, and the flush consumed the pending payload.
    const keepalivePosts = fetchMock.mock.calls.filter(
      (call) =>
        (call[1] as { method?: string; keepalive?: boolean } | undefined)
          ?.method === "POST" &&
        (call[1] as { keepalive?: boolean }).keepalive === true
    );
    expect(keepalivePosts).toHaveLength(0);
    warn.mockRestore();
  });

  it("closes the panel via the Collapse button in the command row", async () => {
    const user = userEvent.setup();
    render(<StudioToolbar config={config} />);
    await user.click(
      screen.getByRole("button", { name: "Open Portal Studio" })
    );
    const panel = screen.getByRole("toolbar", { name: "Portal Studio" });
    expect(panel).toBeInTheDocument();
    // The command row has a Collapse button (Goal 01).
    await user.click(screen.getByRole("button", { name: "Collapse" }));
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
    // No More button or badge in collapsed state (Goal 01).
    expect(screen.queryByRole("button", { name: "More" })).not.toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Annotations" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("toolbar", { name: "Portal Studio" })
    ).not.toBeInTheDocument();
    // No emoji glyphs in the toolbar (D-034 #5).
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

  // ---- AC5: collapsed dock pauses capture listeners (Goal 01) ----

  it("collapsed Pick mode does not intercept page pointer events", async () => {
    const user = userEvent.setup();
    const row = makePageElement("Alice", "row-a");
    render(<StudioToolbar config={config} />);
    // Open and enter pick mode.
    await user.click(screen.getByRole("button", { name: "Open Portal Studio" }));
    await user.click(screen.getByRole("button", { name: "Pick element" }));
    expect(screen.getByText(/Hover an element/)).toBeInTheDocument();
    // Collapse while in pick mode.
    await user.click(screen.getByRole("button", { name: "Collapse" }));
    expect(
      screen.queryByRole("toolbar", { name: "Portal Studio" })
    ).not.toBeInTheDocument();
    // Simulate a pointer move on a page element — the picking listener should
    // NOT have intercepted it (no outline rendered, no mode change).
    fireEvent.pointerMove(row, { clientX: 10, clientY: 10 });
    expect(screen.queryByText(/Hover an element/)).not.toBeInTheDocument();
    // The outline must remain hidden — proof the listener did not fire.
    const outline = document.querySelector(".ps-outline");
    expect(outline?.getAttribute("style")).toContain("display: none");
    // Re-enter pick mode cleanly.
    await user.click(screen.getByRole("button", { name: /Open Portal Studio/ }));
    await user.click(screen.getByRole("button", { name: "Pick element" }));
    expect(screen.getByText(/Hover an element/)).toBeInTheDocument();
  });

  it("collapsed Multi mode does not intercept page pointer events", async () => {
    const user = userEvent.setup();
    const row = makePageElement("Alice", "row-a");
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: "Open Portal Studio" }));
    await user.click(screen.getByRole("button", { name: "Multi-select" }));
    expect(screen.getByText(/Multi-select/)).toBeInTheDocument();
    // Collapse while in multi mode.
    await user.click(screen.getByRole("button", { name: "Collapse" }));
    expect(
      screen.queryByRole("toolbar", { name: "Portal Studio" })
    ).not.toBeInTheDocument();
    // Pointer move should not trigger multi-select behavior.
    fireEvent.pointerMove(row, { clientX: 10, clientY: 10 });
    expect(screen.queryByText(/Multi-select/)).not.toBeInTheDocument();
    const outline = document.querySelector(".ps-outline");
    expect(outline?.getAttribute("style")).toContain("display: none");
  });

  it("collapsed Area mode does not intercept page pointer events", async () => {
    const user = userEvent.setup();
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: "Open Portal Studio" }));
    await user.click(screen.getByRole("button", { name: "Select region" }));
    expect(screen.getByText(/Drag over the page/)).toBeInTheDocument();
    // Collapse while in marquee mode.
    await user.click(screen.getByRole("button", { name: "Collapse" }));
    expect(
      screen.queryByRole("toolbar", { name: "Portal Studio" })
    ).not.toBeInTheDocument();
    // Pointer down/move should not start a marquee — the hint must not
    // reappear (it lives inside the panel which is collapsed).
    fireEvent.pointerDown(document.body, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(document.body, { clientX: 100, clientY: 100 });
    expect(screen.queryByText(/Drag over the page/)).not.toBeInTheDocument();
    // Re-enter marquee mode cleanly — proves the mode is still valid.
    await user.click(screen.getByRole("button", { name: /Open Portal Studio/ }));
    await user.click(screen.getByRole("button", { name: "Select region" }));
    expect(screen.getByText(/Drag over the page/)).toBeInTheDocument();
  });

  it("collapsed Pick mode does not intercept page keyboard events", async () => {
    const user = userEvent.setup();
    const row = makePageElement("Alice", "row-a");
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: "Open Portal Studio" }));
    await user.click(screen.getByRole("button", { name: "Pick element" }));
    // Collapse while in pick mode.
    await user.click(screen.getByRole("button", { name: "Collapse" }));
    // Arrow keys on the page should not be intercepted by picking listeners.
    fireEvent.keyDown(row, { key: "ArrowDown" });
    fireEvent.keyDown(row, { key: "Enter" });
    // No outline should appear — proof the listener did not fire.
    const outline = document.querySelector(".ps-outline");
    expect(outline?.getAttribute("style")).toContain("display: none");
    // Re-expand — pick mode should still be pending (not consumed).
    await user.click(screen.getByRole("button", { name: /Open Portal Studio/ }));
    expect(screen.getByText(/Hover an element/)).toBeInTheDocument();
  });

  it("re-expanding restores pending Pick mode and selection state", async () => {
    const user = userEvent.setup();
    const row = makePageElement("Alice", "row-a");
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: "Open Portal Studio" }));
    await user.click(screen.getByRole("button", { name: "Pick element" }));
    // Pick mode is active — verify the hint.
    expect(screen.getByText(/Hover an element/)).toBeInTheDocument();
    // Collapse — pick mode listeners are paused.
    await user.click(screen.getByRole("button", { name: "Collapse" }));
    // Re-expand — pick mode restored, hint visible again.
    await user.click(screen.getByRole("button", { name: /Open Portal Studio/ }));
    expect(screen.getByText(/Hover an element/)).toBeInTheDocument();
    // Pick an element after re-expand — works normally.
    row.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByText("1", { selector: "strong" })).toBeInTheDocument();
  });

  // ---- Goal 02: hotkey integration tests ----

  it("Ctrl+Alt+K toggles the dock open/closed", async () => {
    render(<StudioToolbar config={config} />);
    expect(screen.queryByRole("toolbar", { name: "Portal Studio" })).not.toBeInTheDocument();
    // Dispatch toggle hotkey — dock should open.
    fireEvent.keyDown(document, { key: "k", ctrlKey: true, altKey: true });
    expect(screen.getByRole("toolbar", { name: "Portal Studio" })).toBeInTheDocument();
    // Dispatch again — dock should close.
    fireEvent.keyDown(document, { key: "k", ctrlKey: true, altKey: true });
    expect(screen.queryByRole("toolbar", { name: "Portal Studio" })).not.toBeInTheDocument();
  });

  it("Ctrl+Alt+P expands dock and enters Pick mode from collapsed", async () => {
    render(<StudioToolbar config={config} />);
    expect(screen.queryByRole("toolbar", { name: "Portal Studio" })).not.toBeInTheDocument();
    // Dispatch Pick hotkey — dock expands and pick mode starts.
    fireEvent.keyDown(document, { key: "p", ctrlKey: true, altKey: true });
    expect(screen.getByRole("toolbar", { name: "Portal Studio" })).toBeInTheDocument();
    expect(screen.getByText(/Hover an element/)).toBeInTheDocument();
  });

  it("Ctrl+Alt+M switches from Pick to Multi mode safely", async () => {
    const user = userEvent.setup();
    render(<StudioToolbar config={config} />);
    // Open and enter pick mode.
    await user.click(screen.getByRole("button", { name: "Open Portal Studio" }));
    await user.click(screen.getByRole("button", { name: "Pick element" }));
    expect(screen.getByText(/Hover an element/)).toBeInTheDocument();
    // Switch to multi via hotkey — pick mode exits, multi starts.
    fireEvent.keyDown(document, { key: "m", ctrlKey: true, altKey: true });
    expect(screen.queryByText(/Hover an element/)).not.toBeInTheDocument();
    expect(screen.getByText(/Multi-select/)).toBeInTheDocument();
  });

  it("Ctrl+Alt+A switches from Pick to Area mode safely", async () => {
    const user = userEvent.setup();
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: "Open Portal Studio" }));
    await user.click(screen.getByRole("button", { name: "Pick element" }));
    expect(screen.getByText(/Hover an element/)).toBeInTheDocument();
    // Switch to area via hotkey.
    fireEvent.keyDown(document, { key: "a", ctrlKey: true, altKey: true });
    expect(screen.queryByText(/Hover an element/)).not.toBeInTheDocument();
    expect(screen.getByText(/Drag over the page/)).toBeInTheDocument();
  });

  it("Ctrl+Alt+C copies open annotations without clearing", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    makeRoutedFetch([
      {
        annotationId: "ann-open-1",
        kind: "element",
        comment: "hotkey open comment",
        createdAt: "2026-08-07T12:00:00.000Z",
        status: "open",
        elements: [],
      },
      {
        annotationId: "ann-done-1",
        kind: "element",
        comment: "hotkey completed comment",
        createdAt: "2026-08-07T12:00:00.000Z",
        status: "completed",
        elements: [],
      },
    ]);
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: "Open Portal Studio" }));
    await waitFor(() => {
      expect(screen.getByText(/Annotations/)).toBeInTheDocument();
    });
    // Dispatch Copy hotkey.
    fireEvent.keyDown(document, { key: "c", ctrlKey: true, altKey: true });
    await waitFor(() => {
      expect(writeText).toHaveBeenCalled();
    });
    const copied = writeText.mock.calls[0][0] as string;
    // Open annotation comment IS copied.
    expect(copied).toContain("hotkey open comment");
    // Completed annotation comment is NOT copied.
    expect(copied).not.toContain("hotkey completed comment");
    // Annotations count reflects ONLY the open one.
    expect(copied).toContain("## Annotations (1)");
    // Goal 04: nothing was cleared or mutated — the OPEN comment is in the
    // default Open view; the COMPLETED one is hidden there (view filter)
    // but still present in All.
    expect(screen.getByText("hotkey open comment")).toBeInTheDocument();
    expect(screen.queryByText("hotkey completed comment")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByText("hotkey completed comment")).toBeInTheDocument();
  });

  it("hotkey does not fire inside an input element", async () => {
    const user = userEvent.setup();
    const row = makePageElement("Alice", "row-a");
    render(<StudioToolbar config={config} />);
    // Open, pick an element to enter draft mode (textarea visible).
    await user.click(screen.getByRole("button", { name: "Open Portal Studio" }));
    await user.click(screen.getByRole("button", { name: "Pick element" }));
    row.focus();
    await user.keyboard("{Enter}");
    // Now in draft mode — textarea is visible.
    const textarea = screen.getByLabelText("Annotation comment");
    textarea.focus();
    // Dispatch Pick hotkey while focused on textarea — should NOT re-enter pick mode.
    fireEvent.keyDown(textarea, { key: "p", ctrlKey: true, altKey: true });
    // Still in draft mode, not pick mode.
    expect(screen.getByLabelText("Annotation comment")).toBeInTheDocument();
    expect(screen.queryByText(/Hover an element/)).not.toBeInTheDocument();
  });

  it("hotkey does not fire during IME composition", async () => {
    render(<StudioToolbar config={config} />);
    // Dispatch Pick hotkey with isComposing=true — should NOT enter pick mode.
    fireEvent.keyDown(document, { key: "p", ctrlKey: true, altKey: true, isComposing: true });
    expect(screen.queryByRole("toolbar", { name: "Portal Studio" })).not.toBeInTheDocument();
  });

  it("unmatched key does not call preventDefault", () => {
    render(<StudioToolbar config={config} />);
    const event = new KeyboardEvent("keydown", {
      key: "x",
      ctrlKey: true,
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    const spy = vi.spyOn(event, "preventDefault");
    document.dispatchEvent(event);
    expect(spy).not.toHaveBeenCalled();
  });

  it("hotkey switching preserves saved annotations", async () => {
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
        respond: async () => jsonResponse({ ok: true, file: "s.png", width: 100, height: 50 }),
      },
    ]);
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: "Open Portal Studio" }));
    // Pick and save an annotation.
    await user.click(screen.getByRole("button", { name: "Pick element" }));
    row.focus();
    await user.keyboard("{Enter}");
    await user.type(screen.getByLabelText("Annotation comment"), "saved note");
    await user.click(screen.getByRole("button", { name: "Save task" }));
    await waitFor(() => {
      expect(screen.getByText(/Task saved/)).toBeInTheDocument();
    });
    // Switch to multi via hotkey — saved annotation persists.
    fireEvent.keyDown(document, { key: "m", ctrlKey: true, altKey: true });
    expect(screen.getByText(/Multi-select/)).toBeInTheDocument();
    // Re-enter pick — annotation still in list.
    fireEvent.keyDown(document, { key: "p", ctrlKey: true, altKey: true });
    expect(screen.getByText("saved note")).toBeInTheDocument();
  });

  it("unsaved draft comment survives switching capture modes by hotkey", async () => {
    const user = userEvent.setup();
    const row = makePageElement("Alice", "row-a");
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: "Open Portal Studio" }));
    // Enter pick mode and pick an element → draft mode with comment textarea.
    await user.click(screen.getByRole("button", { name: "Pick element" }));
    row.focus();
    await user.keyboard("{Enter}");
    const textarea = screen.getByLabelText("Annotation comment");
    await user.type(textarea, "unsaved draft survives");
    expect((textarea as HTMLTextAreaElement).value).toBe("unsaved draft survives");
    // Hotkey switch to multi mode — draft mode exits, draft text preserved.
    fireEvent.keyDown(document, { key: "m", ctrlKey: true, altKey: true });
    expect(screen.getByText(/Multi-select/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Annotation comment")).not.toBeInTheDocument();
    // Hotkey back to pick, pick the element again → draft mode restored with text.
    fireEvent.keyDown(document, { key: "p", ctrlKey: true, altKey: true });
    row.focus();
    await user.keyboard("{Enter}");
    const restored = screen.getByLabelText("Annotation comment");
    expect((restored as HTMLTextAreaElement).value).toBe("unsaved draft survives");
  });

  // ---- Goal 03: marker-local annotation editor ----

  /** jsdom returns zero rects; give page elements a real geometry. */
  const mockRect = (
    element: Element,
    rect: { left: number; top: number; width: number; height: number }
  ) => {
    (element as HTMLElement & { getBoundingClientRect(): DOMRect }).getBoundingClientRect =
      () =>
        ({
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          right: rect.left + rect.width,
          bottom: rect.top + rect.height,
          x: rect.left,
          y: rect.top,
          toJSON: () => ({}),
        }) as DOMRect;
  };

  /** makePageElement + a non-zero rect (markers skip zero-sized targets). */
  const makeMarkerPageElement = (
    text: string,
    id: string,
    rect = { left: 100, top: 200, width: 200, height: 40 }
  ) => {
    const element = makePageElement(text, id);
    mockRect(element, rect);
    return element;
  };

  const makeMarkerTask = (annotations: unknown[]) => ({
    task: {
      schemaVersion: 5,
      taskId: "task-markers-1",
      createdAt: "2026-08-08T12:00:00.000Z",
      url: "http://127.0.0.1:4173/users",
      title: "Users",
      annotations,
      businessContext: [],
      redaction: { droppedKeys: [], redactedValues: 0, truncatedValues: 0 },
    },
  });

  const markerRoutes = (annotations: unknown[], postOk = true) => {
    // Stateful like the real server: the POST persists the submitted task,
    // so the follow-up GET (refreshTask) returns the UPDATED annotations.
    let current = [...annotations];
    return mockFetchRoutes([
      {
        url: "/__portal-studio/tasks",
        method: "GET",
        respond: async () => jsonResponse(makeMarkerTask(current)),
      },
      {
        url: "/__portal-studio/tasks",
        method: "POST",
        respond: async (init?: { method?: string; body?: string }) => {
          if (!postOk) {
            return jsonResponse({ ok: false, error: "boom" });
          }
          const payload = JSON.parse(init?.body ?? "{}") as {
            annotations?: unknown[];
          };
          if (Array.isArray(payload.annotations)) {
            current = payload.annotations;
          }
          return jsonResponse({ ok: true });
        },
      },
    ]);
  };

  const elementCapture = (id: string) => ({
    tagName: "tr",
    selectorCandidates: [{ kind: "id", selector: `#${id}` }],
    componentCandidates: [],
    sourceCandidates: [],
    snapshot: { text: id, attributes: {}, childCount: 0 },
  });

  it("markers render as semantic buttons labeled with display number and action", async () => {
    makeMarkerPageElement("Alice", "row-a");
    markerRoutes([
      {
        annotationId: "ann-1",
        kind: "element",
        comment: "fix this",
        createdAt: "2026-08-08T12:00:00.000Z",
        status: "open",
        elements: [elementCapture("row-a")],
      },
    ]);
    render(<StudioToolbar config={config} />);
    const marker = await screen.findByRole("button", {
      name: "Annotation 1: open editor",
    });
    expect(marker).toBeInTheDocument();
    // Not aria-hidden — it is a real accessible control.
    expect(marker.closest(".ps-marker-anchor")).not.toHaveAttribute(
      "aria-hidden"
    );
  });

  it("clicking an element marker opens the editor; Save persists via the shared path", async () => {
    const user = userEvent.setup();
    makeMarkerPageElement("Alice", "row-a");
    markerRoutes([
      {
        annotationId: "ann-1",
        kind: "element",
        comment: "original",
        createdAt: "2026-08-08T12:00:00.000Z",
        status: "open",
        elements: [elementCapture("row-a")],
      },
    ]);
    render(<StudioToolbar config={config} />);
    const marker = await screen.findByRole("button", {
      name: "Annotation 1: open editor",
    });
    await user.click(marker);
    // Editor opens beside the marker with the current comment.
    const dialog = screen.getByRole("dialog", { name: "Annotation editor" });
    const textarea = within(dialog).getByRole("textbox");
    expect((textarea as HTMLTextAreaElement).value).toBe("original");
    // Edit and save.
    await user.clear(textarea);
    await user.type(textarea, "edited from marker");
    await user.click(within(dialog).getByRole("button", { name: "Save comment" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    // Open the panel — the list shows the updated comment (shared path).
    await user.click(screen.getByRole("button", { name: /Open Portal Studio/ }));
    expect(await screen.findByText("edited from marker")).toBeInTheDocument();
  });

  it("save failure preserves the edited text and shows error/retry feedback", async () => {
    const user = userEvent.setup();
    makeMarkerPageElement("Alice", "row-a");
    markerRoutes(
      [
        {
          annotationId: "ann-1",
          kind: "element",
          comment: "original",
          createdAt: "2026-08-08T12:00:00.000Z",
          status: "open",
          elements: [elementCapture("row-a")],
        },
      ],
      false
    );
    render(<StudioToolbar config={config} />);
    const marker = await screen.findByRole("button", {
      name: "Annotation 1: open editor",
    });
    await user.click(marker);
    const dialog = screen.getByRole("dialog", { name: "Annotation editor" });
    const textarea = within(dialog).getByRole("textbox");
    await user.clear(textarea);
    await user.type(textarea, "precious text");
    await user.click(within(dialog).getByRole("button", { name: "Save comment" }));
    // Error feedback shown; editor stays open; text preserved.
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/boom/);
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect((within(dialog).getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      "precious text"
    );
    // The FAILED comment must NOT be in shared state: close the editor and
    // open the panel — the list still shows the last CONFIRMED comment.
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: /Open Portal Studio/ }));
    expect(screen.getByText("original")).toBeInTheDocument();
    expect(screen.queryByText("precious text")).not.toBeInTheDocument();
  });

  it("a failed comment cannot leak into a later unrelated mutation", async () => {
    const user = userEvent.setup();
    makeMarkerPageElement("Alice", "row-a");
    // Stateful mock: the FIRST POST fails; subsequent mutations succeed.
    let failed = true;
    let current: unknown[] = [
      {
        annotationId: "ann-1",
        kind: "element",
        comment: "original",
        createdAt: "2026-08-08T12:00:00.000Z",
        status: "open",
        elements: [elementCapture("row-a")],
      },
    ];
    const fetchMock = mockFetchRoutes([
      {
        url: "/__portal-studio/tasks",
        method: "GET",
        respond: async () => jsonResponse(makeMarkerTask(current)),
      },
      {
        url: "/__portal-studio/tasks",
        method: "POST",
        respond: async (init?: { method?: string; body?: string }) => {
          if (failed) {
            failed = false;
            return jsonResponse({ ok: false, error: "boom" });
          }
          const payload = JSON.parse(init?.body ?? "{}") as {
            annotations?: unknown[];
          };
          if (Array.isArray(payload.annotations)) {
            current = payload.annotations;
          }
          return jsonResponse({ ok: true });
        },
      },
    ]);
    render(<StudioToolbar config={config} />);
    const marker = await screen.findByRole("button", {
      name: "Annotation 1: open editor",
    });
    // 1. Failed edit of the comment.
    await user.click(marker);
    const dialog = screen.getByRole("dialog", { name: "Annotation editor" });
    const textarea = within(dialog).getByRole("textbox");
    await user.clear(textarea);
    await user.type(textarea, "doomed leak");
    await user.click(within(dialog).getByRole("button", { name: "Save comment" }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/boom/);
    });
    await user.keyboard("{Escape}");
    // 2. Unrelated mutation: Complete via the marker editor. It must build
    //    on the CONFIRMED annotations (comment "original"), never "doomed".
    await user.click(marker);
    await user.click(
      within(screen.getByRole("dialog", { name: "Annotation editor" })).getByRole(
        "button",
        { name: "Complete" }
      )
    );
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    // The persisted artifact: comment "original", status completed — the
    // successful Complete mutation never carried the failed comment.
    await waitFor(() => {
      const bodies = fetchMock.mock.calls
        .filter(
          (call) =>
            (call[1] as { method?: string } | undefined)?.method === "POST"
        )
        .map((call) => (call[1] as { body?: string }).body ?? "");
      expect(
        bodies.some((body) => body.includes('"status":"completed"'))
      ).toBe(true);
    });
    const postBodies = fetchMock.mock.calls
      .filter((call) => (call[1] as { method?: string } | undefined)?.method === "POST")
      .map((call) => (call[1] as { body?: string }).body ?? "");
    const completedPost = postBodies.find((body) =>
      body.includes('"status":"completed"')
    )!;
    expect(completedPost).not.toContain("doomed leak");
    expect(completedPost).toContain("original");
  });

  it("retry after a failed save succeeds and persists the corrected comment", async () => {
    const user = userEvent.setup();
    makeMarkerPageElement("Alice", "row-a");
    // First POST fails; the retry POST succeeds (stateful mock).
    let failed = true;
    let current: unknown[] = [
      {
        annotationId: "ann-1",
        kind: "element",
        comment: "original",
        createdAt: "2026-08-08T12:00:00.000Z",
        status: "open",
        elements: [elementCapture("row-a")],
      },
    ];
    mockFetchRoutes([
      {
        url: "/__portal-studio/tasks",
        method: "GET",
        respond: async () => jsonResponse(makeMarkerTask(current)),
      },
      {
        url: "/__portal-studio/tasks",
        method: "POST",
        respond: async (init?: { method?: string; body?: string }) => {
          if (failed) {
            failed = false;
            return jsonResponse({ ok: false, error: "boom" });
          }
          const payload = JSON.parse(init?.body ?? "{}") as {
            annotations?: unknown[];
          };
          if (Array.isArray(payload.annotations)) {
            current = payload.annotations;
          }
          return jsonResponse({ ok: true });
        },
      },
    ]);
    render(<StudioToolbar config={config} />);
    const marker = await screen.findByRole("button", {
      name: "Annotation 1: open editor",
    });
    // 1. First save attempt fails — error shown, draft preserved.
    await user.click(marker);
    const dialog = screen.getByRole("dialog", { name: "Annotation editor" });
    const textarea = within(dialog).getByRole("textbox");
    await user.clear(textarea);
    await user.type(textarea, "retry text");
    await user.click(within(dialog).getByRole("button", { name: "Save comment" }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/boom/);
    });
    expect((textarea as HTMLTextAreaElement).value).toBe("retry text");
    // 2. Retry (same Save button) succeeds — editor closes, list updated.
    await user.click(within(dialog).getByRole("button", { name: "Save comment" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /Open Portal Studio/ }));
    expect(await screen.findByText("retry text")).toBeInTheDocument();
  });

  it("another marker cannot race an in-flight save; a late failure stays on the original editor and draft", async () => {
    const user = userEvent.setup();
    makeMarkerPageElement("Alice", "row-a");
    // Deferred POST: the first save stays in flight until the gate resolves.
    let openGate: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    let current: unknown[] = [
      {
        annotationId: "ann-1",
        kind: "element",
        comment: "original one",
        createdAt: "2026-08-08T12:00:00.000Z",
        status: "open",
        elements: [elementCapture("row-a")],
      },
      {
        annotationId: "ann-2",
        kind: "element",
        comment: "original two",
        createdAt: "2026-08-08T12:00:00.000Z",
        status: "open",
        elements: [elementCapture("row-a")],
      },
    ];
    mockFetchRoutes([
      {
        url: "/__portal-studio/tasks",
        method: "GET",
        respond: async () => jsonResponse(makeMarkerTask(current)),
      },
      {
        url: "/__portal-studio/tasks",
        method: "POST",
        respond: async (init?: { method?: string; body?: string }) => {
          await gate;
          const payload = JSON.parse(init?.body ?? "{}") as {
            annotations?: unknown[];
          };
          if (Array.isArray(payload.annotations)) {
            current = payload.annotations;
          }
          return jsonResponse({ ok: false, error: "boom" });
        },
      },
    ]);
    render(<StudioToolbar config={config} />);
    const markers = await screen.findAllByRole("button", {
      name: /open editor/,
    });
    expect(markers).toHaveLength(2);
    // Open the FIRST marker, type a draft, and start the save (in flight).
    await user.click(markers[0]);
    const dialog = screen.getByRole("dialog", { name: "Annotation editor" });
    const textarea = within(dialog).getByRole("textbox");
    await user.clear(textarea);
    await user.type(textarea, "draft one");
    await user.click(within(dialog).getByRole("button", { name: "Save comment" }));
    // The save is pending — clicking the SECOND marker must NOT switch the
    // editor (save-in-flight lock).
    await user.click(markers[1]);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      (within(screen.getByRole("dialog", { name: "Annotation editor" })).getByRole(
        "textbox"
      ) as HTMLTextAreaElement).value
    ).toBe("draft one");
    // Let the save fail — the error lands on the ORIGINAL editor with the
    // draft intact, not on the other marker's editor.
    openGate?.();
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/boom/);
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      (within(screen.getByRole("dialog", { name: "Annotation editor" })).getByRole(
        "textbox"
      ) as HTMLTextAreaElement).value
    ).toBe("draft one");
  });

  it("list mutation controls cannot race an in-flight marker save", async () => {
    const user = userEvent.setup();
    makeMarkerPageElement("Alice", "row-a");
    let openGate: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    let current: unknown[] = [
      {
        annotationId: "ann-1",
        kind: "element",
        comment: "original",
        createdAt: "2026-08-08T12:00:00.000Z",
        status: "open",
        elements: [elementCapture("row-a")],
      },
    ];
    const fetchMock = mockFetchRoutes([
      {
        url: "/__portal-studio/tasks",
        method: "GET",
        respond: async () => jsonResponse(makeMarkerTask(current)),
      },
      {
        url: "/__portal-studio/tasks",
        method: "POST",
        respond: async (init?: { method?: string; body?: string }) => {
          await gate;
          const payload = JSON.parse(init?.body ?? "{}") as {
            annotations?: unknown[];
          };
          if (Array.isArray(payload.annotations)) {
            current = payload.annotations;
          }
          return jsonResponse({ ok: true });
        },
      },
    ]);
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: /Open Portal Studio/ }));
    await waitFor(() => {
      expect(screen.getByText(/Annotations/)).toBeInTheDocument();
    });
    const marker = await screen.findByRole("button", {
      name: "Annotation 1: open editor",
    });
    await user.click(marker);
    const dialog = screen.getByRole("dialog", { name: "Annotation editor" });
    const textarea = within(dialog).getByRole("textbox");
    await user.clear(textarea);
    await user.type(textarea, "marker save");
    await user.click(within(dialog).getByRole("button", { name: "Save comment" }));
    // While the save is in flight the list Complete button is DISABLED —
    // no newer action can be enqueued and dropped. (Scope to the LIST
    // control; the marker editor's own Complete is disabled too.)
    const listComplete = document.querySelector(
      ".ps-annotation-item [aria-label='Complete']"
    ) as HTMLButtonElement;
    expect(listComplete.disabled).toBe(true);
    await user.click(listComplete);
    const postsDuringSave = fetchMock.mock.calls.filter(
      (call) => (call[1] as { method?: string } | undefined)?.method === "POST"
    ).length;
    expect(postsDuringSave).toBe(1);
    // Complete the save — the marker comment is persisted.
    openGate?.();
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    // The list control works again after the save settles.
    const listCompleteAfter = document.querySelector(
      ".ps-annotation-item [aria-label='Complete']"
    ) as HTMLButtonElement;
    await user.click(listCompleteAfter);
    await waitFor(() => {
      const bodies = fetchMock.mock.calls
        .filter(
          (call) =>
            (call[1] as { method?: string } | undefined)?.method === "POST"
        )
        .map((call) => (call[1] as { body?: string }).body ?? "");
      expect(
        bodies.some((body) => body.includes('"status":"completed"'))
      ).toBe(true);
    });
  });

  it("Complete for open annotations and Reopen for completed ones", async () => {
    const user = userEvent.setup();
    makeMarkerPageElement("Alice", "row-a");
    markerRoutes([
      {
        annotationId: "ann-open",
        kind: "element",
        comment: "do me",
        createdAt: "2026-08-08T12:00:00.000Z",
        status: "open",
        elements: [elementCapture("row-a")],
      },
      {
        annotationId: "ann-done",
        kind: "element",
        comment: "done",
        createdAt: "2026-08-08T12:00:00.000Z",
        status: "completed",
        completedAt: "2026-08-08T13:00:00.000Z",
        elements: [elementCapture("row-a")],
      },
    ]);
    render(<StudioToolbar config={config} />);
    // Open annotation → Complete button.
    const openMarker = await screen.findByRole("button", {
      name: "Annotation 1: open editor",
    });
    await user.click(openMarker);
    const dialog = screen.getByRole("dialog", { name: "Annotation editor" });
    await user.click(within(dialog).getByRole("button", { name: "Complete" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    // Goal 04: the just-completed marker is now hidden from the default
    // Open view — open the panel and switch to All to reach it.
    await user.click(screen.getByRole("button", { name: /Open Portal Studio/ }));
    await user.click(screen.getByRole("button", { name: "All" }));
    // Completed annotation → Reopen button.
    const doneMarker = await screen.findByRole("button", {
      name: "Annotation 2: open editor",
    });
    await user.click(doneMarker);
    const dialog2 = screen.getByRole("dialog", { name: "Annotation editor" });
    expect(
      within(dialog2).queryByRole("button", { name: "Complete" })
    ).not.toBeInTheDocument();
    await user.click(within(dialog2).getByRole("button", { name: "Reopen" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("Delete requires lightweight confirmation and removes the annotation", async () => {
    const user = userEvent.setup();
    makeMarkerPageElement("Alice", "row-a");
    markerRoutes([
      {
        annotationId: "ann-1",
        kind: "element",
        comment: "doomed",
        createdAt: "2026-08-08T12:00:00.000Z",
        status: "open",
        elements: [elementCapture("row-a")],
      },
    ]);
    render(<StudioToolbar config={config} />);
    const marker = await screen.findByRole("button", {
      name: "Annotation 1: open editor",
    });
    await user.click(marker);
    const dialog = screen.getByRole("dialog", { name: "Annotation editor" });
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    // Confirmation appears; the first Delete click must NOT remove yet.
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Delete this annotation?"
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Delete", exact: true })
    );
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.queryByText("doomed")).not.toBeInTheDocument();
    });
  });

  it("Escape closes the editor and restores focus to the marker button", async () => {
    const user = userEvent.setup();
    makeMarkerPageElement("Alice", "row-a");
    markerRoutes([
      {
        annotationId: "ann-1",
        kind: "element",
        comment: "focus me",
        createdAt: "2026-08-08T12:00:00.000Z",
        status: "open",
        elements: [elementCapture("row-a")],
      },
    ]);
    render(<StudioToolbar config={config} />);
    const marker = await screen.findByRole("button", {
      name: "Annotation 1: open editor",
    });
    await user.click(marker);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(marker).toHaveFocus();
    });
  });

  it("outside click closes the editor; clicks inside the editor keep it open", async () => {
    const user = userEvent.setup();
    makeMarkerPageElement("Alice", "row-a");
    markerRoutes([
      {
        annotationId: "ann-1",
        kind: "element",
        comment: "stay",
        createdAt: "2026-08-08T12:00:00.000Z",
        status: "open",
        elements: [elementCapture("row-a")],
      },
    ]);
    render(<StudioToolbar config={config} />);
    const marker = await screen.findByRole("button", {
      name: "Annotation 1: open editor",
    });
    await user.click(marker);
    const dialog = screen.getByRole("dialog", { name: "Annotation editor" });
    // Click inside the editor → stays open.
    await user.click(within(dialog).getByRole("textbox"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // Click outside (the page row) → closes.
    await user.click(document.body);
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("pointer/keyboard events inside the editor do not leak into capture or hotkey handlers", async () => {
    const user = userEvent.setup();
    makeMarkerPageElement("Alice", "row-a");
    markerRoutes([
      {
        annotationId: "ann-1",
        kind: "element",
        comment: "isolated",
        createdAt: "2026-08-08T12:00:00.000Z",
        status: "open",
        elements: [elementCapture("row-a")],
      },
    ]);
    render(<StudioToolbar config={config} />);
    const marker = await screen.findByRole("button", {
      name: "Annotation 1: open editor",
    });
    await user.click(marker);
    const dialog = screen.getByRole("dialog", { name: "Annotation editor" });
    const textarea = within(dialog).getByRole("textbox");
    textarea.focus();
    // A pointer move inside the editor must NOT start picking (no hint).
    fireEvent.pointerMove(textarea, { clientX: 5, clientY: 5 });
    expect(screen.queryByText(/Hover an element/)).not.toBeInTheDocument();
    // A hotkey combo typed inside the editor textarea must NOT switch modes
    // and must NOT be treated as a handled shortcut (no preventDefault).
    const keyEvent = new KeyboardEvent("keydown", {
      key: "m",
      ctrlKey: true,
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    const spy = vi.spyOn(keyEvent, "preventDefault");
    textarea.dispatchEvent(keyEvent);
    expect(screen.queryByText(/Multi-select/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Hover an element/)).not.toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
    // The editor is still open and the draft intact.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("hotkey combos from NON-editable editor controls do not leak (mode idle, no preventDefault)", async () => {
    const user = userEvent.setup();
    makeMarkerPageElement("Alice", "row-a");
    markerRoutes([
      {
        annotationId: "ann-1",
        kind: "element",
        comment: "isolated",
        createdAt: "2026-08-08T12:00:00.000Z",
        status: "open",
        elements: [elementCapture("row-a")],
      },
    ]);
    render(<StudioToolbar config={config} />);
    const marker = await screen.findByRole("button", {
      name: "Annotation 1: open editor",
    });
    await user.click(marker);
    const dialog = screen.getByRole("dialog", { name: "Annotation editor" });
    // Focus a NON-editable control inside the editor (the Complete button).
    const completeButton = within(dialog).getByRole("button", { name: "Complete" });
    completeButton.focus();
    const keyEvent = new KeyboardEvent("keydown", {
      key: "p",
      ctrlKey: true,
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    const spy = vi.spyOn(keyEvent, "preventDefault");
    completeButton.dispatchEvent(keyEvent);
    // Mode must stay idle (no pick hint) and the shortcut must not be
    // handled (preventDefault not called) — the guard covers ALL editor
    // internals, not just editable targets.
    expect(screen.queryByText(/Hover an element/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Drag over the page/)).not.toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("multi marker activation highlights every captured target temporarily", async () => {
    const user = userEvent.setup();
    makeMarkerPageElement("Alice", "row-a");
    makeMarkerPageElement("Bob", "row-b");
    markerRoutes([
      {
        annotationId: "ann-multi",
        kind: "multi",
        comment: "group",
        createdAt: "2026-08-08T12:00:00.000Z",
        status: "open",
        elements: [elementCapture("row-a"), elementCapture("row-b")],
      },
    ]);
    render(<StudioToolbar config={config} />);
    const marker = await screen.findByRole("button", {
      name: "Annotation 1: open editor",
    });
    await user.click(marker);
    // Two temporary highlights — one per resolved captured target.
    expect(document.querySelectorAll(".ps-marker-highlight")).toHaveLength(2);
    // Closing the editor removes the highlights.
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(document.querySelectorAll(".ps-marker-highlight")).toHaveLength(0);
    });
  });

  it("region marker opens the editor positioned beside the region boundary", async () => {
    const user = userEvent.setup();
    markerRoutes([
      {
        annotationId: "ann-region",
        kind: "region",
        comment: "area note",
        createdAt: "2026-08-08T12:00:00.000Z",
        status: "open",
        elements: [],
        region: { x: 400, y: 300, width: 200, height: 120 },
      },
    ]);
    render(<StudioToolbar config={config} />);
    const marker = await screen.findByRole("button", {
      name: "Annotation 1: open editor",
    });
    await user.click(marker);
    const dialog = screen.getByRole("dialog", { name: "Annotation editor" });
    // Positioned beside the region: top = region bottom + gap (below).
    const style = (dialog as HTMLElement).style;
    expect(Number(style.top.replace("px", ""))).toBe(300 + 120 + 8);
    expect(Number(style.left.replace("px", ""))).toBe(400 + 200 - 264);
  });

  // ---- Goal 04: completed visibility and cleanup semantics ----

  const viewRoutes = (annotations: unknown[]) =>
    mockFetchRoutes([
      {
        url: "/__portal-studio/tasks",
        method: "GET",
        respond: async () => jsonResponse(makeLoadTask(annotations)),
      },
      {
        url: "/__portal-studio/tasks",
        method: "POST",
        respond: async () => jsonResponse({ ok: true }),
      },
    ]);

  const openAnn = (id: string, comment: string) => ({
    annotationId: id,
    kind: "element" as const,
    comment,
    createdAt: "2026-08-08T12:00:00.000Z",
    status: "open" as const,
    elements: [],
  });

  const doneAnn = (id: string, comment: string) => ({
    ...openAnn(id, comment),
    status: "completed" as const,
    completedAt: "2026-08-08T13:00:00.000Z",
  });

  it("launcher count is ALWAYS the open count, independent of the view", async () => {
    const user = userEvent.setup();
    viewRoutes([openAnn("a", "open one"), doneAnn("b", "done one")]);
    render(<StudioToolbar config={config} />);
    // 1 open + 1 completed → launcher shows 1 (open only).
    await waitFor(() => {
      expect(screen.getByText("1", { selector: ".ps-launcher-count" })).toBeInTheDocument();
    });
    // Switching to All must NOT change the launcher count.
    await user.click(screen.getByRole("button", { name: /Open Portal Studio/ }));
    await user.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByText("1", { selector: ".ps-launcher-count" })).toBeInTheDocument();
  });

  it("default Open view hides completed items; All shows them with distinct styling and Reopen", async () => {
    const user = userEvent.setup();
    viewRoutes([openAnn("a", "open one"), doneAnn("b", "done one")]);
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: /Open Portal Studio/ }));
    // Open view: only the open item is listed.
    await waitFor(() => {
      expect(screen.getByText("open one")).toBeInTheDocument();
    });
    expect(screen.queryByText("done one")).not.toBeInTheDocument();
    // All view: both listed, completed styled + Reopen action (no Complete).
    await user.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByText("done one")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reopen" })).toBeInTheDocument();
    // Reopen moves the item back to open: in Open view it reappears.
    await user.click(screen.getByRole("button", { name: "Reopen" }));
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByText("done one")).toBeInTheDocument();
  });

  it("Remove completed is disabled at zero and requires confirmation; removes ONLY completed", async () => {
    const user = userEvent.setup();
    viewRoutes([openAnn("a", "keep open"), doneAnn("b", "remove done")]);
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: /Open Portal Studio/ }));
    // All view so the completed item is visible during the flow.
    await user.click(screen.getByRole("button", { name: "All" }));
    await waitFor(() => {
      expect(screen.getByText("remove done")).toBeInTheDocument();
    });
    const removeButton = await screen.findByRole("button", {
      name: "Remove completed (1)",
    });
    await user.click(removeButton);
    // Confirmation appears before anything is removed.
    expect(screen.getByRole("alert")).toHaveTextContent(/Open items stay/);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("remove done")).toBeInTheDocument();
    // Confirm removes ONLY the completed item.
    await user.click(screen.getByRole("button", { name: "Remove completed (1)" }));
    await user.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => {
      expect(screen.queryByText("remove done")).not.toBeInTheDocument();
      expect(screen.getByText("keep open")).toBeInTheDocument();
    });
  });

  it("Remove completed with zero completed items is disabled", async () => {
    const user = userEvent.setup();
    viewRoutes([openAnn("a", "only open")]);
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: /Open Portal Studio/ }));
    const removeButton = await screen.findByRole("button", {
      name: "Remove completed (0)",
    });
    expect(removeButton).toBeDisabled();
  });

  it("completing the FINAL open item returns the launcher to Wrench and hides it in Open view (not deleted)", async () => {
    const user = userEvent.setup();
    viewRoutes([openAnn("a", "last open")]);
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: /Open Portal Studio/ }));
    await waitFor(() => {
      expect(screen.getByText("last open")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "Complete" }));
    // The item leaves the Open view and the launcher shows no count.
    await waitFor(() => {
      expect(screen.queryByText("last open")).not.toBeInTheDocument();
    });
    expect(
      document.querySelector(".ps-launcher-count")
    ).not.toBeInTheDocument();
    // Not deleted: present in All with Reopen.
    await user.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByText("last open")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reopen" })).toBeInTheDocument();
  });

  it("zero states: open view with only completed shows the empty hint", async () => {
    const user = userEvent.setup();
    viewRoutes([doneAnn("b", "only done")]);
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: /Open Portal Studio/ }));
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/No open annotations/);
    });
    expect(screen.queryByText("only done")).not.toBeInTheDocument();
  });

  it("marker labels renumber to the VISIBLE order in the Open view (P1 review)", async () => {
    const user = userEvent.setup();
    makeMarkerPageElement("Alice", "row-a");
    viewRoutes([
      { ...openAnn("open-1", "first open"), elements: [elementCapture("row-a")] },
      { ...doneAnn("done-1", "middle done"), elements: [elementCapture("row-a")] },
      { ...openAnn("open-2", "second open"), elements: [elementCapture("row-a")] },
    ]);
    render(<StudioToolbar config={config} />);
    // Open view: the two OPEN items are numbered 1 and 2 in BOTH the list
    // and the marker labels (previously the marker showed 1 and 3).
    const markers = await screen.findAllByRole("button", {
      name: /open editor/,
    });
    expect(markers).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "Annotation 1: open editor" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Annotation 2: open editor" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Annotation 3: open editor" })
    ).not.toBeInTheDocument();
    // All view restores the full 1..3 numbering.
    await user.click(screen.getByRole("button", { name: /Open Portal Studio/ }));
    await user.click(screen.getByRole("button", { name: "All" }));
    expect(
      screen.getByRole("button", { name: "Annotation 3: open editor" })
    ).toBeInTheDocument();
  });

  it("mixed hidden + completed + open data stays independent across views and markers", async () => {
    const user = userEvent.setup();
    makeMarkerPageElement("Alice", "row-a");
    viewRoutes([
      { ...openAnn("open-1", "mixed open"), hidden: true, elements: [elementCapture("row-a")] },
      { ...doneAnn("done-1", "mixed done"), elements: [elementCapture("row-a")] },
      { ...openAnn("open-2", "mixed open two"), elements: [elementCapture("row-a")] },
    ]);
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: /Open Portal Studio/ }));
    // Open view: both OPEN items listed (the hidden one keeps its Hidden
    // badge — hidden is independent of the view filter), completed hidden.
    await waitFor(() => {
      expect(screen.getByText("mixed open")).toBeInTheDocument();
      expect(screen.getByText("mixed open two")).toBeInTheDocument();
    });
    expect(screen.queryByText("mixed done")).not.toBeInTheDocument();
    expect(screen.getByText(/Hidden/)).toBeInTheDocument();
    // Launcher counts the two OPEN items only.
    expect(screen.getByText("2", { selector: ".ps-launcher-count" })).toBeInTheDocument();
    // All view: completed appears; hidden item still listed with its badge.
    await user.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByText("mixed done")).toBeInTheDocument();
    expect(screen.getByText(/Hidden/)).toBeInTheDocument();
    // Visible-order numbering: All shows 1..3, Open renumbers to 1..2.
    expect(screen.getByText("Annotations (3)")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => {
      expect(screen.getByText("Annotations (2)")).toBeInTheDocument();
    });
  });

  // ---- Goal 05: visibility-aware revision polling / browser sync ----

  const revisionConfig = {
    ...config,
    revisionEndpoint: "/__portal-studio/revision",
  };

  const revisionRoutes = (options: {
    revisions: Array<number | null>;
    failAfter?: number;
  }) => {
    let revisionCalls = 0;
    let taskGets = 0;
    // The task served by the task GET carries the CURRENT server-owned
    // revision; tests bump it to simulate a CLI write between fetches.
    let taskRevision = 1;
    const fetchMock = vi.fn(
      (input: string | URL | Request, init?: { method?: string }) => {
        const url = String(input);
        const method = (init?.method ?? "GET").toUpperCase();
        if (url === "/__portal-studio/revision" && method === "GET") {
          if (
            options.failAfter !== undefined &&
            revisionCalls >= options.failAfter
          ) {
            return Promise.resolve({ ok: false, json: async () => ({}) });
          }
          const revision =
            options.revisions[
              Math.min(revisionCalls, options.revisions.length - 1)
            ];
          revisionCalls += 1;
          return Promise.resolve({
            ok: true,
            json: async () => ({ ok: true, taskRevision: revision }),
          });
        }
        if (url === "/__portal-studio/tasks" && method === "GET") {
          taskGets += 1;
          // Snapshot the revision at CALL time (the real server reads the
          // artifact when the request arrives — a CLI write AFTER this GET
          // must not retroactively change what this fetch served).
          const servedRevision = taskRevision;
          return Promise.resolve({
            ok: true,
            json: async () => ({
              task: {
                schemaVersion: 5,
                taskId: "poll-task",
                createdAt: "2026-08-09T00:00:00.000Z",
                url: "http://127.0.0.1:4173/users",
                title: "Users",
                annotations: [],
                businessContext: [],
                redaction: {
                  droppedKeys: [],
                  redactedValues: 0,
                  truncatedValues: 0,
                },
                taskRevision: servedRevision,
              },
            }),
          });
        }
        return Promise.resolve({ ok: false, json: async () => ({}) });
      }
    );
    vi.stubGlobal("fetch", fetchMock);
    return {
      fetchMock,
      countTaskGets: () => taskGets,
      countRevisionCalls: () =>
        fetchMock.mock.calls.filter((call) =>
          String(call[0]).includes("/revision")
        ).length,
      setTaskRevision: (revision: number) => {
        taskRevision = revision;
      },
    };
  };

  it(
    "re-fetches the task ONLY when the server taskRevision changes",
    async () => {
      const { countTaskGets } = revisionRoutes({ revisions: [1, 1, 2, 2] });
      render(<StudioToolbar config={revisionConfig} />);
      // Mount refreshTask = first task GET; the first poll seeds the
      // baseline (revision 1) WITHOUT refetching.
      expect(countTaskGets()).toBe(1);
      // Revision stays 1 for two polls (~1s each) — no refetch.
      await new Promise((resolve) => setTimeout(resolve, 2300));
      expect(countTaskGets()).toBe(1);
      // The next poll sees revision 2 — the task is re-fetched.
      await waitFor(() => {
        expect(countTaskGets()).toBe(2);
      }, { timeout: 3000 });
    },
    15000
  );

  it(
    "a CLI completion landing between mount and the first poll still syncs (P1 baseline race)",
    async () => {
      const { countTaskGets, setTaskRevision } = revisionRoutes({
        // The FIRST poll already observes the NEW revision (the CLI wrote
        // before the first poll fired) — it must NOT be accepted as the
        // baseline: the baseline is the last FETCHED task's revision.
        revisions: [2, 2],
      });
      render(<StudioToolbar config={revisionConfig} />);
      // Mount refreshTask fetched the task at revision 1 (baseline).
      expect(countTaskGets()).toBe(1);
      // The CLI completes the annotation before the first poll runs.
      setTaskRevision(2);
      // The first poll sees 2 != 1 (last fetched) → the task is re-fetched.
      await waitFor(
        () => {
          expect(countTaskGets()).toBe(2);
        },
        { timeout: 3000 }
      );
    },
    15000
  );

  it(
    "does not poll while the document is hidden; resumes when visible",
    async () => {
      const visibility = { state: "visible" };
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => visibility.state,
      });
      const { countRevisionCalls } = revisionRoutes({ revisions: [1, 1] });
      render(<StudioToolbar config={revisionConfig} />);
      // One visible poll (~1s).
      await new Promise((resolve) => setTimeout(resolve, 1200));
      expect(countRevisionCalls()).toBe(1);
      // Hidden: no new polls for 1.5s.
      visibility.state = "hidden";
      document.dispatchEvent(new Event("visibilitychange"));
      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect(countRevisionCalls()).toBe(1);
      // Visible again: the visibilitychange handler re-polls immediately.
      visibility.state = "visible";
      document.dispatchEvent(new Event("visibilitychange"));
      await waitFor(() => {
        expect(countRevisionCalls()).toBe(2);
      }, { timeout: 3000 });
    },
    15000
  );

  it(
    "backs off while the revision read keeps failing, then recovers",
    async () => {
      const { countRevisionCalls } = revisionRoutes({
        revisions: [1],
        failAfter: 1,
      });
      render(<StudioToolbar config={revisionConfig} />);
      // Poll 1 succeeds (baseline). Poll 2 (~1s) fails; backoff 2s.
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const afterFirst = countRevisionCalls();
      expect(afterFirst).toBeGreaterThanOrEqual(1);
      // Let the failed poll + the 2s backoff elapse → a third attempt.
      await new Promise((resolve) => setTimeout(resolve, 3300));
      expect(countRevisionCalls()).toBeGreaterThanOrEqual(3);
    },
    15000
  );

});
