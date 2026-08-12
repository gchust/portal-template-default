# Copy-ready Codex Goal 01

Before implementation, use the following fixed decisions unless the repository owner changes them now:

```text
package: @gchust/agent-feedback
repo: agent-feedback
version: 0.1.0-alpha.0
license: MIT
Node: >=20
package manager: pnpm
bundler: tsdown
format: ESM-only
React peer: ^19.0.0
Vite peer: ^6.0.0
react-grab: 0.1.50
```

Final architecture: a standalone generic React/Vite package and a separate
NocoBase Default Portal repository. The package must eventually contain the
browser annotation runtime, React Grab inspection, task/revision protocol,
extensible toolbar Registry, Vite plugin, file store, CLI and read-only MCP.
It must not import or hard-code NocoBase. Default Portal must eventually keep
only a thin NocoBase extension and one Vite plugin registration.

For this Goal only, do not migrate any Studio code or change runtime behavior.

/goal Establish a two-repository workspace with `agent-feedback/` and
`portal-template-default/`, create an independently buildable and packable
`@gchust/agent-feedback` skeleton, and record a fresh baseline of the current
Default Portal Studio. Verify the package through a real packed tarball rather
than a workspace link, while preserving the Default Portal production source
unchanged.

Required outcomes:

1. `agent-feedback/` is an independent Git repository next to the current
   Default Portal repository. If the sandbox cannot create/write the sibling
   repository, stop BLOCKED; do not create the permanent library inside the
   template.
2. Create package metadata, ESM-only multi-entry tsdown build, declarations,
   exports for `.`, `/vite`, `/extension`, `/types`, and an `agent-feedback`
   CLI bin.
3. Add a minimal React/Vite Playground that only proves package imports in this
   Goal.
4. Pin build/test tool versions in the lockfile. React/React DOM are peers;
   react-grab is the package's exact dependency. No NocoBase dependency is
   allowed.
5. Run `pnpm pack --json`; install the resulting tarball into a temporary
   fixture with no workspace link; import all public subpaths and run
   `agent-feedback --help`.
6. Create `MIGRATION-BASELINE.md` with the actual Default Portal branch/commit,
   Studio file/line inventory, direct NocoBase couplings, current scripts,
   current tests/build commands and freshly observed results, plus known bugs.
7. The Default Portal production diff must remain zero except for task-plan or
   baseline evidence files.
8. Do not move `src/studio/**`, design the Extension Registry, fix Studio bugs,
   integrate NocoBase, or start a later Goal.

Acceptance criteria:

- G01-001 two independent `.git` directories;
- G01-002 metadata matches the fixed decisions;
- G01-003 package frozen install succeeds;
- G01-004 package typecheck/test/build succeeds;
- G01-005 all public exports and CLI exist in dist;
- G01-006 tarball contents exclude source tests, playground source, temporary
  files and Default Portal files;
- G01-007 tarball-installed fixture imports every public subpath;
- G01-008 tarball-installed CLI `--help` exits 0;
- G01-009 package dependency graph contains no `@nocobase/*`;
- G01-010 Default Portal runtime/production source is unchanged;
- G01-011 baseline contains fresh command evidence;
- G01-012 no Goal 02+ work was started.

Maintain Progress, Surprises & Discoveries, Decision Log, and Outcomes &
Retrospective while working. Continue until every criterion is PASS. If a
required command cannot run, report FAIL/BLOCKED with the command, output,
attempted fixes and smallest input needed; do not claim completion.
