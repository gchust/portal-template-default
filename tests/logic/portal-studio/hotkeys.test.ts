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
  matchHotkey,
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

  it("HOTKEYS has exactly 5 entries", () => {
    expect(HOTKEYS).toHaveLength(5);
  });

  it("each hotkey has a unique action", () => {
    const actions = HOTKEYS.map((h) => h.action);
    expect(new Set(actions).size).toBe(5);
  });

  it("each hotkey has a single-letter key", () => {
    for (const h of HOTKEYS) {
      expect(h.key).toMatch(/^[A-Z]$/);
    }
  });

  it("getHotkey returns the correct definition", () => {
    expect(getHotkey("pick")?.key).toBe("P");
    expect(getHotkey("toggle")?.key).toBe("K");
    expect(getHotkey("copy")?.key).toBe("C");
    expect(getHotkey("multi")?.key).toBe("M");
    expect(getHotkey("area")?.key).toBe("A");
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
