> **ARCHIVED — DO NOT IMPLEMENT — superseded by React Grab single-engine migration v1**
>
> This plan promoted the custom Fiber/module-graph perception adapter and v1–v5 schema
> compatibility. The migration contract (docs/exec-plans/portal-studio-react-grab-migration-v1/)
> is the only normative source; schema v6 and react-grab/primitives are the only supported
> engine. Kept for history only.

# ExecPlan 04 — MCP & Update-Verification Loop

> Contract: `00-shared-contract.md`. Self-contained for Goal 04. Do **not**
> start Goal 05 until this Goal's single end-state is achieved and
> independently reviewed.

## Summary

Close the full agent loop: annotate → agent reads task → agent edits source →
Studio tracks source/browser revisions with HMR/full-reload acknowledgement and
stale-artifact detection under a bounded wait → agent reads errors →
agent fetches current screenshot. Deliver the optional stdio MCP server that
exposes the same capabilities as first-class tools, with the JSON path
remaining fully compatible and first-class.

**Depends on:** Goal 03 end-state (diagnostics + heartbeat + screenshot).
**Single end-state:** *The annotate → read → edit → wait HMR/reload → read
errors → current-screenshot loop is verifiable end to end, with and without
MCP.*

## Scope

In scope:
- Revision tracking (contract §10 semantics): `sourceRevision` (content hash of
  task-referenced source files, computed by dev plugin/CLI), `browserRevision`
  (bootstrap marker + full-reload bump), HMR ack via the dev plugin; both
  recorded in the artifact (schema v4 `revision`).
- Stale detection + bounded wait: artifact `expectedAfter` deadline; browser
  state must reach `online` with matching revision inside the wait
  (default ≤ 10 s, configurable); otherwise the task is marked `stale` and
  reported — never silently trusted.
- Verification loop UX: Studio status UI shows revision/ack/state; a
  `verify` flow (endpoint or CLI) that performs the bounded wait and returns
  {revision, diagnostics, screenshot ref, state}.
- Optional stdio MCP server (Node, zero heavy deps, devDependencies only):
  tools `capture_task`, `print_task`, `current_screenshot`, `read_diagnostics`,
  `wait_verification` (bounded wait), operating on the same
  `.portal-studio/tasks/` files; configuration docs (env, stdio launch);
  credentials never in frontend; MCP is enhancement only — JSON fallback is
  always compatible and first-class (contract §9).
- MCP screenshot: same capture pipeline as the JSON path; results returned as
  file refs (never inline secrets).
- Tests: revision math, stale detection, bounded-wait timing (fake timers),
  MCP tool contract against a temp task dir, JSON-path parity matrix (every
  MCP tool has a JSON equivalent); E2E: edit a source file during the test,
  wait, read diagnostics + screenshot, assert loop completes.

Out of scope (later Goal):
- Security abuse suite, full E2E matrix, bundle-graph/artifact checks, license/
  NOTICE, usage docs finalization, clean-workspace re-verification, release
  evidence (Goal 05).
- Any production-visible MCP client; any credential in frontend.

## Milestones

| # | Milestone | AC (observable) |
| --- | --- | --- |
| M1 | Revision tracking + ack | source/browser revisions recorded; HMR ack and reload bump observable in artifact after a real edit |
| M2 | Stale detection + bounded wait | Wait succeeds on online+matched revision; times out to `stale` on mismatch; no silent trust |
| M3 | Verify flow (endpoint/CLI) | One command returns {revision, diagnostics, screenshot ref, state} after bounded wait |
| M4 | stdio MCP server + tools | Tools operate on the same files; JSON parity matrix passes; config docs committed |
| M5 | Tests + E2E loop | Fake-timer unit suite green; E2E full loop green; `pnpm typecheck && pnpm test && pnpm build` green |

## Acceptance criteria (Goal 04)

1. Full loop verifiable: with and without MCP, same artifact, same result
   (parity matrix).
2. Revisions are honest: reload bumps browser revision; unacked HMR after the
   bounded wait yields `stale`, never a false pass.
