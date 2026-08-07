/**
 * Portal Studio — task artifact schema (shared client/server contract).
 *
 * Contract: docs/exec-plans/portal-studio/00-shared-contract.md §6.
 * Version 2 (Goal 02): additive evolution over v1 — `element` is kept for
 * backward compatibility (v1 payloads) while the canonical shape uses
 * `elements[]`, plus region, business context, redaction manifest, and
 * screenshot refs. The server normalizes v1 payloads into the v2 shape.
 */

export const TASK_SCHEMA_VERSION = 2 as const;
export const TASK_SCHEMA_VERSION_V1 = 1 as const;

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
};

/** v1 payload shape (accepted by the server, normalized to v2). */
export type PortalStudioTaskV1 = {
  schemaVersion: typeof TASK_SCHEMA_VERSION_V1;
  taskId: string;
  createdAt: string;
  url: string;
  title: string;
  instruction: string;
  element: ElementCapture;
};
