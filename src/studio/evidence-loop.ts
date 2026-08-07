/**
 * Portal Studio — heartbeat + evidence-command loop (client side).
 *
 * Periodically reports the browser's presence to the dev server, and polls
 * for pending `current screenshot` commands: when one is requested, captures
 * the viewport, pushes the PNG together with the diagnostics ring buffer,
 * and lets the server atomically refresh the active task's screenshot ref,
 * diagnostics, and heartbeat. All fetch calls are token-guarded and the loop
 * fails silently (never through captured channels).
 */

import {
  diagnosticsBytes,
  snapshotDiagnostics,
  type DiagnosticsBuffer,
} from "./diagnostics";
import { captureViewportPng, type ScreenshotAnnotation } from "./screenshot";
import type { PortalStudioConfig } from "./toolbar";
import type { ScreenshotRef } from "./types";

export const HEARTBEAT_INTERVAL_MS = 5000;
export const PENDING_POLL_INTERVAL_MS = 1000;

type PendingRequest = {
  requestId: string;
  taskId?: string;
  annotations?: ScreenshotAnnotation[];
};

const warn = (message: string) => {
  // Not a captured channel: safe for internal failures.
  console.warn(`[portal-studio] ${message}`);
};

/**
 * Start the heartbeat + pending-command loop. Returns a disposer. The loop
 * never throws into the page; all failures degrade to `console.warn`.
 */
const LOOP_INSTALLED_FLAG = "__PORTAL_STUDIO_EVIDENCE_LOOP_INSTALLED__";

export function startEvidenceLoop(
  config: PortalStudioConfig,
  buffer: DiagnosticsBuffer
): () => void {
  if (
    typeof window !== "undefined" &&
    (window as unknown as Record<string, unknown>)[LOOP_INSTALLED_FLAG] === true
  ) {
    return () => undefined;
  }
  const heartbeatEndpoint = "/__portal-studio/heartbeat";
  const pendingEndpoint = "/__portal-studio/screenshot/pending";
  const screenshotsEndpoint =
    config.screenshotsEndpoint ?? "/__portal-studio/screenshots";

  let disposed = false;
  let fulfilling = false;
  let lastHeartbeatAt = 0;

  const sendHeartbeat = () => {
    if (disposed) return;
    lastHeartbeatAt = Date.now();
    fetch(heartbeatEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Portal-Studio-Token": config.token,
      },
      body: JSON.stringify({ ts: lastHeartbeatAt }),
    }).catch(() => {
      // The dev server may be restarting; next tick retries.
    });
  };

  const pollPending = async () => {
    if (disposed || fulfilling) return;
    try {
      const response = await fetch(pendingEndpoint, {
        headers: { "X-Portal-Studio-Token": config.token },
      });
      if (!response.ok) return;
      const payload = (await response.json()) as {
        pending?: boolean;
        request?: PendingRequest;
      };
      if (!payload.pending || !payload.request) return;
      fulfilling = true;
      try {
        const shot = await captureViewportPng(payload.request.annotations ?? []);
        if (!shot) {
          warn("screenshot command capture failed");
          return;
        }
        const png = shot.dataUrl.split(",")[1] ?? "";
        if (diagnosticsBytes(buffer) > 0 || png) {
          const result = await fetch(screenshotsEndpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Portal-Studio-Token": config.token,
            },
            body: JSON.stringify({
              taskId: payload.request.taskId,
              requestId: payload.request.requestId,
              png,
              diagnostics: snapshotDiagnostics(buffer),
            }),
          });
          if (!result.ok) {
            warn(`evidence push failed (HTTP ${result.status})`);
          }
        }
      } finally {
        fulfilling = false;
      }
    } catch (error) {
      warn(`pending poll failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleVisibility = () => {
    if (document.visibilityState === "visible") {
      sendHeartbeat();
      pollPending();
    }
  };

  sendHeartbeat();
  const heartbeatTimer = window.setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
  const pollTimer = window.setInterval(pollPending, PENDING_POLL_INTERVAL_MS);
  document.addEventListener("visibilitychange", handleVisibility);

  (window as unknown as Record<string, unknown>)[LOOP_INSTALLED_FLAG] = true;
  return () => {
    (window as unknown as Record<string, unknown>)[LOOP_INSTALLED_FLAG] = false;
    disposed = true;
    window.clearInterval(heartbeatTimer);
    window.clearInterval(pollTimer);
    document.removeEventListener("visibilitychange", handleVisibility);
  };
}

export type { ScreenshotRef };
