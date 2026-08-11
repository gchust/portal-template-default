import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import {
  MAX_SCREENSHOT_BODY_BYTES,
  MAX_TASK_BODY_BYTES,
  sanitizeTask,
} from "@/studio/endpoint";
import {
  readRequestBody,
  serializeTaskArtifact,
} from "@/studio/vite";
import {
  TASK_SCHEMA_VERSION,
  type PortalStudioTask,
} from "@/studio/types";

const toStream = (chunks: Buffer[]) =>
  Readable.from(chunks.map((chunk) => chunk as unknown as Uint8Array));

const asAsyncIterable = (stream: Readable) =>
  stream as unknown as AsyncIterable<unknown>;

describe("readRequestBody per-route limits", () => {
  it("reads a screenshot body larger than 256 KB up to the screenshot limit", async () => {
    // Base64 PNG data legitimately exceeds the task limit while staying far
    // below the decoded 2 MB cap: 300 KB of body must be readable with the
    // screenshot limit and rejected with the task limit.
    const body = Buffer.alloc(300 * 1024, 0x61);
    const taskLimited = await readRequestBody(
      asAsyncIterable(toStream([body])),
      MAX_TASK_BODY_BYTES
    );
    expect(taskLimited).toEqual({ ok: false, status: 413 });

    const screenshotLimited = await readRequestBody(
      asAsyncIterable(toStream([body])),
      MAX_SCREENSHOT_BODY_BYTES
    );
    expect(screenshotLimited.ok).toBe(true);
    if (screenshotLimited.ok) {
      expect(screenshotLimited.body).toHaveLength(300 * 1024);
    }
  });

  it("reads small bodies under both limits", async () => {
    const body = Buffer.from('{"ok":true}', "utf8");
    const result = await readRequestBody(
      asAsyncIterable(toStream([body])),
      MAX_TASK_BODY_BYTES
    );
    expect(result).toEqual({ ok: true, body: '{"ok":true}' });
  });

  it("accumulates chunks across a stream", async () => {
    const result = await readRequestBody(
      asAsyncIterable(
        toStream([Buffer.from("ab"), Buffer.from("cd"), Buffer.from("ef")])
      ),
      MAX_TASK_BODY_BYTES
    );
    expect(result).toEqual({ ok: true, body: "abcdef" });
  });
});

describe("serializeTaskArtifact size re-check (v6, no source backfill)", () => {
  const baseTask = (count: number): PortalStudioTask => ({
    schemaVersion: TASK_SCHEMA_VERSION,
    taskId: "task-size-1",
    createdAt: "2026-08-07T12:00:00.000Z",
    url: "http://127.0.0.1:5176/users",
    title: "t",
    annotations: [
      {
        annotationId: "ann-size-1",
        kind: "element",
        comment: "i",
        createdAt: "2026-08-07T12:00:00.000Z",
        status: "open",
        elements: Array.from({ length: count }, (_, index) => ({
          tagName: "div",
          selector: `#el-${index}`,
          bounds: { x: 0, y: 0, width: 10, height: 10 },
          componentName: `Component${index}`,
          source: {
            filePath: "src/components/ui/table.tsx",
            lineNumber: 42,
            columnNumber: 4,
            componentName: `Component${index}`,
          },
          sourceStack: [],
          htmlPreview: "<div>x</div>",
          styleText: "display: block;",
          __pad: "x",
          fingerprint: {
            tagName: "div",
            role: "",
            accessibleName: "",
            text: "x",
            identityAttributes: { id: `el-${index}` },
            childCount: 0,
            parent: { tagName: "section", role: "" },
          },
        })),
      },
    ],
    businessContext: [],
    redaction: { droppedKeys: [], redactedValues: 0, truncatedValues: 0 },
  });

  it("serializes a v6 task without candidate backfill and redacts the token", () => {
    const task = baseTask(1);
    const result = serializeTaskArtifact(task, "session-token");
    expect(result.ok).toBe(true);
    if (result.ok) {
      const parsed = JSON.parse(result.serialized) as PortalStudioTask;
      expect(parsed.annotations[0].elements[0].selector).toBe("#el-0");
      expect(parsed.annotations[0].elements[0].source?.filePath).toContain(
        "table.tsx"
      );
      // The session token is redacted even inside the serialized artifact.
      expect(result.serialized).not.toContain("session-token");
    }
  });

  it("rejects artifacts that exceed 256 KB (sanitize and serialize agree)", () => {
    const task = baseTask(50);
    // Pad each capture near the v6 caps so the serialized artifact exceeds
    // the limit. sanitizeTask is the primary gate; serializeTaskArtifact
    // re-checks the final size as defense in depth.
    for (const element of task.annotations[0].elements) {
      element.htmlPreview = "x".repeat(4000);
      element.styleText = "y".repeat(6000);
      element.fingerprint.text = "z".repeat(1000);
    }
    expect(sanitizeTask(task)).toBeNull();
    const result = serializeTaskArtifact(task, "");
    expect(result).toEqual({ ok: false, error: "artifact_too_large" });
  });
});

describe("buildStudioInitScript (D-025: base-aware injection)", () => {
  it("imports the studio entry root-relative for the root base", async () => {
    const { buildStudioInitScript } = await import("@/studio/vite");
    const script = buildStudioInitScript("/");
    expect(script).toContain('import { mountPortalStudio } from "/src/studio/index.tsx"');
    expect(script).toContain("mountPortalStudio(window.__PORTAL_STUDIO_CONFIG__)");
  });

  it("imports the studio entry under a non-root base (portal deployment)", async () => {
    const { buildStudioInitScript } = await import("@/studio/vite");
    const script = buildStudioInitScript("/x/dogfood-crm-a808/");
    expect(script).toContain(
      'import { mountPortalStudio } from "/x/dogfood-crm-a808/src/studio/index.tsx"'
    );
    // Missing trailing slash is normalized.
    expect(buildStudioInitScript("/x/portal")).toContain(
      '"/x/portal/src/studio/index.tsx"'
    );
  });
});
