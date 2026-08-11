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

- [ ] Establish clean worktree/install.
- [ ] Run full static/unit/build gates.
- [ ] Run source benchmark.
- [ ] Run complete user workflow E2E.
- [ ] Run public CLI/MCP smoke.
- [ ] Run security/privacy tests.
- [ ] Prove production exclusion.
- [ ] Run the permanent inspection audit and prove no legacy/fallback/compat remains.
- [ ] Audit active docs.
- [ ] Fill F-001…F-028 and independently review failures.

## Surprises & Discoveries

- None yet.

## Decision Log

- None yet. Record every targeted repair made during release proof.

## Outcomes & Retrospective

Fill only after every final matrix row passes.
