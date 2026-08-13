# Goal 09 — Produce a clean-room, packed release candidate

## 单一完成状态

独立包 `0.1.0-alpha.0`（或项目常量中的 RC 版本）从 clean clone/install 完成 build、tests、API/CLI/browser/packed fixtures，并产出可人工发布的 tarball、release notes 和逐项最终验收报告；不执行真实 npm publish。

## 必须完成

### Package quality

- README：安装、Vite、extension、CLI、security、limitations；
- API reference；
- CHANGELOG；
- LICENSE；
- package metadata、repository、bugs、keywords；
- exports/types/bin；
- files whitelist；
- exact dependency/peer contracts；
- third-party notices（React Grab 等）。

### Clean-room matrix

至少：

- Node 20；
- Node 22；
- React 19；
- Vite 6；
- package source tests；
- plain Playground；
- Extension Demo；
- packed blank fixture；
- packed NocoBase fixture；
- production build exclusion。

可用 CI matrix 完成无法在单机同时运行的版本，但必须有本次 commit 的成功结果或本地容器证据。

### Tarball checks

- 安装后所有 exports 可导入；
- CLI shebang/permissions；
- `.d.ts` 无 internal path；
- 无 workspace protocol；
- 无 source/test/fixture 泄漏；
- 无 NocoBase；
- 无 React bundle duplication；
- tarball 大小记录并设合理防回归门禁。

### Final matrix

逐项执行 `FINAL-ACCEPTANCE-MATRIX.md` F-001–F-044。

## 验收标准

- **G09-001** clean clone 的 package `pnpm install --frozen-lockfile` 成功。
- **G09-002** typecheck/test/build/E2E 全通过。
- **G09-003** `pnpm pack --json` 产出唯一 tarball。
- **G09-004** tarball contents 与 files whitelist 一致。
- **G09-005** packed blank fixture 在删除 package repo 后通过。
- **G09-006** packed NocoBase fixture 在删除 package repo 后通过。
- **G09-007** public exports/CLI/types smoke 通过。
- **G09-008** package audit 全通过且 failure fixtures 有效。
- **G09-009** production exclusion 通过两个 host fixture。
- **G09-010** README 命令全部由测试或 docs-smoke 验证。
- **G09-011** F-001–F-044 全部 PASS，无 NOT RUN。
- **G09-012** `RELEASE-NOTES-0.1.0-alpha.0.md` 包含功能、限制、breaking reset、验证和发布命令。
- **G09-013** 未调用 npm publish，未写入用户凭据。
- **G09-014** 输出 tarball SHA-256、文件大小和路径。

## 必须运行

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm pack --json
pnpm exec agent-feedback audit

# packed blank fixture
pnpm install --frozen-lockfile
pnpm test:e2e
pnpm build

# packed NocoBase fixture/template
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

还要执行 package metadata/type checks，例如 publint、exports import smoke 和类型消费 Fixture。实际工具由 Goal 01 固定，不能临时跳过。

## 发布候选产物

```text
artifacts/
├── @gchust-agent-feedback-<version>.tgz
├── SHA256SUMS
├── PACK-CONTENTS.txt
├── FINAL-ACCEPTANCE-REPORT.md
└── RELEASE-NOTES-<version>.md
```

## 阻塞停止条件

任何 F-001–F-044 为 FAIL/BLOCKED/NOT RUN 时，不能声称 RC 完成。CI 服务不可用时必须用本地 Node/container 补齐；若确实无法补齐，报告 BLOCKED。

## Living ExecPlan

### Progress

