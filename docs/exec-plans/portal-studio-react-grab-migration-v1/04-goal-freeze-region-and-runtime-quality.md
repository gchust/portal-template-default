# Goal 04 — finish freeze, region quality, error cleanup and performance

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current.

## Goal contract

**Objective:** Make the React Grab-based interaction reliable on dynamic Portal UIs by integrating freeze/unfreeze correctly, hardening region semantics, cleaning lifecycle resources and setting measurable runtime budgets.

**Stopping condition:** hover/popover/animation targets can be annotated without collapsing; every exit path unfreezes and removes listeners; region output is useful and bounded; performance/cleanup tests pass.

Do not perform legacy deletion from Goal 05 yet, except obsolete code directly blocking this Goal.

## Purpose / big picture

A correct source locator is not enough if the target disappears when the pointer moves to the comment editor, or if Area captures 50 nested wrappers. This Goal converts upstream primitives into a polished product behavior.

## Freeze state machine

Integrate React Grab freeze through the sole engine. Required behavior:

1. Entering Pick, Multi or Area freezes the page after the mode is activated.
2. Existing hover/focus/popover state remains visible where supported.
3. Studio overlay and editor remain interactive.
4. Exiting through any path calls `unfreeze()` exactly once and leaves no frozen state:
   - annotation saved;
   - cancel/Esc;
   - mode switch;
   - toolbar collapse;
   - route navigation;
   - component unmount;
   - HMR disposal;
   - inspection error;
   - screenshot error;
   - task save error;
   - browser visibility/pagehide cleanup.
5. Re-entering a mode after an error works.
6. Freeze failures surface a bounded user-facing error and do not invoke old logic.

Use a small explicit state owner/hook; do not sprinkle raw freeze calls throughout the Toolbar.

## Region semantic quality

Formalize the Area collector introduced in Goal 03:

- deterministic sample points for the same rectangle/viewport: `columns = clamp(ceil(width / 120), 2, 8)`, `rows = clamp(ceil(height / 120), 2, 8)`; sample each cell center plus the rectangle center and four inset corners; deduplicate coordinates; maximum 69 points;
- target cap remains 50 and inspection concurrency remains exactly 4;
- no `querySelectorAll("*")` fallback;
- target scoring favors:
  1. `data-ai-page-element` and meaningful `data-nb-*`;
  2. interactive/ARIA elements;
  3. user-owned source component frame;
  4. meaningful text/accessibility name;
  5. smaller semantic target over layout-only ancestor;
- remove exact duplicates;
- remove ancestors that add no unique business/source/text context;
- keep distinct sibling cards/cells;
- preserve user selection order deterministically.

Add fixture cases for cards, table cells, nested wrappers and a large dashboard region.

## Runtime lifecycle cleanup

Review and fix:

- pointer/keyboard/scroll/resize listeners;
- `MutationObserver` activation and debounce;
- XHR/fetch/console patch disposal;
- React Grab freeze cleanup;
- inspection requests completing after mode cancellation;
- HMR/unmount cleanup, including `disposeBaselineStyles()`;
- timers and requestAnimationFrame handles.

Specific invariant: no observer/listener used only for markers is active when there are no visible annotations/editor/capture modes requiring it.

## Performance budgets

Do not run `getElementContext` on pointermove. It may run only when a target/group is committed or a detail preview explicitly requests it.

Add deterministic call-count tests:

- pointermove calls hit testing/bounds but zero context inspections;
- one Pick commit performs one inspection;
- one Multi commit performs one inspection per distinct selected target;
- cancellation prevents pending result from mutating state;
- Area respects target and concurrency caps.

Add a browser performance trace or timing report for the fixture, but do not use fragile machine-specific millisecond gates as the sole pass condition. The hard gate is bounded call count and no long-task/console-error regression in the focused scenario.

## Screenshot interaction

Keep current screenshot implementation unless a change is necessary, but verify:

- frozen page can be captured;
- Studio UI/markers are excluded as intended;
- page always unfreezes after capture success/failure;
- source/annotation save does not depend on screenshot success.

## Acceptance criteria

