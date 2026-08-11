/**
 * Portal Studio — useStudioHotkeys (Goal 05 maintainability split).
 *
 * The global Studio hotkey listener, extracted from the toolbar shell.
 * Every registered action (Pick/Multi/Area/Copy/V/L/K/?) works from
 * focused NON-editable Studio controls, including while the toolbar is
 * collapsed; the contract disables shortcuts only for editable controls,
 * IME/repeat/extra modifiers (enforced in hotkeys.ts via the
 * composed-path-aware editable guard).
 */
import { useEffect, useRef, type RefObject } from "react";

import { matchStudioShortcut } from "./hotkeys.ts";

export type StudioHotkeyActions = {
  toggle: () => void;
  copy: () => void;
  visibility: () => void;
  list: () => void;
  help: () => void;
  pick: () => void;
  multi: () => void;
  area: () => void;
};

/**
 * Register the document-level capture hotkey listener ONCE (mount).
 * `openCountRef` gates Copy at zero Open annotations like the button;
 * `savingRef` gates capture-mode hotkeys while a save is pending (strict
 * serial saving).
 */
export function useStudioHotkeys(
  actions: StudioHotkeyActions,
  gates: {
    openCountRef: RefObject<number>;
    savingRef: RefObject<boolean>;
  }
): void {
  const { openCountRef, savingRef } = gates;
  // Keep the actions callable from the mount-once listener without
  // re-registering on every render.
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(() => {
    const handleHotkey = (event: KeyboardEvent) => {
      const matched = matchStudioShortcut(event);
      if (!matched) return;
      event.preventDefault();
      event.stopPropagation();

      const action = matched.action;

      // Toggle: open/close the dock (collapsing also dismisses any open
      // auxiliary panel — presentation only).
      if (action === "toggle") {
        actionsRef.current.toggle();
        return;
      }

      // Copy: expand first (contract: a shortcut invoked while collapsed
      // expands the toolbar and runs the requested action); disabled at
      // zero Open annotations like the toolbar button.
      if (action === "copy") {
        if (openCountRef.current === 0) return;
        actionsRef.current.copy();
        return;
      }

      // Marker visibility: presentation-only toggle.
      if (action === "visibility") {
        actionsRef.current.visibility();
        return;
      }

      // Annotation list / shortcut help: expand and open (toggle closed
      // when the same panel is already open).
      if (action === "list") {
        actionsRef.current.list();
        return;
      }
      if (action === "help") {
        actionsRef.current.help();
        return;
      }

      // Capture actions (pick/multi/area): expand first if collapsed,
      // dismiss any auxiliary panel, then safely exit the previous
      // capture and enter the new mode. Strict serial saving: the
      // corresponding global hotkeys are IGNORED while a save is pending.
      if (
        savingRef.current &&
        (action === "pick" || action === "multi" || action === "area")
      ) {
        return;
      }
      if (action === "pick") {
        actionsRef.current.pick();
      } else if (action === "multi") {
        actionsRef.current.multi();
      } else if (action === "area") {
        actionsRef.current.area();
      }
    };

    document.addEventListener("keydown", handleHotkey, true);
    return () => document.removeEventListener("keydown", handleHotkey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
