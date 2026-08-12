> **ARCHIVED — DO NOT IMPLEMENT — superseded by React Grab single-engine migration v1**
>
> This plan promoted the custom Fiber/module-graph perception adapter and v1–v5 schema
> compatibility. The migration contract (docs/exec-plans/portal-studio-react-grab-migration-v1/)
> is the only normative source; schema v6 and react-grab/primitives are the only supported
> engine. Kept for history only.

# 01 — Draggable dock (independently executable)

Implements: D-033 #2, #3; D-034 #5, #6; contract §1 (dock), §4, §5, §7.

## Objective

Replace the fixed bottom-right toggle+panel with a draggable dock: grab to
reposition anywhere in the viewport, collapse/expand, remember the position
across reloads (dev session), collapsed state = compact icon toolbar with
lucide-react icons (no emoji), global destructive actions under a More (⋯)
menu.

## Dependencies

- Baseline: branch `feat-agent-feedback` @ `2519dd6` (clean tree), unit
  36 files/224 tests, e2e 6/6.
- Preceding goals: none (first goal); relies on the D-031 theme system
  (TOOLBAR_STYLES vars) and the D-012 precedent (jsdom cannot simulate
  PointerEvent → drag is E2E-verified).
- This goal must NOT assume annotations exist (G02) — the compact toolbar
  renders a placeholder count of 0.

## Exact file areas

- `src/studio/toolbar.tsx` — dock position state, pointer/keyboard drag,
  clamp, collapsed/expanded states, compact toolbar (toggle + badge +
  More), More menu open/close/focus-return; replace 🛠/✕ with lucide icons.
- `src/studio/index.tsx` — TOOLBAR_STYLES: remove hardcoded positions
  (`.ps-toggle` right/bottom, `.ps-panel` right/bottom), add compact
  toolbar + More menu styles (light/dark via `:host-context`), icon sizing.
- `src/studio/dock.ts` (NEW, pure) — `DEFAULT_DOCK_POSITION`,
  `clampDockPosition`, `loadDockPosition(storage)`, `saveDockPosition`
  (injectable storage).
- `src/locales/en-US.ts`, `src/locales/zh-CN.ts` — new keys only.
- `tests/logic/portal-studio/dock.test.ts` (NEW), `tests/components/
  portal-studio/toolbar.test.tsx` (extend), `e2e/portal-studio.spec.ts`
  (NEW drag step).
- `docs/exec-plans/portal-studio/00-shared-contract.md` — D-037 entry.
- `docs/exec-plans/portal-studio-annotation-first/README.md` — G01 done.

## Non-goals

- NO annotation state/schema changes (G02); NO selection-model changes
  (G03); NO Copy/Complete (G04); NO backend/API changes; NO new endpoints;
  NO unrelated refactors (D-036); NO emoji glyphs anywhere in the toolbar.

## Acceptance criteria (AC)

1. Draggable by pointer and keyboard (arrows; Shift+arrow = larger step);
   clamped to visible bounds (viewport incl. scrolled page).
2. Position persists across reload (localStorage `portal-studio.dock`,
   try/catch privacy-mode; default bottom-right; re-clamped on load).
3. Collapsed = compact icon toolbar only (no large idle panel): toggle +
   count badge (0 placeholder) + More (⋯).
4. lucide-react icons replace 🛠/✕; consistent icon set; aria-labels kept.
5. More menu: "Reset dock position" (and "Clear all annotations" once G03
   lands, feature-gated); keyboard accessible, Esc closes, focus returns.
6. No capture conflict: dock pointer handlers stop propagation; page
   picking/marquee listeners keep `isStudioElement` exclusion.
7. a11y: `aria-expanded` on toggle; focus containment extended to More.
8. Tests listed below pass.

## Tests & browser evidence

- Unit: `dock.test.ts` — clamp math (edges, oversized, scrolled), load/save
  round-trip, defaults, invalid stored values → default.
- Component: `toolbar.test.tsx` — drag state updates position; More opens/
  closes; compact toolbar renders (no panel) when collapsed.
- E2E: new step — open dev page → drag dock → reload → position retained;
  collapsed state shows compact toolbar; More menu opens.
- Browser evidence: screenshots (collapsed / expanded / dragged / after
  reload) saved to the goal evidence dir.

## Review checklist

- Grounding: real files cited exist; no schema/annotation code introduced.
- AC 1–8 each has observable evidence (test or screenshot).
- D-031 theme vars intact; lucide icons only (no emoji) — grep 🛠/✕ in
  src/studio returns nothing.
- No unrelated changes; working tree contains only this goal's files.
- Gates green with pipefail; dist grep 0.
- D-035: any borrowed design (Instruckt adaptation with MIT notice /
  Agentation UX reference) recorded in the D-log with provenance.

## Checkpoint rule

After the independent reviewer and Auditor approve: one local English
Conventional Commit on `feat-agent-feedback`, e.g.
`feat(portal): make Portal Studio dock draggable with persisted position (G01)`
— no push, no amend of existing commits; report hash + status.

## Gates

`set -o pipefail`; `pnpm typecheck`; `pnpm test` (224 + new, 0 failures);
`pnpm exec eslint src/studio tests/logic/portal-studio
tests/components/portal-studio` (0 warnings on touched files);
`pnpm test:e2e` (6/6 + new step); `pnpm build`; dist grep 0 (exit 1);
`git diff --check`.

## Evidence & Done

Evidence under `/root/work/dogfood-crm/evidence-annotation-first-g01/`
(raw gate outputs, e2e run, screenshots). Done = AC 1–8 pass on the
template dev page + full gates green + D-037 recorded + checkpoint per the
rule above.
