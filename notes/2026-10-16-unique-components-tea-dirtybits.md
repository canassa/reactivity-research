# 2026-10-16: tea-dirtybits for unique-components

Wrote `scenarios/unique-components/tea-dirtybits.js`: one module per widget (bits, reducer,
init, DOM factory, static patch), emitted from the widget description as code; an app module
with the reducer router, the cross-read edges and the tick routing.

- The first version failed locality only on `tick`: looping over every time-driven widget calls
  its reducer N/30 times. Checking each gate inline in the app reducer made it flat (1.1x to 1.2x).
- `branch` (conditional content with its own nested patch, kept in place by a comment) was added
  to the shared runtime; the dashboard output is unchanged.
- Slope is about 282 B/widget (N >= 16: 271), runtime 1340 B brotli at every size; the
  dashboard's 28 to 37 B/widget is what sharing per kind buys.
