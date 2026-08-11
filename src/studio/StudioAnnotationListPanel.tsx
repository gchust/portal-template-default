/**
 * Portal Studio — annotation-list panel (Goal 01 v5).
 *
 * The final feature action (ListChecks) opens this anchored panel. It
 * REUSES the existing annotation source of truth (the task's annotations
 * plus the shared typed mutation path) — there is no second list or task
 * store. The parent owns placement and the marker editor; this component
 * renders the panel body: title + open/total counts, Open/All filter
 * (default Open), items with stable display numbers, status/unresolved
 * info, inline edit/complete/reopen/hide/delete actions, item selection
 * (opens the marker editor when resolvable), and the low-emphasis
 * Remove-completed footer.
 */

import type { MutableRefObject } from "react";

import {
  CheckCircle2,
  Eye,
  EyeOff,
  Pencil,
  RotateCcw,
  Trash2,
} from "lucide-react";

import type { Annotation } from "./types";
import {
  annotationDisplayNumber,
  countOpenAnnotations,
  selectCompletedAnnotations,
  selectVisibleAnnotations,
  type ViewFilter,
} from "./task-model";
import { isAnnotationUnresolved } from "./markers";
import type { LabelResolver } from "./studio-actions";

export type StudioAnnotationListPanelProps = {
  t: LabelResolver;
  style: { left: number; top: number; width: number; maxHeight: number };
  /** The FULL annotation list (open/total counts derive from it). */
  annotations: Annotation[];
  viewFilter: ViewFilter;
  onViewFilterChange: (filter: ViewFilter) => void;
  editingId: string | null;
  editValue: string;
  onEditStart: (annotation: Annotation) => void;
  onEditChange: (value: string) => void;
  onEditSave: () => void;
  confirmDeleteId: string | null;
  onConfirmDelete: (annotationId: string) => void;
  onCancelDelete: () => void;
  removeCompletedConfirm: boolean;
  onToggleRemoveCompleted: () => void;
  onCancelRemoveCompleted: () => void;
  onRemoveCompleted: () => void;
  onComplete: (annotationId: string) => void;
  onReopen: (annotationId: string) => void;
  onHideToggle: (annotationId: string) => void;
  onDelete: (annotationId: string) => void;
  /** Item body click: scroll/highlight + open the marker editor. */
  onItemSelect: (annotation: Annotation) => void;
  /** Disables list mutation controls while a marker save is in flight. */
  editorSaving: boolean;
  /** Round-3 finding 3: id-keyed focus-return refs — Esc restores focus
   *  to the EXACT row/trigger that opened a transient surface. */
  deleteButtonRefs: MutableRefObject<Map<string, HTMLButtonElement>>;
  editButtonRefs: MutableRefObject<Map<string, HTMLButtonElement>>;
  removeCompletedTriggerRef: MutableRefObject<HTMLButtonElement | null>;
  /** Mutation/save error to surface while the panel is open (role=alert). */
  error?: string | null;
  /** Round-6 blocker 1: lets the toolbar measure the RENDERED height for
   *  genuine surface-height anchoring. */
  surfaceRef?: (node: HTMLDivElement | null) => void;
};

/** Secondary line: route/page context or the first target selector. */
const annotationSecondary = (annotation: Annotation): string => {
  const page = annotation.pageContext;
  if (page?.routeKey) return page.routeKey;
  if (page?.url) return page.url;
  for (const element of annotation.elements) {
    if (element.selector) return element.selector;
  }
  return "";
};

