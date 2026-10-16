# 2026-10-16: big-table as tea-inline

Wrote `scenarios/big-table/tea-inline.js` and `frameworks/tea-inline/template/rows.js`, the
runtime file only this scenario includes (`templateFiles({ extra: ["rows.js"] })`). The other
three scenarios' generated output is byte-identical (sha256 of `src/`, before and after).

## What was done

- **Emitter:** one module per table, from its description alone. The markup is one static string;
  rows are cloned from one row template per table; every operation is inlined into its control's
  action (no op table, no column table). The row builder is written out per table with the table's
  own pools; initial rows are built at mount with it.
- **Selection:** each row has a `mark` binding reading `s.selected === item.id`. The compiler
  knows this reads one row's key, so select schedules the `mark` of the old and the new selected
  row, found by id (`list.get`): 7 to 9 calls, whatever the rows.
- **Runtime (`rows.js`):** the keyed list. Reconcile by id; when no row is reused the body is
  emptied in one go; a reused row whose item is the same object is not repainted (every in-place
  edit schedules its own row). `add`, `drop` and `swap` serve in-place edits and are dropped when
  the array was replaced since (found while reasoning about a flush that mixes both: an old edit
  would undo a reconcile). Swap moves two nodes, not a rotation.
- **External events** are the same for every table, so `app.js` has them once: they copy the
  message's rows and schedule the list or the touched rows.

## Checks

`./rr check big-table tea-inline` at sizes 1, 4, 16, 64 and seeds 1-3: 0 mismatches, focus losses
and keyed replacements; locality 1.0x (worst: select, 17 calls at N=16 and 256). The checks of
shared-components, unique-components and big-component still pass. Builds are byte-identical.

## Sizes (brotli, medians of 3 seeds; `./rr measure`, not committed)

N=1 2209 B (runtime 959, app 1105, html 140), N=16 6510, N=64 14461, N=256 41543. Fit over
N >= 4: 4071 B + 148.4 B per table (R2 0.996). The runtime is 1180 B from N=4 on (rows.js
functions are tree-shaken by use).

## Work (calls per action, N=16 to 256, --rows 1000: all 1.00x)

Rows axis, N=16, 1,000 rows against 10,000 rows:

| action | 1k | 10k | |
|---|---|---|---|
| select a row | 7 | 7 | O(1) |
| bump, toggle, swap, clear | 17, 10, 8, 6 | same | O(1) in calls |
| remove a row | 8 | 8 | O(1) calls, but `indexOf` scans the array (native, so not counted) |
| update every k-th row | 603 (t1) | 6003 | proportional |
| create, append | 14k (t1) | 140k | proportional |
| sort | 6.3k, 8.7k | 65k, 120k | proportional |
| remove checked | 1006 | 10006 | proportional |
| serverRows, serverDelete, serverUpdate | 4.6k, 494, 1.8k | 45k, 5.0k, 29k | proportional (`find`, `filter`) |

The scans are written the natural way (`indexOf`, `find`, `filter`, `some`), as in the other
emitters; no scan was reshaped to change what the call counter sees.

## Review fixes (same day)

- **Stale clicks:** remove looks the item up by id (`findIndex`) and returns when it is gone;
  toggle and bump do the same with `find` and write to the current item. Verified in Chrome: two
  clicks on one remove in a task remove one row (before, the second removed the last row). The
  scans are now visible to the call counter (remove 8 -> 12 calls, toggle 10 -> 13, bump 17 ->
  23, all flat in N and in rows, because the work actions use rows near the start).
- **Runtime/app split:** `rows.js` keeps only `tpl` and `rows` (runtime). The PRNG, formatters,
  `state` and `keepSelected` moved to `scenario.js`, classified as app. Total unchanged in
  substance; split at N=1 runtime 959 -> 853 B, app 1105 -> 1227 B; at N=256 runtime 1180 -> 855 B.
- **Sizes** (median of 3 seeds): N=1 2227, N=16 6516, N=64 14487, N=256 41634; fit N >= 4:
  4096 B + 148.6 B per table (R2 0.996). Before: 3472/4071 + 151.8/148.4.
- **Markup trimming** (dropped end tags, unquoted attributes) saves 0.8%: +110 B at N=64, +335 B
  at N=256 when written out.
- Checks, other scenarios (generated `src/` hashes unchanged) and work (N=16..256 flat; rows axis
  as before apart from the three lookups above) rerun.
