# Goal 01 — Establish the two-repository workspace, baseline, and publishable skeleton

## 单一完成状态

`agent-feedback/` 已成为独立 Git 仓库，能 build、typecheck、test、`pnpm pack` 并从 tarball 导入最小公开入口；当前 Default Portal 的 Studio 行为和生产源码没有改变，同时已有可重复的迁移基线报告。

本 Goal 不迁移 Studio 代码，不设计完整 Extension Registry，不修功能 Bug。

## 开始前读取

- `00-project-constants.md`
- `00-shared-contract.md`
- 当前 Default Portal 的 `AGENTS.md`、`package.json`、`vite.config.ts`
- 当前 `src/studio/**`、scripts 和相关测试清单

## 范围

### 必须完成

1. 确认父工作区包含两个 sibling 路径；若 `agent-feedback/` 不存在则创建并 `git init`。
2. 创建独立 package skeleton：
   - `package.json`；
   - `pnpm-lock.yaml`；
   - `tsconfig.json`；
   - `tsdown.config.ts`；
   - `src/client/index.ts`；
   - `src/vite/index.ts`；
   - `src/extension/index.ts`；
   - `src/types/index.ts`；
   - `src/cli/index.ts`；
   - `README.md`、`LICENSE`、`.gitignore`。
3. 精确 pin 执行时使用的 `tsdown`、TypeScript、Vitest、Playwright、`publint`、`@arethetypeswrong/cli` 和 React/Vite 测试依赖；禁止 caret 用于关键 build/release validation tool。
4. 配置 ESM-only 多入口 build 和 `.d.ts`。
5. 配置 `exports`、`bin`、`files`、peer dependencies、`peerDependenciesMeta.vite.optional=true`、Node engines。
6. 建立一个最小 `playgrounds/react-vite`，此阶段只验证 package import，不实现 Studio。
7. 生成 `MIGRATION-BASELINE.md`：
   - 当前模板 commit/branch；
   - Studio 文件数和行数；
   - 直接 NocoBase 耦合；
   - 当前公开 scripts；
   - 可运行的现有 test/build 命令及结果；
   - 当前已知 Bug 列表。
8. 记录 Default Portal 初始 `git status` 和 `git diff --stat`。
9. `pnpm pack`，在临时 Fixture 中从 `.tgz` 安装并 import 所有子路径；运行 CLI `--help`。

### 禁止

- 不移动 `src/studio/**`。
- 不修改 Default Portal 的 Studio 运行行为。
- 不使用 workspace link 作为 tarball smoke 的替代。
- 不发布到 NPM。
- 不把 package repo 建在 Default Portal 的永久子目录。

## 验收标准

- **G01-001** 两个路径分别拥有自己的 `.git`。
- **G01-002** package metadata 与项目常量完全一致。
- **G01-003** `pnpm install --frozen-lockfile` 在 package repo 成功。
- **G01-004** `pnpm typecheck`、`pnpm test`、`pnpm build` 成功。
- **G01-005** dist 包含四个声明的公开子路径和 CLI。
- **G01-006** `pnpm pack --json` 成功，tarball 清单无 Playground source、测试、临时文件和 Default Portal 文件。
- **G01-007** 临时 Fixture 从 tarball 安装后能 import `.`, `/vite`, `/extension`, `/types`。
- **G01-008** tarball 安装后的 `agent-feedback --help` 退出码为 0。
- **G01-009** package dependency graph 中无 `@nocobase/*`。
- **G01-010** Default Portal 的 production source diff 为零；只允许添加本套 ExecPlan 或 baseline 证据。
- **G01-011** `MIGRATION-BASELINE.md` 包含真实命令结果，不复制历史完成声明。
- **G01-012** 未开始任何 Goal 02+ 功能。

## 必须运行

```bash
# package repo
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm pack --json

# tarball fixture
pnpm install --frozen-lockfile
pnpm test
node -e "Promise.all([import('@gchust/agent-feedback'), import('@gchust/agent-feedback/vite'), import('@gchust/agent-feedback/extension'), import('@gchust/agent-feedback/types')]).then(()=>console.log('imports ok'))"
pnpm exec agent-feedback --help

# both repos
git status --short
git diff --stat
```

## 阻塞停止条件

- 无法在父工作区创建 sibling repo；
- package manager 或 Node 版本无法满足常量；
- packed tarball 只能依赖 workspace source 才能 import。

不得通过把 package 建进模板内部来规避。

## Living ExecPlan

### Progress

