# 2026-10-16: big-table in Elm

Wrote `scenarios/big-table/elm.js` (framework `frameworks/elm/`, unchanged). A module per table
(`Table<i>`: `Model { rows : Array Row, selected, nextId, rng }`, `Row`, `Msg` with a constructor
per button and row control, `update`, `newRow`, `view`, decoders); `Main` holds one field per table
and wraps each `Msg` with `Html.map`. Table 1 follows js-framework-benchmark's `keyed/elm`:
`Html.Keyed.node "tbody"`, `lazy2 viewRow isSelected row` per row, rows in an `Array`, the PRNG in
the model (their `Random.Seed`, here the contract's Park-Miller step in `Ui.next`).

- Style choices are in the emitter's header and `style` (rr.json). Beyond the entry: `Html.Lazy`
  also on each table (`Html.map GotTableN (lazy TableN.view model.tableN)`), so an event in one
  table does not diff the rows of the others. `selected` exists only in tables with a select
  control, and `Ui.ariaSelected` renders no attribute while unselected (Elm's `class` property
  would leave `class=""`, which the panel tolerates, but `aria-selected` would not be tolerated).
- `Ui` (generic helpers only): attributes, `next`/`pick`/`between`/`build`, number and date
  formatters, row helpers over `{ r | id : Int }`. Written per app only for what a table uses.
- Currency cents use `floor (toFloat v / 100)`: Elm's `//` truncates to 32 bits and a computed
  product (quantity times price) reaches 5e11.
- `./rr check big-table elm`: 0 mismatches at N = 1, 4, 16, 64, seeds 1-3. Output passes
  `elm-format --validate` (N = 1 to 256). Builds are byte-identical and run offline (`unshare -rn`).
- Size (brotli, seed 1): N=1 9,258 B; N=16 16,707; N=64 31,145; N=256 81,742. Runtime flat at
  about 8.2 kB (kernel + packages), app 1.5 kB at N=1 to 73.3 kB at N=256. Fit over N >= 4:
  12,171 B + 278.4 B per table (R2 0.998).
- `elm make` takes 390 s at N=256 (48 s at N=1, 58 s at 16): the compile time grows faster than
  the app, probably the 256-field `Model` and its `andMap` decoder in `Main` plus 256 modules.
- Work, N 16 to 256 (rows 1,000): every local action grows 1.00-1.35x (median 1.07x), against
  16x more tables; the whole-state snapshot 1.33x. Elm's per-table `lazy` makes events local;
  what still grows slightly is `Main.update`'s record copy (`_Utils_update` over N fields) and
  `Html.map` over N tables.
- Rows axis (N=16, 1,000 to 10,000 rows, calls): select 18,267 to 188,924; swap 18,132 to 188,795;
  toggle 15,370 to 159,898; remove 9,754 to 100,662; update every k-th 40,855 to 416,363; replace
  all rows 218,354 to 2,191,322. All about 10x: a select costs about 18 calls per row, because
  every row's lazy node is built and compared (the update is O(1), the view diff is O(rows)).
- `./rr work` at `--rows 10000` runs under the profiler with the JIT off, so it is slow (about
  3.5 min at 6,000 rows, 9 min at 10,000; two of 29 counts differed between its two fresh pages).
