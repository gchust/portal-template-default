# Goal 01 — Horizontal Collapsible Icon Toolbar, Tooltips, Help, and Annotation List

## Outcome

The current cluttered command row and large mixed panel are replaced by the
accepted horizontal toolbar interaction.

A first-time user can:

```text
see a compact collapsed annotation chip
→ click to expand one horizontal icon bar
→ understand every icon by hover/focus tooltip
→ start Pick/Multi/Area directly
→ open shortcut help from the penultimate feature icon
→ open the current annotation/comment list from the final feature icon
→ collapse again without losing annotations or draft state
```

This Goal is one cohesive user-visible slice. Do not leave Help/List as dead
placeholder icons.

## Read first

- `00-shared-contract.md`
- `design/portal-studio-horizontal-toolbar-reference.png`
- current `src/studio/toolbar.tsx`
- current `src/studio/index.tsx` and Shadow DOM styles
- current `src/studio/dock.ts`
- current `src/studio/hotkeys.ts`
- current task selectors, marker editor and annotation list code
- current locales
- relevant Vitest/component/Playwright tests

Inspect actual HEAD. Suggested file names are not permission to create a second
parallel Studio implementation.

## Current defects to remove

The reviewed implementation has these concrete problems:

1. collapsed launcher always uses Wrench plus a detached count badge;
2. expanded UI is a fixed-width mixed panel with one wrapping command row;
3. Pick uses Wrench, Multi uses CheckCircle, Area uses Eye and Collapse uses X;
4. Open/All, remove-completed and capture actions share one visual level;
5. action explanation relies mainly on native `title` strings;
6. there is no dedicated shortcut-help icon/popover;
7. there is no dedicated final list icon that owns the annotation-list panel;
8. the entire mixed panel is declared as one toolbar;
9. drag/expand/collapse/list/help/panel placement are not modeled as one
   coherent horizontal Dock.

## Required implementation

### A. Create one typed action registry

Create or extend one source of truth for toolbar actions. Exact file placement
may follow repository conventions.

The registry must define at least:

```ts
type StudioActionId =
  | "pick"
  | "multi"
  | "area"
  | "copy"
  | "visibility"
  | "help"
  | "list"
  | "toggle";

type StudioActionDefinition = {
  id: StudioActionId;
  labelKey: string;
  fallbackLabel: string;
  shortcut: ShortcutDefinition;
};
```

Icons may be mapped in the UI layer, but labels, shortcuts, tooltip copy and
handlers must not be separately hard-coded in four places.

Extend the current shortcut source with:

- visibility: Mod+Alt+V;
- list: Mod+Alt+L;
- help: `?` / Shift+/;

Preserve Pick/Multi/Area/Copy/Toggle shortcuts from the shared contract.

### B. Replace the collapsed launcher with the accepted horizontal chip

The collapsed structure must be conceptually:

```text
<div class="studio-collapsed-chip">
  <DragHandle />
  <StatusSlot />
  <ShortLabel />
  <ExpandControl />
</div>
```

Requirements:

- default on a fresh page load is collapsed;
- no Open annotations: StatusSlot shows `MessageSquarePlus` or verified
  equivalent;
- Open annotations: StatusSlot shows the open count/`99+` instead of the icon;
- no detached corner badge;
- localized short label `Annotation tools` / `批注工具`;
- ChevronDown or equivalent is the expand affordance;
- the drag handle, chip body and Expand have unambiguous event boundaries;
- pointer drag uses capture and does not expand;
- keyboard movement and existing position persistence remain functional;
- invalid/off-screen stored positions are clamped automatically;
- do not add Reset Dock Position.

### C. Implement the expanded horizontal toolbar

Render one horizontal bar with this exact feature order:

```text
Grip
| Pick  Multi  Area
| Copy  MarkerVisibility
| ShortcutHelp  AnnotationList
| Collapse
```

The final two feature actions must be:

1. Shortcut help;
2. Annotation list.

Collapse follows after a divider as toolbar chrome.

Requirements:

- icon-only primary presentation;
- no permanent labels under/beside icons;
- no wrap into a second row;
- semantically correct unique icons from the shared contract;
- action buttons use at least 40×40 hit targets desktop and 36×36 compact;
- active Pick/Multi/Area states are obvious and use `aria-pressed`;
- MarkerVisibility, Help and List have active/open states;
- List and Help use `aria-expanded` and `aria-controls`;
- Copy is disabled when there are no Open annotations;
- Collapse uses ChevronUp, not X;
- outer horizontal action bar may use `role="toolbar"`;
- annotation-list/help panels are not children semantically treated as toolbar
  buttons.

### D. Preserve clean capture behavior from the icon bar

