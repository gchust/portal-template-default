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

import { TOOLBAR_STYLES, detectHostTheme } from "./styles.ts";

/**
 * Theme adaptation (D-031): luminance of the host page background decides
 * whether the toolbar renders its light or dark palette. Walks
 * html → body → #root and uses the first non-transparent background.
 * Pages without a resolvable background default to light, matching the AI
 * portal template's white theme. Handles rgb()/rgba(), oklch() and hsl().
 */

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
  // Theme adaptation (D-031): detect the host's background luminance once
  // and switch the toolbar to a matching light/dark palette (the AI portal
  // is a white monochrome theme; the previous fixed dark panel clashed).
  host.dataset.psTheme = detectHostTheme();
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
