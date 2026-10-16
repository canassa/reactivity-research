# 2026-10-16: tea-local on big-component

Wrote `scenarios/big-component/tea-local.js`. The form is split into one instance per fieldset,
each owning a slice of the one model; cross-fieldset readers watch their sources; a combined
button that writes a field of another fieldset forwards a message to that fieldset.

- `./rr check big-component tea-local` passes at sizes 1, 4, 16, 64 and seeds 1-3, locality
  included: calls per local action flat (ratio 1.00) from N=16 to 256 (51 calls for the add
  button at every size). unique/shared-components tea-local checks still pass; builds are
  byte-identical on rebuild; `runtime.js` untouched.
- Whole-state events (`serverSet` of the form, `snapshot`) cost O(N) (about 106 → 1315 calls),
  as the work table marks them global.
- Sizes (brotli total, mean of seeds): N=1 1392 B, 16 3393, 64 7337, 256 20373; fit 1943 B +
  73.8 B per unit (R² 0.992). Runtime 614-782 B, the rest app code.
- Learned: a pitfall was to give every fieldset the whole state on `Load` and spread it in its
  reducers: that copies O(N) fields per message, work the call counter cannot see. So each
  fieldset picks its own fields on `Load`.
