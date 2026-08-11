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

export const TASK_SCHEMA_VERSION = 5 as const;
export const TASK_SCHEMA_VERSION_V4 = 4 as const;
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
/** Revision-tracking states (contract §10, schema v4). */
export type RevisionState = "pending" | "matched" | "stale";

/**
 * Update-verification bookkeeping (schema v4): the source revision is the
 * content hash of the task-referenced source files (computed by the dev
 * server from disk); the browser revision is a server-issued monotonic
 * counter bumped at every bootstrap (full reload); HMR ack is informational
 * (server-observed hot update), the reload bump is the authoritative signal.
 */
export type RevisionInfo = {
  sourceRevision: string;
  browserRevision: number;
  hmrAck: boolean;
  /** ISO deadline of the bounded wait (set while verifying). */
  expectedAfter?: string;
  state: RevisionState;
  checkedAt: string;
};

export type HeartbeatReport = {
  state: HeartbeatState;
  /** Last client heartbeat report observed by the server. */
  reportedAt: string;
  /** When the server derived this state. */
  checkedAt: string;
  /** Last time the state was derived as online. */
  lastOnlineAt?: string;
};

/**
 * Annotation-first (D-033 #14, schema v5): the task carries an ordered list
 * of per-comment annotations. The display number of a marker is its LIVE
 * order index + 1 (D-034 #4) — never stored; `annotationId` is the stable
 * identity that survives renumbering.
 */
export type AnnotationKind = "element" | "multi" | "region";

export type Annotation = {
  /** Stable identity (newTaskId); never renumbered (D-034 #4). */
  annotationId: string;
  kind: AnnotationKind;
  /** Per-annotation modification comment (D-033 #7). */
  comment: string;
  createdAt: string;
  status: "open" | "completed";
  completedAt?: string;
  /**
   * Additive completion evidence (Goal 05): recorded by studio:complete
   * with --verified and a bounded summary. ADDITIVE on purpose — legacy
   * readers keep working (status/completedAt still the source of truth
   * for "completed"); never inferred from HMR/source/timestamps/tests.
   */
  completedEvidence?: {
    verified: boolean;
    summary: string;
    source: "cli";
    completedAt: string;
  };
  /** Hidden without deletion (D-033 #11; used by G03). */
  hidden?: boolean;
  /** Element captures for element/multi kinds (schema-v2-shaped). */
  elements: ElementCapture[];
  /** Viewport rect for the region kind (marquee). */
  region?: Region;
  /**
   * Goal 06: page context captured when the annotation was created
   * (backward-compatible — absent on legacy annotations). routeKey gates
   * marker rendering: markers only resolve/render when the current route
   * matches. url/title/viewport/scroll/businessContext describe the page
   * state the annotation refers to.
   */
  pageContext?: {
    url: string;
    routeKey: string;
    title: string;
    viewport: { width: number; height: number };
    scroll: { x: number; y: number };
    businessContext: BusinessContextItem[];
  };
};

/**
 * Canonical (v5) task artifact. Top-level v4 bookkeeping fields are kept;
 * `instruction`/`elements`/`region` are replaced by `annotations[]`.
 */
export type PortalStudioTask = {
  schemaVersion: typeof TASK_SCHEMA_VERSION;
  taskId: string;
  /** Immutable creation time — preserved across adds (Goal 04 C). */
  createdAt: string;
  /** Last successful mutation time — stamped on every task write
   *  (server, CLI and browser share the single stamp path). */
  updatedAt?: string;
  url: string;
  title: string;
  annotations: Annotation[];
  businessContext: BusinessContextItem[];
  redaction: RedactionManifest;
  screenshot?: ScreenshotRef;
  /** Bounded ring buffer of runtime errors (schema v3). */
  diagnostics?: DiagnosticEntry[];
  /** Server-derived page state (schema v3). */
  heartbeat?: HeartbeatReport;
  /** Update-verification bookkeeping (schema v4). */
  revision?: RevisionInfo;
  /**
   * Server-owned monotonic task revision (Goal 05): incremented by the
   * server/CLI on every successful task write; DISTINCT from the
   * source/browser revision bookkeeping above. Browsers poll this value
   * (via the lightweight revision read) to decide when to re-fetch the
   * task. Never inferred from HMR, source revision, timestamps or tests.
   */
  taskRevision?: number;
  /**
   * Sticky task-level completion marker (taskId lifecycle): stamped when the
   * LAST open annotation is completed and PRESERVED by removeCompleted so a
   * new annotation batch after a fully completed task still starts a fresh
   * taskId (contract: new taskId after a fully completed task when a new
   * batch begins), even when the completed items were removed first.
   * Cleared by add/reopen/clear, which make the task active again.
   */
  completedAt?: string;
};

/**
 * v4 payload shape (unpublished dev-only intermediate, D-033 #17): kept
 * for the simple normalize-on-read path — never a migration framework.
 */
export type PortalStudioTaskV4 = Omit<
  PortalStudioTask,
  "schemaVersion" | "annotations"
> & {
  schemaVersion: typeof TASK_SCHEMA_VERSION_V4;
  instruction: string;
  elements: ElementCapture[];
  region?: Region;
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
