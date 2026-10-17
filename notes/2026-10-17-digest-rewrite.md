# 2026-10-17: digest passes the same-task "rewrite" step

- Cause: digest's `bind` wrote only when the computed value differed from the cached `last`, so a
  snapshot of the same state left typed invalid text in an input.
- Fix (all six `frameworks/digest/runtime*.js`): `bind` also writes when the DOM property differs
  from the value (`(last !== (last = f()) || n[k] != last) && (n[k] = last)`). Loose `!=` so a number
  and its string form do not rewrite.
- `./rr check digest` passes at sizes 1, 4, 16, 64 x seeds 1-3 in all six scenarios (locality
  excluded for big-component and derived-graph, its known failure, unchanged: 8.6x and 13.8x).
- Size (brotli total, seed 1, N=16 / 64): shared-components +6 / +21 (3074/4276 -> 3080/4297),
  unique-components +9 / +3 (4814/12620 -> 4823/12623).
