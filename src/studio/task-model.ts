/**
 * Portal Studio — annotation task model (pure, testable).
 *
 * Goal 02 (D-033 #14/#17): the canonical artifact is schemaVersion 5 with
 * `annotations[]`. v4 files are unpublished dev-only intermediates — the
 * ONLY compatibility path is normalize-on-read via `normalizeTask` (a pure
 * mapping, never a migration framework). Display numbers are the live order
 * index + 1 (D-034 #4); stable `annotationId`s never renumber.
 */

import {
  TASK_SCHEMA_VERSION,
  TASK_SCHEMA_VERSION_V4,
  type Annotation,
  type PortalStudioTask,
  type PortalStudioTaskV4,
} from "./types";

export const MAX_ANNOTATIONS = 50;
/** Matches the server-side safe task-id pattern (endpoint.ts). */
export const ANNOTATION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/**
 * v4 → v5 normalization (D-033 #17): `instruction` becomes a single
 * annotation's comment, `elements[]` its captures, `region` its rect.
 * Lossless for every v4 field (bookkeeping is carried through untouched).
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


