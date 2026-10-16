# 2026-10-16: tea-local on unique-components

Wrote `scenarios/unique-components/tea-local.js` (reusing `frameworks/tea-local/` unchanged).

## Design

- One module per widget: initial model, own reducer (a `case` per message from its kind and
  ops, merged into one object literal when the ops touch different fields), own factory with
  createElement calls and a `patch` binding list. Derived texts compile to template literals.
- Only generic helpers are shared: the runtime and `widgets/frame.js` (frame, `place` for
  conditional content in the right sibling position, `nextId`, `byId`, `running`).
- Readers take the earlier widgets as factory parameters and watch them.
- `tick` first looped over every time-driven widget, which made calls per action grow with N
  (the clocks no longer saturate). Fix: a time-driven widget is a subscription, adding its
  `tick` to a shared `running` set while its gate is on, so `tick` costs the running ones.
- Number inputs are written through `valueAsNumber` (a typed "007" is left alone).

## Results

- `./rr check unique-components tea-local`: ok at sizes 1, 4, 16, 64 x seeds 1-3; locality at
  most 2.1x (16 to 256), at most 1.9x (64 to 1024). shared-components still ok.
- Build twice: byte-identical.
- Brotli total, median of 3 seeds: N=1 1633, 16 7275, 64 19127, 256 59355 B. Fit over all
  sizes 3183 + 225 B/widget; over N >= 16 about 4900 + 215 B/widget. Runtime is 1245 B flat
  once a few features are used (594 B at N=1 seed 2); the slope is all app code.
- shared-components tea-local (results/2026-10-16-shared-components-6): 2764 + 37.0 B/widget
  over all sizes, 4157 + 29.1 over the steady range.
