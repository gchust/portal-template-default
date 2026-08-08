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

import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

import type { Plugin, ViteDevServer } from "vite";

import {
  atomicWriteSessionFile,
  atomicWriteTaskFile,
  buildHeartbeatReport,
  buildRevisionInfo,
  clearActiveTask,
  commitEvidence,
  computeSourceRevision,
  createServerRecorder,
  DEFAULT_WAIT_TIMEOUT_MS,
  deriveHeartbeatState,
  generateSessionToken,
  matchesPendingEvidence,
  MAX_ARTIFACT_BYTES,
  MAX_SCREENSHOT_BODY_BYTES,
  MAX_TASK_BODY_BYTES,
  parseHeartbeatPayload,
  parseScreenshotPayload,
  performBoundedWait,
  readActiveTask,
  readReferencedScreenshot,
  redactSessionToken,
  removeScreenshotFile,
  resolveActiveTaskPath,
  sanitizeDiagnostics,
  sanitizeTask,
  SESSION_FILENAME,
  updateActiveTaskEvidence,
  verifySessionToken,
} from "./endpoint";
import { existsSync, readFileSync } from "node:fs";
import type {
  ElementCapture,
  PortalStudioTask,
  SourceCandidate,
} from "./types";

const TASKS_ENDPOINT_PATH = "/__portal-studio/tasks";
const SCREENSHOTS_ENDPOINT_PATH = "/__portal-studio/screenshots";
const HEARTBEAT_ENDPOINT_PATH = "/__portal-studio/heartbeat";
const SCREENSHOT_COMMAND_ENDPOINT_PATH = "/__portal-studio/screenshot";
const PENDING_ENDPOINT_PATH = "/__portal-studio/screenshot/pending";
const BOOTSTRAP_ENDPOINT_PATH = "/__portal-studio/bootstrap";
const VERIFY_ENDPOINT_PATH = "/__portal-studio/verify";
const MAX_VERIFY_BODY_BYTES = 1024;
const TOKEN_HEADER = "x-portal-studio-token";
const MAX_HEARTBEAT_BODY_BYTES = 1024;
const MAX_SCREENSHOT_COMMAND_BODY_BYTES = 16 * 1024;
const MAX_ANNOTATIONS = 20;
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
  let sessionFilePersisted = false;
  const sessionPath = path.join(studioRoot, SESSION_FILENAME);
  let lastHeartbeatAtMs: number | undefined;
  let lastIssuedBrowserRevision = 0;
  let lastHotUpdateAtMs = 0;
  let pendingEvidence: {
    requestId: string;
    taskId?: string;
    annotations?: Array<{ x: number; y: number; width: number; height: number }>;
  } | null = null;

  /**
   * Content hash of the task-referenced source files, computed from disk at
   * read time (contract §10). Missing files hash as a path marker so edits
   * and deletions both change the revision.
   */
  const computeTaskSourceRevision = (task: {
    elements: Array<{ sourceCandidates: SourceCandidate[] }>;
  }): string => {
    const files = new Map<string, string>();
    for (const element of task.elements) {
      for (const candidate of element.sourceCandidates) {
        if (files.size >= 20) break;
        if (files.has(candidate.file)) continue;
        let content = "";
        try {
          content = readFileSync(candidate.file, "utf8");
        } catch {
          content = "<missing>";
        }
        files.set(candidate.file, content);
      }
    }
    return computeSourceRevision(
      [...files.entries()].map(([file, content]) => ({ file, content }))
    );
  };

  const readActiveHeartbeat = () => {
    try {
      const task = readActiveTask(studioRoot);
      return task?.heartbeat;
    } catch {
      return undefined;
    }
  };

  const sanitizeAnnotations = (input: unknown) => {
    if (!isRecordLike(input) || !Array.isArray(input.annotations)) {
      return undefined;
    }
    const rects: Array<{ x: number; y: number; width: number; height: number }> = [];
    for (const raw of input.annotations.slice(0, MAX_ANNOTATIONS)) {
      if (!isRecordLike(raw)) continue;
      const clamp = (value: unknown, max: number) =>
        typeof value === "number" && Number.isFinite(value)
          ? Math.min(Math.max(0, Math.round(value)), max)
          : undefined;
      const x = clamp(raw.x, 1_000_000);
      const y = clamp(raw.y, 1_000_000);
      const width = clamp(raw.width, 1_000_000);
      const height = clamp(raw.height, 1_000_000);
      if (x === undefined || y === undefined || width === undefined || height === undefined) {
        continue;
      }
      rects.push({ x, y, width, height });
    }
    return rects.length ? rects : undefined;
  };

  /** In-memory token only — never touches the session file at config time. */
  const ensureToken = () => {
    if (!sessionToken) sessionToken = generateSessionToken();
    return sessionToken;
  };

  /**
   * Persist the session file. ONLY the instance that actually succeeded in
   * listening may write it: a second instance on the same port with
   * `strictPort` fails to bind, its `listening` event never fires, and it
   * must never overwrite the active instance's session file (which would
   * invalidate the live token for shell agents). Write is atomic (tmp +
   * rename, 0600).
   */
  const persistSessionFile = () => {
    if (sessionFilePersisted && existsSync(sessionPath)) return;
    atomicWriteSessionFile(
      sessionPath,
      JSON.stringify(
        {
          token: ensureToken(),
          createdAt: new Date().toISOString(),
          endpoint: TASKS_ENDPOINT_PATH,
        },
        null,
        2
      )
    );
    sessionFilePersisted = true;
    console.log(
      `[portal-studio] dev session ready: token in ${sessionPath} (endpoint ${TASKS_ENDPOINT_PATH}, dev server only)`
    );
  };

  return {
    name: "portal-studio",
    apply: "serve",
    configResolved() {
      // Deliberately no file side effects: the session file is persisted
      // only after this instance successfully listens (see configureServer).
      ensureToken();
    },
    transformIndexHtml() {
      const config = JSON.stringify({
        token: ensureToken(),
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
    handleHotUpdate() {
      // Informational HMR ack: a hot update was served to the browser. The
      // reload bump remains the authoritative success signal (contract §10,
      // D-019).
      lastHotUpdateAtMs = Date.now();
      return undefined;
    },
    configureServer(server) {
      // Persist the session file only once this instance is actually
      // listening: a strictPort bind failure (port taken) means the
      // `listening` event never fires and the failed instance leaves the
      // active instance's session file untouched.
      if (server.httpServer?.listening) {
        persistSessionFile();
      } else {
        server.httpServer?.once("listening", () => {
          persistSessionFile();
        });
      }
      server.middlewares.use(
        async (
          request: IncomingMessage,
          response: ServerResponse,
          next: () => void
        ) => {
          const isTaskPost =
            request.method === "POST" && request.url === TASKS_ENDPOINT_PATH;
          const isTaskGet =
            request.method === "GET" && request.url === TASKS_ENDPOINT_PATH;
          const isScreenshotPost =
            request.method === "POST" &&
            request.url === SCREENSHOTS_ENDPOINT_PATH;
          const isTaskDelete =
            request.method === "DELETE" && request.url === TASKS_ENDPOINT_PATH;
          const isHeartbeatPost =
            request.method === "POST" &&
            request.url === HEARTBEAT_ENDPOINT_PATH;
          const isScreenshotCommandPost =
            request.method === "POST" &&
            request.url === SCREENSHOT_COMMAND_ENDPOINT_PATH;
          const isPendingGet =
            request.method === "GET" &&
            request.url === PENDING_ENDPOINT_PATH;
          const isBootstrapPost =
            request.method === "POST" &&
            request.url === BOOTSTRAP_ENDPOINT_PATH;
          const isVerifyPost =
            request.method === "POST" && request.url === VERIFY_ENDPOINT_PATH;
          if (
            !isTaskPost &&
            !isTaskGet &&
            !isScreenshotPost &&
            !isTaskDelete &&
            !isHeartbeatPost &&
            !isScreenshotCommandPost &&
            !isPendingGet &&
            !isBootstrapPost &&
            !isVerifyPost
          ) {
            next();
            return;
          }
          // A serving instance is by definition the successful listener, so
          // self-healing the file here is safe (it owns the port); the file
          // is re-created with the SAME in-memory token if it was deleted.
          if (
            (!sessionFilePersisted || !existsSync(sessionPath)) &&
            server.httpServer?.listening
          ) {
            persistSessionFile();
          }

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

          // GET routes carry no body and must not enter the JSON parser.
          if (isTaskGet) {
            const task = readActiveTask(studioRoot);
            if (!task) {
              writeJsonResponse(response, 404, { error: "no_active_task" });
              return;
            }
            writeJsonResponse(response, 200, { task });
            return;
          }

          if (isPendingGet) {
            writeJsonResponse(response, 200, {
              pending: pendingEvidence !== null,
              ...(pendingEvidence ? { request: pendingEvidence } : {}),
            });
            return;
          }

          // Browser bootstrap: issues a fresh monotonic browser revision.
          // Full reloads re-run the bootstrap, so the counter bump is the
          // authoritative "the page restarted" signal (contract §10). No
          // body, so it returns before the JSON parser.
          if (isBootstrapPost) {
            lastIssuedBrowserRevision += 1;
            writeJsonResponse(response, 200, {
              ok: true,
              browserRevision: lastIssuedBrowserRevision,
            });
            return;
          }

          const bodyLimit = isScreenshotPost
            ? MAX_SCREENSHOT_BODY_BYTES
            : isVerifyPost
              ? MAX_VERIFY_BODY_BYTES
              : isHeartbeatPost
                ? MAX_HEARTBEAT_BODY_BYTES
                : isScreenshotCommandPost
                  ? MAX_SCREENSHOT_COMMAND_BODY_BYTES
                  : MAX_TASK_BODY_BYTES;
          const read = await readRequestBody(request, bodyLimit);
          if (!read.ok) {
            writeJsonResponse(response, read.status, {
              error: "payload_too_large",
              limit: bodyLimit,
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

          if (isVerifyPost) {
            const payload = isRecordLike(raw) ? raw : {};
            const requestedTimeout =
              typeof payload.timeoutMs === "number" &&
              Number.isFinite(payload.timeoutMs)
                ? payload.timeoutMs
                : DEFAULT_WAIT_TIMEOUT_MS;
            const timeoutMs = Math.min(Math.max(requestedTimeout, 1_000), 30_000);
            const startMs = Date.now();
            const expectedAfter = new Date(startMs + timeoutMs).toISOString();
            const activeTask = readActiveTask(studioRoot);
            if (!activeTask) {
              writeJsonResponse(response, 400, { error: "no_active_task" });
              return;
            }
            const baselineBrowserRevision = activeTask.revision?.browserRevision;
            // The HMR ack reference is the task's baseline timestamp: the
            // agent's edit (and its hot update) happens BETWEEN the capture
            // and the verify call, so comparing against the wait start
            // would never see it (D-020).
            const baselineCheckedAtMs =
              Date.parse(activeTask.revision?.checkedAt ?? "") || startMs;
            const hmrAck = lastHotUpdateAtMs >= baselineCheckedAtMs;
            const sourceRevision = computeTaskSourceRevision(activeTask);
            const wait = await performBoundedWait({
              timeoutMs,
              now: Date.now,
              sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
              readState: () => ({
                browserRevision: lastIssuedBrowserRevision,
                baselineBrowserRevision,
                hmrAck,
                heartbeatOnline:
                  deriveHeartbeatState(lastHeartbeatAtMs, Date.now()) ===
                  "online",
              }),
            });
            const state = wait.matched ? "matched" : "stale";
            const revision = buildRevisionInfo(
              sourceRevision,
              lastIssuedBrowserRevision,
              hmrAck,
              state,
              Date.now(),
              expectedAfter
            );
            const update = updateActiveTaskEvidence(studioRoot, { revision });
            if (!update.ok) {
              writeJsonResponse(response, 400, { error: "revision_update_failed" });
              return;
            }
            const updatedTask = readActiveTask(studioRoot);
            writeJsonResponse(response, 200, {
              ok: true,
              state,
              revision,
              diagnostics: updatedTask?.diagnostics ?? [],
              screenshot: updatedTask?.screenshot ?? null,
            });
            return;
          }

          if (isHeartbeatPost) {
            // D-016: only the server receipt time is authoritative; the
            // client payload.ts is ignored (validated only as an object).
            const receipt = parseHeartbeatPayload(raw, Date.now());
            if (!receipt.ok) {
              writeJsonResponse(response, 400, { error: "invalid_heartbeat" });
              return;
            }
            lastHeartbeatAtMs = receipt.receivedAtMs;
            writeJsonResponse(response, 200, { ok: true });
            return;
          }

          if (isScreenshotCommandPost) {
            // Evidence refresh command: recompute the authoritative
            // heartbeat NOW (even when the page is gone) and queue the
            // browser-side capture for the fresh PNG + diagnostics.
            const nowMs = Date.now();
            const heartbeat = buildHeartbeatReport(
              lastHeartbeatAtMs,
              nowMs,
              readActiveHeartbeat()
            );
            const update = updateActiveTaskEvidence(studioRoot, { heartbeat });
            if (!update.ok) {
              writeJsonResponse(response, 400, {
                error: update.error === "no_active_task" ? "no_active_task" : "write_failed",
              });
              return;
            }
            const activeTask = readActiveTask(studioRoot);
            pendingEvidence = {
              requestId: randomBytes(16).toString("hex"),
              taskId: activeTask?.taskId,
              annotations: sanitizeAnnotations(raw),
            };
            writeJsonResponse(response, 200, {
              ok: true,
              requestId: pendingEvidence.requestId,
              heartbeat,
            });
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
            // Strict diagnostics: provided-but-invalid/over-budget payloads
            // are rejected up front (before any file is written), never
            // silently degraded to an empty array.
            const recorder = createServerRecorder();
            const diagnostics = sanitizeDiagnostics(
              payload.diagnostics,
              recorder
            );
            if (diagnostics === null) {
              writeJsonResponse(response, 400, {
                error: "invalid_diagnostics",
              });
              return;
            }
            const committed = commitEvidence(studioRoot, {
              taskId,
              pngBuffer: parsed.buffer,
              width: parsed.width,
              height: parsed.height,
              diagnostics,
              heartbeat: buildHeartbeatReport(
                lastHeartbeatAtMs,
                Date.now(),
                readActiveHeartbeat()
              ),
            });
            if (!committed.ok) {
              writeJsonResponse(response, 400, {
                error:
                  committed.error === "artifact_too_large"
                    ? "artifact_too_large"
                    : "evidence_update_failed",
              });
              return;
            }
            // Pending is cleared ONLY after the evidence update succeeded
            // AND requestId + taskId both match exactly.
            if (
              matchesPendingEvidence(pendingEvidence, payload.requestId, taskId)
            ) {
              pendingEvidence = null;
            }
            writeJsonResponse(response, 200, {
              ok: true,
              file: committed.file,
              width: committed.width,
              height: committed.height,
              bytes: parsed.buffer.length,
              capturedAt: committed.capturedAt,
            });
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
          // Stamp the initial revision bookkeeping (schema v4): the source
          // revision is the pre-edit baseline; the browser revision is the
          // latest bootstrap counter; state starts as pending.
          const stampedTask = JSON.parse(finalized.serialized) as PortalStudioTask;
          stampedTask.revision = buildRevisionInfo(
            computeTaskSourceRevision(stampedTask),
            lastIssuedBrowserRevision,
            false,
            "pending",
            Date.now()
          );
          const stamped = JSON.stringify(stampedTask, null, 2);
          if (Buffer.byteLength(stamped, "utf8") > MAX_ARTIFACT_BYTES) {
            writeJsonResponse(response, 400, { error: "artifact_too_large" });
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
          atomicWriteTaskFile(studioRoot, "active-task.json", stamped);
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
