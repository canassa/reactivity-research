# 2026-10-16: vanilla, and big-table in vanilla

The project's first vanilla framework (`frameworks/vanilla/`, track real, no library) and its
first emitter, `scenarios/big-table/vanilla.js`, modelled on js-framework-benchmark's
`frameworks/keyed/vanillajs` (`src/Main.js`, read from a sparse clone).

## What was done

- **The framework:** Vite 8.3.4 alone, the same config as the other Vite setups. The adapter maps
  the contract onto `start(root)` → `{ receive, stop }`, and `settled()` resolves at once because
  every handler writes the DOM synchronously. `classify` counts everything as app code except
  `src/lib.js` (the keyed reconciler) and Vite's preload polyfill.
- **The emitter:** one module per table, each with its own `<tr>` template (static cells in its
  innerHTML, cloned), row builder (one Park–Miller draw per generated cell, in column order),
  one setter per data column (its cell plus the computed cells reading it), a `case` per
  operation and row control in one delegated click listener on the section, and sort
  comparators and computed expressions compiled to code. State is plain and mutable in the
  table's closure. Records carry their `<tr>`. The selection is the selected `<tr>`.
  vanillajs's fast paths are kept: `textContent = ""`, a detached `<tbody>` while an empty table
  fills, two `insertBefore` for a swap. Initial rows are built at mount by the table's own
  builder, not embedded.
- `serverRows`, `serverDelete` and the snapshot go through `reconcile` (a map by id, `patch`
  for changed cells, and one forward placement pass). `serverUpdate` uses the column setters.

## Results

- `./rr check`: 0 mismatches, 0 focus losses, 0 keyed replacements, nothing left after dispose,
  at N = 1, 4, 16 and 64 for seeds 1 to 3, at N = 256 for seed 1, and at N = 16 with
  `--rows 1000`. It passed on the first build.
- Builds are byte-identical twice (N=64, seed 2: 72 files hashed).
- Sizes (brotli total, seed 1): N=1 1,914 B, N=16 8,625 B, N=64 22,082 B, N=256 68,388 B. Fit
  over N ≥ 4: 4,504 B + 254.8 B per table (R² 0.998). Runtime is flat at about 460 B (the
  reconciler, 301 B raw, plus the preload polyfill, 670 B raw). HTML is about 145 B.
- `./rr work`: every local action is flat from N=16 to 256 (×1.00). The snapshot grows ×1.57
  (global). Along the rows axis (1,000 → 10,000 rows at N=16), select, swap, remove, toggle,
  bump and serverUpdate stay at 2 to 23 calls. Create, append, sort, removeChecked, serverRows
  and serverDelete grow with rows, as the README expects.

## Learned

- Even the floor pays about 255 B per table after brotli. Each table's row template, builder,
  setters and listener are distinct code, so they don't compress away, which is the scenario's
  point.
- The panel structured-clones external events, so the app can keep the server's row objects as
  its own records with no copy.
