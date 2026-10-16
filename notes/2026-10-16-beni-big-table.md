# 2026-10-16: big-table in beni (both browser platforms)

## Done

- `scenarios/big-table/shared/beni.js`, one generator for both platforms, and the emitters
  `beni-tea.js` and `beni-direct.js` (they only pick the framework's template files).
- Style (recorded in the generator's header and every app's `rr.json`): The Elm Architecture with
  `Tea.element`; one module per table (`Table.T1` ...) with its own `Row`, `Model` (`rows`,
  `selected`, `nextId`, `rng`), `init`, `Msg` (one constructor per operation and per row control),
  `update`, row builder, server events (`serverRows`, `serverUpdate`, `serverDelete`, `replace` for a
  snapshot) and `view`; `Main` only routes (`Html.map`, one-line branches, the `Event` schema).
  Table 1 follows beni's own js-framework-benchmark app (`bench/ui/apps/beni/Main.beni`): its three
  word lists, a recursive `buildFrom` pushing at the end, `List.indexedMap` for every 10th row,
  `List.swap`, a keyed `For` with the row's markup inline, `class` read from `model.selected` in the
  row. Other tables write the same shapes for their own columns: `Fmt` calls for formats, computed
  cells as expressions in the markup, `List.sortWith` with `Sort.tie` for sorts, one `serverUpdate`
  arm per data column. Generic helpers (`Rng`, `Fmt`, `Change`, `Sort`) hold no table's behaviour.
- A column named like a beni keyword (`alias`) is a field `aliasCol`; its table declares
  `schema RowJson` (`aliasCol : String as "alias"`) and reads rows through it, because the derived
  codec uses the field's name as the key.
- Generated source matches `beni fmt` except a few over-long lines (three or four per size).
- `runs.json`: beni-tea at 1..256, beni-direct at 1, 2, 4, 8.

## Checks

`./rr check big-table <fw>` (quick-check rows 40), seeds 1-3:

- Every run reports **0 mismatches with the reference render, 0 focus losses, nothing left after
  dispose**. N=1 passes on both platforms and all seeds.
- From N=4 up every run **fails only on keyed replacements, all in tables whose selection marker is
  `aria-selected`** (and none elsewhere: with that marker temporarily written as a class, 64 tables
  of seed 1 replace nothing).
- beni-tea builds and checks at 1, 4, 16, 64 for seeds 1-3, and at 256 for seed 1; beni-direct at 1,
  4, 8, 15 (see the limit below).
- Builds are byte-identical on rebuild (tea 16 and 64, direct 8).

## Limit 1: `aria-selected` cannot be absent

beni's Html vocabulary declares `aria-*` as a `String` attribute, written with `setAttribute` and
never removed; a `Maybe String` attribute is refused ("`aria-selected` is declared to take String"),
and declaring one in the project's platform layer is not picked up either. The contract wants the
attribute absent on an unselected row. A single `<tr>` hole cannot do that, so a table with this marker
(a third of the tables with select) writes the `<tr>` twice in an `if` on the selection, with the cells
shared as a fragment (`cells row`). The page is right at every step; selecting such a row replaces
its `<tr>` (and deselecting the old one replaces that), which is the check's failure, and costs the
work of a new row (`t4: select a row`: 6 132 calls on tea and 12 157 on direct, against 111 and 105 for a
class marker). Table 1 (class `danger`), and so the N=1 bench point, is not affected. Not written
around: nothing in beni's shipped markup can do it.

## Limit 2: browser-direct's ownership checker from 16 tables

`LIST MAY BE SHARED` at `Tea.element` (the width cap, `ownership-checker.md` §16.7: at most 64 paths
in `update`'s summary), every seed: N=1 to 15 build, N=16 and up do not (the message names a dozen
`model.tK.rows`; at N=15 all pass). `runs.json` measures beni-direct at 1, 2, 4, 8 only. The standard
sizes 16 to 256 are out, and 12 or 15 would be additional fit points if wanted.

Learned on the way: the checker also refused `{ new | rows = List.copy new.rows }` in `replace` (a
record update of the decoded host record); building the record field by field passes.

## Measured (`./rr measure big-table <fw> --out /tmp/rr-btb-measure-*`, not committed)

Medians over seeds 1-3, brotli bytes (runtime / app split from the release source map):

| N | beni-tea total | runtime | app | beni-direct total | runtime | app |
|---|---|---|---|---|---|---|
| 1 | 12 412 | 9 240 | 3 036 | 13 904 | 10 245 | 3 524 |
| 4 | 17 398 | 10 278 | 6 956 | 19 745 | 11 615 | 7 979 |
| 8 | 21 179 | 10 365 | 10 649 | 23 969 | 11 703 | 12 130 |
| 16 | 28 366 | 10 605 | 17 621 | | | |
| 64 | 60 830 | 11 392 | 49 298 | | | |
| 256 | 173 905 | 13 553 | 160 216 | | | |

Fits: beni-tea 16 453 B + 628.8 B/table (all sizes), 18 303 + 618.2 (N >= 4); beni-direct 13 418 +
1 364.9 (all, 4 sizes), 15 538 + 1 046.4 (N >= 4, 3 sizes). One more table costs about 620 B on tea
(12.8 kB of minified JavaScript each: its row builder, operations, view, a derived codec for its rows
and one `serverUpdate` arm per column) and about 1 kB on direct, whose per-message functions are
written per table. The runtime is flat (9.2 to 13.6 kB tea).

## Work (`./rr work`, calls per action, rows 1 000)

- beni-tea, N=16 -> 256: median 1.08x, max 3.16x (select, clear: 111 -> 351 calls, a few
  calls more per added table); nothing grows with the rows of other tables.
- beni-direct, N=4 -> 15: median 1.00x, max 1.07x (the `dispatch` events, which route by table).
- Rows axis (N=16 tea; 1 000 against 10 000 rows): select and clear flat (111, 113), update every 10th
  10x (2 617 -> 25 117), swap 9x (1 211 -> 10 775: `List.swap` copies), remove 9x, toggle 9x, create and
  append 10x, sort 12.5x, `serverUpdate` 9.5x, `serverDelete` 9.6x.
- Rows axis, beni-direct (N=4; 1 000 against 3 000 rows, because `--rows 10000` on direct did not
  finish in 30 minutes of the no-JIT counting run): select and clear flat (105, 83), update every
  10th 2.9x (3 699 -> 10 899), swap 2.8x, remove 2.8x, toggle 2.7x, create and append 3.0x, sort
  3.0x to 3.4x, `serverUpdate` 2.9x. Linear in the rows, like tea.
