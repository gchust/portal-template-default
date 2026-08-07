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

- **Progress:** (milestone status + evidence paths)
- **Surprises & Discoveries:** (e.g. XHR interception edge cases, Vite error
  overlay interactions, throttled-tab heartbeat behavior)
- **Decisions:** (append to contract §13)
- **Outcomes & Retrospective:** (filled at Goal end)

## Handoff to Goal 04

Goal 04 wires the verification loop on top of this: revision tracking decides
*when* to trust diagnostics/screenshots after an edit, and the bounded wait
uses the heartbeat states defined here.
