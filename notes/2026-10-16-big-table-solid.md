# 2026-10-16: big-table in Solid 1

Wrote `scenarios/big-table/solid.js`: one component per table, one `createStore` for the page
(`{ rows, selected, nextId, rng }` per table), `<For>` over the rows, `createSelector` for the
selection, `reconcile(…, { key: "id" })` for `serverRows` and `snapshot`. Table 1 follows
js-framework-benchmark's keyed/solid (textContent cells, id captured once).

- `./rr check`: 0 mismatches at N = 1, 4, 16, 64, seeds 1-3. Builds are byte-identical.
- Size (seed 1, brotli): N=1 8,051 B; N=16 14,167; N=64 26,459; N=256 68,610. Runtime is flat at
  about 6.6 kB; fit over N >= 4: 10,443 B + 233.0 B per table (R2 0.998).
- Work, N 16 to 256: every local action is flat (ratio 1.00); only the snapshot grows (1.58x).
- Rows axis (1,000 to 10,000 rows, N=16): select goes from 2,067 to 20,067 calls. Solid 1's
  `createSelector` visits every subscribed key on a change (two comparisons per row), although it
  touches only two rows in the DOM. This is the idiom of the official entry, so it is kept.
  Swap, remove and toggle grow the same way for another reason: store updaters (`filter`, a row
  filter path) are O(rows).

## Review fixes

- `textContent` now only in table 1 (the js-framework-benchmark app); tables 2 to N use JSX
  children, as an expert writes them. Slope over N >= 4: 233.0 to 225.7 B per table.
- The Solid adapter no longer imports `DelegatedEvents` (a 22-string Set the app never uses). On
  dispose it keeps the names in Solid's own `_$DX_DELEGATE` set, clears, and re-registers those
  on the next mount. Runtime bytes at N=64 s1 (brotli, runtime / total):
  shared 11,655 total before, 11,555 after (runtime 6,415); unique 26,031 to 25,951 (6,535);
  big-component 14,675 to 14,564 (6,530); big-table (both fixes) 26,459 to 25,489 (6,532, from
  6,626). Committed results of the other scenarios are stale until `./rr report`.
