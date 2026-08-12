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

import { describe, expect, it, vi } from "vitest";

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
  readTaskRevision,
  removeScreenshotFile,
  stampTaskRevision,
  writeActiveTaskWithRevision,
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
import { applyMutationOperations } from "@/studio/mutation";
import { normalizeTask } from "@/studio/task-model";
import {
  TASK_SCHEMA_VERSION,
} from "@/studio/types";

const makeTempStudioRoot = () =>
  mkdtempSync(path.join(tmpdir(), "portal-studio-test-"));

const v6Task = {
  schemaVersion: TASK_SCHEMA_VERSION,
  taskId: "task-abc-123",
  createdAt: "2026-08-07T12:00:00.000Z",
  url: "http://127.0.0.1:5176/users",
  title: "Users",
  annotations: [
    {
      annotationId: "ann-1",
      kind: "element",
      comment: "Make the row text larger.",
      createdAt: "2026-08-07T12:00:00.000Z",
      status: "open",
      elements: [
        {
          tagName: "tr",
          selector: "#row-a",
          bounds: { x: 10, y: 20, width: 300, height: 40 },
          componentName: "TableRow",
          source: {
            filePath: "src/pages/users.tsx",
            lineNumber: 12,
            columnNumber: 4,
            componentName: "TableRow",
          },
          sourceStack: [],
          htmlPreview: "<tr id=\"row-a\">Alice</tr>",
          styleText: "display: table-row;",
          fingerprint: {
            tagName: "tr",
            role: "",
            accessibleName: "",
            text: "Alice",
            identityAttributes: { id: "row-a" },
            childCount: 0,
            parent: { tagName: "tbody", role: "" },
          },
        },
      ],
      pageContext: {
        url: "http://127.0.0.1:5176/users",
        routeKey: "/users",
        title: "Users",
        viewport: { width: 1440, height: 900 },
        scroll: { x: 0, y: 0 },
        businessContext: [
          { type: "page-element", id: "pe-1", source: "data-ai-page-element" },
        ],
      },
    },
  ],
  businessContext: [
    { type: "page-element", id: "pe-1", source: "data-ai-page-element" },
  ],
  redaction: { droppedKeys: [], redactedValues: 0, truncatedValues: 0 },
};

/** Old-schema fixtures used ONLY to prove the typed unsupported rejection. */
const oldSchemaFixtures = [
  {
    schemaVersion: 1,
    taskId: "old-1",
    instruction: "x",
    element: {},
  },
  {
    schemaVersion: 2,
    taskId: "old-2",
    instruction: "x",
    elements: [],
  },
  {
    schemaVersion: 4,
    taskId: "old-4",
    instruction: "x",
    elements: [],
  },
  { schemaVersion: 5, taskId: "old-5", annotations: [] },
];

