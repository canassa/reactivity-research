# 2026-10-16: a smaller digest, second round

## Done

- State is plain variables instead of one object per widget, on both scenarios.
  - shared-components: a kind's state is its factory's variables (its parameters where it can
    be). Each widget hands `widget()` a setter, `(v) => ({ value } = v)`, which `serverSet` and
    `snapshot` call. A feed keeps its entries on a record its factory returns (`E[k]`), because
    `notify` pushes into them by name.
  - unique-components: a field only its widget uses is a local of the widget's function, a
    field another widget reads is a module variable (`w1$files`), and a feed list stays on a
    record (`O`). The emitter finds the read fields from the views (`["w", id, field]`).
  - `up(k)` is gone: `receive` calls the setter, then `run(W[k])`. The setter call takes the
    place of the `up` call, so external events cost the same calls.
- unique-components: bindings name their element by distance from the previous binding's (the
  runtime keeps a cursor `P`); readers name their sources by distance back (`dep(2, 5)`);
  `bind` defaults to `value` and takes the property last; the number check reuses the handler's
  parameter; a one-statement click handler has no block in a block.

## Numbers

Brotli totals, adapter excluded, `runs.json` (sizes 1 to 256, seeds 1 to 3), medians, Node
26.11.1, Vite 8.3.4, Rolldown 1.2.14:

| | N=1 | N=16 | N=64 | N=256 | all sizes | N ≥ 16 |
|---|---|---|---|---|---|---|
| shared, before | 1,059 | 3,196 | 4,424 | 7,648 | 2,105 + 23.86 | 3,097 + 18.27 |
| shared, after | 1,053 | 3,154 | 4,399 | 7,634 | 2,088 + 23.78 | 3,062 + 18.29 |
| unique, before | 1,438 | 5,282 | 13,807 | 41,281 | 2,458 + 156.6 | 3,835 + 148.8 |
| unique, after | 1,420 | 5,068 | 13,029 | 38,790 | 2,400 + 146.7 | 3,680 + 139.5 |

Every size's median is lower on both scenarios. Calls (`./rr work`, seed 1, sizes 16 to 256),
record by record: none higher. Totals 12,059 → 12,054 (shared), 19,977 → 19,967 (unique).

`./rr check` passes on both at sizes 1, 4, 16 and 64, seeds 1 to 3, locality included (worst
5.3×, unique n=64 seed 2, a tick). Builds are byte-identical twice.

## Tried, didn't help

- Read fields on a record (`O.w1.files`) instead of module variables: −300 B at N=256 against
  −1,330 B. Getters would have kept them local, but a getter is a call per read.
- Separate `val`/`chk`/`dis` helpers: +4 B at N=1; the default property does better.
- Same `bind` signature on shared-components, the item role built by the runtime, the snapshot
  cloned once on unique-components: noise or worse.
- Delta 1 as a default argument, the heading written by the runtime: nothing (offline).

## Learned

- **Small-size medians move by a few bytes with any change.** Brotli at N ≤ 8 is noisy; a
  change that helps from N=16 can still lose 2 to 4 B at N=2 or N=8. The fit over all seeds is
  the steadier judge. Two kept steps raised one size on their own (the `bind` default: +3 B at
  N=2, +4 B at N=8; the handler bodies: +14 B at N=128), none raised N=1, 16, 64 or 256, and
  the whole round lowers every size.
- **Where the minifier can rename, names are free.** The field names stayed in the bundle once
  (in the setter, as genuine data of the external protocol); every other mention became one
  letter. Escape analysis (which fields leave their widget) decides where a field may live.
