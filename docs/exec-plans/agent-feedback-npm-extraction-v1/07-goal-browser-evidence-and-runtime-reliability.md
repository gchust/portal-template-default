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
