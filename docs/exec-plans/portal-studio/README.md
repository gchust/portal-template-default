> **SUPERSEDED** — this plan set describes the older vertical/labeled-panel
> or Wrench-launcher presentation. The current source of truth for Portal
> Studio UX work is `docs/exec-plans/portal-studio-horizontal-toolbar-v5/`
> (the accepted draggable horizontal icon-first toolbar). Do not implement
> the conflicting designs here.

# Portal Studio — ExecPlan Series

Portal Studio (working name) is a **development-only feedback / developer tooling
capability** for this AI Portal template. It lets an agent (Pi, OpenCode, Codex, or
any shell agent) capture real browser state from the running Portal — selected
elements, component/source candidates, screenshots, runtime errors — into a
**local task JSON file**, then read that file, apply source changes, and verify
the result in the browser through a safe, bounded, redacted feedback loop.

This directory freezes the **shared product contract** (`00-shared-contract.md`)
and the five **phased ExecPlans** (`01-*.md` … `05-*.md`). It is the deliverable
of Goal 00. No product code exists yet; the plans below are executed one Goal at
a time in later sessions.

## Goal sequence

| Goal | Title | Single end-state |
| --- | --- | --- |
| 00 | Contract & ExecPlans (this series) | Shared contract + five phase plans frozen, with read-only repo evidence |
| 01 | Browser → File loop | A real Portal element stably becomes a printable local task JSON |
| 02 | Rich selection & complete artifacts | Multi-element / region / screenshot selections form a complete task artifact |
| 03 | Runtime diagnostics | An agent can safely tell whether the modified browser errors and obtain current page evidence |
| 04 | MCP & update-verification loop | The annotate → read → edit → wait HMR/reload → read errors → current screenshot loop is verifiable |
| 05 | Release hardening | The shared final DoD is fully evidenced; the capability is releasable and maintainable |

**Execution rule (hard):** exactly one Goal at a time. After each Goal:
**independent review → checkpoint commit (requested separately by the user,
never auto-committed) → clear the Goal → start the next Goal.** Each ExecPlan
contains its own stop condition; a plan must never start the next Goal.

## Repository facts & baselines (recorded at Goal 00)

| Item | Value |
| --- | --- |
| Implementation repo | `/root/work/portal-template-default`, branch `feat-agent-feedback` |
| Implementation baseline | `311827fcf11cfcb9446e980a5ddae4c3b2671f5e` — "feat: improve user role management and route overlays (#22)" — HEAD == `origin/main` after fetch; working tree clean |
| Upstream facts source | `/root/work/nocobase`, **read-only** via `git show` / `git grep` on `origin/develop` |
| Upstream baseline | `1e11828e025601914d865660144b277fc9a68cb5` — "docs: mark built-in plugins as enabled by default (#10314)" — confirmed after `git fetch origin develop` |
| Untouchable state | nocobase working tree contains pre-existing uncommitted `M yarn.lock` and `?? packages/core/app/client-settings/` — never modify, clean, stash, reset, checkout, or commit them |

## Recon log (Goal 00 evidence)

