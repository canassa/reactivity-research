# 2026-10-16: the CPU bench made fast, and its first runs on azathoth

## Done

- **Governor test.** The official runner (vanillajs, Solid; two passes per setting) shows spreads around
  2% and pass-to-pass agreement around 0.4% under `powersave`, `performance` and `performance` with turbo
  off, with identical ratios. On our tiny events, though, `powersave` measures about 3× slower: idle
  cores sit at 800 MHz between reps. Bench runs set `performance` and restore `powersave` afterwards.
- **Faster `./rr bench`.** The first full run would have taken about 4 h. It is now under 6 minutes:
  - each rep waits as long as its action's warm-up reps took to commit (at least 20 ms, not 40);
  - 10–20 reps at ±5%;
  - one session;
  - 2 parallel Chromes, each on its own two physical cores;
  - a load gate that allows for the bench's own load;
  - one app per framework: N=64, seed 1, the largest size every framework builds everywhere.
- **The CPU card** now shows absolute numbers per framework, with no N axis: script µs per event,
  startup ms and heap MB, each as bars with a table.

## Learned

- **A/A test,** 2 workers, every shared-components app benchmarked twice, in
  `results/cpu/2026-10-16-shared-components-azathoth`:
  - per framework, the two copies agree within 1–10%;
  - per event cell, the median difference is 4–6%.

  That separates tiers but not the four prototypes from each other.
- **Median script per local event at N=64 (µs):**
  - shared: tea-inline 73, tea-local 73, digest 75, tea-dirtybits 84, Solid 127, beni-tea 132,
    beni-direct 133, Elm 658;
  - unique: digest 80, tea-local 95, tea-dirtybits 98, tea-inline 99, Solid 133, beni-tea 149,
    beni-direct 152, Elm 1,059;
  - big: tea-inline 87, tea-local 93, tea-dirtybits 97, Solid 138, beni-tea 152, beni-direct 223,
    Elm 564.
