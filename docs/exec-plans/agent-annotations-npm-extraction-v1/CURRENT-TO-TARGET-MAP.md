# Current-to-target code map

本文件帮助低参数模型理解“哪些现有文件属于通用包、哪些必须留在 NocoBase 适配层”。实际 HEAD 变化时先核对，不要机械复制不存在的路径。

## 1. 纯核心：Goal 02

| 当前 Default Portal | 目标独立包 | 说明 |
|---|---|---|
| `src/studio/types.ts` | `src/types/task.ts`、`src/types/public.ts` | 重命名为通用 schema v1，不复制旧版本号 |
| `src/studio/task-model.ts` | `src/core/task-model.ts` | 只保留新 schema validate/create |
| `src/studio/mutation.ts` | `src/core/mutation.ts` | expectedRevision 与 annotation operations |
| `src/studio/format.ts` | `src/core/format.ts` | Markdown/JSON exporter 基础 |
| `src/studio/redact.ts` | `src/core/redaction.ts` | 删除 NocoBase import，形成 pipeline |
| `src/studio/selection.ts` | `src/core/selection.ts` | 纯 selection model |
| `src/studio/annotation-selectors.ts` | `src/core/annotation-selectors.ts` | Open/All/count selectors |
| `src/studio/task-id.ts` | `src/core/ids.ts` | generic task/annotation IDs |
| `src/studio/placement.ts` | `src/core/placement.ts` | 无 DOM 依赖部分；DOM 测量留 client |
| `src/studio/studio-actions.ts` | `src/extension/builtins/contracts.ts` | Goal 05 前只迁移数据定义，不固定硬编码 Registry |

## 2. 浏览器运行时：Goal 03

| 当前 Default Portal | 目标独立包 | 注意 |
|---|---|---|
| `src/studio/index.tsx` | `src/client/mount.tsx` | root ID/attribute/CSS 前缀改为通用名 |
| `src/studio/toolbar.tsx` | 拆入 `src/client/runtime/`、`toolbar/`、`annotations/` | 禁止原样留下 3000 行单文件 |
| `StudioHorizontalToolbar.tsx` | `src/client/toolbar/HorizontalToolbar.tsx` | Goal 05 改为 Registry 渲染 |
| `StudioActionTooltip.tsx` | `src/client/toolbar/ActionTooltip.tsx` | generic messages |
| `StudioShortcutHelp.tsx` | `src/client/panels/ShortcutHelp.tsx` | 从 shortcut registry 生成 |
| `StudioAnnotationListPanel.tsx` | `src/client/panels/AnnotationList.tsx` | public commands only |
| `StudioComposer.tsx` | `src/client/annotations/Composer.tsx` | generic task transport |
| `AnnotationEditorPopover.tsx` | `src/client/annotations/EditorPopover.tsx` | generic task transport |
| `AnnotationMarkerLayer.tsx` | `src/client/markers/MarkerLayer.tsx` | route/locator abstractions |
| `dock.ts` | `src/client/toolbar/dock.ts` | local UI preference only |
| `hotkeys.ts`、`useStudioHotkeys.ts` | `src/client/hotkeys/` | Goal 05 接 Registry |
| `task-client.ts` | `src/client/transport/http.ts` | interface 放 `src/client/transport/types.ts` |
| `useActiveTaskSync.ts` | `src/client/task/useActiveTaskSync.ts` | generic endpoint/config |
| `diagnostics.ts` | `src/client/evidence/diagnostics.ts` | generic capture/redaction |
| `screenshot.ts` | `src/client/evidence/screenshot.ts` | Goal 07 修正确性 |
| `capture-freeze.ts`、`useCaptureFreeze.ts` | `src/client/inspection/freeze.ts` | 只使用 React Grab 公共 freeze |
| `styles.ts` | `src/client/styles/` | `.aa-` 前缀与 Shadow DOM |

## 3. 感知域：Goals 03、06、07

| 当前 | 目标 | 处理 |
|---|---|---|
| `inspection/react-grab-engine.ts` | `src/client/inspection/react-grab-engine.ts` | 唯一 primitives importer |
| `inspection/types.ts` | `src/types/inspection.ts` | 不暴露上游私有类型 |
| `inspection/normalize.ts` | `src/client/inspection/normalize.ts` | source path 不在浏览器伪装相对路径 |
| `inspection/pipeline.ts` | `src/client/inspection/pipeline.ts` | enrich/redact pipeline |
| `inspection/hierarchy.ts` | `src/client/inspection/hierarchy.ts` | realm-safe |
| `inspection/region.ts` | `src/client/inspection/region.ts` | bounded sample、先 prune 后 50 |
| `inspection/react-grab-selector-locator.ts` | `src/client/markers/selector-locator.ts` | 严格 locator，不是第二感知引擎 |
| `inspection/nocobase-context.ts` | **不进入通用包** | Goal 08 改成 NocoBase TargetEnricher |

## 4. Vite、Node 和 CLI：Goal 04

| 当前 | 目标独立包 |
|---|---|
| `src/studio/vite.ts` | `src/vite/plugin.ts`、`virtual-client.ts`、`source-path.ts` |
| `src/studio/endpoint.ts` | `src/node/http/`、`src/node/store/` |
| `src/studio/evidence-loop.ts` | client/node evidence command 两侧拆分 |
| `scripts/portal-studio-agent.mjs` | `src/cli/commands/{list,complete,reopen}.ts` |
| `portal-studio-print.mjs` | `src/cli/commands/print.ts` |
| `portal-studio-verify.mjs` | `src/cli/commands/verify.ts` |
| `portal-studio-mcp.mjs` | `src/cli/commands/mcp.ts`，只读/验证 tools |
| `portal-studio-inspection-audit.ts` | `src/cli/commands/audit.ts` |

## 5. Extension API：Goal 05

推荐目标：

```text
src/extension/
├── define-extension.ts
├── registry.ts
├── toolbar.ts
├── panels.ts
├── enrichers.ts
├── exporters.ts
├── redactors.ts
├── host.ts
├── public-api.ts
└── builtins/
```

所有 built-ins 必须从 `builtins/` 通过公开 Registry 注册。核心 Toolbar 只消费已解析 contributions。

## 6. NocoBase 薄适配：Goal 08

只留在 Default Portal：

```text
src/agent-annotations/nocobase-extension.ts
```

它可导入：

- `@gchust/agent-annotations/extension`；
- `@nocobase/portal-sdk/i18n`；
- 必要 NocoBase redactor API。

它不得包含：

- Task store；
- Marker；
- Screenshot；
- Vite middleware；
- CLI；
- React Grab；
- Toolbar 内置逻辑；
- 通用 redaction 副本。

## 7. 测试归属

### 移入独立包

当前几乎所有：

```text
tests/logic/portal-studio/**
tests/components/portal-studio/**
e2e/react-grab-g01/**
通用 portal-studio E2E
```

按 core/client/vite/cli/extension/playground 重新组织。

### Default Portal 保留

只保留：

- package plugin 在 NocoBase Portal 中 mount；
- NocoBase target enricher；
- locale；
-真实 Portal Pick/Copy/Agent Complete；
- production exclusion。

不要在两个仓库复制同一套通用测试。
