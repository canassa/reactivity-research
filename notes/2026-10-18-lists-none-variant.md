# 2026-10-18: a `--lists none` variant of unique-components and big-component

**Why.** beni's direct platform is being rewritten slice by slice (beni `plans/direct-rewrite.md`,
#295), and its first slice with real apps (S1, holes and handlers) is measured on these two
scenarios. Under the owner's decision that keyed rows are a `Dict` and a `List` edited by id is a
build error, every list widget is refused until the keyed-rows slice (S2) and the `Dict`
generators land: 103 of the 256 widgets at N=256 have one. So S1 is judged on a variant of the
same apps with no keyed list anywhere, measured for tea-inline on the same variant so the
comparison is like with like; the unmodified scenarios are S2's bar.

**Done.**
- `--lists all|none` on both scenarios (`spec.js` `params`, README "Parameters"). With `none`
  the forced list widgets keep their other capability (unique-components: w3 a text input, w5 a
  bare enum control; big-component: unit 2 a text input, unit 5 an int) and the random draw
  skips lists. The draws themselves are unchanged, so a widget without a list is the same widget
  in both variants, and the default output is byte-identical (tea-inline N=16, seed 1, both
  scenarios: same `dist/` hashes before and after).
- The work actions and the bench leave out the three list actions and `notify` when the spec
  has no list (`harness/work/*.js`, `harness/bench/lib/fields.js`); the other nine (ten) actions
  are unchanged.
- `runs.json`: tea-inline measures both values in both scenarios (`tea-inline` and
  `tea-inline-lists=none`).

**Checked.** The variant is list-free at sizes 1–256, seeds 1–3, deterministic, prefix-stable,
and `lists=all` equals the default. `./rr check <scenario> tea-inline --lists none` passes
(script, same-task and locality: 2.8× and 1.2× worst growth), and so does Solid on both.

**Measured** (`./rr measure … --lists none`, scratch only; brotli total, median of seeds 1–3):

| | N=1 | N=16 | N=64 | N=256 | fit |
|---|---|---|---|---|---|
| unique-components, no lists | 1,337 | 4,707 | 12,876 | 39,123 | 2,072 + 148.5 B/widget |
| unique-components, as committed | 1,486 | 5,905 | 15,286 | 45,203 | 2,721 + 172 |
| big-component, no lists | 1,315 | 2,923 | 6,653 | 19,719 | 1,567 + 72.5 B/unit |
| big-component, as committed | 1,315 | 3,623 | 7,604 | 22,151 | 1,938 + 80.5 |

tea-inline's runtime drops from 498 to 467 B at unique-components N=1 without lists: `list`
is not reached and the bundler drops it.

**Open.** `spec.js` changed in both scenarios, so the next `./rr report` remeasures every
framework in them (the numbers should not move: the default output is byte-identical).
