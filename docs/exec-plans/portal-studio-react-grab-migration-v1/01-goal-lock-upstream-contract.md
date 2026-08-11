# Goal 01 — lock and prove the React Grab public contract

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current.

## Goal contract

**Objective:** Add the exact React Grab dependency and create a real React 19/Vite 6 contract fixture proving that the public `react-grab/primitives` APIs required by this migration work in this repository.

**Stopping condition:** The dependency, license record, fixture and contract tests are committed; every G01 acceptance criterion passes; no production Portal Studio behavior has been switched yet.

Do not start the inspection-domain implementation from Goal 02. Do not write a fallback.

## Purpose / big picture

Before replacing a working custom engine, prove the exact upstream package in the actual template. The result of this Goal is evidence, not a mock. A later Goal can rely on a pinned and tested public API instead of guessing from upstream examples.

## Context and orientation

Implementation baseline: `feat-agent-feedback` at `10abeda4da31fd0c0df30b43c516b80dff9e1e9d`. The documented Studio, Vite, test, and E2E paths still match this checkout. The pre-existing uncommitted change in `registry/nocobase-users-example/list.tsx` is outside this Goal and must remain untouched.

Read first:

- `00-shared-contract.md`;
- root `AGENTS.md`;
- `package.json`, `pnpm-lock.yaml`, `vite.config.ts`;
- `src/studio/index.tsx`, `src/studio/toolbar.tsx`;
- current Playwright configuration and Portal Studio E2E tests.

The current source uses a custom Fiber adapter, but this Goal must not modify its production path.

## Required implementation

### 1. Pin the dependency

Add to root `devDependencies` with no range:

```json
"react-grab": "0.1.50"
```

Run the repository package manager so `pnpm-lock.yaml` records the exact resolved package and transitive dependency.

Do not install `element-source` directly.

### 2. Record third-party provenance

Add a concise repository document, for example:

```text
docs/portal-studio-third-party.md
```

It must record:

- package name and exact version;
- MIT license;
- repository/project name;
- imported surface: `react-grab/primitives` only;
- no upstream source copied into this repository;
- production exclusion expectation.

Do not copy a font, logo or React Grab UI asset.

### 3. Create a dev/E2E-only inspection fixture

Create a fixture that is unavailable in production and contains stable test targets with explicit IDs:

1. `fixture-plain-button`: user-defined React component with text;
2. `fixture-svg-button`: button whose click point is on nested `svg/path`;
3. `fixture-overlay-button`: meaningful button behind a transparent/non-grabbable overlay;
4. `fixture-memo-button`: `memo` component;
5. `fixture-forward-ref-button`: `forwardRef` component;
6. `fixture-mapped-item-2`: second item from `.map()`;
7. `fixture-portal-dialog-action`: content rendered through `createPortal`;
8. `fixture-shadow-button`: element in an open Shadow Root;
9. `fixture-iframe-button`: same-origin iframe target;
10. one real shadcn/base component from this template.

The fixture must not become an application/business route. Gate it behind a test/dev flag and prove it is absent from production output.

### 4. Add an upstream contract test module

Create test-only code that imports the required public primitives and verifies the installed exports are callable:

- `getElementAtPoint`;
- `getElementsAtPoint`;
- `isElementGrabbable`;
- `getElementBounds`;
- `getElementSelector`;
- `getElementContext`;
- `freeze`;
- `unfreeze`;
- `isFreezeActive`;
- `disposeBaselineStyles`.

Do not import private paths.

### 5. Real-browser source-context proof

For every test-owned React fixture where source context is expected, assert:

- `componentName` is not empty or the source stack contains the expected component;
- `filePath` resolves to the fixture source file;
- `lineNumber` is a positive integer;
- `columnNumber` is a non-negative integer;
- stack contains at least one workspace-owned frame;
- no source frame points to `node_modules` as the primary result.

For Shadow DOM and iframe targets, explicitly record what the public API supports. The Goal passes only if hit testing, selector and bounds work; source context may be nullable for an iframe document that is not part of the parent React tree, but that limitation must be documented and must not trigger a custom fallback.

### 6. Prove the default UI is not loaded

The fixture/contract test may temporarily import primitives directly in this Goal only. Goal 02 must move the import into the sole production adapter and rewrite tests through that boundary. Assert no React Grab overlay, global hotkey, clipboard behavior or `data-react-grab-*` UI is mounted by merely running the contract test.

### 7. Prove the deterministic semantic target-promotion rule (user-approved amendment)

