/**
 * Goal 06 — remote/production boundary.
 * resolveAllowRemote: NOCOBASE_PORTAL_STUDIO_ALLOW_REMOTE === "true" is the
 * ONLY opt-in (exact string; default false — never hard-coded).
 */
import { describe, expect, it } from "vitest";

import { resolveAllowRemote } from "@/studio/vite";

describe("resolveAllowRemote (Goal 06 remote opt-in)", () => {
  it("defaults to false when the env var is absent", () => {
    expect(resolveAllowRemote(undefined)).toBe(false);
  });

  it("is true ONLY for the exact string 'true'", () => {
    expect(resolveAllowRemote("true")).toBe(true);
  });

  it("rejects every other value (case-sensitive, no truthy aliases)", () => {
    expect(resolveAllowRemote("TRUE")).toBe(false);
    expect(resolveAllowRemote("True")).toBe(false);
    expect(resolveAllowRemote("1")).toBe(false);
    expect(resolveAllowRemote("yes")).toBe(false);
    expect(resolveAllowRemote("")).toBe(false);
    expect(resolveAllowRemote("false")).toBe(false);
  });
});
