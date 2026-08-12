/**
 * Portal Studio — capture freeze lifecycle hook (Goal 04).
 *
 * The ONE explicit owner wiring the capture-freeze controller into the
 * toolbar. Empirical contract with the upstream freeze (react-grab 0.1.50):
 * while the page is frozen, the app's React updates are deferred until the
 * next unfreeze — the Studio itself would become unresponsive. This hook
 * therefore unfreezes SYNCHRONOUSLY around every pointer/key interaction
 * (native capture listeners, no React), lets the deferred updates flush,
 * and re-applies the freeze shortly after (if the capture flow is still
 * active). Async exits (save completion, inspection/save errors, route
 * navigation, pagehide/visibility, unmount/HMR) unfreeze explicitly.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  createCaptureFreezeController,
  type CaptureFreezeController,
} from "./capture-freeze";
import { inspectionEngine } from "./inspection";
import { currentRouteKey } from "./route-context";

export type UseCaptureFreezeOptions = {
  /** True while a capture flow requires the page to stay frozen. */
  captureActive: boolean;
  /**
   * Route navigation is a documented freeze exit: the caller cancels the
   * active capture session (the freeze follows).
   */
  onRouteChange: () => void;
};

/** How long after an interaction the freeze is re-applied (flush window). */
export const FREEZE_REAPPLY_DELAY_MS = 120;

export function useCaptureFreeze(options: UseCaptureFreezeOptions): {
  /** Bounded user-facing freeze failure (null when healthy). */
  freezeError: string | null;
  /** Synchronous unfreeze for async exits (save/errors). */
  unfreezeNow: () => void;
  /** Live frozen state for native (non-React) updates while frozen. */
  isFrozenRef: React.MutableRefObject<boolean>;
} {
  const [freezeError, setFreezeError] = useState<string | null>(null);
  const controllerRef = useRef<CaptureFreezeController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = createCaptureFreezeController({
      engine: inspectionEngine,
      onError: setFreezeError,
    });
  }
  const controller = controllerRef.current;

  const optionsRef = useRef(options);
  optionsRef.current = options;
  const captureActiveRef = useRef(options.captureActive);
  captureActiveRef.current = options.captureActive;
  const isFrozenRef = useRef(false);
  const reapplyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const unfreezeNow = useCallback(() => {
    controller.setCaptureActive(false);
  }, [controller]);

  const reapplyFreeze = useCallback(() => {
    if (reapplyTimerRef.current) clearTimeout(reapplyTimerRef.current);
    reapplyTimerRef.current = setTimeout(() => {
      reapplyTimerRef.current = null;
      controller.setCaptureActive(captureActiveRef.current);
    }, FREEZE_REAPPLY_DELAY_MS);
  }, [controller]);

  /**
   * Native interaction escape hatch: any pointer/key interaction while the
   * page is frozen unfreezes synchronously so the Studio's React can flush,
   * then re-freezes shortly after (capture flow still active).
   */
  const unfreezeForInteraction = useCallback(() => {
    if (!controller.isFrozen()) return;
    unfreezeNow();
    reapplyFreeze();
  }, [controller, reapplyFreeze, unfreezeNow]);

  useEffect(() => {
    const onInteraction = () => unfreezeForInteraction();
    document.addEventListener("pointerdown", onInteraction, true);
    document.addEventListener("pointerup", onInteraction, true);
    document.addEventListener("keydown", onInteraction, true);
    // `click` covers programmatic/keyboard-activated button activations
    // that dispatch no pointer events.
    document.addEventListener("click", onInteraction, true);
    return () => {
      document.removeEventListener("pointerdown", onInteraction, true);
      document.removeEventListener("pointerup", onInteraction, true);
      document.removeEventListener("keydown", onInteraction, true);
      document.removeEventListener("click", onInteraction, true);
      if (reapplyTimerRef.current) clearTimeout(reapplyTimerRef.current);
    };
  }, [unfreezeForInteraction]);

  // Freeze/unfreeze from the mode machine (backstop for state-driven
  // exits). Runs after the mode render, so the page freezes AFTER the
  // capture mode is activated. NOTE (G04 finding): a mode RE-ENTRY with an
  // unchanged `captureActive` (save → resumed pick) deliberately does NOT
  // re-engage the freeze — the async-exit unfreeze stays released because
  // the upstream React-pause resume is not reliable enough to re-freeze
  // mid-flush (a re-freeze can swallow the interaction's own dispatches,
  // leaving the Studio stuck). The freeze re-engages on the NEXT explicit
  // capture-mode entry (a fresh session).
  useEffect(() => {
    if (options.captureActive) {
      setFreezeError(null);
    }
    controller.setCaptureActive(options.captureActive);
    isFrozenRef.current = controller.isFrozen();
  }, [controller, options.captureActive]);

  // Route navigation (native popstate — React effects are inert while the
  // page is frozen): unfreeze exactly once and cancel the capture session.
  const routeRef = useRef(currentRouteKey());
  useEffect(() => {
    const onPopState = () => {
      const key = currentRouteKey();
      if (key === routeRef.current) return;
      routeRef.current = key;
      controller.setCaptureActive(false);
      optionsRef.current.onRouteChange();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [controller]);

  // Browser visibility/pagehide cleanup: unfreeze so no frozen state leaks
  // into a hidden tab or a navigated-away page.
  useEffect(() => {
    const unfreezeForBrowserExit = () => {
      controller.setCaptureActive(false);
      if (reapplyTimerRef.current) clearTimeout(reapplyTimerRef.current);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") unfreezeForBrowserExit();
    };
    window.addEventListener("pagehide", unfreezeForBrowserExit);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", unfreezeForBrowserExit);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [controller]);

  // Unmount / HMR disposal: unfreeze, remove injected styles, and release
  // the upstream baseline-style machinery.
  useEffect(() => {
    return () => {
      if (reapplyTimerRef.current) clearTimeout(reapplyTimerRef.current);
      controller.dispose();
      inspectionEngine.dispose();
    };
  }, [controller]);

  return { freezeError, unfreezeNow, isFrozenRef };
}