3. MCP server is stdio-only, runs from `node` with documented config; no
   credentials in frontend or artifacts; no new production dependencies.
4. JSON path gains no capability only behind MCP (contract §9).
5. i18n for new status UI (en-US/zh-CN); a11y for status display.
6. `git diff --check` clean; lockfile untouched except devDependencies if the
   MCP server needs a stdio helper package — if so, stop and ask first
   (contract rule).

## Risks & mitigations

- **HMR ack unreliability** (Vite granular HMR vs full reload): document
  reload bump as the authoritative signal; HMR ack informational; E2E covers
  both paths.
- **Bounded-wait flakiness in CI**: default 10 s configurable; E2E uses a
  short edit (comment change) to keep the wait deterministic.
- **MCP scope creep**: only the five listed tools; anything else deferred to
  Goal 05 only if it is hardening, otherwise to a future product decision.
- **Parity drift**: JSON-path parity matrix is a CI test, not a doc promise.

## Verification commands

```bash
pnpm typecheck && pnpm test
pnpm test:e2e                       # full-loop spec (edit → wait → verify)
node scripts/portal-studio-print.mjs --json | grep '"revision"'   # schema v4 present
# MCP smoke (config documented in the plan's Decisions / repo docs):
node --experimental-stdio <mcp-entry> &  # per config docs
git diff --check
```

## Stop conditions

- End-state achieved → stop, request independent review + checkpoint commit;
  do **not** start Goal 05.
- The loop cannot be made deterministic within the bounded-wait semantics →
  stop and report minimal blocker with evidence (never relax to silent trust).

## Running log (maintain during execution)

### Progress

- M1 Revision tracking + ack: **DONE** — schema v4 additive
  (`revision{sourceRevision, browserRevision, hmrAck, expectedAfter, state,
  checkedAt}`); `sourceRevision` = sha256 over the task-referenced source
  files (sorted, missing files hash as markers) computed by the dev server
  from disk; `browserRevision` = server-issued monotonic counter via the
  bootstrap endpoint (full reloads re-bootstrap → bump); HMR ack is
  server-observed (plugin `handleHotUpdate`), informational only; reload bump
  is the authoritative signal. Task POST stamps the initial revision; the
  E2E proves a real edit changes the source revision and a reload bumps the
  browser revision.
- M2 Stale detection + bounded wait: **DONE** — `performBoundedWait` (pure,
  injectable clock/sleep/state) with `evaluateRevisionMatch` (bump → matched;
  hmrAck + online → matched; anything else → never trusted); timeout → `stale`
  with `expectedAfter` deadline recorded; default 10 s, configurable ≤30 s
  (constants exported); fake-timer unit tests cover match/stale/offline and
  mid-wait flips.
- M3 Verify flow + status UI: **DONE** — `POST /__portal-studio/verify`
  (token-guarded, ≤1 KB) returns `{ok, state, revision, diagnostics,
  screenshot}` after the bounded wait and atomically updates the artifact
  revision; `scripts/portal-studio-verify.mjs` CLI (exit 0 matched / 1 stale /
  2 error); `GET /__portal-studio/tasks` returns the active task; the toolbar
  idle panel shows `Revision: <src> · browser <n> · <state>` (role=status,
  aria-live, i18n en-US/zh-CN).
- M4 stdio MCP server: **DONE** — `scripts/portal-studio-mcp.mjs`
  (zero-dep, newline-delimited JSON-RPC 2.0): initialize/ping/tools/list/
  tools/call; five tools (`capture_task`, `print_task`,
  `current_screenshot`, `read_diagnostics`, `wait_verification`) operating on
  the same artifact and endpoints; token read in-process (env/session.json,
  never frontend); screenshots as file refs only; config docs
  (`docs/exec-plans/portal-studio/mcp-config.md`); no new production
  dependencies.
