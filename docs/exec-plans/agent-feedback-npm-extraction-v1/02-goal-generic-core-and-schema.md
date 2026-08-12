# Goal 02 — Move the host-neutral core into the standalone package

## 单一完成状态

独立包已经拥有全新 `agent-feedback.task.v1` 的纯核心实现与测试；这些模块不依赖 React DOM、Vite、Node 文件系统或 NocoBase，并可独立完成 task create/mutate/format/redact/validate。Default Portal 运行行为仍未切换。

## 范围

迁移或重写为通用命名的纯模块：

- task schema/types；
- task ID；
- annotation selectors；
- mutation 与 revision contract；
- shared formatter；
- generic redaction；
- selection pure model；
- placement/hotkey pure definitions（不含 DOM listener）；
- JSON limits 和 extension namespace validation。

推荐目录：

```text
agent-feedback/src/core/
agent-feedback/src/types/
agent-feedback/tests/core/
```

## 核心要求

1. 新 schema 从 v1 开始，不复制 PortalStudio v6 的名称。
2. 不实现旧 schema normalizer/migration。
3. Extension 数据只存在于 `annotation.extensions[extensionId]`。
4. Mutation 必须使用 `expectedRevision` 并返回 deterministic conflict。
5. Formatter 默认导出 open annotations，并支持 all/json。
6. Generic redactor 不 import NocoBase；支持 extension redactor pipeline 的纯合同。
7. 所有类型可从 `@gchust/agent-feedback/types` 导入。
8. 纯模块不得 import browser-only 或 Node-only 模块。
9. 当前模板代码暂时不需要改为使用这些模块；本 Goal 只建立可靠核心。

## 非范围

- Browser Toolbar；
- Vite plugin；
- 文件存储；
- CLI；
- NocoBase Extension；
- Plugin toolbar registry 实现；
- 已知 Screenshot/source bug。

## 验收标准

- **G02-001** schema ID/version 精确为项目常量。
- **G02-002** 全仓 package source 不出现 `PortalStudio`、`.portal-studio`、`/__portal-studio`。
- **G02-003** 不存在 v2+ 或旧 v1–v6 migration/normalizer。
- **G02-004** schema 接受完整合法任务并拒绝未知顶层字段、非 JSON extension 数据和超限数据。
- **G02-005** mutation add/update/complete/reopen/remove/removeCompleted/revision conflict 单测通过。
- **G02-006** formatter 的 Markdown golden test 覆盖单目标、多目标、region、open/all、extension context。
- **G02-007** redaction 覆盖 Authorization、Bearer/JWT、cookie、token、password、input value 和 URL secret。
- **G02-008** extension namespace 不能覆盖其他 extension，大小和 key 数量有明确上限。
- **G02-009** core build 输出无 React/Vite/Node imports。
- **G02-010** 公开 types 的 consumer compile test 通过。
- **G02-011** `pnpm pack` 后 consumer 可使用 schema/mutation/formatter 公共 API。
- **G02-012** Default Portal 行为未切换，Goal 03 未开始。

## 必须运行

```bash
pnpm typecheck
pnpm test -- core
pnpm build
pnpm pack --json
pnpm exec publint
pnpm exec attw --pack .
rg -n "PortalStudio|portal-studio|schemaVersion:\s*[2-9]|@nocobase|data-nb-|NOCOBASE_" src dist
```

`rg` 对 package source/dist 的禁止模式必须没有结果；测试 Fixture 中的字符串可通过明确 exclude 处理。

## 阻塞停止条件

如果某个“纯模块”必须访问 DOM、Vite server、NocoBase 或文件系统才能工作，停止并重新划分边界，不能在 core 中加入环境判断。

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
