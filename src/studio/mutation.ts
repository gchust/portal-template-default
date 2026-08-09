/**
 * Goal 06 — typed revision-aware atomic mutation contract.
 *
 * ONE typed contract shared by the browser, the dev-server middleware and
 * the agent CLI: a request carries the stable taskId, the expected
 * taskRevision and a list of operations. The server applies the operations
 * atomically (single temp+rename write) and increments taskRevision; a
 * revision mismatch returns 409 with the current metadata/task so the
 * browser can refresh, retry once and then show explicit conflict
 * feedback. `applyMutationOperations` is PURE and is used by the HTTP
 * handler AND the CLI so both share identical mutation semantics.
 */

import type { Annotation, PortalStudioTask } from "./types";
import { MAX_ANNOTATIONS } from "./task-model.ts";

/** The eight supported mutation operations (Goal 06 contract). */
export type MutationOp =
  | { op: "add"; annotation: Annotation }
  | { op: "updateComment"; annotationId: string; comment: string }
  | { op: "setHidden"; annotationId: string; hidden: boolean }
  | {
      op: "complete";
      annotationId: string;
      /** Goal 05 additive evidence (the agent CLI's --verified path). */
      evidence?: { verified: boolean; summary: string; source: "cli" };
    }
  | { op: "reopen"; annotationId: string }
  | { op: "remove"; annotationId: string }
  | { op: "removeCompleted" }
  | { op: "clear" };

export type MutationRequest = {
  taskId: string;
  expectedTaskRevision: number;
  operations: MutationOp[];
};

export type MutationResult =
  | { ok: true; task: PortalStudioTask }
  | {
      ok: false;
      error:
        | "invalid_request"
        | "annotation_not_found"
        | "annotation_limit"
        | "empty_operations"
        | "task_id_mismatch";
    };

/** All annotations of the active task are completed (new-batch condition). */
export function isFullyCompletedTask(task: PortalStudioTask): boolean {
  return (
    task.annotations.length > 0 &&
    task.annotations.every((annotation) => annotation.status === "completed")
  );
}

const requiresAnnotation = (
  annotations: Annotation[],
  annotationId: string
): boolean => annotations.some((a) => a.annotationId === annotationId);

/**
 * Apply a validated list of operations to a task (pure; no I/O). Each
 * operation is applied in order; unknown annotation ids and empty
 * operation lists are rejected so a partial application can never be
 * persisted. Unrelated fields are always preserved (spread).
 */
