# ExecPlan 03 — Runtime Diagnostics

> Contract: `00-shared-contract.md`. Self-contained for Goal 03. Do **not**
> start Goal 04 until this Goal's single end-state is achieved and
> independently reviewed.

## Summary

Capture runtime errors in the modified browser (console.error, window error,
unhandled rejection, failed fetch, failed XHR) into a bounded, deduped,
size-limited ring buffer with unified redaction and **no body capture by
default**; add a browser heartbeat (online/stale/offline) and a
`current screenshot` command; attach all of it to the task artifact (schema v3).

**Depends on:** Goal 02 end-state (complete artifacts + screenshot capture).
**Single end-state:** *An agent can safely determine whether the modified
browser reports errors and obtain current page evidence (screenshot + status)
via the JSON path alone.*

## Scope

In scope:
- Error sources: `console.error`, `window.onerror`, `unhandledrejection`,
  failed `fetch`, failed `XMLHttpRequest`. Each entry: source, message,
  stack (redacted), URL, timestamp, occurrence count.
- Ring buffer: bounded count (e.g. ≤ 100 entries), dedup (same source+message
  within a window coalesces with a counter), per-entry and total size caps;
  **request/response bodies never captured by default** (contract invariant).
- Unified redaction: same `redactPortalErrorText` baseline + artifact rules;
  redaction manifest entry for diagnostics.
- Browser heartbeat: periodic status report (`online | stale | offline`) with
  timestamps, written into the artifact (schema v3 `diagnostics` + `heartbeat`);
  `stale` when the page has not reported within the bounded interval.
- `current screenshot` command: captures the current viewport (annotated
  optionally), writes PNG under `.portal-studio/screenshots/`, updates the
  artifact's screenshot ref + timestamp. Available via the dev endpoint and
  (read-side) via the print command output.
- Tests: ring-buffer bounds/dedup, redaction of injected errors, no-body-by-
  default proof, heartbeat state transitions; E2E: induce a real error
  (console.error via page interaction), read it back through the JSON path.

Out of scope (later Goals):
- MCP, revision/HMR ack semantics, stale-artifact wait loop (Goal 04).
- Full abuse suite, production bundle hardening, release docs (Goal 05).
- NocoBase upstream changes; new runtime deps.

## Milestones

| # | Milestone | AC (observable) |
| --- | --- | --- |
| M1 | Error capture pipeline | All five sources captured, redacted, deduped, size-capped; body fields absent by default (asserted by tests) |
| M2 | Ring buffer + heartbeat | Bounds/dedup honored under synthetic error storms; heartbeat states observable and written to artifact |
| M3 | Screenshot command | Current-viewport PNG written on demand; artifact ref updated; works from shell via endpoint/CLI |
| M4 | Schema v3 + tests/E2E | v3 artifact renders via print; unit + E2E green; `pnpm typecheck && pnpm test && pnpm build` green |

## Acceptance criteria (Goal 03)

1. All five error sources appear in the artifact with source, redacted message,
   timestamp, and occurrence count; nothing beyond the caps is retained.
2. No request/response body is captured by default; any future opt-in requires
   contract Decision Log approval (scope cannot silently grow).
3. Heartbeat distinguishes online/stale/offline; a dead tab is never reported
   as healthy.
4. `current screenshot` command returns a fresh PNG and updates the artifact;
   JSON path alone can trigger and read it.
5. Redaction manifest covers diagnostics; seeded secrets in errors never leak.
6. `git diff --check` clean; no lockfile changes.

## Risks & mitigations

- **Error storms / recursion** (capturing our own capture errors): capture
  code never logs through captured channels; guard flag; ring buffer caps.
- **Leak via stack/URLs**: redaction runs at ingestion, not display; tests seed
  known secrets into errors.
- **Heartbeat false offline** (throttled tabs): tolerance window documented;
  `stale` semantics (contract §10) reused by Goal 04.
- **Screenshot of sensitive data**: local dev artifact only; documented in
  release docs (Goal 05) and redaction notes.

