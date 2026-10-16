# 2026-10-16: tea-inline, a compiled-TEA prototype

## Done

- `frameworks/tea-inline/`: the first prototype-track setup (`track = "prototype"`). It uses
  Vite 8.3.4 alone, with the same rolldown 1.2.14 as Solid. The runtime has DOM helpers,
  microtask batching, `when` and a keyed `list` with Solid 2's `reconcileArrays`, vendored from
  beni PR #180 with its MIT notice.
- `scenarios/dashboard/tea-inline.js`: one factory per widget kind. Each update arm becomes an
  action that writes model fields in place and schedules the bindings that read them. The app
  is a table of `[factory, config]` rows.
- `runs.json`: same sizes and seeds as Solid.
- `./rr check` passes at N = 1, 4, 16 and 64 with seeds 1–3, and with `--kinds` subsets. A
  second mount in the same page passes too. Builds are byte-identical.

## Measured (not committed; the owner runs one consolidated report)

`./rr measure dashboard tea-inline`, brotli total. Solid's numbers are from
`results/2026-10-16-dashboard`.

| | N=1 (median) | N=256 (median) | slope, all sizes | slope, N ≥ 16 | runtime |
|---|---|---|---|---|---|
| tea-inline | 1127 B | 11.3 kB | 36.0 B/widget | 28.3 B/widget | 1.29 kB |
| Solid 1 | 6583 B | 16.7 kB | 35.8 B/widget | 28.1 B/widget | 6.5 kB |

## Learned

- **The baseline gap is all runtime.** At N = 16, tea-inline's app code (2.9 kB) is already
  smaller than Solid's (3.2 kB), even though its factories spell out their DOM construction.
- **The slope is per-instance data, not strategy.** Both approaches pay the same ~28 B/widget for
  config and initial state. Erasing messages saves nothing per use once the factories are shared.
- **Dead end: one call per widget with an explicit slice.** The first emitter wrote
  `w1: counter(board, model.w1, { id: "w1", … })`, which repeats the id four times per widget.
  That cost 32.2 B/widget from N = 16. A table of `[factory, config]` rows, with each factory
  taking its slice by `c.id`, brought it down to 28.3.
