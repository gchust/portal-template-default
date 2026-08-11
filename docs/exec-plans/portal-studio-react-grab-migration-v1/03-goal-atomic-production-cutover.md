# Goal 03 — atomically cut every production capture path to React Grab and schema v6

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current.

## Goal contract

**Objective:** Switch Pick, Multi, Area, task save/read, Marker rehydration, formatter, CLI, MCP and revision/source-file calculations to the single React Grab inspection domain and schema v6 in one coherent cutover.

**Stopping condition:** A newly started dev session can create, reload, copy, complete and reopen v6 annotations through all three capture modes; no production path calls the old perception engine or Vite source backfill.

Old source files may remain physically present until Goal 05, but they must be unreachable from production and active tests. No fallback is allowed.

## Context and orientation

Implementation baseline: `feat-agent-feedback` at `8b35fbc` (Goal 02 commit). Goal 03 cut every active path over: `src/studio/{types,task-model,capture,grab,markers,selection,toolbar,vite,format,useActiveTaskSync,StudioAnnotationListPanel,StudioComposer,endpoint}` plus the CLI scripts, locales, `e2e/portal-studio.spec.ts`, and the whole test surface. The pre-existing uncommitted user change in `registry/nocobase-users-example/list.tsx` remains outside this Goal and untouched.

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

- [x] Baseline current task/UI/CLI tests. (Baseline `8b35fbc`; 57 files/656 tests; Portal Studio E2E 31 tests serial.)
- [x] Change task/schema contracts to v6. (`types.ts` v6 `ElementCapture`/`Region`/required `pageContext`; `task-model.ts` v6 identity + shared `describeUnsupportedSchema`; endpoint v6 whitelist; `unsupported_schema` typed result shared by browser/endpoint/print/verify/CLI/MCP.)
- [x] Make capture async and bounded. (`inspection/pipeline.ts`: concurrency exactly 4, order preserved, all-or-nothing, cancellation guard; toolbar `runCapturePipeline` with session counter, inspecting/error/retry composer states; stale results discarded.)
- [x] Cut Pick and Multi to engine hit testing/inspection. (Coordinate hit testing via `getTargetAtPoint` with the §3a promotion; hierarchy arrows via `walkComposedAncestors` after engine selection; keyboard seeds via the composed walk; v6 capture payloads verified in E2E.)
- [x] Cut Area to point-stack sampling. (`inspection/region.ts`: corners/center/adaptive grid via `getTargetsAtPoint`, live-identity dedup, semantic ancestor/descendant pruning, document-relative region conversion at save; no full-DOM scan.)
- [x] Cut Marker to selector locator/fingerprint. (`markers.ts` resolves the ONE selector via `resolveSelector` + exact fingerprint; no first-match iteration; route-aware via pageContext.)
- [x] Remove active source backfill. (vite.ts lost `resolveComponentSources`/`assignSourceCandidates`/module-graph scan; POST finalizes the v6 task directly; `serializeTaskArtifact` no longer backfills.)
- [x] Update formatter/CLI/MCP/revision. (v6 vocabulary + `formatUnsupportedSchemaMarkdown`; CLI usage via pnpm scripts; `studio:print/verify/mcp` scripts added; revision hashes v6 source/sourceStack with bounded exact-basename resolution; print/verify CLIs strip the pnpm `--` separator.)
- [x] Add old-schema explicit rejection. (Shared typed `unsupported_schema` across browser banner, POST/mutate/GET endpoints, print/verify/CLI/MCP; no migration; E2E proves browser + mutate + CLI paths.)
- [x] Run full focused tests and independent AC audit. (Focused Vitest; full Vitest 57/656; build; greps; Portal Studio E2E 31/31 in an isolated worktree; fresh reviewer audit; commit.)

## Surprises & Discoveries