## Verification commands

```bash
pnpm typecheck && pnpm test
pnpm test:e2e                       # induced-error spec + screenshot command spec
node scripts/portal-studio-print.mjs --json | grep -c '"diagnostics"'   # schema v3 present
grep -rE "requestBody|responseBody" tests/ || echo "no-body default enforced by tests"
git diff --check
```

## Stop conditions

- End-state achieved → stop, request independent review + checkpoint commit;
  do **not** start Goal 04.
- A required capture source cannot be made safe (redaction/limits) within the
  invariants → stop and report minimal blocker with evidence.

## Running log (maintain during execution)

### Progress

- M1 Error capture pipeline: **DONE** — `src/studio/diagnostics.ts` captures all
  five sources (console.error wrapper, window.onerror, unhandledrejection,
  fetch wrapper, XHR wrapper), redacts message/stack/url AT INGESTION, and
  never routes its own failures through captured channels (guard flag +
  `console.warn` fallback, idempotent install flag for HMR).
- M2 Ring buffer + heartbeat: **DONE** — ≤100 entries, per-entry caps
  (message 2000 / stack 4000 / url 2000, truncation markers), 10 s dedup
  window with occurrence counters, storm tests (same ×1000 → 1 entry count
  1000; distinct ×1000 → exactly 100). Heartbeat: client reports every 5 s
  (+ visibilitychange catch-up); the server derives online/stale/offline from
  the LAST REPORT RECEIPT TIME ONLY (D-016), with bounded thresholds
  (online ≤10 s, stale ≤30 s).
- M3 Screenshot command: **DONE** — `POST /__portal-studio/screenshot`
  (agent command, optional annotations ≤16 KB) recomputes the authoritative
  heartbeat and queues a pending request; the browser's evidence loop
  (1 s poll) captures the viewport and pushes PNG + diagnostics; the server
  validates (magic/IHDR/2 MB), atomically updates the active task's
  screenshot ref + `capturedAt`, diagnostics, and heartbeat, and clears the
  pending slot. Replace/orphan handling reuses the Goal 02 transaction
  pattern (read-before-write, delete-after-write, same-path retention).
- M4 Schema v3 + tests/E2E: **DONE** — v3 additive (diagnostics, heartbeat,
  screenshot.capturedAt); v1/v2 payloads still accepted and normalized; print
  renders v1/v2/v3. 169 unit/component tests (final count after the
  closeout security review); E2E 4/4 (login regression +
  3 studio specs incl. induced console.error read-back with redaction +
  heartbeat authority transition + command-triggered fresh screenshot).

### Surprises & Discoveries

1. **The page's own console noise pollutes the buffer** (Base UI
   "nativeButton" warnings + fetch 404/401 from the auth flow). Dedup helps;
   E2E must locate the INDUCED entry by its redaction-preserved prefix rather
   than "first console entry".
2. **`Buffer` is a Node global — absent in the browser**: the client
   diagnostics byte-size helper crashed the evidence loop at runtime
   ("Buffer is not defined") while passing vitest (jsdom polyfills it).
   Replaced with `TextEncoder` (unit tests only catch this if the browser is
   exercised — the E2E caught it).
