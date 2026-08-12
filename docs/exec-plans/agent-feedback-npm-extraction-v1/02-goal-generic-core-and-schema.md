# Goal 02 — Move the host-neutral core into the standalone package

## 单一完成状态

独立包已经拥有全新 `agent-feedback.task.v1` 的纯核心实现与测试；这些模块不依赖 React DOM、Vite、Node 文件系统或 NocoBase，并可独立完成 task create/mutate/format/redact/validate。Default Portal 运行行为仍未切换。

## 范围

迁移或重写为通用命名的纯模块：

- task schema/types；
- task ID；
- annotation selectors；
- mutation 与 revision contract；
- shared formatter；
- generic redaction；
- selection pure model；
- placement/hotkey pure definitions（不含 DOM listener）；
- JSON limits 和 extension namespace validation。

推荐目录：

```text
agent-feedback/src/core/
agent-feedback/src/types/
agent-feedback/tests/core/
```

## 核心要求

1. 新 schema 从 v1 开始，不复制 PortalStudio v6 的名称。
2. 不实现旧 schema normalizer/migration。
3. Extension 数据只存在于 `annotation.extensions[extensionId]`。
4. Mutation 必须使用 `expectedRevision` 并返回 deterministic conflict。
5. Formatter 默认导出 open annotations，并支持 all/json。
6. Generic redactor 不 import NocoBase；支持 extension redactor pipeline 的纯合同。
7. 所有类型可从 `@gchust/agent-feedback/types` 导入。
8. 纯模块不得 import browser-only 或 Node-only 模块。
9. 当前模板代码暂时不需要改为使用这些模块；本 Goal 只建立可靠核心。

## 非范围

- Browser Toolbar；
- Vite plugin；
- 文件存储；
- CLI；
- NocoBase Extension；
- Plugin toolbar registry 实现；
- 已知 Screenshot/source bug。

## 验收标准

- **G02-001** schema ID/version 精确为项目常量。
- **G02-002** 全仓 package source 不出现 `PortalStudio`、`.portal-studio`、`/__portal-studio`。
- **G02-003** 不存在 v2+ 或旧 v1–v6 migration/normalizer。
- **G02-004** schema 接受完整合法任务并拒绝未知顶层字段、非 JSON extension 数据和超限数据。
- **G02-005** mutation add/update/complete/reopen/remove/removeCompleted/revision conflict 单测通过。
- **G02-006** formatter 的 Markdown golden test 覆盖单目标、多目标、region、open/all、extension context。
- **G02-007** redaction 覆盖 Authorization、Bearer/JWT、cookie、token、password、input value 和 URL secret。
- **G02-008** extension namespace 不能覆盖其他 extension，大小和 key 数量有明确上限。
- **G02-009** core build 输出无 React/Vite/Node imports。
- **G02-010** 公开 types 的 consumer compile test 通过。
- **G02-011** `pnpm pack` 后 consumer 可使用 schema/mutation/formatter 公共 API。
- **G02-012** Default Portal 行为未切换，Goal 03 未开始。

## 必须运行

```bash
pnpm typecheck
pnpm test -- core
pnpm build
pnpm pack --json
pnpm exec publint
pnpm exec attw --pack .
rg -n "PortalStudio|portal-studio|schemaVersion:\s*[2-9]|@nocobase|data-nb-|NOCOBASE_" src dist
```

`rg` 对 package source/dist 的禁止模式必须没有结果；测试 Fixture 中的字符串可通过明确 exclude 处理。

## 阻塞停止条件

如果某个“纯模块”必须访问 DOM、Vite server、NocoBase 或文件系统才能工作，停止并重新划分边界，不能在 core 中加入环境判断。

## Living ExecPlan

### Progress

