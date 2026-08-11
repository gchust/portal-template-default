# Goal 03 — atomically cut every production capture path to React Grab and schema v6

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current.

## Goal contract

**Objective:** Switch Pick, Multi, Area, task save/read, Marker rehydration, formatter, CLI, MCP and revision/source-file calculations to the single React Grab inspection domain and schema v6 in one coherent cutover.

**Stopping condition:** A newly started dev session can create, reload, copy, complete and reopen v6 annotations through all three capture modes; no production path calls the old perception engine or Vite source backfill.

Old source files may remain physically present until Goal 05, but they must be unreachable from production and active tests. No fallback is allowed.

## Purpose / big picture

Avoid a mixed task format where Pick saves v6 while Area saves v5. This Goal changes the product boundary as one transaction.

## Required changes

### 1. Task schema cutover

Set:

```ts
TASK_SCHEMA_VERSION = 6
```

Update `ElementCapture`, `Region`, `Annotation.pageContext` and the complete task model to the exact shared v6 shape. Update server sanitation, task model, mutation, format, print CLI, MCP output, screenshot metadata, revision calculation and tests. `pageContext` is required on every new annotation and region coordinates are document-relative.

During this Goal, old schemas may receive one explicit `unsupported_schema` response. Do not normalize them. Full compatibility deletion is completed in Goal 05.

### 2. Async capture pipeline

Current capture is synchronous. Replace it with a bounded async flow:

```text
live Element(s)
  -> inspect each target with the sole InspectionEngine
  -> enrich NocoBase context
  -> redact/limit
  -> build Annotation draft
```

Requirements:

- preserve the live selection while inspection is pending;
- show an explicit capture/inspection error without losing the user's comment or selection;
- allow retry;
- do not save a partially inspected multi annotation;
- use an inspection concurrency limit of exactly 4;
- preserve input order;
- no old `captureElement`/component/source candidate call.

### 3. Pick and Multi hit testing

All pointer selection uses engine coordinates, never raw `event.target` as the page target.

Pick:

- `getTargetAtPoint` chooses one useful target;
- hierarchy arrows may move among grabbable composed ancestors;
- final annotation has exactly one v6 element.

Multi:

- each click uses the same engine;
- toggle identity uses live Element identity during the active session;
- saved annotation preserves selection order and contains one v6 capture per target;
- duplicates are removed.

### 4. Area cutover

Replace `document.body.querySelectorAll("*")` as the primary collector. Use React Grab point-stack sampling across the region:

- include corners, center and a bounded adaptive grid;
- call `getTargetsAtPoint` with the Studio filter;
- deduplicate live elements;
- prune composed ancestor/descendant duplicates using a documented semantic score;
- prefer NocoBase business elements, interactive targets and user-defined source components;
- convert the pointer rectangle to document-relative v6 coordinates and preserve it even if no element source is available;
- cap targets at the existing safe task limit.

Do not fall back to full-DOM scanning.

### 5. Marker rehydration

`markers.ts` must resolve the one persisted React Grab selector using the Goal 02 locator and validate the fingerprint. Remove first-match candidate iteration from the active path.

Rules:

- current route must match annotation page context;
- selector resolves + fingerprint passes -> marker rendered;
- selector fails or fingerprint fails -> unresolved list entry, no marker;
- never attach to a different role/class/text approximation;
- Multi editor highlights every successfully resolved target;
- Region behavior remains route-aware and viewport/document-coordinate correct.

### 6. Remove server source guessing from active path

Task POST no longer extracts component names or calls:

- `resolveComponentSources`;
- `assignSourceCandidates`;
- Vite module-graph source scan.

Source revision calculation uses `element.source` and `sourceStack` workspace paths. Deduplicate paths and ignore null/external frames.

### 7. Shared formatter and Agent handoff

Expose and test public package commands through `tsx`; do not document raw `node` execution of files that import TypeScript modules:

```json
"studio:list": "tsx ...",
"studio:complete": "tsx ...",
"studio:reopen": "tsx ...",
"studio:print": "tsx ...",
"studio:verify": "tsx ...",
"studio:mcp": "tsx ..."
```

Process-level tests must spawn the public package scripts or the same `tsx` entrypoint and assert exit code/stdout/stderr.


Update Markdown/JSON output to show:

- selector;
- component name;
- primary `filePath:line:column`;
- bounded source stack;
- unresolved source explicitly when null;
- NocoBase business context;
- annotation ID and completion command.

