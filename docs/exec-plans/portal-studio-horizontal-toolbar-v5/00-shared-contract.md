# Portal Studio Horizontal Toolbar v5 — Shared Product and Engineering Contract

Status: normative for Goals 01–05.

This contract supersedes the vertical/labeled-panel interaction proposed in
Portal Studio UX Polish v4. The accepted product direction is a draggable,
horizontal, icon-first annotation toolbar that can collapse into a compact
horizontal chip. The reference image is:

`design/portal-studio-horizontal-toolbar-reference.png`

The image defines hierarchy and interaction direction, not pixel-perfect colors,
example business data, or exact Chinese copy.

## 1. Mission

Turn the existing annotation-first Portal Studio into a fast browser feedback
surface for a local Code Agent.

The primary loop is:

```text
open Portal preview
→ expand the horizontal annotation toolbar
→ Pick, Multi-select, or Select Region
→ write feedback beside the selected target
→ keep numbered markers visible
→ inspect the annotation list when needed
→ Copy open feedback to a local Code Agent
→ Agent modifies and verifies real source
→ Agent explicitly completes fixed annotations
→ completed annotations disappear from the default Open view
```

Portal Studio is not a generic visual page builder and is not an AI Agent
runtime.

## 2. Current implementation baseline

Inspect actual HEAD before editing. The reviewed implementation already has:

- dev-only Shadow DOM injection;
- draggable Dock position with persistence and viewport clamping;
- collapsed/expanded state;
- Pick, Multi and Area capture modes;
- persistent numbered annotations;
- marker-local edit/complete/reopen/delete;
- Open/All task filtering and remove-completed;
- Markdown Copy;
- typed mutation/revision handling;
- per-annotation route context;
- runtime diagnostics, screenshot and revision plumbing;
- local Agent completion commands and browser polling;
- production exclusion.

Do not rebuild those systems. Reuse them and replace only the broken or
superseded presentation path.

## 3. Accepted visual model

### 3.1 Expanded toolbar

The expanded control is one horizontal floating bar:

```text
[drag] | [Pick] [Multi] [Area] | [Copy] [Markers] | [Shortcuts] [List] | [Collapse]
```

The order is normative.

- `Shortcuts` is the penultimate **feature action**.
- `List` is the final **feature action**.
- `Collapse` is separate toolbar chrome after a divider. It does not count as a
  feature action and therefore does not violate the “List is last” rule.
- Do not place text labels permanently under or beside every icon in the
  expanded bar.
- Do not wrap the horizontal bar into two rows.
- Do not restore a large always-open vertical panel under the toolbar.

Use visual separators between these groups:

1. capture: Pick / Multi / Area;
2. task/display: Copy / Marker visibility;
3. support: Shortcut help / Annotation list;
4. toolbar chrome: Collapse.

### 3.2 Collapsed toolbar

The collapsed control is a compact horizontal chip, not a fixed circular emoji
button:

```text
[drag] [feedback icon OR open count] [Annotation tools] [Expand]
```

Rules:

- no open annotations: show an annotation/feedback icon;
- one or more open annotations: replace that icon with the open count, capped at
  `99+`;
- do not show an icon plus a second detached corner badge;
- keep a short localized label such as `Annotation tools` / `批注工具` when the
  viewport has room;
- at narrow widths the visible label may shorten or visually hide, but the
  accessible label remains complete;
- the collapsed chip is draggable by its explicit drag handle;
- clicking the chip body or Expand opens the toolbar;
- dragging must never trigger expansion;
- default state on a new page load is collapsed;
- Dock position persists; expanded/collapsed state need not persist across a
  full reload.

Preferred idle icon: `MessageSquarePlus`, after verifying the installed
`lucide-react` exports.

## 4. Icon contract

Use one meaning per icon and verify exports against the installed
`lucide-react` version before coding.

Preferred mapping:

| Action | Preferred Lucide icon |
|---|---|
| Drag | `GripVertical` |
| Idle annotation launcher | `MessageSquarePlus` |
| Pick one element | `MousePointer2` or `MousePointerClick` |
| Multi-select | `Layers3` or `Layers` |
| Select region | `ScanLine`, `Scan`, or `BoxSelect` |
| Copy open annotations | `Copy` |
| Show/hide marker layer | `Eye` / `EyeOff` |
| Shortcut help | `CircleHelp` (accepted design) or verified `Keyboard` fallback |
| Annotation list | `ListChecks` or `List` |
| Collapse | `ChevronUp` |
| Expand | `ChevronDown` |
| Complete | `CheckCircle2` |
| Reopen | `RotateCcw` |
| Delete | `Trash2` |

Forbidden mappings:

- Wrench for Pick or launcher;
- CheckCircle for Multi;
- Eye for Area;
- X as the normal Collapse action;
- Pencil/“write” as the idle launcher;
- the same icon for two unrelated primary actions.

## 5. Dimensions and visual hierarchy

The implementation may adapt to the existing theme, but preserve these
principles:

### Desktop (`>= 420px`)

