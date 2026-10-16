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
- First try passed.

## Results

- `./rr check big-table tea-local`: ok at sizes 1, 4, 16, 64 x seeds 1-3; locality 1.0x. The
  three other scenarios still ok. Build twice: byte-identical.
- Work over N=16 to 256: every local action flat (the table does not grow with N).
- Rows axis (N=16, 1000 to 10000 rows): O(1) are select and swap only. Remove, serverDelete,
  serverUpdate, removeChecked, serverRows are O(rows) (filter/map plus the keyed walk). Toggle and
  bump look flat in calls only because their target row is near the front (findIndex exits early);
  they still slice the array and walk every row.
- Bytes (mean of 3 seeds): N=1 2203, 16 6546, 64 14445, 256 41213 B; 4134 + 147.6 B/table over
  N >= 4. Runtime 887 B.

## Review fix

The first version wrote the O(rows) scans as plain loops (find, drop, setColumn, has) because
`./rr work` counts calls. That fitted the code to the measurement, hid the rows-proportional
cost, and was inconsistent (removeChecked used filter). Replaced with findIndex, filter, some,
map and reduce, as the other tea-local emitters do; dropped the `loops` style entry and the
claims about it. Effect: bytes slightly smaller (4182 + 147.6 to 4134 + 147.6 B per table; N=256
41256 to 41213); remove 14 to 1021 calls, serverDelete 12 to 498, serverUpdate 53 to 1053 (1000
rows). The snapshot handler's direct model set is commented.
