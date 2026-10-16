# 2026-10-17: tea-local on derived-graph

**Done.** `scenarios/derived-graph/tea-local.js` and a new opt-in runtime file,
`frameworks/tea-local/template/graph.js`. Nothing else's output changed (the other scenarios'
tea-local checks pass; `classify` in `framework.js` learned the new file).

**Structure.** One instance per input, per formula (its model is the cached value) and one for the
items section; a unit's displays are the binding list of its formula's instance. A formula is a
reader sent its one message when a source changes. Jobs run in rank order (creation order is a
topological order), so a diamond recomputes once, and a value that did not change tells nobody.
Rows are not instances. See `frameworks/tea-local/README.md`, "derived-graph".

**Results.** `./rr check` passes at sizes 1, 4, 16, 64 with seeds 1-3 and at 16 with fanout low and
high; locality 1.0x (65 calls for the chain input at every N). Brotli at N=256: 20.8 / 26.8 / 35.9
kB for low / mid / high; slope over N >= 16 is 67.9 / 91.5 / 127.9 B per unit.

**Learned.**
- The items instance needs `quiet` arms (a note, the markup). Without them a note keystroke costs
  44k calls at N=16 and 449k at N=256, and the markup 52k to 427k: the locality check fails
  (10.1x). Only the compiler's knowledge of what each message touches fixes it.
- A display-only dependency must not recompute a formula, so a cell's `refresh` and `patch` are
  separate subscriptions.
- The item edits are the cost: 49k calls for one quantity at N=16 and 527k at N=256 (each formula
  over the items re-runs once, O(rows)). That is the coarse subscription; no per-field tracking.
- A top-k whose key reads a scalar cell has to rewrite its rows (the keyed list patches on item
  identity only).

**Not committed:** the measurement in `/tmp/rr-dg5-measure-{low,mid,high}`.
