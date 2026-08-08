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
  type SourceCandidate,
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

describe("serializeTaskArtifact size re-check after source backfill", () => {
  const baseTask = (names: string[]): PortalStudioTask => ({
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
        elements: names.map((name) => ({
      tagName: "div",
      selectorCandidates: [],
      componentCandidates: [{ name, key: null, kind: "fiber" }],
      sourceCandidates: [],
      snapshot: {
        text: "x",
        attributes: {},
        childCount: 0,
        domOutline: "div",
        computedStyle: { display: "block" },
      },
        })),
      },
    ],
    businessContext: [],
    redaction: { droppedKeys: [], redactedValues: 0, truncatedValues: 0 },
  });

  it("accepts artifacts that stay within the limit after backfill", () => {
    const task = baseTask(["TableRow"]);
    const resolved: SourceCandidate[] = [
      {
        kind: "module",
        file: "/repo/src/components/ui/table.tsx",
        line: 42,
        name: "TableRow",
      },
    ];
    const result = serializeTaskArtifact(task, resolved, "session-token");
    expect(result.ok).toBe(true);
    if (result.ok) {
      const parsed = JSON.parse(result.serialized) as PortalStudioTask;
      expect(parsed.annotations[0].elements[0].sourceCandidates).toHaveLength(1);
      expect(
        parsed.annotations[0].elements[0].sourceCandidates[0].file
      ).toContain("table.tsx");
      // The session token is redacted even inside the serialized artifact.
      expect(result.serialized).not.toContain("session-token");
    }
  });

  it("rejects artifacts that exceed 256 KB after source backfill", () => {
    // sanitizeTask's own size check passes (no source candidates yet); the
    // backfill pushes the final artifact over the limit.
    const names = Array.from({ length: 40 }, (_, i) => `Component${i}`);
    const task = baseTask(names);
    const longFile = "/repo/src/".padEnd(7000, "x") + ".tsx";
    const resolved: SourceCandidate[] = names.flatMap((name, index) => [
      {
        kind: "module",
        file: longFile.slice(0, longFile.length - index),
        line: 1,
        name,
      },
      {
        kind: "module",
        file: `${longFile.slice(0, 6000)}/alt.tsx`,
        line: 2,
        name,
      },
    ]);
    // Sanitization itself must accept the task (it is small without sources).
    expect(sanitizeTask(task)).not.toBeNull();
    const result = serializeTaskArtifact(task, resolved, "");
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
