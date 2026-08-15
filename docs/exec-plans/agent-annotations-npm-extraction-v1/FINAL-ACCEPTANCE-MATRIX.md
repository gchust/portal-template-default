# Final acceptance matrix

Goal 09 完成时，F-001 至 F-044 必须全部为 PASS。Goal 10 完成时再验证 F-045 至 F-048。

## A. 独立包与分发

- **F-001** `agent-annotations/` 是独立 Git 仓库。
- **F-002** package name 与 `00-project-constants.md` 一致。
- **F-003** ESM-only build 成功，所有公开 exports 可导入。
- **F-004** `agent-annotations` bin 从 packed tarball 安装后可执行。
- **F-005** React/React DOM 是 peer dependency，不被 bundle 成第二份。
- **F-006** `react-grab` 精确版本由包自身依赖。
- **F-007** package 中没有 `@nocobase/*` dependency/import。
- **F-008** package 中没有 `data-nb-`、`data-ai-page-element`、`NOCOBASE_` 硬编码。
- **F-009** tarball 仅包含 dist、types、README、LICENSE、package metadata 和必要 assets。
- **F-010** tarball 安装到干净 React/Vite Fixture 后可运行。

## B. 通用功能

- **F-011** 无 NocoBase Playground 完成 Pick → Comment → Marker → Copy。
- **F-012** Multi 产生一条包含多个 targets 的 Annotation。
- **F-013** Area 使用 bounded sampling，不扫描全部 DOM。
- **F-014** Marker 在 reload 后恢复到原目标或明确 unresolved，绝不错误绑定。
- **F-015** Open/Completed/Reopen/Remove Completed 工作。
- **F-016** Code Agent CLI 能 list/complete/reopen/print/verify。
- **F-017** runtime diagnostics 与 screenshot 证据可读取。
- **F-018** dev-only production exclusion 有 bundle 证据。

## C. 插件 Registry

- **F-019** 所有 built-in toolbar actions 由公开 Registry 注册。
- **F-020** 外部 Extension 可增加 toolbar action。
- **F-021** 外部 Extension 可增加 Panel。
- **F-022** 外部 Extension 可增加快捷键，Tooltip/Help 自动同步。
- **F-023** 外部 Extension 可增加 target enricher。
- **F-024** 外部 Extension 可增加 exporter/redactor。
- **F-025** duplicate extension/action ID 明确失败。
- **F-026** shortcut 冲突明确失败。
- **F-027** HMR/unmount 后无重复注册和 listener 泄漏。
- **F-028** 扩展只能使用 Public API，不能访问内部 React setters。

## D. 正确性 Bug

- **F-029** source path 由 server 精确 canonicalize。
- **F-030** 无 basename-first 文件猜测。
- **F-031** duplicate basename fixture 返回完整正确路径。
- **F-032** source revision 只基于精确文件。
- **F-033** MCP/CLI 不宣称旧 PortalStudio schema；MCP 不提供旧 capture_task。
- **F-034** Screenshot CSS property、tree mapping、scroll、scale 回归通过。
- **F-035** nested same-origin iframe Marker reload 通过。
- **F-036** iframe 内 open ShadowRoot Marker reload 通过。
- **F-037** Freeze 不存在自研全局 rAF fallback。
- **F-038** Region 在 prune 前不会因 50 个 wrapper 提前截断。
- **F-039** Marker observer 只追踪真正可见 targets。
- **F-040** Studio root 在首次 inspection 前带 React Grab ignore 属性。

## E. NocoBase 薄集成

- **F-041** Default Portal 无 `src/studio/**`、旧 Studio scripts 和通用测试副本。
- **F-042** NocoBase Extension 数据位于 `annotation.extensions["nocobase.portal"]`。
- **F-043** NocoBase locale/translation 和 strong identity 通过 Extension 提供。
- **F-044** Default Portal 用 packed tarball clean install、dev、E2E、build 均通过。

## F. 发布后 registry 切换（Goal 10）

- **F-045** `npm view` 返回已发布目标版本。
- **F-046** Default Portal dependency 是 registry 版本，不是 link/file/workspace/tarball。
- **F-047** 从只包含 Default Portal 的 clean clone 安装成功。
- **F-048** 删除本地 tarball 或 sibling package 后，Default Portal 仍通过完整验证。
