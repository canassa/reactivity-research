# 2026-10-17: derived-graph in digest (a dead end, kept)

## Done

- `scenarios/derived-graph/digest.js`, `frameworks/digest/runtime-graph.js` (selected through the
  existing `runtime` option) and `graph-helpers.js` (app code: `num`, `sum`, `avg`, `maxOf`, `minOf`,
  `top`, `grp`). The sheet is one binding list (formulas as `calc`, displays as `text`/`bind`,
  controls as handlers in document order); items are big-table's reconciler list plus one list per
  row. Formulas and displays are written out as code, nothing is interpreted.
- Correct on the first build: `./rr check derived-graph digest` passes at sizes 1, 4, 16, 64, 256,
  seeds 1-3, and `--fanout low`/`high` at 16. Builds are byte-identical. The other digest scenarios'
  checks are unchanged (big-component still fails its known locality).
- Locality fails: calls per local action grow 17x from N=16 to 256 (rows fixed at 2,000), 13.8x in
  `./rr check` (30 rows). No `digest` entry in `runs.json` (a `$comment`, and `$bench.also`).

## Decision

The sheet is one model with cross-cutting reads (any earlier cell, six levels deep), like flat
big-component. A list per unit with joined readers would need each input's list to carry its
transitive closure, chosen by the compiler: tea-inline's mechanism. Computed from the spec (seed 1,
mid, N=256): 1,991 read edges become 11,260 (binding, list) pairs; closed inputs' closures stay 12
and 9 bindings. Not built. No chunking.

## Learned

- A flat digest re-evaluates every aggregate on every event: the chain input costs 40k calls at
  N=64 with 1,000 rows and 420k with 10,000 (10.4x). Without memoization the "local" actions are
  not flat on the rows axis either.
- Sizes (mid, median of 3 seeds): N=1 1,967 B, N=16 3,642, N=64 7,557, N=256 21,744; fit N>=16
  2,597 + 75.3 B/unit. `low` 2,656 + 59.0, `high` 2,529 + 100.0. Measured to /tmp, not committed.