- [x] 2026-08-12T10:42Z 完整读取 `AGENTS.md`、冻结常量、共享合同和 Goal 01；确认只执行 Goal 01。
- [x] 2026-08-12T10:45Z 记录模板初始状态：`feat-agent-feedback` @ `cdfbfb4c959ee660379b7510d89ce506c15f4817`；已有意图内未提交项为 `AGENTS.md` 和本 ExecPlan 目录，production source diff 为零。
- [x] 2026-08-12T10:47Z 确认 `/root/work/portal-template-default/.git` 存在且 `/root/work/agent-feedback` 尚不存在；Node `v22.22.0`、pnpm `10.28.1` 满足冻结常量。
- [x] 2026-08-12T10:50Z 盘点当前 Studio、scripts、测试、直接 NocoBase 耦合和已知缺陷，供新仓库 `MIGRATION-BASELINE.md` 使用。
- [x] 2026-08-12T10:53Z 创建 `/root/work/agent-feedback/.git`（`main`）及冻结 metadata、ESM-only 多入口、声明输出、CLI、最小测试和 React/Vite Playground。
- [x] 2026-08-12T10:56Z 首次 `pnpm install` 生成 lockfile；依据唯一具体失败，将 Playground 从 package `tsconfig` 的 typecheck 范围移出，随后 package typecheck/test/build 全部通过。
- [x] 2026-08-12T11:00Z `pnpm pack --json --out /tmp/agent-feedback-g01-fixture.1vDFBq/agent-feedback.tgz` 成功，清单仅含 dist、LICENSE、README、package.json。
- [x] 2026-08-12T11:00Z 新建 clean Fixture，并在第二个无源码副本 `/tmp/agent-feedback-g01-offline.Jv96by` 用 tarball + frozen lockfile + offline install 验证测试、四入口 import 和 CLI help。
- [x] 2026-08-12T11:01Z 模板 typecheck/build 通过；并行 focused suite 的两个 5s timeout 已以 15s focused rerun 证实 2 files / 11 tests PASS，原始失败仍如实写入 baseline。
- [x] 2026-08-12T11:05Z 逐项记录 G01-001–G01-012 的最终新鲜证据。
- [x] 2026-08-12T11:08Z standalone package checkpoint commit：`3ac5528ecc0c7b67380782b6adcd66c021c98f01`。
- [x] 2026-08-12T11:09Z Default Portal plan/baseline checkpoint commit：`3d8dedd4eb13dac9cb048559db217d31364c6f02`；production source 未进入 commit；SHA 记录 commit 为 `23340b7baf2f2d8f5f25b6a0e9907aa12866e354`。

### Surprises & Discoveries

- 计划中的“约 15K 行”在当前 HEAD 实测为 `src/studio/**` 44 个 TypeScript/TSX 文件、13,903 行；baseline 使用实测值，不沿用估算。
- 当前模板工作树在 Goal 01 开始前已经包含未提交的 `AGENTS.md` 与完整 ExecPlan 目录；两者属于本迁移计划输入，当前 production source diff 仍为零。
- `tsdown` build 与 `publint` 并行启动时，`publint` 恰逢 clean 后、输出完成前而报告 dist 缺失；改为合同要求的串行 build → package validation 后通过，未改代码绕过。
- focused Studio suite 与 package/Portal build 并行运行时有 2 个进程型测试超过默认 5s；相同两个文件以 15s timeout 隔离重跑，11/11 通过。Baseline 同时保留首次 FAIL 和重跑 PASS。

### Decision Log

- 2026-08-12：package skeleton 只实现可导入的空公开入口和 `--help` CLI；Extension Registry、schema 和运行时功能明确留给 Goal 02+，避免提前设计。
- 2026-08-12：采用当前 Node 可运行的精确工具版本；所有关键 build/release validation tool 和 React/Vite 测试依赖均精确 pin，不使用 caret。
- 2026-08-12：`@arethetypeswrong/cli` 使用 `--profile esm-only`，因为 ESM-only 是冻结模块格式；仍保留并通过 Node ESM 与 bundler 两种解析检查，不伪造 CommonJS 支持。
- 2026-08-12：packed Fixture 额外复制到第二个临时目录并用 `--offline --frozen-lockfile` 安装，以证明解析只依赖 `.tgz` 与 store，不依赖 `/root/work/agent-feedback` workspace source。

### Outcomes & Retrospective

#### 实际交付

- `/root/work/agent-feedback` 是独立 Git repo，包含冻结 package metadata、pnpm lockfile、ESM-only tsdown 五入口 build、四个公开 exports、CLI、最小 Vitest、React/Vite import Playground、README、MIT LICENSE 和 `MIGRATION-BASELINE.md`。
- 发布边界经 `publint`、ATTW ESM-only profile 和 `pnpm pack --json` 验证；最终 tarball 为 `/tmp/agent-feedback-g01-fixture.1vDFBq/agent-feedback-final.tgz`。
- clean Fixture `/tmp/agent-feedback-g01-offline.Jv96by` 只携带 tarball、fixture files 和 lockfile，在 `--offline --frozen-lockfile` 下安装成功并通过测试、四入口动态 import 和 CLI help。
- Default Portal production source 未改变；`pnpm typecheck` 和 `pnpm build` 新鲜通过。

#### 未交付

- Goal 02–10 的 schema、generic core、browser runtime、Vite server、Extension Registry、source/protocol fixes、browser evidence、NocoBase cutover、release candidate 和发布后迁移全部未开始。
- 未 push、publish、创建 remote repository 或修改 Default Portal runtime。

