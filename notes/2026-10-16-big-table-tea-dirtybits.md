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
