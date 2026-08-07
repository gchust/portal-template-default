# 00 — Shared Product Contract: Portal Studio

Status: **FROZEN** (Goal 00). This document holds only **stable invariants** and
the **final DoD** for Portal Studio. Phase-specific scope, milestones, ACs,
risks, verification commands, and stop conditions live in `01-*.md` … `05-*.md`
and are deliberately **not** repeated here. Changes to path/API decisions are
recorded in the Decision Log (§9) and may never shrink product scope.

## 1. Product definition

Portal Studio is a **development-only** capability of this AI Portal template
(`portal-template-default`) that closes the agent feedback loop for source
edits against the real running Portal:

1. The agent captures real browser state (single/multiple elements, regions,
   component/source candidates, business context, annotated screenshots).
2. The capture is written as a **local task JSON file** (atomic, token-protected,
   dev-only endpoint) and printed via a shell-readable command.
3. The agent edits source; the Studio reports runtime errors (console/window/
   fetch/XHR) and current page evidence (heartbeat, screenshot), with
   HMR/reload revision tracking, so the agent can verify the edit safely.
4. A **JSON/file path is always first-class**; an optional stdio MCP server
   (Goal 04) is an enhancement, never a prerequisite.

The AI Portal is an independent React/Vite template runtime. NocoBase v2
FlowEngine frontend tooling is **not** copied or coupled in; its protocol
concepts (manifest, ASK/ALLOW, workContext, frontend execution/return) are
borrowed as documented in §3.2.

## 2. Stable invariants (never change across Goals 01–05)

1. **Dev-only capability, enforced at build level.** Production builds must not
   contain executable Studio/diagnostic/MCP-client code and must not expose any
   dev endpoint. Hiding behind a button is never sufficient. Evidence of
   exclusion is part of the final DoD (Goal 05 bundle-graph checks).
2. **JSON/file-first.** The local task file is the source of truth. All
   capabilities must remain fully usable without MCP. MCP is an optional
   enhancement only.
3. **Security invariants** (defaults, apply to every capture/endpoint):
   - minimal privilege; endpoints bind to loopback (`127.0.0.1`), same-origin
     only, no CORS exposure;
   - random per-session token (≥ 32 bytes CSPRNG) protecting every dev endpoint;
     constant-time comparison; never in artifacts;
   - atomic writes (temp file + rename); path-traversal protection on every
     file operation; bounded buffers and body-size caps;
   - secrets — `Authorization`, `Cookie`, tokens, passwords, request/response
     bodies — are **never** captured by default; unified redaction applies
     everywhere (baseline: `redactPortalErrorText` in
     `registry/nocobase-error-boundary/error-diagnostics.ts`, extended as
     needed by Goal 02/03);
   - MCP credentials never live in frontend code (Goal 04).
4. **No upstream modification.** NocoBase upstream product code is never
   modified. Any unavoidable cross-repo dependency is recorded as evidence +
   recommendation only (Decision Log), never implemented here.
5. **One Goal at a time.** After each Goal: independent review → checkpoint
   commit (only when separately requested by the user) → clear Goal → next.
   ExecPlans define single end-states and explicit "do not start the next Goal"
   stop conditions.
6. **Repo conventions apply.** portal-template-default TypeScript/React/a11y/
   i18n/test norms (see repo `AGENTS.md`); no `any`, no unrelated refactors, no
   premature abstractions; every new package lands in `devDependencies`
   (production serves built `dist` and never installs Node deps).
7. **Repo facts beat the imagined path.** When the repository contradicts a
   plan, the plan adapts via the Decision Log; the product scope defined in the
   user's five-Goal description cannot shrink.

## 3. Architecture anchors

### 3.1 Reusable stable interfaces (implementation repo)

