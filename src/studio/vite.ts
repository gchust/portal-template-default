/**
 * Build the inline bootstrap module for the dev HTML. The import specifier
 * must be BASE-AWARE: portals deployed under a non-root base (e.g.
 * /x/<portal>/) serve dev modules under that base, so a root-relative
 * "/src/studio/index.tsx" import would 404 (D-025, found by the Goal 06
 * dogfood acceptance).
 */
export function buildStudioInitScript(base: string): string {
  const normalizedBase = /\/$/.test(base) ? base : `${base}/`;
  const entry = `${normalizedBase}src/studio/index.tsx`;
  return [
    `import { mountPortalStudio } from ${JSON.stringify(entry)};`,
    `mountPortalStudio(window.__PORTAL_STUDIO_CONFIG__);`,
  ].join("\n");
}

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
import { networkInterfaces } from "node:os";

import type { Plugin, ViteDevServer } from "vite";

import {
  atomicWriteSessionFile,
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
  readTaskRevision,
  redactSessionToken,
  removeScreenshotFile,
  resolveActiveTaskPath,
  sanitizeDiagnostics,
  sanitizeTask,
  SESSION_FILENAME,
  updateActiveTaskEvidence,
  verifySessionToken,
  writeActiveTaskSerialized,
} from "./endpoint";
import { existsSync, readFileSync } from "node:fs";
import { isTaskCompleted } from "./format.ts";
import { normalizeTask } from "./task-model.ts";
import {
  applyMutationOperations,
  parseMutationRequest,
} from "./mutation";
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
const REVISION_ENDPOINT_PATH = "/__portal-studio/revision";
const MUTATE_ENDPOINT_PATH = "/__portal-studio/mutate";
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
  /**
   * Goal 06: remote access is EXPLICITLY opt-in via
   * NOCOBASE_PORTAL_STUDIO_ALLOW_REMOTE === "true" (default false) — never
   * hard-coded. When enabled, Studio endpoints accept non-loopback sources
   * but the session token is STILL required; host/origin source checks are
   * retained for the default (disabled) path. A clear dev-only warning is
   * printed when enabled.
   */
  allowRemote?: boolean;
};

export const isLoopbackAddress = (address: string | undefined) =>
  address === "127.0.0.1" ||
  address === "::1" ||
  address === "::ffff:127.0.0.1" ||
  address === undefined;

let ownAddressCache: Set<string> | null = null;

/**
 * All IPs of this machine (loopback, LAN, containers). Dev access through
 * the machine's own LAN address (e.g. 192.168.2.199) is the same operator;
 * the loopback-only check incorrectly treated it as remote (D-031).
 */
export const ownServerAddresses = (): ReadonlySet<string> => {
  if (!ownAddressCache) {
    const set = new Set<string>();
    for (const entries of Object.values(networkInterfaces())) {
      for (const entry of entries ?? []) {
        set.add(entry.address);
        if (entry.family === "IPv4") {
          set.add(`::ffff:${entry.address}`);
        }
      }
    }
    ownAddressCache = set;
  }
  return ownAddressCache;
};

/**
 * Trusted dev-machine source: loopback (legacy contract §7) or any address
 * bound to this machine (LAN dev access). Remote machines stay rejected
 * unless the plugin is configured with `allowRemote` (D-031).
 */
