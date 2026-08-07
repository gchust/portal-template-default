/**
 * Portal Studio — serve-only Vite plugin.
 *
 * Dev-only (apply: "serve"): owns the session token, the local task endpoint,
 * the dev HTML bootstrap injection, and server-side source-candidate
 * resolution against the Vite module graph. Never participates in production
 * builds: `pnpm build` does not run serve plugins, so no endpoint, token, or
 * injection code reaches `dist/` (verified by Goal 01 prod-exclusion
 * evidence).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

import type { Plugin, ViteDevServer } from "vite";

import {
  atomicWriteScreenshot,
  atomicWriteTaskFile,
  clearActiveTask,
  generateSessionToken,
  readReferencedScreenshot,
  removeScreenshotFile,
  MAX_ARTIFACT_BYTES,
  MAX_SCREENSHOT_BODY_BYTES,
  MAX_TASK_BODY_BYTES,
  parseScreenshotPayload,
  redactSessionToken,
  resolveActiveTaskPath,
  sanitizeTask,
  SESSION_FILENAME,
  verifySessionToken,
} from "./endpoint";
import type {
  ElementCapture,
  PortalStudioTask,
  SourceCandidate,
} from "./types";

const TASKS_ENDPOINT_PATH = "/__portal-studio/tasks";
const SCREENSHOTS_ENDPOINT_PATH = "/__portal-studio/screenshots";
const TOKEN_HEADER = "x-portal-studio-token";
const MAX_SOURCE_CANDIDATES_PER_NAME = 3;
const MAX_SOURCE_CANDIDATES_PER_ELEMENT = 5;
const MAX_TOTAL_SOURCE_CANDIDATES = 40;

export type PortalStudioPluginOptions = {
  root?: string;
};

const isLoopbackAddress = (address: string | undefined) =>
  address === "127.0.0.1" ||
  address === "::1" ||
  address === "::ffff:127.0.0.1" ||
  address === undefined;

/**
 * Read a request body up to the given byte limit. The limit is per-route:
 * task payloads use MAX_TASK_BODY_BYTES, screenshot payloads use
 * MAX_SCREENSHOT_BODY_BYTES (base64 PNG data may legitimately exceed 256 KB
 * while still far below the decoded 2 MB cap).
 */
export const readRequestBody = async (
  request: AsyncIterable<unknown>,
  limit: number
): Promise<{ ok: true; body: string } | { ok: false; status: number }> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk as Uint8Array);
    size += buffer.length;
    if (size > limit) {
      return { ok: false, status: 413 };
    }
    chunks.push(buffer);
  }
  return { ok: true, body: Buffer.concat(chunks).toString("utf8") };
};

const isRecordLike = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const writeJsonResponse = (
  response: ServerResponse,
  status: number,
  payload: Record<string, unknown>
) => {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
};

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

/**
 * Resolve component names to file/line candidates using the loaded Vite
 * module graph (dev-transformed code is unminified, so authored names match).
 */
