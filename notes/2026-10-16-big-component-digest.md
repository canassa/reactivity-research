# 2026-10-16: big-component in digest

## Done

- `scenarios/big-component/digest.js` and `frameworks/digest/runtime-big.js` (selected through
  `templateFiles`' existing `runtime` option; `runtime.js`, `runtime-unique.js` and
  `framework.js` untouched).
- Structure: one function for the form and one for the companion, like unique-components, but
  the bindings are split into lists per fieldset and per section. An event digests its
  control's list plus the lists reading what the control writes (`dep(source, ...readers)`,
  derived at build time from the handlers' assigned fields and the bindings' read fields).
- `./rr check big-component digest` passes at sizes 1, 4, 16, 64, seeds 1-3, locality included
  (worst 1.0-1.4x). unique-components and shared-components digest checks still pass; builds
  are byte-identical twice.
- `runs.json` has `big-component` / `digest` (9 sizes, seeds 1-3).

## Numbers (brotli, median of 3 seeds)

- Total: N=1 1,379 B; N=16 3,028; N=64 6,481; N=256 17,451. Fit over all sizes: 1,811 + 61.9 B per
  unit; N >= 16: 2,331 + 59.7.
- Runtime 864 B at N=1, about 1,120 B from N=8 (flat); the rest is app code (16,178 B at 256).
  HTML about 145 B.
- Calls per local action N=16 to 256: 104 for most (ratio 1.00), 96-118 across actions, tick
  97 to 99. Global: snapshot 168 to 1676, serverSet of the whole component 149 to 1699.

## Learned

- A list per fieldset passes locality with room to spare; the cost is the first units' group
  (the forced ones sit in one group read by several others), ~100 calls per action.
- The serverSet of the form must also digest the companion: the whole-state digest includes the
  readers of the widget's lists.
- Reader lists are digested but not their readers (no transitive closure): chains of
  adjacent groups would otherwise make the closure grow with N.
