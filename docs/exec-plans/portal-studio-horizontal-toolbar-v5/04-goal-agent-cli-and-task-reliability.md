# Goal 04 — Agent CLI and Task Reliability

## Outcome

The local Code Agent completion path actually runs on the documented Node
baseline and browser/CLI mutations cannot silently overwrite one another.

## Preconditions

Goals 01–03 are complete. Do not redesign the toolbar.

## Required implementation

### A. Fix package-script CLI execution

The reviewed script path invokes Node on `.mjs` that imports `.ts`, which may
fail without an experimental loader. Use a stable repository-supported runtime
such as `tsx`, or compile the shared module path, while preserving Node support
claimed by the package.

The following must work as package scripts without experimental flags:

```text
pnpm studio:list
pnpm studio:complete -- <annotation-id> --verified --summary "..."
pnpm studio:reopen -- <annotation-id>
```

Add process-level smoke tests, not only imported-function tests.

### B. Serialize task mutations

Prevent lost updates between:

- browser list/editor;
- browser polling refresh;
- annotation creation;
- Agent CLI completion/reopen.

Use current revision-aware typed operations. On conflict, refresh and retry the
specific operation safely. Do not rewrite stale whole-task JSON.

### C. Task lifecycle correctness

- one active task ID remains stable while adding annotations;
- `createdAt` remains original;
- `updatedAt` changes on mutation;
- completion/reopen records are explicit;
- HMR/file change alone never completes an item;
- Copy instructions include the real working completion command;
- browser reflects CLI completion within the existing bounded sync target.

### D. Per-annotation page formatting and locale parity

Copy/list output uses each annotation’s own page context. Fix English/Chinese
locale parity and remove mixed-language fallbacks.

### E. Security

Remote Studio access is explicit opt-in and retains token/origin/host checks.
CLI accepts only valid annotation/task identities and bounded summaries.

## Tests and acceptance

Prove:

- each package script launches on the documented Node baseline;
- list/complete/reopen end-to-end;
- browser and CLI concurrent mutations preserve both operations;
- stable task ID and timestamps;
- Copy completion command works;
- browser sync updates List/markers;
- invalid IDs and stale revisions fail safely;
- no toolbar UX regression;
- production exclusion remains green.

Acceptance G04-01 through G04-10 map to the behaviors above. Do not start Goal
05.
