import { describe, expect, it } from "vitest";

import {
  createRedactionRecorder,
  redactTextValue,
  sanitizeArtifact,
  sanitizeAttributeMap,
  toRedactionManifest,
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
    expect(redactTextValue("token=bare-secret")).not.toContain("bare-secret");
  });

  it("truncates long values with a marker", () => {
    const value = "y".repeat(5000);
    const redacted = redactTextValue(value);
    expect(redacted.length).toBeLessThan(2100);
    expect(redacted.endsWith("[truncated]")).toBe(true);
  });
});

describe("redaction manifest recording", () => {
  it("records redacted and truncated values", () => {
    const recorder = createRedactionRecorder();
    redactTextValue("Bearer abc", {}, recorder);
    redactTextValue("plain text", {}, recorder);
    redactTextValue("z".repeat(3000), {}, recorder);
    const manifest = toRedactionManifest(recorder);
    expect(manifest.redactedValues).toBe(2);
    expect(manifest.truncatedValues).toBe(1);
  });

  it("records dropped secret keys in nested structures", () => {
    const recorder = createRedactionRecorder();
    sanitizeArtifact(
      {
        token: "x",
        nested: { apiKey: "y", authorization: "z", keep: "ok" },
      },
      {},
      recorder
    );
    const manifest = toRedactionManifest(recorder);
    expect(manifest.droppedKeys).toEqual(
      expect.arrayContaining(["token", "apiKey", "authorization"])
    );
    expect(manifest.droppedKeys).not.toContain("keep");
  });

  it("records dropped keys and redactions in attribute maps", () => {
    const recorder = createRedactionRecorder();
    sanitizeAttributeMap(
      { class: "row", token: "drop", title: "Bearer zz" },
      {},
      recorder
    );
    const manifest = toRedactionManifest(recorder);
    expect(manifest.droppedKeys).toEqual(["token"]);
    expect(manifest.redactedValues).toBe(1);
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
    expect((e.d as Record<string, unknown>).e).toBeDefined();
    expect(
      ((e.d as Record<string, unknown>).e as Record<string, unknown>).f
    ).toBe("[truncated]");
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
