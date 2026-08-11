/**
 * Portal Studio — AnnotationMarkerLayer (Goal 05 maintainability split).
 *
 * The annotation-first marker overlay extracted from the toolbar shell:
 * numbered SEMANTIC BUTTON markers over resolved live targets; region
 * rects with dashed outlines carry a marker button at the top-right
 * corner; the temporary editor-open target highlight. Rendered INSIDE
 * the shadow host (D-034 #3 mounting rule) so markers never pollute
 * evidence screenshots and can never be annotated by Studio itself.
 * Unresolved targets stay in the list (grey chip) with no page anchor.
 */
import type { MutableRefObject } from "react";

import { annotationDisplayNumber } from "./annotation-selectors.ts";
import {
  resolveAnnotationTarget,
  resolveAnnotationTargets,
} from "./markers.ts";
import { annotationMatchesRoute } from "./route-context.ts";
import type { LabelResolver } from "./studio-actions.ts";
import type { Annotation } from "./types.ts";

export type AnnotationMarkerLayerProps = {
  t: LabelResolver;
  /** The FULL annotation list (stable display numbering). */
  annotations: Annotation[];
  /** Annotations of the current view (the layer maps over them). */
  visibleAnnotations: Annotation[];
  markersVisible: boolean;
  editorAnnotationId: string | null;
  editorSaving: boolean;
  markerButtonRefs: MutableRefObject<Map<string, HTMLButtonElement>>;
  /** Open the marker editor for an annotation. */
  onOpenEditor: (annotation: Annotation) => void;
  /** Close the marker editor. */
  onCloseEditor: () => void;
};

const rectStyle = (rect: DOMRect | undefined): React.CSSProperties => {
  if (!rect) return { display: "none" };
  return {
    display: "block",
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
};

/** Goal 03 D: document-aware region anchor (region + captured scroll −
 *  current scroll). */
const regionStyleScrolled = (
  region: { x: number; y: number; width: number; height: number } | undefined,
  scroll: { x: number; y: number } | undefined
): React.CSSProperties => {
  if (!region) return { display: "none" };
  const left = scroll ? region.x + scroll.x - window.scrollX : region.x;
  const top = scroll ? region.y + scroll.y - window.scrollY : region.y;
  return {
    display: "block",
    left,
    top,
    width: region.width,
    height: region.height,
  };
};

export function AnnotationMarkerLayer({
  t,
  annotations,
  visibleAnnotations,
  markersVisible,
  editorAnnotationId,
  editorSaving,
  markerButtonRefs,
  onOpenEditor,
  onCloseEditor,
}: AnnotationMarkerLayerProps) {
  const editorAnnotation =
    visibleAnnotations.find(
      (annotation) => annotation.annotationId === editorAnnotationId
    ) ?? null;
  return (
    <>
      {visibleAnnotations.map((annotation) => {
        if (!markersVisible || annotation.hidden === true) return null;
        // Goal 06: markers only render when the annotation's routeKey
        // matches the current route (legacy annotations without pageContext
        // always render).
        if (!annotationMatchesRoute(annotation)) return null;
        // Review P2: marker numbers are STABLE across Open/All filtering —
        // always derived from the FULL annotations list so they match the
        // list chips in every view.
        const number = annotationDisplayNumber(
          annotations,
          annotation.annotationId
        );
        const completed = annotation.status === "completed";
        const chipClass = completed
          ? "ps-marker-chip ps-marker-chip-onpage ps-marker-chip-button ps-marker-chip-completed"
          : "ps-marker-chip ps-marker-chip-onpage ps-marker-chip-button";
        const markerLabel = t(
          "studio.marker.openEditor",
          "Annotation {{number}}: open editor"
        ).replace("{{number}}", String(number ?? "?"));
        const markerRef = (node: HTMLButtonElement | null) => {
          if (node) {
            markerButtonRefs.current.set(annotation.annotationId, node);
          } else {
            markerButtonRefs.current.delete(annotation.annotationId);
          }
        };
        const markerOnClick = () => {
          // Save-in-flight lock (review): a marker click can neither close
          // nor switch the editor while a save POST is pending, so a late
          // success/failure stays attached to the ORIGINAL editor+draft.
          if (editorSaving) return;
          if (editorAnnotationId === annotation.annotationId) {
            onCloseEditor();
            return;
          }
          onOpenEditor(annotation);
        };
        if (annotation.kind === "region" && annotation.region) {
          return (
            <div
              key={annotation.annotationId}
              className="ps-outline ps-region"
              style={regionStyleScrolled(
                annotation.region,
                annotation.pageContext?.scroll
              )}
            >
              <button
                type="button"
                ref={markerRef}
                className={`${chipClass} ps-marker-region-chip`}
                style={{ position: "absolute", top: 4, right: 4 }}
                aria-label={markerLabel}
                onClick={markerOnClick}
              >
                {number ?? "?"}
              </button>
            </div>
          );
        }
        const target = resolveAnnotationTarget(annotation);
        if (!target) return null;
        const rect = target.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return null;
        return (
          <div
            key={annotation.annotationId}
            className="ps-marker-anchor"
            style={{
              left: rect.left - 6,
              top: rect.top - 6,
            }}
          >
            <button
              type="button"
              ref={markerRef}
              className={chipClass}
              aria-label={markerLabel}
              onClick={markerOnClick}
            >
              {number ?? "?"}
            </button>
          </div>
        );
      })}

      {/* Goal 03: temporary target highlight while the editor is open —
          every resolved captured target is outlined (one outline for an
          element, all members for a multi group); regions render their
          own boundary. Also covers the list-item click highlight. */}
      {editorAnnotation && editorAnnotation.kind !== "region"
        ? resolveAnnotationTargets(editorAnnotation).map((target, index) => {
            const rect = target.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return null;
            return (
              <div
                key={`${editorAnnotation.annotationId}-hl-${index}`}
                className="ps-outline ps-selected ps-marker-highlight"
                style={rectStyle(rect)}
                aria-hidden="true"
              />
            );
          })
        : null}
    </>
  );
}
