/**
 * Portal Studio — shared anchored-placement math (Goal 01 v5).
 *
 * One viewport-aware placement helper used by the toolbar tooltips, the
 * shortcut-help popover, the annotation-list panel and the capture status
 * panel. Pure math over plain rects — no DOM — so placement is
 * unit-testable without a browser.
 *
 * Rules (shared contract §10): anchor near the trigger, flip
 * above/below when there is not enough room, clamp horizontally (aligning
 * to the trigger edge, shifting left near the right viewport edge), and
 * never overflow the viewport.
 */

export type AnchorRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

export type Viewport = { width: number; height: number };

export type PanelPlacement = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
};

export const PLACEMENT_GAP = 8;
/** Edge margin kept inside the viewport for anchored surfaces. */
export const PLACEMENT_MARGIN = 4;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

/**
 * Resolve the anchored panel placement for a trigger rect.
 *
 * - width is capped to the viewport (minus edge margins);
 * - vertical: preferred side (default below) unless the opposite side has
 *   strictly more room, then flip;
 * - horizontal: align the trigger's left edge, shifted left (right-edge
 *   aligned) when it would overflow; always clamped inside the viewport.
 */
export function resolveAnchoredPlacement(input: {
  trigger: AnchorRect;
  viewport: Viewport;
  width: number;
  maxHeight: number;
  gap?: number;
  preferredSide?: "above" | "below";
  /**
   * The RENDERED surface height when known (round-4 finding 5): an
   * above-flipped surface must sit `gap` away from the trigger by its
   * ACTUAL height, not by maxHeight (maxHeight is only a bound). Callers
   * measure their surface and pass the real height; without it, maxHeight
   * remains the fallback.
   */
  surfaceHeight?: number;
}): PanelPlacement {
  const viewport = input.viewport;
  const gap = input.gap ?? PLACEMENT_GAP;
  const preferred = input.preferredSide ?? "below";
  const width = Math.min(
    Math.max(0, input.width),
    Math.max(0, viewport.width - PLACEMENT_MARGIN * 2)
  );
  const maxHeight = Math.min(
    Math.max(0, input.maxHeight),
    Math.max(0, viewport.height - PLACEMENT_MARGIN * 2)
  );
  const surfaceHeight = Math.min(
    Math.max(0, input.surfaceHeight ?? maxHeight),
    maxHeight
  );

  // Horizontal (round-6 blocker 1): start at the trigger's LEFT edge
  // WITHOUT pre-clamping — the previous version clamped first, which made
  // the overflow check unreachable (dead right-edge branch). When the
  // panel would cross the right edge, align its RIGHT edge to the
  // trigger's right edge; only clamp afterwards if that still leaves the
  // viewport.
  let left = Math.round(input.trigger.left);
  if (left + width > viewport.width - PLACEMENT_MARGIN) {
    left = Math.max(
      PLACEMENT_MARGIN,
      Math.round(input.trigger.right - width)
    );
  }
  left = clamp(left, PLACEMENT_MARGIN, Math.max(PLACEMENT_MARGIN, viewport.width - width - PLACEMENT_MARGIN));

  const spaceBelow = viewport.height - input.trigger.bottom - gap;
  const spaceAbove = input.trigger.top - gap;
  // The flip decision uses the ACTUAL space needed (the rendered surface
  // height when known; maxHeight otherwise) so a short surface that fits
  // on its preferred side is never flipped away from its trigger
  // (round-4 finding 5).
  const needed = surfaceHeight;
  const flip = preferred === "below"
    ? spaceBelow < needed && spaceAbove > spaceBelow
    : spaceAbove < needed && spaceBelow > spaceAbove;

  let top: number;
  if (preferred === "above" && !flip) {
    top = Math.max(PLACEMENT_MARGIN, Math.round(input.trigger.top - gap - surfaceHeight));
  } else if (preferred === "below" && !flip) {
    top = Math.round(input.trigger.bottom + gap);
  } else if (preferred === "below") {
    // Flip above: anchor the panel bottom to the trigger top (gap away),
    // using the RENDERED height so the surface hugs the trigger.
    top = Math.max(PLACEMENT_MARGIN, Math.round(input.trigger.top - gap - surfaceHeight));
  } else {
    // Flip below.
    top = Math.round(input.trigger.bottom + gap);
  }
  top = clamp(top, PLACEMENT_MARGIN, Math.max(PLACEMENT_MARGIN, viewport.height - surfaceHeight - PLACEMENT_MARGIN));

  return { left, top, width, maxHeight };
}

/**
 * Resolve a small tooltip placement above the trigger by default,
 * flipping below near the top edge, clamped horizontally.
 */
export function resolveTooltipPlacement(input: {
  trigger: AnchorRect;
  viewport: Viewport;
  tooltipWidth: number;
  tooltipHeight: number;
  gap?: number;
}): { left: number; top: number } {
  const gap = input.gap ?? 6;
  const width = Math.min(input.tooltipWidth, Math.max(0, input.viewport.width - PLACEMENT_MARGIN * 2));
  const left = clamp(
    Math.round(input.trigger.left + input.trigger.width / 2 - width / 2),
    PLACEMENT_MARGIN,
    Math.max(PLACEMENT_MARGIN, input.viewport.width - width - PLACEMENT_MARGIN)
  );
  const spaceAbove = input.trigger.top - gap;
  const spaceBelow = input.viewport.height - input.trigger.bottom - gap;
  const above = spaceAbove >= input.tooltipHeight || spaceAbove >= spaceBelow;
  const top = above
    ? Math.max(PLACEMENT_MARGIN, Math.round(input.trigger.top - gap - input.tooltipHeight))
    : Math.round(input.trigger.bottom + gap);
  return { left, top: Math.min(top, Math.max(PLACEMENT_MARGIN, input.viewport.height - input.tooltipHeight - PLACEMENT_MARGIN)) };
}

/** Rect helper for DOMRect-like objects (used by the UI layer). */
export const rectFrom = (rect: {
  left: number;
  top: number;
  width: number;
  height: number;
}): AnchorRect => ({
  left: rect.left,
  top: rect.top,
  right: rect.left + rect.width,
  bottom: rect.top + rect.height,
  width: rect.width,
  height: rect.height,
});
