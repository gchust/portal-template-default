> **ARCHIVED — DO NOT IMPLEMENT — superseded by React Grab single-engine migration v1**
>
> This plan promoted the custom Fiber/module-graph perception adapter and v1–v5 schema
> compatibility. The migration contract (docs/exec-plans/portal-studio-react-grab-migration-v1/)
> is the only normative source; schema v6 and react-grab/primitives are the only supported
> engine. Kept for history only.

# Goal 06 — Real code-agent dogfood acceptance (log)

Series-final acceptance: an independent, non-Pi code agent used the NocoBase
skills against the REAL environment, built a CRM AI Portal, and the Portal
Studio feedback loop (annotate → read → edit → verify) was exercised with real
Chromium, real artifacts, and no fabricated evidence.

## Progress

- Phase A (read-only official-path verification): npm registry metadata
  (`@nocobase/plugin-multi-portal` exists, Proprietary), backend plugin
  inventory (175, no multi-portal), license status (no record), local runtimes
  (none) → dual condition (legally obtainable ∧ authorized) FAILS → Phase B
  (PHASE-A-CONCLUSION.md, evidence-phase-a/01-07).
- Phase B (authorized fallback): `nb portal create dogfood-crm-a808` source +
  127.0.0.1:23000 real API backend; deviation explicitly recorded
  (PHASE-B-DEVIATION.md); dev URL http://127.0.0.1:5180/x/dogfood-crm-a808/.
- Studio applied to the generated portal source from the product repo (real
  code); **D-025 defect found and fixed**: Studio bootstrap was base-broken
  (root-relative import 404 under /x/<portal>/); `buildStudioInitScript(base)`
  + 2 unit tests; verified live (host/mounted/capture).
- CRM built by independent codex agent #2 (AGENT-CRM-RUN.md, 160+ evidence
  files): dogfood_customers/contacts/deals with relations + 11 seed records,
  routes/pages (customers/deals/contacts, drawers), ACL role
  r_dogfood_crm_user (create/view/update), trusted-context AI (viz) wired with
  honest "LLM not configured" prerequisite state. Verified by Pi: real rows
  render, Studio present, zero page errors, LLM services list empty.
- Real Studio annotations (Pi + real Chromium driving the Studio UI):
  element task (Value cell; candidates incl. crm.tsx:245) + region task
  (marquee over the deals table; 50 elements, region rect) with issue
  instructions and pre-fix screenshots; real schema-v4 task JSON saved.
- MCP evidence: five tools against the dogfood portal; print_task returns the
  real artifact; read_diagnostics clean.
- Fix loop: independent codex agent #3 read the real task, edited ONLY
  `src/pages/crm.tsx` (Value column right-aligned + tabular-nums), HMR
  applied; live assertion + typecheck/build pass (AGENT-FIX-RUN.md).
- Post-fix verification (Pi): computed text-align right on header+cells,
  $120,000/$31,500/$42,000/$78,000 consistent, Studio screenshot command
  produced a fresh capturedAt, induced post-fix console.error read back
  redacted (count 1, secret absent), zero page errors.

## Surprises & Discoveries

1. The `nb portal create`-generated template (published 3.1.0) does NOT
   contain Portal Studio — the Studio product code had to be applied into the
   portal source for the dogfood loop to be possible at all (it is the product
   under test).
2. Studio was broken under a non-root Vite base (the DEFAULT portal
   deployment path): root-relative module import 404'd silently and the host
   never mounted; the published-template E2E could never catch it because the
   product repo's E2E runs with base `/`. The dogfood acceptance caught a real
   production-facing defect (D-025).
3. The generated portal's `.env.local` already pointed at the 23000 API
   (`NOCOBASE_API_URL=http://127.0.0.1:23000/api`) — `nb portal create` bakes
   the environment's API into the source.
4. The backend has no LLM service configured; the AI employee (viz) is real
   and enabled, so the trusted-context surface renders an honest prerequisite
   state instead of a fake AI answer — exactly the behavior the skills
   mandate.
5. The published template's own test suite has a pre-existing
   route-overlay-viewport failure (portal-sdk 2.1.0 harness) unrelated to the
   acceptance (D-027); the product repo's identical test passes under the
   workspace SDK.
