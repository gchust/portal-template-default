# Copy-ready Goal Launchers

Use one launcher at a time.

## Goal 01

```text
/goal Complete Portal Studio Horizontal Toolbar v5 Goal 01.

Read first:
- docs/exec-plans/portal-studio-horizontal-toolbar-v5/00-shared-contract.md
- docs/exec-plans/portal-studio-horizontal-toolbar-v5/01-goal-horizontal-toolbar-shell.md
- docs/exec-plans/portal-studio-horizontal-toolbar-v5/design/portal-studio-horizontal-toolbar-reference.png

Inspect actual HEAD before changing code. Replace the current Wrench launcher,
wrapping command row and mixed vertical panel with the accepted draggable,
collapsible horizontal icon toolbar.

The feature order must be Pick, Multi, Area, Copy, Marker visibility, Shortcut
help, Annotation list. Shortcut help is the penultimate feature icon and
Annotation list is the final feature icon. Collapse is separate toolbar chrome
after a divider.

Implement the compact collapsed chip, exact icon semantics, custom hover/focus
tooltips containing action+shortcut, the shortcut-help popover, and the
annotation-list panel. Reuse the existing task/list/mutation source of truth.
Do not leave Help/List as dead buttons. Global Marker visibility must become
presentation-only.

Preserve capture, annotations, marker editing, Copy, completion sync,
diagnostics, screenshots, security, dragging and production exclusion. Do not
stop at a plan and do not start the target-side composer in Goal 02.

Continue until every G01 acceptance criterion has unit/component, real-browser
or Playwright, and build evidence. Report exact commands/results and mark every
criterion PASS, FAIL or BLOCKED.
```

## Goal 02

```text
/goal Complete Portal Studio Horizontal Toolbar v5 Goal 02.

Read:
- 00-shared-contract.md
- 02-goal-fast-local-annotation-flow.md

Assume Goal 01 is complete but independently verify the horizontal toolbar,
tooltips, Help and List still work. Replace the technical Draft/Saved/Done
journey with a target-side composer and continuous annotation loop. Do not
redesign the toolbar or start Goal 03. Continue until every Goal 02 criterion
has concrete tests and browser evidence.
```

## Goal 03

```text
/goal Complete Portal Studio Horizontal Toolbar v5 Goal 03.

Read:
- 00-shared-contract.md
- 03-goal-marker-list-and-viewport-polish.md

Assume Goals 01–02 are complete. Stabilize numbering, marker/list behavior,
region scrolling and all anchored-layer placement. Preserve the approved
horizontal toolbar. Do not change Agent CLI runtime or start Goal 04.
```

## Goal 04

```text
/goal Complete Portal Studio Horizontal Toolbar v5 Goal 04.

Read:
- 00-shared-contract.md
- 04-goal-agent-cli-and-task-reliability.md

Assume Goals 01–03 are complete. Fix the real package-script Agent CLI, add
process-level tests, prevent browser/CLI lost updates, preserve task identity
and timestamps, and keep completion explicit. Do not redesign UI or start Goal
05.
```

## Goal 05

```text
/goal Complete Portal Studio Horizontal Toolbar v5 Goal 05.

Read:
- 00-shared-contract.md
- 05-goal-maintainability-and-visual-regression.md

Assume Goals 01–04 are green. Freeze the approved horizontal toolbar behavior,
split monolithic responsibilities, move Shadow DOM CSS out of bootstrap,
remove superseded paths, add deterministic visual regression and run the final
clean-worktree release gate. Do not redesign the UX.
```

## Independent review prompt

```text
Independently review the just-completed Portal Studio Goal. Do not trust the
previous completion claim. Re-read the v5 shared contract and current Goal,
inspect the actual diff, run every required gate, and verify every criterion
with concrete evidence. Fix only issues within the current Goal. Do not start
the next Goal. Report PASS, FAIL or BLOCKED for every criterion.
```
