/**
 * Portal Studio — AnnotationEditorPopover (Goal 05 maintainability split).
 *
 * The marker-local annotation editor extracted from the toolbar shell: a
 * small, viewport-clamped dialog beside the marker. Events inside it are
 * stopped from leaking to the business page or capture handlers
 * (pointer/keyboard/hotkey isolation; the shadow host additionally keeps
 * it out of page listeners and screenshots).
 */
import type { RefObject } from "react";

import { MARKER_EDITOR_WIDTH } from "./markers.ts";
import { annotationDisplayNumber } from "./annotation-selectors.ts";
import type { LabelResolver } from "./studio-actions.ts";
import type { Annotation } from "./types.ts";

export type AnnotationEditorPopoverProps = {
  t: LabelResolver;
  /** The annotation being edited (undefined = closed). */
  annotation: Annotation;
  /** The FULL annotation list (stable display numbering). */
  annotations: Annotation[];
  anchor: { left: number; top: number } | undefined;
  surfaceRef?: RefObject<HTMLDivElement | null>;
  draft: string;
  onDraftChange: (value: string) => void;
  saving: boolean;
  error?: string | null;
  deleteConfirm: boolean;
  onDeleteConfirmChange: (value: boolean) => void;
  onSave: () => void;
  onComplete: () => void;
  onReopen: () => void;
  onDelete: () => void;
};

export function AnnotationEditorPopover({
  t,
  annotation,
  annotations,
  anchor,
  surfaceRef,
  draft,
  onDraftChange,
  saving,
  error,
  deleteConfirm,
  onDeleteConfirmChange,
  onSave,
  onComplete,
  onReopen,
  onDelete,
}: AnnotationEditorPopoverProps) {
  if (!anchor) return null;
  return (
    <div
      ref={surfaceRef}
      className="ps-marker-editor"
      role="dialog"
      aria-label={t("studio.editorTitle", "Annotation editor")}
      style={{
        left: anchor.left,
        top: anchor.top,
        width: MARKER_EDITOR_WIDTH,
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <p className="ps-label" id="ps-marker-editor-label">
        {t("studio.editorNumber", "Annotation {{number}}").replace(
          "{{number}}",
          String(
            annotationDisplayNumber(annotations, annotation.annotationId) ??
              "?"
          )
        )}{" "}·{" "}
        {t("studio.instruction", "Annotation comment")}
      </p>
      <textarea
        className="ps-textarea"
        rows={3}
        autoFocus
        aria-labelledby="ps-marker-editor-label"
        disabled={saving}
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            onSave();
          }
        }}
      />
      {error ? (
        <p className="ps-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="ps-actions">
        <button
          type="button"
          className="ps-button ps-primary"
          disabled={saving}
          onClick={onSave}
        >
          {saving
            ? t("studio.saving", "Saving task…")
            : t("studio.saveComment", "Save comment")}
        </button>
        {annotation.status === "completed" ? (
          <button
            type="button"
            className="ps-button"
            disabled={saving}
            onClick={onReopen}
          >
            {t("studio.reopen", "Reopen")}
          </button>
        ) : (
          <button
            type="button"
            className="ps-button"
            disabled={saving}
            onClick={onComplete}
          >
            {t("studio.completeAnnotation", "Complete")}
          </button>
        )}
        {deleteConfirm ? (
          <span className="ps-annotation-confirm" role="alert">
            {t("studio.confirmDelete", "Delete this annotation?")}{" "}
            <button
              type="button"
              className="ps-button ps-danger"
              disabled={saving}
              onClick={onDelete}
            >
              {t("studio.delete", "Delete")}
            </button>
            <button
              type="button"
              className="ps-button"
              disabled={saving}
              onClick={() => onDeleteConfirmChange(false)}
            >
              {t("studio.cancel", "Cancel")}
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="ps-button ps-danger"
            disabled={saving}
            onClick={() => onDeleteConfirmChange(true)}
          >
            {t("studio.deleteAnnotation", "Delete")}
          </button>
        )}
      </div>
    </div>
  );
}
