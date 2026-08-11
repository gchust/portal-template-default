# Goal 02 — build the single React Grab inspection domain in isolation

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current.

## Goal contract

**Objective:** Implement and fully test the repository-owned inspection domain, v6 target normalization, React Grab selector locator and NocoBase enrichment, while leaving the current production Toolbar/capture path untouched.

**Stopping condition:** The new modules pass unit and fixture tests and expose one stable interface ready for atomic cutover; no old engine is used as a fallback inside the new domain.

Do not switch task persistence or production Pick/Multi/Area in this Goal.

## Context and orientation

Implementation baseline: `feat-agent-feedback` at `e325f18` (Goal 01 commit). The Goal 01 fixture and evidence live at `e2e/react-grab-g01/` and `.portal-studio-evidence/react-grab-g01/` (gitignored). The production Studio source (`src/studio/grab.ts`, `capture.ts`, `toolbar.tsx`, `vite.ts`, `endpoint.ts`) is untouched by this Goal; the new domain lives under `src/studio/inspection/` and is not wired into production. The pre-existing uncommitted user change in `registry/nocobase-users-example/list.tsx` remains outside this Goal and untouched.

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

- [x] Inspect Goal 01 evidence and installed declarations. (Baseline `e325f18`; `dist/primitives.d.ts` and Goal 01 JSON evidence reviewed; selector boundary formats `#host >>> #button` and `#frame >>iframe>> #button` confirmed from evidence.)
- [x] Define v6 domain types. (`src/studio/inspection/types.ts`: bounded `InspectedElement`, `SourceFrame`, `ElementFingerprint`, `EnrichedTarget`, `RouteContext`, limits, typed `InspectionError`, `InspectionEngine` interface; no live Element/Fiber/upstream objects in persisted types.)
- [x] Implement sole React Grab engine. (`react-grab-engine.ts`: the ONLY `react-grab/primitives` import; target filter; §3a promotion rule moved verbatim from the Goal 01 proof; typed errors; singleton + factory.)
- [x] Implement normalization/redaction. (`normalize.ts`: v6 capture, path normalization, redaction, caps, fingerprint extraction, honest source-null.)
- [x] Implement NocoBase enrichment. (`nocobase-context.ts`: one `enrichInspectedElement` boundary; bounded deduplicated `data-ai-page-element` / `data-nb-*` walk; route bounding; no Fiber/source access.)
- [x] Implement hierarchy and selector locator. (`hierarchy.ts` composed walk; `react-grab-selector-locator.ts` strict `>>>` / `>>iframe>>` resolution + exact §6 fingerprint scoring.)
- [x] Add unit/fixture tests. (7 inspection test files + rewritten Goal 01 promotion test; whole-repo import-ownership gate; adapter-based Chromium contract spec 10/10; 81 focused unit tests.)
- [x] Rewrite Goal 01 tests/E2E through the adapter. (`e2e/react-grab-g01/primitives.ts` and `target-promotion.ts` deleted; fixture and contract spec consume `@/studio/inspection`; `react-grab-primitives.test.ts` replaced by engine surface tests; exactly one `react-grab/primitives` import remains, in the engine.)
- [x] Run all Goal 02 gates plus affected full gates. (Focused Vitest; contract spec; full Vitest; typecheck; build + dist exclusion; all greps; Portal Studio E2E; `git diff --check`.)
- [x] Independently audit G02-AC01…G02-AC14. (Fresh reviewer: all 14 criteria PASS; findings fixed and gates rerun.)
- [x] Commit Goal 02 files in one English Conventional Commit; do not push; do not start Goal 03.

## Surprises & Discoveries