- [x] 2026-08-12T12:00Z 完整读取 `AGENTS.md`、冻结项目常量、共享合同、Goal 02，以及 Goal 01 living plan；确认只执行 Goal 02。
- [x] 2026-08-12T12:02Z 验证两仓工作树 clean：`agent-feedback` `main` @ `eab212b7b516bb848a657194dc51a50cfe0dc512`，`portal-template-default` `feat-agent-feedback` @ `a1c75911c7208a7bff49e2a1a2dd886c466170a0`。
- [x] 2026-08-12T12:04Z 逐 commit 审查两仓完整 Goal 01 history；确认 package skeleton、发布边界 follow-up、baseline follow-up 与 Portal 独立复核记录均已落在当前 HEAD。
- [x] 2026-08-12T12:07Z 追踪 embedded `types/task-model/mutation/format/redact/selection/annotation-selectors/task-id/placement/hotkeys` 的全部 source/test callers；确认 formatter/mutation 被 browser、Vite、CLI/MCP 共用，而 selection/redaction/hotkey 的旧实现含 DOM 或 NocoBase/browser coupling。
- [x] 2026-08-12T12:08Z 在 standalone package 的 `src/core/`、`src/types/` 建立全新 v1 task create/validate/mutate/format/redact 与 plain-data selection/placement/hotkey contracts；未修改 Portal runtime。
- [x] 2026-08-12T12:09Z 首轮 `pnpm typecheck` PASS；首轮 `pnpm test -- core` 15/16，唯一 FAIL 为 generic text redactor 漏掉 `input_value=`，在同一通用 regex 根因修正后 6 files / 16 tests PASS。
- [x] 2026-08-12T12:14Z `pnpm build` PASS（18 dist files）；core/root/types build graph scan 无 React、Vite、Node built-in 或 NocoBase imports，禁止模式 scan 无结果。
- [x] 2026-08-12T12:15Z `pnpm exec publint` PASS；合同原样 `pnpm exec attw --pack .` 首次因 strict profile 将 frozen ESM-only package 的预期 Node10/CJS 不支持计为 FAIL，新增 repository-level `.attw.json` 固定 `esm-only` profile 后原命令 PASS（Node ESM/bundler 全绿）。
- [x] 2026-08-12T12:16Z fresh `pnpm pack --json` PASS：21 files，仅 dist、LICENSE、README、package.json；tarball `/tmp/agent-feedback-g02-final-pack.dPO0t2/agent-feedback.tgz`，SHA-256 `01dc7990c71054c968cad1cb6add449fdf5a1b0b8c4830418aca4271e2ad0194`。
- [x] 2026-08-12T12:16Z tarball-only type consumer `/tmp/agent-feedback-g02-final-types.4eruGy` 从 `/types` 导入完整 task/annotation/mutation/redactor/shortcut 类型并以 TypeScript 5.9.3 compile PASS。
- [x] 2026-08-12T12:17Z clean offline/frozen Fixture `/tmp/agent-feedback-g02-final-offline.xDI7li` 从 final tarball 安装并通过 `/types` compile 及 root schema/create/mutation/formatter runtime smoke。
- [x] 2026-08-12T12:18Z standalone implementation checkpoint `3ffd140b0b2870765503623816aa345a43853935`（`feat: add host-neutral feedback core`）。
- [x] 2026-08-12T12:22Z review 补充准确 public API README，checkpoint `d0969283a3aada8bad426d4de14830b435909f53`（`docs: describe public core API`）。
- [x] 2026-08-12T12:24Z final review 将 Authorization redaction 覆盖到任意 scheme（含 Basic），并将 test helper 从 `fixtures.ts` 改名避免 Goal 必须命令的 fixture exclusion 歧义；checkpoint `b6f3b6c126d8b4a475133f90a961eb8f63ad5d52`（`fix: harden generic authorization redaction`）。
- [x] 2026-08-12T12:27Z 补齐 task/annotation ID 和 extension namespace-count focused checks；checkpoint `bb6749deef3d8f2fb1b05348c8da72a97a3b04b4`（`test: cover core ids and namespace limits`）；final focused suite 6 files / 21 tests PASS。
- [x] 2026-08-12T12:28Z 针对 final package HEAD 重跑全部 required gates，并生成 final tarball `/tmp/agent-feedback-g02-final2-pack.eGCyxc/agent-feedback.tgz`（SHA-256 `6502b294a648a592c99bf472744fd26de5a0dea5e6452d7cf3865daf4615a03c`）及 clean offline/frozen consumer `/tmp/agent-feedback-g02-final2-offline.r53eQi`；全部 PASS。
- [x] 2026-08-12T12:31Z 写完 criterion-by-criterion outcomes；Portal Goal 02 evidence checkpoint `d1338acb6d9546a2bf21474478afd1f5a9a6feda`（`docs: record Agent Feedback Goal 02`）。
- [x] 2026-08-12T12:34Z final audit 将 extension byte-limit test 与 8 KiB string limit 解耦，checkpoint `1565ab5aaa89471340117bab928dcb4ed85fac84`（`test: isolate extension byte limit`）；重跑 required gates 和 clean tarball consumer 全部 PASS。