- M5 Tests + E2E: **DONE** — 190 unit/component tests (revision math, bounded
  wait, MCP protocol + tool parity, verify CLI, print v4, toolbar status UI,
  v4 schema acceptance); E2E 4/4 incl. the full-loop spec: real source edit →
  HMR-path verify (matched via hmrAck+online, source revision changed) →
  reload-bump verify (matched via browserRevision bump) → fresh screenshot +
  diagnostics read-back → MCP smoke (all five tools).

### Surprises & Discoveries

1. **HMR ack reference point**: comparing `lastHotUpdateAtMs >= waitStart`
   never matched — the agent's edit happens BEFORE the verify call, so the
   hot update precedes the wait. The reference is the task's baseline
   `checkedAt` (D-020); the E2E caught this immediately.
2. **Reload wipes the diagnostics buffer**: inducing an error before the
   reload step lost it (fresh page = fresh ring buffer). The E2E induces the
   error after the reload — matching the real loop (errors observed AFTER the
   edit/reload).
3. **jsdom has no global fetch** for component tests: the status-UI effect
   crashed tests that didn't stub fetch; a `typeof fetch === "function"`
   guard fixed the component and `vi.unstubAllGlobals()` fixed cross-test
   global leaks (fetch stubs survived `restoreAllMocks`).
4. **Session-file self-heal**: `beforeEach` deletes `.portal-studio`
   (including `session.json`); the listening-event persistence only ran once,
   so the file stayed gone. The middleware now re-persists the SAME in-memory
   token when the file is missing while serving (safe: a serving instance owns
   the port; D-017 semantics preserved).
5. Vite `handleHotUpdate` is serve-only and fires per edited module — a cheap,
   honest "hot update served" signal; it is intentionally NOT a browser
   confirmation (documented as informational in D-019).

### Decisions

- See contract Decision Log D-019 … D-021 (appended during Goal 04).

### Outcomes & Retrospective (filled at Goal end)

- End-state reached: the annotate → read → edit → wait HMR/reload → read
  errors → current-screenshot loop is verifiable end to end with and without
  MCP; revisions are honest (bump authoritative, stale never silently
  trusted); the MCP server is a thin, documented wrapper over the same
  artifact/endpoints with full JSON parity.
- Retro: the pure-function seams (`performBoundedWait`, `evaluateRevisionMatch`,
  `computeSourceRevision`) made the tricky timing logic unit-testable without
  a browser; the E2E full loop earned its keep again (HMR reference bug).
- Known trade-offs (documented, not defects): the HMR ack is
  server-observed-push, not browser-confirmed-apply; the reload bump is the
  only fully authoritative signal. `browserRevision` is single-counter per dev
  server (last-write-wins across tabs — dev-only, documented).

### AC checklist (Goal 04)

| AC | Evidence |
| --- | --- |
| 1. Full loop verifiable with and without MCP (parity matrix as CI test) | E2E full-loop spec (HMR + reload paths) + MCP smoke (five tools, live server); mcp.test.ts parity (print_task/read_diagnostics vs print CLI; endpoint-path parity vs plugin constants) |
| 2. Revisions honest: reload bumps browserRevision; unacked HMR → stale, never silent | E2E: reload → browserRevision increase → matched; revision.test.ts: hmrAck-alone false, offline false, bump authoritative; performBoundedWait timeout → stale |
| 3. MCP stdio-only, node launch, documented config, no credentials in frontend, no new prod deps, five tools only | scripts/portal-studio-mcp.mjs; mcp-config.md; token in-process; package.json/lockfile unchanged; tools/list = exactly five |
| 4. JSON path gains nothing only behind MCP; screenshots as file refs | mcp-config.md parity table; current_screenshot returns {file, capturedAt} only |
| 5. i18n/a11y for status UI; diff --check clean; no lockfile changes | toolbar status line (role=status, aria-live), studio.revisionStatus/browserRevision keys en-US+zh-CN; gates below |
| 6. Gates with real exit codes (pipefail) | eslint 0, typecheck 0, test 190/190, build 0, dist grep 0 (exit 1), e2e 4/4, diff --check 0 |
