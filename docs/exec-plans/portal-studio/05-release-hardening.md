# ExecPlan 05 — Release Hardening

> Contract: `00-shared-contract.md`. Self-contained for Goal 05. Final Goal:
> **no new product features.** Do **not** start any further Goal; close the
> series by producing the release evidence for the shared final DoD.

## Summary

Turn the working capability of Goals 01–04 into a releasable, maintainable
state: security abuse testing, full Playwright E2E coverage, HMR re-injection
checks, production bundle-graph/artifact exclusion evidence, dependency and
upstream license/NOTICE review, usage documentation for Codex and Pi/JSON,
clean-workspace re-verification, and a release evidence pack.

**Depends on:** Goal 04 end-state (verifiable loop with and without MCP).
**Single end-state:** *The shared final DoD (contract §12) is fully evidenced;
Portal Studio is releasable and maintainable.*

## Scope

In scope (hardening only — zero new product behavior):
- Security abuse tests: path traversal attempts (absolute, `..`, encoded),
  token missing/wrong/brute-force throttling, oversized bodies, redaction
  leakage seeds (Authorization/Cookie/token/query/headers across artifacts,
  screenshots, diagnostics), no-body-by-default re-assertion, endpoint
  loopback binding check.
- Playwright E2E matrix: single/multi/region capture, screenshot commands,
  induced-error diagnostics, full verification loop, HMR re-injection
  (repeated dev-server reloads must not duplicate toolbar/overlays/state),
  print CLI integration.
- Production exclusion evidence: `pnpm build` output scanned for Studio
  markers (provider, toolbar, picker, diagnostics, MCP client, endpoint paths)
  in both chunk names and content; dev endpoint absent from prod preview
  (`pnpm start`); evidence committed to the Goal log.
- Dependencies & licenses: audit any added devDependencies (expected: none or
  minimal) for licenses; add/extend NOTICE if required; upstream reference
  review — confirm no copied code from nocobase v2 (grep-based provenance
  check against the borrowed-concept list); record in Decision Log.
- Usage docs: Codex guide and Pi/JSON guide (capture → print → edit → verify
  with and without MCP), security notes, troubleshooting; i18n final pass.
- Clean-workspace re-verification: from a clean checkout state (fresh
  `pnpm install` not required — verify tracked-state reproducibility:
  `git status` clean except intended files, `pnpm typecheck && pnpm test &&
  pnpm build && pnpm test:e2e` green in one pass).
- Release evidence pack: checklist mapping every final-DoD item to evidence
  (paths + command outputs), consolidated in the Goal log and README.

Out of scope:
- Any new Studio feature, MCP tool, capture source, or endpoint (product scope
  is closed; future ideas go to the Decision Log as "future", not implemented).

## Milestones

| # | Milestone | AC (observable) |
| --- | --- | --- |
| M1 | Abuse suite | All security tests green; every invariant from contract §2/§3 re-asserted with evidence |
| M2 | E2E matrix + HMR re-injection | Full matrix green incl. repeated reload/hot-update no-duplication checks |
| M3 | Bundle-graph & prod-exclusion evidence | `dist/` scan clean; `pnpm start` shows no endpoint; evidence logged |
| M4 | Dependencies/licenses/NOTICE + provenance | No unexpected deps; licenses reviewed; provenance grep shows no v2 code copied; NOTICE updated if needed |
| M5 | Docs (Codex + Pi/JSON) + clean re-verify + evidence pack | Docs committed and accurate against the real commands; clean-state one-pass verification green; DoD checklist with evidence complete |

## Acceptance criteria (Goal 05)

1. Every contract §12 DoD item maps to reproducible evidence in the Goal log
   (commands + outputs + file paths).
2. Abuse suite passes with zero invariant violations; secrets never in
   artifacts by default (re-asserted).
3. Production bundle and prod preview contain no Studio markers and no dev
   endpoint (grep + runtime check evidence).
4. Dependency set unchanged from Goals 01–04 (or minimal devDeps with reviewed
   licenses); NOTICE accurate; no upstream code copied.
5. Docs let a fresh agent (Codex and Pi) complete the loop from the README
   alone, with and without MCP.
6. Clean-workspace one-pass `typecheck + test + build + e2e` green;
   `git diff --check` clean; final `git status` shows only intended files.

## Risks & mitigations

- **Grep-evidence false confidence**: bundle check includes chunk-name AND
  content scans plus runtime endpoint probe; recorded raw outputs, not
  summaries.
- **E2E flakiness at matrix scale**: CI retries already configured
  (playwright.config.ts `retries: 2` under CI); workers sequential in CI.
- **License debt**: no new deps expected; if Goals 01–04 introduced any, the
  audit lists them with license + NOTICE entries.
- **Doc drift**: docs are written against executed commands (paste actual
  outputs), then re-verified in the clean pass.

## Verification commands

```bash
pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e   # one clean pass
grep -rE "PortalStudio|portal-studio|__portal-studio" dist/  # expect no matches
pnpm start & curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:<port>/__portal-studio/tasks  # expect 404/refused
git diff --check && git status --short
```

## Stop conditions

- End-state achieved → stop; request the **final independent review** and the
  checkpoint commit for the whole series. This is the last Goal: no successor.
- Any invariant violation found in the abuse suite that cannot be fixed within
  Goal 05's hardening scope → stop and report the blocker with evidence; never
  ship with a known invariant violation.

## Running log (maintain during execution)

- **Progress:** (milestone status + evidence paths)
- **Surprises & Discoveries:** (e.g. bundler inlining quirks, license findings)
- **Decisions:** (append to contract §13; mark product-scope closures)
- **Outcomes & Retrospective:** (series-level retrospective: what worked, what
  the five Goals changed vs the contract, final DoD checklist with evidence)

## Series close

After this Goal: final DoD checklist (contract §12) is the acceptance artifact;
the series is complete. Future feature requests are recorded in the contract
Decision Log as "future" and implemented only through a new contract revision
by the user.
