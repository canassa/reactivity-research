# 2026-10-16: making tea-dirtybits smaller, fourth pass

Goal: fewer brotli bytes for the tea-dirtybits prototype on both scenarios, without raising any
`./rr work` count and without leaving its strategy (real messages and reducers, arms marking
compile-time dirty bits, a static patch per component, DOM built once).

## Result

Total brotli, medians of seeds 1 to 3, before → after:

| | N=1 | N=16 | N=64 | N=256 | fit, all N | fit, N >= 16 |
|---|---|---|---|---|---|---|
| shared-components | 1,199 → 1,177 | 3,592 → 3,566 | 5,222 → 5,184 | 9,760 → 9,697 | 2,346 + 31.2 → 2,324 + 31.1 | 3,428 + 25.1 → 3,400 + 25.0 |
| unique-components | 1,651 → 1,637 | 6,030 → 6,012 | 16,066 → 15,988 | 48,296 → 48,186 | 2,748 + 183.8 → 2,724 + 183.4 | 4,299 + 175.1 → 4,261 + 174.7 |

Lower at every one of the 9 measured sizes in both scenarios. `./rr work` (sizes 16 to 256,
seed 1): every record equal (calls 6,257 and 8,074; blocks 7,229 and 9,131). `./rr check`
passes at sizes 1, 4, 16 and 64 with seeds 1 to 3, locality included; builds are byte-identical.

## What worked

1. **Unique templates select `[b],[data-role],:empty`.** Every element with a `data-role` is
   bound, and so is every empty one (texts and lists the code fills). Only conditional blocks
   keep the `b` marker. Together about 40 B per build over 12 seeds; it removes round 3's
   marker cost at small sizes.
2. **Templates parsed in a detached div** and selected from it: the root comes first, so
   `html()` and `template()` return the node list as is.
3. **Regular dashboard kinds:** the three kinds that indexed their nodes now destructure them
   like the other ten (about 9 B per build), and the counter's tags follow its wiring order.
4. Small runtime cuts: a branch knows it is hidden when its anchor has a parent; no reset of the
   dirty table when a program starts; the list stores a row's item where it patches it.

## What did not help

Handing a unique view its elements from the app (+600 B at N=256), list rows built by the
list from markup, branch and list handles stored in the template array (+2 KB at N=256),
patch statements sorted by helper, `value += ""`, `"" + x` for `String(x)`, indexed dashboard
nodes (+15 B per build), swapped `Math.min` operands, `Array.from` for rating buttons,
`forEach` for options, `parent?.append`.

## Learned

- A one-byte change moves brotli by ±30 B per build, and the HTML's hashed script name by up
  to ±10 B. Three seeds cannot judge it: run 12 seeds (`--seeds 1,…,12`, a few seconds) and
  compare the JavaScript sums, then check the official medians.
- Regularity across components keeps paying: the same destructuring in every kind, tags in
  wiring order. And the cheapest marker is no marker: attributes the page needs anyway
  (`data-role`) and emptiness say which elements are bound.
- Close to the rules, not done: event delegation by `data-role` (handlers would become
  attributes read by a generic routine).
