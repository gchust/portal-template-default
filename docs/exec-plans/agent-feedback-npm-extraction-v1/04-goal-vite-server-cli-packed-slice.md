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

- [ ] 在执行过程中逐项更新，不要等到最后。

### Surprises & Discoveries

- 记录实际仓库与计划不一致、上游 API 行为、测试环境差异。

### Decision Log

- 记录所有偏离推荐文件布局或实现路径的决定及理由。

### Outcomes & Retrospective

完成时写明：

- 实际交付；
- 未交付；
- 运行过的命令及结果；
- AC 逐项 PASS/FAIL/BLOCKED；
- 下一 Goal 的可靠起点。

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
