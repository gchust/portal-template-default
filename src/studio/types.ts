/**
 * Portal Studio — task artifact schema v1 (shared client/server contract).
 *
 * Contract: docs/exec-plans/portal-studio/00-shared-contract.md §6.
 * Version 1 (Goal 01): single element capture; additive evolution only.
 */

export const TASK_SCHEMA_VERSION = 1;

export const TASK_FILENAME = "active-task.json";

export type SelectorCandidateKind = "id" | "attribute" | "path";

export type SelectorCandidate = {
  kind: SelectorCandidateKind;
  selector: string;
};

export type ComponentCandidate = {
  name: string | null;
  key: string | null;
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
};

export type ElementCapture = {
  tagName: string;
  selectorCandidates: SelectorCandidate[];
  componentCandidates: ComponentCandidate[];
  sourceCandidates: SourceCandidate[];
  snapshot: ElementSnapshot;
};

export type PortalStudioTask = {
  schemaVersion: typeof TASK_SCHEMA_VERSION;
  taskId: string;
  createdAt: string;
  url: string;
  title: string;
  instruction: string;
  element: ElementCapture;
};