| Interface | Location | Reuse in Studio |
| --- | --- | --- |
| `NocoBaseAIRootProvider` | `registry/nocobase-ai/components/ai-root-provider.tsx` | Provider composition pattern; Studio mounts beside/inside it, never replacing it |
| `AIPageElementProvider` / `useAIPageElementPicker` / `useAIPageElement` | `registry/nocobase-ai/components/page-elements/page-element-provider.tsx` | Hover-highlight + click-to-pick interaction pattern, `data-ai-page-element` registry, portal overlay z-index conventions (`z-2000`/`z-2001`); Studio selection may reuse the registry as an adapter, but must add keyboard access (current picker only handles Escape) |
| `AIPageContextResolverProvider`, `AIWorkContextItem` | `registry/nocobase-ai/providers/page-context.tsx`, `providers/types.ts` | workContext item shape `{type, id?, title?, content?, …}` for business-context captures (Goal 02) |
| `AIFrontendToolRegistry`, `defineAIFrontendTool`, `createFrontendToolInvokers` | `registry/nocobase-ai/providers/frontend-tool-registry.tsx` | Manifest + `ASK`/`ALLOW` + serializability discipline; Studio task metadata may mirror the manifest shape, but must not impersonate chat tools |
| `AIFormRegistry`, `createFormFillerInvoker` | `registry/nocobase-ai/providers/form-registry.tsx` | Allowed-ids invocation context pattern (if Studio later exposes forms) |
| `NocoBaseChatTransport` | `registry/nocobase-ai/providers/chat-transport.ts` | Transport/resume protocol pattern for the update-verification loop (Goal 04) |
| `RouteOverlayViewportContext` | `@nocobase/portal-sdk/routing` + `registry/nocobase-route-surfaces/route-overlay-viewport.ts` | Reserve/inspect viewport space (`--route-overlay-inline-end`) so Studio overlays do not cover content or clash with the chat side panel |
| `NocoBaseErrorBoundary`, `normalizePortalError`, `formatPortalErrorDiagnostic`, `redactPortalErrorText` | `registry/nocobase-error-boundary/` | Diagnostic formatting + redaction baseline for Goals 02/03 |
| Extension assembly (`AppExtension`, `dev.routes`/`dev.resources`, `extensionStandaloneRouteElements`) | `src/app/extensions.tsx`, `sdk/src/extensions/index.ts` | DEV-only surfaces; `/dev` route machinery already gates on `import.meta.env.DEV` |
| Vite plugins (`portalSdkCompatibilityPlugin`, `portalRawIndexHtmlPlugin`), `envPrefix` (`VITE_`, `NOCOBASE_`, `API_CLIENT_`) | `vite.config.ts`, `sdk/src/vite/index.ts` | Dev-server plugin/middleware pattern for the Studio endpoint (Goal 01) |

### 3.2 Borrowed protocol concepts (nocobase `origin/develop`, read-only)

These are **concepts to borrow**, never code to copy (different runtime: v2
`@nocobase/client-v2` + FlowEngine vs this React/Vite template):

- **Manifest**: `BackendTools` (`scope: SPECIFIED|GENERAL|CUSTOM`,
  `defaultPermission`, `silence`, `introduction`, `definition{name, description,
  schema}`) merged with `FrontendTools` (`ui.card`, `ui.modal`, `invoke`,
  `useHooks`) into `ToolsEntry`; enumerated by the `aiTools` resource
  (`packages/core/client-v2/src/ai/tools-manager/types.ts`).
- **ASK/ALLOW**: `Permission = 'ASK' | 'ALLOW'`; tool calls carry
  `auto` and `invokeStatus` (`init | interrupted | waiting | pending | done |
  confirmed`) (`chat-tool-call.ts`).
- **Frontend execution/return protocol**: `aiConversations.updateUserDecision`
  (`approve | edit | reject`, `editedAction{name,args}`) → server returns the
  tool calls → frontend runs `invoke(app, args)` → results returned as
  `{id, result}` with `result = {status:'success'|'error', content}`
  (`chatbox/hooks/useToolCallActions.ts`, `stores/chat-tool-call.ts`).
- **workContext**: session-scoped context items (e.g. `{type:'flow-model',
  uid}`) added/synced per session (`AIEmployeeShortcut`,
  `addContextItems`/`syncContextAttachments` tests).
- **Business attributes**: upstream `data-nb-*` usage is sparse
  (`data-nb-hidden-menu-item` in admin layout); this template's equivalent is
  `data-ai-page-element`. Goal 02 must treat both as optional hints, not
  guarantees.

### 3.3 Explicit non-copy rule

