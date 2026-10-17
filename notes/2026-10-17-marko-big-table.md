# 2026-10-17: Marko 6 on big-table

## Done

- `scenarios/big-table/marko.js`: one tag per table (`src/tags/t<i>-table.marko`), each with its
  own `<let>` rows, selection, next id and PRNG state; `<for|row| of=rows by="id">`; the selection
  as `selected === row.id` in the row's marker; handlers in markup; each table `<return>`s its
  own external-event function (a tag variable), and `app.marko` routes to them. Table 1 follows
  js-framework-benchmark's Marko entry (`keyed/marko`: `<let/rows>`, `<let/selected>`, the same
  `<for by="id">` and `class=(selected === row.id && "danger")`), except that its remove finds the
  row by id (theirs `indexOf(row)`), and the buttons carry the contract's selectors.
- `runs.json`: `marko` under `big-table`, sizes 1 to 256, seeds 1 to 3.

## Checks

- `./rr check big-table marko` passes at sizes 1, 4, 16 and 64, seeds 1 to 3 (the same-task
  two-event step has not landed on main yet). Builds are byte-identical (dist hash twice at N=16).
- Work (`./rr work big-table marko`, N 16 to 256): every local action is flat, ratio 1.00 (the
  median is 10.7k calls). The snapshot grows 1.86x (global by nature).
- Rows axis (N=16, `--rows 1000` against `10000`): everything is proportional to the rows,
  select included: 3,039 calls at 1,000 rows, 30,046 at 10,000, for the first select from no
  selection. A second select costs 43 / 50 calls, flat. Row handlers read `rows` (and the
  remove handler `selected`), so Marko registers each row as a reader of the list signal, and
  immutable state means an edit to one item visits every row (the marko-rendering note). Swap,
  remove, toggle and bump cost 7 to 21 calls per row of the table.

## Sizes (brotli, 3 seeds, 27 builds)

N=1 4.69 KB, N=4 7.0-7.3, N=16 12.7-13.0, N=64 31.0-32.2, N=256 100.6-101.9 KB. Fit over all sizes:
baseline 6.1 KB + 376 B per table (runtime 3.5 KB, flat; app code 375 B per table). N>=4:
6.85 KB + 372 B.

## Learned

- **Marko 6.4.6 bug, again.** A `<return>` function reading tag variables (`<t1-table/t1/>`)
  compiles with a free `$scope` (`ReferenceError` at the first dispatch). The workaround in
  `frameworks/marko/README.md` is to declare what reads tag variables in the same body, after the
  tags, and `<return=receive>`.
- **A `<const>` function that assigns `<let>`s** (`<const/draw=(count) => { rng = …; return … }>`)
  compiled to a signal that failed at run time in my first draft, so row drawing is three lines
  in each handler (`build` returns the rows with the advanced `rng` and `nextId`).
- The disk of `/tmp` filled (tmpfs, 8 GB, other sessions' leftovers) during the last runs, so
  `./rr measure`'s output stays in `results/2026-10-17-big-table/`, uncommitted, rather than
  `/tmp/rr-mk3-measure`.
