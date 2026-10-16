# 2026-10-16: a smaller digest, fifth round

## Done

- Both scenarios: `receive` treats a serverSet as a snapshot of one widget, one loop for both;
  a tick or notify the app has no branch for has no `state` and replaces nothing.
- unique-components: setters take no parameter and read the incoming state from the runtime's
  `S` (`run(W[k], state)` sets it and calls the setter; mount empties it for the initial call).
  Input, select and checkbox handlers take no parameter either and read their control from `X`,
  which the delegated listener sets.
- Initial flags as bit masks: a checklist's done items (unique, `C(mask, ...texts)`), a todo's
  done items and a toggles widget's switches (shared).
- Small: `nx(value, ...options)` (unique), the counter's initial value and the todo's draft as
  parameter defaults (shared), `widget()` numbers the widget itself (unique).

## Numbers

Brotli totals, adapter excluded, `runs.json` (sizes 1 to 256, seeds 1 to 3), medians, Node
26.11.1, Vite 8.3.4:

| | N=1 | N=16 | N=64 | N=256 | all sizes | N ≥ 16 |
|---|---|---|---|---|---|---|
| shared, before | 1,033 | 3,108 | 4,348 | 7,578 | 2,053 + 23.69 | 3,011 + 18.29 |
| shared, after | 1,009 | 3,074 | 4,309 | 7,514 | 2,028 + 23.51 | 2,987 + 18.10 |
| unique, before | 1,377 | 4,970 | 12,736 | 37,617 | 2,359 + 142.2 | 3,646 + 135.0 |
| unique, after | 1,356 | 4,923 | 12,604 | 37,255 | 2,331 + 140.9 | 3,596 + 133.8 |

Every size's median is lower on both scenarios (sums over all 27 builds: shared −951 B, unique
−2,691 B). Calls (`./rr work`, seed 1, sizes 16 to 256), record by record: none higher, none
lower. Totals 11,798 → 11,798 (shared), 19,962 → 19,962 (unique).

`./rr check` passes on both at sizes 1, 4, 16 and 64, seeds 1 to 3, locality included (worst
5.3×, as before). Builds are byte-identical twice.

## Tried, didn't help

- `run(W[k], state)` on shared-components, the X handler trick on shared-components, choice
  extras as a mask, a summary's formula from its prefix, more parameter defaults (feed record,
  filter items, rating stars, expanded masks, unique feed record): noise or worse.
- `insertAdjacentHTML` or `appendChild`'s result for the section, `Object.assign` in `el()`,
  `show` without `!!`, `Math.min` as a compare-and-assign, `data-role` before `type`, unquoted
  option values: worse or mixed.
- A first try of the single receive branch crashed on small apps: a tick or notify that the
  app had no branch for fell into it. `m.state?.widgets` makes it replace nothing.

## Learned

- **A per-widget name the minifier picks costs bytes, one letter or not.** The setter's and
  handlers' parameters took whatever letter the widget's own variables left free, so the same
  code began differently in every widget and brotli could not copy it whole. Reading from one
  runtime variable instead was −1,060 B and −709 B summed on unique-components; on
  shared-components, where that code is written once per kind, it gained nothing.
- **Small-size medians still move ±10 B for any runtime change.** A change was kept when the sum
  over all builds fell and every median stayed below the starting point; a few changes raise one
  size against the step before (the bit mask up to +15 B at N=8 to 32), which the README says.
