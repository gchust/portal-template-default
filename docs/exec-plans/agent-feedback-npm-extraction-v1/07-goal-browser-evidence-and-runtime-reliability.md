# Goal 07 — Fix screenshot, cross-realm marker recovery, freeze, region, and observer reliability

## 单一完成状态

独立包在真实浏览器中可靠处理滚动页面、媒体、same-origin iframe、open Shadow Root、动画和动态 DOM；Screenshot/Marker/Freeze/Region 不再具有已知结构性错误，且所有修复留在通用包。

## 必须修复

### Screenshot

- computed style 使用合法 CSS kebab-case；
- source/clone 映射不因媒体删除错位；
- 媒体至少保留几何占位，不能破坏后续节点映射；
- viewport scroll 对齐；
- 大 viewport 先按原尺寸布局再缩放；
- annotation overlay 与截图 target 对齐；
- 明确 best-effort，不声称 pixel-perfect。

实现可以修复当前算法或替换内部实现，但公共 API 不变；若新增依赖，必须说明包体积和许可证。

### Cross realm

- 不使用顶层全局 constructor 判断 iframe/ShadowRoot；
- top → iframe；
- nested iframe；
- iframe → open shadow；
- iframe → shadow → target；
- reload 后 marker 恢复；
- cross-origin 明确 unsupported。

### Freeze

- 删除自研全局 `requestAnimationFrame` monkey patch/fallback；
- 只使用 React Grab 公共 freeze/unfreeze；
- disposer 对称；
- 不使用固定 500ms 作为核心正确性条件；
- Toolbar 自身可操作。

### Region

- 最多 69 sampling points；
- 收集最多 150–200 live unique candidates；
- 再执行语义评分/父子去重；
- 最终最多 50 targets；
- 不用 subtree aggregate textContent 作为主要 unique signal；
- 不扫描全部 DOM。

### Marker observer

- 只在存在真正可见/编辑中的 markers 时工作；
- 观察 app root，不默认整个 body；
- rAF/debounce 合并；
- resolved target 使用 ResizeObserver 或等价精确更新；
- cleanup 完整。

### Host ignore

- root 创建时立即写 `data-react-grab-ignore`。

## 验收标准

- **G07-001** Screenshot Card 背景、字体、padding、border 测试通过。
- **G07-002** 页面中 img/canvas/iframe 不导致后续 clone style 错位。
- **G07-003** 滚动到页面下半部分截图与 annotation bounds 对齐。
- **G07-004** 1920×1080 缩放截图无重排/裁切错位。
- **G07-005** nested iframe marker save/reload 精确恢复。
- **G07-006** iframe 内 open ShadowRoot marker save/reload 精确恢复。
- **G07-007** cross-origin boundary 明确 unresolved/unsupported，无异常泄漏。
- **G07-008** source 中无自研 rAF replacement。
- **G07-009** freeze/unfreeze 对称，Popover/animation/streaming Fixtures 无破坏。
- **G07-010** Region wrapper-heavy Fixture 最终保留语义目标而非前 50 个 wrapper。
- **G07-011** Region source 中无 `querySelectorAll("*")`。
- **G07-012** Mutation-heavy Fixture 的 marker refresh 次数有上界并记录测量。
- **G07-013** 无 marker 时 observer/ResizeObserver 不运行。
- **G07-014** Studio root 首次 inspection 前已有 ignore attribute。
- **G07-015** package build、tarball E2E 和 production exclusion 仍通过。

## 必须运行

```bash
pnpm test -- screenshot selector-locator freeze region marker-runtime
pnpm test:e2e -- screenshot cross-realm freeze region dynamic-dom
pnpm build
pnpm pack --json
rg -n "window\.requestAnimationFrame\s*=|querySelectorAll\(['\"]\\?\*|instanceof\s+(HTMLIFrameElement|ShadowRoot)" src
```

对 realm-safe 判断，可允许使用 ownerDocument.defaultView constructor，但必须由 nested realm E2E 证明。

## 性能证据

记录：

- 69 点 Area 最坏执行时间；
- 200 candidate prune 时间；
- dynamic DOM 10 秒内 marker refresh 次数；
- screenshot 典型页面耗时和 PNG 大小。

不要求虚假的绝对性能目标，但必须留基线并避免无限/按节点线性 observer 重算。

## 阻塞停止条件

如果某个跨域 iframe 或浏览器安全边界无法支持，明确标记 unsupported；禁止通过全 DOM 扫描或跨域访问绕过。

## Living ExecPlan

### Progress

