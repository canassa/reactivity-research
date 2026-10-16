# 2026-10-16: making tea-dirtybits smaller

Goal: fewer brotli bytes for the tea-dirtybits prototype on both scenarios, without raising any
`./rr work` count and without leaving its strategy (real messages and reducers, arms marking
compile-time dirty bits, a static patch per component, DOM built once).

## Result

Total brotli, medians of seeds 1 to 3, before → after:

| | N=1 | N=16 | N=256 | fit, all N | fit, N >= 16 |
|---|---|---|---|---|---|
| shared-components | 1,352 → 1,277 | 4,880 → 3,837 | 11,703 → 10,072 | 3,147 + 36.6 → 2,525 + 31.9 | 4,681 + 27.9 → 3,681 + 25.4 |
| unique-components | 1,923 → 1,702 | 8,689 → 6,543 | 73,975 → 55,109 | 3,590 + 282.3 → 2,836 + 209.6 | 5,567 + 271.2 → 4,474 + 200.4 |

`./rr work` (sizes 16 to 256, seed 1): no record went up; summed calls 8,240 → 6,954
(shared) and 11,763 → 8,740 (unique), blocks 12,251 → 7,957 and 16,580 → 9,797.

## What worked, in order

1. **Static templates** (one HTML string per component, nodes found by position), conditional
   content built once and swapped for a comment, messages with numeric tags built once when an
   event is wired, bits written as numbers, no namespace objects (the bundler materialized
   getters for every `import *` used as a value). Unique N=256: −14.8 KB.
2. `onInt` for number inputs, ARIA states as reflected properties (drops `attr`): small.
3. **The widget id as the view's parameter** instead of a literal on every handler line in
   unique: −11 B per widget. Varying literals break brotli's matches between alike lines.
4. Initial slices in the dashboard's table rows: −2 B per widget.
5. **A keyed walk instead of the vendored reconcileArrays:** −500 B baseline in both, and fewer
   calls (its per-node ownership closure is gone, and `map`/`some` callbacks became loops).
6. **Positional dashboard rows** (idea from tea-inline's branch): kinds destructure
   `[kind, init, label, ...params]`; no property names per widget.

## What did not help

- Destructuring template nodes into named locals instead of `t[i]`: unique N=256 +1.9 KB.
- One factory for `onClick`/`onCheck`: +12 B at N=1.
- Not tried, since each adds a call per event: a `cycle` helper, a per-widget `send` wrapper.

## Learned

- Under brotli, identical code shapes are nearly free and per-instance literals are not: pass
  varying values once (a parameter) and keep the repeated lines identical.
- Construction helpers cost nothing in `work` except where construction happens during an
  event (list rows, conditional content); building those from a template lowered calls.