- [x] 2026-08-13: 逐字读取 `AGENTS.md`、项目常量、共享合同、Goal 09 和最终验收矩阵。
- [x] 2026-08-13: 验证干净的已提交起点：package `73c836ab7cd5204dc2103cf4e8a86dcebb27cf8a`，Portal `068bfcbf7fe3f81884238dae7bc2cd33e73ad98d`。
- [x] 2026-08-13: 盘点现有 package scripts、Playground、Extension Demo、packed React/Vite fixture 和 Portal 薄集成；后续只在具体失败上修复。
- [x] 2026-08-13: 补齐 package metadata、README 安装/Vite/安全/限制、API reference、CHANGELOG、third-party notices、docs smoke 和 200000-byte tarball 门禁；source 21 files / 90 tests、publint/ATTW 和 docs smoke 已 PASS。
- [x] 2026-08-13: 修正两个过期 completed-marker fixture 断言，更新测试 Vite 到 6.4.3；dependency audit 0 vulnerabilities，plain Playground 3/3 和 Extension Demo 1/1 Chromium、两者 production build 全部 PASS。
- [x] 2026-08-13: package Goal 09 逻辑改动已本地提交为 `4dc320d599805ea44b30dea1deb1d78886fdfe44` (`chore: prepare Agent Feedback release candidate`)；从该候选 commit 启动 clean archive 矩阵。
- [x] 2026-08-13: Node 20 clean archive 发现 tsdown 0.22.14 engine 越界；具体修复已单独提交为 `812dcb209882084eb4b1bdb2369fc9caa8464cf5` (`fix: keep release build compatible with Node 20`)，当前候选起点更新为该 commit。
- [x] 2026-08-13: 从 `812dcb2` clean archives 在 Node 20.20.2 和 22.22.0 分别完成 frozen install/typecheck/90 tests/build/publint/ATTW/architecture/dependency/docs/tarball gates，全部 PASS。
- [x] 2026-08-13: 仅从 Node 22 clean archive 产出一个 final RC tarball：`artifacts/gchust-agent-feedback-0.1.0-alpha.0.tgz`，41 files / 135315 bytes / SHA-256 `241a7b60691dc3725869906cf710ee71ec1f4d768a8c0ce0a31fc92995fc6626`。
- [x] 2026-08-13: 首个 packed blank consumer 完整 browser/source/reliability/build/import/CLI 门禁 PASS，但发现 packed `agent-feedback audit` 无法在无 package `src` 的消费者运行；修复及回归测试已单独提交为 `688e960604f54c435b2564feedce7a0bed96d81f` (`fix: support audits from packed consumers`)。
- [x] 上述 `812dcb2` tarball 因后续具体 audit 修复已降为历史证据；最终已从 `5feabb0` 重跑 Node matrix 并重产唯一 final RC。
- [x] 2026-08-13: 真实 packed host 的 `src/main.tsx` 暴露 audit 首修不完整；精确 package-source 边界修正已单独提交为 `c7d20563caeef0e8d90c10d56ed727c48a1d0889` (`fix: distinguish package and consumer source audits`)，当前最终候选更新为该 commit。
- [x] 2026-08-13: `c7d2056` 在 Node 20.20.2/22.22.0 clean archives 的 frozen install/typecheck/91 tests/build/package/architecture/dependency/docs/tarball 全部 PASS；packed consumer 自带 `src/main.ts` 的 installed CLI audit 也 PASS。
- [x] 2026-08-13: 唯一 final RC 已替换为 `c7d2056` 产物：41 files / 135381 bytes / SHA-256 `313d23bb588607ef1c21eab59564e36eb1c58cd6b5021e44a9a2e291f66ba55f`；旧 tarballs 移至 `evidence/` 且不是发布产物。
- [x] 2026-08-13: tarball 内部路径/source-map 泄漏修正已单独提交为 `5feabb0fdcc9f71843efddd2d26b8ff06303f90f` (`fix: keep source internals out of release tarballs`)；发布清单从 41 个文件收窄为 25 个，当前最终候选更新为该 commit。
- [x] 2026-08-13: `5feabb0` 在 Node 20.20.2/22.22.0 clean archives 的全部 source/package/audit/docs/tarball gates PASS；唯一 final RC 替换为 25 files / 53051 bytes / SHA-256 `fbd9de0d4e81f738eff9a20b632cce348476ab4f8d0595631c04c87ea2701c54`。
- [x] 2026-08-13: `5feabb0` final packed blank fixture 完整 7-test browser 套件、SIGTERM、production build/exclusion、six exports、CLI help/audit 全部 PASS；installed d.ts/host/source/workspace scans 为 0，CLI artifact 为 0755 + Node shebang。
- [x] 2026-08-13: 从 Portal `068bfcb` committed archive 安装最终 tarball；frozen install、typecheck、23 files / 58 tests、SDK 9 files / 30 tests、build 和真实 NocoBase 2/2 Chromium 全 PASS；CLI list/complete/reopen/print/verify 与生产 preview `rootCount=0`、`endpointScripts=0` PASS。
- [x] 2026-08-13: packed Portal 将既有 `node_modules` 移至仓外证据目录后完成 `pnpm install --offline --frozen-lockfile`，随后 typecheck/tests/build PASS；packed types consumer 对六个公开 exports 编译 PASS。
- [x] 2026-08-13: 从最终 commit 复跑 plain Playground 3/3 Chromium + build 和 Extension Demo 1/1 Chromium/HMR + build；packed blank 与 packed Portal 两个生产 host 的 runtime/endpoint/root marker scan 均为 0。
- [x] 2026-08-13: `/root/work/agent-feedback-g09-writer-20260813/artifacts` 仅保留一个 RC tarball及 `SHA256SUMS`、`PACK-CONTENTS.txt`、release notes、writer acceptance report；25 files / 53051 bytes / SHA-256 `fbd9de0d4e81f738eff9a20b632cce348476ab4f8d0595631c04c87ea2701c54`，checksum 与精确 manifest PASS。
- [x] 2026-08-13: writer 对 F-001–F-044 全部记录 provisional PASS；不声称独立最终验收，下一步只允许独立 agent 从 package `5feabb0`、本 Goal plan commit 与上述 exact tarball 重跑合同。

