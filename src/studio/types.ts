/**
 * Portal Studio — task artifact schema (shared client/server contract).
 *
 * Contract: docs/exec-plans/portal-studio-react-grab-migration-v1/
 * 00-shared-contract.md §5 (schema v6) and §8.
 * Version 6 (React Grab migration Goal 03): every element capture carries
 * ONE React Grab selector plus the normalized v6 source/stack/fingerprint;
 * regions are document-relative; pageContext is required on every new
 * annotation. Schema v1-v5 artifacts are NEVER normalized or migrated —
 * they receive one shared typed `unsupported_schema` result (see
 * task-model.describeUnsupportedSchema).
 */

export const TASK_SCHEMA_VERSION = 6 as const;

export const TASK_FILENAME = "active-task.json";
export const SCREENSHOTS_DIRECTORY = "screenshots";

/** Workspace-relative POSIX source location (shared contract §5). */
export type SourceFrame = {
  filePath: string;
  lineNumber: number;
  columnNumber: number;
  componentName: string | null;
};

/** Deterministic rehydration fingerprint (shared contract §6). */
export type ElementFingerprint = {
  tagName: string;
  role: string;
  accessibleName: string;
  text: string;
  identityAttributes: Record<string, string>;
  childCount: number;
  parent: { tagName: string; role: string };
};

/** Normalized v6 element capture (shared contract §5 `ElementCapture`). */
export type ElementCapture = {
  tagName: string;
  /** ONE React Grab selector; no candidate array. */
  selector: string;
  /** Top-level viewport bounds. */
  bounds: { x: number; y: number; width: number; height: number };
  componentName: string | null;
  source: SourceFrame | null;
  sourceStack: SourceFrame[];
  htmlPreview: string;
  styleText: string;
  fingerprint: ElementFingerprint;
};

/** Document-relative marquee region (shared contract §5 `Region`). */
export type Region = {
  coordinateSpace: "document";
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
  /** When the browser captured this PNG. */
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
/** Revision-tracking states (contract §10). */
export type RevisionState = "pending" | "matched" | "stale";

/**
 * Update-verification bookkeeping: the source revision is the content hash
 * of the task-referenced source files (computed by the dev server from
 * disk); the browser revision is a server-issued monotonic counter bumped
 * at every bootstrap (full reload); HMR ack is informational (server-
 * observed hot update), the reload bump is the authoritative signal.
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
   * Additive completion evidence (agent CLI --verified): recorded by
   * studio:complete with --verified and a bounded summary. ADDITIVE on
   * purpose — status/completedAt remain the source of truth for
   * "completed"; never inferred from HMR/source/timestamps/tests.
   */
  completedEvidence?: {
    verified: boolean;
    summary: string;
    source: "cli";
    completedAt: string;
  };
  /** Hidden without deletion (D-033 #11; used by G03). */
  hidden?: boolean;
  /** v6 element captures for element/multi kinds. */
  elements: ElementCapture[];
  /** Document-relative rect for the region kind (marquee). */
  region?: Region;
  /**
   * v6: REQUIRED on every new annotation. routeKey gates marker
   * rendering: markers only resolve/render when the current route
   * matches. url/title/viewport/scroll/businessContext describe the page
   * state the annotation refers to.
   */
  pageContext: {
    url: string;
    routeKey: string;
    title: string;
    viewport: { width: number; height: number };
    scroll: { x: number; y: number };
    businessContext: BusinessContextItem[];
  };
};

/**
 * Shared typed old-schema result (shared contract §5 "Unsupported old
 * artifacts"): returned by the browser, endpoint, print, verify, CLI and
 * MCP when the active artifact is schema v1-v5. Never normalized or
 * migrated; carries the actual/expected version and a safe instruction to
 * clear the dev-only task.
 */
export type UnsupportedSchemaResult = {
  status: "unsupported_schema";
  schemaVersion: number | null;
  expectedSchemaVersion: typeof TASK_SCHEMA_VERSION;
  /** Safe instruction to clear the dev-only artifact. */
  clearInstruction: string;
  /** Path of the dev-only artifact to clear (POSIX, relative to studio root). */
  clearPath: string;
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
  /** Bounded ring buffer of runtime errors. */
  diagnostics?: DiagnosticEntry[];
  /** Server-derived page state. */
  heartbeat?: HeartbeatReport;
  /** Update-verification bookkeeping. */
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
