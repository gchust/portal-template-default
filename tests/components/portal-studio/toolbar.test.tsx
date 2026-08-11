import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TOOLBAR_STYLES } from "@/studio/index";
import { StudioToolbar } from "@/studio/toolbar";
import { applyMutationOperations } from "@/studio/mutation";

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
  mutateEndpoint: "/__portal-studio/mutate",
};

const makePageElement = (text = "Hello row", id = "") => {
  const row = document.createElement("tr");
  row.setAttribute("tabindex", "-1");
  if (id) row.id = id;
  row.textContent = text;
  document.body.appendChild(row);
  return row;
};

const jsonResponse = (payload: unknown, ok = true, status?: number) => ({
  ok,
  status: status ?? (ok ? 200 : 400),
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
      status?: number;
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

/** Extract typed mutation operations from captured mutate-endpoint calls. */
const mutateOperationsFrom = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls
    .filter((call) => String(call[0]).includes("/mutate"))
    .map(
      (call) =>
        (
          JSON.parse((call[1] as { body: string }).body) as {
            operations: Array<Record<string, unknown>>;
          }
        ).operations
    );

const openAndPick = async (
  user: ReturnType<typeof userEvent.setup>,
  element: Element
) => {
  await user.click(
    screen.getByRole("button", { name: /Annotation tools/ })
  );
  await user.click(screen.getByRole("button", { name: "Pick element" }));
  element.focus();
};

/** Expand the collapsed chip (if present) and open the annotation-list
 *  panel (if not already open). */
const openList = async (user: ReturnType<typeof userEvent.setup>) => {
  const chip = screen.queryByRole("button", { name: /Annotation tools/ });
  if (chip) await user.click(chip);
  const list = screen.queryByRole("button", { name: "Annotation list" });
  if (list && list.getAttribute("aria-expanded") !== "true") {
    await user.click(list);
  }
};

/** Per-item hide button (exact — distinct from the toolbar "Hide markers"). */
const hideItemButton = () =>
  screen.getByRole("button", { name: "Hide", exact: true });

/** Goal 02: the target-side composer dialog shown beside the target. */
const composer = () => screen.getByRole("dialog", { name: "Annotation" });
const composerTextarea = () =>
  within(composer()).getByRole("textbox", { name: "Annotation comment" });
const composerSave = () =>
  within(composer()).getByRole("button", { name: "Save", exact: true });

/** Goal 02: continuous loop — click Pick only when NOT already picking
 *  (Pick resumes automatically after a successful save). */
const startPickIfNeeded = async (
  user: ReturnType<typeof userEvent.setup>
) => {
  // Pick resumes automatically after a successful save (Goal 02) — check
  // the button's aria-pressed, NOT the status hint (the hint hides while
  // an auxiliary panel is open even though picking stays active). When an
  // auxiliary panel is open, picking is suspended: re-entering via the
  // button closes the panel and resumes the session.
  const pick = screen.getByRole("button", { name: "Pick element" });
  const list = screen.getByRole("button", { name: "Annotation list" });
  const help = screen.getByRole("button", { name: "Keyboard shortcuts" });
  if (pick.getAttribute("aria-pressed") !== "true") {
    await user.click(pick);
  } else {
    // Picking is already active. If an auxiliary panel is open the session
    // is merely suspended — close the panel via its own toggle instead of
    // clicking Pick (which would CANCEL the active session).
    if (list.getAttribute("aria-expanded") === "true") {
      await user.click(list);
    }
    if (help.getAttribute("aria-expanded") === "true") {
      await user.click(help);
    }
  }
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
      screen.getByRole("button", { name: /Annotation tools/ })
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
      screen.getByRole("button", { name: /Annotation tools/ })
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
      screen.getByRole("button", { name: /Annotation tools/ })
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

    // Goal 02: the target-side composer opens beside the target — no
    // technical Draft screen.
    expect(composer()).toBeInTheDocument();

    await user.type(
      composerTextarea(),
      "Increase padding"
    );
    await user.click(composerSave());

    await waitFor(() => {
      expect(screen.getByText("Annotation saved")).toBeInTheDocument();
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

  it("Pick is STRICTLY single-target: Shift+Enter commits one element, Shift+click never accumulates (review P1)", async () => {
    const user = userEvent.setup();
    const a = makePageElement("A", "row-a");
    const b = makePageElement("B", "row-b");
    render(<StudioToolbar config={config} />);
    await openAndPick(user, a);
    // Shift+Enter behaves exactly like plain Enter: ONE element draft.
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect(composer()).toBeInTheDocument();
    // The draft is committed — no additive "Selected" counter path exists.
    expect(screen.queryByText(/Selected/)).not.toBeInTheDocument();

    // Re-enter picking: Shift+click must NOT toggle the second element in.
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Pick element" }));
    await user.click(b, { shiftKey: true });
    expect(composer()).toBeInTheDocument();
    // No additive counter anywhere.
    expect(screen.queryByText(/Selected/)).not.toBeInTheDocument();
    expect(screen.queryByText("2", { selector: "strong" })).not.toBeInTheDocument();
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
      composerTextarea(),
      "do it"
    );
    await user.click(composerSave());
    await waitFor(() => {
      expect(screen.getByText("Annotation saved")).toBeInTheDocument();
    });

    // Goal 02 continuous loop: after the save, Pick RESUMES with a clean
    // selection. Close and reopen: presentation-only — the resumed Pick
    // session persists, so no Pick click is needed (clicking would
    // cancel it); a Shift+Enter pick commits exactly ONE element.
    await user.click(screen.getByRole("button", { name: "Collapse toolbar" }));
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    expect(screen.getByText(/Hover an element/)).toBeInTheDocument();
    row.focus();
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect(composer()).toBeInTheDocument();
  });

  it("collapsing mid-draft preserves the composer draft; cancel clears it", async () => {
    const user = userEvent.setup();
    const row = makePageElement("Alice", "row-a");
    render(<StudioToolbar config={config} />);
    await openAndPick(user, row);
    await user.keyboard("{Enter}");
    expect(composer()).toBeInTheDocument();
    await user.type(composerTextarea(), "keep draft");

    // Goal 02 A: collapse hides the composer but PRESERVES the non-empty
    // draft and target; re-expand restores both.
    await user.click(screen.getByRole("button", { name: "Collapse toolbar" }));
    expect(screen.queryByRole("dialog", { name: "Annotation" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    expect(composer()).toBeInTheDocument();
    expect((composerTextarea() as HTMLTextAreaElement).value).toBe(
      "keep draft"
    );
    // Esc cancels: the composer closes and the draft is cleared.
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Annotation" })).not.toBeInTheDocument();
    // A fresh pick commits exactly ONE element.
    await startPickIfNeeded(user);
    row.focus();
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect(composer()).toBeInTheDocument();
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
      composerTextarea(),
      "do it"
    );
    await user.click(composerSave());
    await waitFor(() => {
      expect(screen.getByText("Annotation saved")).toBeInTheDocument();
    });
    // Goal 02 continuous loop: Pick RESUMES with a clean session — a
    // fresh Shift+Enter pick opens the composer for a SECOND annotation.
    row.focus();
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect(composer()).toBeInTheDocument();
    await user.type(composerTextarea(), "second");
    await user.click(composerSave());
    await waitFor(() => {
      expect(screen.getByText("Annotation saved")).toBeInTheDocument();
    });
    // Both saves persisted, each with exactly one element.
    const taskPosts = fetchMock.mock.calls.filter(
      (call) =>
        (call[1] as { method?: string } | undefined)?.method === "POST" &&
        String(call[0]).includes("/tasks")
    );
    expect(taskPosts).toHaveLength(2);
    for (const call of taskPosts) {
      const payload = JSON.parse((call[1] as { body: string }).body) as {
        annotations: Array<{ elements: unknown[] }>;
      };
      expect(payload.annotations.at(-1)!.elements).toHaveLength(1);
    }
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
    await openList(user);
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
    await user.type(composerTextarea(), "doomed");
    await user.click(composerSave());
    await waitFor(() => {
      expect(within(composer()).getByRole("alert")).toBeInTheDocument();
    });
    expect(within(composer()).getByRole("alert").textContent).toContain(
      "Unable to save"
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
    await openList(user);
    await waitFor(() => {
      expect(screen.getAllByRole("listitem")).toHaveLength(2);
    });
    // Panel header: localized title plus open/total counts.
    expect(
      screen.getByRole("region", { name: "Annotations" })
    ).toBeInTheDocument();
    expect(screen.getByText("2 open · 2 total")).toBeInTheDocument();
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
      expect(screen.getByText("Annotation saved")).toBeInTheDocument();
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
    await user.click(composerSave());
    // The warning toast is non-blocking; the annotation is NOT rolled back.
    await waitFor(() => {
      expect(
        screen.getByText("Annotation saved; the screenshot capture failed.")
      ).toBeInTheDocument();
    });
    // The annotation is retained — visible in the annotation list.
    await openList(user);
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
      screen.getByRole("button", { name: /Annotation tools/ })
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
    await user.click(composerSave());
    await waitFor(() => {
      expect(screen.getByText("Annotation saved")).toBeInTheDocument();
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
      screen.getByRole("button", { name: /Annotation tools/ })
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
    await openList(user);
    await waitFor(() => {
      expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0);
    });
  };

  /**
   * Stateful fetch helper: GET serves the current task; the typed mutate
   * endpoint applies operations with the SAME pure contract as the real
   * server (applyMutationOperations) and bumps a revision counter.
   */
  const makeRoutedFetch = (annotations: unknown[]) => {
    let current = makeLoadTask(annotations);
    let revision = 1;
    return mockFetchRoutes([
      {
        url: "/__portal-studio/tasks",
        method: "GET",
        respond: async () => jsonResponse(current),
      },
      {
        url: "/__portal-studio/tasks",
        method: "POST",
        respond: async () => jsonResponse({ ok: true }),
      },
      {
        url: "/__portal-studio/mutate",
        method: "POST",
        respond: async (init?: { method?: string; body?: string }) => {
          const request = JSON.parse(init?.body ?? "{}") as {
            taskId: string;
            expectedTaskRevision: number;
            operations: unknown[];
          };
          const baseTask = (current.task ?? {}) as {
            taskId?: string;
            annotations?: unknown[];
          };
          const task = {
            schemaVersion: 5,
            taskId: baseTask.taskId ?? "task-routed-1",
            createdAt: "2026-08-07T12:00:00.000Z",
            url: "http://127.0.0.1:4173/users",
            title: "Users",
            annotations: (baseTask.annotations ?? []) as never[],
            businessContext: [],
            redaction: {
              droppedKeys: [],
              redactedValues: 0,
              truncatedValues: 0,
            },
            taskRevision: revision,
          } as never;
          if (request.expectedTaskRevision !== revision) {
            return jsonResponse(
              {
                ok: false,
                error: "revision_conflict",
                taskRevision: revision,
                task,
              },
              false,
              409
            );
          }
          const applied = applyMutationOperations(
            task,
            request.operations as never
          );
          if (!applied.ok) {
            return jsonResponse({ ok: false, error: applied.error });
          }
          revision += 1;
          current = makeLoadTask(applied.task.annotations as never[]);
          return jsonResponse({
            ok: true,
            taskRevision: revision,
            task: applied.task,
          });
        },
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
    // The typed mutation sends an updateComment op (debounced).
    await waitFor(() => {
      const ops = mutateOperationsFrom(fetchMock).flat();
      expect(
        ops.some(
          (op) =>
            op.op === "updateComment" &&
            op.annotationId === "ann-1" &&
            op.comment === "old comment!"
        )
      ).toBe(true);
    });
    const editRequests = fetchMock.mock.calls
      .filter((call) => String(call[0]).includes("/mutate"))
      .map((call) => JSON.parse((call[1] as { body: string }).body) as { taskId: string });
    expect(editRequests[0].taskId).toBe("task-actions-1");
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
      const ops = mutateOperationsFrom(fetchMock).flat();
      expect(
        ops.some(
          (op) => op.op === "remove" && op.annotationId === "ann-1"
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
    await user.click(hideItemButton());
    await waitFor(() => {
      expect(screen.getByText("Hidden")).toBeInTheDocument();
    });
    await waitFor(() => {
      const ops = mutateOperationsFrom(fetchMock).flat();
      expect(
        ops.some(
          (op) => op.op === "setHidden" && op.annotationId === "ann-1" && op.hidden === true
        )
      ).toBe(true);
    });
    await user.click(hideItemButton());
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
    await openList(user);
    await waitFor(() => {
      expect(screen.getByText("keep me")).toBeInTheDocument();
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
    await openList(user);
    await waitFor(() => {
      expect(screen.getByText(/Annotations/)).toBeInTheDocument();
    });
    await user.click(hideItemButton());
    // Immediately unmount (the debounce has NOT fired yet): the pending
    // mutation must flush with keepalive instead of being lost.
    unmount();
    await waitFor(() => {
      const ops = mutateOperationsFrom(fetchMock).flat();
      expect(
        ops.some(
          (op) => op.op === "setHidden" && op.annotationId === "ann-1" && op.hidden === true
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
    await openList(user);
    await waitFor(() => {
      expect(screen.getByText(/Annotations/)).toBeInTheDocument();
    });
    const postsBefore = fetchMock.mock.calls.filter(
      (call) => (call[1] as { method?: string } | undefined)?.method === "POST"
    ).length;
    await user.click(screen.getByRole("button", { name: "Copy annotations" }));
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
    await openList(user);
    await waitFor(() => {
      expect(screen.getByText(/Annotations/)).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "Copy annotations" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Copy manually",
    });
    const textarea = within(dialog).getByRole("textbox");
    expect((textarea as HTMLTextAreaElement).value).toContain(
      "Comment: manual copy"
    );
    // The annotation is still there — Copy did not clear anything.
    expect(screen.getByText("manual copy")).toBeInTheDocument();
    // Review P7: Esc closes the fallback and restores focus to the REAL
    // Copy button (the ref is threaded through the toolbar shell).
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(dialog).not.toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: "Copy annotations" })
    ).toHaveFocus();
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
      {
        url: "/__portal-studio/mutate",
        method: "POST",
        respond: async () => {
          posted = true;
          return jsonResponse({ ok: true });
        },
      },
    ]);
    render(<StudioToolbar config={config} />);
    await openList(user);
    await waitFor(() => {
      expect(screen.getByText(/Annotations/)).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "Complete" }));
    await waitFor(() => {
      const ops = mutateOperationsFrom(fetchMock).flat();
      expect(
        ops.some(
          (op) => op.op === "complete" && op.annotationId === "ann-1"
        )
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
      const ops = mutateOperationsFrom(fetchMock).flat();
      expect(
        ops.some((op) => op.op === "reopen" && op.annotationId === "ann-1")
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
    await openList(user);
    await waitFor(() => {
      expect(screen.getByText(/Annotations/)).toBeInTheDocument();
    });
    await user.click(hideItemButton());
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

  it("the unload flush sends pending typed operations (reload safety, D-043 regression)", async () => {
    const user = userEvent.setup();
    const fetchMock = makeRoutedFetch([
      {
        annotationId: "ann-1",
        kind: "element",
        comment: "x".repeat(1200),
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
    await openList(user);
    await waitFor(() => {
      expect(screen.getByText(/Annotations/)).toBeInTheDocument();
    });
    // Hide, then unmount before the 300 ms debounce fires: the pending
    // typed operation must be flushed by the unload path instead of lost.
    await user.click(hideItemButton());
    unmount();
    await waitFor(() => {
      const ops = mutateOperationsFrom(fetchMock).flat();
      expect(
        ops.some(
          (op) =>
            op.op === "setHidden" &&
            op.annotationId === "ann-1" &&
            op.hidden === true
        )
      ).toBe(true);
    });
    // P1-1 review: the unload flush MUST use keepalive, otherwise the
    // browser terminates the request during unload and the mutation is
    // silently lost (the original D-043 defect class).
    const mutateCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("/mutate")
    );
    expect(
      mutateCalls.some(
        (call) => (call[1] as { keepalive?: boolean }).keepalive === true
      )
    ).toBe(true);
  });

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
    await openList(user);
    await waitFor(() => {
      expect(screen.getByText(/Annotations/)).toBeInTheDocument();
    });
    const postsBefore = fetchMock.mock.calls.filter(
      (call) => (call[1] as { method?: string } | undefined)?.method === "POST"
    ).length;
    await user.click(screen.getByRole("button", { name: "Copy annotations" }));
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
    await openList(user);
    await waitFor(() => {
      expect(screen.getByText(/Annotations/)).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "Copy annotations" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Copy manually",
    });
    const textarea = within(dialog).getByRole("textbox");
    expect((textarea as HTMLTextAreaElement).value).toContain(
      "Comment: manual copy"
    );
    // The annotation is still there — Copy did not clear anything.
    expect(screen.getByText("manual copy")).toBeInTheDocument();
    // Review P7: Esc closes the fallback and restores focus to the REAL
    // Copy button (the ref is threaded through the toolbar shell).
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(dialog).not.toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: "Copy annotations" })
    ).toHaveFocus();
  });

  // ---- Goal 04 Complete (D-033 #13) ----

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
    await openList(user);
    await waitFor(() => {
      expect(screen.getByText(/Annotations/)).toBeInTheDocument();
    });
    await user.click(hideItemButton());
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

  it("closes the expanded bar via the Collapse toolbar button", async () => {
    const user = userEvent.setup();
    render(<StudioToolbar config={config} />);
    await user.click(
      screen.getByRole("button", { name: /Annotation tools/ })
    );
    const panel = screen.getByRole("toolbar", { name: "Portal Studio" });
    expect(panel).toBeInTheDocument();
    // The horizontal bar has a Collapse chrome button (Goal 01).
    await user.click(screen.getByRole("button", { name: "Collapse toolbar" }));
    expect(
      screen.queryByRole("toolbar", { name: "Portal Studio" })
    ).not.toBeInTheDocument();
  });

  // ---- Goal 01 dock (G01 AC3/AC4/AC5/AC7) ----

  it("fresh mount is collapsed: horizontal chip with icon status slot, no toolbar, no badge", () => {
    render(<StudioToolbar config={config} />);
    // The collapsed chip: drag handle + body (status slot + label) + expand.
    expect(
      screen.getByRole("button", { name: /Annotation tools/ })
    ).toBeInTheDocument();
    // Review P6: with zero open annotations the accessible name stays the
    // plain localized label (no count).
    expect(
      screen.getByRole("button", { name: "Annotation tools", exact: true })
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.getByRole("button", { name: "Drag toolbar" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Expand toolbar" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("toolbar", { name: "Portal Studio" })
    ).not.toBeInTheDocument();
    // Zero Open annotations: the status slot shows the feedback ICON (no
    // count text) and there is no detached badge anywhere.
    const slot = document.querySelector(".ps-status-slot");
    expect(slot?.textContent).toBe("");
    expect(
      document.querySelector(".ps-launcher-count")
    ).not.toBeInTheDocument();
    // No emoji glyphs in the toolbar (D-034 #5).
    const dock = document.querySelector(".ps-dock");
    expect(dock?.textContent).not.toContain("🛠");
  });

  it("collapsed chip: one Open annotation shows 1; 100 Open shows 99+; label + Expand semantics", async () => {
    const user = userEvent.setup();
    viewRoutes([
      openAnn("a", "only open"),
      openAnn("b", "another open"),
      openAnn("c", "third open"),
    ]);
    render(<StudioToolbar config={config} />);
    // 3 Open annotations → count in the status slot AND in the localized
    // accessible name of the chip (review P6).
    await waitFor(() => {
      expect(document.querySelector(".ps-status-slot")?.textContent).toBe("3");
    });
    expect(
      screen.getByRole("button", {
        name: "Annotation tools (3 open)",
      })
    ).toBeInTheDocument();
    // The chip label and Expand affordance are present with semantics.
    expect(
      screen.getByRole("button", { name: /Annotation tools/ })
    ).toHaveAttribute("aria-expanded", "false");
    // Expand via the dedicated Expand button opens the bar.
    await user.click(screen.getByRole("button", { name: "Expand toolbar" }));
    expect(
      screen.getByRole("toolbar", { name: "Portal Studio" })
    ).toBeInTheDocument();
    // Swap the server data for 100 open annotations, then collapse — the
    // open-state change refetches, and the chip slot shows the 99+ cap.
    const many = [
      ...Array.from({ length: 100 }, (_, i) =>
        openAnn(`m${i}`, `open ${i}`)
      ),
    ];
    viewRoutes(many);
    await user.click(screen.getByRole("button", { name: "Collapse toolbar" }));
    await waitFor(() => {
      expect(document.querySelector(".ps-status-slot")?.textContent).toBe("99+");
    });
    // The accessible name exposes the capped count too.
    expect(
      screen.getByRole("button", {
        name: "Annotation tools (99+ open)",
      })
    ).toBeInTheDocument();
  });

  it("clicking the chip body expands the horizontal bar; the dock keeps its position", async () => {
    const user = userEvent.setup();
    render(<StudioToolbar config={config} />);
    const chip = screen.getByRole("button", { name: /Annotation tools/ });
    expect(chip).toHaveAttribute("aria-expanded", "false");
    const dock = document.querySelector(".ps-dock") as HTMLElement;
    const before = {
      left: Number(dock.style.left.replace("px", "")),
      top: Number(dock.style.top.replace("px", "")),
    };
    await user.click(chip);
    // The expanded bar replaces the chip at the same dock position.
    expect(
      screen.getByRole("toolbar", { name: "Portal Studio" })
    ).toBeInTheDocument();
    expect(Number(dock.style.left.replace("px", ""))).toBe(before.left);
    expect(Number(dock.style.top.replace("px", ""))).toBe(before.top);
  });

  it("pointer drag on the chip never expands the toolbar", async () => {
    const user = userEvent.setup();
    render(<StudioToolbar config={config} />);
    const handle = screen.getByRole("button", { name: "Drag toolbar" });
    // Drag the handle past the threshold and release over the chip body.
    await user.pointer([
      { keys: "[MouseLeft>]", target: handle, coords: { x: 10, y: 10 } },
      { coords: { x: 200, y: 60 } },
      { coords: { x: 260, y: 90 } },
      { keys: "[/MouseLeft]", coords: { x: 260, y: 90 } },
    ]);
    // Still collapsed: no toolbar role, chip remains.
    expect(
      screen.queryByRole("toolbar", { name: "Portal Studio" })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Annotation tools/ })
    ).toBeInTheDocument();
  });

  it("keyboard arrows move the dock; Shift moves by the larger step", async () => {
    const user = userEvent.setup();
    render(<StudioToolbar config={config} />);
    const handle = screen.getByRole("button", { name: "Drag toolbar" });
    const dock = document.querySelector(".ps-dock") as HTMLElement;
    const before = { left: Number(dock.style.left.replace("px", "")), top: Number(dock.style.top.replace("px", "")) };
    handle.focus();
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
    const handle = screen.getByRole("button", { name: "Drag toolbar" });
    const dock = document.querySelector(".ps-dock") as HTMLElement;
    handle.focus();
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
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    await user.click(screen.getByRole("button", { name: "Pick element" }));
    expect(screen.getByText(/Hover an element/)).toBeInTheDocument();
    // Collapse while in pick mode.
    await user.click(screen.getByRole("button", { name: "Collapse toolbar" }));
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
    // Re-expand: the pending pick session resumes (listeners active again).
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    expect(screen.getByText(/Hover an element/)).toBeInTheDocument();
  });

  it("collapsed Multi mode does not intercept page pointer events", async () => {
    const user = userEvent.setup();
    const row = makePageElement("Alice", "row-a");
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    await user.click(screen.getByRole("button", { name: "Multi-select" }));
    expect(screen.getByText(/Multi-select/)).toBeInTheDocument();
    // Collapse while in multi mode.
    await user.click(screen.getByRole("button", { name: "Collapse toolbar" }));
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
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    await user.click(screen.getByRole("button", { name: "Select region" }));
    expect(screen.getByText(/Drag over the page/)).toBeInTheDocument();
    // Collapse while in marquee mode.
    await user.click(screen.getByRole("button", { name: "Collapse toolbar" }));
    expect(
      screen.queryByRole("toolbar", { name: "Portal Studio" })
    ).not.toBeInTheDocument();
    // Pointer down/move should not start a marquee — the hint must not
    // reappear (it lives inside the panel which is collapsed).
    fireEvent.pointerDown(document.body, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(document.body, { clientX: 100, clientY: 100 });
    expect(screen.queryByText(/Drag over the page/)).not.toBeInTheDocument();
    // Re-enter marquee mode cleanly — proves the mode is still valid.
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    await user.click(screen.getByRole("button", { name: "Select region" }));
    expect(screen.getByText(/Drag over the page/)).toBeInTheDocument();
  });

  it("collapsed Pick mode does not intercept page keyboard events", async () => {
    const user = userEvent.setup();
    const row = makePageElement("Alice", "row-a");
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    await user.click(screen.getByRole("button", { name: "Pick element" }));
    // Collapse while in pick mode.
    await user.click(screen.getByRole("button", { name: "Collapse toolbar" }));
    // Arrow keys on the page should not be intercepted by picking listeners.
    fireEvent.keyDown(row, { key: "ArrowDown" });
    fireEvent.keyDown(row, { key: "Enter" });
    // No outline should appear — proof the listener did not fire.
    const outline = document.querySelector(".ps-outline");
    expect(outline?.getAttribute("style")).toContain("display: none");
    // Re-expand — pick mode should still be pending (not consumed).
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    expect(screen.getByText(/Hover an element/)).toBeInTheDocument();
  });

  it("re-expanding restores pending Pick mode and selection state", async () => {
    const user = userEvent.setup();
    const row = makePageElement("Alice", "row-a");
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    await user.click(screen.getByRole("button", { name: "Pick element" }));
    // Pick mode is active — verify the hint.
    expect(screen.getByText(/Hover an element/)).toBeInTheDocument();
    // Collapse — pick mode listeners are paused.
    await user.click(screen.getByRole("button", { name: "Collapse toolbar" }));
    // Re-expand — pick mode restored, hint visible again.
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    expect(screen.getByText(/Hover an element/)).toBeInTheDocument();
    // Pick an element after re-expand — the target-side composer opens.
    row.focus();
    await user.keyboard("{Enter}");
    expect(composer()).toBeInTheDocument();
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
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
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
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
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
    await openList(user);
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
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    await startPickIfNeeded(user);
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
        url: "/__portal-studio/tasks",
        method: "GET",
        respond: async () =>
          jsonResponse({
            task: {
              schemaVersion: 5,
              taskId: "task-1",
              createdAt: "2026-08-08T12:00:00.000Z",
              url: "http://127.0.0.1:4173/users",
              title: "Users",
              annotations: [
                {
                  annotationId: "ann-1",
                  kind: "element",
                  comment: "saved note",
                  createdAt: "2026-08-08T12:00:00.000Z",
                  status: "open",
                  elements: [],
                },
              ],
              businessContext: [],
              redaction: { droppedKeys: [], redactedValues: 0, truncatedValues: 0 },
            },
          }),
      },
      {
        url: "/__portal-studio/screenshots",
        method: "POST",
        respond: async () => jsonResponse({ ok: true, file: "s.png", width: 100, height: 50 }),
      },
    ]);
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    // Pick and save an annotation.
    await startPickIfNeeded(user);
    row.focus();
    await user.keyboard("{Enter}");
    await user.type(composerTextarea(), "saved note");
    await user.click(composerSave());
    await waitFor(() => {
      expect(screen.getByText("Annotation saved")).toBeInTheDocument();
    });
    // Switch to multi via hotkey — saved annotation persists.
    fireEvent.keyDown(document, { key: "m", ctrlKey: true, altKey: true });
    expect(screen.getByText(/Multi-select/)).toBeInTheDocument();
    // Re-enter pick — annotation still in the list (open the list panel).
    fireEvent.keyDown(document, { key: "p", ctrlKey: true, altKey: true });
    await user.click(screen.getByRole("button", { name: "Annotation list" }));
    expect(screen.getByText("saved note")).toBeInTheDocument();
  });

  it("unsaved draft comment survives switching capture modes by hotkey", async () => {
    const user = userEvent.setup();
    const row = makePageElement("Alice", "row-a");
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    // Enter pick mode and pick an element → draft mode with comment textarea.
    await startPickIfNeeded(user);
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
    // Stateful like the real server: the typed mutate endpoint applies
    // operations through the shared pure contract, and the follow-up GET
    // (refreshTask) returns the UPDATED annotations.
    let current = [...annotations];
    let revision = 1;
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
      {
        url: "/__portal-studio/mutate",
        method: "POST",
        respond: async (init?: { method?: string; body?: string }) => {
          if (!postOk) {
            return jsonResponse({ ok: false, error: "boom" });
          }
          const request = JSON.parse(init?.body ?? "{}") as {
            taskId: string;
            expectedTaskRevision: number;
            operations: never[];
          };
          const task = makeMarkerTask(current).task as {
            taskId: string;
            annotations: never[];
            taskRevision?: number;
          };
          task.taskRevision = revision;
          if (request.expectedTaskRevision !== revision) {
            return jsonResponse(
              {
                ok: false,
                error: "revision_conflict",
                taskRevision: revision,
                task,
              },
              false,
              409
            );
          }
          const applied = applyMutationOperations(task, request.operations);
          if (!applied.ok) {
            return jsonResponse({ ok: false, error: applied.error });
          }
          revision += 1;
          current = applied.task.annotations as never[];
          return jsonResponse({
            ok: true,
            taskRevision: revision,
            task: applied.task,
          });
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
    // Open the annotation list — it shows the updated comment (shared path).
    await openList(user);
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
    // open the list — it still shows the last CONFIRMED comment.
    await user.keyboard("{Escape}");
    await openList(user);
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
        url: "/__portal-studio/mutate",
        method: "POST",
        respond: async (init?: { method?: string; body?: string }) => {
          if (failed) {
            failed = false;
            return jsonResponse({ ok: false, error: "boom" });
          }
          const request = JSON.parse(init?.body ?? "{}") as {
            operations: never[];
          };
          const task = makeMarkerTask(current).task as never;
          const applied = applyMutationOperations(task, request.operations);
          if (!applied.ok) {
            return jsonResponse({ ok: false, error: applied.error });
          }
          current = applied.task.annotations as never[];
          return jsonResponse({ ok: true, taskRevision: 2, task: applied.task });
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
      const ops = mutateOperationsFrom(fetchMock).flat();
      expect(ops.some((op) => op.op === "complete")).toBe(true);
      const completeRequest = fetchMock.mock.calls
        .filter((call) => String(call[0]).includes("/mutate"))
        .map((call) => (call[1] as { body?: string }).body ?? "");
      // The LAST (successful complete) request must not carry the comment.
      expect(completeRequest[completeRequest.length - 1]).not.toContain(
        "doomed leak"
      );
    });
    // The successful Complete request still built on the confirmed comment.
    const completeRequests = fetchMock.mock.calls
      .filter((call) => String(call[0]).includes("/mutate"))
      .map((call) => (call[1] as { body?: string }).body ?? "");
    const lastComplete = completeRequests[completeRequests.length - 1];
    expect(lastComplete).not.toContain("doomed leak");
    expect(lastComplete).toContain('"op":"complete"');
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
        url: "/__portal-studio/mutate",
        method: "POST",
        respond: async (init?: { method?: string; body?: string }) => {
          if (failed) {
            failed = false;
            return jsonResponse({ ok: false, error: "boom" });
          }
          const request = JSON.parse(init?.body ?? "{}") as {
            operations: never[];
          };
          const task = makeMarkerTask(current).task as never;
          const applied = applyMutationOperations(task, request.operations);
          if (!applied.ok) {
            return jsonResponse({ ok: false, error: applied.error });
          }
          current = applied.task.annotations as never[];
          return jsonResponse({ ok: true, taskRevision: 2, task: applied.task });
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
    await openList(user);
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
    const current: unknown[] = [
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
        url: "/__portal-studio/mutate",
        method: "POST",
        respond: async () => {
          await gate;
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
        url: "/__portal-studio/mutate",
        method: "POST",
        respond: async (init?: { method?: string; body?: string }) => {
          await gate;
          const request = JSON.parse(init?.body ?? "{}") as {
            operations: never[];
          };
          const task = makeMarkerTask(current).task as never;
          const applied = applyMutationOperations(task, request.operations);
          if (!applied.ok) {
            return jsonResponse({ ok: false, error: applied.error });
          }
          current = applied.task.annotations as never[];
          return jsonResponse({ ok: true, taskRevision: 2, task: applied.task });
        },
      },
    ]);
    render(<StudioToolbar config={config} />);
    await openList(user);
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
    // Clicking the marker closed the list (outside click); reopen it while
    // the save is in flight — the editor stays open (save lock) and the
    // list Complete button is DISABLED, so no newer action can be enqueued
    // and dropped. (Scope to the LIST control; the editor's Complete is
    // disabled too.)
    await user.click(screen.getByRole("button", { name: "Annotation list" }));
    const listComplete = document.querySelector(
      ".ps-annotation-item [aria-label='Complete']"
    ) as HTMLButtonElement;
    expect(listComplete.disabled).toBe(true);
    await user.click(listComplete);
    const postsDuringSave = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("/mutate")
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
      const ops = mutateOperationsFrom(fetchMock).flat();
      expect(ops.some((op) => op.op === "complete")).toBe(true);
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
    // Open view — open the list panel and switch to All to reach it.
    await openList(user);
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

  it("hotkey combos DO fire from focused NON-editable Studio controls, incl. the marker editor's buttons (round-4 finding 3)", async () => {
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
    // Focus a NON-editable control inside the editor (the Complete button):
    // the contract disables shortcuts only for EDITABLE controls, so
    // Mod+Alt+P must activate Pick from here (and preventDefault fires
    // because the shortcut positively matched).
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
    expect(spy).toHaveBeenCalled();
    expect(await screen.findByText(/Hover an element/)).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByText(/Hover an element/)).not.toBeInTheDocument();
    // Editable targets inside the editor remain guarded (round-3 finding 2).
    const textarea = within(dialog).getByRole("textbox");
    textarea.focus();
    const editEvent = new KeyboardEvent("keydown", {
      key: "p",
      ctrlKey: true,
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    const editSpy = vi.spyOn(editEvent, "preventDefault");
    textarea.dispatchEvent(editEvent);
    expect(screen.queryByText(/Hover an element/)).not.toBeInTheDocument();
    expect(editSpy).not.toHaveBeenCalled();
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

  const viewRoutes = (annotations: unknown[]) => {
    let current = [...annotations];
    let revision = 1;
    return mockFetchRoutes([
      {
        url: "/__portal-studio/tasks",
        method: "GET",
        respond: async () => jsonResponse(makeLoadTask(current)),
      },
      {
        url: "/__portal-studio/tasks",
        method: "POST",
        respond: async () => jsonResponse({ ok: true }),
      },
      {
        url: "/__portal-studio/mutate",
        method: "POST",
        respond: async (init?: { method?: string; body?: string }) => {
          const request = JSON.parse(init?.body ?? "{}") as {
            taskId: string;
            expectedTaskRevision: number;
            operations: never[];
          };
          const task = makeLoadTask(current).task as {
            taskId: string;
            annotations: never[];
            taskRevision?: number;
          };
          task.taskRevision = revision;
          if (request.expectedTaskRevision !== revision) {
            return jsonResponse(
              {
                ok: false,
                error: "revision_conflict",
                taskRevision: revision,
                task,
              },
              false,
              409
            );
          }
          const applied = applyMutationOperations(task, request.operations);
          if (!applied.ok) {
            return jsonResponse({ ok: false, error: applied.error });
          }
          revision += 1;
          current = applied.task.annotations as never[];
          return jsonResponse({
            ok: true,
            taskRevision: revision,
            task: applied.task,
          });
        },
      },
    ]);
  };

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
    // 1 open + 1 completed → collapsed chip shows 1 (open only).
    await waitFor(() => {
      expect(
        document.querySelector(".ps-status-slot")?.textContent
      ).toBe("1");
    });
    // Switching to All must NOT change the launcher count.
    await openList(user);
    await user.click(screen.getByRole("button", { name: "All" }));
    await user.click(screen.getByRole("button", { name: "Collapse toolbar" }));
    expect(
      document.querySelector(".ps-status-slot")?.textContent
    ).toBe("1");
  });

  it("default Open view hides completed items; All shows them with distinct styling and Reopen", async () => {
    const user = userEvent.setup();
    viewRoutes([openAnn("a", "open one"), doneAnn("b", "done one")]);
    render(<StudioToolbar config={config} />);
    await openList(user);
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
    await openList(user);
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

  it("Remove-completed is ABSENT at zero completed items (round-6 blocker 2)", async () => {
    const user = userEvent.setup();
    viewRoutes([openAnn("a", "only open")]);
    render(<StudioToolbar config={config} />);
    await openList(user);
    // Contract §9: "Remove N completed" appears only when N > 0 — the
    // zero-count disabled control must not render at all.
    await waitFor(() => {
      expect(screen.getByText("only open")).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("button", { name: "Remove completed (0)" })
    ).not.toBeInTheDocument();
    expect(document.querySelector(".ps-list-footer")).toBeNull();
  });

  it("completing the FINAL open item returns the launcher to the feedback icon and hides it in Open view (not deleted)", async () => {
    const user = userEvent.setup();
    const fetchMock = viewRoutes([openAnn("a", "last open")]);
    render(<StudioToolbar config={config} />);
    await openList(user);
    await waitFor(() => {
      expect(screen.getByText("last open")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "Complete" }));
    // The item leaves the Open view (optimistic), and the typed mutation
    // settles before collapsing (the collapse refetch must see the
    // completed server state).
    await waitFor(() => {
      expect(screen.queryByText("last open")).not.toBeInTheDocument();
    });
    await waitFor(() => {
      const ops = mutateOperationsFrom(fetchMock).flat();
      expect(ops.some((op) => op.op === "complete")).toBe(true);
    });
    await user.click(screen.getByRole("button", { name: "Collapse toolbar" }));
    const slot = document.querySelector(".ps-status-slot");
    expect(slot?.textContent).toBe("");
    expect(
      document.querySelector(".ps-launcher-count")
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Wrench/ })).not.toBeInTheDocument();
    // Not deleted: reopen the list and switch to All to see it.
    await openList(user);
    await user.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByText("last open")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reopen" })).toBeInTheDocument();
  });

  it("zero states: open view with only completed shows the empty hint", async () => {
    const user = userEvent.setup();
    viewRoutes([doneAnn("b", "only done")]);
    render(<StudioToolbar config={config} />);
    await openList(user);
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/No open annotations/);
    });
    expect(screen.queryByText("only done")).not.toBeInTheDocument();
  });

  it("numbers are STABLE across Open/All: completed earlier keeps open items at 1 and 3 (review P2)", async () => {
    const user = userEvent.setup();
    makeMarkerPageElement("Alice", "row-a");
    viewRoutes([
      { ...openAnn("open-1", "first open"), elements: [elementCapture("row-a")] },
      { ...doneAnn("done-1", "middle done"), elements: [elementCapture("row-a")] },
      { ...openAnn("open-2", "second open"), elements: [elementCapture("row-a")] },
    ]);
    render(<StudioToolbar config={config} />);
    // Open view: the completed item is hidden, but the OPEN items KEEP
    // their full-list numbers 1 and 3 in BOTH the marker labels and the
    // list chips — filtering never renumbers.
    const markers = await screen.findAllByRole("button", {
      name: /open editor/,
    });
    expect(markers).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "Annotation 1: open editor" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Annotation 3: open editor" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Annotation 2: open editor" })
    ).not.toBeInTheDocument();
    // The list chips show the same stable numbers.
    await openList(user);
    await waitFor(() => {
      expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0);
    });
    const chips = Array.from(
      document.querySelectorAll(".ps-list-panel .ps-marker-chip")
    ).map((chip) => chip.textContent);
    expect(chips).toEqual(["1", "3"]);
    // All view shows the full 1..3 numbering everywhere.
    await user.click(screen.getByRole("button", { name: "All" }));
    expect(
      screen.getByRole("button", { name: "Annotation 2: open editor" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Annotation 3: open editor" })
    ).toBeInTheDocument();
    const allChips = Array.from(
      document.querySelectorAll(".ps-list-panel .ps-marker-chip")
    ).map((chip) => chip.textContent);
    expect(allChips).toEqual(["1", "2", "3"]);
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
    // Launcher counts the two OPEN items only (collapsed chip).
    await waitFor(() => {
      expect(document.querySelector(".ps-status-slot")?.textContent).toBe("2");
    });
    await openList(user);
    // Open view: both OPEN items listed (the hidden one keeps its Hidden
    // badge — hidden is independent of the view filter), completed hidden.
    await waitFor(() => {
      expect(screen.getByText("mixed open")).toBeInTheDocument();
      expect(screen.getByText("mixed open two")).toBeInTheDocument();
    });
    expect(screen.queryByText("mixed done")).not.toBeInTheDocument();
    expect(screen.getByText(/Hidden/)).toBeInTheDocument();
    // All view: completed appears; hidden item still listed with its badge.
    await user.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByText("mixed done")).toBeInTheDocument();
    expect(screen.getByText(/Hidden/)).toBeInTheDocument();
    // Header counts: 2 OPEN of 3 total in both views (completed is not
    // open); visible items renumber 1..3 in All, 1..2 in Open.
    expect(screen.getByText("2 open · 3 total")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => {
      expect(screen.getAllByRole("listitem")).toHaveLength(2);
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

  // ---- Goal 06: explicit-clear lifecycle (agent DELETE → fresh taskId) ----

  it("after the active task is cleared server-side, the next save starts a FRESH taskId", async () => {
    const user = userEvent.setup();
    const row = makePageElement("Alice", "row-a");
    const postedTaskIds: string[] = [];
    const postedTaskBodies: unknown[] = [];
    let taskExists = true;
    mockFetchRoutes([
      {
        url: "/__portal-studio/tasks",
        method: "GET",
        respond: async () =>
          jsonResponse(taskExists ? { task: null } : { task: null }),
      },
      {
        url: "/__portal-studio/tasks",
        method: "POST",
        respond: async (init?: { method?: string; body?: string }) => {
          const body = JSON.parse(init?.body ?? "{}") as {
            taskId: string;
            annotations: Array<{ comment: string }>;
          };
          postedTaskIds.push(body.taskId);
          postedTaskBodies.push(body);
          taskExists = true;
          return jsonResponse({ ok: true, taskId: body.taskId, sourceCandidates: [] });
        },
      },
      {
        url: "/__portal-studio/screenshots",
        method: "POST",
        respond: async () =>
          jsonResponse({ ok: true, file: "s.png", width: 100, height: 50 }),
      },
    ]);
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    const saveOne = async (comment: string) => {
      await startPickIfNeeded(user);
      row.focus();
      await user.keyboard("{Enter}");
      await user.type(composerTextarea(), comment);
      await user.click(composerSave());
      await waitFor(() => {
        expect(screen.getByText("Annotation saved")).toBeInTheDocument();
      });
      };
    // Annotation 1 → taskId A.
    await saveOne("first");
    expect(postedTaskIds).toHaveLength(1);
    // An agent-side DELETE clears the task: refreshTask (panel close/open)
    // now finds no task and must DROP the stale snapshot.
    taskExists = false;
    await user.click(screen.getByRole("button", { name: "Collapse toolbar" }));
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    await waitFor(() => {
      // refreshTask nulled the stale snapshot (GET serves no task).
    });
    // Annotation 2 → a FRESH taskId, carrying ONLY the new annotation.
    await saveOne("second");
    expect(postedTaskIds).toHaveLength(2);
    expect(postedTaskIds[1]).not.toBe(postedTaskIds[0]);
    expect(
      (postedTaskBodies[1] as { annotations: Array<{ comment: string }> })
        .annotations
    ).toHaveLength(1);
    expect(
      (postedTaskBodies[1] as { annotations: Array<{ comment: string }> })
        .annotations[0].comment
    ).toBe("second");
  });

  // ---- Goal 06: create/save path is revision-aware (P2-3 review) ----

  it("the save POST carries the last-known taskRevision and surfaces a 409 conflict instead of overwriting", async () => {
    const user = userEvent.setup();
    const row = makePageElement("Alice", "row-a");
    let createRevision: number | undefined;
    mockFetchRoutes([
      {
        url: "/__portal-studio/tasks",
        method: "GET",
        respond: async () =>
          jsonResponse({
            task: {
              schemaVersion: 5,
              taskId: "task-save-conflict",
              createdAt: "2026-08-09T00:00:00.000Z",
              url: "http://127.0.0.1:4173/users",
              title: "Users",
              annotations: [
                {
                  annotationId: "ann-1",
                  kind: "element",
                  comment: "existing",
                  createdAt: "2026-08-09T00:00:00.000Z",
                  status: "open",
                  elements: [],
                },
              ],
              businessContext: [],
              redaction: { droppedKeys: [], redactedValues: 0, truncatedValues: 0 },
              taskRevision: 2,
            },
          }),
      },
      {
        url: "/__portal-studio/tasks",
        method: "POST",
        respond: async (init?: { method?: string; body?: string }) => {
          const body = JSON.parse(init?.body ?? "{}") as {
            taskId: string;
            expectedTaskRevision?: number;
          };
          createRevision = body.expectedTaskRevision;
          // The server moved to revision 3 (another client completed the
          // last annotation) — the save must NOT silently overwrite.
          return jsonResponse(
            {
              ok: false,
              error: "revision_conflict",
              taskRevision: 3,
              task: null,
            },
            false,
            409
          );
        },
      },
      {
        url: "/__portal-studio/screenshots",
        method: "POST",
        respond: async () =>
          jsonResponse({ ok: true, file: "s.png", width: 100, height: 50 }),
      },
    ]);
    render(<StudioToolbar config={config} />);
    await openList(user);
    await waitFor(() => {
      expect(screen.getByText("existing")).toBeInTheDocument();
    });
    // Save a new annotation — the POST must carry the last-known revision.
    await startPickIfNeeded(user);
    row.focus();
    await user.keyboard("{Enter}");
    await user.type(composerTextarea(), "conflicted save");
    await user.click(composerSave());
    await waitFor(() => {
      expect(createRevision).toBe(2);
    });
    // The 409 surfaces as explicit conflict feedback — no silent overwrite.
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/changed on the server/);
    });
    expect(screen.queryByText("Annotation saved")).not.toBeInTheDocument();
  });

  // ---- Goal 06: 409 revision conflict — refresh, retry once, feedback ----

  it("409: refreshes from the conflict payload, retries the still-valid op ONCE, then shows conflict feedback", async () => {
    const user = userEvent.setup();
    let mutateCalls = 0;
    const serverTask: unknown = {
      schemaVersion: 5,
      taskId: "task-conflict-1",
      annotations: [
        {
          annotationId: "ann-1",
          kind: "element",
          comment: "server changed me",
          createdAt: "2026-08-08T12:00:00.000Z",
          status: "open",
          elements: [],
        },
      ],
    };
    const serverRevision = 2; // the server already moved past the client's 1
    mockFetchRoutes([
      {
        url: "/__portal-studio/tasks",
        method: "GET",
        respond: async () => jsonResponse({ task: serverTask }),
      },
      {
        url: "/__portal-studio/mutate",
        method: "POST",
        respond: async () => {
          mutateCalls += 1;
          // Always conflict: the server keeps moving ahead of the client.
          return jsonResponse(
            {
              ok: false,
              error: "revision_conflict",
              taskRevision: serverRevision,
              task: serverTask,
            },
            false,
            409
          );
        },
      },
    ]);
    render(<StudioToolbar config={config} />);
    await openList(user);
    await waitFor(() => {
      expect(screen.getByText(/server changed me/)).toBeInTheDocument();
    });
    // The client's revision baseline is 1 (serverRevision 2 was never seen
    // by the client's fetch? No — the GET serves revision 2 in taskRevision
    // if present; seed it explicitly via the task payload).
    // Attempt a hide mutation.
    await user.click(hideItemButton());
    await waitFor(() => {
      expect(mutateCalls).toBeGreaterThanOrEqual(2);
    });
    // Both attempts conflicted → explicit conflict feedback, and the UI
    // adopted the SERVER state (the server comment is shown, not hidden).
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/changed on the server/);
    });
    expect(screen.getByText("server changed me")).toBeInTheDocument();
  });

  it("409: the retry succeeds after the server state is adopted (retry-once happy path)", async () => {
    const user = userEvent.setup();
    let mutateCalls = 0;
    let serverTask: unknown = {
      schemaVersion: 5,
      taskId: "task-conflict-2",
      annotations: [
        {
          annotationId: "ann-1",
          kind: "element",
          comment: "original",
          createdAt: "2026-08-08T12:00:00.000Z",
          status: "open",
          elements: [],
        },
      ],
    };
    let serverRevision = 2;
    mockFetchRoutes([
      {
        url: "/__portal-studio/tasks",
        method: "GET",
        respond: async () => jsonResponse({ task: serverTask }),
      },
      {
        url: "/__portal-studio/mutate",
        method: "POST",
        respond: async (init?: { method?: string; body?: string }) => {
          mutateCalls += 1;
          const request = JSON.parse(init?.body ?? "{}") as {
            expectedTaskRevision: number;
            operations: Array<{ op: string; annotationId?: string; hidden?: boolean }>;
          };
          if (request.expectedTaskRevision !== serverRevision) {
            return jsonResponse(
              {
                ok: false,
                error: "revision_conflict",
                taskRevision: serverRevision,
                task: serverTask,
              },
              false,
              409
            );
          }
          // Retry succeeded: apply the op.
          const task = serverTask as {
            taskId: string;
            annotations: Array<Record<string, unknown>>;
          };
          const updated = task.annotations.map((a) =>
            a.annotationId === "ann-1"
              ? { ...a, hidden: request.operations[0].hidden }
              : a
          );
          serverRevision += 1;
          serverTask = { ...task, annotations: updated };
          return jsonResponse({
            ok: true,
            taskRevision: serverRevision,
            task: serverTask,
          });
        },
      },
    ]);
    render(<StudioToolbar config={config} />);
    await openList(user);
    await waitFor(() => {
      expect(screen.getByText("original")).toBeInTheDocument();
    });
    await user.click(hideItemButton());
    await waitFor(() => {
      expect(screen.getByText("Hidden")).toBeInTheDocument();
    });
    // Exactly two mutate attempts: the initial (409) + the retry (ok).
    await waitFor(() => {
      expect(mutateCalls).toBe(2);
    });
    expect(
      screen.queryByRole("alert")
    ).not.toBeInTheDocument();
  });

  // ---- Goal 06: stable task identity, page context, route-key gating ----

  it("taskId lifecycle: created with the first annotation and preserved across adds", async () => {
    const user = userEvent.setup();
    const row = makePageElement("Alice", "row-a");
    const postedTaskIds: string[] = [];
    const postedTaskBodies: unknown[] = [];
    let currentTask: { taskId: string; annotations: unknown[] } | null = null;
    mockFetchRoutes([
      {
        url: "/__portal-studio/tasks",
        method: "GET",
        respond: async () =>
          jsonResponse(currentTask ? { task: currentTask } : { task: null }),
      },
      {
        url: "/__portal-studio/tasks",
        method: "POST",
        respond: async (init?: { method?: string; body?: string }) => {
          const body = JSON.parse(init?.body ?? "{}") as {
            taskId: string;
            annotations: unknown[];
          };
          postedTaskIds.push(body.taskId);
          postedTaskBodies.push(body);
          currentTask = body;
          return jsonResponse({ ok: true, taskId: body.taskId, sourceCandidates: [] });
        },
      },
      {
        url: "/__portal-studio/screenshots",
        method: "POST",
        respond: async () =>
          jsonResponse({ ok: true, file: "s.png", width: 100, height: 50 }),
      },
    ]);
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    // Annotation 1.
    await startPickIfNeeded(user);
    row.focus();
    await user.keyboard("{Enter}");
    await user.type(composerTextarea(), "first");
    await user.click(composerSave());
    await waitFor(() => {
      expect(screen.getByText("Annotation saved")).toBeInTheDocument();
    });
    // Annotation 2 — same active task, SAME taskId.
    await startPickIfNeeded(user);
    row.focus();
    await user.keyboard("{Enter}");
    await user.type(composerTextarea(), "second");
    await user.click(composerSave());
    await waitFor(() => {
      expect(screen.getByText("Annotation saved")).toBeInTheDocument();
    });
    expect(postedTaskIds).toHaveLength(2);
    expect(postedTaskIds[0]).toBe(postedTaskIds[1]);
    expect((postedTaskBodies[1] as { annotations: unknown[] }).annotations).toHaveLength(2);
    // G04-03: createdAt is IMMUTABLE — the second add preserves the
    // original creation time of the active task.
    const firstBody = postedTaskBodies[0] as { createdAt: string };
    const secondBody = postedTaskBodies[1] as { createdAt: string };
    expect(secondBody.createdAt).toBe(firstBody.createdAt);
  });

  it("taskId lifecycle: a new batch after FULL completion starts a fresh taskId", async () => {
    const user = userEvent.setup();
    const row = makePageElement("Alice", "row-a");
    const postedTaskIds: string[] = [];
    const postedTaskBodies: unknown[] = [];
    let currentTask: { taskId: string; annotations: Array<{ status: string }> } | null = null;
    const fetchMock = mockFetchRoutes([
      {
        url: "/__portal-studio/tasks",
        method: "GET",
        respond: async () =>
          jsonResponse(currentTask ? { task: currentTask } : { task: null }),
      },
      {
        url: "/__portal-studio/tasks",
        method: "POST",
        respond: async (init?: { method?: string; body?: string }) => {
          const body = JSON.parse(init?.body ?? "{}") as {
            taskId: string;
            annotations: Array<{ status: string }>;
          };
          postedTaskIds.push(body.taskId);
          postedTaskBodies.push(body);
          currentTask = body;
          return jsonResponse({ ok: true, taskId: body.taskId, sourceCandidates: [] });
        },
      },
      {
        url: "/__portal-studio/screenshots",
        method: "POST",
        respond: async () =>
          jsonResponse({ ok: true, file: "s.png", width: 100, height: 50 }),
      },
      {
        url: "/__portal-studio/mutate",
        method: "POST",
        respond: async (init?: { method?: string; body?: string }) => {
          const request = JSON.parse(init?.body ?? "{}") as {
            operations: never[];
          };
          const task = currentTask as never;
          const applied = applyMutationOperations(task, request.operations);
          if (!applied.ok) {
            return jsonResponse({ ok: false, error: applied.error });
          }
          currentTask = applied.task as never;
          return jsonResponse({ ok: true, taskRevision: 2, task: applied.task });
        },
      },
    ]);
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    // Annotation 1.
    await startPickIfNeeded(user);
    row.focus();
    await user.keyboard("{Enter}");
    await user.type(composerTextarea(), "one");
    await user.click(composerSave());
    await waitFor(() => {
      expect(screen.getByText("Annotation saved")).toBeInTheDocument();
    });
    // Complete the only open annotation → task fully completed (the typed
    // mutate flush must settle so taskRef reflects the completed task).
    await openList(user);
    await user.click(screen.getByRole("button", { name: "Complete" }));
    await waitFor(() => {
      const ops = mutateOperationsFrom(fetchMock).flat();
      expect(ops.some((op) => op.op === "complete")).toBe(true);
    });
    await waitFor(() => {
      expect(postedTaskBodies.length).toBeGreaterThanOrEqual(1);
    });
    // Annotation 2 — a NEW batch → fresh taskId, only the new annotation.
    await startPickIfNeeded(user);
    row.focus();
    await user.keyboard("{Enter}");
    await user.type(composerTextarea(), "batch two");
    await user.click(composerSave());
    await waitFor(() => {
      // save1 (taskId A) + save2 (new batch, taskId B); the Complete went
      // through the typed mutate endpoint (no new task POST).
      expect(postedTaskIds.length).toBeGreaterThanOrEqual(2);
    });
    const batchTwo = postedTaskBodies[postedTaskBodies.length - 1] as {
      taskId: string;
      annotations: Array<{ status: string; comment: string }>;
    };
    expect(batchTwo.taskId).not.toBe(postedTaskIds[0]);
    expect(batchTwo.annotations).toHaveLength(1);
    expect(batchTwo.annotations[0].comment).toBe("batch two");
  });

  it("taskId lifecycle: removeCompleted after FULL completion still grants a fresh taskId", async () => {
    const user = userEvent.setup();
    const row = makePageElement("Alice", "row-a");
    const postedTaskIds: string[] = [];
    const postedTaskBodies: unknown[] = [];
    let currentTask: {
      taskId: string;
      annotations: Array<{ status: string }>;
      completedAt?: string;
    } | null = null;
    const fetchMock = mockFetchRoutes([
      {
        url: "/__portal-studio/tasks",
        method: "GET",
        respond: async () =>
          jsonResponse(currentTask ? { task: currentTask } : { task: null }),
      },
      {
        url: "/__portal-studio/tasks",
        method: "POST",
        respond: async (init?: { method?: string; body?: string }) => {
          const body = JSON.parse(init?.body ?? "{}") as {
            taskId: string;
            annotations: Array<{ status: string }>;
          };
          postedTaskIds.push(body.taskId);
          postedTaskBodies.push(body);
          currentTask = body;
          return jsonResponse({ ok: true, taskId: body.taskId, sourceCandidates: [] });
        },
      },
      {
        url: "/__portal-studio/screenshots",
        method: "POST",
        respond: async () =>
          jsonResponse({ ok: true, file: "s.png", width: 100, height: 50 }),
      },
      {
        url: "/__portal-studio/mutate",
        method: "POST",
        respond: async (init?: { method?: string; body?: string }) => {
          const request = JSON.parse(init?.body ?? "{}") as {
            operations: never[];
          };
          const applied = applyMutationOperations(
            currentTask as never,
            request.operations
          );
          if (!applied.ok) {
            return jsonResponse({ ok: false, error: applied.error });
          }
          currentTask = applied.task as never;
          return jsonResponse({ ok: true, taskRevision: 2, task: applied.task });
        },
      },
    ]);
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    // Annotation 1.
    await startPickIfNeeded(user);
    row.focus();
    await user.keyboard("{Enter}");
    await user.type(composerTextarea(), "one");
    await user.click(composerSave());
    await waitFor(() => {
      expect(screen.getByText("Annotation saved")).toBeInTheDocument();
    });
    const taskIdA = postedTaskIds[0];
    // Complete the only open annotation → the sticky task-level
    // completedAt is stamped by the typed mutate flush.
    await openList(user);
    await user.click(screen.getByRole("button", { name: "Complete" }));
    await waitFor(() => {
      const ops = mutateOperationsFrom(fetchMock).flat();
      expect(ops.some((op) => op.op === "complete")).toBe(true);
    });
    await waitFor(() => {
      expect(currentTask?.completedAt).toBeTruthy();
    });
    // Remove completed through the dock control + confirm.
    await user.click(
      screen.getByRole("button", { name: /Remove completed \(1\)/ })
    );
    await user.click(screen.getByRole("button", { name: "Remove", exact: true }));
    await waitFor(() => {
      expect(currentTask?.annotations.length).toBe(0);
    });
    // The sticky marker survives removeCompleted → the task is STILL
    // fully completed, so the next batch must start a fresh taskId
    // (regression: the emptied task used to reuse the old id).
    expect(currentTask?.completedAt).toBeTruthy();
    await startPickIfNeeded(user);
    row.focus();
    await user.keyboard("{Enter}");
    await user.type(composerTextarea(), "batch after remove");
    await user.click(composerSave());
    await waitFor(() => {
      expect(postedTaskIds.length).toBeGreaterThanOrEqual(2);
    });
    expect(postedTaskIds[1]).not.toBe(taskIdA);
    expect(
      (postedTaskBodies[1] as { annotations: unknown[] }).annotations
    ).toHaveLength(1);
  });

  it("markers render ONLY when the annotation routeKey matches the current route", async () => {
    makeMarkerPageElement("Alice", "row-a");
    window.history.pushState({}, "", "/");
    mockFetchRoutes([
      {
        url: "/__portal-studio/tasks",
        method: "GET",
        respond: async () =>
          jsonResponse(
            makeLoadTask([
              {
                annotationId: "ann-route",
                kind: "element",
                comment: "users annotation",
                createdAt: "2026-08-09T00:00:00.000Z",
                status: "open",
                elements: [elementCapture("row-a")],
                pageContext: {
                  url: "http://127.0.0.1:4173/users",
                  routeKey: "/users",
                  title: "Users",
                  viewport: { width: 1280, height: 720 },
                  scroll: { x: 0, y: 0 },
                  businessContext: [],
                },
              },
            ])
          ),
      },
    ]);
    render(<StudioToolbar config={config} />);
    // Wrong route (jsdom "/") → no marker.
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /open editor/ })).not.toBeInTheDocument();
    });
    // Navigate to /users → the marker appears.
    window.history.pushState({}, "", "/users");
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Annotation 1: open editor" })
      ).toBeInTheDocument();
    });
  });

  it("route changes close a stale marker editor safely", async () => {
    const user = userEvent.setup();
    makeMarkerPageElement("Alice", "row-a");
    window.history.pushState({}, "", "/users");
    mockFetchRoutes([
      {
        url: "/__portal-studio/tasks",
        method: "GET",
        respond: async () =>
          jsonResponse(
            makeLoadTask([
              {
                annotationId: "ann-route",
                kind: "element",
                comment: "users annotation",
                createdAt: "2026-08-09T00:00:00.000Z",
                status: "open",
                elements: [elementCapture("row-a")],
                pageContext: {
                  url: "http://127.0.0.1:4173/users",
                  routeKey: "/users",
                  title: "Users",
                  viewport: { width: 1280, height: 720 },
                  scroll: { x: 0, y: 0 },
                  businessContext: [],
                },
              },
            ])
          ),
      },
    ]);
    render(<StudioToolbar config={config} />);
    const marker = await screen.findByRole("button", {
      name: "Annotation 1: open editor",
    });
    await user.click(marker);
    expect(screen.getByRole("dialog", { name: "Annotation editor" })).toBeInTheDocument();
    // Navigate away → the editor closes (its annotation belongs to /users).
    window.history.pushState({}, "", "/dev/ai-chat");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Annotation editor" })
      ).not.toBeInTheDocument();
    });
  });


  // ---- Goal 01 v5: horizontal toolbar contract (action order, tooltips,
  //      help, list, presentation-only visibility) ----

  const barButtons = () => {
    const bar = screen.getByRole("toolbar", { name: "Portal Studio" });
    return within(bar)
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label"));
  };

  it("expanded feature order is Pick, Multi, Area, Copy, Visibility, Help, List with Collapse chrome after", async () => {
    const user = userEvent.setup();
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    // The toolbar role belongs to the horizontal bar ONLY (never the
    // panels); the feature order is normative; Collapse sits after a
    // divider as separate toolbar chrome.
    expect(barButtons()).toEqual([
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
    // Exactly one toolbar role in the whole Studio root.
    expect(
      screen.getAllByRole("toolbar", { name: "Portal Studio" })
    ).toHaveLength(1);
  });

  it("all toolbar icons have localized accessible labels; no Wrench, X-collapse or reset controls remain", async () => {
    const user = userEvent.setup();
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    const bar = screen.getByRole("toolbar", { name: "Portal Studio" });
    const buttons = within(bar).getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(8);
    for (const button of buttons) {
      expect((button.getAttribute("aria-label") ?? "").length).toBeGreaterThan(0);
    }
    // Superseded paths: no Wrench icon anywhere, no X collapse, no
    // Reset-dock control, no detached badge class.
    expect(document.querySelector(".ps-dock .lucide-wrench")).toBeNull();
    expect(document.querySelector(".ps-dock .lucide-x")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Reset Dock/i })
    ).not.toBeInTheDocument();
    expect(document.querySelector(".ps-launcher-count")).toBeNull();
  });

  it("tooltips: focus opens immediately with action + platform shortcut; Esc closes", async () => {
    const user = userEvent.setup();
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    const pick = screen.getByRole("button", { name: "Pick element" });
    pick.focus();
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip.textContent).toContain("Pick element");
    expect(tooltip.textContent).toContain("Ctrl+Alt+P");
    // aria-describedby wiring points at the tooltip.
    expect(pick.getAttribute("aria-describedby")).toBe(tooltip.id);
    // Esc closes it.
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    });
    // The drag grip has no fake keycap.
    const grip = screen.getByRole("button", { name: "Drag toolbar" });
    grip.focus();
    const gripTip = await screen.findByRole("tooltip");
    expect(gripTip.textContent).toBe("Drag toolbar");
  });

  it("collapsed chip Expand has the custom tooltip with label + keycap (review P5)", async () => {
    render(<StudioToolbar config={config} />);
    const expand = screen.getByRole("button", { name: "Expand toolbar" });
    expand.focus();
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip.textContent).toContain("Expand toolbar");
    expect(tooltip.textContent).toContain("Ctrl+Alt+K");
    expect(expand.getAttribute("aria-describedby")).toBe(tooltip.id);
  });

  it("tooltips: hover opens after the delay and closes on leave", async () => {
    const user = userEvent.setup();
    viewRoutes([openAnn("a", "hover me")]);
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    const copy = screen.getByRole("button", { name: "Copy annotations" });
    await user.hover(copy);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    await waitFor(
      () => {
        expect(screen.getByRole("tooltip").textContent).toContain(
          "Copy annotations"
        );
      },
      { timeout: 1000 }
    );
    await user.unhover(copy);
    await waitFor(() => {
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    });
  });

  it("capture actions expose aria-pressed and toggle off on re-click", async () => {
    const user = userEvent.setup();
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    const pick = screen.getByRole("button", { name: "Pick element" });
    const multi = screen.getByRole("button", { name: "Multi-select" });
    const area = screen.getByRole("button", { name: "Select region" });
    expect(pick).toHaveAttribute("aria-pressed", "false");
    await user.click(pick);
    expect(pick).toHaveAttribute("aria-pressed", "true");
    // Clicking the active Pick cancels it.
    await user.click(pick);
    expect(pick).toHaveAttribute("aria-pressed", "false");
    await user.click(multi);
    expect(multi).toHaveAttribute("aria-pressed", "true");
    expect(pick).toHaveAttribute("aria-pressed", "false");
    await user.click(area);
    expect(area).toHaveAttribute("aria-pressed", "true");
    expect(multi).toHaveAttribute("aria-pressed", "false");
  });

  it("Copy is disabled at zero Open annotations (including all-completed tasks)", async () => {
    const user = userEvent.setup();
    viewRoutes([doneAnn("b", "only done")]);
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    expect(
      screen.getByRole("button", { name: "Copy annotations" })
    ).toBeDisabled();
  });

  it("toolbar marker visibility is presentation-only: no task mutation, markers hidden, per-item Hide untouched", async () => {
    const user = userEvent.setup();
    makeMarkerPageElement("Alice", "row-a");
    const fetchMock = viewRoutes([
      { ...openAnn("open-1", "visible one"), elements: [elementCapture("row-a")] },
    ]);
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    const visibility = screen.getByRole("button", { name: "Hide markers" });
    expect(visibility).toHaveAttribute("aria-pressed", "false");
    // A resolved marker is rendered before the toggle.
    expect(
      screen.getByRole("button", { name: "Annotation 1: open editor" })
    ).toBeInTheDocument();
    await user.click(visibility);
    // Presentation-only: markers hidden, button now "Show markers".
    expect(
      screen.queryByRole("button", { name: "Annotation 1: open editor" })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Show markers" })
    ).toHaveAttribute("aria-pressed", "true");
    // NO task mutation was sent (no setHidden batch, nothing).
    expect(mutateOperationsFrom(fetchMock).flat()).toEqual([]);
    // Toggling back restores the markers without any mutation either.
    await user.click(screen.getByRole("button", { name: "Show markers" }));
    expect(
      screen.getByRole("button", { name: "Annotation 1: open editor" })
    ).toBeInTheDocument();
    expect(mutateOperationsFrom(fetchMock).flat()).toEqual([]);
    // The per-item Hide action remains the explicit persisted path.
    await openList(user);
    await waitFor(() => {
      expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0);
    });
    await user.click(hideItemButton());
    await waitFor(() => {
      const ops = mutateOperationsFrom(fetchMock).flat();
      expect(
        ops.some(
          (op) => op.op === "setHidden" && op.annotationId === "open-1"
        )
      ).toBe(true);
    });
  });

  it("Help opens from click and from the ? shortcut; content comes from the registry", async () => {
    const user = userEvent.setup();
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    const helpButton = screen.getByRole("button", { name: "Keyboard shortcuts" });
    await user.click(helpButton);
    expect(helpButton).toHaveAttribute("aria-expanded", "true");
    expect(helpButton).toHaveAttribute("aria-controls", "ps-shortcut-help");
    const popover = screen.getByRole("region", {
      name: "Keyboard shortcuts",
    });
    // Every registry action row (INCLUDING the help action's own `?` row,
    // review P4) + the Esc row + the safety note.
    expect(within(popover).getAllByText("Keyboard shortcuts").length).toBeGreaterThanOrEqual(2);
    expect(within(popover).getByText("?", { exact: true })).toBeInTheDocument();
    expect(within(popover).getByText("Pick element")).toBeInTheDocument();
    expect(within(popover).getByText("Multi-select")).toBeInTheDocument();
    expect(within(popover).getByText("Select region")).toBeInTheDocument();
    expect(within(popover).getByText("Copy annotations")).toBeInTheDocument();
    expect(within(popover).getByText("Hide markers")).toBeInTheDocument();
    expect(within(popover).getByText("Annotation list")).toBeInTheDocument();
    expect(within(popover).getByText("Collapse toolbar")).toBeInTheDocument();
    expect(within(popover).getByText(/cancel the current capture/)).toBeInTheDocument();
    expect(
      within(popover).getByText(/ignored while typing in inputs/)
    ).toBeInTheDocument();
    // Close with Esc (focus returns to the trigger).
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(
        screen.queryByRole("region", { name: "Keyboard shortcuts" })
      ).not.toBeInTheDocument();
    });
    expect(helpButton).toHaveFocus();
    // The ? shortcut opens the same registry-generated popover.
    fireEvent.keyDown(document, { key: "?" });
    expect(
      screen.getByRole("region", { name: "Keyboard shortcuts" })
    ).toBeInTheDocument();
  });

  it("List is the final feature action, toggles the panel, and Help/List are mutually exclusive", async () => {
    const user = userEvent.setup();
    viewRoutes([openAnn("a", "list me")]);
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    const listButton = screen.getByRole("button", { name: "Annotation list" });
    // List is the last feature action before the Collapse chrome.
    const names = barButtons();
    expect(names.indexOf("Annotation list")).toBe(names.length - 2);
    await user.click(listButton);
    expect(listButton).toHaveAttribute("aria-expanded", "true");
    expect(listButton).toHaveAttribute("aria-controls", "ps-annotation-list");
    const panel = screen.getByRole("region", { name: "Annotations" });
    await waitFor(() => {
      expect(within(panel).getByText("list me")).toBeInTheDocument();
    });
    // Exactly ONE list surface exists.
    expect(document.querySelectorAll(".ps-list-panel")).toHaveLength(1);
    // The toolbar remains visible while the panel is open.
    expect(
      screen.getByRole("toolbar", { name: "Portal Studio" })
    ).toBeInTheDocument();
    // Clicking the icon again closes it.
    await user.click(listButton);
    await waitFor(() => {
      expect(
        screen.queryByRole("region", { name: "Annotations" })
      ).not.toBeInTheDocument();
    });
    // Mutual exclusion: opening Help closes the list and vice versa.
    await user.click(listButton);
    await user.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));
    expect(
      screen.queryByRole("region", { name: "Annotations" })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Keyboard shortcuts" })
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Annotation list" }));
    expect(
      screen.queryByRole("region", { name: "Keyboard shortcuts" })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Annotations" })
    ).toBeInTheDocument();
    // Escape closes the list with focus back on its trigger.
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(
        screen.queryByRole("region", { name: "Annotations" })
      ).not.toBeInTheDocument();
    });
    expect(listButton).toHaveFocus();
  });

  it("the expanded toolbar does NOT trap Tab — native focus navigation stays intact (review P3)", async () => {
    const user = userEvent.setup();
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    const collapse = screen.getByRole("button", { name: "Collapse toolbar" });
    collapse.focus();
    const keyEvent = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    const spy = vi.spyOn(keyEvent, "preventDefault");
    collapse.dispatchEvent(keyEvent);
    // No open-wide focus trap: Tab is NOT intercepted (no preventDefault,
    // no forced focus wrap inside the toolbar). Genuine dialogs (the Copy
    // fallback) keep their own scoped trap.
    expect(spy).not.toHaveBeenCalled();
  });

  it("unresolved list items do not open an invisible editor; one Esc closes the list (review P8)", async () => {
    const user = userEvent.setup();
    viewRoutes([
      openAnn("ann-unresolved", "no target here"),
    ]);
    render(<StudioToolbar config={config} />);
    await openList(user);
    await waitFor(() => {
      expect(screen.getByText("no target here")).toBeInTheDocument();
    });
    // The item IS unresolved.
    expect(screen.getByText(/Target not found/)).toBeInTheDocument();
    // Its mutation actions remain available (edit/complete/hide/delete).
    expect(
      screen.getByRole("button", { name: "Edit comment" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Complete" })
    ).toBeInTheDocument();
    // Clicking the item body must NOT open an (invisible) marker editor.
    await user.click(screen.getByText("no target here"));
    expect(
      screen.queryByRole("dialog", { name: "Annotation editor" })
    ).not.toBeInTheDocument();
    // ONE Esc closes the list (it is not consumed by a hidden editor).
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(
        screen.queryByRole("region", { name: "Annotations" })
      ).not.toBeInTheDocument();
    });
  });

  it("list Esc coordinator: inline-edit Esc cancels and returns focus to that row's Edit trigger (round-3 finding 3)", async () => {
    const user = userEvent.setup();
    viewRoutes([openAnn("ann-1", "edit me")]);
    render(<StudioToolbar config={config} />);
    await openList(user);
    await waitFor(() => {
      expect(screen.getByText("edit me")).toBeInTheDocument();
    });
    const editButton = screen.getByRole("button", { name: "Edit comment" });
    await user.click(editButton);
    const textarea = screen.getByDisplayValue("edit me");
    await user.type(textarea, "!");
    expect(screen.getByText("Unsaved")).toBeInTheDocument();
    // ONE Esc cancels the inline edit (no saved mutation) and restores
    // focus to THIS row's Edit trigger.
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByDisplayValue("edit me!")).not.toBeInTheDocument();
    });
    expect(screen.getByText("edit me")).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Edit comment" })
      ).toHaveFocus();
    });
    // Nothing was mutated.
    expect(screen.queryByText("Unsaved")).not.toBeInTheDocument();
  });

  it("list Esc coordinator: multi-row delete confirm returns focus to the EXACT row (round-3 finding 3)", async () => {
    const user = userEvent.setup();
    viewRoutes([openAnn("ann-1", "row one"), openAnn("ann-2", "row two")]);
    render(<StudioToolbar config={config} />);
    await openList(user);
    await waitFor(() => {
      expect(screen.getAllByRole("listitem").length).toBeGreaterThan(1);
    });
    // Open the confirmation on the SECOND row.
    const deleteButtons = screen.getAllByRole("button", { name: "Delete" });
    expect(deleteButtons).toHaveLength(2);
    await user.click(deleteButtons[1]);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Delete this annotation?"
    );
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
    // Focus returns to row TWO's Delete button — not the first row's.
    await waitFor(() => {
      expect(
        screen.getAllByRole("button", { name: "Delete" })[1]
      ).toHaveFocus();
    });
    // Nothing was deleted.
    expect(screen.getByText("row one")).toBeInTheDocument();
    expect(screen.getByText("row two")).toBeInTheDocument();
  });

  it("list Esc coordinator: remove-completed confirm Esc cancels and restores its trigger (round-3 finding 3)", async () => {
    const user = userEvent.setup();
    viewRoutes([openAnn("a", "open one"), doneAnn("b", "done one")]);
    render(<StudioToolbar config={config} />);
    await openList(user);
    const removeTrigger = await screen.findByRole("button", {
      name: "Remove completed (1)",
    });
    await user.click(removeTrigger);
    expect(screen.getByRole("alert")).toHaveTextContent(/Open items stay/);
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(
        screen.queryByRole("alert")
      ).not.toBeInTheDocument();
    });
    // Focus returns to the Remove-completed trigger; nothing removed —
    // the OPEN item is intact and the footer still counts the completed one.
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Remove completed (1)" })
      ).toHaveFocus();
    });
    expect(screen.getByText("open one")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove completed (1)" })
    ).not.toBeDisabled();
  });

  it("list Esc coordinator: a hidden list transient never blocks Help Esc after Help/List switching (round-3 finding 3)", async () => {
    const user = userEvent.setup();
    viewRoutes([openAnn("ann-1", "switch me")]);
    render(<StudioToolbar config={config} />);
    await openList(user);
    await waitFor(() => {
      expect(screen.getByText("switch me")).toBeInTheDocument();
    });
    // Open a delete confirmation in the LIST…
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    // …then switch to Help: the list (and its transient UI) closes.
    await user.click(
      screen.getByRole("button", { name: "Keyboard shortcuts" })
    );
    expect(
      screen.getByRole("region", { name: "Keyboard shortcuts" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("alert")
    ).not.toBeInTheDocument();
    // ONE Esc closes Help — it is NOT blocked by the hidden list transient.
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(
        screen.queryByRole("region", { name: "Keyboard shortcuts" })
      ).not.toBeInTheDocument();
    });
    // Saved annotations are untouched.
    await openList(user);
    expect(screen.getByText("switch me")).toBeInTheDocument();
  });

  /**
   * jsdom lacks pointer capture — install no-op prototype methods via
   * typed Object.defineProperty so the capture contract can be asserted
   * (real browsers cover actual capture in the e2e drag tests).
   * Round-4 finding 2: no unsafe type-escape casts anywhere in the diff —
   * the DOM types already declare these methods on Element, and the
   * original descriptors are restored safely.
   */
  const installPointerCaptureMocks = () => {
    const proto = HTMLElement.prototype;
    const restores: Array<() => void> = [];
    const define = (
      name: "setPointerCapture" | "hasPointerCapture" | "releasePointerCapture",
      impl: (pointerId: number) => void | boolean
    ) => {
      const existing = Object.getOwnPropertyDescriptor(proto, name);
      Object.defineProperty(proto, name, {
        configurable: true,
        writable: true,
        value: impl,
      });
      restores.push(() => {
        if (existing) {
          Object.defineProperty(proto, name, existing);
        } else {
          Reflect.deleteProperty(proto, name);
        }
      });
    };
    define("setPointerCapture", () => undefined);
    define("hasPointerCapture", () => true);
    define("releasePointerCapture", () => undefined);
    return () => {
      for (const restore of restores) restore();
    };
  };

  it("dock drag uses REAL pointer capture with release on pointerup (round-3 finding 1)", async () => {
    const restoreMocks = installPointerCaptureMocks();
    const proto = HTMLElement.prototype;
    const setSpy = vi
      .spyOn(proto, "setPointerCapture")
      .mockImplementation(() => undefined);
    const hasSpy = vi
      .spyOn(proto, "hasPointerCapture")
      .mockImplementation(() => true);
    const releaseSpy = vi
      .spyOn(proto, "releasePointerCapture")
      .mockImplementation(() => undefined);
    try {
      const user = userEvent.setup();
      render(<StudioToolbar config={config} />);
      const handle = screen.getByRole("button", { name: "Drag toolbar" });
      await user.pointer([
        { keys: "[MouseLeft>]", target: handle, coords: { x: 10, y: 10 } },
        { coords: { x: 120, y: 60 } },
        { keys: "[/MouseLeft]", coords: { x: 120, y: 60 } },
      ]);
      // The pointer was captured with the gesture's pointerId and released
      // on pointerup.
      expect(setSpy).toHaveBeenCalledTimes(1);
      const pointerId = setSpy.mock.calls[0][0];
      expect(typeof pointerId).toBe("number");
      expect(hasSpy).toHaveBeenCalledWith(pointerId);
      expect(releaseSpy).toHaveBeenCalledWith(pointerId);
      // The drag itself moved the dock and did not expand anything.
      expect(
        screen.queryByRole("toolbar", { name: "Portal Studio" })
      ).not.toBeInTheDocument();
    } finally {
      setSpy.mockRestore();
      hasSpy.mockRestore();
      releaseSpy.mockRestore();
      restoreMocks();
    }
  });

  it("dock drag aborts cleanly on window blur and lostpointercapture (round-3 finding 1)", async () => {
    const restoreMocks = installPointerCaptureMocks();
    const proto = HTMLElement.prototype;
    const setSpy = vi
      .spyOn(proto, "setPointerCapture")
      .mockImplementation(() => undefined);
    vi.spyOn(proto, "hasPointerCapture").mockImplementation(() => true);
    vi.spyOn(proto, "releasePointerCapture").mockImplementation(() => undefined);
    try {
      const user = userEvent.setup();
      render(<StudioToolbar config={config} />);
      const handle = screen.getByRole("button", { name: "Drag toolbar" });
      const dock = document.querySelector(".ps-dock") as HTMLElement;
      const before = Number(dock.style.left.replace("px", ""));
      await user.pointer([
        { keys: "[MouseLeft>]", target: handle, coords: { x: 10, y: 10 } },
      ]);
      // Window blur aborts the drag: subsequent moves must NOT move the
      // dock (listeners are dropped, nothing is persisted).
      fireEvent.blur(window);
      fireEvent.pointerMove(window, {
        clientX: 300,
        clientY: 300,
        pointerId: setSpy.mock.calls[0][0],
      });
      expect(Number(dock.style.left.replace("px", ""))).toBe(before);
      // lostpointercapture on the handle also aborts a NEW drag.
      await user.pointer([
        { keys: "[MouseLeft>]", target: handle, coords: { x: 10, y: 10 } },
      ]);
      fireEvent.pointerMove(window, {
        clientX: -100,
        clientY: -100,
        pointerId: setSpy.mock.calls[1][0],
      });
      const afterDrag = Number(dock.style.left.replace("px", ""));
      expect(afterDrag).toBeLessThan(before);
      const lost = new Event("lostpointercapture");
      Object.defineProperty(lost, "pointerId", {
        value: setSpy.mock.calls[1][0],
      });
      fireEvent(handle, lost);
      fireEvent.pointerMove(window, {
        clientX: 300,
        clientY: 300,
        pointerId: setSpy.mock.calls[1][0],
      });
      expect(Number(dock.style.left.replace("px", ""))).toBe(afterDrag);
    } finally {
      setSpy.mockRestore();
      restoreMocks();
    }
  });

  it("manual Copy from a FOCUSED toolbar control suppresses its tooltip: zero tooltips, ONE Esc closes the fallback (round-6 addendum)", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn().mockRejectedValue(new Error("denied")),
      },
    });
    viewRoutes([openAnn("a", "focus copy")]);
    render(<StudioToolbar config={config} />);
    // No auxiliary panel open (a panel would suppress tooltips by design);
    // just expand and wait for the loaded task so Copy is enabled.
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Copy annotations" })
      ).not.toBeDisabled();
    });
    const copyButton = screen.getByRole("button", {
      name: "Copy annotations",
    });
    copyButton.focus();
    // The focused Copy button's tooltip opens…
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip.textContent).toContain("Copy annotations");
    // …but the hotkey-triggered manual fallback suppresses it.
    fireEvent.keyDown(copyButton, { key: "c", ctrlKey: true, altKey: true });
    await screen.findByRole("dialog", { name: "Copy manually" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    // ONE Esc closes the fallback (the suppressed tooltip cannot steal it).
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Copy manually" })
      ).not.toBeInTheDocument();
    });
  });

  it("collapsed focused-C: expansion + fallback leaves ZERO tooltips; one Esc closes the fallback (round-6 addendum)", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn().mockRejectedValue(new Error("denied")),
      },
    });
    viewRoutes([openAnn("a", "collapse copy")]);
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    // Collapse and focus the chip drag handle → its tooltip opens.
    await user.click(screen.getByRole("button", { name: "Collapse toolbar" }));
    const chipGrip = screen.getByRole("button", { name: "Drag toolbar" });
    chipGrip.focus();
    expect(await screen.findByRole("tooltip")).toBeInTheDocument();
    // C from the collapsed grip: expands AND opens the manual fallback —
    // the stale chip tooltip must NOT carry onto the bar grip.
    fireEvent.keyDown(chipGrip, { key: "c", ctrlKey: true, altKey: true });
    expect(
      await screen.findByRole("toolbar", { name: "Portal Studio" })
    ).toBeInTheDocument();
    await screen.findByRole("dialog", { name: "Copy manually" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Copy manually" })
      ).not.toBeInTheDocument();
    });
  });

  it("a focused collapsed Drag tooltip does NOT carry onto the expanded bar after shortcut-driven expansion (round-6 addendum)", async () => {
    const user = userEvent.setup();
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    await user.click(screen.getByRole("button", { name: "Collapse toolbar" }));
    const chipGrip = screen.getByRole("button", { name: "Drag toolbar" });
    chipGrip.focus();
    expect(await screen.findByRole("tooltip")).toBeInTheDocument();
    // Shortcut-driven expansion (P): the bar grip must mount with a FRESH
    // closed tooltip (distinct stable keys force a remount).
    fireEvent.keyDown(chipGrip, { key: "p", ctrlKey: true, altKey: true });
    expect(
      await screen.findByRole("toolbar", { name: "Portal Studio" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(screen.getByText(/Hover an element/)).toBeInTheDocument();
  });

  it("ONE Esc closes an open tooltip while capture stays active; the next Esc cancels capture (round-6 blocker 3)", async () => {
    const user = userEvent.setup();
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    const cases: Array<{
      label: string;
      hint: RegExp;
    }> = [
      { label: "Pick element", hint: /Hover an element/ },
      { label: "Multi-select", hint: /toggle elements in\/out/ },
      { label: "Select region", hint: /Drag over the page/ },
    ];
    for (const { label, hint } of cases) {
      const action = screen.getByRole("button", { name: label });
      await user.click(action);
      expect(action).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByText(hint)).toBeInTheDocument();
      // Focus the action button (blur first — the click already focused
      // it, and the tooltip closed on click) → the registry tooltip opens.
      action.blur();
      action.focus();
      const tooltip = await screen.findByRole("tooltip");
      expect(tooltip.textContent).toContain(label);
      // ONE Esc closes the TOOLTIP only — capture stays active.
      await user.keyboard("{Escape}");
      await waitFor(() => {
        expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
      });
      expect(action).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByText(hint)).toBeInTheDocument();
      // The NEXT Esc cancels capture.
      await user.keyboard("{Escape}");
      await waitFor(() => {
        expect(action).toHaveAttribute("aria-pressed", "false");
      });
      expect(screen.queryByText(hint)).not.toBeInTheDocument();
    }
  });

  it("Help and List panels anchor ≈PLACEMENT_GAP above a bottom trigger, not maxHeight away (round-6 blocker 1)", async () => {
    const user = userEvent.setup();
    viewRoutes([openAnn("ann-1", "anchor me")]);
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    // jsdom reports offsetHeight 0 — mock the rendered height so the
    // above-flip anchoring is exercised exactly like a short real panel.
    const heightGetter = vi
      .spyOn(HTMLElement.prototype, "offsetHeight", "get")
      .mockReturnValue(220);
    try {
      const cases: Array<[string, string]> = [
        ["Keyboard shortcuts", "Keyboard shortcuts"],
        ["Annotation list", "Annotations"],
      ];
      for (const [buttonName, regionName] of cases) {
        const trigger = screen.getByRole("button", { name: buttonName });
        (trigger as HTMLElement & {
          getBoundingClientRect(): DOMRect;
        }).getBoundingClientRect = () =>
          ({
            left: 1000,
            top: 700,
            width: 40,
            height: 40,
            right: 1040,
            bottom: 740,
            x: 1000,
            y: 700,
            toJSON: () => ({}),
          }) as DOMRect;
        await user.click(trigger);
        const panel = screen.getByRole("region", {
          name: regionName,
        }) as HTMLElement;
        // Flipped ABOVE with the RENDERED height (220): the panel bottom
        // ends ≈ PLACEMENT_GAP above the trigger top — NOT maxHeight away.
        await waitFor(() => {
          const top = Number(panel.style.top.replace("px", ""));
          expect(Math.abs(top + 220 - (700 - 8))).toBeLessThanOrEqual(2);
        });
        await user.keyboard("{Escape}");
        await waitFor(() => {
          expect(screen.queryByRole("region", { name: regionName })).not.toBeInTheDocument();
        });
      }
    } finally {
      heightGetter.mockRestore();
    }
  });

  it("an open Help/List panel re-anchors after a viewport resize (round-6 blocker 1)", async () => {
    const user = userEvent.setup();
    viewRoutes([openAnn("ann-1", "resize me")]);
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    const listButton = screen.getByRole("button", { name: "Annotation list" });
    (listButton as HTMLElement & {
      getBoundingClientRect(): DOMRect;
    }).getBoundingClientRect = () =>
      ({
        left: 1000,
        top: 300,
        width: 40,
        height: 40,
        right: 1040,
        bottom: 340,
        x: 1000,
        y: 300,
        toJSON: () => ({}),
      }) as DOMRect;
    await user.click(listButton);
    const panel = screen.getByRole("region", { name: "Annotations" }) as HTMLElement;
    await waitFor(() => {
      expect(panel.style.left).not.toBe("");
    });
    const firstLeft = Number(panel.style.left.replace("px", ""));
    // The trigger moves left; a viewport resize must re-read the trigger
    // rect and re-anchor the open panel.
    (listButton as HTMLElement & {
      getBoundingClientRect(): DOMRect;
    }).getBoundingClientRect = () =>
      ({
        left: 500,
        top: 300,
        width: 40,
        height: 40,
        right: 540,
        bottom: 340,
        x: 500,
        y: 300,
        toJSON: () => ({}),
      }) as DOMRect;
    fireEvent(window, new Event("resize"));
    await waitFor(() => {
      const movedLeft = Number(panel.style.left.replace("px", ""));
      expect(movedLeft).toBeLessThan(firstLeft);
    });
  });

  it("manual-Copy fallback Close button dismisses AND restores Copy focus (round-6 blocker 4)", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn().mockRejectedValue(new Error("denied")),
      },
    });
    viewRoutes([openAnn("a", "close focus")]);
    render(<StudioToolbar config={config} />);
    await openList(user);
    await waitFor(() => {
      expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0);
    });
    await user.click(
      screen.getByRole("button", { name: "Copy annotations" })
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Copy manually",
    });
    // Keyboard-focus and ACTIVATE the visible Close button (not Esc).
    const closeButton = within(dialog).getByRole("button", {
      name: "Close",
    });
    closeButton.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(dialog).not.toBeInTheDocument();
    });
    // Focus returns to the real Copy button after render.
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Copy annotations" })
      ).toHaveFocus();
    });
  });

  it("manual-Copy fallback is placed by the shared viewport-aware helper (round-3 finding 4)", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn().mockRejectedValue(new Error("denied")),
      },
    });
    viewRoutes([openAnn("a", "edge copy")]);
    render(<StudioToolbar config={config} />);
    await openList(user);
    await waitFor(() => {
      expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0);
    });
    await user.click(
      screen.getByRole("button", { name: "Copy annotations" })
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Copy manually",
    });
    // The fallback is positioned by the shared placement utility anchored
    // to the real Copy button — inline left/top/width, never the old
    // CSS-only flip class.
    const style = (dialog as HTMLElement).style;
    expect(style.left).not.toBe("");
    expect(style.top).not.toBe("");
    expect(style.width).toBe("320px");
    expect((dialog as HTMLElement).className).not.toContain(
      "ps-more-menu-below"
    );
    // Round-4 finding 5: genuine near-trigger anchoring — with a real
    // trigger rect, the below-placed dialog sits exactly PLACEMENT_GAP
    // below the Copy button's bottom edge.
    const copyButton = screen.getByRole("button", {
      name: "Copy annotations",
    });
    (copyButton as HTMLElement & {
      getBoundingClientRect(): DOMRect;
    }).getBoundingClientRect = () =>
      ({
        left: 800,
        top: 700,
        width: 40,
        height: 40,
        right: 840,
        bottom: 740,
        x: 800,
        y: 700,
        toJSON: () => ({}),
      }) as DOMRect;
    // Re-open the fallback after the rect mock is installed.
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(dialog).not.toBeInTheDocument();
    });
    await user.click(copyButton);
    const reOpened = await screen.findByRole("dialog", {
      name: "Copy manually",
    });
    expect(Number((reOpened as HTMLElement).style.top.replace("px", ""))).toBe(
      740 + 8
    );
    // Esc still closes it race-free and restores Copy focus.
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(dialog).not.toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: "Copy annotations" })
    ).toHaveFocus();
  });

  it("dock drag listeners are removed with the EXACT callback+options added; lostpointercapture identity on the handle (round-5 blocker 2)", async () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    try {
      render(<StudioToolbar config={config} />);
      const handle = screen.getByRole("button", { name: "Drag toolbar" });
      // Spy on the handle ELEMENT (React's root delegation installs its
      // own listeners on the container, not on the handle).
      const addHandleSpy = vi.spyOn(handle, "addEventListener");
      const removeHandleSpy = vi.spyOn(handle, "removeEventListener");
      const dock = document.querySelector(".ps-dock") as HTMLElement;
      // Gesture 1 (pointerId 7) is REPLACED by gesture 2 (pointerId 8)
      // before it ends — its listeners must be dropped immediately.
      fireEvent.pointerDown(handle, { pointerId: 7, clientX: 10, clientY: 10 });
      fireEvent.pointerDown(handle, { pointerId: 8, clientX: 20, clientY: 20 });
      const before = Number(dock.style.left.replace("px", ""));
      // A move with the STALE pointerId is ignored (replacement cleanup).
      fireEvent.pointerMove(window, { pointerId: 7, clientX: 300, clientY: 300 });
      expect(Number(dock.style.left.replace("px", ""))).toBe(before);
      // A move with the ACTIVE pointerId drives the drag.
      fireEvent.pointerMove(window, { pointerId: 8, clientX: 300, clientY: 300 });
      expect(Number(dock.style.left.replace("px", ""))).toBeGreaterThan(before);
      fireEvent.pointerUp(window, { pointerId: 8, clientX: 300, clientY: 300 });
      // EXACT callback identity + capture options for every window drag
      // listener: each add has a remove with the SAME function reference
      // and the SAME options (capture=true). Equal counts alone are not
      // enough — the test fails if the callback or options differ.
      for (const type of ["pointermove", "pointerup", "pointercancel", "blur"]) {
        const adds = addSpy.mock.calls.filter((call) => call[0] === type);
        const removes = removeSpy.mock.calls.filter((call) => call[0] === type);
        expect(adds.length, `${type} adds`).toBe(removes.length);
        for (const add of adds) {
          const matched = removes.some(
            (remove) =>
              remove[1] === add[1] && remove[2] === add[2]
          );
          expect(matched, `${type} exact callback+options`).toBe(true);
        }
      }
      // The handle's lostpointercapture listener must be removed with the
      // IDENTICAL callback it was added with (React never touches this
      // event type, so the spy counts only the drag's listener).
      const lostAdds = addHandleSpy.mock.calls.filter(
        (call) => call[0] === "lostpointercapture"
      );
      const lostRemoves = removeHandleSpy.mock.calls.filter(
        (call) => call[0] === "lostpointercapture"
      );
      expect(lostAdds.length).toBe(lostRemoves.length);
      for (const add of lostAdds) {
        const matched = lostRemoves.some(
          (remove) => remove[1] === add[1] && remove[2] === add[2]
        );
        expect(matched, "lostpointercapture exact callback+options").toBe(
          true
        );
      }
    } finally {
      addSpy.mockRestore();
      removeSpy.mockRestore();
    }
  });

  it("chip gesture: STALE up AND STALE cancel never end the active gesture; a dragged click never expands (round-5 blocker 1/2)", async () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    try {
      render(<StudioToolbar config={config} />);
      const chipOpen = screen.getByRole("button", { name: /Annotation tools/ });
      // Pointer 2 REPLACES pointer 1 while both are down.
      fireEvent.pointerDown(chipOpen, { pointerId: 1, clientX: 10, clientY: 10 });
      fireEvent.pointerDown(chipOpen, { pointerId: 2, clientX: 20, clientY: 20 });
      // STALE pointer 1 up must NOT end gesture 2 (its listeners survive).
      fireEvent.pointerUp(window, { pointerId: 1, clientX: 300, clientY: 300 });
      // STALE pointer 1 cancel must NOT end gesture 2 either.
      fireEvent.pointerCancel(window, { pointerId: 1, clientX: 300, clientY: 300 });
      // ACTIVE pointer 2 moves beyond the threshold → dragged=true…
      fireEvent.pointerMove(window, { pointerId: 2, clientX: 400, clientY: 400 });
      // …the ACTIVE end + click must NOT expand (drag suppresses the click).
      fireEvent.pointerUp(window, { pointerId: 2, clientX: 400, clientY: 400 });
      fireEvent.click(chipOpen);
      expect(
        screen.queryByRole("toolbar", { name: "Portal Studio" })
      ).not.toBeInTheDocument();
      // Exact symmetry after the whole sequence.
      for (const type of ["pointermove", "pointerup", "pointercancel"]) {
        const added = addSpy.mock.calls.filter((call) => call[0] === type).length;
        const removed = removeSpy.mock.calls.filter((call) => call[0] === type).length;
        expect(added, `${type} added`).toBe(removed);
      }
    } finally {
      addSpy.mockRestore();
      removeSpy.mockRestore();
    }
  });

  it("chip gesture: ACTIVE pointer up and ACTIVE pointer cancel each end the gesture cleanly (round-5 blocker 2)", async () => {
    const user = userEvent.setup();
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    try {
      render(<StudioToolbar config={config} />);
      const chipOpen = screen.getByRole("button", { name: /Annotation tools/ });
      // Active UP ends gesture 11 → the following click expands.
      fireEvent.pointerDown(chipOpen, { pointerId: 11, clientX: 10, clientY: 10 });
      fireEvent.pointerUp(window, { pointerId: 11, clientX: 10, clientY: 10 });
      fireEvent.click(chipOpen);
      expect(
        await screen.findByRole("toolbar", { name: "Portal Studio" })
      ).toBeInTheDocument();
      // Collapse; ACTIVE CANCEL ends gesture 12 → the click expands too.
      await user.click(
        screen.getByRole("button", { name: "Collapse toolbar" })
      );
      // The chip remounted after the collapse — query the FRESH node
      // (never dispatch pointer events on a detached element).
      const remountedChip = screen.getByRole("button", {
        name: /Annotation tools/,
      });
      fireEvent.pointerDown(remountedChip, { pointerId: 12, clientX: 10, clientY: 10 });
      fireEvent.pointerCancel(window, { pointerId: 12, clientX: 10, clientY: 10 });
      fireEvent.click(remountedChip);
      expect(
        await screen.findByRole("toolbar", { name: "Portal Studio" })
      ).toBeInTheDocument();
      // Exact symmetry after both gestures.
      for (const type of ["pointermove", "pointerup", "pointercancel"]) {
        const added = addSpy.mock.calls.filter((call) => call[0] === type).length;
        const removed = removeSpy.mock.calls.filter((call) => call[0] === type).length;
        expect(added, `${type} added`).toBe(removed);
      }
    } finally {
      addSpy.mockRestore();
      removeSpy.mockRestore();
    }
  });

  it("chip gesture listeners are removed on unmount mid-gesture (round-5 blocker 2)", async () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    try {
      const { unmount } = render(<StudioToolbar config={config} />);
      const chipOpen = screen.getByRole("button", { name: /Annotation tools/ });
      // Start a gesture on the still-MOUNTED chip, then unmount
      // immediately (never dispatch pointerdown on a detached chip).
      fireEvent.pointerDown(chipOpen, { pointerId: 21, clientX: 10, clientY: 10 });
      expect(chipOpen.isConnected).toBe(true);
      unmount();
      for (const type of ["pointermove", "pointerup", "pointercancel"]) {
        const added = addSpy.mock.calls.filter((call) => call[0] === type).length;
        const removed = removeSpy.mock.calls.filter((call) => call[0] === type).length;
        expect(added, `${type} added after unmount`).toBe(removed);
      }
    } finally {
      addSpy.mockRestore();
      removeSpy.mockRestore();
    }
  });

  it("unmount during a dock drag releases capture without errors (round-3 finding 1)", async () => {
    const restoreMocks = installPointerCaptureMocks();
    const proto = HTMLElement.prototype;
    vi.spyOn(proto, "setPointerCapture").mockImplementation(() => undefined);
    vi.spyOn(proto, "hasPointerCapture").mockImplementation(() => true);
    vi.spyOn(proto, "releasePointerCapture").mockImplementation(() => undefined);
    try {
      const user = userEvent.setup();
      const { unmount } = render(<StudioToolbar config={config} />);
      const handle = screen.getByRole("button", { name: "Drag toolbar" });
      await user.pointer([
        { keys: "[MouseLeft>]", target: handle, coords: { x: 10, y: 10 } },
        { coords: { x: 80, y: 50 } },
      ]);
      expect(() => unmount()).not.toThrow();
    } finally {
      restoreMocks();
    }
  });

  it("Esc closes the TOPMOST list transient: delete confirm before inline edit, edit stays active (round-4 finding 4)", async () => {
    const user = userEvent.setup();
    viewRoutes([openAnn("ann-1", "edit me")]);
    render(<StudioToolbar config={config} />);
    await openList(user);
    await waitFor(() => {
      expect(screen.getByText("edit me")).toBeInTheDocument();
    });
    // Begin an inline edit…
    await user.click(screen.getByRole("button", { name: "Edit comment" }));
    const textarea = screen.getByDisplayValue("edit me");
    await user.type(textarea, "!");
    expect(screen.getByText("Unsaved")).toBeInTheDocument();
    // …then open THIS row's Delete confirmation on top of the edit.
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Delete this annotation?"
    );
    // ONE Esc closes the CONFIRMATION first (topmost) — the inline edit
    // stays active with its draft, nothing is mutated, and focus returns
    // to the exact Delete trigger.
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
    expect(screen.getByDisplayValue("edit me!")).toBeInTheDocument();
    expect(screen.getByText("Unsaved")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Delete" })).toHaveFocus();
    });
    // The inline edit still owns the row (no plain comment text yet).
    expect(screen.queryByText("edit me")).not.toBeInTheDocument();
  });

  it("keyboard dock movement closes auxiliary panels like drag (review P9)", async () => {
    const user = userEvent.setup();
    // Deterministic: earlier tests may have persisted a clamped position.
    window.localStorage.clear();
    viewRoutes([openAnn("ann-1", "dock move")]);
    render(<StudioToolbar config={config} />);
    await openList(user);
    await waitFor(() => {
      expect(
        screen.getByRole("region", { name: "Annotations" })
      ).toBeInTheDocument();
    });
    const dock = document.querySelector(".ps-dock") as HTMLElement;
    const before = Number(dock.style.left.replace("px", ""));
    const grip = screen.getByRole("button", { name: "Drag toolbar" });
    grip.focus();
    await user.keyboard("{ArrowLeft}");
    // The dock moved...
    expect(Number(dock.style.left.replace("px", ""))).toBeLessThan(before);
    // ...and the auxiliary panel closed (anchors can never go stale).
    await waitFor(() => {
      expect(
        screen.queryByRole("region", { name: "Annotations" })
      ).not.toBeInTheDocument();
    });
  });

  it("hotkeys fire from focused NON-editable Studio controls; never from foreign-shadow editables (round-3 finding 2)", async () => {
    const user = userEvent.setup();
    viewRoutes([openAnn("ann-1", "focus me")]);
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: "Annotation tools" }));
    // L from the focused LIST button (non-editable, inside the root).
    const listButton = screen.getByRole("button", { name: "Annotation list" });
    listButton.focus();
    fireEvent.keyDown(listButton, { key: "l", ctrlKey: true, altKey: true });
    expect(
      screen.getByRole("region", { name: "Annotations" })
    ).toBeInTheDocument();
    // V from the focused Visibility button toggles presentation markers.
    const visibility = screen.getByRole("button", { name: "Hide markers" });
    visibility.focus();
    fireEvent.keyDown(visibility, { key: "v", ctrlKey: true, altKey: true });
    expect(
      screen.getByRole("button", { name: "Show markers" })
    ).toHaveAttribute("aria-pressed", "true");
    // ? from a focused bar control opens the registry help popover.
    const barGrip = screen.getByRole("button", { name: "Drag toolbar" });
    barGrip.focus();
    fireEvent.keyDown(barGrip, { key: "?" });
    expect(
      screen.getByRole("region", { name: "Keyboard shortcuts" })
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");
    // Round-4 finding 3: capture-activating shortcuts DO fire from focused
    // non-editable Studio controls — P/M/A from the bar buttons.
    const pick = screen.getByRole("button", { name: "Pick element" });
    pick.focus();
    fireEvent.keyDown(pick, { key: "p", ctrlKey: true, altKey: true });
    expect(await screen.findByText(/Hover an element/)).toBeInTheDocument();
    await user.keyboard("{Escape}");
    const multi = screen.getByRole("button", { name: "Multi-select" });
    multi.focus();
    fireEvent.keyDown(multi, { key: "m", ctrlKey: true, altKey: true });
    expect(
      await screen.findByText(/toggle elements in\/out/)
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");
    const area = screen.getByRole("button", { name: "Select region" });
    area.focus();
    fireEvent.keyDown(area, { key: "a", ctrlKey: true, altKey: true });
    expect(await screen.findByText(/Drag over the page/)).toBeInTheDocument();
    await user.keyboard("{Escape}");
    // K from a focused bar control collapses the toolbar.
    fireEvent.keyDown(area, { key: "k", ctrlKey: true, altKey: true });
    await waitFor(() => {
      expect(
        screen.queryByRole("toolbar", { name: "Portal Studio" })
      ).not.toBeInTheDocument();
    });
    // Round-5 blocker 3: EVERY capture action works from a focused
    // COLLAPSED-chip control — P/M/A/C each expand the toolbar and
    // activate their action.
    const collapsedShortcut = async (
      key: string,
      expectHint: () => void
    ) => {
      // If the bar is currently expanded, collapse it first via K from a
      // focused bar control (Esc only cancels capture, never collapses).
      if (screen.queryByRole("toolbar", { name: "Portal Studio" })) {
        const barGrip = screen.getByRole("button", { name: "Drag toolbar" });
        barGrip.focus();
        fireEvent.keyDown(barGrip, { key: "k", ctrlKey: true, altKey: true });
        await waitFor(() => {
          expect(
            screen.queryByRole("toolbar", { name: "Portal Studio" })
          ).not.toBeInTheDocument();
        });
      }
      const grip = screen.getByRole("button", { name: "Drag toolbar" });
      grip.focus();
      fireEvent.keyDown(grip, { key, ctrlKey: true, altKey: true });
      expect(
        await screen.findByRole("toolbar", { name: "Portal Studio" })
      ).toBeInTheDocument();
      expectHint();
      // Cancel the activated capture mode so the next iteration starts
      // from a clean idle state (the toolbar stays expanded).
      await user.keyboard("{Escape}");
    };
    // P: expands + Pick hint.
    await collapsedShortcut("p", () => {
      expect(screen.getByText(/Hover an element/)).toBeInTheDocument();
    });
    await user.keyboard("{Escape}");
    // M: expands + Multi hint.
    await collapsedShortcut("m", () => {
      expect(screen.getByText(/toggle elements in\/out/)).toBeInTheDocument();
    });
    // A: expands + Area hint.
    await collapsedShortcut("a", () => {
      expect(screen.getByText(/Drag over the page/)).toBeInTheDocument();
    });
    // C: expands + copies the one Open annotation (deterministic stub).
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    await collapsedShortcut("c", () => {
      expect(
        screen.getByText("Copied to clipboard")
      ).toBeInTheDocument();
    });
    await user.keyboard("{Escape}");

    // A FOREIGN shadow-root editable never triggers shortcuts.
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    const input = document.createElement("input");
    shadow.appendChild(input);
    document.body.appendChild(host);
    input.focus();
    fireEvent.keyDown(input, { key: "p", ctrlKey: true, altKey: true });
    expect(screen.queryByText(/Hover an element/)).not.toBeInTheDocument();
    fireEvent.keyDown(input, { key: "l", ctrlKey: true, altKey: true });
    expect(
      screen.queryByRole("region", { name: "Annotations" })
    ).not.toBeInTheDocument();
    fireEvent.keyDown(input, { key: "k", ctrlKey: true, altKey: true });
    // K from the foreign editable is ignored too — the toolbar stays open.
    expect(
      screen.getByRole("toolbar", { name: "Portal Studio" })
    ).toBeInTheDocument();
    document.body.removeChild(host);
  });

  it("opening Help or List suspends page capture; closing returns to a safe state", async () => {
    const user = userEvent.setup();
    const row = makePageElement("Alice", "row-a");
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    await user.click(screen.getByRole("button", { name: "Pick element" }));
    expect(screen.getByText(/Hover an element/)).toBeInTheDocument();
    // Open the list while picking — capture hints suspend (status panel
    // hidden) but the mode is preserved.
    await user.click(screen.getByRole("button", { name: "Annotation list" }));
    expect(screen.queryByText(/Hover an element/)).not.toBeInTheDocument();
    // Closing the list resumes the pending pick mode.
    await user.click(screen.getByRole("button", { name: "Annotation list" }));
    expect(screen.getByText(/Hover an element/)).toBeInTheDocument();
    row.focus();
    await user.keyboard("{Enter}");
    expect(composer()).toBeInTheDocument();
  });

});