#### 本地 checkpoint commits

- agent-feedback: `3ac5528ecc0c7b67380782b6adcd66c021c98f01` (`chore: establish Agent Feedback package skeleton`)
- portal-template-default: `3d8dedd4eb13dac9cb048559db217d31364c6f02` (`docs: add Agent Feedback extraction plan`) and `23340b7baf2f2d8f5f25b6a0e9907aa12866e354` (`docs: record Goal 01 checkpoint SHAs`)

#### 运行过的命令及结果

- `node --version && pnpm --version` → PASS：`v22.22.0`、`10.28.1`。
- package `pnpm install --frozen-lockfile` → PASS：lockfile up to date，exit 0。
- package `pnpm typecheck` → PASS，exit 0。
- package `pnpm test` → PASS：1 file / 1 test，exit 0。
- package `pnpm build` → PASS：tsdown 生成 18 个 dist 文件，四公开子路径和 CLI 均有 JS/声明（CLI 有声明和可执行 JS），exit 0。
- package `pnpm check:package` → PASS：publint `All good!`；ATTW ESM-only 的 Node ESM/bundler 全绿，exit 0。
- Playground `pnpm --dir playgrounds/react-vite install --frozen-lockfile && ... build` → PASS：27 modules transformed，exit 0。
- `pnpm pack --json --out /tmp/agent-feedback-g01-fixture.1vDFBq/agent-feedback-final.tgz` → PASS：22 files，仅 dist、LICENSE、MIGRATION-BASELINE.md、package.json、README.md。
- clean Fixture `pnpm install --frozen-lockfile --offline && pnpm test` → PASS：tarball install；`packed fixture ok`。
- clean Fixture 四入口 `node -e "Promise.all([...imports])"` → PASS：`imports ok`。
- clean Fixture `pnpm exec agent-feedback --help` → PASS：打印版本、Usage、描述，exit 0。
- package `pnpm list --depth Infinity --json` + dependency/lockfile scan → PASS：`nocobaseHits: []`。
- Portal `pnpm typecheck` → PASS，exit 0。
- Portal `pnpm build` → PASS：5,952 modules transformed，exit 0。
- Portal focused Studio suite first concurrent run → FAIL：644 PASS、2 timeout；隔离 rerun命令 `pnpm exec vitest run tests/logic/portal-studio/print-cli.test.ts tests/logic/portal-studio/cli-smoke.test.ts --testTimeout=15000 --reporter=verbose` → PASS：2 files / 11 tests。
- 两仓 `git status --short`、`git diff --stat` 和 Portal production-path diff scan → PASS：package 只有 Goal 01 files；Portal 只有 `AGENTS.md` 与 ExecPlan，production diff 空。

#### Acceptance criteria

- **G01-001 PASS** — 两个路径各自存在 `.git`；`git rev-parse --show-toplevel` 分别解析到 `/root/work/portal-template-default` 与 `/root/work/agent-feedback`。
- **G01-002 PASS** — `package.json` 的 name/displayName/description/version/license、Node engine、ESM、React/ReactDOM/Vite peers、react-grab `0.1.50`、exports 与 CLI 均与冻结常量一致。
- **G01-003 PASS** — package `pnpm install --frozen-lockfile` exit 0。
- **G01-004 PASS** — package typecheck、1-test Vitest suite 和 tsdown build 均 exit 0。
- **G01-005 PASS** — dist 包含 `client`、`vite`、`extension`、`types` 的 JS/`.d.ts`，以及 mode 755 的 `cli/index.js` 和 CLI declaration。
- **G01-006 PASS** — `pnpm pack --json` exit 0；22-file manifest 无 Playground source、tests、临时文件或 Default Portal 文件。
- **G01-007 PASS** — second clean/offline Fixture 从 final tarball 安装后，`.`、`/vite`、`/extension`、`/types` 全部 import 成功。
- **G01-008 PASS** — tarball Fixture 的 `pnpm exec agent-feedback --help` exit 0。
- **G01-009 PASS** — package dependency graph JSON 与 package/lockfile scan 的 `@nocobase/*` 命中为零。
- **G01-010 PASS** — `git diff --name-only -- src scripts vite.config.ts package.json pnpm-lock.yaml` 无输出；Portal runtime behavior 未改，typecheck/build 通过。
- **G01-011 PASS** — `MIGRATION-BASELINE.md` 记录当前 SHA/branch、44 files/13,903 lines、耦合、scripts、真实 PASS/FAIL/rerun 结果和已知问题。
- **G01-012 PASS** — package 仅为空入口/CLI help/import smoke；Goal 02–10 功能与模板切换均未开始。

#### 下一 Goal 的可靠起点

独立包可以从精确 lockfile 重建并从 tarball clean-install；Default Portal 仍完整运行现有 embedded Studio。下一 Goal 必须先经 orchestrator 独立审查和明确 promotion，且应从全新 schema/core 开始，不复用旧 schema 或 workspace link。

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
