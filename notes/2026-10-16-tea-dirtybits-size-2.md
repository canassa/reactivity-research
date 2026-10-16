# 2026-10-16: making tea-dirtybits smaller, second pass

Goal: fewer brotli bytes for the tea-dirtybits prototype on both scenarios, again without
raising any `./rr work` count and without leaving its strategy (real messages and reducers,
arms marking compile-time dirty bits, a static patch per component, DOM built once).

## Result

Total brotli, medians of seeds 1 to 3, before → after:

| | N=1 | N=16 | N=64 | N=256 | fit, all N | fit, N >= 16 |
|---|---|---|---|---|---|---|
| shared-components | 1,277 → 1,255 | 3,837 → 3,669 | 5,513 → 5,302 | 10,072 → 9,793 | 2,525 + 31.9 → 2,419 + 31.1 | 3,681 + 25.4 → 3,499 + 25.0 |
| unique-components | 1,702 → 1,674 | 6,543 → 6,114 | 17,854 → 16,473 | 55,109 → 50,098 | 2,836 + 209.6 → 2,758 + 190.3 | 4,474 + 200.4 → 4,299 + 181.6 |

Lower at every measured size in both scenarios. `./rr work` (sizes 16 to 256, seed 1): no
record went up; summed calls 6,954 → 6,921 (shared: routing no longer takes bits for an
unchanged slice) and 8,740 → 8,740 (unique).

## What worked, roughly by size of the gain

1. **A unique widget module is one anonymous triple** registered under its id
   (`WIDGETS.w7 = [view, reducer, init]`) instead of three named exports collected in an app
   table: −8 B per widget for the triple, −2 B more for the registration, and the order
   view, reducer, init was the smallest of all six at every size.
2. **Regular numbers:** message tags in the order the view sends them, field bits in the order
   it reads them, handlers wired in one run, patch tests ordered by mask. Each is 1 to 2 B per
   widget: brotli matches `l(n[5],t,0),l(n[6],t,1)` and `t&1&&…,t&2&&…` across widgets.
3. **Enum cycles as a conditional chain** (the compiler knows the options) instead of a
   module-level array and indexOf.
4. **Templates written as a minifier would:** trailing closing tags and optional end tags
   (`</p>`, `</li>`, `</option>`) left out.
5. Dashboard: kinds as `[reducer, view]` pairs, tabs and options as tuples, summaries reading
   each term in place unless a breakdown shows it twice.
6. Small: one setter per property in unique, the section keyed by the app loop, checkboxes on
   `click` (so `onCheck` is `onClick`), bits taken only for a changed slice.

## What did not help

- `pick`: keeping only the elements the code uses, so references are 0, 1, 2…: +600 B at
  unique N=256 (the per-widget position list costs more than the indices it saves).
- A section helper or an app-created section (+13 to +18 B at N=1 for −1 B per widget), the
  list helper setting row keys, setters in the dashboard kinds, unquoted attribute values,
  template literals for ARIA strings, other orders of kinds, row fields and kind pairs: mixed.

## Learned

- Removing a few bytes of code can raise brotli at large N: the minifier's short names are
  reassigned across the whole bundle, which alone moves results by ±10 to 30 B. Judge a change
  over every size and the sum, not one size.
- What compresses is regularity across components: the same numbers in the same order in every
  widget. Per-widget names (bindings, table entries) are the most expensive bytes left after
  the spec's own strings, which are now about half of the unique bundle.
- Close to the rules, not done: ids derived from row order, no modulepreload polyfill, and
  `settled` moved into the excluded adapter.
