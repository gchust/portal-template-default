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
  atomicWriteTaskFile,
  generateSessionToken,
  MAX_TASK_BODY_BYTES,
  redactSessionToken,
  resolveActiveTaskPath,
  sanitizeTask,
  SESSION_FILENAME,
  verifySessionToken,
} from "./endpoint";
import type { SourceCandidate } from "./types";

const ENDPOINT_PATH = "/__portal-studio/tasks";
const TOKEN_HEADER = "x-portal-studio-token";
const MAX_SOURCE_CANDIDATES = 8;

export type PortalStudioPluginOptions = {
  root?: string;
};

const isLoopbackAddress = (address: string | undefined) =>
  address === "127.0.0.1" ||
  address === "::1" ||
  address === "::ffff:127.0.0.1" ||
  address === undefined;

const readRequestBody = async (
  request: IncomingMessage
): Promise<{ ok: true; body: string } | { ok: false; status: number }> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_TASK_BODY_BYTES) {
      return { ok: false, status: 413 };
    }
    chunks.push(buffer);
  }
  return { ok: true, body: Buffer.concat(chunks).toString("utf8") };
};

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
      if (candidates.length >= MAX_SOURCE_CANDIDATES) break;
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

  return candidates.slice(0, MAX_SOURCE_CANDIDATES);
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
            endpoint: ENDPOINT_PATH,
          },
          null,
          2
        ),
        { encoding: "utf8", mode: 0o600 }
      );
      console.log(
        `[portal-studio] dev session ready: token in ${sessionPath} (endpoint ${ENDPOINT_PATH}, dev server only)`
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
        endpoint: ENDPOINT_PATH,
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
          if (request.method !== "POST" || request.url !== ENDPOINT_PATH) {
            next();
            return;
          }
          ensureSession();

          // Loopback-only enforcement (contract §7).
          if (!isLoopbackAddress(request.socket.remoteAddress)) {
            writeJsonResponse(response, 404, {
              error: "not_found",
            });
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

          const read = await readRequestBody(request);
          if (!read.ok) {
            writeJsonResponse(response, read.status, {
              error: "payload_too_large",
              limit: MAX_TASK_BODY_BYTES,
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

          const task = sanitizeTask(raw);
          if (!task) {
            writeJsonResponse(response, 400, { error: "invalid_task" });
            return;
          }

          const sourceCandidates = resolveComponentSources(
            server,
            task.element.componentCandidates
              .map((candidate) => candidate.name)
              .filter((name): name is string => typeof name === "string"),
            root
          );
          task.element.sourceCandidates = sourceCandidates;

          const serialized = redactSessionToken(
            JSON.stringify(task, null, 2),
            sessionToken
          );
          atomicWriteTaskFile(studioRoot, "active-task.json", serialized);

          writeJsonResponse(response, 200, {
            ok: true,
            taskId: task.taskId,
            writtenAt: new Date().toISOString(),
            file: resolveActiveTaskPath(studioRoot),
            sourceCandidates,
          });
        }
      );
    },
  };
}

export { ENDPOINT_PATH };
