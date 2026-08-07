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
  atomicWriteTaskFile,
  clearActiveTask,
  readReferencedScreenshot,
  removeScreenshotFile,
  generateSessionToken,
  isSafeTaskFileName,
  parseScreenshotPayload,
  redactSessionToken,
  resolveActiveTaskPath,
  resolveTaskFilePath,
  sanitizeTask,
  verifySessionToken,
} from "@/studio/endpoint";
import { TASK_SCHEMA_VERSION, TASK_SCHEMA_VERSION_V1 } from "@/studio/types";

const makeTempStudioRoot = () =>
  mkdtempSync(path.join(tmpdir(), "portal-studio-test-"));

const v2Task = {
  schemaVersion: TASK_SCHEMA_VERSION,
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
    expect(task?.elements).toHaveLength(2);
    expect(task?.elements[0].componentCandidates[0]).toMatchObject({
      name: "TableRow",
      kind: "fiber",
    });
    expect(task?.elements[0].snapshot.domOutline).toBe("tr#row-1.row");
    expect(task?.elements[0].snapshot.computedStyle).toEqual({
      display: "table-row",
      color: "rgb(0, 0, 0)",
    });
    expect(task?.region).toEqual({ x: 10, y: 20, width: 300, height: 120 });
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

  it("normalizes a v1 payload into the v2 shape", () => {
    const task = sanitizeTask(v1Task);
    expect(task).not.toBeNull();
    expect(task?.schemaVersion).toBe(TASK_SCHEMA_VERSION);
    expect(task?.elements).toHaveLength(1);
    expect(task?.elements[0].tagName).toBe("tr");
    expect(task?.businessContext).toEqual([]);
    expect(task?.region).toBeUndefined();
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
    expect(sanitizeTask({ ...v2Task, schemaVersion: 3 })).toBeNull();
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
    expect(task?.instruction).toHaveLength(2000);
    expect(task?.elements).toHaveLength(50);
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
    expect(task?.elements[0].sourceCandidates).toEqual([]);
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
    expect(task?.instruction).toContain("[REDACTED]");
    expect(task?.instruction).not.toContain("abc123");
    expect(task?.elements[0].snapshot.text).not.toContain("supersecret");
    expect(
      task?.elements[0].snapshot.attributes.token
    ).toBeUndefined();
    expect(
      task?.elements[0].snapshot.attributes["data-api-key"]
    ).toBeUndefined();
    expect(task?.elements[0].snapshot.attributes.title).toContain("[REDACTED]");
    expect(
      task?.elements[0].snapshot.attributes.title
    ).not.toContain("live-secret");
    expect(task?.elements[0].snapshot.computedStyle?.backgroundImage).not.toContain(
      "style-secret"
    );
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
