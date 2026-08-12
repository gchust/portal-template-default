> **ARCHIVED — DO NOT IMPLEMENT — superseded by React Grab single-engine migration v1**
>
> This plan promoted the custom Fiber/module-graph perception adapter and v1–v5 schema
> compatibility. The migration contract (docs/exec-plans/portal-studio-react-grab-migration-v1/)
> is the only normative source; schema v6 and react-grab/primitives are the only supported
> engine. Kept for history only.

# 02 — Persistent per-comment annotations (independently executable)

Implements: D-033 #1, #4, #6, #7, #8, #9, #14, #17; D-034 #1, #2, #3, #8;
contract §2 (schemaVersion 5), §5.

## Objective

Move the artifact to **schemaVersion 5 with `annotations[]`**: continuous
single-element annotation (each plain pick creates a new annotation with its
own comment), area annotations, numbered markers that persist across
collapse/refresh/routes and follow their targets (unresolved targets
retained), a simple v4 normalize-on-read (no migration framework), and
Enter/Ctrl+Enter comment editing with capture-failure-safe saves.

## Dependencies

- G01 dock (annotation list lives in the expanded dock; compact toolbar
  badge shows live annotation count).
- Existing pipeline reused: `captureSelection`/`captureElement` (capture.ts),
  `selection.ts` ops, `endpoint.ts` sanitize/atomic-write,
  `task-id.ts` `newTaskId` (annotation ids), `errors.ts` message mapping.
- No dependency on G03/G04 features (multi-select, hide, Copy/Complete).

## Exact file areas

- `src/studio/types.ts` — `TASK_SCHEMA_VERSION = 5` const (v4 kept);
  `Annotation`, `AnnotationKind`, `PortalStudioTaskV5` types.
- `src/studio/task-model.ts` (NEW, pure) — `normalizeTask` (v4|v5 →
  canonical v5), `annotationDisplayNumber`, helpers; unit-tested.
- `src/studio/toolbar.tsx` — annotation state replaces single
  `instruction`/`draft`; continuous pick → new annotation; per-annotation
  comment editor (Enter = newline, Ctrl/Cmd+Enter = save); v5 save path
  (task POST then evidence; capture failure → non-blocking notice);
  annotation list UI in the dock; unresolved rendering.
- `src/studio/index.tsx` — numbered marker overlay (page badges), marker
  re-resolution on route/scroll/resize, `hidden` render support (used by
  G03), styles for badges/list/unresolved (light/dark). MOUNTING RULE:
  markers render INSIDE the shadow host (or are explicitly excluded in
  `src/studio/screenshot.ts` clone handling) so they never pollute
  evidence screenshots — the host element sits inside the cloned
  documentElement tree (D-034 #3 review finding F3).
- `src/studio/endpoint.ts` — v5 sanitization (annotations validation:
  ≤50 element captures PER ANNOTATION (existing MAX_ELEMENTS; totals are
  bounded by the 256 KB artifact cap so accumulated annotations keep
  working), comment ≤2000, annotationId safe-name pattern, region bounds,
  status/hidden whitelist); v4 read normalized.
- `src/studio/vite.ts` — GET/POST unchanged surface; v5 passes through
  sanitize; no new endpoints.
- `scripts/portal-studio-print.mjs`, `scripts/portal-studio-mcp.mjs` —
  v4/v5 dual reader (normalize for rendering); MCP tools unchanged.
- `src/locales/en-US.ts`, `src/locales/zh-CN.ts` — new keys.
- Tests: `tests/logic/portal-studio/task-model.test.ts` (NEW),
  `endpoint.test.ts` (v5 cases), `print-cli.test.ts` (v5 + v4 fallback),
  `mcp.test.ts` (v5 non-crash), `tests/components/portal-studio/
  toolbar.test.tsx`, `e2e/portal-studio.spec.ts` (NEW steps).
- Docs: contract D-038; series README G02 done.

## Non-goals

- NO multi-select mode (G03); NO per-marker delete/hide (G03); NO
  Copy/Complete (G04); NO multi-task queue/history (single active-task
  slot); NO migration framework for v4 (simple normalize-on-read only,
  D-033 #17); NO backend data mutation (D-036); NO new endpoints.

## Acceptance criteria (AC)

1. Schema v5 with `annotations[]`; v4 const/type retained; display number
   = live order index + 1 (never stored).
2. Continuous annotation: consecutive plain picks each create a NEW
   annotation (no replace).
3. Per-comment editor: Enter = newline, Ctrl/Cmd+Enter = save (D-034 #1);
   save persists via the active-task atomic write.
4. Capture-failure safety (D-034 #2): evidence capture failure keeps the
   annotation + non-blocking notice; never rolls back or clears.
5. Numbered markers persist across collapse/reload/routes and re-resolve
   against the live DOM (D-033 #8).
6. Unresolved targets retained as "unresolved" state, never dropped
   (D-033 #9).
7. Studio UI cannot annotate itself (D-034 #3): all annotation paths use
   `isStudioElement`; overlay outside the screenshot DOM clone.
8. v4 reader: `normalizeTask` maps v4 → v5 losslessly; print CLI and MCP
   serve v4 AND v5 without crashing; next save writes v5 (D-033 #17).
9. Acceptance concerns (D-034 #8): markers follow routes, re-clamp on
   scroll/resize, HMR no duplicates, a11y, security invariants hold.
10. Tests in the Tests section pass.

## Tests & browser evidence

- Unit: `task-model.test.ts` — v4 fixture → v5 normalized (instruction →
  single element-annotation comment; elements → captures; region →
  region rect), lossless round-trip; endpoint v5 sanitize (valid /
  oversized / invalid shapes rejected); print-cli v5 markdown + v4
  fallback; MCP print_task on v5 artifacts.
- Component: annotation list renders; continuous pick creates multiple
  annotations; Ctrl+Enter saves; capture-failure notice shown; Enter
  inserts newline.
- E2E: annotate 2 elements → reload → markers persist; route change →
  markers follow; unresolved target (navigate away) retained; v4 artifact
  printed after upgrade.
- Browser evidence: screenshots (markers numbered on page, list, unresolved
  state, after reload).

## Review checklist

- Grounding: v5 types/task-model/endpoint changes exist and are tested;
  v4 files still print via CLI/MCP.
- AC 1–10 evidenced (tests or live screenshots).
- No migration framework (grep: no migration dirs/scripts); no multi-task
  queue; MCP tools unchanged (5 tools).
- Redaction caps apply to `comment` (2000) and annotation fields; token
  never in artifacts.
- No unrelated changes; gates green (pipefail); dist grep 0.
- D-035: any borrowed design (Instruckt adaptation with MIT notice /
  Agentation UX reference) recorded in the D-log with provenance.

## Checkpoint rule

After reviewer + Auditor approval: one local English Conventional Commit,
e.g.
`feat(portal): persist per-comment annotations with schemaVersion 5 (G02)`
— no push, no amend; report hash + status.

## Gates

As G01 (unit 224+new, e2e 6/6+new, typecheck, eslint, build, dist grep 0,
diff-check, pipefail).

## Evidence & Done

Evidence under `/root/work/dogfood-crm/evidence-annotation-first-g02/`.
Done = AC 1–10 pass on the template dev page (real browser) + v4 file
still printable + full gates green + D-038 + checkpoint per the rule above.
