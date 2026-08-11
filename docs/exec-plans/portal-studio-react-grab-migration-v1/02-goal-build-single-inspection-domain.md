# Goal 02 — build the single React Grab inspection domain in isolation

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current.

## Goal contract

**Objective:** Implement and fully test the repository-owned inspection domain, v6 target normalization, React Grab selector locator and NocoBase enrichment, while leaving the current production Toolbar/capture path untouched.

**Stopping condition:** The new modules pass unit and fixture tests and expose one stable interface ready for atomic cutover; no old engine is used as a fallback inside the new domain.

Do not switch task persistence or production Pick/Multi/Area in this Goal.

## Purpose / big picture

The next Goal must be an atomic product cutover, not a large refactor performed directly inside the 2,000+ line Toolbar. This Goal creates a tested seam first.

## Required module structure

Use this structure unless actual repository conventions require a documented equivalent:

```text
src/studio/inspection/
  types.ts
  react-grab-engine.ts
  normalize.ts
  nocobase-context.ts
  react-grab-selector-locator.ts
  hierarchy.ts
  index.ts
```

### Direct-import rule

Only `react-grab-engine.ts` imports `react-grab/primitives`. Rewrite Goal 01 contract tests to consume the repository-owned adapter; tests/E2E/scripts may not import upstream directly. Add a whole-repository test/grep gate for this rule.

## Required interfaces

The normalized inspection result and persisted domain types must not expose React Grab-specific live objects. The transient engine methods may accept/return standard DOM `Element` references only while the browser session is active:

```ts
export interface InspectionEngine {
  getTargetAtPoint(clientX: number, clientY: number): Element | null;
  getTargetsAtPoint(clientX: number, clientY: number): Element[];
  getBounds(element: Element): ViewportRect;
  inspect(element: Element): Promise<InspectedElement>;
  freeze(elements?: Element[]): void;
  unfreeze(): void;
  isFrozen(): boolean;
}
```

There is exactly one implementation and one exported instance/factory. Do not define a legacy implementation.

### Target filter

The engine must:

- scope selection to the Portal app/document rather than Studio UI;
- require `isElementGrabbable(candidate)`;
- reject the Studio host and descendants;
- add `data-react-grab-ignore` to the Studio host/subtree;
- reject disconnected elements;
- never choose `html`, `body` or the Studio overlay as a target.

### Normalization

`inspect(element)` calls public React Grab context, selector and bounds APIs. Normalize immediately into the v6 contract from the shared file. Remove before returning/persisting:

- live `element`;
- `fiber`;
- upstream error objects/functions;
- absolute/out-of-workspace source paths;
- unbounded HTML/style/source stack.

If the upstream call rejects, return a typed `InspectionError`. Do not invoke old code.

A valid element may have `source: null`; that is an honest upstream result, not a reason to guess with a custom resolver. The selector must be non-empty or inspection fails.

### NocoBase context enrichment

Keep/reuse the current safe business-context extraction, but move it behind one function:

```ts
export function enrichInspectedElement(
  element: Element,
  inspected: InspectedElement,
  route: RouteContext,
): EnrichedTarget;
```

Collect bounded, deduplicated hints from current `data-ai-page-element`, `data-nb-*`, resource/field/action conventions and route context. This function must not read Fiber or source modules.

### Hierarchy navigation

Replace the old generic `collectTargetStack` contract with a hierarchy helper that starts from a React Grab-selected target and walks composed parents. Every returned ancestor must pass `isElementGrabbable` and Studio exclusion. Support open Shadow Root host traversal. Do not use hierarchy walking as alternative hit testing.

### Selector locator

Implement a small locator for the selector syntax produced by React Grab:

- plain CSS segment in current document/root;
- `>>>` enters the open `shadowRoot` of the resolved host;
- `>>iframe>>` enters a same-origin iframe `contentDocument`;
- invalid/missing/closed/cross-origin boundaries return unresolved, never throw.

Use the exact deterministic fingerprint algorithm from shared contract section 6. Do not substitute an ad-hoc fuzzy match. Unit-test every score contribution and threshold.

There is no alternate selector, role-only scan, class scan or DOM-path generation. A mismatch returns unresolved.

## Tests

Create focused unit tests for:

- normalization and redaction;
- source path normalization/rejection;
- limits/truncation;
- direct-import ownership;
- Studio exclusion;
- hierarchy through ordinary DOM and open Shadow Root;
- selector parsing for ordinary, nested shadow and nested same-origin iframe boundaries;
- cross-origin/closed shadow failure;
- every exact fingerprint score contribution, hard identity mismatch, threshold pass/fail and empty-semantic case from shared contract section 6;
- source-null behavior without fallback;
- upstream thrown error surfaces as typed error.

Use the Goal 01 fixture for real-browser adapter tests.

## Acceptance criteria

- **G02-AC01:** exactly one source file imports `react-grab/primitives`.
- **G02-AC02:** normalized/persisted domain types contain no live DOM `Element`, Fiber or React Grab private types; only transient engine method signatures use standard DOM `Element`.
- **G02-AC03:** engine hit testing excludes Studio and disconnected/root targets.
- **G02-AC04:** `inspect()` returns bounded v6 source, stack, selector, bounds, HTML, styles and fingerprint.
- **G02-AC05:** absolute source paths become workspace-relative POSIX paths; external/node_modules paths are omitted.
- **G02-AC06:** source-null is preserved honestly and never calls old source logic.
- **G02-AC07:** NocoBase context enrichment preserves current business hints.
- **G02-AC08:** ordinary selector resolution works.
- **G02-AC09:** open Shadow Root selector resolution works.
- **G02-AC10:** same-origin iframe selector resolution works.
- **G02-AC11:** fingerprint mismatch returns unresolved rather than a wrong element.
- **G02-AC12:** no fallback/legacy implementation exists in `src/studio/inspection`.
- **G02-AC13:** current production Studio behavior remains unchanged.
- **G02-AC14:** all new tests pass and a code-owner/import-boundary grep passes.

## Required verification

```bash
pnpm typecheck
pnpm test -- <inspection unit tests>
pnpm test:e2e -- <React Grab fixture contract spec>
rg -n 'react-grab/primitives' src tests e2e scripts
rg -n '__reactFiber\$|moduleGraph|transformResult|resolveComponentSources|assignSourceCandidates' src/studio/inspection tests/logic/portal-studio/inspection*
rg -n 'fallback|legacy' src/studio/inspection
```

Expected:

- one primitives import;
- zero private Fiber/module source logic in inspection modules;
- zero fallback/legacy branch.

## Stop/block rules

Stop with evidence if the documented React Grab selector boundary format differs from the installed package. Update tests and Decision Log only if the public installed API demonstrates a different stable format; do not import private selector utilities.

## Progress

- [ ] Inspect Goal 01 evidence and installed declarations.
- [ ] Define v6 domain types.
- [ ] Implement sole React Grab engine.
- [ ] Implement normalization/redaction.
- [ ] Implement NocoBase enrichment.
- [ ] Implement hierarchy and selector locator.
- [ ] Add unit/fixture tests.
- [ ] Independently audit G02 acceptance.

## Surprises & Discoveries

- None yet.

## Decision Log

- Decision: The selector locator is part of annotation persistence, not a second perception engine.
  Rationale: React Grab generates the selector; Portal Studio only resolves and validates it after reload.
  Date/Author: Goal author; confirm during implementation.

## Outcomes & Retrospective

Fill at completion with criterion-by-criterion evidence.