export function StudioAnnotationListPanel({
  t,
  style,
  annotations,
  viewFilter,
  onViewFilterChange,
  editingId,
  editValue,
  onEditStart,
  onEditChange,
  onEditSave,
  confirmDeleteId,
  onConfirmDelete,
  onCancelDelete,
  removeCompletedConfirm,
  onToggleRemoveCompleted,
  onCancelRemoveCompleted,
  onRemoveCompleted,
  onComplete,
  onReopen,
  onHideToggle,
  onDelete,
  onItemSelect,
  editorSaving,
  deleteButtonRefs,
  editButtonRefs,
  removeCompletedTriggerRef,
  error,
  surfaceRef,
}: StudioAnnotationListPanelProps) {
  const openCount = countOpenAnnotations(annotations);
  const completedCount = selectCompletedAnnotations(annotations).length;
  const visibleAnnotations = selectVisibleAnnotations(annotations, viewFilter);

  return (
    <div
      ref={surfaceRef}
      id="ps-annotation-list"
      className="ps-list-panel"
      role="region"
      aria-label={t("studio.listTitle", "Annotations")}
      style={style}
    >
      {error ? (
        <p className="ps-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="ps-list-header">
        <p className="ps-label">
          {t("studio.listTitle", "Annotations")}{" "}
          <span className="ps-list-counts">
            {t("studio.listCounts", "{{open}} open · {{total}} total")
              .replace("{{open}}", String(openCount))
              .replace("{{total}}", String(annotations.length))}
          </span>
        </p>
        <div className="ps-list-filters" role="group" aria-label={t("studio.viewFilter", "View")}>
          <button
            type="button"
            className="ps-button ps-view-toggle"
            aria-pressed={viewFilter === "open"}
            onClick={() => onViewFilterChange("open")}
          >
            {t("studio.viewOpen", "Open")}
          </button>
          <button
            type="button"
            className="ps-button ps-view-toggle"
            aria-pressed={viewFilter === "all"}
            onClick={() => onViewFilterChange("all")}
          >
            {t("studio.viewAll", "All")}
          </button>
        </div>
      </div>

      {visibleAnnotations.length > 0 ? (
        <ul className="ps-annotation-list">
          {visibleAnnotations.map((annotation) => {
            // Review P2: numbers are STABLE across Open/All filtering —
            // always derived from the FULL annotations list.
            const number = annotationDisplayNumber(
              annotations,
              annotation.annotationId
            );
            const unresolved = isAnnotationUnresolved(annotation);
            const hidden = annotation.hidden === true;
            const completed = annotation.status === "completed";
            const editing = editingId === annotation.annotationId;
            const confirming = confirmDeleteId === annotation.annotationId;
            const dirty = editing && editValue !== annotation.comment;
            const secondary = annotationSecondary(annotation);
            return (
              <li
                key={annotation.annotationId}
                className={
                  hidden
                    ? "ps-annotation-item ps-annotation-item-hidden"
                    : completed
                      ? "ps-annotation-item ps-annotation-item-completed"
                      : "ps-annotation-item"
                }
                onClick={() => {
                  // Item-body selection opens the marker editor; action
                  // buttons stop propagation so their clicks never select.
                  // Review P8: unresolved items have no resolvable anchor —
                  // selecting them would create an invisible editor state,
                  // so selection is inert for them (edit/complete/reopen/
                  // delete stay available).
                  if (unresolved) return;
                  onItemSelect(annotation);
                }}
              >
                <span
                  className={
                    completed
                      ? "ps-marker-chip ps-marker-chip-completed"
                      : "ps-marker-chip"
                  }
                >
                  {number ?? "?"}
                </span>
                <span className="ps-annotation-body">
                  {editing ? (
                    <textarea
                      className="ps-textarea ps-annotation-edit"
                      rows={2}
                      autoFocus
                      disabled={editorSaving}
                      value={editValue}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => onEditChange(event.target.value)}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        // D-034 #1: Enter = newline, Ctrl/Cmd+Enter = save.
                        if (
                          event.key === "Enter" &&
                          (event.ctrlKey || event.metaKey)
                        ) {
                          event.preventDefault();
                          onEditSave();
                        }
                      }}
                    />
                  ) : unresolved ? (
                    <span className="ps-annotation-comment">
                      {annotation.comment.slice(0, 120) ||
                        t("studio.emptyComment", "(empty)")}
                    </span>
                  ) : (
                    <span
                      className="ps-annotation-comment"
                      role="button"
                      tabIndex={0}
                      aria-label={t(
                        "studio.listSelect",
                        "Annotation {{number}}: select"
                      ).replace("{{number}}", String(number ?? "?"))}
                      onClick={(event) => {
                        event.stopPropagation();
                        onItemSelect(annotation);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          event.stopPropagation();
                          onItemSelect(annotation);
                        }
                      }}
                    >
                      {annotation.comment.slice(0, 120) ||
                        t("studio.emptyComment", "(empty)")}
                    </span>
                  )}
                  {secondary ? (
                    <span className="ps-meta ps-annotation-secondary">
                      {secondary}
                    </span>
                  ) : null}
                  {dirty ? (
                    <span className="ps-unresolved">
                      {t("studio.unsaved", "Unsaved")}
                    </span>
                  ) : null}
                  {unresolved ? (
                    <span className="ps-unresolved">
                      {t("studio.unresolved", "Target not found")}
                    </span>
                  ) : null}
                  {completed ? (
                    <span className="ps-completed-label">
                      {t("studio.completed", "Completed")}
                    </span>
                  ) : null}
                  {hidden ? (
                    <span className="ps-unresolved">
                      {t("studio.hidden", "Hidden")}
                    </span>
                  ) : null}
                  {confirming ? (
                    <span className="ps-annotation-confirm" role="alert">
                      {t("studio.confirmDelete", "Delete this annotation?")}
                      <button
                        type="button"
                        className="ps-button ps-danger"
                        disabled={editorSaving}
                        onClick={(event) => {
                          event.stopPropagation();
                          onDelete(annotation.annotationId);
                        }}
                      >
                        {t("studio.delete", "Delete")}
                      </button>
                      <button
                        type="button"
                        className="ps-button"
                        disabled={editorSaving}
                        onClick={(event) => {
                          event.stopPropagation();
                          onCancelDelete();
                        }}
                      >
                        {t("studio.cancel", "Cancel")}
                      </button>
                    </span>
                  ) : null}
                  {!confirming ? (
                    <span
                      className="ps-annotation-actions"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <button
                        type="button"
                        className="ps-icon-button"
                        aria-label={t("studio.editAnnotation", "Edit comment")}
                        disabled={editorSaving}
                        ref={(node) => {
                          // Round-3 finding 3: id-keyed — inline-edit Esc
                          // returns focus to THIS row's Edit trigger.
                          if (node) {
                            editButtonRefs.current.set(
                              annotation.annotationId,
                              node
                            );
                          } else {
                            editButtonRefs.current.delete(
                              annotation.annotationId
                            );
                          }
                        }}
                        onClick={() => onEditStart(annotation)}
                      >
                        <Pencil size={12} aria-hidden="true" />
                      </button>
                      {completed ? (
                        <button
                          type="button"
                          className="ps-icon-button"
                          aria-label={t("studio.reopen", "Reopen")}
                          disabled={editorSaving}
                          onClick={() => onReopen(annotation.annotationId)}
                        >
                          <RotateCcw size={12} aria-hidden="true" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="ps-icon-button"
                          aria-label={t(
                            "studio.completeAnnotation",
                            "Complete"
                          )}
                          aria-pressed={completed}
                          disabled={editorSaving}
                          onClick={() => onComplete(annotation.annotationId)}
                        >
                          <CheckCircle2 size={12} aria-hidden="true" />
                        </button>
                      )}
                      <button
                        type="button"
                        className="ps-icon-button"
                        aria-label={t("studio.hideAnnotation", "Hide")}
                        aria-pressed={hidden}
                        disabled={editorSaving}
                        onClick={() => onHideToggle(annotation.annotationId)}
                      >
                        {hidden ? (
                          <EyeOff size={12} aria-hidden="true" />
                        ) : (
                          <Eye size={12} aria-hidden="true" />
                        )}
                      </button>
                      <button
                        type="button"
                        className="ps-icon-button"
                        aria-label={t("studio.deleteAnnotation", "Delete")}
                        disabled={editorSaving}
                        ref={(node) => {
                          // Round-3 finding 3: register by ANNOTATION ID so
                          // Esc returns focus to the exact row that opened
                          // the confirmation (re-mounted buttons re-arm).
                          if (node) {
                            deleteButtonRefs.current.set(
                              annotation.annotationId,
                              node
                            );
                          } else {
                            deleteButtonRefs.current.delete(
                              annotation.annotationId
                            );
                          }
                        }}
                        onClick={() => onConfirmDelete(annotation.annotationId)}
                      >
                        <Trash2 size={12} aria-hidden="true" />
                      </button>
                    </span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      {visibleAnnotations.length === 0 && annotations.length > 0 ? (
        <p className="ps-hint" role="status">
          {t("studio.emptyOpenList", "No open annotations.")}
        </p>
      ) : null}
      {annotations.length === 0 ? (
        <p className="ps-hint" role="status">
          {t("studio.emptyAllList", "No annotations yet.")}
        </p>
      ) : null}

      {completedCount > 0 ? (
        <div className="ps-list-footer">
          {removeCompletedConfirm ? (
            <span className="ps-annotation-confirm" role="alert">
              {t(
                "studio.confirmRemoveCompleted",
                "Remove {{count}} completed annotation(s)? Open items stay."
              ).replace("{{count}}", String(completedCount))}{" "}
              <button
                type="button"
                className="ps-button ps-danger"
                disabled={editorSaving}
                onClick={onRemoveCompleted}
              >
                {t("studio.remove", "Remove")}
              </button>
              <button
                type="button"
                className="ps-button"
                disabled={editorSaving}
                onClick={onCancelRemoveCompleted}
              >
                {t("studio.cancel", "Cancel")}
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="ps-remove-completed"
              disabled={completedCount === 0}
              ref={removeCompletedTriggerRef}
              onClick={onToggleRemoveCompleted}
            >
              {t("studio.removeCompleted", "Remove completed ({{count}})").replace(
                "{{count}}",
                String(completedCount)
              )}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
