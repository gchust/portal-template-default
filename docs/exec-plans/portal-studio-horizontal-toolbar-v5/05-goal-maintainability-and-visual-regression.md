# Goal 05 — Maintainability, Visual Regression, and Release Gate

## Outcome

The approved horizontal-toolbar experience is frozen with deterministic tests,
and the monolithic Studio code is split into reviewable responsibility
boundaries without changing behavior.

## Preconditions

Goals 01–04 are green and independently reviewed.

## Required implementation

### A. Freeze behavior before refactor

Ensure tests cover:

- collapsed chip states;
- exact horizontal icon order;
- every tooltip/shortcut;
- Help/List mutual exclusion;
- active capture states;
- target composer;
- stable markers/list;
- Copy;
- Agent completion sync;
- production exclusion.

### B. Extract responsibility-based components/hooks

Suggested boundaries:

```text
StudioDock.tsx
StudioHorizontalToolbar.tsx
StudioActionTooltip.tsx
StudioShortcutHelp.tsx
StudioAnnotationListPanel.tsx
AnnotationComposerPopover.tsx
AnnotationMarkerLayer.tsx
AnnotationEditorPopover.tsx
useStudioHotkeys.ts
useActiveTaskSync.ts
studio-actions.ts
studio-task-client.ts
annotation-selectors.ts
```

Use actual repository facts. Do not chase arbitrary line counts or create empty
abstractions.

### C. Move Shadow DOM styles out of bootstrap

Use the repository-supported inline CSS/module mechanism. Preserve:

- Shadow isolation;
- no host CSS leakage;
- theme behavior;
- HMR idempotence;
- production exclusion.

Delete dead classes from old Wrench/badge/vertical command row/Saved screen.

### D. Mark older plans as superseded

Identify v5 as the current source of truth in a short AGENTS rule. Archive,
remove or mark older unpublished plans as superseded so a low-parameter Agent
does not implement conflicting vertical-panel designs.

### E. Deterministic visual regression

At minimum snapshot:

#### Collapsed chip

- no Open annotations;
- 1, 9 and 100 Open;
- English/Chinese;
- focus;
- near each viewport edge.

#### Expanded toolbar

- exact horizontal order;
- English/Chinese;
- light/dark host;
- Pick/Multi/Area active;
- tooltips for every action;
- Help popover;
- List panel Open/All;
- 1440×900 and 375×667;
- Copy success/fallback;
- marker visibility state.

#### Annotation surfaces

- composer near each edge;
- marker editor;
- completed/unresolved/hidden items;
- long list internal scrolling.

Assertions:

- no wrap;
- no page horizontal overflow;
- all surfaces within viewport;
- hit targets and focus visible;
- no duplicate Shadow root after HMR;
- no Studio module in production graph.

### F. CI and final evidence

CI runs:

```text
typecheck
unit/component tests
CLI process smoke
Playwright interaction tests
visual snapshots
production build/exclusion
```

Create final release evidence with exact commands, versions, screenshot paths,
license changes, known limitations and manual smoke checklist.

## Acceptance criteria

- G05-01: behavior green before/after refactor.
- G05-02: horizontal toolbar responsibilities are reviewably split.
- G05-03: no giant inline CSS bootstrap remains.
- G05-04: obsolete vertical/mixed UI is removed.
- G05-05: v5 is the single current plan.
- G05-06: deterministic snapshots cover all required states.
- G05-07: CI includes CLI/browser/visual/production gates.
- G05-08: clean-worktree full gate passes.
- G05-09: release evidence is complete.
- G05-10: approved UX and task semantics did not change.
