# Portal Studio：迁移到 React Grab 单一感知引擎

本目录是一套按顺序执行的 Codex Goal / ExecPlan，用于把当前 Portal Studio 的自研通用页面感知链迁移到 `react-grab/primitives`，同时完整保留 NocoBase 自己有价值的产品能力：横向工具栏、Pick / Multi / Area、编号 Marker、批注列表、Open / Completed、Copy、Code Agent 完成状态同步、任务 revision、运行时诊断、截图、NocoBase 业务上下文与安全脱敏。

最终状态不是“双引擎”，也不是“React Grab 失败后再走旧 Fiber”。最终状态只有一条感知路径：

```text
Pointer / keyboard input
  -> react-grab/primitives
  -> Portal Studio normalization + redaction
  -> NocoBase business-context enrichment
  -> Annotation / Marker / Task / Agent workflow
```

## 为什么拆成多个 Goal

Codex Goal 最适合“一个明确结果 + 一个停止条件”，而不适合把多个可独立失败的工作面塞进一个超大任务。复杂迁移使用一份共享合同，并让每个 Goal 维护自己的 `Progress`、`Surprises & Discoveries`、`Decision Log` 和 `Outcomes & Retrospective`。每个阶段完成后独立复核、建立 checkpoint，再进入下一阶段。

## 执行顺序

1. `01-goal-lock-upstream-contract.md`
   - 安装并锁定 React Grab；建立真实 React 19/Vite 6 验证夹具；证明公共 primitives 满足要求。
2. `02-goal-build-single-inspection-domain.md`
   - 建立唯一 Inspection Engine、v6 目标数据合同、定位器和 NocoBase 语义增强；暂不切换生产交互。
3. `03-goal-atomic-production-cutover.md`
   - 一次性把 Pick、Multi、Area、保存、Marker、格式化、CLI/MCP 和服务端写入全部切到 v6 / React Grab。
4. `04-goal-freeze-region-and-runtime-quality.md`
   - 接入 Freeze，改进区域选择、Shadow DOM/iframe、性能与错误恢复。
5. `05-goal-delete-legacy-and-compatibility.md`
   - 物理删除旧 Fiber、Vite 正则源码定位、候选数组、v1–v5 兼容和冲突文档；不保留 fallback。
6. `06-goal-release-proof.md`
   - 完整 E2E、源定位基准、安全、CLI、生产剔除、许可证与最终零遗留证明。

不要并行执行会修改同一批 `src/studio` 文件的 Goal。对于低参数模型，先使用 `launchers.md` 中当前阶段的 `/plan` 预检，确认仓库适配和验收映射，再启动 `/goal`。每次只给 Code Agent：

```text
00-shared-contract.md
+ 当前一个 Goal
+ launchers.md 中对应的启动提示词
```

## 推荐仓库位置

将本目录复制到：

```text
docs/exec-plans/portal-studio-react-grab-migration-v1/
```

## 最终完成的硬门槛

只有以下条件全部成立，整个迁移才算完成：

- 生产交互只通过 `react-grab/primitives` 感知元素；
- 只允许一个文件直接 import `react-grab/primitives`；
- 不安装、不直接 import `element-source`；
- 不 import 完整 `react-grab` 默认 UI；
- 不读取任何 React 私有 Fiber key；
- 不扫描 Vite `moduleGraph` / `transformResult.code` 猜源码；
- 不保留旧感知 adapter 或 fallback；
- 任务只接受 schema v6，不迁移 v1–v5；
- 当前批注产品功能没有回归；
- 所有验收命令与证据均已记录。

## 研究依据

见 `RESEARCH-NOTES.md`。它记录了 Codex Goal / ExecPlan 的官方写法依据、React Grab 公共契约，以及为何最终不安装 `element-source`、不保留 fallback。
