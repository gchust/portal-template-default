# Project constants — edit only before Goal 01

这些常量用于消除低参数模型在命名、路径和协议上的自由发挥。Goal 01 完成后视为冻结。

```yaml
workspaceDirectory: agent-feedback-workspace
packageRepositoryDirectory: agent-feedback
templateRepositoryDirectory: portal-template-default

packageName: "@gchust/agent-feedback"
packageDisplayName: "Agent Feedback"
packageDescription: "Developer-only visual annotations and Code Agent feedback for React/Vite applications"
packageLicense: MIT
initialVersion: "0.1.0-alpha.0"
firstStableVersion: "0.1.0"

packageManager: pnpm
nodeEngine: ">=20"
moduleFormat: ESM-only
libraryBundler: tsdown

reactPeer: "^19.0.0"
reactDomPeer: "^19.0.0"
vitePeerInitial: "^6.0.0"
reactGrabDependency: "0.1.50"

taskSchemaId: "agent-feedback.task.v1"
taskSchemaVersion: 1
runtimeDirectory: ".agent-feedback"
endpointPrefix: "/__agent-feedback"
tokenHeader: "x-agent-feedback-token"
clientRootId: "agent-feedback-root"
clientRootAttribute: "data-agent-feedback-root"
reactGrabIgnoreAttribute: "data-react-grab-ignore"
cssClassPrefix: "af-"
virtualClientModule: "virtual:agent-feedback/client"

clientExtensionApiVersion: 1
nocobaseExtensionId: "nocobase.portal"
```

## Frozen architecture decisions

1. 第一版只支持 React 19 + Vite 6；只有真实 CI 证明后才扩大 peer range。
2. 只发布一个 NPM 包，使用子路径 exports；不拆成多个同步版本包。
3. `react-grab@0.1.50` 是唯一通用感知引擎。
4. 不直接依赖或调用 `element-source`。
5. 不加载 React Grab 默认 UI。
6. 通用包不导入 `@nocobase/*`，不硬编码 `data-nb-*` 或 `NOCOBASE_*`。
7. 新包使用全新 schema v1；不迁移 `.portal-studio` 和旧 PortalStudio schema。
8. Default Portal 最终通过正式 NPM 依赖使用它；发布前验证使用 `pnpm pack` tarball。
9. Goal 09 不执行真实 npm publish；Goal 10 在人工发布后执行。
10. 若用户要修改 packageName、license 或 repo 名称，必须在 Goal 01 开始前修改本文件并同步 `README.zh-CN.md`。
