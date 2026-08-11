/**
 * Portal Studio — annotation task model (pure, testable).
 *
 * Goal 03 (React Grab migration): the canonical artifact is schemaVersion 6
 * with `annotations[]` of v6 element captures. Schema v1-v5 artifacts are
 * NEVER normalized or migrated — `normalizeTask` accepts v6 only, and
 * `describeUnsupportedSchema` produces the one shared typed old-schema
 * result used by the browser, endpoint, print, verify, CLI and MCP.
 * Display numbers are the live order index + 1 (D-034 #4); stable
 * `annotationId`s never renumber.
 */

// Value imports carry the explicit .ts extension so Node 22 type
// stripping can resolve them when the print CLI / MCP import this module.
import {
  TASK_FILENAME,
  TASK_SCHEMA_VERSION,
  TASK_SCHEMA_VERSION_V1,
  TASK_SCHEMA_VERSION_V2,
  TASK_SCHEMA_VERSION_V4,
  TASK_SCHEMA_VERSION_V5,
} from "./types.ts";
import type {
  Annotation,
  PortalStudioTask,
  UnsupportedSchemaResult,
} from "./types";

export const MAX_ANNOTATIONS = 50;
/** Matches the server-side safe task-id pattern (endpoint.ts). */
export const ANNOTATION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** The dev-only artifact the unsupported-schema result points at. */
export const ACTIVE_TASK_CLEAR_PATH = `tasks/${TASK_FILENAME}`;

/**
 * Shared typed old-schema result (shared contract §5 "Unsupported old
 * artifacts"): any task-shaped artifact whose schemaVersion is not 6 gets
 * this one result with the actual/expected version and a safe instruction
 * to clear the dev-only task. Never normalized, never migrated. Returns
 * null for v6 tasks and for non-task inputs (which stay "invalid_task").
 */
export function describeUnsupportedSchema(
  input: unknown
): UnsupportedSchemaResult | null {
  if (!isRecord(input)) return null;
  const schemaVersion = input.schemaVersion;
  if (typeof schemaVersion !== "number") return null;
  if (schemaVersion === TASK_SCHEMA_VERSION) return null;
  const known = new Set([
    TASK_SCHEMA_VERSION_V1,
    TASK_SCHEMA_VERSION_V2,
    3,
    TASK_SCHEMA_VERSION_V4,
    TASK_SCHEMA_VERSION_V5,
  ]);
  if (!known.has(schemaVersion)) return null;
  return {
    status: "unsupported_schema",
    schemaVersion,
    expectedSchemaVersion: TASK_SCHEMA_VERSION,
    clearInstruction: `The active task uses the removed schema v${schemaVersion}. Clear the dev-only artifact (${ACTIVE_TASK_CLEAR_PATH}) and create the first v6 annotation again.`,
    clearPath: ACTIVE_TASK_CLEAR_PATH,
  };
}

/**
 * Normalize a raw task to the canonical v6 shape; null when the input is
 * not a recognizable v6 task. v6 payloads are returned as-is (identity)
 * after a minimal shape check. Schema v1-v5 artifacts are NOT normalized —
 * callers use `describeUnsupportedSchema` for the typed rejection.
 */
export function normalizeTask(input: unknown): PortalStudioTask | null {
  if (!isRecord(input)) return null;
  if (input.schemaVersion !== TASK_SCHEMA_VERSION) return null;
  if (!Array.isArray(input.annotations)) return null;
  return input as unknown as PortalStudioTask;
}

/**
 * Display numbers are provided by ./annotation-selectors (Goal 05 split).
 */

/**
 * ---- Goal 03: pure annotation operations (D-033 #5/#10/#11, D-034 #4) ----
 * Every mutation is a pure function over the annotations list: stable
 * annotationIds never change; display numbers are derived live (order
 * index), so deletion renumbers automatically; empty lists are VALID
 * v5 tasks (the server accepts `annotations: []`).
 */

/** Append an annotation (bounded by MAX_ANNOTATIONS). */
export function addAnnotation(
  annotations: Annotation[],
  annotation: Annotation
): Annotation[] {
  if (annotations.length >= MAX_ANNOTATIONS) return annotations;
  return [...annotations, annotation];
}

/** Remove an annotation by its stable id (display numbers renumber live). */
export function removeAnnotation(
  annotations: Annotation[],
  annotationId: string
): Annotation[] {
  return annotations.filter(
    (annotation) => annotation.annotationId !== annotationId
  );
}

