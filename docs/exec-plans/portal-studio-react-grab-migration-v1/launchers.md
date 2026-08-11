# Copy-ready Codex / Pi launchers

Place this Goal directory at:

```text
docs/exec-plans/portal-studio-react-grab-migration-v1/
```

Run one Goal at a time. For low-parameter models, use the two-step sequence below: first run the Goal-specific `/plan` prompt to inspect the actual repository and map every acceptance criterion to files and commands; then activate the `/goal` prompt. The plan phase must not change code. After completion, ask for an independent review before checkpointing and clearing/changing the Goal.

## Generic preflight-plan template

```text
/plan Read the shared contract and the currently assigned numbered Goal. Inspect
actual HEAD, repository instructions, package scripts, tests and relevant source.
Return a repository-adapted implementation plan that maps every acceptance
criterion to concrete files, commands and evidence artifacts. Identify conflicts
or blockers. Do not change code, do not widen scope, do not design compatibility
or fallback behavior, and do not begin a later Goal.
```

## Goal 01

Recommended preflight:

```text
/plan Read:
- docs/exec-plans/portal-studio-react-grab-migration-v1/00-shared-contract.md
- docs/exec-plans/portal-studio-react-grab-migration-v1/01-goal-lock-upstream-contract.md

Inspect actual HEAD and produce a criterion-by-criterion repository adaptation.
Do not modify code, add fallback/compatibility, or start another Goal.
```

```text
/goal Complete Portal Studio React Grab Migration Goal 01.

Read first:
- docs/exec-plans/portal-studio-react-grab-migration-v1/00-shared-contract.md
- docs/exec-plans/portal-studio-react-grab-migration-v1/01-goal-lock-upstream-contract.md

Inspect actual HEAD before changing code. Pin and prove the exact public
react-grab/primitives contract in this React 19/Vite 6 repository using the
required real-browser fixture. Do not switch production Portal Studio behavior,
do not import React Grab's default UI, do not install element-source directly,
and do not create any fallback.

Do not stop at a plan. Continue until every G01 acceptance criterion has
concrete command/test/browser/build evidence. Keep the ExecPlan living sections
updated and report every criterion PASS, FAIL or BLOCKED. Do not start Goal 02.
```

## Goal 02

Recommended preflight:

```text
/plan Read:
- docs/exec-plans/portal-studio-react-grab-migration-v1/00-shared-contract.md
- docs/exec-plans/portal-studio-react-grab-migration-v1/02-goal-build-single-inspection-domain.md

Inspect actual HEAD and produce a criterion-by-criterion repository adaptation.
Do not modify code, add fallback/compatibility, or start another Goal.
```

```text
/goal Complete Portal Studio React Grab Migration Goal 02.

Read first:
- docs/exec-plans/portal-studio-react-grab-migration-v1/00-shared-contract.md
- docs/exec-plans/portal-studio-react-grab-migration-v1/02-goal-build-single-inspection-domain.md
- Goal 01 Outcomes & Retrospective and upstream verification evidence

Build the one repository-owned inspection domain around react-grab/primitives,
including v6 normalization, NocoBase enrichment, hierarchy and selector/fingerprint
locator. Exactly one source file may import the primitives. There is no legacy
implementation and no fallback inside the new domain. Leave the current product
capture path untouched in this Goal.

Do not stop at a plan. Continue until every G02 acceptance criterion is proven.
Do not start Goal 03.
```

## Goal 03

Recommended preflight:

```text
/plan Read:
- docs/exec-plans/portal-studio-react-grab-migration-v1/00-shared-contract.md
- docs/exec-plans/portal-studio-react-grab-migration-v1/03-goal-atomic-production-cutover.md

Inspect actual HEAD and produce a criterion-by-criterion repository adaptation.
Do not modify code, add fallback/compatibility, or start another Goal.
```

