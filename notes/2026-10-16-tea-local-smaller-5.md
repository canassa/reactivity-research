# 2026-10-16: making tea-local smaller, round 5

Same goal and rules as rounds 1 to 4: fewer brotli bytes in both scenarios, no call or block
count higher, the strategy unchanged (a closure per instance, real messages to its own `send`,
its own reducer, then its own binding list, readers watching their sources, DOM built once).
No final median may be above the round's start.

## Results (brotli total, median of 3 seeds; fits by least squares over every run of sizes 1 to 256)

| | N=1 | N=16 | N=64 | N=256 | all sizes | N >= 16 |
|---|---|---|---|---|---|---|
| shared, before | 1067 | 3409 | 4942 | 8980 | 2212 + 28.8/w | 3282 + 22.7/w |
| shared, after | 1067 | 3393 | 4938 | 8976 | 2205 + 28.8/w | 3271 + 22.8/w |
| unique, before | 1475 | 5606 | 14434 | 43240 | 2588 + 163.7/w | 4040 + 155.5/w |
| unique, after | 1474 | 5542 | 14254 | 42560 | 2575 + 161.2/w | 4014 + 153.1/w |

Every median of every size (1 to 256) is at or below the start in both scenarios; sums over the
27 builds: shared 103,813 -> 103,616 B, unique 320,762 -> 316,653 B. `rr work` (sizes 16 to 256,
seed 1), record by record: no count higher. Calls: shared 7635 -> 7635, unique 9762 -> 9762;
blocks: shared 8353 -> 8353, unique 10532 -> 10532. `rr check` passes at sizes 1, 4, 16, 64 x
seeds 1-3 in both scenarios, locality included; two builds are byte-identical.

## What helped

- **unique: a reader's patch declared after its instance** (-435 B at N=256): as a `const`
  declared first, a reader's patch took the block's first minified name and shifted the
  instance and elements away from the names the other blocks use (110 of 256 widgets read
  another). Then superseded by the next item.
- **unique: readers made by the frame's `reader(sources, model, update, patch)`** (-143 B at
  N=256 on top, -934 B summed): it has the patch watch the sources and calls `instance`, so a
  reader's patch is an inline arrow like every block's. Tree-shaken from apps without readers;
  apps with few readers pay up to 13 B for it, still below the round's start.
- **unique: the frame's `setProp(node, value, key = "value")`** (-74 B at N=256 on top, every
  median lower than the start): 222 of the 569 property bindings at N=256 write a form value.
  The same signature in the runtime made the dashboard larger (+11 B at N=1), so the runtime
  keeps `setProp(node, key, value)`, which unique apps tree-shake.
- **The keyed list compares rows with the parent's `childNodes`** instead of keeping the last
  order (unique -275 B summed): the list owns every child of its parent; the placement pass
  walks the new row map. Same calls and blocks.
- **shared: checkboxes listen on `click`, selects on `input`** (-197 B summed, every median at or
  below the start): two event types instead of three, as unique's `wire` does.

## What did not help (measured, reverted)

- **unique: arms without `...m` when they set every field** (single-field models, resets):
  +573 B summed. The repeated `({...e,` is cheaper than the variety; uniformity beats length.
- **unique: the instance as the element array** (`widget(main, html, model, arms, patch)`,
  `Object.assign` on the array; the shared kinds' section as their instance): +41 B at N=1 to 16,
  -127 B at N=256. A trade.
- **unique: element lists without `h2`, `label`, `option`** (`:not(…)` selector, smaller indexes):
  +14 to +31 B at N=1 to 32, -85 B at N=256.
- **unique: every widget made by `reader`** (also `reader([], …)`): +27 B at N=1.
- **unique: `reader(model, update, patch, ...sources)`, or an arrow with `map`**: worse than the
  array-first function.
- **unique: `App(root, main = …)` as the dashboard function**: +434 B summed.
- **shared: `element(parent, tag, role, content, attrs)`** (the `data-role` as an argument):
  +19 B at N=1.
- **shared: `on(node, handler, type = "click")`**: -59 B summed but +1 B at N=1, in either place
  in the runtime.
- **shared: the dashboard kept by the frame** (kinds without a `parent`): +13 B at N=1, +36 at
  N=256 (the kinds' names shift).
- **shared: the counter's messages numbered in DOM order** (Dec, Inc, Reset): noise (+4 at N=1).
- **The runtime's `setProp(node, value, key = "value")` for both scenarios**: unique -695 B
  summed but shared +65 and +11 at N=1.
- **The list's placement pass over `r[0]` rather than destructuring `[node]`**: +30 B at N=256
  in shared.

## Rules of thumb

- Minified names keep deciding the unique totals: a declaration's position in a block (the
  reader's patch) was worth 400 B at N=256, more than any expression change this round.
- Uniform spellings beat shorter ones: removing `...m` where it was redundant grew every size.
- The dashboard is at brotli's noise floor (single medians move by +-15 B for a 10 B change);
  only changes that remove a construct everywhere (an event type) were consistent.
