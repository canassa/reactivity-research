# 2026-10-17: the derived-graph scenario (contract, generator, work and bench actions)

**Done.** A new scenario, `derived-graph`, built from the tea-inline critique's proposed scenario 2
(`notes/2026-10-16-tea-inline-critique.md`): a planning sheet of N formulas over inputs and a table
of line items. Files: `scenarios/derived-graph/README.md` (the contract), `spec.js` (generator and
reference), `harness/work/derived-graph.js`, `harness/bench/derived-graph.js`, and a
`derived-graph` block in `runs.json` (`$bench` at N = 64, no frameworks yet). No emitters.

**Design, in short.**
- N counts formulas; about half the units bring an input, so readers per value stay bounded.
- Formulas read any earlier value (no window) with caps: 5 formula readers per value (24 for a hub),
  fan-in up to 12, depth up to 6. Displays only read and format; all computation is in formulas.
- `--fanout low|mid|high` changes only the displays (1, 4 or 10 extra reads per unit); formulas are
  byte-identical across levels, so a variant isolates the cost of read edges. Readers per value at
  N = 256: mean 3.2 / 5.2 / 9.2, max 32 / 48 / 88.
- The first 11 units are forced. The local work targets (a 3-formula chain, a cut-off bool, a
  category filter, a toggle, a top-5 threshold) are **closed**: nothing outside the forced units
  reads them, so their closures are identical at every N and locality is meaningful. The hub input
  and every item edit are global by nature (the formulas over the items are part of N) and reported.
- Items come from the app's own PRNG (Load, Add item), so `--rows` (default 2,000) never reaches the
  bundle. The markup input is read by every row and nothing else; a note by nothing.
- Integers only, kept below 2^50 by a static bound per expression; values above 2^31 are common, so
  integer division is a floor on doubles (Elm's `//` would be wrong).

**Harness.** `harness/report.js` and `harness/measure.js` accept a scenario parameter in a runs.json
entry's `options` (a list measures each value as a variant named `solid-fanout=high`). `measure.js`
is in the measurement hash, so the next `./rr report` rebuilds every cached measurement once (the
numbers should come out the same).

**Checked** (scratch scripts, not committed):
- deterministic and prefix-stable for seeds 1-5, sizes 1-512, every fanout; formulas identical across
  fanout;
- the reference replays the script at sizes 1-512, rows 30, 2,000 and 10,000; every value stays a
  safe integer within its static bound;
- in headless Chrome, all 3,759 script targets (3 fanouts × 7 sizes × 3 seeds) resolve to exactly
  one element of the right kind in the reference HTML; keyed elements and sheet roles are unique;
- all work and bench targets resolve at sizes 11-256; every work action changes the page; every
  bench rep returns to its start state;
- formulas each work action changes (seed 1, N = 16/64/256): chain 3/3/3, cut-off unchanged 0/0/0,
  hub 5/25/55, a quantity 9/30/84.

**Learned.** A random DAG with "read any earlier value" makes every early value's transitive
closure grow with N, so locality needs either closed targets or closure-normalised work counts.
Closed forced targets were the simplest honest answer; the item edits stay global.
