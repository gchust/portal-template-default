# Goal 04 — Extract Vite server, file store, CLI, and prove a packed vertical slice

## 单一完成状态

从 package tarball 安装的空白 React/Vite 应用，只需在 `vite.config.ts` 注册 `agentAnnotations()`，即可自动注入 Client Runtime，将任务原子保存到 `.agent-annotations`，并通过 `agent-annotations` CLI 读取/完成/复验；production build 完全不含开发工具。

## 必须交付

### Vite 子入口

- `agentAnnotations(options)` factory；
- `apply: "serve"`；
- namespaced virtual client module；
- `transformIndexHtml` 自动 bootstrap；
- loopback/remote/token/origin 安全；
- endpoint、heartbeat、revision、evidence command；
- source path service 的接口（正确性完善留 Goal 06）；
- `clientExtensions` browser module paths。

### Node/server

- `.agent-annotations/session.json`；
- active task 与 atomic writer；
- screenshot/runtime evidence；
- expectedRevision mutation；
- serialized writes；
- clean shutdown。

### CLI

```text
agent-annotations list
agent-annotations complete <annotation-id> --verified --summary ...
agent-annotations reopen <annotation-id>
agent-annotations print [--json|--markdown]
agent-annotations verify
agent-annotations mcp
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
- **G04-002** `agentAnnotations()` 自动注入，不修改 fixture `main.tsx`。
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
pnpm --dir fixtures/packed-react-vite exec agent-annotations --help
pnpm --dir fixtures/packed-react-vite exec agent-annotations list
pnpm --dir fixtures/packed-react-vite exec agent-annotations print --markdown
```

生产剔除必须有：