### Surprises & Discoveries

- 初始 package 已有三个可复用边界：`playgrounds/react-vite`、`playgrounds/extension-demo` 和 `fixtures/packed-react-vite`；无需再建同类 fixture。
- 初始 README 只覆盖 extension 和 CLI；API reference、CHANGELOG、third-party notices 和完整 metadata 仍是 Goal 09 的具体缺口。
- `pnpm pack --json` 当前返回单个 object 且不带 size，不是 npm pack 式 array/size；tarball audit 改用返回的 `filename` 做 `stat` 取真实大小。
- plain Playground 首跑在 Complete 后等待 completed marker 而 FAIL；Goal 08 已确立 completed marker 隐藏合同，现有 runtime unit 也明确断言不渲染，因此是两处旧 fixture 断言过期，不是 source runtime 缺陷。
- 误将 `pnpm audit` 当成 package script 执行时，pnpm 运行了 dependency security audit 并具体报出 Vite 6.3.5 的 2 high / 3 moderate / 2 low advisories；修复版本均在 Vite 6 peer 内。
- 机器原有 Node 20.18.3 低于当前 tsdown 锁定的 Rolldown 1.2.4 engine `^20.19.0 || >=22.12.0`；frozen install 因 engine 跳过 native optional binding，build 具体 FAIL。使用同一 Node 20 主版的当前 20.20.2 重建 clean room，不改 package engine `>=20`。
- Node 20.20.2 继续具体 FAIL：`tsdown@0.22.14` 自身 engine 已是 `^22.18.0 || >=24.11.0`，optional config loader `unrun` 被跳过。这证实不是安装偶发，而是已冻结 Node `>=20` 与 dev bundler 的真实冲突。
- packed blank consumer 运行 `pnpm exec agent-feedback audit` 具体 FAIL：audit 无条件要求 package source 中的唯一 primitives importer，但 publish tarball 按合同不含 `src`;导致 audit 不可从 packed consumer 使用。
- 首次 audit 修复的测试只覆盖完全没有 `src`的 consumer；真实 packed blank host 自身有 `src/main.tsx`，仍被误认为 package source 而 FAIL。
- final tarball 深度扫描发现 `.d.ts` 泄漏 audit 内部 `src/client/inspection-engine.ts` 常量，且 `.map` 的 `sourcesContent` 内联 package source；这与 Goal 09 的 no internal path / no source leak 检查冲突。
- packed Portal 首次 E2E 因未显式提供 `NOCOBASE_E2E_ACCOUNT`/`NOCOBASE_E2E_PASSWORD` 按合同 FAIL；使用本机真实 NocoBase test backend 的已有测试账户通过进程环境提供后，原样 2/2 Chromium PASS，未写入仓库或证据凭据。
- 对整个 NocoBase Portal 运行通用 package architecture audit 会按设计拒绝 Portal 的 `@nocobase/*` imports；适用边界是 package source 与 generic packed host audit PASS，Portal host 由薄集成、namespace 与生产隔离门禁验证。

### Decision Log

- 2026-08-13: 所有生成 consumer、tarball、日志、报告和截图都放在 `/root/work/agent-feedback-g09-writer-20260813`，两个仓库只保留需要版本化的实现、测试和文档。
- 2026-08-13: 复用现有 packed React/Vite fixture 作 blank host；使用 Portal 提交的 clean archive 作 packed NocoBase host，避免新增重复 fixture。
- 2026-08-13: 发布候选仍为 `0.1.0-alpha.0`；不改冻结常量，不执行 publish/Goal 10。
- 2026-08-13: 复用 Node `fs.statSync` 为 tarball 设 200000-byte 回归门禁；当前约 132 KB，留出文档和 source-map 小幅增长空间，不引入新工具。
- 2026-08-13: 只修正 plain/packed fixture 的 completed-marker 断言：等待 public snapshot 为 `completed` 并断言 marker count 0；不改 runtime，与 Goal 08 CLI/browser 同步合同一致。
- 2026-08-13: 将 root 和三个现有 host fixture 的精确 Vite 6.3.5 测试版本更新到已在 Portal lockfile 使用的 6.4.3；不改冻结 peer `^6.0.0`，不扩大主版支持。
- 2026-08-13: Node 20 matrix 使用 20.20.2，这是 Node 20 主版且满足 frozen dev toolchain 的实际 engine；20.18.3 的原始失败日志保留，不用 `--force` 结果作最终证据。
- 2026-08-13: 将冻结为精确测试工具的 tsdown 从不支持 Node 20 的 0.22.14 回退到同一现有 bundler 的 0.21.0；0.21.0 engine `>=20.19.0`，是保留 Node 20/22 合同的最近版本，不更换 bundler 或新增工具。
- 2026-08-13: audit 只在被审计 root 真实存在 `src` 时强制 sole-importer 不变量；packed consumer 仍审计其 manifest/scripts/tests/fixtures/playgrounds，不伪造一个必须泄漏的 package source 目录。
- 2026-08-13: 精确收窄为只在被审计 root 存在 `src/client/inspection-engine.ts` 时强制 sole-importer；回归 fixture 现包含 consumer 自己的 `src/main.ts`，确保 packed app 不再被误判。
- 2026-08-13: 删除 release build source maps，将 sole-importer 常量改为 audit 内部，并让 tarball gate 明确拒绝 `.map` 和 source/test/fixture/script 路径；不新增发布工具。
- 2026-08-13: packed Portal E2E 只通过当前进程环境接入已有本机测试 backend；不创建 `.env.e2e`、不记录账号密码、不修改 Portal archive source。
- 2026-08-13: 两 host production exclusion 使用真正从 final tarball 安装的 blank 与 Portal builds；source Playground 直接嵌入 runtime，不能作为 Vite plugin exclusion host，故不伪造相同断言。

