# 2026-10-16: making tea-inline smaller

Goal: fewer brotli bytes for the tea-inline prototype in both scenarios, with its strategy
unchanged (messages erased into actions, compile-time dependencies, DOM built once) and no work
action making more calls than before.

## Result

Sizes from `./rr measure` (runs.json: sizes 1–256, seeds 1–3), compressed total, median of seeds:

| scenario | N=1 | N=16 | N=256 | fit, all sizes | fit, N ≥ 16 |
|---|---|---|---|---|---|
| shared-components before | 1127 | 4333 | 11288 | 2762 + 36.0/w | 4125 + 28.3/w |
| shared-components after | 1100 | 3700 | 10135 | 2367 + 32.6/w | 3529 + 26.1/w |
| unique-components before | 1591 | 7478 | 60706 | 3294 + 230.5/w | 5129 + 220.1/w |
| unique-components after | 1546 | 6739 | 56332 | 2893 + 214.6/w | 4663 + 204.6/w |

Work (`./rr work`, sizes 16–256, seed 1): no record went up; total calls 10296 → 7869
(shared) and 18247 → 12893 (unique).

## What helped (in order)

- **Unique widgets from one static HTML string** (elements picked by document order with a
  destructuring pattern), conditional sections included and swapped with an empty text node by
  `when(node)`: −4% at N=256. Removing the per-element parent references is most of it.
- **A small keyed pass instead of the vendored `reconcileArrays`**: about −450 B of baseline,
  fewer calls. Later replaced by tea-local's forward pass (shorter still), keyed by `item.id`
  like the other prototypes, so no key function is emitted per list.
- **`schedule` flattens with `flat(Infinity)`** instead of recursing: a little smaller, one call
  less per scheduled array.
- **Shared rows as positional arguments with their initial state** (`[counter, "w1",
  { value: 0 }, "Design tickets", 5, 0, 20, 0]`): −5% at N=256 in shared-components.
- **`section` writes the `<section>` wrapper** in unique-components: −0.3% at N=256.
- **`loader` schedules the first render**, so no widget spells out its initial `schedule`: −1%.
- **ARIA states as reflected properties** (from tea-dirtybits), dropping `attr`.
- **The widget id as a parameter** in unique widgets instead of a literal (the tea-dirtybits
  finding): −1.3% at N=256.

## What did not help

- List rows from a parsed `<template>` clone in unique-components: +1% (the `el` calls compress
  better for small rows).
- A one-binding group as a bare function rather than a one-item array: slightly larger.
- The widget's initial state inside its module (unique), or its state slice passed in its call:
  smaller at small N, larger at N=256; the init tree compresses better in one place.
- `<h2>` written by `section` too: mixed, within noise.
- Shared factories from static markup (as tea-dirtybits did): +0.8% at N=256; each per-widget
  text then needs an assignment.
- Estimated but not done: omitting optional `</p>`/`</option>` (under 0.3%), `click`/`input`
  helpers instead of `on(node, "click", …)` (0.1%), `onclick` properties (they would also escape
  the serve page's listener count). A number-input helper (tea-dirtybits' `onInt`) would add a
  call per input event, so it is out under the work rule.

## Learned

- Brotli punishes entropy, not repetition: what pays is removing distinct tokens (parent
  references, id literals, property names, a second tree keyed by id), not shortening repeated
  boilerplate. Estimates made by deleting text from a bundle overstate gains; only rebuilds count.
- Vite's modulepreload polyfill is about 260 B brotli in every Vite-built app here; disabling it
  (`build.modulePreload.polyfill: false`) is a build-config choice for all Vite frameworks at
  once, so it was left alone.
