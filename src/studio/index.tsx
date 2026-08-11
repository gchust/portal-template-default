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

export const TOOLBAR_STYLES = `
.ps-root {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  pointer-events: none;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color-scheme: dark;
  /* Host-theme accent (D-031): inherits the portal's --primary when the
     host defines one; indigo fallback keeps the classic dev look. */
  --ps-accent: var(--primary, #6366f1);
  --ps-primary-foreground: var(--primary-foreground, #ffffff);
}
.ps-root * {
  box-sizing: border-box;
  pointer-events: auto;
}
/* Goal 01 v5: collapsed horizontal chip (drag handle | status slot |
   short label | expand). The chip body click expands; only the explicit
   drag handle starts a drag, so dragging never expands. */
.ps-collapsed-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 9999px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: #18181b;
  color: #fafafa;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
  user-select: none;
  touch-action: none;
  white-space: nowrap;
}
.ps-chip-drag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  color: #71717a;
  cursor: grab;
  border-radius: 9999px;
  padding: 0;
}
.ps-chip-drag:hover { color: #fafafa; background: rgba(255,255,255,0.08); }
.ps-chip-drag:focus-visible {
  outline: 2px solid var(--ps-accent, #6366f1);
  outline-offset: 2px;
}
/* Status slot: feedback icon OR the open count (99+ cap) — never both,
   never a detached corner badge. */
.ps-status-slot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 5px;
  border-radius: 9999px;
  background: var(--ps-accent, #6366f1);
  color: var(--ps-primary-foreground, #ffffff);
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
}
.ps-chip-open {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: transparent;
  color: #fafafa;
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  padding: 0 2px;
  cursor: pointer;
  border-radius: 9999px;
  height: 32px;
}
.ps-chip-open:hover { color: #ffffff; }
.ps-chip-open:focus-visible {
  outline: 2px solid var(--ps-accent, #6366f1);
  outline-offset: 2px;
}
.ps-chip-label {
  white-space: nowrap;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ps-chip-expand {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 9999px;
  background: transparent;
  color: #a1a1aa;
  cursor: pointer;
  padding: 0;
}
.ps-chip-expand:hover { color: #fafafa; background: rgba(255,255,255,0.08); }
.ps-chip-expand:focus-visible {
  outline: 2px solid var(--ps-accent, #6366f1);
  outline-offset: 2px;
}
/* Goal 01 v5: expanded horizontal bar — exactly ONE row, never wraps. */
.ps-horizontal-bar {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 4px;
  padding: 6px 8px;
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: #18181b;
  color: #fafafa;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
  user-select: none;
  touch-action: none;
}
.ps-tool-grip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: none;
  background: transparent;
  color: #71717a;
  cursor: grab;
  border-radius: 10px;
  padding: 0;
}
.ps-tool-grip:hover { color: #fafafa; background: rgba(255,255,255,0.08); }
.ps-tool-grip:focus-visible {
  outline: 2px solid var(--ps-accent, #6366f1);
  outline-offset: 2px;
}
.ps-tool-group {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.ps-tool-divider {
  width: 1px;
  height: 22px;
  background: rgba(255, 255, 255, 0.14);
  margin: 0 2px;
}
/* Hit targets: 40x40 desktop, 36x36 compact (media query below). */
.ps-tool-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: #a1a1aa;
  cursor: pointer;
  padding: 0;
}
.ps-tool-action:hover { color: #fafafa; background: rgba(255,255,255,0.08); }
.ps-tool-action:focus-visible {
  outline: 2px solid var(--ps-accent, #6366f1);
  outline-offset: 2px;
}
.ps-tool-action[aria-pressed="true"] {
  background: var(--ps-accent, #6366f1);
  border-color: var(--ps-accent, #6366f1);
  color: var(--ps-primary-foreground, #ffffff);
  box-shadow: 0 0 0 2px
    color-mix(in srgb, var(--ps-accent, #6366f1) 35%, transparent);
}
.ps-tool-action[aria-expanded="true"] {
  background: color-mix(in srgb, var(--ps-accent, #6366f1) 22%, transparent);
  border-color: var(--ps-accent, #6366f1);
  color: var(--ps-accent, #6366f1);
}
.ps-tool-action:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
/* Goal 01 v5: compact viewport (360-419px) — one row, 36px targets,
   tighter gaps, no wrap, no horizontal overflow. */
@media (max-width: 419px) {
  .ps-horizontal-bar { gap: 2px; padding: 5px 4px; border-radius: 14px; }
  .ps-tool-grip { width: 36px; height: 36px; }
  .ps-tool-action { width: 36px; height: 36px; }
  .ps-tool-group { gap: 1px; }
  .ps-tool-divider { margin: 0 1px; }
  .ps-collapsed-chip { gap: 4px; padding: 5px 6px; }
  .ps-chip-label { max-width: 108px; }
}
@media (max-width: 339px) {
  /* Very narrow: the visible label may hide; the accessible label stays. */
  .ps-chip-label { display: none; }
}
/* G01 dock: positioning container only (drag lives on the handles). */
.ps-dock {
  position: fixed;
  display: inline-flex;
  align-items: center;
  z-index: 2147483000;
}
.ps-copy-button {
  width: 28px;
  height: 28px;
  border-radius: 9999px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: #18181b;
  color: #a1a1aa;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.ps-copy-feedback {
  position: absolute;
  right: 0;
  bottom: calc(100% + 6px);
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: #18181b;
  color: #4ade80;
  font-size: 12px;
  white-space: nowrap;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  z-index: 2147483001;
}
.ps-copy-fallback {
  /* Round-3 finding 4: positioned by the shared viewport-aware placement
     utility (inline left/top/width/maxHeight); fixed so it is anchored to
     the Copy button and clamps/flips inside the viewport at any dock
     position and viewport size. */
  position: fixed;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: #18181b;
  color: #fafafa;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  /* Goal 03 blocker fix: the fallback is an open Studio surface — page
     markers must never cover it (previously 3001, below marker anchors). */
  z-index: 2147483005;
}
.ps-copy-text {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
}
:host-context([data-ps-theme="light"]) .ps-copy-feedback {
  border: 1px solid rgba(0, 0, 0, 0.14);
  background: #ffffff;
  color: #16a34a;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
}
:host-context([data-ps-theme="light"]) .ps-copy-fallback {
  border: 1px solid rgba(0, 0, 0, 0.14);
  background: #ffffff;
  color: #18181b;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.16);
}

/* Goal 01 v5: separate anchored surfaces — capture status, shortcut help
   and the annotation list. None of them is a toolbar. */
.ps-status-panel,
.ps-help-popover,
.ps-list-panel {
  position: fixed;
  /* Goal 03 blocker fix: open panel content must never be covered by
     page markers/outlines (marker anchors sit at 2147483002) — panels
     paint ABOVE them, below the marker editor/dialog layer. */
  z-index: 2147483003;
  overscroll-behavior: contain;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: #18181b;
  color: #fafafa;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
  padding: 12px;
  overflow-y: auto;
  box-sizing: border-box;
}
.ps-help-list {
  margin: 8px 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ps-help-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: #d4d4d8;
}
.ps-help-keycap {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  color: #fafafa;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 5px;
  padding: 2px 6px;
  background: rgba(255, 255, 255, 0.06);
  white-space: nowrap;
}
.ps-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.ps-list-counts {
  color: #a1a1aa;
  font-weight: 500;
  font-size: 11px;
}
.ps-list-filters { display: inline-flex; gap: 4px; }
.ps-list-panel .ps-annotation-list {
  max-height: none;
  overflow: visible;
}
.ps-annotation-secondary {
  font-size: 11px;
  color: #a1a1aa;
  overflow-wrap: anywhere;
}
.ps-annotation-comment[role="button"] {
  cursor: pointer;
}
.ps-annotation-comment[role="button"]:focus-visible {
  outline: 2px solid var(--ps-accent, #6366f1);
  outline-offset: 2px;
  border-radius: 4px;
}
.ps-list-footer {
  margin-top: 10px;
  display: flex;
  justify-content: flex-end;
}
.ps-remove-completed {
  border: none;
  background: transparent;
  color: #a1a1aa;
  font-size: 11px;
  padding: 4px 6px;
  border-radius: 6px;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.ps-remove-completed:hover:not(:disabled) { color: #f87171; }
.ps-remove-completed:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  text-decoration: none;
}
.ps-remove-completed:focus-visible {
  outline: 2px solid var(--ps-accent, #6366f1);
  outline-offset: 2px;
}
/* Goal 02: target-side composer — the one small form beside the captured
   target/group/region. The horizontal toolbar never hosts it. */
.ps-composer {
  position: fixed;
  z-index: 2147483007;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: #18181b;
  color: #fafafa;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-sizing: border-box;
}
.ps-composer-textarea {
  min-height: 64px;
  resize: vertical;
}
.ps-composer-actions {
  justify-content: flex-end;
}
.ps-composer-error {
  margin: 0;
}
:host-context([data-ps-theme="light"]) .ps-composer {
  border: 1px solid rgba(0, 0, 0, 0.14);
  background: #ffffff;
  color: #18181b;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.16);
}
/* Goal 02: compact non-blocking save toast (replaces the Saved panel). */
.ps-save-toast {
  position: fixed;
  z-index: 2147483008;
  left: 50%;
  bottom: 92px;
  transform: translateX(-50%);
  padding: 8px 14px;
  border-radius: 9999px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: #18181b;
  color: #4ade80;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  pointer-events: none;
}
.ps-save-toast-warning {
  color: #fbbf24;
}
:host-context([data-ps-theme="light"]) .ps-save-toast {
  border: 1px solid rgba(0, 0, 0, 0.14);
  background: #ffffff;
  color: #16a34a;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
}
:host-context([data-ps-theme="light"]) .ps-save-toast-warning {
  color: #d97706;
}

/* Goal 01 v5: custom tooltip — registry-generated, pointer-events none,
   role=tooltip wired through aria-describedby (no native title). */
.ps-tooltip {
  position: fixed;
  z-index: 2147483006;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 9px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: #27272a;
  color: #fafafa;
  font-size: 11px;
  font-weight: 500;
  line-height: 1.4;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
}
.ps-tooltip-keycap {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  color: #d4d4d8;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 5px;
  padding: 1px 5px;
  background: rgba(255, 255, 255, 0.06);
}
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
.ps-icon-button:focus-visible { outline: 2px solid var(--ps-accent, #6366f1); }
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
.ps-textarea:focus-visible { outline: 2px solid var(--ps-accent, #6366f1); }
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
.ps-button:focus-visible { outline: 2px solid var(--ps-accent, #6366f1); }
.ps-button.ps-primary { background: var(--ps-accent, #4f46e5); border-color: var(--ps-accent, #4f46e5); color: var(--ps-primary-foreground, #ffffff); }
.ps-button.ps-primary:hover { filter: brightness(1.12); }
.ps-outline {
  position: fixed;
  border: 2px solid var(--ps-accent, #6366f1);
  background: color-mix(in srgb, var(--ps-accent, #6366f1) 12%, transparent);
  pointer-events: none;
  z-index: 2147483001;
}
.ps-outline.ps-region {
  border: 2px dashed #22d3ee;
  background: rgba(34, 211, 238, 0.10);
}
.ps-outline.ps-selected {
  border: 1px solid var(--ps-accent, #6366f1);
  background: transparent;
}
.ps-actions.ps-actions-start {
  justify-content: flex-start;
}
.ps-button.ps-danger {
  border-color: rgba(248, 113, 113, 0.5);
  color: #f87171;
}
/* Annotation-first marker overlay + list (G02, D-033 #8/#9). */
.ps-marker-anchor {
  position: fixed;
  z-index: 2147483002;
  pointer-events: none;
}
.ps-marker-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 4px;
  border-radius: 9999px;
  background: var(--ps-accent, #6366f1);
  color: var(--ps-primary-foreground, #ffffff);
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
}
/* Goal 03: markers are semantic buttons — clickable, keyboard-focusable. */
.ps-marker-chip-button {
  position: relative;
  pointer-events: auto;
  cursor: pointer;
  border: none;
  font-family: inherit;
}
/* Goal 03 C: a ≈30px HIT TARGET around the ≈20px visual chip — the
   ::before is part of the button's hit-testing box. */
.ps-marker-chip-button::before {
  content: "";
  position: absolute;
  inset: -5px;
  border-radius: inherit;
}
.ps-marker-chip-button:hover {
  filter: brightness(1.15);
}
.ps-marker-chip-button:focus-visible {
  outline: 2px solid var(--ps-accent, #6366f1);
  outline-offset: 2px;
}
/* Goal 03: region marker chip sits on the region outline's corner. */
.ps-marker-region-chip {
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
}
/* Goal 03: temporary multi-target highlight while the editor is open. */
.ps-marker-highlight {
  border-color: #fbbf24;
  background: rgba(251, 191, 36, 0.12);
  pointer-events: none;
}
/* Goal 04: view-filter toggle in the annotation-list panel. */
.ps-view-toggle {
  font-size: 11px;
  padding: 2px 8px;
}
.ps-view-toggle[aria-pressed="true"] {
  border-color: var(--ps-accent, #6366f1);
  color: var(--ps-accent, #6366f1);
}
/* Goal 03: marker-local editor dialog. max-width/max-height + overflow
   make it FIT viewports smaller than its nominal 264x232 size, keeping
   Save/Delete reachable via scrolling (review P1). */
.ps-marker-editor {
  position: fixed;
  z-index: 2147483004;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: #18181b;
  color: #fafafa;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-sizing: border-box;
  max-width: calc(100vw - 8px);
  max-height: calc(100vh - 8px);
  overflow-y: auto;
}
:host-context([data-ps-theme="light"]) .ps-marker-editor {
  border: 1px solid rgba(0, 0, 0, 0.14);
  background: #ffffff;
  color: #18181b;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.16);
}
.ps-marker-chip-onpage {
  border: 1px solid rgba(255, 255, 255, 0.7);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
}
.ps-annotation-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 180px;
  overflow-y: auto;
}
.ps-annotation-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.06);
}
.ps-annotation-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.ps-annotation-comment {
  font-size: 12px;
  color: inherit;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.ps-unresolved {
  font-size: 10px;
  color: #a1a1aa;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.ps-annotation-item-completed {
  opacity: 0.72;
}
.ps-annotation-item-completed .ps-annotation-comment {
  text-decoration: line-through;
}
.ps-marker-chip-completed {
  background: #16a34a;
}
.ps-completed-label {
  font-size: 10px;
  color: #4ade80;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
:host-context([data-ps-theme="light"]) .ps-completed-label {
  color: #16a34a;
}
.ps-annotation-item-hidden {
  opacity: 0.55;
}
.ps-annotation-item-hidden .ps-marker-chip {
  filter: grayscale(1);
}
.ps-annotation-actions {
  display: inline-flex;
  gap: 2px;
  margin-top: 2px;
}
.ps-annotation-confirm {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 11px;
  color: #f87171;
  margin-top: 4px;
}
.ps-annotation-confirm .ps-button {
  padding: 2px 8px;
  font-size: 11px;
}
.ps-annotation-edit {
  min-height: 44px;
}


:host-context([data-ps-theme="light"]) .ps-annotation-item {
  background: rgba(0, 0, 0, 0.05);
}
:host-context([data-ps-theme="light"]) .ps-unresolved {
  color: #71717a;
}

/* Light host (D-031): mirror the host palette so the toolbar looks native
   on light portals (the AI portal is white with a near-black primary). */
:host-context([data-ps-theme="light"]) .ps-root { color-scheme: light; }
/* Light host: the floating toggle follows the host palette too (D-031
   follow-up) — white button with dark glyph instead of the fixed black. */
:host-context([data-ps-theme="light"]) .ps-collapsed-chip,
:host-context([data-ps-theme="light"]) .ps-horizontal-bar {
  background: #ffffff;
  color: #18181b;
  border: 1px solid rgba(0, 0, 0, 0.14);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.14);
}
:host-context([data-ps-theme="light"]) .ps-chip-drag,
:host-context([data-ps-theme="light"]) .ps-tool-grip { color: #71717a; }
:host-context([data-ps-theme="light"]) .ps-chip-drag:hover,
:host-context([data-ps-theme="light"]) .ps-tool-grip:hover {
  color: #18181b;
  background: rgba(0, 0, 0, 0.06);
}
:host-context([data-ps-theme="light"]) .ps-chip-open { color: #18181b; }
:host-context([data-ps-theme="light"]) .ps-chip-open:hover { color: #000000; }
:host-context([data-ps-theme="light"]) .ps-chip-expand { color: #71717a; }
:host-context([data-ps-theme="light"]) .ps-chip-expand:hover {
  color: #18181b;
  background: rgba(0, 0, 0, 0.06);
}
:host-context([data-ps-theme="light"]) .ps-tool-action { color: #71717a; }
:host-context([data-ps-theme="light"]) .ps-tool-action:hover {
  color: #18181b;
  background: rgba(0, 0, 0, 0.06);
}
:host-context([data-ps-theme="light"]) .ps-tool-action[aria-pressed="true"] {
  background: var(--ps-accent, #6366f1);
  border-color: var(--ps-accent, #6366f1);
  color: #ffffff;
  box-shadow: 0 0 0 2px
    color-mix(in srgb, var(--ps-accent, #6366f1) 30%, transparent);
}
:host-context([data-ps-theme="light"]) .ps-tool-action[aria-expanded="true"] {
  background: color-mix(in srgb, var(--ps-accent, #6366f1) 14%, transparent);
  border-color: var(--ps-accent, #6366f1);
  color: var(--ps-accent, #6366f1);
}
:host-context([data-ps-theme="light"]) .ps-tool-divider {
  background: rgba(0, 0, 0, 0.14);
}
:host-context([data-ps-theme="light"]) .ps-status-panel,
:host-context([data-ps-theme="light"]) .ps-help-popover,
:host-context([data-ps-theme="light"]) .ps-list-panel {
  border: 1px solid rgba(0, 0, 0, 0.14);
  background: #ffffff;
  color: #18181b;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.16);
}
:host-context([data-ps-theme="light"]) .ps-help-row { color: #3f3f46; }
:host-context([data-ps-theme="light"]) .ps-help-keycap,
:host-context([data-ps-theme="light"]) .ps-tooltip-keycap {
  color: #3f3f46;
  border-color: rgba(0, 0, 0, 0.14);
  background: rgba(0, 0, 0, 0.05);
}
:host-context([data-ps-theme="light"]) .ps-tooltip {
  background: #ffffff;
  color: #18181b;
  border: 1px solid rgba(0, 0, 0, 0.14);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.16);
}
:host-context([data-ps-theme="light"]) .ps-list-counts { color: #71717a; }
:host-context([data-ps-theme="light"]) .ps-annotation-secondary {
  color: #71717a;
}
:host-context([data-ps-theme="light"]) .ps-remove-completed {
  color: #71717a;
}
:host-context([data-ps-theme="light"]) .ps-remove-completed:hover:not(:disabled) {
  color: #dc2626;
}
:host-context([data-ps-theme="light"]) .ps-copy-button {
  border: 1px solid rgba(0, 0, 0, 0.14);
  background: #ffffff;
  color: #71717a;
}

:host-context([data-ps-theme="light"]) .ps-label { color: #3f3f46; }
:host-context([data-ps-theme="light"]) .ps-hint { color: #52525b; }
:host-context([data-ps-theme="light"]) .ps-meta { color: #3f3f46; }
:host-context([data-ps-theme="light"]) .ps-list { color: #3f3f46; }
:host-context([data-ps-theme="light"]) .ps-icon-button { color: #71717a; }
:host-context([data-ps-theme="light"]) .ps-icon-button:hover { color: #18181b; }
:host-context([data-ps-theme="light"]) .ps-textarea {
  border: 1px solid rgba(0, 0, 0, 0.14);
  background: #f4f4f5;
  color: #18181b;
}
:host-context([data-ps-theme="light"]) .ps-button {
  border: 1px solid rgba(0, 0, 0, 0.14);
  background: #f4f4f5;
  color: #18181b;
}
:host-context([data-ps-theme="light"]) .ps-button:hover { background: #e4e4e7; }
:host-context([data-ps-theme="light"]) .ps-ok { color: #16a34a; }
:host-context([data-ps-theme="light"]) .ps-error { color: #dc2626; }
:host-context([data-ps-theme="light"]) .ps-button.ps-danger {
  border-color: rgba(220, 38, 38, 0.5);
  color: #dc2626;
}
`;

