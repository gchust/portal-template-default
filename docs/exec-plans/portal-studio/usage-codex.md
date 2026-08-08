# Portal Studio — Codex usage guide

Portal Studio is a dev-only agent feedback tool for this Portal. This guide
gets a fresh Codex agent from zero to a completed edit-verify loop. The JSON
path (below) is always available; the optional MCP path is equivalent.

## 0. Prerequisites

- The Portal dev server is running (`pnpm dev`).
- You are working in the Portal repo with the Studio enabled (dev mode).

## 1. Capture a task

Open the Portal in a browser. Use the Studio toolbar (bottom-right 🛠):

1. **Pick element** — hover a real element, click (Shift+click adds to a
   multi-selection; drag "Select region" for a marquee).
2. Type a **modification instruction**.
3. **Save task**.

The task is written atomically to `.portal-studio/tasks/active-task.json`
(schema v4) — component/source candidates, business context, redaction
manifest, screenshot ref, diagnostics, heartbeat, and revision bookkeeping.

## 2. Read the task (JSON path)

```bash
node scripts/portal-studio-print.mjs --json          # full artifact
node scripts/portal-studio-print.mjs --markdown      # readable summary
```

The token is not needed to read files; it is only required for endpoints.

## 3. Edit the source

Edit the file(s) referenced by the task's `sourceCandidates`. The dev server
serves the change via HMR (or full reload).

## 4. Wait for the edit to reach the browser (bounded wait)

```bash
node scripts/portal-studio-verify.mjs --timeout-ms 10000
# exit 0 = matched, 1 = stale, 2 = error
```

Semantics (contract §10): a full reload bumps `browserRevision` (authoritative
match); an HMR update counts only while the browser heartbeat is `online`
(informational ack). A timeout marks the task `stale` — never a false pass.

## 5. Read errors and current evidence

```bash
node scripts/portal-studio-print.mjs --json | jq .diagnostics   # runtime errors
# Fresh screenshot + refreshed diagnostics:
curl -s -X POST http://127.0.0.1:5173/__portal-studio/screenshot \
  -H "X-Portal-Studio-Token: $(node -e "console.log(JSON.parse(require('fs').readFileSync('.portal-studio/session.json','utf8')).token)")"
sleep 3
node scripts/portal-studio-print.mjs --json | jq .screenshot    # new capturedAt
```

All diagnostics are redacted at ingestion; request/response bodies are never
captured; the screenshot is returned as a file reference.

## 6. Optional MCP path

```bash
node scripts/portal-studio-mcp.mjs        # stdio MCP server
```

Tools: `capture_task`, `print_task`, `current_screenshot`,
`read_diagnostics`, `wait_verification` — see
`docs/exec-plans/portal-studio/mcp-config.md` for configuration. The JSON path
above remains fully usable without it.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `verify` exits 1 (stale) | The browser did not reload and no HMR ack + online state was observed. Reload the page and retry. |
| Endpoint returns 404 | Missing/wrong `X-Portal-Studio-Token`, or you are hitting a production build (dev endpoints only exist in dev). |
| `print` says no task found | `.portal-studio/tasks/active-task.json` does not exist — capture a task first. |
| Studio toolbar missing | Confirm `pnpm dev` (not `pnpm start`); Studio is dev-only by design. |
