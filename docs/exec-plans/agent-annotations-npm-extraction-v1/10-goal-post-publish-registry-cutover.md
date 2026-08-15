# Goal 10 — Conditional post-publication cutover to the NPM registry

> 本 Goal 只有在人类已经发布 package 后执行。它不是 Goals 01–09 的完成条件。

## 单一完成状态

Default Portal 使用 NPM registry 中已发布的精确 `@gchust/agent-annotations` 版本；不依赖 sibling repo、workspace link、file path 或 tarball，并从独立 clean clone 通过完整验证。

## 前置硬门禁

```bash
npm view @gchust/agent-annotations@<version> version
```

必须精确返回目标版本。否则立即 BLOCKED，不允许修改模板 dependency 来引用不存在版本。

## 必须完成

1. 将 Default Portal dependency 从 tarball/file/link 改成已发布精确版本。
2. 更新 lockfile。
3. 删除本地 tarball、临时 install script 和 staging fixture 引用。
4. 在一个不包含 sibling package repo 的目录中 clean clone Default Portal。
5. install/typecheck/test/build/E2E。
6. 验证 production exclusion 和 NocoBase extension。
7. 完成 F-045–F-048。

## 验收标准

- **G10-001** npm view 返回目标版本。
- **G10-002** package.json/lockfile 不含 `file:`、`link:`、`workspace:` 或本地 tarball。
- **G10-003** sibling package 目录不存在时 install 成功。
- **G10-004** typecheck/test/build/E2E 成功。
- **G10-005** CLI 从 registry package 可执行。
- **G10-006** production exclusion 成功。
- **G10-007** F-045–F-048 全部 PASS。
- **G10-008** 最终 Default Portal Studio 集成 diff 符合薄集成预算。

## 必须运行

```bash
npm view @gchust/agent-annotations@<version> version
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm test:sdk
pnpm build
pnpm test:e2e
pnpm exec agent-annotations --help
pnpm exec agent-annotations list
rg -n "file:|link:|workspace:|\.tgz" package.json pnpm-lock.yaml
```

最后一个 `rg` 对该 dependency 必须无本地引用。

## 阻塞停止条件

package 未发布、registry 不可访问、版本与 tarball RC 不一致时立即停止。不得使用 `--no-frozen-lockfile`、手工 node_modules 或 sibling link 绕过。

## Living ExecPlan

### Progress

- [x] 2026-08-15: 读取项目常量、共享合同、Goal 10 与 F-045–F-048，确认本 Goal 只能在目标 npm 版本已存在后执行。
- [x] 2026-08-15: 执行 `npm view @gchust/agent-annotations@0.1.0-alpha.0 version --json`，registry 返回 `E404 Not Found`；按前置硬门禁立即停止。
- [x] 2026-08-15: 未修改 dependency/lockfile，未运行 registry consumer matrix，未发布 npm，也未用 GitHub、tarball、file/link/workspace 或手工 `node_modules` 绕过。

### Surprises & Discoveries

- GitHub 公开仓库与 npm registry 发布是两个独立状态；`https://github.com/gchust/agent-annotations` 可公开读取并不意味着 `@gchust/agent-annotations@0.1.0-alpha.0` 已存在于 npm。

### Decision Log

- 2026-08-15: 严格执行 hard gate。E404 后不切换 Portal dependency，也不运行 G10-002–G10-008/F-046–F-048，因为这样会把不存在的 registry 版本或替代来源误当成 Goal 10 完成证据。

### Outcomes & Retrospective

Goal: G10
Result: BLOCKED

Changed files by repository:

- agent-annotations: none。
- portal-template-default: 本 Goal living plan only；未修改 runtime、dependency 或 lockfile。

Commands run:

- `npm view @gchust/agent-annotations@0.1.0-alpha.0 version --json` → BLOCKED，npm registry 返回 `E404 Not Found`：`'@gchust/agent-annotations@0.1.0-alpha.0' is not in this registry.`

Acceptance criteria:

- G10-001 BLOCKED — npm view 未返回 `0.1.0-alpha.0`，而是 E404。
- G10-002 BLOCKED — 前置版本不存在；按合同未执行 dependency/lockfile registry cutover。
- G10-003 BLOCKED — 未获准在 sibling package 不存在时安装不存在的 registry 版本。
- G10-004 BLOCKED — hard gate 后未运行 registry consumer typecheck/test/build/E2E。
- G10-005 BLOCKED — registry package 不存在，无法验证其 CLI。
- G10-006 BLOCKED — registry consumer 不存在，无法验证 production exclusion。
- G10-007 BLOCKED — F-045–F-048 均未满足：F-045 为 E404，F-046–F-048 受其阻塞。
- G10-008 BLOCKED — 未执行 registry cutover，不能形成其最终薄集成 diff。

Final matrix:

- F-045 BLOCKED — `npm view` 返回 E404。
- F-046 BLOCKED — 未将 Portal dependency 指向不存在的 registry 版本。
- F-047 BLOCKED — 无可安装的 registry 版本，不能建立 Portal-only clean clone 证据。
- F-048 BLOCKED — 无 registry consumer，不能删除 tarball/sibling 后运行完整验证。

Known issues within this Goal:

- 唯一阻塞点是公开 npm registry 尚无精确版本 `@gchust/agent-annotations@0.1.0-alpha.0`。
- 最小解除条件：人工将 exact RC `/root/work/agent-annotations-base-fix-20260815-j5WYgd/gchust-agent-annotations-0.1.0-alpha.0.tgz`（SHA-256 `3f9c2b3c65477fbe97ea260d725bee37203003d4b50cd94655a11fdd9d17ed6e`）发布为 public npm 版本，并使上述 `npm view` 精确返回 `0.1.0-alpha.0`。

Not started:

- npm publish；registry dependency/lockfile cutover；G10-002–G10-008 执行矩阵；F-046–F-048。

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
