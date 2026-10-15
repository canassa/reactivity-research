# 2026-10-16: first working slice (harness, dashboard, Solid 1)

## Done

- `./rr` with `generate`, `build`, `measure`, `serve`, `plots` and (on the owner's request) `report`,
  which reads `runs.json` and remeasures only what changed (inputs hash per record; `--force`).
- `scenarios/dashboard/spec.js`: seeded generator (full catalogue, per-instance variation,
  summaries reading 2–3 earlier widgets), reference `update`/`render`, external-event builders,
  interaction script. Deterministic; widgets are prefix-stable across sizes for a seed.
- `frameworks/solid/` (Solid 1.9.17, Vite 8.3.4, vite-plugin-solid 2.11.14, lockfile), adapter, and
  `scenarios/dashboard/solid.js`: one reusable component per widget kind.
- Serve page: panel outside the root drives the script and every external event, compares the page
  with the reference render after each step, and shows element churn, keyed-node identity,
  focus/caret, and listeners/timers left after dispose.
- Measured every size and seed in `runs.json` into `results/`.

## Learned

- **Solid's delegated listeners outlive `render`'s dispose.** They sit on `document`, and the
  compiled module adds them once, at load. The adapter calls `clearDelegatedEvents()` on dispose
  and registers Solid's delegated events again on the next mount.
- **`reconcile` adopts the objects it is given** as the store's backing data and mutates them later.
  The panel first shared message objects with its reference state, and the reference got corrupted.
  Dispatched messages are now `structuredClone`d, as data from a network would be.
- **A checkbox's `click()` fires trusted `input`/`change` events**, which made the panel think the
  owner had interacted, so it skipped comparisons. An early all-green sweep was invalid because of
  this. The panel now also counts how many steps it actually compared.
- **Babel's Solid output hoists `template()` declarations without source mappings.** Unmapped bytes
  are therefore attributed to the module that follows them. Bytes before the first or after the
  last mapping (Vite's modulepreload polyfill, 670 B raw) count as tooling.
- **Growth is not linear in N.** Up to N = 16 each new widget kind brings a component and sometimes
  runtime (For, Show, createMemo, reconcile). Past it, growth is per widget only. Fits are
  reported over all sizes and over N ≥ 16.

## Open

- No vanilla floor yet, so the ratio-to-vanilla chart is empty.
