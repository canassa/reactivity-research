# 2026-10-17: the routed-app scenario

Designed and implemented `scenarios/routed-app/` (contract and generator), its work and bench
actions, and the harness support it needs. No emitters yet. Motivated by the tea-inline review
(`notes/2026-10-16-tea-inline-critique.md`, weakness 2): every earlier scenario mounts everything
once, so none can see whether an approach builds only what is shown and disposes what it leaves.

## What was done

- **The scenario:** N pages behind a shell (nav bar of the first four pages, an "All pages" menu
  built only while open, user/cart/notices in the header), one page shown at a time. Pages are
  composed from the unique-components primitives, plus global reads and writes, backward links,
  tabs (30%) and a modal (35%) whose state lives only while shown, time-driven fields (in pages
  and tabs) and page feeds (`pagePush`). Refs `["f"|"p"|"g", name]` replace bare field names.
- **Decisions** (README "Decisions"): routing is in-app state; page, tab and modal state resets
  on remount, global state persists; one `setInterval` per mounted time-driven field; a `pagePush`
  to a page not shown is dropped; `snapshot` is global state only; bench at N = 64.
- **Harness** (generic, small): served pages run intervals on a virtual clock (`hooks.js`,
  `fireIntervals()`), a `clock` script step and panel button fire them; a spec may export
  `maxIntervals(spec, state)` and the panel/`./rr check` then report per-step `problems`;
  `./rr work` performs `clock`, `dispose` and `mount` steps (mount resets the reference state).
- **Work actions:** 24, all local except opening and closing the menu: p1 events, `serverSet` of a
  global p1 does not read (currency) and of one it reads (balance), `notify`, `pagePush` hidden and
  shown, navigation p1 → … → p5 → p1, tabs, a clock tick, the modal, the global snapshot, and the
  app's dispose and mount. **Bench:** 15 do/undo pairs on the same pages.

## Checks

- Deterministic and prefix-stable at N = 1 … 256, seeds 1 to 3; the reference replays every
  script; forced capabilities hold for seeds 1 to 60.
- Every script step's target matches exactly one element (enabled for clicks) in the reference
  HTML at the time it runs, by headless Chrome's `querySelector` (N = 16 and 64, seeds 1 to 3); the
  same for every work and bench step (N = 16, 64, 256, seeds 1 to 3).
- A scratch, uncommitted app that morphs the DOM from the reference render ran the whole script
  through the real panel: 0 mismatches over every compared step at N = 1, 2, 4, 5, 16, 64 and 256
  (the few keyed/focus flags left at 64 and 256 were its naive positional morph pairing a new
  `when` section with an old group of the same tag). With its timers deliberately leaked, the
  interval check failed from the first step after leaving the time-driven page, and the doubled
  tick on return showed as a mismatch.
- `./rr check` still passes for shared-components/solid, unique-components/tea-inline (with
  locality, through the changed `work.js`), big-component/elm and big-table/vanilla.

## What was learned

- A nav bar listing all N pages would make the shell, and so every mount and every navigation's
  `aria-current` update, O(N) by design; the locality bound could not then separate "builds hidden
  pages" from "renders a long nav". Hence four pinned links and a lazily built menu.
- Keyed-identity checking needed no harness change: giving `<main>`, tab panels and the modal a
  `data-key` makes every key chain under a page start with the page id, so an unmount only removes
  keys and is never read as a replacement. Distinct roles (`navLink`, `menuLink`, `pageLink`) keep
  the nav and menu buttons for the same page from colliding.
- Elm's `Time.every` shares one interval per period across subscriptions, so the interval rule is
  "at most one per mounted time-driven field", not "exactly".