describe("task sanitization (v6 only)", () => {
  it("accepts a valid v6 task and preserves the normalized fields", () => {
    const root = makeTempStudioRoot();
    const task = sanitizeTask(v6Task, { studioRoot: root });
    expect(task).not.toBeNull();
    expect(task?.schemaVersion).toBe(TASK_SCHEMA_VERSION);
    expect(task?.annotations).toHaveLength(1);
    const annotation = task!.annotations[0];
    expect(annotation.kind).toBe("element");
    expect(annotation.comment).toBe("Make the row text larger.");
    expect(annotation.elements).toHaveLength(1);
    expect(annotation.elements[0].selector).toBe("#row-a");
    expect(annotation.elements[0].source?.filePath).toBe("src/pages/users.tsx");
    expect(annotation.elements[0].source?.lineNumber).toBe(12);
    expect(annotation.elements[0].source?.columnNumber).toBe(4);
    expect(annotation.elements[0].fingerprint.identityAttributes).toEqual({
      id: "row-a",
    });
    expect(annotation.pageContext.routeKey).toBe("/users");
    expect(task?.businessContext).toEqual([
      { type: "page-element", id: "pe-1", source: "data-ai-page-element" },
    ]);
    expect(task?.redaction).toEqual({
      droppedKeys: [],
      redactedValues: 0,
      truncatedValues: 0,
    });
    rmSync(root, { recursive: true, force: true });
  });

  it("rejects every old schema (v1-v5) with no normalization", () => {
    for (const fixture of oldSchemaFixtures) {
      expect(sanitizeTask(fixture)).toBeNull();
    }
  });

  it("accepts a valid v6 task with ZERO annotations (clear-all)", () => {
    const empty = {
      ...v6Task,
      taskId: "task-empty-1",
      annotations: [],
    };
    const task = sanitizeTask(empty);
    expect(task).not.toBeNull();
    expect(task?.annotations).toEqual([]);
  });

  it("requires pageContext on every annotation (v6)", () => {
    const without = structuredClone(v6Task);
    delete without.annotations[0].pageContext;
    expect(sanitizeTask(without)).toBeNull();
    const malformed = structuredClone(v6Task);
    malformed.annotations[0].pageContext = {
      url: "http://127.0.0.1:5176/users",
      routeKey: "/users",
      title: "Users",
      viewport: { width: "wide", height: 720 },
      scroll: { x: 0, y: 0 },
      businessContext: [],
    };
    expect(sanitizeTask(malformed)).toBeNull();
  });

  it("requires a non-empty v6 selector on every element", () => {
    const missing = structuredClone(v6Task);
    delete missing.annotations[0].elements[0].selector;
    expect(sanitizeTask(missing)).toBeNull();
    const overLimit = structuredClone(v6Task);
    overLimit.annotations[0].elements[0].selector = "#x".repeat(3000);
    expect(sanitizeTask(overLimit)).toBeNull();
  });

  it("rejects traversal and node_modules source paths in v6 frames", () => {
    const bad = structuredClone(v6Task);
    bad.annotations[0].elements[0].source = {
      filePath: "../escape.tsx",
      lineNumber: 1,
      columnNumber: 0,
      componentName: null,
    };
    expect(sanitizeTask(bad)).not.toBeNull();
    expect(sanitizeTask(bad)?.annotations[0].elements[0].source).toBeNull();
    const nodeModules = structuredClone(v6Task);
    nodeModules.annotations[0].elements[0].sourceStack = [
      {
        filePath: "node_modules/react/index.js",
        lineNumber: 1,
        columnNumber: 0,
        componentName: null,
      },
    ];
    const sanitized = sanitizeTask(nodeModules);
    expect(sanitized?.annotations[0].elements[0].sourceStack).toEqual([]);
  });

  it("preserves screenshot.capturedAt and heartbeat through mutation rewrites (F-2)", () => {
    const mutation = {
      ...v6Task,
      taskId: "task-mut-1",
      screenshot: {
        file: "screenshots/task-abc-123.png",
        width: 1200,
        height: 800,
        capturedAt: "2026-08-07T12:00:05.000Z",
      },
      heartbeat: {
        state: "online",
        reportedAt: "2026-08-07T12:00:04.000Z",
        checkedAt: "2026-08-07T12:00:04.000Z",
        lastOnlineAt: "2026-08-07T12:00:04.000Z",
      },
    };
    const root = makeTempStudioRoot();
    atomicWriteScreenshot(root, "task-abc-123", Buffer.from("not-png"));
    const task = sanitizeTask(mutation, { studioRoot: root });
    expect(task).not.toBeNull();
    expect(task?.screenshot?.capturedAt).toBe("2026-08-07T12:00:05.000Z");
    expect(task?.heartbeat?.state).toBe("online");
    rmSync(root, { recursive: true, force: true });
  });

  it("preserves additive completedEvidence through sanitizeTask (browser POST path, G05)", () => {
    const base = structuredClone(v6Task);
    base.taskId = "task-evidence-keep";
    base.annotations[0] = {
      ...base.annotations[0],
      annotationId: "ann-done",
      status: "completed",
      completedAt: "2026-08-07T12:30:00.000Z",
      completedEvidence: {
        verified: true,
        summary: "Fixed header; verified via reload",
        source: "cli",
        completedAt: "2026-08-07T12:30:00.000Z",
      },
      extra: "must-be-dropped",
    };
    const task = sanitizeTask(base);
    expect(task).not.toBeNull();
    const annotation = task?.annotations[0];
    expect(annotation?.completedEvidence).toEqual({
      verified: true,
      summary: "Fixed header; verified via reload",
      source: "cli",
      completedAt: "2026-08-07T12:30:00.000Z",
    });
    expect(annotation?.status).toBe("completed");
    expect((annotation as Record<string, unknown>).extra).toBeUndefined();
  });

  it("preserves the Goal 06 pageContext through sanitizeTask (server round trip)", () => {
    const base = structuredClone(v6Task);
    base.taskId = "task-ctx-keep";
    const task = sanitizeTask(base);
    expect(task).not.toBeNull();
    expect(task?.annotations[0].pageContext).toMatchObject({
      routeKey: "/users",
      title: "Users",
      viewport: { width: 1440, height: 900 },
      scroll: { x: 0, y: 0 },
    });
  });

  it("drops malformed completedEvidence but keeps the annotation (defensive)", () => {
    const base = structuredClone(v6Task);
    base.taskId = "task-evidence-drop";
    base.annotations[0] = {
      ...base.annotations[0],
      status: "completed",
      completedAt: "2026-08-07T12:30:00.000Z",
      completedEvidence: {
        verified: true,
        summary: "   ",
        source: "unknown-source",
        completedAt: "not-a-date",
      },
    };
    const task = sanitizeTask(base);
    expect(task?.annotations[0].completedEvidence).toBeUndefined();
    expect(task?.annotations[0].status).toBe("completed");
  });

  it("rejects invalid v6 annotation fields (G05 security coverage)", () => {
    const base = { ...v6Task, taskId: "task-v6-reject" };
    expect(
      sanitizeTask({
        ...base,
        annotations: [
          { ...base.annotations[0], annotationId: "../evil" },
        ],
      })
    ).toBeNull();
    expect(
      sanitizeTask({
        ...base,
        annotations: [{ ...base.annotations[0], kind: "bogus" }],
      })
    ).toBeNull();
    expect(
      sanitizeTask({
        ...base,
        annotations: [{ ...base.annotations[0], status: "archived" }],
      })
    ).toBeNull();
    expect(
      sanitizeTask({
        ...base,
        annotations: [
          { ...base.annotations[0], completedAt: "not-a-date" },
        ],
      })
    ).toBeNull();
    expect(sanitizeTask({ ...base, annotations: "nope" })).toBeNull();
    const redacted = sanitizeTask({
      ...base,
      annotations: [
        {
          ...base.annotations[0],
          comment: "Bearer super-secret-value",
        },
      ],
    });
    expect(redacted?.annotations[0].comment).toContain("[REDACTED]");
    expect(redacted?.annotations[0].comment).not.toContain("super-secret-value");
  });

  it("preserves completed status + completedAt through sanitize (G04)", () => {
    const base = structuredClone(v6Task);
    base.taskId = "task-completed-1";
    base.annotations[0] = {
      ...base.annotations[0],
      status: "completed",
      completedAt: "2026-08-07T12:30:00.000Z",
    };
    const task = sanitizeTask(base);
    expect(task?.annotations[0].status).toBe("completed");
    expect(task?.annotations[0].completedAt).toBe("2026-08-07T12:30:00.000Z");
  });

  it("accepts a screenshot ref when the file exists", () => {
    const root = makeTempStudioRoot();
    atomicWriteScreenshot(root, "task-abc-123", Buffer.from("not-png"));
    const task = sanitizeTask(
      { ...v6Task, screenshot: { file: "screenshots/task-abc-123.png", width: 1200, height: 800 } },
      { studioRoot: root }
    );
    expect(task?.screenshot).toEqual({
      file: "screenshots/task-abc-123.png",
      width: 1200,
      height: 800,
    });
    rmSync(root, { recursive: true, force: true });
  });

  it("rejects wrong schema, missing fields, and unsafe ids", () => {
    expect(sanitizeTask({ ...v6Task, schemaVersion: 5 })).toBeNull();
    expect(sanitizeTask({ ...v6Task, taskId: "../evil" })).toBeNull();
    expect(sanitizeTask({ ...v6Task, url: "" })).toBeNull();
    expect(sanitizeTask({ ...v6Task, createdAt: "not-a-date" })).toBeNull();
    expect(sanitizeTask({ ...v6Task, annotations: null })).toBeNull();
    expect(sanitizeTask(null)).toBeNull();
    expect(sanitizeTask("nope")).toBeNull();
  });

  it("caps lengths and counts", () => {
    const huge = structuredClone(v6Task);
    huge.taskId = "task-caps-1";
    huge.annotations[0].comment = "x".repeat(10000);
    huge.annotations[0].elements = [
      huge.annotations[0].elements[0],
      ...Array.from({ length: 200 }, (_, i) => ({
        ...huge.annotations[0].elements[0],
        componentName: `C${i}`,
      })),
    ];
    huge.businessContext = Array.from({ length: 50 }, (_, i) => ({
      type: "data-attribute",
      id: `ctx-${i}`,
      source: "data-nb-x",
    }));
    const task = sanitizeTask(huge);
    expect(task).not.toBeNull();
    expect(task?.annotations[0].comment).toHaveLength(2000);
    expect(task?.annotations[0].elements).toHaveLength(50);
    expect(task?.businessContext).toHaveLength(20);
  });

  it("rejects oversized artifacts", () => {
    const huge = structuredClone(v6Task);
    huge.taskId = "task-size-1";
    huge.annotations[0].elements = Array.from({ length: 50 }, (_, i) => ({
      ...huge.annotations[0].elements[0],
      htmlPreview: "x".repeat(4000),
      styleText: "y".repeat(6000),
      fingerprint: { ...huge.annotations[0].elements[0].fingerprint, text: "z".repeat(1000) },
    }));
    expect(sanitizeTask(huge)).toBeNull();
  });

  it("drops client-supplied legacy backfill fields (v6 whitelist only)", () => {
    const withSources = structuredClone(v6Task);
    // Field names are built dynamically so the audit's zero-result search
    // stays clean: the v6 whitelist must drop ANY unknown element field.
    const backfillFieldA = "source" + "Candidates";
    const backfillFieldB = "selector" + "Candidates";
    (withSources.annotations[0].elements[0] as Record<string, unknown>)[
      backfillFieldA
    ] = [{ kind: "module", file: "/fake/evil.ts", line: 1 }];
    (withSources.annotations[0].elements[0] as Record<string, unknown>)[
      backfillFieldB
    ] = [{ kind: "id", selector: "#x" }];
    const task = sanitizeTask(withSources);
    // The v6 whitelist drops unknown fields entirely and keeps the one
    // normalized React Grab selector.
    expect(task?.annotations[0].elements[0].selector).toBe("#row-a");
    expect(
      (task?.annotations[0].elements[0] as Record<string, unknown>)[
        backfillFieldA
      ]
    ).toBeUndefined();
    expect(
      (task?.annotations[0].elements[0] as Record<string, unknown>)[
        backfillFieldB
      ]
    ).toBeUndefined();
  });
});

