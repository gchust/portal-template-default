# Suggested AGENTS.md snippet

将以下短规则放到父工作区或两个仓库最接近该工作的 `AGENTS.md`。不要把全部 Goal 内容复制进 AGENTS.md。

```md
## Agent Feedback NPM extraction

For Agent Feedback extraction work, read `00-project-constants.md`,
`00-shared-contract.md`, and only the currently assigned numbered Goal under
`docs/exec-plans/agent-feedback-npm-extraction-v1/`.

Complete and independently verify one Goal before starting the next. Keep its
Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective
current.

The standalone package must not import or hard-code NocoBase. React Grab
primitives are the sole generic perception engine. Built-in and third-party
toolbar actions must use the same public Extension Registry. Do not add legacy
schema compatibility, a fallback engine, basename source guessing, workspace-
only package behavior, or generic fixes inside the NocoBase adapter.

Use packed tarballs to verify package boundaries. Report every acceptance
criterion as PASS, FAIL, or BLOCKED with fresh evidence.
```
