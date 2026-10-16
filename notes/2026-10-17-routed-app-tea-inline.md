# 2026-10-17: routed-app emitter for tea-inline (lifetime)

## Done

- `scenarios/routed-app/tea-inline.js` and `frameworks/tea-inline/template/routes.js` (`up`, `reg`,
  `every`), included only by this scenario. `classify` counts `routes.js` as runtime.
- `./rr check routed-app tea-inline`, locality included: sizes 1, 4, 16, 64 and seeds 1, 2, 3 all pass
  (0 mismatches, 0 focus losses, 0 keyed replacements, 0 listeners and 0 timers after dispose).
- The other four scenarios' tea-inline checks pass; their N=16 seed-1 builds are byte-identical to the
  committed results (raw and brotli JS: unique 20937/5755, shared 9181/3358, big-table 28340/6310,
  big-component 11742/3667). Two builds of the same spec hash the same.
- `runs.json`: tea-inline under routed-app, sizes 1 to 256, seeds 1 to 3.

## The design in a line

Critique weakness 2 asked for lifetime. A unit (shell, page, tab panel, modal) is a markup string and a
function; `up` builds it and gives it disposers; readers of global state sit in groups outside every
unit (`GR.x`) and a unit adds its own group on build and removes it on `down`. So a write schedules only
the shell and the page shown. Details in `frameworks/tea-inline/README.md`, "routed-app".

## Numbers

- `./rr work routed-app tea-inline --sizes 16,256`: every local action ratio 0.98 to 1.00. Page event
  9 calls, navigation 49 to 147, mount 61, dispose 14, a tab switch 27 and 56. The menu (global) grows
  36 → 516.
- Size, seeds 1 to 3: baseline 4,451 B, slope 307 B per page, R² 0.990; N=256 is 78.9 to 82.6 kB. The
  runtime is 884 B from N=4 (730 B in the dashboards; 899 B after the review round).
- Deletion accounting of the lifetime machinery (registrations and page disposers cut out of a generated
  build; the result leaks and is only for counting): 242 B at N=16 (2.3%), 874 B at N=64, 2,480 B at
  N=256 (3.1%), about 10 B per page, plus 140 B of `routes.js`.

## Learned

- It was the right shape the first time: tea-inline's compile-time reader lists already existed, so
  lifetime is only making the lists that outlive a unit (global fields, the page's fields) a
  register-and-unregister pair. Nothing in the runtime had to learn about owners.
- Global lists cannot use `add`/`drop` rows: the writing action does not know which lists are mounted,
  so a write replaces the array and the registered groups reconcile.
- Event delegation for navigation (one listener, `data-key` on the buttons) removed a handler from
  every link, nav button and menu entry.

## Open

- A binding scheduled in the same tick as its unit's `down` still runs once on detached nodes
  (`runtime.js` keeps `pending` private; touching it would change every scenario's bytes).
- Not measured here: the CPU bench, and the comparison with the other routed-app emitters.

## Review round (same day)

- Stale structural and global-writing events on a page left in the same task: `up` returns a no-op unit
  for a detached ref, and controls that write outside their unit (global, or page fields from a tab or
  the modal, and global-list row removals) return when their node is not connected.
- Adopted feed items (`notify`, `pagePush`) are cloned like `snapshot`; navigation roles are matched
  strictly (`navLink`, `menuLink`, `pageLink`).
- The "10 B per page" figure is narrowed: it is the disposal bookkeeping only (`reg` calls and leave
  disposers), not the cost against an eager design. Seeds 1 to 3 at N = 16, 64, 256, and the script is
  `notes/2026-10-17-routed-app-tea-inline-strip.mjs`: 203 to 251 B, 609 to 933 B, 2,630 to 2,856 B.
- Before and after (seeds 1 to 3): baseline 4,451 → 4,500 B, slope 307.3 → 309.2 B per page, runtime
  884 → 899 B, N = 256 seed 1 78,858 → 79,368 B. The five scenarios' tea-inline checks pass; the other
  four scenarios' N=16 builds are still byte-identical to the committed results.
- Not done: the two-events-in-one-task `./rr check` step had not landed on main at rebase time.
