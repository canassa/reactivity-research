# 2026-10-16: the big-table contract

Wrote `scenarios/big-table/README.md`, the contract only (no spec, no emitters), for the owner to
review before anything is generated.

## What was decided

- **N = tables, rows = data.** N different tables, each its own component (unique-components'
  no-interpreter rule, a 4-character token per table); `--rows` (default 1,000) changes no code.
- **N = 1 is js-framework-benchmark's app** (their word lists, six buttons, select and remove,
  row structure), so `./rr bench` at N = 1 can be calibrated against the official standing. The
  differences come from the contract (`data-key`/`data-role`, `dispatch` events, no CSS, a seeded
  PRNG) and are listed in the README.
- **Labels from a Park–Miller PRNG held in each table's state**, so a click stays pure intent and
  every implementation reproduces the rows without the reference; server rows come in messages.
- **No `--tables shared` parameter** recommended: the shared axis is covered by shared-components,
  and a column-config grid would turn the slope into data.
- **Locality:** every table-scoped action is local as N grows (rows fixed); the rows axis
  (1k against 10k) is reported, not enforced. Bench: the nine js-framework-benchmark operations
  as do/undo pairs, at N = 1.

## What was learned

- js-framework-benchmark's vanillajs nulls `selected` in its store on append and update but keeps
  the highlight in the DOM; the contract follows the DOM (every entry keeps the selection).
- Its remove link is an empty glyphicon span sized by CSS; without CSS it has no box and cannot be
  clicked by the bench, so ours carries a `×`.
- beni research 83 §7 reproduced the published Solid 1.9 ≈ 1.08× vanillajs on a quiet machine with
  the official runner: the reference point for our calibration.
