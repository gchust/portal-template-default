/**
 * Portal Studio — typed toolbar action registry (Goal 01 v5).
 *
 * Single source of truth for the horizontal toolbar: action ids, feature
 * order, i18n label keys (with fallbacks), tooltip copy and shortcuts.
 * Handlers read from this registry; the shortcut-help popover and every
 * tooltip are generated from it — no separately hard-coded tables.
 *
 * Review P4/P10: order arrays are DERIVED from the visual groups (no
 * redundant literal order lists), the help table includes the `?` action
 * itself, and shortcuts use a dedicated display type (no type escapes).
 */

import { getHotkey } from "./hotkeys";

export type StudioActionId =
  | "pick"
  | "multi"
  | "area"
  | "copy"
  | "visibility"
  | "help"
  | "list"
  | "toggle"
  /** Help-only rows (Esc cancellation); not a toolbar feature action. */
  | "escape";

/**
 * Display shortcut used by tooltips and the help popover. Deliberately
 * separate from the hotkey matcher type: registry rows only need the
 * human-facing keycap, never the matching engine.
 */
export type ShortcutDisplay = {
  /** The physical key / keycap text (e.g. "P", "?", "Esc"). */
  key: string;
  /** Platform-adjusted label (e.g. "⌘⌥P", "Ctrl+Alt+P", "?"). */
  shortcutLabel: string;
};

export type StudioActionDefinition = {
  id: StudioActionId;
  /** i18n key in the `starter` namespace (see src/locales/*). */
  labelKey: string;
  /** Fallback label when the locale entry is missing. */
  fallbackLabel: string;
  /** Display shortcut for tooltips/help (from the single hotkey module). */
  shortcut: ShortcutDisplay;
};

/** Resolve the display shortcut for an action (registry-owned). */
const shortcutFor = (action: StudioActionId): ShortcutDisplay => {
  if (action === "escape") {
    return {
      key: "Esc",
      shortcutLabel: "Esc",
    };
  }
  const def = getHotkey(action);
  if (!def) {
    throw new Error(`[portal-studio] missing shortcut for action ${action}`);
  }
  return {
    key: def.key,
    shortcutLabel: def.shortcutLabel,
  };
};

/** Every registry entry (feature actions + the help-only Esc row). */
export const STUDIO_ACTIONS: Record<StudioActionId, StudioActionDefinition> = {
  pick: {
    id: "pick",
    labelKey: "studio.pick",
    fallbackLabel: "Pick element",
    shortcut: shortcutFor("pick"),
  },
  multi: {
    id: "multi",
    labelKey: "studio.multiSelect",
    fallbackLabel: "Multi-select",
    shortcut: shortcutFor("multi"),
  },
  area: {
    id: "area",
    labelKey: "studio.selectRegion",
    fallbackLabel: "Select region",
    shortcut: shortcutFor("area"),
  },
  copy: {
    id: "copy",
    labelKey: "studio.copyAnnotations",
    fallbackLabel: "Copy annotations",
    shortcut: shortcutFor("copy"),
  },
  visibility: {
    id: "visibility",
    labelKey: "studio.visibilityHide",
    fallbackLabel: "Hide markers",
    shortcut: shortcutFor("visibility"),
  },
  help: {
    id: "help",
    labelKey: "studio.helpTitle",
    fallbackLabel: "Keyboard shortcuts",
    shortcut: shortcutFor("help"),
  },
  list: {
    id: "list",
    labelKey: "studio.listAction",
    fallbackLabel: "Annotation list",
    shortcut: shortcutFor("list"),
  },
  toggle: {
    id: "toggle",
    labelKey: "studio.collapseToolbar",
    fallbackLabel: "Collapse toolbar",
    shortcut: shortcutFor("toggle"),
  },
  escape: {
    id: "escape",
    labelKey: "studio.helpEsc",
    fallbackLabel: "Esc — cancel the current capture or popover",
    shortcut: shortcutFor("escape"),
  },
};

/**
 * Visual groups with their separators (divider before each group except
 * the first). Group order mirrors the shared contract §3.1.
 */
export const STUDIO_ACTION_GROUPS: StudioActionId[][] = [
  ["pick", "multi", "area"],
  ["copy", "visibility"],
  ["help", "list"],
];

/**
 * Normative feature-action order of the expanded horizontal toolbar:
 * capture (Pick, Multi, Area) → task/display (Copy, Visibility) →
 * support (Help, List). DERIVED from the visual groups so the two can
 * never drift apart. Collapse is separate toolbar chrome after a divider
 * and is NOT part of the feature order.
 */
export const STUDIO_ACTION_ORDER: StudioActionId[] =
  STUDIO_ACTION_GROUPS.flat();

/**
 * The actions listed in the shortcut-help popover, in table order:
 * every feature action (incl. Help and its own `?`), then the
 * expand/collapse toggle and the Esc cancellation row. Derived.
 */
export const STUDIO_HELP_ORDER: StudioActionId[] = [
  ...STUDIO_ACTION_ORDER,
  "toggle",
  "escape",
];

/** Localized-label resolver signature (matches the toolbar's `t`). */
export type LabelResolver = (key: string, fallback: string) => string;

/** Resolve an action's localized label through the registry. */
export const actionLabel = (
  t: LabelResolver,
  id: StudioActionId
): string => t(STUDIO_ACTIONS[id].labelKey, STUDIO_ACTIONS[id].fallbackLabel);

/** The platform-adjusted keycap of an action (e.g. "⌘⌥P", "?"). */
export const actionKeycap = (id: StudioActionId): string =>
  STUDIO_ACTIONS[id].shortcut.shortcutLabel;
