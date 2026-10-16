# 2026-10-16: tea-inline on unique-components

Wrote `scenarios/unique-components/tea-inline.js`: one module per widget, emitted from its
description (expressions compiled to JavaScript, each message inlined into its control's action,
per-field binding groups, `R.<widget>.<field>` for cross-widget reads). Runtime unchanged.

- Checks pass at sizes 1, 4, 16, 64 and seeds 1-3, locality included (worst 6.6x, from the
  global `tick` event, which touches every ticking widget; local actions stay at 12-20 calls).
  `shared-components tea-inline` still passes. Builds are byte-identical.
- Size (brotli total, median of 3 seeds): N=1 1591 B, N=16 7478, N=64 19852, N=256 60706. Fit over
  all sizes: 3294 B + 230 B/widget; over N >= 16: 5129 + 220 B/widget. Shared-components was
  28 B/widget from N=16: each unique widget costs about 8x a reused one, and the runtime is the
  same 1.27 kB.
- Lesson: the per-widget cost is dominated by the DOM construction lines and one action per
  message, which brotli cannot share because every widget differs.
