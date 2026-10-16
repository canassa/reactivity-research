# 2026-10-16: making tea-local smaller

The goal was fewer brotli bytes for tea-local in both scenarios, with no call count higher than
before and the strategy unchanged: a closure per instance, real messages to its own `send`, its
own reducer, then its own binding list, readers watching their sources, DOM built once.

## Results (brotli total, median of 3 seeds; fits by least squares over runs.json sizes)

| | N=1 | N=16 | N=256 | all sizes | N >= 16 |
|---|---|---|---|---|---|
| shared, before | 1153 | 4348 | 11482 | 2764 + 37.0/w | 4157 + 29.1/w |
| shared, after | 1156 | 3780 | 10303 | 2420 + 33.3/w | 3621 + 26.5/w |
| unique, before | 1633 | 7316 | 59549 | 3200 + 226.3/w | 4941 + 216.5/w |
| unique, after | 1587 | 6514 | 54983 | 2789 + 209.0/w | 4405 + 199.9/w |

`rr work` (default sizes 16 to 256, seed 1), record by record: no count higher. Totals: shared
calls 9405 -> 7730, blocks 13766 -> 8448; unique calls 13468 -> 10171, blocks 19457 -> 10941.
`rr check` passes at sizes 1, 4, 16, 64 x seeds 1-3 in both scenarios, locality included; two
builds are byte-identical.

## What helped

- **Unique widgets from static templates** (-13 B/widget): the widget's markup is one string,
  its elements addressed as `e[i]` in document order; a list row has its own template; trailing
  end tags left out, as Solid's compiler does.
- **Events as Elm-style helpers** in unique: `onSend(node, self, msg)` (onClick msg),
  `onValue(node, self, tag)` (onInput Tag), `onInt` (a bounded integer decoder).
- **The model as a property** (`self.m`, not `self.model()`), lists keyed by `item.id` (which
  they also write as `data-key`): fewer bytes and fewer calls.
- **One forward placement pass instead of the vendored reconcileArrays** (-480 B baseline in
  both scenarios; tea-inline and tea-dirtybits did the same on their branches). Moves no more
  nodes for the scenario's adds, removes, filters and reversed runs; a rotation is its worst case.
- **The shared widget frame registers instances** (a Map), so the app no longer writes a
  `{ w1: a, w2: b, … }` map with a name per widget (-2.6 B/widget).
- Small: instances schedule their own first patch; ARIA states written as reflected properties
  (no `setAttr`); placeholder text nodes in elements instead of a `text()` helper.

## What did not help (measured, reverted)

- **Templates for shared kinds**: +200 B at N=16. Config-driven text needs appends after the
  clone, and `element()` calls repeat across kinds so brotli takes them cheaply.
- **`onSend`/`onValue` in shared kinds**: +22 B; the arrows are paid once per kind.
- **Named elements (destructuring) instead of `e[i]`** in unique: +7 B/widget. Indexes compress
  better than fresh minified names.
- **Positional factory arguments in shared** (as tea-inline did): -135 B at N=256 but +10 at N=1
  and a higher fitted baseline; the config keys already compress well. Reverted.
- **The registry in unique**: +25 B at N=1, -150 at N=256; the `widgets.wN = …` lines are
  sequential and nearly free. Reverted.
- **Models as `patch`'s default parameters** in unique: within noise.

## Rules of thumb

- brotli rewards repetition across the bundle: a shape repeated per widget (`n[5]`, an
  `element(...)` call) beats a shorter but unique spelling.
- The vendored reconcile was the biggest single cost in the baseline.
- The N=1 shared median moved by +3 B (1153 -> 1156): the registry costs a dozen bytes when
  there is one widget; within brotli noise, but not lower.
