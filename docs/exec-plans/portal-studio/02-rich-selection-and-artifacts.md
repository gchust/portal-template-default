# ExecPlan 02 — Rich Selection & Complete Task Artifacts

> Contract: `00-shared-contract.md`. Self-contained for Goal 02. Do **not**
> start Goal 03 until this Goal's single end-state is achieved and
> independently reviewed.

## Summary

Extend the Goal 01 picker and artifact from single element to multi-element and
region selections, enrich captures with DOM/computed-style/component-stack/
business context, add default redaction and size limits, initial annotated
screenshots, artifact lifecycle (replace/clear), and schema v2 — with the JSON
path fully usable without MCP.

**Depends on:** Goal 01 end-state (stable single-element → task JSON loop).
**Single end-state:** *Multi-element / region / screenshot selections form a
complete, redacted, size-bounded task artifact (schema v2), fully usable via
the JSON path alone.*

## Scope

In scope:
- Selection modes: Shift+click multi-select; drag marquee region selection
  (bounded rect); union with existing single-element mode; clear selection.
- Capture enrichment per element: DOM outline (tag/class/id/attributes),
  computed-style excerpts (bounded, curated list — never full style dumps),
  component stack + source candidates (from Goal 01 mechanism), business
  context: `data-ai-page-element` registry items, `data-nb-*` attributes where
  present (optional hints), workContext-shaped items
  (`AIWorkContextItem`-compatible `{type, id, title, content}`).
- Redaction + size limits: URLs, attributes, text, headers, tokens — unified
  redaction (baseline `redactPortalErrorText`, extended for artifacts);
  per-field and total byte caps; a redaction manifest (what was stripped) in
  the artifact; secrets never captured by default (contract §3 invariant).
- Initial annotated screenshot: capture viewport (or element clip) with
  selection markers drawn in the Shadow DOM overlay; write PNG under
  `.portal-studio/screenshots/`; artifact stores relative refs only.
- Lifecycle: task replace (new capture overwrites active task atomically),
  clear (empty/`null` state), `schemaVersion: 2` additive upgrade; the print
  command renders v1 and v2 artifacts.
- Tests: redaction unit matrix (headers, tokens, cookies, query strings,
  bodies), size-cap behavior, multi/region capture state, screenshot ref
  integrity; E2E for shift-multi + marquee + screenshot on a real page.

Out of scope (later Goals):
- console/network error capture, heartbeat, current-screenshot *command*
  (Goal 03).
- MCP, revisions/HMR semantics (Goal 04).
- Full abuse suite, bundle hardening, release docs (Goal 05).
- NocoBase upstream changes; new runtime dependencies (devDeps only if
  unavoidable, and then stop to ask first).

## Milestones

| # | Milestone | AC (observable) |
| --- | --- | --- |
| M1 | Multi/region selection | Shift+click adds/removes elements; marquee selects contained elements; selection state visible in toolbar; Esc clears/resets per mode; all keyboard-operable |
| M2 | Enriched capture | Artifact v2 contains per-element DOM outline, bounded computed-style excerpts, component/source candidates, business context items; empty-context pages still produce valid artifacts |
| M3 | Redaction + size limits | Seeded secrets (Bearer/Authorization/Cookie/token/query) never appear in artifact; caps enforced with explicit truncation markers; redaction manifest present |
| M4 | Screenshot + lifecycle | Annotated screenshot written and referenced; replace/clear commands work atomically; print shows v1+v2 |
| M5 | Tests + E2E | Unit matrix green; E2E covers multi/region/screenshot on real page; `pnpm typecheck && pnpm test && pnpm build` green |

## Acceptance criteria (Goal 02)

1. Multi-element and region selections produce one coherent schema-v2 artifact;
   single-element flow from Goal 01 still works unchanged (no regression).
2. Every capture is redacted by default and size-bounded; the manifest records
   redactions; secrets provably absent (tests grep artifact content).
3. Screenshot files exist and are referenced by relative path; broken refs fail
   the E2E.
4. Replace/clear lifecycle is atomic and idempotent; JSON path alone supports
   all of it (no MCP).
5. Keyboard + ARIA for new interactions; i18n keys for new UI in en-US/zh-CN.
6. `git diff --check` clean; no lockfile changes.

## Risks & mitigations

- **Marquee over interactive app content** (click-through, drag conflicts):
  capture-phase listeners + pointer capture inside the overlay; E2E on the
  real Users page.
- **Screenshot privacy** (other tabs' content? same-origin only, current
  viewport; redaction manifest notes it): document that screenshots are local
  dev artifacts; redaction applies to text/URLs inside JSON, and Goal 03's
  capture rules apply to any future DOM text extraction.
- **Schema drift**: additive-only rule from contract §6; v1 readers must parse
  v2 (print command contract).
- **data-nb-* scarcity**: treat as optional; never block capture on it
  (contract D-005).

## Verification commands

```bash
pnpm typecheck && pnpm test
pnpm test:e2e                       # multi/region/screenshot spec
node scripts/portal-studio-print.mjs --json   # renders v1+v2
grep -rE "Bearer |Authorization|Cookie" .portal-studio/tasks/ || echo "no secrets"   # redaction evidence
git diff --check
```

## Stop conditions

- End-state achieved → stop, request independent review + checkpoint commit;
  do **not** start Goal 03.
- A capture type cannot be redacted/size-bounded without violating the
  security invariants → stop and report minimal blocker with evidence.

## Running log (maintain during execution)

### Progress

- M1 Multi/region selection: **DONE** — `src/studio/selection.ts` (pure state:
  replace/toggle/clear/region normalize/commit with 50-element cap); toolbar
  Shift+click/Shift+Enter multi (stays in picking mode), drag marquee, Esc
  cancel; session lifecycle fix: closing the panel or starting a new session
  clears stale selections (regression-tested).
