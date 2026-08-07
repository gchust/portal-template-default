import { afterEach, describe, expect, it } from "vitest";

import {
  createDiagnosticsBuffer,
  utf8ByteLength,
  DEDUP_WINDOW_MS,
  diagnosticsBytes,
  installDiagnosticsCapture,
  MAX_DIAGNOSTIC_ENTRIES,
  MAX_DIAGNOSTIC_MESSAGE,
  MAX_DIAGNOSTIC_STACK,
  MAX_DIAGNOSTIC_URL,
  recordDiagnostic,
  snapshotDiagnostics,
  type DiagnosticsBuffer,
} from "@/studio/diagnostics";

const now = 1_700_000_000_000;

const makeBuffer = (): DiagnosticsBuffer => createDiagnosticsBuffer();

afterEach(() => {
  delete (window as unknown as Record<string, unknown>)
    .__PORTAL_STUDIO_CAPTURE_INSTALLED__;
});

describe("recordDiagnostic — five sources", () => {
  it("normalizes all five sources with source, timestamp, and count", () => {
    const buffer = makeBuffer();
    recordDiagnostic(buffer, "console", "console boom", undefined, undefined, now);
    recordDiagnostic(buffer, "window", "window boom", "stack-a", "http://x/a.js:1", now);
    recordDiagnostic(buffer, "promise", "promise boom", undefined, undefined, now);
    recordDiagnostic(buffer, "fetch", "HTTP 500", undefined, "http://x/api?q=1", now);
    recordDiagnostic(buffer, "xhr", "HTTP 401", undefined, "http://x/api2", now);
    const entries = snapshotDiagnostics(buffer);
    expect(entries).toHaveLength(5);
    expect(entries.map((entry) => entry.source)).toEqual([
      "console",
      "window",
      "promise",
      "fetch",
      "xhr",
    ]);
    for (const entry of entries) {
      expect(entry.occurrenceCount).toBe(1);
      expect(Number.isNaN(Date.parse(entry.timestamp))).toBe(false);
    }
    expect(entries[1].stack).toContain("stack-a");
    expect(entries[1].url).toContain("http://x/a.js:1");
  });

  it("captures error instances and string messages", () => {
    const buffer = makeBuffer();
    recordDiagnostic(buffer, "promise", new Error("boom with Bearer abc123"), undefined, undefined, now);
    const [entry] = snapshotDiagnostics(buffer);
    expect(entry.message).toContain("boom with Bearer");
    expect(entry.message).not.toContain("abc123");
    expect(entry.stack).toBeDefined();
  });
});

describe("recordDiagnostic — ingestion redaction", () => {
  it("redacts seeded secrets in message, stack, and url", () => {
    const buffer = makeBuffer();
    recordDiagnostic(
      buffer,
      "window",
      "Failed: Authorization: Bearer live-token-1",
      "at fn (https://x/app.js?token=stack-secret&k=1)",
      "https://x/api?token=url-secret&k=2",
      now
    );
    const [entry] = snapshotDiagnostics(buffer);
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain("live-token-1");
    expect(serialized).not.toContain("stack-secret");
    expect(serialized).not.toContain("url-secret");
    expect(serialized).toContain("[REDACTED]");
  });

  it("truncates long fields with explicit markers", () => {
    const buffer = makeBuffer();
    recordDiagnostic(
      buffer,
      "console",
      "m".repeat(MAX_DIAGNOSTIC_MESSAGE + 500),
      "s".repeat(MAX_DIAGNOSTIC_STACK + 500),
      "u".repeat(MAX_DIAGNOSTIC_URL + 500),
      now
    );
    const [entry] = snapshotDiagnostics(buffer);
    expect(entry.message.length).toBeLessThanOrEqual(MAX_DIAGNOSTIC_MESSAGE + 12);
    expect(entry.message.endsWith("[truncated]")).toBe(true);
    expect(entry.stack).toBeDefined();
    expect(entry.stack!.endsWith("[truncated]")).toBe(true);
    expect(entry.url).toBeDefined();
    expect(entry.url!.endsWith("[truncated]")).toBe(true);
  });
});

