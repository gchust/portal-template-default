/**
 * D-031 regression tests: the two LAN-access defects found by real user
 * feedback on the dogfood portal —
 *  1. saveTask stranded in "Saving task…" because crypto.randomUUID is
 *     unavailable in non-secure contexts (plain http on a LAN IP);
 *  2. the toolbar palette clashing with light hosts (fixed indigo on a
 *     white monochrome portal).
 */
import { describe, expect, it, vi } from "vitest";

import { detectHostTheme } from "@/studio/index";
import { sessionErrorMessage } from "@/studio/errors";
import { newTaskId } from "@/studio/task-id";

describe("D-031: task id generation in non-secure contexts", () => {
  it("uses crypto.randomUUID when available", () => {
    expect(newTaskId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it("falls back to a v4-shaped id when crypto.randomUUID is missing", () => {
    const original = globalThis.crypto;
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {},
    });
    try {
      const id = newTaskId();
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      );
      expect(newTaskId()).not.toBe(newTaskId());
    } finally {
      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        value: original,
      });
    }
  });
});

describe("D-031: host theme detection", () => {
  it("returns light for a white host (the AI portal)", () => {
    vi.stubGlobal(
      "getComputedStyle",
      vi.fn().mockReturnValue({ backgroundColor: "rgb(255, 255, 255)" })
    );
    expect(detectHostTheme()).toBe("light");
    vi.unstubAllGlobals();
  });

  it("returns dark for a dark host", () => {
    vi.stubGlobal(
      "getComputedStyle",
      vi.fn().mockReturnValue({ backgroundColor: "rgb(24, 24, 27)" })
    );
    expect(detectHostTheme()).toBe("dark");
    vi.unstubAllGlobals();
  });

  it("parses oklch backgrounds (shadcn-style hosts, D-031)", () => {
    // White-ish oklch (0.985 lightness) must read as LIGHT — the bug that
    // left the toolbar dark on the white AI portal.
    vi.stubGlobal(
      "getComputedStyle",
      vi.fn().mockReturnValue({ backgroundColor: "oklch(0.985 0 0)" })
    );
    expect(detectHostTheme()).toBe("light");
    vi.unstubAllGlobals();
    vi.stubGlobal(
      "getComputedStyle",
      vi.fn().mockReturnValue({ backgroundColor: "oklch(0.18 0 0)" })
    );
    expect(detectHostTheme()).toBe("dark");
    vi.unstubAllGlobals();
  });

  it("parses dark shadcn oklch backgrounds", () => {
    vi.stubGlobal(
      "getComputedStyle",
      vi.fn().mockReturnValue({ backgroundColor: "oklch(0.13 0 0)" })
    );
    expect(detectHostTheme()).toBe("dark");
    vi.unstubAllGlobals();
  });

  it("parses hsl backgrounds", () => {
    vi.stubGlobal(
      "getComputedStyle",
      vi.fn().mockReturnValue({ backgroundColor: "hsl(0, 0%, 98%)" })
    );
    expect(detectHostTheme()).toBe("light");
    vi.unstubAllGlobals();
  });

  it("defaults to light when no background resolves", () => {
    vi.stubGlobal(
      "getComputedStyle",
      vi.fn().mockReturnValue({ backgroundColor: "" })
    );
    expect(detectHostTheme()).toBe("light");
    vi.unstubAllGlobals();
  });

  it("walks html → body when html is transparent (AI portal layout)", () => {
    // The AI portal paints white on <body> (oklch(0.985 0 0)) while <html>
    // stays transparent — the D-031 regression case.
    vi.stubGlobal(
      "getComputedStyle",
      vi
        .fn()
        .mockReturnValueOnce({ backgroundColor: "rgba(0, 0, 0, 0)" })
        .mockReturnValue({ backgroundColor: "oklch(0.985 0 0)" })
    );
    expect(detectHostTheme()).toBe("light");
    vi.unstubAllGlobals();
  });
});

describe("D-031: stale-session / untrusted-origin error mapping", () => {
  it("explains 404/not_found with reload and origin hints", () => {
    const message = sessionErrorMessage(404, "not_found");
    expect(message).toContain("reload the page");
    expect(message).toContain("allowRemote");
    expect(message).not.toBe("not_found");
    expect(sessionErrorMessage(404)).toContain("reload the page");
    expect(sessionErrorMessage(200, "not_found")).toContain("reload the page");
  });

  it("keeps other errors raw", () => {
    expect(sessionErrorMessage(500, "boom")).toBe("boom");
    expect(sessionErrorMessage(500)).toBe("500");
  });
});