```bash
rg -n "agent-annotations-root|/__agent-annotations|x-agent-annotations-token|Pick element|Annotation list" fixtures/packed-react-vite/dist
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
- [x] 2026-08-12 16:21 UTC — packed tarball 在 `/tmp/agent-annotations-g04-packed` 空白 React/Vite consumer 完成首次 browser → file → CLI → browser 闭环和 production exclusion。
- [x] 2026-08-12 16:27 UTC — 最终 fresh package suite、packed install、Playwright/HMR、CLI、production/build graph、无 workspace link、无 NocoBase 扫描全部通过；证据在 `/tmp/agent-annotations-g04-evidence/`。
- [x] 2026-08-12 16:34 UTC — G04-001..G04-014 独立逐项复核为 PASS；package implementation 已提交为 `dce4c81585aa9350d205d58a26d5b2781f7f0d33`；Goal 05 未开始。
- [x] 2026-08-12 16:52 UTC — 按“必须交付”补齐受控静态 fixture `fixtures/packed-react-vite/`，将完整 bootstrap 移入唯一 resolved virtual module，并以 `closeSync(token)` 覆盖 exit/SIGINT/SIGTERM；第三个 package commit 为 `731a96fb74579554ff037964d6fe5c7c754266af`。
- [x] 2026-08-12 16:55 UTC — 从受控 fixture 新鲜复制到 repo 外 `/root/work/agent-annotations-g04-consumer-sYIC1p`，只在副本中指向已提交 HEAD 的外部 tarball；frozen install、browser/CLI/HMR、真实 SIGTERM、trace、build 与边界扫描全部通过，证据在 `/root/work/agent-annotations-g04-evidence-w3lfBr/`。
- [x] 2026-08-12 17:10 UTC — 独立复核从 committed HEAD archive 删除既有 `dist` 后复现必须命令失败：`pnpm test -- vite endpoint store cli` 的 3 个 CLI process tests 找不到 `dist/cli/index.mjs`；以 `pretest: pnpm build` 做最小修复并单独提交 `013821ceee14308b2bd328efed8a4a54c2e8edfd`。
- [x] 2026-08-12 17:18 UTC — 独立复核按必须顺序复现 packed fixture 在 `test:e2e` 后无法执行 `agent-annotations list`：`shutdown.mjs` 删除整个 runtime root；改为仅删除 `session.json`，保留 active task，并单独提交 `a8b517917cf65d9b8ef80bd72d59c2fdf8dba226`。
- [x] 2026-08-12 17:22 UTC — 从 package HEAD `a8b517917cf65d9b8ef80bd72d59c2fdf8dba226` 的全新 archive 构建并打包，在 repo 外全新 consumer 按原始必须顺序全部通过；G04-001..G04-014 独立复核均为 PASS，最终证据在 `/root/work/agent-annotations-g04-independent-final2-IfEE2n/evidence/`，Goal 05–10 未开始。

### Surprises & Discoveries

- 受控的 `fixtures/packed-react-vite/` 是必须提交的静态 source/config/tests；lockfile、`node_modules`、`dist`、`.agent-annotations`、tarball、截图、trace 和日志仍只生成在 repo 外的新鲜副本与 evidence 目录。
- Vite 不重写 plugin-added inline module children 的 bare imports；完整 bootstrap 必须位于 resolved `virtual:agent-annotations/client` 中，HTML 只注入 `src="/@id/__x00__virtual:agent-annotations/client"` 的 module tag。packed Chromium 验证该根因修复。
- `tsdown` 的 browser 与 Node 入口必须分成两个 build config；否则 `/vite` 与 CLI 的 Node built-ins 会污染 browser-target build boundary。最终 browser exports 扫描无 Node built-ins，Node `/vite` 和 CLI 使用 `.mjs`。
- packed E2E 中 React fixture 的 source edit触发 Vite HMR invalidate + page reload；这仍验证了同一 dev process/token 下只有一个 mount，并保留了 HMR lifecycle 的实际 Vite 证据。
- clean committed-HEAD archive 不含 ignored `dist`；原 focused test 的 CLI process tests 隐式依赖先前 build 产物，因此旧的通过结果不能证明文档规定的命令顺序。失败日志：`/root/work/agent-annotations-g04-independent-14QnhW/evidence/package-focused-tests-external.log`。
- 原 `shutdown.mjs` 用于隔离 SIGTERM 检查的全目录删除同时删除了 vertical test 留下的 active task，破坏后续必须 CLI 命令；session 生命周期检查只需删除 `session.json`。失败日志：`/root/work/agent-annotations-g04-independent-final-EkMCyW/evidence/44-required-cli-list.log`。

### Decision Log

- **D-04-01:** 提交 `fixtures/packed-react-vite/` 的静态 source/config/tests；每次验证从该目录复制一个 repo 外 consumer，只在外部副本中将 package specifier 改成 repo 外 tarball 绝对路径，并仅在外部生成 lockfile、`node_modules`、`dist`、`.agent-annotations`、截图、trace 和日志。
- **D-04-02:** 复用既有 core schema/mutation/format 与 browser runtime；server store 只提供原子文件边界、跨进程 `O_EXCL` lock 和 revision conflict，不复制 task model。
- **D-04-03:** 增加内部 `@gchust/agent-annotations/vite/client` browser transport export，使 public `/vite` 入口保持 Node-only，同时 injected browser module 不包含 Node built-ins。
- **D-04-04:** MCP 仅发布 `list_annotations`、`print_task`、`verify_task` 三个只读 tool；没有 task creation、capture 或 mutation tool。
- **D-04-05:** source path service 本阶段只做 root-contained canonicalization interface；basename/source correctness 留给 Goal 06，不加入猜测或 fallback。
- **D-04-06:** resolved virtual module 是唯一 browser bootstrap module；`transformIndexHtml` 不含 inline children，只引用 Vite 的 encoded NUL `/@id/__x00__virtual:agent-annotations/client` URL。
- **D-04-07:** `FileTaskStore.closeSync(token)` 供 exit/SIGINT/SIGTERM 同步删除本 session；正常 HTTP server close 继续 `await` serialized writes 后异步清理。
- **D-04-08:** public CLI process tests 继续直接测试 built binary，但由标准 `pretest` lifecycle 先构建，确保文档规定的 `pnpm test -- vite endpoint store cli` 可从无 `dist` 的 committed HEAD 独立运行；不增加测试 launcher。
- **D-04-09:** packed shutdown check 仅预清理自己的 `session.json`，不删除 browser vertical slice 已生成的 task；真实 SIGTERM 仍必须删除 session，task 则供紧随其后的 public CLI smoke 使用。

### Outcomes & Retrospective

- **实际交付：** `agentAnnotations()` serve-only plugin、单一 resolved virtual bootstrap、受控 `fixtures/packed-react-vite/`、`clientExtensions` browser import、loopback/token/Host-Origin-Referer guard、private session lifecycle、atomic/serialized file store、revision/heartbeat/PNG evidence endpoints、polling browser transport、完整 CLI、read-only MCP、browser revision sync，以及 Node/browser 分离 package output。
- **未交付：** toolbar pluginization、NocoBase adapter、source correctness/reliability、screenshot/iframe/browser reliability 均未开始；Goal 05 未开始。
- **fresh correction commands:** package `pnpm typecheck` PASS；`pnpm test -- vite endpoint store cli` PASS（13 files / 41 tests）；`pnpm build` PASS；`pnpm check:package` PASS；committed HEAD `pnpm pack --json --pack-destination /root/work/agent-annotations-g04-evidence-w3lfBr` PASS；从 tracked fixture 复制到 repo 外后，在副本执行 `pnpm install --lockfile-only` 和 `pnpm install --frozen-lockfile` PASS；`pnpm test:e2e` PASS（1 Chromium vertical test + direct Vite SIGTERM）；trace-on Playwright PASS；fixture `pnpm build` PASS；installed CLI global/six command help、list、print PASS。Goal 文档中原始 direct fixture 命令按 delivery protocol 等价地只在 external copy 执行。完整 correction 证据见 `/root/work/agent-annotations-g04-evidence-w3lfBr/`。
- **G04-001 PASS** — browser exports + `vite/client` Node-builtins scan empty；Node-only `/vite` resolves from packed install。
- **G04-002 PASS** — tracked fixture `src/main.tsx` 只渲染 React app；virtual-module unit test断言完整 mount bootstrap 和无 inline children；fresh packed Playwright 看见自动注入的 `#agent-annotations-root`。
- **G04-003 PASS** — packed browser process断言 `session.json` mode `0600`、64 hex token、reload token stable；fresh external fixture 的 `tests/shutdown.mjs` 向 direct Vite PID 发送真实 SIGTERM，日志确认 `SIGTERM removed session.json`；store test 验证 only-own-token `closeSync`。
- **G04-004 PASS** — concurrent store test 一次成功、一次 `revision_conflict`，最终 revision 1；CLI/browser packed loop 达 revision 3；atomic temp+rename 和跨进程 lock 共用同一 store boundary。
- **G04-005 PASS** — built/packed public binary global help 与六个 command `--help` process tests 全部成功。
- **G04-006 PASS** — process tests 和 packed fixture 实跑 list/complete/reopen/print/verify，completion/reopen 分别被 browser poll 同步。
- **G04-007 PASS** — stdio MCP initialize、tools/list、print_task 成功；仅三个 read tools，scan/negative call 证明无 `capture_task` 或旧 schema 描述。
- **G04-008 PASS** — `/root/work/agent-annotations-g04-evidence-w3lfBr/vertical-loop.png`、`packed-e2e-with-evidence.log` 与 trace 证明 browser annotation → active-task file → CLI complete/reopen → browser marker status。
- **G04-009 PASS** — packed Playwright 在 dependency optimize reload、fixture source HMR/reload 后均断言一个 root；session token 不变；runtime unit test 验证 poll disposer。
- **G04-010 PASS** — unit test覆盖 remote default reject、explicit opt-in accept + warning，且两者都要求 token 和 matching origin。
- **G04-011 PASS** — fresh external production build成功；`production-exclusion.txt` 对 client root、endpoint、token header、toolbar strings 扫描为 0 bytes。
- **G04-012 PASS** — fresh consumer 是 tracked fixture 的 repo 外副本；installed package 无 `src`，lock/modules scan 无 `link:`/`workspace:`/`/root/work/agent-annotations/` package source path（外部 tarball path 保留为预期的 `file:` resolution），解析路径位于 consumer `.pnpm/...tgz...`；仍通过 E2E/build/CLI。
- **G04-013 PASS** — installed tarball `nocobase-installed-scan.txt` 为 0 bytes。
- **G04-014 PASS** — template baseline 到当前仅本 Goal living plan 变更；`package.json`、`vite.config.ts`、`src/studio/**`、`scripts/portal-studio-*` diff 为空。
- **下一 Goal 的可靠起点：** package 的 file/transport/CLI vertical slice 已从 tarball 验证；Goal 05 可在其独立 launcher 下开始 public Extension Registry，不需要修改本 Goal server boundary。

