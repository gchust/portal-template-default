import { describe, expect, it } from "vitest";

import {
  redactTextValue,
  sanitizeArtifact,
  sanitizeAttributeMap,
} from "@/studio/redact";

describe("redactTextValue", () => {
  it("redacts bearer tokens, auth headers, and token query params", () => {
    expect(redactTextValue("Bearer abc123")).toContain("[REDACTED]");
    expect(redactTextValue("Bearer abc123")).not.toContain("abc123");
    expect(
      redactTextValue("Authorization: Bearer xyz")
    ).not.toContain("xyz");
    expect(redactTextValue("?token=secret&ok=1")).not.toContain("secret");
    expect(redactTextValue("api_key=abc")).not.toContain("abc");
  });

  it("truncates long values with a marker", () => {
    const value = "y".repeat(5000);
    const redacted = redactTextValue(value);
    expect(redacted.length).toBeLessThan(2100);
    expect(redacted.endsWith("[truncated]")).toBe(true);
  });
});

describe("sanitizeArtifact", () => {
  it("drops secret-shaped keys at any depth", () => {
    const input = {
      instruction: "hello",
      token: "drop-me",
      nested: {
        apiKey: "drop-me-too",
        payload: { Authorization: "drop" },
        keep: "value",
      },
    };
    const result = sanitizeArtifact(input) as Record<string, unknown>;
    expect(result.token).toBeUndefined();
    expect(
      (result.nested as Record<string, unknown>).apiKey
    ).toBeUndefined();
    expect(
      (
        (result.nested as Record<string, unknown>).payload as Record<
          string,
          unknown
        >
      ).Authorization
    ).toBeUndefined();
    expect(
      (result.nested as Record<string, unknown>).keep
    ).toBe("value");
  });

  it("bounds object depth and string length", () => {
    const deep = {
      a: { b: { c: { d: { e: { f: { g: { h: "deep" } } } } } } },
    };
    const result = sanitizeArtifact(deep) as Record<string, unknown>;
    const e = (
      (result.a as Record<string, unknown>).b as Record<string, unknown>
    ).c as Record<string, unknown>;
    const eRecord = e.d as Record<string, unknown>;
    expect(eRecord.e).toBeDefined();
    expect((eRecord.e as Record<string, unknown>).f).toBe("[truncated]");
    const long = { text: "z".repeat(5000) };
    const redacted = sanitizeArtifact(long) as Record<string, unknown>;
    expect(String(redacted.text)).toHaveLength(2012);
  });

  it("never mutates the input", () => {
    const input = { token: "x", list: ["a", "b"] };
    sanitizeArtifact(input);
    expect(input).toEqual({ token: "x", list: ["a", "b"] });
  });
});

describe("sanitizeAttributeMap", () => {
  it("drops secret keys and applies the attribute cap", () => {
    const attributes = sanitizeAttributeMap({
      class: "row",
      token: "drop",
      title: "Bearer zz",
      name: "x".repeat(1000),
    });
    expect(attributes.token).toBeUndefined();
    expect(attributes.title).toContain("[REDACTED]");
    expect(attributes.title).not.toContain("zz");
    expect(attributes.name).toHaveLength(212);
    expect(attributes.class).toBe("row");
  });
});