describe("recordDiagnostic — dedup window and ring bounds", () => {
  it("coalesces identical source+message within the window", () => {
    const buffer = makeBuffer();
    for (let index = 0; index < 3; index += 1) {
      recordDiagnostic(buffer, "console", "same error", undefined, undefined, now + index * 1000);
    }
    const entries = snapshotDiagnostics(buffer);
    expect(entries).toHaveLength(1);
    expect(entries[0].occurrenceCount).toBe(3);
    // Different message → new entry.
    recordDiagnostic(buffer, "console", "other error", undefined, undefined, now + 2000);
    expect(snapshotDiagnostics(buffer)).toHaveLength(2);
  });

  it("starts a new entry outside the dedup window", () => {
    const buffer = makeBuffer();
    recordDiagnostic(buffer, "console", "same error", undefined, undefined, now);
    recordDiagnostic(
      buffer,
      "console",
      "same error",
      undefined,
      undefined,
      now + DEDUP_WINDOW_MS + 1
    );
    const entries = snapshotDiagnostics(buffer);
    expect(entries).toHaveLength(2);
    expect(entries[0].occurrenceCount).toBe(1);
    expect(entries[1].occurrenceCount).toBe(1);
  });

  it("survives error storms without breaking the ring cap", () => {
    const buffer = makeBuffer();
    // Identical error storm: one entry, huge counter.
    for (let index = 0; index < 1000; index += 1) {
      recordDiagnostic(buffer, "console", "storm", undefined, undefined, now + index);
    }
    expect(snapshotDiagnostics(buffer)).toHaveLength(1);
    expect(snapshotDiagnostics(buffer)[0].occurrenceCount).toBe(1000);

    // Distinct error storm: exactly MAX entries, oldest evicted.
    const distinct = makeBuffer();
    for (let index = 0; index < 1000; index += 1) {
      recordDiagnostic(distinct, "console", `distinct-${index}`, undefined, undefined, now + index);
    }
    const entries = snapshotDiagnostics(distinct);
    expect(entries).toHaveLength(MAX_DIAGNOSTIC_ENTRIES);
    expect(entries[0].message).toBe("distinct-900");
  });

  it("reports serialized byte size for the total budget", () => {
    const buffer = makeBuffer();
    recordDiagnostic(buffer, "console", "x".repeat(500), undefined, undefined, now);
    expect(diagnosticsBytes(buffer)).toBeGreaterThan(0);
  });
});

describe("recordDiagnostic — no body fields by default", () => {
  it("never captures request/response bodies (type + artifact proof)", () => {
    const buffer = makeBuffer();
    recordDiagnostic(buffer, "fetch", "HTTP 500", undefined, "http://x/api", now);
    const serialized = JSON.stringify(snapshotDiagnostics(buffer));
    expect(serialized).not.toContain("requestBody");
    expect(serialized).not.toContain("responseBody");
    expect(serialized).not.toContain("body");
  });
});

describe("installDiagnosticsCapture — real channel wiring", () => {
  it("captures console.error through the wrapped channel", () => {
    const buffer = makeBuffer();
    const dispose = installDiagnosticsCapture(buffer);
     
    console.error("real console boom Bearer cap-secret");
    expect(snapshotDiagnostics(buffer)).toHaveLength(1);
    const [entry] = snapshotDiagnostics(buffer);
    expect(entry.source).toBe("console");
    expect(entry.message).toContain("[REDACTED]");
    expect(entry.message).not.toContain("cap-secret");
    dispose();
  });

  it("is idempotent across re-installations (HMR safety)", () => {
    const buffer = makeBuffer();
    installDiagnosticsCapture(buffer);
    const second = installDiagnosticsCapture(buffer);
     
    console.error("single capture");
    expect(snapshotDiagnostics(buffer)).toHaveLength(1);
    second();
  });
});

describe("utf8ByteLength accuracy (surrogate pairs / emoji)", () => {
  it("matches Buffer.byteLength for ASCII, CJK, and astral code points", () => {
    for (const sample of [
      "plain ascii",
      "éàü", // 2-byte code points
      "中文测试", // 3-byte code points
      "😀", // 4-byte astral (surrogate pair)
      "a😀b中é", // mixed
      "👨‍👩‍👧‍👦", // multi-codepoint emoji with ZWJ
      "", // empty
      "\uD800", // lone high surrogate (3 bytes, invalid but countable)
    ]) {
      expect(utf8ByteLength(sample)).toBe(Buffer.byteLength(sample, "utf8"));
    }
  });
});
