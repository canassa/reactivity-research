# 2026-10-16: tea-local on big-table

Wrote `scenarios/big-table/tea-local.js` and the opt-in runtime file
`frameworks/tea-local/template/table.js` (keyed list of row nodes with `get`, `mark`,
`rowEvents`). The other scenarios' output is unchanged (only `framework.js` gained `runtimeFile`
and classifies `table.js` as runtime).

## Design

- One instance per table; model `{ rows, selected, nextId, rng }` in the closure; a jump-table
  reducer written out per table; constructors 0-2 are the external events, then the toolbar
  buttons, then the row controls at `base + column` (holes in the array).
- Rows are not instances: see `frameworks/tea-local/README.md` (big-table).
- Binding list: rows (skipped unless the array changed), each row's cells, the selection marker
  via the key map. A delegated click listener on the body sends the control's column
  constructor with the row key.
- First try passed. Note `./rr work` counts calls, so scans over rows are plain loops
  (`edit`, `dropIds`, `setColumn`, `has`); the blocks count does not see the keyed list's walk.

## Results

- `./rr check big-table tea-local`: ok at sizes 1, 4, 16, 64 x seeds 1-3; locality 1.0x. The
  three other scenarios' tea-local checks still ok. Build twice: byte-identical.
- Work, N=16 to 256: every local action flat (select 10 calls, remove 14, toggle 17, bump 25).
  Rows 1000 to 10000: same flat calls; `updateEvery`, create, append, sort, `serverRows`
  proportional.
- Bytes (mean of 3 seeds): N=1 2230, 16 6592, 64 14488, 256 41256 B; 4182 + 147.6 B/table over
  N >= 4. Runtime 887 B.
