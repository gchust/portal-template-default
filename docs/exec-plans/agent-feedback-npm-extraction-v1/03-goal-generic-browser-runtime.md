# Goal 03 — Extract the generic browser runtime and prove the annotation flow without NocoBase

## 单一完成状态

独立包的 React 浏览器运行时在 `playgrounds/react-vite` 中完成真实的 Pick/Multi/Area → Comment → Marker → Edit/Complete → Copy 闭环，完全不依赖 NocoBase；本阶段使用 package-owned in-memory transport，不要求文件持久化。

## 必须交付

1. 通用 Client Runtime：
   - mount/unmount；
   - Shadow DOM host；
   -横向可拖拽、折叠工具栏；
   - Pick/Multi/Area；
   - Marker、Composer、List、Help、Tooltip；
   - Open/Completed/Reopen/Delete；
   - Copy；
   - hotkeys；
   - diagnostics client；
   - React Grab inspection。
2. Environment-neutral interfaces：
   - `TaskTransport`；
   - `MemoryTaskTransport`（只通过 `./testing` 导出）；
   - HostIntegration；
   - TargetEnricher/Redactor/Exporter contracts；
   - Public snapshot/commands。
3. 默认 host behavior：
   - locale 从 `document.documentElement.lang`，fallback `en-US`；
   - route key 从 location；
   - generic identity 使用 id、stable aria/role 和 React Grab selector；
   - 不认识 NocoBase。
4. Browser runtime 的所有公共 React/Vite imports 使用 peer dependency。
5. 在 blank Playground 中加入真实可测试页面：普通按钮、SVG、map、memo、forwardRef、Popover/Portal、长滚动页面。

## 迁移原则

- 可以从模板移动代码，但必须重命名公共 PortalStudio 类型与 CSS/DOM 前缀。
- package source 不得 import Template 文件。
- 不允许通过复制 NocoBase i18n/redactor/context 让包编译。
- React Grab 的 import 只能位于一个内部 engine 文件。
- 不保留旧自研感知 fallback。
- 此阶段 Toolbar 可以暂时由 package 内 built-in array 驱动；正式 Registry 在 Goal 05。

## 验收标准

- **G03-001** `mountAgentFeedback()` 和 unmount API 可由 public root import。
- **G03-002** Playground 不安装 `@nocobase/*` 且能完整运行。
- **G03-003** Pick 只创建单目标 Annotation。
- **G03-004** Multi 创建一条多目标 Annotation。
- **G03-005** Area 使用 React Grab bounded sampling，禁止 `querySelectorAll("*")`。
- **G03-006** Marker 点击可编辑/complete/reopen/delete。
- **G03-007** Copy 默认只包含 open annotations，manual fallback 可用。
- **G03-008** Dock 拖动/折叠、快捷键、Tooltip/Help 可访问性测试通过。
- **G03-009** Studio host 在第一次 inspection 前带 ignore attribute。
- **G03-010** package runtime source 无 NocoBase 和 Portal Studio 硬编码。
- **G03-011** React Grab public primitives import count 精确为 1；默认 UI import 为 0；element-source direct import 为 0。
- **G03-012** HMR/unmount 后事件 listener、timer、observer 和 root 均清理。
- **G03-013** Playground Playwright 保存截图/trace 证明完整用户闭环。
- **G03-014** package build 与 tarball browser import 成功。
- **G03-015** Default Portal 仍未切换，不开始 server/CLI 抽离。

## 必须运行

```bash
pnpm typecheck
pnpm test -- client inspection components
pnpm --dir playgrounds/react-vite test:e2e
pnpm build
pnpm pack --json
rg -n "@nocobase|data-nb-|data-ai-page-element|NOCOBASE_|PortalStudio|portal-studio" src dist playgrounds/react-vite/src
rg -n "from ['\"]react-grab/primitives['\"]" src
rg -n "from ['\"]react-grab['\"]|element-source|__reactFiber\$|transformResult\.code" src
```

## 浏览器证据

至少保存：

- collapsed/expanded toolbar；
- Pick composer；
- Multi annotation；
- Area annotation；
- annotation list open/all；
- marker editor；
- Copy success/fallback；
- unmount 后页面无工具栏。

## 阻塞停止条件

若浏览器运行时只有导入 NocoBase 才能启动，或必须加载 React Grab 默认 UI，当前 Goal 必须 BLOCKED。

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
