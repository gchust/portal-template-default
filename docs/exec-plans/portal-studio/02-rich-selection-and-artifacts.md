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

- **Progress:** (milestone status + evidence paths)
- **Surprises & Discoveries:** (e.g. marquee pitfalls, attribute leak vectors,
  computed-style cost)
- **Decisions:** (append to contract §13)
- **Outcomes & Retrospective:** (filled at Goal end)

## Handoff to Goal 03

Goal 03 consumes the redaction/artifact machinery: diagnostics attach to the
same artifact (schema v3) with the same redaction and size discipline, and the
screenshot capture path becomes the basis of the `current screenshot` command.
