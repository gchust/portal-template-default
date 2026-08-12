> **ARCHIVED — DO NOT IMPLEMENT — superseded by React Grab single-engine migration v1**
>
> This plan promoted the custom Fiber/module-graph perception adapter and v1–v5 schema
> compatibility. The migration contract (docs/exec-plans/portal-studio-react-grab-migration-v1/)
> is the only normative source; schema v6 and react-grab/primitives are the only supported
> engine. Kept for history only.

# Portal Studio — optional stdio MCP server configuration

The MCP server is an **optional enhancement** (contract §9): it exposes the
same capabilities as the JSON/file path as first-class MCP tools, operating on
the same `.portal-studio/tasks/active-task.json` artifact and the same
token-protected dev endpoints. The JSON path stays fully compatible and
first-class; nothing is implemented only behind MCP. Credentials never enter
frontend code: the token is read by the Node process from the local
`session.json` (or an env override) only.

## Requirements

- Node.js ≥ 18 (the dev machine already runs the Vite dev server).
- The Portal dev server must be running (`pnpm dev`) — the server owns the
  session token, the task endpoints, and the browser evidence loop.

## Launch

```bash
node scripts/portal-studio-mcp.mjs
```

Environment:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORTAL_STUDIO_DIR` | `./.portal-studio` | Studio runtime directory (task files, session file) |
| `PORTAL_STUDIO_ORIGIN` | `http://127.0.0.1:5173` | Dev server origin (change for other ports) |
| `PORTAL_STUDIO_TOKEN` | read from `session.json` | Session token override |

Example with a custom port:

```bash
PORTAL_STUDIO_ORIGIN=http://127.0.0.1:5176 node scripts/portal-studio-mcp.mjs
```

## Transport

MCP stdio transport: newline-delimited JSON-RPC 2.0 messages on stdin/stdout.
Works with any MCP client that supports stdio servers (e.g. Claude Desktop /
Codex MCP config).

## Tools

| Tool | Arguments | Returns |
| --- | --- | --- |
| `capture_task` | `task` (schema v4 payload) | Endpoint result (`{ok, taskId, file, sourceCandidates}`) |
| `print_task` | `taskId?` (optional match) | Active task JSON, normalized to schema v5 via the shared formatter (byte-identical to `portal-studio-print.mjs --json`) |
| `current_screenshot` | `annotations?` (rects) | File reference `{file, width, height, capturedAt, fresh}` — never inline pixels |
| `read_diagnostics` | — | Active task diagnostics ring buffer |
| `wait_verification` | `timeoutMs?` (default 10000, max 30000) | `{ok, state, revision, diagnostics, screenshot}` |

## Parity with the JSON path

Every tool maps 1:1 to the JSON/file path:

| MCP tool | JSON/file equivalent |
| --- | --- |
| `capture_task` | `POST /__portal-studio/tasks` (curl / `fetch` with `X-Portal-Studio-Token`) |
| `print_task` | `node scripts/portal-studio-print.mjs --json` |
| `current_screenshot` | `POST /__portal-studio/screenshot` + artifact read |
| `read_diagnostics` | `node scripts/portal-studio-print.mjs --json` (diagnostics section) |
| `wait_verification` | `node scripts/portal-studio-verify.mjs [--timeout-ms <ms>]` |

The parity is enforced by tests (`tests/logic/portal-studio/mcp.test.ts`:
file-tool parity against the print CLI; endpoint-path parity against the
plugin constants) and by the E2E smoke (all five tools against the live dev
server).

## Security notes

- The token is read in-process (env or `session.json`, mode 0600); it is never
  sent to the frontend and never written into artifacts.
- Screenshots are returned as file references; pixel data is never inlined in
  tool results.
- All endpoint calls reuse the same loopback/token/constant-time guards as the
  JSON path (404 on missing/wrong token).
