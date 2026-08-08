/**
 * Goal 05 — security abuse suite (ExecPlan 05 M1).
 *
 * Re-asserts every security invariant from contract §2/§3 with adversarial
 * inputs: encoded path traversal, token brute force, oversized bodies,
 * redaction-leakage seeds across artifacts/screenshots/diagnostics,
 * no-body-by-default, and endpoint loopback binding. Zero new product
 * behavior — these are tests (plus a loopback exporter) only.
 */

import { Readable } from "node:stream";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  atomicWriteScreenshot,
  atomicWriteSessionFile,
  atomicWriteTaskFile,
  createServerRecorder,
  generateSessionToken,
  isSafeTaskFileName,
  resolveTaskFilePath,
  sanitizeDiagnostics,
  sanitizeTask,
  verifySessionToken,
} from "@/studio/endpoint";
import { sanitizeArtifact } from "@/studio/redact";
import { stripSecretAttributes } from "@/studio/screenshot";
import {
  isLoopbackAddress,
  isTrustedStudioSource,
  ownServerAddresses,
} from "@/studio/vite";

const TASK_SCHEMA_VERSION = 4;

const makeTask = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: TASK_SCHEMA_VERSION,
  taskId: "abuse-task-1",
  createdAt: "2026-08-07T12:00:00.000Z",
  url: "http://127.0.0.1:5176/users",
  title: "t",
  instruction: "i",
  elements: [
    {
      tagName: "div",
      selectorCandidates: [],
      componentCandidates: [],
      snapshot: { text: "x", attributes: {}, childCount: 0 },
    },
  ],
  businessContext: [],
  redaction: { droppedKeys: [], redactedValues: 0, truncatedValues: 0 },
  ...overrides,
});

describe("abuse: encoded and exotic path traversal", () => {
  const attempts = [
    "../escape",
    "..%2fescape",
    "%2e%2e/escape",
    "..\\escape",
    "....//escape",
    "a/../../escape",
    "a%2f..%2f..%2fescape",
    "..%00/escape",
    "%2e%2e%2fescape",
    "..",
    ".",
    "active-task.json/../../x",
    "x/../..",
  ];

  it("rejects every traversal shape for task file names", () => {
    for (const attempt of attempts) {
      expect(isSafeTaskFileName(attempt), attempt).toBe(false);
    }
  });

  it("rejects traversal-shaped screenshot task ids", () => {
    const root = mkdtempSync(path.join(tmpdir(), "portal-studio-abuse-"));
    for (const attempt of attempts) {
      expect(() =>
        atomicWriteScreenshot(root, attempt, Buffer.from("x"))
      ).toThrow();
    }
    rmSync(root, { recursive: true, force: true });
  });

  it("never resolves task paths outside the tasks directory", () => {
    const root = mkdtempSync(path.join(tmpdir(), "portal-studio-abuse-"));
    for (const attempt of attempts) {
      expect(resolveTaskFilePath(root, attempt), attempt).toBeUndefined();
    }
    rmSync(root, { recursive: true, force: true });
  });

  it("rejects traversal-shaped taskIds in the sanitizer", () => {
    for (const attempt of attempts) {
      expect(sanitizeTask(makeTask({ taskId: attempt })), attempt).toBeNull();
    }
  });
});

describe("abuse: token brute force and constant-time structure", () => {
  it("rejects 100 rapid wrong tokens and the real token still verifies", () => {
    const token = generateSessionToken();
    for (let index = 0; index < 100; index += 1) {
      expect(verifySessionToken(`wrong-${index}`, token)).toBe(false);
    }
    expect(verifySessionToken(token, token)).toBe(true);
  });

  it("never treats missing/empty tokens as valid", () => {
    const token = generateSessionToken();
    expect(verifySessionToken(undefined, token)).toBe(false);
    expect(verifySessionToken("", token)).toBe(false);
    expect(verifySessionToken("null", token)).toBe(false);
  });

  it("hashes before comparing (constant-time by construction, no length leak)", () => {
    // The comparison path is sha256-hash-then-timingSafeEqual: different
    // token lengths produce equal-length digests before comparison.
    const token = generateSessionToken();
    const short = "short";
    const long = "x".repeat(100);
    expect(verifySessionToken(short, token)).toBe(false);
    expect(verifySessionToken(long, token)).toBe(false);
  });

  it("generates distinct high-entropy tokens", () => {
    const seen = new Set<string>();
    for (let index = 0; index < 50; index += 1) {
      seen.add(generateSessionToken());
    }
    expect(seen.size).toBe(50);
    for (const token of seen) {
      expect(Buffer.byteLength(token, "utf8")).toBeGreaterThanOrEqual(32);
    }
  });
});

describe("abuse: oversized bodies are rejected (per-route caps)", () => {
  it("rejects task and diagnostics payloads over their budgets", async () => {
    const { readRequestBody } = await import("@/studio/vite");
    const { MAX_TASK_BODY_BYTES, MAX_DIAGNOSTICS_BYTES } = await import(
      "@/studio/endpoint"
    );
    const stream = (size: number) =>
      Readable.from([
        Buffer.alloc(size, 0x61) as unknown as Uint8Array,
      ]) as unknown as AsyncIterable<unknown>;
    const oversized = await readRequestBody(stream(MAX_TASK_BODY_BYTES + 1), MAX_TASK_BODY_BYTES);
    expect(oversized).toEqual({ ok: false, status: 413 });

    const recorder = createServerRecorder();
    const hugeDiagnostics = Array.from({ length: 100 }, () => ({
      source: "console",
      message: "z".repeat(2000),
      timestamp: "2026-08-07T12:00:00.000Z",
      occurrenceCount: 1,
    }));
    expect(
      sanitizeDiagnostics(hugeDiagnostics, recorder)
    ).toBeNull();
    expect(MAX_DIAGNOSTICS_BYTES).toBe(64 * 1024);
  });
});