The user explicitly approved continuing with `react-grab@0.1.50` and revised G01-AC06: clicking a nested SVG point must resolve to the meaningful interactive control rather than persisting the raw path, and the single perception path may use `getElementsAtPoint()`, `isElementGrabbable()`, DOM/composed-parent relationships and deterministic semantic rules to promote the hit to the nearest useful interactive target. See `00-shared-contract.md` §3a for the normative rule.

Add a Goal-01 test-only module implementing exactly that rule and prove it:

1. A deterministic unit test (Vitest/jsdom) proving: the nested SVG path scenario selects `#fixture-svg-button`; a plain button stays direct; a standalone SVG shape with no interactive ancestor stays the raw shape (no unrelated-ancestor jump); the first arbitrary stack item is never chosen; a nearer interactive control is never skipped. The unit test must exercise the REAL public primitives; because jsdom 30 has no layout engine, it may install a minimal, documented `elementFromPoint`/`elementsFromPoint` containment shim and must say so.
2. Real-browser assertions in the Chromium contract spec: nested SVG point → `#fixture-svg-button` with `promoted: true`; raw `getElementAtPoint()` result and stack head remain the honest raw `#fixture-svg-path`; standalone SVG shape stays raw; plain button stays direct; overlay, Shadow DOM and iframe results unchanged.
3. Record the browser results as evidence files next to the existing JSON results.

## Acceptance criteria

- **G01-AC01:** `react-grab` is present as exact `0.1.50` in `package.json` and lockfile.
- **G01-AC02:** `element-source` is not a direct dependency.
- **G01-AC03:** a third-party provenance document records MIT and the public import boundary.
- **G01-AC04:** all ten required primitives are imported from `react-grab/primitives` and callable.
- **G01-AC05:** fixture plain/memo/forwardRef/map/portal targets return workspace source file + line + column.
- **G01-AC06:** clicking a nested SVG point resolves a useful target, not a raw meaningless `path`. Per the user-approved amendment, the single perception path may use `getElementsAtPoint()`, `isElementGrabbable()`, DOM/composed-parent relationships, and deterministic semantic rules (shared contract §3a) to promote the hit to the nearest useful interactive target. It must use only documented `react-grab/primitives` and ordinary DOM semantics; it must not jump to an unrelated ancestor or first arbitrary stack item.
- **G01-AC07:** transparent overlay does not become the chosen target.
- **G01-AC08:** open Shadow DOM hit testing, bounds and selector are proven.
- **G01-AC09:** same-origin iframe hit testing and top-level bounds are proven.
- **G01-AC10:** calling `freeze()` sets active state, `unfreeze()` restores it, and `disposeBaselineStyles()` is safe during teardown without console errors.
- **G01-AC11:** no full React Grab UI or clipboard interception is mounted.
- **G01-AC12:** production build does not contain the test fixture or React Grab runtime.
- **G01-AC13:** current Portal Studio behavior and existing tests remain unchanged.
- **G01-AC14:** an upstream verification report records exact commands, results and any supported limitations.

## Required verification

Adapt commands to actual repository scripts, but run at least:

```bash
pnpm install
pnpm typecheck
pnpm test -- <new React Grab contract tests>
pnpm test:e2e -- <focused fixture spec>
pnpm build
rg -n 'from ["'"']react-grab["'"']|import\(["'"']react-grab["'"']\)' src tests e2e
rg -n 'element-source' package.json pnpm-lock.yaml src tests e2e
rg -n 'react-grab|bippy|fixture-plain-button' dist
```

Expected source grep: only the test/contract code may import `react-grab/primitives`; no full import. Expected `dist` grep: zero.

## Evidence artifacts

Store concise evidence under a gitignored or documented evidence directory:

```text
.portal-studio-evidence/react-grab-g01/
  upstream-verification.md
  source-context-results.json
  screenshots/
  commands.log
```

Do not commit secrets or session tokens.

## Stop/block rules

Stop and report BLOCKED instead of inventing a fallback when any of these is true:

- exact version cannot install;
- primitives import requires private paths;
- source context fails even for the plain test-owned React component;
- hit testing breaks normal Portal behavior;
- freeze cannot be reliably cleaned up.

The blocker report must include attempted commands, error output and the smallest decision needed from the user.

## Progress

