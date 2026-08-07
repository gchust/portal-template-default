# ExecPlan 01 — Core Browser → File Loop

> Contract: `00-shared-contract.md`. This plan is self-contained for Goal 01 and
> does not repeat the contract. Execution rule: do **not** start Goal 02 until
> this Goal's single end-state is achieved and independently reviewed.

## Summary

Prove the minimal viable loop in the real Portal: an agent (or user) picks a
real element in the running dev Portal, writes an instruction, and the Studio
atomically writes a local task JSON that any shell agent can print and act on.
Includes the React Grab feasibility spike, dev-only injection, Shadow DOM
toolbar, token-protected dev endpoint, and first production-exclusion evidence.

**Depends on:** Goal 00 (frozen contract).
**Single end-state:** *A real Portal element stably becomes a printable local
task JSON artifact (schema v1) via a dev-only, token-protected Studio.*

## Scope

In scope:
- React Grab spike in the real Portal (fiber/DevTools-hook read), promotion
  decision against contract §8 criteria; adapter over stable public APIs
  (`__REACT_DEVTOOLS_GLOBAL_HOOK__`, template element registry) when they
  adapt; evidence-documented fallback (DOM tree + `data-ai-page-element` +
  component/source hints) only when criteria fail; otherwise **stop and report
  the minimal blocker**.
- Dev-only Studio bootstrap in `src/App.tsx` under a compile-time
  `import.meta.env.DEV` branch (or dev-plugin HTML injection — spike decides,
  record in Decision Log).
- Shadow DOM toolbar overlay: keyboard accessible (focus trap, arrow keys move
  candidate, Enter picks, Esc cancels), role/aria labels, i18n keys in
  `src/locales` (en-US + zh-CN).
- Single-element selection with hover preview; component/source candidate list
  shown for the picked element; free-text instruction input.
- Dev endpoint (Vite plugin middleware, `apply: 'serve'`): random session token
  (≥32 bytes CSPRNG), loopback-only, `X-Portal-Studio-Token` constant-time
  check, path-traversal guard, body-size cap, atomic write of
  `.portal-studio/tasks/active-task.json` (schema v1), `session.json` (0600).
- Print command `scripts/portal-studio-print.mjs` (zero runtime deps, readable
  by Pi/OpenCode/any shell agent; `--json`/`--markdown`/`--task`).
- `.gitignore` entries for `.portal-studio/`; minimal production-exclusion
  evidence (dev-only artifacts absent from `pnpm build` output, grep-verified).
- Unit tests (redaction baseline reuse, token/path guards, print CLI, schema v1
  serialization) under `tests/`; focused E2E smoke under `e2e/`.

Out of scope (later Goals — do not pre-implement):
- Multi-select, region marquee, computed styles, business-context capture,
  screenshots, replace/clear lifecycle (Goal 02).
- console/network diagnostics, heartbeat, screenshot command (Goal 03).
- MCP, HMR revision tracking, stale detection (Goal 04).
- Security abuse suite, full E2E matrix, bundle-graph hardening, docs release
  (Goal 05).
- Any NocoBase upstream change; any `registry/` item; any new dependency
  (if the spike requires one, record evidence and stop to ask — contract rule).

## Milestones

| # | Milestone | AC (observable) |
| --- | --- | --- |
| M1 | React Grab spike | Spike report in this file's log: real Portal pages tested, promotion criteria §8 evaluated item by item with evidence (screenshots/console), decision recorded: promote / fallback / stop-with-blocker |
| M2 | Dev-only injection + Shadow DOM toolbar | With `pnpm dev`: toolbar visible on real Portal pages; fully keyboard-operable; absent from `pnpm build` output (grep evidence) |
| M3 | Single-element pick + candidates | Hover highlights pickable element; pick shows component + source candidates; instruction field accepts text |
| M4 | Token-protected endpoint + atomic task file | Wrong/missing token → 404; traversal attempts rejected; valid POST atomically writes schema-v1 `active-task.json`; file is 0600-consistent and gitignored |
| M5 | Print command + E2E smoke | `node scripts/portal-studio-print.mjs` prints the task JSON and exits 0; E2E smoke: pick element → POST → print → content matches; `pnpm typecheck && pnpm test && pnpm build` green |

## Acceptance criteria (Goal 01)

1. Real element → printable local task JSON in one uninterrupted flow, stable
   across ≥ 3 repetitions on ≥ 2 distinct real pages.
2. Toolbar and picker keyboard-accessible (WCAG-minded: visible focus, Esc
   cancel, documented key map); i18n keys present for en-US and zh-CN.
3. Token, traversal, and size guards tested; no token/secret ever inside the
   artifact (asserted by test).
4. Production build contains no Studio marker (grep evidence committed to the
   Goal log).
5. Print command works from a plain shell with no NocoBase/UI prerequisites.
6. `git diff --check` clean; no lockfile/`package.json` dependency changes.

## Risks & mitigations

- **React Grab fragile** (React 19.1 internals): promotion criteria §8 gate;
  fail-closed adapter; fallback path is first-class, not an afterthought.
- **Dev endpoint leaks** (SSRF-ish/local): loopback bind + token + size caps +
  traversal guard; abuse tests in Goal 05 re-run them.
- **HMR re-injection of toolbar** (double mount): idempotent mount keyed on the
  app root; E2E reload check (full hardening in Goal 05).
- **i18n drift**: keys only via `t()`; both locales updated in same change.
- **Scope creep**: any Goal 02+ item discovered mid-flight is logged in the
  contract Decision Log and deferred.

## Verification commands

