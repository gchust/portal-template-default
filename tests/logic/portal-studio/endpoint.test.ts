import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
  clearActiveTask,
  commitEvidence,
  createServerRecorder,
  deriveHeartbeatState,
  matchesPendingEvidence,
  parseHeartbeatPayload,
  readActiveTask,
  readReferencedScreenshot,
  removeScreenshotFile,
  sanitizeDiagnostics,
  updateActiveTaskEvidence,
  generateSessionToken,
  isSafeTaskFileName,
  parseScreenshotPayload,
  redactSessionToken,
  resolveActiveTaskPath,
  resolveTaskFilePath,
  sanitizeTask,
  verifySessionToken,
} from "@/studio/endpoint";
import {
  TASK_SCHEMA_VERSION,
  TASK_SCHEMA_VERSION_V1,
  TASK_SCHEMA_VERSION_V2,
  TASK_SCHEMA_VERSION_V4,
} from "@/studio/types";

const makeTempStudioRoot = () =>
  mkdtempSync(path.join(tmpdir(), "portal-studio-test-"));

const v2Task = {
  schemaVersion: TASK_SCHEMA_VERSION_V2,
  taskId: "task-abc-123",
  createdAt: "2026-08-07T12:00:00.000Z",
  url: "http://127.0.0.1:5176/users",
  title: "Users",
  instruction: "Make the row text larger.",
  elements: [
    {
      tagName: "tr",
      selectorCandidates: [{ kind: "path", selector: "tbody > tr" }],
      componentCandidates: [
        { name: "TableRow", key: "1", kind: "fiber" },
        { name: "DataTable", key: null },
      ],
      snapshot: {
        text: "Alice",
        attributes: { class: "row" },
        childCount: 4,
        domOutline: "tr#row-1.row",
        computedStyle: { display: "table-row", color: "rgb(0, 0, 0)" },
      },
    },
    {
      tagName: "td",
      selectorCandidates: [{ kind: "path", selector: "tbody > tr > td" }],
      componentCandidates: [{ name: "TableRow", key: null, kind: "fiber" }],
      snapshot: {
        text: "Alice",
        attributes: {},
        childCount: 0,
      },
    },
  ],
  region: { x: 10, y: 20, width: 300, height: 120 },
  businessContext: [
    { type: "page-element", id: "pe-1", source: "data-ai-page-element" },
  ],
  screenshot: { file: "screenshots/task-abc-123.png", width: 1200, height: 800 },
};

const v4Task = {
  schemaVersion: TASK_SCHEMA_VERSION_V4,
  taskId: "task-v4-1",
  createdAt: "2026-08-07T12:00:00.000Z",
  url: "http://127.0.0.1:5176/users",
  title: "Users",
  instruction: "legacy v4 instruction",
  elements: [
    {
      tagName: "tr",
      selectorCandidates: [{ kind: "path", selector: "tbody > tr" }],
      componentCandidates: [{ name: "TableRow", key: "1" }],
      snapshot: { text: "Alice", attributes: { class: "row" }, childCount: 4 },
    },
  ],
  region: { x: 1, y: 2, width: 50, height: 20 },
  businessContext: [],
  redaction: { droppedKeys: [], redactedValues: 0, truncatedValues: 0 },
};

const v1Task = {
  schemaVersion: TASK_SCHEMA_VERSION_V1,
  taskId: "task-v1-1",
  createdAt: "2026-08-07T12:00:00.000Z",
  url: "http://127.0.0.1:5176/users",
  title: "Users",
  instruction: "legacy",
  element: {
    tagName: "tr",
    selectorCandidates: [{ kind: "path", selector: "tbody > tr" }],
    componentCandidates: [{ name: "TableRow", key: "1" }],
    snapshot: { text: "Alice", attributes: { class: "row" }, childCount: 4 },
  },
};

describe("session token", () => {
  it("generates a token of at least 32 bytes and verifies constant-time", () => {
    const token = generateSessionToken();
    expect(Buffer.byteLength(token, "utf8")).toBeGreaterThanOrEqual(32);
    expect(verifySessionToken(token, token)).toBe(true);
    expect(verifySessionToken("wrong", token)).toBe(false);
    expect(verifySessionToken(undefined, token)).toBe(false);
    expect(verifySessionToken(token, undefined)).toBe(false);
    expect(verifySessionToken("", token)).toBe(false);
  });

  it("produces distinct tokens per call", () => {
    expect(generateSessionToken()).not.toBe(generateSessionToken());
  });
});

describe("task file names", () => {
  it("accepts safe names and rejects traversal", () => {
    expect(isSafeTaskFileName("active-task.json")).toBe(true);
    expect(isSafeTaskFileName("task-1.json")).toBe(true);
    expect(isSafeTaskFileName("..")).toBe(false);
    expect(isSafeTaskFileName("../active-task.json")).toBe(false);
    expect(isSafeTaskFileName("a/../b")).toBe(false);
    expect(isSafeTaskFileName("")).toBe(false);
    expect(isSafeTaskFileName("has space.json")).toBe(false);
  });

  it("resolves paths only inside the tasks directory", () => {
    const root = makeTempStudioRoot();
    const resolved = resolveTaskFilePath(root, "active-task.json");
    expect(resolved).toBe(path.join(root, "tasks", "active-task.json"));
    expect(resolveTaskFilePath(root, "../escape.json")).toBeUndefined();
    expect(resolveTaskFilePath(root, "a/../../escape.json")).toBeUndefined();
    expect(resolveActiveTaskPath(root)).toBe(
      path.join(root, "tasks", "active-task.json")
    );
    rmSync(root, { recursive: true, force: true });
  });
});