No v2 FlowEngine source, `@nocobase/client-v2` imports, `@formily/reactive`
models, or `@nocobase/plugin-ai` chatbox code may be copied into
`portal-template-default`. Import direction in this repo is
`@nocobase/portal-sdk` + `@/` only; registry items never import Ant Design.

## 4. Recommended code placement (Decision Log D-002)

Implementation repo, application-owned sources:

```
src/studio/                  ← Studio runtime (provider, toolbar, picker, capture, diagnostics)
src/studio/extension.tsx     ← AppExtension: dev routes/resources for the /dev control panel
src/studio/…tests            ← unit tests under tests/ (vitest include patterns)
scripts/portal-studio-print.mjs   ← zero-dependency CLI print command (any shell agent)
vite.config.ts (or src/studio/vite.ts) ← dev-only plugin, apply: 'serve': endpoint + token + injection
.portal-studio/              ← runtime dir: session token + task files (gitignored, added in Goal 01)
```

Rationale: a `registry/` item would materialize into every derived Portal via
`registry.config.json` (source → `src/extensions/<name>`), which conflicts with
the dev-only, never-in-production invariant. Studio therefore stays
application-owned under `src/`, like `src/app/development.tsx`. The dev control
panel reuses the existing DEV-only `/dev` route machinery
(`extensionStandaloneRouteElements`); the toolbar overlay is provider-mounted.

## 5. Dev/prod injection boundary

- **Dev only**: Vite dev server (`pnpm dev`, Playwright `--mode e2e`).
  - Studio bootstrap: provider mounted in `src/App.tsx` inside a
    `import.meta.env.DEV` static branch (compile-time eliminated in prod) — or
    injected by the dev-only Vite plugin into `index.html`; decided by the
    Goal 01 spike.
  - Studio endpoints: Vite plugin middleware, `apply: 'serve'` only; bound to
    loopback; token-protected (see §7). `pnpm build` never registers them.
  - Toolbar: Shadow DOM overlay, keyboard accessible, role/aria compliant.
- **Prod (never)**: no Studio provider, toolbar, picker, diagnostics capture,
  MCP client, or endpoint in the production bundle. Evidence: Goal 05 checks the
  production bundle graph and artifacts (grep for Studio markers in `dist/`).
- **Not acceptable**: hiding Studio behind a button in prod, lazy-loading it
  from a prod chunk, or gating only on an env var read at runtime.

## 6. Task artifact schema evolution

File: `.portal-studio/tasks/active-task.json` (single source of truth; Goal 01
creates it). Writes are atomic (temp + rename), bounded size, path-traversal
checked. Evolution is **additive**; `schemaVersion` is a positive integer.

