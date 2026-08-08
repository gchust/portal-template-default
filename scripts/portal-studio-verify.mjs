#!/usr/bin/env node
/**
 * Portal Studio — verify command (zero runtime dependencies).
 *
 * Runs the bounded-wait update verification against the dev server's
 * `/__portal-studio/verify` endpoint and prints the outcome for any shell
 * agent. This is the JSON/file path's first-class verification command; the
 * optional MCP `wait_verification` tool calls the same endpoint.
 *
 * Usage:
 *   node scripts/portal-studio-verify.mjs [--timeout-ms <ms>] [--json]
 *
 * Environment:
 *   PORTAL_STUDIO_DIR     studio runtime directory (default: ./.portal-studio)
 *   PORTAL_STUDIO_ORIGIN  dev server origin (default: http://127.0.0.1:5173)
 *   PORTAL_STUDIO_TOKEN   session token override (default: session.json)
 *
 * Exit codes: 0 matched (or completed:true — G04), 1 stale, 2 error.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const VERIFY_PATH = "/__portal-studio/verify";

function parseArguments(argv) {
  let timeoutMs;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--timeout-ms") {
      const value = Number(argv[index + 1]);
      if (!Number.isFinite(value) || value < 1000) {
        throw new Error("--timeout-ms must be a number >= 1000");
      }
      timeoutMs = Math.min(value, 30000);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return timeoutMs;
}

function readToken(studioRoot) {
  if (process.env.PORTAL_STUDIO_TOKEN) return process.env.PORTAL_STUDIO_TOKEN;
  const sessionPath = path.join(studioRoot, "session.json");
  const session = JSON.parse(readFileSync(sessionPath, "utf8"));
  if (typeof session.token !== "string" || !session.token) {
    throw new Error("session.json has no token");
  }
  return session.token;
}

async function main() {
  const timeoutMs = parseArguments(process.argv.slice(2));
  const studioRoot = process.env.PORTAL_STUDIO_DIR
    ? path.resolve(process.env.PORTAL_STUDIO_DIR)
    : path.resolve(".portal-studio");
  const origin = process.env.PORTAL_STUDIO_ORIGIN ?? "http://127.0.0.1:5173";
  const token = readToken(studioRoot);

  const response = await fetch(`${origin}${VERIFY_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Portal-Studio-Token": token,
    },
    body: JSON.stringify(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  const payload = await response.json();
  if (!response.ok || payload.ok !== true) {
    process.stderr.write(
      `[portal-studio] verify failed (HTTP ${response.status}): ${JSON.stringify(payload)}\n`
    );
    process.exitCode = 2;
    return;
  }
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  // G04: a fully completed task exits 0 with completed:true (no edit
  // wait needed); open-task semantics are unchanged (matched/stale).
  process.exitCode =
    payload.state === "matched" || payload.completed === true ? 0 : 1;
}

main().catch((error) => {
  process.stderr.write(`[portal-studio] ${error.message}\n`);
  process.exitCode = 2;
});