Do not emit old candidate terminology.

### 8. Current task handling

Because compatibility is intentionally not required:

- if `.portal-studio/tasks/active-task.json` is v1–v5, browser shows a clear unsupported-task message;
- CLI exits non-zero with a clear message and a command/path to clear the dev artifact;
- no automatic migration;
- creating the first v6 annotation after clearing works normally.

## Acceptance criteria

- **G03-AC01:** Pick saves one v6 element with React Grab selector, bounds, source and stack.
- **G03-AC02:** Multi saves one annotation with N ordered v6 elements.
- **G03-AC03:** Area saves a document-relative v6 region and bounded semantically deduped v6 targets without full-DOM scan.
- **G03-AC04:** pointer selection no longer treats nested SVG `path` as the chosen target in the fixture.
- **G03-AC05:** Marker reload uses one selector + fingerprint and never first-match candidate arrays.
- **G03-AC06:** fingerprint mismatch becomes unresolved.
- **G03-AC07:** Shadow DOM target survives reload and rehydrates.
- **G03-AC08:** same-origin iframe target uses top-level bounds and selector rehydration where the frame remains available.
- **G03-AC09:** task POST performs no moduleGraph/transform source backfill.
- **G03-AC10:** formatter, Copy, print CLI and MCP contain v6 source location and no candidate vocabulary.
- **G03-AC11:** source revision follows v6 source paths.
- **G03-AC12:** every browser/endpoint/print/verify/CLI/MCP old-task path returns the shared typed `unsupported_schema` result and performs no migration.
- **G03-AC13:** existing annotation edit/delete/complete/reopen/list/revision flows pass.
- **G03-AC14:** no active production import/reference reaches `grab.ts` or old source resolver.
- **G03-AC15:** no runtime fallback path exists.
- **G03-AC16:** production build still excludes Studio/React Grab.

## Required tests

Update or add:

- v6 task-model unit tests;
- endpoint sanitation and size tests;
- formatter golden tests;
- CLI/MCP schema tests;
- source revision tests;
- Marker locator tests;
- component tests for pending/failed async inspection;
- Playwright Pick/Multi/Area creation and reload;
- fixture source assertions;
- old-schema explicit rejection.

## Required verification

```bash
pnpm typecheck
pnpm test -- tests/logic/portal-studio tests/components/portal-studio
pnpm test:e2e -- e2e/portal-studio.spec.ts
pnpm build
rg -n 'selectorCandidates|componentCandidates|sourceCandidates' src/studio scripts
rg -n 'resolveComponentSources|assignSourceCandidates|transformResult\?\.code' src/studio
rg -n 'from ["'"']\./grab["'"']|from ["'"'].*grab["'"']' src/studio
rg -n 'fallback|legacy' src/studio/inspection src/studio/toolbar.tsx src/studio/capture.ts src/studio/markers.ts
rg -n 'react-grab|bippy|portal-studio' dist
```

At this stage old definitions may still exist in unused files, but active path/import graph checks must prove they are unreachable. Goal 05 requires zero physical legacy code.

## Evidence artifacts

Capture at least:

- v6 Pick task JSON;
- v6 Multi task JSON;
- v6 Area task JSON;
- before/after reload screenshots with Marker;
- unresolved fingerprint-mismatch screenshot;
- Copy Markdown;
- old-schema error screenshot/CLI log;
- active-import graph or grep report.

## Stop/block rules

Do not re-enable old code when React Grab inspection fails. Keep the draft/selection and surface a retryable error. If an upstream limitation prevents a required product path, stop with evidence and request a product decision.

## Progress

- [ ] Baseline current task/UI/CLI tests.
- [ ] Change task/schema contracts to v6.
- [ ] Make capture async and bounded.
- [ ] Cut Pick and Multi to engine hit testing/inspection.
- [ ] Cut Area to point-stack sampling.
- [ ] Cut Marker to selector locator/fingerprint.
- [ ] Remove active source backfill.
- [ ] Update formatter/CLI/MCP/revision.
- [ ] Add old-schema explicit rejection.
- [ ] Run full focused tests and independent AC audit.

## Surprises & Discoveries

- None yet.

## Decision Log

- Decision: All capture modes and persisted task readers switch in one Goal.
  Rationale: mixed schemas would create temporary compatibility logic and ambiguous artifacts.
  Date/Author: Goal author; confirm during implementation.

## Outcomes & Retrospective

Fill at completion with exact evidence and every AC status.
