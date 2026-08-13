# Goal 05 — Make the horizontal toolbar and host behavior genuinely extensible

## 单一完成状态

内置工具条动作和一个完全外部的 Demo Extension 均通过同一个公开 Extension Registry 注册；外部扩展可增加 toolbar action、快捷键、Panel、target enricher、exporter 和 redactor，而无需修改核心 Toolbar 源码。

## 必须实现

1. `defineClientExtension()` 与完整公共类型。
2. Registry：
   - extension lifecycle；
   - toolbar contributions；
   - panel contributions；
   - target enrichers；
   - exporters；
   - redactors；
   - locale messages；
   - host integration。
3. Built-in extension：注册 Pick/Multi/Area/Copy/Visibility/Help/List。
4. Public API：snapshot + command facade；不暴露 setter/reducer/live DOM。
5. Demo Extension：
   - “Copy JSON” toolbar action；
   - 一个 custom panel；
   - 一个独立快捷键；
   - 一个 target enricher；
   - 一个 exporter；
   - setup/dispose 可观测计数。
6. Vite `clientExtensions` module list 通过虚拟模块 import。
7. Tooltip、Help、aria-label、keyboard listener 从同一个 shortcut registry 生成。
8. Built-in 和 external contributions 使用同一排序和状态计算路径。

## 明确禁止

- 核心 Toolbar 中用 action ID switch 特判行为；
- 外部扩展直接 import internal files；
- 扩展获得 `setState`；
- extension data 写 Task 顶层；
- 冲突时后注册静默覆盖；
- HMR 重复注册。

## 验收标准

- **G05-001** public `/extension` 子入口仅暴露稳定类型和 define/register API。
- **G05-002** 所有 built-in action 可在 built-in extension 文件中找到，不在 Toolbar hardcode array/switch 中。
- **G05-003** Demo Extension 的按钮按 group/order 出现在正确位置。
- **G05-004** Demo shortcut 实际触发，Tooltip 和 Help 自动显示相同组合键。
- **G05-005** Demo Panel 打开、互斥、关闭和 focus management 正确。
- **G05-006** target enricher 数据写入自己的 extension namespace。
- **G05-007** exporter 出现在可用导出项并生成预期内容。
- **G05-008** redactor 在持久化前生效。
- **G05-009** duplicate extension ID、contribution ID、panel ID 和 shortcut 均 deterministic fail。
- **G05-010** invalid contribution 不会部分注册。
- **G05-011** setup disposer 在 unmount/HMR 执行一次；重新挂载无重复按钮/listener。
- **G05-012** Public API consumer compile test 不能访问内部 setter。
- **G05-013** built-in behavior parity E2E 全通过。
- **G05-014** packed fixture 从外部文件注册 Demo Extension，不依赖 package source path。
- **G05-015** package public API 文档有最小可运行例子。

## 必须运行

```bash
pnpm typecheck
pnpm test -- registry extension toolbar hotkeys panels
pnpm --dir playgrounds/extension-demo test:e2e
pnpm build
pnpm pack --json
pnpm --dir fixtures/packed-react-vite test:e2e
rg -n "switch\s*\([^)]*(action|contribution).*\)|case\s+['\"](pick|multi|area|copy|visibility|help|list)" src/client
rg -n "setMode|setTask|setAnnotations|setOpen|React\.Dispatch" dist/extension dist/types
```

## 浏览器证据

- 默认 built-in toolbar；
- Demo action；
- Demo shortcut Tooltip 与 Help；
- Demo Panel；
- HMR 前后按钮数量一致；
- extension data 出现在 task namespace。

## 阻塞停止条件

若 built-in 必须绕过公开 Registry 才能维持功能，当前 API 设计不成立，必须停下重构 API，不能保留双轨。

## Living ExecPlan

### Progress