### Outcomes & Retrospective

Goal: G09
Result: PASS（writer provisional；独立最终验收未声称）

实际交付：

- package 从冻结起点产生五个本地逻辑 commit：`4dc320d`（quality/docs/metadata）、`812dcb2`（Node 20 build compatibility）、`688e960` 与 `c7d2056`（packed audit boundary corrections）、`5feabb0`（移除 maps/internal source leaks）。最终 package source commit 为 `5feabb0fdcc9f71843efddd2d26b8ff06303f90f`。
- 最终 RC 目录为 `/root/work/agent-feedback-g09-writer-20260813/artifacts`；包含 exact tarball、checksum、25-file contents、release notes 与 writer acceptance report。生成 consumers、logs、reports、screenshots 均在两个仓库外。
- Node 20.20.2 / 22.22.0 clean archives 均通过 frozen install/typecheck/91 tests/build/publint/ATTW/architecture/dependency/docs/tarball；plain Playground、Extension Demo、packed blank、packed Portal、offline reinstall、two-host production exclusion 和 packed types 均通过。
- F-001–F-044 逐项 provisional PASS 的证据映射完整写入 `artifacts/FINAL-ACCEPTANCE-REPORT.md`；G09-001–G09-014 均为 writer provisional PASS。

未交付：独立 agent 最终复审、npm publish、registry cutover 与 Goal 10 均未执行。

关键命令与结果：

- Node 20/22 clean archives `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm check:package`, `pnpm run audit`, `pnpm audit`, `pnpm check:docs`, `pnpm check:tarball` → PASS；证据 `logs/171-*`～`logs/188-*`。installed `pnpm exec agent-feedback audit` 另在 generic packed blank host PASS。
- source `pnpm --dir playgrounds/react-vite test:e2e && build` → PASS（3/3）；Extension Demo 等价命令 → PASS（1/1 + HMR）；证据 `logs/213-*`～`logs/216-*`。
- packed blank frozen install/E2E/build/six imports/CLI/audit/scans → PASS（7/7 + SIGTERM）；证据 `logs/189-*`～`logs/195-*`。
- packed Portal frozen install/typecheck/test/test:sdk/build/real E2E/CLI/production browser → PASS（23/58、9/30、2/2）；offline frozen reinstall 后 typecheck/tests/build → PASS；证据 `logs/196-*`～`logs/212-*`。缺少显式测试凭据的首次 E2E `logs/202-*` 为预期配置 FAIL，配置后 `logs/203-*` PASS。
- exact tarball `sha256sum -c`, manifest diff, forbidden-member and 200000-byte size gate → PASS；证据 `logs/221-*`。

Acceptance criteria：G09-001～G09-010、G09-012～G09-014 PASS；G09-011 writer provisional PASS，必须由独立 agent 重跑后才可转为 final acceptance。F-001～F-044 writer provisional PASS，详见仓外 report；无 FAIL/BLOCKED/NOT RUN。

Known issues within this Goal: 无尚未修复的具体 Goal 09 failure。唯一剩余工作是明确要求的独立审计，而非 writer acceptance。

下一可靠起点：package `5feabb0fdcc9f71843efddd2d26b8ff06303f90f`、本文件的 Goal 09 plan commit、exact tarball SHA-256 `fbd9de0d4e81f738eff9a20b632cce348476ab4f8d0595631c04c87ea2701c54`。Goal 10 未开始。

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
