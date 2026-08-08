# Goal 00 — Portal Studio Annotation-first redesign: execution plan

Status: PLAN ONLY (this goal produces this document + review + checkpoint;
the five goals below are implemented sequentially by later goals).

Baseline (repository-grounded, see /root/work/dogfood-crm/evidence-reconcile/):

- portal-template-default branch `feat-agent-feedback` HEAD
  `aeafbbb28be2809d8d6e7e959bfc60db98627f90` (clean; == origin/feat-agent-feedback).
- NocoBase baseline reconciled to origin/develop
  `f0a480e9f0647986ee88ec4b3dc4ab4428c7df03` (authorized ff-only merge,
  task-1; only substantive delta: #10315 `nb portal push` local Git identity).
- Test baselines at aeafbbb: unit 36 files / 224 tests exit 0; e2e 6/6
  (login + 5 studio specs); typecheck/eslint 0; dogfood D-027 baseline
  failure only.

## Scope

The five goals below complete the "Annotation-first feedback" redesign of
Portal Studio on portal-template-default:

| Goal | Title |
| --- | --- |
| G01 | Draggable dock |
| G02 | Persistent per-comment annotations (schemaVersion 5) |
| G03 | Multi-select / area / per-marker edit-delete |
| G04 | Copy / explicit Complete / shared formatter |
| G05 | Hardening & cleanup |

EXPLICITLY OUT of this plan (per Goal 00 contract): multi-task
history/archive, commit rewriting (aeafbbb "chore: test" is immutable), any
portal-template-default upstream rebase/merge, release/publish, dogfood
implementation (the dogfood portal stays on the current Studio until later
decisions; the product source of truth remains portal-template-default and
syncs happen outside this plan).

Cross-cutting invariants (must survive every goal):

- Dev-only: plugin `apply: "serve"`, endpoints absent from `pnpm build`
  (dist grep 0 matches, exit 1 asserted).
- Base-aware bootstrap (D-025), LAN/remote source trust + `allowRemote`
  (D-031), non-secure-context `newTaskId()` fallback (D-031), session token
  constant-time verification (D-022), loopback+own-interface default.
- All user-facing strings through i18n (`t()`/`translate`, en-US + zh-CN).
- Gates per goal: `set -o pipefail` with real exit codes — `pnpm test`,
  `pnpm typecheck`, `pnpm build`, `pnpm exec eslint`, `pnpm test:e2e` (6/6),
  `git diff --check`; dist precise grep must stay 0 matches.
- a11y: keyboard navigation, ARIA, focus containment inside the dock/panel.

---

## G01 — Draggable dock

**Objective**: Replace the fixed bottom-right toggle+panel with a draggable
dock: grab to reposition anywhere in the viewport, collapse/expand, and
remember the position across reloads (dev session).

**Success criteria**:
- The dock (toggle + panel unit) can be dragged by pointer and keyboard
  (arrow keys while focused per a11y) and never escapes the viewport
  (clamped to visible bounds, including under a scrolled page).
- Position persists across reloads (localStorage key, e.g.
  `portal-studio.dock`) with the existing session semantics; a
  collapse/expand affordance restores the compact toggle state.
- Drag interaction never conflicts with page selection capture (marquee /
  pick pointer handlers stay on the page, dock handles its own pointer
  events only).
- New tests: unit (drag clamp math, persistence round-trip) + e2e spec
  step (drag → position change → reload → position retained).

**Boundaries**: layout/interaction only — no schema change; panel content
and modes untouched; dark/light theme palette (D-031) applies to the dock.

**Tasks**:
1. `src/studio/toolbar.tsx` + `src/studio/index.tsx` (TOOLBAR_STYLES):
   add dock position state (`{x,y}` or anchored default), pointer drag
   handlers (pointerdown/move/up with setPointerCapture), keyboard drag,
   viewport clamping (element size + `window.innerWidth/Height`).
2. Persistence module (reuse `task-id.ts`-style util file, e.g.
   `src/studio/dock.ts`): load/save position with try/catch (privacy mode),
   default bottom-right when absent.
3. Collapse/expand: existing `.ps-toggle` becomes the collapse target; when
   collapsed, drag still works; `aria-expanded` on the toggle.
4. Tests: `tests/logic/portal-studio/dock.test.ts` (clamp math, save/load,
   defaults) + `tests/components/portal-studio/toolbar.test.tsx` (drag
   events render position) + new e2e step in `e2e/portal-studio.spec.ts`
   (drag → reload → position retained).
5. i18n keys (en-US + zh-CN) for any new labels; docs: D-033 in the
   contract Decision Log + this plan's goal entry marked done.

**Done = ACs above pass on the template dev page + full gates green.**

---

## G02 — Persistent per-comment annotations (schemaVersion 5)

**Objective**: Annotations become persistent, per-comment artifacts instead
of one-shot save-time markers: each comment owns its markers (element
refs / region), text, and status, and survives HMR/reload within the dev
session; task JSON moves to **schemaVersion 5** with a v4→v5 migration.

**Success criteria**:
- `types.ts`: `TASK_SCHEMA_VERSION = 5` (v4 const retained); v5 task shape
  replaces the single `elements[] + region + instruction` with
  `annotations[]` (each: stable `annotationId`, `kind: "element" | "region"`,
  marker payload with element refs/selector candidates or region rect,
  `comment`, `status: "open" | "completed"`, `createdAt`, optional
  `sourceCandidates`) while keeping `taskId/url/title/businessContext/
  diagnostics/redaction` top-level for agent compatibility.
- v4 artifacts remain readable: the print CLI (`--json`/`--markdown`) and
  MCP `print_task` accept both v4 (single instruction/elements) and v5
  (per-comment), normalizing to the agent-facing format; a v4 file read
  with the new code is served without loss (migration notes below).
- Save writes the v5 task atomically (existing `atomicWriteTaskFile`
  slot); markers re-render as overlay outlines on page load/reload from the
  persisted task (persistent visual layer, independent of capture session).
- Migration notes (in-code + docs): (a) v4 `instruction` → v5 single
  annotation comment when converting; (b) v4 `elements[]` → v5 marker with
  `kind: "element"` per element (element index retained as `ref`); (c) v4
  `region` → v5 marker `kind: "region"`; (d) `redaction`/`diagnostics`/
  `screenshot` fields unchanged; (e) active-task file version stamped and
  written as v5 on next save; (f) CLI/MCP keep a `--schema v4` passthrough
  for debugging.

**Boundaries**: no multi-task queue/history (excluded); single active task
slot stays; screenshot pipeline unchanged (one annotated capture per task
today; per-marker re-capture arrives in G03).

**Tasks**:
1. `src/studio/types.ts`: v5 types + `normalizeTask` (v4|v5 → canonical v5)
   in a pure module (`src/studio/task-model.ts`) with unit tests
   (v4 fixture → v5 normalized, lossless).
2. `src/studio/toolbar.tsx`: capture session builds annotations (element
   pick → element annotation; marquee → region annotation) instead of the
   flat selection; comment text per annotation; save serializes v5.
3. `src/studio/endpoint.ts` + `src/studio/vite.ts`: v5 write path (same
   active-task slot), accept + normalize v4 reads on `GET`.
4. `scripts/portal-studio-print.mjs` + `scripts/portal-studio-mcp.mjs`:
   v4/v5 dual reader with normalization; tests for both versions.
5. `src/studio/index.tsx`: persistent overlay layer re-renders markers from
   the persisted task after reload (HMR-safe; see G05 for edge cases).
6. Tests: `tests/logic/portal-studio/task-model.test.ts` (normalize v4→v5,
   round-trip), endpoint tests (v5 write + v4 read), print-cli tests
   (v4/v5 output), e2e: annotate → reload → markers still rendered.
7. Docs: schema v5 migration section in this plan + D-034.

**Done = v4 artifacts readable end-to-end (CLI/MCP), v5 save/load
round-trips, markers persist across reload, full gates green.**

---

## G03 — Multi-select / area / per-marker edit-delete

**Objective**: Manage annotations per marker: edit a marker's comment and
target, re-size/re-grab a region, delete individual markers, and maintain a
multi-selection list in the dock — replacing today's all-or-nothing
replace/clear behavior.

**Success criteria**:
- Dock shows the annotation list (from G02) with per-marker actions:
  edit comment (inline textarea), delete (confirm), and re-target
  (re-enter pick mode for that marker; region markers get a re-grab).
- Multi-select: shift-click on the page adds/removes elements INTO an
  existing annotation (merge) or across markers (bulk delete); marquee
  area can be re-sized by dragging its handles after creation.
- Deleting the last marker of a task leaves a valid v5 task with zero
  annotations (or explicit empty state); per-marker edits persist through
  atomic rewrite of active-task.json.
- Keyboard: markers focusable in the list (Tab), delete via Delete/Backspace
  with focus in list, Esc cancels edits.
- Tests: unit (selection→annotation ops, merge semantics, delete-empty),
  e2e: multi-select merge → edit marker text → delete marker → reload →
  state retained.

**Boundaries**: interaction + persistence of annotations only; no new
endpoints (single active-task slot); screenshot re-capture per marker is
limited to the existing whole-task capture (per-marker screenshots are a
later decision — record in D-log if needed).

**Tasks**:
1. `src/studio/selection.ts`/`capture.ts`: marker identity + merge ops
   (add/remove element refs into an annotation; region handle model).
2. `src/studio/toolbar.tsx`: annotation list UI in the dock (reuse panel
   styles), per-marker edit/delete/retarget, bulk ops, empty state.
3. `src/studio/endpoint.ts`: atomic rewrite on every annotation mutation
   (debounced), unchanged endpoint surface.
4. `src/studio/index.tsx`: region resize handles overlay (pointer + clamp
   like G01).
5. Tests: `tests/logic/portal-studio/annotation-ops.test.ts` (pure ops),
   toolbar component tests, e2e steps (edit/delete/merge + reload
   retention).
6. i18n + D-035.

**Done = all per-marker ops work in real browser with reload retention,
unit + e2e green.**

---

## G04 — Copy / explicit Complete / shared formatter

**Objective**: Workflow affordances: one-click Copy of the agent-facing
artifact (markdown/JSON), an explicit Complete action that marks a task
`status: "completed"` (the verify loop treats it as authoritative), and a
single shared formatter used by client Copy, print CLI, and MCP.

**Success criteria**:
- Dock adds "Copy" (copies the normalized agent-facing markdown — same
  output as `portal-studio-print.mjs --markdown` for the active task — to
  clipboard; JSON variant via Copy+Shift or menu), and "Complete" (sets
  `status: "completed"` + `completedAt` in the v5 task; UI shows completed
  state; verify script exit semantics unchanged for open tasks, and a
  completed task yields exit 0 with a "completed" marker).
- One formatter module (e.g. `src/studio/format.ts`, pure) is the single
  source of truth: `scripts/portal-studio-print.mjs` and MCP `print_task`
  import it; the client Copy calls the same module (bundled copy, since
  client is browser-side — the module must stay dependency-free and tested
  in both node and jsdom).
- Clipboard uses the async Clipboard API with a textarea fallback
  (non-secure-context safe, D-031 style); Copy reports success/failure in
  the dock.
- Tests: formatter golden tests (identical output across the three
  consumers), complete-flow unit + e2e (mark complete → verify exits
  completed → copy yields identical markdown to CLI).

**Boundaries**: no multi-task queue (Complete applies to the active task);
no new endpoint for status (reuse active-task atomic write); verify
semantics for completed tasks documented (D-036).

**Tasks**:
1. `src/studio/format.ts`: `formatTaskMarkdown(task)` / `formatTaskJson(task)`
   (v4/v5 normalized input) — extracted from print-cli with golden tests.
2. `scripts/portal-studio-print.mjs` + `scripts/portal-studio-mcp.mjs`:
   import the shared formatter (delete duplicated code); keep CLI flags.
3. `src/studio/types.ts` (+task-model): `status: "open" | "completed"`,
   `completedAt?`; endpoint accepts status update (PATCH on active task or
   same POST semantics — decide at implementation, safest minimal, and
   record the choice in the Decision Log, e.g. D-037).
4. `src/studio/toolbar.tsx`: Copy + Complete buttons + feedback; i18n.
5. Tests: golden formatter tests, print-cli/MCP parity tests, e2e complete
   + copy step; D-036.

**Done = CLI/MCP/Copy outputs identical (golden), Complete persists and
verify distinguishes it, gates green.**

---

## G05 — Hardening & cleanup

**Objective**: Close the rough edges of G01–G04 and the existing baseline:
theme edge cases, a11y audit, redaction/diagnostics coverage, error-path
clarity, i18n completeness, and doc/Decision-Log consolidation.

**Success criteria**:
- Theme: dock/panel verified on light (white), dark, and no-vars hosts
  (unit detectHostTheme extended + e2e on the template dev page which has
  its own vars); contrast of primary actions checked against the palette
  rules used in D-031.
- a11y: full keyboard walkthrough (toggle focus, dock drag arrows, list
  navigation, Esc everywhere), ARIA states (`aria-expanded`,
  `aria-pressed` for Complete, live regions for save/copy feedback),
  focus containment while panel open.
- Diagnostics/redaction: console.error read-back and redaction tests
  extended for the new dock interactions (drag errors, clipboard denial,
  marker render errors); no new secret leaks (redact tests).
- Error paths: stale-session message (D-031) covers copy/complete paths;
  localStorage denied / clipboard denied degrade gracefully with visible
  feedback.
- Cleanup: `pnpm exec eslint` zero warnings on `src/studio/**` (the
  react-refresh warning moved out via util modules), i18n keys complete
  (en-US/zh-CN parity check test), dead code removal (e.g. replaced
  selection helpers), Decision Log D-033..D-036 consolidated, this plan's
  per-goal sections marked done, README index current.
- Full gates green at the final state; dist precise grep still 0 matches.

**Boundaries**: no new features; behavior-preserving changes only except
fixes discovered by the audits above (each fix recorded in the D-log).

**Tasks**:
1. Theme/a11y audit pass (list findings, fix, re-test).
2. Diagnostics/redaction test extension.
3. i18n parity + lint-zero cleanup.
4. Docs consolidation (D-033..D-036, README, usage guides updated for the
   new dock/copy/complete).
5. Final gates: unit/e2e/typecheck/build/eslint/diff-check (pipefail) +
   dist grep 0; record baselines.

**Done = audits pass with fixes recorded, zero lint warnings, full gates
green, docs consistent.**

---

## Execution order & sequencing notes

- G01 → G02 → G03 → G04 → G05 is the dependency order: the dock hosts the
  persistent annotation list (G02), marker management builds on it (G03),
  workflow affordances assume both (G04), polish last (G05).
- Each goal ships as its own checkpoint commit (English Conventional
  Commit, no push) after its own review; the series continues to follow
  the Goal 00..07 pattern: independent review of each goal, explicit
  Auditor `<approved/>` before completion claims, local checkpoints.
- The dogfood portal is NOT in this plan's scope; syncing the redesigned
  Studio into dogfood is a separate, later decision (recorded as a D-log
  note when the time comes).
- NocoBase baseline note: `nb portal push` now preserves the local Git
  identity (#10315) — irrelevant while we never push; revisit if a future
  goal pushes the fork.
