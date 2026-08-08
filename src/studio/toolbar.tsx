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
  Eye,
  EyeOff,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Trash2,
  Wrench,
  X,
} from "lucide-react";

import { translate } from "@nocobase/portal-sdk/i18n";

import { sessionErrorMessage } from "./errors";

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
import { captureViewportPng } from "./screenshot";
import { isAnnotationUnresolved, resolveAnnotationTarget } from "./markers";
import { newTaskId } from "./task-id";
import {
  annotationDisplayNumber,
  clearAnnotations,
  groupToggleElement,
  normalizeTask,
  removeAnnotation,
  toggleAnnotationHidden,
  updateAnnotationComment,
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
/** Flip the More menu below the dock when less space remains above. */
const MENU_FLIP_MIN_ABOVE = 60;

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
  const dockRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
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
  const [clearAllConfirm, setClearAllConfirm] = useState(false);
  // Last-known task (loaded from the server) used to rebuild mutation
  // POSTs through the existing atomic rewrite (no new endpoints).
  const taskRef = useRef<PortalStudioTask | null>(null);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const isMulti = mode.kind === "multi";
  const isIdle = mode.kind === "idle";
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

  // Close the More menu on outside clicks and Esc (focus returns to More).
  useEffect(() => {
    if (!menuOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      setClearAllConfirm(false);
      moreButtonRef.current?.focus();
    };
    const handlePointerDown = (event: PointerEvent | MouseEvent) => {
      // composedPath() crosses the shadow boundary: events from inside the
      // shadow are retargeted to the host, so a plain `contains(target)`
      // check would treat menu-item clicks as outside clicks and unmount
      // the menu before the item's click can fire (F1).
      const path = event.composedPath?.() ?? [];
      if (dockRef.current && path.includes(dockRef.current)) return;
      setMenuOpen(false);
      setClearAllConfirm(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [menuOpen]);

  const persistDockPosition = (next: DockPosition) => {
    setDockPosition(next);
    saveDockPosition(readDockStorage(), next);
  };

  // Pointer drag (G01 AC1): starts on any dock surface (row, toggle,
  // badge — More menu excluded). No pointer capture, so button clicks keep
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
    const target = event.target;
    if (target instanceof Element && target.closest(".ps-more-menu")) return;
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

  const resetDockPosition = () => {
    persistDockPosition(defaultDockPosition(viewport, dockWidth));
    setMenuOpen(false);
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

  // Load the persisted annotations + revision status (schema v4/v5 dual
  // read, D-033 #17). Runs on mount (the dock badge shows the live count
  // without opening the panel) and refreshes when the panel opens.
  useEffect(() => {
    if (typeof fetch !== "function") return;
    let cancelled = false;
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
          if (cancelled || !payload?.task) return;
          const normalized = normalizeTask(payload.task);
          if (!normalized) return;
          taskRef.current = normalized;
          setAnnotations(normalized.annotations);
          const revision = normalized.revision as
            | {
                sourceRevision?: string;
                browserRevision?: number;
                state?: string;
              }
            | undefined;
          if (revision) {
            setRevisionStatus({
              sourceRevision: revision.sourceRevision,
              browserRevision: revision.browserRevision,
              state: revision.state,
            });
          }
        }
      )
      .catch(() => {
        // Dev server restarting; status stays hidden.
      });
    return () => {
      cancelled = true;
    };
  }, [config.endpoint, config.token, open]);

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
  useEffect(() => {
    if (!isMulti) return;

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
   */
  /** Send one mutation POST (keepalive so reload flushes survive).
   *  NOTE: keepalive bodies are limited to 64 KB by the browser vs the
   *  256 KB artifact cap — a mutation flush beyond 64 KB may fail silently
   *  on unload (F-5; realistic annotation payloads stay far below). */
  const sendMutation = useCallback(
    (payload: PortalStudioTask) => {
      fetch(config.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Portal-Studio-Token": config.token,
        },
        body: JSON.stringify(payload),
        keepalive: true,
      })
        .then((response) => response.json())
        .then((result: { ok?: boolean; error?: string }) => {
          if (result.ok !== true) {
            setMode({
              kind: "error",
              message: result.error ?? "annotation update failed",
            });
          }
        })
        .catch(() => {
          // Dev server restarting; the next mutation retries.
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
      sendMutation(payload);
    }
  }, [sendMutation]);

  const persistAnnotations = useCallback(
    (next: Annotation[]) => {
      setAnnotations(next);
      const base = taskRef.current;
      if (!base) return;
      const payload: PortalStudioTask = { ...base, annotations: next };
      pendingPayloadRef.current = payload;
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
      persistTimerRef.current = setTimeout(() => {
        pendingPayloadRef.current = null;
        taskRef.current = payload;
        sendMutation(payload);
      }, 300);
    },
    [sendMutation]
  );

  // Flush pending mutations on unmount AND on beforeunload (reloads) —
  // otherwise an edit made <300 ms before a reload would be lost (found
  // by the G03 e2e: the optimistic UI hid the missing persistence).
  useEffect(() => {
    const flush = () => flushPendingMutation();
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      flushPendingMutation();
    };
  }, [flushPendingMutation]);

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

  const confirmClearAll = () => {
    persistAnnotations(clearAnnotations());
    setClearAllConfirm(false);
    setMenuOpen(false);
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
      setDraftComment("");
      setAnnotations([]);
      taskRef.current = null;
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

  /** Reset all capture-session state (selection, draft text, mode). */
  const resetSession = useCallback(() => {
    selectionRef.current = EMPTY_SELECTION;
    setSelectionRects([]);
    setSelectionCount(0);
    setDraftComment("");
    setMode({ kind: "idle" });
    setOutlineRect(undefined);
    setHoverName(null);
  }, []);

  const panelVisible = open;

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
              : t("studio.toggle.open", "Open Portal Studio")
          }
          aria-expanded={open}
          onClick={() => {
            if (didDragRef.current) {
              didDragRef.current = false;
              return;
            }
            setOpen((current) => !current);
            setMenuOpen(false);
            resetSession();
          }}
          onKeyDown={handleToggleKeyDown}
        >
          <Wrench size={18} aria-hidden="true" />
        </button>
        <span
          className="ps-badge"
          role="status"
          aria-label={t("studio.annotations", "Annotations")}
        >
          {annotations.length}
        </span>
        <button
          ref={moreButtonRef}
          type="button"
          className="ps-icon-button ps-more-button"
          aria-label={t("studio.more", "More")}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => {
            // Same post-drag click suppression as the toggle (F3): a drag
            // that starts and ends on the More button must not toggle it.
            if (didDragRef.current) {
              didDragRef.current = false;
              return;
            }
            setClearAllConfirm(false);
            setMenuOpen((current) => !current);
          }}
        >
          <MoreHorizontal size={16} aria-hidden="true" />
        </button>
        {menuOpen ? (
          clearAllConfirm ? (
            <div
              className={
                position.y < MENU_FLIP_MIN_ABOVE
                  ? "ps-more-menu ps-more-menu-below"
                  : "ps-more-menu"
              }
              role="alert"
            >
              <p className="ps-hint">
                {t("studio.confirmClearAll", "Clear all annotations?")}
              </p>
              <div className="ps-actions">
                <button
                  type="button"
                  className="ps-button ps-danger"
                  onClick={confirmClearAll}
                >
                  {t("studio.clearAll", "Clear all")}
                </button>
                <button
                  type="button"
                  className="ps-button"
                  onClick={() => setClearAllConfirm(false)}
                >
                  {t("studio.cancel", "Cancel")}
                </button>
              </div>
            </div>
          ) : (
            <div
              className={
                position.y < MENU_FLIP_MIN_ABOVE
                  ? "ps-more-menu ps-more-menu-below"
                  : "ps-more-menu"
              }
              role="menu"
            >
              <button
                type="button"
                className="ps-menu-item"
                role="menuitem"
                onClick={resetDockPosition}
              >
                <RotateCcw size={14} aria-hidden="true" />
                {t("studio.resetDock", "Reset dock position")}
              </button>
              <button
                type="button"
                className="ps-menu-item ps-menu-item-danger"
                role="menuitem"
                onClick={() => setClearAllConfirm(true)}
              >
                <Trash2 size={14} aria-hidden="true" />
                {t("studio.clearAllAnnotations", "Clear all annotations")}
              </button>
            </div>
          )
        ) : null}
      </div>

      {panelVisible ? (
        <div
          className="ps-panel"
          style={layout.panel}
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
              <X size={14} aria-hidden="true" />
            </button>
          </div>

          {annotations.length > 0 ? (
            <div className="ps-section">
              <p className="ps-label">
                {t("studio.annotationsList", "Annotations")} (
                {annotations.length})
              </p>
              <ul className="ps-annotation-list">
                {annotations.map((annotation) => {
                  const number = annotationDisplayNumber(
                    annotations,
                    annotation.annotationId
                  );
                  const unresolved = isAnnotationUnresolved(annotation);
                  const hidden = annotation.hidden === true;
                  const editing = editingId === annotation.annotationId;
                  const confirming = confirmDeleteId === annotation.annotationId;
                  const dirty = editing && editValue !== annotation.comment;
                  return (
                    <li
                      key={annotation.annotationId}
                      className={
                        hidden
                          ? "ps-annotation-item ps-annotation-item-hidden"
                          : "ps-annotation-item"
                      }
                    >
                      <span className="ps-marker-chip">{number ?? "?"}</span>
                      <span className="ps-annotation-body">
                        {editing ? (
                          <textarea
                            className="ps-textarea ps-annotation-edit"
                            rows={2}
                            autoFocus
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
                              onClick={confirmDelete}
                            >
                              {t("studio.delete", "Delete")}
                            </button>
                            <button
                              type="button"
                              className="ps-button"
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
                              onClick={() => startEdit(annotation)}
                            >
                              <Pencil size={12} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              className="ps-icon-button"
                              aria-label={t(
                                "studio.hideAnnotation",
                                "Hide"
                              )}
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
                  onClick={startMulti}
                >
                  {t("studio.multiSelect", "Multi-select")}
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

      {/* Annotation-first marker overlay (G02, D-033 #8/#9): numbered
          badges over resolved live targets; region rects with dashed
          outlines. Rendered INSIDE the shadow host (D-034 #3 mounting
          rule) so markers never pollute evidence screenshots and can
          never be annotated by Studio itself. Unresolved targets stay in
          the list (grey chip) with no page anchor. */}
      {annotations.map((annotation) => {
        if (annotation.hidden === true) return null;
        const number = annotationDisplayNumber(
          annotations,
          annotation.annotationId
        );
        if (annotation.kind === "region" && annotation.region) {
          return (
            <div
              key={annotation.annotationId}
              className="ps-outline ps-region"
              style={regionStyle(annotation.region)}
              aria-hidden="true"
            >
              <span className="ps-marker-chip ps-marker-chip-onpage">
                {number ?? "?"}
              </span>
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
            aria-hidden="true"
          >
            <span className="ps-marker-chip ps-marker-chip-onpage">
              {number ?? "?"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
