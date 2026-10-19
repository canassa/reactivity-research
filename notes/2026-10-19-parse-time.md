# 2026-10-19: how long Chrome takes to parse and compile JavaScript

## Done

- `harness/parse/generate.js`: a seeded generator of realistic JavaScript (a back-office program of
  distinct modules from 21 shapes, grown by adding modules, never by copying). Valid ES2020, top level
  only registers factories, so evaluating it is mostly parse. Each payload passes `node --check` and
  runs in node with every module required.
- Three forms per size (`harness/parse/payloads.js`): unminified, esbuild 0.28.2, esbuild + terser
  5.51.2 (pinned in `harness/parse/package.json` with a lockfile).
- `./rr parse` (`harness/parse.js`): 8 sizes from 25 kB to 3 MB, 3 forms, external and inline script,
  fresh page per load, traced; compile = `v8.compile` + `v8.parseOnBackground`, evaluate =
  `EvaluateScript`. Cache defeated and checked from the trace (see `harness/parse/README.md`),
  with a positive control that shows the detector sees a hit.
- A "Parse time" tab on the plots page. Method in `harness/parse/README.md`.
- Results: `results/parse/2026-10-19/` (run.json with versions, machine and governor; samples.json;
  summary.json with medians, intervals, fits).

## Headline (external script, compile = worker parse + main-thread finish)

| form | ms per 100 kB | fixed cost | R² |
|---|---|---|---|
| unminified | 1.39 | 0.9 ms | 0.9989 |
| esbuild | 2.23 | 0.7 ms | 0.9990 |
| esbuild + terser | 2.44 | 0.4 ms | 0.9997 |

- The relation is linear (straight-line R² >= 0.998 over 25 kB to 3 MB). The power-law exponent is
  0.80 to 0.83, below 1 only because of the fixed cost per load.
- Per byte, minified code costs about 1.6x as much as unminified (denser: more tokens per byte),
  but it is 2.1x smaller, so the same program takes about 77% of the time after minifying. esbuild
  and esbuild + terser are within 10% of each other.
- Concrete: 3 MB unminified takes about 42 ms; the same program minified (1.4 MB) about 32 ms.
- Inline script (all on the main thread) gives 1.29, 2.01 and 2.05 ms per 100 kB: a bit lower, as
  there is no thread hand-off. Evaluate in external mode is nearly flat (0.02 to 0.05 ms per 100
  kB, about 0.4 to 1 ms in all): the top level only registers modules.

## Caveats

- **Governor: `powersave`** (amd-pstate-epp with energy preference `performance`, CPU 0 at 3.9 GHz
  of 5.1 at the start). The project's benches need `performance`; not changed. Absolute numbers may
  be inflated.
- **Shared machine.** Other jobs pushed the 1-minute load to 50 to 130 on 32 threads. A first full run
  (not committed) was bimodal: the same 3 MB took 38 ms in quiet rounds and 120 to 270 ms in busy ones,
  precision about ±40%. `./rr parse` now only runs a round when the load is below 8 (own Chrome is
  about 5 of that) and skips it otherwise; 10 round starts were skipped in the committed run.
- **Precision target not met.** No point reached ±3% of the median in 40 loads: the 95% intervals are
  ±9% to ±18%. Samples drift over the run (later ones 20 to 40% faster than earlier ones at the same
  load average), likely other jobs on shared cores and frequency scaling. Rounds interleave all
  points, so the drift hits every point alike and the slopes agree (R² > 0.998); the absolute ms/100 kB
  carry about ±15%. A rerun on a quiet machine with the `performance` governor (`./rr parse`, ideally
  as `bench --remote` does on azathoth) is the way to tighten them.
- **Lazy parsing.** The modules do not run on load, so V8 only pre-parses their function bodies. A
  script whose functions all run at startup costs more per byte. Numbers are for code shaped like a
  bundle with unused modules.
- **Streaming.** External scripts are parsed on a worker thread, which `v8.compile` alone does not
  show (about 0.1 ms on the main thread), so compile adds `v8.parseOnBackground`. On loopback nothing
  overlaps with the download; on a real network part of the cost hides behind it.
- **Cache.** Unique URL per load, no-store, cache disabled, and every load checked for cache fields in
  `v8.compile` and `fromCache`; none tripped.
- **Generated code is repetitive** (brotli 4 to 1 at 25 kB, 19 to 1 at 3 MB). Parse time follows
  tokens, not entropy, so it should not matter, but real code is more varied.
- One seed (1) only; a different seed gives different modules.