### Surprises & Discoveries

- 当前未发现 handoff 与实际 HEAD/cleanliness 不一致；继续记录实现与验证中的实际差异。
- embedded `selection.ts` 虽标注 pure，但状态持有 live `Element`、调用 `getBoundingClientRect()` 并依赖 `isStudioElement`；新 core 只保留泛型 plain-data selection 与 region geometry，DOM candidate collection 留给 Goal 03。
- embedded `redact.ts` 直接 import NocoBase error redactor；新 core 使用 package-owned generic credential patterns 和按 namespace 调用的纯 extension redactor contract。
- `pnpm test -- core` 的 Vitest 参数按 substring 过滤，准确运行新增 `tests/core/**`；首轮暴露并修正 `input_value=` pattern 漏项。
- `attw@0.18.5` 默认 strict profile 会检查 Node10 和 CommonJS resolution，与冻结的 ESM-only architecture 冲突；Goal 01 曾通过显式 `--profile esm-only`。为让 Goal 02 合同原样命令可重复，新增 `.attw.json` 固定同一 profile，不改变 package exports。
- 最终 pack 输出仍为 Goal 01 相同的 21-file public shape；core 被 bundle 到既有 root entry，没有新增非合同 subpath export。
- code review 未发现 Must Fix；review follow-up 修正 README 的过时 skeleton 描述，并将 Authorization 规则从 Bearer-only 泛化到任意 auth scheme。

### Decision Log

- 2026-08-12：先完成 embedded 实现及 caller trace，再决定复用范围；不因类型名相似而复制旧 PortalStudio schema 或 host/environment 分支。
- 2026-08-12：不新增 `/core` public export；公共 runtime API 由冻结 root entry 导出，`/types` 只导出类型。原因是共享合同只冻结四个 subpath，Goal 02 不需要扩大公共入口面。
- 2026-08-12：mutation 对已验证 task + typed request 执行，显式接收 `updatedAt`，避免 core 读取时钟；冲突固定返回 `expectedRevision`、`actualRevision` 和未修改的 current task。
- 2026-08-12：Extension Registry 实现仍留 Goal 05；Goal 02 仅交付 `AgentFeedbackExtensionRedactor` pure contract 与 `annotation.extensions[extensionId]` 的 bounded namespace setter/pipeline。
- 2026-08-12：使用 Web 标准 `TextEncoder` 计算 UTF-8 JSON byte limits，使用 `globalThis.crypto.randomUUID()` 生成 ID；不为 Node/browser 添加 fallback 或环境判断。

### Outcomes & Retrospective

#### 实际交付

- standalone package 新增全新 `agent-feedback.task.v1` schema/types、strict validator/create API、Web-standard UUID ID、annotation selectors、revision-aware pure mutation、Markdown/JSON formatter、generic + extension redactor pipeline，以及 plain-data selection/placement/hotkey definitions。
- Extension 数据只位于 `annotation.extensions[extensionId]`；单 namespace 16 KiB、64 keys、8 levels/100 array items，上限 20 namespaces；task 上限 256 KiB。
- root export 提供 runtime core API，`@gchust/agent-feedback/types` 提供全部 public types；无新增 subpath dependency 或 package dependency。

#### 未交付

- Goal 03–10 的 Browser Runtime、Vite server/store、完整 CLI、Extension Registry、source/protocol fixes、browser evidence、NocoBase adapter/cutover、release/publish 全部未开始。
- Default Portal production/runtime source 未修改；Goal 01 CLI `--help` sentinel 之外未实现 CLI。

#### 运行过的命令及结果

