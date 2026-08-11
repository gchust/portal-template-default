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

- [ ] Map capture/freeze exit paths.
- [ ] Implement one freeze lifecycle owner.
- [ ] Add hover/popover/animation fixture tests.
- [ ] Formalize region sampling/scoring/dedupe.
- [ ] Add async cancellation and call-count gates.
- [ ] Audit observers/listeners/diagnostic disposers.
- [ ] Verify screenshot interaction.
- [ ] Independently audit G04 acceptance.

## Surprises & Discoveries

- None yet.

## Decision Log

- Decision: Freeze is automatic for capture modes rather than a separate toolbar mode.
  Rationale: it preserves transient UI exactly when annotation needs it without adding another primary control.
  Date/Author: Goal author; confirm with actual UX evidence.

## Outcomes & Retrospective

Fill at completion.
