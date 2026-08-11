# Goal 05 — delete the custom engine, old schemas and all compatibility code

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current.

## Goal contract

**Objective:** Physically remove every unused custom generic perception path, old candidate schema and v1–v5 compatibility path, then simplify active code/tests/docs around the single React Grab/v6 design.

**Stopping condition:** Required zero-result searches pass; no old engine/fallback/compatibility code remains; all current tests pass on v6 only.

This Goal is intentionally destructive. Do not preserve old dev task files or compatibility helpers.

## Purpose / big picture

A migration is not complete while old Fiber and module-regex code remains “just in case”. Leaving it increases React upgrade risk, confuses low-parameter Agents and makes future bugs ambiguous.

## Required deletion inventory

### Delete files/functions

Delete or fully remove the legacy responsibilities from:

- `src/studio/grab.ts`;
- Fiber-specific tests such as `tests/logic/portal-studio/grab.test.ts`;
- `collectSelectorCandidates`;
- `collectComponentCandidates`;
- Fiber-based `readHostComponentName`;
- old `collectTargetStack` if replaced by inspection hierarchy;
- `resolveComponentSources`;
- `assignSourceCandidates`;
- Vite module graph transformed-code regex matching;
- source-candidate POST response fields/backfill;
- legacy selector-candidate marker loop.

If a file also contains useful non-legacy helpers, move the useful helper to a clearly named module and delete the legacy file.

### Delete old types

Remove:

- `SelectorCandidateKind`, `SelectorCandidate`;
- `ComponentCandidateKind`, `ComponentCandidate`;
- `SourceCandidateKind`, `SourceCandidate`;
- `selectorCandidates`, `componentCandidates`, `sourceCandidates` fields;
- old comments referring to schema-v2-shaped captures or Fiber candidates.

### Delete schema compatibility

Remove:

- `TASK_SCHEMA_VERSION_V1`, `_V2`, `_V4`, v5 compatibility constants;
- normalizers/migrations accepting v1–v5;
- v4→v5 annotation conversion;
- tests/golden fixtures whose only purpose is rendering old schemas;
- docs telling users old artifacts are supported.

Keep one explicit unsupported-schema error path that compares `schemaVersion !== 6`. This is rejection, not compatibility.

### Delete runtime fallback language/branches

Audit active source for:

- `fallback`;
- `legacy`;
- `try custom` / `try old`;
- `resolver: "legacy"`;
- optional engine arrays;
- source guessing when React Grab returns null.

Remove them. A null source remains null.

### Simplify server/Vite code

After removing source backfill:

- simplify task serialization;
- remove now-unused Vite imports/constants/module traversal;
- simplify endpoint responses;
- make source-revision code consume v6 frames directly;
- reduce tests tied to implementation details while retaining security and product contracts.


### Add a permanent architecture audit command

Add one public package script, for example:

```json
"studio:inspection:audit": "tsx ./scripts/portal-studio-inspection-audit.ts"
```

The audit must exit non-zero unless all of these are true:

- exactly one active application source file imports `react-grab/primitives`;
- no full `react-grab` UI import exists;
- no direct `element-source` dependency/import exists;
- no private Fiber-key access exists;
- no Vite transformed-code/component-name source guessing exists;
- no candidate-array field/type exists;
- no v1-v5 normalizer/migration exists;
- no runtime legacy/fallback engine branch exists.

Use explicit path allowlists for archived documentation and the audit script's own pattern strings so the command does not pass by hiding active code. Unit-test both passing and intentionally failing fixture trees. This command is a regression guard, not a substitute for the independent semantic review.

### Archive conflicting plans

Current repository contains old ExecPlans and decisions that explicitly promoted the custom Fiber/module-graph adapter and v1–v5 compatibility. Move superseded documents to an archive location or add an unmistakable header:

```text
ARCHIVED — DO NOT IMPLEMENT — superseded by React Grab single-engine migration v1
```

Active usage/security/MCP docs must describe v6 only.

### Code-size/ownership cleanup

Do not use this Goal for unrelated architectural redesign, but extract obvious migration seams from `toolbar.tsx` if they remain embedded:

