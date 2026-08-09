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

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import {
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  GripVertical,
  Pencil,
  RotateCcw,
  Trash2,
  Wrench,
  X,
} from "lucide-react";

import { translate } from "@nocobase/portal-sdk/i18n";

import { sessionErrorMessage } from "./errors";
import { matchHotkey, getHotkey } from "./hotkeys";

import {
  clampDockPosition,
  defaultDockPosition,
  DEFAULT_DOCK_WIDTH,
  DRAG_THRESHOLD_PX,
  KEYBOARD_FAST_STEP_PX,
  KEYBOARD_STEP_PX,
  loadDockPosition,
  moveDockPosition,
  resolveDockLayout,
  saveDockPosition,
  type DockPosition,
} from "./dock";

import {
  captureSelection,
  collectTargetStack,
  isStudioElement,
  readHostComponentName,
} from "./capture";
import { sharedDiagnosticsBuffer, snapshotDiagnostics } from "./diagnostics";
import { formatTaskMarkdown } from "./format.ts";
import { captureViewportPng } from "./screenshot";
import {
  isAnnotationUnresolved,
  resolveAnnotationTarget,
  resolveAnnotationTargets,
  resolveMarkerEditorPosition,
  MARKER_EDITOR_WIDTH,
} from "./markers";
import { newTaskId } from "./task-id";
import {
  annotationDisplayNumber,
  completeAnnotation,
  countOpenAnnotations,
  groupToggleElement,
  normalizeTask,
  removeAnnotation,
  removeCompletedAnnotations,
  reopenAnnotation,
  selectCompletedAnnotations,
  selectVisibleAnnotations,
  toggleAnnotationHidden,
  updateAnnotationComment,
  type ViewFilter,
} from "./task-model";
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
  type Annotation,
  type BusinessContextItem,
  type ElementCapture,
  type PortalStudioTask,
  type PortalStudioTaskV4,
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
/** Position threshold for above/below-anchored copy fallback dialog. */
const COPY_FLIP_MIN_ABOVE = 60;
/** Keepalive fetch bodies are limited to 64 KB by Chromium (D-043). */
const KEEPALIVE_SAFE_BYTES = 60 * 1024;

const readDockStorage = (): DockStorage | null => {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
};

const viewportOf = (win: Window & typeof globalThis): DockViewport => ({
  width: win.innerWidth,
  height: win.innerHeight,
});

type DockStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

type DockViewport = { width: number; height: number };

type DragState = {
  startX: number;
  startY: number;
  origin: DockPosition;
  moved: boolean;
};

type ToolbarMode =
  | { kind: "idle" }
  | { kind: "picking"; stack: Element[]; index: number }
  | {
      kind: "multi";
      stack: Element[];
      index: number;
      /** True multi-select group (D-033 #5): one annotation, many elements. */
      group: Element[];
    }
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
      /** Non-blocking evidence warning (D-034 #2): the annotation is safe. */
      notice?: string;
    }
  | { kind: "error"; message: string };

/**
 * The active element inside the Studio shadow root. `document.activeElement`
 * retargets to the shadow HOST, so containment comparisons against
 * shadow-internal elements would always be false (P1-1, G05 review).
 */
