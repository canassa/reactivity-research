# 2026-10-16: making tea-local smaller, round 4

Same goal and rules as rounds 1 to 3: fewer brotli bytes in both scenarios, no call or block
count higher, the strategy unchanged (a closure per instance, real messages to its own `send`,
its own reducer, then its own binding list, readers watching their sources, DOM built once).
Trades that grow a small app were dropped.

## Results (brotli total, median of 3 seeds; fits by least squares over every run of sizes 1 to 256)

| | N=1 | N=16 | N=64 | N=256 | all sizes | N >= 16 |
|---|---|---|---|---|---|---|
| shared, before | 1078 | 3504 | 5068 | 9162 | 2270 + 29.2/w | 3385 + 22.9/w |
| shared, after | 1067 | 3409 | 4942 | 8980 | 2212 + 28.8/w | 3282 + 22.7/w |
| unique, before | 1494 | 5710 | 14795 | 44205 | 2633 + 167.5/w | 4139 + 159.0/w |
| unique, after | 1475 | 5606 | 14434 | 43240 | 2588 + 163.7/w | 4040 + 155.5/w |

Every median of every size (1 to 256) is lower in both scenarios; sums over the 27 builds:
shared 106,081 -> 103,813 B, unique 327,813 -> 320,762 B. `rr work` (sizes 16 to 256, seed 1),
record by record: no count higher. Calls: shared 7725 -> 7635, unique 9832 -> 9762; blocks:
shared 8443 -> 8353, unique 10602 -> 10532. `rr check` passes at sizes 1, 4, 16, 64 x seeds 1-3
in both scenarios, locality included; two builds are byte-identical.

## What helped

- **unique: each widget inlined as a block of one `dashboard(main)` function** (-5.5 kB summed,
  -807 B at N=256, every median lower): a unique widget's factory is called once, so the
  compiler inlines it. No factory name or call per widget (two-letter names past 54 widgets),
  and the minifier reuses the same local names in every block. `main` is the dashboard
  function's parameter so that a patch names its model `e`, as the reducer arms do (without
  the wrapper the blocks measured 1.2 kB larger).
- **The registry as an array in page order** (shared -576 B, unique -651 B summed, every median
  lower): `push` returns the new length, which numbers the widget; readers, summaries and the
  tick index it (`widgets[2]`) instead of `widgets.get("w3")`.
- **shared: `on()` returns its node**, so a control is built, wired and named in one expression
  and a control the patch never reads is not named (-450 B summed with the next item).
- **shared: the rating builds its constant init itself** (`{ stars: 0 }`), so its calls pass no
  model; the emitter checks the widget's initial model is that constant.
- **shared: tighter kinds** (-765 B summed): the amount writes through `valueAsNumber` and
  validates in its Set arm (as unique number inputs do), the todo's add arm is one guarded
  expression, the clock formats its time in its patch (one call less per tick), a summary's
  patch is an arrow, a rating pushes its buttons as built, a feed tests `!entries.length`.
- **unique: readers read `widgets[i].m` in place**, a feed keeps its Notify tag for the app to
  send (one call less per notify), the dashboard's end tag is left to the parser (-370 B summed).
- **unique: widget factories as arrows** (-392 B summed; made moot by the inlining, kept until
  then).
- Small: `settled` passes the promise's resolve straight to `queueMicrotask`; a list row is
  patched whenever its item changed, which a new row's missing item also is.

## What did not help (measured, reverted)

- **shared: kinds' init from their config** (`{ value: start }` for counters, the first option
  for choices, `{ query: "" }` for filters): -100 B at N=256 but +7 to +30 B at N=1 to 16, a
  trade; as a default parameter it was worse still. Only the rating's constant init was clean.
- **unique: dense numbering of bound elements** (a `b` marker removed by `wire`, as
  tea-dirtybits does): -148 B at N=256 but +26 B at N=1, a trade.
- **unique: initial list items built by helpers** (`items("a", "b")`, as digest does): worse at
  N=4 to 128; brotli already codes `{id:1,text:` cheaply.
- **unique: the dashboard as a frame variable** instead of a block parameter: +654 B at N=256;
  the names shift and the patch's model no longer matches the arms'.
- **unique: `instance(patch, model, update)` or `(model, patch, update)`**, a 1-based registry,
  `App` as an arrow, list rows parsed by a `Range`: mixed or worse.
- **shared: kinds as arrow constants**: worse at N=1 and N=256.

## Rules of thumb

- Minified names are information too: a per-widget name costs two references, and which name a
  model gets inside a closure decides whether it matches the arms around it. The inlining won by
  removing names; the frame-variable dashboard lost by shifting them.
- Small runtime edits still move single medians by +-20 B either way; changes were judged by the
  sum over the 27 builds and then by every median against the starting point.