- capture controller;
- inspection request lifecycle;
- selection hierarchy;
- marker resolution;
- task mutation client.

The purpose is to make the one-engine ownership obvious, not to chase arbitrary line-count targets.

## Mandatory zero-result checks

These must return no matches in active source/tests/scripts (archive docs may be excluded explicitly):

```bash
rg -n '__reactFiber\$|findFiberKey|collectComponentChain|readFiberTypeName' src/studio tests e2e scripts
rg -n 'resolveComponentSources|assignSourceCandidates|transformResult\?\.code' src/studio tests e2e scripts
rg -n 'selectorCandidates|componentCandidates|sourceCandidates' src/studio tests e2e scripts
rg -n 'TASK_SCHEMA_VERSION_V1|TASK_SCHEMA_VERSION_V2|TASK_SCHEMA_VERSION_V4|normalizeV4ToV5|normalizeLegacyToV5|normalizeElementCaptureV5' src/studio tests e2e scripts
rg -n 'resolver:\s*["'"']legacy["'"']|Legacy.*Adapter|fallback.*engine|engine.*fallback' src/studio tests e2e scripts
rg -n 'element-source' package.json pnpm-lock.yaml src tests e2e scripts
```

Direct React Grab import check must show exactly one active source file:

```bash
rg -n 'react-grab/primitives' src tests e2e scripts
```

## Acceptance criteria

- **G05-AC01:** `src/studio/grab.ts` is deleted.
- **G05-AC02:** no React private Fiber property access remains.
- **G05-AC03:** no Vite transformed-code/component-name source resolver remains.
- **G05-AC04:** no candidate-array types/fields remain.
- **G05-AC05:** no v1–v5 normalizer/migration remains.
- **G05-AC06:** old tasks are rejected only through one simple schema-version check.
- **G05-AC07:** no runtime perception fallback or legacy adapter remains.
- **G05-AC08:** exactly one active source file imports React Grab primitives.
- **G05-AC09:** no direct element-source dependency/import exists.
- **G05-AC10:** endpoint/Vite/task code is measurably simpler and all dead imports/constants/tests are removed.
- **G05-AC11:** active docs describe v6/single-engine behavior only.
- **G05-AC12:** all product, security, CLI and browser tests still pass.
- **G05-AC13:** production exclusion still passes.
- **G05-AC14:** `pnpm studio:inspection:audit` exists, fails on injected forbidden fixtures and passes on the cleaned repository.

## Required verification

Run all mandatory greps plus:

```bash
pnpm studio:inspection:audit
pnpm typecheck
pnpm test
pnpm test:e2e -- e2e/portal-studio.spec.ts
pnpm build
```

Also run an unused-export/dead-code check available in the repo or use TypeScript/ESLint evidence. Do not add a large new analyzer solely for this Goal unless justified.

## Independent review requirement

After implementation, perform a second pass that starts from the shared contract, not from the diff summary. Search for semantic equivalents of the old engine even when names changed. Examples:

- `Object.keys(element)` + React internals;
- component-name regex scanning source strings;
- multiple inspection implementations;
- old schema branches hidden under generic names.

Record findings and fixes.

## Progress

- [ ] Inventory every old symbol and import edge.
- [ ] Delete custom Fiber path.
- [ ] Delete Vite source guessing/backfill.
- [ ] Delete candidate schema.
- [ ] Delete v1–v5 compatibility.
- [ ] Simplify endpoint/task/revision/formatter code.
- [ ] Archive conflicting docs.
- [ ] Add and test the permanent inspection audit command.
- [ ] Run zero-result checks.
- [ ] Perform independent semantic review.
- [ ] Run full gates and audit ACs.

## Surprises & Discoveries

- None yet.

## Decision Log

- Decision: Old dev artifacts are disposable and receive no migration.
  Rationale: feature is unreleased; compatibility would permanently retain duplicate concepts.
  Date/Author: Goal author; confirm during implementation.

## Outcomes & Retrospective

Fill at completion, including before/after changed line counts for the removed engine area and all zero-result outputs.
