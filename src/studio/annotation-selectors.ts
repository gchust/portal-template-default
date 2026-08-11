/**
 * Portal Studio — pure annotation selectors (Goal 05 maintainability split).
 *
 * View filtering, counting and display numbering over the annotation list,
 * independent of any component. `hidden` and `completed` are separate
 * concepts: the view filter selects by status only; hidden is applied at
 * render time.
 */

import type { Annotation } from "./types.ts";

export type ViewFilter = "open" | "all";

/** Only open annotations (the default view). */
export function selectOpenAnnotations(
  annotations: Annotation[]
): Annotation[] {
  return annotations.filter((annotation) => annotation.status === "open");
}

/** Only completed annotations. */
export function selectCompletedAnnotations(
  annotations: Annotation[]
): Annotation[] {
  return annotations.filter(
    (annotation) => annotation.status === "completed"
  );
}

/**
 * The annotations visible in a given view: all in "all", open-only in
 * "open". Hidden annotations are NOT excluded here (hidden is applied
 * separately at render time, D-033 #11).
 */
export function selectVisibleAnnotations(
  annotations: Annotation[],
  viewFilter: ViewFilter
): Annotation[] {
  return viewFilter === "all"
    ? annotations
    : selectOpenAnnotations(annotations);
}

/** Launcher count: ALWAYS the open count, independent of the view. */
export function countOpenAnnotations(annotations: Annotation[]): number {
  return selectOpenAnnotations(annotations).length;
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
