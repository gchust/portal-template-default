/**
 * Portal Studio — dock geometry & persistence (pure, testable).
 *
 * Goal 01 (D-033 #2/#3, D-034 #5/#6): the dock is a single draggable
 * launcher with annotation-count display, whose top-left position is
 * clamped to the viewport and persisted across reloads. All geometry is
 * pure math over plain objects — no DOM — so clamp/move/layout/persistence
 * are unit-testable without a browser. The toolbar owns the single instance.
 *
 * Storage contract: `portal-studio.dock` = JSON `{x, y}`; invalid or
 * missing values fall back to the default bottom-right position; storage
 * failures (privacy mode) degrade silently (D-034 #7-style safe path).
 */

export const DOCK_STORAGE_KEY = "portal-studio.dock";
export const DEFAULT_DOCK_MARGIN = 16;
export const TOGGLE_SIZE = 40;
/** Single launcher — no badge, no More button (Goal 01). */
export const DEFAULT_DOCK_WIDTH = TOGGLE_SIZE;

export const PANEL_WIDTH = 320;
export const PANEL_GAP = 8;
/** Space required above the toggle for the above-anchored panel. */
export const PANEL_FLIP_MIN_ABOVE = 200;

export const DRAG_THRESHOLD_PX = 4;
export const KEYBOARD_STEP_PX = 8;
export const KEYBOARD_FAST_STEP_PX = 24;

export type DockPosition = { x: number; y: number };
export type DockViewport = { width: number; height: number };

export type DockStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

/** Default bottom-right position (top-left anchor of the dock row). */
export function defaultDockPosition(
  viewport: DockViewport,
  dockWidth: number = DEFAULT_DOCK_WIDTH,
  dockHeight: number = TOGGLE_SIZE
): DockPosition {
  return {
    x: Math.max(0, viewport.width - dockWidth - DEFAULT_DOCK_MARGIN),
    y: Math.max(0, viewport.height - dockHeight - DEFAULT_DOCK_MARGIN),
  };
}

/** Clamp the top-left anchor so the whole dock row stays in the viewport. */
export function clampDockPosition(
  position: DockPosition,
  viewport: DockViewport,
  dockWidth: number = DEFAULT_DOCK_WIDTH,
  dockHeight: number = TOGGLE_SIZE
): DockPosition {
  const maxX = Math.max(0, viewport.width - dockWidth);
  const maxY = Math.max(0, viewport.height - dockHeight);
  return {
    x: Math.min(Math.max(0, Math.round(position.x)), maxX),
    y: Math.min(Math.max(0, Math.round(position.y)), maxY),
  };
}

/** Load a persisted position; null when absent/invalid/unreadable. */
export function loadDockPosition(
  storage: DockStorage | null | undefined
): DockPosition | null {
  try {
    const raw = storage?.getItem(DOCK_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { x?: unknown; y?: unknown };
    if (
      typeof parsed.x !== "number" ||
      typeof parsed.y !== "number" ||
      !Number.isFinite(parsed.x) ||
      !Number.isFinite(parsed.y)
    ) {
      return null;
    }
    return { x: parsed.x, y: parsed.y };
  } catch {
    return null;
  }
}

/** Persist a position; storage failures (privacy mode) degrade silently. */
export function saveDockPosition(
  storage: DockStorage | null | undefined,
  position: DockPosition
): void {
  try {
    storage?.setItem(DOCK_STORAGE_KEY, JSON.stringify(position));
  } catch {
    // Privacy mode / quota: the position simply is not persisted.
  }
}

/** Keyboard step move, clamped. delta components are direction units. */
export function moveDockPosition(
  position: DockPosition,
  delta: { dx: -1 | 0 | 1; dy: -1 | 0 | 1 },
  viewport: DockViewport,
  step: number,
  dockWidth: number = DEFAULT_DOCK_WIDTH,
  dockHeight: number = TOGGLE_SIZE
): DockPosition {
  return clampDockPosition(
    {
      x: position.x + delta.dx * step,
      y: position.y + delta.dy * step,
    },
    viewport,
    dockWidth,
    dockHeight
  );
}

export type DockLayout = {
  toggle: { left: number; top: number };
  panel: {
    left: number;
    top?: number;
    bottom?: number;
    width: number;
    maxHeight?: number;
  };
};

/**
 * Resolve the dock layout from the anchor position. The toggle is always
 * clamped to the viewport; the expanded panel anchors ABOVE the toggle
 * (bottom = toggle top − gap), flipping BELOW the toggle when there is not
 * enough space above (viewport-top docks), with a bounded maxHeight.
 */
export function resolveDockLayout(input: {
  position: DockPosition;
  viewport: DockViewport;
  expanded: boolean;
  dockWidth?: number;
  dockHeight?: number;
  panelWidth?: number;
  panelGap?: number;
  flipMinAbove?: number;
}): DockLayout {
  const dockWidth = input.dockWidth ?? DEFAULT_DOCK_WIDTH;
  const dockHeight = input.dockHeight ?? TOGGLE_SIZE;
  const panelWidth = input.panelWidth ?? PANEL_WIDTH;
  const gap = input.panelGap ?? PANEL_GAP;
  const flipMinAbove = input.flipMinAbove ?? PANEL_FLIP_MIN_ABOVE;
  const clamped = clampDockPosition(
    input.position,
    input.viewport,
    dockWidth,
    dockHeight
  );
  const toggle = { left: clamped.x, top: clamped.y };
  const panelLeft = Math.min(clamped.x, Math.max(0, input.viewport.width - panelWidth));
  if (!input.expanded) {
    return { toggle, panel: { left: panelLeft, top: clamped.y, width: panelWidth } };
  }
  if (clamped.y >= flipMinAbove) {
    return {
      toggle,
      panel: {
        left: panelLeft,
        bottom: input.viewport.height - clamped.y + gap,
        width: panelWidth,
        maxHeight: Math.max(120, clamped.y - gap * 2),
      },
    };
  }
  const top = clamped.y + dockHeight + gap;
  return {
    toggle,
    panel: {
      left: panelLeft,
      top,
      width: panelWidth,
      maxHeight: Math.max(120, input.viewport.height - top - gap),
    },
  };
}
