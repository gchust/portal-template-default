/**
 * Portal Studio — shortcut-help popover (Goal 01 v5).
 *
 * Anchored, non-modal popover opened by the penultimate feature action
 * (CircleHelp) or the `?` shortcut. Every row is generated from the typed
 * action registry — no independently hard-coded shortcut table. The parent
 * owns placement, Esc/outside-click/collapse/drag closing and focus
 * restore; this component renders only the panel body.
 */

import {
  STUDIO_ACTIONS,
  STUDIO_HELP_ORDER,
  type LabelResolver,
} from "./studio-actions";

export type StudioShortcutHelpProps = {
  t: LabelResolver;
  style: { left: number; top: number; width: number; maxHeight: number };
  /** Round-6 blocker 1: lets the toolbar measure the RENDERED height for
   *  genuine surface-height anchoring. */
  surfaceRef?: (node: HTMLDivElement | null) => void;
};

export function StudioShortcutHelp({ t, style, surfaceRef }: StudioShortcutHelpProps) {
  return (
    <div
      ref={surfaceRef}
      id="ps-shortcut-help"
      className="ps-help-popover"
      role="region"
      aria-label={t("studio.helpTitle", "Keyboard shortcuts")}
      style={style}
    >
      <p className="ps-label">
        {t("studio.helpTitle", "Keyboard shortcuts")}
      </p>
      <ul className="ps-help-list">
        {STUDIO_HELP_ORDER.map((id) => {
          const def = STUDIO_ACTIONS[id];
          return (
            <li key={id} className="ps-help-row">
              <span className="ps-help-action">
                {t(def.labelKey, def.fallbackLabel)}
              </span>
              <kbd className="ps-help-keycap">{def.shortcut.shortcutLabel}</kbd>
            </li>
          );
        })}
      </ul>
      <p className="ps-hint">
        {t(
          "studio.helpSafety",
          "Shortcuts are ignored while typing in inputs, textareas or other editable fields."
        )}
      </p>
    </div>
  );
}
