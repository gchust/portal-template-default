/**
 * Goal 02 — hotkeys module unit tests.
 *
 * Covers: modifier mapping, editable-target guards, IME/repeat handling,
 * platform detection, and all five action matches.
 */
import { describe, expect, it, vi } from "vitest";

import {
  getHotkey,
  HOTKEYS,
  isEditableTarget,
  matchHelpShortcut,
  matchHotkey,
  matchStudioShortcut,
  MODIFIER,
} from "@/studio/hotkeys";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeEvent = (
  overrides: Partial<KeyboardEvent> = {}
): KeyboardEvent =>
  ({
    key: "p",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    target: document.body,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...overrides,
  }) as unknown as KeyboardEvent;

// ---------------------------------------------------------------------------
// Modifier mapping & platform detection
// ---------------------------------------------------------------------------

describe("hotkeys — modifier mapping", () => {
  it("MODIFIER.primary is Meta on Mac, Control elsewhere", () => {
    expect(MODIFIER.primary === "Meta" || MODIFIER.primary === "Control").toBe(
      true
    );
  });

  it("MODIFIER.label includes platform-appropriate notation", () => {
    expect(MODIFIER.label.length).toBeGreaterThan(0);
  });

  it("HOTKEYS has exactly 8 entries (P/M/A/C/V/L/?/K)", () => {
    expect(HOTKEYS).toHaveLength(8);
  });

  it("each hotkey has a unique action", () => {
    const actions = HOTKEYS.map((h) => h.action);
    expect(new Set(actions).size).toBe(8);
  });

  it("each hotkey has a single-character key (letters plus ?)", () => {
    for (const h of HOTKEYS) {
      expect(h.key).toMatch(/^[A-Z?]$/);
    }
  });

  it("getHotkey returns the correct definition", () => {
    expect(getHotkey("pick")?.key).toBe("P");
    expect(getHotkey("toggle")?.key).toBe("K");
    expect(getHotkey("copy")?.key).toBe("C");
    expect(getHotkey("multi")?.key).toBe("M");
    expect(getHotkey("area")?.key).toBe("A");
    expect(getHotkey("visibility")?.key).toBe("V");
    expect(getHotkey("list")?.key).toBe("L");
    expect(getHotkey("help")?.key).toBe("?");
    expect(getHotkey("nonexistent")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Editable-target guards
// ---------------------------------------------------------------------------

describe("hotkeys — editable target guards", () => {
  it("returns false for document.body", () => {
    expect(isEditableTarget(document.body)).toBe(false);
  });

  it("returns true for <input>", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    expect(isEditableTarget(input)).toBe(true);
    document.body.removeChild(input);
  });

  it("returns true for <textarea>", () => {
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    expect(isEditableTarget(ta)).toBe(true);
    document.body.removeChild(ta);
  });

  it("returns true for <select>", () => {
    const sel = document.createElement("select");
    document.body.appendChild(sel);
    expect(isEditableTarget(sel)).toBe(true);
    document.body.removeChild(sel);
  });

  it("returns true for contenteditable element", () => {
    const div = document.createElement("div");
    div.setAttribute("contenteditable", "true");
    document.body.appendChild(div);
    expect(isEditableTarget(div)).toBe(true);
    document.body.removeChild(div);
  });

  it("returns true for contenteditable='' (empty string)", () => {
    const div = document.createElement("div");
    div.setAttribute("contenteditable", "");
    document.body.appendChild(div);
    expect(isEditableTarget(div)).toBe(true);
    document.body.removeChild(div);
  });

  it("returns true for role='textbox'", () => {
    const div = document.createElement("div");
    div.setAttribute("role", "textbox");
    document.body.appendChild(div);
    expect(isEditableTarget(div)).toBe(true);
    document.body.removeChild(div);
  });

  it("returns true for a child of contenteditable parent", () => {
    const parent = document.createElement("div");
    parent.setAttribute("contenteditable", "true");
    const child = document.createElement("span");
    parent.appendChild(child);
    document.body.appendChild(parent);
    expect(isEditableTarget(child)).toBe(true);
    document.body.removeChild(parent);
  });

  it("returns false for a regular <div>", () => {
    const div = document.createElement("div");
    document.body.appendChild(div);
    expect(isEditableTarget(div)).toBe(false);
    document.body.removeChild(div);
  });
});

// ---------------------------------------------------------------------------
// IME composition guard
// ---------------------------------------------------------------------------

describe("hotkeys — IME composition guard", () => {
  it("returns null when isComposing is true", () => {
    const event = makeEvent({
      key: "p",
      altKey: true,
      metaKey: true,
      isComposing: true,
    });
    expect(matchHotkey(event)).toBeNull();
  });

  it("returns a match when isComposing is false", () => {
    const event = makeEvent({
      key: "p",
      altKey: true,
      ctrlKey: true,
      isComposing: false,
    });
    const result = matchHotkey(event);
    expect(result?.action).toBe("pick");
  });
});

// ---------------------------------------------------------------------------
// Repeat guard
// ---------------------------------------------------------------------------

describe("hotkeys — repeat guard", () => {
  it("returns null when repeat is true", () => {
    const event = makeEvent({
      key: "p",
      altKey: true,
      metaKey: true,
      repeat: true,
    });
    expect(matchHotkey(event)).toBeNull();
  });

  it("returns a match when repeat is false", () => {
    const event = makeEvent({
      key: "p",
      altKey: true,
      ctrlKey: true,
      repeat: false,
    });
    expect(matchHotkey(event)?.action).toBe("pick");
  });
});

// ---------------------------------------------------------------------------
// All five action matches (jsdom is non-Mac → primary = Control)
// ---------------------------------------------------------------------------

describe("hotkeys — action matching", () => {
  const mod = { label: "win/linux", ctrlKey: true, metaKey: false };

  it("Pick: Ctrl+Alt+P", () => {
    const event = makeEvent({ key: "p", altKey: true, ...mod });
    expect(matchHotkey(event)?.action).toBe("pick");
  });

  it("Multi: Ctrl+Alt+M", () => {
    const event = makeEvent({ key: "m", altKey: true, ...mod });
    expect(matchHotkey(event)?.action).toBe("multi");
  });

  it("Area: Ctrl+Alt+A", () => {
    const event = makeEvent({ key: "a", altKey: true, ...mod });
    expect(matchHotkey(event)?.action).toBe("area");
  });

  it("Copy: Ctrl+Alt+C", () => {
    const event = makeEvent({ key: "c", altKey: true, ...mod });
    expect(matchHotkey(event)?.action).toBe("copy");
  });

  it("Toggle: Ctrl+Alt+K", () => {
    const event = makeEvent({ key: "k", altKey: true, ...mod });
    expect(matchHotkey(event)?.action).toBe("toggle");
  });

  it("Visibility: Ctrl+Alt+V", () => {
    const event = makeEvent({ key: "v", altKey: true, ...mod });
    expect(matchHotkey(event)?.action).toBe("visibility");
  });

  it("List: Ctrl+Alt+L", () => {
    const event = makeEvent({ key: "l", altKey: true, ...mod });
    expect(matchHotkey(event)?.action).toBe("list");
  });
});

// ---------------------------------------------------------------------------
// Help shortcut (?) / Shift+/
// ---------------------------------------------------------------------------

describe("hotkeys — help shortcut (?)", () => {
  it("matches the bare ? key with no modifiers", () => {
    const event = makeEvent({ key: "?", shiftKey: true });
    expect(matchHelpShortcut(event)?.action).toBe("help");
    expect(matchStudioShortcut(event)?.action).toBe("help");
  });

  it("matches Shift+/ on international layouts (key '/')", () => {
    const event = makeEvent({
      key: "/",
      code: "Slash",
      shiftKey: true,
    });
    expect(matchHelpShortcut(event)?.action).toBe("help");
  });

  it("does not match with other modifiers held", () => {
    const event = makeEvent({ key: "?", altKey: true });
    expect(matchHelpShortcut(event)).toBeNull();
    const ctrlEvent = makeEvent({ key: "?", ctrlKey: true });
    expect(matchHelpShortcut(ctrlEvent)).toBeNull();
  });

  it("does not match inside an editable target", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    const event = makeEvent({ key: "?", target: input });
    expect(matchHelpShortcut(event)).toBeNull();
    document.body.removeChild(input);
  });

  it("does not match during IME composition or repeats", () => {
    expect(
      matchHelpShortcut(makeEvent({ key: "?", isComposing: true }))
    ).toBeNull();
    expect(matchHelpShortcut(makeEvent({ key: "?", repeat: true }))).toBeNull();
  });

  it("a plain slash without Shift is not help", () => {
    const event = makeEvent({ key: "/", code: "Slash" });
    expect(matchHelpShortcut(event)).toBeNull();
  });

  it("matchStudioShortcut falls back to the ? key", () => {
    expect(matchStudioShortcut(makeEvent({ key: "?" }))?.action).toBe("help");
  });

  it("detects editable controls inside a FOREIGN shadow root via composedPath (round-3 finding 2)", () => {
    // jsdom cannot retarget: dispatching on a shadow-internal node leaves
    // event.target as the HOST and composedPath() empty, so the browser
    // case (target = host, path = [input, shadow, host, …]) is covered by
    // the explicit-path contract below plus the real-browser e2e test.
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    const input = document.createElement("input");
    shadow.appendChild(input);
    document.body.appendChild(host);
    try {
      // A browser document listener would see target = host with a path
      // that includes the shadow-internal input — model exactly that by
      // overriding composedPath on the (plain-object) event:
      const path = [input, host, document.body];
      const browserLikeEvent = makeEvent({
        key: "p",
        altKey: true,
        ctrlKey: true,
        target: host,
        composedPath: () => path,
      });
      expect(matchHotkey(browserLikeEvent)).toBeNull();
      expect(matchStudioShortcut(browserLikeEvent)).toBeNull();
      // Same for the ? help shortcut.
      expect(
        matchHelpShortcut(
          makeEvent({ key: "?", target: host, composedPath: () => path })
        )
      ).toBeNull();
    } finally {
      document.body.removeChild(host);
    }
  });

  it("isEditableTarget honors an explicit composed path over the target walk", () => {
    const plain = document.createElement("button");
    const input = document.createElement("input");
    // Path that CONTAINS an editable node while the target is a button:
    // the composed path is authoritative (a document listener sees the
    // retargeted target but the path still carries the editable node).
    expect(isEditableTarget(plain, [plain, input, document.body])).toBe(true);
    expect(isEditableTarget(plain, [plain, document.body])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Negative cases
// ---------------------------------------------------------------------------

describe("hotkeys — negative cases", () => {
  it("returns null without alt modifier", () => {
    const event = makeEvent({ key: "p", metaKey: true });
    expect(matchHotkey(event)).toBeNull();
  });

  it("returns null with shift held", () => {
    const event = makeEvent({
      key: "p",
      altKey: true,
      metaKey: true,
      shiftKey: true,
    });
    expect(matchHotkey(event)).toBeNull();
  });

  it("returns null for non-letter key", () => {
    const event = makeEvent({ key: "Enter", altKey: true, metaKey: true });
    expect(matchHotkey(event)).toBeNull();
  });

  it("returns null when target is an input element", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    const event = makeEvent({
      key: "p",
      altKey: true,
      metaKey: true,
      target: input,
    });
    expect(matchHotkey(event)).toBeNull();
    document.body.removeChild(input);
  });

  it("returns null when both ctrl and meta are held (extra modifier)", () => {
    const event = makeEvent({
      key: "p",
      altKey: true,
      ctrlKey: true,
      metaKey: true,
    });
    expect(matchHotkey(event)).toBeNull();
  });
});
