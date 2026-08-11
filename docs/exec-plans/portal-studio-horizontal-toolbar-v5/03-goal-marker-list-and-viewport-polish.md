# Goal 03 — Stable Marker/List Semantics and Viewport Polish

## Outcome

Markers, annotation-list entries and anchored surfaces remain understandable
while items are completed, filtered, hidden, scrolled, edited and copied.

## Preconditions

Goals 01–02 are complete.

## Required implementation

### A. Stable human numbering

Derive display numbers from full task annotation order, not the filtered Open
list.

Example:

```text
full order: 1 Open, 2 Completed, 3 Open
Open view: 1 and 3
All view: 1, 2 and 3
Copy Open: Annotation 1 and Annotation 3
```

### B. Presentation-only global visibility

Confirm the toolbar Eye/EyeOff only toggles `markersVisible` and never rewrites
all annotations. Keep per-item hidden state separate if retained.

### C. Marker usability

- visual marker approximately 20–22 px;
- hit target approximately 28–32 px;
- keyboard focus and localized label;
- clicking opens the existing editor;
- Multi item temporarily highlights all targets;
- completed styling appears in All;
- unresolved item remains in List without a false page anchor.

### D. Region scrolling

Persist/render region anchors in document-aware coordinates so they follow
content scrolling and remain route-gated.

### E. One anchored placement utility

Use/reuse one viewport-aware placement path for:

- toolbar tooltips;
- Help popover;
- List panel;
- target composer;
- marker editor;
- Copy fallback/toast;
- confirmations.

Handle toolbar drag, resize and narrow viewport.

### F. List behavior polish

- clicking an item scrolls/highlights/focuses target when possible;
- default Open hides completed;
- All shows completed and Reopen;
- Remove completed deletes only completed;
- list internal scroll does not move the page unexpectedly;
- panel stays anchored after Dock movement or closes predictably during drag;
- stable numbering is shared by marker/list/editor/Copy.

## Tests and acceptance

Add unit/component/Playwright evidence for:

- stable numbers across Open/All;
- global visibility causes no task mutation;
- per-item hidden independence;
- target scroll/highlight;
- region follows scroll;
- marker hit target/focus;
- every anchored surface near all viewport edges;
- 375×667 List and composer;
- no page overflow;
- current route gating.

Acceptance G03-01 through G03-10 map to those behaviors. Preserve Goal 01/02
and production exclusion. Do not start Goal 04.
