# 2026-10-16: digest on the flat big-component form

## Decision

digest fails big-component's locality, and that is the result. The emitter now makes the whole
form one binding list (before, it still made a list per unit wrapper, a boundary that is not
precision either). A list per field unit with handlers digesting the units they feed is
tea-inline's compile-time per-action binding sets under another name, so it was not built.

## Numbers

- `./rr check big-component digest`, sizes 1, 4, 16, 64, seeds 1-3: page correct everywhere
  (0 mismatches, focus losses, keyed replacements, nothing left after dispose); locality fails:
  8.6-10.5x from 16 to 256, 13.8-14.5x from 64 to 1024.
- `./rr work` seed 1: 181 / 261 / 425 / 791 / 1,556 calls at N = 16..256 (8.6x). Before (wrapper
  lists): 141 -> 1,415.
- `./rr measure` (not committed): 1,383 B at N=1, 3,003 at 16, 5,929 at 64, 16,199 at 256; fit
  1,837 B + 57.7 B/unit.

## Where it is written

`frameworks/digest/README.md`, "big-component". `runtime-big.js` unchanged.