- The installed public primitives work fully under jsdom 30 once a minimal, documented `elementFromPoint`/`elementsFromPoint` containment shim is installed: `getElementContext`, `getElementSelector` and `getElementBounds` resolve real v6 captures with honest `source: null` (no React tree in jsdom), and the promotion rule runs unchanged. The Chromium contract spec remains the authoritative browser proof.
- `freeze()` throws `FreezeError` ("Failed to freeze page") under jsdom because the freeze implementation needs real browser animation/rendering hooks; in Chromium the adapter freeze cycle is clean (false → true → false, zero console errors). The adapter therefore wraps freeze/unfreeze/bounds failures in typed `InspectionError`s, and jsdom unit tests assert the typed wrap while the browser spec asserts the happy path.
- `inspect()` on a same-origin iframe element fails a naive `instanceof Element` guard: the iframe button is an instance of the IFRAME realm's `Element`, not the parent realm's. The adapter uses the realm-agnostic `nodeType === 1` check; the Chromium iframe test (previously passing with direct primitive calls) caught this immediately.
- The Goal 02 verification grep `rg -n 'react-grab/primitives' src tests e2e scripts` must yield exactly one line. The whole-repo ownership gate therefore builds its pattern strings dynamically and doc comments avoid the literal import path, so the raw grep output is exactly the single engine import.
- The public `getElementAtPoint()` stack can legitimately be reduced to only a container like `main` at a point covered solely by the Studio subtree: the repository filter removes Studio/root/disconnected elements, and what remains (a plain visible container) is a legitimate target. Studio exclusion is therefore proven by asserting the Studio elements are absent from the stack and that a point covered ONLY by the Studio subtree resolves to no target.
- jsdom's `getBoundingClientRect` always returns zero rects, so the unit-level hit-test shim also stubs per-element rects; this is documented in the test headers.

## Decision Log

- Decision: The selector locator is part of annotation persistence, not a second perception engine.
  Rationale: React Grab generates the selector; Portal Studio only resolves and validates it after reload.
  Date/Author: Goal author; confirmed during implementation.
- Decision: The inspection domain re-implements the bounded `data-ai-page-element` / `data-nb-*` business-context walk locally instead of importing `collectBusinessContext` from the older `capture.ts`.
  Rationale: `capture.ts` pulls the older Fiber-based grab module into its dependency chain; the new domain must stay free of it, and Goal 05 will remove the older copy. The convention is identical (same hint shapes, dedup, 20-item cap) with stricter per-value caps.
  Date/Author: Codex; 2026-08-11.
- Decision: Normalization redacts and bounds text locally (`redactInspectionText`) instead of importing the shared `redact.ts`.
  Rationale: keeps the inspection domain self-contained for the Goal 05 restructure while applying the same v6 invariants (secret-pattern redaction + caps); the endpoint's server-side sanitization remains the authoritative persistence defense.
  Date/Author: Codex; 2026-08-11.
- Decision: The §3a promotion rule lives inside `react-grab-engine.ts` (the sole primitives owner) and is exported through the repository-owned index; `resolveUsefulTarget(x, y)` no longer takes an injected primitives argument.
  Rationale: after Goal 02 no test may import upstream, so the rule binds to the engine's module-scope primitives and the unit tests call it through the adapter.
  Date/Author: Codex; 2026-08-11.
- Decision: `inspect()` validates its argument with the realm-agnostic `nodeType === 1` check rather than `instanceof Element`.
  Rationale: same-origin iframe targets are elements of the iframe realm; the Chromium iframe contract test requires cross-realm inspection.
  Date/Author: Codex; 2026-08-11.
- Decision: Freeze/unfreeze/bounds passthrough failures are wrapped in typed `InspectionError`s.
  Rationale: upstream failures must never leak raw upstream objects to Studio code; jsdom's freeze limitation makes the typed wrap unit-testable.
  Date/Author: Codex; 2026-08-11.
- Decision: The engine factory also ensures the Studio host carries `data-react-grab-ignore` at creation (idempotent), in addition to the filter excluding Studio/root/disconnected elements.
  Rationale: shared contract §9 requires the attribute; the filter remains the authoritative exclusion.
  Date/Author: Codex; 2026-08-11.

## Outcomes & Retrospective

Overall result: **PASS**. The inspection domain is implemented, fully tested, and consumed by the rewritten Goal 01 fixture/contract tests; the whole-repository import-ownership gate proves exactly one upstream import; production Studio paths are untouched. Committed on `feat-agent-feedback`; no push and no Goal 03 work.

