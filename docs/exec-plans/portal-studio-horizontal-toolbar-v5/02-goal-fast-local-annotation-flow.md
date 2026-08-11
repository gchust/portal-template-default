# Goal 02 — Fast Target-Side Composer and Continuous Annotation Loop

## Outcome

Creating several annotations feels like using a feedback tool rather than a
technical task debugger:

```text
Pick icon
→ click target
→ type beside target
→ Ctrl/Cmd+Enter
→ brief saved feedback
→ immediately pick the next target
```

The horizontal toolbar remains compact. Comment entry happens beside the page
target, not by expanding the toolbar into a large form.

## Preconditions

Goal 01 is complete and independently reviewed. Preserve:

- collapsed chip;
- horizontal action order;
- action tooltips and shortcuts;
- Help/List popovers;
- presentation-only marker visibility;
- toolbar/list accessibility.

Read current capture, save, marker-editor and screenshot code and tests.

## Required implementation

### A. Reuse one target-side annotation composer

Create or reuse one small composer positioned beside the selected target,
multi-target group or region.

It contains:

```text
comment textarea
Save
Cancel
```

Behavior:

- autofocus textarea;
- plain Enter inserts newline;
- Ctrl/Cmd+Enter saves;
- Esc cancels;
- selected target remains highlighted;
- clicks inside never trigger capture;
- non-empty draft is not silently lost by Help/List/open/collapse actions;
- viewport-aware placement uses the shared anchored-layer helper;
- collapse may hide the composer and suspend capture, but re-expand restores
  the draft and target where feasible.

### B. Remove the technical Draft/Saved/Done journey

Normal creation must not show or require:

- Task ID;
- task JSON path;
- screenshot path;
- source-candidate details;
- full Saved panel;
- Done button.

Keep technical data in JSON, Copy output and diagnostics.

### C. Continuous capture

Pick is single-target and resumes Pick after a successful save.

Multi is the sole multi-target path. After save, remain in Multi with an empty
group or return to idle according to one documented/tested rule.

Area follows one documented/tested post-save rule.

Do not retain Shift-additive behavior in Pick.

### D. Non-blocking evidence

- task persistence succeeds before screenshot evidence is considered;
- screenshot failure is a warning, not a failed annotation;
- successful save immediately updates markers and List panel;
- show a compact toast/check state;
- no Done click.

### E. Failure behavior

- POST failure preserves draft and target;
- conflict uses current typed refresh/retry semantics;
- Help/List/collapse cannot overwrite a pending save;
- Copy and Agent sync remain functional.

## Tests

Prove:

1. target click opens local composer;
2. no technical Draft/Saved screen in normal flow;
3. Ctrl/Cmd+Enter saves and Pick remains active;
4. two annotations can be created consecutively;
5. Pick is single-target;
6. Multi is only multi-target path;
7. save failure preserves draft;
8. screenshot failure is non-blocking;
9. Help/List/collapse preserve non-empty draft;
10. composer clamps at every viewport edge;
11. saved item appears in List and marker layer immediately;
12. horizontal toolbar never expands vertically to host the form.

Run typecheck, relevant tests, Playwright and production exclusion.

## Acceptance criteria

- G02-01 through G02-12 correspond exactly to the twelve proofs above.
- G02-13: Goal 01 horizontal toolbar and tooltips remain unchanged.
- G02-14: all required browser evidence exists.

Do not start Goal 03.
