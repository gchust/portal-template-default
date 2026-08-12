# Goal 08 — Cut the Default Portal over to a thin NocoBase extension and delete the embedded copy

## 单一完成状态

Default Portal 从 packed `@gchust/agent-feedback` tarball 使用完整功能；模板只保留薄 NocoBase Extension、一次 Vite 注册和少量集成测试，原 `src/studio/**`、Studio scripts、通用测试和旧计划已物理删除。

## 前置条件

Goals 01–07 全部 PASS。使用 Goal 09 前的 package tarball，不依赖 NPM registry。

## NocoBase Extension 必须提供

1. locale/translate：通过 `@nocobase/portal-sdk/i18n`。
2. target enricher：收集 `data-ai-page-element` 与 `data-nb-*`。
3. strong identity allowlist：仅稳定属性，例如：
   - `data-ai-page-element`；
   - `data-nb-resource`；
   - `data-nb-field`；
   - `data-nb-action`；
   - `data-nb-surface`。
4. 其他 `data-nb-*` 只作为 contextual/soft evidence。
5. extension namespace：`nocobase.portal`。
6. NocoBase-specific redactor；禁止复制 core redaction。
7. 可选产品标题 “Portal Studio”，但通用包公共名称仍是 Agent Feedback。

## Default Portal 最终改动

推荐：

```text
package.json
vite.config.ts
src/agent-feedback/nocobase-extension.ts
.gitignore
少量 tests/e2e
```

Vite 注册必须通过 browser extension module path：

```ts
agentFeedback({
  root: __dirname,
  clientExtensions: [nocobaseExtensionPath],
  allowRemote: env.NOCOBASE_PORTAL_STUDIO_ALLOW_REMOTE === "true",
});
```

可以暂时保留现有环境变量作为宿主配置名，也可改成通用名；若保留，必须只存在模板配置层，不能进入 package。

## 必须删除

- `src/studio/**`；
- `scripts/portal-studio-agent.mjs`；
- print/verify/mcp/audit 等 Studio scripts；
- package.json 的 react-grab 直接依赖；
- 只为内置 Studio 使用的 tsx 依赖；
- 通用 Studio unit/component/E2E 的复制；
- 活跃的旧 Portal Studio ExecPlans；
- 对已删除内部文件的 import/alias/docs。

NocoBase 集成测试不能复制 package tests；只验证宿主边界。

## 验收标准

- **G08-001** Default Portal 通过 tarball 而非 workspace link 使用 package。
- **G08-002** `src/studio` 不存在。
- **G08-003** 旧 Studio scripts 和通用测试不再存在。
- **G08-004** `package.json` 不直接依赖 react-grab。
- **G08-005** Vite config 仅注册 package plugin，无本地 Studio plugin import。
- **G08-006** NocoBase extension 最多 3 个非测试文件、目标不超过 300 行。
- **G08-007** NocoBase context 仅写 `annotation.extensions["nocobase.portal"]`。
- **G08-008** strong/contextual identity 分类测试通过。
- **G08-009** Portal locale 切换后工具栏文案更新。
- **G08-010** 真实 Portal Pick/Multi/Area/Copy/Complete E2E 通过。
- **G08-011** package CLI 操作 Default Portal `.agent-feedback` 成功。
- **G08-012** Agent complete 后浏览器同步状态。
- **G08-013** Default Portal production build 无 Agent Feedback client/endpoints。
- **G08-014** 删除 sibling package source 后，tarball-installed template 仍能 install/build/test。
- **G08-015** Default Portal 活跃文档只指向当前 package 使用方式。
- **G08-016** 通用 Bug 修复没有在 NocoBase extension 重复实现。

## 必须运行

```bash
# package
pnpm build
pnpm pack --json

# template using tarball
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm test:sdk
pnpm build
pnpm test:e2e
pnpm exec agent-feedback list
pnpm exec agent-feedback print --markdown

# boundary audits
! test -d src/studio
! find scripts -maxdepth 1 -name 'portal-studio-*' | grep .
rg -n "src/studio|portalStudioPlugin|react-grab/primitives|element-source|__reactFiber" . --glob '!docs/archive/**'
rg -n "@nocobase|data-nb-|data-ai-page-element|NOCOBASE_" ../agent-feedback/src ../agent-feedback/dist
```

最后一个 `rg` 在 package 中必须无结果。

## 浏览器证据

- NocoBase 页面横向工具栏；
- NocoBase business context JSON；
-中文和英文 locale；
- Agent complete 自动隐藏 completed；
- production 页面无 root。

## 阻塞停止条件

若模板必须保留通用实现副本才能工作，Goal BLOCKED。不得通过复制 package 内部模块到 NocoBase extension 解决。

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
