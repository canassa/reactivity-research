# 2026-10-16: making tea-inline smaller, round 3

Goal: fewer brotli bytes for the tea-inline prototype in both scenarios, strategy unchanged
(messages erased into actions, compile-time dependencies, DOM built once), no work action
making more calls than before.

## Result

`./rr measure` (sizes 1–256, seeds 1–3), compressed total, median of seeds:

| scenario | N=1 | N=16 | N=64 | N=256 | fit, all sizes | fit, N ≥ 16 |
|---|---|---|---|---|---|---|
| shared-components before | 1096 | 3620 | 5139 | 9316 | 2329 + 29.7/w | 3456 + 23.3/w |
| shared-components after | 1096 | 3502 | 5022 | 9131 | 2273 + 29.0/w | 3362 + 22.9/w |
| unique-components before | 1515 | 6493 | 17394 | 53212 | 2840 + 202.5/w | 4568 + 192.8/w |
| unique-components after | 1491 | 6155 | 16157 | 48698 | 2759 + 185.2/w | 4413 + 175.9/w |

No size of either scenario grew; every size but shared N=1 is smaller (−2.0% and −8.5% at
N=256). Work (`./rr work`, sizes 16–256, seed 1): no record went up; total calls 7854 → 7769
(shared) and 12888 → 12868 (unique): fewer calls per item toggle, add and remove.

## What helped (in order)

- **Fewer named variables per unique widget** (the big one). The minifier names each widget
  function's locals, skipping the letters of whichever runtime functions that widget uses, so
  every own variable is a letter that differs between alike widgets. Elements as `E[n]` instead
  of one destructured variable each: −995 B at N=256; another widget's slice read in place
  (`model[3].email`) instead of a named const: −1,217 B; `when(node, cond)` called by the binding
  instead of a `when(node)` function per block: −890 B; the app building the section and passing
  the elements and the slice as the first parameters, the same two letters in every widget:
  −692 B.
- **List rows**: a row keeps its current item, so toggle and remove use it (no `find` callback,
  `indexOf`); the row's `set` is its binding, scheduled by a toggle, so the list lost `patch`;
  adds and drops are scheduled as their own edits, so the list lost its edit queue; rows are
  `[node, set]` pairs.
- **Defaults for the common case**: `on(node, handler, type = "click")` (checkboxes handled on
  click, selects on input, so `"input"` is the only type spelled), `prop(node, value, key =
  "value")`: −0.2% and −0.24% at N=256 in unique, shared even.
- **Unique markup and code**: optional end tags left out (`</option>`, `</p>` before a block or
  its parent's end), headings, labels and options left out of the element list, the handle as
  the load function carrying the arms, loose equality between values of one known type.
- **Shared**: widgets numbered in the model and readers (summary sources as numbers), a filter's
  pool as its texts, the page table a function called per mount (no `structuredClone`), the
  handle as the load function.
- `settled()` as `Promise.resolve(done)`.

## What did not help

- A per-widget `click` helper or a `val` helper in the runtime: +524 B and +1,065 B in unique.
  Any new top-level function shifts every minified name.
- Binding groups in one object by field name (`G.tone`): +2.3 kB at N=256.
- List rows from markup (`createContextualFragment`): smaller up to N=128, +92 B at N=256.
- Initial list items as `L("a", "b")` (with or without `[text, done]` pairs), or todo items as
  pairs in shared: smaller at N=256, +20…+30 B for small apps.
- The state slice as a default parameter, always passing `model`, the widget's own readers as a
  parameter, heading written by `section`, `el` with a string as its role, `drop(item)`,
  `content ?? ""` in `el`: within noise, some sizes up.
- Close to the line: the `on` and `prop` defaults each raised shared N=1 against the step before
  (+9 B and +4 B) while saving over all builds; shared N=1 ends equal to main's (1,096 B), every
  other size below.

## Learned

- Brotli at quality 11 moves a single build by up to ±60 B for a change of a few raw bytes
  anywhere, even with the app code byte-identical; and the HTML shell moves by ±8 B with the
  bundle's content hash. The sum over all 27 builds of a scenario was a steadier signal than
  the medians; changes were kept when it fell, with every median at or under main's.
- What paid most was not shorter code but fewer distinct identifiers per widget: minified letter
  assignment is per function, so anything a widget names itself makes it unlike its neighbours.
