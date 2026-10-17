# 2026-10-17: routed-app emitter for digest (lifetime)

## Done

- `scenarios/routed-app/digest.js` and `frameworks/digest/runtime-routed.js`, selected through
  `templateFiles({ runtime })`; `framework.js` and the other scenarios' output are unchanged.
- `./rr check routed-app digest`, locality included: sizes 1, 4, 16 and 64, seeds 1, 2, 3 all pass
  (0 mismatches, 0 focus losses, 0 keyed replacements, 0 listeners and 0 timers after dispose;
  locality 1.0x). The other digest scenarios still pass (big-component still fails its locality,
  as documented). Two builds of the same spec hash the same.
- `runs.json`: digest under routed-app, sizes 1 to 256, seeds 1 to 3.

## The design in a line

A page is a function that mounts it with its state as locals; a component is a binding list with its
node and its cleanups; global fields have a Set of the mounted lists that read them, joined at mount
and left at `end`; navigation ends everything but the shell. Details in `frameworks/digest/README.md`,
"routed-app".

## Numbers

- `./rr work --sizes 16,256`: every local action 1.00x. Page event 23 calls, navigation 77 to 234,
  mount 99, dispose 16, a tab switch 92 and 129. The menu (global) grows 42 → 282.
- Size, seeds 1 to 3: baseline 3,823 B, slope 237.6 B per page, R² 0.990; N=256 is 61.5 to 64.0 kB.
  The runtime is about 1.1 kB from N=8.

## Learned

- The `dep` mechanism of the dashboards survives lifetime as a runtime fact: the compiler still
  knows which fields a component reads, and the only change is that the reader list is joined at
  mount and left at unmount instead of being copied once at build time.
- Running a binding when it is registered removes the separate first pass, and makes a component
  complete when its function returns. The cost is one save and restore in the keyed list.
- No convergence: the lists are still whole components digested by a handler, not per-field groups.
  A page has a handful of bindings, so what a digest runs is bounded by the page, and a write to a
  global adds only the mounted readers.

## After the code review

- The scenario's helpers (`add`, `nx`, `L`, `C`) left `runtime-routed.js` and are emitted into
  `app.js` when used; initial lists are plain object literals; routes and tabs are found by an object
  keyed by id; the menu escapes titles and is wired through `widget` like the rest; `end` is
  idempotent (`K.delete(b) && …`); `receive` switches on `snapshot` explicitly; opening a modal that
  is open resets its fields in place (`B.r`) and keeps its node.
- Split, seeds 1-3: runtime 1,099-1,103 B → 1,006 B from N=8 (774-854 → 746-776 at N=1). Fit 3,823 +
  237.6 → 3,866 + 241.2 B per page; N=256 61.5-64.0 → 62.4-64.9 kB (+1.5%).
- Re-run: `./rr check routed-app digest` sizes 1, 4, 16, 64 × seeds 1-3 with locality (1.0x), the other
  scenarios' digest checks (big-component still fails locality, as documented), `./rr work` all
  local actions 1.00x (menu open 58 → 538).
