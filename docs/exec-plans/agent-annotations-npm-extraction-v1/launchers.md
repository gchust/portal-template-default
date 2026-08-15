# Copy-ready Codex launchers

每次只复制当前阶段的 launcher。路径假设本 Goal 套件位于父工作区：

```text
docs/exec-plans/agent-annotations-npm-extraction-v1/
```

或你已经将这些文件复制到两个仓库都可访问的位置。

## 通用 Plan 模板

```text
/plan Read:
- docs/exec-plans/agent-annotations-npm-extraction-v1/00-project-constants.md
- docs/exec-plans/agent-annotations-npm-extraction-v1/00-shared-contract.md
- docs/exec-plans/agent-annotations-npm-extraction-v1/<CURRENT-GOAL>.md

Inspect the actual two-repository workspace and current HEADs. Produce a
criterion-by-criterion repository adaptation for this Goal only. Map every
acceptance criterion to concrete files, commands, browser/package evidence,
and rollback boundaries. Do not modify code. Do not start a later Goal.
```

## 通用独立复核模板

```text
Independently re-review the current Goal. Do not trust the previous completion
claim or its test summary. Read the shared contract and the current Goal,
inspect both repository diffs, rerun the required commands and artifact
checks, and fix issues that are inside this Goal. Mark every acceptance
criterion PASS, FAIL, or BLOCKED with fresh evidence. Do not start the next
Goal.
```

## Goal 01

```text
/goal Complete Agent Annotations NPM Extraction Goal 01.

Read 00-project-constants.md, 00-shared-contract.md, and
01-goal-baseline-and-package-skeleton.md. Establish the two-repository
workspace, a buildable/packable standalone package skeleton, and a fresh
migration baseline without moving Studio code or changing Default Portal
runtime behavior.

Continue until every G01 criterion has concrete command and packed-tarball
evidence. Keep Progress, Discoveries, Decision Log, and Outcomes current. If
the sibling repository cannot be created or the tarball only works through a
workspace link, stop with exact evidence. Do not start Goal 02.
```

## Goal 02

```text
/goal Complete Agent Annotations NPM Extraction Goal 02.

Read the project constants, shared contract, and
02-goal-generic-core-and-schema.md. Move only the host-neutral pure core into
the standalone package under the new agent-annotations.task.v1 contract. Do not
add PortalStudio compatibility, browser UI, Vite server, or NocoBase coupling.

Continue until every G02 criterion has fresh tests, build, type-consumer and
packed-artifact evidence. Do not start Goal 03.
```

## Goal 03

```text
/goal Complete Agent Annotations NPM Extraction Goal 03.

Read the project constants, shared contract, and
03-goal-generic-browser-runtime.md. Deliver the complete generic React browser
runtime in a blank React/Vite Playground using the package's in-memory testing
transport. Preserve the accepted horizontal annotation UX and use React Grab
as the sole perception engine. The package must have no NocoBase coupling.

Do not implement the Vite file server or extension registry yet. Continue
until every G03 criterion has unit/component, real-browser, build and tarball
evidence. Do not start Goal 04.
```

## Goal 04

```text
/goal Complete Agent Annotations NPM Extraction Goal 04.

Read the project constants, shared contract, and
04-goal-vite-server-cli-packed-slice.md. Extract the serve-only Vite plugin,
file task store, revision/evidence endpoints, CLI and read-only MCP into the
standalone package. Prove the full browser-to-file-to-Agent loop from a packed
tarball installed in a blank fixture, with production exclusion.

Do not start toolbar pluginization or NocoBase integration. Continue until
every G04 criterion has fresh process, browser, package and build evidence.
```

## Goal 05

```text
/goal Complete Agent Annotations NPM Extraction Goal 05.

Read the project constants, shared contract, and
05-goal-extension-registry.md. Implement the public Client Extension Registry
and convert every built-in toolbar action to the same public contribution API
used by an external Demo Extension. Enforce deterministic ID/shortcut
conflicts and HMR disposal. Do not leave a hidden built-in switch path.

Continue until every G05 criterion has unit, consumer, browser, HMR and packed
fixture evidence. Do not start Goal 06.
```

## Goal 06

```text
/goal Complete Agent Annotations NPM Extraction Goal 06.

Read the project constants, shared contract, and
06-goal-source-and-protocol-reliability.md. Fix source path canonicalization,
remove all basename guessing, prove exact file/line/column and source revision,
align CLI/MCP with task schema v1, and make the architecture audit detect all
forbidden fallback/host-coupling patterns.

No NocoBase-side patch is allowed. Continue until every G06 criterion has
fresh unit, E2E, process and audit-failure evidence. Do not start Goal 07.
```

## Goal 07

```text
/goal Complete Agent Annotations NPM Extraction Goal 07.

Read the project constants, shared contract, and
07-goal-browser-evidence-and-runtime-reliability.md. Fix screenshot mapping and
viewport behavior, cross-realm iframe/Shadow DOM marker recovery, freeze,
region pruning, marker observers and Studio-root ignore behavior inside the
standalone package.

Do not add generic fixes to Default Portal. Continue until every G07 criterion
has real-browser and performance evidence plus build/tarball regression
results. Do not start Goal 08.
```

## Goal 08

```text
/goal Complete Agent Annotations NPM Extraction Goal 08.

Read the project constants, shared contract, and
08-goal-nocobase-thin-integration-and-delete-embedded.md. Install the packed
standalone package into Default Portal, implement only the thin NocoBase Client
Extension, cut over all behavior, and physically delete the embedded Studio
source, scripts, generic tests and obsolete active plans.

Do not copy generic implementation into the NocoBase adapter. Continue until
every G08 criterion has clean install, unit, E2E, CLI, build and boundary-audit
evidence. Do not start Goal 09.
```

## Goal 09

```text
/goal Complete Agent Annotations NPM Extraction Goal 09.

Read the project constants, shared contract,
FINAL-ACCEPTANCE-MATRIX.md, and
09-goal-release-candidate-clean-room.md. Produce a clean-room packed release
candidate without publishing it. Re-run all package, generic fixture,
extension fixture and packed NocoBase validations, and mark F-001 through
F-044 from fresh evidence.

Do not claim completion if any item is FAIL, BLOCKED or NOT RUN. Do not use npm
credentials or start Goal 10.
```

## Goal 10 — only after human publication

```text
/goal Complete Agent Annotations NPM Extraction Goal 10.

Read the project constants, shared contract, and
10-goal-post-publish-registry-cutover.md. First prove that the exact published
version exists with npm view. Then replace every local/tarball dependency in
Default Portal with the registry version and prove a clean clone works without
the sibling package repository.

If the version is not published or does not match the release candidate, stop
BLOCKED without changing the dependency. Complete only when F-045 through
F-048 have fresh evidence.
```
