> **ARCHIVED — DO NOT IMPLEMENT — superseded by React Grab single-engine migration v1**
>
> This plan promoted the custom Fiber/module-graph perception adapter and v1–v5 schema
> compatibility. The migration contract (docs/exec-plans/portal-studio-react-grab-migration-v1/)
> is the only normative source; schema v6 and react-grab/primitives are the only supported
> engine. Kept for history only.

# 00 — Annotation-first design & shared contract

Status: EXECUTABLE CONTRACT. Companion to the series README. The five goal
docs (01–05) are independently executable against this contract.

## 1. Design model (Annotation-first)

The Studio moves from "one task = one selection + one instruction" to a
persistent annotation canvas:

```
Dock (draggable, position persisted, collapsed = compact icon toolbar)
 └─ annotation list: numbered markers (1,2,3… = live order index)
     └─ per annotation: marker kind (element | region | multi), comment,
        status (open | completed), hidden flag, stable annotationId
```

Lifecycle: continuous picks create annotations → each owns a comment
(Ctrl/Cmd+Enter saves) → markers persist in the task artifact, re-resolve
against the live DOM on render/navigation (unresolved targets retained) →
per-marker edit/delete/hide → Copy exports the agent-facing artifact
(non-clearing) → explicit Complete is the only normal clear path.

Current-state anchors (what is being replaced/extended):

- `src/studio/toolbar.tsx` — 8-state mode machine
  (`idle|picking|marquee|draft|saving|saved|error|cleared`), fixed
  `.ps-toggle` (emoji 🛠) + large `.ps-panel`; single `instruction` state;
  `saveTask` POSTs task then screenshot (capture failure currently errors).
- `src/studio/index.tsx` — mount + `TOOLBAR_STYLES` (position hardcoded in
  CSS: toggle `right:16/bottom:16`, panel `right:16/bottom:68`),
  `detectHostTheme` (D-031), theme-adaptive palette vars.
- `src/studio/types.ts` — `TASK_SCHEMA_VERSION = 4`; task shape
  `{instruction, elements[], region?, businessContext, redaction,
  screenshot?, diagnostics?, heartbeat?, revision?}`.
- `src/studio/selection.ts` — pure selection ops (replace/toggle/
  commitRegion/normalizeRegion, MAX_SELECTED_ELEMENTS=50).
- `src/studio/endpoint.ts` — `sanitizeTask` (v1–v4 → v4), atomic writes,
  `commitEvidence`, heartbeat/revision semantics; single `active-task.json`
  slot.
- `src/studio/vite.ts` — serve-only plugin, 7 endpoints, base-aware
  bootstrap (D-025), trusted-source check (D-031).
- `scripts/portal-studio-print.mjs` / `-verify.mjs` / `-mcp.mjs` — agent
  interfaces (print owns the Markdown renderer today).

## 2. schemaVersion 5 — `annotations[]`

BREAKING over v4 (deliberate, justified by D-033 #17: v4 intermediates are
unpublished dev-only artifacts, so no migration framework is built — contract §6
additivity is intentionally set aside with this note appended to the D-log).
`TASK_SCHEMA_VERSION = 5` const added; v4 const retained. Top-level v4 fields (`taskId, createdAt,
url, title, businessContext, redaction, screenshot?, diagnostics?,
heartbeat?, revision?`) stay; `instruction` and `elements[]`/`region` are
replaced by:

```ts
export type AnnotationKind = "element" | "multi" | "region";

export type Annotation = {
  annotationId: string;          // stable, never renumbered (newTaskId)
  kind: AnnotationKind;
  comment: string;               // per-annotation instruction
  createdAt: string;
  status: "open" | "completed";
  completedAt?: string;
  hidden?: boolean;              // D-033 #11: hide without delete
  // element / multi: element captures (schema-v2-shaped) + live refs
  elements: ElementCapture[];
  // region: viewport rect (marquee)
  region?: Region;
  // display number is NOT stored: it is the live order index + 1 (D-034 #4)
};

export type PortalStudioTaskV5 = Omit<
  PortalStudioTask, "instruction" | "elements" | "region"
> & {
  schemaVersion: 5;
  annotations: Annotation[];
};
```

v4 compatibility (D-033 #17): a simple `normalizeTask` (pure module
`src/studio/task-model.ts`) maps v4 → v5 on read: `instruction` becomes a
single `kind:"element"` annotation comment, `elements[]` its captures,
`region` its rect. NO migration framework; v4 files stay readable by the
print CLI and MCP (dual reader) and are rewritten as v5 on next save.

## 3. Authoritative decisions

D-033 (product), D-034 (interaction), D-035 (licensing), D-036 (scope) —
full text in `../portal-studio/00-shared-contract.md` Decision Log and
`../portal-studio/08-annotation-first.md` Revisions 1–4. Summary: see
series README. Every goal doc cites the specific D-items it implements.