- expanded bar height: approximately 52–58 px;
- action hit target: at least 40×40 px;
- icon size: approximately 18–20 px;
- outer radius: approximately 14–18 px;
- compact 3–6 px gaps;
- subtle border and shadow;
- active capture action uses a clear accent background, border and focus ring;
- dividers are subtle and do not add visual clutter.

### Compact viewport (`360–419px`)

- remain one horizontal row;
- action hit target may reduce to 36×36 px, not below 32×32 px;
- use compact gaps and padding;
- do not wrap;
- toolbar must remain within the viewport after drag, expand and resize;
- auxiliary panels may become a viewport-clamped sheet/popover, but the toolbar
  itself stays horizontal.

Support the repository’s existing minimum tested viewport. If a viewport below
that minimum cannot fit every control, document and test the chosen compact
behavior; do not silently wrap into a vertical tool palette.

## 6. Horizontal toolbar action behavior

### Pick

- strictly one target;
- click or Enter selects one element;
- active state is visible and exposed through `aria-pressed`;
- old Shift-additive multi-select behavior must not remain hidden inside Pick.

### Multi

- only multi-target capture path;
- each click toggles one target;
- show selected count and a clear Add note/Finish action in a small status
  surface, not by expanding the main toolbar vertically.

### Area

- drag to select one region;
- Esc cancels the active gesture;
- saved region anchors remain correct after page scrolling.

### Copy

- copies open annotations by default;
- disabled when there are no open annotations;
- on success temporarily changes to a check state or shows a compact toast;
- never completes or clears annotations;
- Clipboard fallback is viewport-aware.

### Marker visibility

- toggles one presentation-only `markersVisible` value;
- does not persist `hidden=true` to every annotation;
- does not modify Copy output or task status;
- per-annotation hidden state remains a separate explicit action if retained.

### Shortcut help

- opens a compact anchored help popover;
- popover is generated from the same shortcut registry used by handlers and
  tooltips;
- no independently hard-coded duplicate shortcut table;
- closes on Esc, outside click, toolbar collapse, or opening Annotation list.

### Annotation list

- is the final feature icon;
- opens an anchored annotation/comments panel;
- list panel is separate from the horizontal toolbar;
- clicking the icon again closes it;
- help and list panels are mutually exclusive;
- list icon exposes `aria-expanded` and `aria-controls`;
- toolbar remains visible while the list panel is open.

### Collapse

- lives after a separator as toolbar chrome;
- uses ChevronUp in expanded state;
- only changes presentation;
- closes transient Help/List panels;
- must not delete saved annotations or task data;
- must not lose a non-empty composer draft;
- invisible capture listeners must not continue intercepting page input while
  collapsed.

## 7. Tooltip contract

Every actionable icon requires a polished custom tooltip on hover and keyboard
focus. Native `title` alone is insufficient.

Examples:

```text
Pick element        ⌘⌥P
Multi-select        ⌘⌥M
Select region       ⌘⌥A
Copy annotations    ⌘⌥C
Hide markers        ⌘⌥V
Keyboard shortcuts  ?
Annotation list     ⌘⌥L
Collapse toolbar    ⌘⌥K
```

Windows/Linux labels use `Ctrl+Alt+…`.

Rules:

- hover delay: approximately 250–400 ms;
- keyboard focus shows immediately;
- tooltip contains the localized action name and shortcut keycap;
- Drag tooltip may show `Drag toolbar` without a shortcut;
- placement flips above/below and clamps horizontally near viewport edges;
- tooltip is `role="tooltip"` and connected through `aria-describedby`;
- tooltip must not intercept pointer capture or page selection;
- do not show both a custom tooltip and a duplicate native title bubble;
- tooltip copy, shortcut help and event handling come from one action registry.

## 8. Shortcut contract

Use one typed source of truth. Extend the existing hotkey module rather than
adding component-local listeners and labels.

Normative shortcuts:

| Action | macOS | Windows/Linux |
|---|---|---|
| Pick | `⌘⌥P` | `Ctrl+Alt+P` |
| Multi | `⌘⌥M` | `Ctrl+Alt+M` |
| Area | `⌘⌥A` | `Ctrl+Alt+A` |
| Copy open annotations | `⌘⌥C` | `Ctrl+Alt+C` |
| Show/hide markers | `⌘⌥V` | `Ctrl+Alt+V` |
| Annotation list | `⌘⌥L` | `Ctrl+Alt+L` |
| Expand/collapse toolbar | `⌘⌥K` | `Ctrl+Alt+K` |
| Shortcut help | `?` (`Shift+/`) | `?` (`Shift+/`) |
| Cancel current capture/popover | `Esc` | `Esc` |

Safety:

- do not fire inside input, textarea, select, contenteditable or editor roles;
- do not fire during IME composition;
- ignore repeat events;
- prevent default only after a Studio shortcut is positively matched;
- shortcut invoked while collapsed expands the toolbar and activates/opens the
  requested action;
- shortcut help itself lists every supported shortcut and the safety note.

## 9. Annotation list panel contract

The panel opened by the final feature icon shows the current annotations and
comments.

### Header

