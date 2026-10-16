# 2026-10-16: making tea-local smaller, round 3

Same goal and rules as rounds 1 and 2: fewer brotli bytes in both scenarios, no call or block
count higher, the strategy unchanged (a closure per instance, real messages to its own `send`,
its own reducer, then its own binding list, readers watching their sources, DOM built once).
This round also avoided trades: a change that grew a small app was dropped.

## Results (brotli total, median of 3 seeds; fits by least squares over every run of sizes 1 to 256)

| | N=1 | N=16 | N=64 | N=256 | all sizes | N >= 16 |
|---|---|---|---|---|---|---|
| shared, before | 1090 | 3669 | 5290 | 9861 | 2348 + 31.6/w | 3523 + 25.0/w |
| shared, after | 1078 | 3504 | 5068 | 9162 | 2270 + 29.2/w | 3385 + 22.9/w |
| unique, before | 1548 | 6112 | 16088 | 49026 | 2730 + 185.9/w | 4286 + 177.1/w |
| unique, after | 1494 | 5710 | 14795 | 44205 | 2633 + 167.5/w | 4139 + 159.0/w |

Every median of every size (1 to 256) is lower in both scenarios. `rr work` (sizes 16 to 256,
seed 1), record by record: no count higher. Calls: shared 7725 -> 7725, unique 10074 -> 9832;
blocks: shared 8443 -> 8443, unique 10844 -> 10602. `rr check` passes at sizes 1, 4, 16, 64 x
seeds 1-3 in both scenarios, locality included; two builds are byte-identical.

## What helped

- **Reducers as jump tables** (unique -1.4 kB, shared -60 B at N=256; N=1 lower in both):
  `case msg of` compiles to an array with one arrow per constructor, indexed by the tag, each
  `(model, value) => …`; `send` calls `update[tag](model, value)`, one call as the switch was.
  Giving every arm the same parameters measured smaller than dropping unused ones (brotli likes
  the repeated `(e,t)=>`). tea-dirtybits found the same table on its branch.
- **The table passed straight to `instance`** (unique -0.5 kB summed; shared -1.3 kB summed,
  every median lower): `instance(model, [arms…], patch)`; in shared the kinds' tables moved from
  module level into the factory.
- **`patch` as a `const` arrow declared before the instance** (unique -1.3 kB summed, shared
  -0.5 kB summed, every median lower in both): it runs only after mount, so it can come first.
- **unique: messages numbered by their controls' document order** (-1 kB at N=256): a compiler
  chooses its constructor tags, so the template's controls take 0, 1, 2, … and each row's
  controls the next ones; `wire` counts from a first tag and no tag list is written.
- **List rows as element arrays** (`list(parent, build, patch)`, `patch(row, item)`), and in
  unique a frame `row(html, self, first)` that clones, wires and returns the row's elements
  (`wire` returns them): -0.8 kB at N=256 in unique.
- **Widgets numbered in page order by the frame** (shared -0.6 kB, unique -0.5 kB at N=256): the
  ids are `w1`, `w2`, … (checked by the emitters), so the frame takes the next one from its
  registry's size and nobody spells them. tea-inline does this on main.
- **unique: enum cycles as a chain of comparisons** (-0.6 kB at N=256, from tea-inline on main),
  with the same wrap to the first option for the last or any other value.
- **unique: sections and the dashboard parsed from markup** (`insertAdjacentHTML`), so unique
  apps ship no `element()` (-17 B at N=1).
- **unique: a reader watches its sources right after its patch** (-0.5 kB summed).

## What did not help (measured, reverted)

- **Partial records** (arms return only the changed fields, `send` merges them): unique -200 B
  at N=256 but +11 B at N=1; shared +12 B at N=1. A trade.
- **Self-registering widget modules** (each module pushes its factory, the app loops):
  -870 B at N=256 in unique, but +9 B at N=1 (the loop and array). A trade, dropped.
- **Kinds' default `init`** (shared: omit the initial model when it is the kind's init, as a
  default parameter): -0.8 kB at N=256 but +2 to +11 B at N=1-32. A trade.
- **The instance's own patch as its first watcher** (one `schedule` call less in the source):
  smaller, but one more block per message (a loop iteration). Reverted for the block counts.
- **Routing `send` through `self.set`** so `subscribe` wraps only `set`: +4 / +11 B at N=1.
- **`watch` returning the instance, a frame `read(id, patch)` helper, an exposed `watchers`
  array**: mixed, within noise or worse at small sizes.
- **The heading passed apart from the template**, **elements indexed without the section and
  heading** (`.slice(2)`), **`value += ""` in `setText`**, **loose equality**, **single-statement
  row patches as expressions**, **a successor table for cycles**, **patch's model as a default
  parameter**: within noise (single medians moved both ways by up to 30 B).

## Rules of thumb

- brotli is chaotic at this scale: a 5-byte runtime change moved one N=256 build by 87 B, and the
  HTML (whose script name carries the content hash) moves by up to 9 B between builds. Changes
  were judged by the sum over the 27 runs and then by every median; only consistent wins kept.
- Oxc inlines a single-use `const` (an arrow `patch` used once is the same bytes whether named or
  passed inline), but not a module-level table.
- The wins were declaration shapes the minifier can pack (arrows in a `let` chain, tables
  instead of switches) and information a compiler owns (tag numbers, widget numbers).
