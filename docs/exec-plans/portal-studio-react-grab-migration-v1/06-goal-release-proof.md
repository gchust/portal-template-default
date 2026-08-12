# Goal 06 — prove release readiness of the single-engine Portal Studio

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current.

## Goal contract

**Objective:** Independently verify the final React Grab single-engine implementation against the complete functional, UX, source-accuracy, security, CLI, production-exclusion and no-legacy matrix; fix any in-scope failures.

**Stopping condition:** Every row in `FINAL-ACCEPTANCE-MATRIX.md` is PASS with concrete evidence from a clean worktree/install; no unresolved in-scope issue remains.

Do not add new product scope. This is proof and targeted repair.

## Purpose / big picture

The final Goal must not trust earlier completion claims. It re-evaluates the finished system from user behavior and repository invariants.

## 1. Clean environment gate

From a clean worktree or fresh checkout:

```bash
pnpm install --frozen-lockfile
pnpm studio:inspection:audit
pnpm typecheck
pnpm test
pnpm test:sdk
pnpm build
pnpm test:e2e
```

If the existing real-backend E2E environment cannot run, execute every local fixture Studio E2E and clearly separate environment BLOCKED items. Do not claim final completion while a required product scenario is untested.

## 2. Source-accuracy benchmark

Create/retain a machine-readable benchmark report for the test-owned fixture targets:

```json
{
  "reactGrabVersion": "0.1.50",
  "targets": [
    {
      "id": "fixture-plain-button",
      "expectedFile": "...",
      "actualFile": "...",
      "lineNumber": 1,
      "columnNumber": 1,
      "expectedComponent": "...",
      "stackContainsExpected": true,
      "pass": true
    }
  ]
}
```

Hard expectations:

- 100% correct file for test-owned plain/memo/forwardRef/map/portal targets;
- positive line and valid column;
- source stack includes expected workspace component;
- no incorrect file may be presented as high-confidence product context;
- source-null is explicit for unsupported/non-React cases, never guessed.

Also sample at least six real Portal elements (shadcn control, Refine/table cell, dialog/drawer/popover, route page element). Assert paths are workspace-owned and evidence is plausible; exact line goldens are not required for frequently changing app source.

## 3. User workflow E2E

Verify end to end:

1. toolbar collapsed/expanded/dragged;
2. Pick a nested-SVG control, add comment, save, Marker appears;
3. Multi-select distinct targets, add one comment, task has N elements;
4. Area select a card/table region, output is semantically bounded;
5. reload, Marker rehydrates to correct target;
6. mutate target so fingerprint no longer matches, Marker becomes unresolved rather than wrong;
7. click Marker, edit, complete, reopen, delete;
8. Open/All and Remove completed;
9. Copy open annotations;
10. Code Agent CLI list/complete/reopen updates browser;
11. HMR/source revision verification;
12. console/network diagnostic evidence;
13. old-schema explicit rejection and clear action;
14. Shadow DOM and same-origin iframe targets;
15. hover/popover freeze flow.

Capture screenshots for key states.

## 4. Process-level CLI proof

Run public commands exactly as documented, not imported internal functions:

```bash
pnpm studio:list
pnpm studio:complete -- <annotation-id> --verified --summary "..."
pnpm studio:reopen -- <annotation-id>
# plus documented print/verify/MCP commands, after Goal 03/05 docs updates
```

Assert exit codes, stdout/stderr, JSON/Markdown format and task mutation.

## 5. Security and privacy proof

Run focused tests for:

- session token/Origin/Host/loopback boundary;
- path traversal;
- body/artifact/screenshot caps;
- source path outside root;
- selector/HTML/style/attributes redaction;
- password/input/token values absent;
- malformed React Grab context rejected;
- unsupported schema behavior;
- revision conflict;
- atomic write and concurrent browser/CLI mutation.

## 6. Production exclusion proof

After production build:

```bash
rg -n 'portal-studio|react-grab|bippy|data-react-grab-ignore|__portal-studio' dist
```

Expected zero relevant runtime matches. Start/serve the production build and probe every Studio endpoint; expected 404/not registered. Confirm fixture route unavailable.

## 7. No-legacy proof

Run `pnpm studio:inspection:audit` and all Goal 05 zero-result checks again. Inspect package/lock and import graph. Confirm:

- one primitives import;
- zero full React Grab UI import;
- zero element-source direct dependency;
- zero Fiber/module-regex/candidate/old-schema/fallback code.

## 8. Docs and maintenance proof

Active docs must include:

- architecture and ownership boundary;
- exact dependency/version/license;
- v6 task format;
- unsupported old-task clearing;
- user annotation workflow;
- Codex/Pi JSON handoff;
- CLI/MCP commands that actually run;
- freeze behavior and limitations;
- source-null/unresolved semantics;
- how to upgrade React Grab: dedicated version bump + fixture/benchmark rerun.