- [x] 2026-08-13T01:55Z 从 clean package `dabbeb7a985525d337fbae52b8835bc578d9cd2d` 与 Portal `9f33ec57e8254006d357dcc76fad392ea2c73b23` 开始；完整读取 Portal `AGENTS.md`、冻结常量、共享合同、Goal 05 plan 与 checkpoint-B public runtime/registry/code/tests。
- [x] 2026-08-13T02:08Z 新增 `playgrounds/extension-demo`，Demo Extension 仅从公开 `/extension` 导入，交付 Copy JSON、custom panel、Ctrl+Alt+J、target enricher、JSON exporter、redactor 与 setup/dispose counters；同一 external consumer source/layout 扩展至 packed React/Vite fixture。
- [x] 2026-08-13T02:12Z 首轮浏览器验证准确暴露 panel focus 表达式返回值误用与 Demo redactor 数据层级误判；修正共享 runtime focus 根因和 external redactor 后，focused tests 14 files / 54 tests 与 demo E2E 通过。
- [x] 2026-08-13T02:16Z HMR acceptance 准确暴露 Vite virtual module 未 self-accept；最小修正为 virtual module `hot.accept()`，复用 checkpoint-B symbol-key cleanup，验证 setup=2/dispose=1、按钮=1，shortcut listener 每次只执行一次。
- [x] 2026-08-13T02:17Z final required gates PASS；fresh repo-external evidence root `/root/work/agent-feedback-g05c-evidence-cuQ4RC/` 包含日志、截图、trace、task/counters JSON、tarball、manifest、hash 与 packed consumer。

### Surprises & Discoveries

- checkpoint B 已交付完整 public runtime registry/lifecycle、built-in migration、Vite extension imports 与 focused unit tests；checkpoint C 无需新增 extension abstraction，只需 external consumers、browser evidence、README 与 concrete parity corrections。
- external exporter 存在时，原 runtime 会让无 exporter ID 的 built-in Copy 隐式选择排序第一项，破坏 built-in Markdown parity；`undefined` exporter ID 现在固定走 built-in formatter，第三方 exporter 仅在显式 ID 时执行。
- 原 panel focus fallback 使用 `target?.focus() ?? panel.focus()`；`HTMLElement.focus()` 返回 `undefined`，因此即使 target focus 成功仍继续 focus panel。改为显式 target/fallback 分支后 unit 与 real browser focus 均通过。
- packed fixture 在 repo-external copy 首轮因测试漏取 Playwright `context` FAIL；补齐 fixture 参数后通过。所有失败原始日志/trace 保留在同一 evidence root，最终有效证据明确使用 `demo-acceptance-pass*` 与 `packed-pass*`。

### Decision Log

- 2026-08-13：Demo playground 和 packed fixture 各保留一份真正 external consumer file；两者只 import public package exports。未把 Demo Extension 移入 package source/export，避免把示例变成内置实现或 source-path shortcut。
- 2026-08-13：复用 checkpoint-B registry/runtime，不新增 demo adapter、fixture framework或 dependency；README 仅记录最小 runnable extension + Vite registration。
- 2026-08-13：Vite virtual module 只增加 `import.meta.hot.accept()`，继续复用 checkpoint-B `Symbol.for("agent-feedback.mount")` cleanup；未扩展 public package types/API 或新增 window property。
- 2026-08-13：`playgrounds/extension-demo` 是 package-repo playground，允许 package link；发布边界的 `fixtures/packed-react-vite` 则只在 fresh repo-external copy 中使用相对 tarball并冻结安装。两者职责不混用。

### Outcomes & Retrospective

#### 实际交付

- `playgrounds/extension-demo` 的真正 external Demo Extension：Copy JSON toolbar action、独立 Ctrl+Alt+J、custom/exclusive/focus-safe panel、namespaced target enricher、explicit JSON exporter、pre-persistence redactor 与 setup/dispose/action counters。
- packed React/Vite fixture 从自身 `src/demo-extension.ts` 通过 Vite `clientExtensions` 注册同一 public-contract consumer；external copy 无 package source path、workspace/link resolution。
- built-in Copy 默认 formatter parity、panel focus fallback 与 virtual-module self-accepted HMR cleanup 的最小 runtime corrections；public README 最小 runnable extension example。

#### 未交付

- Goal 06–10 均未开始；未修改 Portal production/runtime source，未 push、publish、触碰 remotes 或改写 history。
- Goal 05 的独立 review 尚未执行；本 checkpoint C completion 仍需另一条独立审查线程按 G05-001–G05-015 重跑 fresh evidence 后才能作为 independently accepted Goal 05。

#### 运行过的命令及结果