/**
 * Theme adaptation (D-031): luminance of the host page background decides
 * whether the toolbar renders its light or dark palette. Walks
 * html → body → #root and uses the first non-transparent background.
 * Pages without a resolvable background default to light, matching the AI
 * portal template's white theme. Handles rgb()/rgba(), oklch() and hsl().
 */
export const detectHostTheme = (): "light" | "dark" => {
  const elements = [
    document.documentElement,
    document.body,
    document.getElementById("root"),
  ].filter((element): element is HTMLElement => !!element);
  let luminance: number | null = null;
  for (const element of elements) {
    const bg = getComputedStyle(element).backgroundColor;
    const parsed = (() => {
      const rgb = bg.match(/rgba?\(([^)]+)\)/);
      if (rgb) {
        const parts = rgb[1].split(",").map((part) => parseFloat(part));
        if (parts.length >= 3 && parts.every((n) => !Number.isNaN(n))) {
          // Fully transparent backgrounds carry no luminance (skip).
          if (parts.length >= 4 && parts[3] === 0) return null;
          return 0.299 * parts[0] + 0.587 * parts[1] + 0.114 * parts[2];
        }
        return null;
      }
      const oklch = bg.match(/oklch\(([^)]+)\)/);
      if (oklch) {
        // oklch lightness is 0..1; map onto the 0..255 scale.
        const lightness = parseFloat(oklch[1].split(/[\s,]+/)[0]);
        if (!Number.isNaN(lightness)) return lightness * 255;
        return null;
      }
      const hsl = bg.match(/hsl\(([^)]+)\)/);
      if (hsl) {
        const parts = hsl[1].split(/[\s,]+/).map((part) => parseFloat(part));
        if (parts.length >= 3 && !Number.isNaN(parts[2])) {
          return (parts[2] / 100) * 255;
        }
        return null;
      }
      return null;
    })();
    if (parsed !== null) {
      luminance = parsed;
      break;
    }
  }
  return luminance === null || luminance > 128 ? "light" : "dark";
};

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
