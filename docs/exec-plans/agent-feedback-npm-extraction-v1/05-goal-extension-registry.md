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
