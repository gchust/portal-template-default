import { execFileSync, spawn } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TASK_SCHEMA_VERSION } from "@/studio/types";

const MCP_SCRIPT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../scripts/portal-studio-mcp.mjs"
);
const PRINT_SCRIPT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../scripts/portal-studio-print.mjs"
);

type McpResponse = {
  jsonrpc: string;
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
};

const sampleTask = {
  schemaVersion: TASK_SCHEMA_VERSION,
  taskId: "task-mcp-1",
  createdAt: "2026-08-07T12:00:00.000Z",
  url: "http://127.0.0.1:5176/users",
  title: "t",
  annotations: [
    {
      annotationId: "ann-mcp-1",
      kind: "element",
      comment: "i",
      createdAt: "2026-08-07T12:00:00.000Z",
      status: "open",
      elements: [
        {
          tagName: "div",
          selectorCandidates: [],
          componentCandidates: [{ name: "X", key: null, kind: "fiber" }],
          sourceCandidates: [],
          snapshot: { text: "t", attributes: {}, childCount: 0 },
        },
      ],
    },
  ],
  businessContext: [],
  redaction: { droppedKeys: [], redactedValues: 0, truncatedValues: 0 },
  revision: {
    sourceRevision: "a".repeat(64),
    browserRevision: 1,
    hmrAck: false,
    state: "pending",
    checkedAt: "2026-08-07T12:00:00.000Z",
  },
};

class McpClient {
  private child: ReturnType<typeof spawn>;
  private pending = new Map<number, (value: McpResponse) => void>();
  private nextId = 1;

  constructor(dir: string) {
    this.child = spawn(process.execPath, [MCP_SCRIPT], {
      env: {
        ...process.env,
        PORTAL_STUDIO_DIR: dir,
        PORTAL_STUDIO_ORIGIN: "http://127.0.0.1:1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let buffer = "";
    this.child.stdout.on("data", (chunk) => {
      buffer += String(chunk);
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const message = JSON.parse(line) as McpResponse;
        const resolve = this.pending.get(message.id as number);
        if (resolve) {
          this.pending.delete(message.id as number);
          resolve(message);
        }
      }
    });
  }

  request(method: string, params?: unknown): Promise<McpResponse> {
    const id = this.nextId++;
    const payload = { jsonrpc: "2.0", id, method, ...(params ? { params } : {}) };
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.child.stdin.write(`${JSON.stringify(payload)}\n`);
    });
  }

  close() {
    this.child.kill();
  }
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "portal-studio-mcp-"));
  mkdirSync(path.join(dir, "tasks"), { recursive: true });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("portal-studio MCP server (stdio, zero-dep)", () => {
  it("handles initialize, ping, and tools/list", async () => {
    const client = new McpClient(dir);
    const init = await client.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect(init.result).toMatchObject({
      protocolVersion: "2024-11-05",
      serverInfo: { name: "portal-studio-mcp" },
    });
    const ping = await client.request("ping");
    expect(ping.result).toEqual({});
    const tools = await client.request("tools/list");
    const names = (tools.result as { tools: Array<{ name: string }> }).tools.map(
      (tool) => tool.name
    );
    expect(names).toEqual([
      "capture_task",
      "print_task",
      "current_screenshot",
      "read_diagnostics",
      "wait_verification",
    ]);
    client.close();
  });

  it("print_task returns the same artifact as the JSON path (parity)", async () => {
    writeFileSync(
      path.join(dir, "tasks", "active-task.json"),
      JSON.stringify(sampleTask, null, 2)
    );
    const client = new McpClient(dir);
    const result = await client.request("tools/call", {
      name: "print_task",
      arguments: {},
    });
    const content = (result.result as { content: Array<{ text: string }> })
      .content[0].text;
    expect(JSON.parse(content)).toEqual(sampleTask);

    // JSON path parity: the print CLI reads the same file identically.
    const printed = execFileSync(process.execPath, [PRINT_SCRIPT, "--json"], {
      encoding: "utf8",
      env: { ...process.env, PORTAL_STUDIO_DIR: dir },
    });
    expect(JSON.parse(printed)).toEqual(sampleTask);
    client.close();
  });

  it("print_task normalizes a v4 artifact through the shared formatter (F-5)", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "portal-studio-mcp-v4-"));
    mkdirSync(path.join(dir, "tasks"), { recursive: true });
    writeFileSync(
      path.join(dir, "tasks", "active-task.json"),
      JSON.stringify({
        schemaVersion: 4,
        taskId: "task-mcp-v4",
        createdAt: "2026-08-07T12:00:00.000Z",
        url: "http://127.0.0.1:5176/users",
        title: "t",
        instruction: "legacy v4 via MCP",
        elements: [
          {
            tagName: "div",
            selectorCandidates: [],
            componentCandidates: [],
            sourceCandidates: [],
            snapshot: { text: "t", attributes: {}, childCount: 0 },
          },
        ],
        businessContext: [],
        redaction: { droppedKeys: [], redactedValues: 0, truncatedValues: 0 },
      })
    );
    const client = new McpClient(dir);
    const result = (await client.request("tools/call", {
      name: "print_task",
      arguments: {},
    })) as McpResponse;
    const content = (result.result as { content: Array<{ text: string }> })
      .content[0].text;
    const parsed = JSON.parse(content);
    expect(parsed.schemaVersion).toBe(5);
    expect(parsed.annotations[0].comment).toBe("legacy v4 via MCP");
    client.close();
  });

  it("read_diagnostics returns the artifact diagnostics (parity with file read)", async () => {
    const task = {
      ...sampleTask,
      diagnostics: [
        {
          source: "console",
          message: "boom",
          timestamp: "2026-08-07T12:00:00.000Z",
          occurrenceCount: 2,
        },
      ],
    };
    writeFileSync(
      path.join(dir, "tasks", "active-task.json"),
      JSON.stringify(task, null, 2)
    );
    const client = new McpClient(dir);
    const result = await client.request("tools/call", {
      name: "read_diagnostics",
      arguments: {},
    });
    const text = (result.result as { content: Array<{ text: string }> })
      .content[0].text;
    expect(JSON.parse(text)).toEqual(task.diagnostics);
    client.close();
  });

  it("returns an error result for unknown tools and missing tasks", async () => {
    const client = new McpClient(dir);
    const unknown = await client.request("tools/call", {
      name: "nope",
      arguments: {},
    });
    expect(
      (unknown.result as { isError: boolean }).isError
    ).toBe(true);
    const missing = await client.request("tools/call", {
      name: "print_task",
      arguments: {},
    });
    expect((missing.result as { isError: boolean }).isError).toBe(true);
    client.close();
  });

  it("rejects malformed JSON with a parse error", async () => {
    const client = new McpClient(dir);
    const response = new Promise<McpResponse>((resolve) => {
      const probe = (chunk: Buffer) => {
        const line = String(chunk).split("\n")[0];
        if (line.trim()) {
          resolve(JSON.parse(line) as McpResponse);
          client.child.stdout.off("data", probe);
        }
      };
      client.child.stdout.on("data", probe);
      client.child.stdin.write("not-json\n");
    });
    const parsed = await response;
    expect(parsed.error?.code).toBe(-32700);
    client.close();
  });
});

