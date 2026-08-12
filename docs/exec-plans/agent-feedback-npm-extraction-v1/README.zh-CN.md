# Agent Feedback 通用 NPM 库抽离：Codex Goal 套件 v1

本套件用于把当前 `portal-template-default` 中内置的 Portal Studio，抽离成独立发布的通用 React/Vite NPM 工具，并让 NocoBase Default Portal 只保留极薄的宿主扩展。

它不是一份“一次性大 Prompt”。执行时应使用：

```text
共享合同
+ 当前一个 Goal
+ 一段很短的 /goal 启动提示词
```

每个 Goal 都只有一个可演示的结束状态，必须独立验证、独立复核，再进入下一阶段。

## 1. 最终目标

```text
独立 NPM 包 @gchust/agent-feedback
├── 通用 React 浏览器运行时
├── react-grab 感知引擎
├── Annotation / Marker / Task / Revision
├── 可扩展横向工具栏 Registry
├── Vite 插件与文件存储
├── CLI / MCP / 验证工具
└── 不依赖、不硬编码 NocoBase

NocoBase Default Portal
├── 一个 NPM 依赖
├── vite.config.ts 中一次插件注册
├── 一个很薄的 NocoBase Client Extension
└── 不再包含 src/studio/**、Studio CLI 和通用测试副本
```

## 2. 推荐工作区拓扑

Codex 应从同时包含两个 Git 仓库的父目录启动：

```text
agent-feedback-workspace/
├── agent-feedback/                 # 新建的独立 Git 仓库
└── portal-template-default/        # 当前 feat-agent-feedback 分支
```

硬性规则：

- 两个目录最终必须是独立 Git 仓库。
- 不要把新 NPM 库永久放进 Default Portal 的 `packages/` 子目录。
- 不要使用 Git submodule 作为最终分发方式。
- Goal 01 可以创建 `agent-feedback/`；若 Codex 的沙箱不能写入父工作区，必须停止并报告，不能把库偷偷建在模板内部。

## 3. 开始前只允许修改一次的常量

先阅读 `00-project-constants.md`。默认使用：

```text
NPM package: @gchust/agent-feedback
Repository:  agent-feedback
License:     MIT
Initial RC:  0.1.0-alpha.0
```

若你的实际 NPM scope 不同，请在 Goal 01 开始前修改该文件。Goal 01 完成后不得再进行跨仓库改名。

## 4. 为什么拆成多个 Goal

官方 Codex 指南把 Goal 定义为可验证的“完成合同”，应包含结果、验证面、约束、边界、迭代规则和阻塞停止条件。复杂迁移还应使用可持续更新的 ExecPlan，并在每个里程碑执行最小但充分的验证。

本项目同时包含：

- 两仓库抽离；
- 浏览器运行时；
- Vite/Node/CLI；
- 插件 API；
- NocoBase 解耦；
- 已知正确性 Bug；
- packed tarball 和发布验证。

将它们放进一个 Goal，会让低参数模型在后期失败时反复破坏前面已工作的功能。因此拆成九个必做 Goal，以及一个发布后的条件 Goal。

详细的现有文件到目标目录映射见 `CURRENT-TO-TARGET-MAP.md`。

## 5. Goal 顺序

| Goal | 单一结束状态 |
|---|---|
| 01 | 两仓库工作区、独立包骨架和当前行为基线已建立，模板功能未改变 |
| 02 | 通用纯核心已迁入独立包，并以全新 `agent-feedback.task.v1` 合同通过单测 |
| 03 | 独立包的浏览器运行时在无 NocoBase 的 React/Vite Playground 中完成批注闭环 |
| 04 | Vite 插件、文件存储和 CLI 已迁入包，packed tarball 可在空白应用中完成真实闭环 |
| 05 | 工具栏正式插件化；内置动作与第三方动作使用同一 Registry |
| 06 | 源码路径、revision、CLI/MCP 协议等可靠性问题在独立包中修复 |
| 07 | Screenshot、iframe/Shadow DOM、Freeze、Region、Observer 等浏览器问题修复 |
| 08 | Default Portal 改为薄 NocoBase Extension，并物理删除内置 Studio 副本 |
| 09 | 独立包从 clean install 与 packed tarball 获得发布候选证明 |
| 10 | **条件 Goal**：人工发布 NPM 后，Default Portal 切换到正式 registry 版本 |

必须顺序执行 01–09。Goal 10 只有在用户完成 NPM 发布后执行。

## 6. 每个 Goal 的执行节奏

### 6.1 Plan

```text
/plan 读取共享合同和当前 Goal，检查真实 HEAD，
逐条把验收标准映射到文件、命令和证据。
不要修改代码，不要开始后续 Goal。
```

### 6.2 Goal

```text
/goal 实际实现当前 Goal。
只有所有 AC 都有证据且为 PASS 才能完成。
```

### 6.3 独立复核

另起一次审查消息，但保持同一工作区：

```text
独立重新检查当前 Goal。不要相信之前的完成声明。
检查 diff、运行命令、验证 packed artifact；修复当前 Goal 范围内的问题。
不要开始下一 Goal。
```

### 6.4 Checkpoint

当前 Goal 全部通过后：

- 更新该 Goal 的 `Outcomes & Retrospective`；
- 两个仓库分别记录清晰 checkpoint；
- `/goal clear`；
- 再开始下一个 Goal。

禁止两个 Codex 会话同时写同一个仓库。需要并行时使用独立 worktree，并只并行互不依赖的只读调研或验证。

## 7. 每次只给低参数模型哪些文件

每次只给：

```text
00-project-constants.md
00-shared-contract.md
当前一个 Goal
launchers.md 中对应段落
```

不要同时投喂全部 Goal。上一阶段的结果应通过代码、测试和该 Goal 的 Outcomes 留在工作区中。

## 8. 完成声明规则

最终报告必须逐项标记：

```text
PASS
FAIL
BLOCKED
NOT RUN
```

以下文字不算证据：

```text
应该可以
理论上通过
代码看起来正确
之前有人跑过
后续再验证
```

只有命令输出、测试报告、浏览器证据、tarball 内容和实际导入结果可以作为完成证据。

## 9. 发布边界

Goal 09 只产出发布候选，不要求 Codex 使用你的 NPM 凭据发布。

Goal 10 的前置条件是：

```bash
npm view @gchust/agent-feedback@<published-version> version
```

能够从 registry 返回目标版本。若尚未发布，Goal 10 必须保持 BLOCKED，不能伪造 registry 依赖成功。
