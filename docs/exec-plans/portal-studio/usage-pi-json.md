# Portal Studio — Pi / JSON usage guide

The JSON/file path is the first-class interface: every capability works with
plain shell commands and local files, no browser UI and no MCP required.

## The loop (annotate → read → edit → wait → verify)

```bash
# 1. ANNOTATE — in the browser: pick element(s)/region + instruction + Save.
#    Artifact: .portal-studio/tasks/active-task.json (schema v4)

# 2. READ
node scripts/portal-studio-print.mjs --json          # full artifact
node scripts/portal-studio-print.mjs --markdown      # summary (elements,
                                                     # components, sources,
                                                     # redaction manifest,
                                                     # diagnostics, heartbeat,
                                                     # screenshot, revision)

# 3. EDIT — modify the source files referenced by element.sourceCandidates.

# 4. WAIT (bounded) — dev server must be running.
node scripts/portal-studio-verify.mjs --timeout-ms 10000
# exit 0 matched / 1 stale / 2 error
# Full response (revision, diagnostics, screenshot, state):
curl -s -X POST http://127.0.0.1:5173/__portal-studio/verify \
  -H "Content-Type: application/json" \
  -H "X-Portal-Studio-Token: $(node -e "console.log(JSON.parse(require('fs').readFileSync('.portal-studio/session.json','utf8')).token)")" \
  -d '{"timeoutMs":10000}'

# 5. VERIFY EVIDENCE
node scripts/portal-studio-print.mjs --json | jq .diagnostics   # errors
node scripts/portal-studio-print.mjs --json | jq .heartbeat     # online/stale/offline
node scripts/portal-studio-print.mjs --json | jq .screenshot    # fresh PNG ref + capturedAt
```

## Agent-side operations (token from `.portal-studio/session.json`, mode 0600)

| Operation | Command |
| --- | --- |
| Write a task (agent-authored) | `POST /__portal-studio/tasks` with `X-Portal-Studio-Token` |
| Read the active task | `GET /__portal-studio/tasks` (token) or `portal-studio-print.mjs` |
| Request a fresh screenshot | `POST /__portal-studio/screenshot` → browser fulfills → artifact `screenshot.capturedAt` updates |
| Read diagnostics | `portal-studio-print.mjs --json` → `.diagnostics` |
| Bounded wait | `POST /__portal-studio/verify` or `portal-studio-verify.mjs` |
| Clear the task | `DELETE /__portal-studio/tasks` (token) |
| Heartbeat | the browser reports automatically; the server derives `online/stale/offline` from receipt time |

All endpoints: loopback only, token-guarded (404 on missing/wrong token),
bounded bodies, path-traversal safe, atomic writes.

## Without the browser (page closed)

`verify` still returns a server-derived heartbeat (stale/offline once the
report ages past the windows) and the last artifact state — never a
self-reported online. A fresh screenshot requires the browser; the command
response tells you the page state so you know whether to expect one.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `curl` 404 on every endpoint | Token missing/wrong (read `session.json`), or prod preview (dev-only endpoints). |
| `verify` exit 2 | Server unreachable — is `pnpm dev` running? Set `PORTAL_STUDIO_ORIGIN` for a non-default port. |
| `print` exit 1 | No active task — capture one first. |
| `.portal-studio` missing | First dev-server start creates it (session file persists on the listening instance). |
