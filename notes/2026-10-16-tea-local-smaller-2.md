# 2026-10-16: making tea-local smaller, round 2

Same goal and rules as round 1: fewer brotli bytes in both scenarios, no call count higher, the
strategy unchanged (a closure per instance, real messages to its own `send`, its own reducer,
then its own binding list, readers watching their sources, DOM built once).

## Results (brotli total, median of 3 seeds; fits by least squares over runs.json sizes)

| | N=1 | N=16 | N=64 | N=256 | all sizes | N >= 16 |
|---|---|---|---|---|---|---|
| shared, before | 1156 | 3780 | 5523 | 10303 | 2420 + 33.3/w | 3621 + 26.5/w |
| shared, after | 1090 | 3669 | 5290 | 9861 | 2348 + 31.6/w | 3523 + 25.0/w |
| unique, before | 1587 | 6514 | 17691 | 54983 | 2789 + 209.0/w | 4405 + 199.9/w |
| unique, after | 1548 | 6112 | 16088 | 49026 | 2730 + 185.9/w | 4286 + 177.1/w |

Every median of every size (1 to 256) is lower in both scenarios. `rr work` (sizes 16 to 256,
seed 1), record by record: no count higher. Calls: shared 7730 -> 7725, unique 10171 -> 10074.
`rr check` passes at sizes 1, 4, 16, 64 x seeds 1-3 in both scenarios, locality included; two
builds are byte-identical.

## What helped

- **unique: events wired by document order** (-1.9 kB at N=256): the factory gives `widget()`
  one message tag per control of its template and the runtime's `wire` attaches them (click for
  buttons and checkboxes, input for text, selects and numbers); a row passes its item id once.
  It replaces one `onSend(e[5], self, [3])` call per element: the index and the call go. The
  number input's range check moved into its reducer case (Elm's `onInput` plus a `Maybe Int`).
- **unique: `place(node, shown)` with an empty text node as the hidden element's stand-in**
  (-1 kB at N=256): a conditional no longer names its parent and every later sibling.
- **Messages as `send(tag, value)`, reducers as `update(model, tag, value)`** (unique -418 B at
  N=256, shared -26 B): no array per message, and bare tags in the wiring.
- **The widget frame's registry holds the instances** (unique -290 B, shared -194 B at N=256):
  `widget()` already receives the instance, so factories return nothing, the app names nothing,
  readers and summaries take their sources by id, the tick goes to the clocks by id.
- **shared: positional config arguments** (-148 B at N=256, -32 B at N=1): with the counter's
  reducer closing over its limits, the runtime's `config` parameter went too. (Round 1 measured
  this alone as +10 B at N=1; with the reducer in the factory it is lower at every size.)
- **unique: the initial model in the `instance` call and the reducer inside the factory**
  (-5.6 and -2.7 B per widget).
- **unique: `tick`/`notify` routed only when the app has a time-driven widget or a feed.**
- Small: the flush queued from `pending.size` and emptying the set it iterates; `parent?.append`;
  element text appended only if non-empty; the counter's messages as literals (no named
  constants); ARIA states as `${bool}`; a summary's single-use terms written in place.

## What did not help (measured, reverted)

- **Moving `settled` into the adapter**: smaller, but it moves counted runtime bytes into the
  excluded adapter. Reverted on the coordinator's request (it is measurement gaming); costs
  7-28 B per median.
- **Leaving out optional end tags** (`</p>`, `</option>`) in unique templates: noise (+-15 B).
- **The section element in the template, or the widget id passed by the app**: +20 to +160 B.
- **A module-level dashboard instead of a `parent` parameter**: +430 B at N=256; it shifts every
  factory's local names away from the runtime's (e, t, n) and brotli loses the matches.
- **Rows as `[node, patch]` arrays**: +95 / +47 B summed; the `{ node, patch }` shape repeats.
- **`patch(m)` with the model passed by the flush**: shared worse, unique small sizes worse.
- **The frame creating the instance** (`const [self, e] = widget(…, model, update, patch, …)`):
  -307 B at N=256 but +10 to +23 B at N=1-8, a trade.
- **`onInt` kept for number inputs** (the wiring skipping them): +180 B at N=256.
- **Inlining single-use model reads** (`w3.m.x` instead of `const m3 = w3.m`): noise.
- **`setText` through `textContent`** (no placeholder text nodes): -118/-292 B summed, but it
  replaces the text node on every change instead of writing its data; not taken.
- **shared: `place` instead of `show`** (+251 B), **`wire` in the shared kinds** (a fixed cost
  per app for a saving per kind: a trade).
- **Specialised `setValue`/`setChecked` helpers**: no information saved, so no bytes.

## Rules of thumb

- The minifier names top-level bindings in declaration order. Which letters the helpers the
  widget code calls get moves the unique totals by +-150 B at N=256 (removing one top-level
  binding shifts every name). Changes to the runtime were judged by the sum over all 27 runs of
  a scenario, with single medians allowed to move by noise; the named selector constants in
  `wire` are kept because the version without them measured larger.
- What brotli cannot remove is information: indexes, tags, prop names and expressions. The wins
  this round removed information (element indexes for events and placement, parents and later
  siblings, the instance's return path), not syntax.
- The modulepreload polyfill (about 670 B minified) is still shipped: it is Vite's default for
  every framework here, and turning it off for one approach would not be a fair comparison.