describe("task sanitization", () => {
  it("accepts a valid v2 task and normalizes fields", () => {
    const root = makeTempStudioRoot();
    const task = sanitizeTask(v2Task, { studioRoot: root });
    expect(task).not.toBeNull();
    expect(task?.schemaVersion).toBe(TASK_SCHEMA_VERSION);
    expect(task?.annotations).toHaveLength(1);
    const annotation = task!.annotations[0];
    expect(annotation.kind).toBe("element");
    expect(annotation.comment).toBe("Make the row text larger.");
    expect(annotation.elements).toHaveLength(2);
    expect(annotation.elements[0].componentCandidates[0]).toMatchObject({
      name: "TableRow",
      kind: "fiber",
    });
    expect(annotation.elements[0].snapshot.domOutline).toBe("tr#row-1.row");
    expect(annotation.elements[0].snapshot.computedStyle).toEqual({
      display: "table-row",
      color: "rgb(0, 0, 0)",
    });
    expect(annotation.region).toEqual({ x: 10, y: 20, width: 300, height: 120 });
    expect(task?.businessContext).toEqual([
      { type: "page-element", id: "pe-1", source: "data-ai-page-element" },
    ]);
    expect(task?.redaction).toEqual({
      droppedKeys: [],
      redactedValues: 0,
      truncatedValues: 0,
    });
    // Screenshot ref is dropped when the file does not exist yet.
    expect(task?.screenshot).toBeUndefined();
    rmSync(root, { recursive: true, force: true });
  });

  it("normalizes a v1 payload into the v5 shape (single annotation)", () => {
    const task = sanitizeTask(v1Task);
    expect(task).not.toBeNull();
    expect(task?.schemaVersion).toBe(TASK_SCHEMA_VERSION);
    expect(task?.annotations).toHaveLength(1);
    expect(task?.annotations[0].elements).toHaveLength(1);
    expect(task?.annotations[0].elements[0].tagName).toBe("tr");
    expect(task?.annotations[0].region).toBeUndefined();
    expect(task?.businessContext).toEqual([]);
  });

  it("normalizes a v4 payload into v5 (normalize-on-read, D-033 #17)", () => {
    const task = sanitizeTask(v4Task);
    expect(task).not.toBeNull();
    expect(task?.schemaVersion).toBe(TASK_SCHEMA_VERSION);
    expect(task?.annotations).toHaveLength(1);
    const annotation = task!.annotations[0];
    expect(annotation.comment).toBe("legacy v4 instruction");
    expect(annotation.kind).toBe("element");
    expect(annotation.elements[0].tagName).toBe("tr");
    expect(annotation.region).toEqual({ x: 1, y: 2, width: 50, height: 20 });
    expect(annotation.annotationId).toBe("task-v4-1-v4");
  });

  it("accepts a screenshot ref when the file exists", () => {
    const root = makeTempStudioRoot();
    atomicWriteScreenshot(root, "task-abc-123", Buffer.from("not-png"));
    const task = sanitizeTask(v2Task, { studioRoot: root });
    expect(task?.screenshot).toEqual({
      file: "screenshots/task-abc-123.png",
      width: 1200,
      height: 800,
    });
    rmSync(root, { recursive: true, force: true });
  });

  it("rejects wrong schema, missing fields, and unsafe ids", () => {
    expect(sanitizeTask({ ...v2Task, schemaVersion: 6 })).toBeNull();
    expect(sanitizeTask({ ...v2Task, taskId: "../evil" })).toBeNull();
    expect(sanitizeTask({ ...v2Task, url: "" })).toBeNull();
    expect(
      sanitizeTask({ ...v2Task, createdAt: "not-a-date" })
    ).toBeNull();
    expect(sanitizeTask({ ...v2Task, elements: [] })).toBeNull();
    expect(sanitizeTask({ ...v2Task, elements: null })).toBeNull();
    expect(sanitizeTask(null)).toBeNull();
    expect(sanitizeTask("nope")).toBeNull();
  });

  it("caps lengths and counts", () => {
    const huge = {
      ...v2Task,
      instruction: "x".repeat(10000),
      elements: [
        v2Task.elements[0],
        ...Array.from({ length: 200 }, (_, i) => ({
          ...v2Task.elements[1],
          componentCandidates: [{ name: `C${i}`, key: null }],
        })),
      ],
      businessContext: Array.from({ length: 50 }, (_, i) => ({
        type: "data-attribute",
        id: `ctx-${i}`,
        source: "data-nb-x",
      })),
    };
    const task = sanitizeTask(huge);
    expect(task).not.toBeNull();
    expect(task?.annotations[0].comment).toHaveLength(2000);
    expect(task?.annotations[0].elements).toHaveLength(50);
    expect(task?.businessContext).toHaveLength(20);
  });

  it("rejects oversized artifacts", () => {
    const styleBlock = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [`prop-${i}`, "z".repeat(200)])
    );
    const huge = {
      ...v2Task,
      elements: Array.from({ length: 50 }, (_, i) => ({
        ...v2Task.elements[0],
        componentCandidates: [{ name: `C${i}`, key: null }],
        snapshot: {
          text: "t",
          attributes: {},
          childCount: 0,
          computedStyle: styleBlock,
        },
      })),
    };
    expect(sanitizeTask(huge)).toBeNull();
  });

  it("rejects client-supplied source candidates (server resolves)", () => {
    const withSources = {
      ...v2Task,
      elements: [
        {
          ...v2Task.elements[0],
          sourceCandidates: [
            { kind: "module", file: "/fake/evil.ts", line: 1 },
          ],
        },
      ],
    };
    const task = sanitizeTask(withSources);
    expect(task?.annotations[0].elements[0].sourceCandidates).toEqual([]);
  });
});