- [x] Inspect actual HEAD and baseline commands. (`pnpm typecheck`: PASS; baseline `pnpm test -- ...`: 50 files / 590 tests PASS.)
- [x] Pin dependency and update lockfile. (`react-grab@0.1.50`; installed public exports/types inspected.)
- [x] Add provenance note. (`docs/portal-studio-third-party.md`; MIT, upstream repository, public-only boundary, no copied assets/source.)
- [x] Add dev/E2E-only fixture. (Nested E2E HTML, explicit `DEV` + `mode === "e2e"` gate, React 19/Vite 6, all ten required targets.)
- [x] Add contract tests. (One test-owned public import module, focused Vitest callability test, six-scenario Playwright contract.)
- [x] Run source/hit/freeze browser proof. (Latest Chromium run: 6/7 PASS; G01-AC06 deterministically FAILS because the public primitive selects the nested raw `path`.)
- [x] Prove production exclusion. (`pnpm build`: PASS; production `dist` grep has zero React Grab, bippy, or fixture matches.)
- [x] Independently audit G01-AC01…G01-AC14. (Audit confirmed AC01–AC05 and AC07–AC14 PASS, AC06 FAIL.)
- [x] Evaluate the user-authorized version change. (`0.1.49` and latest dev/current upstream main `0.1.50-dev.f8c2c71` retain all required APIs but reproduce AC06; older tested lines lack required primitives. Final pin restored to `0.1.50`.)
- [x] Stop at the failed promotion gate without fallback, commit, push, or Goal 02 work.
- [x] Record the user-approved contract amendment. (User decision: keep `react-grab@0.1.50`, revise G01-AC06; nested SVG path is promotable through public primitives. Shared contract §3a records the normative rule.)
- [x] Implement the test-only promotion rule. (`e2e/react-grab-g01/target-promotion.ts`: `resolveUsefulTarget`; SVG-geometry trigger, interactive-control vocabulary, composed-parent guard, grabbability gate; no fallback.)
- [x] Add the deterministic unit proof. (`tests/logic/portal-studio/react-grab-target-promotion.test.ts`: real public primitives under a documented jsdom 30 hit-test shim; 7/7 PASS.)
- [x] Extend the Chromium contract spec. (Nested SVG → `#fixture-svg-button` promoted; standalone SVG shape not promoted; plain button direct; template shadcn button inspected; overlay/Shadow/iframe unchanged. 10/10 PASS.)
- [x] Run every Goal 01 gate with the revised AC06. (Focused Vitest 8/8; contract spec 10/10; full Vitest; typecheck; build; production greps; Portal Studio E2E; `git diff --check`.)
- [x] Independently audit the revised G01-AC01…G01-AC14. (Fresh reviewer: all 14 criteria PASS with evidence; no in-scope findings left open.)
- [x] Commit Goal 01/setup files in one English Conventional Commit; do not push; do not start Goal 02.

## Surprises & Discoveries

- `pnpm test -- <paths>` forwards a literal `--` to Vitest in this repository and ran the complete 50-file suite rather than only the named paths; all 590 tests passed. Use `pnpm exec vitest run <paths>` for the narrow contract test command.
- The published `react-grab@0.1.50` package exposes all ten required functions from its declared `./primitives` export. Its transitive dependencies are `bippy` and `@react-grab/cli`; `element-source` is absent from the root manifest and lockfile.
- Vite source mapping reports Goal-owned source paths as `fixture.tsx` (with valid line/column) rather than a workspace-absolute path. The browser test resolves that value against the fixture module directory and verifies the result is exactly the workspace-owned fixture file; stack frames use the same stable path.
- Vite's dev transform suffixes memo/forwardRef function names (`MemoButton2`, `ForwardRefButton2`). Contract assertions use the authored stable name as a substring while still requiring the exact fixture source path and valid line/column.
- A same-origin `srcDoc` iframe target has no React source context because it is not part of the parent React tree. Public hit testing, `>>iframe>>` selector generation, and top-level bounds all pass; no fallback is added.
- A pointer-event-enabled decorative SVG `path` is itself grabbable upstream. After removing the fixture's `pointer-events: none` workaround, native hit testing reports the path as grabbable and `getElementAtPoint()` returns the same raw path. The useful button is only the third entry in `getElementsAtPoint()`. This failed the original G01-AC06; fixture CSS would bypass the primitive rather than prove it.
- After the user authorized a version change, both the only earlier stable release with all ten primitives (`0.1.49`) and latest dev/current upstream main (`0.1.50-dev.f8c2c71`, commit `f8c2c71ad772e8ab5371addd697010f0b3183d69`) reproduced the same SVG failure. `0.1.48` has only five required declarations, while the directly tested `0.1.30` has only four required callables. There is no viable current version-only promotion path.
- The public `getElementsAtPoint()` stack is already filtered by the default grabbability predicate: invisible elements, `html`/`body`, full-viewport transparent overlays and `data-react-grab-ignore` subtrees are absent, while ordinary visible containers (`section`, `main`, `div`) remain. This is why the overlay case already resolves to the button below it and why the promotion walk sees a clean ancestor chain.
- `getElementAtPoint()` is a first-grabbable lookup over the same stack with a 16 ms same-point cache; `getElementsAtPoint()` has no cache. Calling both at one point is deterministic and returns consistent results.
- jsdom 30 implements no layout engine: `Document.prototype.elementFromPoint`/`elementsFromPoint` do not exist, so the REAL public primitives cannot hit-test in Vitest. The unit proof installs a minimal, documented containment shim (deepest element first) for those two DOM APIs only; the real `react-grab/primitives` filter, `isElementGrabbable()`, and the promotion rule run unchanged. The Chromium contract spec remains the authoritative browser proof.
- The promotion walk must be gated on composed-parent identity, not on stack order alone: the guard makes the rule provably unable to jump to a non-ancestor entry and lets the unit proof assert the "no unrelated ancestor" property directly.
- This host's proxy environment omits localhost from `NO_PROXY`; Playwright's web-server readiness probe timed out until the verification command set `NO_PROXY=127.0.0.1,localhost` (and lowercase parity). Browser behavior was unaffected once the local probe bypassed the proxy.