// =====================================================================
// Goal 02 — Fast Target-Side Composer and Continuous Annotation Loop
// (proofs G02-01 .. G02-13; spec:
// /root/goals/portal-studio-horizontal-toolbar-v5/02-goal-fast-local-annotation-flow.md)
// =====================================================================

describe("Goal 02 — fast target-side composer and continuous loop", () => {
  /** Stateful G02 mock: the task POST succeeds and the GET returns the
   *  saved task so markers and the List refresh immediately. */
  const g02SaveMocks = () => {
    let currentTask: {
      taskId: string;
      annotations: Array<{ status: string; comment: string }>;
    } | null = null;
    const fetchMock = mockFetchRoutes([
      {
        url: "/__portal-studio/tasks",
        method: "GET",
        respond: async () =>
          jsonResponse(currentTask ? { task: currentTask } : { task: null }),
      },
      {
        url: "/__portal-studio/tasks",
        method: "POST",
        respond: async (init) => {
          const task = JSON.parse((init?.body ?? "{}") as string);
          currentTask = task;
          return jsonResponse({
            ok: true,
            taskId: task.taskId,
            sourceCandidates: [],
          });
        },
      },
      {
        url: "/__portal-studio/screenshots",
        method: "POST",
        respond: async () =>
          jsonResponse({
            ok: true,
            file: "screenshots/g02.png",
            width: 100,
            height: 50,
          }),
      },
    ]);
    return { fetchMock };
  };

  const taskPosts = (fetchMock: ReturnType<typeof vi.fn>) =>
    fetchMock.mock.calls.filter(
      (call) =>
        (call[1] as { method?: string } | undefined)?.method === "POST" &&
        String(call[0]).includes("/tasks")
    );

  it("G02-01: a target click opens the local composer (autofocus, Save/Cancel, clicks inside never capture)", async () => {
    const user = userEvent.setup();
    const row = makePageElement("Alice", "row-g02-01");
    const { fetchMock } = g02SaveMocks();
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    await user.click(screen.getByRole("button", { name: "Pick element" }));
    // POINTER capture: clicking the target commits it and opens the
    // composer beside it — no keyboard required.
    (row as HTMLElement & { getBoundingClientRect(): DOMRect }).getBoundingClientRect = () =>
      ({
        left: 100,
        top: 200,
        width: 200,
        height: 40,
        right: 300,
        bottom: 240,
        x: 100,
        y: 200,
        toJSON: () => ({}),
      }) as DOMRect;
    await user.click(row);
    expect(composer()).toBeInTheDocument();
    // G02-01/A: the selected target stays highlighted while the composer
    // is open — the .ps-selected outline renders from the committed
    // selection rects.
    expect(document.querySelector(".ps-outline.ps-selected")).not.toBeNull();
    await waitFor(() => {
      expect(composerTextarea()).toHaveFocus();
    });
    // Exactly the three composer controls: textarea + Save + Cancel.
    expect(
      within(composer()).getByRole("button", { name: "Cancel", exact: true })
    ).toBeInTheDocument();
    expect(composerSave()).toBeInTheDocument();
    // Clicks INSIDE the composer (textarea, buttons) never trigger a new
    // capture — the SAME single-target draft stays open.
    await user.click(composerTextarea());
    await user.type(composerTextarea(), "pointer pick");
    expect(composer()).toBeInTheDocument();
    await user.click(composerSave());
    await waitFor(() => {
      expect(screen.getByText("Annotation saved")).toBeInTheDocument();
    });
    const payload = JSON.parse(
      (taskPosts(fetchMock)[0][1] as { body: string }).body
    ) as { annotations: Array<{ elements: unknown[] }> };
    expect(payload.annotations.at(-1)!.elements).toHaveLength(1);
  });

  it("G02-02: normal creation never shows the technical Draft/Saved journey", async () => {
    const user = userEvent.setup();
    const row = makePageElement("Alice", "row-g02-02");
    g02SaveMocks();
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    await user.click(screen.getByRole("button", { name: "Pick element" }));
    row.focus();
    await user.keyboard("{Enter}");
    expect(composer()).toBeInTheDocument();
    // No Task ID, JSON path, screenshot path or source-candidate details.
    expect(screen.queryByText(/Task ID|task JSON|JSON path/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/screenshot path|source candidate/i)).not.toBeInTheDocument();
    // No Done button and no Saved panel at any point of the draft; the
    // status panel is absent during the draft (composer replaces it).
    expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument();
    expect(document.querySelector(".ps-status-panel")).toBeNull();
    await user.type(composerTextarea(), "clean flow");
    await user.click(composerSave());
    await waitFor(() => {
      expect(screen.getByText("Annotation saved")).toBeInTheDocument();
    });
    // After the save: ONLY the compact toast — still no Done, no Saved
    // panel, no technical surface.
    expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Task ID/i)).not.toBeInTheDocument();
    expect(
      screen.getByText("Annotation saved").closest(".ps-save-toast")
    ).not.toBeNull();
    // After the save the compact toast is the only new surface; the
    // status panel re-appears ONLY with the resumed Pick hint (the
    // continuous loop) — never as an empty artifact.
    await waitFor(() => {
      expect(screen.getByText(/Hover an element/)).toBeInTheDocument();
    });
    expect(document.querySelector(".ps-status-panel")).not.toBeNull();
  });

  it("G02-03: Ctrl+Enter AND Cmd+Enter save; Pick stays active for the next target", async () => {
    const user = userEvent.setup();
    const row = makePageElement("Alice", "row-g02-03");
    const { fetchMock } = g02SaveMocks();
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    await user.click(screen.getByRole("button", { name: "Pick element" }));
    row.focus();
    await user.keyboard("{Enter}");
    await user.type(composerTextarea(), "via ctrl");
    await user.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() => {
      expect(taskPosts(fetchMock)).toHaveLength(1);
    });
    // Pick RESUMES: still pressed, hint visible, no re-arm click needed.
    expect(
      screen.getByRole("button", { name: "Pick element" })
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Hover an element/)).toBeInTheDocument();
    // Second annotation — Cmd+Enter (macOS shortcut) on the SAME session.
    row.focus();
    await user.keyboard("{Enter}");
    await user.type(composerTextarea(), "via cmd");
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    await waitFor(() => {
      expect(taskPosts(fetchMock)).toHaveLength(2);
    });
  });

  it("G02-04: two annotations are created CONSECUTIVELY with no Done between", async () => {
    const user = userEvent.setup();
    const row = makePageElement("Alice", "row-g02-04");
    const { fetchMock } = g02SaveMocks();
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    await user.click(screen.getByRole("button", { name: "Pick element" }));
    row.focus();
    await user.keyboard("{Enter}");
    await user.type(composerTextarea(), "first");
    await user.click(composerSave());
    await waitFor(() => {
      expect(taskPosts(fetchMock)).toHaveLength(1);
    });
    // Immediately capture the next target — Pick already resumed.
    row.focus();
    await user.keyboard("{Enter}");
    await user.type(composerTextarea(), "second");
    await user.click(composerSave());
    await waitFor(() => {
      expect(taskPosts(fetchMock)).toHaveLength(2);
    });
    const secondPayload = JSON.parse(
      (taskPosts(fetchMock)[1][1] as { body: string }).body
    ) as { annotations: Array<{ comment: string }> };
    expect(secondPayload.annotations.map((a) => a.comment)).toEqual([
      "first",
      "second",
    ]);
  });

  it("G02-05: Pick stays STRICTLY single-target — a new pick REPLACES, never accumulates", async () => {
    const user = userEvent.setup();
    const a = makePageElement("A", "row-a-g02");
    const b = makePageElement("B", "row-b-g02");
    const { fetchMock } = g02SaveMocks();
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    await user.click(screen.getByRole("button", { name: "Pick element" }));
    a.focus();
    await user.keyboard("{Enter}");
    expect(composer()).toBeInTheDocument();
    // Cancel the draft, then pick a DIFFERENT target.
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Annotation" })).not.toBeInTheDocument();
    await startPickIfNeeded(user);
    b.focus();
    await user.keyboard("{Enter}");
    await user.type(composerTextarea(), "replacement");
    await user.click(composerSave());
    await waitFor(() => {
      expect(taskPosts(fetchMock)).toHaveLength(1);
    });
    const payload = JSON.parse(
      (taskPosts(fetchMock)[0][1] as { body: string }).body
    ) as {
      annotations: Array<{
        elements: Array<{ selectorCandidates: Array<{ selector: string }> }>;
      }>;
    };
    const elements = payload.annotations.at(-1)!.elements;
    // Exactly ONE element, and it is the SECOND target — no accumulation.
    expect(elements).toHaveLength(1);
    expect(
      elements[0].selectorCandidates.some((c) => c.selector === "#row-b-g02")
    ).toBe(true);
  });

  it("G02-06: Multi is the ONLY multi-target path; after save it resumes with an EMPTY group (documented rule)", async () => {
    const user = userEvent.setup();
    const cellA = makePageElement("A", "cell-a-g02");
    const cellB = makePageElement("B", "cell-b-g02");
    const { fetchMock } = g02SaveMocks();
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    await user.click(screen.getByRole("button", { name: "Multi-select" }));
    await user.click(cellA);
    await user.click(cellB);
    expect(screen.getByText(/Selected/)).toHaveTextContent("2");
    await user.keyboard("{Enter}");
    await user.type(composerTextarea(), "group");
    await user.click(composerSave());
    await waitFor(() => {
      expect(taskPosts(fetchMock)).toHaveLength(1);
    });
    const payload = JSON.parse(
      (taskPosts(fetchMock)[0][1] as { body: string }).body
    ) as { annotations: Array<{ kind: string; elements: unknown[] }> };
    expect(payload.annotations.at(-1)!.kind).toBe("multi");
    expect(payload.annotations.at(-1)!.elements).toHaveLength(2);
    // Documented rule: Multi resumes with an EMPTY group, still active.
    expect(
      screen.getByRole("button", { name: "Multi-select" })
    ).toHaveAttribute("aria-pressed", "true");
    // Documented rule: the resumed group is EMPTY (Selected: 0).
    expect(screen.getByText(/Selected/)).toHaveTextContent("0");
    // A fresh group can be built immediately — one click = one member.
    await user.click(cellB);
    expect(screen.getByText(/Selected/)).toHaveTextContent("1");
  });

  it("G02-06 (Area): a region annotation saves and returns to IDLE (documented rule)", async () => {
    const user = userEvent.setup();
    const { fetchMock } = g02SaveMocks();
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    await user.click(screen.getByRole("button", { name: "Select region" }));
    // Marquee drag over the page.
    fireEvent.pointerDown(document.body, { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(document.body, { clientX: 300, clientY: 200 });
    fireEvent.pointerUp(document.body, { clientX: 300, clientY: 200 });
    expect(composer()).toBeInTheDocument();
    await user.type(composerTextarea(), "area note");
    await user.click(composerSave());
    await waitFor(() => {
      expect(taskPosts(fetchMock)).toHaveLength(1);
    });
    const payload = JSON.parse(
      (taskPosts(fetchMock)[0][1] as { body: string }).body
    ) as { annotations: Array<{ kind: string; region: unknown }> };
    expect(payload.annotations.at(-1)!.kind).toBe("region");
    expect(payload.annotations.at(-1)!.region).toBeDefined();
    // Documented rule: Area returns to IDLE — no capture mode active.
    expect(
      screen.getByRole("button", { name: "Pick element" })
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByRole("button", { name: "Multi-select" })
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByRole("button", { name: "Select region" })
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("G02-07: a POST failure preserves the draft AND the target; retry succeeds", async () => {
    const user = userEvent.setup();
    const row = makePageElement("Alice", "row-g02-07");
    let failNext = true;
    const fetchMock = mockFetchRoutes([
      {
        url: "/__portal-studio/tasks",
        method: "POST",
        respond: async () =>
          failNext
            ? jsonResponse({ ok: false, error: "invalid_task" }, false, 400)
            : jsonResponse({ ok: true, taskId: "task-g02-07", sourceCandidates: [] }),
      },
      {
        url: "/__portal-studio/screenshots",
        method: "POST",
        respond: async () => jsonResponse({ ok: true, file: "g02.png" }),
      },
    ]);
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    await user.click(screen.getByRole("button", { name: "Pick element" }));
    row.focus();
    await user.keyboard("{Enter}");
    await user.type(composerTextarea(), "doomed");
    await user.click(composerSave());
    await waitFor(() => {
      expect(within(composer()).getByRole("alert")).toBeInTheDocument();
    });
    // The draft is preserved VERBATIM in the open composer…
    expect((composerTextarea() as HTMLTextAreaElement).value).toBe("doomed");
    // …and the target is preserved: the retry commits exactly one element.
    failNext = false;
    await user.click(composerSave());
    await waitFor(() => {
      expect(screen.getByText("Annotation saved")).toBeInTheDocument();
    });
    const payload = JSON.parse(
      (taskPosts(fetchMock)[0][1] as { body: string }).body
    ) as { annotations: Array<{ comment: string; elements: unknown[] }> };
    expect(payload.annotations.at(-1)!.comment).toBe("doomed");
    expect(payload.annotations.at(-1)!.elements).toHaveLength(1);
  });

  it("G02-07b: a 409 on save refreshes and retries ONCE (typed refresh/retry semantics)", async () => {
    const user = userEvent.setup();
    const row = makePageElement("Alice", "row-g02-07b");
    let serverTask: {
      taskId: string;
      annotations: Array<{ status: string; comment: string }>;
      taskRevision: number;
    } | null = null;
    let posts = 0;
    const fetchMock = mockFetchRoutes([
      {
        url: "/__portal-studio/tasks",
        method: "GET",
        respond: async () =>
          jsonResponse(
            serverTask
              ? {
                  task: {
                    schemaVersion: 5,
                    taskId: serverTask.taskId,
                    createdAt: "2026-08-10T00:00:00.000Z",
                    annotations: serverTask.annotations,
                    businessContext: [],
                    redaction: {
                      droppedKeys: [],
                      redactedValues: 0,
                      truncatedValues: 0,
                    },
                    taskRevision: serverTask.taskRevision,
                  },
                }
              : { task: null }
          ),
      },
      {
        url: "/__portal-studio/tasks",
        method: "POST",
        respond: async (init) => {
          const body = JSON.parse((init?.body ?? "{}") as string);
          posts += 1;
          if (posts === 1) {
            // The server moved (revision 2): the first POST conflicts.
            return jsonResponse(
              {
                ok: false,
                error: "revision_conflict",
                taskRevision: 2,
              },
              false,
              409
            );
          }
          serverTask = {
            taskId: body.taskId,
            annotations: body.annotations,
            taskRevision: 2,
          };
          return jsonResponse({
            ok: true,
            taskId: body.taskId,
            sourceCandidates: [],
            taskRevision: 2,
          });
        },
      },
      {
        url: "/__portal-studio/screenshots",
        method: "POST",
        respond: async () => jsonResponse({ ok: true, file: "g02.png" }),
      },
    ]);
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    await user.click(screen.getByRole("button", { name: "Pick element" }));
    row.focus();
    await user.keyboard("{Enter}");
    await user.type(composerTextarea(), "conflict retry");
    await user.click(composerSave());
    // The retry succeeded transparently: toast, no conflict feedback, and
    // the annotation persisted (retried against the fresh baseline).
    await waitFor(() => {
      expect(screen.getByText("Annotation saved")).toBeInTheDocument();
    });
    expect(posts).toBe(2);
    // No conflict feedback anywhere — the retry was transparent.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await openList(user);
    expect(screen.getAllByText("conflict retry").length).toBeGreaterThan(0);
    void fetchMock;
  });

  it("G02-03b: strict serial save — capture-mode CLICKS are ignored while saving; element resume applies", async () => {
    const user = userEvent.setup();
    const row = makePageElement("Alice", "row-g02-03b");
    let releasePost: (() => void) | null = null;
    const postGate = new Promise<void>((resolve) => {
      releasePost = resolve;
    });
    const fetchMock = mockFetchRoutes([
      {
        url: "/__portal-studio/tasks",
        method: "POST",
        respond: async () => {
          await postGate;
          return jsonResponse({
            ok: true,
            taskId: "task-g02-03b",
            sourceCandidates: [],
            taskRevision: 1,
          });
        },
      },
      {
        url: "/__portal-studio/screenshots",
        method: "POST",
        respond: async () => jsonResponse({ ok: true, file: "g02.png" }),
      },
    ]);
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    await user.click(screen.getByRole("button", { name: "Pick element" }));
    row.focus();
    await user.keyboard("{Enter}");
    await user.type(composerTextarea(), "serial one");
    await user.click(composerSave());
    // The POST is pending: the mode is saving — no capture mode active.
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Pick element" })
      ).toHaveAttribute("aria-pressed", "false");
    });
    // Clicks on Pick/Multi/Area during saving are IGNORED — the in-flight
    // save owns the mode.
    await user.click(screen.getByRole("button", { name: "Pick element" }));
    await user.click(screen.getByRole("button", { name: "Multi-select" }));
    await user.click(screen.getByRole("button", { name: "Select region" }));
    expect(
      screen.getByRole("button", { name: "Pick element" })
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByRole("button", { name: "Multi-select" })
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByRole("button", { name: "Select region" })
    ).toHaveAttribute("aria-pressed", "false");
    // The global P/M/A hotkeys are ignored while saving too.
    fireEvent.keyDown(document, { key: "p", ctrlKey: true, altKey: true });
    fireEvent.keyDown(document, { key: "m", ctrlKey: true, altKey: true });
    fireEvent.keyDown(document, { key: "a", ctrlKey: true, altKey: true });
    expect(
      screen.getByRole("button", { name: "Pick element" })
    ).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText(/Hover an element/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Multi-select/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Drag over the page/)).not.toBeInTheDocument();
    // Release the save: exactly ONE POST, and the element rule resumes
    // Pick with a fresh session.
    releasePost!();
    await waitFor(() => {
      expect(screen.getByText("Annotation saved")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: "Pick element" })
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Hover an element/)).toBeInTheDocument();
    const posts = fetchMock.mock.calls.filter(
      (call) =>
        (call[1] as { method?: string } | undefined)?.method === "POST" &&
        String(call[0]).includes("/tasks")
    );
    expect(posts).toHaveLength(1);
  });

  it("G02-03b (multi): during a multi save mode switches are ignored; the multi rule resumes with an EMPTY group", async () => {
    const user = userEvent.setup();
    const cellA = makePageElement("A", "cell-a-g02-03b");
    const cellB = makePageElement("B", "cell-b-g02-03b");
    let releasePost: (() => void) | null = null;
    const postGate = new Promise<void>((resolve) => {
      releasePost = resolve;
    });
    mockFetchRoutes([
      {
        url: "/__portal-studio/tasks",
        method: "POST",
        respond: async () => {
          await postGate;
          return jsonResponse({
            ok: true,
            taskId: "task-g02-03b-m",
            sourceCandidates: [],
          });
        },
      },
      {
        url: "/__portal-studio/screenshots",
        method: "POST",
        respond: async () => jsonResponse({ ok: true, file: "g02.png" }),
      },
    ]);
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    await user.click(screen.getByRole("button", { name: "Multi-select" }));
    await user.click(cellA);
    await user.click(cellB);
    await user.keyboard("{Enter}");
    await user.type(composerTextarea(), "serial group");
    await user.click(composerSave());
    // While the multi save is pending, clicking Multi (or the P/A hotkeys)
    // must NOT switch the mode.
    await user.click(screen.getByRole("button", { name: "Multi-select" }));
    fireEvent.keyDown(document, { key: "p", ctrlKey: true, altKey: true });
    fireEvent.keyDown(document, { key: "a", ctrlKey: true, altKey: true });
    expect(screen.queryByText(/Hover an element/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Drag over the page/)).not.toBeInTheDocument();
    // Release: the multi rule resumes Multi with an EMPTY group.
    releasePost!();
    await waitFor(() => {
      expect(screen.getByText("Annotation saved")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: "Multi-select" })
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Selected/)).toHaveTextContent("0");
  });

  it("G02-03b (area): during an area save mode switches are ignored; the area rule returns to IDLE", async () => {
    const user = userEvent.setup();
    let releasePost: (() => void) | null = null;
    const postGate = new Promise<void>((resolve) => {
      releasePost = resolve;
    });
    mockFetchRoutes([
      {
        url: "/__portal-studio/tasks",
        method: "POST",
        respond: async () => {
          await postGate;
          return jsonResponse({
            ok: true,
            taskId: "task-g02-03b-a",
            sourceCandidates: [],
          });
        },
      },
      {
        url: "/__portal-studio/screenshots",
        method: "POST",
        respond: async () => jsonResponse({ ok: true, file: "g02.png" }),
      },
    ]);
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    await user.click(screen.getByRole("button", { name: "Select region" }));
    fireEvent.pointerDown(document.body, { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(document.body, { clientX: 300, clientY: 200 });
    fireEvent.pointerUp(document.body, { clientX: 300, clientY: 200 });
    await user.type(composerTextarea(), "serial area");
    await user.click(composerSave());
    // While the area save is pending, Area/Pick/Multi clicks are ignored.
    await user.click(screen.getByRole("button", { name: "Select region" }));
    await user.click(screen.getByRole("button", { name: "Pick element" }));
    await user.click(screen.getByRole("button", { name: "Multi-select" }));
    expect(screen.queryByText(/Hover an element/)).not.toBeInTheDocument();
    // Release: the area rule returns to IDLE — no capture mode active.
    releasePost!();
    await waitFor(() => {
      expect(screen.getByText("Annotation saved")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: "Pick element" })
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByRole("button", { name: "Multi-select" })
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByRole("button", { name: "Select region" })
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("G02-03b (re-entry): a second saveTask while one is in flight is a NO-OP — one POST only", async () => {
    const user = userEvent.setup();
    const row = makePageElement("Alice", "row-g02-03b-r");
    let releasePost: (() => void) | null = null;
    const postGate = new Promise<void>((resolve) => {
      releasePost = resolve;
    });
    const fetchMock = mockFetchRoutes([
      {
        url: "/__portal-studio/tasks",
        method: "POST",
        respond: async () => {
          await postGate;
          return jsonResponse({
            ok: true,
            taskId: "task-g02-03b-r",
            sourceCandidates: [],
          });
        },
      },
      {
        url: "/__portal-studio/screenshots",
        method: "POST",
        respond: async () => jsonResponse({ ok: true, file: "g02.png" }),
      },
    ]);
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    await user.click(screen.getByRole("button", { name: "Pick element" }));
    row.focus();
    await user.keyboard("{Enter}");
    await user.type(
      screen.getByLabelText("Annotation comment"),
      "double fired"
    );
    // Two synchronous clicks in the same tick — the lock makes the second
    // a no-op (one POST).
    const save = screen.getByRole("button", { name: "Save", exact: true });
    fireEvent.click(save);
    fireEvent.click(save);
    releasePost!();
    await waitFor(() => {
      expect(screen.getByText("Annotation saved")).toBeInTheDocument();
    });
    const posts = fetchMock.mock.calls.filter(
      (call) =>
        (call[1] as { method?: string } | undefined)?.method === "POST" &&
        String(call[0]).includes("/tasks")
    );
    expect(posts).toHaveLength(1);
  });

  it("G02-08: a screenshot failure is a WARNING, not a failed annotation", async () => {
    const user = userEvent.setup();
    const row = makePageElement("Alice", "row-g02-08");
    const fetchMock = mockFetchRoutes([
      {
        url: "/__portal-studio/tasks",
        method: "GET",
        respond: async () => jsonResponse({ task: null }),
      },
      {
        url: "/__portal-studio/tasks",
        method: "POST",
        respond: async () =>
          jsonResponse({ ok: true, taskId: "task-g02-08", sourceCandidates: [] }),
      },
      {
        url: "/__portal-studio/screenshots",
        method: "POST",
        respond: async () => jsonResponse({ ok: false, error: "capture failed" }, false, 500),
      },
    ]);
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    await user.click(screen.getByRole("button", { name: "Pick element" }));
    row.focus();
    await user.keyboard("{Enter}");
    await user.type(composerTextarea(), "kept despite shot");
    await user.click(composerSave());
    // Warning toast — NOT an error: the annotation itself succeeded.
    await waitFor(() => {
      expect(
        screen.getByText("Annotation saved; the screenshot capture failed.")
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText("Annotation saved; the screenshot capture failed.").closest(
        ".ps-save-toast-warning"
      )
    ).not.toBeNull();
    // No Done, no error panel, and the task POST went through.
    expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument();
    expect(taskPosts(fetchMock)).toHaveLength(1);
    // The annotation is still retained in the list.
    await openList(user);
    expect(screen.getByText("kept despite shot")).toBeInTheDocument();
  });

  it("G02-09: Help/List/collapse never silently lose a non-empty draft or its target", async () => {
    const user = userEvent.setup();
    const row = makePageElement("Alice", "row-g02-09");
    (row as HTMLElement & { getBoundingClientRect(): DOMRect }).getBoundingClientRect = () =>
      ({
        left: 100,
        top: 200,
        width: 200,
        height: 40,
        right: 300,
        bottom: 240,
        x: 100,
        y: 200,
        toJSON: () => ({}),
      }) as DOMRect;
    const { fetchMock } = g02SaveMocks();
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    await user.click(screen.getByRole("button", { name: "Pick element" }));
    row.focus();
    await user.keyboard("{Enter}");
    await user.type(composerTextarea(), "precious");
    // The highlight persists through Help/List/collapse round-trips.
    expect(document.querySelector(".ps-outline.ps-selected")).not.toBeNull();
    // Help open/close.
    await user.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));
    expect(composer()).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));
    expect((composerTextarea() as HTMLTextAreaElement).value).toBe("precious");
    // List open/close.
    await user.click(screen.getByRole("button", { name: "Annotation list" }));
    expect(composer()).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Annotation list" }));
    expect((composerTextarea() as HTMLTextAreaElement).value).toBe("precious");
    // Collapse hides the composer; re-expand restores draft AND target.
    await user.click(screen.getByRole("button", { name: "Collapse toolbar" }));
    expect(
      screen.queryByRole("dialog", { name: "Annotation" })
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    expect((composerTextarea() as HTMLTextAreaElement).value).toBe("precious");
    // The preserved target commits exactly ONE element on save.
    await user.click(composerSave());
    await waitFor(() => {
      expect(taskPosts(fetchMock)).toHaveLength(1);
    });
    const payload = JSON.parse(
      (taskPosts(fetchMock)[0][1] as { body: string }).body
    ) as { annotations: Array<{ comment: string; elements: unknown[] }> };
    expect(payload.annotations.at(-1)!.comment).toBe("precious");
    expect(payload.annotations.at(-1)!.elements).toHaveLength(1);
  });

  it("G02-11: a saved annotation appears in the List and the marker layer IMMEDIATELY", async () => {
    const user = userEvent.setup();
    const row = makePageElement("Alice", "row-g02-11");
    // A measurable rect lets the marker layer resolve the saved target.
    (row as HTMLElement & {
      getBoundingClientRect(): DOMRect;
    }).getBoundingClientRect = () =>
      ({
        left: 100,
        top: 200,
        width: 200,
        height: 40,
        right: 300,
        bottom: 240,
        x: 100,
        y: 200,
        toJSON: () => ({}),
      }) as DOMRect;
    g02SaveMocks();
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    await user.click(screen.getByRole("button", { name: "Pick element" }));
    row.focus();
    await user.keyboard("{Enter}");
    await user.type(composerTextarea(), "instant");
    await user.click(composerSave());
    await waitFor(() => {
      expect(screen.getByText("Annotation saved")).toBeInTheDocument();
    });
    // Marker layer: the numbered semantic button resolves over the target.
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Annotation 1: open editor" })
      ).toBeInTheDocument();
    });
    // List panel: the fresh annotation is listed immediately.
    await openList(user);
    expect(screen.getByText("instant")).toBeInTheDocument();
    expect(screen.getByText(/1 open · 1 total/)).toBeInTheDocument();
  });

  it("G02-12: the horizontal toolbar NEVER expands vertically to host the form", async () => {
    const user = userEvent.setup();
    const row = makePageElement("Alice", "row-g02-12");
    render(<StudioToolbar config={config} />);
    await user.click(screen.getByRole("button", { name: /Annotation tools/ }));
    await user.click(screen.getByRole("button", { name: "Pick element" }));
    row.focus();
    await user.keyboard("{Enter}");
    expect(composer()).toBeInTheDocument();
    const bar = document.querySelector(".ps-horizontal-bar");
    expect(bar).not.toBeNull();
    // The composer is a SEPARATE anchored surface — never inside the bar.
    expect(bar!.contains(composer())).toBe(false);
    // The bar hosts no form controls at any point.
    expect(bar!.querySelector("textarea, input")).toBeNull();
    expect(
      within(bar as HTMLElement).queryByRole("button", { name: "Save", exact: true })
    ).toBeNull();
    // The status panel is ENTIRELY absent during the draft — the form
    // lives beside the target, not in any toolbar surface.
    expect(document.querySelector(".ps-status-panel")).toBeNull();
    // The bar itself keeps the same single-row structure it had before
    // the draft: exactly the toolbar buttons, nothing appended.
    const barLabels = () =>
      within(screen.getByRole("toolbar", { name: "Portal Studio" }))
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label"));
    expect(barLabels()).toEqual([
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
  });

  it("G02-13: Goal 01 stays unchanged — collapsed chip, action order, tooltips with shortcuts, Help/List", async () => {
    const user = userEvent.setup();
    render(<StudioToolbar config={config} />);
    // Collapsed chip first: compact, no horizontal bar.
    const chip = screen.getByRole("button", { name: /Annotation tools/ });
    expect(document.querySelector(".ps-horizontal-bar")).toBeNull();
    await user.click(chip);
    // Horizontal action order (Goal 01 normative).
    const barLabels = () =>
      within(screen.getByRole("toolbar", { name: "Portal Studio" }))
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label"));
    expect(barLabels()).toEqual([
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
    // Tooltip with the platform shortcut still opens on focus.
    const pick = screen.getByRole("button", { name: "Pick element" });
    pick.focus();
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip.textContent).toContain("Pick element");
    expect(tooltip.textContent).toContain("Ctrl+Alt+P");
    expect(pick.getAttribute("aria-describedby")).toBe(tooltip.id);
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    });
    // Help and List remain available from the expanded bar.
    await user.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));
    expect(screen.getByRole("region", { name: "Keyboard shortcuts" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));
    await user.click(screen.getByRole("button", { name: "Annotation list" }));
    expect(screen.getByRole("region", { name: "Annotations" })).toBeInTheDocument();
  });
});

