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

- **Progress:** (milestone status + evidence paths)
- **Surprises & Discoveries:** (e.g. Vite HMR ack timing, vite-plugin
  middleware ordering for acks, stdio framing)
- **Decisions:** (append to contract §13)
- **Outcomes & Retrospective:** (filled at Goal end)

## Handoff to Goal 05

Goal 05 does not add product features; it hardens everything above
(abuse tests, E2E matrix, HMR re-injection, production bundle graph,
dependencies/licenses/NOTICE, Codex + Pi/JSON usage docs, clean-workspace
re-verification) and produces the release evidence for the final DoD.
