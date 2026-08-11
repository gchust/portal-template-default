/**
 * Portal Studio — React Grab inspection domain types (schema v6 shape).
 *
 * This module owns the bounded, persisted-safe v6 domain contract from
 * `docs/exec-plans/portal-studio-react-grab-migration-v1/00-shared-contract.md`
 * §5: no live `Element`, Fiber object, React Grab internal object, error
 * object or function may be persisted. Only the transient engine methods
 * (`InspectionEngine`) accept/return standard DOM `Element` references while
 * the browser session is active.
 *
 * React Grab-specific upstream types never appear here; the engine maps the
 * upstream context into `RawInspectionContext` (structural) before
 * normalization.
 */

import type { BusinessContextItem } from "../types";

/** v6 bounded limits (shared contract §5 invariants). */
export const INSPECTION_SELECTOR_LIMIT = 4096;
export const INSPECTION_STACK_FRAMES_LIMIT = 12;
export const INSPECTION_HTML_PREVIEW_LIMIT = 4000;
export const INSPECTION_STYLE_TEXT_LIMIT = 6000;
export const INSPECTION_ACCESSIBLE_NAME_LIMIT = 500;
export const INSPECTION_TEXT_LIMIT = 1000;
export const INSPECTION_IDENTITY_ATTRIBUTES_LIMIT = 30;
export const INSPECTION_IDENTITY_VALUE_LIMIT = 500;
export const INSPECTION_COMPONENT_NAME_LIMIT = 200;
export const INSPECTION_ROLE_LIMIT = 200;

/** Viewport-relative rect without upstream extras (borderRadius dropped). */
export type ViewportRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

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
export type InspectedElement = {
  tagName: string;
  selector: string;
  bounds: ViewportRect;
  componentName: string | null;
  source: SourceFrame | null;
  sourceStack: SourceFrame[];
  htmlPreview: string;
  styleText: string;
  fingerprint: ElementFingerprint;
};

/** Bounded route context consumed by the enrichment boundary. */
export type RouteContext = {
  url: string;
  routeKey: string;
  title: string;
};

/** Inspected element plus NocoBase business hints (one enrichment boundary). */
export type EnrichedTarget = InspectedElement & {
  businessContext: BusinessContextItem[];
  route: RouteContext;
};

/** Structural upstream context the engine hands to normalization. */
export type RawSourceFrame = {
  functionName?: string;
  fileName?: string;
  lineNumber?: number;
  columnNumber?: number;
};

/** Structural subset of the upstream element-context result. */
export type RawInspectionContext = {
  htmlPreview: string;
  stack: RawSourceFrame[];
  componentName: string | null;
  filePath: string | null;
  lineNumber: number | null;
  columnNumber: number | null;
  selector: string | null;
  styles: string;
};

export type InspectionErrorCode =
  | "invalid_selector"
  | "upstream_error"
  | "not_an_element";

/** Typed failure of the inspection domain; never exposes upstream objects. */
export class InspectionError extends Error {
  readonly code: InspectionErrorCode;
  override readonly cause?: unknown;

  constructor(code: InspectionErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "InspectionError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

/** Reason the §3a promotion rule produced its result. */
export type PromotionReason =
  | "no-target"
  | "direct"
  | "svg-geometry-promotion";

/**
 * Transient promotion result. The element references are live only while the
 * browser session is active; nothing here is persisted.
 */
export type PromotionResult = {
  target: Element | null;
  promoted: boolean;
  reason: PromotionReason;
  stack: Element[];
  hit: Element | null;
};

/**
 * The repository-owned inspection surface (shared contract §4). There is
 * exactly one implementation and one exported instance/factory; the transient
 * methods may use standard DOM `Element` references only.
 */
export interface InspectionEngine {
  getTargetAtPoint(clientX: number, clientY: number): Element | null;
  getTargetsAtPoint(clientX: number, clientY: number): Element[];
  getBounds(element: Element): ViewportRect;
  inspect(element: Element): Promise<InspectedElement>;
  freeze(elements?: Element[]): void;
  unfreeze(): void;
  isFrozen(): boolean;
}