## Decision Log

- Decision: Use exact `react-grab@0.1.50` and public primitives only.
  Rationale: deterministic migration; no duplicate source-of-truth library.
  Date/Author: Goal author; confirmed by Codex on 2026-08-11 after inspecting the installed package manifest and `dist/primitives.d.ts`.
- Decision: Keep the contract fixture as a nested E2E HTML entry with a dedicated test-only Vite/Playwright configuration.
  Rationale: it exercises the repository's real React 19 and Vite 6 dependencies without adding an application route or touching the production Portal Studio capture path.
  Date/Author: Codex; 2026-08-11.
- Decision: Keep the only Goal 01 direct primitives import in `e2e/react-grab-g01/primitives.ts`.
  Rationale: Vitest and the real-browser fixture share one exact public surface, while production source imports none of React Grab.
  Date/Author: Codex; 2026-08-11.
- Decision: Reject the decorative-SVG CSS workaround and stop Goal 01 as BLOCKED.
  Rationale: G01-AC06 requires the public primitive to promote a nested SVG point to a useful target. CSS `pointer-events: none` changes native hit testing before React Grab runs and is therefore a false-positive promotion proof. The contract forbids filtering, fallbacks, private APIs, package patches, and alternate engines.
  Date/Author: Codex after independent audit; 2026-08-11.
- Decision: Retain exact stable `0.1.50` after the user-authorized version search.
  Rationale: `0.1.49` and latest dev/current upstream main both reproduce AC06, while older tested lines fail the required public-API surface. Retaining the original stable pin leaves the repository in the best-supported state without implying that a version change solved promotion.
  Date/Author: Codex; 2026-08-11.
- Decision: Keep `react-grab@0.1.50` and revise G01-AC06 instead of switching the library (USER APPROVED, 2026-08-11).
  Rationale: the version search proved `0.1.50` is the newest stable line with all ten public primitives; `0.1.49` has the same raw-path selection and older lines fail AC04. The user decided the promotion gate is not a blocker when the public stack provides a deterministic useful target.
  Date/Author: user decision; recorded by Codex 2026-08-11.
- Decision: Implement the promotion rule as a test-only module (`e2e/react-grab-g01/target-promotion.ts`) consuming only `react-grab/primitives` and ordinary DOM semantics.
  Rationale: the rule must be proven in this Goal and later moved verbatim into the Goal 02 production adapter; keeping it next to the public-import module gives the unit test and the browser fixture one exact shared implementation. The rule triggers only on SVG geometry shapes, walks the public stack with a composed-parent guard, and requires the first interactive control candidate to also pass `isElementGrabbable()`.
  Date/Author: Codex; 2026-08-11.
- Decision: Keep a standalone SVG shape un-promoted when no interactive control ancestor exists.
  Rationale: promotion to `section`/`main` would be an unrelated-ancestor jump; the raw shape is the deterministic useful target for decorative graphics without controls. Both the unit test and the browser spec assert this negative property.
  Date/Author: Codex; 2026-08-11.
- Decision: Prove the unit-level rule with the REAL public primitives under a documented jsdom 30 hit-test shim instead of stubbing the primitives.
  Rationale: jsdom 30 lacks `elementFromPoint`/`elementsFromPoint`, so the primitives' hit path cannot run; shimming those two DOM APIs keeps the primitives and the rule fully real while the Chromium spec remains the authoritative browser proof.
  Date/Author: Codex; 2026-08-11.

