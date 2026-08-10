/**
 * Portal Studio — Shadow DOM toolbar (schema v2).
 *
 * Dev-only client UI rendered inside a shadow root (see `index.tsx`). Plain
 * semantic HTML + scoped styles. Interactions: strictly single-target pick
 * (click/Enter), true Multi-select (the only multi-target path), drag
 * marquee region selection, replace (a new plain pick replaces the
 * selection), and an annotated screenshot taken at save time. Keyboard
 * accessible: Tab reaches the dock, Esc cancels, arrow keys move between
 * the hovered element and its ancestors while picking.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import { translate } from "@nocobase/portal-sdk/i18n";

import { StudioAnnotationListPanel } from "./StudioAnnotationListPanel";
import { StudioShortcutHelp } from "./StudioShortcutHelp";
import {
  StudioToolbarShell,
  type AuxiliaryPanel,
} from "./StudioHorizontalToolbar";
import {
  rectFrom,
  resolveAnchoredPlacement,
  type AnchorRect,
} from "./placement";

import { sessionErrorMessage } from "./errors";
import { matchStudioShortcut } from "./hotkeys";
import {
  applyMutationOperations,
  isFullyCompletedTask,
  type MutationOp,
} from "./mutation";
import {
  annotationMatchesRoute,
  capturePageContext,
  currentRouteKey,
} from "./route-context";
import { postMutation } from "./task-client";

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
  TOGGLE_SIZE,
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
  resolveAnnotationTarget,
  resolveAnnotationTargets,
  resolveMarkerEditorPosition,
  MARKER_EDITOR_WIDTH,
} from "./markers";
import { newTaskId } from "./task-id";
import {
  annotationDisplayNumber,
  countOpenAnnotations,
  groupToggleElement,
  normalizeTask,
  selectVisibleAnnotations,
  type ViewFilter,
} from "./task-model";
import {
  commitRegion,
  EMPTY_SELECTION,
  normalizeRegion,
  replaceSelection,
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
  /** Goal 05: lightweight same-origin revision read endpoint. */
  revisionEndpoint?: string;
  /** Goal 06: typed revision-aware mutation endpoint. */
  mutateEndpoint?: string;
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
  const [dockHeight, setDockHeight] = useState(TOGGLE_SIZE);
  const dockPositionRef = useRef<DockPosition | null>(dockPosition);
  dockPositionRef.current = dockPosition;
  const dockWidthRef = useRef(dockWidth);
  dockWidthRef.current = dockWidth;
  const dockHeightRef = useRef(dockHeight);
  dockHeightRef.current = dockHeight;
  const dragRef = useRef<DragState | null>(null);
  const dragListenersRef = useRef<{
    move: (event: PointerEvent) => void;
    up: (event: PointerEvent) => void;
    cancel: (event: PointerEvent) => void;
    blur?: () => void;
    release?: () => void;
    handle?: HTMLElement;
    lostPointerCapture?: (event: PointerEvent) => void;
  } | null>(null);
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
  // per-row delete confirmation, and the remove-completed confirmation.
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
  // Goal 01 v5: presentation-only marker visibility (never a batch
  // setHidden mutation) and the mutually-exclusive auxiliary panel
  // (shortcut help / annotation list).
  const [markersVisible, setMarkersVisible] = useState(true);
  const [auxPanel, setAuxPanel] = useState<AuxiliaryPanel>("none");
  const helpButtonRef = useRef<HTMLButtonElement | null>(null);
  const listButtonRef = useRef<HTMLButtonElement | null>(null);
  const openCountRef = useRef(0);
  // Trigger rects for the anchored Help/List panels (filled by a layout
  // effect once the expanded bar has rendered).
  const [auxAnchors, setAuxAnchors] = useState<{
    shortcuts?: AnchorRect;
    annotations?: AnchorRect;
  }>({});
  // Round-6 blocker 1: RENDERED surface heights of the Help/List panels
  // (bounded by maxHeight) drive the above-flip anchor so the panels hug
  // their trigger buttons; recomputed on open, dock move, viewport resize
  // and panel-content size changes (ResizeObserver where available).
  const [helpSurfaceHeight, setHelpSurfaceHeight] = useState<number | null>(
    null
  );
  const [listSurfaceHeight, setListSurfaceHeight] = useState<number | null>(
    null
  );
  const helpSurfaceNodeRef = useRef<HTMLDivElement | null>(null);
  const listSurfaceNodeRef = useRef<HTMLDivElement | null>(null);
  const [auxResizeTick, setAuxResizeTick] = useState(0);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const markerButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const editorSavingRef = useRef(false);
  editorSavingRef.current = editorSaving;
  // Copy state (G04, D-033 #12): "idle" | "copied" (aria-live feedback) |
  // "manual" (Clipboard unavailable — selectable textarea fallback).
  const [copyState, setCopyState] = useState<
    "idle" | "copied" | "manual"
  >("idle");
  // Mount-once refs mirroring the transient-surface states. The Esc /
  // outside-click listeners are registered ONCE at mount and read these
  // refs, so a keypress arriving immediately after a surface opens is
  // never lost to effect-registration timing (external review, P7).
  const copyStateRef = useRef(copyState);
  copyStateRef.current = copyState;
  const auxPanelRef = useRef(auxPanel);
  auxPanelRef.current = auxPanel;
  const editorAnnotationIdRef = useRef(editorAnnotationId);
  editorAnnotationIdRef.current = editorAnnotationId;
  const editingIdRef = useRef(editingId);
  editingIdRef.current = editingId;
  const confirmDeleteIdRef = useRef(confirmDeleteId);
  confirmDeleteIdRef.current = confirmDeleteId;
  const removeCompletedConfirmRef = useRef(removeCompletedConfirm);
  removeCompletedConfirmRef.current = removeCompletedConfirm;
  // Round-4 finding 5: the RENDERED dialog height (bounded by maxHeight)
  // drives the above-flip anchor so the fallback hugs the Copy button;
  // recomputed on dock moves, viewport resize and height changes.
  const [copyFallbackHeight, setCopyFallbackHeight] = useState<number | null>(
    null
  );
  const [copyResizeTick, setCopyResizeTick] = useState(0);
  useEffect(() => {
    const onResize = () => setCopyResizeTick((tick) => tick + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useLayoutEffect(() => {
    if (copyState !== "manual") {
      setCopyFallbackPlacement(null);
      setCopyFallbackHeight(null);
      return;
    }
    const trigger = copyButtonRef.current?.getBoundingClientRect();
    if (!trigger) return;
    const viewport = viewportOf(window);
    setCopyFallbackPlacement(
      resolveAnchoredPlacement({
        trigger: rectFrom(trigger),
        viewport,
        width: 320,
        maxHeight: Math.max(160, Math.round(viewport.height * 0.6)),
        // Genuine anchoring: use the measured rendered height so an
        // above-flipped dialog sits right above the button, not hundreds
        // of pixels away (round-4 finding 5).
        surfaceHeight: copyFallbackHeight ?? undefined,
      })
    );
  }, [copyState, copyFallbackHeight, copyResizeTick, dockPosition]);
  const [copyText, setCopyText] = useState("");
  const copyFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  // Round-3 finding 4: the manual-Copy fallback is anchored to the REAL
  // Copy button through the shared viewport-aware placement utility
  // (flip above/below + horizontal clamping), recomputed on dock moves.
  const [copyFallbackPlacement, setCopyFallbackPlacement] = useState<{
    left: number;
    top: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const copyButtonRef = useRef<HTMLButtonElement | null>(null);
  // Last-known task (loaded from the server) used to rebuild mutation
  // POSTs through the existing atomic rewrite (no new endpoints).
  const taskRef = useRef<PortalStudioTask | null>(null);
  // Goal 05: revision baseline = the last FETCHED task's taskRevision
  // (set in refreshTask; read by the visibility-aware polling effect).
  const lastTaskRevisionRef = useRef<number | null>(null);
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

  // Measure the real dock size once so clamping keeps the whole chip/bar
  // inside the viewport; falls back to the constants when measurement is
  // unavailable (jsdom).
  useLayoutEffect(() => {
    const element = dockRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const measuredWidth = rect.width;
    const measuredHeight = rect.height;
    if (measuredWidth > 0 && measuredHeight > 0) {
      setDockWidth(measuredWidth);
      setDockHeight(measuredHeight);
      // Re-clamp a persisted position against the MEASURED size so a
      // position saved at the extreme edge cannot sit off-viewport after
      // reload (round-2 P4).
      const persisted = dockPositionRef.current;
      if (persisted) {
        setDockPosition(
          clampDockPosition(
            persisted,
            viewportOf(window),
            measuredWidth,
            measuredHeight
          )
        );
      }
    }
    // Goal 01 v5: the dock size changes between the collapsed chip and
    // the expanded bar — re-measure + re-clamp whenever the state flips so
    // the expanded toolbar always stays inside the viewport.
  }, [open]);



  const persistDockPosition = (next: DockPosition) => {
    setDockPosition(next);
    saveDockPosition(readDockStorage(), next);
  };

  // Pointer drag (G01 AC1, round-3 finding 1): the drag handle captures
  // the pointer (setPointerCapture with pointerId filtering) so the gesture
  // survives leaving the handle; the capture is released safely on
  // pointerup/pointercancel, lostpointercapture, window blur and unmount.
  // Click-vs-drag: movement past the threshold marks the gesture as a
  // drag, and a dragged gesture never expands/clicks (the chip body's own
  // threshold tracking is independent). Ordinary clicks and keyboard
  // focus keep their natural semantics (no preventDefault on pointerdown).
  // The page-level picking/marquee listeners are unaffected: they exclude
  // Studio elements (isStudioElement, D-034 #3) and the window-capture
  // handler stops propagation of the events it consumes.
  const stopDragListeners = () => {
    const listeners = dragListenersRef.current;
    if (!listeners) return;
    // Round-4 finding 1: every listener is removed with the IDENTICAL
    // callback that registered it (pointercancel uses `cancel`, not `up`),
    // including the handle's lostpointercapture listener — removed BEFORE
    // releasing capture so release/lost-capture reentrancy is impossible.
    window.removeEventListener("pointermove", listeners.move, true);
    window.removeEventListener("pointerup", listeners.up, true);
    window.removeEventListener("pointercancel", listeners.cancel, true);
    if (listeners.blur) window.removeEventListener("blur", listeners.blur);
    if (listeners.handle && listeners.lostPointerCapture) {
      listeners.handle.removeEventListener(
        "lostpointercapture",
        listeners.lostPointerCapture
      );
    }
    listeners.release?.();
    dragListenersRef.current = null;
  };

  const handleDockPointerDown = (
    event: React.PointerEvent<HTMLElement>
  ) => {
    // Goal 01 v5: dragging the toolbar closes transient tooltips and
    // auxiliary popovers (contract §10) but preserves all task/composer
    // data — only presentation surfaces are dismissed.
    setAuxPanel("none");
    // Round-4 finding 1: a replacement gesture must not leak the previous
    // gesture's window/handle listeners.
    stopDragListeners();
    const drag: DragState = {
      startX: event.clientX,
      startY: event.clientY,
      origin: dockPositionRef.current ?? position,
      moved: false,
    };
    dragRef.current = drag;
    const handle = event.currentTarget as HTMLElement;
    const pointerId = event.pointerId;
    // Real pointer capture (round-3 finding 1): the drag continues even
    // when the pointer leaves the handle. Wrapped defensively — capture
    // can throw if the pointer is already gone (synthetic jsdom events).
    let captured = false;
    try {
      handle.setPointerCapture(pointerId);
      captured = true;
    } catch {
      captured = false;
    }
    const releaseCapture = () => {
      if (!captured) return;
      captured = false;
      try {
        if (typeof handle.hasPointerCapture === "function" &&
            handle.hasPointerCapture(pointerId)) {
          handle.releasePointerCapture(pointerId);
        }
      } catch {
        // Already released by the browser (lostpointercapture).
      }
    };
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const active = dragRef.current;
      if (!active) return;
      const dx = moveEvent.clientX - active.startX;
      const dy = moveEvent.clientY - active.startY;
      if (!active.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      active.moved = true;
      // Fresh viewport/width so a mid-drag resize clamps correctly (F5).
      const currentViewport = viewportOf(window);
      setDockPosition(
        clampDockPosition(
          { x: active.origin.x + dx, y: active.origin.y + dy },
          currentViewport,
          dockWidthRef.current,
          dockHeightRef.current
        )
      );
      moveEvent.preventDefault();
      moveEvent.stopPropagation();
    };
    const finish = (finishEvent: PointerEvent, save: boolean) => {
      if (finishEvent.pointerId !== pointerId) return;
      stopDragListeners();
      dragRef.current = null;
      finishEvent.stopPropagation();
      if (save && drag.moved) {
        saveDockPosition(readDockStorage(), dockPositionRef.current ?? position);
      }
    };
    const up = (upEvent: PointerEvent) => finish(upEvent, true);
    const cancel = (cancelEvent: PointerEvent) => finish(cancelEvent, false);
    const onBlur = () => {
      // Window blur (alt-tab etc.): abort the drag without persisting.
      if (!dragRef.current) return;
      stopDragListeners();
      dragRef.current = null;
    };
    const onLostPointerCapture = (lostEvent: PointerEvent) => {
      if (lostEvent.pointerId !== pointerId) return;
      // The browser ended the capture (e.g. pointercancel or an element
      // removal): abort the drag and clean up listeners.
      if (!dragRef.current) return;
      stopDragListeners();
      dragRef.current = null;
    };
    dragListenersRef.current = {
      move,
      up,
      cancel,
      release: releaseCapture,
      blur: onBlur,
      handle,
      lostPointerCapture: onLostPointerCapture,
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", cancel, true);
    window.addEventListener("blur", onBlur);
    handle.addEventListener("lostpointercapture", onLostPointerCapture);
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
    // Review P9: keyboard movement is treated like drag — transient
    // auxiliary panels (Help/List) close so their anchors cannot go stale.
    setAuxPanel("none");
    persistDockPosition(
      moveDockPosition(
        position,
        delta,
        viewport,
        step,
        dockWidth,
        dockHeight
      )
    );
  };

  // Goal 01 v5: auxiliary panel (shortcut help / annotation list) open and
  // close with mutual exclusion; collapse is presentation only and never
  // touches annotations, tasks or the composer draft.
  const toggleHelpPanel = useCallback(() => {
    setOpen(true);
    // Round-3 finding 3: switching to Help clears the LIST's transient UI
    // so a hidden confirm/edit can never block Help's own Esc handling.
    setEditingId(null);
    setEditValue("");
    setConfirmDeleteId(null);
    setRemoveCompletedConfirm(false);
    setAuxPanel((current) => (current === "shortcuts" ? "none" : "shortcuts"));
  }, []);

  const toggleListPanel = useCallback(() => {
    setOpen(true);
    setAuxPanel((current) =>
      current === "annotations" ? "none" : "annotations"
    );
  }, []);

  const collapseToolbar = useCallback(() => {
    setAuxPanel("none");
    setOpen(false);
  }, []);

  // Re-anchor the Help/List panels to their trigger buttons whenever the
  // expanded bar mounts or the panel opens (fallback until measured).
  useLayoutEffect(() => {
    if (auxPanel === "shortcuts") {
      const rect = helpButtonRef.current?.getBoundingClientRect();
      if (rect) {
        setAuxAnchors((current) => ({
          ...current,
          shortcuts: rectFrom(rect),
        }));
      }
    }
    if (auxPanel === "annotations") {
      const rect = listButtonRef.current?.getBoundingClientRect();
      if (rect) {
        setAuxAnchors((current) => ({
          ...current,
          annotations: rectFrom(rect),
        }));
      }
    }
    // Review P9: re-anchor synchronously on ANY dock movement/resize so an
    // open panel can never sit at a stale trigger position.
  }, [auxPanel, dockPosition, open, auxResizeTick, helpSurfaceHeight, listSurfaceHeight]);

  // Viewport resize: bump the tick so the trigger rects and placements are
  // recomputed when a null/default or clamped dock moves with the viewport.
  useEffect(() => {
    const onResize = () => setAuxResizeTick((tick) => tick + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Round-6 blocker 1: measure the RENDERED panel height (initial measure
  // via the surface ref; content-size changes via ResizeObserver where the
  // browser provides it — jsdom lacks ResizeObserver, so the ref measure
  // is the jsdom path).
  const setMeasuredSurfaceHeight = (
    which: "help" | "list",
    height: number
  ) => {
    if (which === "help") {
      setHelpSurfaceHeight((current) =>
        current === height ? current : height
      );
    } else {
      setListSurfaceHeight((current) =>
        current === height ? current : height
      );
    }
  };
  const helpSurfaceRef = useCallback((node: HTMLDivElement | null) => {
    helpSurfaceNodeRef.current = node;
    if (node) {
      setMeasuredSurfaceHeight("help", node.offsetHeight);
    }
  }, []);
  const listSurfaceRef = useCallback((node: HTMLDivElement | null) => {
    listSurfaceNodeRef.current = node;
    if (node) {
      setMeasuredSurfaceHeight("list", node.offsetHeight);
    }
  }, []);
  useEffect(() => {
    if (auxPanel === "none") return;
    const node =
      auxPanel === "shortcuts"
        ? helpSurfaceNodeRef.current
        : listSurfaceNodeRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      // Border-box size (padding + border included) — contentRect.height
      // excludes padding and made the panel sit ~26px too high.
      const entry = entries[0];
      const height =
        entry?.borderBoxSize?.[0]?.blockSize ?? entry?.contentRect.height;
      if (typeof height === "number" && height > 0) {
        setMeasuredSurfaceHeight(
          auxPanel === "shortcuts" ? "help" : "list",
          Math.round(height)
        );
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [auxPanel]);

  // Goal 01 v5: Help/List close on Esc (with focus return to the trigger)
  // and on outside pointerdown. Capture listeners are suspended while an
  // auxiliary panel is open, so Esc here never races a capture handler.
  // Registered ONCE at mount and gated on refs so an Esc/pointerdown right
  // after a surface opens is never lost to effect-registration timing.
  useEffect(() => {
    // Round-3 finding 3: ONE list-transient Esc coordinator. Esc closes
    // the TOPMOST transient surface first, panel-scoped — the manual-Copy
    // dialog, then Help/List transients by exact trigger, then the panel
    // itself. Hidden transients of the OTHER panel never block Esc.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const openPanel = auxPanelRef.current;
      if (openPanel === "none") return;
      // The manual-Copy dialog is topmost when open (its own mount-once
      // listener closes it and restores Copy focus).
      if (copyStateRef.current === "manual") return;
      // The marker editor owns Esc whenever it is open (target-side).
      if (editorAnnotationIdRef.current) return;
      if (openPanel === "shortcuts") {
        event.preventDefault();
        event.stopPropagation();
        setAuxPanel("none");
        requestAnimationFrame(() => {
          helpButtonRef.current?.focus();
        });
        return;
      }
      // openPanel === "annotations": the list's transients, topmost first
      // (round-4 finding 4). The remove-completed confirmation renders in
      // the panel FOOTER — painted last, so it is the visually topmost
      // list transient; the per-row delete confirmation renders below the
      // inline edit textarea within an item, and Esc priority follows the
      // finding's required order: remove-completed → delete confirm →
      // inline edit. A user who starts an inline edit and then opens the
      // row's Delete confirmation gets the CONFIRMATION closed first while
      // the edit stays active.
      if (removeCompletedConfirmRef.current) {
        event.preventDefault();
        event.stopPropagation();
        setRemoveCompletedConfirm(false);
        requestAnimationFrame(() => {
          removeCompletedTriggerRef.current?.focus();
        });
        return;
      }
      if (confirmDeleteIdRef.current) {
        const confirmId = confirmDeleteIdRef.current;
        event.preventDefault();
        event.stopPropagation();
        setConfirmDeleteId(null);
        requestAnimationFrame(() => {
          // Focus returns to the EXACT row that opened the confirmation
          // (id-keyed ref; re-armed on re-mount).
          deleteButtonRefs.current.get(confirmId)?.focus();
        });
        return;
      }
      if (editingIdRef.current) {
        const editingId = editingIdRef.current;
        event.preventDefault();
        event.stopPropagation();
        setEditingId(null);
        setEditValue("");
        requestAnimationFrame(() => {
          editButtonRefs.current.get(editingId)?.focus();
        });
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setAuxPanel("none");
      requestAnimationFrame(() => {
        listButtonRef.current?.focus();
      });
    };
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
      if (auxPanelRef.current === "none") return;
      // The panels live INSIDE the shadow root — document.getElementById
      // does not pierce shadow boundaries, so resolve them through the
      // toolbar root's shadow tree (real browsers) with a light-DOM
      // fallback (jsdom tests).
      const openPanel = auxPanelRef.current;
      const rootNode = rootRef.current?.getRootNode() as
        | ShadowRoot
        | Document
        | undefined;
      const panel =
        openPanel === "shortcuts"
          ? rootNode?.querySelector("#ps-shortcut-help")
          : rootNode?.querySelector("#ps-annotation-list");
      const trigger =
        openPanel === "shortcuts"
          ? helpButtonRef.current
          : listButtonRef.current;
      const path = event.composedPath?.() ?? [];
      if (hitInside(panel ?? null, path, event.target)) return;
      if (hitInside(trigger, path, event.target)) return;
      // Clicks on the toolbar itself (any action) never close the panel —
      // the action's own handler decides (e.g. Pick dismisses it).
      if (hitInside(dockRef.current, path, event.target)) return;
      setAuxPanel("none");
    };
    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, []);



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

  // Goal 01 v5 review P1: Pick is STRICTLY single-target. Shift is inert —
  // Shift+click / Shift+Enter commit the same single-element draft as a
  // plain pick. Multi is the only multi-target path (true multi mode),
  // so no additive behavior is hidden inside Pick (contract §6).
  const addOrReplace = useCallback(
    (element: Element) => {
      commitDraft(replaceSelection(selectionRef.current, element));
    },
    [commitDraft]
  );

  // Picking listeners (single only): pointermove builds the target stack,
  // plain click/Enter commits a single-element draft, Esc cancels.
  // Capture listeners for single-pick mode: paused when the dock is collapsed
  // (AC5: collapsed dock must not leave invisible capture listeners active).
  useEffect(() => {
    if (!picking || !open || auxPanel !== "none") return;

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
        if (target) addOrReplace(target);
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
      addOrReplace(picked);
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
  }, [addOrReplace, auxPanel, cancelPicking, picking, open, refreshSelectionRects, updateOutline]);

  // Marquee listeners: pointerdown starts, pointermove updates the rect,
  // pointerup commits the region selection.
  // Marquee listeners: paused when the dock is collapsed (AC5).
  useEffect(() => {
    if (!isMarquee || !open || auxPanel !== "none") return;

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
  }, [auxPanel, commitDraft, isMarquee, open]);

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
          if (!payload?.task) {
            // Goal 06: the active task no longer exists (explicit clear or
            // an agent-side DELETE) — drop the stale local snapshot so the
            // NEXT save creates a FRESH taskId instead of resurrecting the
            // cleared task with its old annotations.
            taskRef.current = null;
            setAnnotations([]);
            lastTaskRevisionRef.current = null;
            return;
          }
          const normalized = normalizeTask(payload.task);
          if (!normalized) return;
          taskRef.current = normalized;
          setAnnotations(normalized.annotations);
          // Goal 05 (review P1): the revision baseline is ALWAYS the last
          // FETCHED task's taskRevision — never whatever the first poll
          // happened to read. This closes the race where a CLI completion
          // lands after mount but before the first poll: the first poll
          // then sees a revision DIFFERENT from this baseline and refetches.
          lastTaskRevisionRef.current = normalized.taskRevision ?? 0;
        }
      )
      .catch(() => {
        // Dev server restarting; status stays hidden.
      });
  }, [config.endpoint, config.token]);

  useEffect(() => {
    refreshTask();
    // Re-fetch when the dock expands/collapses (the launcher count and the
    // list need fresh data). The visibility-aware revision poll covers
    // server-side changes while open — no refetch needed when an auxiliary
    // panel opens, so optimistic local state is never discarded.
  }, [refreshTask, open]);

  // Goal 05: visibility-aware revision polling. While the document is
  // VISIBLE, poll the lightweight revision read about once per second and
  // re-fetch the task ONLY when the server-owned taskRevision changes
  // (CLI-completed items then leave the Open view / update All within two
  // seconds). Paused while the page is hidden; exponential backoff on
  // repeated failures. Completion is never inferred from HMR, source
  // revision, timestamps or tests — only from the server revision.
  useEffect(() => {
    const revisionEndpoint = config.revisionEndpoint;
    if (!revisionEndpoint) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const schedule = (ms: number) => {
      if (cancelled) return;
      timer = setTimeout(() => void poll(), ms);
    };
    const poll = async () => {
      if (cancelled) return;
      // Paused while hidden; visibilitychange re-polls when visible.
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch(revisionEndpoint, {
          headers: { "X-Portal-Studio-Token": config.token },
        });
        if (!response.ok) throw new Error("revision read failed");
        const payload = (await response.json()) as {
          taskRevision?: number | null;
        };
        const revision =
          typeof payload.taskRevision === "number" ? payload.taskRevision : 0;
        const last = lastTaskRevisionRef.current;
        // Compare against the last FETCHED task's revision (set by
        // refreshTask). If we have never fetched (last === null) or the
        // revision moved, re-fetch — refreshTask re-baselines the ref.
        // Never accept the polled value as the baseline without fetching:
        // a CLI completion between mount and the first poll must sync.
        if (last === null || revision !== last) {
          refreshTask();
        }
        failures = 0;
        schedule(1000);
      } catch {
        // Dev server restarting or revision read failing: back off.
        failures += 1;
        schedule(Math.min(1000 * 2 ** failures, 15000));
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        if (timer) clearTimeout(timer);
        void poll();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    schedule(1000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refreshTask, config.endpoint, config.token, config.revisionEndpoint]);

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
    if (!isMulti || !open || auxPanel !== "none") return;

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
    auxPanel,
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

  /** The typed operations of the debounced mutation currently pending. */
  const pendingOpsRef = useRef<MutationOp[] | null>(null);
  const pendingOpsRevisionRef = useRef<number | null>(null);

  /**
   * Goal 06: flush the pending typed operations through the mutation
   * endpoint with refresh + retry-once on 409, then explicit conflict
   * feedback. Never silently overwrite another client's completed state.
   */
  /**
   * Flush the pending typed operations. `keepalive` is used by the unload
   * path ONLY (single attempt): per the fetch spec, non-keepalive requests
   * are terminated during document unload, which would silently lose a
   * mutation made <300 ms before a reload (D-043/G03 regression class).
   * Returns false when the flush was skipped or failed outright (callers
   * should abort dependent work); the 409 retry-once + conflict feedback
   * applies to the normal (non-unload) path.
   */
  const flushPendingOps = useCallback(
    async (options: { keepalive?: boolean } = {}): Promise<boolean> => {
      const ops = pendingOpsRef.current;
      if (!ops || ops.length === 0) return true;
      pendingOpsRef.current = null;
      const base = taskRef.current;
      if (!base) return true;
      const mutateEndpoint = config.mutateEndpoint;
      if (!mutateEndpoint) {
        // No typed endpoint configured (dev-only injection absent): the
        // optimistic local state is the best available outcome.
        return true;
      }
      let expected = pendingOpsRevisionRef.current ?? 0;
      pendingOpsRevisionRef.current = null;
      const maxAttempts = options.keepalive ? 1 : 2;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const result = await postMutation(
          { token: config.token, mutateEndpoint },
          { taskId: base.taskId, expectedTaskRevision: expected, operations: ops },
          { keepalive: options.keepalive === true }
        );
        if (result.ok) {
          taskRef.current = result.task;
          lastTaskRevisionRef.current = result.taskRevision;
          // Re-sync after the mutation settles (server artifact is
          // authoritative for screenshot/heartbeat merges).
          refreshTask();
          return true;
        }
        if (result.conflict) {
          if (options.keepalive) {
            // Unload path: no retry (the page is going away) — the refresh
            // + conflict UI cannot help; the op is dropped intentionally.
            return false;
          }
          // 409: adopt the server's current task + revision and retry the
          // still-valid operation once against it.
          taskRef.current = result.conflict.task;
          lastTaskRevisionRef.current = result.conflict.taskRevision;
          setAnnotations(result.conflict.task.annotations);
          expected = result.conflict.taskRevision;
          continue;
        }
        setMode({ kind: "error", message: result.error ?? "mutation failed" });
        return false;
      }
      // Both attempts conflicted: explicit conflict feedback.
      setMode({
        kind: "error",
        message: t(
          "studio.conflict",
          "The task changed on the server — your change was not applied. Review the current state and retry."
        ),
      });
      return false;
    },
    [config.mutateEndpoint, config.token, refreshTask]
  );

  /**
   * Goal 06: optimistic local apply (same pure contract as the server) +
   * accumulate typed operations + debounced typed send with 409 handling.
   */
  const enqueueMutation = useCallback(
    (operations: MutationOp[]) => {
      const base = taskRef.current;
      if (!base) return;
      const applied = applyMutationOperations(base, operations);
      if (!applied.ok) return;
      setAnnotations(applied.task.annotations);
      // P3-2 review: keep taskRef in sync with the optimistic state so a
      // second enqueue inside the debounce window applies against the
      // CURRENT base (no transient revert on the flush).
      taskRef.current = applied.task;
      pendingOpsRef.current = [
        ...(pendingOpsRef.current ?? []),
        ...operations,
      ];
      pendingOpsRevisionRef.current ??= lastTaskRevisionRef.current ?? 0;
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
      persistTimerRef.current = setTimeout(() => {
        void flushPendingOps();
      }, 300);
    },
    [flushPendingOps]
  );

  /** Flush a pending mutation immediately (unload/reload safety). */
  const flushPendingMutation = useCallback(() => {
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    if (pendingOpsRef.current) {
      // Reload safety (P1-1 review): the unload flush MUST use keepalive
      // or the browser terminates the request mid-unload.
      void flushPendingOps({ keepalive: true });
    }
  }, [flushPendingOps]);

  // Flush pending mutations on unmount AND on beforeunload (reloads) —
  // otherwise an edit made <300 ms before a reload would be lost (found
  // by the G03 e2e: the optimistic UI hid the missing persistence).
  // Esc closes the manual-copy fallback dialog and returns focus (F-1),
  // and Tab is contained within the dialog (G05 a11y audit). Registered
  // ONCE at mount and gated on copyStateRef so the Esc can never land in
  // the window between the state commit and an effect registration.
  const closeCopyFallback = useCallback(() => {
    setCopyState("idle");
    // Focus restoration after render: the dialog unmounts, then the real
    // Copy button (threaded ref) receives focus.
    requestAnimationFrame(() => {
      copyButtonRef.current?.focus();
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (copyStateRef.current !== "manual") return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeCopyFallback();
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
    return () => document.removeEventListener("keydown", handleKeyDown, true);
    // closeCopyFallback is a stable useCallback — the listener stays
    // registered ONCE (the mount-once race-free contract).
  }, [closeCopyFallback]);

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

  // Round-3 finding 1: unmount/HMR during a drag must release the pointer
  // capture and drop the window listeners — no leaked global state.
  useEffect(() => {
    return () => {
      stopDragListeners();
      dragRef.current = null;
    };
  }, []);

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
    enqueueMutation([
      { op: "updateComment", annotationId: editingId, comment: editValue },
    ]);
    setEditingId(null);
    setEditValue("");
  };

  const confirmDelete = () => {
    if (!confirmDeleteId) return;
    enqueueMutation([{ op: "remove", annotationId: confirmDeleteId }]);
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

  const closeMarkerEditor = useCallback(() => {
    setEditorAnnotationId(null);
    setEditorError(null);
    setEditorSaving(false);
    setEditorDeleteConfirm(false);
  }, []);

  // Goal 06: route changes close a stale marker editor safely. The editor
  // stays open only while its annotation's routeKey matches the current
  // route; navigating away re-resolves markers for the new route and closes
  // an editor whose annotation belongs to the previous one.
  const routeKeyRef = useRef(currentRouteKey());
  useEffect(() => {
    const checkRoute = () => {
      const key = currentRouteKey();
      if (key === routeKeyRef.current) return;
      routeKeyRef.current = key;
      setMarkerTick((tick) => tick + 1);
      if (editorAnnotationId) {
        const annotation = annotations.find(
          (candidate) => candidate.annotationId === editorAnnotationId
        );
        if (annotation && !annotationMatchesRoute(annotation)) {
          closeMarkerEditor();
        }
      }
    };
    checkRoute();
    // SPA navigations either fire popstate or mutate the body (which bumps
    // markerTick via the observer above → this effect re-runs).
    window.addEventListener("popstate", checkRoute);
    return () => window.removeEventListener("popstate", checkRoute);
  }, [annotations, closeMarkerEditor, editorAnnotationId, markerTick]);

  /**
   * Save the editor comment via the typed mutation client (updateComment
   * op). The shared annotations state, taskRef and the server artifact
   * stay at the last CONFIRMED value until the mutation succeeds: a failed
   * save must never leak the unsaved comment into the list or a later
   * unrelated mutation. On failure the draft text is preserved
   * (editorDraft untouched) and error/retry feedback is shown; a 409 is
   * retried once after refresh, then reported as a conflict.
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
    if (pendingOpsRef.current) {
      // P3-5 review: if the pending list mutation could not be flushed
      // (network failure), abort the save — proceeding would send the
      // comment op against a base the server never received.
      const flushed = await flushPendingOps();
      if (!flushed) {
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
    const mutateEndpoint = config.mutateEndpoint;
    if (!mutateEndpoint) {
      setEditorSaving(false);
      closeMarkerEditor();
      return;
    }
    const operations: MutationOp[] = [
      {
        op: "updateComment",
        annotationId: editorAnnotationId,
        comment: editorDraft,
      },
    ];
    // No optimistic shared-state update here — the mutation is the single
    // observable change; failure leaves list/taskRef/server untouched.
    let expected = lastTaskRevisionRef.current ?? 0;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await postMutation(
        { token: config.token, mutateEndpoint },
        { taskId: base.taskId, expectedTaskRevision: expected, operations }
      );
      if (result.ok) {
        taskRef.current = result.task;
        lastTaskRevisionRef.current = result.taskRevision;
        setAnnotations(result.task.annotations);
        refreshTask();
        setEditorSaving(false);
        closeMarkerEditor();
        return;
      }
      if (result.conflict) {
        taskRef.current = result.conflict.task;
        lastTaskRevisionRef.current = result.conflict.taskRevision;
        setAnnotations(result.conflict.task.annotations);
        expected = result.conflict.taskRevision;
        continue;
      }
      setEditorError(
        result.error ?? t("studio.saveError", "Unable to save — try again.")
      );
      setEditorSaving(false);
      return;
    }
    // Both attempts conflicted — explicit conflict feedback; the draft is
    // preserved in editorDraft for a manual retry.
    setEditorError(
      t(
        "studio.conflict",
        "The task changed on the server — your change was not applied. Review the current state and retry."
      )
    );
    setEditorSaving(false);
  };

  /** Complete an open annotation from the marker editor (typed op). */
  const completeEditorAnnotation = () => {
    if (!editorAnnotationId) return;
    enqueueMutation([{ op: "complete", annotationId: editorAnnotationId }]);
    closeMarkerEditor();
  };

  /** Reopen a completed annotation from the marker editor (typed op). */
  const reopenEditorAnnotation = () => {
    if (!editorAnnotationId) return;
    enqueueMutation([{ op: "reopen", annotationId: editorAnnotationId }]);
    closeMarkerEditor();
  };

  /** Delete an annotation from the marker editor (typed op). */
  const deleteEditorAnnotation = () => {
    if (!editorAnnotationId) return;
    enqueueMutation([{ op: "remove", annotationId: editorAnnotationId }]);
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
  }, [closeMarkerEditor, editorAnnotationId]);

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
  }, [closeMarkerEditor, editorAnnotationId]);

  // The button that opened the current delete confirmation (focus return).
  // Round-3 finding 3: id-keyed focus-return refs for the annotation list
  // transients — Esc restores focus to the EXACT row/trigger that opened
  // a surface (replaces the shared last-row ref).
  const deleteButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const editButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const removeCompletedTriggerRef = useRef<HTMLButtonElement | null>(null);


  const saveTask = async () => {
    if (mode.kind !== "draft") return;
    setMode({ kind: "saving" });
    // Goal 06 taskId lifecycle (documented): the active taskId is created
    // with the FIRST annotation and preserved while annotations are added
    // or changed. A NEW taskId is created only (a) after an explicit
    // clear (task file gone → next save starts fresh) or (b) when the
    // existing task is FULLY completed and a new batch begins — the new
    // batch replaces the completed task with a fresh identity. Copy/CLI
    // references stay valid during the active task lifecycle.
    const existingTask = taskRef.current;
    // Sticky task-level marker: a fully completed task whose completed
    // items were removed (removeCompleted) still grants the next batch a
    // fresh taskId — the current annotations alone would no longer show
    // the completed state (single source of truth in mutation.ts).
    const fullyCompleted = !!existingTask && isFullyCompletedTask(existingTask);
    const taskId =
      existingTask && !fullyCompleted ? existingTask.taskId : newTaskId();
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
      // Goal 06: per-annotation page context (url, stable routeKey, title,
      // viewport, scroll, businessContext) — gates marker rendering to the
      // route the annotation was created on.
      pageContext: capturePageContext(mode.capture.businessContext),
    };
    const task: PortalStudioTask = {
      schemaVersion: TASK_SCHEMA_VERSION,
      taskId,
      createdAt: new Date().toISOString(),
      url: window.location.href,
      title: document.title,
      // New batch after full completion: the completed task is superseded
      // by a fresh one (only the new annotation is carried).
      annotations: fullyCompleted ? [annotation] : [...annotations, annotation],
      businessContext: mode.capture.businessContext,
      diagnostics: snapshotDiagnostics(sharedDiagnosticsBuffer),
      redaction: {
        droppedKeys: [],
        redactedValues: 0,
        truncatedValues: 0,
      },
      ...(lastTaskRevisionRef.current !== null
        ? { expectedTaskRevision: lastTaskRevisionRef.current }
        : {}),
    };
    // P3-1 review: a fresh task (new batch or after an agent-side clear)
    // supersedes any still-pending typed operations of the OLD task —
    // flushing them against the new identity would 400 annotation_not_found.
    if (fullyCompleted || !existingTask) {
      pendingOpsRef.current = null;
      pendingOpsRevisionRef.current = null;
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
    }
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
      const payload = (await response.json()) as PortalStudioSaveResult & {
        taskRevision?: number;
      };
      if (response.status === 409) {
        // P2-3 review: another client (or the agent CLI/DELETE) moved the
        // task between our last fetch and this save — never silently
        // overwrite. Refresh and show explicit conflict feedback.
        refreshTask();
        setMode({
          kind: "error",
          message: t(
            "studio.conflict",
            "The task changed on the server — your change was not applied. Review the current state and retry."
          ),
        });
        return;
      }
      if (!response.ok || !payload.ok || !payload.taskId) {
        setMode({
          kind: "error",
          message: sessionErrorMessage(response.status, payload.error),
        });
        return;
      }
      if (typeof payload.taskRevision === "number") {
        lastTaskRevisionRef.current = payload.taskRevision;
      }
      // The annotation is durably persisted — reflect it in the overlay
      // and the dock badge immediately, and keep the last-known task for
      // later mutation rewrites.
      const savedAnnotations = fullyCompleted ? [annotation] : [...annotations, annotation];
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
      const matched = matchStudioShortcut(event);
      if (!matched) return;
      // Round-4 finding 3: the Studio-root special case is REMOVED — the
      // contract disables shortcuts only for editable controls,
      // IME/repeat/extra modifiers (all enforced in hotkeys.ts via the
      // composed-path-aware editable guard). EVERY registered action
      // (Pick/Multi/Area/Copy/V/L/K/?) works from focused NON-editable
      // Studio controls, including while the toolbar is collapsed.
      event.preventDefault();
      event.stopPropagation();

      const action = matched.action;

      // Toggle: open/close the dock (collapsing also dismisses any open
      // auxiliary panel — presentation only).
      if (action === "toggle") {
        setOpen((prev) => {
          if (prev) setAuxPanel("none");
          return !prev;
        });
        return;
      }

      // Copy: expand first (contract: a shortcut invoked while collapsed
      // expands the toolbar and runs the requested action); disabled at
      // zero Open annotations like the toolbar button.
      if (action === "copy") {
        if (openCountRef.current === 0) return;
        setOpen(true);
        copyMarkdownRef.current();
        return;
      }

      // Marker visibility: presentation-only toggle.
      if (action === "visibility") {
        setOpen(true);
        setMarkersVisible((current) => !current);
        return;
      }

      // Annotation list / shortcut help: expand and open (toggle closed
      // when the same panel is already open).
      if (action === "list") {
        setOpen(true);
        setAuxPanel((current) =>
          current === "annotations" ? "none" : "annotations"
        );
        return;
      }
      if (action === "help") {
        setOpen(true);
        setAuxPanel((current) =>
          current === "shortcuts" ? "none" : "shortcuts"
        );
        return;
      }

      // Capture actions (pick/multi/area): expand first if collapsed,
      // dismiss any auxiliary panel, then safely exit the previous
      // capture and enter the new mode.
      setOpen(true);
      setAuxPanel("none");

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

  // Goal 01 v5: the capture-status panel is a separate anchored surface,
  // hidden while an auxiliary panel (Help/List) is open — the underlying
  // mode/draft state is preserved and resumes when the panel closes.
  const statusPanelVisible =
    open && auxPanel === "none" && mode.kind !== "idle";

  // Help/List panel placements: anchored to their trigger buttons, with a
  // dock-row fallback before the expanded bar has been measured.
  const fallbackTrigger = (): AnchorRect => ({
    left: position.x + dockWidth - 170,
    top: position.y,
    right: position.x + dockWidth - 70,
    bottom: position.y + 48,
    width: 100,
    height: 48,
  });
  const helpPlacement = resolveAnchoredPlacement({
    trigger: auxAnchors.shortcuts ?? fallbackTrigger(),
    viewport: viewportOf(window),
    width: 300,
    maxHeight: Math.max(200, Math.round(window.innerHeight * 0.6)),
    // Genuine anchoring: the RENDERED height, not maxHeight (round-6
    // blocker 1).
    surfaceHeight: helpSurfaceHeight ?? undefined,
  });
  const listPlacement = resolveAnchoredPlacement({
    trigger: auxAnchors.annotations ?? fallbackTrigger(),
    viewport: viewportOf(window),
    width: Math.min(380, Math.max(0, window.innerWidth - 16)),
    maxHeight: Math.max(200, Math.round(window.innerHeight * 0.65)),
    surfaceHeight: listSurfaceHeight ?? undefined,
  });

  // Goal 04: view-filter derived values (launcher count is ALWAYS the open
  // count, independent of the view; the list/markers use the visible list).
  const openCount = countOpenAnnotations(annotations);
  const visibleAnnotations = selectVisibleAnnotations(annotations, viewFilter);
  openCountRef.current = openCount;

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
      >
        <StudioToolbarShell
          open={open}
          openCount={openCount}
          markersVisible={markersVisible}
          auxPanel={auxPanel}
          picking={picking}
          multi={isMulti}
          marquee={isMarquee}
          t={t}
          helpButtonRef={helpButtonRef}
          listButtonRef={listButtonRef}
          copyButtonRef={copyButtonRef}
          tooltipsSuppressed={
            auxPanel !== "none" ||
            copyState === "manual" ||
            copyState === "copied"
          }
          onDragStart={handleDockPointerDown}
          onKeyMove={handleToggleKeyDown}
          onExpand={() => setOpen(true)}
          onCollapse={collapseToolbar}
          onPick={() => {
            setAuxPanel("none");
            // Clicking the active Pick cancels it (contract §6).
            if (mode.kind === "picking") {
              cancelPicking();
            } else {
              startPicking();
            }
          }}
          onMulti={() => {
            setAuxPanel("none");
            // Clicking the active Multi cancels it.
            if (mode.kind === "multi") {
              cancelMulti();
            } else {
              startMulti();
            }
          }}
          onArea={() => {
            setAuxPanel("none");
            // Clicking the active Area cancels it.
            if (mode.kind === "marquee") {
              setMode({ kind: "idle" });
            } else {
              startMarquee();
            }
          }}
          onCopy={copyMarkdown}
          onToggleMarkers={() => setMarkersVisible((current) => !current)}
          onToggleHelp={toggleHelpPanel}
          onToggleList={toggleListPanel}
        />
        {copyState === "copied" ? (
          <div className="ps-copy-feedback" role="status" aria-live="polite">
            {t("studio.copied", "Copied to clipboard")}
          </div>
        ) : null}
        {copyState === "manual" ? (
          <div
            ref={(node) => {
              if (node) {
                const height = node.offsetHeight;
                setCopyFallbackHeight((current) =>
                  current === height ? current : height
                );
              }
            }}
            className="ps-copy-fallback"
            role="dialog"
            aria-label={t("studio.copyManual", "Copy manually")}
            style={copyFallbackPlacement ?? undefined}
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
              onClick={closeCopyFallback}
            >
              {t("studio.close", "Close")}
            </button>
          </div>
        ) : null}
      </div>

      {auxPanel === "shortcuts" ? (
        <StudioShortcutHelp
          t={t}
          style={helpPlacement}
          surfaceRef={helpSurfaceRef}
        />
      ) : null}

      {auxPanel === "annotations" ? (
        <StudioAnnotationListPanel
          t={t}
          style={listPlacement}
          surfaceRef={listSurfaceRef}
          annotations={annotations}
          viewFilter={viewFilter}
          onViewFilterChange={(filter) => {
            setViewFilter(filter);
            setRemoveCompletedConfirm(false);
            closeMarkerEditor();
          }}
          editingId={editingId}
          editValue={editValue}
          onEditStart={startEdit}
          onEditChange={setEditValue}
          onEditSave={saveEdit}
          confirmDeleteId={confirmDeleteId}
          onConfirmDelete={setConfirmDeleteId}
          onCancelDelete={() => setConfirmDeleteId(null)}
          removeCompletedConfirm={removeCompletedConfirm}
          onToggleRemoveCompleted={() =>
            setRemoveCompletedConfirm((current) => !current)
          }
          onCancelRemoveCompleted={() => setRemoveCompletedConfirm(false)}
          onRemoveCompleted={() => {
            enqueueMutation([{ op: "removeCompleted" }]);
            setRemoveCompletedConfirm(false);
          }}
          onComplete={(annotationId) =>
            enqueueMutation([{ op: "complete", annotationId }])
          }
          onReopen={(annotationId) =>
            enqueueMutation([{ op: "reopen", annotationId }])
          }
          onHideToggle={(annotationId) => {
            const annotation = annotations.find(
              (candidate) => candidate.annotationId === annotationId
            );
            if (!annotation) return;
            enqueueMutation([
              {
                op: "setHidden",
                annotationId,
                hidden: !(annotation.hidden === true),
              },
            ]);
          }}
          onDelete={confirmDelete}
          onItemSelect={(annotation) => openMarkerEditor(annotation)}
          editorSaving={editorSaving}
          deleteButtonRefs={deleteButtonRefs}
          editButtonRefs={editButtonRefs}
          removeCompletedTriggerRef={removeCompletedTriggerRef}
          error={
            auxPanel === "annotations" && mode.kind === "error"
              ? mode.message
              : null
          }
        />
      ) : null}

      {statusPanelVisible ? (
        <div className="ps-status-panel" style={layout.panel}>

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
        if (!markersVisible || annotation.hidden === true) return null;
        // Goal 06: markers only render when the annotation's routeKey
        // matches the current route (legacy annotations without pageContext
        // always render).
        if (!annotationMatchesRoute(annotation)) return null;
        // Review P2: marker numbers are STABLE across Open/All filtering —
        // always derived from the FULL annotations list so they match the
        // list chips in every view.
        const number = annotationDisplayNumber(
          annotations,
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
