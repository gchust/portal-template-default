/**
 * Portal Studio — target-side annotation composer (Goal 02).
 *
 * The one small composer shown BESIDE the selected target, multi-target
 * group or region. It replaces the technical Draft/Saved/Done journey:
 * comment textarea + Save + Cancel, autofocus, plain Enter inserts a
 * newline, Ctrl/Cmd+Enter saves, Esc cancels, clicks/keys inside never
 * trigger capture, and the non-empty draft is never silently lost by
 * Help/List/collapse actions (the parent owns the draft state and this
 * surface only mirrors it).
 *
 * Placement is computed by the parent through the shared viewport-aware
 * anchored-layer helper; this component renders at the given position.
 */

import { useEffect, useRef, type CSSProperties } from "react";

import type { LabelResolver } from "./studio-actions";

export type StudioComposerProps = {
  t: LabelResolver;
  style: CSSProperties;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  /** True while the bounded async v6 capture pipeline is running. */
  inspecting?: boolean;
  /** Retry a failed inspection (keeps the comment and selection). */
  onRetry?: () => void;
  /** Inline save error (role=alert); the draft stays in the textarea. */
  error?: string | null;
  /** Round-6 style surface ref for genuine height anchoring. */
  surfaceRef?: (node: HTMLDivElement | null) => void;
};

export function StudioComposer({
  t,
  style,
  value,
  onChange,
  onSave,
  onCancel,
  saving,
  inspecting = false,
  onRetry,
  error,
  surfaceRef,
}: StudioComposerProps) {
  // Goal 02 P2: programmatic focus with preventScroll — the browser's
  // autoFocus path can scroll the page to reveal the focused element,
  // which drifts the anchored target rect AFTER the composer was placed
  // (the composer would then overlap the target). preventScroll keeps the
  // anchor exactly where the placement measured it.
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (saving) return;
    textareaRef.current?.focus({ preventScroll: true });
  }, [saving]);

  return (
    <div
      ref={surfaceRef}
      className="ps-composer"
      role="dialog"
      aria-label={t("studio.composerTitle", "Annotation")}
      style={style}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <textarea
        ref={textareaRef}
        className="ps-textarea ps-composer-textarea"
        rows={3}
        aria-label={t("studio.instruction", "Annotation comment")}
        placeholder={t(
          "studio.composerPlaceholder",
          "Describe the change… Ctrl+Enter saves."
        )}
        disabled={saving}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          // Plain Enter inserts a newline (default); Ctrl/Cmd+Enter saves.
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            if (!saving) onSave();
            return;
          }
          if (event.key === "Escape" && !saving) {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      {inspecting ? (
        <p className="ps-meta ps-composer-inspecting" role="status">
          {t("studio.inspecting", "Inspecting target…")}
        </p>
      ) : null}
      {error ? (
        <p className="ps-error ps-composer-error" role="alert">
          {error}
          {onRetry ? (
            <button
              type="button"
              className="ps-button ps-composer-retry"
              disabled={saving}
              onClick={onRetry}
            >
              {t("studio.retry", "Retry")}
            </button>
          ) : null}
        </p>
      ) : null}
      <div className="ps-actions ps-composer-actions">
        <button
          type="button"
          className="ps-button"
          disabled={saving}
          onClick={onCancel}
        >
          {t("studio.cancel", "Cancel")}
        </button>
        <button
          type="button"
          className="ps-button ps-primary"
          disabled={saving || inspecting}
          onClick={onSave}
        >
          {saving
            ? t("studio.saving", "Saving task…")
            : inspecting
              ? t("studio.inspecting", "Inspecting target…")
              : t("studio.save", "Save")}
        </button>
      </div>
    </div>
  );
}
