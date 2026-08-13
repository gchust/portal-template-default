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

- [x] 2026-08-13：确认 package HEAD `7f27b86155bedbc4adc6c397f4207df154bd87db` 与 Portal HEAD `22895e40cf2d296886d56e78f6c5e54ca54c4f17` 均为 clean 起点；已完整读取 AGENTS、冻结常量、共享合同、本 Goal 与 launcher。
- [x] 2026-08-13：完成 browser raw source -> Vite post-React sourcemap -> server canonicalization -> exact source revision -> CLI/MCP 的真实调用链修复；未修改 Portal production/runtime source。
- [x] 2026-08-13：`pnpm test -- source-path revision cli mcp audit` PASS（16 files / 74 tests），完整 `pnpm test` PASS（16 / 74），`pnpm typecheck`、`pnpm build`、`pnpm run audit`、`pnpm check:package` 均 PASS。
- [x] 2026-08-13：fresh external packed consumer `/tmp/agent-feedback-g06-final-rnbPMl/consumer` 以 React/ReactDOM `19.2.8` 安装相对 tarball，随后 frozen offline reinstall PASS；完整 packed fixture E2E 的 vertical、source benchmark、SIGTERM process smoke 全部 PASS。
- [x] 2026-08-13：packed binary `pnpm exec agent-feedback --help`、MCP initialize/tools-list smoke PASS；`pnpm pack --json` 得到 38-file tarball，仅含 `LICENSE`、`README.md`、`dist`、`package.json`，无 fixture/source/runtime-dir 泄漏。`dist/audit/index.mjs` 中旧词与 host 词仅是 audit 检测规则字面量，按 audit 实现 allowlist 处理，不是 production hardcoding。

### Surprises & Discoveries

- 起点 package 已有 schema v1 CLI/MCP 基线且 MCP 工具仅为 `list_annotations`、`print_task`、`verify_task`；但 source canonicalizer 仅执行 `path.resolve(root, input)` 的词法 containment，尚未验证存在性、realpath/symlink、Windows/file URL/Vite `/@fs/`/leading `/src`，也没有 source-file revision watch。
- Vite 6 会在 transform sourcemap chain recomposition 中把普通 absolute source 再相对化为 `Card.tsx`。最终修复在 post-order transform 中精确验证 local source 后，将 combined sourcemap 的 `sources` 原位替换为 canonical `file://` URL；真实 served-module test 证明 duplicate-a/b 保持两个不同完整 source。
- Packed fixture 的两个 Playwright spec 共享同一 active task 时并行执行会互相污染；fixture script 顺序运行 vertical 与 source benchmark，保持每项真实浏览器隔离且不改变产品行为。

### Decision Log

- 2026-08-13：所有通用修复、测试、audit 与 fixture 仅进入 standalone package；Portal 仓库只持续更新本 Goal Living ExecPlan，绝不修改 production/runtime source。
- 2026-08-13：只有 leading `/src/...` 作为 Vite root-relative special case；其他 POSIX absolute path 均按真实 absolute path 验证，绝不剥离 leading slash 后猜入 workspace。
- 2026-08-13：MCP `wait_verification` 以 workspace cwd 的 exact `sourceRevision` 为输入、轮询和结果；`AGENT_FEEDBACK_DIR` 只覆盖存储位置。
- 2026-08-13：architecture audit 读取 whole-file 内容并使用 multiline-safe forbidden patterns；每一种禁止架构以及 multiline transformed-code、basename、built-in bypass 均有注入失败测试。

### Outcomes & Retrospective

实际交付：standalone package 内完成 exact source canonicalization、post-React served sourcemap normalization、unresolved/null、exact source revisions、schema-v1 CLI/read-only MCP、permanent architecture audit，以及 duplicate basename/memo/forwardRef/ReactDOM Portal packed browser benchmark。未交付：无 Goal 06 内缺项；Goal 07–10 均未开始。

Fresh browser evidence（`/tmp/agent-feedback-g06-final-rnbPMl/evidence/packed-e2e.log`）：

```text
expected duplicate-a = src/duplicate-a/Card.tsx:1:33
actual   duplicate-a = src/duplicate-a/Card.tsx:1:33
expected duplicate-b = src/duplicate-b/Card.tsx:1:33
actual   duplicate-b = src/duplicate-b/Card.tsx:1:33
expected memo        = src/main.tsx:8:36;  actual = src/main.tsx:8:36
expected forwardRef  = src/main.tsx:9:70;  actual = src/main.tsx:9:70
expected Portal      = src/main.tsx:21:28; actual = src/main.tsx:21:28
baseline/after wrong sourceRevision = abc1cdf5ecb205a6c93cdb764d364abedf2e6840db9429080f280c462d52d077
after correct sourceRevision         = df192adc65e86f06c95f92b28a8006767615d768724d17942bb984c5ff6562cd
taskRevision remained 6; sourceFiles remained [src/duplicate-a/Card.tsx, src/main.tsx]
```

Acceptance classification：

- **G06-001 PASS** — canonicalizer tests cover relative POSIX, Windows, file URL, `/@fs/`, leading `/src`, query/hash, realpath and canonical POSIX output.
- **G06-002 PASS** — tests reject outside absolute paths, traversal, missing/directory input and symlink escape.
- **G06-003 PASS** — fresh packed browser persists distinct `src/duplicate-a/Card.tsx` and `src/duplicate-b/Card.tsx`.
- **G06-004 PASS** — permanent audit reports clean tree and injected basename lookup fails, including multiline form; no first-match lookup exists.
- **G06-005 PASS** — fixture-derived exact line/column expected/actual values above all match.
- **G06-006 PASS** — unresolved frame unit test persists primary source as null and removes unresolved stack entries; no basename fallback.
- **G06-007 PASS** — source service unit and `/revision` E2E prove only canonical selected files contribute to source revision.
- **G06-008 PASS** — wrong duplicate leaves task/source revision and sourceFiles unchanged; selected duplicate changes only sourceRevision, with hashes above; process MCP test proves the same wait contract.
- **G06-009 PASS** — packed MCP tools are exactly `list_annotations`, `print_task`, `verify_task`, `read_diagnostics`, `list_screenshots`, `wait_verification`; no capture/create/old-schema tool or text.
- **G06-010 PASS** — built CLI process tests cover every public command; packed consumer runs the real bin for vertical CLI flow, `--help`, audit and MCP process smoke.
- **G06-011 PASS** — `pnpm run audit` reports `[agent-feedback] architecture audit PASS`.
- **G06-012 PASS** — injected tests fail sole importer, React Grab UI, element-source, Fiber/private, transformed-code, basename, old schema, NocoBase and built-in bypass patterns, including multiline violations.
- **G06-013 PASS** — README command list equals packed `--help`; MCP exact-source wait signature is documented and process-verified.
- **G06-014 PASS** — Portal diff is this Living ExecPlan only; no Portal production/runtime source or NocoBase patch changed.

Reliable next start：package Goal 06 commit `4786e2fd64f40d4a66350a633cd25186b2ec7ae0` from baseline `7f27b86155bedbc4adc6c397f4207df154bd87db`; Portal plan-only commit follows baseline `22895e40cf2d296886d56e78f6c5e54ca54c4f17`. Goal 07 remains explicitly unstarted.

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
