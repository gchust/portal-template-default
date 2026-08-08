# Goal 07 — Alpha real regression acceptance (log)

Acceptance against the upgraded real environment: /root/work/nocobase HEAD
8cc448410b85, @nocobase/server 3.0.0-alpha.7 on 127.0.0.1:23000; dogfood CRM
portal dev at http://127.0.0.1:5180/x/dogfood-crm-a808/ (goal base).

## Progress

- t1 Reproduction & root cause (real Chromium): symptom A "The server is
  configured with a public base URL of /x/dogfood-crm-a808/" = Vite dev-server
  base behavior for paths outside the base (root → 302 → base; `/foo` → 404 +
  vite message; canonical entry 200; duplicate-base path 200) — access-method
  category, NOT Studio/Alpha. Symptom B (the functional regression): post-login
  `roles:check` carries `X-Portal: dogfood-crm-a808` → Alpha backend 404
  PORTAL_NOT_FOUND → "Unable to load permissions / Portal not found". Root
  cause category: **Alpha API compatibility** (3.0.0-alpha.7 validates X-Portal
  against the portal registry; probes: main/no-header → 200, x/… → 400).
  Evidence: evidence-alpha-repro/ (REPRO-CONCLUSION.md, repro-chain.json,
  repro-login-chain.json, roles-check-capture.json, login-failure-nav.json).
- t2 Minimal fix (dogfood config only): vite.config.ts dev proxy strips the
  x-portal header (dev-only Alpha compatibility shim, D-028); canonical base
  unchanged; verified roles:check 200 and CRM pages load after login
  (fix-verify-login.json). No Studio defect; portal-template-default untouched;
  nocobase untouched.
- t3 Alpha acceptance: app:getInfo = 3.0.0-alpha.7; CRM data was LOST in the
  upgrade (collection registry only roles/users) → re-created in the isolated
  dogfood_ namespace via `nb api data-modeling` with Alpha validation deltas
  (D-029; evidence-alpha-acceptance/01-07 incl. retained failures); relations
  read back; canonical base opens directly without duplicate redirects;
  customers/deals/contacts render real data in real Chromium; Studio host +
  mounted on all pages; zero page errors (08-browser-acceptance.json).
- t4 Real Studio annotation: element task (Expected close cell) + region task
  (deals table marquee, 50 elements) with instructions and pre-fix screenshots;
  real schema-v4 task JSON (task-element.json, task-region.json); MCP
  print_task returns the real active task (mcp-evidence.json).
- t5 Agent fix loop: independent codex agent read the real task, edited only
  src/pages/crm.tsx:191 (display-only Intl.DateTimeFormat en-US dateStyle
  medium, UTC), HMR applied; post-fix verified: all four Expected close cells
  friendly ("Jul 15, 2026", "Aug 31, 2026", "Oct 15, 2026", "Sep 30, 2026"),
  Studio screenshot command fresh capturedAt, induced diagnostic read back
  redacted, zero page errors (post-fix-verify.json, post-fix-deals.png;
  AGENT-FIX-ALPHA-RUN.md + evidence-alpha-fix/).
- t6 Targeted regression test (added post-audit): the Alpha root cause is the
  SDK base → portal-name mapping whose output feeds the X-Portal header
  (3.0.0-alpha.7 validates it; D-028) plus the canonical base normalization.
  tests/logic/portal-studio/alpha-regression.test.ts pins both contracts
  (5 tests: normalizePortalBase canonical/non-doubling; resolveNocoBasePortalName
  /x/dogfood-crm-a808/ → dogfood-crm-a808, /x/main/ → main, root/no-prefix →
  undefined = no header = Alpha-accepted path, SDK apps-segment contract).
  Full gate outputs archived raw with pipefail exit codes in
  evidence-alpha-gates/ (01 typecheck=0, 02 test=0 [35 files / 212 tests],
  03 build=0, 04 e2e=0 [6/6: login + 5 studio], 05 eslint=0, 06 dist grep=1
  [0 matches], 07 diff-check=0).

## Surprises & Discoveries

1. The backend was upgraded from 2.1.36 to 3.0.0-alpha.7 between goals, and the
   CRM collections were wiped (registry: only roles/users) — a real environment
   change, not a code defect; data was re-created in the isolated namespace.
2. The Alpha data-modeling surface is much stricter than 2.1.36: enum colors
   validated against a fixed palette, relation fields must be `belongsTo` with
   `reverseField.interface`, dates are `dateOnly`, and relation field names
   must differ from foreign keys (the Goal 06 schema used field-name ==
   foreignKey, which Alpha rejects).
3. The Alpha roles:check endpoint enforces the X-Portal header against the
   portal registry — the same "no environment Portal record" deviation that
   was harmless on 2.1.36 became a hard 404 on Alpha.
4. The reported "public base URL" symptom is Vite's standard base-redirect page
   for out-of-base paths; both the canonical entry and the duplicate-base path
   behave normally (302→base / 200). The functional blocker was the login/ACL
   path, not the entry path.
5. The dev-proxy header strip is a dogfood-side compatibility shim, not a
   Studio product change — portal-template-default required no source edits
   this goal (only documentation).

## Decisions

- Contract Decision Log D-028 (X-Portal shim), D-029 (Alpha data-modeling
  deltas + data recreation), D-030 (symptom root-cause classification).

## Outcomes & Retrospective

- The Alpha regression is reproduced, root-caused (access-method + Alpha API
  compatibility), minimally fixed (dogfood config), and the full acceptance
  loop re-verified end to end (annotate → read → agent fix → HMR → function +
  diagnostics + post screenshot) with real artifacts only.
- Retro: real-browser reproduction separated two distinct symptoms (vite base
  message vs roles:check 404) — the first is benign standard behavior, the
  second was the actual functional regression. The Alpha schema strictness
  surfaced through retained failure evidence, keeping the acceptance honest.

## AC checklist (Goal 07)

| AC | Evidence |
| --- | --- |
| 1. Real reproduction + root-cause classification | evidence-alpha-repro/* (entry/redirect chain/final URL/console/network; REPRO-CONCLUSION.md categories) |
| 2. Minimal fix (dogfood config; Studio-defect-only rule; nocobase untouched) | fix.diff (vite.config before/after); fix-verify-login.json; nocobase status = pre-existing only |
| 3. Alpha acceptance loop | evidence-alpha-acceptance/01-08 (app:getInfo, collections apply, seed + readback, browser acceptance with Studio mount); task-element/region.json; mcp-evidence.json; post-fix-verify.json + screenshots |
| 4. Targeted regression coverage + gates | NEW regression test tests/logic/portal-studio/alpha-regression.test.ts (5 tests) pins the X-Portal/base root cause (base → portal-name mapping + canonical base normalization); gates archived raw with pipefail exit codes: typecheck 0, unit 35 files/212 tests 0, build 0, full e2e 6/6 (login + 5 studio) 0, eslint 0, dist grep 0 matches, diff-check 0 (evidence-alpha-gates/) |
| 5. Evidence pack + docs | this log + contract D-028..D-030 + /root/work/dogfood-crm/evidence-alpha-{repro,acceptance,fix}/ |
| 6. Auditor <approved/> + auto checkpoint (no push) | auditor output; checkpoint commit hash; git status clean; nocobase read-only |
