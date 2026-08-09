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

  const pageWait = (count: number) =>
    new Promise<void>((resolve) => {
      const check = () => {
        const posts = (globalThis.fetch as unknown as ReturnType<
          typeof vi.fn
        >)?.mock?.calls?.filter(
          (call: unknown[]) =>
            (call[1] as { method?: string } | undefined)?.method === "POST"
        );
        if (!posts || posts.length > count) resolve();
        else setTimeout(check, 20);
      };
      check();
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
    // Distinct completed rendering.
    await waitFor(() => {
      expect(screen.getByText("Completed")).toBeInTheDocument();
    });
    // Second click must NOT double-stamp (status stays completed).
    const postsAfterFirst = fetchMock.mock.calls.filter(
      (call) => (call[1] as { method?: string } | undefined)?.method === "POST"
    ).length;
    await user.click(screen.getByRole("button", { name: "Complete" }));
    await pageWait(postsAfterFirst);
    const completedPayloads = fetchMock.mock.calls
      .filter(
        (call) =>
          (call[1] as { method?: string } | undefined)?.method === "POST"
      )
      .map((call) => JSON.parse((call[1] as { body: string }).body));
    expect(
      completedPayloads.some(
        (payload) =>
          (payload.annotations as { completedAt?: string }[])[0].completedAt !==
          undefined
      )
    ).toBe(true);
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

});