Read fully (implementation repo): `AGENTS.md`, `README.MD`, `package.json`,
`vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `.env.example`,
`.gitignore`, `MIGRATION.md`, `registry.config.json`, `src/App.tsx`,
`src/app/{extensions,development,routes,route-access-guard}.tsx`,
`src/routes.tsx`, and the stable interfaces:
`registry/nocobase-ai/{components/ai-root-provider,components/page-elements/page-element-provider,
providers/frontend-tool-registry,providers/form-registry,providers/page-context,
providers/chat-transport,providers/types,global-ai-chat,extension}.ts(x)`,
`registry/nocobase-route-surfaces/route-overlay-viewport.ts`,
`registry/nocobase-error-boundary/{error-boundary,error-diagnostics}.ts(x)`,
`sdk/src/{vite,extensions,routing}/…`, plus test conventions
(`registry/nocobase-ai/tests/frontend-tool.test.ts`, vitest include patterns,
Playwright `e2e/` setup).

Read read-only via `origin/develop` (upstream facts): nocobase `AGENTS.md`;
`packages/core/client-v2/src/ai/tools-manager/{types,index,hooks/*}.ts`
(BackendTools/FrontendTools manifest merge, `Scope`, `Permission = ASK | ALLOW`,
`ToolsEntry`); `packages/plugins/@nocobase/plugin-ai/src/client-v2/ai-employees/chatbox/`
(`ToolCall.invokeStatus`, `updateUserDecision` → frontend `invoke` →
`resumeToolCall` result list `{id, result: {status, content}}` return protocol,
session `workContext` items like `{type:'flow-model', uid}`); `data-nb-*`
attribute reality (`data-nb-hidden-menu-item` only, in admin layout);
`packages/core/flow-engine` layout (v2 runtime — **not** to be copied).

## Unverified assumptions (Goal 00, to be validated in later Goals)

1. React Grab is feasible in this template's React 19.1 runtime (fiber / DevTools
   hook) — to be evidenced by the Goal 01 spike; promotion criteria in contract §8.
2. `import.meta.env.DEV` static branches are fully eliminated from `pnpm build`
   output by Vite/Rollup constant folding — Goal 01 minimal evidence + Goal 05
   bundle-graph checks.
3. A dev-only Vite plugin (`apply: 'serve'`) can add middleware/injection without
   interfering with `portalRawIndexHtmlPlugin` / `portalSdkCompatibilityPlugin`.
4. Playwright's `vite --mode e2e` dev server keeps `import.meta.env.DEV === true`,
   so Studio is available in E2E runs.
5. The Shadow DOM toolbar and capture listeners coexist with
   `AIPageElementProvider`'s capture-phase listeners and portals (z-index/event
   conflicts unknown until the spike).
6. `redactPortalErrorText` plus the planned artifact rules cover all Goal 02/03
   leak vectors (header/token/query/URL) — extended coverage by tests.
7. The zero-dependency print CLI runs in Pi/OpenCode/shell environments (Node ≥ 18)
   — runtime requirement to be documented in Goal 01.
8. The stdio MCP server (Goal 04) needs no new runtime dependency (JSON-RPC over
   stdio with `node:` builtins) — otherwise the stop-and-ask rule applies.
9. Default bounded-wait (≤ 10 s) and heartbeat thresholds are sane for
   throttled-tab scenarios — to be calibrated in Goals 03/04.
10. nocobase `origin/develop` facts are a point-in-time snapshot; re-check before
    borrowing any protocol detail in later Goals.

## Prerequisites before Goal 01

- Goal 00 deliverables independently reviewed and checkpoint-committed
  (commit requested separately by the user; never auto-committed).
- Implementation repo on `feat-agent-feedback` with a clean tree.
- `.gitignore` entries for `.portal-studio/` are added as part of Goal 01.

## Annotation-first redesign — execution plan (Goal 00)

`08-annotation-first.md`: repository-grounded plan for the Annotation-first
redesign — five sequential goals: G01 draggable dock; G02 persistent
per-comment annotations (schemaVersion 5, v4→v5 migration); G03
multi-select / area / per-marker edit-delete; G04 Copy / explicit Complete /
shared formatter; G05 hardening & cleanup. Explicitly out of scope:
multi-task history/archive, commit rewriting, upstream sync, release,
dogfood implementation. Baseline: feat-agent-feedback @ aeafbbb (unit
224 / e2e 6/6), NocoBase origin/develop @ f0a480e9f0 (authorized ff-only
merge, evidence-reconcile/).

## Alpha regression acceptance (Goal 07)

`07-alpha-regression.md`: real reproduction and root-cause classification of
the Alpha (3.0.0-alpha.7) regression — the reported "public base URL" message
is Vite base behavior; the functional blocker was the Alpha `roles:check`
X-Portal 404, minimally fixed by a dogfood dev-proxy shim (D-028); the CRM
data lost in the upgrade was re-created with Alpha validation deltas (D-029);
the full annotate → read → agent fix → HMR → verify loop passed.

## Dogfood acceptance (Goal 06)

The real code-agent dogfood acceptance log lives in
`06-dogfood-acceptance.md` (evidence under /root/work/dogfood-crm/): an
independent non-Pi agent + NocoBase skills built a CRM AI Portal on the real
23000 backend, and the Portal Studio loop was exercised end to end with real
Chromium, real task JSON/MCP artifacts, and a real source fix verified by
HMR/reload. Found and fixed: D-025 (base-aware Studio bootstrap).

## Release evidence (Goal 05)

The series closes with the final DoD evidence checklist (contract §12) in
`05-release-hardening.md`, the abuse suite (`tests/logic/portal-studio/abuse.test.ts`),
production-exclusion raw outputs (chunk/content scans + prod-preview POST 404
probes), usage guides (`usage-codex.md`, `usage-pi-json.md`, `mcp-config.md`),
and security notes (`security-notes.md`).

## How to use these documents

- Read `00-shared-contract.md` once for the stable invariants, boundaries,
  security rules, and the final DoD. It intentionally does **not** repeat phase
  detail.
- Read the ExecPlan of the Goal you are about to execute. It is self-contained
  for that phase: scope, milestones, ACs, risks, verification commands, stop
  conditions, and a running log to maintain during execution
  (`Progress`, `Surprises & Discoveries`, `Decisions`, `Outcomes & Retrospective`).
- Any path/API adjustment during execution is recorded in the contract's
  **Decision Log** (`00-shared-contract.md §Decision Log`) and may never shrink
  the product scope.
- Docs are written in English (repo convention); see Decision Log D-001.

## Deliverable set of Goal 00 (this directory)

```
docs/exec-plans/portal-studio/
├── README.md               ← this entry point
├── 00-shared-contract.md   ← stable invariants + final DoD + boundaries
├── 01-browser-to-file-loop.md
├── 02-rich-selection-and-artifacts.md
├── 03-runtime-diagnostics.md
├── 04-mcp-and-update-verification.md
└── 05-release-hardening.md
```
