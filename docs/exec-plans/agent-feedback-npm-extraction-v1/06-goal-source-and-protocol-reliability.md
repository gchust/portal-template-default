# Goal 06 — Fix source-path integrity, revision, CLI/MCP contracts, and architecture audits

## 单一完成状态

任何持久化 source path 都能由 package Vite server 精确映射到 workspace 内唯一文件；不能唯一映射则明确 unresolved。不存在 basename 猜测，source revision、CLI/MCP 和永久 audit 与新 schema v1 完全一致。

## 必须修复

### Source path

- Browser 保留 upstream raw source 作为临时传输值，但不能自行伪装 workspace-relative。
- Server canonicalizer 支持：
  - relative POSIX；
  - Windows path；
  - file URL；
  - Vite `/@fs/`；
  - leading `/src/...`；
  - query/hash；
  - symlink/realpath；
  - root containment。
- 删除 basename recursive fallback。
- 无法精确确认时 source 为 null/unresolved。
- source revision 只使用 canonical exact path。

### Benchmarks

- duplicate basename fixture；
- 完整 path、line、column；
- 不只比较 basename；
- 同名组件、memo/forwardRef、Portal。

### CLI/MCP

- 所有命令描述新 schema v1；
- MCP 移除 task creation/capture tool；
- 只保留 list/read/diagnostics/screenshot/wait verification 等只读或验证工具；
- public scripts/bin 的进程级 smoke。

### Audit

新增 `agent-feedback audit` 或 package script，检查：

- React Grab primitives importer = 1；
- 默认 React Grab UI import = 0；
- direct element-source = 0；
- Fiber/private source engine = 0；
- transformed-code regex guess = 0；
- basename-only lookup = 0；
- PortalStudio/old schema compatibility = 0；
- NocoBase hardcoding = 0；
- built-in action bypass Registry = 0。

Audit 自身必须有故意注入违规模式的失败测试。

## 验收标准

- **G06-001** canonicalizer 单测覆盖所有声明路径格式。
- **G06-002** workspace 外路径、路径穿越和 symlink escape 被拒绝。
- **G06-003** duplicate basename Fixture 精确返回两个不同完整路径。
- **G06-004** 无 `basename` 搜索第一匹配逻辑。
- **G06-005** source line/column 与真实源文件断言通过。
- **G06-006** unresolved source 不被伪装成低质量路径。
- **G06-007** source revision 只监听正确文件。
- **G06-008** Agent 修改正确 source 后 verification 更新；修改同名错误文件不更新。
- **G06-009** MCP `tools/list` 无 capture_task 和旧 schema 文案。
- **G06-010** CLI 所有公开命令从 tarball 进程级通过。
- **G06-011** audit 在正常树 PASS。
- **G06-012** audit 注入每一种禁止模式时 FAIL。
- **G06-013** package README/CLI help 与真实命令一致。
- **G06-014** Default Portal 中不增加任何源路径补丁。

## 必须运行

```bash
pnpm test -- source-path revision cli mcp audit
pnpm test:e2e -- source-benchmark duplicate-basename
pnpm build
pnpm pack --json
pnpm exec agent-feedback audit
pnpm exec agent-feedback --help
pnpm exec agent-feedback mcp   # 由 smoke harness 完成 initialize/tools-list
```

需要附上 duplicate-basename E2E 断言的完整 expected/actual path 证据。

## 阻塞停止条件

若某类路径无法安全映射，必须返回 unresolved；禁止以 basename、模糊全仓搜索或旧引擎 fallback 绕过。

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