const shadowActiveElement = (): Element | null => {
  const host = document.getElementById("portal-studio-root");
  return host?.shadowRoot?.activeElement ?? document.activeElement;
};

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
  const dockRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  // Dock position (G01, D-033 #2): null = default bottom-right anchor;
  // persisted via localStorage portal-studio.dock (D-037).
  const [dockPosition, setDockPosition] = useState<DockPosition | null>(
    () => {
      const loaded = loadDockPosition(readDockStorage());
      return loaded ? clampDockPosition(loaded, viewportOf(window)) : null;
    }
  );
  const [dockWidth, setDockWidth] = useState(DEFAULT_DOCK_WIDTH);
  const dockPositionRef = useRef<DockPosition | null>(dockPosition);
  dockPositionRef.current = dockPosition;
  const dockWidthRef = useRef(dockWidth);
  dockWidthRef.current = dockWidth;
  const dragRef = useRef<DragState | null>(null);
  const dragListenersRef = useRef<{
    move: (event: PointerEvent) => void;
    up: (event: PointerEvent) => void;
  } | null>(null);
  const didDragRef = useRef(false);
  const [mode, setMode] = useState<ToolbarMode>({ kind: "idle" });
  // Annotation-first (D-033 #4/#7): the draft comment of the annotation
  // being created, and the persisted annotation list of the active task
  // (loaded on panel open, appended on save, cleared with the task).
  const [draftComment, setDraftComment] = useState("");
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  // Re-resolution tick for the numbered marker overlay (route/scroll/
  // resize, D-033 #8).
  const [markerTick, setMarkerTick] = useState(0);
  // Goal 03 list actions: inline comment editing (with dirty state),
  // delete confirmation, and the More-menu clear-all confirmation.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  // Goal 03 marker-local editor: which annotation's marker is open, the
  // draft comment (never cleared on save failure), error/retry state,
  // and the lightweight delete confirmation.
  const [editorAnnotationId, setEditorAnnotationId] = useState<string | null>(
    null
  );
  const [editorDraft, setEditorDraft] = useState("");
  const [editorError, setEditorError] = useState<string | null>(null);
  const [editorSaving, setEditorSaving] = useState(false);
  const [editorDeleteConfirm, setEditorDeleteConfirm] = useState(false);
  // Goal 04: view filter (presentation state, independent of hidden and
  // completed) + the Remove-completed confirmation.
  const [viewFilter, setViewFilter] = useState<ViewFilter>("open");
  const [removeCompletedConfirm, setRemoveCompletedConfirm] = useState(false);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const markerButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const editorSavingRef = useRef(false);
  editorSavingRef.current = editorSaving;
  // Copy state (G04, D-033 #12): "idle" | "copied" (aria-live feedback) |
  // "manual" (Clipboard unavailable — selectable textarea fallback).
  const [copyState, setCopyState] = useState<
    "idle" | "copied" | "manual"
  >("idle");
  const [copyText, setCopyText] = useState("");
  const copyFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const copyButtonRef = useRef<HTMLButtonElement | null>(null);
  // Last-known task (loaded from the server) used to rebuild mutation
  // POSTs through the existing atomic rewrite (no new endpoints).
  const taskRef = useRef<PortalStudioTask | null>(null);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [outlineRect, setOutlineRect] = useState<DOMRect>();
  const [hoverName, setHoverName] = useState<string | null>(null);
  const [selectionRects, setSelectionRects] = useState<DOMRect[]>([]);
  const [selectionCount, setSelectionCount] = useState(0);
  const selectionRef = useRef<SelectionState>(EMPTY_SELECTION);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const picking = mode.kind === "picking";
  const isMulti = mode.kind === "multi";
  const isMarquee = mode.kind === "marquee";

  const viewport = viewportOf(window);
  const position = dockPosition ?? defaultDockPosition(viewport, dockWidth);
  const layout = resolveDockLayout({
    position,
    viewport,
    expanded: open,
    dockWidth,
  });

  // Measure the real dock row width once so clamping keeps the whole row
  // (toggle + badge + More) inside the viewport; falls back to the constant
  // when measurement is unavailable (jsdom).
  useLayoutEffect(() => {
    const element = dockRef.current;
    if (!element) return;
    const measured = element.getBoundingClientRect().width;
    if (measured > 0) {
      setDockWidth(measured);
      // Re-clamp a persisted position against the MEASURED width so a
      // position saved at the extreme edge cannot sit off-viewport after
      // reload (round-2 P4).
      const persisted = dockPositionRef.current;
      if (persisted) {
        setDockPosition(clampDockPosition(persisted, viewportOf(window), measured));
      }
    }
  }, []);



  const persistDockPosition = (next: DockPosition) => {
    setDockPosition(next);
    saveDockPosition(readDockStorage(), next);
  };

  // Pointer drag (G01 AC1): starts on any dock surface (row, toggle). No pointer capture, so button clicks keep
  // their natural semantics; movement past the threshold marks the gesture
  // as a drag (didDragRef suppresses the toggle's click action). Window-
  // capture listeners end the drag on pointerup/cancel. The page-level
  // picking/marquee listeners are unaffected: they exclude Studio elements
  // (isStudioElement, D-034 #3) and our window-capture handler stops
  // propagation of the events it consumes.
  const stopDragListeners = () => {
    const listeners = dragListenersRef.current;
    if (!listeners) return;
    window.removeEventListener("pointermove", listeners.move, true);
    window.removeEventListener("pointerup", listeners.up, true);
    window.removeEventListener("pointercancel", listeners.up, true);
    dragListenersRef.current = null;
  };

  const handleDockPointerDown = (
    event: React.PointerEvent<HTMLDivElement>
  ) => {
    // A new gesture: clear any suppression left by a PREVIOUS drag so the
    // next plain click still toggles the panel.
    didDragRef.current = false;
    const drag: DragState = {
      startX: event.clientX,
      startY: event.clientY,
      origin: dockPositionRef.current ?? position,
      moved: false,
    };
    dragRef.current = drag;
    const move = (moveEvent: PointerEvent) => {
      const active = dragRef.current;
      if (!active) return;
      const dx = moveEvent.clientX - active.startX;
      const dy = moveEvent.clientY - active.startY;
      if (!active.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      active.moved = true;
      didDragRef.current = true;
      // Fresh viewport/width so a mid-drag resize clamps correctly (F5).
      const currentViewport = viewportOf(window);
      setDockPosition(
        clampDockPosition(
          { x: active.origin.x + dx, y: active.origin.y + dy },
          currentViewport,
          dockWidthRef.current
        )
      );
      moveEvent.preventDefault();
      moveEvent.stopPropagation();
    };
    const up = (upEvent: PointerEvent) => {
      stopDragListeners();
      dragRef.current = null;
      upEvent.stopPropagation();
      if (drag.moved) {
        saveDockPosition(readDockStorage(), dockPositionRef.current ?? position);
      }
    };
    dragListenersRef.current = { move, up };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    // No preventDefault here (F6): buttons keep mouse focus; the move
    // handler prevents default (selection/scroll) during the drag.
    event.stopPropagation();
  };

  // Keyboard drag (D-034 #5): arrows move the dock (Shift = larger step).
  const handleToggleKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>
  ) => {
    const step = event.shiftKey ? KEYBOARD_FAST_STEP_PX : KEYBOARD_STEP_PX;
    const delta = {
      ArrowUp: { dx: 0, dy: -1 },
      ArrowDown: { dx: 0, dy: 1 },
      ArrowLeft: { dx: -1, dy: 0 },
      ArrowRight: { dx: 1, dy: 0 },
    }[event.key] as
      | { dx: -1 | 0 | 1; dy: -1 | 0 | 1 }
      | undefined;
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    persistDockPosition(
      moveDockPosition(position, delta, viewport, step, dockWidth)
    );
  };



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
  // Capture listeners for single-pick mode: paused when the dock is collapsed
  // (AC5: collapsed dock must not leave invisible capture listeners active).
  useEffect(() => {
    if (!picking || !open) return;

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
  }, [addOrReplace, cancelPicking, picking, open, refreshSelectionRects, updateOutline]);

  // Marquee listeners: pointerdown starts, pointermove updates the rect,
  // pointerup commits the region selection.
  // Marquee listeners: paused when the dock is collapsed (AC5).
  useEffect(() => {
    if (!isMarquee || !open) return;

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
  }, [commitDraft, isMarquee, open]);

  // Load the persisted task (annotations + revision status; schema v4/v5
  // dual read, D-033 #17). Runs on mount (the dock badge shows the live
  // count without opening the panel), when the panel opens, and after a
  // save so Copy always reflects the SERVER artifact (screenshot +
  // heartbeat merged) — byte-identical to the print CLI (G04 parity).
  const refreshTask = useCallback(() => {
    if (typeof fetch !== "function") return;
    fetch(config.endpoint, {
      headers: { "X-Portal-Studio-Token": config.token },
    })
      .then((response) => (response.ok ? response.json() : null))
      .then(
        (
          payload: {
            task?: PortalStudioTask | PortalStudioTaskV4 | null;
          } | null
        ) => {
          if (!payload?.task) return;
          const normalized = normalizeTask(payload.task);
          if (!normalized) return;
          taskRef.current = normalized;
          setAnnotations(normalized.annotations);
        }
      )
      .catch(() => {
        // Dev server restarting; status stays hidden.
      });
  }, [config.endpoint, config.token]);

  useEffect(() => {
    refreshTask();
  }, [refreshTask, open]);

  // Marker re-resolution (D-033 #8): re-query the live DOM on route
  // changes (body child mutations), scroll, and resize — markers follow
  // their targets; unresolved ones stay retained in the list.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setMarkerTick((tick) => tick + 1), 80);
    };
    window.addEventListener("scroll", refresh, true);
    window.addEventListener("resize", refresh);
    // Any body-subtree mutation (async table loads, route swaps, HMR)
    // re-resolves the markers — debounced. Route navigation mutates the
    // subtree too, so no pathname special-casing is needed (G02 e2e found
    // the pathname-only observer missed async content renders).
    const observer = new MutationObserver(() => {
      refresh();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("scroll", refresh, true);
      window.removeEventListener("resize", refresh);
      observer.disconnect();
    };
  }, []);

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
      const active = shadowActiveElement();
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

  /** True multi-select (D-033 #5): seed the group and enter multi mode. */
  const startMulti = () => {
    // A new capture session always starts from a clean selection.
    selectionRef.current = EMPTY_SELECTION;
    setSelectionRects([]);
    setSelectionCount(0);
    const active = document.activeElement;
    const initial =
      active instanceof Element && !isStudioElement(active)
        ? collectTargetStack(active, STACK_DEPTH)
        : [];
    setMode({ kind: "multi", stack: initial, index: 0, group: [] });
    updateOutline(initial[0]);
  };

  /** Toggle a target in/out of the ONE group (no new annotation per click). */
  const toggleGroupTarget = useCallback((target: Element) => {
    const current = modeRef.current;
    if (current.kind !== "multi") return;
    const group = groupToggleElement(current.group, target);
    selectionRef.current = { elements: group };
    setSelectionCount(group.length);
    setMode({ ...current, group });
    refreshSelectionRects();
  }, [refreshSelectionRects]);

  /** Finish the group: open the comment editor for the multi annotation. */
  const commitMulti = useCallback(() => {
    const current = modeRef.current;
    if (current.kind !== "multi") return;
    if (current.group.length === 0) {
      setMode({ kind: "idle" });
      setOutlineRect(undefined);
      setHoverName(null);
      return;
    }
    commitDraft({ elements: current.group });
  }, [commitDraft]);

  /** Cancel the multi session (Esc). */
  const cancelMulti = useCallback(() => {
    selectionRef.current = EMPTY_SELECTION;
    setSelectionRects([]);
    setSelectionCount(0);
    setMode({ kind: "idle" });
    setOutlineRect(undefined);
    setHoverName(null);
  }, []);

  // True multi-select listeners (D-033 #5): a seed pick starts ONE group;
  // subsequent clicks toggle elements in/out of the SAME annotation; Enter
  // finishes and opens the group comment editor; Esc cancels; keyboard
  // arrows move + Space toggles the focused target.
  // Multi-select capture listeners: paused when the dock is collapsed (AC5).
  useEffect(() => {
    if (!isMulti || !open) return;

    const handlePointerMove = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || isStudioElement(target)) return;
      const stack = collectTargetStack(target, STACK_DEPTH);
      if (!stack.length) return;
      setMode((current) =>
        current.kind === "multi"
          ? { ...current, stack, index: 0 }
          : current
      );
      updateOutline(stack[0]);
    };
    const handleScroll = () => {
      const current = modeRef.current;
      if (current.kind === "multi") {
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
        cancelMulti();
        return;
      }
      if (current.kind !== "multi") return;
      // Keys pressed while focus is on the Studio's own controls must keep
      // their native button behavior (F-4); Esc above is still global.
      const target = event.target;
      if (target instanceof Element && isStudioElement(target)) return;
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
        setMode({ ...current, stack, index: next });
        updateOutline(stack[next]);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        commitMulti();
        return;
      }
      if (event.key === " " || event.key === "Spacebar") {
        event.preventDefault();
        event.stopPropagation();
        const target = stack[current.index] ?? undefined;
        if (target) toggleGroupTarget(target);
      }
    };
    const handleClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || isStudioElement(target)) return;
      const current = modeRef.current;
      if (current.kind !== "multi") return;
      const stack = collectTargetStack(target, STACK_DEPTH);
      const picked = stack[0] ?? target;
      event.preventDefault();
      event.stopPropagation();
      toggleGroupTarget(picked);
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
  }, [
    cancelMulti,
    commitMulti,
    isMulti,
    open,
    refreshSelectionRects,
    toggleGroupTarget,
    updateOutline,
  ]);


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

  /**
   * Persist annotation mutations through the existing atomic POST rewrite
   * (D-033 #10/#11; no new endpoints): the last-known task is re-POSTed
   * with the mutated annotations (same taskId/screenshot ref, so the
   * replace lifecycle keeps the evidence). Debounced 300 ms.
   *
   * ACCEPTANCE-DISCOVERED DEFECT (G05, D-043): keepalive bodies are limited
   * to 64 KB by the browser, but the artifact cap is 256 KB — a task with
   * several annotations routinely exceeds 64 KB, so the ALWAYS-keepalive
   * mutation POST failed with "TypeError: Failed to fetch" and the
   * mutation was silently swallowed. The regular (debounced) path now
   * sends a PLAIN fetch (like saveTask, which always worked); only the
   * unload flush uses keepalive, and only when the payload fits the
   * keepalive budget (otherwise it warns and skips — the debounced write
   * already persisted unless the edit was < 300 ms before unload).
   */
  const sendMutation = useCallback(
    (
      payload: PortalStudioTask,
      options: { keepalive?: boolean; silent?: boolean } = {}
    ): Promise<{ ok: boolean; error?: string }> => {
      const body = JSON.stringify(payload);
      const useKeepalive = options.keepalive === true;
      if (
        useKeepalive &&
        new TextEncoder().encode(body).length > KEEPALIVE_SAFE_BYTES
      ) {
        console.warn(
          "[portal-studio] task exceeds the keepalive budget; the unload save was skipped (D-043)"
        );
        return Promise.resolve({ ok: true });
      }
      return fetch(config.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Portal-Studio-Token": config.token,
        },
        body,
        ...(useKeepalive ? { keepalive: true } : {}),
      })
        .then((response) => response.json())
        .then((result: { ok?: boolean; error?: string }) => {
          if (result.ok !== true) {
            const error = result.error ?? "annotation update failed";
            if (options.silent !== true) {
              setMode({ kind: "error", message: error });
            }
            return { ok: false, error };
          }
          return { ok: true };
        })
        .catch(() => {
          // Dev server restarting; the caller decides retry behavior.
          return {
            ok: false,
            error: "network error — dev server restarting",
          };
        });
    },
    [config.endpoint, config.token]
  );

  /** The payload of the debounced mutation currently pending (if any). */
  const pendingPayloadRef = useRef<PortalStudioTask | null>(null);

  /** Flush a pending mutation immediately (unload/reload safety). */
  const flushPendingMutation = useCallback(() => {
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    const payload = pendingPayloadRef.current;
    if (payload) {
      pendingPayloadRef.current = null;
      taskRef.current = payload;
      // Same ordering as the debounced path: refresh after the POST
      // settles (audit race fix). The unload flush uses keepalive when
      // the payload fits the budget (D-043).
      void sendMutation(payload, { keepalive: true }).then(() =>
        refreshTask()
      );
    }
  }, [refreshTask, sendMutation]);

  const persistAnnotations = useCallback(
    (next: Annotation[]) => {
      setAnnotations(next);
      const base = taskRef.current;
      if (!base) return;
      const payload: PortalStudioTask = { ...base, annotations: next };
      pendingPayloadRef.current = payload;
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
      persistTimerRef.current = setTimeout(async () => {
        pendingPayloadRef.current = null;
        taskRef.current = payload;
        // Re-sync ONLY after the mutation POST settles — refreshing
        // earlier could revert the optimistic UI to stale state (audit
        // race), and refreshing later could make Copy stale (F-3).
        await sendMutation(payload);
        refreshTask();
      }, 300);
    },
    [refreshTask, sendMutation]
  );

  // Flush pending mutations on unmount AND on beforeunload (reloads) —
  // otherwise an edit made <300 ms before a reload would be lost (found
  // by the G03 e2e: the optimistic UI hid the missing persistence).
  // Esc closes the manual-copy fallback dialog and returns focus (F-1),
  // and Tab is contained within the dialog (G05 a11y audit).
  useEffect(() => {
    if (copyState !== "manual") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setCopyState("idle");
        copyButtonRef.current?.focus();
        return;
      }
      if (event.key === "Tab") {
        const dialog = dockRef.current?.querySelector(".ps-copy-fallback");
        if (!dialog) return;
        const focusable = findFocusable(dialog as HTMLElement);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = shadowActiveElement();
        if (event.shiftKey) {
          if (active === first || !dialog.contains(active)) {
            event.preventDefault();
            last.focus();
          }
        } else if (active === last || !dialog.contains(active)) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () =>
      document.removeEventListener("keydown", handleKeyDown, true);
  }, [copyState]);

  useEffect(() => {
    return () => {
      if (copyFeedbackTimerRef.current) {
        clearTimeout(copyFeedbackTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const flush = () => flushPendingMutation();
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      flushPendingMutation();
    };
  }, [flushPendingMutation]);

  /**
   * Copy the agent-facing Markdown (G04, D-033 #12/#15): first-class,
   * NEVER clears or mutates any annotation state. Async Clipboard API with
   * a selectable textarea fallback when unavailable/denied (D-034 #7).
   */
  const copyMarkdown = async () => {
    const task = taskRef.current;
    if (!task) {
      setCopyState("manual");
      setCopyText("");
      return;
    }
    // Goal 02/04: browser Copy defaults to OPEN annotations only — the
    // one shared formatter filters via its explicit option (completed
    // items are done work; CLI/MCP callers opt into all-mode explicitly).
    const markdown = formatTaskMarkdown(task, { includeCompleted: false });
    setCopyText(markdown);
    try {
      if (
        typeof navigator !== "undefined" &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === "function"
      ) {
        await navigator.clipboard.writeText(markdown);
        setCopyState("copied");
        if (copyFeedbackTimerRef.current) {
          clearTimeout(copyFeedbackTimerRef.current);
        }
        copyFeedbackTimerRef.current = setTimeout(() => {
          setCopyState("idle");
        }, 2000);
        return;
      }
      throw new Error("clipboard unavailable");
    } catch {
      // D-034 #7: manual copy path.
      setCopyState("manual");
    }
  };

  const startEdit = (annotation: Annotation) => {
    setEditingId(annotation.annotationId);
    setEditValue(annotation.comment);
  };

  const saveEdit = () => {
    if (!editingId) return;
    persistAnnotations(
      updateAnnotationComment(annotations, editingId, editValue)
    );
    setEditingId(null);
    setEditValue("");
  };

  const confirmDelete = () => {
    if (!confirmDeleteId) return;
    persistAnnotations(removeAnnotation(annotations, confirmDeleteId));
    setConfirmDeleteId(null);
  };

  // -----------------------------------------------------------------------
  // Goal 03: marker-local annotation editor
  // -----------------------------------------------------------------------

  /** Open the editor for a marker; keeps saved + unsaved state intact. */
  const openMarkerEditor = (annotation: Annotation) => {
    // Save-in-flight lock (review): never switch editors mid-save.
    if (editorSavingRef.current) return;
    setEditorAnnotationId(annotation.annotationId);
    setEditorDraft(annotation.comment);
    setEditorError(null);
    setEditorSaving(false);
    setEditorDeleteConfirm(false);
  };

  const closeMarkerEditor = () => {
    setEditorAnnotationId(null);
    setEditorError(null);
    setEditorSaving(false);
    setEditorDeleteConfirm(false);
  };

  /**
   * Save the editor comment via the SAME mutation functions/client path as
   * the list editor (updateAnnotationComment + sendMutation). The shared
   * annotations state, taskRef and the server artifact stay at the last
   * CONFIRMED value until the POST succeeds: a failed save must never leak
   * the unsaved comment into the list or a later unrelated mutation. On
   * failure the draft text is preserved (editorDraft untouched) and
   * error/retry feedback is shown.
   */
  const saveEditorComment = async () => {
    if (!editorAnnotationId || editorSaving) return;
    setEditorSaving(true);
    setEditorError(null);
    // Serialize with any list mutation that is already pending (debounced):
    // flush it FIRST so this save is ordered AFTER it and the newer action
    // is never dropped (review P1). List controls are also disabled while
    // saving, so nothing new can be enqueued mid-flight.
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    if (pendingPayloadRef.current) {
      const pending = pendingPayloadRef.current;
      pendingPayloadRef.current = null;
      taskRef.current = pending;
      const flushed = await sendMutation(pending, { silent: true });
      if (!flushed.ok) {
        setEditorError(
          t("studio.saveError", "Unable to save — try again.")
        );
        setEditorSaving(false);
        return;
      }
    }
    const base = taskRef.current;
    if (!base) {
      setEditorSaving(false);
      closeMarkerEditor();
      return;
    }
    // Build the comment edit on the CURRENT (post-flush) annotations so an
    // earlier pending edit is preserved, not overwritten.
    const next = updateAnnotationComment(
      base.annotations,
      editorAnnotationId,
      editorDraft
    );
    // No optimistic shared-state update here — the POST is the single
    // observable mutation; failure leaves list/taskRef/server untouched.
    const result = await sendMutation(
      { ...base, annotations: next },
      { silent: true }
    );
    if (!result.ok) {
      // Draft text preserved in editorDraft; expose retry/error feedback.
      setEditorError(
        result.error ?? t("studio.saveError", "Unable to save — try again.")
      );
      setEditorSaving(false);
      return;
    }
    // Confirmed: only now sync the shared state to the server artifact.
    const confirmed = { ...base, annotations: next };
    setAnnotations(next);
    taskRef.current = confirmed;
    refreshTask();
    setEditorSaving(false);
    closeMarkerEditor();
  };

  /** Complete an open annotation from the marker editor (shared path). */
  const completeEditorAnnotation = () => {
    if (!editorAnnotationId) return;
    persistAnnotations(
      completeAnnotation(annotations, editorAnnotationId)
    );
    closeMarkerEditor();
  };

  /** Reopen a completed annotation from the marker editor (shared path). */
  const reopenEditorAnnotation = () => {
    if (!editorAnnotationId) return;
    persistAnnotations(
      reopenAnnotation(annotations, editorAnnotationId)
    );
    closeMarkerEditor();
  };

  /** Delete an annotation from the marker editor (shared path). */
  const deleteEditorAnnotation = () => {
    if (!editorAnnotationId) return;
    persistAnnotations(
      removeAnnotation(annotations, editorAnnotationId)
    );
    closeMarkerEditor();
  };

  // Esc closes the marker editor and returns focus to its marker button
  // (skipped while a save POST is in flight so a late failure still lands
  // on the open editor with the draft preserved).
  useEffect(() => {
    if (!editorAnnotationId) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (editorSavingRef.current) return;
      closeMarkerEditor();
      requestAnimationFrame(() => {
        markerButtonRefs.current.get(editorAnnotationId)?.focus();
      });
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [editorAnnotationId]);

  // Outside click closes the marker editor safely. composedPath() crosses
  // the shadow boundary in real browsers (events inside the shadow are
  // retargeted to the host, so a plain contains(target) check would treat
  // editor/marker clicks as outside); contains() is the jsdom fallback.
  useEffect(() => {
    if (!editorAnnotationId) return;
    const hitInside = (
      node: Element | null,
      path: EventTarget[],
      target: EventTarget | null
    ): boolean => {
      if (!node) return false;
      if (path.includes(node)) return true;
      return target instanceof Node && node.contains(target);
    };
    const handlePointerDown = (event: PointerEvent | MouseEvent) => {
      const path = event.composedPath?.() ?? [];
      const target = event.target;
      // Clicks inside the editor never close it.
      if (hitInside(editorRef.current, path, target)) return;
      // Clicks on ANY marker button are handled by the button's own
      // toggle; the editor stays open until that click runs.
      for (const [, button] of markerButtonRefs.current) {
        if (hitInside(button, path, target)) return;
      }
      if (editorSavingRef.current) return;
      closeMarkerEditor();
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("mousedown", handlePointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("mousedown", handlePointerDown, true);
    };
  }, [editorAnnotationId]);

  // The button that opened the current delete confirmation (focus return).
  const confirmDeleteButtonRef = useRef<HTMLButtonElement | null>(null);

  // Esc cancels the inline delete confirmation and returns focus (F-1).
  // The ref is re-armed by a callback ref on every delete-button mount, so
  // by the time the rAF runs (after the confirm unmounts the actions span
  // and they remount) it points at the FRESH button, not a detached node.
  useEffect(() => {
    if (!confirmDeleteId) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setConfirmDeleteId(null);
      requestAnimationFrame(() => {
        confirmDeleteButtonRef.current?.focus();
      });
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () =>
      document.removeEventListener("keydown", handleKeyDown, true);
  }, [confirmDeleteId]);



  const saveTask = async () => {
    if (mode.kind !== "draft") return;
    setMode({ kind: "saving" });
    const taskId = newTaskId();
    // Annotation-first (D-033 #4/#7): the new annotation carries its own
    // comment; the task is the ordered list of annotations.
    // A marquee is an AREA annotation (D-033 #6) even when intersecting
    // elements were captured; element/multi kinds come from picks (the
    // true multi-select mode lands in G03).
    const kind: Annotation["kind"] = mode.capture.region
      ? "region"
      : mode.capture.elements.length > 1
        ? "multi"
        : "element";
    const annotation: Annotation = {
      annotationId: newTaskId(),
      kind,
      comment: draftComment,
      createdAt: new Date().toISOString(),
      status: "open",
      elements: mode.capture.elements,
      ...(mode.capture.region ? { region: mode.capture.region } : {}),
    };
    const task: PortalStudioTask = {
      schemaVersion: TASK_SCHEMA_VERSION,
      taskId,
      createdAt: new Date().toISOString(),
      url: window.location.href,
      title: document.title,
      annotations: [...annotations, annotation],
      businessContext: mode.capture.businessContext,
      diagnostics: snapshotDiagnostics(sharedDiagnosticsBuffer),
      redaction: {
        droppedKeys: [],
        redactedValues: 0,
        truncatedValues: 0,
      },
    };
    try {
      // Order matters (D-034 #2): the task POST persists the annotation
      // FIRST, atomically; the screenshot POST then merges the fresh PNG
      // ref + capturedAt into the just-created task (commitEvidence
      // requires an existing active task). A capture failure therefore
      // NEVER loses or rolls back the annotation — it surfaces as a
      // non-blocking notice.
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
      // The annotation is durably persisted — reflect it in the overlay
      // and the dock badge immediately, and keep the last-known task for
      // later mutation rewrites.
      const savedAnnotations = [...annotations, annotation];
      setAnnotations(savedAnnotations);
      taskRef.current = { ...task, annotations: savedAnnotations };

      // Annotated screenshot (markers over the selected elements and the
      // region); the server validates, stores the PNG atomically, and
      // updates the active task's screenshot ref + capturedAt.
      const markerRects = [
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
      const shot = await captureViewportPng(markerRects);
      if (!shot) {
        // D-034 #2: annotation already persisted — non-blocking notice.
        setMode({
          kind: "saved",
          taskId: payload.taskId,
          file: payload.file,
          sources: payload.sourceCandidates ?? [],
          notice: t(
            "studio.captureFailed",
            "Annotation saved; the screenshot capture failed."
          ),
        });
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
        // D-034 #2: same non-blocking semantics as a capture failure.
        setMode({
          kind: "saved",
          taskId: payload.taskId,
          file: payload.file,
          sources: payload.sourceCandidates ?? [],
          notice: t(
            "studio.captureFailed",
            "Annotation saved; the screenshot capture failed."
          ),
        });
        return;
      }

      if (taskRef.current) {
        taskRef.current = {
          ...taskRef.current,
          screenshot: {
            file: shotPayload.file,
            width: shot.width,
            height: shot.height,
          },
        };
      }
      // The server artifact now carries the merged screenshot + heartbeat;
      // refresh so Copy matches the CLI byte-for-byte (G04 parity).
      refreshTask();
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
    setDraftComment("");
    setMode({ kind: "idle" });
  };

  // -----------------------------------------------------------------------
  // Goal 02: global hotkeys
  // -----------------------------------------------------------------------
  const startPickingRef = useRef(startPicking);
  startPickingRef.current = startPicking;
  const startMultiRef = useRef(startMulti);
  startMultiRef.current = startMulti;
  const startMarqueeRef = useRef(startMarquee);
  startMarqueeRef.current = startMarquee;
  const copyMarkdownRef = useRef(copyMarkdown);
  copyMarkdownRef.current = copyMarkdown;

  useEffect(() => {
    const handleHotkey = (event: KeyboardEvent) => {
      // Events originating inside the Studio's OWN UI (marker editor
      // textarea/buttons, panel, dock) must never trigger global
      // shortcuts. Shadow-DOM retargeting makes event.target the HOST for
      // document listeners, so check composedPath() (browsers) with a
      // contains() fallback (jsdom) BEFORE matching — otherwise Ctrl/Cmd
      // + Alt typed in the editor could still enter capture mode.
      if (rootRef.current) {
        const path = event.composedPath?.() ?? [];
        if (path.includes(rootRef.current)) return;
        if (
          event.target instanceof Node &&
          rootRef.current.contains(event.target)
        ) {
          return;
        }
      }
      const matched = matchHotkey(event);
      if (!matched) return;
      event.preventDefault();
      event.stopPropagation();

      const action = matched.action;

      // Toggle: open/close the dock.
      if (action === "toggle") {
        setOpen((prev) => !prev);
        return;
      }

      // Copy: copy open annotations as markdown.
      if (action === "copy") {
        copyMarkdownRef.current();
        return;
      }

      // Capture actions (pick/multi/area): expand first if collapsed,
      // then safely exit the previous capture and enter the new mode.
      setOpen(true);

      if (action === "pick") {
        startPickingRef.current();
      } else if (action === "multi") {
        startMultiRef.current();
      } else if (action === "area") {
        startMarqueeRef.current();
      }
    };

    document.addEventListener("keydown", handleHotkey, true);
    return () => document.removeEventListener("keydown", handleHotkey, true);
  }, []);

  const panelVisible = open;

  // Goal 04: view-filter derived values (launcher count is ALWAYS the open
  // count, independent of the view; the list/markers use the visible list).
  const openCount = countOpenAnnotations(annotations);
  const completedCount = selectCompletedAnnotations(annotations).length;
  const visibleAnnotations = selectVisibleAnnotations(annotations, viewFilter);

  // Goal 03: marker-local editor anchor — prefer bottom-right of the
  // marker/region rect, flip + clamp inside the viewport (pure math).
  const editorAnnotation = editorAnnotationId
    ? (annotations.find(
        (annotation) => annotation.annotationId === editorAnnotationId
      ) ?? null)
    : null;
  const editorAnchor = (() => {
    if (!editorAnnotation) return undefined;
    const viewport = viewportOf(window);
    if (editorAnnotation.kind === "region" && editorAnnotation.region) {
      const r = editorAnnotation.region;
      return resolveMarkerEditorPosition(
        { left: r.x, top: r.y, width: r.width, height: r.height },
        viewport
      );
    }
    const target = resolveAnnotationTarget(editorAnnotation);
    if (!target) return undefined;
    const rect = target.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return undefined;
    return resolveMarkerEditorPosition(
      {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      },
      viewport
    );
  })();

  return (
    <div ref={rootRef} className="ps-root" data-portal-studio-root>
      <div
        ref={dockRef}
        className="ps-dock"
        style={{ left: layout.toggle.left, top: layout.toggle.top }}
        onPointerDown={handleDockPointerDown}
      >
        <button
          type="button"
          className="ps-toggle"
          aria-label={
            open
              ? t("studio.toggle.close", "Close Portal Studio")
              : openCount > 0
                ? t(
                    "studio.toggle.openCount",
                    "Open Portal Studio ({{count}} annotations)",
                  ).replace("{{count}}", String(openCount))
                : t("studio.toggle.open", "Open Portal Studio")
          }
          title={getHotkey("toggle")?.shortcutLabel}
          aria-expanded={open}
          onClick={() => {
            if (didDragRef.current) {
              didDragRef.current = false;
              return;
            }
            setOpen((current) => !current);
          }}
          onKeyDown={handleToggleKeyDown}
        >
          <Wrench size={18} aria-hidden="true" />
          {openCount > 0 ? (
            <span className="ps-launcher-count" aria-hidden="true">
              {openCount > 99 ? "99+" : openCount}
            </span>
          ) : null}
        </button>
        {copyState === "copied" ? (
          <div className="ps-copy-feedback" role="status" aria-live="polite">
            {t("studio.copied", "Copied to clipboard")}
          </div>
        ) : null}
        {copyState === "manual" ? (
          <div
            className={
              position.y < COPY_FLIP_MIN_ABOVE
                ? "ps-copy-fallback ps-more-menu-below"
                : "ps-copy-fallback"
            }
            role="dialog"
            aria-label={t("studio.copyManual", "Copy manually")}
          >
            <p className="ps-hint">
              {t(
                "studio.copyManualHint",
                "Clipboard unavailable — select and copy the text below."
              )}
            </p>
            <textarea
              className="ps-textarea ps-copy-text"
              readOnly
              rows={6}
              value={
                copyText ||
                t("studio.copyEmpty", "No annotations to copy yet.")
              }
              onFocus={(event) => event.currentTarget.select()}
            />
            <button
              type="button"
              className="ps-button"
              onClick={() => setCopyState("idle")}
            >
              {t("studio.close", "Close")}
            </button>
          </div>
        ) : null}
      </div>

      {panelVisible ? (
        <div
          className="ps-panel"
          style={layout.panel}
          role="toolbar"
          aria-label={t("studio.title", "Portal Studio")}
        >
          {/* Command row (Goal 01): direct actions, no separate menu */}
          <div className="ps-command-row">
            <span className="ps-title" style={{ flex: 1 }}>
              {t("studio.title", "Portal Studio")}
            </span>
            <div
              className="ps-drag-handle"
              role="separator"
              aria-orientation="vertical"
              aria-label={t("studio.dragHint", "Drag to reposition")}
              onPointerDown={handleDockPointerDown}
              style={{ cursor: "grab" }}
            >
              <GripVertical size={14} aria-hidden="true" />
            </div>
            <button
              type="button"
              className="ps-icon-button"
              aria-label={t("studio.pick", "Pick element")}
              title={getHotkey("pick")?.shortcutLabel}
              onClick={startPicking}
            >
              <Wrench size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="ps-icon-button"
              aria-label={t("studio.multiSelect", "Multi-select")}
              title={getHotkey("multi")?.shortcutLabel}
              onClick={startMulti}
            >
              <CheckCircle2 size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="ps-icon-button"
              aria-label={t("studio.selectRegion", "Select region")}
              title={getHotkey("area")?.shortcutLabel}
              onClick={startMarquee}
            >
              <Eye size={14} aria-hidden="true" />
            </button>
            <button
              ref={copyButtonRef}
              type="button"
              className="ps-icon-button"
              aria-label={t("studio.copy", "Copy")}
              title={getHotkey("copy")?.shortcutLabel}
              onClick={copyMarkdown}
            >
              <Copy size={14} aria-hidden="true" />
            </button>
            {annotations.length > 0 ? (
              <button
                type="button"
                className="ps-icon-button"
                aria-label={
                  annotations.some((a) => a.hidden)
                    ? t("studio.showAllMarkers", "Show all markers")
                    : t("studio.hideAllMarkers", "Hide all markers")
                }
                onClick={() => {
                  const anyHidden = annotations.some((a) => a.hidden);
                  persistAnnotations(
                    annotations.map((a) => ({
                      ...a,
                      hidden: anyHidden ? false : true,
                    }))
                  );
                }}
              >
                {annotations.some((a) => a.hidden) ? (
                  <Eye size={14} aria-hidden="true" />
                ) : (
                  <EyeOff size={14} aria-hidden="true" />
                )}
              </button>
            ) : null}
            {/* Goal 04: view filter + Remove completed — DIRECT controls in
                the expanded dock (no ellipsis menu). Two buttons with
                aria-pressed on the ACTIVE view; changing the view closes
                any open marker editor so it cannot linger over a
                now-filtered annotation. */}
            <button
              type="button"
              className="ps-button ps-view-toggle"
              aria-pressed={viewFilter === "open"}
              onClick={() => {
                setViewFilter("open");
                setRemoveCompletedConfirm(false);
                closeMarkerEditor();
              }}
            >
              {t("studio.viewOpen", "Open")}
            </button>
            <button
              type="button"
              className="ps-button ps-view-toggle"
              aria-pressed={viewFilter === "all"}
              onClick={() => {
                setViewFilter("all");
                setRemoveCompletedConfirm(false);
                closeMarkerEditor();
              }}
            >
              {t("studio.viewAll", "All")}
            </button>
            <button
              type="button"
              className="ps-button ps-danger"
              disabled={completedCount === 0}
              onClick={() => setRemoveCompletedConfirm((current) => !current)}
            >
              {t("studio.removeCompleted", "Remove completed ({{count}})").replace(
                "{{count}}",
                String(completedCount)
              )}
            </button>
            {removeCompletedConfirm ? (
              <span className="ps-annotation-confirm" role="alert">
                {t(
                  "studio.confirmRemoveCompleted",
                  "Remove {{count}} completed annotation(s)? Open items stay."
                ).replace("{{count}}", String(completedCount))}{" "}
                <button
                  type="button"
                  className="ps-button ps-danger"
                  disabled={editorSaving}
                  onClick={() => {
                    persistAnnotations(removeCompletedAnnotations(annotations));
                    setRemoveCompletedConfirm(false);
                  }}
                >
                  {t("studio.remove", "Remove")}
                </button>
                <button
                  type="button"
                  className="ps-button"
                  onClick={() => setRemoveCompletedConfirm(false)}
                >
                  {t("studio.cancel", "Cancel")}
                </button>
              </span>
            ) : null}
            <button
              type="button"
              className="ps-icon-button"
              aria-label={t("studio.collapse", "Collapse")}
              onClick={() => setOpen(false)}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>

          {visibleAnnotations.length > 0 ? (
            <div className="ps-section">
              <p className="ps-label">
                {t("studio.annotationsList", "Annotations")} (
                {visibleAnnotations.length})
              </p>
              <ul className="ps-annotation-list">
                {visibleAnnotations.map((annotation) => {
                  // Display numbers derive from the CURRENT VISIBLE list
                  // order (D-034 #4), so the Open view renumbers 1..N and
                  // All shows the full order.
                  const number = annotationDisplayNumber(
                    visibleAnnotations,
                    annotation.annotationId
                  );
                  const unresolved = isAnnotationUnresolved(annotation);
                  const hidden = annotation.hidden === true;
                  const completed = annotation.status === "completed";
                  const editing = editingId === annotation.annotationId;
                  const confirming = confirmDeleteId === annotation.annotationId;
                  const dirty = editing && editValue !== annotation.comment;
                  return (
                    <li
                      key={annotation.annotationId}
                      className={
                        hidden
                          ? "ps-annotation-item ps-annotation-item-hidden"
                          : completed
                            ? "ps-annotation-item ps-annotation-item-completed"
                            : "ps-annotation-item"
                      }
                    >
                      <span
                        className={
                          completed
                            ? "ps-marker-chip ps-marker-chip-completed"
                            : "ps-marker-chip"
                        }
                      >
                        {number ?? "?"}
                      </span>
                      <span className="ps-annotation-body">
                        {editing ? (
                          <textarea
                            className="ps-textarea ps-annotation-edit"
                            rows={2}
                            autoFocus
                            disabled={editorSaving}
                            value={editValue}
                            onChange={(event) => setEditValue(event.target.value)}
                            onKeyDown={(event) => {
                              // D-034 #1: Enter = newline, Ctrl/Cmd+Enter = save.
                              if (
                                event.key === "Enter" &&
                                (event.ctrlKey || event.metaKey)
                              ) {
                                event.preventDefault();
                                saveEdit();
                              }
                            }}
                          />
                        ) : (
                          <span className="ps-annotation-comment">
                            {annotation.comment.slice(0, 120) ||
                              t("studio.emptyComment", "(empty)")}
                          </span>
                        )}
                        {dirty ? (
                          <span className="ps-unresolved">
                            {t("studio.unsaved", "Unsaved")}
                          </span>
                        ) : null}
                        {unresolved ? (
                          <span className="ps-unresolved">
                            {t("studio.unresolved", "Target not found")}
                          </span>
                        ) : null}
                        {completed ? (
                          <span className="ps-completed-label">
                            {t("studio.completed", "Completed")}
                          </span>
                        ) : null}
                        {hidden ? (
                          <span className="ps-unresolved">
                            {t("studio.hidden", "Hidden")}
                          </span>
                        ) : null}
                        {confirming ? (
                          <span className="ps-annotation-confirm" role="alert">
                            {t(
                              "studio.confirmDelete",
                              "Delete this annotation?"
                            )}
                            <button
                              type="button"
                              className="ps-button ps-danger"
                              disabled={editorSaving}
                              onClick={confirmDelete}
                            >
                              {t("studio.delete", "Delete")}
                            </button>
                            <button
                              type="button"
                              className="ps-button"
                              disabled={editorSaving}
                              onClick={() => setConfirmDeleteId(null)}
                            >
                              {t("studio.cancel", "Cancel")}
                            </button>
                          </span>
                        ) : null}
                        {!confirming ? (
                          <span className="ps-annotation-actions">
                            <button
                              type="button"
                              className="ps-icon-button"
                              aria-label={t(
                                "studio.editAnnotation",
                                "Edit comment"
                              )}
                              disabled={editorSaving}
                              onClick={() => startEdit(annotation)}
                            >
                              <Pencil size={12} aria-hidden="true" />
                            </button>
                            {completed ? (
                              <button
                                type="button"
                                className="ps-icon-button"
                                aria-label={t("studio.reopen", "Reopen")}
                                disabled={editorSaving}
                                onClick={() =>
                                  persistAnnotations(
                                    reopenAnnotation(
                                      annotations,
                                      annotation.annotationId
                                    )
                                  )
                                }
                              >
                                <RotateCcw size={12} aria-hidden="true" />
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="ps-icon-button"
                                aria-label={t(
                                  "studio.completeAnnotation",
                                  "Complete"
                                )}
                                aria-pressed={completed}
                                disabled={editorSaving}
                                onClick={() =>
                                  persistAnnotations(
                                    completeAnnotation(
                                      annotations,
                                      annotation.annotationId
                                    )
                                  )
                                }
                              >
                                <CheckCircle2 size={12} aria-hidden="true" />
                              </button>
                            )}
                            <button
                              type="button"
                              className="ps-icon-button"
                              aria-label={t(
                                "studio.hideAnnotation",
                                "Hide"
                              )}
                              aria-pressed={hidden}
                              disabled={editorSaving}
                              onClick={() =>
                                persistAnnotations(
                                  toggleAnnotationHidden(
                                    annotations,
                                    annotation.annotationId
                                  )
                                )
                              }
                            >
                              {hidden ? (
                                <EyeOff size={12} aria-hidden="true" />
                              ) : (
                                <Eye size={12} aria-hidden="true" />
                              )}
                            </button>
                            <button
                              type="button"
                              className="ps-icon-button"
                              aria-label={t(
                                "studio.deleteAnnotation",
                                "Delete"
                              )}
                              disabled={editorSaving}
                              ref={(node) => {
                                // Re-arm on every mount so the Esc focus
                                // return targets a CONNECTED button (F-1).
                                if (node && !confirming) {
                                  confirmDeleteButtonRef.current = node;
                                }
                              }}
                              onClick={() =>
                                setConfirmDeleteId(annotation.annotationId)
                              }
                            >
                              <Trash2 size={12} aria-hidden="true" />
                            </button>
                          </span>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
          {visibleAnnotations.length === 0 && annotations.length > 0 ? (
            <div className="ps-section">
              <p className="ps-hint" role="status">
                {t(
                  "studio.emptyOpenView",
                  "No open annotations — switch to All to review completed items."
                )}
              </p>
            </div>
          ) : null}

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

          {mode.kind === "multi" ? (
            <div className="ps-section" role="status" aria-live="polite">
              <p className="ps-hint">
                {t(
                  "studio.multiHint",
                  "Multi-select: click to toggle elements in/out of ONE annotation. Arrow keys move, Space toggles, Enter opens the comment editor, Esc cancels."
                )}
              </p>
              <p className="ps-meta">
                {t("studio.selectedCount", "Selected")}:{" "}
                <strong>{selectionCount}</strong>
              </p>
              <div className="ps-actions">
                <button
                  type="button"
                  className="ps-button"
                  onClick={cancelMulti}
                >
                  {t("studio.cancel", "Cancel")}
                </button>
                <button
                  type="button"
                  className="ps-button ps-primary"
                  onClick={commitMulti}
                >
                  {t("studio.finishGroup", "Finish group")}
                </button>
              </div>
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
                {t("studio.instruction", "Annotation comment")}
              </label>
              <textarea
                id="ps-instruction"
                className="ps-textarea"
                rows={3}
                value={draftComment}
                onChange={(event) => setDraftComment(event.target.value)}
                onKeyDown={(event) => {
                  // D-034 #1: plain Enter inserts a newline; Ctrl/Cmd+Enter
                  // saves the annotation.
                  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault();
                    saveTask();
                  }
                }}
                placeholder={t(
                  "studio.instructionPlaceholder",
                  "Describe the change the agent should make… Ctrl+Enter saves."
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
              {mode.notice ? (
                <p className="ps-hint" role="alert">
                  {mode.notice}
                </p>
              ) : null}
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

        </div>
      ) : null}

      {picking || isMulti ? (
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

      {/* Annotation-first marker overlay (G02, D-033 #8/#9; Goal 03):
          numbered, SEMANTIC BUTTON markers over resolved live targets;
          region rects with dashed outlines carry a marker button at the
          top-right corner. Rendered INSIDE the shadow host (D-034 #3
          mounting rule) so markers never pollute evidence screenshots and
          can never be annotated by Studio itself. Unresolved targets stay
          in the list (grey chip) with no page anchor. */}
      {visibleAnnotations.map((annotation) => {
        if (annotation.hidden === true) return null;
        // Display numbers derive from the CURRENT VISIBLE list (D-034 #4),
        // so marker numbers match the list chips in every view.
        const number = annotationDisplayNumber(
          visibleAnnotations,
          annotation.annotationId
        );
        const completed = annotation.status === "completed";
        const chipClass = completed
          ? "ps-marker-chip ps-marker-chip-onpage ps-marker-chip-button ps-marker-chip-completed"
          : "ps-marker-chip ps-marker-chip-onpage ps-marker-chip-button";
        const markerLabel = t(
          "studio.marker.openEditor",
          "Annotation {{number}}: open editor"
        ).replace("{{number}}", String(number ?? "?"));
        const markerRef = (node: HTMLButtonElement | null) => {
          if (node) {
            markerButtonRefs.current.set(annotation.annotationId, node);
          } else {
            markerButtonRefs.current.delete(annotation.annotationId);
          }
        };
        const markerOnClick = () => {
          // Save-in-flight lock (review): a marker click can neither close
          // nor switch the editor while a save POST is pending, so a late
          // success/failure stays attached to the ORIGINAL editor+draft.
          if (editorSaving) return;
          if (editorAnnotationId === annotation.annotationId) {
            closeMarkerEditor();
            return;
          }
          openMarkerEditor(annotation);
        };
        if (annotation.kind === "region" && annotation.region) {
          return (
            <div
              key={annotation.annotationId}
              className="ps-outline ps-region"
              style={regionStyle(annotation.region)}
            >
              <button
                type="button"
                ref={markerRef}
                className={`${chipClass} ps-marker-region-chip`}
                style={{ position: "absolute", top: 4, right: 4 }}
                aria-label={markerLabel}
                onClick={markerOnClick}
              >
                {number ?? "?"}
              </button>
            </div>
          );
        }
        const target = resolveAnnotationTarget(annotation);
        if (!target) return null;
        const rect = target.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return null;
        void markerTick;
        return (
          <div
            key={annotation.annotationId}
            className="ps-marker-anchor"
            style={{
              left: rect.left - 6,
              top: rect.top - 6,
            }}
          >
            <button
              type="button"
              ref={markerRef}
              className={chipClass}
              aria-label={markerLabel}
              onClick={markerOnClick}
            >
              {number ?? "?"}
            </button>
          </div>
        );
      })}

      {/* Goal 03: temporary multi-target highlight while the editor is
          open on a multi annotation — every resolved captured target is
          outlined so the group is visible at once. */}
      {editorAnnotation && editorAnnotation.kind === "multi"
        ? resolveAnnotationTargets(editorAnnotation).map((target, index) => {
            const rect = target.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return null;
            return (
              <div
                key={`${editorAnnotation.annotationId}-hl-${index}`}
                className="ps-outline ps-selected ps-marker-highlight"
                style={rectStyle(rect)}
                aria-hidden="true"
              />
            );
          })
        : null}

      {/* Goal 03: marker-local editor — small, viewport-clamped dialog
          beside the marker. Events inside it are stopped from leaking to
          the business page or capture handlers (pointer/keyboard/hotkey
          isolation; the shadow host additionally keeps it out of page
          listeners and screenshots). */}
      {editorAnnotation && editorAnchor ? (
        <div
          ref={editorRef}
          className="ps-marker-editor"
          role="dialog"
          aria-label={t("studio.editorTitle", "Annotation editor")}
          style={{
            left: editorAnchor.left,
            top: editorAnchor.top,
            width: MARKER_EDITOR_WIDTH,
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <p className="ps-label" id="ps-marker-editor-label">
            {t("studio.instruction", "Annotation comment")}
          </p>
          <textarea
            className="ps-textarea"
            rows={3}
            autoFocus
            aria-labelledby="ps-marker-editor-label"
            disabled={editorSaving}
            value={editorDraft}
            onChange={(event) => setEditorDraft(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                saveEditorComment();
              }
            }}
          />
          {editorError ? (
            <p className="ps-error" role="alert">
              {editorError}
            </p>
          ) : null}
          <div className="ps-actions">
            <button
              type="button"
              className="ps-button ps-primary"
              disabled={editorSaving}
              onClick={saveEditorComment}
            >
              {editorSaving
                ? t("studio.saving", "Saving task…")
                : t("studio.saveComment", "Save comment")}
            </button>
            {editorAnnotation.status === "completed" ? (
              <button
                type="button"
                className="ps-button"
                disabled={editorSaving}
                onClick={reopenEditorAnnotation}
              >
                {t("studio.reopen", "Reopen")}
              </button>
            ) : (
              <button
                type="button"
                className="ps-button"
                disabled={editorSaving}
                onClick={completeEditorAnnotation}
              >
                {t("studio.completeAnnotation", "Complete")}
              </button>
            )}
            {editorDeleteConfirm ? (
              <span className="ps-annotation-confirm" role="alert">
                {t("studio.confirmDelete", "Delete this annotation?")}{" "}
                <button
                  type="button"
                  className="ps-button ps-danger"
                  disabled={editorSaving}
                  onClick={deleteEditorAnnotation}
                >
                  {t("studio.delete", "Delete")}
                </button>
                <button
                  type="button"
                  className="ps-button"
                  disabled={editorSaving}
                  onClick={() => setEditorDeleteConfirm(false)}
                >
                  {t("studio.cancel", "Cancel")}
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="ps-button ps-danger"
                disabled={editorSaving}
                onClick={() => setEditorDeleteConfirm(true)}
              >
                {t("studio.deleteAnnotation", "Delete")}
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