6. The codex agents repeatedly refused to fabricate evidence on their own
   (rejected script-based evidence writing; retained failure outputs and
   failed attempts alongside successes).

## Decisions

- Contract Decision Log D-025 (base-aware Studio injection), D-026 (Phase B
  deviation), D-027 (pre-existing template test baseline).

## Outcomes & Retrospective (series + acceptance)

- The real dogfood loop is fully evidenced: independent agent + skills +
  real 23000 backend + real Chromium + real Studio UI + real task JSON/MCP +
  real source diff + HMR + post-fix diagnostics/screenshot. One real Studio
  defect was found and fixed (D-025) with gates green.
- Retro: dogfooding with a non-root base immediately surfaced a defect the
  product E2E could not see; the "real only, no fabrication" discipline held
  on all three agent runs and all Pi verifications.

## AC checklist (Goal 06)

| AC | Evidence |
| --- | --- |
| 1. 阶段 A 官方路径只读核查（双条件判定） | PHASE-A-CONCLUSION.md + evidence-phase-a/01-07（npm view、pm:list、license、docker、版本兼容）；零安装/启用命令 |
| 2. 阶段 B 授权拓扑回退 + 偏差记录 + 拓扑证明 | PHASE-B-DEVIATION.md（multiPortals 404、plugin 不可得、portalType 按模板来源）；dev URL 5180 + API 23000 + 生成源码路径 |
| 3. 独立 agent + skills（真实调用与读取证据） | 三次 codex exec（AGENT-RUN/CRM-RUN/FIX-RUN.md）：nocobase-portal-manage→ai-builder→data-modeling→acl-manage→ai-employee→ai-manager 路径与摘录；160+/40+ evidence 文件 |
| 4. 真实 CRM（collections/关联/数据/路由/权限/AI） | AGENT-CRM-RUN.md + Pi 实测：3 集合 11 记录、关系 readback、routes/crm.tsx、r_dogfood_crm_user ACL readback 141-143、viz trusted-context（LLM 未配置→诚实前置状态） |
| 5. 真实 Studio 标注（Chromium UI + 真实制品） | task-element.json / task-region.json（schema v4、crm.tsx:245 源码候选、region rect、截图引用）；pre-annotation/pre-fix 截图；禁止项零违反（全部真实 UI 流程） |
| 6. agent 修改 + HMR/reload 复验闭环 | AGENT-FIX-RUN.md（仅 crm.tsx diff）+ Pi 复验：computed right 对齐、金额一致、Studio 截图命令新 capturedAt、post-fix 诊断读回脱敏、零 pageerror |
| 7. 禁止项与隔离（无预制/无 /users 冒充/无共享破坏） | 全程证据自洽；main 未动；nocobase 仓库零改动（status 复核）；dogfood 数据仅 dogfood_ 命名空间 |
| 8. 缺陷修复（D-025）+ 门禁 | src/studio/vite.ts buildStudioInitScript + 2 新单测；ESLint 0/typecheck 0/test 207 207/build 0/dist grep 0/E2E 5/5（pipefail）；Decision Log D-025 |
| 9. 证据包 + 文档 + Auditor + checkpoint | 本 log + README + 合同 D-025..D-027；/root/work/dogfood-crm/ 全量证据；Auditor <approved/> 后自动 checkpoint（不 push） |

## Evidence index

- Agent runs: /root/work/dogfood-crm/AGENT-RUN.md, AGENT-CRM-RUN.md,
  AGENT-FIX-RUN.md + evidence-agent-crm/ + evidence-agent-fix/ + codex logs.
- Phase A/B: /root/work/dogfood-crm/PHASE-A-CONCLUSION.md,
  PHASE-B-DEVIATION.md, evidence-phase-a/, evidence-phase-b/
  (task-element.json, task-region.json, mcp-evidence.json, pre/post-fix
  screenshots, post-fix diagnostics/screenshot-ref).
- Product fixes: src/studio/vite.ts (D-025), tests/logic/portal-studio/
  plugin-body.test.ts (base tests), docs (this log + contract D-025..D-027).