- `pnpm typecheck` → PASS，exit 0；final log `/root/work/agent-feedback-g05c-evidence-cuQ4RC/final-typecheck.log`。
- `pnpm test -- registry extension toolbar hotkeys panels` → PASS，14 files / 54 tests；final log `final-focused-tests.log`。
- `AGENT_FEEDBACK_EVIDENCE=.../demo-acceptance-pass pnpm --dir playgrounds/extension-demo test:e2e` → PASS，1 Chromium test；toolbar/action/order、aria-label/Tooltip/Help/listener parity、panel exclusivity/close/focus、task namespace/redaction/exporter、setup/dispose 与 HMR no-duplicate checks all executed；screenshots/trace/task/counters under `demo-acceptance-pass/`。
- `pnpm build` → PASS，31 public build artifacts plus shared chunks; `build.log`。
- `pnpm check:package` → PASS，publint `All good!` and ATTW ESM-only Node ESM/bundler green；`package-check.log`。
- final `pnpm pack --json --pack-destination /root/work/agent-feedback-g05c-evidence-cuQ4RC/delivery-pack` → PASS，34-file public manifest, tarball `gchust-agent-feedback-0.1.0-alpha.0.tgz`, SHA-256 `d998dc1b6ac8205eaebfa9d6585a5c9a2db1de0de58b62a353913dcf4612f795`；`delivery-pack.json`, `delivery-pack.sha256`。
- final external packed consumer `pnpm install --lockfile-only --ignore-scripts` + `pnpm install --frozen-lockfile` → PASS；consumer `/root/work/agent-feedback-g05c-evidence-cuQ4RC/delivery-packed-consumer/` uses only `file:./gchust-agent-feedback.tgz`。
- final external packed consumer `AGENT_FEEDBACK_EVIDENCE=.../delivery-packed-pass pnpm test:e2e` → PASS，1 Chromium packed vertical flow + direct Vite SIGTERM cleanup；`delivery-packed-test.log` and `delivery-packed-pass/vertical-loop.png`。
- final external packed consumer `pnpm build` + `pnpm exec agent-feedback --help` → PASS；production build 26 modules and CLI help lists six commands；`delivery-packed-build.log`, `delivery-packed-cli-help.log`。
- source/declaration audits → PASS：required toolbar switch/case scan no matches; setter/`React.Dispatch` declaration scan no matches; external import scan proves `/extension`, `/vite`, and `clientExtensions` only.

#### Acceptance criteria

- **G05-001 PASS** — `/extension` stable define/register/types contract compile and final declaration scan pass; no setter/reducer/live DOM exposure.
- **G05-002 PASS** — all Pick/Multi/Area/Copy/Visibility/List/Help actions remain in `builtin-extension.ts`; required client switch/case scan has no matches.
- **G05-003 PASS** — browser exact action order is `pick,multi,area,copy,demo-copy-json,visibility,list,demo-panel-action,help,toggle`.
- **G05-004 PASS** — Copy JSON aria-label and Tooltip both `Ctrl+Alt+J`, Help contains the same value, and keyboard listener increments the action exactly once before/after HMR.
- **G05-005 PASS** — browser opens Demo panel over List with one `.af-panel`, focuses Close Demo, closes it, and returns focus to Demo toolbar action.
- **G05-006 PASS** — `task-extension.json` has only `annotation.extensions["demo.extension"]["target-context"]`.
- **G05-007 PASS** — public snapshot lists `demo-json`; explicit exporter copies parseable `{ format: "demo-json" }` content.
- **G05-008 PASS** — captured/persisted/exported data keeps `demoKind`/`kept` and contains no `redactMe`.
- **G05-009 PASS** — focused registry suite covers duplicate extension/contribution/panel/shortcut deterministic failures.
- **G05-010 PASS** — focused registry suite covers atomic invalid registration.
- **G05-011 PASS** — browser HMR evidence records setup=2/dispose=1/button=1 and single shortcut execution; checkpoint-B unit test retains idempotent unmount/dispose-once coverage.
- **G05-012 PASS** — compile-time public consumer and declaration audit cannot access internal setters/`React.Dispatch`.
- **G05-013 PASS** — built-in toolbar/order, Markdown Copy parity, List/Help panels, marker capture and packed browser-file-CLI-browser flow pass.
- **G05-014 PASS** — repo-external packed fixture imports/registers `src/demo-extension.ts` through public package exports and relative tarball only; no package source path/workspace link.
- **G05-015 PASS** — public README contains minimal runnable `defineClientExtension` plus Vite `clientExtensions` example.

#### 下一可靠起点

- 保持 Goal 06 未开始。先从 package checkpoint-C commit 和本 plan-only commit 启动独立 Goal 05 review，复核所有 G05 criteria、fresh tarball consumer 和 clean-tree/commit provenance；只有独立 review PASS 后才可授权 Goal 06。

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
