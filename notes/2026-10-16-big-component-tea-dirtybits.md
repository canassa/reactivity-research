# 2026-10-16: big-component in tea-dirtybits

Wrote `scenarios/big-component/tea-dirtybits.js`: the unique-components emitter with the bit
layout changed, for one widget of about N fields.

- **Problem:** one integer holds 31 bits, the form has 1.06 N fields. A patch testing every
  group on every message would be O(N) and fail locality.
- **Design:** words of 31 bits in view-read order; the dirty set is a sparse array of words; arms
  mark `[word, bits…]`; the view returns one static patch per word and the app runs only the
  dirty words'. A binding group reading two words is a function called by both words' patches.
  Nested branch patches test the same words; they needed a `branch` that re-patches with a
  full array instead of -1, so `template/words.js` (runtime bucket in `classify`) was added
  rather than touching `runtime.js`.
- **Bug on the way:** the `drop w` pass replaced only the first occurrence in a multi-line
  string; `replaceAll` fixed N=16 mounting.
- **Results:** `./rr check` passes at sizes 1, 4, 16, 64 and seeds 1 to 3; locality 1.00 (16 to
  256 calls flat at 12 to 23 per action). Builds byte-identical. Shared and unique checks
  still pass. Totals (brotli, median of 3 seeds): N=1 1,488, N=16 3,673, N=64 8,444,
  N=256 24,136; fit 1,982 + 87.6 B per unit; runtime about 870 B at N>=16.
- **Not tried:** sections as their own templates (smaller indices than `t[1500]`), bits per
  group instead of per 31 fields, size tuning.
