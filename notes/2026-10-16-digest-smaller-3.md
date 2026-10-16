# 2026-10-16: a smaller digest, third round

## Done

- Handlers are `widget()`'s last arguments, after the setter (`widget(html, set, ...h)`), on
  both scenarios; a unique feed widget puts its record in `O` itself.
- A control carries its widget's binding list (`c.b`), so the delegated listener no longer
  calls `closest()`.
- unique-components: an int add checks only the bound its step can pass (`Math.min(x + 3,
  max)`, `Math.max(x - 2, min)`), since an int field always lies within its range; the `cl`
  helper is gone. Typed comparisons use `==`/`!=`. A push is one expression on the click
  handler's unused parameter, new items always start not done, and `L` takes the initial items
  as arguments.
- shared-components: ARIA states and the amount value are written without `"" +`, rating stars
  go through `text`, a summary rounds its total only where it shows it, the todo add, amount
  check, filter item and clock reset are expressions, and the feed record keeps its entries
  under `e`.

## Numbers

Brotli totals, adapter excluded, `runs.json` (sizes 1 to 256, seeds 1 to 3), medians, Node
26.11.1, Vite 8.3.4, Rolldown 1.2.14:

| | N=1 | N=16 | N=64 | N=256 | all sizes | N ≥ 16 |
|---|---|---|---|---|---|---|
| shared, before | 1,053 | 3,154 | 4,399 | 7,634 | 2,088 + 23.78 | 3,062 + 18.29 |
| shared, after | 1,045 | 3,110 | 4,359 | 7,580 | 2,061 + 23.68 | 3,019 + 18.28 |
| unique, before | 1,420 | 5,068 | 13,029 | 38,790 | 2,400 + 146.7 | 3,680 + 139.5 |
| unique, after | 1,382 | 4,997 | 12,925 | 38,437 | 2,356 + 145.4 | 3,623 + 138.2 |

Every size's median is lower on both scenarios. Calls (`./rr work`, seed 1, sizes 16 to 256),
record by record: none higher. Totals 12,054 → 11,806 (shared: list summaries skip their
total), 19,967 → 19,962 (unique: no `cl` call per int click).

`./rr check` passes on both at sizes 1, 4, 16 and 64, seeds 1 to 3, locality included (worst
5.3×, unique n=64, a tick, as before). Builds are byte-identical twice.

## Tried, didn't help

- The static prefix of a text in the template with a text node for the expression: worse at
  every size. `dis`/`chk` helpers, enum cycles as comparison chains, `!x.length`, `x % 1 == 0`,
  `done` as 0/1, the item's `<li data-role>` in its template, `nx` with rest options, rest
  items in dashboard rows, one-field setters as assignments: worse or mixed.
- `onclick`/`oninput` instead of `addEventListener` would save bytes, but the serve page counts
  listeners through `addEventListener`: not built.

## Learned

- **The runtime renames the app.** The minifier names the app's module variables (the read
  fields) after the runtime's, so a runtime-only change moved single unique builds at N=256 by
  up to ±120 B. Medians at N ≥ 128 are that noisy for any change; the sum over all 27 builds
  and the runtime's own bytes are the steadier judges.
- **Call shape is where the code bytes were.** The biggest step was the cheapest-looking: no
  brackets around the handlers and no placeholder argument, −12 to −116 B at every size. What
  is left on unique-components is mostly the contract (`data-role` 5 KB of 38.7 KB) and the
  external protocol's field names in the setters (3 KB).
