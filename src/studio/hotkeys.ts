/**
 * Portal Studio — global hotkey definitions (single source of truth).
 *
 * Goal 02: five safe cross-platform shortcuts with typed definitions,
 * platform detection, label strings, and matching logic. Every consumer
 * (toolbar, tooltips, a11y text, event handling) reads from this module.
 */

/** Modifier keys per platform. */
const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPod|iPhone|iPad/.test(navigator.platform);

export const MODIFIER = {
  primary: isMac ? "Meta" : "Control",
  alt: "Alt",
  label: isMac ? "⌘⌥" : "Ctrl+Alt",
} as const;

/** A single hotkey definition. */
export type HotkeyAction =
  | "pick"
  | "multi"
  | "area"
  | "copy"
  | "visibility"
  | "list"
  | "help"
  | "toggle";

export type HotkeyDef = {
  action: HotkeyAction;
  /** The letter key (case-insensitive). */
  key: string;
  /** Platform-adjusted modifier label for tooltips. */
  shortcutLabel: string;
};

/**
 * The Studio shortcut table (one typed source of truth, Goal 01 v5).
 * Mod+Alt combos use `key` = the letter; the `?` help shortcut is matched
 * separately by `matchHelpShortcut` (Shift+/ produces `?` on US layouts
 * and `/` + shiftKey on some international layouts).
 */
export const HOTKEYS: HotkeyDef[] = [
  {
    action: "pick",
    key: "P",
    shortcutLabel: `${MODIFIER.label}+P`,
  },
  {
    action: "multi",
    key: "M",
    shortcutLabel: `${MODIFIER.label}+M`,
  },
  {
    action: "area",
    key: "A",
    shortcutLabel: `${MODIFIER.label}+A`,
  },
  {
    action: "copy",
    key: "C",
    shortcutLabel: `${MODIFIER.label}+C`,
  },
  {
    action: "visibility",
    key: "V",
    shortcutLabel: `${MODIFIER.label}+V`,
  },
  {
    action: "list",
    key: "L",
    shortcutLabel: `${MODIFIER.label}+L`,
  },
  {
    action: "help",
    key: "?",
    shortcutLabel: "?",
  },
  {
    action: "toggle",
    key: "K",
    shortcutLabel: `${MODIFIER.label}+K`,
  },
] as const;

/** Map action → full definition for O(1) lookup. */
const byAction = new Map<HotkeyAction, HotkeyDef>(
  HOTKEYS.map((h) => [h.action, h])
);

export const getHotkey = (action: HotkeyAction): HotkeyDef | undefined =>
  byAction.get(action);

// ---------------------------------------------------------------------------
// Matching logic
// ---------------------------------------------------------------------------

/** Keys that should never be intercepted by hotkeys. */
const EDITABLE_TAGNAMES = new Set([
  "INPUT",
  "TEXTAREA",
  "SELECT",
]);

/**
 * Returns true when any node in the given composed path (or, failing that,
 * the ancestor chain of the target) is an editable element where hotkeys
 * must not fire: <input>, <textarea>, <select>, [contenteditable], or any
 * node with an editor-like role.
 *
 * Round-3 finding 2: detection MUST inspect the composed path so editable
 * controls inside EITHER the Studio shadow root OR a foreign page shadow
 * root are recognized (a document-level listener retargets event.target to
 * the shadow HOST; only the composed path still contains the real node).
 */
const isEditableNode = (node: EventTarget | null): boolean => {
  if (!(node instanceof Element)) return false;
  if (EDITABLE_TAGNAMES.has(node.tagName)) return true;
  // Check isContentEditable property (works in browsers) and attribute
  // fallback for jsdom where the property may be undefined.
  if (node instanceof HTMLElement && node.isContentEditable) return true;
  const ce = node.getAttribute("contenteditable");
  if (ce !== null && ce !== "false") return true;
  const role = node.getAttribute("role");
  return role === "textbox" || role === "searchbox" || role === "combobox";
};

export function isEditableTarget(
  target: EventTarget | null,
  path?: readonly EventTarget[] | null
): boolean {
  if (path && path.length > 0) {
    for (const node of path) {
      if (isEditableNode(node)) return true;
    }
    return false;
  }
  if (!(target instanceof Element)) return false;
  // Fallback (no composed path available, e.g. synthetic jsdom events):
  // walk the ancestor chain from the target.
  let el: Element | null = target;
  while (el && el !== document.body) {
    if (isEditableNode(el)) return true;
    el = el.parentElement;
  }
  return false;
}

/**
 * Match a KeyboardEvent against the hotkey table.
 *
 * Safety guards:
 * - Editable targets (input/textarea/select/contenteditable) → no match.
 * - IME composition (event.isComposing) → no match.
 * - Repeat events (event.repeat) → no match.
 * - Only primary+alt modifiers must be held (no Shift, no extra modifiers).
 *
 * Returns the matched HotkeyDef or null.
 */
/**
 * Match the `?` shortcut-help key (Shift+/). Returns the help definition
 * when the event is the bare `?` (US layout) or `/` with shift held
 * (international layouts), with NO other modifiers, outside editable
 * targets, not composing and not a repeat.
 */
const eventComposedPath = (event: KeyboardEvent): readonly EventTarget[] | null => {
  try {
    return typeof event.composedPath === "function"
      ? event.composedPath()
      : null;
  } catch {
    return null;
  }
};

export function matchHelpShortcut(event: KeyboardEvent): HotkeyDef | null {
  if (isEditableTarget(event.target, eventComposedPath(event))) return null;
  if (event.isComposing) return null;
  if (event.repeat) return null;
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  const isQuestionMark =
    event.key === "?" || (event.code === "Slash" && event.shiftKey);
  if (!isQuestionMark) return null;
  const help = byAction.get("help");
  return help ?? null;
}

/**
 * Match a KeyboardEvent against the Mod+Alt hotkey table.
 *
 * Safety guards:
 * - Editable targets (input/textarea/select/contenteditable) → no match.
 * - IME composition (event.isComposing) → no match.
 * - Repeat events (event.repeat) → no match.
 * - Only primary+alt modifiers must be held (no Shift, no extra modifiers).
 *
 * Returns the matched HotkeyDef or null. The `?` help shortcut is handled
 * by matchHelpShortcut (callers should try it when this returns null).
 */
export function matchHotkey(event: KeyboardEvent): HotkeyDef | null {
  // Guard: editable target (composed-path aware, round-3 finding 2).
  if (isEditableTarget(event.target, eventComposedPath(event))) return null;
  // Guard: IME composition.
  if (event.isComposing) return null;
  // Guard: repeat events.
  if (event.repeat) return null;

  // Normalise: on non-Mac, Meta maps to Control for matching.
  const primaryHeld = isMac ? event.metaKey : event.ctrlKey;
  const altHeld = event.altKey;
  const ctrlHeld = isMac ? false : event.ctrlKey;

  // Only primary + alt must be held; no Shift, no extra modifiers.
  if (event.shiftKey) return null;
  if (isMac ? event.ctrlKey : event.metaKey) return null;
  if (!altHeld) return null;

  const letter = event.key.length === 1 ? event.key.toUpperCase() : null;
  if (!letter) return null;

  for (const def of HOTKEYS) {
    if (def.key === letter && (primaryHeld || ctrlHeld)) {
      return def;
    }
  }
  return null;
}

/**
 * Match either the Mod+Alt table or the `?` help key. Convenience used by
 * the toolbar's single global listener.
 */
export function matchStudioShortcut(
  event: KeyboardEvent
): HotkeyDef | null {
  return matchHotkey(event) ?? matchHelpShortcut(event);
}
