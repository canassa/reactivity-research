# 2026-10-16: the big-table generator

Wrote `scenarios/big-table/spec.js` from the contract, the work and bench actions, and the harness
pieces the scenario needs. No emitter yet.

## What was done

- **The generator.** Table 1 is js-framework-benchmark's app (their lists verbatim); tables 2 to N
  draw 2-5 data columns, an id column (60%), 0-2 computed columns and their controls, with tables
  2-4 forced. Every table carries its Park–Miller `rng` and `nextId` in the state; the reference
  update builds rows with it. A structural signature keeps every table different (256 of 256 at
  N = 256). The script exercises every table up to N = 16, else t1-t4 and 12 sampled, which also
  caps the spec at about 2 MB at the default 1,000 rows (the snapshot carries every row).
- **Harness:** `quickCheckOptions` (`./rr check` and its locality build use it; big-table checks at
  40 rows); the panel's comparison now ignores an empty `class` (it did not before: `class=""`
  was a mismatch); the panel stylesheet highlights the selected row; `./rr report` and
  `./rr bench all` pass over a scenario with no frameworks in `runs.json`.
- **Work** (`harness/work/big-table.js`): 24 local actions on t1-t4 (after 4 untimed setup creates) plus the snapshot; `--rows`
  already passed through as a scenario option. **Bench** (`harness/bench/big-table.js`): the nine
  js-framework-benchmark operations as do/undo pairs with untimed `serverRows` resets.
- **README:** decisions recorded, the description format documented, the worked example
  regenerated and checked against the generator.

## Checks

- Deterministic and prefix-stable for N = 1 … 256, seeds 1-3, at 40 and 1,000 rows; the reference
  replays every script; every operation, row control and external event is exercised from N = 4
  (N < 4: what exists). Script length at N = 16: 149, 154, 140 steps for seeds 1-3.
- Every click target resolves to exactly one element, in the right table and row, in headless
  Chrome against the reference HTML.
- The whole script through the real panel on a throwaway app that re-renders the reference and
  leaves `class=""` on every row: 0 mismatches (its keyed replacements are expected).
- Work and bench actions resolve and change the state at N = 4, 16, 256; bench pairs return to
  their start where they should.
- `./rr check` still passes on shared-components/tea-inline, unique-components/solid and
  big-component/tea-local.

## What was learned

- A whole-state snapshot of a table app is as big as its data: the script has to bound the tables
  it fills, or the spec (served to the panel, written per build) grows with N × rows.
