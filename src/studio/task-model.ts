/**
 * Portal Studio — annotation task model (pure, testable).
 *
 * Goal 02 (D-033 #14/#17): the canonical artifact is schemaVersion 5 with
 * `annotations[]`. v4 files are unpublished dev-only intermediates — the
 * ONLY compatibility path is normalize-on-read via `normalizeTask` (a pure
 * mapping, never a migration framework). Display numbers are the live order
 * index + 1 (D-034 #4); stable `annotationId`s never renumber.
 */

// Value imports carry the explicit .ts extension so Node 22 type
// stripping can resolve them when the print CLI / MCP import this module.
import {
  TASK_SCHEMA_VERSION,
  TASK_SCHEMA_VERSION_V1,
  TASK_SCHEMA_VERSION_V2,
  TASK_SCHEMA_VERSION_V4,
} from "./types.ts";
import type {
  Annotation,
  BusinessContextItem,
  DiagnosticEntry,
  ElementCapture,
  HeartbeatReport,
  PortalStudioTask,
  PortalStudioTaskV4,
  RedactionManifest,
  Region,
  RevisionInfo,
  ScreenshotRef,
} from "./types";

export const MAX_ANNOTATIONS = 50;
/** Matches the server-side safe task-id pattern (endpoint.ts). */
export const ANNOTATION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/**
 * Legacy (v1–v4) → v5 normalization (D-033 #17): `instruction` becomes a
 * single annotation's comment, `elements[]` its captures, `region` its
 * rect. Lossless for every legacy field (bookkeeping is carried through
 * untouched). v1 payloads carry a single `element` instead of `elements[]`.
 */
export function normalizeV4ToV5(task: PortalStudioTaskV4): PortalStudioTask {
  const { instruction, elements, region, ...rest } = task;
  const annotation: Annotation = {
    annotationId: `${task.taskId}-v4`,
    kind: elements.length > 0 ? "element" : "region",
    comment: instruction,
    createdAt: task.createdAt,
    status: "open",
    elements,
    ...(region ? { region } : {}),
  };
  return {
    ...rest,
    schemaVersion: TASK_SCHEMA_VERSION,
    annotations: [annotation],
  };
}

const isElementCaptureArray = (value: unknown): value is ElementCapture[] =>
  Array.isArray(value);

/** v1–v3 payloads (single `element` or `elements[]`) → v5. */
function normalizeLegacyToV5(
  input: Record<string, unknown>
): PortalStudioTask | null {
  const taskId = input.taskId;
  if (typeof taskId !== "string") return null;
  const instruction = input.instruction;
  if (typeof instruction !== "string") return null;
  const rawElements =
    input.schemaVersion === 1 ? [input.element] : input.elements;
  if (!isElementCaptureArray(rawElements)) return null;
  const v4: PortalStudioTaskV4 = {
    schemaVersion: TASK_SCHEMA_VERSION_V4,
    taskId,
    createdAt: typeof input.createdAt === "string" ? input.createdAt : "",
    url: typeof input.url === "string" ? input.url : "",
    title: typeof input.title === "string" ? input.title : "",
    instruction,
    elements: rawElements,
    ...(input.region ? { region: input.region as Region } : {}),
    businessContext: (input.businessContext ?? []) as BusinessContextItem[],
    redaction: (input.redaction ?? {
      droppedKeys: [],
      redactedValues: 0,
      truncatedValues: 0,
    }) as RedactionManifest,
    ...(input.screenshot ? { screenshot: input.screenshot as ScreenshotRef } : {}),
    ...(input.diagnostics
      ? { diagnostics: input.diagnostics as DiagnosticEntry[] }
      : {}),
    ...(input.heartbeat ? { heartbeat: input.heartbeat as HeartbeatReport } : {}),
    ...(input.revision ? { revision: input.revision as RevisionInfo } : {}),
  };
  return normalizeV4ToV5(v4);
}

/**
 * Normalize a raw task (v4 or v5) to the canonical v5 shape; null when the
 * input is not a recognizable v4/v5 task. v5 payloads are returned as-is
 * (identity) after a minimal shape check.
 */
export function normalizeTask(input: unknown): PortalStudioTask | null {
  if (!isRecord(input)) return null;
  if (input.schemaVersion === TASK_SCHEMA_VERSION) {
    if (!Array.isArray(input.annotations)) return null;
    return input as unknown as PortalStudioTask;
  }
  if (input.schemaVersion === TASK_SCHEMA_VERSION_V4) {
    if (
      typeof input.instruction !== "string" ||
      !Array.isArray(input.elements) ||
      typeof input.taskId !== "string"
    ) {
      return null;
    }
    return normalizeV4ToV5(input as unknown as PortalStudioTaskV4);
  }
  // v1–v3 historical intermediates: normalized on read like v4 (D-033 #17
  // dual reader — the print CLI keeps printing them, now as v5).
  if (
    input.schemaVersion === TASK_SCHEMA_VERSION_V2 ||
    input.schemaVersion === 3 ||
    input.schemaVersion === TASK_SCHEMA_VERSION_V1
  ) {
    return normalizeLegacyToV5(input);
  }
  return null;
}

/**
 * Display number of an annotation: its LIVE 1-based order index in the
 * list (D-034 #4). Undefined when the id is not present. Never stored.
 */
export function annotationDisplayNumber(
  annotations: Annotation[],
  annotationId: string
): number | undefined {
  const index = annotations.findIndex(
    (annotation) => annotation.annotationId === annotationId
  );
  return index === -1 ? undefined : index + 1;
}



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
      ? { ...annotation, status: "open", completedAt: undefined }
      : annotation
  );
}
