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

### Progress

- M1 Abuse suite: **DONE** — `tests/logic/portal-studio/abuse.test.ts` (15 tests
  green): 13 encoded/exotic traversal shapes rejected across
  `isSafeTaskFileName` / `atomicWriteScreenshot` / `resolveTaskFilePath` /
  `sanitizeTask`; token brute force (100 wrong → all rejected, real token
  still verifies; constant-time structure = sha256 + timingSafeEqual, no
  length leak); oversized bodies (task 413, diagnostics >64 KB rejected);
  redaction-leakage seeds (Authorization/Cookie/query token/api_key/password/
  bare token) absent from artifacts; secret-attribute stripping in the
  screenshot clone; no-body-by-default re-assertion; loopback binding
  (`isLoopbackAddress` exported + 7-address test); atomic writes 0600 with no
  temp leftovers.
- M2 E2E matrix + HMR re-injection: **DONE** — full matrix 5/5 (single/multi/
  region/screenshot/diagnostics/guards/full-loop/MCP smoke) + new
  "HMR re-injection" spec: exactly one host, idempotency flags, 3 reloads and
  a real hot update (table.tsx comment, restored) never duplicate the mount;
  toolbar still operable.
- M3 Bundle-graph & prod-exclusion evidence: **DONE** — raw outputs below.
- M4 Dependencies/licenses/NOTICE + provenance: see Decisions / this log.
- M5 Docs + clean re-verify + evidence pack: see below.

### Production-exclusion evidence (raw outputs, M3)

```
$ pnpm build        # exit 0, built in 22s
$ find dist -name "*.js" | grep -iE "studio|portal-studio"    # no studio-named chunks
$ grep -rlE "PortalStudio|portal-studio|__portal-studio|ps-toggle|mountPortalStudio|portal-studio-mcp|__PORTAL_STUDIO" dist/
# grep exit 1 (zero matches)
$ grep -c "portal-studio" dist/index.html                      # 0
$ grep -rlE "__portal-studio/(tasks|screenshots|heartbeat|screenshot|verify|bootstrap)" dist/
# no endpoint markers
# prod preview (pnpm start, vite preview on [::1]:4173):
$ curl -s -o /dev/null -w "%{http_code}" http://localhost:4173/__portal-studio/tasks -X POST -d '{}'   # 404
$ curl -s -o /dev/null -w "%{http_code}" http://localhost:4173/__portal-studio/heartbeat -X POST -d '{}' # 404
$ curl -s -o /dev/null -w "%{http_code}" http://localhost:4173/__portal-studio/verify -X POST -d '{}'    # 404
# GET returns 200 index.html — the SPA history fallback, not an endpoint
# (no middleware exists; every POST returns 404)
$ curl -s http://localhost:4173/ | grep -cE "__PORTAL_STUDIO|portal-studio|ps-toggle"   # 0
```

### Surprises & Discoveries

1. The prod preview binds to IPv6 loopback only (`[::1]:4173`); IPv4 probes
   refused. Loopback-only holds, but on the IPv6 address — recorded.
2. GET on an unknown path returns 200 (SPA history fallback) — only POSTs
   prove endpoint absence (404). The evidence records POSTs for every dev
   endpoint path.
3. Refine start (vite preview) serves `dist/` with no middleware — dev
   endpoints cannot exist there by construction.
4. The E2E HMR re-injection test needed the hot update to target a
   NON-studio file: editing a studio module would mutate the running app;
   table.tsx (already used by the verification-loop spec) is the stable
   choice, restored in `finally`.

### Decisions

- See contract Decision Log D-022 … D-024 (appended during Goal 05).

### Outcomes & Retrospective (series close)

- End-state reached: every contract §12 DoD item maps to reproducible evidence
  (see the checklist below); Portal Studio is releasable and maintainable.
- Series retrospective: five goals delivered a dev-only feedback loop
  (capture → artifact → edit → verify) with honest security boundaries. The
  recurring lessons: real-browser E2E catches what unit tests cannot (SVG
  spacing, region drop, HMR ack reference, Buffer-in-browser); gate commands
  must never mask exit codes (D-018); server-side authority (heartbeat
  receipt time, session-file ownership, revision bumps) is the pattern that
  keeps agent-facing claims honest.
- Final gate run (set -o pipefail, real exit codes): ESLint 0; typecheck 0;
  test 34 files / 205 of 205 exit 0; build 0; dist precise grep 0 (exit 1);
  e2e 6/6 exit 0 (login + 5 studio specs incl. HMR re-injection); git diff
  --check 0; package.json/pnpm-lock.yaml unchanged (zero deps across the
  whole series); nocobase untouched; i18n parity 35/35 studio keys.

### Series close

The final DoD checklist (below) is the acceptance artifact. Future feature
requests are recorded in the contract Decision Log as "future" and implemented
only through a new contract revision by the user.

### Final DoD evidence checklist (contract §12)

| §12 | Item | Evidence |
| --- | --- | --- |
| 1 | Real elements → complete printable artifacts, JSON-only | Goals 01–02 E2E + unit suites; print CLI v1–v4 tests |
| 2 | Agent loop verifiable (revision/diagnostics/heartbeat/screenshot) | Goal 03–04 E2E full-loop spec; verify CLI; mcp.test.ts |
| 3 | Optional MCP server, no credentials in frontend, JSON fallback | Goal 04 mcp.test.ts + E2E MCP smoke; mcp-config.md; D-021 |
| 4 | Production excludes Studio/diagnostics/MCP code + endpoints | M3 raw outputs above (chunk+content scan, POST 404 probes, html 0 markers) |
| 5 | Security invariants under abuse testing | abuse.test.ts (15 tests) + Goals 01–04 guard tests |
| 6 | Repo conventions (typecheck/lint/tests green, i18n, a11y, no `any`) | Final gate run (below); eslint/typecheck/test exit 0 |
| 7 | Clean-workspace re-verification + release evidence | Clean single-pass gates (below); this checklist; usage docs |