describe("endpoint-path parity (MCP tools vs JSON endpoints)", () => {
  it("the MCP server targets the same endpoint paths as the dev plugin", () => {
    const mcp = readFileSync(MCP_SCRIPT, "utf8");
    const vite = readFileSync(path.resolve("src/studio/vite.ts"), "utf8");
    for (const endpoint of [
      "/__portal-studio/tasks",
      "/__portal-studio/screenshot",
      "/__portal-studio/verify",
    ]) {
      expect(mcp).toContain(endpoint);
      expect(vite).toContain(endpoint);
    }
  });
});

describe("portal-studio-verify CLI", () => {
  const VERIFY_SCRIPT = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "../../../scripts/portal-studio-verify.mjs"
  );

  const run = (args: string[], studioDir: string) => {
    try {
      const stdout = execFileSync(process.execPath, [VERIFY_SCRIPT, ...args], {
        encoding: "utf8",
        env: { ...process.env, PORTAL_STUDIO_DIR: studioDir },
      });
      return { stdout, stderr: "", status: 0 };
    } catch (error) {
      const failed = error as { stdout?: string; stderr?: string; status?: number };
      return {
        stdout: String(failed.stdout ?? ""),
        stderr: String(failed.stderr ?? ""),
        status: failed.status ?? 1,
      };
    }
  };

  it("exits 2 with a clear message when the session file is missing", () => {
    const empty = mkdtempSync(path.join(tmpdir(), "portal-studio-verify-"));
    const result = run([], empty);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("portal-studio");
    rmSync(empty, { recursive: true, force: true });
  });

  it("rejects invalid arguments", () => {
    const empty = mkdtempSync(path.join(tmpdir(), "portal-studio-verify-"));
    expect(run(["--bogus"], empty).status).toBe(2);
    expect(run(["--timeout-ms", "abc"], empty).status).toBe(2);
    rmSync(empty, { recursive: true, force: true });
  });

  it("reads the token from session.json", () => {
    const dir2 = mkdtempSync(path.join(tmpdir(), "portal-studio-verify-"));
    writeFileSync(
      path.join(dir2, "session.json"),
      JSON.stringify({ token: "tok", createdAt: "x", endpoint: "/x" })
    );
    // No live server: the fetch fails, but the token was read and the CLI
    // reports an error via exit 2 rather than a token error.
    const result = run([], dir2);
    expect(result.status).toBe(2);
    expect(result.stderr).not.toContain("session.json");
    rmSync(dir2, { recursive: true, force: true });
  });
});