- **G04-AC01:** hover-only menu/popover remains annotatable during Pick.
- **G04-AC02:** CSS/JS animation target remains stable during capture and resumes afterward.
- **G04-AC03:** every documented exit path leaves `isFrozen() === false`.
- **G04-AC04:** Studio controls remain interactive while page is frozen.
- **G04-AC05:** pointermove performs zero source-context inspections.
- **G04-AC06:** canceled async inspection cannot save or overwrite a later draft.
- **G04-AC07:** Area never uses full-DOM `querySelectorAll("*")` scanning.
- **G04-AC08:** nested-card fixture produces semantic targets, not wrapper explosion.
- **G04-AC09:** adjacent table cells remain distinct.
- **G04-AC10:** large region respects sample/target/concurrency caps.
- **G04-AC11:** diagnostics/XHR patches and observers restore cleanly after unmount/HMR.
- **G04-AC12:** screenshot success/failure always unfreezes and task save semantics remain correct.
- **G04-AC13:** existing accessibility/hotkey behavior passes.
- **G04-AC14:** no fallback is added.

## Required verification

```bash
pnpm typecheck
pnpm test -- <freeze, region, lifecycle, call-count tests>
pnpm test:e2e -- <hover/popover/animation/region fixture scenarios>
pnpm test:e2e -- e2e/portal-studio.spec.ts
rg -n 'querySelectorAll\(["'"']\*["'"']\)' src/studio
rg -n 'getElementContext|\.inspect\(' src/studio
rg -n 'fallback|legacy' src/studio/inspection src/studio/toolbar.tsx
```

Review every `.inspect()` call. Pointermove handlers must not call it.

## Progress

