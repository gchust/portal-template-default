> **ARCHIVED — DO NOT IMPLEMENT — superseded by React Grab single-engine migration v1**
>
> This plan promoted the custom Fiber/module-graph perception adapter and v1–v5 schema
> compatibility. The migration contract (docs/exec-plans/portal-studio-react-grab-migration-v1/)
> is the only normative source; schema v6 and react-grab/primitives are the only supported
> engine. Kept for history only.

# 05 — Hardening & cleanup (independently executable)

Implements: D-034 #8; D-035 (licensing provenance); D-036 (scope);
contract §4, §5, §7, §8.

## Objective

Close the rough edges of G01–G04 and the existing baseline: theme edge
cases, a11y audit, redaction/diagnostics coverage for the new interactions,
i18n parity, zero lint warnings, licensing provenance verification (D-035),
documentation consolidation, and final security/production-exclusion
re-verification.

## Dependencies

- G01–G04 complete (full Annotation-first feature set exists and is
  checkpointed); baseline suites green.
- Reused: `detectHostTheme`, redaction modules, diagnostics ring buffer,
  abuse suites, usage docs.

## Exact file areas

- `src/studio/**` — audit-driven fixes only (theme, a11y, redaction,
  lint); util extraction where the react-refresh rule fires (pattern of
  `task-id.ts`/`errors.ts`).
- `src/locales/en-US.ts`, `src/locales/zh-CN.ts` — key parity completion.
- Tests: `tests/logic/portal-studio/theme-save.test.ts` (extend),
  `redact.test.ts`, `diagnostics.test.ts`, `abuse.test.ts` (new-surface
  cases), `tests/logic/portal-studio/i18n-parity.test.ts` (NEW),
  `e2e/portal-studio.spec.ts` (a11y/theme walkthrough steps).
- Docs: `docs/exec-plans/portal-studio/00-shared-contract.md` (D-037..
  D-041), `docs/exec-plans/portal-studio/security-notes.md`,
  `usage-codex.md`, `usage-pi-json.md`, `mcp-config.md`, series README +
  00 contract (implemented reality), goal docs marked done.
- Evidence/provenance: licensing records in the goal evidence dir.

## Non-goals

- NO new features (behavior-preserving changes only, except audit-discovered
  fixes — each recorded in the D-log); NO scope expansion (D-036: hosted AI
  employees, browser source editing, backend data mutation, new MCP
  features, unrelated refactors all remain out).

## Acceptance criteria (AC)

1. Theme: dock/panel/markers verified on light (white), dark, and no-vars
   hosts; contrast consistent with D-031 palette rules.
2. a11y audit: full keyboard walkthrough (dock drag, toggle, marker list,
   editors, More menu, confirms, Esc); ARIA (`aria-expanded`,
   `aria-pressed` on hide/complete toggles, live regions); focus
   containment while panel/menu open.
3. Redaction/diagnostics coverage for new interactions (drag errors,
   clipboard denial, marker render errors, confirm dialogs); redact +
   abuse suites green; v5 fields in the shape whitelist.
4. i18n parity: every new string in en-US AND zh-CN; parity check test
   (same key set); no hardcoded UI text.
5. Lint zero: eslint on `src/studio/**`, `scripts/**`, tests — zero errors
   AND zero warnings.
6. Portal-source compatibility docs (D-042): usage docs record that
   `nb portal push` packs `.portal-studio/` (upstream gap; re-verify the
   filter at this time) and that `nb portal pull` wipes local annotations
   (restart dev after pull).
7. Licensing provenance (D-035): Instruckt-adapted code (if any) carries
   MIT notice + copyright + D-log provenance; NO Agentation source in the
   repo — evidence of absence via
   `grep -riE "agentation|polyform" src/ scripts/ tests/ docs/` plus a
   license-header scan and a distinct-identifier audit; design notes
   recorded.
8. Docs consolidated (README, 00 contract, usage guides, security-notes,
   Decision Log D-037..D-041 complete; goal docs marked done) — including
   reconciling design-record drift in `../portal-studio/08-annotation-first.md`
   (its G02 `--schema v4` CLI passthrough and G04 status-shape "D-037"
   references vs the executable 02/04 docs, which reserve D-040).
9. Security & production exclusion re-verified: token/trusted-source/
   traversal/body-cap suites green; `pnpm build` + dist grep 0 (exit 1);
   prod preview POST probes 404 on all Studio endpoints.
10. Final gates green; baselines recorded.

## Tests & browser evidence

- Unit: theme-save extensions (new surfaces), redact/diagnostics new
  cases, i18n-parity test, abuse additions.
- E2E: a11y keyboard walkthrough steps; theme switch (light host) visual
  check; HMR no-duplicate re-run; prod preview 404 probes (script).
- Browser evidence: screenshots (light/dark/no-vars, keyboard focus
  states, More menu focus trap), prod probe outputs, grep evidence for
  licensing.

## Review checklist

- Grounding: fixes mapped to audit findings (each recorded); no new
  features.
- AC 1–9 evidenced; lint zero proven by raw eslint output; i18n parity
  test present; licensing grep outputs archived.
- Prod exclusion: dist grep 0 + POST probes 404; security suites green.
- No unrelated changes; working tree limited to this goal's files;
  gates green (pipefail).

## Checkpoint rule

After reviewer + Auditor approval: one local English Conventional Commit,
e.g.
`chore(portal): harden and clean up Annotation-first Studio (G05)`
— no push, no amend; report hash + status.

## Gates

As G01, plus: eslint across `src/studio scripts e2e tests` (zero
warnings), prod preview POST probe script, licensing grep evidence,
i18n parity test.

## Evidence & Done

Evidence under `/root/work/dogfood-crm/evidence-annotation-first-g05/`
(audit findings/fixes, i18n parity output, lint-zero log, licensing
provenance, prod-exclusion probes, full gate outputs). Done = AC 1–9 pass
+ all gates green + D-log complete + checkpoint per the rule above.
