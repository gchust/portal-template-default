# Portal Studio Horizontal Toolbar Goal Set v5

This Goal set updates the previous UX Polish v4 plan to the accepted horizontal,
icon-first toolbar design.

## What changed from v4

The previous Goal 01 proposed a structured panel with visible Pick/Multi/Area
labels. That direction is superseded.

The accepted design is now:

```text
collapsed horizontal chip
       ⇅ click
horizontal icon toolbar
  ├─ Pick / Multi / Area
  ├─ Copy / Marker visibility
  ├─ Shortcut help / Annotation list
  └─ separate Collapse chrome
```

The penultimate feature icon is Shortcut help. The final feature icon is the
Annotation list. Every actionable icon has a localized tooltip containing its
action and keyboard shortcut.

The reference image is included at:

`design/portal-studio-horizontal-toolbar-reference.png`

## Execution order

Execute one Goal at a time:

1. `01-goal-horizontal-toolbar-shell.md`
2. `02-goal-fast-local-annotation-flow.md`
3. `03-goal-marker-list-and-viewport-polish.md`
4. `04-goal-agent-cli-and-task-reliability.md`
5. `05-goal-maintainability-and-visual-regression.md`

Goal 01 is a complete user-visible vertical slice: horizontal toolbar,
collapsed chip, icon semantics, tooltips, shortcut help and annotation-list
panel. It is intentionally cohesive so the branch never lands with dead Help
or List icons.

For a low-parameter model, provide only:

- `00-shared-contract.md`;
- the current numbered Goal;
- the corresponding launcher from `launchers.md`;
- the reference image for Goal 01.

Do not paste all Goals into one run.

## Recommended loop

```text
inspect actual HEAD
→ implement current Goal
→ run current-Goal tests and browser checks
→ independent review of the same Goal
→ checkpoint
→ start next Goal
```

## Supersession

This v5 set supersedes the interaction hierarchy in:

- Portal Studio UX Polish v4 Goal 01;
- any earlier requirement that the expanded toolbar must be a vertical/labeled
  panel;
- any earlier launcher design that uses Wrench, Pencil, emoji, or a detached
  count badge.

The underlying annotation, task, completion, security and production contracts
remain in force unless v5 explicitly refines them.