- clicking Pick starts/switches to Pick;
- clicking active Pick cancels Pick;
- same toggle rule for Multi and Area where safe;
- switching modes clears only transient capture selection from the old mode;
- saved annotations remain untouched;
- opening Help or List suspends invisible page interception while the auxiliary
  panel is open;
- closing the auxiliary panel returns to a documented safe state;
- collapsing suspends active page interception but preserves any non-empty
  composer draft and saved task data;
- shortcut activation while collapsed expands and runs the requested action.

Do not implement target-side composer redesign in this Goal; preserve the
current annotation creation path until Goal 02, but do not make it inaccessible.

### E. Implement a reusable custom tooltip primitive

Create one Shadow-DOM-safe tooltip implementation used by every toolbar icon.

Behavior:

- hover opens after approximately 300 ms;
- keyboard focus opens immediately;
- mouse leave, blur, Esc, click, drag or popover open closes it;
- tooltip includes localized action plus keycap;
- drag tooltip has action text without a fake keycap;
- placement flips above/below and clamps horizontally;
- `role="tooltip"` and stable `aria-describedby` wiring;
- pointer-events none;
- no duplicate native `title` bubble;
- generated from the typed action registry.

Required tooltip examples:

```text
Pick element — ⌘⌥P
Multi-select — ⌘⌥M
Select region — ⌘⌥A
Copy annotations — ⌘⌥C
Hide markers — ⌘⌥V
Keyboard shortcuts — ?
Annotation list — ⌘⌥L
Collapse toolbar — ⌘⌥K
```

Use platform-specific labels.

### F. Implement the penultimate Shortcut Help action

Use `CircleHelp` from the accepted visual direction, or a verified `Keyboard`
fallback if the installed Lucide version lacks it.

Click and `?` open an anchored non-modal popover listing every supported
shortcut from the registry.

The help popover must include:

- Pick;
- Multi;
- Area;
- Copy;
- marker visibility;
- Annotation list;
- toolbar expand/collapse;
- `Esc` cancellation;
- note that shortcuts do not fire while typing in editable controls.

Behavior:

- `aria-expanded` / `aria-controls`;
- closes on Esc, outside click, toolbar collapse, drag start or opening List;
- restores focus to Help trigger;
- stays within viewport;
- no manually duplicated shortcut strings.

### G. Implement the final Annotation List action

Move/reuse the current annotation list into a distinct anchored panel triggered
by the final feature icon.

Do not create a second list or task store.

Minimum panel requirements in this Goal:

- title and open/total count;
- Open/All filter, default Open;
- current comment items and stable numbers;
- status/unresolved information;
- existing edit/complete/reopen/delete actions continue working;
- selecting an item opens/focuses its existing marker editor when resolvable;
- Remove completed remains available at low emphasis when applicable;
- internal scrolling for long lists;
- viewport-aware placement after toolbar drag;
- Help and List mutually exclusive;
- `aria-expanded`, `aria-controls` and appropriate panel semantics;
- closing List does not reset annotations or filters unnecessarily.

The toolbar remains visible while the panel is open.

### H. Separate global Marker visibility from persisted per-item hidden state

The Eye/EyeOff toolbar action must toggle presentation-only
`markersVisible`.

It must not perform a batch `setHidden` mutation over all annotations.

Preserve per-item hidden behavior only as a distinct explicit annotation action
if current product requirements still need it.

This change is required now because Marker visibility is a first-class toolbar
icon and must behave predictably.

### I. Responsive layout and anchored layers

Desktop:

- horizontal bar remains one row;
- help/list panels anchor near their triggers;
- no command wrap.

375×667:

- toolbar remains horizontal;
- use compact 36×36 targets and tighter gaps;
- no horizontal page overflow;
- list/help panel clamps or flips inside viewport;
- collapsed chip stays within viewport;
- dragging near each edge remains usable.

Use or introduce one placement helper for toolbar tooltips/help/list where
practical. Do not independently invent conflicting edge logic for each surface.

### J. Localization

Add/update English and Chinese strings for:

- collapsed chip label;
- every action;
- every tooltip;
- Show/Hide marker dynamic text;
- Expand/Collapse dynamic text;
- shortcut help title and safety note;
- Annotation list title/count/filter;
- empty Open list;
- empty All list.

Do not hard-code user-visible text where the repository locale mechanism exists.

### K. Remove superseded UI paths

After the new horizontal path works, delete:

- Wrench launcher/Pick mapping;
- detached `.ps-launcher-count` path;
- old wrapping command-row layout;
- old inline Open/All/remove controls in the toolbar row;
- X Collapse control;
- dead More/reset/menu classes from older iterations;
- duplicate list surfaces;
- stale tests asserting the old vertical/mixed panel.

Do not keep the old UI hidden as a fallback.

## Suggested implementation sequence

The Code Agent should execute in this order:

1. add/extend action and shortcut registry;
2. add tests for exact action order and tooltip copy;
3. implement collapsed chip;
4. implement horizontal toolbar shell and active states;
5. implement custom tooltip primitive;
6. implement Help popover;
7. extract/move existing annotation list into List panel;
8. change global marker visibility to presentation-only;
9. add viewport placement and compact CSS;
10. remove superseded paths;
11. run browser and production gates.

Do not begin with a broad file split. Extract only focused components needed to
make this Goal reviewable, such as:

```text
StudioHorizontalToolbar.tsx
StudioActionTooltip.tsx
StudioShortcutHelp.tsx
StudioAnnotationListPanel.tsx
studio-actions.ts
```

Exact names may differ.

## Do not do in Goal 01

- do not implement the new target-side composer;
- do not change Agent CLI runtime;
- do not add AI employee/MCP features;
- do not add browser source editing;
- do not add a UI framework or full floating-positioning library solely for
  this toolbar;
- do not redesign task schema;
- do not remove working annotation actions to make the toolbar visually clean;
- do not start Goal 02.

## Required tests

### Unit/component

Prove at minimum:

1. fresh mount is collapsed;
2. zero Open annotations shows feedback icon and no detached badge;
3. one Open annotation replaces icon with `1`;
4. 100 Open annotations shows `99+`;
5. collapsed chip has label and Expand semantics;
6. pointer drag does not expand;
7. expanded toolbar feature order is Pick, Multi, Area, Copy, Visibility,
   Help, List;
8. Collapse is separate after List;
9. all icons have localized accessible labels;
10. each action tooltip contains action and platform shortcut;
11. tooltip opens on focus and closes on Esc;
12. Pick/Multi/Area expose correct `aria-pressed` state;
13. Copy is disabled at zero Open annotations;
14. Visibility changes presentation only and sends no task mutation;
15. Help opens from click and `?`;
16. Help content is generated from action registry;
17. List is the final feature action and toggles its panel;
18. Help and List are mutually exclusive;
19. closing/collapsing does not clear saved annotations;
20. no Reset Dock Position, Wrench Pick, X Collapse or old badge remains;
21. no duplicate list surface remains;
22. editable targets and IME do not trigger shortcuts.

### Playwright / real browser

Capture and assert:

- collapsed, no annotations, English, 1440×900;
- collapsed, four Open annotations, Chinese, 1440×900;
- expanded horizontal toolbar, English and Chinese;
- each action tooltip;
- active Pick/Multi/Area;
- shortcut-help popover;
- annotation-list panel with Open and All;
- toolbar dragged near top, bottom, left and right edges;
- 375×667 collapsed/expanded/help/list;
- keyboard-only Tab/focus/tooltips;
- `?`, Mod+Alt+L, Mod+Alt+V and Mod+Alt+K behavior;
- collapse while annotations exist;
- drag does not click/expand;
- no page horizontal overflow;
- no toolbar wrap.

### Regression/build

Run the repository’s actual commands for:

```text
typecheck
relevant Studio unit/component tests
relevant Playwright tests
production build
production Studio-exclusion gate
```

## Acceptance criteria

- G01-01: default collapsed UI is a horizontal chip.
- G01-02: zero Open shows feedback icon; Open count replaces it and caps 99+.
- G01-03: expanded UI is exactly one horizontal row.
- G01-04: feature action order matches the normative order.
- G01-05: Shortcut help is penultimate feature action.
- G01-06: Annotation list is final feature action.
- G01-07: Collapse is separate chrome after List.
- G01-08: all icons have unique, understandable semantics.
- G01-09: every actionable icon has action+shortcut tooltip on hover/focus.
- G01-10: shortcuts come from one typed registry and include V, L and `?`.
- G01-11: Help popover works and is generated from the registry.
- G01-12: List panel reuses the existing annotation source of truth.
- G01-13: toolbar Marker visibility is presentation-only.
- G01-14: drag, persistence, clamping and click-vs-drag remain correct.
- G01-15: collapse/Help/List do not clear task or draft state.
- G01-16: 375×667 remains horizontal and within viewport.
- G01-17: keyboard and screen-reader semantics are correct.
- G01-18: old Wrench/badge/wrapping command-row/vertical mixed-panel path is
  removed, not hidden.
- G01-19: all existing task, annotation, mutation, Copy, completion-sync,
  diagnostics, screenshot and security behavior remains accessible.
- G01-20: production build excludes Studio.

## Completion report

Report:

- actual files changed;
- final component/action hierarchy;
- exact Lucide exports selected;
- shortcut registry table;
- removed obsolete classes/paths;
- exact test/build commands and results;
- screenshot artifact paths;
- every G01 criterion as PASS, FAIL or BLOCKED;
- deviations from the visual reference and concrete reason.

Do not start Goal 02.
