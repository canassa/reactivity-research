# 2026-10-17: routed-app in tea-dirtybits

## Done

- Emitter `scenarios/routed-app/tea-dirtybits.js`; new runtime `frameworks/tea-dirtybits/template/routes.js`
  (`slot`, events without a widget, model setters) and `routes-adapter.js` (dispose calls the app's
  `stop` first). `framework.js` counts `routes.js` as runtime. Other scenarios' output is unchanged.
- `runs.json`: tea-dirtybits under routed-app, sizes 1 to 256, seeds 1 to 3.

## Design (lifetime inside dirty bits)

- A page is a unit with its own reducer, patch and `stop`, mounted by a `slot` keyed by the route;
  tab panels and modals are units mounted by slots inside the page; the menu is a slot too.
- One dirty word: bits 0 to 5 are the global fields in every page, then the page's own, so a global
  write needs no mapping and only the mounted page's patch tests it.

## Results

- `./rr check`: passes at sizes 1, 4, 16, 64 with seeds 1, 2, 3, locality included (calls 17 → 17
  from N=16 to 256 for the worst action, ratio 1.00); the other four scenarios' checks still pass.
- `./rr work` (N=16 → 256, seed 1): every local action is flat (ratio 1.00): page events 15 to 20
  calls, navigation 40 to 117 (p2 → p3 is the largest page), tab switch 34 and 55, mount 56, dispose 5.
  Only the menu opening grows (50 → 530, global by nature).
- `./rr measure` (written to /tmp/rr-ra4-measure, not committed): baseline 4,603 B + 366.4 B per page
  (R² 0.992); runtime 1,061 B; N=1 about 2.2 KB, N=16 about 10 to 11.5 KB, N=256 about 94 to 97 KB.

## Learned

- Lifetime costs very little in dirty bits: `slot` is about 20 lines and the pages need no
  subscription code, because a patch only exists while its page is mounted.
- A page costs about twice a `unique-components` widget (366 against about 175 B), as the README expects.

## Review fixes (same-task events)

A review found that units are removed only at the microtask patch, so until then their handlers can
still send, and reached through `dispatch` as well as through input. The "real input cannot do it"
claim in the first README section was wrong and is deleted. Cases found: a tab switch then a click
on the old panel (an arm ran on another panel's fields: TypeError); a modal closed then typed in (a
ghost modal) or confirmed (a read of null); a navigation then a click on the old page, or a timer
tick (an arm of another page, or `undefined(...)`); deepLink p2 then p1 before settled (the slot key
did not change, so the DOM kept the old p1's edited fields while the model held the initial ones);
tab A to B to A and a modal closed then opened in one task (same).

- **Ownership guards, at compile time:** a page message carries the page id (`widget`, the runtime's
  own event shape) and the reducer drops it unless it is the route; tab arms and ticks test
  `m.page.tab === "t1"`, modal arms test `m.page.modal`.
- **Generation keys:** `gen` (navigation), the page's `t` (tab selected) and `o` (modal opened) are the
  keys of the slots, so re-entry before the patch builds the unit again.
- **Attribution:** `routes.js` keeps only `slot` and a `program` wrapper; the model setters, `nextId`
  and `go` moved to `src/model.js` (app code); events use the runtime's `onClick`, `onInput`,
  `onInt` with the page id as the widget.
- **Adapter:** `view` returns `[patch, stop]`; the adapter is the standard one with its import
  pointed at `./routes`, whose `program` runs the stop on dispose. `routes-adapter.js` is gone.
- **Tests:** the seven same-task cases above pass (a script firing the events in one task, comparing
  with the same flow without the stale event, and checking no page error and no timer left).
