#!/usr/bin/env node
/**
 * Portal Studio — optional stdio MCP server (zero runtime dependencies).
 *
 * Exposes the same capabilities as the JSON/file path as first-class MCP
 * tools. It operates on the SAME `.portal-studio/tasks/active-task.json`
 * artifact and the SAME token-protected dev endpoints — MCP is an
 * enhancement only; the JSON path stays fully compatible and first-class
 * (contract §9). Credentials never enter frontend code: the token is read
 * from the local `session.json` (or PORTAL_STUDIO_TOKEN) in this Node
 * process only. Screenshots are returned as file references, never inline.
 *
 * Transport: MCP stdio (newline-delimited JSON-RPC 2.0).
 *
 * Configuration:
 *   PORTAL_STUDIO_DIR     studio runtime directory (default: ./.portal-studio)
 *   PORTAL_STUDIO_ORIGIN  dev server origin (default: http://127.0.0.1:5173)
 *   PORTAL_STUDIO_TOKEN   session token override (default: session.json)
 *
 * Tools: capture_task, print_task, current_screenshot, read_diagnostics,
 * wait_verification.
 */

import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";

const SERVER_NAME = "portal-studio-mcp";
const SERVER_VERSION = "1.0.0";
const PROTOCOL_VERSION = "2024-11-05";
const TASKS_PATH = "/__portal-studio/tasks";
const SCREENSHOT_COMMAND_PATH = "/__portal-studio/screenshot";
const VERIFY_PATH = "/__portal-studio/verify";

const studioRoot = process.env.PORTAL_STUDIO_DIR
  ? path.resolve(process.env.PORTAL_STUDIO_DIR)
  : path.resolve(".portal-studio");
const origin = process.env.PORTAL_STUDIO_ORIGIN ?? "http://127.0.0.1:5173";

const readToken = () => {
  if (process.env.PORTAL_STUDIO_TOKEN) return process.env.PORTAL_STUDIO_TOKEN;
  const session = JSON.parse(
    readFileSync(path.join(studioRoot, "session.json"), "utf8")
  );
  if (typeof session.token !== "string" || !session.token) {
    throw new Error("session.json has no token");
  }
  return session.token;
};

const readActiveTask = () => {
  const raw = readFileSync(path.join(studioRoot, "tasks", "active-task.json"), "utf8");
  return JSON.parse(raw);
};

const readDiagnostics = () => {
  try {
    const task = readActiveTask();
    return JSON.stringify(task.diagnostics ?? [], null, 2);
  } catch {
    return "[]";
  }
};

const endpointCall = async (endpointPath, body, token) => {
  const response = await fetch(`${origin}${endpointPath}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Portal-Studio-Token": token,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      `endpoint ${endpointPath} failed (HTTP ${response.status}): ${JSON.stringify(payload)}`
    );
  }
  return payload;
};

const TOOLS = [
  {
    name: "capture_task",
    description:
      "Write a task artifact (schema v4) to the dev server; it becomes the active task.",
    inputSchema: {
      type: "object",
      properties: { task: { type: "object", description: "schema v4 task payload" } },
      required: ["task"],
    },
  },
  {
    name: "print_task",
    description: "Print the active task artifact as JSON (optional taskId match).",
    inputSchema: {
      type: "object",
      properties: { taskId: { type: "string" } },
    },
  },
  {
    name: "current_screenshot",
    description:
      "Request a fresh annotated viewport screenshot via the dev command; returns the file reference (never inline pixels).",
    inputSchema: {
      type: "object",
      properties: { annotations: { type: "array", items: { type: "object" } } },
    },
  },
  {
    name: "read_diagnostics",
    description: "Read the active task's runtime diagnostics ring buffer.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "wait_verification",
    description:
      "Bounded-wait update verification: waits for the browser to acknowledge the edit (reload bump authoritative, HMR ack informational) and returns {revision, diagnostics, screenshot, state}.",
    inputSchema: {
      type: "object",
      properties: { timeoutMs: { type: "number" } },
    },
  },
];

const callTool = async (name, args) => {
  switch (name) {
    case "capture_task": {
      if (!args || typeof args.task !== "object" || args.task === null) {
        throw new Error("capture_task requires a task object");
      }
      const payload = await endpointCall(TASKS_PATH, args.task, readToken());
      return JSON.stringify(payload, null, 2);
    }
    case "print_task": {
      const task = readActiveTask();
      if (args?.taskId !== undefined && args.taskId !== task.taskId) {
        throw new Error(
          `task "${args.taskId}" not found (active task is "${task.taskId}")`
        );
      }
      return JSON.stringify(task, null, 2);
    }
    case "current_screenshot": {
      const token = readToken();
      let previousCapturedAt;
      try {
        previousCapturedAt = readActiveTask().screenshot?.capturedAt;
      } catch {
        previousCapturedAt = undefined;
      }
      await endpointCall(
        SCREENSHOT_COMMAND_PATH,
        args?.annotations ? { annotations: args.annotations } : {},
        token
      );
      // Bounded wait for the browser to fulfill the command (1s poll).
      let task = null;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        try {
          task = readActiveTask();
        } catch {
          continue;
        }
        if (
          task.screenshot?.capturedAt &&
          task.screenshot.capturedAt !== previousCapturedAt
        ) {
          break;
        }
      }
      if (!task?.screenshot) {
        throw new Error("no screenshot recorded; is the browser online?");
      }
      // File reference only — never inline pixel data.
      return JSON.stringify(
        {
          file: task.screenshot.file,
          width: task.screenshot.width,
          height: task.screenshot.height,
          capturedAt: task.screenshot.capturedAt,
          fresh: task.screenshot.capturedAt !== previousCapturedAt,
        },
        null,
        2
      );
    }
    case "read_diagnostics":
      return readDiagnostics();
    case "wait_verification": {
      const timeoutMs =
        typeof args?.timeoutMs === "number" ? args.timeoutMs : undefined;
      const payload = await endpointCall(
        VERIFY_PATH,
        timeoutMs === undefined ? {} : { timeoutMs },
        readToken()
      );
      return JSON.stringify(payload, null, 2);
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
};

const handleRequest = async (message) => {
  if (message.method === "initialize") {
    return {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    };
  }
  if (message.method === "ping") {
    return {};
  }
  if (message.method === "tools/list") {
    return { tools: TOOLS };
  }
  if (message.method === "tools/call") {
    const { name, arguments: args } = message.params ?? {};
    if (!name) {
      throw new Error("tools/call requires a tool name");
    }
    try {
      const text = await callTool(name, args ?? {});
      return { content: [{ type: "text", text }], isError: false };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: error instanceof Error ? error.message : String(error),
          },
        ],
        isError: true,
      };
    }
  }
  if (message.method === "notifications/initialized") {
    return undefined;
  }
  throw new Error(`unsupported method: ${message.method}`);
};

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    process.stdout.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } })}\n`
    );
    return;
  }
  // Notifications carry no id and get no response.
  if (message.id === undefined) return;
  try {
    const result = await handleRequest(message);
    if (result !== undefined) {
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n`
      );
    }
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: -32601,
          message: error instanceof Error ? error.message : String(error),
        },
      })}\n`
    );
  }
});