## Outcomes & Retrospective

Overall result: **PASS**. The user-approved amendment (keep `react-grab@0.1.50`, revise G01-AC06) unblocked the promotion gate. Goal 01 proves the public contract, the deterministic semantic target-promotion rule, and production exclusion. The Goal was committed on branch `feat-agent-feedback`; no push and no Goal 02 work.

| Acceptance criterion | Result | Evidence |
| --- | --- | --- |
| G01-AC01 | PASS | Root `devDependencies` and lockfile pin exact `0.1.50`. |
| G01-AC02 | PASS | `element-source` has zero root manifest, lockfile, or source matches. |
| G01-AC03 | PASS | `docs/portal-studio-third-party.md` records MIT, upstream project, public-only boundary, no copied source/assets, and production exclusion. |
| G01-AC04 | PASS | Focused Vitest and Chromium prove all ten public primitives are callable; only the test-owned public import exists. |
| G01-AC05 | PASS | Plain, memo, forwardRef, mapped, and portal fixtures return the fixture source with valid line/column and workspace stack evidence. |
| G01-AC06 | **PASS** | `svg-results.json`: native hit and raw `getElementAtPoint()` both remain the grabbable `#fixture-svg-path` (honest upstream observation), and the deterministic rule promotes the click to `#fixture-svg-button` (`promoted: true`). The raw path is the first stack entry — proving the rule never takes the first arbitrary stack item — and the promoted button is a real composed ancestor in the public stack. |
| G01-AC07 | PASS | The separate overlay test passes: native overlay is non-grabbable and selection continues to `#fixture-overlay-button`. |
| G01-AC08 | PASS | Open Shadow Root test passes for hit testing, non-zero top-level bounds, and a `>>>` selector. |
| G01-AC09 | PASS | Same-origin iframe test passes for inner hit testing, top-level bounds, and a `>>iframe>>` selector. |
| G01-AC10 | PASS | Freeze state is false → true → false; teardown and baseline-style disposal produce no console errors. |
| G01-AC11 | PASS | No React Grab UI attributes, clipboard write, copy cancellation, or hotkey cancellation is observed. |
| G01-AC12 | PASS | Production build passes and `dist` contains neither fixture nor React Grab/bippy runtime identifiers. |
| G01-AC13 | PASS | Production Studio paths remain untouched; full Vitest passed 52 files/598 tests and isolated existing Portal Studio E2E passed 31/31. |
| G01-AC14 | PASS | Ignored evidence contains exact commands, JSON browser results, screenshots, the promoted-rule results, limitations, and the amendment record. |

Promotion-rule proof (amendment):

- `tests/logic/portal-studio/react-grab-target-promotion.test.ts` — 7/7 PASS against the REAL public primitives (jsdom 30 hit-test shim documented in-file): nested SVG → button; plain direct; standalone shape un-promoted; nearest interactive link; nearer control never skipped; non-ancestor interactive sibling never jumped to; no-target.
- Chromium contract spec — 10/10 PASS, including `promotes a nested SVG point to its nearest useful button target`, `keeps a plain button hit direct and unpromoted`, `does not jump a standalone SVG shape to an unrelated ancestor`, and `inspects the template shadcn button target`. Overlay, Shadow DOM and iframe assertions unchanged and green.
- Evidence: `svg-results.json` and `standalone-svg-results.json` record the raw-vs-promoted target, stack, and promotion flags.

Key command results:

- `pnpm install --frozen-lockfile`: PASS.
- `pnpm typecheck`: PASS.
- `pnpm exec vitest run tests/logic/portal-studio/react-grab-primitives.test.ts tests/logic/portal-studio/react-grab-target-promotion.test.ts`: 8/8 PASS.
- `NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost pnpm exec playwright test --config e2e/react-grab-g01/playwright.config.ts`: **10 PASS** (previously 6 PASS, 1 FAIL).
- `pnpm test`: 52 files/598 tests PASS.
- `pnpm build`: PASS.
- Isolated existing `e2e/portal-studio.spec.ts`: 31/31 PASS.
- Full-package/private-import, `element-source`, and production-output greps: zero forbidden matches.

No fallback, compatibility layer, private import, direct `element-source` dependency, default React Grab UI, production cutover, push, or Goal 02 implementation was added. The pre-existing user change in `registry/nocobase-users-example/list.tsx` was not edited, staged, or committed.
