# Research notes: why this Goal set is structured this way

## Codex Goal / ExecPlan findings

The Goal set follows current OpenAI guidance rather than treating one very long prompt as a Goal:

- a Goal is a persistent completion contract, not merely a larger prompt;
- one Goal should name one objective and one stopping condition;
- the Goal must identify the verification surface, constraints, boundaries, iteration policy and blocked stop condition;
- long implementation work should use living ExecPlans with `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective`;
- milestones should say what exists at the end, how to run it, and what observable result proves it;
- repository `AGENTS.md` should remain concise and point to task-specific documents rather than embedding the whole migration.

That is why this migration is split into six sequential, independently reviewable outcomes instead of one monolithic backlog.

Primary references:

- OpenAI, “Using Goals in Codex”
- OpenAI, “Follow a goal”
- OpenAI, “Using PLANS.md for multi-hour problem solving”
- OpenAI, Codex best practices / `AGENTS.md`

## Upstream technical findings

At the time this plan was written, the React Grab package declares:

- package: `react-grab`;
- version: `0.1.50`;
- license: MIT;
- public export: `react-grab/primitives`.

The public primitives expose the capabilities required by this migration, including element hit testing, grabbability filtering, top-level bounds, selector generation, element/source context, freeze/unfreeze and cleanup. The context object contains live DOM/Fiber objects as well as structured source data, so Portal Studio must normalize immediately and must never persist the upstream object directly.

The package's selector contract documents `>>>` for open Shadow Root boundaries and `>>iframe>>` for same-origin iframe boundaries. Portal Studio retains a strict resolver for those public selectors because persistent annotations must reattach after reload; that resolver is not a second perception engine.

## Why `element-source` is not installed directly

React Grab already exposes the source-context capability through its public primitives. Adding `element-source` directly would create two overlapping source resolvers and an ambiguous ownership model. The final implementation therefore has:

```text
one direct dependency: react-grab
one public import surface: react-grab/primitives
one repository-owned adapter file
zero secondary source resolver
zero fallback
```

## Why the old engine is deleted rather than retained

The feature is unreleased and its `.portal-studio` tasks are developer artifacts. Preserving the old Fiber/module-regex implementation or schema v1-v5 compatibility would permanently create:

- two answers for the same selected element;
- two source-location algorithms;
- duplicated React-upgrade risk;
- more tests and ambiguous failures;
- more context for low-parameter coding models to misunderstand.

The migration temporarily leaves old files present only until the atomic cutover is verified. Goal 05 physically deletes them, and Goal 06 proves the absence with a permanent audit command plus independent source review.
