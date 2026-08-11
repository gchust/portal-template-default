/**
 * Portal Studio — inspection domain public surface (shared contract §4).
 *
 * All Studio code, tests, E2E and scripts consume this repository-owned
 * interface. The upstream primitives module is imported by exactly one
 * active source file: `react-grab-engine.ts`.
 */

export {
  createInspectionEngine,
  ensureStudioHostIgnored,
  inspectionEngine,
  isInspectionCandidate,
  isInteractiveControl,
  isStudioElement,
  isSvgGeometry,
  resolveUsefulTarget,
} from "./react-grab-engine";

export {
  enrichInspectedElement,
  boundRouteContext,
  collectInspectionBusinessContext,
} from "./nocobase-context";

export { composedParent, walkComposedAncestors } from "./hierarchy";

export {
  extractAccessibleName,
  extractFingerprint,
  extractIdentityAttributes,
  normalizeComparedText,
  normalizeInspectedElement,
  normalizeSource,
  normalizeSourceFrame,
  redactInspectionText,
  sanitizeViewportRect,
  toWorkspaceRelativePosix,
} from "./normalize";

export {
  parseSelectorSegments,
  resolveSelector,
  scoreFingerprint,
  validateFingerprint,
} from "./react-grab-selector-locator";

export { InspectionError } from "./types";
export type { AncestorWalkOptions } from "./hierarchy";
export type {
  FingerprintVerdict,
  SelectorResolution,
  SelectorStatus,
} from "./react-grab-selector-locator";
export type {
  ElementFingerprint,
  EnrichedTarget,
  InspectedElement,
  InspectionEngine,
  InspectionErrorCode,
  PromotionReason,
  PromotionResult,
  RawInspectionContext,
  RawSourceFrame,
  RouteContext,
  SourceFrame,
  ViewportRect,
} from "./types";
export type {
  BusinessContextItem,
} from "../types";
