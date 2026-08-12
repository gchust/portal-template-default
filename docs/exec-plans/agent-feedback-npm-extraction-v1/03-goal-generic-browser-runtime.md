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

- [x] 2026-08-12: Confirmed clean accepted baselines: package
  `ad13f94f3042609cf014dd69029ffd1725c3ac5c`, template
  `c2729afdfc3e5ce94549fd3262551c4d267d6a07`.
- [x] 2026-08-12: Read the frozen constants, shared contract, this Goal, and
  traced the embedded Studio bootstrap, toolbar, task model, inspection
  engine/pipeline, region sampler, markers, composer, list, Help, Tooltip,
  diagnostics, dock, and hotkey implementations.
- [x] Implemented the generic browser runtime and package-owned in-memory
  transport.
- [x] Completed the blank React/Vite playground and focused tests.
- [x] Ran package, external-tarball, and real-browser acceptance gates.
- [x] Recorded final evidence and criterion results; focused repository
  commits are the final delivery step.

### Surprises & Discoveries

- The standalone repository is `/root/work/agent-feedback` rather than the
  constants file's parent-directory sketch `agent-feedback-workspace/agent-feedback`;
  its accepted Goal 02 HEAD and clean state are otherwise exact.
- Goal 02 already owns the generic v1 schema, mutation, format, redaction,
  selection, placement, and hotkey primitives, so Goal 03 can reuse those
  contracts instead of porting the embedded Studio's legacy schema/runtime.
- This shell's proxy environment did not exempt loopback, so Playwright's
  web-server probe returned 502 until both `NO_PROXY` and `no_proxy` were set
  to `localhost,127.0.0.1`; the checked-in Playwright config also passes them
  to its web server.
- A packed consumer is only valid after the tarball leaves the package repo:
  the final fixture used external artifact `agent-feedback-g03.tgz`, then a
  clean `--frozen-lockfile --offline` reinstall before build and E2E.

### Decision Log

- Keep all generic runtime implementation in the standalone package and make
  the template repository's Goal 03 living plan its only change; G03-015
  explicitly forbids switching the Default Portal.
- Reuse the embedded Studio only as behavioral reference. Build the new v1
  runtime directly on Goal 02 core contracts so no PortalStudio compatibility
  layer or NocoBase-specific context crosses the package boundary.
- Keep `MemoryTaskTransport` behind `./testing`, and keep Goal 03 entirely
  browser-side: no Vite file API, persistence, CLI/MCP extraction, Registry,
  NocoBase adapter, or later-goal reliability patch was added.
- Use React Grab's selector as persisted marker identity and only ordinary
  `document.querySelector` resolution in this Goal; cross-boundary marker
  reliability remains owned by Goal 07.

### Outcomes & Retrospective

- Delivered public async `mountAgentFeedback()`/idempotent unmount, Shadow DOM
  runtime, dock/toolbar, Pick/Multi/Area, composer, markers/editor/list/help,
  hotkeys/tooltips, open/completed/reopen/delete/copy flows, diagnostics,
  host/enricher/redactor/exporter contracts, and `MemoryTaskTransport`.
- Delivered a blank React/Vite playground with ordinary, SVG, mapped, memo,
  forwardRef, Portal, Shadow Root, canvas, and long-scroll fixtures plus real
  Playwright closed-loop acceptance.
- Fresh mandatory gates all PASS: `pnpm typecheck`; `pnpm test -- client
  inspection components` (10 files, 28 tests); playground E2E (3 tests);
  `pnpm build`; `pnpm pack --json`; all three source audits. `pnpm
  check:package` also passed.
- Packed boundary PASS: external tarball SHA-256
  `ebb9b04863db945412a6db3ff666a8b3d6f6a12a45b89828dabfea4f1165af54`;
  `/tmp/agent-feedback-g03-consumer.QLKpWB` reinstalled it with
  `--frozen-lockfile --offline`, then passed Vite build and all 3 E2E tests.
- Evidence root: `/root/work/agent-feedback-workspace-artifacts/g03/`; traces
  are under `playwright-results/`, browser screenshots are named by state, and
  mandatory command logs are under `commands/`.
- G03-001 PASS — public root exports mount and returned unmount/API.
- G03-002 PASS — playground has no `@nocobase/*`; source audit is empty.
- G03-003 PASS — Pick browser flow persists exactly one target.
- G03-004 PASS — Multi browser flow persists one annotation with two targets.
- G03-005 PASS — Area uses bounded React Grab point stacks; no `querySelectorAll("*")`.
- G03-006 PASS — real marker clicks exercise edit/complete/reopen/delete.
- G03-007 PASS — clipboard excludes completed annotations; manual fallback shown.
- G03-008 PASS — drag/collapse/hotkey/Tooltip/Help tests pass.
- G03-009 PASS — host ignore attribute exists before capture/inspection.
- G03-010 PASS — runtime vocabulary audit has zero matches.
- G03-011 PASS — exactly one primitives import; forbidden-engine audit empty.
- G03-012 PASS — idempotent unmount removes listeners/timers/root; remount passes.
- G03-013 PASS — required screenshots and Playwright traces saved externally.
- G03-014 PASS — build, pack, external frozen-offline consumer build/E2E pass.
- G03-015 PASS — Default Portal integration remains unchanged; only this plan
  changes in the template repository.
- Known issues within Goal 03: none.
- Not started: Goals 04, 05, 06, 07, 08, 09, and 10.

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