| Acceptance criterion | Result | Evidence |
| --- | --- | --- |
| G02-AC01 | PASS | `rg -n 'react-grab/primitives' src tests e2e scripts` yields exactly one line (`src/studio/inspection/react-grab-engine.ts`); `inspection-ownership.test.ts` asserts the same programmatically; Goal 01 test-owned import modules deleted. |
| G02-AC02 | PASS | `types.ts` persisted types carry no Element/Fiber/upstream-private objects (only transient `InspectionEngine`/`PromotionResult` use `Element`); ownership test enforces the required module structure; engine maps upstream context into structural `RawInspectionContext` before normalization. |
| G02-AC03 | PASS | `isInspectionCandidate` rejects disconnected, `html`/`body`, Studio host/subtree and `data-react-grab-ignore` subtrees (unit matrix); a point covered only by the Studio subtree resolves to no target; `ensureStudioHostIgnored` idempotent. |
| G02-AC04 | PASS | `inspect()` returns bounded v6 source/stack/selector/bounds/html/style/fingerprint; caps asserted (htmlPreview 4000, styleText 6000, stack 12, accessibleName 500, text 1000, identity attrs 30/500, selector 4096); `InspectionError` for empty/over-limit selector and non-element input. |
| G02-AC05 | PASS | `toWorkspaceRelativePosix`: absolute → relative (leading slash, Windows drive), `node_modules`/URL/traversal → omitted; unit matrix in `normalize.test.ts`; Chromium source-context test resolves the normalized path to the fixture file. |
| G02-AC06 | PASS | jsdom `inspect` returns `source: null` honestly (unit); engine never imports or calls the older source logic (ownership gate forbids `resolveComponentSources`/`assignSourceCandidates`/`moduleGraph`/`transformResult`/`__reactFiber$` in inspection); Chromium source context still resolves for authored components. |
| G02-AC07 | PASS | `enrichInspectedElement` collects bounded deduplicated `data-ai-page-element`/`data-nb-*` hints (same convention as the product; stricter per-value caps) and bounds route fields; no Fiber/source access (module contains DOM-attribute code only). |
| G02-AC08 | PASS | `resolveSelector` ordinary CSS: resolved / missing / ambiguous (never first-match); invalid CSS → `invalid_selector`; unit + browser. |
| G02-AC09 | PASS | `#host >>> #button` resolves through an open shadow root; closed root → `unsupported_boundary`; unit + browser (`>>>` selector from `inspect`). |
| G02-AC10 | PASS | `#frame >>iframe>> #button` resolves into a same-origin iframe document; unavailable/cross-origin `contentDocument` and non-iframe preceding element → `unsupported_boundary`; unit + browser. |
| G02-AC11 | PASS | Fingerprint validation implements every §6 rule (tagName hard match; strong identity hard match; score contributions +2/−4, +3/−3, +3/−2, ±1, +1/0/−1; threshold ≥4 + matched non-empty signal; empty-semantic parent+child-only acceptance); mismatch → `fingerprint_mismatch`; exhaustive unit matrix in `selector-locator.test.ts`. |
| G02-AC12 | PASS | `src/studio/inspection` contains zero `__reactFiber$`, `moduleGraph`, `transformResult`, `resolveComponentSources`, `assignSourceCandidates`, `fallback`, `legacy` matches; no alternate engine/registry/private import/package patch/element-source (ownership gate + raw greps). |
| G02-AC13 | PASS | No `src/studio` production file changed (git status: only inspection + Goal 02 test/docs files); full Vitest 57 files/671 tests PASS; Portal Studio E2E 31/31 PASS; typecheck/build PASS; production `dist` has zero react-grab/bippy/fixture matches. |
| G02-AC14 | PASS | All new tests pass (81 focused unit tests + 10/10 Chromium contract spec); import-boundary and forbidden-pattern greps pass; evidence recorded in `.portal-studio-evidence/react-grab-g01/commands.log` (Goal 02 section). |

Key command results:

- `pnpm typecheck`: PASS.
- `pnpm exec vitest run tests/logic/portal-studio/inspection/ tests/logic/portal-studio/inspection-ownership.test.ts tests/logic/portal-studio/react-grab-target-promotion.test.ts`: 81/81 PASS.
- `NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost pnpm exec playwright test --config e2e/react-grab-g01/playwright.config.ts`: 10/10 PASS (adapter-based).
- `pnpm test`: 57 files/671 tests PASS.
- `pnpm build`: PASS; `dist` greps zero.
- `rg -n 'react-grab/primitives' src tests e2e scripts`: exactly one line (engine import).
- `rg -n '__reactFiber\$|moduleGraph|transformResult|resolveComponentSources|assignSourceCandidates' src/studio/inspection tests/logic/portal-studio/inspection*`: zero.
- `rg -n 'fallback|legacy' src/studio/inspection`: zero.
- Isolated existing `e2e/portal-studio.spec.ts`: 31/31 PASS.
- `git diff --check`: clean.

No production cutover, no schema-v6 persistence switch, no old-engine use, no push, and no Goal 03 work. The pre-existing user change in `registry/nocobase-users-example/list.tsx` was not edited, staged, or committed.