### 2026-08-12 Independent Review Checkpoint

- **package reviewed range:** `5be82326cbb5c8b932e9ad1ea98c3806762fb373..a8b517917cf65d9b8ef80bd72d59c2fdf8dba226`（完整 24-file Goal 04 diff）。
- **fresh package archive:** `/root/work/agent-annotations-g04-independent-final2-IfEE2n/package-head/`。
- **fresh external consumer:** `/root/work/agent-annotations-g04-independent-final2-IfEE2n/consumer/`，从 tracked `fixtures/packed-react-vite/` 复制，只改外部副本的 tarball placeholder。
- **fresh evidence:** `/root/work/agent-annotations-g04-independent-final2-IfEE2n/evidence/`。
- **tarball:** `/root/work/agent-annotations-g04-independent-final2-IfEE2n/evidence/gchust-agent-annotations-0.1.0-alpha.0.tgz`；SHA256 `08dfe027878ac904dd28865746bd943fdaeb8228f226ed17ff2058bea0afc01e`。
- **package commands:** `pnpm typecheck` PASS；`pnpm test -- vite endpoint store cli` PASS（13 files / 41 tests，从无 `dist` archive 自动 build）；`pnpm build` PASS；`pnpm check:package` PASS；`pnpm pack --json` PASS。
- **exact packed order:** external copy `pnpm install --lockfile-only` PASS；`pnpm install --frozen-lockfile` PASS；`pnpm test:e2e` PASS（1 real Chromium vertical loop + real Vite SIGTERM cleanup）；`pnpm build` PASS；global/six command help PASS；`agent-annotations list` PASS；`print --markdown` PASS；`verify` PASS。CLI complete/reopen 与 browser status synchronization、MCP initialize/tools/list/read、remote/token/origin、concurrent revision writes 均由该 E2E 或 fresh focused process/unit suite PASS 覆盖。
- **G04-001 PASS** — packed browser exports Node built-in scan `21-browser-node-builtins.txt` 为 0 bytes；Node `/vite` 由 installed tarball 成功加载。
- **G04-002 PASS** — tracked/external `main.tsx` 未注册 Agent Annotations；Chromium 看到自动注入的单一 `#agent-annotations-root`。
- **G04-003 PASS** — Chromium 断言 private `0600` session、64-hex token 和 reload token 稳定；`shutdown.mjs` 对 direct Vite PID 发真实 SIGTERM 后 session 消失，active task 仍为 `0600`；shared signal registration 包含 SIGINT/SIGTERM。
- **G04-004 PASS** — fresh focused suite 的 concurrent store test 证明 serialized write 中一次成功、一次 `revision_conflict`、最终 revision 1；packed loop 最终 revision 3。
- **G04-005 PASS** — installed tarball 的 global help 与 list/complete/reopen/print/verify/mcp 六个 command help 全部退出 0，见 `14-required-help.log`、`15-all-command-help.log`。
- **G04-006 PASS** — fresh process suite实跑 list/complete/reopen/print/verify；packed Chromium 内 complete/reopen 后 browser 状态同步，shutdown 后 required list/print/verify 仍成功。
- **G04-007 PASS** — fresh process suite实跑 MCP initialize、tools/list、print_task；仅发布 `list_annotations`、`print_task`、`verify_task`，并拒绝 `capture_task`，无旧 schema 描述。
- **G04-008 PASS** — `12-required-test-e2e.log` 与 `vertical-loop.png` 证明 real Chromium browser annotation → file → CLI complete/reopen → browser status 闭环。
- **G04-009 PASS** — real Vite dependency reload 与 source HMR/reload 后仍只有一个 root且 token 不变；runtime test证明 poll disposer。
- **G04-010 PASS** — fresh focused suite覆盖 remote default reject、explicit opt-in warning/accept，以及 token 与 matching origin 要求。
- **G04-011 PASS** — external production build PASS；`20-production-exclusion.txt` 对 root/endpoint/token/toolbar strings 扫描为 0 bytes。
- **G04-012 PASS** — external consumer lock/modules 无 `workspace:`、`link:` 或 package source path，installed package 无 `src`；解析路径为 consumer `.pnpm/...tgz...`，E2E/build/CLI 均通过。
- **G04-013 PASS** — installed tarball 的 NocoBase/forbidden host string scan `22-installed-forbidden-host-strings.txt` 为 0 bytes。
- **G04-014 PASS** — template 从 Goal 04 baseline 到 review HEAD 对 `package.json`、`vite.config.ts`、`src/studio/**`、`scripts/portal-studio-*` diff 为空；Default Portal 未切换。
- **Known issues within Goal 04:** none after commits `013821ceee14308b2bd328efed8a4a54c2e8edfd` and `a8b517917cf65d9b8ef80bd72d59c2fdf8dba226`。
- **Not started:** Goals 05, 06, 07, 08, 09, and 10。

## 最终报告格式

```text
Goal: GXX
Result: PASS | FAIL | BLOCKED

Changed files by repository:
- agent-annotations: ...
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