- [x] 2026-08-13：已读取冻结常量、完整共享合同、Goal 07 与 launcher，并确认两个仓库位于指定干净基线。
- [x] 2026-08-13：通用包已完成 Screenshot、跨 realm 恢复、Freeze、Region 与 Marker observer 修复；Goal 08 未开始。
- [x] 2026-08-13：fresh relative-tarball consumer `/tmp/agent-feedback-g07-release2-d1UhnM/consumer` 完成 vertical、source benchmark、5 项 reliability browser E2E、production build 和 SIGTERM cleanup；外部证据位于 `/root/work/agent-feedback-goal07-evidence-20260813T0830Z/final/`。
- [x] 2026-08-13：最终 follow-up 后 external consumer `/tmp/agent-feedback-g07-release-8N3ove` 的 reliability browser suite 5/5 PASS；package full Vitest 20 files / 88 tests、typecheck、build、audit、check:package 与 diff check 均 PASS。
- [x] 2026-08-13：最终提交 `cf3fdf6` 后 fresh relative-tarball consumer `/tmp/agent-feedback-g07-final-cf3fdf6-jpMdQj/consumer` 完整 E2E、production build/exclusion 与 SIGTERM cleanup PASS；证据位于 `/root/work/agent-feedback-goal07-evidence-20260813T0830Z/final-cf3fdf6/`。

### Surprises & Discoveries

- React Grab selector 已原生编码 `>>iframe>>` 与 `>>>` realm boundary；包内恢复器按这些公共 selector token 逐 realm 查询，不依赖顶层 realm constructor。
- nested iframe reload 后最初 marker 缺失的根因是只监听顶层 iframe `load`；递归监听 same-origin frame tree，并在 rAF 中重新 resolve 隐藏 marker 后恢复。
- Screenshot 是结构化、经过清理的 best-effort viewport evidence；媒体以原几何 placeholder 保留，先以原 viewport layout 再缩放，不承诺 pixel-perfect。

### Decision Log

- **D-07-01:** 不新增 screenshot 依赖；复用浏览器 `foreignObject`、canvas 和现有 evidence endpoint，避免包体与许可证变化。
- **D-07-02:** React Grab public `freeze`/`unfreeze` 仅在已选中 target、composer 打开时成对调用；capture 启动本身不冻结 toolbar。
- **D-07-03:** marker observer 限定 app root，只在有 marker/编辑状态时运行；Mutation/Resize/frame-load 事件统一 rAF 合并，unmount/隐藏完整清理。

### Outcomes & Retrospective

**实际交付：** best-effort PNG evidence、合法 computed CSS、媒体占位与 viewport/overlay 对齐；nested iframe/open Shadow Root selector 恢复；React Grab public freeze lifecycle；69 points / 200 candidates / 50 targets Region pruning；app-root marker observers、ResizeObserver、recursive same-origin frame reload refresh 与完整 cleanup；root 创建时 ignore attribute。

**未交付：** Goal 07 无缺项。Goal 08、09、10 均未开始；未 push、publish。

**执行证据：** `pnpm typecheck` PASS；focused/full Vitest 20 files / 88 tests PASS；`pnpm build` PASS；`publint && attw --pack . --profile esm-only` PASS；architecture audit PASS；forbidden source scan 0 matches；38-file package tarball只含 LICENSE/README/package.json/dist；fresh relative-tarball consumer 完整 E2E PASS（vertical 1、source 1、reliability 5）并 production build / six public imports / CLI help / production exclusion / SIGTERM cleanup PASS。

**性能基线：** 最终 fresh Chromium 1920×1080 screenshot 314 ms、40,777 bytes；69-point Area 最坏 169 ms；dynamic DOM 10 秒 marker refresh 10 次；200-candidate prune focused unit 81.948 ms（算法上限 200 candidates、最终 50）。

**验收结果：**

- **G07-001 PASS** — unit + packed Card 验证 background/font/padding/border computed style。
- **G07-002 PASS** — img/canvas/iframe 保留几何 placeholder，后续节点 clone/style 对齐。
- **G07-003 PASS** — 下半页 scroll screenshot 与 viewport annotation overlay 对齐。
- **G07-004 PASS** — 1920×1080 先原尺寸 layout，再输出 1600×900 PNG；未发生重排/裁切。
- **G07-005 PASS** — nested iframe selector save/reload 后 marker 精确恢复为 target x/y - 8。
- **G07-006 PASS** — iframe 内 open Shadow Root selector save/reload 后 marker 精确恢复。
- **G07-007 PASS** — cross-origin fixture 明确为 unsupported，未泄漏异常。
- **G07-008 PASS** — package source forbidden scan无 `window.requestAnimationFrame =`。
- **G07-009 PASS** — public freeze/unfreeze 对称；packed popover、animation、streaming dynamic fixture 与 toolbar 均可用。
- **G07-010 PASS** — wrapper-heavy Region 在 200 candidates 后语义 pruning，保留 button target。
- **G07-011 PASS** — source forbidden scan无 `querySelectorAll("*")`。
- **G07-012 PASS** — mutation-heavy 10 秒仅 10 次 marker refresh，rAF 合并有上界。
- **G07-013 PASS** — no-marker unit 证明 MutationObserver/ResizeObserver 不启动；隐藏 marker 后停止。
- **G07-014 PASS** — runtime unit 验证 host 首次 render 前已有 `data-react-grab-ignore`。
- **G07-015 PASS** — package build、fresh relative-tarball full E2E、production exclusion、public imports 均通过。

**下一可靠起点：** package Goal 07 tip `cf3fdf6f8f50f1eec531a834f64612ce6fa7a5a7`（基于 `4786e2fd64f40d4a66350a633cd25186b2ec7ae0`）；Portal plan-only completion commit includes this final evidence. Goal 08 仍未开始。

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