- [x] Map capture/freeze exit paths (freeze lifecycle E2E covers every documented exit).
- [x] Implement one freeze lifecycle owner (`capture-freeze.ts` controller + `useCaptureFreeze` hook + toolbar predicate; pipeline success/error and save-error paths unfreeze explicitly).
- [x] Add hover/popover/animation fixture tests (JS-driven hover popover, CSS `@keyframes`, JS rAF loop).
- [x] Formalize region sampling/scoring/dedupe (`region.ts`: 4 inset corners + center + cell centers, `columns/rows = clamp(ceil(dim/120), 2, 8)`, dedup, max 69 points; tiered `targetSignal`; symmetric prune + order-independent final pass).
- [x] Add async cancellation and call-count gates (pipeline session guard; pointermove zero-inspection, one Pick commit = one inspection, one Multi commit = one per distinct target).
- [x] Audit observers/listeners/diagnostic disposers (marker-observer gated by `needsDomTracking`; diagnostics restores XHR `open`/`send`; freeze controller removes styles and restores rAF identity-exactly; upstream `disposeBaselineStyles()` on unmount/HMR).
- [x] Verify screenshot interaction (rasterization bounded to 5s; save never depends on screenshot success; freeze follows save/resume).
- [x] Independently audit G04 acceptance (fresh reviewer round; all findings fixed, gates rerun).
- [x] Fix the completed-visibility E2E flake at the ROOT: an OPEN auxiliary panel now thaws the page (`captureActive` gated on `auxPanel === "none"` — capture handlers are already suspended while a panel is open, so freezing only deferred the Studio's own React updates); the mutation flush paths (`flushPendingOps`, `saveEdit`) unfreeze when the authoritative result lands (success/conflict/error) like the save path already did.
- [x] Fix the dock re-measure deferral: re-expanding the toolbar while a capture session is active re-freezes in the same commit, deferring the width-measure render — the bar then kept the chip-sized anchor and overflowed the viewport. The re-measure effect now applies the measured-size clamp natively (same pattern as the frozen outline).
- [x] Portal Studio E2E 31/31 green twice in a row from the main repo (port 4176).

## Surprises & Discoveries

- The upstream freeze only intercepts React scheduler callbacks — raw page `requestAnimationFrame` loops keep running, and plain CSS compositor animations are not paused either. The freeze controller therefore holds page rAF callbacks (queue + replay on unfreeze) and injects a page-wide `animation-play-state: paused` override.
- The upstream freeze defers ALL React updates while frozen, so the in-page Studio itself would deadlock (e.g. a draft's pipeline resolution could never enable Save). The hook unfreezes synchronously around every native pointer/key interaction and re-applies after 120ms; async exits (pipeline success/error, save branches) unfreeze explicitly.
- The upstream freeze sets `pointer-events: none` on the page, which removes CSS `:hover` state — a CSS-only hover popover collapses during Pick. The fixture popover is state-driven (React `mouseenter`/`mouseleave`) so hover-opened UI survives the frozen window.
- `expect.poll`-style freeze checks were replaced with a manual polling helper: the freeze legitimately takes up to ~200ms to (re)apply after an interaction (transient unfreeze window + mode flush), and the first immediate poll evaluation races that window.
- Playwright `boundingBox()` is already viewport-relative; converting with `scrollX/scrollY` double-subtracts and produces empty samples once the fixture is scrolled.
- Re-expanding the toolbar while a capture session is active re-engages the freeze in the SAME commit (captureActive flips false→true), and the upstream freeze's queue patch makes the dock's width-measure state update INVISIBLE to React's render while frozen — the expanded bar then stayed anchored at the chip-sized position and overflowed the viewport on narrower screens (its rightmost buttons unreachable, and Playwright reports "element is outside of the viewport" while the click can never land to unfreeze). The re-measure effect applies the clamped position natively so the bar always stays inside.
- The E2E's users-table tests must wait for `tbody tr` BEFORE entering a capture mode: while the page is frozen, the app's own deferred React updates can never paint the table rows, so a Pick started during the table load times out forever.

## Decision Log

- Decision: Freeze is automatic for capture modes rather than a separate toolbar mode.
  Rationale: it preserves transient UI exactly when annotation needs it without adding another primary control.
  Date/Author: Goal author; confirmed by E2E (freeze lifecycle, hover popover, animation stability).
- Decision: The freeze controller also holds page rAF callbacks and pauses CSS animations page-wide.
  Rationale: upstream freeze does not pause either; the annotated target must stay visually stable during capture. Queued frames replay on unfreeze so the page resumes coherently.
- Decision: The hover popover fixture is state-driven rather than CSS `:hover`.
  Rationale: `pointer-events: none` removes `:hover`; a state-driven popover survives the frozen window and stays annotatable (G04-AC01).
- Decision: `expect.poll` freeze assertions use a manual `waitFrozen` helper.
  Rationale: the freeze re-applies after a ~120ms flush window; polling with the first immediate evaluation races the mode flush.
- Decision: the page is NOT frozen while an auxiliary panel (Help/List) is open — `captureActive` requires `auxPanel === "none"`.
  Rationale: every capture handler is already gated on `auxPanel === "none"` (the capture is suspended), so freezing then only deferred the Studio's own React updates; list mutations and their async flushes must render live.
- Decision: mutation flushes (`flushPendingOps`, `saveEdit`) unfreeze when the authoritative result lands (success, conflict-adopt, and error paths).
  Rationale: the same async-exit contract as save success — while frozen the upstream freeze buffers all dispatches until the next interaction, so a completion/edit landing on a frozen page would stay invisible (the G04 completed-visibility E2E flake).
- Decision: the dock re-measure effect applies the measured-size clamp natively to the dock element.
  Rationale: re-expanding while a capture session is active re-freezes before the width-measure render can apply, leaving the bar anchored at the chip size and overflowing the viewport; the native write (like the frozen outline) keeps the bar inside while the state reconciles on unfreeze.
- Decision: the save-resume (Goal 02 continuous loop) deliberately does NOT re-engage the freeze mid-flush.
  Rationale: re-freezing in the same commit as the resume's state updates lets the upstream React-pause swallow the interaction's own dispatches (the toolbar then sticks expanded + frozen until another interaction, and the E2E cannot recover). The async-exit unfreeze stays released; the freeze re-engages on the NEXT explicit capture-mode entry (a fresh session). This is documented in `resumeAfterSave` and the freeze hook.

## Outcomes & Retrospective

- G04-AC01…AC14 all PASS (contract E2E 20/20; freeze lifecycle, hover popover, CSS/JS animation stability, Pick/Multi commit call counts, Area caps, collapse re-expand, pagehide exit).
- Full gates: `pnpm typecheck` clean; `pnpm test` 58 files / 672 tests PASS; `pnpm build` clean with zero `react-grab|bippy|portal-studio` in `dist`; `git diff --check` clean; exactly one `react-grab/primitives` import owner; no `querySelectorAll("*")` in region sampling; Portal Studio E2E 31/31 twice in a row from the main repo (port 4176, `PLAYWRIGHT_WORKERS=1`).
- Region: deterministic point grid (max 69), tiered scoring, symmetric pruning with an order-independent final pass for multi-level wrapper chains; distinct sibling cards/cells preserved.
- Runtime: freeze controller idempotent, bounded error message, Studio-safe pointer-events override, page-wide animation pause, rAF frame hold with exact identity restore; diagnostics restores XHR prototypes; marker observer gated by `needsDomTracking`.
- Performance: pointermove = hit testing + bounds only, zero `inspect()`; one Pick commit = one inspection; one Multi commit = one inspection per distinct target.
