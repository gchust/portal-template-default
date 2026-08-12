> **ARCHIVED — DO NOT IMPLEMENT — superseded by React Grab single-engine migration v1**
>
> This plan promoted the custom Fiber/module-graph perception adapter and v1–v5 schema
> compatibility. The migration contract (docs/exec-plans/portal-studio-react-grab-migration-v1/)
> is the only normative source; schema v6 and react-grab/primitives are the only supported
> engine. Kept for history only.

# 03 — Multi-select, area, per-marker edit/delete (independently executable)

Implements: D-033 #5, #6, #10, #11; D-034 #4, #6; contract §2.

## Objective

Full annotation management: TRUE multi-select mode (distinct mode that
adds/removes elements as one group), area annotations (marquee → region
annotation), and per-marker edit/delete/hide with live renumbering; global
destructive actions remain under More (⋯) (D-034 #6).

## Dependencies

- G02 annotations model (v5 `annotations[]`, marker list in the dock,
  comment editor, numbered overlay) and G01 dock + More menu.
- Reused: `selection.ts` ops (`toggleInSelection`, `commitRegion`,
  `normalizeRegion`, MAX_SELECTED_ELEMENTS), `task-model.ts` helpers,
  `captureSelection` for group captures.

## Exact file areas

- `src/studio/task-model.ts` — pure annotation ops: `addAnnotation`,
  `removeAnnotation`, `toggleAnnotationHidden`, `updateAnnotationComment`,
  `groupToggleElement` (bounded), display-number derivation (live index).
- `src/studio/toolbar.tsx` — Multi-select mode (`multi` state in the mode
  machine: seed pick → toggle group → Enter finish → comment editor);
  area annotation path; marker list actions (edit / delete with inline
  confirm / hide toggle); dirty indicator; More menu "Clear all
  annotations" wiring.
- `src/studio/selection.ts` — group toggle helpers (bounded by
  MAX_SELECTED_ELEMENTS); region commit reuse.
- `src/studio/index.tsx` — hidden-marker rendering (no badge/anchor),
  region marker dashed outline with number, styles (light/dark).
- `src/studio/endpoint.ts` — validate `hidden`/`status` in v5 sanitize;
  no new endpoints (mutations go through the existing POST with debounced
  atomic rewrite).
- `src/locales/en-US.ts`, `src/locales/zh-CN.ts` — new keys.
- Tests: `tests/logic/portal-studio/annotation-ops.test.ts` (NEW),
  `tests/components/portal-studio/toolbar.test.tsx` (extend),
  `e2e/portal-studio.spec.ts` (NEW steps).
- Docs: contract D-039; series README G03 done.

## Non-goals

- NO Copy/Complete (G04); NO schema changes beyond G02's v5; NO new
  endpoints; NO per-marker screenshot re-capture (whole-task capture only);
  NO backend data mutation (D-036); NO unrelated refactors.

## Acceptance criteria (AC)

1. TRUE multi-select mode (D-033 #5): seed pick starts a group; clicks
   toggle elements in/out of the SAME annotation; Enter finishes and opens
   the group comment editor; Esc cancels; keyboard: arrows + Space toggle.
2. Area annotation (D-033 #6): marquee produces `kind:"region"` annotation
   (rect via `commitRegion`); region marker = dashed numbered outline.
3. Per-marker edit (D-033 #10): inline comment editing (same editor
   contract: Enter = newline, Ctrl/Cmd+Enter = save); persists via atomic
   write; dirty indicator while unsaved.
4. Per-marker delete (D-033 #10): removes the annotation; display numbers
   RENUMBER live (D-034 #4) while `annotationId`s stay stable; inline
   confirm before delete.
5. Hide without delete (D-033 #11): visibility toggle sets `hidden: true`
   (persists; badge/anchor hidden; list shows hidden state); unhide
   restores; deleting the last visible marker keeps a valid v5 task.
6. More menu (D-034 #6): "Clear all annotations" (confirm) + "Reset dock
   position"; per-marker destruction stays on the marker.
7. Acceptance concerns (D-034 #8): hide/delete survive reload and routes;
   re-resolution after edits; a11y (list nav, confirms focusable, Esc);
   HMR never duplicates or resurrects deleted markers.
8. Tests in the Tests section pass.

## Tests & browser evidence

- Unit: `annotation-ops.test.ts` — group toggle bounds, remove + renumber
  output (delete index 2 → labels shift), hide/unhide round-trip, clear
  all, empty-state validity.
- Component: list interactions (edit/delete/confirm/hide), More menu
  actions, dirty indicator.
- E2E: multi-select group → comment → delete item 2 → numbers renumber →
  reload retains state; hide → reload still hidden; More clear-all →
  empty state.
- Browser evidence: screenshots (group selection, region marker, renumbered
  markers after delete, hidden state, More menu).

## Review checklist

- Grounding: ops live in `task-model.ts` (pure, tested); no endpoint
  additions; schema unchanged from G02.
- AC 1–8 evidenced; renumbering proven by e2e + unit.
- Display-number = live index (no stored numbers) — grep confirms.
- a11y of confirm dialogs/menus; no unrelated changes; gates green
  (pipefail); dist grep 0.
- D-035: any borrowed design (Instruckt adaptation with MIT notice /
  Agentation UX reference) recorded in the D-log with provenance.

## Checkpoint rule

After reviewer + Auditor approval: one local English Conventional Commit,
e.g.
`feat(portal): add multi-select, area and per-marker annotation ops (G03)`
— no push, no amend; report hash + status.

## Gates

As G01 (full suite green + new tests, pipefail).

## Evidence & Done

Evidence under `/root/work/dogfood-crm/evidence-annotation-first-g03/`.
Done = AC 1–8 pass live (real browser) + full gates green + D-039 +
checkpoint per the rule above.
