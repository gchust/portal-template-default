# Goal 10 — Conditional post-publication cutover to the NPM registry

> 本 Goal 只有在人类已经发布 package 后执行。它不是 Goals 01–09 的完成条件。

## 单一完成状态

Default Portal 使用 NPM registry 中已发布的精确 `@gchust/agent-feedback` 版本；不依赖 sibling repo、workspace link、file path 或 tarball，并从独立 clean clone 通过完整验证。

## 前置硬门禁

```bash
npm view @gchust/agent-feedback@<version> version
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
npm view @gchust/agent-feedback@<version> version
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm test:sdk
pnpm build
pnpm test:e2e
pnpm exec agent-feedback --help
pnpm exec agent-feedback list
rg -n "file:|link:|workspace:|\.tgz" package.json pnpm-lock.yaml
```

最后一个 `rg` 对该 dependency 必须无本地引用。

## 阻塞停止条件

package 未发布、registry 不可访问、版本与 tarball RC 不一致时立即停止。不得使用 `--no-frozen-lockfile`、手工 node_modules 或 sibling link 绕过。

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