/** Toggle the hidden flag (hide WITHOUT deletion, D-033 #11). */
export function toggleAnnotationHidden(
  annotations: Annotation[],
  annotationId: string
): Annotation[] {
  return annotations.map((annotation) =>
    annotation.annotationId === annotationId
      ? { ...annotation, hidden: !annotation.hidden }
      : annotation
  );
}

/** Replace the comment of one annotation (inline edit). */
export function updateAnnotationComment(
  annotations: Annotation[],
  annotationId: string,
  comment: string
): Annotation[] {
  return annotations.map((annotation) =>
    annotation.annotationId === annotationId
      ? { ...annotation, comment }
      : annotation
  );
}

/** Clear all annotations → a valid empty v5 task (clear-all action). */
export function clearAnnotations(): Annotation[] {
  return [];
}

/**
 * Group bound for the true multi-select mode (D-033 #5). Kept local so this
 * module stays importable at vite config-load time (no `@/` alias there,
 * D-008) — selection.ts's MAX_SELECTED_ELEMENTS is the same value for the
 * legacy selection model; both are deliberately aligned at 50.
 */
export const MAX_GROUP_ELEMENTS = 50;

/**
 * True multi-select group toggle (D-033 #5): toggles a live element in/out
 * of the group being built — the SAME annotation — bounded by
 * MAX_GROUP_ELEMENTS. Pure over the group element list.
 */
export function groupToggleElement(
  group: Element[],
  element: Element
): Element[] {
  if (group.includes(element)) {
    return group.filter((entry) => entry !== element);
  }
  if (group.length >= MAX_GROUP_ELEMENTS) return group;
  return [...group, element];
}

/**
 * ---- Goal 04: Complete semantics (D-033 #13) ----
 * Explicit Complete: per-annotation or all — status "completed" +
 * completedAt, NEVER double-stamped (already-completed annotations are
 * left untouched). Complete is the ONLY normal clear path; per-marker
 * delete (G03) remains for destructive removal.
 */

/** Complete ONE annotation (no double-stamp). */
export function completeAnnotation(
  annotations: Annotation[],
  annotationId: string
): Annotation[] {
  return annotations.map((annotation) =>
    annotation.annotationId === annotationId &&
    annotation.status !== "completed"
      ? {
          ...annotation,
          status: "completed",
          completedAt: new Date().toISOString(),
        }
      : annotation
  );
}

/** Maximum length of the verified-completion summary (Goal 05). */
export const MAX_COMPLETION_SUMMARY_LENGTH = 2000;

/**
 * Verified completion (Goal 05): like completeAnnotation but records the
 * completion EVIDENCE additively (verified flag + bounded summary + who
 * recorded it). The evidence never replaces the canonical status fields;
 * unrelated annotation fields are preserved (spread). No double-stamp.
 */
export function completeAnnotationVerified(
  annotations: Annotation[],
  annotationId: string,
  evidence: { verified: boolean; summary: string; source: "cli" }
): Annotation[] {
  const completedAt = new Date().toISOString();
  return annotations.map((annotation) =>
    annotation.annotationId === annotationId &&
    annotation.status !== "completed"
      ? {
          ...annotation,
          status: "completed",
          completedAt,
          completedEvidence: {
            verified: evidence.verified,
            summary: evidence.summary,
            source: evidence.source,
            completedAt,
          },
        }
      : annotation
  );
}

/** Complete ALL annotations (no double-stamp). */
export function completeAllAnnotations(
  annotations: Annotation[]
): Annotation[] {
  const completedAt = new Date().toISOString();
  return annotations.map((annotation) =>
    annotation.status === "completed"
      ? annotation
      : { ...annotation, status: "completed", completedAt }
  );
}

/** Reopen a completed annotation (pure; Goal 03 marker editor). */
export function reopenAnnotation(
  annotations: Annotation[],
  annotationId: string
): Annotation[] {
  return annotations.map((annotation) =>
    annotation.annotationId === annotationId &&
    annotation.status === "completed"
      ? {
          ...annotation,
          status: "open",
          completedAt: undefined,
          completedEvidence: undefined,
        }
      : annotation
  );
}

/**
 * Annotation selectors (Goal 05 split) — the pure view/numbering
 * selectors moved to ./annotation-selectors; re-exported here for
 * backward compatibility.
 */
export {
  annotationDisplayNumber,
  countOpenAnnotations,
  selectCompletedAnnotations,
  selectOpenAnnotations,
  selectVisibleAnnotations,
  type ViewFilter,
} from "./annotation-selectors.ts";

/** Remove ONLY completed annotations (never open); pure. */
export function removeCompletedAnnotations(
  annotations: Annotation[]
): Annotation[] {
  return annotations.filter(
    (annotation) => annotation.status !== "completed"
  );
}