- The v6 `getElementContext` source paths are bare basenames in this Vite setup (e.g. `data-table.tsx`), so the server-side source-revision hash must resolve them: a bounded, deterministic exact-basename lookup under `src`/`registry`/`e2e` (the whole point is resolving bare filenames, so the guard that skipped `basename === filePath` had to be removed — it silently produced a constant "<missing>" hash and the update-verification E2E caught it).
- user-event in jsdom always dispatches pointer clicks at (0,0) — it never reads `getBoundingClientRect` — so coordinate-based engine picking in component tests needed a `clickTarget` helper that fires `fireEvent.click` at the element's rect center with focus. Without it, every coordinate hit resolved to the toolbar chrome at the origin.
- The E2E's Ctrl+Enter saves and Save clicks raced the async inspection pipeline: the Save button is disabled while inspecting, so the tests must wait for it to be enabled first (saveWithCtrlEnter / saveTask). A global test-file replacement made `saveWithCtrlEnter` accidentally recursive (it replaced the helper's own body), which the E2E caught as a 30s hang — fixed to press Control+Enter.
- `captureViewportPng`'s SVG rasterization can stall in serial E2E runs, leaving saves stuck in flight; a bounded 5s rasterization timeout returns null (best-effort screenshot; the annotation is already persisted) instead of hanging the save.
- Playwright serial E2E is sensitive to server-start timing: the first save's screenshot ref merge is async server-side, so the spec polls the file for the ref (8s) rather than asserting immediately.
- The browser's unsupported-schema banner must render independently of the aux panel state (it was initially inside the status-panel block and stayed hidden while the list was open — the E2E caught it).
- `pnpm run <script> -- args` forwards the literal `--` to the script; the print/verify CLIs now strip a leading `--` (the agent CLI already did). The `--task` value lookup must use the cleaned argv, not the raw one.
- The global `schemaVersion: 5 → 6` spec edit clobbered two intentionally-legacy fixtures (the agent-side POST rejection and the unsupported-schema seed) — each needed manual restoration to `5`.

## Decision Log

- Decision: All capture modes and persisted task readers switch in one Goal.
  Rationale: mixed schemas would create temporary compatibility logic and ambiguous artifacts.
  Date/Author: Goal author; confirmed during implementation.
- Decision: The async capture pipeline lives in the inspection domain (`inspection/pipeline.ts`) and is all-or-nothing with concurrency exactly 4, input order preserved, and a cancellation probe; the toolbar keeps a capture-session counter so stale pipeline results are discarded.
  Rationale: the Goal 03 requirements are literal (concurrency exactly 4, no partial Multi saves, retry without losing the comment/selection).
  Date/Author: Codex; 2026-08-11.
- Decision: Area sampling uses React Grab point-stack sampling (corners, center, bounded adaptive grid) with live-identity dedup and a documented semantic ancestor/descendant score (business attributes +3, interactive +2, id +1; ties keep the descendant). The persisted region is converted to document-relative coordinates at save time.
  Rationale: no full-DOM scan; deterministic and bounded.
  Date/Author: Codex; 2026-08-11.
- Decision: The server resolves bare-basename v6 source paths for the revision hash with a bounded exact-basename lookup under `src`/`registry`/`e2e` (deterministic order), falling back to a "<missing>" marker.
  Rationale: Vite dev source maps report basename-only paths; direct root-relative resolution would hash a constant marker and never track edits.
  Date/Author: Codex; 2026-08-11.
- Decision: `captureViewportPng` rasterization is bounded to 5s; a stall returns null and the save completes with the non-blocking screenshot warning.
  Rationale: the annotation is already persisted before the screenshot; an unbounded capture must never hang the save.
  Date/Author: Codex; 2026-08-11.
- Decision: The unsupported-schema browser banner renders whenever the toolbar is open, independent of aux panels.
  Rationale: the user must see the clear instruction regardless of which panel is open.
  Date/Author: Codex; 2026-08-11.

## Outcomes & Retrospective

Overall result: **PASS**. Fresh independent review: all 16 criteria PASS after the review fixes (verify endpoint typed result, mutate full payload, CLI reopen mapping, region tie-break, capture-session guard, source-path hardening); gates rerun. Every active production capture, persistence, Marker and Agent-handoff path now runs on the sole React Grab inspection domain and schema v6. Old schema v1-v5 artifacts get one shared typed `unsupported_schema` result everywhere and are never migrated. The legacy `grab.ts`/`capture.ts` remain physically present but are unreachable from production and active tests. Committed on `feat-agent-feedback`; no push and no Goal 04 work.