3. **Vite config-restart token split**: a second dev instance that fails to
   bind (strictPort) still runs `configResolved` and previously overwrote the
   active instance's `session.json` with a dead token. Fixed by persisting the
   session file ONLY on the `listening` event (D-017); verified with an A/B
   repro (B fails, A's file + token untouched).
4. **GET routes entered the JSON body parser** in the shared middleware
   (pending endpoint returned `invalid_json`) — moved the GET branch before
   body parsing.
5. The `heartbeat` command response already carries the server-derived state,
   so an agent can judge page liveness even when the page is gone (pending
   unfulfilled): the E2E closes the page, waits past ONLINE_WINDOW, and
   asserts the command response is stale/offline — never a self-reported
   online.
6. Real fetch failures (auth 401/404 on load) are captured as diagnostics —
   good evidence that the fetch wrapper works, and a reminder that "failed
   fetch" includes HTTP >= 400, not only network errors.
7. **False-green eslint (D-018)**: the Goal 03 refactor replaced the inline
   `atomicWriteScreenshot` call with `commitEvidence` but left the stale
   import in `vite.ts`. The executor's pipeline `pnpm exec eslint ... | tail`
   **piped through tail which consumed the real exit code and returned 0**
   even when eslint exited 1 — masking the lint error entirely. The auditor
   re-ran `npx eslint src/studio/vite.ts` directly and caught exit 1. Fix:
   deleted the import; **going forward every lint invocation must use `set -o
   pipefail` (or no pipe) so downstream tools cannot mask a non-zero exit
   code**.

   **Final real gate evidence (all re-run with `set -o pipefail`, no
   tail/grep masking):**
   - touched-files ESLint: `exit 0`
   - `pnpm typecheck`: `exit 0`
   - `pnpm test`: 31 files / 169 of 169 passed, `exit 0`
   - `pnpm build`: `exit 0`
   - production dist precise grep (`PortalStudio|portal-studio|__portal-studio|ps-toggle|mountPortalStudio`): 0 matches, `grep exit 1`
   - `pnpm test:e2e`: 4 of 4 passed, `exit 0`
   - `git diff --check`: `exit 0`

### Decisions

- See contract Decision Log D-014 … D-017 (appended during Goal 03).

### Outcomes & Retrospective (filled at Goal end)

- End-state reached: any shell agent can, through the JSON/file path alone,
  judge whether the modified browser reports runtime errors (redacted
  diagnostics with occurrence counts), the page state (server-derived
  heartbeat), and a fresh annotated screenshot (command → capture → atomic
  artifact update → print).
- Retro: the D-016/D-017 security reviews (client-ts authority, failed-start
  session persistence) were exactly the "don't trust the client / don't trust
  startup order" class of bug the contract is designed to catch. The E2E
  earned its keep again (Buffer crash, GET-body-parse bug).
- Known trade-offs (documented, not defects): heartbeat `online` lasts at
  most ONLINE_WINDOW after the last report (throttled tabs may look stale
  briefly — intentional: never falsely healthy); fetch/XHR wrappers only
  capture status-level information, never bodies (by design).

### AC checklist (Goal 03)

| AC | Evidence |
| --- | --- |
| 1. Five sources with source/redacted message/stack/url/timestamp/count | diagnostics.test.ts (five-source normalization, redaction matrix, caps); E2E induced console.error read-back with occurrenceCount ≥1 |
| 2. No body capture by default | types carry no body fields; server shape whitelist drops unknown keys (test asserts requestBody/responseBody absent); E2E artifact grep |
| 3. Ring ≤100, caps, dedup, storms | diagnostics.test.ts bounds/dedup/storm tests; endpoint sanitize caps (≤100, ≤64 KB) |
| 4. Heartbeat online/stale/offline, server-derived, throttled tabs never healthy | deriveHeartbeatState tests (15 s → stale, 60 s → offline, undefined → offline); D-016 receipt-time tests (future/old/invalid ts ignored); E2E closed-page transition |
| 5. Redaction manifest covers diagnostics | recorder counts asserted in sanitizeDiagnostics tests; manifest present in artifact (existing v2 assertions) |
| 6. Screenshot command fresh PNG + ref/timestamp update, JSON path only | endpoint tests (pending lifecycle, atomic update, same/diff path pruning); E2E capturedAt change + PNG magic |
| 7. Print renders v3 diagnostics/heartbeat/screenshot | print-cli.test.ts v3 markdown (heartbeat state, [console] xN, capturedAt) + v1/v2 regression |
| 8. Quality gates + prod exclusion + no dep/lockfile changes + nocobase untouched | typecheck 0, test 169/169 (31 files), build ok, E2E 4/4, eslint 0, git diff --check 0, dist precise grep 0, package.json/lockfile unchanged, nocobase status = pre-existing only |
