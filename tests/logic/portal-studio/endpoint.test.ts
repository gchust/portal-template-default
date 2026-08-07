import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  atomicWriteTaskFile,
  generateSessionToken,
  isSafeTaskFileName,
  redactSessionToken,
  resolveActiveTaskPath,
  resolveTaskFilePath,
  sanitizeTask,
  verifySessionToken,
} from "@/studio/endpoint";
import { TASK_SCHEMA_VERSION } from "@/studio/types";

const makeTempStudioRoot = () =>
  mkdtempSync(path.join(tmpdir(), "portal-studio-test-"));

const validTask = {
  schemaVersion: TASK_SCHEMA_VERSION,
  taskId: "task-abc-123",
  createdAt: "2026-08-07T12:00:00.000Z",
  url: "http://127.0.0.1:5176/users",
  title: "Users",
  instruction: "Make the row text larger.",
  element: {
    tagName: "tr",
    selectorCandidates: [{ kind: "path", selector: "tbody > tr" }],
    componentCandidates: [
      { name: "TableRow", key: "1" },
      { name: "DataTable", key: null },
    ],
    snapshot: {
      text: "Alice",
      attributes: { class: "row" },
      childCount: 4,
    },
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
    expect(resolved).toBe(
      path.join(root, "tasks", "active-task.json")
    );
    expect(resolveTaskFilePath(root, "../escape.json")).toBeUndefined();
    expect(resolveTaskFilePath(root, "a/../../escape.json")).toBeUndefined();
    expect(resolveActiveTaskPath(root)).toBe(
      path.join(root, "tasks", "active-task.json")
    );
    rmSync(root, { recursive: true, force: true });
  });
});

describe("task sanitization", () => {
  it("accepts a valid task and normalizes fields", () => {
    const task = sanitizeTask(validTask);
    expect(task).not.toBeNull();
    expect(task?.schemaVersion).toBe(TASK_SCHEMA_VERSION);
    expect(task?.element.componentCandidates).toHaveLength(2);
    expect(task?.element.sourceCandidates).toEqual([]);
  });

  it("rejects wrong schema, missing fields, and unsafe ids", () => {
    expect(sanitizeTask({ ...validTask, schemaVersion: 2 })).toBeNull();
    expect(sanitizeTask({ ...validTask, taskId: "../evil" })).toBeNull();
    expect(sanitizeTask({ ...validTask, url: "" })).toBeNull();
    expect(
      sanitizeTask({ ...validTask, createdAt: "not-a-date" })
    ).toBeNull();
    expect(sanitizeTask({ ...validTask, element: null })).toBeNull();
    expect(sanitizeTask(null)).toBeNull();
    expect(sanitizeTask("nope")).toBeNull();
  });

  it("caps lengths and candidate counts", () => {
    const huge = {
      ...validTask,
      instruction: "x".repeat(10000),
      element: {
        ...validTask.element,
        componentCandidates: Array.from({ length: 200 }, (_, i) => ({
          name: `C${i}`,
          key: null,
        })),
      },
    };
    const task = sanitizeTask(huge);
    expect(task?.instruction).toHaveLength(2000);
    expect(task?.element.componentCandidates).toHaveLength(50);
  });
});

describe("secret hygiene in task sanitization", () => {
  it("drops secret-shaped keys and redacts values", () => {
    const leaky = {
      ...validTask,
      instruction: "Use Authorization: Bearer abc123 to call the API",
      element: {
        ...validTask.element,
        snapshot: {
          text: "token=supersecret&ok=1",
          attributes: {
            class: "row",
            token: "should-be-dropped",
            "data-api-key": "dropped-too",
            title: "Bearer live-secret",
          },
          childCount: 1,
        },
      },
    };
    const task = sanitizeTask(leaky);
    expect(task).not.toBeNull();
    expect(task?.instruction).toContain("[REDACTED]");
    expect(task?.instruction).not.toContain("abc123");
    expect(task?.element.snapshot.text).not.toContain("supersecret");
    expect(task?.element.snapshot.attributes.token).toBeUndefined();
    expect(task?.element.snapshot.attributes["data-api-key"]).toBeUndefined();
    expect(task?.element.snapshot.attributes.title).toContain("[REDACTED]");
    expect(task?.element.snapshot.attributes.title).not.toContain("live-secret");
  });

  it("never writes the session token into artifacts", () => {
    const token = generateSessionToken();
    const task = sanitizeTask({
      ...validTask,
      instruction: `My token is ${token}`,
      element: {
        ...validTask.element,
        snapshot: {
          text: token,
          attributes: { class: "x" },
          childCount: 0,
        },
      },
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
      JSON.stringify(validTask)
    );
    expect(target).toBe(resolveActiveTaskPath(root));
    expect(JSON.parse(readFileSync(target, "utf8"))).toMatchObject({
      taskId: "task-abc-123",
    });
    const mode = statSync(target).mode & 0o777;
    expect(mode).toBe(0o600);
    // No leftover temp files.
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
