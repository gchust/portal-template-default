# Portal Studio — Annotation-first redesign (executable series)

Repository-grounded executable plan for the Annotation-first redesign of
Portal Studio on `gchust/portal-template-default` branch
`feat-agent-feedback`.

## Baseline

- HEAD `2519dd6` (pre-series baseline). The Goal 00 docs (this directory,
  D-033..D-042 entries) are the CURRENT uncommitted diff; the Goal 00
  checkpoint commit lands after review (baseline for G01 = 2519dd6 +
  the Goal 00 docs checkpoint).
- Test baselines: unit 36 files / 224 tests (exit 0), e2e 6/6 (login + 5
  studio specs), typecheck/eslint 0, dist precise grep 0 matches.
- NocoBase origin/develop reconciled at `f0a480e9f0` (ff-only merge; user
  dirty states in the user's own stash, untouched).
- Design lineage: `../portal-studio/08-annotation-first.md` (plan with
  Revisions 1–4 = contract decisions D-033..D-036). This directory is the
  EXECUTABLE series; the 08 doc stays as the design record.

## Document map

| Doc | Goal | Title |
| --- | --- | --- |
| ~~`01-draggable-dock.md`~~ | G01 ✅ | Draggable dock, persisted position, compact icon toolbar, More menu — DONE (checkpoint d908e1f) |
| `00-annotation-first-design-and-shared-contract.md` | — | Design model, schema v5, invariants, test matrix, gates, DoD |
| `01-draggable-dock.md` | G01 | Draggable dock, persisted position, compact icon toolbar, More menu |
| `02-persistent-annotations.md` | G02 | schemaVersion 5 `annotations[]`, per-comment, numbered persistent markers |
| `03-multi-select-area-delete.md` | G03 | True multi-select, area annotation, per-marker edit/delete/hide |
| `04-copy-complete-shared-formatter.md` | G04 | Copy, explicit Complete, shared Markdown formatter |
| `05-hardening-cleanup.md` | G05 | Hardening & cleanup acceptance |

## Authoritative decisions (contract D-033..D-036)

- **D-033 product decision**: replace fixed emoji toggle + large idle panel
  + top-level single instruction with Annotation-first — draggable dock
  with persisted position; collapsed = compact icon toolbar; continuous
  single-element annotation; true multi-select; area annotation;
  per-annotation comments; numbered markers persisting across
  collapse/refresh/routes and following targets; unresolved targets
  retained; per-marker edit/delete; hide-without-delete; Copy first-class
  and non-clearing; explicit Complete = only normal clear path;
  schemaVersion 5 `annotations[]`; browser and CLI share one Markdown
  formatter; MCP non-crashing with no scope expansion; no large migration
  framework for unpublished v4 intermediates (simple normalize-on-read).
- **D-034 interaction**: Enter = newline, Ctrl/Cmd+Enter = save; capture
  failure never loses an annotation; Studio UI cannot annotate itself;
  deleting item N renumbers displayed markers (display = live order index,
  stable `annotationId`s); lucide-react icons, no emoji; global destructive
  actions under More (⋯); Clipboard fallback = manual copy; route/scroll/
  resize/HMR/a11y/security/production-exclusion are acceptance concerns.
- **D-035 licensing**: Instruckt (MIT) — selective adaptation allowed WITH
  attribution only when code is copied (MIT notice + copyright + provenance
  in D-log); Agentation (PolyForm Shield) — design reference only, its
  source MUST NOT be copied/adapted/line-for-line reimplemented.
- **D-036 out of scope**: hosted AI employees; browser source editing;
  backend data mutation; new MCP features; unrelated refactors.

## Compatibility reconciliation (D-042)

Reconciled against NocoBase origin/develop @ f0a480e9f0
(`packages/core/cli/src/lib/portal-source.ts` + AI portal integration;
evidence: /root/work/dogfood-crm/evidence-reconcile/05-plan-compat-impacts.md):

- **IMPACT 1 (HIGH, upstream gap)**: `nb portal push` packs `.portal-studio/`
  (session token + annotations + screenshots after G02) because the CLI's
  pack filter excludes only `.git/node_modules/dist/.DS_Store/._*`. No
  G01–G05 code change (nocobase read-only); G05 documents the risk and
  verifies the gap status; upstream filter addition recommended
  (`.portal-studio`, `test-results`).
- **IMPACT 2 (MEDIUM)**: `nb portal pull` wipes `.portal-studio/` (git-root
  pull runs `clean -fdx`; archive pulls replace the directory) — local
  annotations are dev-session-local and lost on pull; session regenerates
  on the next `pnpm dev`. G05 documents "restart dev after pull" in usage
  docs.
- **IMPACT 3–5 (NONE)**: #10315 push identity (we never push), AI portal
  record/X-Portal validation (D-028), env/build html handling — no plan
  impact.

## Goal 00 boundary

- **Goal 00 implements NO product code**: this directory is documentation
  only. The working tree must contain no changes under `src/`, `scripts/`,
  `tests/`, `e2e/`, `sdk/`, `registry/`, or any build/config file. Product
  code ships exclusively in G01–G05 (each independently executable,
  checkpointed, and reviewed).
- Deliverables: README + 00 contract + goal docs 01–05 + reconciliation
  records (D-042) + review + local checkpoint commit of the docs (no push).

## Execution rules (every goal)

- Gates with `set -o pipefail` and real exit codes: `pnpm test`, `pnpm
  typecheck`, `pnpm build`, `pnpm exec eslint` (zero warnings on touched
  files), `pnpm test:e2e` (6/6, plus new steps), `git diff --check`, dist
  precise grep 0 matches (exit 1).
- Each goal ships its own local English Conventional Commit checkpoint (no
  push, no amend); independent review + explicit Auditor `<approved/>`
  before completion claims (series pattern).
- i18n for all user-facing strings (en-US + zh-CN); a11y (keyboard, ARIA,
  focus containment); no `any`; no unrelated refactors (D-036); AGENTS.md
  rules apply (test boundary: logic/components in `tests/`, browser
  behavior in `e2e/`; deps as devDependencies; shadcn composition).
- Evidence per goal under `/root/work/dogfood-crm/evidence-annotation-first-<goal>/`
  with raw command outputs; Decision Log entries continue at D-037+.
