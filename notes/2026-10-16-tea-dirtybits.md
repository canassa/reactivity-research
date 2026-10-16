# 2026-10-16: tea-dirtybits prototype (dashboard)

## Done

- `frameworks/tea-dirtybits/`: a prototype strategy from beni PR #180 (strategy B): compiled TEA
  that keeps messages and reducers, marks compile-time dirty bits per reducer arm, and patches
  only the bindings behind them in one microtask. Plain Vite 8.3.4 (rolldown 1.2.14, as Solid's
  setup), hidden source maps; the runtime and Solid 2's `reconcileArrays` ship as template files
  and count as runtime.
- `scenarios/dashboard/tea-dirtybits.js`: one module per widget kind (reducer + DOM factory),
  configured per widget, unlike the PR's prototypes, which repeat the code per instance.
- `./rr check` passes at sizes 1–256, seeds 1–3. Builds are byte-identical.

## Measured (not committed; the owner runs one consolidated report)

Brotli total, median of 3 seeds: 1.35 KB at N=1, 4.9 KB at N=16, 11.7 KB at N=256 (Solid: 6.6,
9.9, 16.7 KB). Fits: 3147 B + 36.6 B/widget over all sizes, 4681 B + 27.9 B/widget from N=16
(Solid: 35.8 and 28.1 B/widget). Runtime 1.3 KB against Solid's 6.5 KB; app code with every kind
present (N=16) 3.4 KB against 3.2 KB.

## Learned

- **Per-instance scaffolding sets the slope.** A first version named every config
  (`const W1 = …`) and listed each widget twice (a routing table and a view line): 36 B/widget
  from N=16. One table in page order with inline configs brought it to 28, level with Solid.
  Only filters a summary reads keep a name, as in the Solid emitter.
- **With shared kinds, the strategy's slope matches Solid's.** The PR's static.js repeats each
  component's factory and reducer, and the PR names that as the cause of its gap to vanilla;
  here a widget adds only its config and initial state. No vanilla emitter exists yet to
  compare against.
