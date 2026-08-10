/**
 * Portal Studio — horizontal toolbar shell (Goal 01 v5).
 *
 * The dock renders either the COLLAPSED horizontal chip or the EXPANDED
 * one-row icon bar (single `role="toolbar"`). Feature order is normative:
 * Grip | Pick Multi Area | Copy Visibility | Help List | divider Collapse.
 * Every icon is a real button with a localized aria-label, `aria-pressed`
 * active states, `aria-expanded`/`aria-controls` for Help/List, and a
 * registry-generated custom tooltip (action + platform keycap).
 */

import { useEffect, useRef, type ReactNode } from "react";

import {
  ChevronDown,
  ChevronUp,
  CircleHelp,
  Copy,
  Eye,
  EyeOff,
  GripVertical,
  Layers3,
  ListChecks,
  MessageSquarePlus,
  MousePointer2,
  ScanLine,
} from "lucide-react";

import { DRAG_THRESHOLD_PX } from "./dock";
import {
  STUDIO_ACTION_GROUPS,
  actionKeycap,
  actionLabel,
  type LabelResolver,
} from "./studio-actions";
import { StudioActionTooltip } from "./StudioActionTooltip";

export type AuxiliaryPanel = "none" | "shortcuts" | "annotations";

export type StudioToolbarShellProps = {
  open: boolean;
  openCount: number;
  markersVisible: boolean;
  auxPanel: AuxiliaryPanel;
  picking: boolean;
  multi: boolean;
  marquee: boolean;
  t: LabelResolver;
  helpButtonRef: React.RefObject<HTMLButtonElement | null>;
  listButtonRef: React.RefObject<HTMLButtonElement | null>;
  /** The real Copy button (review P7): the manual-Copy fallback restores
   *  focus to it. */
  copyButtonRef: React.RefObject<HTMLButtonElement | null>;
  /** Round-6 addendum: suppress EVERY toolbar tooltip while a related
   *  transient surface (Help/List or Copy feedback/fallback) is open — a
   *  stale tooltip must never linger above the newly opened surface or
   *  steal its Esc. */
  tooltipsSuppressed: boolean;
  onDragStart: (event: React.PointerEvent<HTMLElement>) => void;
  onKeyMove: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
  onExpand: () => void;
  onCollapse: () => void;
  onPick: () => void;
  onMulti: () => void;
  onArea: () => void;
  onCopy: () => void;
  onToggleMarkers: () => void;
  onToggleHelp: () => void;
  onToggleList: () => void;
};

