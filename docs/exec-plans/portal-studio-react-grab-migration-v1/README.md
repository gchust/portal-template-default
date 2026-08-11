# Portal Studio React Grab single-engine migration — Goal set v1

This directory contains six sequential Codex Goals / ExecPlans. The migration keeps the current NocoBase Portal Studio product layer and replaces only the generic DOM/React perception implementation with `react-grab/primitives`.

## Final product boundary

React Grab owns hit testing, target filtering, top-level bounds, selector generation, React source context and freeze/unfreeze. NocoBase continues to own the horizontal toolbar, Pick/Multi/Area workflows, annotations, persistent markers, task status, Agent handoff/completion, NocoBase business context, diagnostics, screenshots, revision control, redaction and production exclusion.

The final implementation has one perception engine. It does not retain a custom Fiber/source fallback, does not directly install `element-source`, does not import React Grab's default UI, and does not support task schema v1–v5.

## Execute in this order

1. `01-goal-lock-upstream-contract.md` — pin and prove the public upstream APIs in a real React 19/Vite 6 fixture.
2. `02-goal-build-single-inspection-domain.md` — build the sole inspection domain, v6 normalization, locator and NocoBase enrichment in isolation.
3. `03-goal-atomic-production-cutover.md` — atomically cut Pick/Multi/Area, task persistence, Marker, formatter, CLI/MCP and revision logic to React Grab/v6.
4. `04-goal-freeze-region-and-runtime-quality.md` — finish freeze lifecycle, semantic region selection, async cleanup and performance gates.
5. `05-goal-delete-legacy-and-compatibility.md` — physically delete Fiber/module-regex/candidate/old-schema/fallback code and archive conflicting plans.
6. `06-goal-release-proof.md` — independently prove every row in `FINAL-ACCEPTANCE-MATRIX.md` from a clean environment.

## Codex usage

Place this directory at:

```text
docs/exec-plans/portal-studio-react-grab-migration-v1/
```

For low-parameter models, first run the Goal-specific `/plan` preflight in `launchers.md`, then activate the `/goal`. For each run, provide only:

```text
repository AGENTS.md
00-shared-contract.md
the current numbered Goal
```

Use the short prompt in `launchers.md`. After the Goal reports completion, run the independent-review prompt before checkpointing and proceeding. Do not run Goals that modify the same `src/studio` files in parallel.

## Evidence rule

A completion claim requires concrete code/test/build/browser/grep artifacts. Every acceptance criterion must be marked PASS, FAIL or BLOCKED. “Implemented”, “looks correct”, “should pass”, and mocked upstream output are not sufficient evidence.

## Files

- `README.zh-CN.md` — Chinese overview.
- `RESEARCH-NOTES.md` — official Goal/ExecPlan and upstream-library research summary.
- `00-shared-contract.md` — frozen architecture and final-state invariants.
- `01-goal-lock-upstream-contract.md` through `06-goal-release-proof.md` — sequential living ExecPlans.
- `FINAL-ACCEPTANCE-MATRIX.md` — final release matrix.
- `launchers.md` — copy-ready Codex/Pi prompts.
- `COPY-READY-GOAL-01.md` — shared contract plus Goal 01 in one file.
- `AGENTS-snippet.md` — concise repository guidance.
