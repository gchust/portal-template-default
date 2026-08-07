/**
 * Portal Studio — Shadow DOM toolbar.
 *
 * Dev-only client UI rendered inside a shadow root (see `index.tsx`). Plain
 * semantic HTML + scoped styles (Tailwind/shadcn styles do not cross shadow
 * boundaries). Keyboard accessible: Tab reaches the floating button, the
 * panel traps focus, Esc cancels, arrow keys move between the hovered
 * element and its ancestors while picking.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

import { translate } from "@nocobase/portal-sdk/i18n";

import {
  captureElement,
  collectTargetStack,
  isStudioElement,
  readHostComponentName,
} from "./capture";
import {
  TASK_SCHEMA_VERSION,
  type ElementCapture,
  type PortalStudioTask,
} from "./types";

export type PortalStudioConfig = {
  token: string;
  endpoint: string;
};

export type PortalStudioSaveResult = {
  ok: boolean;
  taskId?: string;
  file?: string;
  sourceCandidates?: ElementCapture["sourceCandidates"];
  error?: string;
};

const t = (key: string, fallback: string) =>
  translate(key, { ns: "starter" }, fallback);

const STACK_DEPTH = 4;

type ToolbarMode =
  | { kind: "idle" }
  | { kind: "picking"; stack: Element[]; index: number }
  | { kind: "draft"; capture: ElementCapture }
  | { kind: "saving" }
  | { kind: "saved"; taskId: string; file?: string; sources: ElementCapture["sourceCandidates"] }
  | { kind: "error"; message: string };

const findFocusable = (root: HTMLElement) =>
  Array.from(
    root.querySelectorAll<HTMLElement>(
      'button, textarea, [href], input, [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => !element.hasAttribute("disabled"));

const outlineStyle = (rect: DOMRect | undefined): CSSProperties => {
  if (!rect) return { display: "none" };
  return {
    display: "block",
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
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
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const picking = mode.kind === "picking";
  const isIdle = mode.kind === "idle";

  const updateOutline = useCallback((element: Element | undefined) => {
    setOutlineRect(element?.getBoundingClientRect());
    setHoverName(element ? readHostComponentName(element) : null);
  }, []);

  const cancelPicking = useCallback(() => {
    setMode({ kind: "idle" });
    setOutlineRect(undefined);
    setHoverName(null);
  }, []);

  const confirmCapture = useCallback((element: Element) => {
    setMode({ kind: "draft", capture: captureElement(element) });
    setOutlineRect(undefined);
    setHoverName(null);
  }, []);

  // Picking listeners: pointermove builds the target stack, click confirms,
  // keyboard moves within the stack and confirms, Esc cancels. The effect is
  // registered once per picking session; the current mode is read from a ref.
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
      if (current.kind !== "picking") return;
      updateOutline(current.stack[current.index]);
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
      // Keyboard picking without hover: seed the stack from the focused
      // page element so arrow keys and Enter work with no pointer input.
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
        const next = Math.min(Math.max(current.index + direction, 0), stack.length - 1);
        setMode({ kind: "picking", stack, index: next });
        updateOutline(stack[next]);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        const target = stack[current.index] ?? undefined;
        if (target) confirmCapture(target);
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
      confirmCapture(picked);
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
  }, [cancelPicking, confirmCapture, picking, updateOutline]);

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

  const saveTask = async () => {
    if (mode.kind !== "draft") return;
    setMode({ kind: "saving" });
    const task: PortalStudioTask = {
      schemaVersion: TASK_SCHEMA_VERSION,
      taskId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      url: window.location.href,
      title: document.title,
      instruction,
      element: mode.capture,
    };
    try {
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
          message: payload.error ?? String(response.status),
        });
        return;
      }
      setMode({
        kind: "saved",
        taskId: payload.taskId,
        file: payload.file,
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
    setInstruction("");
    setMode({ kind: "idle" });
  };

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
          setMode({ kind: "idle" });
          setOutlineRect(undefined);
          setHoverName(null);
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
                setMode({ kind: "idle" });
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
                  "Hover an element, then click or press Enter. Arrow keys move between the element and its ancestors. Esc cancels."
                )}
              </p>
              {hoverName ? (
                <p className="ps-meta">
                  {t("studio.currentComponent", "Component")}: {hoverName}
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

          {mode.kind === "draft" ? (
            <div className="ps-section">
              <p className="ps-meta">
                {t("studio.capturedTag", "Captured")}:{" "}
                <code>{mode.capture.tagName}</code>
              </p>
              <p className="ps-label">
                {t("studio.component", "Components")}
              </p>
              <ul className="ps-list">
                {mode.capture.componentCandidates.length ? (
                  mode.capture.componentCandidates
                    .slice(0, 12)
                    .map((candidate, index) => (
                      <li key={`${candidate.name}-${index}`}>
                        <code>{candidate.name ?? "?"}</code>
                      </li>
                    ))
                ) : (
                  <li>
                    {t(
                      "studio.noComponent",
                      "No React component detected (DOM fallback)"
                    )}
                  </li>
                )}
              </ul>
              <p className="ps-label">{t("studio.source", "Source candidates")}</p>
              <p className="ps-hint">
                {t(
                  "studio.sourcePending",
                  "Resolved by the dev server when the task is saved."
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
              <button
                type="button"
                className="ps-button ps-primary"
                onClick={startPicking}
              >
                {t("studio.pick", "Pick element")}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {picking ? (
        <div
          className="ps-outline"
          style={outlineStyle(outlineRect)}
          aria-hidden="true"
        />
      ) : null}
    </div>
  );
}