export const isTrustedStudioSource = (address: string | undefined): boolean =>
  isLoopbackAddress(address) ||
  (address ? ownServerAddresses().has(address) : false);

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
  const elements = assignSourceCandidates(
    task.annotations.flatMap((annotation) => annotation.elements),
    resolved
  );
  // Re-assign the resolved candidates back into the per-annotation lists
  // (they were flattened only for resolution; order is preserved).
  let elementIndex = 0;
  const annotations = task.annotations.map((annotation) => ({
    ...annotation,
    elements: annotation.elements.map((element) => {
      const assigned = elements[elementIndex];
      elementIndex += 1;
      return assigned ?? element;
    }),
  }));
  const serialized = redactSessionToken(
    JSON.stringify({ ...task, annotations }, null, 2),
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

/**
 * Goal 06: remote access is EXPLICITLY opt-in via
 * NOCOBASE_PORTAL_STUDIO_ALLOW_REMOTE === "true" (exact string; default
 * false). Pure and testable.
 */
export function resolveAllowRemote(envValue: string | undefined): boolean {
  return envValue === "true";
}

export function portalStudioPlugin(
  options: PortalStudioPluginOptions = {}
): Plugin {
  const allowRemote = options.allowRemote === true;
  if (allowRemote) {
    // Goal 06: clear dev-only warning when remote access is opted in —
    // never includes the session token or any other secret.
    console.warn(
      "[portal-studio] remote access ENABLED (NOCOBASE_PORTAL_STUDIO_ALLOW_REMOTE=true): Studio endpoints accept non-loopback clients; the per-session token is still required. Development use only."
    );
  }
  const root = path.resolve(options.root ?? process.cwd());
  const studioRoot = path.resolve(root, ".portal-studio");
  let sessionToken = "";
  let sessionFilePersisted = false;
  const sessionPath = path.join(studioRoot, SESSION_FILENAME);
  let resolvedBase = "/";
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
    annotations: Array<{ elements: Array<{ sourceCandidates: SourceCandidate[] }> }>;
  }): string => {
    const files = new Map<string, string>();
    for (const annotation of task.annotations) {
      for (const element of annotation.elements) {
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
    configResolved(config) {
      // Deliberately no file side effects: the session file is persisted
      // only after this instance successfully listens (see configureServer).
      resolvedBase = config.base ?? "/";
      ensureToken();
    },
    transformIndexHtml() {
      const config = JSON.stringify({
        token: ensureToken(),
        endpoint: TASKS_ENDPOINT_PATH,
        screenshotsEndpoint: SCREENSHOTS_ENDPOINT_PATH,
        revisionEndpoint: REVISION_ENDPOINT_PATH,
        mutateEndpoint: MUTATE_ENDPOINT_PATH,
      });
      // Inline module scripts in dev index.html are processed by Vite, so the
      // studio entry import resolves through the dev transform pipeline. The
      // script only exists in the dev-served HTML (apply: "serve"), so
      // production builds contain neither the script nor the import. The
      // entry specifier is base-aware (D-025).
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
          children: buildStudioInitScript(resolvedBase),
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
          const isRevisionGet =
            request.method === "GET" && request.url === REVISION_ENDPOINT_PATH;
          const isMutatePost =
            request.method === "POST" && request.url === MUTATE_ENDPOINT_PATH;
          if (
            !isTaskPost &&
            !isTaskGet &&
            !isScreenshotPost &&
            !isTaskDelete &&
            !isHeartbeatPost &&
            !isScreenshotCommandPost &&
            !isPendingGet &&
            !isBootstrapPost &&
            !isVerifyPost &&
            !isRevisionGet &&
            !isMutatePost
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

          // Dev-machine enforcement (contract §7, D-031): loopback or the
          // server's own interface IPs; remote machines stay rejected unless
          // the plugin opts in via allowRemote (still token-protected).
          if (
            !allowRemote &&
            !isTrustedStudioSource(request.socket.remoteAddress)
          ) {
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

          // Goal 05: lightweight same-origin revision read — the browser
          // polls THIS (not the full task) and re-fetches the task only
          // when the value changes. null when no active task exists.
          if (isRevisionGet) {
            const activeTask = readActiveTask(studioRoot);
            writeJsonResponse(response, 200, {
              ok: true,
              taskRevision: activeTask ? readTaskRevision(studioRoot) : null,
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
            : isMutatePost
              ? MAX_TASK_BODY_BYTES
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
            // G04 (D-033 #13): a fully completed task is reported so the
            // verify CLI can exit 0 without waiting for an edit.
            const completed = updatedTask
              ? isTaskCompleted(updatedTask)
              : false;
            writeJsonResponse(response, 200, {
              ok: true,
              state,
              completed,
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

          // Goal 06: typed revision-aware atomic mutation endpoint. The
          // browser/CLI send {taskId, expectedTaskRevision, operations};
          // the server applies the operations atomically and increments
          // taskRevision. A revision mismatch returns 409 with the current
          // metadata/task so the client can refresh, retry once, then show
          // explicit conflict feedback. Never silently overwrite another
          // client's completed state.
          if (isMutatePost) {
            const request = parseMutationRequest(raw);
            if (!request) {
              writeJsonResponse(response, 400, { error: "invalid_mutation_request" });
              return;
            }
            // Goal 04 B / §13: the typed mutation runs at the ONE
            // authoritative serialized write boundary — the locked
            // authoritative read, the expected-revision validation, the
            // normalize+apply+sanitize merge, the revision/updatedAt stamp
            // and the atomic persist are ONE critical section. A stale
            // writer gets a 409 (refresh + retry + conflict UI) and never
            // writes stale whole-task JSON.
            const written = writeActiveTaskSerialized(studioRoot, {
              expectedTaskRevision: request.expectedTaskRevision,
              apply: (authoritative) => {
                if (!authoritative) {
                  return { ok: false, error: "no_active_task" };
                }
                // P2-2 review: the typed ops apply against the NORMALIZED
                // v5 task (legacy v1–v4 artifacts have no annotations[]
                // and would crash the pure apply).
                const normalized = normalizeTask(authoritative);
                if (!normalized) return { ok: false, error: "invalid_task" };
                if (request.taskId !== normalized.taskId) {
                  return { ok: false, error: "task_id_mismatch" };
                }
                const applied = applyMutationOperations(
                  normalized,
                  request.operations
                );
                if (!applied.ok) return applied;
                // Defense in depth: the merged task passes the same server
                // whitelist sanitizer as the create path (redaction,
                // bounds, additive evidence, pageContext preserved).
                const sanitized = sanitizeTask(applied.task, {
                  studioRoot,
                });
                if (!sanitized) {
                  return { ok: false, error: "invalid_task" };
                }
                return { ok: true, task: sanitized };
              },
            });
            if (!written.ok) {
              if (written.error === "revision_conflict") {
                // 409 + current metadata/task → refresh + retry + UI.
                writeJsonResponse(response, 409, {
                  ok: false,
                  error: "revision_conflict",
                  taskRevision: written.taskRevision,
                  task: written.task,
                });
                return;
              }
              if (written.error === "no_active_task") {
                writeJsonResponse(response, 404, { error: "no_active_task" });
                return;
              }
              if (written.error === "lock_timeout") {
                writeJsonResponse(response, 503, { error: "write_busy" });
                return;
              }
              writeJsonResponse(response, 400, {
                error:
                  written.error === "annotation_not_found"
                    ? "annotation_not_found"
                    : written.error === "task_id_mismatch"
                      ? "task_id_mismatch"
                      : "invalid_mutation",
              });
              return;
            }
            writeJsonResponse(response, 200, {
              ok: true,
              taskRevision: written.revision,
              // The authoritative persisted task (the mutation client uses
              // it to update its local mirror).
              task: readActiveTask(studioRoot),
            });
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

          // P2-3 review: the create/save POST is revision-aware when the
          // client supplies its last-known taskRevision.
          const rawRecord = isRecordLike(raw) ? raw : {};
          const expectedCreateRevision =
            typeof rawRecord.expectedTaskRevision === "number"
              ? rawRecord.expectedTaskRevision
              : undefined;
          // Replace lifecycle: READ the superseded screenshot reference
          // BEFORE the write (best-effort cleanup of the replaced task's
          // PNG, never a data-loss path).
          const supersededScreenshot = readReferencedScreenshot(
            studioRoot,
            resolveActiveTaskPath(studioRoot)
          );
          // Goal 04 B / §13: the whole-task save runs at the ONE
          // authoritative serialized write boundary — the locked
          // authoritative read, the expected-revision validation (a stale
          // browser POST returns 409 and NEVER writes stale whole-task
          // JSON), the resolve+finalize merge, the revision/updatedAt
          // stamp and the atomic persist are ONE critical section.
          let resolved: SourceCandidate[] = [];
          const written = writeActiveTaskSerialized(studioRoot, {
            expectedTaskRevision: expectedCreateRevision,
            apply: (authoritative) => {
              void authoritative;
              const names = task.annotations.flatMap((annotation) =>
                annotation.elements.flatMap((element) =>
                  element.componentCandidates
                    .map((candidate) => candidate.name)
                    .filter(
                      (name): name is string => typeof name === "string"
                    )
                )
              );
              resolved = resolveComponentSources(server, names, root);
              const finalized = serializeTaskArtifact(
                task,
                resolved,
                sessionToken
              );
              if (!finalized.ok) {
                return { ok: false, error: "artifact_too_large" };
              }
              // Stamp the initial revision bookkeeping (schema v4): the
              // source revision is the pre-edit baseline; the browser
              // revision is the latest bootstrap counter; state starts as
              // pending.
              const stampedTask = JSON.parse(
                finalized.serialized
              ) as PortalStudioTask;
              stampedTask.revision = buildRevisionInfo(
                computeTaskSourceRevision(stampedTask),
                lastIssuedBrowserRevision,
                false,
                "pending",
                Date.now()
              );
              return { ok: true, task: stampedTask };
            },
          });
          if (!written.ok) {
            if (written.error === "revision_conflict") {
              writeJsonResponse(response, 409, {
                ok: false,
                error: "revision_conflict",
                taskRevision: written.taskRevision,
                task: written.task,
              });
              return;
            }
            if (written.error === "lock_timeout") {
              writeJsonResponse(response, 503, { error: "write_busy" });
              return;
            }
            writeJsonResponse(response, 400, { error: written.error });
            return;
          }
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
            // P2-3 review: the create response carries the stamped revision
            // so the client keeps its baseline in sync.
            taskRevision: written.revision,
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
