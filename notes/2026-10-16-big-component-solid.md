# 2026-10-16: big-component in Solid 1

- Wrote `scenarios/big-component/solid.js`, adapted from the unique-components emitter: the form is
  one component (`W1`, one file, a handler per message, one JSX tree, no sub-components), the
  companion `W2`; one `createStore` with `widgets.w1`/`w2`; `<For>`, `<Show>`, `reconcile` by id.
- `./rr check` passes at N 1, 4, 16, 64 with seeds 1-3; builds are byte-identical.
- Size (median of 3 seeds, brotli total): N=1 6937 B, 16 9677, 64 14835, 256 31752. Fit over all
  sizes: 7729 B + 94.5 B/unit; N>=16: 8542 B + 89.9 B/unit. Runtime stays about 6.6 kB, so
  everything that grows is app code (about 93 B per unit).
- Work: local actions cost the same calls at N=16 and 256 (max ratio 1.31, the tick); whole-state
  replacements grow about 9x (global by nature). Fine-grained bindings keep Solid O(1) per event.
