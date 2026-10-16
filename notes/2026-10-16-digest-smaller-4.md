# 2026-10-16: a smaller digest, fourth round

## Done

- unique-components: the setter's defaults are the initial state. `widget()` calls the setter
  once with `{}`, a widget's own fields are its function's parameters, and the separate `let`
  and read-field assignments are gone. The setter rides on the widget's binding list (`W[k].s`,
  no `S` map), comes first, and the template comes last (`widget(set, ...h, html)`).
- unique-components: `L(...texts)` and `C(...[text, done])` instead of one list helper that
  tests `typeof`; the delegated listener is one expression; the widget number is a counter, so
  `dep` reads `I - k`. The emitter refuses a field named like an `Object.prototype` property
  (the `{}` the setter is first called with would supply it).
- shared-components: the label is spliced into the heading's HTML (the emitter checks that it
  needs no escaping), and each widget is digested for the first time right after its factory.

## Numbers

Brotli totals, adapter excluded, `runs.json` (sizes 1 to 256, seeds 1 to 3), medians, Node
26.11.1, Vite 8.3.4, Rolldown 1.2.14:

| | N=1 | N=16 | N=64 | N=256 | all sizes | N ≥ 16 |
|---|---|---|---|---|---|---|
| shared, before | 1,045 | 3,110 | 4,359 | 7,580 | 2,061 + 23.68 | 3,019 + 18.28 |
| shared, after | 1,033 | 3,108 | 4,348 | 7,578 | 2,053 + 23.69 | 3,011 + 18.29 |
| unique, before | 1,382 | 4,997 | 12,925 | 38,437 | 2,356 + 145.4 | 3,623 + 138.2 |
| unique, after | 1,377 | 4,970 | 12,736 | 37,617 | 2,359 + 142.2 | 3,646 + 135.0 |

Every size's median is lower on both scenarios (sums over all 27 builds: shared −223 B, unique
−4,749 B). Calls (`./rr work`, seed 1, sizes 16 to 256), record by record: none higher. Totals
11,806 → 11,798 (shared), 19,962 → 19,962 (unique).

`./rr check` passes on both at sizes 1, 4, 16 and 64, seeds 1 to 3, locality included (worst
5.3×, as before). Builds are byte-identical twice.

## Tried, didn't help

- Handlers first or in a separate call after the bindings, initial values as parameter
  defaults with a plain setter, variadic text bindings, rows as factory calls (shared),
  unquoted attribute values, the listeners added in a loop, one `structuredClone` per snapshot,
  the item role suffixed by the runtime, the widget counter on shared-components, the setter on
  the binding list on shared-components: worse or mixed.
- Digesting each unique widget right after it is built saved 129 B summed, but the work
  counter then counted 2 more calls on a toggle: a summary's `filter` callback had been
  undercounted while its closure was cold. Dropped for the per-record rule.

## Learned

- **Brotli codes a name next to its value better.** The setter already held every field name,
  so moving each initial value next to its name (`sheets: $sheets = 11`) cost nothing in raw
  bytes and took about 720 B off N=256. The same values as parameter defaults, away from the
  names, saved nothing.
- **Small-size medians move ±10 B for any runtime change,** because brotli's choices shift
  with a single renamed identifier. A change was kept only when the sum over all builds fell
  and no median ended above the starting point.
- **The work counter is warm-up sensitive** even with the optimizing tiers off: changing how
  often a binding runs at mount changed how many callback calls a later action was credited
  with.