export function StudioToolbarShell({
  open,
  openCount,
  markersVisible,
  auxPanel,
  picking,
  multi,
  marquee,
  t,
  helpButtonRef,
  listButtonRef,
  copyButtonRef,
  tooltipsSuppressed,
  onDragStart,
  onKeyMove,
  onExpand,
  onCollapse,
  onPick,
  onMulti,
  onArea,
  onCopy,
  onToggleMarkers,
  onToggleHelp,
  onToggleList,
}: StudioToolbarShellProps) {
  // Drag-vs-click discrimination for the chip BODY: a pointer gesture that
  // moves beyond the drag threshold must never expand the toolbar.
  // Round-4 finding 1: the gesture listeners live in one lifecycle record
  // with pointerId isolation, replacement-gesture cleanup, and unmount
  // cleanup — no leaked window listeners across gestures or HMR.
  const chipGestureRef = useRef<{ x: number; y: number; dragged: boolean } | null>(null);
  const chipGestureListenersRef = useRef<{
    move: (event: PointerEvent) => void;
    up: (event: PointerEvent) => void;
    cancel: (event: PointerEvent) => void;
  } | null>(null);

  const stopChipGestureListeners = () => {
    const listeners = chipGestureListenersRef.current;
    if (!listeners) return;
    window.removeEventListener("pointermove", listeners.move, true);
    window.removeEventListener("pointerup", listeners.up, true);
    window.removeEventListener("pointercancel", listeners.cancel, true);
    chipGestureListenersRef.current = null;
  };

  const beginChipPress = (event: React.PointerEvent) => {
    // A replacement gesture must first drop the previous gesture's
    // listeners (overlapping pointerdowns must never stack them).
    stopChipGestureListeners();
    const pointerId = event.pointerId;
    const gesture = { x: event.clientX, y: event.clientY, dragged: false };
    chipGestureRef.current = gesture;
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const active = chipGestureRef.current;
      if (!active || active.dragged) return;
      if (
        Math.hypot(moveEvent.clientX - active.x, moveEvent.clientY - active.y) >=
        DRAG_THRESHOLD_PX
      ) {
        active.dragged = true;
      }
    };
    // Round-5 blocker 1: end events are pointerId-isolated like move — a
    // stale pointer's up/cancel must NEVER end the ACTIVE gesture (only
    // the active pointer may clean it up). Otherwise pointer 2's listeners
    // would be removed by pointer 1's up, letting a later drag click
    // through and expand the toolbar.
    const end = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== pointerId) return;
      stopChipGestureListeners();
    };
    chipGestureListenersRef.current = { move, up: end, cancel: end };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", end, true);
    window.addEventListener("pointercancel", end, true);
  };

  // Round-4 finding 1: unmount/HMR drops any in-flight chip gesture.
  useEffect(() => {
    return () => {
      stopChipGestureListeners();
      chipGestureRef.current = null;
    };
  }, []);

  const handleChipClick = () => {
    const gesture = chipGestureRef.current;
    chipGestureRef.current = null;
    // No tracked gesture = a plain click (keyboard/programmatic activation)
    // → expand. A gesture that moved past the threshold is a drag → never
    // expand.
    if (!gesture || !gesture.dragged) onExpand();
  };

  const chipDragHandle = (
    <StudioActionTooltip
      key="chip-drag-tooltip"
      label={t("studio.dragToolbar", "Drag toolbar")}
      suppress={tooltipsSuppressed}
    >
      <button
        type="button"
        className="ps-chip-drag"
        aria-label={t("studio.dragToolbar", "Drag toolbar")}
        onPointerDown={onDragStart}
        onKeyDown={onKeyMove}
      >
        <GripVertical size={18} aria-hidden="true" />
      </button>
    </StudioActionTooltip>
  );

  if (!open) {
    const statusSlot =
      openCount > 0 ? (
        <span className="ps-status-slot" aria-hidden="true">
          {openCount > 99 ? "99+" : openCount}
        </span>
      ) : (
        <span className="ps-status-slot" aria-hidden="true">
          <MessageSquarePlus size={18} aria-hidden="true" />
        </span>
      );
    return (
      <div className="ps-collapsed-chip">
        {chipDragHandle}
        <button
          type="button"
          className="ps-chip-open"
          aria-label={
            openCount > 0
              ? t("studio.chipOpenCount", "Annotation tools ({{count}} open)").replace(
                  "{{count}}",
                  openCount > 99 ? "99+" : String(openCount)
                )
              : t("studio.chipLabel", "Annotation tools")
          }
          aria-expanded={false}
          onPointerDown={beginChipPress}
          onClick={handleChipClick}
        >
          {statusSlot}
          <span className="ps-chip-label">
            {t("studio.chipLabel", "Annotation tools")}
          </span>
        </button>
        <StudioActionTooltip
          label={t("studio.expandToolbar", "Expand toolbar")}
          shortcut={actionKeycap("toggle")}
        >
          <button
            type="button"
            className="ps-chip-expand"
            aria-label={t("studio.expandToolbar", "Expand toolbar")}
            aria-expanded={false}
            onPointerDown={beginChipPress}
            onClick={handleChipClick}
          >
            <ChevronDown size={18} aria-hidden="true" />
          </button>
        </StudioActionTooltip>
      </div>
    );
  }

  const barGrip = (
    <StudioActionTooltip
      key="bar-drag-tooltip"
      label={t("studio.dragToolbar", "Drag toolbar")}
      suppress={tooltipsSuppressed}
    >
      <button
        type="button"
        className="ps-tool-grip"
        aria-label={t("studio.dragToolbar", "Drag toolbar")}
        onPointerDown={onDragStart}
        onKeyDown={onKeyMove}
      >
        <GripVertical size={18} aria-hidden="true" />
      </button>
    </StudioActionTooltip>
  );

  const groups: ReactNode[] = STUDIO_ACTION_GROUPS.map((group, groupIndex) => {
    const divider = groupIndex > 0 ? (
      <span className="ps-tool-divider" aria-hidden="true" />
    ) : null;
    const actions = group.map((id) => {
      const base = (() => {
        switch (id) {
          case "pick":
            return {
              label: actionLabel(t, "pick"),
              pressed: picking,
              onClick: onPick,
              icon: <MousePointer2 size={18} aria-hidden="true" />,
            };
          case "multi":
            return {
              label: actionLabel(t, "multi"),
              pressed: multi,
              onClick: onMulti,
              icon: <Layers3 size={18} aria-hidden="true" />,
            };
          case "area":
            return {
              label: actionLabel(t, "area"),
              pressed: marquee,
              onClick: onArea,
              icon: <ScanLine size={18} aria-hidden="true" />,
            };
          case "copy":
            return {
              label: actionLabel(t, "copy"),
              pressed: undefined,
              buttonRef: copyButtonRef,
              onClick: onCopy,
              disabled: openCount === 0,
              icon: <Copy size={18} aria-hidden="true" />,
            };
          case "visibility":
            return {
              label: markersVisible
                ? actionLabel(t, "visibility")
                : t("studio.visibilityShow", "Show markers"),
              pressed: !markersVisible,
              onClick: onToggleMarkers,
              icon: markersVisible ? (
                <Eye size={18} aria-hidden="true" />
              ) : (
                <EyeOff size={18} aria-hidden="true" />
              ),
            };
          case "help":
            return {
              label: actionLabel(t, "help"),
              pressed: undefined,
              expanded: auxPanel === "shortcuts",
              controls: "ps-shortcut-help",
              buttonRef: helpButtonRef,
              onClick: onToggleHelp,
              icon: <CircleHelp size={18} aria-hidden="true" />,
            };
          case "list":
            return {
              label: actionLabel(t, "list"),
              pressed: undefined,
              expanded: auxPanel === "annotations",
              controls: "ps-annotation-list",
              buttonRef: listButtonRef,
              onClick: onToggleList,
              icon: <ListChecks size={18} aria-hidden="true" />,
            };
          default:
            return null;
        }
      })();
      if (!base) return null;
      return (
        <StudioActionTooltip
          key={id}
          label={base.label}
          shortcut={actionKeycap(id)}
          suppress={tooltipsSuppressed}
        >
          <button
            type="button"
            ref={base.buttonRef}
            className="ps-tool-action"
            aria-label={base.label}
            aria-pressed={base.pressed}
            aria-expanded={base.expanded}
            aria-controls={base.controls}
            disabled={base.disabled}
            onClick={base.onClick}
          >
            {base.icon}
          </button>
        </StudioActionTooltip>
      );
    });
    return (
      <span key={groupIndex} className="ps-tool-group">
        {divider}
        {actions}
      </span>
    );
  });

  return (
    <div
      className="ps-horizontal-bar"
      role="toolbar"
      aria-label={t("studio.title", "Portal Studio")}
    >
      {barGrip}
      {groups}
      <span className="ps-tool-divider" aria-hidden="true" />
      <StudioActionTooltip
        label={t("studio.collapseToolbar", "Collapse toolbar")}
        shortcut={actionKeycap("toggle")}
        suppress={tooltipsSuppressed}
      >
        <button
          type="button"
          className="ps-tool-action"
          aria-label={t("studio.collapseToolbar", "Collapse toolbar")}
          onClick={onCollapse}
        >
          <ChevronUp size={18} aria-hidden="true" />
        </button>
      </StudioActionTooltip>
    </div>
  );
}
