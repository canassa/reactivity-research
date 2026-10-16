# 2026-10-16: big-table built, reviewed, measured and timed

## Done

- **Scenario:** the `big-table` contract and generator, with N different tables and rows as data. N=1 is the
  js-framework-benchmark app.
- **Implementations:** eight, each followed by a code-only review and fixes. They are vanilla (new, the
  floor), Solid 1, Elm, beni-tea, beni-direct and the four prototypes.
- **CLAUDE.md rule 3** now forbids shaping code to the measuring tools.
- **`/tmp` cleanup:** `/tmp` had filled with leaked Chrome profiles. `launch()` now sweeps its own profiles
  older than an hour.
- **Startup read:** a startup measurement now ends at the last paint before `rr.settled()` when nothing
  paints after it (beni).

## What the reviews caught

- **Loops for the counter.** tea-local's row scans were loops because `./rr work` counts calls. tea-dirtybits
  sent row objects to reach a native `indexOf`. digest's first draft used `indexOf` with `splice`, and an
  older line in digest's unique-components runtime did the same. All of them now use the natural form.
- **Stale clicks.** Two clicks in one task removed the last row, through `splice(-1)`, in tea-inline and
  tea-dirtybits. Both now guard by id.
- **Attribution.** Scenario helpers (PRNG, formatters, selection rules) were counted as runtime in tea-inline,
  tea-dirtybits and digest. They now count as app, as in vanilla, Solid and tea-local.
- **Solid.** The adapter pulled `DelegatedEvents` into Solid's runtime, costing 80 to 110 B in every scenario.
  `textContent` is now limited to table 1.
- **vanilla.** It adopted dispatched messages, and it paid Vite's preload polyfill, now dropped from the floor.
- **beni.** It counts at N=1 only. From N=2, tables marked by `aria-selected` replace the selected row's node.
  beni's shipped HTML vocabulary types `aria-*` as `String`, and a one-line upstream declaration would fix it.
- **digest.** Its table digest skips rows that did not change, which is a departure from self-checking
  bindings. It is now documented and measured as the `rowDigest` variant: about 3 B per table buys O(1) row
  controls.
- **tea-local swap.** The CPU bench caught it: 7.3 ms of script, because its keyed list re-inserted every row
  between the two swapped ones. A minimal-move reorder fixed it (330 µs). That fix touches only big-table's
  list file, `template/table.js`.

  **Correction:** commit `a570eb9` says every scenario ships it. They do not. The other scenarios' tea-local
  sizes were remeasured only because the framework directory's hash changed, and they are byte-identical.

## Learned

- **vanilla is the floor only at N=1.** It costs 255 B per table. digest, tea-local and tea-inline cost
  126 to 149 B per table and are about 40% smaller than vanilla at N=256.
- **The rows axis exposes what N does not.** Solid's `createSelector` and Elm's lazy rows are O(rows) per
  select. The prototypes' select is O(1).
- **CPU calibration.** On the js-framework-benchmark weighted geometric mean, our order (vanilla, beni, Solid,
  Elm) matches the official table, but the ratios differ: our Solid uses a store, and our "every 10th" runs on
  10,000 rows. Script ratios are stable between runs. Total ratios moved by up to 10% for unchanged code, so
  rank by script.