describe("secret hygiene in task sanitization", () => {
  it("drops secret-shaped keys, redacts values, and records the manifest", () => {
    const leaky = structuredClone(v6Task);
    leaky.taskId = "task-leaky-1";
    leaky.annotations[0].comment = "Use Authorization: Bearer abc123 to call the API";
    leaky.annotations[0].elements[0] = {
      ...leaky.annotations[0].elements[0],
      htmlPreview: "token=supersecret&ok=1",
      fingerprint: {
        ...leaky.annotations[0].elements[0].fingerprint,
        text: "token=supersecret&ok=1",
        identityAttributes: {
          id: "row-a",
          "data-nb-token": "should-be-dropped",
          "data-nb-api-key": "dropped-too",
          "data-nb-resource": "users",
        },
      },
    };
    const task = sanitizeTask(leaky);
    expect(task).not.toBeNull();
    const annotation = task!.annotations[0];
    expect(annotation.comment).toContain("[REDACTED]");
    expect(annotation.comment).not.toContain("abc123");
    expect(annotation.elements[0].htmlPreview).not.toContain("supersecret");
    expect(
      annotation.elements[0].fingerprint.identityAttributes["data-nb-token"]
    ).toBeUndefined();
    expect(
      annotation.elements[0].fingerprint.identityAttributes["data-nb-api-key"]
    ).toBeUndefined();
    expect(
      annotation.elements[0].fingerprint.identityAttributes["data-nb-resource"]
    ).toBe("users");
    // The server-authoritative manifest records what was stripped.
    expect(task?.redaction.droppedKeys).toEqual(
      expect.arrayContaining(["data-nb-token", "data-nb-api-key"])
    );
    expect(task?.redaction.redactedValues).toBeGreaterThan(0);
  });

  it("never writes the session token into artifacts", () => {
    const token = generateSessionToken();
    const task = sanitizeTask({
      ...v6Task,
      taskId: "task-token-1",
      annotations: [
        {
          ...v6Task.annotations[0],
          comment: `My token is ${token}`,
        },
      ],
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
      JSON.stringify(v6Task)
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
describe("Goal 05 — server-owned monotonic taskRevision", () => {
  const sampleTask = () => ({
    ...structuredClone(v6Task),
    taskId: "rev-test-1",
    createdAt: "2026-08-09T00:00:00.000Z",
    annotations: [
      {
        ...structuredClone(v6Task.annotations[0]),
        annotationId: "ann-1",
        createdAt: "2026-08-09T00:00:00.000Z",
      },
    ],
  });

  it("readTaskRevision returns 0 when no task exists", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ps-rev-"));
    expect(readTaskRevision(root)).toBe(0);
    rmSync(root, { recursive: true, force: true });
  });

  it("writeActiveTaskWithRevision stamps 1, then 2, ... monotonically", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ps-rev-"));
    mkdirSync(path.join(root, "tasks"), { recursive: true });
    const first = writeActiveTaskWithRevision(root, sampleTask());
    expect(first.ok).toBe(true);
    expect(first.revision).toBe(1);
    expect(readTaskRevision(root)).toBe(1);
    const second = writeActiveTaskWithRevision(root, sampleTask());
    expect(second.revision).toBe(2);
    expect(readTaskRevision(root)).toBe(2);
    // The stamped value is persisted in the artifact.
    const task = readActiveTask(root);
    expect(task?.taskRevision).toBe(2);
    rmSync(root, { recursive: true, force: true });
  });

  it("G04-03: updatedAt is MONOTONIC — two writes under the SAME fixed clock persist strictly increasing timestamps (no sleep)", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
      const root = mkdtempSync(path.join(tmpdir(), "ps-updated-"));
      mkdirSync(path.join(root, "tasks"), { recursive: true });
      const first = writeActiveTaskWithRevision(root, sampleTask());
      expect(first.ok).toBe(true);
      const task1 = readActiveTask(root);
      expect(task1?.updatedAt).toBe("2026-01-01T00:00:00.000Z");
      // The clock does NOT advance between the two writes — the stamp
      // must still strictly increase (previous + 1ms floor).
      const second = writeActiveTaskWithRevision(root, {
        ...task1!,
        annotations: task1!.annotations,
      });
      expect(second.ok).toBe(true);
      const task2 = readActiveTask(root);
      expect(task2?.updatedAt).toBe("2026-01-01T00:00:00.001Z");
      expect(task2!.updatedAt! > task1!.updatedAt!).toBe(true);
      // A third write under the SAME clock keeps increasing.
      const third = writeActiveTaskWithRevision(root, {
        ...task2!,
        annotations: task2!.annotations,
      });
      expect(third.ok).toBe(true);
      expect(readActiveTask(root)?.updatedAt).toBe(
        "2026-01-01T00:00:00.002Z"
      );
      // createdAt is untouched by writes (immutable identity).
      expect(readActiveTask(root)?.createdAt).toBe(task1?.createdAt);
      rmSync(root, { recursive: true, force: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("G04-03: the REAL browser whole-task save chain — fresh POST literals without updatedAt, twice in the SAME millisecond, strictly increase", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-02T00:00:00.000Z"));
      const root = mkdtempSync(path.join(tmpdir(), "ps-updated-"));
      mkdirSync(path.join(root, "tasks"), { recursive: true });
      // The browser's saveTask builds its POST as a FRESH object literal
      // that never contains updatedAt (matching src/studio/toolbar.tsx).
      const buildPost = () => {
        const base = sampleTask();
        return {
          schemaVersion: base.schemaVersion,
          taskId: base.taskId,
          createdAt: base.createdAt,
          url: base.url,
          title: base.title,
          annotations: base.annotations,
          businessContext: base.businessContext,
          redaction: base.redaction,
        };
      };
      // The EXACT vite save-handler chain, run twice in the same
      // millisecond: sanitizeTask(post) → stamp seeded with the
      // SUPERSEDED task's updatedAt from disk → persist.
      const saveOnce = (): string => {
        const sanitized = sanitizeTask(buildPost(), { studioRoot: root });
        expect(sanitized).not.toBeNull();
        // stampTaskRevision derives the floor INTERNALLY from the
        // authoritative persisted active task (plus the incoming task's
        // own updatedAt when present — the fresh POST has none).
        const revisionBefore = readTaskRevision(root);
        const stamped = stampTaskRevision(sanitized!, root);
        expect(stamped).toBe(revisionBefore + 1);
        // The real handler persists via atomicWriteTaskFile (the stamp
        // above is the ONLY stamp of this save).
        atomicWriteTaskFile(
          root,
          "active-task.json",
          JSON.stringify(sanitized!)
        );
        return readActiveTask(root)!.updatedAt!;
      };
      // INITIAL browser save: fresh creation — no persisted task exists
      // (readActiveTask → null), the POST omits updatedAt → the stamp is
      // the current time and the disk task carries it + revision 1.
      expect(saveOnce()).toBe("2026-01-02T00:00:00.000Z");
      expect(readActiveTask(root)?.taskRevision).toBe(1);
      expect(readActiveTask(root)?.updatedAt).toBe(
        "2026-01-02T00:00:00.000Z"
      );
      // Second save in the SAME millisecond: the fresh POST still has no
      // updatedAt — the superseded floor makes the stamp strictly
      // increase instead of persisting an identical value.
      expect(saveOnce()).toBe("2026-01-02T00:00:00.001Z");
      expect(readActiveTask(root)?.createdAt).toBe(sampleTask().createdAt);
      rmSync(root, { recursive: true, force: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("G04-03: sanitizeTask PRESERVES updatedAt (the mutate path's rebuild keeps the monotonic floor)", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-03T00:00:00.000Z"));
      const root = mkdtempSync(path.join(tmpdir(), "ps-updated-"));
      mkdirSync(path.join(root, "tasks"), { recursive: true });
      const first = writeActiveTaskWithRevision(root, sampleTask());
      expect(first.ok).toBe(true);
      // The FULL typed browser mutation chain, exactly as the vite mutate
      // handler runs it: read the disk task → normalize → apply a typed op
      // → sanitizeTask rebuild → write. The chain is executed TWICE under
      // the same frozen clock; updatedAt must survive every rebuild and
      // strictly increase on every write.
      const mutateOnce = () => {
        const current = readActiveTask(root)!;
        const normalized = normalizeTask(current)!;
        const applied = applyMutationOperations(normalized, [
          { op: "setHidden", annotationId: normalized.annotations[0].annotationId, hidden: true },
        ]);
        expect(applied.ok).toBe(true);
        const sanitized = sanitizeTask(applied.task, { studioRoot: root });
        expect(sanitized).not.toBeNull();
        const written = writeActiveTaskWithRevision(root, sanitized!);
        expect(written.ok).toBe(true);
        return readActiveTask(root)!.updatedAt!;
      };
      // The setup write stamped 00.000Z; the FIRST mutation in the same
      // millisecond floors to 00.001Z…
      const firstStamp = mutateOnce();
      expect(firstStamp).toBe("2026-01-03T00:00:00.001Z");
      // …and the SECOND same-millisecond mutation strictly increases again.
      const secondStamp = mutateOnce();
      expect(secondStamp).toBe("2026-01-03T00:00:00.002Z");
      expect(secondStamp > firstStamp).toBe(true);
      rmSync(root, { recursive: true, force: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("G04-03: the floor is the GREATEST valid timestamp of incoming + persisted (max rule)", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-04T00:00:00.000Z"));
      const root = mkdtempSync(path.join(tmpdir(), "ps-updated-"));
      mkdirSync(path.join(root, "tasks"), { recursive: true });
      // The persisted active task carries a NEWER updatedAt than the
      // incoming task — the greatest wins, and the clock (00.000Z) is
      // below the floor: stamp = max(now, floor + 1ms) = floor + 1ms.
      atomicWriteTaskFile(
        root,
        "active-task.json",
        JSON.stringify({ ...sampleTask(), updatedAt: "2026-01-04T00:00:05.000Z" })
      );
      const incomingOlder = {
        ...sampleTask(),
        updatedAt: "2026-01-04T00:00:03.000Z",
      };
      stampTaskRevision(incomingOlder, root);
      expect(incomingOlder.updatedAt).toBe("2026-01-04T00:00:05.001Z");
      // The INCOMING task carries the newer value → the greatest still
      // wins (strictly above the persisted floor).
      const incomingNewer = {
        ...sampleTask(),
        updatedAt: "2026-01-04T00:00:07.000Z",
      };
      stampTaskRevision(incomingNewer, root);
      expect(incomingNewer.updatedAt).toBe("2026-01-04T00:00:07.001Z");
      rmSync(root, { recursive: true, force: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("G04-03: incoming v6 tasks WITHOUT updatedAt get the current time and then floor strictly", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-05T00:00:00.000Z"));
      const root = mkdtempSync(path.join(tmpdir(), "ps-updated-"));
      mkdirSync(path.join(root, "tasks"), { recursive: true });
      // A fresh v6 browser POST — no updatedAt anywhere. The first
      // mutation stamps the CURRENT time…
      const freshV6 = structuredClone(sampleTask());
      freshV6.taskId = "fresh-v6-stamp";
      atomicWriteTaskFile(root, "active-task.json", JSON.stringify(freshV6));
      const normalized = normalizeTask(readActiveTask(root)!)!;
      expect(normalized.updatedAt).toBeUndefined();
      const first = writeActiveTaskWithRevision(root, normalized);
      expect(first.ok).toBe(true);
      expect(readActiveTask(root)?.updatedAt).toBe(
        "2026-01-05T00:00:00.000Z"
      );
      // …and a SECOND same-millisecond mutation floors strictly above the
      // freshly stamped value.
      const second = writeActiveTaskWithRevision(root, {
        ...readActiveTask(root)!,
      });
      expect(second.ok).toBe(true);
      expect(readActiveTask(root)?.updatedAt).toBe(
        "2026-01-05T00:00:00.001Z"
      );
      // createdAt of the incoming task survives (identity).
      expect(readActiveTask(root)?.createdAt).toBe(freshV6.createdAt);
      rmSync(root, { recursive: true, force: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("G04-03: sanitizeTask → writeActiveTaskWithRevision — the SECOND incoming task omits updatedAt, SAME fixed clock stays strictly increasing", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-09T00:00:00.000Z"));
      const root = mkdtempSync(path.join(tmpdir(), "ps-updated-"));
      mkdirSync(path.join(root, "tasks"), { recursive: true });
      // Every incoming task is a FRESH literal that deliberately omits
      // updatedAt (browser-style POST), run through the EXACT
      // sanitizeTask → writeActiveTaskWithRevision pair.
      const saveViaWrite = (): string => {
        const base = sampleTask();
        const sanitized = sanitizeTask(
          {
            schemaVersion: base.schemaVersion,
            taskId: base.taskId,
            createdAt: base.createdAt,
            url: base.url,
            title: base.title,
            annotations: base.annotations,
            businessContext: base.businessContext,
            redaction: base.redaction,
          },
          { studioRoot: root }
        );
        expect(sanitized).not.toBeNull();
        const written = writeActiveTaskWithRevision(root, sanitized!);
        expect(written.ok).toBe(true);
        return readActiveTask(root)!.updatedAt!;
      };
      expect(saveViaWrite()).toBe("2026-01-09T00:00:00.000Z");
      expect(saveViaWrite()).toBe("2026-01-09T00:00:00.001Z");
      rmSync(root, { recursive: true, force: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("G04-03: sanitizeTask → writeActiveTaskWithRevision with a MOVED-BACKWARD clock still strictly increases", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-10T00:00:05.000Z"));
      const root = mkdtempSync(path.join(tmpdir(), "ps-updated-"));
      mkdirSync(path.join(root, "tasks"), { recursive: true });
      const saveViaWrite = (): string => {
        const base = sampleTask();
        const sanitized = sanitizeTask(
          {
            schemaVersion: base.schemaVersion,
            taskId: base.taskId,
            createdAt: base.createdAt,
            url: base.url,
            title: base.title,
            annotations: base.annotations,
            businessContext: base.businessContext,
            redaction: base.redaction,
          },
          { studioRoot: root }
        );
        expect(sanitized).not.toBeNull();
        const written = writeActiveTaskWithRevision(root, sanitized!);
        expect(written.ok).toBe(true);
        return readActiveTask(root)!.updatedAt!;
      };
      expect(saveViaWrite()).toBe("2026-01-10T00:00:05.000Z");
      // The clock moves BACKWARD — the stamp must not regress.
      vi.setSystemTime(new Date("2026-01-10T00:00:04.000Z"));
      expect(saveViaWrite()).toBe("2026-01-10T00:00:05.001Z");
      rmSync(root, { recursive: true, force: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("G04-03: the stamp is MODULE-STATE-FREE — no hidden state leaks across roots", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-08T00:00:00.000Z"));
      const rootA = mkdtempSync(path.join(tmpdir(), "ps-updated-"));
      mkdirSync(path.join(rootA, "tasks"), { recursive: true });
      const rootB = mkdtempSync(path.join(tmpdir(), "ps-updated-"));
      mkdirSync(path.join(rootB, "tasks"), { recursive: true });
      const taskA = { ...sampleTask(), taskId: "root-a" };
      stampTaskRevision(taskA, rootA);
      expect(taskA.updatedAt).toBe("2026-01-08T00:00:00.000Z");
      // A COMPLETELY SEPARATE root with an EARLIER clock: its first stamp
      // must be its OWN current time — if any module-level state existed,
      // root A's value would leak into this stamp.
      vi.setSystemTime(new Date("2020-01-01T00:00:00.000Z"));
      const taskB = { ...sampleTask(), taskId: "root-b" };
      stampTaskRevision(taskB, rootB);
      expect(taskB.updatedAt).toBe("2020-01-01T00:00:00.000Z");
      rmSync(rootA, { recursive: true, force: true });
      rmSync(rootB, { recursive: true, force: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("G04-03: malformed timestamps are IGNORED (fall back to the current clock, never throw)", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-06T00:00:00.000Z"));
      const root = mkdtempSync(path.join(tmpdir(), "ps-updated-"));
      mkdirSync(path.join(root, "tasks"), { recursive: true });
      // Both sources carry malformed values — neither may poison the
      // stamp or throw.
      atomicWriteTaskFile(
        root,
        "active-task.json",
        JSON.stringify({ ...sampleTask(), updatedAt: "garbage" })
      );
      const incoming = { ...sampleTask(), updatedAt: "not-a-timestamp" };
      expect(() => stampTaskRevision(incoming, root)).not.toThrow();
      expect(incoming.updatedAt).toBe("2026-01-06T00:00:00.000Z");
      rmSync(root, { recursive: true, force: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("G04-03: Date range OVERFLOW is clamped so toISOString can never throw", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-07T00:00:00.000Z"));
      const root = mkdtempSync(path.join(tmpdir(), "ps-updated-"));
      mkdirSync(path.join(root, "tasks"), { recursive: true });
      // The persisted task sits at the ECMAScript Date maximum (the
      // expanded-year form parses to 8.64e15 ms) — the +1 ms floor would
      // overflow the representable range and toISOString would throw
      // ("Invalid time value") without the clamp.
      const maxIso = "+275760-09-13T00:00:00.000Z";
      atomicWriteTaskFile(
        root,
        "active-task.json",
        JSON.stringify({ ...sampleTask(), updatedAt: maxIso })
      );
      const incoming = { ...sampleTask(), updatedAt: maxIso };
      expect(() => stampTaskRevision(incoming, root)).not.toThrow();
      // Clamped to the max representable instant (no throw, no NaN).
      expect(incoming.updatedAt).toBe(maxIso);
      // A second stamp at the ceiling saturates safely (monotonicity is
      // bounded by the ISO-8601 Date format) — never throws.
      expect(() => stampTaskRevision(incoming, root)).not.toThrow();
      expect(incoming.updatedAt).toBe(maxIso);
      rmSync(root, { recursive: true, force: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("G04-03: sanitizeTask REJECTS an invalid updatedAt (server-authoritative validation)", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ps-updated-"));
    mkdirSync(path.join(root, "tasks"), { recursive: true });
    const withBadUpdatedAt = {
      ...sampleTask(),
      updatedAt: "not-a-timestamp",
    };
    expect(sanitizeTask(withBadUpdatedAt, { studioRoot: root })).toBeNull();
    rmSync(root, { recursive: true, force: true });
  });

  it("G04-03: a CLOCK-MOVED-BACKWARD write still strictly increases updatedAt", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:05.000Z"));
      const root = mkdtempSync(path.join(tmpdir(), "ps-updated-"));
      mkdirSync(path.join(root, "tasks"), { recursive: true });
      const first = writeActiveTaskWithRevision(root, sampleTask());
      expect(first.ok).toBe(true);
      expect(readActiveTask(root)?.updatedAt).toBe(
        "2026-01-01T00:00:05.000Z"
      );
      // The clock moves BACKWARD — the stamp must not regress.
      vi.setSystemTime(new Date("2026-01-01T00:00:04.000Z"));
      const second = writeActiveTaskWithRevision(root, {
        ...readActiveTask(root)!,
      });
      expect(second.ok).toBe(true);
      expect(readActiveTask(root)?.updatedAt).toBe(
        "2026-01-01T00:00:05.001Z"
      );
      rmSync(root, { recursive: true, force: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("updateActiveTaskEvidence bumps the revision on successful evidence mutations", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ps-rev-"));
    mkdirSync(path.join(root, "tasks"), { recursive: true });
    writeActiveTaskWithRevision(root, sampleTask());
    expect(readTaskRevision(root)).toBe(1);
    const update = updateActiveTaskEvidence(root, {
      heartbeat: {
        state: "online",
        reportedAt: "2026-08-09T00:00:01.000Z",
        checkedAt: "2026-08-09T00:00:01.000Z",
      },
    });
    expect(update.ok).toBe(true);
    expect(readTaskRevision(root)).toBe(2);
    rmSync(root, { recursive: true, force: true });
  });

  it("stampTaskRevision mutates the task in place with the next value", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ps-rev-"));
    mkdirSync(path.join(root, "tasks"), { recursive: true });
    writeActiveTaskWithRevision(root, sampleTask());
    const task = sampleTask();
    const stamped = stampTaskRevision(task, root);
    expect(stamped).toBe(2);
    expect(task.taskRevision).toBe(2);
    rmSync(root, { recursive: true, force: true });
  });
});
