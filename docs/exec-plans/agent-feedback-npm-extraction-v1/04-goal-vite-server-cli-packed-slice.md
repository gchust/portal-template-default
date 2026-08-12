# Goal 04 — Extract Vite server, file store, CLI, and prove a packed vertical slice

## 单一完成状态

从 package tarball 安装的空白 React/Vite 应用，只需在 `vite.config.ts` 注册 `agentFeedback()`，即可自动注入 Client Runtime，将任务原子保存到 `.agent-feedback`，并通过 `agent-feedback` CLI 读取/完成/复验；production build 完全不含开发工具。

## 必须交付

### Vite 子入口

- `agentFeedback(options)` factory；
- `apply: "serve"`；
- namespaced virtual client module；
- `transformIndexHtml` 自动 bootstrap；
- loopback/remote/token/origin 安全；
- endpoint、heartbeat、revision、evidence command；
- source path service 的接口（正确性完善留 Goal 06）；
- `clientExtensions` browser module paths。

### Node/server

- `.agent-feedback/session.json`；
- active task 与 atomic writer；
- screenshot/runtime evidence；
- expectedRevision mutation；
- serialized writes；
- clean shutdown。

### CLI

```text
agent-feedback list
agent-feedback complete <annotation-id> --verified --summary ...
agent-feedback reopen <annotation-id>
agent-feedback print [--json|--markdown]
agent-feedback verify
agent-feedback mcp
```

MCP 此阶段只允许 read/verify/list；不得实现旧式完整 task creation tool。

### Packed fixture

新增一个不使用 workspace link 的 fixture：

```text
fixtures/packed-react-vite/
```

每次测试先 `pnpm pack`，再安装生成的 `.tgz`。

## 非范围

- Toolbar 插件化；
- NocoBase adapter；
- source path 精确性收口；
- Screenshot/iframe 已知 Bug 收口。

## 验收标准

- **G04-001** `/vite` 子入口只在 Node/Vite 环境加载，browser root 不包含 Node built-ins。
- **G04-002** `agentFeedback()` 自动注入，不修改 fixture `main.tsx`。
- **G04-003** dev server 启动后 session/token 文件权限和生命周期正确。
- **G04-004** task save、mutation、revision 和 serialized writes 通过并发测试。
- **G04-005** public CLI 从 tarball 安装后所有 `--help` 成功。
- **G04-006** list/complete/reopen/print/verify 进程级 smoke 成功。
- **G04-007** MCP `initialize`、`tools/list` 和 read tool 成功；无旧 schema/capture_task 描述。
- **G04-008** packed fixture 完成浏览器标注 → 文件 → CLI complete → 浏览器同步。
- **G04-009** HMR 后不重复 mount、token 或 listener。
- **G04-010** remote 默认关闭，显式 opt-in 有警告和测试。
- **G04-011** production bundle graph 和 dist 文本不包含 client root、endpoint、token header 或 toolbar strings。
- **G04-012** tarball fixture 删除 package source/workspace link 后仍通过。
- **G04-013** package source 不含 NocoBase。
- **G04-014** Default Portal 尚未切换。

## 必须运行

```bash
pnpm typecheck
pnpm test -- vite endpoint store cli
pnpm build
pnpm pack --json
pnpm --dir fixtures/packed-react-vite install --frozen-lockfile
pnpm --dir fixtures/packed-react-vite test:e2e
pnpm --dir fixtures/packed-react-vite build
pnpm --dir fixtures/packed-react-vite exec agent-feedback --help
pnpm --dir fixtures/packed-react-vite exec agent-feedback list
pnpm --dir fixtures/packed-react-vite exec agent-feedback print --markdown
```

生产剔除必须有：

```bash
rg -n "agent-feedback-root|/__agent-feedback|x-agent-feedback-token|Pick element|Annotation list" fixtures/packed-react-vite/dist
```

无结果才通过。

## 阻塞停止条件

- 只有 workspace link 才能运行；
- Vite plugin 必须修改 host React entry；
- browser bundle 包含 Node built-ins；
- CLI 需要读取 package source 而非 dist。

## Living ExecPlan

### Progress

- [x] 2026-08-12 15:51 UTC — 确认两个仓库均为指定 clean baseline：package `5be82326cbb5c8b932e9ad1ea98c3806762fb373`，template `2ffb81edf710867c1f3edc48dee429f7ac066cd6`。
- [x] 2026-08-12 16:12 UTC — 完成 serve-only Vite plugin、namespaced virtual bootstrap、HTTP transport、file store、session/token、revision/heartbeat/evidence、CLI 与 read-only MCP；focused typecheck/test/build/package checks 首次通过。
- [x] 2026-08-12 16:21 UTC — packed tarball 在 `/tmp/agent-feedback-g04-packed` 空白 React/Vite consumer 完成首次 browser → file → CLI → browser 闭环和 production exclusion。
- [x] 2026-08-12 16:27 UTC — 最终 fresh package suite、packed install、Playwright/HMR、CLI、production/build graph、无 workspace link、无 NocoBase 扫描全部通过；证据在 `/tmp/agent-feedback-g04-evidence/`。
- [x] 2026-08-12 16:34 UTC — G04-001..G04-014 独立逐项复核为 PASS；package implementation 已提交为 `dce4c81585aa9350d205d58a26d5b2781f7f0d33`；Goal 05 未开始。

### Surprises & Discoveries