export function applyMutationOperations(
  task: PortalStudioTask,
  operations: MutationOp[]
): MutationResult {
  if (!Array.isArray(operations) || operations.length === 0) {
    return { ok: false, error: "empty_operations" };
  }
  let annotations = task.annotations;
  for (const operation of operations) {
    switch (operation.op) {
      case "add":
        // P3-3 review: the pure contract enforces the annotation bound so
        // every consumer (server + CLI) is limited identically.
        if (annotations.length >= MAX_ANNOTATIONS) {
          return { ok: false, error: "annotation_limit" };
        }
        annotations = [...annotations, operation.annotation];
        break;
      case "updateComment":
        if (!requiresAnnotation(annotations, operation.annotationId)) {
          return { ok: false, error: "annotation_not_found" };
        }
        annotations = annotations.map((annotation) =>
          annotation.annotationId === operation.annotationId
            ? { ...annotation, comment: operation.comment }
            : annotation
        );
        break;
      case "setHidden":
        if (!requiresAnnotation(annotations, operation.annotationId)) {
          return { ok: false, error: "annotation_not_found" };
        }
        annotations = annotations.map((annotation) =>
          annotation.annotationId === operation.annotationId
            ? { ...annotation, hidden: operation.hidden }
            : annotation
        );
        break;
      case "complete": {
        if (!requiresAnnotation(annotations, operation.annotationId)) {
          return { ok: false, error: "annotation_not_found" };
        }
        const completedAt = new Date().toISOString();
        annotations = annotations.map((annotation) =>
          annotation.annotationId === operation.annotationId &&
          annotation.status !== "completed"
            ? {
                ...annotation,
                status: "completed",
                completedAt,
                ...(operation.evidence
                  ? {
                      completedEvidence: {
                        verified: operation.evidence.verified,
                        summary: operation.evidence.summary,
                        source: operation.evidence.source,
                        completedAt,
                      },
                    }
                  : {}),
              }
            : annotation
        );
        break;
      }
      case "reopen":
        if (!requiresAnnotation(annotations, operation.annotationId)) {
          return { ok: false, error: "annotation_not_found" };
        }
        annotations = annotations.map((annotation) =>
          annotation.annotationId === operation.annotationId &&
          annotation.status === "completed"
            ? {
                ...annotation,
                status: "open",
                completedAt: undefined,
                completedEvidence: undefined,
              }
            : annotation
        );
        break;
      case "remove":
        if (!requiresAnnotation(annotations, operation.annotationId)) {
          return { ok: false, error: "annotation_not_found" };
        }
        annotations = annotations.filter(
          (annotation) => annotation.annotationId !== operation.annotationId
        );
        break;
      case "removeCompleted":
        annotations = annotations.filter(
          (annotation) => annotation.status !== "completed"
        );
        break;
      case "clear":
        annotations = [];
        break;
      default:
        return { ok: false, error: "invalid_request" };
    }
  }
  return { ok: true, task: { ...task, annotations } };
}

/** Validate an unknown payload as a MutationRequest (server + tests). */
export function parseMutationRequest(input: unknown): MutationRequest | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  if (typeof record.taskId !== "string") return null;
  if (typeof record.expectedTaskRevision !== "number") return null;
  if (!Array.isArray(record.operations)) return null;
  const operations: MutationOp[] = [];
  for (const raw of record.operations) {
    if (!raw || typeof raw !== "object") return null;
    const op = raw as Record<string, unknown>;
    switch (op.op) {
      case "add": {
        const annotation = op.annotation as Annotation | undefined;
        if (!annotation || typeof annotation.annotationId !== "string") {
          return null;
        }
        operations.push({ op: "add", annotation });
        break;
      }
      case "updateComment":
        if (typeof op.annotationId !== "string" || typeof op.comment !== "string") {
          return null;
        }
        operations.push({
          op: "updateComment",
          annotationId: op.annotationId,
          comment: op.comment,
        });
        break;
      case "setHidden":
        if (typeof op.annotationId !== "string" || typeof op.hidden !== "boolean") {
          return null;
        }
        operations.push({
          op: "setHidden",
          annotationId: op.annotationId,
          hidden: op.hidden,
        });
        break;
      case "complete": {
        if (typeof op.annotationId !== "string") return null;
        let evidence: MutationOp extends never ? never : { verified: boolean; summary: string; source: "cli" } | undefined;
        const rawEvidence = op.evidence as Record<string, unknown> | undefined;
        if (rawEvidence !== undefined) {
          if (
            rawEvidence.verified !== true ||
            typeof rawEvidence.summary !== "string" ||
            rawEvidence.source !== "cli"
          ) {
            return null;
          }
          evidence = {
            verified: true,
            summary: rawEvidence.summary,
            source: "cli",
          };
        }
        operations.push({
          op: "complete",
          annotationId: op.annotationId,
          ...(evidence ? { evidence } : {}),
        });
        break;
      }
      case "reopen":
      case "remove":
        if (typeof op.annotationId !== "string") return null;
        operations.push({ op: op.op, annotationId: op.annotationId });
        break;
      case "removeCompleted":
      case "clear":
        operations.push({ op: op.op });
        break;
      default:
        return null;
    }
  }
  return { taskId: record.taskId, expectedTaskRevision: record.expectedTaskRevision, operations };
}