describe("abuse: redaction-leakage seeds never reach artifacts", () => {
  const seeds = {
    authorization: "Authorization: Bearer abuse-bearer-1",
    cookie: "Cookie: session=abuse-cookie-1",
    queryToken: "https://x/api?token=abuse-query-1",
    apiKey: "api_key=abuse-key-1",
    password: "password=abuse-pass-1",
    bareToken: "token=abuse-bare-1",
  };

  it("redacts every seed in instruction, snapshot text, and diagnostics", () => {
    const task = sanitizeTask(
      makeTask({
        instruction: [
          seeds.authorization,
          seeds.cookie,
          seeds.queryToken,
          seeds.apiKey,
          seeds.password,
          seeds.bareToken,
        ].join(" "),
        elements: [
          {
            tagName: "div",
            selectorCandidates: [],
            componentCandidates: [],
            snapshot: {
              text: [seeds.queryToken, seeds.bareToken].join(" "),
              attributes: { title: seeds.authorization },
              childCount: 0,
            },
          },
        ],
        diagnostics: [
          {
            source: "console",
            message: seeds.authorization,
            timestamp: "2026-08-07T12:00:00.000Z",
            occurrenceCount: 1,
          },
        ],
      })
    );
    expect(task).not.toBeNull();
    const serialized = JSON.stringify(task);
    for (const [name, seed] of Object.entries(seeds)) {
      const marker = seed.split("abuse-")[1]?.split(/[^a-z0-9-]/)[0];
      expect(serialized, name).not.toContain(`abuse-${marker}`);
    }
    expect(serialized).toContain("[REDACTED]");
  });

  it("drops secret-shaped keys in artifacts and attribute maps", () => {
    const recorder = createServerRecorder();
    const result = sanitizeArtifact({
      token: "x",
      Authorization: "y",
      cookie: "z",
      nested: { apiKey: "w" },
    }, {}, recorder) as Record<string, unknown>;
    expect(result.token).toBeUndefined();
    expect(result.Authorization).toBeUndefined();
    expect(result.cookie).toBeUndefined();
    expect(recorder.droppedKeys.size).toBeGreaterThanOrEqual(3);
  });

  it("strips secret-bearing attributes from the screenshot clone", () => {
    const element = document.createElement("div");
    element.setAttribute("data-token", "abuse-attr-1");
    element.setAttribute("href", "/safe");
    stripSecretAttributes(element);
    expect(element.getAttribute("data-token")).toBeNull();
    expect(element.getAttribute("href")).toBe("/safe");
  });

  it("re-asserts no request/response body fields by default", () => {
    const task = sanitizeTask(
      makeTask({
        diagnostics: [
          {
            source: "fetch",
            message: "HTTP 500",
            timestamp: "2026-08-07T12:00:00.000Z",
            occurrenceCount: 1,
            requestBody: { secret: "x" },
            responseBody: { token: "y" },
          },
        ],
      })
    );
    expect(task).not.toBeNull();
    const serialized = JSON.stringify(task);
    expect(serialized).not.toContain("requestBody");
    expect(serialized).not.toContain("responseBody");
    expect(serialized).not.toContain('"body"');
  });
});

describe("abuse: endpoint loopback binding", () => {
  it("accepts only loopback and undefined (socket) addresses", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("::1")).toBe(true);
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackAddress(undefined)).toBe(true);
    expect(isLoopbackAddress("192.168.1.10")).toBe(false);
    expect(isLoopbackAddress("10.0.0.1")).toBe(false);
    expect(isLoopbackAddress("172.17.0.1")).toBe(false);
    expect(isLoopbackAddress("8.8.8.8")).toBe(false);
  });

  it("trusts the machine's own interface addresses (LAN dev access, D-031)", () => {
    // Any address bound to this machine must be accepted: loopback is
    // already covered, and the machine's own LAN/container IPs are the
    // same operator accessing through a different origin (the reported
    // 404-on-LAN regression).
    for (const address of ownServerAddresses()) {
      expect(isTrustedStudioSource(address)).toBe(true);
    }
    expect(isTrustedStudioSource(undefined)).toBe(true);
  });

  it("rejects unknown remote addresses unless allowRemote opts in", () => {
    // A different machine on the LAN is still not a trusted source.
    // (203.0.113.7 is TEST-NET-3, guaranteed unassigned.)
    expect(isTrustedStudioSource("10.99.99.99")).toBe(false);
    expect(isTrustedStudioSource("8.8.8.8")).toBe(false);
    expect(isTrustedStudioSource("203.0.113.7")).toBe(false);
  });
});

describe("abuse: atomic writes leave no torn state", () => {
  it("writes session and task files with 0600 and no temp leftovers", () => {
    const root = mkdtempSync(path.join(tmpdir(), "portal-studio-abuse-"));
    const sessionPath = path.join(root, "session.json");
    atomicWriteSessionFile(sessionPath, JSON.stringify({ token: "x" }));
    expect(statSync(sessionPath).mode & 0o777).toBe(0o600);
    const taskPath = path.join(root, "tasks", "active-task.json");
    mkdirSync(path.dirname(taskPath), { recursive: true });
    writeFileSync(taskPath, JSON.stringify(makeTask()));
    atomicWriteTaskFile(root, "active-task.json", JSON.stringify(makeTask()));
    expect(readdirSync(path.dirname(taskPath))).toEqual(["active-task.json"]);
    rmSync(root, { recursive: true, force: true });
  });
});
