# Codex Goal / ExecPlan 调研与本套件的写法

核验日期：2026-08-12。

## 1. 官方建议摘要

### Goal 是完成合同，不是更大的 Prompt

OpenAI 将 Goal 描述为跨轮次保持的持久目标。一个强 Goal 通常包含：

1. Outcome：完成时什么必须为真；
2. Verification surface：用什么测试、基准、报告或制品证明；
3. Constraints：不能退化什么；
4. Boundaries：允许修改、读取和使用什么；
5. Iteration policy：每轮失败后怎样选择下一步；
6. Blocked stop condition：什么时候必须停止并如实报告阻塞。

来源：

- https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex
- https://developers.openai.com/codex/long-running-work

### Goal 要窄到可审计，宽到允许发现

官方建议 Goal 比单次任务大、比开放式 backlog 小。迁移类 Goal 应给出清楚的目标栈、行为一致性检查、限制和停止条件。

来源：

- https://developers.openai.com/codex/use-cases/follow-goals/
- https://developers.openai.com/codex/use-cases/code-migrations

### Plan 回答路径，Goal 回答结束状态

复杂、风险高、跨多个系统的工作应先 `/plan`，确认文件边界、风险和验证方式，再启动 `/goal`。

来源：

- https://developers.openai.com/codex/learn/best-practices
- https://developers.openai.com/blog/mastering-codex-remote-for-engineering

### 多小时任务使用可持续更新的 ExecPlan

官方 ExecPlan 指南要求计划能够让“只拿到当前 working tree 和这一份计划”的 Agent 继续工作；计划是 living document，应持续维护：

- Progress；
- Surprises & Discoveries；
- Decision Log；
- Outcomes & Retrospective。

每个 milestone 都应产出可观察、可独立验证的结果。

来源：

- https://developers.openai.com/cookbook/articles/codex_exec_plans
- https://developers.openai.com/blog/run-long-horizon-tasks-with-codex

### AGENTS.md 要简短

官方建议将仓库布局、命令、约束和反复出现的规则放入 `AGENTS.md`，但保持短小准确；任务细节应引用单独的 Markdown 文件。

来源：

- https://developers.openai.com/codex/agent-configuration/agents-md
- https://developers.openai.com/codex/customization/overview

## 2. 本套件采用的结构

```text
短 AGENTS.md
    ↓
项目常量 + 共享架构合同
    ↓
当前一个详细 ExecPlan
    ↓
很短的 /goal 完成合同
```

这样做的原因：

- 低参数模型不会同时背负十个阶段；
- 验收标准只围绕当前结果；
- 每个阶段完成后可以独立审查和回退；
- 共享不变量不需要在每个 Goal 中重复；
- 后续 Goal 读取已经存在的代码和 Outcomes，而不是重读全部历史计划。

## 3. 每个 Goal 的固定写法

每个 Goal 都必须具备：

```text
单一完成状态
明确范围与非范围
仓库事实和允许修改的目录
实现要求
编号验收标准
必须运行的命令
必须提供的浏览器/制品证据
阻塞停止条件
最终报告格式
Living ExecPlan 四个栏目
```

## 4. 为什么不是一个大 Goal

本迁移存在九种独立故障面：

- 两仓库工作区；
- library build 与 package exports；
- 浏览器运行时；
- Vite/Node/CLI；
- 插件 Registry；
- source path 与协议；
- screenshot 与跨 realm；
- NocoBase 切换；
- packed artifact 与发布。

若塞进一个 Goal，后期一个 Screenshot E2E 失败会使整个任务“未完成”，低参数模型容易重新重构已经稳定的工具栏。按可观察纵向结果拆分，能让每个 Goal 都有清楚的停止点。

## 5. 证据原则

每项验收标准必须对应至少一种：

- 精确命令及退出码；
- 单元、组件、契约或 E2E 测试；
- 浏览器截图或 Playwright trace；
- `pnpm pack --json` 和 tarball 文件清单；
- 从 tarball 安装后的 import/CLI smoke；
- grep/audit 门禁；
- 两仓库 `git diff --stat` 与文件清单。

完成声明必须区分：

```text
已由本轮重新运行并确认
仅由前一阶段记录但未重新运行
因环境受阻未运行
```