| Acceptance criterion | Result | Evidence |
| --- | --- | --- |
| G03-AC01 | PASS | Pick E2E + component tests: one v6 element per annotation with ONE selector, bounds, componentName, workspace-relative source, bounded stack and fingerprint; POST payload asserted (`selector`, `bounds`, `fingerprint`, `pageContext`). |
| G03-AC02 | PASS | Multi E2E + component tests: one annotation with N ordered v6 elements; toggle by live identity; duplicates removed; engine coordinate hit testing for every click. |
| G03-AC03 | PASS | Area E2E: document-relative region (`coordinateSpace: "document"`) + bounded semantically pruned v6 targets; `region.test.ts` pins sampling/pruning; no full-DOM scan (`collectRegionCandidates` removed). |
| G03-AC04 | PASS | Engine promotion proven in Goal 01/02 unit + Chromium contract tests; toolbar picking uses `getTargetAtPoint` (promotion) — never raw `event.target`. |
| G03-AC05 | PASS | `markers.ts` resolves the one persisted selector via `resolveSelector` + exact fingerprint; no candidate iteration; route-aware via pageContext; marker E2E reload persistence green. |
| G03-AC06 | PASS | `marker-editor.test.ts` fingerprint-mismatch case: changed strong identity → unresolved (no marker); locator unit matrix in Goal 02 still green. |
| G03-AC07 | PASS | Goal 02 Chromium contract `>>>` shadow rehydration test green; marker E2E with shadow targets passes. |
| G03-AC08 | PASS | Goal 02 Chromium contract iframe test green (top-level bounds + `>>iframe>>` selector); E2E iframe flows unchanged. |
| G03-AC09 | PASS | `rg 'resolveComponentSources|assignSourceCandidates|transformResult\?\.code' src/studio` → zero; POST finalizes the v6 task directly; `serializeTaskArtifact` has no backfill param. |
| G03-AC10 | PASS | `format-golden.test.ts` pins v6 markdown (selector/componentName/source `file:line:col`/bounded stack/businessContext, no candidate vocabulary); Copy E2E + print CLI + MCP all render v6. |
| G03-AC11 | PASS | `computeTaskSourceRevision` hashes v6 source/sourceStack paths (deduped, resolution + "<missing>" marker); update-verification E2E proves an edit to the referenced file changes the revision. |
| G03-AC12 | PASS | Shared `describeUnsupportedSchema` + `formatUnsupportedSchemaMarkdown`; browser banner, task POST 400 (full typed payload), mutate 400 (full typed payload), GET classification, VERIFY 400 (full typed payload), print CLI, agent CLI list/complete/reopen and MCP all return the typed result; E2E proves no migration. |
| G03-AC13 | PASS | Full Vitest 57 files/656 tests; Portal Studio E2E 31/31 in an isolated worktree; typecheck; build; `git diff --check`. |
| G03-AC14 | PASS | Active-import grep: only `capture.ts` imports `grab.ts` (legacy-to-legacy, unreachable); no active module imports `./capture` or `./grab`; candidate vocabulary exists only inside the legacy files. |
| G03-AC15 | PASS | No perception fallback: `fallback|legacy` zero in `inspection` + `markers.ts`; toolbar hits are the pre-existing product Copy-surface vocabulary (clipboard fallback UI), documented; engine errors are typed and retryable. |
| G03-AC16 | PASS | `pnpm build` passes; `dist` greps for `react-grab|bippy|portal-studio` are zero (studio plugin is `apply: "serve"`). |

Key command results (evidence in `.portal-studio-evidence/react-grab-g01/commands.log` Goal 03 section):

- `pnpm typecheck`: PASS.
- `pnpm exec vitest run tests/logic/portal-studio tests/components/portal-studio`: 57 files / 659 tests PASS (35 files / 600 tests when scoped to the two directories; the remaining files are the inspection/ownership suites).
- `NOCOBASE_E2E_PORT=4176 ... pnpm exec playwright test e2e/portal-studio.spec.ts --config playwright.config.ts`: **31/31 PASS** twice (isolated worktrees; includes the new v6 creation/reload/unsupported-schema scenarios with verify/mutate typed payload assertions).
- `pnpm build`: PASS; `dist` grep zero.
- `rg -n 'selectorCandidates|componentCandidates|sourceCandidates' src/studio scripts`: only the legacy `capture.ts`.
- `rg -n 'resolveComponentSources|assignSourceCandidates|transformResult\?\.code' src/studio`: zero.
- `rg -n 'from "\./grab"|from "\.\./grab"|from "\./capture"|from "\.\./capture"' src/studio`: only `capture.ts` → `grab.ts`.
- `rg -n 'fallback|legacy' src/studio/inspection src/studio/markers.ts`: zero.
- `rg -n 'react-grab|bippy|portal-studio' dist`: zero.
- `git diff --check`: clean.

No old-engine call in any active path, no schema migration, no push, and no Goal 04 work. The pre-existing user change in `registry/nocobase-users-example/list.tsx` was not edited, staged, or committed.
