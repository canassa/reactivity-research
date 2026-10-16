# 2026-10-17: derived-graph in tea-dirtybits

Wrote `scenarios/derived-graph/tea-dirtybits.js` and `frameworks/tea-dirtybits/template/graph.js`
(new runtime, included only by this scenario and counted as runtime in `classify`). The strategy is
kept: real messages and reducer arms, compile-time dirty bits, a static patch per cell. The README
section in `frameworks/tea-dirtybits/README.md` describes the design.

## Design in short

- **A bit per cell.** Formulas, displays and input controls are cells, numbered so each comes after
  the cells it reads (a unit's controls, its formula, its displays). The dirty set is an array of
  31-bit words; the cells are one table of closures, so a cell's number is its position.
- **An arm marks the readers of the input it wrote** (`IN[name]`, written by the emitter). A flush
  sweeps the words in ascending order and runs each marked cell once.
- **A formula is recomputed once and stored** in a module-level `let`. It compares with its stored
  value and marks its readers only if it changed.
- **Unchanged values.** Numbers, booleans and words compare with `!==`, a filtered list by the
  identity of its items; a top-k list and a group sum count as changed every time they are
  recomputed. A formula that did not change does not run its readers (the cut-off input's bool
  that stays: 14 calls).
- **Items.** Item fields are bits too: the emitter knows which fields each formula reads, so a
  quantity edit marks the formulas reading quantities, active those reading it, a note none, and
  load/add/remove/`serverItems` mark every formula over the items. Lists are refreshed by the
  fields their readers read through them (found by an analysis over readers; without it they
  would serve stale items). Aggregates are recomputed in full.
- **The table** is big-table's keyed grid with column bits (quantity, active, note, markup).

## Results

- `./rr check derived-graph tea-dirtybits` passes at sizes 1, 4, 16, 64 (seeds 1 to 3), 32 (seeds
  1 to 5), 128 and 256, and with `--fanout low` and `high`; locality 1.00 from N=16 to 256 (the
  worst local action, the chain input: 53 calls at both sizes).
- The other scenarios' checks pass; their sources are unchanged (only `classify` in
  `framework.js` learned the new file). A build is byte-identical to the one before it.
- Sizes (brotli, medians of seeds 1 to 3, total, N=1 / 16 / 64 / 256): low 2,809 / 4,802 / 9,057 /
  24,255; mid 2,825 / 5,158 / 10,575 / 31,222; high 2,862 / 5,827 / 13,316 / 42,987. Fit for
  N >= 16: low 3,677 + 81.3, mid 3,529 + 108.9, high 3,361 + 154.6 B per formula. Each display
  read costs about 9 B at the margin.
- Work (`./rr work`, seed 1, rows 2,000, calls, N=16 to 256): every local action is flat (1.00): chain
  53, cut-off unchanged 14 / flips 31, toggle 21, note 22; the O(rows) local ones (filter select
  2,821, threshold 14,184, markup 8,013, serverInputs of the closed inputs 20,587) are flat in N too.
  Global by nature: hub input 2,165 to 65,466 (30x), quantity 35,185 to 316,378 (9x), toggle active
  4,050 to 264,737 (65x), add 37,208 to 401,468, remove 37,166 to 463,305, serverItems 43,160 to
  469,919, snapshot 69,443 to 432,983 (6x).
- Rows axis (N=64, rows 1,000 to 10,000): flat: chain 53, cut-off 14 and 31, toggle 21, note 22. About
  10x: filter select 1,429 to 14,083, threshold 6,492 to 83,404, markup 4,013 to 40,013, the
  bool flipping back 450 to 4,060, serverInputs of the closed inputs 9,623 to 121,572, hub input
  11,629 to 112,029 (formulas that read the hub and the items), quantity 38,246 to 411,395, toggle
  active 23,026 to 243,519, add 45,050 to 473,217, remove 44,986 to 484,958, serverItems 47,963 to
  514,932, snapshot 53,063 to 546,424. Nothing is incremental: an item edit costs O(rows) per
  aggregate that reads the field.

## Learned

- The slope depends on read edges more than on formulas: going from `low` to `high` adds 9 display
  reads per unit and 73 B, about 8 B per read (markup, a display function, and its bit in each
  source's reader list).
- Cell numbers as index lists (`touch([5, 6, 17])`) were chosen over `(word, mask)` pairs by
  estimate, not measured: readers of a hub are scattered over many words, so a pair per word
  should cost more than a number per reader.
- Not tried: incremental aggregates, a smaller table of reader lists (ranges), comparing top-k
  lists by item and key.
