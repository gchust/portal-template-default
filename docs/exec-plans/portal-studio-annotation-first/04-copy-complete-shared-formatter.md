# 04 — Copy, explicit Complete, shared formatter (independently executable)

Implements: D-033 #12, #13, #15, #16; D-034 #7; contract §2.

## Objective

Workflow affordances: **Copy** is first-class and does NOT clear the
session (clipboard fallback = manual copy); **explicit Complete** is the
only normal clear path for annotations; the **browser and CLI share one
Markdown formatter** (single source of truth for Copy, `print --markdown`,
and MCP `print_task`); MCP tools stay non-crashing with NO scope expansion.

## Dependencies

- G02/G03 (annotations model + management exist; dock hosts the actions).
- Reused: `task-model.ts` (normalize, status transitions), `errors.ts`
  (stale-session/untrusted-origin messages), `task-id.ts`.
- The CLI scripts run in Node; the shared formatter module must be
  dependency-free and pass in both node and jsdom (D-034 #7 fallback is
  non-secure-context safe, D-031-style).

## Exact file areas

- `src/studio/format.ts` (NEW, pure, zero-dep) — `formatTaskMarkdown`,
  `formatTaskJson` (accept v4|v5 via `normalizeTask`); golden fixtures.
- `scripts/portal-studio-print.mjs` — import the shared formatter;
  delete the local `formatMarkdown`; keep flags/exit codes. MECHANICS:
  the import specifier MUST carry the `.ts` extension (Node 22 type
  stripping) and `src/studio/format.ts` must use erasable-syntax-only
  TS (no enums/namespaces) so `node scripts/portal-studio-print.mjs`
  keeps working standalone with zero dependencies.
- `scripts/portal-studio-mcp.mjs` — `print_task` renders via the shared
  formatter path; NO new tools (D-033 #16).
- `src/studio/toolbar.tsx` — Copy button (async Clipboard API → textarea
  fallback), per-annotation Complete + "Complete all" in More, completed
  rendering, REMOVE the old Clear-task button (Complete is the only normal
  clear path, D-033 #13).
- `scripts/portal-studio-verify.mjs` — map the `completed` marker in the
  verify payload (exit 0 with completed marker; open-task semantics
  unchanged) if the endpoint change needs a CLI-side display.
- `src/studio/task-model.ts` + `src/studio/endpoint.ts` — `status` /
  `completedAt` validation (v5 sanitize extension); status transitions via
  atomic rewrite; verify response includes a `completed` marker (decision
  D-040: PATCH vs POST — safest minimal first, record the choice).
- `src/locales/en-US.ts`, `src/locales/zh-CN.ts` — new keys.
- Tests: `tests/logic/portal-studio/format-golden.test.ts` (NEW),
  `print-cli.test.ts` (parity), `mcp.test.ts` (parity + v5 non-crash),
  `tests/components/portal-studio/toolbar.test.tsx` (Copy/Complete),
  `e2e/portal-studio.spec.ts` (NEW steps).
- Docs: contract D-040; series README G04 done.

## Non-goals

- NO multi-task queue (Complete applies to the active task's annotations
  only); NO new MCP tools or scope expansion (D-036 #4); NO backend data
  mutation (D-036); NO schema changes beyond G02's v5 (status fields are
  part of v5); NO unrelated refactors.

## Acceptance criteria (AC)

1. Shared formatter (D-033 #15): `format.ts` used by print CLI, MCP
   `print_task`, AND browser Copy; golden tests assert byte-identical
   output across the three consumers.
2. Copy first-class, non-clearing (D-033 #12): copies agent-facing
   Markdown of the active task; does NOT clear/reset annotation state;
   success/failure feedback (aria-live).
3. Clipboard fallback (D-034 #7): async Clipboard API; on failure/
   unavailable → selectable textarea for MANUAL copy.
4. Explicit Complete (D-033 #13): per-annotation Complete + "Complete
   all" under More → `status: "completed"` + `completedAt` persisted;
   completed markers render distinctly; old Clear-task button removed —
   Complete is the ONLY normal clear path (per-marker delete from G03
   remains for destructive removal).
5. Verify semantics: open tasks unchanged (exit 0/1/2); completed task →
   exit 0 with `completed: true` marker in the payload (D-040).
6. MCP non-crashing (D-033 #16): five tools unchanged; v4/v5 render via
   the shared formatter path.
7. Acceptance concerns (D-034 #8): Copy/Complete survive reload (state
   persisted); a11y (buttons focusable, aria-live); HMR no duplication;
   security (clipboard content = redacted artifact; token never included).
8. Tests in the Tests section pass.

## Tests & browser evidence

- Unit: `format-golden.test.ts` — v4 + v5 fixtures, markdown/json golden
  bytes identical CLI↔MCP↔Copy; status transitions (open→completed,
  completedAt stamped, no double-stamp); verify completed semantics.
- Component: Copy button + fallback textarea + Complete UI + completed
  rendering.
- E2E: copy → paste equals `print --markdown`; complete → verify exit 0
  with completed marker → reload retains completed state; old Clear
  button absent.
- Browser evidence: screenshots (Copy feedback, fallback textarea,
  completed markers, More with Complete all).

## Review checklist

- Grounding: `format.ts` exists and is the single renderer (grep for
  duplicated markdown builders in scripts/toolbar).
- AC 1–8 evidenced; golden parity proven by tests.
- Old Clear-task path gone (grep clearTask/studio.clearTask in toolbar);
  MCP tool list still exactly five.
- Clipboard fallback exercised (non-secure-context unit/e2e path);
  redaction intact in copied output.
- No unrelated changes; gates green (pipefail); dist grep 0.
- D-035: any borrowed design (Instruckt adaptation with MIT notice /
  Agentation UX reference) recorded in the D-log with provenance.

## Checkpoint rule

After reviewer + Auditor approval: one local English Conventional Commit,
e.g.
`feat(portal): add Copy and explicit Complete with shared formatter (G04)`
— no push, no amend; report hash + status.

## Gates

As G01 (full suite green + new tests, pipefail).

## Evidence & Done

Evidence under `/root/work/dogfood-crm/evidence-annotation-first-g04/`
(parity outputs CLI vs Copy, complete flow, verify completed run). Done =
AC 1–8 pass live + golden parity proven + full gates green + D-040 +
checkpoint per the rule above.
