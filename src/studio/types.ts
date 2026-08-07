/**
 * Portal Studio — task artifact schema (shared client/server contract).
 *
 * Contract: docs/exec-plans/portal-studio/00-shared-contract.md §6.
 * Version 3 (Goal 03): additive over v2 — `diagnostics` (bounded ring
 * buffer of redacted runtime errors), `heartbeat` (server-derived page
 * state), and `screenshot.capturedAt`. v1 payloads (single `element`) and
 * v2 payloads remain accepted and normalized by the server; the print CLI
 * renders all three versions.
 */

export const TASK_SCHEMA_VERSION = 3 as const;
export const TASK_SCHEMA_VERSION_V1 = 1 as const;
export const TASK_SCHEMA_VERSION_V2 = 2 as const;

export const TASK_FILENAME = "active-task.json";
export const SCREENSHOTS_DIRECTORY = "screenshots";

export type SelectorCandidateKind = "id" | "attribute" | "path";

export type SelectorCandidate = {
  kind: SelectorCandidateKind;
  selector: string;
};

/** Explainable candidate origin (contract: candidates carry provenance). */
export type ComponentCandidateKind = "fiber" | "dom";

export type ComponentCandidate = {
  name: string | null;
  key: string | null;
  kind?: ComponentCandidateKind;
};

export type SourceCandidateKind = "module" | "signature";

export type SourceCandidate = {
  kind: SourceCandidateKind;
  file: string;
  line?: number;
  name?: string;
  excerpt?: string;
};

export type ElementSnapshot = {
  text: string;
  attributes: Record<string, string>;
  childCount: number;
  /** Bounded DOM outline, e.g. `button#save.primary[role=button]`. */
  domOutline?: string;
  /** Curated computed-style excerpt (≤ 30 properties, values ≤ 200 chars). */
  computedStyle?: Record<string, string>;
};

export type ElementCapture = {
  tagName: string;
  selectorCandidates: SelectorCandidate[];
  componentCandidates: ComponentCandidate[];
  sourceCandidates: SourceCandidate[];
  snapshot: ElementSnapshot;
};

/** Viewport-relative integer rect (marquee selection). */
export type Region = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Business context extracted from the page (workContext-shaped). */
export type BusinessContextItem = {
  type: string;
  id?: string;
  source: string;
};

export type RedactionManifest = {
  droppedKeys: string[];
  redactedValues: number;
  truncatedValues: number;
};

export type ScreenshotRef = {
  /** Relative path under the studio root, e.g. `screenshots/<taskId>.png`. */
  file: string;
  width: number;
  height: number;
  /** When the browser captured this PNG (schema v3). */
  capturedAt?: string;
};

/** Runtime error sources captured by the diagnostics ring buffer. */
export type DiagnosticSource = "console" | "window" | "promise" | "fetch" | "xhr";

export type DiagnosticEntry = {
  source: DiagnosticSource;
  /** Redacted at ingestion; never contains secrets. */
  message: string;
  stack?: string;
  url?: string;
  /** ISO timestamp of the first occurrence in the dedup window. */
  timestamp: string;
  /** Deduped occurrences within the window (≥ 1). */
  occurrenceCount: number;
};

export type HeartbeatState = "online" | "stale" | "offline";

/**
 * Server-derived page state (never trusted from the browser alone — the
 * server computes the state from the last client report time).
 */
export type HeartbeatReport = {
  state: HeartbeatState;
  /** Last client heartbeat report observed by the server. */
  reportedAt: string;
  /** When the server derived this state. */
  checkedAt: string;
  /** Last time the state was derived as online. */
  lastOnlineAt?: string;
};

export type PortalStudioTask = {
  schemaVersion: typeof TASK_SCHEMA_VERSION;
  taskId: string;
  createdAt: string;
  url: string;
  title: string;
  instruction: string;
  elements: ElementCapture[];
  region?: Region;
  businessContext: BusinessContextItem[];
  redaction: RedactionManifest;
  screenshot?: ScreenshotRef;
  /** Bounded ring buffer of runtime errors (schema v3). */
  diagnostics?: DiagnosticEntry[];
  /** Server-derived page state (schema v3). */
  heartbeat?: HeartbeatReport;
};

/** v1 payload shape (accepted by the server, normalized to v2+). */
export type PortalStudioTaskV1 = {
  schemaVersion: typeof TASK_SCHEMA_VERSION_V1;
  taskId: string;
  createdAt: string;
  url: string;
  title: string;
  instruction: string;
  element: ElementCapture;
};
