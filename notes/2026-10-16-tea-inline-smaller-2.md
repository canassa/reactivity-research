# 2026-10-16: making tea-inline smaller, round 2

Goal: fewer brotli bytes for the tea-inline prototype in both scenarios, strategy unchanged
(messages erased into actions, compile-time dependencies, DOM built once), no work action
making more calls than before, and no size growing for a gain elsewhere.

## Result

`./rr measure` (sizes 1–256, seeds 1–3), compressed total, median of seeds:

| scenario | N=1 | N=16 | N=64 | N=256 | fit, all sizes | fit, N ≥ 16 |
|---|---|---|---|---|---|---|
| shared-components before | 1100 | 3700 | 5378 | 10135 | 2367 + 32.6/w | 3529 + 26.1/w |
| shared-components after | 1096 | 3620 | 5139 | 9316 | 2329 + 29.7/w | 3456 + 23.3/w |
| unique-components before | 1546 | 6739 | 18324 | 56332 | 2893 + 214.6/w | 4663 + 204.6/w |
| unique-components after | 1517 | 6519 | 17640 | 54060 | 2839 + 206.0/w | 4556 + 196.3/w |

Every size of both scenarios is smaller (−8.1% and −4.0% at N=256). Work (`./rr work`, sizes
16–256, seed 1): no record went up; total calls 7869 → 7854 (shared) and 12893 → 12888 (unique),
one call less per item toggle, remove or dismiss.

## What helped

- **Widgets numbered by position.** Ids are `w1…wN` in page order, so the compiler numbers them:
  shared rows no longer spell an id (−6% at N=256); the unique initial model is an array by number
  (no `wN:` key per widget) and the app mounts widgets with one `map` over the widget functions
  (−1,052 B and −488 B at N=256). Done naively (a hole and `slice(1)` everywhere) it cost 10 B at
  N=1; each version kept had to be tuned until no size grew (handing shared factories their slice
  and counting rows in a `for…of`; building the unique dashboard div from markup, which drops `el`
  from small apps).
- **Readers in the field's group** (unique): `R[widget].f` listed once in `onF` instead of in every
  action and in `load`: −573 B.
- **Item arms inlined into row handlers** (both): one call and one name less per item control:
  −712 B (unique), −19…−42 B (shared).
- **Enum cycles as a comparison chain** (unique, tea-dirtybits' idea, checking the last option
  first): −106 B at N=64.
- **Tabs and options as pairs** (shared): −109 B at N=256.
- **Summaries inline their single-use terms** (shared): −56 B at N=256.

## What did not help

- Fields as local variables (digest's change): +1,150 B at N=256 in unique. The minifier gives
  each function its own letters, so alike widgets stop looking alike.
- One function per field group instead of an array of bindings: fewer calls, +110 B.
- Marking referenced elements with a `ref` attribute removed at mount (no comma holes): −443 B at
  N=256 but +18…+31 B up to N=4. Not kept.
- `when(node, cond)` returning the binding, `prop(node, value, key = "value")`, `loader(s, ...all)`,
  a simpler keyed loop, `let done;`, `return { receive() {}, stop() {} }`, inlining `init()`:
  each within ±0.2% noise with some size growing.
- A flush queued with `queueMicrotask` from the pending set's size (tea-local's idea): −79 B summed
  in shared but +1,100 B at N=256 in unique, only because dropping one top-level variable shifted
  every minified runtime name by one letter. Keeping the names fixed made it noise.
- Shared state passed positionally (no init object per row), filter items as pairs, `null` rows as
  holes: mixed or larger.

## Learned

- Brotli at quality 11 is chaotic at the 0.1–0.2% level: removing 5 bytes from the runtime moved
  N=256 by ±90 B. Only changes that win at every size are kept, so small ones mostly fail.
- Minified names matter: the letters the runtime's top-level functions get decide which letters
  every widget's locals use. One shifted declaration cost 2% in unique.
- The modulepreload polyfill is still about 260 B of every N=1 total (left alone, as in round 1:
  it is a build choice for every Vite framework at once).