Add a short repository rule: React Grab version upgrades must rerun Goal 01 contract and Goal 06 benchmark; no casual range update.

## Acceptance criteria

Use `FINAL-ACCEPTANCE-MATRIX.md`. Every F-001…F-028 row must have:

- status PASS;
- command/test/artifact location;
- concise evidence;
- no “assumed”, “not run”, “should work” language.

Any FAIL/BLOCKED means the Goal remains incomplete unless the user explicitly changes the contract.

## Required final report

```text
Summary
Files changed
Commands run and exact results
Final acceptance matrix F-001…F-028
Source benchmark summary
Screenshots/artifacts
Known limitations (only honest upstream/product limitations, not unimplemented ACs)
No-legacy grep outputs
Production-exclusion proof
```

## Progress

- [x] Establish clean worktree/install (git worktree at HEAD + `pnpm install --frozen-lockfile`).
- [x] Run full static/unit/build gates (audit, typecheck, 702 Vitest, sdk 30, build + prod exclusion).
- [x] Run source benchmark (fixture 10/10 + real Portal 7/7, machine-readable reports).
- [x] Run complete user workflow E2E (fixture workflow 4/4 + Portal suite 31/31).
- [x] Run public CLI/MCP smoke (list/complete/reopen/print/verify/mcp — one targeted repair: verify `--timeout-ms` parsed the raw argv, breaking the documented `--` form).
- [x] Run security/privacy tests (10 files / 152 tests PASS).
- [x] Prove production exclusion (dist grep zero matches; preview probes: endpoints/fixture not registered — SPA fallback HTML only).
- [x] Run the permanent inspection audit and prove no legacy/fallback/compat remains (audit PASS + all six zero-result greps).
- [x] Audit active docs (usage/CLI/freeze/unresolved/upgrade rule added to the migration README).
- [x] Fill F-001…F-028 (all PASS) and independently review (fresh reviewer round; findings fixed).

## Surprises & Discoveries

- Playwright in this repo IGNORES the assertion-level `expect(locator, { timeout })` options (verified: 8000ms option behaved as 5000ms); the matcher-level form `toBeEnabled({ timeout })` works. Several E2E waits silently used 5s instead of their intended 20s — the cause of intermittent Save-window flakes. Repaired in the helpers.
- The real-Portal benchmark surfaced the fixture-era lesson again: `#portal-studio-root` is a SHADOW host — light-DOM queries see nothing; and the role-engine locators proved unreliable for the shadow toolbar on the create route, while CSS attribute locators pierce consistently.
- The `studio:verify` CLI read `--timeout-ms`'s value from the RAW argv instead of the cleaned args, so the documented `pnpm studio:verify -- --timeout-ms 5000` form always failed ("must be a number"). Fixed.
- The marker observer watched `childList` only — an attribute-only mutation (target rename) never re-resolved markers; added `attributes: true` (workflow proof).
- The workflow's fingerprint-mismatch proof must mutate a NON-React-managed DOM node (the fixture's React re-renders restore React-owned ids); the same-origin iframe document is the deterministic target.

## Decision Log

- Decision: keep the freeze reapply at 500ms and the documented unfrozen resume (Goal 04/05 decisions remain).
  Rationale: re-freezing before the interaction's render commits makes updates invisible to React (upstream pause); the E2E and contract suites are green with the current semantics.
- Decision: the marker MutationObserver now also watches attributes.
  Rationale: an attribute-only mutation (a renamed target id) must re-resolve markers so a fingerprint mismatch turns the marker unresolved instead of stale.
- Decision: fixture task/screenshot endpoints are stubbed at the HTTP layer (page.route) for the workflow suite, and the fixture vite config mounts the real dev middleware for the save persistence.
  Rationale: the real product code path runs end to end (Pick → save → marker → reload rehydration); only the dev-only transport is harness-controlled.
- Decision: the portal benchmark uses the product capture path (Pick → save → artifact) and asserts workspace ownership + plausibility rather than exact line goldens.
  Rationale: the goal explicitly exempts frequently changing app source from line goldens.

## Outcomes & Retrospective

F-001…F-028 all PASS — see FINAL-ACCEPTANCE-MATRIX.md and the Goal 06 evidence report
(.portal-studio-evidence/react-grab-g01/commands.log). Full clean-worktree gates:
pnpm install --frozen-lockfile; studio:inspection:audit PASS; typecheck clean;
pnpm test 59 files / 702 tests PASS; pnpm test:sdk 30 PASS; pnpm build clean with
zero react-grab|bippy|portal-studio in dist; fixture contract+benchmark+workflow
25/25; Portal Studio E2E 31/31; portal source benchmark 7/7; CLI/MCP smoke PASS;
security/privacy suites 152 PASS; production-serve probes: studio endpoints and
fixture route NOT registered in the prod build (SPA fallback only).