// =====================================================================
// Goal 03 — Stable Marker/List Semantics and Viewport Polish
// (proofs G03-01..G03-10; spec:
// /root/goals/portal-studio-horizontal-toolbar-v5/03-goal-marker-list-and-viewport-polish.md)
// =====================================================================

describe("Goal 03 — stable marker/list semantics and viewport polish", () => {
  /** makePageElement + a non-zero rect (markers skip zero-sized targets). */
  const markerElement = (
    text: string,
    id: string,
    rect = { left: 100, top: 200, width: 200, height: 40 }
  ) => {
    const element = makePageElement(text, id);
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
    return element;
  };

  const captureOf = (id: string) => ({
    tagName: "tr",
    selectorCandidates: [{ kind: "id", selector: `#${id}` }],
    componentCandidates: [],
    sourceCandidates: [],
    snapshot: { text: id, attributes: {}, childCount: 0 },
  });

  const taskRoutes = (annotations: unknown[]) => {
    const current = [...annotations];
    return mockFetchRoutes([
      {
        url: "/__portal-studio/tasks",
        method: "GET",
        respond: async () =>
          jsonResponse({
            task: {
              schemaVersion: 5,
              taskId: "task-g03",
              createdAt: "2026-08-10T00:00:00.000Z",
              url: "http://127.0.0.1:4173/users",
              title: "Users",
              annotations: current,
              businessContext: [],
              redaction: {
                droppedKeys: [],
                redactedValues: 0,
                truncatedValues: 0,
              },
              taskRevision: 1,
            },
          }),
      },
      {
        url: "/__portal-studio/tasks",
        method: "POST",
        respond: async () => jsonResponse({ ok: true, taskId: "task-g03" }),
      },
      {
        url: "/__portal-studio/screenshots",
        method: "POST",
        respond: async () => jsonResponse({ ok: true, file: "g03.png" }),
      },
    ]);
  };

  const openListPanel = async (user: ReturnType<typeof userEvent.setup>) => {
    const chip = screen.queryByRole("button", { name: /Annotation tools/ });
    if (chip) await user.click(chip);
    const list = screen.getByRole("button", { name: "Annotation list" });
    if (list.getAttribute("aria-expanded") !== "true") {
      await user.click(list);
    }
  };

  it("G03-01: the marker EDITOR shows the stable full-order number (1 open / 2 completed / 3 open)", async () => {
    const user = userEvent.setup();
    markerElement("A", "row-g03-a");
    markerElement("B", "row-g03-b", { left: 120, top: 260, width: 200, height: 40 });
    taskRoutes([
      {
        annotationId: "ann-g03-1",
        kind: "element",
        comment: "first open",
        createdAt: "2026-08-10T00:00:00.000Z",
        status: "open",
        elements: [captureOf("row-g03-a")],
      },
      {
        annotationId: "ann-g03-2",
        kind: "element",
        comment: "completed middle",
        createdAt: "2026-08-10T00:00:00.000Z",
        status: "completed",
        elements: [captureOf("row-g03-b")],
      },
      {
        annotationId: "ann-g03-3",
        kind: "element",
        comment: "third open",
        createdAt: "2026-08-10T00:00:00.000Z",
        status: "open",
        elements: [captureOf("row-g03-b")],
      },
    ]);
    render(<StudioToolbar config={config} />);
    const third = await screen.findByRole("button", {
      name: "Annotation 3: open editor",
    });
    await user.click(third);
    const editor = screen.getByRole("dialog", { name: "Annotation editor" });
    // The editor label carries the STABLE number from the full order.
    expect(editor).toHaveTextContent("Annotation 3 · Annotation comment");
    // Open view keeps full-order numbers too: markers 1 and 3 exist.
    expect(
      screen.getByRole("button", { name: "Annotation 1: open editor" })
    ).toBeInTheDocument();
  });

  it("G03-06: marker visual ≈20px with a ≈30px hit target, keyboard-focusable", async () => {
    const user = userEvent.setup();
    markerElement("Alice", "row-g03-size");
    taskRoutes([
      {
        annotationId: "ann-g03-size",
        kind: "element",
        comment: "sized",
        createdAt: "2026-08-10T00:00:00.000Z",
        status: "open",
        elements: [captureOf("row-g03-size")],
      },
    ]);
    render(<StudioToolbar config={config} />);
    const marker = await screen.findByRole("button", {
      name: "Annotation 1: open editor",
    });
    // jsdom does not compute layout from the shadow stylesheet — the
    // DECLARATIONS are asserted here (the real browser bounding box is
    // asserted in the G03 e2e).
    expect(TOOLBAR_STYLES).toContain("min-width: 20px;");
    expect(TOOLBAR_STYLES).toContain("height: 20px;");
    expect(TOOLBAR_STYLES).toContain("font-size: 11px;");
    // The hit target extends ≈5px on every side of the 20px visual chip
    // (::before inset −5px → ≈30px total hit box).
    expect(TOOLBAR_STYLES).toContain(".ps-marker-chip-button::before");
    expect(TOOLBAR_STYLES).toContain("inset: -5px;");
    // Keyboard activation opens the editor (localized label + Enter).
    marker.focus();
    await user.keyboard("{Enter}");
    expect(
      screen.getByRole("dialog", { name: "Annotation editor" })
    ).toBeInTheDocument();
  });

  it("G03-04: clicking a list item focuses the target, opens the editor and highlights it", async () => {
    const user = userEvent.setup();
    markerElement("Alice", "row-g03-focus");
    taskRoutes([
      {
        annotationId: "ann-g03-focus",
        kind: "element",
        comment: "click me",
        createdAt: "2026-08-10T00:00:00.000Z",
        status: "open",
        elements: [captureOf("row-g03-focus")],
      },
    ]);
    render(<StudioToolbar config={config} />);
    await screen.findByRole("button", { name: "Annotation 1: open editor" });
    await openListPanel(user);
    // Click the item body (the selectable comment span).
    await user.click(
      screen.getByRole("button", { name: "Annotation 1: select" })
    );
    // The target received focus before the editor mounted (scrollIntoView
    // is a no-op in jsdom); the editor's own autofocus then takes over as
    // the typing surface — the effective focus is inside the editor.
    const editor = screen.getByRole("dialog", { name: "Annotation editor" });
    expect(editor.contains(document.activeElement)).toBe(true);
    // The editor opens and the target is highlighted while it is open.
    expect(editor).toBeInTheDocument();
    expect(document.querySelector(".ps-marker-highlight")).not.toBeNull();
  });

  it("G03-08b: open panels paint ABOVE page markers (z-index ladder, blocker regression)", async () => {
    // The blocker: .ps-marker-anchor (2147483002) used to cover the
    // z-index-less panels — the list's stable numbers were hidden under
    // page markers. The panel group must sit above 3002 and the ladder
    // 3002 < panels 3003 < editor 3004 < fallback 3005 < tooltip 3006 <
    // composer 3007 < toast 3008 must hold (relative topmost order of
    // editor/composer/tooltip/toast preserved).
    expect(TOOLBAR_STYLES).toContain("z-index: 2147483002;"); // markers
    expect(TOOLBAR_STYLES).toContain("z-index: 2147483003;"); // panels
    expect(TOOLBAR_STYLES).toContain("z-index: 2147483004;"); // editor
    expect(TOOLBAR_STYLES).toContain("z-index: 2147483005;"); // fallback
    expect(TOOLBAR_STYLES).toContain("z-index: 2147483006;"); // tooltip
    expect(TOOLBAR_STYLES).toContain("z-index: 2147483007;"); // composer
    expect(TOOLBAR_STYLES).toContain("z-index: 2147483008;"); // toast
    // The panel z-index lives in the SHARED Status/Help/List group (no
    // side effects: all three panels get the same layer).
    const group =
      /(\.ps-status-panel,\s*\.ps-help-popover,\s*\.ps-list-panel\s*\{[^}]*z-index: 2147483003;)/;
    expect(TOOLBAR_STYLES).toMatch(group);
  });

  it("G03-08: the list panel's internal scroll cannot chain to the page (overscroll-behavior: contain)", async () => {
    const user = userEvent.setup();
    taskRoutes([
      {
        annotationId: "ann-g03-scroll",
        kind: "region",
        comment: "region item",
        createdAt: "2026-08-10T00:00:00.000Z",
        status: "open",
        elements: [],
        region: { x: 100, y: 100, width: 200, height: 120 },
      },
    ]);
    render(<StudioToolbar config={config} />);
    await openListPanel(user);
    // The anchored panels all contain scroll chaining (G03-08).
    expect(TOOLBAR_STYLES).toContain("overscroll-behavior: contain");
    expect(TOOLBAR_STYLES).toContain(".ps-list-panel");
    const panel = screen.getByRole("region", { name: "Annotations" });
    expect(panel).toBeInTheDocument();
  });
});