describe("secret hygiene in task sanitization", () => {
  it("drops secret-shaped keys, redacts values, and records the manifest", () => {
    const leaky = {
      ...v2Task,
      instruction: "Use Authorization: Bearer abc123 to call the API",
      elements: [
        {
          ...v2Task.elements[0],
          snapshot: {
            text: "token=supersecret&ok=1",
            attributes: {
              class: "row",
              token: "should-be-dropped",
              "data-api-key": "dropped-too",
              title: "Bearer live-secret",
            },
            childCount: 1,
            computedStyle: {
              color: "rgb(0,0,0)",
              backgroundImage: "url(?token=style-secret)",
            },
          },
        },
      ],
    };
    const task = sanitizeTask(leaky);
    expect(task).not.toBeNull();
    const annotation = task!.annotations[0];
    expect(annotation.comment).toContain("[REDACTED]");
    expect(annotation.comment).not.toContain("abc123");
    expect(annotation.elements[0].snapshot.text).not.toContain("supersecret");
    expect(
      annotation.elements[0].snapshot.attributes.token
    ).toBeUndefined();
    expect(
      annotation.elements[0].snapshot.attributes["data-api-key"]
    ).toBeUndefined();
    expect(annotation.elements[0].snapshot.attributes.title).toContain("[REDACTED]");
    expect(
      annotation.elements[0].snapshot.attributes.title
    ).not.toContain("live-secret");
    expect(
      annotation.elements[0].snapshot.computedStyle?.backgroundImage
    ).not.toContain("style-secret");
    // The server-authoritative manifest records what was stripped.
    expect(task?.redaction.droppedKeys).toEqual(
      expect.arrayContaining(["token", "data-api-key"])
    );
    expect(task?.redaction.redactedValues).toBeGreaterThan(0);
  });

  it("never writes the session token into artifacts", () => {
    const token = generateSessionToken();
    const task = sanitizeTask({
      ...v2Task,
      instruction: `My token is ${token}`,
    });
    expect(task).not.toBeNull();
    const serialized = redactSessionToken(JSON.stringify(task), token);
    expect(serialized).not.toContain(token);
    expect(serialized).toContain("[REDACTED]");
    expect(redactSessionToken("unchanged", "")).toBe("unchanged");
  });
});

