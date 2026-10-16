# 2026-10-16: unique-components in Solid 1

Emitter `scenarios/unique-components/solid.js`: one component per widget (`src/widgets/W<n>.jsx`),
written from the widget description; handlers, bindings and derived expressions are that
component's own code, nothing interpreted. Shared store (`createStore` + context, `reconcile`
keyed by id for serverSet/snapshot, `tick` written out per time-driven int), `<For>`/`<Show>`,
`produce` for click messages, `onInput`/`onChange` controlled inputs. Helper: `nextId` only.

## Checks
- `./rr check unique-components solid` at sizes 1, 4, 16, 64 and seeds 1-3: 0 mismatches,
  0 focus losses, 0 keyed replacements, clean dispose. shared-components still passes.
- Two builds of n16-s2 are byte-identical.

## Numbers (brotli total, median of 3 seeds; not committed, `--out /tmp/uc-solid`)
N=1 7174, 16 12886, 64 24931, 256 65600. Fit over all sizes: 8728 + 228.3 B/widget;
N >= 16: 10561 + 217.8. Runtime stays about 6.6 kB; the rest is app code (~230 B per widget).
shared-components Solid for comparison: 8292 + 35.8 (steady: 9652 + 28.1).