- M2 Enriched capture: **DONE** — schema v2 (additive): `elements[]`, `region`,
  `domOutline`, curated `computedStyle` excerpts (≤30 props, ≤200 chars),
  explainable candidates (`kind: fiber|dom`), business context
  (`data-ai-page-element` / `data-nb-*` → workContext-shaped items, deduped,
  ≤20); server resolves module-graph file:line candidates per element
  (≤3/name, ≤5/element, ≤40 total).
- M3 Redaction + size limits: **DONE** — client (`redact.ts`, baseline +
  bare-assignment extension) and server (`endpoint.ts`, self-contained)
  independent passes; `redaction` manifest in the artifact
  (droppedKeys/redactedValues/truncatedValues); strict caps incl. per-route
  body limits (tasks 256 KB, screenshots 2.8 MB wire / 2 MB decoded) and a
  post-backfill artifact size re-check (256 KB UTF-8).
- M4 Screenshot + lifecycle: **DONE** — zero-dep annotated viewport capture
  (SVG foreignObject + curated style inlining + secret-attribute stripping +
  marker strokes; D-010); POST `/__portal-studio/screenshots` (token, PNG
  magic + IHDR validation, atomic 0600 write, traversal-safe naming); relative
  refs in the artifact; replace/clear lifecycle with transaction-safe
  screenshot pruning (D-013).
- M5 Tests + E2E: **DONE** — 137 unit/component tests; E2E 3/3 (login
  regression + users 3 rounds + dev-page keyboard/guards).

### Surprises & Discoveries

1. The DevTools-hook/fiber findings from Goal 01 carried over; the big Goal 02
   surprise was the **SVG attribute-spacing bug**: `buildScreenshotSvg` joined
   `height="480"` and `viewBox=…` without a space, producing invalid XML that
   made `new Image()` fail to rasterize — captured only by a real-browser E2E
   (the local manual repro with correct spacing masked it). Fixed + regression
   test (DOMParser parse check).
2. **Stale-selection leak**: after a saved round, closing/reopening the panel
   kept the old selection, so a Shift+click on the same element *toggled it
   out* (counter stayed 0). Fixed by resetting the whole session on close and
   at session start.
3. **Marquee region was dropped in the draft**: `commitDraft` rebuilt the
   capture without `selection.region`, so artifacts never carried the region
   even though ≥3 elements were captured (E2E caught it; unit tests did not —
   jsdom has no layout for drag simulation).
4. **Orphaned screenshots on replace**: each round left its screenshot behind
   because only the *current* task's ref was cleaned on clear. Fixed with
   transaction-safe pruning (read before write, delete after write, same-path
   retention).
5. `pruneSupersededScreenshot` placed before the atomic write had a
   transaction hole (failed write would leave the old task without its
   screenshot; same-path reuse would delete the fresh PNG) — reordered to
   read → write → conditional delete.
6. jsdom: `getBoundingClientRect` is all-zero (no layout) — selection/region
   unit tests must mock rects; `PointerEvent` is unavailable — marquee drag is
   E2E-only.
7. The sandbox users table has a single row — E2E multi-select uses two cells
   of the same row instead of two rows.

### Decisions

- See contract Decision Log D-010 … D-013 (appended during Goal 02).

### Outcomes & Retrospective (filled at Goal end)

- End-state reached: multi/region/screenshot selections form a complete,
  redacted, size-bounded schema-v2 artifact, fully usable via the JSON path
  alone; the v1 single-pick flow is regression-free.
- Retro: real-browser E2E proved its worth three times (SVG spacing, region
  drop, orphan pruning). The transaction-ordering review caught a real hole in
  the replace lifecycle — worth keeping "write first, delete after, guard the
  path" as the standard for every multi-file lifecycle.
- Known trade-offs (documented, not defects): webfonts/media are not
  rasterized in screenshots (media stripped to avoid canvas tainting); marquee
  has no keyboard equivalent (Shift+Enter multi is the keyboard path);
  descriptor *content* of registered page elements is not client-readable (the
  provider registry is not exposed), so business context carries ids/sources
  only.

### AC checklist (Goal 02)

| AC | Evidence |
| --- | --- |
| 1. Multi/region produce one coherent v2 artifact; v1 single flow unregressed | E2E users-page 3 rounds (single → shift-multi+replace → marquee) + dev-page keyboard rounds; v1 payload still accepted (endpoint tests) and print renders v1+v2 |
| 2. Redacted + size-bounded by default; manifest present; secrets absent | redaction matrix tests (Bearer/Cookie/query/token/styles/attributes); endpoint hygiene tests incl. session-token redaction; E2E asserts artifact contains no `token`/`Bearer` and < 256 KB; manifest asserted in unit + E2E |
| 3. Screenshot files exist, referenced relatively, broken refs fail | E2E: PNG magic check, file size > 100 B, ref regex, ref-to-disk match; `parseScreenshotPayload` unit tests (magic/IHDR/2 MB exact boundary) |
| 4. Replace/clear atomic & idempotent; JSON path alone supports all | clear DELETE + replace pruning unit tests (read-only read, same-path retention, different-path removal, unsafe-target rejection); E2E clear → print exit 1 + empty screenshots dir |
| 5. Keyboard + ARIA + i18n | toolbar component tests (Enter/Shift+Enter/Esc, focus trap, aria labels); new i18n keys in en-US + zh-CN |
| 6. `git diff --check` clean; no lockfile changes | exit 0; `git status` shows only intended files; no package.json/lockfile diff |
