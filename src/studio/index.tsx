/**
 * Portal Studio — dev-only bootstrap.
 *
 * Mounts the Studio toolbar inside a Shadow DOM root on `document.body`.
 * Idempotent: repeated mounts (HMR, reloads) are no-ops. This module is only
 * reachable in dev — the serve-only Vite plugin injects
 * `/@portal-studio/init.js`, which imports this file; production builds never
 * include it in the module graph.
 */

import { createRoot } from "react-dom/client";

import {
  installDiagnosticsCapture,
  sharedDiagnosticsBuffer,
} from "./diagnostics";
import { startEvidenceLoop } from "./evidence-loop";
import { StudioToolbar, type PortalStudioConfig } from "./toolbar";

const HOST_ID = "portal-studio-root";

const TOOLBAR_STYLES = `
.ps-root {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  pointer-events: none;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color-scheme: dark;
}
.ps-root * {
  box-sizing: border-box;
  pointer-events: auto;
}
.ps-toggle {
  position: fixed;
  right: 16px;
  bottom: 16px;
  width: 40px;
  height: 40px;
  border-radius: 9999px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: #18181b;
  color: #fafafa;
  font-size: 18px;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
}
.ps-toggle:hover { background: #27272a; }
.ps-toggle:focus-visible {
  outline: 2px solid #6366f1;
  outline-offset: 2px;
}
.ps-panel {
  position: fixed;
  right: 16px;
  bottom: 68px;
  width: 320px;
  max-height: calc(100vh - 96px);
  overflow-y: auto;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: #18181b;
  color: #fafafa;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
  padding: 12px;
}
.ps-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.ps-title { font-size: 13px; font-weight: 600; }
.ps-icon-button {
  border: none;
  background: transparent;
  color: #a1a1aa;
  cursor: pointer;
  font-size: 13px;
  padding: 4px;
  border-radius: 6px;
}
.ps-icon-button:hover { color: #fafafa; }
.ps-icon-button:focus-visible { outline: 2px solid #6366f1; }
.ps-section { display: flex; flex-direction: column; gap: 8px; }
.ps-label { font-size: 12px; font-weight: 600; color: #d4d4d8; margin: 0; }
.ps-hint { font-size: 12px; color: #a1a1aa; margin: 0; line-height: 1.5; }
.ps-meta { font-size: 12px; color: #d4d4d8; margin: 0; }
.ps-ok { font-size: 12px; color: #4ade80; margin: 0; }
.ps-error { font-size: 12px; color: #f87171; margin: 0; line-height: 1.5; }
.ps-list {
  margin: 0;
  padding-left: 16px;
  font-size: 12px;
  color: #d4d4d8;
  max-height: 140px;
  overflow-y: auto;
}
.ps-textarea {
  width: 100%;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: #27272a;
  color: #fafafa;
  font-size: 12px;
  padding: 8px;
  resize: vertical;
  font-family: inherit;
}
.ps-textarea:focus-visible { outline: 2px solid #6366f1; }
.ps-actions { display: flex; gap: 8px; justify-content: flex-end; }
.ps-button {
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: #27272a;
  color: #fafafa;
  font-size: 12px;
  padding: 6px 12px;
  cursor: pointer;
}
.ps-button:hover { background: #3f3f46; }
.ps-button:focus-visible { outline: 2px solid #6366f1; }
.ps-button.ps-primary { background: #4f46e5; border-color: #4f46e5; }
.ps-button.ps-primary:hover { background: #6366f1; }
.ps-outline {
  position: fixed;
  border: 2px solid #6366f1;
  background: rgba(99, 102, 241, 0.12);
  pointer-events: none;
  z-index: 2147483001;
}
.ps-outline.ps-region {
  border: 2px dashed #22d3ee;
  background: rgba(34, 211, 238, 0.10);
}
.ps-outline.ps-selected {
  border: 1px solid #6366f1;
  background: transparent;
}
.ps-actions.ps-actions-start {
  justify-content: flex-start;
}
.ps-button.ps-danger {
  border-color: rgba(248, 113, 113, 0.5);
  color: #f87171;
}
`;

/**
 * Mount the Studio toolbar. Safe to call multiple times; only the first call
 * creates the host. Returns true when a fresh mount happened.
 */
export function mountPortalStudio(config?: PortalStudioConfig): boolean {
  if (typeof document === "undefined") return false;
  if (document.getElementById(HOST_ID)) return false;
  if (!config || typeof config.token !== "string" || !config.endpoint) {
    console.warn("[portal-studio] missing dev config; Studio not mounted");
    return false;
  }

  const host = document.createElement("div");
  host.id = HOST_ID;
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = TOOLBAR_STYLES;
  shadow.appendChild(style);

  const container = document.createElement("div");
  shadow.appendChild(container);

  createRoot(container).render(<StudioToolbar config={config} />);
  // Runtime diagnostics + heartbeat/evidence loop (idempotent across HMR).
  installDiagnosticsCapture(sharedDiagnosticsBuffer);
  startEvidenceLoop(config, sharedDiagnosticsBuffer);
  // Bootstrap marker: requests a fresh monotonic browser revision from the
  // dev server. Full reloads re-run this, so the counter bump is the
  // authoritative "page restarted" signal (contract §10).
  fetch("/__portal-studio/bootstrap", {
    method: "POST",
    headers: { "X-Portal-Studio-Token": config.token },
  })
    .then((response) => (response.ok ? response.json() : null))
    .then((payload: { browserRevision?: number } | null) => {
      if (payload?.browserRevision !== undefined) {
        (window as unknown as Record<string, unknown>).__PORTAL_STUDIO_BROWSER_REVISION__ =
          payload.browserRevision;
      }
    })
    .catch(() => {
      // Dev server restarting; the next reload re-bootstraps.
    });
  (window as Window & { __PORTAL_STUDIO_MOUNTED__?: boolean }).__PORTAL_STUDIO_MOUNTED__ = true;
  return true;
}