| Version | Goal | Adds |
| --- | --- | --- |
| `1` | 01 | `schemaVersion`, `taskId`, `createdAt`, `url`, `title`, `instruction` (agent's modification note), `element` (single: selector candidates, component candidates, source candidates, minimal snapshot), `session`-independent (no token/secret fields by design) |
| `2` | 02 | `elements[]` (multi), `region` (marquee rect), computed-style excerpts, business context (`data-ai-page-element`/`data-nb-*`/workContext-shaped items), redaction manifest (what was stripped), `screenshot` refs (annotated PNG paths), replace/clear lifecycle |
| `3` | 03 | `diagnostics` (ring-buffer errors: source `console.error`/`window.onerror`/`unhandledrejection`/failed `fetch`/failed `XHR`, deduped, size-capped), `heartbeat` (browser online/stale/offline + timestamps) |
| `4` | 04 | `revision` (`sourceRevision`, `browserRevision`, HMR ack state, `expectedAfter` bounded-wait deadline), `screenshot` command output refs, MCP status (absent when MCP unused) |

**Print command contract** (shell-agent readable, no NocoBase, no Studio UI
required): `node scripts/portal-studio-print.mjs [--json|--markdown] [--task <id>]`
prints `active-task.json` (default) or a named task; exit 0 on success, nonzero
with a clear message when missing/unreadable. Zero runtime dependencies.
Token not required to read local files; token required only for the dev
endpoint (writes).

## 7. Token / endpoint boundary

- **Token**: generated once per dev-server session — ≥ 32 bytes from a CSPRNG
  (`node:crypto`); printed to the dev-server console and written to
  `.portal-studio/session.json` (mode `0600`, gitignored) so shell agents can
  read it without it ever entering task artifacts.
- **Endpoints** (dev server only, loopback): one write endpoint
  (e.g. `POST /__portal-studio/tasks` — exact path fixed by Goal 01 spike) plus
  read/control endpoints added by later Goals (screenshot, heartbeat, revision).
  Same-origin; no CORS; header `X-Portal-Studio-Token`, constant-time compare;
  404 on missing/wrong token; request size caps; only `.portal-studio/tasks/`
  writable; every filename resolved and prefix-checked (path-traversal guard).
- **Credentials**: tokens/headers/cookies never appear in artifacts, logs of
  the print command, or screenshots (redaction in Goals 02/03).

## 8. React Grab promotion criteria (Goal 01 spike)

React Grab = reading the live React tree (fiber internals via React DevTools
hook / element keys) to derive component names and source candidates for the
picked element. Promotion criteria (all must hold, with evidence):

1. Works on real Portal pages (e.g. Users table, chat side panel) without
   crashing, warning-spamming, or breaking app behavior.
2. Yields stable, correct component names + source file/line candidates for at
   least two representative blocks.
3. Prefers stable public APIs (React DevTools global hook `__REACT_DEVTOOLS_GLOBAL_HOOK__`,
   template's own element registry); fiber-key access is allowed only as
   evidence-documented adapter with version pinning for React 19.1.
4. Fails closed: any grab failure degrades to the DOM/business-attribute
   fallback, never an exception that kills the picker.

If criteria fail: use the evidence-based element/source fallback (DOM tree +
`data-ai-page-element`/`data-nb-*` + source-map/component hints) or **stop and
report the minimal blocker** with attempted paths and evidence (per contract
blocker rule). React Grab must not block Goal 01's end-state indefinitely.

## 9. JSON / MCP boundary

- Task files + print command = **always available, first-class** path.
- MCP (Goal 04): optional stdio server that reads/writes the *same* task files
  and exposes tools (`capture`, `print`, `screenshot`, `revision`,
  `diagnostics`); configuration documented in repo docs; credentials never in
  frontend; when MCP is absent or fails, the JSON path works unchanged.
- No capability may be implemented *only* behind MCP.

## 10. HMR revision semantics (Goal 04)

- `sourceRevision`: content hash of the source file(s) referenced by the task
  (computed by the dev plugin/CLI from disk at read/print time).
- `browserRevision`: monotonic counter set by the Studio bootstrap marker and
  bumped on every full reload; HMR acks reported by the dev plugin.
- `expectedAfter`: the source revision the agent recorded after editing;
  bounded wait (default ≤ 10 s, configurable) for the browser to reach it.
- **Stale detection**: artifact/browser mismatch or missing ack after the
  bounded wait marks the task `stale` (never silently trusted).
- Heartbeat (Goal 03) distinguishes `online | stale | offline`; only `online`
  state can satisfy a revision wait.

## 11. Test matrix

| Layer | Runner | Where | Covers |
| --- | --- | --- | --- |
| Unit (logic/state) | Vitest | `tests/logic/**` (+ `registry/*/tests` convention if reused) | redaction, schema evolution, ring buffer, token/path guards, print CLI, revision math |
| Component | Vitest + Testing Library | `tests/components/**` | toolbar a11y & keyboard, picker interaction, status UI |
| E2E | Playwright | `e2e/**` (dev-mode server `--mode e2e`, Studio active) | real capture loop, HMR/reload wait, screenshots, error detection |
| SDK | unchanged | `sdk/tests` | must stay green (no SDK changes expected) |
| Build-graph / prod exclusion | shell + `pnpm build` | Goal 05 | no Studio markers in `dist/`, endpoint absent in prod |
| Security abuse | Vitest + E2E (Goal 05) | `tests/logic/**`, `e2e/**` | traversal, token brute-force/missing, oversized bodies, redaction leakage, secret-in-artifact checks |

Verification commands are per-Goal (see ExecPlans); the shared minimum is
`pnpm typecheck && pnpm test && pnpm build` (plus `pnpm test:e2e` where the
Goal touches browser behavior) and `git diff --check`.

## 12. Final DoD (shared, reached by Goals 01–05)

1. Real Portal elements (single, multi, region) become complete, printable,
   local task JSON artifacts with source/component/business candidates and
   annotated screenshots — JSON path only, no MCP required.
2. Agent can read artifacts and apply source edits; the Studio verifies the
   edit via HMR/full-reload revision tracking, error diagnostics
   (console/window/promise/fetch/XHR), heartbeat state, and current screenshots
   — the full annotate → read → edit → verify loop is reproducible by
   Pi/OpenCode/Codex and any shell agent.
3. Optional stdio MCP server works against the same artifacts with documented
   configuration; no credentials in frontend; JSON fallback always compatible.
4. Production build contains no executable Studio/diagnostic/MCP-client code
   and exposes no dev endpoint (bundle-graph + artifact evidence).
5. Security invariants hold under abuse testing (path traversal, token,
   size caps, redaction, secrets never in artifacts by default).
6. All repo conventions respected (lint/typecheck/tests green, i18n where UI
   text is added, a11y keyboard support, no `any`, no unrelated changes).
7. Clean-workspace re-verification passes and release evidence (dependency/
   license/NOTICE review, usage docs for Codex and Pi/JSON) is present.

## 13. Decision Log

| ID | Date | Decision | Rationale / evidence |
| --- | --- | --- | --- |
| D-001 | Goal 00 | Docs in English | Repo convention (`AGENTS.md`, `README.MD`, `MIGRATION.md` all English); consumed by later agents/CI |
| D-002 | Goal 00 | Studio lives under `src/studio/` (application-owned), not a `registry/` item | `registry.config.json` materializes items into derived Portals (`source.target = src/extensions/<name>`), conflicting with the never-in-production invariant; `src/app/development.tsx` sets the DEV-only precedent |
| D-003 | Goal 00 | Runtime dir `.portal-studio/` (gitignored); tasks under `.portal-studio/tasks/` | Keeps secrets/tasks out of git; single obvious location for shell agents; `*.local` already ignored, add exact entries in Goal 01 |
| D-004 | Goal 00 | Upstream borrow list is concept-only (manifest/ASK/ALLOW/workContext/exec-return) | v2 runtime differs (FlowEngine/`@formily/reactive`/antd); template already implements its own registry/transport equivalents |
| D-005 | Goal 00 | `data-nb-*` treated as optional hint, `data-ai-page-element` as primary business context | Upstream `data-nb-*` sparse (`data-nb-hidden-menu-item` only); template's own registry attribute is the reliable signal |
| (open) | — | React Grab feasibility | To be evidenced in Goal 01 spike; promotion criteria in §8 |
| D-006 | Goal 01 | React Grab **promote with adapter** (fiber chain + module-graph source resolution) | Spike evidence (ExecPlan 01 log): `__reactFiber$` keys present in React 19.1 dev; DevTools hook present but inert (0 renderers, no `getFiberRoots` — react-refresh preamble shim); `_debugSource`/`__source` absent in this Vite dev setup. §8 criteria: C1 pass (2 real pages, no probe-induced errors), C2 pass (stable names + file:line via module graph), C3 documented (fiber-key adapter with React 19.1 pinning; public APIs preferred where available), C4 pass (fail-closed empty chain) |
| D-007 | Goal 01 | Dev injection via serve-only plugin `transformIndexHtml` (inline module script appended after react-refresh preamble + config script), not an App.tsx branch | Keeps `src/studio` out of the production module graph entirely (nothing imports it at build time — strongest prod exclusion); virtual-module approach rejected after root-relative import resolution failures (ExecPlan log Surprises #6) |
| D-008 | Goal 01 | Server-side redaction is self-contained in `endpoint.ts` (mirrors client baseline patterns); client `redact.ts` reuses `redactPortalErrorText` via `@/extensions` | `vite.config.ts` is bundled without the `@/` alias at config-load time; server never trusts client redaction (defense in depth); session-token value additionally stripped via `redactSessionToken` before the atomic write |
| D-009 | Goal 01 | E2E uses a local gitignored `.env.e2e` against the sandbox backend (127.0.0.1:23000) and serial mode | Playwright webServer is dev-mode so Studio is active; `.env.e2e` is gitignored; serial mode avoids races on the shared `active-task.json` |

---
*Contract frozen at Goal 00. Per-phase detail: see `01-*.md` … `05-*.md`.*