- `pnpm typecheck` → PASS，exit 0。
- `pnpm test -- core` → PASS：6 files / 21 tests，exit 0（首次 15/16 FAIL 的 `input_value=` 已在通用 redactor 根因修复）。
- `pnpm build` → PASS：tsdown 输出 18 files，root/types 纯 core build，exit 0。
- `pnpm pack --json --out /tmp/agent-feedback-g02-final3-pack.lQQkyq/agent-feedback.tgz` → PASS：21 files，仅 dist、LICENSE、README、package.json；SHA-256 `6502b294a648a592c99bf472744fd26de5a0dea5e6452d7cf3865daf4615a03c`。
- `pnpm exec publint` → PASS：`All good!`。
- `pnpm exec attw --pack .` → PASS：repository `.attw.json` 采用冻结 ESM-only profile；Node ESM/bundler 全绿。
- `rg -n "PortalStudio|portal-studio|schemaVersion:\\s*[2-9]|@nocobase|data-nb-|NOCOBASE_" src dist` → PASS：无结果。
- core build import scan（React/ReactDOM/Vite/Node built-ins/NocoBase）→ PASS：无结果。
- tarball-only `/types` consumer TypeScript compile → PASS：`/tmp/agent-feedback-g02-final3-consumer.VZTtSa`。
- clean second Fixture `pnpm install --frozen-lockfile --offline` + typecheck + runtime smoke → PASS：`/tmp/agent-feedback-g02-final3-offline.AWrLtf`，打印 `packed schema/mutation/formatter ok`。
- Portal production diff scan `git diff --name-only a1c7591 -- src scripts vite.config.ts package.json pnpm-lock.yaml` → PASS：无结果。

#### Acceptance criteria

- **G02-001 PASS** — constants 与测试精确断言 `agent-feedback.task.v1` / `1`。
- **G02-002 PASS** — package `src`/`dist` 禁止 Portal Studio 模式 scan 无结果。
- **G02-003 PASS** — validator 只接受 schemaVersion 1；0/2/6 rejection tested；无 migration/normalizer。
- **G02-004 PASS** — strict full-task validator 接受完整合法 fixture，并拒绝 unknown top-level、undefined/NaN/cyclic extension data、extension/task over-limit data。
- **G02-005 PASS** — add/update/complete/reopen/remove/removeCompleted 与 deterministic revision conflict focused tests PASS；失败 batch 不修改输入。
- **G02-006 PASS** — Markdown golden 覆盖 open default、all、single target、multi target、region、full-order numbering 与 extension context；JSON public formatter tested。
- **G02-007 PASS** — Authorization Bearer/Basic、Bearer、JWT、cookie、token、password、input value、URL api key redaction tests PASS。
- **G02-008 PASS** — namespace setter 保留其他 extension 且不 mutate input；16 KiB/64 keys/20 namespaces 明确并 tested。
- **G02-009 PASS** — final build graph/import scan 对 React、Vite、Node built-in、NocoBase 均无结果。
- **G02-010 PASS** — packed `/types` consumer compile 通过 task/annotation/mutation/redactor/shortcut 类型。
- **G02-011 PASS** — final tarball clean/offline consumer 通过 schema create/validate、revision mutation 和 formatter runtime smoke。
- **G02-012 PASS** — Portal production diff 为空，Goal 03 未开始。

#### 本地 checkpoint commits

- agent-feedback: `3ffd140b0b2870765503623816aa345a43853935`, `d0969283a3aada8bad426d4de14830b435909f53`, `b6f3b6c126d8b4a475133f90a961eb8f63ad5d52`, `bb6749deef3d8f2fb1b05348c8da72a97a3b04b4`, `1565ab5aaa89471340117bab928dcb4ed85fac84`。
- portal-template-default: `d1338acb6d9546a2bf21474478afd1f5a9a6feda`；本 SHA 记录 follow-up commit 见最终报告。

#### 下一 Goal 的可靠起点

Goal 03 可从 `@gchust/agent-feedback` root 的 host-neutral task core 和 `/types` contracts 开始，只在 browser layer 引入 DOM/React/React Grab；不得把 live `Element` 或 environment checks 回填 core，也不得提前实现 Goal 04 server/CLI 或 Goal 05 Registry。

## 最终报告格式

```text
Goal: GXX
Result: PASS | FAIL | BLOCKED

Changed files by repository:
- agent-feedback: ...
- portal-template-default: ...

Commands run:
- <command> → PASS/FAIL, concise output

Acceptance criteria:
- GXX-001 PASS — <evidence>
- ...

Known issues within this Goal:
- none / exact issue

Not started:
- list every later Goal explicitly not started
```

不得用“应该通过”代替执行证据。
