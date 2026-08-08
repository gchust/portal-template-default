/**
 * Goal 07 — Alpha regression tests (X-Portal / base / entry root cause).
 *
 * The Alpha (3.0.0-alpha.7) backend validates the `X-Portal` header derived by
 * the Portal SDK from the Vite base: for base `/x/dogfood-crm-a808/` the SDK
 * sends `X-Portal: dogfood-crm-a808`, which the Alpha backend rejected with
 * 404 PORTAL_NOT_FOUND (no environment Portal record; see D-028). These tests
 * pin the base → portal-name mapping contract (the exact logic whose output
 * feeds the header) and the base normalization used for the canonical entry,
 * so any future change to base handling is caught.
 */

import { describe, expect, it } from "vitest";

import {
  normalizePortalBase,
  resolveNocoBasePortalName,
} from "@nocobase/portal-sdk/runtime";

describe("Alpha regression: normalizePortalBase (canonical entry/base contract)", () => {
  it("normalizes the canonical non-root base without duplication", () => {
    expect(normalizePortalBase("/x/dogfood-crm-a808/")).toBe(
      "/x/dogfood-crm-a808/"
    );
    // Missing trailing slash is normalized (a single base, never doubled).
    expect(normalizePortalBase("/x/dogfood-crm-a808")).toBe(
      "/x/dogfood-crm-a808/"
    );
    expect(normalizePortalBase("/")).toBe("/");
    expect(normalizePortalBase("")).toBe("/");
    expect(normalizePortalBase(undefined)).toBe("/");
    expect(normalizePortalBase("x/dogfood-crm-a808")).toBe(
      "/x/dogfood-crm-a808/"
    );
  });

  it("keeps the root base at root (no portal prefix, no duplication)", () => {
    expect(normalizePortalBase("/")).toBe("/");
    // SDK contract: double slashes are not collapsed (documented as-is).
    expect(normalizePortalBase("//")).toBe("//");
  });
});

describe("Alpha regression: resolveNocoBasePortalName (X-Portal root cause)", () => {
  it("derives the portal name from a /x/<name>/ base (the header value the Alpha backend validated)", () => {
    // This is the exact mapping that produced `X-Portal: dogfood-crm-a808`,
    // which 3.0.0-alpha.7 rejected with PORTAL_NOT_FOUND (D-028).
    expect(resolveNocoBasePortalName("/x/dogfood-crm-a808/")).toBe(
      "dogfood-crm-a808"
    );
    expect(resolveNocoBasePortalName("/x/main/")).toBe("main");
    expect(resolveNocoBasePortalName("/x/other-portal")).toBe("other-portal");
  });

  it("returns undefined for bases that must not send an X-Portal header", () => {
    // Root and non-/x/ bases produce no portal name → the SDK sends no
    // X-Portal header → the Alpha backend accepts the request (verified:
    // roles:check with no header → 200).
    expect(resolveNocoBasePortalName("/")).toBeUndefined();
    expect(resolveNocoBasePortalName("/custom")).toBeUndefined();
    expect(resolveNocoBasePortalName("")).toBeUndefined();
  });

  it("maps the apps-style base to the segment after /x/ (SDK contract)", () => {
    // The SDK's regex captures the first segment after /x/; an apps-style
    // base yields "apps". Pinned so any change to this mapping (which feeds
    // X-Portal) is caught.
    expect(resolveNocoBasePortalName("/x/apps/dogfood-crm-a808/")).toBe(
      "apps"
    );
  });
});