describe("atomic task writes", () => {
  it("writes atomically with mode 0600 and readable content", () => {
    const root = makeTempStudioRoot();
    const target = atomicWriteTaskFile(
      root,
      "active-task.json",
      JSON.stringify(v2Task)
    );
    expect(target).toBe(resolveActiveTaskPath(root));
    expect(JSON.parse(readFileSync(target, "utf8"))).toMatchObject({
      taskId: "task-abc-123",
    });
    const mode = statSync(target).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(readdirSync(path.dirname(target))).toEqual(["active-task.json"]);
    rmSync(root, { recursive: true, force: true });
  });

  it("rejects unsafe file names", () => {
    const root = makeTempStudioRoot();
    expect(() =>
      atomicWriteTaskFile(root, "../escape.json", "{}")
    ).toThrow(/Unsafe task file name/);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("session file writes", () => {
  it("writes the session file atomically with mode 0600", () => {
    const root = makeTempStudioRoot();
    const sessionPath = path.join(root, "session.json");
    atomicWriteSessionFile(
      sessionPath,
      JSON.stringify({ token: "abc", createdAt: "2026-08-07T12:00:00.000Z" })
    );
    expect(JSON.parse(readFileSync(sessionPath, "utf8")).token).toBe("abc");
    expect(statSync(sessionPath).mode & 0o777).toBe(0o600);
    // No leftover temp files (a torn file must never be readable as live).
    expect(readdirSync(root)).toEqual(["session.json"]);
    // Rotations overwrite atomically and stay consistent.
    atomicWriteSessionFile(
      sessionPath,
      JSON.stringify({ token: "def", createdAt: "2026-08-07T12:00:01.000Z" })
    );
    expect(JSON.parse(readFileSync(sessionPath, "utf8")).token).toBe("def");
    expect(readdirSync(root)).toEqual(["session.json"]);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("screenshot payloads and writes", () => {
  const PNG_MAGIC = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);

  it("parses a real PNG header with dimensions", () => {
    const header = Buffer.alloc(26);
    PNG_MAGIC.copy(header, 0);
    header.write("IHDR", 12, "latin1");
    header.writeUInt32BE(640, 16);
    header.writeUInt32BE(480, 20);
    const parsed = parseScreenshotPayload(header.toString("base64"));
    expect(parsed).not.toBeNull();
    expect(parsed?.width).toBe(640);
    expect(parsed?.height).toBe(480);
  });

  it("rejects non-PNG and tiny payloads", () => {
    expect(parseScreenshotPayload(Buffer.from("not-a-png").toString("base64"))).toBeNull();
    expect(parseScreenshotPayload("")).toBeNull();
    expect(parseScreenshotPayload(undefined as unknown as string)).toBeNull();
    // Bad IHDR chunk name.
    const fake = Buffer.alloc(26);
    PNG_MAGIC.copy(fake, 0);
    fake.write("XXXX", 12, "latin1");
    fake.writeUInt32BE(100, 16);
    fake.writeUInt32BE(100, 20);
    expect(parseScreenshotPayload(fake.toString("base64"))).toBeNull();
  });

  it("enforces the decoded 2 MB cap exactly at the boundary", () => {
    const withSize = (size: number) => {
      const buffer = Buffer.alloc(size);
      PNG_MAGIC.copy(buffer, 0);
      buffer.write("IHDR", 12, "latin1");
      buffer.writeUInt32BE(100, 16);
      buffer.writeUInt32BE(100, 20);
      return buffer;
    };
    // Exactly at the cap: accepted.
    const atLimit = parseScreenshotPayload(
      withSize(2 * 1024 * 1024).toString("base64")
    );
    expect(atLimit).not.toBeNull();
    expect(atLimit?.width).toBe(100);
    // One byte over the cap: rejected.
    const overLimit = parseScreenshotPayload(
      withSize(2 * 1024 * 1024 + 1).toString("base64")
    );
    expect(overLimit).toBeNull();
  });

  it("writes screenshots atomically with traversal-safe names", () => {
    const root = makeTempStudioRoot();
    const file = atomicWriteScreenshot(root, "task-1", Buffer.from("png-data"));
    expect(file).toBe("screenshots/task-1.png");
    const target = path.join(root, "screenshots", "task-1.png");
    expect(readFileSync(target, "utf8")).toBe("png-data");
    expect(statSync(target).mode & 0o777).toBe(0o600);
    expect(() =>
      atomicWriteScreenshot(root, "../evil", Buffer.from("x"))
    ).toThrow(/Unsafe screenshot task id/);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("diagnostics sanitization (server-authoritative)", () => {
  it("accepts a bounded diagnostics array with whitelisted fields", () => {
    const recorder = createServerRecorder();
    const entries = sanitizeDiagnostics(
      [
        {
          source: "console",
          message: "boom",
          timestamp: "2026-08-07T12:00:00.000Z",
          occurrenceCount: 3,
        },
        {
          source: "fetch",
          message: "HTTP 500",
          url: "http://x/api",
          timestamp: "2026-08-07T12:00:01.000Z",
          occurrenceCount: 1,
        },
      ],
      recorder
    );
    expect(entries).toHaveLength(2);
    expect(entries?.[0].occurrenceCount).toBe(3);
  });

  it("drops unknown keys including body fields (shape whitelist)", () => {
    const recorder = createServerRecorder();
    const entries = sanitizeDiagnostics(
      [
        {
          source: "fetch",
          message: "HTTP 500",
          timestamp: "2026-08-07T12:00:00.000Z",
          occurrenceCount: 1,
          requestBody: { secret: "x" },
          responseBody: { token: "y" },
          body: "leak",
          evil: "drop",
        },
      ],
      recorder
    );
    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain("requestBody");
    expect(serialized).not.toContain("responseBody");
    expect(serialized).not.toContain("leak");
    expect(serialized).not.toContain("drop");
  });

  it("redacts secrets and enforces per-entry caps", () => {
    const recorder = createServerRecorder();
    const entries = sanitizeDiagnostics(
      [
        {
          source: "window",
          message: "Bearer server-secret",
          stack: "at fn (https://x/a.js?token=stack-secret)",
          url: "https://x/api?token=url-secret",
          timestamp: "2026-08-07T12:00:00.000Z",
          occurrenceCount: 1,
        },
      ],
      recorder
    );
    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain("server-secret");
    expect(serialized).not.toContain("stack-secret");
    expect(serialized).not.toContain("url-secret");
    expect(recorder.redactedValues).toBeGreaterThan(0);
  });

  it("rejects over-limit and oversized-budget payloads (strict 4xx, no silent cap)", () => {
    const recorder = createServerRecorder();
    // More than 100 entries: the WHOLE payload is rejected (not truncated).
    const many = Array.from({ length: 300 }, (_, i) => ({
      source: "console",
      message: `m-${i}`,
      timestamp: "2026-08-07T12:00:00.000Z",
      occurrenceCount: 1,
    }));
    expect(sanitizeDiagnostics(many, recorder)).toBeNull();
    // Exactly 100 entries are accepted.
    const exact = many.slice(0, 100);
    expect(sanitizeDiagnostics(exact, recorder)).toHaveLength(100);

    const huge = [
      {
        source: "console",
        message: "z".repeat(2000),
        timestamp: "2026-08-07T12:00:00.000Z",
        occurrenceCount: 1,
      },
      ...Array.from({ length: 99 }, () => ({
        source: "console",
        message: "y".repeat(2000),
        timestamp: "2026-08-07T12:00:00.000Z",
        occurrenceCount: 1,
      })),
    ];
    expect(sanitizeDiagnostics(huge, recorder)).toBeNull();
  });

  it("rejects malformed entries instead of silently dropping them", () => {
    const recorder = createServerRecorder();
    const valid = {
      source: "console",
      message: "ok",
      timestamp: "2026-08-07T12:00:00.000Z",
      occurrenceCount: 1,
    };
    // Unknown source, bad timestamp, non-object entry, missing message,
    // invalid occurrenceCount: each rejects the WHOLE payload.
    expect(
      sanitizeDiagnostics([valid, { ...valid, source: "evil" }], recorder)
    ).toBeNull();
    expect(
      sanitizeDiagnostics([valid, { ...valid, timestamp: "nope" }], recorder)
    ).toBeNull();
    expect(sanitizeDiagnostics([valid, 42], recorder)).toBeNull();
    expect(
      sanitizeDiagnostics([valid, { ...valid, message: "   " }], recorder)
    ).toBeNull();
    expect(
      sanitizeDiagnostics([valid, { ...valid, occurrenceCount: 0 }], recorder)
    ).toBeNull();
    // Absent diagnostics are fine; provided-but-malformed are not.
    expect(sanitizeDiagnostics(undefined, recorder)).toEqual([]);
  });
});

describe("updateActiveTaskEvidence", () => {
  const writeTask = (root: string, taskId: string, screenshot?: string) => {
    const taskPath = resolveActiveTaskPath(root);
    mkdirSync(path.dirname(taskPath), { recursive: true });
    writeFileSync(
      taskPath,
      JSON.stringify({
        schemaVersion: 3,
        taskId,
        createdAt: "2026-08-07T12:00:00.000Z",
        url: "http://x/users",
        title: "t",
        instruction: "i",
        elements: [],
        businessContext: [],
        redaction: { droppedKeys: [], redactedValues: 0, truncatedValues: 0 },
        ...(screenshot ? { screenshot: { file: screenshot } } : {}),
      })
    );
  };

  it("returns no_active_task when nothing was captured yet", () => {
    const root = makeTempStudioRoot();
    expect(updateActiveTaskEvidence(root, {})).toEqual({
      ok: false,
      error: "no_active_task",
    });
    rmSync(root, { recursive: true, force: true });
  });

  it("atomically updates screenshot ref, capturedAt, diagnostics, heartbeat", () => {
    const root = makeTempStudioRoot();
    writeTask(root, "task-ev-1");
    const result = updateActiveTaskEvidence(root, {
      screenshot: {
        file: "screenshots/task-ev-1.png",
        width: 640,
        height: 480,
        capturedAt: "2026-08-07T12:00:05.000Z",
      },
      diagnostics: [
        {
          source: "console",
          message: "boom",
          timestamp: "2026-08-07T12:00:04.000Z",
          occurrenceCount: 1,
        },
      ],
      heartbeat: {
        state: "online",
        reportedAt: "2026-08-07T12:00:05.000Z",
        checkedAt: "2026-08-07T12:00:05.000Z",
        lastOnlineAt: "2026-08-07T12:00:05.000Z",
      },
    });
    expect(result).toEqual({ ok: true });
    const task = readActiveTask(root);
    expect(task?.screenshot).toEqual({
      file: "screenshots/task-ev-1.png",
      width: 640,
      height: 480,
      capturedAt: "2026-08-07T12:00:05.000Z",
    });
    expect(task?.diagnostics).toHaveLength(1);
    expect(task?.heartbeat?.state).toBe("online");
    // No leftover temp files.
    expect(readdirSync(path.dirname(resolveActiveTaskPath(root)))).toEqual([
      "active-task.json",
    ]);
    rmSync(root, { recursive: true, force: true });
  });

  it("keeps a same-path screenshot and prunes a different superseded one", () => {
    const root = makeTempStudioRoot();
    writeTask(root, "task-ev-2", "screenshots/task-ev-2.png");
    atomicWriteScreenshot(root, "task-ev-2", Buffer.from("old"));

    // Same path (fresh POST already overwrote the file): kept.
    const same = updateActiveTaskEvidence(root, {
      screenshot: {
        file: "screenshots/task-ev-2.png",
        width: 10,
        height: 10,
        capturedAt: "2026-08-07T12:00:06.000Z",
      },
    });
    expect(same).toEqual({ ok: true });
    expect(readdirSync(path.join(root, "screenshots"))).toEqual([
      "task-ev-2.png",
    ]);

    // Different path: the superseded file is pruned after the write.
    atomicWriteScreenshot(root, "task-ev-3", Buffer.from("new"));
    const diff = updateActiveTaskEvidence(root, {
      screenshot: {
        file: "screenshots/task-ev-3.png",
        width: 10,
        height: 10,
        capturedAt: "2026-08-07T12:00:07.000Z",
      },
    });
    expect(diff).toEqual({ ok: true });
    expect(readdirSync(path.join(root, "screenshots")).sort()).toEqual([
      "task-ev-3.png",
    ]);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("evidence commit (no-orphan + final artifact cap)", () => {
  const PNG = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  ]);
  const heartbeat = {
    state: "online" as const,
    reportedAt: "2026-08-07T12:00:00.000Z",
    checkedAt: "2026-08-07T12:00:00.000Z",
  };

  it("leaves no orphan PNG when the active task update fails (no_active_task)", () => {
    const root = makeTempStudioRoot();
    const result = commitEvidence(root, {
      taskId: "task-orphan-1",
      pngBuffer: PNG,
      width: 1,
      height: 1,
      diagnostics: [],
      heartbeat,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("no_active_task");
    }
    // The PNG must NOT be left behind.
    expect(readdirSync(path.join(root, "screenshots"))).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });

  it("rejects evidence that pushes the final artifact over 256 KB and leaves no orphan", () => {
    const root = makeTempStudioRoot();
    // Fixture discipline: the ORIGINAL artifact must be under the cap and
    // the MERGED artifact must exceed it — not a pre-overflowing fixture.
    const bigTask = {
      schemaVersion: 3,
      taskId: "task-big",
      createdAt: "2026-08-07T12:00:00.000Z",
      url: "http://x/users",
      title: "t",
      // 256 KB = 262144 bytes; the instruction is sized so the ORIGINAL
      // artifact sits just under the cap while the merged one exceeds it.
      instruction: "z".repeat(256 * 1024 - 2048),
      elements: [],
      businessContext: [],
      redaction: { droppedKeys: [], redactedValues: 0, truncatedValues: 0 },
    };
    const originalBytes = Buffer.byteLength(JSON.stringify(bigTask), "utf8");
    expect(originalBytes).toBeLessThan(256 * 1024);
    const merged = {
      ...bigTask,
      screenshot: {
        file: "screenshots/task-big.png",
        width: 1,
        height: 1,
        capturedAt: "2026-08-07T12:00:00.000Z",
      },
      diagnostics: [
        {
          source: "console",
          message: "x".repeat(2000),
          timestamp: "2026-08-07T12:00:00.000Z",
          occurrenceCount: 1,
        },
      ],
    };
    expect(Buffer.byteLength(JSON.stringify(merged), "utf8")).toBeGreaterThan(
      256 * 1024
    );

    const taskPath = resolveActiveTaskPath(root);
    mkdirSync(path.dirname(taskPath), { recursive: true });
    writeFileSync(taskPath, JSON.stringify(bigTask));

    const result = commitEvidence(root, {
      taskId: "task-big",
      pngBuffer: PNG,
      width: 1,
      height: 1,
      diagnostics: merged.diagnostics as never,
      heartbeat,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("artifact_too_large");
    }
    // The task file is unchanged AND no orphan PNG remains.
    expect(JSON.parse(readFileSync(taskPath, "utf8")).screenshot).toBeUndefined();
    expect(readdirSync(path.join(root, "screenshots"))).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });

  it("returns write_failed and deletes the fresh PNG when the atomic task write fails AFTER the PNG was persisted", () => {
    const root = makeTempStudioRoot();
    const taskPath = resolveActiveTaskPath(root);
    mkdirSync(path.dirname(taskPath), { recursive: true });
    const oldTask = {
      schemaVersion: 3,
      taskId: "task-wf",
      createdAt: "2026-08-07T12:00:00.000Z",
      url: "http://x/users",
      title: "t",
      instruction: "i",
      elements: [],
      businessContext: [],
      redaction: { droppedKeys: [], redactedValues: 0, truncatedValues: 0 },
      screenshot: { file: "screenshots/task-wf-old.png", width: 1, height: 1 },
    };
    writeFileSync(taskPath, JSON.stringify(oldTask));
    atomicWriteScreenshot(root, "task-wf-old", Buffer.from("old-png"));
    const oldTaskContent = readFileSync(taskPath, "utf8");

    const result = commitEvidence(
      root,
      {
        taskId: "task-wf",
        pngBuffer: PNG,
        width: 1,
        height: 1,
        diagnostics: [],
        heartbeat,
      },
      {
        // The seam simulates the atomic task write failing after the PNG
        // was already written to disk.
        writeTaskFile: () => {
          throw new Error("simulated write failure");
        },
      }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("write_failed");
    }
    // The freshly written PNG must be removed (no orphan)…
    expect(readdirSync(path.join(root, "screenshots"))).toEqual([
      "task-wf-old.png",
    ]);
    // …and the old task + old screenshot are untouched.
    expect(readFileSync(taskPath, "utf8")).toBe(oldTaskContent);
    expect(readFileSync(path.join(root, "screenshots", "task-wf-old.png"), "utf8")).toBe("old-png");
    rmSync(root, { recursive: true, force: true });
  });

  it("commits evidence atomically on success (ref, diagnostics, heartbeat)", () => {
    const root = makeTempStudioRoot();
    const taskPath = resolveActiveTaskPath(root);
    mkdirSync(path.dirname(taskPath), { recursive: true });
    writeFileSync(
      taskPath,
      JSON.stringify({
        schemaVersion: 3,
        taskId: "task-ev",
        createdAt: "2026-08-07T12:00:00.000Z",
        url: "http://x/users",
        title: "t",
        instruction: "i",
        elements: [],
        businessContext: [],
        redaction: { droppedKeys: [], redactedValues: 0, truncatedValues: 0 },
      })
    );
    const result = commitEvidence(root, {
      taskId: "task-ev",
      pngBuffer: PNG,
      width: 1,
      height: 1,
      diagnostics: [
        {
          source: "console",
          message: "boom",
          timestamp: "2026-08-07T12:00:00.000Z",
          occurrenceCount: 2,
        },
      ],
      heartbeat,
    });
    expect(result.ok).toBe(true);
    const task = readActiveTask(root);
    expect(task?.screenshot).toMatchObject({ file: "screenshots/task-ev.png" });
    expect(task?.screenshot?.capturedAt).toBeDefined();
    expect(task?.diagnostics?.[0].occurrenceCount).toBe(2);
    expect(task?.heartbeat?.state).toBe("online");
    expect(readdirSync(path.join(root, "screenshots"))).toEqual([
      "task-ev.png",
    ]);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("pending evidence matching (exact requestId + taskId)", () => {
  const pending = { requestId: "req-1", taskId: "task-1" };

  it("clears only on an exact requestId AND taskId match", () => {
    expect(matchesPendingEvidence(pending, "req-1", "task-1")).toBe(true);
    expect(matchesPendingEvidence(pending, "req-1", "task-2")).toBe(false);
    expect(matchesPendingEvidence(pending, "req-2", "task-1")).toBe(false);
    expect(matchesPendingEvidence(pending, "req-1", undefined)).toBe(false);
    expect(matchesPendingEvidence(null, "req-1", "task-1")).toBe(false);
  });

  it("matches on requestId alone when the pending slot has no taskId", () => {
    expect(matchesPendingEvidence({ requestId: "req-1" }, "req-1", "anything")).toBe(true);
    expect(matchesPendingEvidence({ requestId: "req-1" }, "req-2", "task-1")).toBe(false);
  });
});

describe("heartbeat authority (D-016)", () => {
  it("ignores future, old, and invalid client timestamps — receipt time wins", () => {
    const receivedAtMs = 1_700_000_000_000;
    // Any JSON object payload is accepted; the ts field is ignored entirely.
    for (const payload of [
      { ts: receivedAtMs + 86_400_000 }, // future: would fake liveness
      { ts: receivedAtMs - 86_400_000 }, // old: would fake death
      { ts: "not-a-timestamp" },
      { ts: 42 },
      {},
      { ts: null },
    ]) {
      const result = parseHeartbeatPayload(payload, receivedAtMs);
      expect(result).toEqual({ ok: true, receivedAtMs });
    }
    // Non-object payloads are invalid bodies (400), independent of ts.
    expect(parseHeartbeatPayload(null, receivedAtMs).ok).toBe(false);
    expect(parseHeartbeatPayload("garbage", receivedAtMs).ok).toBe(false);
  });

  it("derives state only from server receipt time, never client ts", () => {
    // A forged future ts must not extend liveness: receipt at t=0, state
    // checked at t=15s must be stale regardless of the client ts.
    const receiptAtMs = 1_700_000_000_000;
    const futurePayload = { ts: receiptAtMs + 3_600_000 };
    const receipt = parseHeartbeatPayload(futurePayload, receiptAtMs);
    const nowMs = receiptAtMs + 15_000;
    expect(deriveHeartbeatState(receipt.receivedAtMs, nowMs)).toBe("stale");
    // No heartbeat at all → offline.
    expect(deriveHeartbeatState(undefined, nowMs)).toBe("offline");
    // Fresh receipt → online.
    expect(deriveHeartbeatState(receiptAtMs, receiptAtMs + 5_000)).toBe("online");
  });

  it("derives the full heartbeat report with lastOnlineAt", async () => {
    const { buildHeartbeatReport } = await import("@/studio/endpoint");
    const receiptAtMs = 1_700_000_000_000;
    const online = buildHeartbeatReport(receiptAtMs, receiptAtMs + 2_000);
    expect(online.state).toBe("online");
    expect(online.lastOnlineAt).toBe(new Date(receiptAtMs + 2_000).toISOString());
    const stale = buildHeartbeatReport(receiptAtMs, receiptAtMs + 15_000, online);
    expect(stale.state).toBe("stale");
    expect(stale.lastOnlineAt).toBe(online.lastOnlineAt);
    const offline = buildHeartbeatReport(receiptAtMs, receiptAtMs + 60_000, stale);
    expect(offline.state).toBe("offline");
  });
});

describe("replace lifecycle (transaction-safe screenshot pruning)", () => {
  it("reads the superseded reference without deleting (write-first ordering)", () => {
    const root = makeTempStudioRoot();
    const taskPath = resolveActiveTaskPath(root);
    mkdirSync(path.dirname(taskPath), { recursive: true });
    writeFileSync(
      taskPath,
      JSON.stringify({
        taskId: "task-old",
        screenshot: { file: "screenshots/task-old.png" },
      })
    );
    atomicWriteScreenshot(root, "task-old", Buffer.from("png"));

    // The middleware reads the reference BEFORE writing the new task; the
    // read must never delete anything (a failed task write must not leave
    // the old artifact without its screenshot).
    expect(readReferencedScreenshot(root, taskPath)).toBe(
      "screenshots/task-old.png"
    );
    expect(readdirSync(path.join(root, "screenshots"))).toEqual([
      "task-old.png",
    ]);
    rmSync(root, { recursive: true, force: true });
  });

  it("keeps a same-path screenshot (new POST already overwrote it)", () => {
    const root = makeTempStudioRoot();
    const taskPath = resolveActiveTaskPath(root);
    mkdirSync(path.dirname(taskPath), { recursive: true });
    writeFileSync(
      taskPath,
      JSON.stringify({
        taskId: "task-same",
        screenshot: { file: "screenshots/task-same.png" },
      })
    );
    atomicWriteScreenshot(root, "task-same", Buffer.from("old-png"));

    const superseded = readReferencedScreenshot(root, taskPath);
    // Same taskId reused: the screenshot POST already overwrote the file, so
    // the post-write cleanup must skip deletion when paths match.
    const newScreenshotFile = "screenshots/task-same.png";
    const removed =
      superseded && superseded !== newScreenshotFile
        ? removeScreenshotFile(root, superseded)
        : false;
    expect(removed).toBe(false);
    expect(readdirSync(path.join(root, "screenshots"))).toEqual([
      "task-same.png",
    ]);
    rmSync(root, { recursive: true, force: true });
  });

  it("removes the superseded screenshot only when the new path differs", () => {
    const root = makeTempStudioRoot();
    const taskPath = resolveActiveTaskPath(root);
    mkdirSync(path.dirname(taskPath), { recursive: true });
    writeFileSync(
      taskPath,
      JSON.stringify({
        taskId: "task-old",
        screenshot: { file: "screenshots/task-old.png" },
      })
    );
    atomicWriteScreenshot(root, "task-old", Buffer.from("png"));
    atomicWriteScreenshot(root, "task-new", Buffer.from("png"));
    expect(readdirSync(path.join(root, "screenshots")).sort()).toEqual([
      "task-new.png",
      "task-old.png",
    ]);

    const superseded = readReferencedScreenshot(root, taskPath);
    const newScreenshotFile = "screenshots/task-new.png";
    let removed = false;
    if (superseded && superseded !== newScreenshotFile) {
      removed = removeScreenshotFile(root, superseded);
    }
    expect(removed).toBe(true);
    expect(readdirSync(path.join(root, "screenshots"))).toEqual([
      "task-new.png",
    ]);
    rmSync(root, { recursive: true, force: true });
  });

  it("rejects unsafe removal targets", () => {
    const root = makeTempStudioRoot();
    expect(removeScreenshotFile(root, "../escape.png")).toBe(false);
    expect(removeScreenshotFile(root, "screenshots/../escape.png")).toBe(false);
    expect(removeScreenshotFile(root, "screenshots/missing.png")).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("clear lifecycle", () => {
  it("removes the active task and its referenced screenshot", () => {
    const root = makeTempStudioRoot();
    const taskPath = resolveActiveTaskPath(root);
    mkdirSync(path.dirname(taskPath), { recursive: true });
    writeFileSync(
      taskPath,
      JSON.stringify({
        taskId: "task-clear-1",
        screenshot: { file: "screenshots/task-clear-1.png" },
      })
    );
    atomicWriteScreenshot(root, "task-clear-1", Buffer.from("png"));
    expect(readdirSync(path.join(root, "screenshots"))).toEqual([
      "task-clear-1.png",
    ]);

    const first = clearActiveTask(root);
    expect(first).toEqual({ clearedTask: true, clearedScreenshot: true });
    expect(readdirSync(path.dirname(taskPath))).toEqual([]);
    expect(readdirSync(path.join(root, "screenshots"))).toEqual([]);

    const second = clearActiveTask(root);
    expect(second).toEqual({ clearedTask: false, clearedScreenshot: false });
    rmSync(root, { recursive: true, force: true });
  });

  it("ignores traversal-shaped screenshot refs in the task", () => {
    const root = makeTempStudioRoot();
    const taskPath = resolveActiveTaskPath(root);
    mkdirSync(path.dirname(taskPath), { recursive: true });
    writeFileSync(
      taskPath,
      JSON.stringify({
        taskId: "task-clear-2",
        screenshot: { file: "../escape.png" },
      })
    );
    const result = clearActiveTask(root);
    expect(result.clearedTask).toBe(true);
    expect(result.clearedScreenshot).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });
});