```text
/goal Complete Portal Studio React Grab Migration Goal 03.

Read first:
- docs/exec-plans/portal-studio-react-grab-migration-v1/00-shared-contract.md
- docs/exec-plans/portal-studio-react-grab-migration-v1/03-goal-atomic-production-cutover.md
- Goal 01 and Goal 02 Outcomes & Retrospective

Atomically cut Pick, Multi, Area, persisted task schema, Marker rehydration,
formatter, CLI/MCP and source revision to the single React Grab inspection domain
and schema v6. Remove the active Vite source-guessing/backfill path. Old schemas
must be rejected, not migrated. Do not call old perception code as a fallback.

Do not stop at a plan. Continue until all G03 criteria have unit/component,
real-browser, CLI and build evidence. Do not start Goal 04.
```

## Goal 04

Recommended preflight:

```text
/plan Read:
- docs/exec-plans/portal-studio-react-grab-migration-v1/00-shared-contract.md
- docs/exec-plans/portal-studio-react-grab-migration-v1/04-goal-freeze-region-and-runtime-quality.md

Inspect actual HEAD and produce a criterion-by-criterion repository adaptation.
Do not modify code, add fallback/compatibility, or start another Goal.
```

```text
/goal Complete Portal Studio React Grab Migration Goal 04.

Read first:
- docs/exec-plans/portal-studio-react-grab-migration-v1/00-shared-contract.md
- docs/exec-plans/portal-studio-react-grab-migration-v1/04-goal-freeze-region-and-runtime-quality.md

Complete automatic freeze/unfreeze lifecycle, semantic bounded Area collection,
async cancellation, observer/listener cleanup and performance call-count gates.
Do not reintroduce full-DOM scanning, old perception logic or fallback behavior.

Continue until every G04 criterion has concrete evidence. Do not start Goal 05.
```

## Goal 05

Recommended preflight:

```text
/plan Read:
- docs/exec-plans/portal-studio-react-grab-migration-v1/00-shared-contract.md
- docs/exec-plans/portal-studio-react-grab-migration-v1/05-goal-delete-legacy-and-compatibility.md

Inspect actual HEAD and produce a criterion-by-criterion repository adaptation.
Do not modify code, add fallback/compatibility, or start another Goal.
```

```text
/goal Complete Portal Studio React Grab Migration Goal 05.

Read first:
- docs/exec-plans/portal-studio-react-grab-migration-v1/00-shared-contract.md
- docs/exec-plans/portal-studio-react-grab-migration-v1/05-goal-delete-legacy-and-compatibility.md

Physically delete the custom Fiber engine, Vite regex source resolver, candidate
arrays, v1-v5 compatibility, dead tests and conflicting active docs. The final
runtime has exactly one React Grab primitives implementation and no fallback.
Old dev task files are disposable and must not receive migration code.

Do not stop until every mandatory zero-result search and every G05 criterion
passes with evidence. Do not start Goal 06.
```

## Goal 06

Recommended preflight:

```text
/plan Read:
- docs/exec-plans/portal-studio-react-grab-migration-v1/00-shared-contract.md
- docs/exec-plans/portal-studio-react-grab-migration-v1/06-goal-release-proof.md

Inspect actual HEAD and produce a criterion-by-criterion repository adaptation.
Do not modify code, add fallback/compatibility, or start another Goal.
```

```text
/goal Complete Portal Studio React Grab Migration Goal 06.

Read first:
- docs/exec-plans/portal-studio-react-grab-migration-v1/00-shared-contract.md
- docs/exec-plans/portal-studio-react-grab-migration-v1/06-goal-release-proof.md
- docs/exec-plans/portal-studio-react-grab-migration-v1/FINAL-ACCEPTANCE-MATRIX.md

Independently prove release readiness from a clean environment. Do not trust
prior completion claims. Run the full source-accuracy benchmark, user workflow,
CLI, security, production-exclusion and no-legacy checks; fix in-scope failures.
The Goal is complete only when F-001 through F-028 are all PASS with concrete
evidence. Do not add new product scope.
```

## Independent review prompt after each Goal

```text
Independently review the just-completed Goal against its shared contract and
acceptance criteria. Do not trust the previous completion statement. Inspect the
diff, run the stated verification commands, look for semantic equivalents of
forbidden fallback/legacy behavior, and fix every in-scope issue. Do not begin
the next Goal. Return a criterion-by-criterion PASS/FAIL/BLOCKED report with
exact evidence.
```
