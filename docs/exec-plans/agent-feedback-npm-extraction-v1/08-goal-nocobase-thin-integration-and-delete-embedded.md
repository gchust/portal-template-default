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

- [x] 2026-08-13：从 package `94c5e83` 构建 packed tarball，并开始 Default Portal tarball cutover。
- [x] 2026-08-13：添加单文件 NocoBase Extension 和 focused strong/contextual/redaction test。
- [x] 2026-08-13：切换 Vite plugin、CLI aliases 和 `.agent-feedback` runtime，删除 embedded Studio、旧 scripts/tests/plans。
- [x] 2026-08-13：添加 focused real Portal G08 E2E，覆盖 toolbar、namespace context、Pick/Multi/Area/Copy/Complete、CLI sync 和 reload 后中英文 locale。
- [x] 2026-08-13：package `73c836a` 和 Portal `7697617` 通过 fresh committed-tree 复审，G08-001～G08-016 全部 PASS。

### Surprises & Discoveries

- Portal SDK 的 locale 切换回调会 reload 页面；现有 Extension `host.locale()` 足以在 fresh mount 后提供新 locale，无需扩大 package API。
- 首次独立审核仅 G08-013 FAIL：production bundle 仍含旧 `Portal Studio` locale；同时暴露了已删路径的 CI 门禁和旧 ignore 残留。删除这些无效副本后，最终 production scan 为 0 matches。
- committed Portal 在预发布阶段使用仓外 absolute tarball，GitHub runner 无法获取该文件；因此旧 Studio CI 不能保留，registry-safe CI 只能在 Goal 10 正式 registry cutover 后恢复。

### Decision Log

- tarball 保留在仓库外并以 absolute `file:` specifier 锁定；Goal 08 的 sibling-source removal proof 将用外部 template copy 重写为 copy-local relative tarball，不改 source repo。
- 保留已有 `studio:*` script 名作为兼容 CLI aliases，但全部直接调用 package binary；不保留旧 scripts 或 `tsx`。
- 对独立审核发现的 production/CI/ignore 残留只做删除，不增加兼容层或新门禁；不改写已有历史。

### Outcomes & Retrospective

Goal: G08
Result: PASS

实际交付：

- package `6e69a83` 使 CLI Complete 后的浏览器状态同步并隐藏 completed marker；`73c836a` 移除 package source/dist 中的 NocoBase/Portal Studio 字面硬编码。
- Portal `d7adcad` 切换到 packed package，增加 72 行单文件 NocoBase Extension 和宿主边界测试，并物理删除 embedded Studio、旧 scripts、通用测试和旧活跃计划。
- Portal `7c5c0b3`、`93b995b`、`6f4b498`、`7697617` 删除旧 locales、失效 CI 门禁、旧 ignore 和预发布 Studio workflow。`d3abe3d` 的中间 ignore 恢复已由后续提交删除，历史保持不变。
- 最终 package tarball：`/root/work/agent-feedback-g08-final-reaudit-20260813/artifacts/gchust-agent-feedback-0.1.0-alpha.0.tgz`，SHA-256 `06bbd8a85a4a2fa3ce346617e1d91f594e082540cdd6558bfa3c3af6cddd2276`。
- 首次审核报告：`/root/work/agent-feedback-g08-final-audit-20260813-6Qiawo/FINAL-AUDIT.md`（15 PASS / 1 FAIL）；最终 fresh 复审：`/root/work/agent-feedback-g08-final-reaudit-20260813/FINAL-AUDIT.md`（16 PASS / 0 FAIL）。

未交付：Goal 08 范围内无；Goal 09 和 Goal 10 未开始。

命令与证据：

- package `pnpm install --frozen-lockfile && pnpm build && pnpm test && pnpm pack --json` → PASS，21 files / 90 tests，39-file tarball。
- package `node dist/audit/index.mjs` 与 host-boundary scans → PASS，package `src`/`dist`/解包产物无 NocoBase 标识，唯一 `react-grab/primitives` importer。
- Portal `pnpm install --offline --frozen-lockfile && pnpm typecheck && pnpm test && pnpm test:sdk && pnpm build` → PASS，23 files / 58 tests，SDK 9 files / 30 tests。
- `NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1 pnpm test:e2e` → PASS，2/2 Chromium；覆盖真实 NocoBase Pick/Multi/Area/Copy/browser Complete/CLI Complete/locale reload。
- `pnpm exec agent-feedback list` 和 `pnpm exec agent-feedback print --markdown` → PASS。
- production marker scan 和 production preview → PASS，10 类 forbidden marker 均为 0，`rootCount=0`、`endpointScripts=0`。
- fresh isolation `pnpm install --offline --frozen-lockfile && pnpm build && pnpm test` → PASS，不含 sibling source/workspace link，23 files / 58 tests。

验收标准：

- G08-001 PASS — committed Portal 使用带 integrity 的 `.tgz` `file:` devDependency，不是 workspace/link。
- G08-002 PASS — committed archive 无 `src/studio`。
- G08-003 PASS — 旧 Studio scripts/通用测试已删除，只保留 focused host unit/E2E。
- G08-004 PASS — Portal 无直接 `react-grab` 或 `tsx` 依赖。
- G08-005 PASS — Vite 仅从 package import 并调用一次 `agentFeedback(...)`。
- G08-006 PASS — NocoBase integration 只有 1 个非测试文件 / 72 行。
- G08-007 PASS — NocoBase 数据只位于 `annotation.extensions["nocobase.portal"]`。
- G08-008 PASS — strong/contextual identity 和 NocoBase redaction 测试通过。
- G08-009 PASS — locale reload 后真实 toolbar 显示 `选取` / `Pick`。
- G08-010 PASS — 真实 Portal Pick/Multi/Area/Copy/Complete E2E 通过。
- G08-011 PASS — installed package CLI 可读取 Default Portal `.agent-feedback`。
- G08-012 PASS — CLI Complete 后浏览器 marker 在合同时限内隐藏。
- G08-013 PASS — production bundle 无 client/endpoints/root/legacy locale 标识。
- G08-014 PASS — 无 sibling source 的 fresh offline consumer 可 install/build/test。
- G08-015 PASS — 活跃文档只指向当前 package 使用方式，无旧 Studio 残留。
- G08-016 PASS — 72 行 NocoBase Extension 未复制通用 Bug fix。

Known issues within Goal 08: none. 下一可靠起点是 package `73c836a`、Portal `7697617` 以及上述 16/16 PASS 复审；下一步只读取并执行 Goal 09。

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