```bash
cd /root/work/portal-template-default
pnpm typecheck && pnpm test          # unit: token/path/print/schema
pnpm build && grep -rE "portal-studio|PortalStudio|__portal-studio" dist/ || echo "clean"
pnpm test:e2e                        # focused smoke spec
node scripts/portal-studio-print.mjs --json
git diff --check
```

## Stop conditions

- End-state achieved → stop, request independent review + checkpoint commit;
  do **not** start Goal 02.
- React Grab fails all promotion criteria and the fallback also fails on real
  pages → stop and report minimal blocker (attempted paths, evidence, minimal
  input needed).
- A new dependency becomes necessary → stop and ask (contract rule).

## Running log (maintain during execution)

### Progress

- M1 React Grab spike: **DONE** — evidence below; decision: **promote with adapter**
  (contract §8 criteria evaluated item by item in Surprises/Decisions).
- M2 Dev-only injection + Shadow DOM toolbar: **DONE** — `src/studio/` + serve-only
  plugin; `pnpm dev` shows the toolbar on real pages; keyboard operable; absent
  from `pnpm build` output (grep evidence in this log).
- M3 Single-element pick + candidates: **DONE** — hover preview, component list,
  source candidates resolved server-side, instruction input.
- M4 Token-protected endpoint + atomic task file: **DONE** — curl/E2E evidence
  (404 wrong/missing token, 400 traversal, atomic write, 0600 file, token never
  in artifact).
- M5 Print command + E2E smoke: **DONE** — `node scripts/portal-studio-print.mjs`
  exit 0; E2E 3× on /users + 2× keyboard on /dev/ai-chat; `pnpm typecheck &&
  pnpm test && pnpm build && pnpm test:e2e` green.

### Surprises & Discoveries

1. `__REACT_DEVTOOLS_GLOBAL_HOOK__` IS present in the dev Portal, but **inert**: it
   is installed by the react-refresh preamble (`injectIntoGlobalHook`), its
   `renderers` Map is empty and `getFiberRoots` is absent — React never
   registered. Not usable for tree access.
2. `fiber._debugSource` and JSX `__source` are **null/absent** in this Vite dev
   setup (plugin-react does not inject `__source`; React 19.1 dev fibers carry no
   source info). So file/line candidates cannot come from the browser.
3. DOM nodes do carry `__reactFiber$<id>` keys; walking `fiber.return` yields
   stable, correct component names (tr → TableRow → TableBody → DataTable →
   ListView → UserList → UserListRoute → …) with zero probe-induced errors.
4. `react-refresh` runtime does not expose its type→module map (`/@react-refresh`
   exports only the preamble helpers), so component→file mapping cannot be read
   from the page; the dev server's **module graph** (transformed code, unminified)
   provides exact file:line matches via `function Name` regex.
5. `vite.config.ts` is bundled **without** the project's `@/` alias at config-load
   time — a node-only chain must not import via aliases (forced the
   self-contained server redaction, D-008).
6. Virtual modules (`/@portal-studio/init.js`) failed to resolve root-relative
   imports even with `this.resolve`; inline module scripts in `transformIndexHtml`
   (appended after the react-refresh preamble) work reliably.
7. jsdom: expando props on elements are non-enumerable via `Object.defineProperty`
   (default) — tests must pass `enumerable: true`; `<tr>` is not focusable — the
   keyboard pick path seeds from `document.activeElement`.

### Decisions

- See contract Decision Log D-006 … D-009 (appended during Goal 01).

### Outcomes & Retrospective (filled at Goal end)

- End-state reached: a real Portal element stably becomes a printable local task
  JSON (schema v1) via a dev-only, token-protected Studio. All ACs verified (see
  the AC checklist below).
- Retro: the spike-first order paid off (DevTools-hook dead end and missing
  `_debugSource` were discovered before any UI code existed). The server-side
  source resolution via module graph is the single most valuable piece for agents.
- Known trade-off (documented, not a defect): element-level file:line mapping is
  only available for modules already loaded in the dev module graph; component
  names + DOM/selector candidates always remain in the artifact as fallback.

### AC checklist (Goal 01)

| AC | Evidence |
| --- | --- |
| 1. Real element → printable task JSON, ≥3 reps, ≥2 pages | E2E: 3× mouse on /users, 2× keyboard on /dev/ai-chat (all passed); `portal-studio-print.mjs --json --task <id>` output equals the artifact (asserted in E2E) |
| 2. Keyboard-accessible + i18n | `tests/components/portal-studio/toolbar.test.tsx` (pick/cancel/save/error/close via keyboard); arrow/Enter/Esc handled in `toolbar.tsx`; `studio.*` keys in en-US + zh-CN |
| 3. Token/traversal/size guards tested; no token in artifact | `tests/logic/portal-studio/endpoint.test.ts` (constant-time, safe names, sanitize, atomic write, secret hygiene incl. session-token redaction); E2E: 404/404/400 live checks; artifact asserted token-free |
| 4. Prod build contains no Studio marker | `pnpm build` + `grep -rlE "PortalStudio|portal-studio|portalStudio|__PORTAL_STUDIO|ps-toggle|mountPortalStudio" dist/` → CLEAN; `dist/index.html` has 0 matches; no studio-named assets |
| 5. Print works from plain shell | CLI runs with `node` only (tests spawn it with `PORTAL_STUDIO_DIR`); exit codes 0/1/2 covered |
| 6. `git diff --check` clean; no lockfile/dependency changes | exit 0; `git status` shows only intended files (no `package.json`/lockfile diff) |

## Handoff to Goal 02

Goal 02 consumes schema-v1 artifacts and the picker interaction; it extends the
schema (v2), the picker (multi/region), and capture (styles/context/screenshot)
without changing the v1 write path or endpoint security model.
