# Goal 09 — Produce a clean-room, packed release candidate

## 单一完成状态

独立包 `0.1.0-alpha.0`（或项目常量中的 RC 版本）从 clean clone/install 完成 build、tests、API/CLI/browser/packed fixtures，并产出可人工发布的 tarball、release notes 和逐项最终验收报告；不执行真实 npm publish。

## 必须完成

### Package quality

- README：安装、Vite、extension、CLI、security、limitations；
- API reference；
- CHANGELOG；
- LICENSE；
- package metadata、repository、bugs、keywords；
- exports/types/bin；
- files whitelist；
- exact dependency/peer contracts；
- third-party notices（React Grab 等）。

### Clean-room matrix

至少：

- Node 20；
- Node 22；
- React 19；
- Vite 6；
- package source tests；
- plain Playground；
- Extension Demo；
- packed blank fixture；
- packed NocoBase fixture；
- production build exclusion。

可用 CI matrix 完成无法在单机同时运行的版本，但必须有本次 commit 的成功结果或本地容器证据。

### Tarball checks

- 安装后所有 exports 可导入；
- CLI shebang/permissions；
- `.d.ts` 无 internal path；
- 无 workspace protocol；
- 无 source/test/fixture 泄漏；
- 无 NocoBase；
- 无 React bundle duplication；
- tarball 大小记录并设合理防回归门禁。

### Final matrix

逐项执行 `FINAL-ACCEPTANCE-MATRIX.md` F-001–F-044。

## 验收标准

- **G09-001** clean clone 的 package `pnpm install --frozen-lockfile` 成功。
- **G09-002** typecheck/test/build/E2E 全通过。
- **G09-003** `pnpm pack --json` 产出唯一 tarball。
- **G09-004** tarball contents 与 files whitelist 一致。
- **G09-005** packed blank fixture 在删除 package repo 后通过。
- **G09-006** packed NocoBase fixture 在删除 package repo 后通过。
- **G09-007** public exports/CLI/types smoke 通过。
- **G09-008** package audit 全通过且 failure fixtures 有效。
- **G09-009** production exclusion 通过两个 host fixture。
- **G09-010** README 命令全部由测试或 docs-smoke 验证。
- **G09-011** F-001–F-044 全部 PASS，无 NOT RUN。
- **G09-012** `RELEASE-NOTES-0.1.0-alpha.0.md` 包含功能、限制、breaking reset、验证和发布命令。
- **G09-013** 未调用 npm publish，未写入用户凭据。
- **G09-014** 输出 tarball SHA-256、文件大小和路径。

## 必须运行

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm pack --json
pnpm exec agent-feedback audit

# packed blank fixture
pnpm install --frozen-lockfile
pnpm test:e2e
pnpm build

# packed NocoBase fixture/template
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

还要执行 package metadata/type checks，例如 publint、exports import smoke 和类型消费 Fixture。实际工具由 Goal 01 固定，不能临时跳过。

## 发布候选产物

```text
artifacts/
├── @gchust-agent-feedback-<version>.tgz
├── SHA256SUMS
├── PACK-CONTENTS.txt
├── FINAL-ACCEPTANCE-REPORT.md
└── RELEASE-NOTES-<version>.md
```

## 阻塞停止条件

任何 F-001–F-044 为 FAIL/BLOCKED/NOT RUN 时，不能声称 RC 完成。CI 服务不可用时必须用本地 Node/container 补齐；若确实无法补齐，报告 BLOCKED。

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
