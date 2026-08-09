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
  | "toggle";

export type HotkeyDef = {
  action: HotkeyAction;
  /** The letter key (case-insensitive). */
  key: string;
  /** Platform-adjusted modifier label for tooltips. */
  shortcutLabel: string;
  /** Accessible description. */
  description: string;
};

/**
 * All five shortcuts. The `key` field is the physical key; matching uses
 * event.key.toUpperCase() after normalising Meta→Control on non-Mac.
 */
export const HOTKEYS: HotkeyDef[] = [
  {
    action: "pick",
    key: "P",
    shortcutLabel: `${MODIFIER.label}+P`,
    description: "Pick element",
  },
  {
    action: "multi",
    key: "M",
    shortcutLabel: `${MODIFIER.label}+M`,
    description: "Multi-select",
  },
  {
    action: "area",
    key: "A",
    shortcutLabel: `${MODIFIER.label}+A`,
    description: "Select region",
  },
  {
    action: "copy",
    key: "C",
    shortcutLabel: `${MODIFIER.label}+C`,
    description: "Copy annotations",
  },
  {
    action: "toggle",
    key: "K",
    shortcutLabel: `${MODIFIER.label}+K`,
    description: "Toggle dock",
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
 * Returns true when the event target is an editable element where hotkeys
 * must not fire: <input>, <textarea>, <select>, [contenteditable], or any
 * ancestor with an editor-like role.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  // Walk up to check contenteditable and editor roles.
  let el: Element | null = target;
  while (el && el !== document.body) {
    if (EDITABLE_TAGNAMES.has(el.tagName)) return true;
    // Check isContentEditable property (works in browsers) and attribute
    // fallback for jsdom where the property may be undefined.
    if (el instanceof HTMLElement && el.isContentEditable) return true;
    const ce = el.getAttribute("contenteditable");
    if (ce !== null && ce !== "false") return true;
    const role = el.getAttribute("role");
    if (role === "textbox" || role === "searchbox" || role === "combobox") {
      return true;
    }
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
export function matchHotkey(event: KeyboardEvent): HotkeyDef | null {
  // Guard: editable target.
  if (isEditableTarget(event.target)) return null;
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
