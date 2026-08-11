# Portal Studio Goal 01 — external independent review findings

Scope: current uncommitted tree in `/root/work/portal-template-default`, branch `feat-agent-feedback`. These findings were independently reproduced against the current files after the Pi Auditor approval. Fix only Goal 01; do not start Goal 02 and do not commit.

## Confirmed blockers

1. **P1 — Pick is not strictly single-target.** `src/studio/toolbar.tsx` still passes `event.shiftKey` into an additive `addOrReplace` path for Shift+click / Shift+Enter, and component/E2E tests preserve this old path. Shared contract §6 requires Pick to be strictly one target and Multi to be the only multi-target path. Remove additive Pick behavior, update copy/status text, and replace the old tests with strict-single regressions.

2. **P2 — Open/All filtering renumbers annotations and markers.** `StudioAnnotationListPanel.tsx` and the marker render path call `annotationDisplayNumber(visibleAnnotations, ...)`. Shared contract §9/§12 requires stable human numbers across Open/All filtering. Use the full `annotations` list for numbering and test an earlier completed item plus a later open item.

3. **P2 — The non-modal expanded toolbar traps Tab inside the Studio root.** Remove the `open`-wide focus-trap effect in `toolbar.tsx`; retain focus traps only for genuine dialogs. Add a regression proving Tab can leave the last toolbar control and reach page content.

4. **P2 — Help omits its own `?` shortcut.** `STUDIO_HELP_ORDER` lacks `help`, contrary to Goal 01 §F and shared contract §8 (“every supported shortcut”). Include and test it. Derive feature/help order where possible to avoid redundant order arrays.

5. **P2 — Collapsed Expand lacks the required custom tooltip.** Wrap the ChevronDown Expand action in `StudioActionTooltip` with localized “Expand toolbar” + Mod+Alt+K. Add component and real-browser coverage for collapsed Expand and every expanded actionable icon, not only Pick.

6. **P2 — Open count is inaccessible.** The visual count/99+ is `aria-hidden` while the chip accessible name stays only “Annotation tools”. Add a localized accessible name/status that exposes 1 and 99+, with assertions.

7. **P2 — Manual Copy fallback cannot restore focus.** `copyButtonRef.current?.focus()` remains, but the ref is no longer attached to the actual Copy button after extraction to `StudioToolbarShell`. Thread the ref through and bind it; test Esc closes fallback and restores Copy focus.

8. **P2 — Unresolved list selection creates an invisible editor state.** Unresolved items unconditionally call `onItemSelect`, setting `editorAnnotationId`; no anchor/editor renders, and the first Esc is consumed clearing invisible state. Do not expose/trigger marker-editor selection for unresolved items, while preserving edit/complete/reopen/delete. Test one Esc closes the list.

9. **P2 — Keyboard dock movement leaves Help/List at stale anchors.** Arrow-key movement does not close auxiliary panels and anchors are only remeasured on `[auxPanel, open]`. Treat keyboard movement like drag: close transient tooltips/aux panels (or re-anchor synchronously), with regression evidence.

10. **Typed-registry cleanup.** Remove the `as unknown as HotkeyDef` escape hack; use a proper display-shortcut type. Derive order arrays and remove or use dead exports (`studioAction`, `actionTooltipText`, currently unused). Preserve one typed source of truth.

## Evidence gaps to close

- Actually exercise and capture both English and Chinese states.
- Assert each action tooltip in a real browser.
- Add focused logic tests for changed placement/edge behavior.
- Run scoped ESLint for every touched source/test/E2E file, `npx tsc --noEmit`, full `npx vitest run`, full `npx playwright test`, `pnpm build`, and the exact production Studio-code exclusion check. Do not use pipelines that mask upstream exit codes.
- Update `portal-studio-g01-report.md` with findings, fixes, exact results, screenshots, and G01-01..G01-20 PASS/FAIL/BLOCKED.