## 4. Stable invariants (never broken)

1. Dev-only: plugin `apply: "serve"`; Studio never in the production
   module graph; `pnpm build` dist has zero Studio markers (grep, exit 1).
2. Base-aware bootstrap (D-025); trusted-source enforcement with
   `allowRemote` opt-in (D-031); token ≥ 32 bytes CSPRNG, constant-time
   verify, 404-on-mismatch; same-origin, no CORS.
3. Atomic writes (temp + rename, 0600), path-traversal guards, per-route
   body caps, final artifact ≤ 256 KB re-checked after merges.
4. Redaction at ingestion (client) + authoritative server re-sanitization;
   session token stripped from artifacts; screenshots are pixel snapshots
   (D-023) with secret attributes stripped.
5. Secrets never captured by default; request/response bodies never
   captured (diagnostics shape whitelist).
6. i18n for all user-facing strings (en-US + zh-CN); a11y (keyboard, ARIA,
   focus containment); no `any`; no unrelated refactors (D-036).
7. Gates: `set -o pipefail`, real exit codes (D-018); HMR revision honesty
   (reload bump authoritative, D-019/020); heartbeat authority (D-015/016).

## 5. Acceptance concerns (D-034 #8) — apply to every goal

- Route changes: markers follow targets (re-resolve on navigation).
- Scroll/resize: marker overlay positions re-clamp.
- HMR: mount idempotence, no duplicate markers/annotations.
- a11y: keyboard-complete interaction, ARIA states, focus containment.
- Security: dev-only, token, redaction, no secrets in artifacts.
- Production exclusion: dist grep 0 at the final state.

## 6. Test matrix

| Layer | Runner | Files | Covers |
| --- | --- | --- | --- |
| Unit logic | Vitest | `tests/logic/portal-studio/` | task-model normalize v4→v5, dock clamp/persistence, annotation ops, formatter golden output, endpoint v5 sanitize, status updates |
| Component | Vitest + Testing Library | `tests/components/portal-studio/` | toolbar modes, dock drag state, annotation list, Copy/Complete UI |
| E2E | Playwright | `e2e/portal-studio.spec.ts` (+ new steps) | drag → reload retention, annotate → reload → markers persist, route/scroll/resize follow, complete/copy, no duplication on HMR |
| Build/prod | shell | Goal 05 | dist grep 0, endpoint absence in prod preview |
| Abuse | Vitest + E2E | existing suites | token, traversal, sizes, redaction, secret-in-artifact |

## 7. Gate commands (shared minimum)

```bash
set -o pipefail
pnpm typecheck; echo "TYPECHECK_EXIT=$?"
pnpm test; echo "TEST_EXIT=$?"
pnpm build; echo "BUILD_EXIT=$?"
pnpm exec eslint <touched>; echo "ESLINT_EXIT=$?"
pnpm test:e2e; echo "E2E_EXIT=$?"   # when the goal touches browser behavior
git diff --check; echo "DIFF_CHECK_EXIT=$?"
grep -rlE "PortalStudio|portal-studio|__portal-studio|ps-toggle|mountPortalStudio|portal-studio-mcp|__PORTAL_STUDIO" dist/; echo "DIST_GREP_EXIT=$? (expect 1)"
```

## 8. Cross-goal DoD (reached by G01–G05)

1. Annotation-first model fully replaces the fixed emoji + idle panel +
   single-instruction UX; dock draggable with persisted position.
2. schemaVersion 5 artifacts with `annotations[]`, per-comment, numbered
   persistent markers that follow targets (unresolved retained); v4 files
   still readable.
3. True multi-select, area annotations, per-marker edit/delete/hide with
   live renumbering.
4. Copy (first-class, non-clearing, clipboard fallback) and explicit
   Complete as the only normal clear path; browser and CLI share the
   Markdown formatter; MCP renders v5 without crashing, tools unchanged.
5. Hardening: theme/a11y audits, redaction/diagnostics coverage, i18n
   parity, zero lint warnings, licensing provenance clean (D-035), docs
   consolidated.
6. Production exclusion and security invariants re-verified; full gates
   green; each goal checkpointed locally (no push); Decision Log at D-037+.

## 9. Decision Log (series continuation)

| ID | Goal | Decision |
| --- | --- | --- |
| D-037 | G01 | dock persistence key/format, More-menu placement (record at implementation) |
| D-038 | G02 | marker re-resolution strategy (route/scroll/resize), v4 normalize details |
| D-039 | G03 | multi-select merge semantics, hide vs delete UX |
| D-040 | G04 | status-update endpoint shape (PATCH vs POST), Complete semantics |
| D-041 | G05 | audit findings & fixes |

(IDs reserved; actual entries appended to `../portal-studio/00-shared-contract.md`.)
