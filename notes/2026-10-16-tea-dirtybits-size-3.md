# 2026-10-16: making tea-dirtybits smaller, third pass

Goal: fewer brotli bytes for the tea-dirtybits prototype on both scenarios, without raising any
`./rr work` count and without leaving its strategy (real messages and reducers, arms marking
compile-time dirty bits, a static patch per component, DOM built once).

## Result

Total brotli, medians of seeds 1 to 3, before → after:

| | N=1 | N=16 | N=64 | N=256 | fit, all N | fit, N >= 16 |
|---|---|---|---|---|---|---|
| shared-components | 1,255 → 1,199 | 3,669 → 3,592 | 5,302 → 5,222 | 9,793 → 9,760 | 2,419 + 31.1 → 2,346 + 31.2 | 3,499 + 25.0 → 3,428 + 25.1 |
| unique-components | 1,674 → 1,651 | 6,114 → 6,030 | 16,473 → 16,066 | 50,098 → 48,296 | 2,758 + 190.3 → 2,748 + 183.8 | 4,299 + 181.6 → 4,299 + 175.1 |

Lower at every measured size in both. The dashboard's slope is flat (its rows are data); its
gain is baseline. `./rr work` (sizes 16 to 256, seed 1): no record rose; summed calls
6,921 → 6,257 and 8,740 → 8,074.

## What worked, roughly by size of the gain

1. **Reducers as tables of arms by tag** (an array, an object when external events are tags),
   each arm returning `[bits, slice]`: no `mark`/`take`, no switch. Unique N=256 about −900 B.
2. **Marked templates in unique:** only bound elements carry a `b` attribute; `template()`
   returns them in order and removes the marker (Lit-style). Dense references `t[1]`, `t[2]`…:
   N=256 −470 B, about +20 B at N <= 16.
3. **The dashboard's sections keyed and labelled by the app loop** (no section helper, no label
   parameter in every kind): about −50 B at every size.
4. **Bits first in an arm's result** (`[1, {…}]`): every arm starts alike. Unique N=256 −170 B;
   the dashboard went below the round's start at every size with it.
5. Small: the app writes `dirty[id]` itself (no `touch` call), unique arms return only the
   written fields, unique handlers numbered before list rows' (tags then count up in wiring
   order), list rows keyed by the list, tests covering every possible bit dropped, the todo add
   arm as one guarded expression, a few runtime bytes.

## What did not help

Unused parameters dropped (`e=>` for `(e,t)=>`), expression patch bodies, always `(s, d, w)`,
other triple orders, wiring first, markers after the tag name, init in bit order, a
"widget being built" global instead of the id argument (unique +450 B at N=256), `set` merged
into `route`, uniform `(c, s, msg)` on dashboard arms, field-only dashboard arms, rewritten
summary triggers, `parent?.append`.

## Learned

- Regular code beats short code under brotli, again: the same arm head everywhere, the same
  parameter list, numbers that count up in the same order.
- At the dashboard's large sizes a few-byte change in the kinds moves the rows' compression by
  ±10 to 40 B, and the HTML's hashed script name moves it by up to ±10 B: judge by the sum over
  all records and keep every size under the starting point, not by one size.
- Close to the rules, not done: a missing reducer arm now throws instead of returning the slice
  (messages are typed, as in Elm, so none reaches a widget without its arm); deriving ids from
  row order; dropping the modulepreload polyfill.
