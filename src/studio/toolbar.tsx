/**
 * Portal Studio — Shadow DOM toolbar (schema v2).
 *
 * Dev-only client UI rendered inside a shadow root (see `index.tsx`). Plain
 * semantic HTML + scoped styles. Interactions: single pick (click/Enter),
 * Shift+click or Shift+Enter multi-select, drag marquee region selection,
 * replace (a new plain pick replaces the selection), clear task, and an
 * annotated screenshot taken at save time. Keyboard accessible: Tab reaches
 * the floating button, the panel traps focus, Esc cancels, arrow keys move
 * between the hovered element and its ancestors while picking.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

import { translate } from "@nocobase/portal-sdk/i18n";

import { sessionErrorMessage } from "./errors";

import {
  captureSelection,
  collectTargetStack,
  isStudioElement,
  readHostComponentName,
} from "./capture";
import { sharedDiagnosticsBuffer, snapshotDiagnostics } from "./diagnostics";
import { captureViewportPng } from "./screenshot";
import { newTaskId } from "./task-id";
import {
  commitRegion,
  EMPTY_SELECTION,
  normalizeRegion,
  replaceSelection,
  toggleInSelection,
  type SelectionState,
} from "./selection";
import {
  TASK_SCHEMA_VERSION,
  type BusinessContextItem,
  type ElementCapture,
  type PortalStudioTask,
  type Region,
  type SourceCandidate,
} from "./types";

export type PortalStudioConfig = {
  token: string;
  endpoint: string;
  screenshotsEndpoint?: string;
};

export type PortalStudioSaveResult = {
  ok: boolean;
  taskId?: string;
  file?: string;
  sourceCandidates?: SourceCandidate[];
  error?: string;
};

const t = (key: string, fallback: string) =>
  translate(key, { ns: "starter" }, fallback);

const STACK_DEPTH = 4;
const MAX_REGION_SCAN_ELEMENTS = 5000;

type ToolbarMode =
  | { kind: "idle" }
  | { kind: "picking"; stack: Element[]; index: number }
  | { kind: "marquee"; start: { x: number; y: number }; current: { x: number; y: number } }
  | {
      kind: "draft";
      capture: {
        elements: ElementCapture[];
        businessContext: BusinessContextItem[];
        region?: Region;
      };
    }
  | { kind: "saving" }
  | {
      kind: "saved";
      taskId: string;
      file?: string;
      screenshot?: string;
      sources: SourceCandidate[];
    }
  | { kind: "cleared" }
  | { kind: "error"; message: string };

const findFocusable = (root: HTMLElement) =>
  Array.from(
    root.querySelectorAll<HTMLElement>(
      'button, textarea, [href], input, [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => !element.hasAttribute("disabled"));

const rectStyle = (rect: DOMRect | undefined): CSSProperties => {
  if (!rect) return { display: "none" };
  return {
    display: "block",
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
};

const regionStyle = (region: Region | undefined): CSSProperties => {
  if (!region) return { display: "none" };
  return {
    display: "block",
    left: region.x,
    top: region.y,
    width: region.width,
    height: region.height,
  };
};

const toRegion = (mode: ToolbarMode): Region | undefined => {
  if (mode.kind !== "marquee") return undefined;
  return normalizeRegion(
    {
      x: Math.min(mode.start.x, mode.current.x),
      y: Math.min(mode.start.y, mode.current.y),
      width: Math.abs(mode.current.x - mode.start.x),
      height: Math.abs(mode.current.y - mode.start.y),
    },
    { width: window.innerWidth, height: window.innerHeight }
  );
};

const collectRegionCandidates = (): Element[] => {
  const body = document.body;
  if (!body) return [];
  const candidates: Element[] = [];
  for (const element of Array.from(body.querySelectorAll("*"))) {
    if (candidates.length >= MAX_REGION_SCAN_ELEMENTS) break;
    candidates.push(element);
  }
  return candidates;
};

export function StudioToolbar({
  config,
}: {
  config: PortalStudioConfig;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ToolbarMode>({ kind: "idle" });
  const [instruction, setInstruction] = useState("");
  const [outlineRect, setOutlineRect] = useState<DOMRect>();
  const [hoverName, setHoverName] = useState<string | null>(null);
  const [selectionRects, setSelectionRects] = useState<DOMRect[]>([]);
  const [selectionCount, setSelectionCount] = useState(0);
  const [revisionStatus, setRevisionStatus] = useState<{
    sourceRevision?: string;
    browserRevision?: number;
    state?: string;
  }>();
  const selectionRef = useRef<SelectionState>(EMPTY_SELECTION);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const picking = mode.kind === "picking";
  const isIdle = mode.kind === "idle";
  const isMarquee = mode.kind === "marquee";

  const refreshSelectionRects = useCallback(() => {
    setSelectionRects(
      selectionRef.current.elements
        .map((element) => element.getBoundingClientRect())
        .filter((rect) => rect.width > 0 || rect.height > 0)
    );
  }, []);

  const updateOutline = useCallback((element: Element | undefined) => {
    setOutlineRect(element?.getBoundingClientRect());
    setHoverName(element ? readHostComponentName(element) : null);
  }, []);

  const cancelPicking = useCallback(() => {
    setMode({ kind: "idle" });
    setOutlineRect(undefined);
    setHoverName(null);
  }, []);

  const commitDraft = useCallback((selection: SelectionState) => {
    selectionRef.current = selection;
    setSelectionCount(selection.elements.length);
    const capture = captureSelection(selection.elements);
    // The marquee region must survive into the draft so it lands in the
    // artifact (regression: the region was dropped here).
    setMode({
      kind: "draft",
      capture: {
        ...capture,
        ...(selection.region ? { region: selection.region } : {}),
      },
    });
    setOutlineRect(undefined);
    setHoverName(null);
  }, []);

  const addOrReplace = useCallback(
    (element: Element, additive: boolean) => {
      if (additive) {
        // Multi-select stays in picking mode so more elements can be added.
        selectionRef.current = toggleInSelection(selectionRef.current, element);
        setSelectionCount(selectionRef.current.elements.length);
        refreshSelectionRects();
        return;
      }
      commitDraft(replaceSelection(selectionRef.current, element));
    },
    [commitDraft, refreshSelectionRects]
  );

  // Picking listeners (single/multi): pointermove builds the target stack,
  // plain click/Enter replaces, Shift+click/Shift+Enter toggles, Esc cancels.
  useEffect(() => {
    if (!picking) return;

    const handlePointerMove = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || isStudioElement(target)) return;
      const stack = collectTargetStack(target, STACK_DEPTH);
      if (!stack.length) return;
      setMode({ kind: "picking", stack, index: 0 });
      updateOutline(stack[0]);
    };
    const handleScroll = () => {
      const current = modeRef.current;
      if (current.kind === "picking") {
        updateOutline(current.stack[current.index]);
      } else {
        return;
      }
      refreshSelectionRects();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      const current = modeRef.current;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancelPicking();
        return;
      }
      if (current.kind !== "picking") return;
      // Keyboard picking without hover: seed the stack from the focused page
      // element so arrow keys and Enter work with no pointer input.
      const stack =
        current.stack.length > 0
          ? current.stack
          : document.activeElement instanceof Element &&
            !isStudioElement(document.activeElement)
            ? collectTargetStack(document.activeElement, STACK_DEPTH)
            : [];
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        if (!stack.length) return;
        const direction = event.key === "ArrowDown" ? 1 : -1;
        const next = Math.min(
          Math.max(current.index + direction, 0),
          stack.length - 1
        );
        setMode({ kind: "picking", stack, index: next });
        updateOutline(stack[next]);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        const target = stack[current.index] ?? undefined;
        if (target) addOrReplace(target, event.shiftKey);
      }
    };
    const handleClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || isStudioElement(target)) return;
      const current = modeRef.current;
      if (current.kind !== "picking") return;
      const stack = collectTargetStack(target, STACK_DEPTH);
      const picked = stack[0] ?? target;
      event.preventDefault();
      event.stopPropagation();
      addOrReplace(picked, event.shiftKey);
    };

    document.addEventListener("pointermove", handlePointerMove, true);
    document.addEventListener("scroll", handleScroll, true);
    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("click", handleClick, true);
    return () => {
      document.removeEventListener("pointermove", handlePointerMove, true);
      document.removeEventListener("scroll", handleScroll, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("click", handleClick, true);
    };
  }, [addOrReplace, cancelPicking, picking, refreshSelectionRects, updateOutline]);

  // Marquee listeners: pointerdown starts, pointermove updates the rect,
  // pointerup commits the region selection.
  useEffect(() => {
    if (!isMarquee) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || isStudioElement(target)) return;
      const current = modeRef.current;
      if (current.kind !== "marquee") return;
      event.preventDefault();
      event.stopPropagation();
      setMode({
        kind: "marquee",
        start: { x: event.clientX, y: event.clientY },
        current: { x: event.clientX, y: event.clientY },
      });
    };
    const handlePointerMove = (event: PointerEvent) => {
      const current = modeRef.current;
      if (current.kind !== "marquee") return;
      event.preventDefault();
      event.stopPropagation();
      setMode({
        kind: "marquee",
        start: current.start,
        current: { x: event.clientX, y: event.clientY },
      });
    };
    const handlePointerUp = (event: PointerEvent) => {
      const current = modeRef.current;
      if (current.kind !== "marquee") return;
      event.preventDefault();
      event.stopPropagation();
      const region = toRegion(current);
      if (!region || region.width < 2 || region.height < 2) {
        setMode({ kind: "idle" });
        return;
      }
      const selection = commitRegion(collectRegionCandidates(), region);
      commitDraft(selection);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setMode({ kind: "idle" });
      }
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("pointermove", handlePointerMove, true);
    document.addEventListener("pointerup", handlePointerUp, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("pointermove", handlePointerMove, true);
      document.removeEventListener("pointerup", handlePointerUp, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [commitDraft, isMarquee]);

  // Load the revision/ack/state status into the panel when it opens.
  useEffect(() => {
    if (!open || typeof fetch !== "function") return;
    let cancelled = false;
    fetch(config.endpoint, {
      headers: { "X-Portal-Studio-Token": config.token },
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { task?: { revision?: unknown } } | null) => {
        if (cancelled || !payload?.task?.revision) return;
        const revision = payload.task.revision as {
          sourceRevision?: string;
          browserRevision?: number;
          state?: string;
        };
        setRevisionStatus({
          sourceRevision: revision.sourceRevision,
          browserRevision: revision.browserRevision,
          state: revision.state,
        });
      })
      .catch(() => {
        // Dev server restarting; status stays hidden.
      });
    return () => {
      cancelled = true;
    };
  }, [config.endpoint, config.token, open]);

  // Refresh selection rects on scroll/resize while the panel is open.
  useEffect(() => {
    if (!open) return;
    const refresh = () => refreshSelectionRects();
    window.addEventListener("scroll", refresh, true);
    window.addEventListener("resize", refresh);
    refresh();
    return () => {
      window.removeEventListener("scroll", refresh, true);
      window.removeEventListener("resize", refresh);
    };
  }, [open, refreshSelectionRects]);

  // Focus trap while the panel is open.
  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    if (!root) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusable = findFocusable(root);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || !root.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !root.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };
    root.addEventListener("keydown", handleKeyDown);
    return () => root.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  const startPicking = () => {
    // A new capture session always starts from a clean selection; stale
    // selections from a previous draft/save must never leak into it.
    selectionRef.current = EMPTY_SELECTION;
    setSelectionRects([]);
    setSelectionCount(0);
    // Keyboard users may start picking with a focused page element.
    const active = document.activeElement;
    const initial =
      active instanceof Element && !isStudioElement(active)
        ? collectTargetStack(active, STACK_DEPTH)
        : [];
    if (initial.length) {
      setMode({ kind: "picking", stack: initial, index: 0 });
      updateOutline(initial[0]);
    } else {
      setMode({ kind: "picking", stack: [], index: 0 });
      updateOutline(undefined);
    }
  };

  const startMarquee = () => {
    // New session: clean selection (see startPicking).
    selectionRef.current = EMPTY_SELECTION;
    setSelectionRects([]);
    setSelectionCount(0);
    setMode({
      kind: "marquee",
      start: { x: 0, y: 0 },
      current: { x: 0, y: 0 },
    });
    setOutlineRect(undefined);
    setHoverName(null);
  };

  const clearTask = async () => {
    setMode({ kind: "saving" });
    try {
      const response = await fetch(config.endpoint, {
        method: "DELETE",
        headers: { "X-Portal-Studio-Token": config.token },
      });
      if (!response.ok) {
        setMode({
          kind: "error",
          message: sessionErrorMessage(response.status),
        });
        return;
      }
      selectionRef.current = EMPTY_SELECTION;
      setSelectionRects([]);
      setSelectionCount(0);
      setInstruction("");
      setMode({ kind: "cleared" });
    } catch (error) {
      setMode({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const saveTask = async () => {
    if (mode.kind !== "draft") return;
    setMode({ kind: "saving" });
    const taskId = newTaskId();
    const task: PortalStudioTask = {
      schemaVersion: TASK_SCHEMA_VERSION,
      taskId,
      createdAt: new Date().toISOString(),
      url: window.location.href,
      title: document.title,
      instruction,
      elements: mode.capture.elements,
      ...(mode.capture.region ? { region: mode.capture.region } : {}),
      businessContext: mode.capture.businessContext,
      diagnostics: snapshotDiagnostics(sharedDiagnosticsBuffer),
      redaction: {
        droppedKeys: [],
        redactedValues: 0,
        truncatedValues: 0,
      },
    };
    try {
      // Order matters: the task POST creates the active task FIRST; the
      // screenshot POST then merges the fresh PNG ref + capturedAt into the
      // just-created task (commitEvidence requires an existing active task).
      const response = await fetch(config.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Portal-Studio-Token": config.token,
        },
        body: JSON.stringify(task),
      });
      const payload = (await response.json()) as PortalStudioSaveResult;
      if (!response.ok || !payload.ok || !payload.taskId) {
        setMode({
          kind: "error",
          message: sessionErrorMessage(response.status, payload.error),
        });
        return;
      }

      // Annotated screenshot (markers over the selected elements and the
      // region); the server validates, stores the PNG atomically, and
      // updates the active task's screenshot ref + capturedAt.
      const annotations = [
        ...selectionRef.current.elements
          .map((element) => element.getBoundingClientRect())
          .filter((rect) => rect.width > 0 && rect.height > 0)
          .map((rect) => ({
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height,
          })),
        ...(mode.capture.region ? [{ ...mode.capture.region }] : []),
      ];
      const shot = await captureViewportPng(annotations);
      if (!shot) {
        setMode({ kind: "error", message: "screenshot capture failed" });
        return;
      }
      const screenshotsEndpoint =
        config.screenshotsEndpoint ?? "/__portal-studio/screenshots";
      const shotResponse = await fetch(screenshotsEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Portal-Studio-Token": config.token,
        },
        body: JSON.stringify({
          taskId,
          png: shot.dataUrl.split(",")[1] ?? "",
        }),
      });
      const shotPayload = (await shotResponse.json()) as {
        ok?: boolean;
        file?: string;
        error?: string;
      };
      if (!shotResponse.ok || !shotPayload.ok || !shotPayload.file) {
        setMode({
          kind: "error",
          message: sessionErrorMessage(
            shotResponse.status,
            shotPayload.error
          ),
        });
        return;
      }

      setMode({
        kind: "saved",
        taskId: payload.taskId,
        file: payload.file,
        screenshot: shotPayload.file,
        sources: payload.sourceCandidates ?? [],
      });
    } catch (error) {
      setMode({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const resetAfterSave = () => {
    selectionRef.current = EMPTY_SELECTION;
    setSelectionRects([]);
    setSelectionCount(0);
    setInstruction("");
    setMode({ kind: "idle" });
  };

  /** Reset all capture-session state (selection, draft text, mode). */
  const resetSession = useCallback(() => {
    selectionRef.current = EMPTY_SELECTION;
    setSelectionRects([]);
    setSelectionCount(0);
    setInstruction("");
    setMode({ kind: "idle" });
    setOutlineRect(undefined);
    setHoverName(null);
  }, []);

  const panelVisible = open;

  return (
    <div ref={rootRef} className="ps-root" data-portal-studio-root>
      <button
        type="button"
        className="ps-toggle"
        aria-label={
          open
            ? t("studio.toggle.close", "Close Portal Studio")
            : t("studio.toggle.open", "Open Portal Studio")
        }
        aria-expanded={open}
        onClick={() => {
          setOpen((current) => !current);
          resetSession();
        }}
      >
        🛠
      </button>

      {panelVisible ? (
        <div
          className="ps-panel"
          role="toolbar"
          aria-label={t("studio.title", "Portal Studio")}
        >
          <div className="ps-panel-header">
            <span className="ps-title">{t("studio.title", "Portal Studio")}</span>
            <button
              type="button"
              className="ps-icon-button"
              aria-label={t("studio.close", "Close")}
              onClick={() => {
                setOpen(false);
                resetSession();
              }}
            >
              ✕
            </button>
          </div>

          {mode.kind === "picking" ? (
            <div className="ps-section" role="status" aria-live="polite">
              <p className="ps-hint">
                {t(
                  "studio.pickHint",
                  "Hover an element, then click or press Enter. Arrow keys move between the element and its ancestors. Shift adds to the selection. Esc cancels."
                )}
              </p>
              {hoverName ? (
                <p className="ps-meta">
                  {t("studio.currentComponent", "Component")}: {hoverName}
                </p>
              ) : null}
              {selectionCount > 0 ? (
                <p className="ps-meta">
                  {t("studio.selectedCount", "Selected")}:{" "}
                  <strong>{selectionCount}</strong>
                </p>
              ) : null}
              <button
                type="button"
                className="ps-button"
                onClick={cancelPicking}
              >
                {t("studio.cancelPick", "Cancel picking")}
              </button>
            </div>
          ) : null}

          {mode.kind === "marquee" ? (
            <div className="ps-section" role="status" aria-live="polite">
              <p className="ps-hint">
                {t(
                  "studio.marqueeHint",
                  "Drag over the page to select everything inside the region. Esc cancels."
                )}
              </p>
              <button
                type="button"
                className="ps-button"
                onClick={() => setMode({ kind: "idle" })}
              >
                {t("studio.cancel", "Cancel")}
              </button>
            </div>
          ) : null}

          {mode.kind === "draft" ? (
            <div className="ps-section">
              <p className="ps-meta">
                {t("studio.capturedCount", "Captured")}:{" "}
                <strong>{mode.capture.elements.length}</strong>{" "}
                {t("studio.elements", "element(s)")}
                {mode.capture.region
                  ? ` — ${t("studio.regionLabel", "region")} ${mode.capture.region.width}×${mode.capture.region.height}`
                  : ""}
              </p>
              {mode.capture.businessContext.length ? (
                <p className="ps-meta">
                  {t("studio.businessContext", "Business context")}:{" "}
                  {mode.capture.businessContext.length}
                </p>
              ) : null}
              <p className="ps-label">{t("studio.component", "Components")}</p>
              <ul className="ps-list">
                {mode.capture.elements.length ? (
                  mode.capture.elements.slice(0, 10).map((capture, index) => {
                    const component = capture.componentCandidates.find(
                      (candidate) => candidate.name
                    )?.name;
                    return (
                      <li key={index}>
                        <code>
                          {capture.tagName}
                          {component ? ` · ${component}` : ""}
                        </code>
                      </li>
                    );
                  })
                ) : (
                  <li>
                    {t(
                      "studio.noComponent",
                      "No React component detected (DOM fallback)"
                    )}
                  </li>
                )}
              </ul>
              <p className="ps-hint">
                {t(
                  "studio.sourcePending",
                  "Source candidates are resolved by the dev server when the task is saved."
                )}
              </p>
              <label className="ps-label" htmlFor="ps-instruction">
                {t("studio.instruction", "Modification instruction")}
              </label>
              <textarea
                id="ps-instruction"
                className="ps-textarea"
                rows={3}
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                placeholder={t(
                  "studio.instructionPlaceholder",
                  "Describe the change the agent should make…"
                )}
              />
              <div className="ps-actions">
                <button
                  type="button"
                  className="ps-button"
                  onClick={() => setMode({ kind: "idle" })}
                >
                  {t("studio.cancel", "Cancel")}
                </button>
                <button
                  type="button"
                  className="ps-button ps-primary"
                  onClick={saveTask}
                >
                  {t("studio.save", "Save task")}
                </button>
              </div>
            </div>
          ) : null}

          {mode.kind === "saving" ? (
            <div className="ps-section" role="status" aria-live="polite">
              <p className="ps-hint">
                {t("studio.saving", "Saving task…")}
              </p>
            </div>
          ) : null}

          {mode.kind === "saved" ? (
            <div className="ps-section" role="status" aria-live="polite">
              <p className="ps-ok">
                {t("studio.saved", "Task saved")} —{" "}
                <code>{mode.taskId}</code>
              </p>
              {mode.file ? (
                <p className="ps-meta">
                  {t("studio.savedFile", "File")}: <code>{mode.file}</code>
                </p>
              ) : null}
              {mode.screenshot ? (
                <p className="ps-meta">
                  {t("studio.screenshot", "Screenshot")}:{" "}
                  <code>{mode.screenshot}</code>
                </p>
              ) : null}
              {mode.sources.length ? (
                <>
                  <p className="ps-label">
                    {t("studio.sourceResolved", "Resolved source candidates")}
                  </p>
                  <ul className="ps-list">
                    {mode.sources.slice(0, 6).map((source) => (
                      <li key={`${source.file}:${source.line ?? ""}`}>
                        <code>
                          {source.file}
                          {typeof source.line === "number"
                            ? `:${source.line}`
                            : ""}
                        </code>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              <button
                type="button"
                className="ps-button ps-primary"
                onClick={resetAfterSave}
              >
                {t("studio.done", "Done")}
              </button>
            </div>
          ) : null}

          {mode.kind === "cleared" ? (
            <div className="ps-section" role="status" aria-live="polite">
              <p className="ps-ok">
                {t("studio.taskCleared", "Task cleared")}
              </p>
              <button
                type="button"
                className="ps-button ps-primary"
                onClick={() => setMode({ kind: "idle" })}
              >
                {t("studio.done", "Done")}
              </button>
            </div>
          ) : null}

          {mode.kind === "error" ? (
            <div className="ps-section" role="alert">
              <p className="ps-error">
                {t("studio.errorSave", "Unable to save task")}:{" "}
                {mode.message}
              </p>
              <button
                type="button"
                className="ps-button"
                onClick={() => setMode({ kind: "idle" })}
              >
                {t("studio.cancel", "Cancel")}
              </button>
            </div>
          ) : null}

          {isIdle ? (
            <div className="ps-section">
              {revisionStatus ? (
                <p className="ps-meta" role="status" aria-live="polite">
                  {t("studio.revisionStatus", "Revision")}:{" "}
                  <code>
                    {revisionStatus.sourceRevision?.slice(0, 8) ?? "?"}
                  </code>{" "}
                  · {t("studio.browserRevision", "browser")}{" "}
                  <code>{revisionStatus.browserRevision ?? "?"}</code> ·{" "}
                  {revisionStatus.state ?? "?"}
                </p>
              ) : null}
              <div className="ps-actions ps-actions-start">
                <button
                  type="button"
                  className="ps-button ps-primary"
                  onClick={startPicking}
                >
                  {t("studio.pick", "Pick element")}
                </button>
                <button
                  type="button"
                  className="ps-button"
                  onClick={startMarquee}
                >
                  {t("studio.selectRegion", "Select region")}
                </button>
              </div>
              <button
                type="button"
                className="ps-button ps-danger"
                onClick={clearTask}
              >
                {t("studio.clearTask", "Clear task")}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {picking ? (
        <div
          className="ps-outline"
          style={rectStyle(outlineRect)}
          aria-hidden="true"
        />
      ) : null}

      {isMarquee ? (
        <div
          className="ps-outline ps-region"
          style={regionStyle(toRegion(mode))}
          aria-hidden="true"
        />
      ) : null}

      {selectionRects.map((rect, index) => (
        <div
          key={index}
          className="ps-outline ps-selected"
          style={rectStyle(rect)}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}