export function resolveComponentSources(
  server: ViteDevServer,
  names: string[],
  root: string
): SourceCandidate[] {
  const candidates: SourceCandidate[] = [];
  const seen = new Set<string>();
  const uniqueNames = [...new Set(names.filter(Boolean))].slice(0, 30);
  if (!uniqueNames.length) return candidates;

  const modules = [...server.moduleGraph.urlToModuleMap.values()];
  const rootPath = path.resolve(root);

  for (const name of uniqueNames) {
    for (const module of modules) {
      if (candidates.length >= MAX_TOTAL_SOURCE_CANDIDATES) break;
      const file = module.file;
      if (!file) continue;
      const extension = path.extname(file);
      if (!SOURCE_EXTENSIONS.has(extension)) continue;
      const normalized = path.normalize(file);
      if (!normalized.startsWith(rootPath) || normalized.includes("node_modules")) {
        continue;
      }
      const code = module.transformResult?.code;
      if (!code) continue;

      const patterns = [
        new RegExp(`function\\s+${name}\\b`),
        new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*(?:function\\b|async\\s*\\(|\\(|\\w+\\s*=>)`),
        new RegExp(`\\b${name}\\s*=\\s*(?:function\\b|async\\s*\\(|\\(|\\w+\\s*=>)`),
      ];
      let matchIndex = -1;
      for (const pattern of patterns) {
        const match = pattern.exec(code);
        if (match) {
          matchIndex = match.index;
          break;
        }
      }
      if (matchIndex < 0) continue;

      const line = code.slice(0, matchIndex).split("\n").length;
      const key = `${file}:${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ kind: "module", file, line, name });
    }
  }

  return candidates;
}

/**
 * Assign resolved source candidates, serialize, re-verify the final UTF-8
 * artifact size (source-candidate backfill happens after `sanitizeTask`'s
 * own size check, so the limit must be re-enforced here), and redact the
 * session token. Returns the artifact text or a size rejection.
 */
export function serializeTaskArtifact(
  task: PortalStudioTask,
  resolved: SourceCandidate[],
  sessionToken: string
):
  | { ok: true; serialized: string }
  | { ok: false; error: "artifact_too_large" } {
  const elements = assignSourceCandidates(task.elements, resolved);
  const serialized = redactSessionToken(
    JSON.stringify({ ...task, elements }, null, 2),
    sessionToken
  );
  if (Buffer.byteLength(serialized, "utf8") > MAX_ARTIFACT_BYTES) {
    return { ok: false, error: "artifact_too_large" };
  }
  return { ok: true, serialized };
}

/**
 * Assign resolved module candidates back to each element by component name
 * (bounded per element and in total).
 */
export function assignSourceCandidates(
  elements: ElementCapture[],
  resolved: SourceCandidate[]
): ElementCapture[] {
  const byName = new Map<string, SourceCandidate[]>();
  for (const candidate of resolved) {
    if (!candidate.name) continue;
    const list = byName.get(candidate.name) ?? [];
    if (list.length < MAX_SOURCE_CANDIDATES_PER_NAME) list.push(candidate);
    byName.set(candidate.name, list);
  }
  let total = 0;
  return elements.map((element) => {
    if (total >= MAX_TOTAL_SOURCE_CANDIDATES) return element;
    const names = new Set(
      element.componentCandidates
        .map((candidate) => candidate.name)
        .filter((name): name is string => typeof name === "string")
    );
    const assigned: SourceCandidate[] = [];
    for (const name of names) {
      for (const candidate of byName.get(name) ?? []) {
        if (assigned.length >= MAX_SOURCE_CANDIDATES_PER_ELEMENT) break;
        assigned.push(candidate);
        total += 1;
        if (total >= MAX_TOTAL_SOURCE_CANDIDATES) break;
      }
      if (total >= MAX_TOTAL_SOURCE_CANDIDATES) break;
    }
    return { ...element, sourceCandidates: assigned };
  });
}

export function portalStudioPlugin(
  options: PortalStudioPluginOptions = {}
): Plugin {
  const root = path.resolve(options.root ?? process.cwd());
  const studioRoot = path.resolve(root, ".portal-studio");
  let sessionToken = "";

  const ensureSession = () => {
    mkdirSync(studioRoot, { recursive: true, mode: 0o700 });
    const sessionPath = path.join(studioRoot, SESSION_FILENAME);
    if (!sessionToken) {
      sessionToken = generateSessionToken();
      writeFileSync(
        sessionPath,
        JSON.stringify(
          {
            token: sessionToken,
            createdAt: new Date().toISOString(),
            endpoint: TASKS_ENDPOINT_PATH,
          },
          null,
          2
        ),
        { encoding: "utf8", mode: 0o600 }
      );
      console.log(
        `[portal-studio] dev session ready: token in ${sessionPath} (endpoint ${TASKS_ENDPOINT_PATH}, dev server only)`
      );
    }
  };

  return {
    name: "portal-studio",
    apply: "serve",
    configResolved() {
      ensureSession();
    },
    transformIndexHtml() {
      ensureSession();
      const config = JSON.stringify({
        token: sessionToken,
        endpoint: TASKS_ENDPOINT_PATH,
        screenshotsEndpoint: SCREENSHOTS_ENDPOINT_PATH,
      });
      // Inline module scripts in dev index.html are processed by Vite, so the
      // studio entry import resolves through the dev transform pipeline. The
      // script only exists in the dev-served HTML (apply: "serve"), so
      // production builds contain neither the script nor the import.
      return [
        {
          tag: "script",
          attrs: { id: "portal-studio-config" },
          children: `window.__PORTAL_STUDIO_CONFIG__ = ${config};`,
          injectTo: "head",
        },
        {
          tag: "script",
          attrs: { type: "module" },
          children: [
            `import { mountPortalStudio } from "/src/studio/index.tsx";`,
            `mountPortalStudio(window.__PORTAL_STUDIO_CONFIG__);`,
          ].join("\n"),
          // Must run after the react-refresh preamble, so append at the end
          // of <head> instead of prepending.
          injectTo: "head",
        },
      ];
    },
    configureServer(server) {
      server.middlewares.use(
        async (
          request: IncomingMessage,
          response: ServerResponse,
          next: () => void
        ) => {
          const isTaskPost =
            request.method === "POST" && request.url === TASKS_ENDPOINT_PATH;
          const isScreenshotPost =
            request.method === "POST" &&
            request.url === SCREENSHOTS_ENDPOINT_PATH;
          const isTaskDelete =
            request.method === "DELETE" && request.url === TASKS_ENDPOINT_PATH;
          if (!isTaskPost && !isScreenshotPost && !isTaskDelete) {
            next();
            return;
          }
          ensureSession();

          // Loopback-only enforcement (contract §7).
          if (!isLoopbackAddress(request.socket.remoteAddress)) {
            writeJsonResponse(response, 404, { error: "not_found" });
            return;
          }

          // Missing/wrong token is indistinguishable from a missing endpoint.
          const providedToken = request.headers[TOKEN_HEADER];
          if (
            !verifySessionToken(
              typeof providedToken === "string" ? providedToken : undefined,
              sessionToken
            )
          ) {
            writeJsonResponse(response, 404, { error: "not_found" });
            return;
          }

          if (isTaskDelete) {
            const result = clearActiveTask(studioRoot);
            writeJsonResponse(response, 200, { ok: true, ...result });
            return;
          }

          const read = await readRequestBody(
            request,
            isScreenshotPost ? MAX_SCREENSHOT_BODY_BYTES : MAX_TASK_BODY_BYTES
          );
          if (!read.ok) {
            writeJsonResponse(response, read.status, {
              error: "payload_too_large",
              limit: isScreenshotPost
                ? MAX_SCREENSHOT_BODY_BYTES
                : MAX_TASK_BODY_BYTES,
            });
            return;
          }

          let raw: unknown;
          try {
            raw = JSON.parse(read.body);
          } catch {
            writeJsonResponse(response, 400, { error: "invalid_json" });
            return;
          }

          if (isScreenshotPost) {
            const payload = isRecordLike(raw) ? raw : {};
            const base64 =
              typeof payload.png === "string" ? payload.png : undefined;
            const taskId =
              typeof payload.taskId === "string" ? payload.taskId : undefined;
            if (!base64 || !taskId) {
              writeJsonResponse(response, 400, {
                error: "invalid_screenshot_payload",
              });
              return;
            }
            const parsed = parseScreenshotPayload(base64);
            if (!parsed) {
              writeJsonResponse(response, 400, {
                error: "invalid_png",
              });
              return;
            }
            try {
              const file = atomicWriteScreenshot(
                studioRoot,
                taskId,
                parsed.buffer
              );
              writeJsonResponse(response, 200, {
                ok: true,
                file,
                width: parsed.width,
                height: parsed.height,
                bytes: parsed.buffer.length,
              });
            } catch {
              writeJsonResponse(response, 400, {
                error: "invalid_screenshot_name",
              });
              return;
            }
            return;
          }

          const task = sanitizeTask(raw, { studioRoot });
          if (!task) {
            writeJsonResponse(response, 400, { error: "invalid_task" });
            return;
          }

          const names = task.elements.flatMap((element) =>
            element.componentCandidates
              .map((candidate) => candidate.name)
              .filter((name): name is string => typeof name === "string")
          );
          const resolved = resolveComponentSources(server, names, root);
          const finalized = serializeTaskArtifact(task, resolved, sessionToken);
          if (!finalized.ok) {
            writeJsonResponse(response, 400, {
              error: "artifact_too_large",
            });
            return;
          }

          // Replace lifecycle, transaction-safe: only READ the superseded
          // task's screenshot reference before the write; delete it only
          // AFTER the new task is durably written, and only when the new
          // task does not reuse the same screenshot path (a same-path
          // screenshot was already overwritten by its own POST and must be
          // kept).
          const supersededScreenshot = readReferencedScreenshot(
            studioRoot,
            resolveActiveTaskPath(studioRoot)
          );
          atomicWriteTaskFile(
            studioRoot,
            "active-task.json",
            finalized.serialized
          );
          if (
            supersededScreenshot &&
            supersededScreenshot !== task.screenshot?.file
          ) {
            removeScreenshotFile(studioRoot, supersededScreenshot);
          }

          writeJsonResponse(response, 200, {
            ok: true,
            taskId: task.taskId,
            writtenAt: new Date().toISOString(),
            file: resolveActiveTaskPath(studioRoot),
            sourceCandidates: resolved,
          });
        }
      );
    },
  };
}

export {
  SCREENSHOTS_ENDPOINT_PATH,
  TASKS_ENDPOINT_PATH,
};