- 仓库没有受控的 `fixtures/packed-react-vite/`；由于 Goal 强制所有 generated consumers 留在仓库外，本 Goal 使用等价外部 fixture `/tmp/agent-feedback-g04-packed`，其中依赖只指向 `/tmp/gchust-agent-feedback-0.1.0-alpha.0.tgz`。
- Vite 对内联 `transformIndexHtml` module script 不重写 bare imports；bootstrap 必须使用 `/@id/` dev URL 才能加载 virtual module 和 package exports。真实 Chromium 首轮明确报错并由此定位根因。
- `tsdown` 的 browser 与 Node 入口必须分成两个 build config；否则 `/vite` 与 CLI 的 Node built-ins 会污染 browser-target build boundary。最终 browser exports 扫描无 Node built-ins，Node `/vite` 和 CLI 使用 `.mjs`。
- packed E2E 中 React fixture 的 source edit触发 Vite HMR invalidate + page reload；这仍验证了同一 dev process/token 下只有一个 mount，并保留了 HMR lifecycle 的实际 Vite 证据。

### Decision Log

- **D-04-01:** 不把 generated packed fixture 提交进 package repo；遵循本次 delivery protocol，在 `/tmp` 生成 blank consumer、lockfile、截图、trace 和日志。
- **D-04-02:** 复用既有 core schema/mutation/format 与 browser runtime；server store 只提供原子文件边界、跨进程 `O_EXCL` lock 和 revision conflict，不复制 task model。
- **D-04-03:** 增加内部 `@gchust/agent-feedback/vite/client` browser transport export，使 public `/vite` 入口保持 Node-only，同时 injected browser module 不包含 Node built-ins。
- **D-04-04:** MCP 仅发布 `list_annotations`、`print_task`、`verify_task` 三个只读 tool；没有 task creation、capture 或 mutation tool。
- **D-04-05:** source path service 本阶段只做 root-contained canonicalization interface；basename/source correctness 留给 Goal 06，不加入猜测或 fallback。

### Outcomes & Retrospective

- **实际交付：** `agentFeedback()` serve-only plugin、virtual bootstrap、`clientExtensions` browser import、loopback/token/Host-Origin-Referer guard、private session lifecycle、atomic/serialized file store、revision/heartbeat/PNG evidence endpoints、polling browser transport、完整 CLI、read-only MCP、browser revision sync，以及 Node/browser 分离 package output。
- **未交付：** toolbar pluginization、NocoBase adapter、source correctness/reliability、screenshot/iframe/browser reliability 均未开始；Goal 05 未开始。
- **fresh commands:** `pnpm typecheck` PASS；`pnpm test -- vite endpoint store cli` PASS（13 files / 41 tests）；`pnpm test` PASS（13 files / 41 tests）；`pnpm build` PASS；`pnpm check:package` PASS；`pnpm pack --json --pack-destination /tmp` PASS；external fixture `pnpm install --frozen-lockfile` PASS；`pnpm test:e2e` PASS（1 Chromium vertical test）；fixture `pnpm build` PASS；installed CLI help/list/print PASS。完整日志见 `/tmp/agent-feedback-g04-evidence/`。
- **G04-001 PASS** — browser exports + `vite/client` Node-builtins scan empty；Node-only `/vite` resolves from packed install。
- **G04-002 PASS** — fixture `src/main.tsx` 只渲染 React app；Playwright 看见自动注入的 `#agent-feedback-root`。
- **G04-003 PASS** — packed browser process 断言 `session.json` mode `0600`、64 hex token、reload token stable；store test 验证 only-own-token clean shutdown。
- **G04-003 follow-up evidence** — final packed process Ctrl-C probe confirmed `session.json` removal (`/tmp/agent-feedback-g04-evidence/shutdown-lifecycle.log`); package follow-up commit records the process-signal cleanup without rewriting the verified implementation commit.
- **G04-004 PASS** — concurrent store test 一次成功、一次 `revision_conflict`，最终 revision 1；CLI/browser packed loop 达 revision 3；atomic temp+rename 和跨进程 lock 共用同一 store boundary。
- **G04-005 PASS** — built/packed public binary global help 与六个 command `--help` process tests 全部成功。
- **G04-006 PASS** — process tests 和 packed fixture 实跑 list/complete/reopen/print/verify，completion/reopen 分别被 browser poll 同步。
- **G04-007 PASS** — stdio MCP initialize、tools/list、print_task 成功；仅三个 read tools，scan/negative call 证明无 `capture_task` 或旧 schema 描述。
- **G04-008 PASS** — `/tmp/agent-feedback-g04-evidence/vertical-loop.png` 与 `packed-e2e.log` 证明 browser annotation → active-task file → CLI complete/reopen → browser marker status。
- **G04-009 PASS** — packed Playwright 在 dependency optimize reload、fixture source HMR/reload 后均断言一个 root；session token 不变；runtime unit test 验证 poll disposer。
- **G04-010 PASS** — unit test覆盖 remote default reject、explicit opt-in accept + warning，且两者都要求 token 和 matching origin。
- **G04-011 PASS** — production build成功；`production-exclusion.txt` 对 client root、endpoint、token header、toolbar strings 扫描为空。
- **G04-012 PASS** — installed package 无 `src`，lock/modules 无 `link:`/`workspace:`，解析路径位于 fixture `.pnpm/...tgz...`；仍通过 E2E/build/CLI。
- **G04-013 PASS** — `nocobase-scan.txt` 为空。
- **G04-014 PASS** — template baseline 到当前仅本 Goal living plan 变更；`package.json`、`vite.config.ts`、`src/studio/**`、`scripts/portal-studio-*` diff 为空。
- **下一 Goal 的可靠起点：** package 的 file/transport/CLI vertical slice 已从 tarball 验证；Goal 05 可在其独立 launcher 下开始 public Extension Registry，不需要修改本 Goal server boundary。

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
