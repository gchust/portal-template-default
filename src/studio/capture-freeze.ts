/**
 * Portal Studio — capture freeze lifecycle owner (Goal 04).
 *
 * ONE explicit owner for the React Grab freeze lifecycle. The toolbar never
 * sprinkles raw freeze calls: it toggles `setCaptureActive` from the mode
 * machine, and this controller makes freeze/unfreeze idempotent, exactly
 * once per transition, with a bounded user-facing error on failure.
 *
 * Behavior:
 * - `setCaptureActive(true)` freezes the page AFTER the capture mode was
 *   activated; a second `true` is a no-op.
 * - `setCaptureActive(false)` unfreezes exactly once and removes the
 *   Studio-safe styles; a repeated `false` is a no-op.
 * - While frozen, the page-wide `pointer-events: none` would make the
 *   Studio overlay itself inert, so the controller injects a Studio-safe
 *   override (`#portal-studio-root, #portal-studio-root *` regain pointer
 *   events; shadow content inherits from the host) plus an
 *   `animation-play-state: paused` override so CSS animations stay stable
 *   during capture (the upstream freeze pauses rAF-driven JS animations
 *   via its rAF interception; CSS compositor animations need this).
 * - A freeze failure surfaces one bounded message through `onError` and
 *   leaves the page unfrozen; it never invokes any older perception logic.
 * - `dispose()` unfreezes (if needed) and removes the injected styles —
 *   used by unmount/HMR/pagehide/visibility cleanup.
 */

import type { InspectionEngine } from "./inspection/types";

export type CaptureFreezeStatus = "frozen" | "unfrozen" | "error";

export type CaptureFreezeControllerOptions = {
  engine: Pick<InspectionEngine, "freeze" | "unfreeze" | "isFrozen">;
  /** Bounded user-facing freeze failure message (never page data). */
  onError?: (message: string) => void;
  /** Injectable for tests; defaults to the global document. */
  documentRef?: Document;
};

export const FREEZE_SAFE_STYLE_ID = "portal-studio-freeze-safe";
const FRAME_HOLD_SYMBOL = "__portalStudioFrameHold__";
export const FREEZE_ERROR_MESSAGE =
  "Could not freeze the page for capture; the target may move while you annotate. You can still capture.";

const STUDIO_SAFE_CSS = [
  // The Studio overlay must regain pointer events while the page freeze
  // applies `html { pointer-events: none }` (shadow content inherits from
  // the host). The `animation-play-state` rule below is page-wide: the
  // upstream freeze pauses rAF-driven JS animations and WAAPI frame
  // animations, but plain CSS compositor animations need this pause so the
  // annotated target stays visually stable during capture.
  "#portal-studio-root, [data-portal-studio-root], #portal-studio-root *, [data-portal-studio-root] * { pointer-events: auto !important; }",
  "*, *::before, *::after { animation-play-state: paused !important; }",
].join("\n");

export type CaptureFreezeController = {
  /** Enter/exit the frozen capture lifecycle (idempotent). */
  setCaptureActive(active: boolean): void;
  isFrozen(): boolean;
  getStatus(): CaptureFreezeStatus;
  getLastError(): string | null;
  /** Unfreeze (if needed) and remove injected styles. */
  dispose(): void;
};

export function createCaptureFreezeController(
  options: CaptureFreezeControllerOptions
): CaptureFreezeController {
  const doc = options.documentRef ?? document;
  let status: CaptureFreezeStatus = "unfrozen";
  let lastError: string | null = null;

  const injectSafeStyles = (): void => {
    if (doc.getElementById(FREEZE_SAFE_STYLE_ID)) return;
    const style = doc.createElement("style");
    style.id = FREEZE_SAFE_STYLE_ID;
    style.textContent = STUDIO_SAFE_CSS;
    (doc.head ?? doc.documentElement).appendChild(style);
  };

  const removeSafeStyles = (): void => {
    doc.getElementById(FREEZE_SAFE_STYLE_ID)?.remove();
  };

  // Hold arbitrary page rAF loops while frozen: the upstream freeze only
  // intercepts React scheduler callbacks, so raw `requestAnimationFrame`
  // loops (carousels, animated markers) would keep moving the very pixels
  // being captured. Queued callbacks replay on unfreeze so the page
  // resumes exactly where it stopped.
  let rafCounter = 0;
  let originalRaf: typeof window.requestAnimationFrame | null = null;
  let originalCancelRaf: typeof window.cancelAnimationFrame | null = null;

  const installFrameHold = (): void => {
    if (originalRaf) return; // already installed
    const win = doc.defaultView;
    if (!win) return;
    // Save the raw references so the restore is identity-exact (bound
    // copies would leak a different function object into the page).
    originalRaf = win.requestAnimationFrame;
    originalCancelRaf = win.cancelAnimationFrame;
    const held = new Map<number, FrameRequestCallback>();
    win.requestAnimationFrame = (callback: FrameRequestCallback): number => {
      rafCounter += 1;
      held.set(rafCounter, callback);
      return rafCounter;
    };
    win.cancelAnimationFrame = (handle: number): void => {
      held.delete(handle);
    };
    // Keep the held queue reachable for the replay on unfreeze.
    (win as unknown as Record<string, unknown>)[FRAME_HOLD_SYMBOL] = held;
  };

  const releaseFrameHold = (): void => {
    const win = doc.defaultView;
    if (!win || !originalRaf || !originalCancelRaf) return;
    const held = (win as unknown as Record<string, unknown>)[
      FRAME_HOLD_SYMBOL
    ] as Map<number, FrameRequestCallback> | undefined;
    win.requestAnimationFrame = originalRaf;
    win.cancelAnimationFrame = originalCancelRaf;
    originalRaf = null;
    originalCancelRaf = null;
    delete (win as unknown as Record<string, unknown>)[FRAME_HOLD_SYMBOL];
    if (!held) return;
    // Replay in registration order so animation state resumes coherently.
    for (const callback of held.values()) {
      win.requestAnimationFrame(callback);
    }
    held.clear();
  };

  const setCaptureActive = (active: boolean): void => {
    if (active) {
      if (status === "frozen") return;
      try {
        options.engine.freeze();
      } catch (cause) {
        status = "error";
        lastError =
          cause instanceof Error ? cause.message : String(cause);
        options.onError?.(FREEZE_ERROR_MESSAGE);
        return;
      }
      installFrameHold();
      injectSafeStyles();
      status = "frozen";
      lastError = null;
      return;
    }
    if (status !== "frozen") return;
    // Unfreeze exactly once per frozen period. Even if the upstream
    // unfreeze throws, the injected styles and the frame hold are removed
    // so no frozen-style residue can remain.
    try {
      options.engine.unfreeze();
    } catch (cause) {
      lastError = cause instanceof Error ? cause.message : String(cause);
    } finally {
      removeSafeStyles();
      releaseFrameHold();
      status = "unfrozen";
    }
  };

  return {
    setCaptureActive,
    isFrozen: () => status === "frozen",
    getStatus: () => status,
    getLastError: () => lastError,
    dispose: () => {
      setCaptureActive(false);
      removeSafeStyles();
    },
  };
}
