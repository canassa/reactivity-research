# 2026-10-16: tea-dirtybits for big-table

Wrote `scenarios/big-table/tea-dirtybits.js` and `frameworks/tea-dirtybits/template/grid.js`
(runtime, included only by this scenario). One module per table; rows are dynamic data, so a
table has table bits (rows, selected, gone, moved, added) and a bit per data column of a row; an
arm returns `[bits, fields, payload]` with the rows it touched, and the grid's patch costs what
changed (README, "big-table").

## Checks

- `./rr check big-table tea-dirtybits` at sizes 1, 4, 16, 64 and seeds 1-3: 0 mismatches, 0 focus
  losses, 0 keyed replacements, clean dispose; locality 1.0x (22 calls both ends).
- The other three scenarios' tea-dirtybits checks still pass; builds are byte-identical.

## Numbers

Total brotli (median of seeds 1-3): N=1 2,503; N=16 7,629; N=64 17,937; N=256 54,596. Fit
N >= 4: 4,397 + 197.9 B per table (R2 0.998). Runtime 1,096 at N=1, about 1,360 from N=8.
Work (N=16 to 256): every local action flat (1.00). Rows axis, 1,000 to 10,000 rows: select, swap,
remove, toggle, bump flat at 13 to 22 calls and blocks; the rest grow with the rows.

## What was learned

- First draft rewrote `serverUpdate` and `serverDelete` as plain loops, which made their calls
  flat by hiding the O(rows) scan from the counter. Reverted to `findIndex` and `filter`, as the
  other emitters write them: they grow with the rows and the README says so.
- Carrying the row's current item in the message lets remove/toggle/bump find it with a native
  `indexOf`; that is still an O(rows) scan, only not a JavaScript call.

## Review fixes (same day)

- A stale click (a row removed earlier in the same tick) made `at()` return -1 and the remove arm
  `toSpliced(-1, 1)` removed the last row. Row arms now do nothing when the row is not found
  (`at`, `edit`, `cut`, select); `rowOf` is gone, the handler sends the id.
- Row messages are `{table, type, id}` as the contract says, not the row object; the arms find the
  row with `findIndex`. This costs 3 to 6 more calls per row action (select 14 to 20, remove 14 to 19,
  toggle 18 to 21, bump 22 to 28) and makes the reducer cost the row's index, which the rows-axis
  numbers hide only because the work actions use early rows. The earlier `indexOf` was a native
  O(rows) scan the call counter did not see.
- README now says what the payload is (a delta side-channel), that two events in a tick reconcile
  everything, and lists the rows axis by O(1), O(position) and O(rows).
- Totals, median of seeds 1-3, before to after: N=1 2,503 to 2,500; N=16 7,629 to 7,581; N=64
  17,937 to 17,894; N=256 54,596 to 54,493. Fit N >= 4: 4,397 + 197.9 to 4,402 + 197.2.
- Rechecked: big-table at sizes 1, 4, 16, 64 x seeds 1-3 (locality 1.0x), the other three
  scenarios; work at N=16 to 256 flat; rows axis above.

## Runtime/app split (same day)

The formatters and the reducers' row helpers moved out of `grid.js` into `rows.js` and
`format.js`, classified as app like vanilla's, Solid's and tea-local's helpers; `grid.js` keeps
the grid, `clone` and `idOf`. Runtime/app (seed 1): N=1 872/1,482 (was 1,116/1,237), N=64 892/16,887,
N=256 892/52,526. Totals move only by brotli noise (2,500, 17,919, 53,566).