- localized title `Annotations` / `批注列表`;
- open count and total count;
- `Open` / `All` filter; default `Open`;
- compact close control is optional because the List icon toggles the panel.

### Items

Each item shows:

- stable human display number;
- comment text as the primary line;
- route/page or target summary as secondary text;
- Open/Completed status;
- unresolved indication when applicable.

Item behavior:

- selecting an item scrolls/highlights its target when resolvable;
- selecting an item opens or focuses the existing marker editor;
- completed items appear only in All by default;
- Reopen, Complete and Delete must continue to use the shared typed mutation
  path;
- do not create a second list-specific task model.

### Footer / maintenance

- optional `Remove N completed` appears only when N > 0;
- requires a lightweight confirmation;
- must never remove Open items;
- Copy remains a first-class toolbar action rather than being hidden only in
  the list panel.

### Placement

- desktop width around 340–400 px;
- max height around 60–70 vh with internal scrolling;
- anchor to the List button and flip left/right/above/below as needed;
- remain within viewport after toolbar drag and resize;
- on narrow viewports use a clamped near-full-width panel without covering the
  entire page unnecessarily.

## 10. Popover coordination

These are separate surfaces:

- action tooltip;
- shortcut-help popover;
- annotation-list panel;
- capture status strip;
- target-side annotation composer;
- marker editor;
- Copy fallback/toast;
- destructive confirmation.

Rules:

- Help and List are mutually exclusive;
- opening Help/List closes only the other auxiliary panel, not saved state;
- tooltips close while a related popover is open;
- dragging the toolbar closes transient tooltips and auxiliary popovers, then
  preserves all task/composer data;
- Esc closes the topmost transient surface first;
- no popover click may leak into page capture;
- all anchored surfaces share or reuse one viewport-aware placement utility.

## 11. State separation

Keep presentation, capture and persisted data separate.

```ts
type PresentationState = {
  expanded: boolean;
  dockPosition: DockPosition;
  markersVisible: boolean;
  viewFilter: "open" | "all";
  auxiliaryPanel: "none" | "shortcuts" | "annotations";
};

type CaptureState =
  | Idle
  | Picking
  | MultiSelecting
  | SelectingRegion
  | Composing
  | Saving
  | Error;
```

Exact names may differ.

- expanding/collapsing is presentation only;
- list/help open state is presentation only;
- Copy does not mutate task status;
- completion/edit/delete uses typed task mutations;
- unsaved composer text is not destroyed by opening List or Help;
- opening List/Help may suspend capture interception but must preserve the
  resumable draft/selection defined by the current Goal.

## 12. Annotation creation and markers

The toolbar redesign must preserve the intended annotation-first path:

```text
Pick/Multi/Area
→ target-side composer
→ save
→ numbered marker remains visible
→ continue capturing
```

Normal creation must not stop on a Task ID/file/source details screen.
Technical details remain available in task JSON, Copy output and diagnostics.

Marker numbers remain stable across Open/All filtering. Global marker hiding is
presentation-only. Region markers follow document scrolling.

## 13. Completion and Code Agent sync

- Completed items are hidden in default Open view;
- All view shows Open and Completed;
- Code Agent completion remains explicit through the local CLI/mutation path;
- HMR alone must never imply completion;
- browser revision polling continues to synchronize completion;
- completing annotations must not silently replace the task ID;
- browser and CLI mutations must not overwrite each other.

## 14. Accessibility

- every icon button has localized `aria-label`;
- active/toggled actions use `aria-pressed`;
- Help/List use `aria-expanded` and `aria-controls`;
- focus rings are visible;
- toolbar uses `role="toolbar"` only for the horizontal action bar, not for
  unrelated panels;
- arrow-key roving focus is optional but recommended; normal Tab order must be
  correct if not implemented;
- hit targets meet the dimension contract;
- tooltips appear on keyboard focus;
- popovers have appropriate dialog/region semantics and restore focus to their
  trigger on close.

## 15. Security and production invariants

Preserve:

- dev-only injection;
- Shadow DOM/style isolation;
- token and origin/host checks;
- redaction and bounded payloads;
- no arbitrary file or shell browser endpoint;
- production build exclusion;
- local Agent commands only;
- no AI employee, provider, hosted Agent or cloud sandbox integration.

Remote Studio access remains explicit opt-in, not a silent default.

## 16. Out of scope

Do not add:

- browser-side source editing;
- AST/Tailwind visual editing;
- another annotation library or store;
- Puck/Craft/Grapes/Onlook/Frontman Server;
- new backend service;
- MCP feature expansion;
- arbitrary npm dependency additions for a tooltip or popover if the small
  Shadow-DOM-safe primitives can be implemented with existing React/CSS.

## 17. Implementation discipline for low-parameter Agents

For every Goal:

1. inspect actual HEAD and existing tests first;
2. write/update tests for the intended behavior before broad refactoring;
3. preserve existing working capabilities;
4. implement only the current Goal;
5. run exact current-Goal gates;
6. report every acceptance criterion PASS, FAIL or BLOCKED with evidence;
7. do not claim browser behavior without Playwright or real-browser evidence;
8. do not start the next Goal.
