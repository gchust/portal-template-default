/**
 * Portal Studio — Shadow-DOM-safe custom tooltip primitive (Goal 01 v5).
 *
 * One reusable tooltip used by every toolbar action: hover opens after
 * ~300 ms, keyboard focus opens immediately, and it closes on mouse leave,
 * blur, Esc, click, outside pointerdown, drag start or a related popover
 * opening (suppress). The tooltip is `role="tooltip"`, wired through
 * `aria-describedby`, has `pointer-events: none`, flips above/below and
 * clamps horizontally via the shared placement helper. No native `title`
 * bubble is used anywhere in the new toolbar.
 */

import {
  Children,
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";

import {
  rectFrom,
  resolveTooltipPlacement,
} from "./placement";

export const TOOLTIP_DELAY_MS = 300;

type TriggerProps = {
  onMouseEnter?: (event: React.MouseEvent) => void;
  onMouseLeave?: (event: React.MouseEvent) => void;
  onFocus?: (event: React.FocusEvent) => void;
  onBlur?: (event: React.FocusEvent) => void;
  onClick?: (event: React.MouseEvent) => void;
  onKeyDown?: (event: React.KeyboardEvent) => void;
  "aria-describedby"?: string;
  /** React 19: ref is a regular prop — typed here so the ref-preserving
   *  clone needs no unsafe casts (round-3 finding 5). */
  ref?: React.Ref<HTMLElement>;
};

export type StudioActionTooltipProps = {
  /** Localized action label (e.g. "Pick element"). */
  label: string;
  /** Platform-adjusted keycap (e.g. "⌘⌥P"); omit for no keycap. */
  shortcut?: string;
  /** When true the tooltip stays closed (a related popover is open). */
  suppress?: boolean;
  /** The trigger element — a single button. */
  children: ReactElement<TriggerProps>;
};

const compose = <A extends unknown[]>(
  ...fns: Array<((...args: A) => void) | undefined>
) => {
  const present = fns.filter((fn): fn is (...args: A) => void => !!fn);
  if (present.length === 0) return undefined;
  return (...args: A) => {
    for (const fn of present) fn(...args);
  };
};

export function StudioActionTooltip({
  label,
  shortcut,
  suppress = false,
  children,
}: StudioActionTooltipProps) {
  const id = useId();
  const tooltipId = `ps-tooltip-${id}`;
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const triggerRectRef = useRef<{ left: number; top: number; width: number; height: number } | null>(null);
  const suppressRef = useRef(suppress);
  suppressRef.current = suppress;

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const close = useCallback(() => {
    clearTimer();
    setOpen(false);
    setPos(null);
  }, [clearTimer]);

  const openNow = useCallback(() => {
    clearTimer();
    if (suppressRef.current) return;
    const trigger = triggerRef.current;
    if (!trigger) return;
    triggerRectRef.current = trigger.getBoundingClientRect();
    setOpen(true);
  }, [clearTimer]);

  const scheduleOpen = useCallback(() => {
    clearTimer();
    if (suppressRef.current) return;
    timerRef.current = setTimeout(openNow, TOOLTIP_DELAY_MS);
  }, [clearTimer, openNow]);

  // Close when a related popover opens (Help/List) or drag starts.
  useEffect(() => {
    if (suppress) close();
  }, [suppress, close]);

  // Close on any outside pointerdown while open (tooltips never intercept
  // pointer events, so every pointerdown is "outside").
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = () => close();
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [open, close]);

  // Round-6 blocker 3: Esc closes the TOPMOST transient surface first —
  // an open tooltip consumes Esc BEFORE the document-capture capture-mode
  // listeners (Pick/Multi/Area). A WINDOW-capture listener runs earlier in
  // the propagation path than any document listener, so the same Esc never
  // cancels capture while the tooltip is open. preventDefault is only
  // called when a tooltip is actually open.
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [open, close]);

  // Native mouseenter/mouseleave: React's synthetic mouseenter does not
  // dispatch when `relatedTarget` crosses the Shadow DOM boundary (pointer
  // re-entering the Studio from the page after a leave) — native events
  // always fire, so hover tooltips stay reliable across repeated cycles.
  const handleNativeEnter = useCallback(() => scheduleOpen(), [scheduleOpen]);
  const handleNativeLeave = useCallback(() => close(), [close]);
  useEffect(() => {
    const node = triggerRef.current;
    if (!node) return;
    node.addEventListener("mouseenter", handleNativeEnter);
    node.addEventListener("mouseleave", handleNativeLeave);
    return () => {
      node.removeEventListener("mouseenter", handleNativeEnter);
      node.removeEventListener("mouseleave", handleNativeLeave);
    };
  }, [handleNativeEnter, handleNativeLeave]);

  // Cleanup on unmount.
  useEffect(() => clearTimer, [clearTimer]);

  const child = Children.only(children) as ReactElement<TriggerProps>;
  const trigger = cloneElement<TriggerProps>(child, {
    ref: (node: HTMLElement | null) => {
      triggerRef.current = node;
      // Preserve any caller ref (React 19: ref is a regular prop).
      const callerRef = child.props.ref;
      if (typeof callerRef === "function") callerRef(node);
      else if (callerRef && typeof callerRef === "object") {
        callerRef.current = node;
      }
    },
    onFocus: compose(child.props.onFocus, openNow),
    onBlur: compose(child.props.onBlur, close),
    onClick: compose(child.props.onClick, close),
    onKeyDown: compose(child.props.onKeyDown, (event: React.KeyboardEvent) => {
      if (event.key === "Escape") close();
    }),
    "aria-describedby": open ? tooltipId : child.props["aria-describedby"],
  });

  // Measure + place the tooltip after it mounts (layout effect keyed on
  // `open`, so it never re-runs per render). Bailing when the position is
  // unchanged prevents render loops.
  useLayoutEffect(() => {
    if (!open) return;
    const node = tooltipRef.current;
    const triggerRect = triggerRectRef.current;
    if (!node || !triggerRect) return;
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const next = resolveTooltipPlacement({
      trigger: rectFrom(triggerRect),
      viewport,
      tooltipWidth: node.offsetWidth,
      tooltipHeight: node.offsetHeight,
    });
    setPos((current) =>
      current && current.left === next.left && current.top === next.top
        ? current
        : next
    );
  }, [open]);

  return (
    <>
      {trigger}
      {open ? (
        <div
          ref={tooltipRef}
          id={tooltipId}
          role="tooltip"
          className="ps-tooltip"
          style={{
            left: pos?.left ?? 0,
            top: pos?.top ?? 0,
            visibility: pos ? "visible" : "hidden",
          }}
        >
          {label}
          {shortcut ? <kbd className="ps-tooltip-keycap">{shortcut}</kbd> : null}
        </div>
      ) : null}
    </>
  );
}
