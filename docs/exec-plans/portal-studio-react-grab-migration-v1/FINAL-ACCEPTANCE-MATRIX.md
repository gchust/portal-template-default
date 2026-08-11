# Final acceptance matrix

This matrix is evaluated only after Goal 06. Every row must be PASS with concrete evidence.

| ID | Final condition | Required evidence |
|---|---|---|
| F-001 | `react-grab` is pinned exactly and only imported via `react-grab/primitives` | package/lock diff + import grep |
| F-002 | Exactly one direct-import owner exists across source/tests/E2E/scripts | whole-repository `rg` output showing only `src/studio/inspection/react-grab-engine.ts` |
| F-003 | Full React Grab default UI never imports or mounts | source grep + production/browser test |
| F-004 | No direct `element-source` dependency/import | package/lock/source grep |
| F-005 | No private React Fiber access remains | zero-result grep for `__reactFiber$`, Fiber helpers |
| F-006 | No Vite component-name/source regex resolver remains | zero-result grep + removed tests |
| F-007 | Task schema is v6 only; v1–v5 are rejected, not migrated | schema tests + CLI/browser error test |
| F-008 | Pick uses React Grab hit testing and saves accurate source context | Playwright artifact + source assertions |
| F-009 | Multi uses the same engine and saves one annotation with N targets | Playwright JSON assertion |
| F-010 | Area uses React Grab point sampling and semantic dedupe | region fixture test + bounded target count |
| F-011 | SVG click selects the meaningful control rather than raw `path` | Playwright fixture |
| F-012 | transparent overlay is skipped | Playwright fixture |
| F-013 | open Shadow DOM hit testing, selector and marker rehydration work | Playwright fixture |
| F-014 | same-origin iframe hit testing, bounds and selector rehydration work | Playwright fixture |
| F-015 | source file, line, column and stack are present for all test-owned React fixtures | source benchmark report |
| F-016 | source paths are workspace-relative and never point to `node_modules` or outside root | sanitizer tests |
| F-017 | selector ambiguity or deterministic fingerprint mismatch never reattaches a marker to the wrong target; it becomes unresolved | selector/fingerprint unit matrix + E2E |
| F-018 | Freeze preserves hover/popover state and always unfreezes on every exit path | Playwright + unit cleanup tests |
| F-019 | current toolbar/list/annotation/status/Copy UX has no regression | existing + updated Playwright suite |
| F-020 | Agent complete/reopen/list commands still work | process-level CLI smoke |
| F-021 | diagnostics, screenshot and revision behavior remains valid | focused tests + E2E |
| F-022 | production build contains no Portal Studio or React Grab runtime | build + dist grep + endpoint 404 probes |
| F-023 | redaction and endpoint abuse tests pass | test logs |
| F-024 | no runtime fallback/legacy branch remains | `pnpm studio:inspection:audit` + zero-result grep + independent semantic review |
| F-025 | old active tasks receive explicit unsupported-schema handling | browser + CLI tests |
| F-026 | active docs describe only v6/single-engine behavior; superseded plans are archived | docs audit |
| F-027 | dependency/license provenance is recorded | third-party note |
| F-028 | clean install, typecheck, tests, build and E2E all pass | clean-worktree command log |
