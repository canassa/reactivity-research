# `./rr parse`: how long does Chrome take to parse and compile JavaScript?

The rest of the project measures size. `./rr parse` measures what size costs the browser: the time
Chrome spends parsing and compiling a script, as a function of its bytes, so that a byte saved can
be priced in milliseconds. Results go to `results/parse/<date>[-n]/`; the plots page has a
"Parse time" tab.

```sh
./rr parse --quick                         # development: 3 sizes, 4 loads per point
./rr parse                                 # 8 sizes from 25 kB to 3 MB, 3 forms, 2 modes, 10-40 loads each
./rr parse --points 10 --to-kb 6000 --seed 2 --modes external
./rr plots --local --out /tmp/plots.html   # the "Parse time" tab reads the latest run
```

## The payloads

`generate.js` writes one seeded, deterministic "back office" program (warehouse, orders, billing,
scheduling): a module registry, then `def("name", factory)` calls, then a `boot()`. Each module is
drawn from 21 shapes (entity classes, config tables, state machines, regex parsers, async clients
with retries, calculators, priority queues, stores with closures, report formatters, repositories,
validators, error hierarchies, allocators, pipelines, caches, CSV readers, generators, ...), and each
instance draws its own words, fields, constants, branch counts and optional members. A larger
payload is the same program with more modules, never a copy of one: names are unique over the whole
program. The code has JSDoc and line comments, switch statements, regexes, template strings, array
methods, classes, closures, async functions, optional chaining and small JSON-like tables (ES2020).

Its top level only registers factories and runs `boot()`, which requires two modules; a factory
runs when its module is first required. So `EvaluateScript` is mostly parsing and compiling, not
running. That also means the functions inside the modules are only pre-parsed by V8 (see
"What is included"), like the code of a real bundle whose modules are not all used on load.

Sizes are a geometric series of target unminified bytes (default 8 points, 25 kB to 3 MB). Each
size is built in three forms and written to `results/tmp/parse/` (gitignored):

| form | how |
|---|---|
| `unminified` | as generated |
| `esbuild` | `esbuild.transformSync(code, { minify: true, target: "es2020" })`, what Vite's production build uses here |
| `terser` | the esbuild output through terser (`compress`, `mangle`) |

Every file is checked with `node --check` and run once in node with all of its modules required, and
every load in Chrome checks that the page booted the right number of modules, so a minifier cannot
have broken or emptied a payload. The raw size of each form is the x axis; the brotli size and the
SHA-256 of every payload are in `run.json`. (The generated code compresses well, about 17 to 1 with
brotli, because it is made from templates; parse time depends on the tokens, not on how well they
compress, so this does not matter here. Compressed size is reported only for context.)

## One load

A local HTTP server serves the page and the script, always with `Cache-Control: no-store`. Each
load is a fresh page (a new tab) in one headless Chrome, `Network.setCacheDisabled`, and a URL of
its own (`?r=<n>`), traced from before the navigation (categories `devtools.timeline`,
`disabled-by-default-devtools.timeline`, `blink.user_timing` and `v8`). A tiny script after the
payload calls a DevTools binding when the payload has run, and only then is the trace ended, so
nothing of the harness is in the timed window. Two modes:

- **external** (the one the question asks for): `<script src=payload.js>`, fetched from the server.
  Chrome streams it: a worker thread parses it while it arrives.
- **inline**: the payload inside a `<script>` in the page itself. It is never streamed, so all of
  the work is on the main thread. It is a cross-check of the worker thread's numbers.

What is read from the trace, per load (`analyse.js`):

| metric | events |
|---|---|
| `compile` | `v8.compile` (main thread) plus `v8.parseOnBackground` (worker thread) for the script's URL |
| `compileMain` / `compileBackground` | the two halves of it |
| `evaluate` | `EvaluateScript` for the script's URL (main thread); it contains `v8.compile` when the script is not streamed |
| `requestToEvaluated` | the script's `ResourceSendRequest` to the end of its `EvaluateScript`, external only |

`V8.CompileCode` (which `COMPILE_NAMES` in `bench/lib/trace.js` also lists) did not appear in these
traces; `v8.compile` is the event Chrome emits for a compiled script.

## What is included, and how it was checked

- **Streaming.** For an external script Chrome starts parsing on a worker thread before the
  download ends, and the main-thread `v8.compile` is only the short finishing step (about 0.1 ms).
  Counting only `v8.compile` would therefore report nothing for the parse; `compile` here adds the
  worker thread's `v8.parseOnBackground`. The trace shows which happened: the `v8.compile` event's
  `streamed` field (and `notStreamedReason` when false) is recorded per load, and `summary.json`
  counts the streamed loads per point. On a loopback server the data is there at once, so the
  worker parse is not hidden behind a slow download: the time until the script is ready is the
  worker's parse plus the finishing step. On a real network part of the worker's time overlaps the
  download, so the user-visible cost of an external script can be less than `compile`. Inline mode
  has no such overlap.
- **Lazy parsing.** V8 pre-parses (scans, without building bytecode) the body of every function that
  is not called during the top-level run, and compiles it fully only when it is first called. All
  the bytes are scanned; only the functions that run are compiled. The payload's modules do not
  run on load, so the numbers are mostly the cost of pre-parsing plus fully parsing the top level.
  This is what a real bundle pays for the code it ships but does not use at startup; a script
  whose functions all run immediately would cost more per byte. `evaluate` includes the lazy
  compilation of the functions that did run (the registry, and two modules).
- **Code cache.** Chrome stores compiled bytecode after a script has been loaded a few times, which
  would make later loads unrealistically fast. Each load uses a URL never seen before, the server
  sends `no-store`, and the cache is disabled in the page. Every load is then checked from its
  trace: its `v8.compile` event must have none of `cacheKind`, `cacheRejected`, `consumedCacheSize`,
  `cacheConsumeOptions` and no cache in `notStreamedReason`, and the script's response must not be
  `fromCache`; a violation aborts the run. The check was validated against a positive control (the
  same URL loaded five times with caching on): from the third load the event carries
  `cacheKind: "normal"`, `consumedCacheSize: 39192` and
  `notStreamedReason: "script has code-cache available (background)"`, so the detector can see a
  hit. Chrome does write a `v8.produceCache` event after a load; with unique URLs nothing reads it
  back.
- **Tracing overhead.** The trace itself costs a little. Every load is traced the same way, so
  the relation is unaffected, but the absolute milliseconds are slightly higher than an untraced
  load.
- **Not included:** the network (a loopback fetch is in `requestToEvaluated` only), HTML parsing
  (outside `compile`), and the execution of an app (the payload does none).

## Statistics

Following `harness/bench/README.md` (`bench/lib/stats.js`):

- The first load of every point is a warm-up and is discarded (it also pays for Chrome's own
  first-use work).
- Loads are taken in rounds of 2 that visit every point still running, in alternating order, so a
  drift in the machine (a warming browser, a load burst) lands on all points and not on whichever
  ran last.
- A point stops when the 95% bootstrap interval of the median (2000 resamples) is within ±3% of the
  median for **both** compile and evaluate, with at least 10 and at most 40 loads. A point that
  reached the maximum without the precision is marked (`hitMax`).
- Reported per point: median, interval, ± precision (half the interval as a percentage of the
  median), n.
- Per form and metric, two fits through the medians: a straight line (`ms = a + b·bytes`, giving
  ms per 100 kB, the fixed cost `a` and R²) and a power law (`ln ms = c + k·ln bytes`, with the
  exponent's standard error). The relation is called linear when `|k - 1| <= 0.1` and `R² >= 0.99`.

## The machine

`run.json` records the CPU governor, the scaling driver and frequencies, the CPU model, the host
name, the 1-minute load average at the start, after every round and at the end, and the versions of
Node, Chrome, esbuild, terser and brotli. **The project's benches need the `performance` governor;
`powersave` inflates small timings about 3 times.** When the governor is anything else the run says
so on the console and in `run.json`'s `warnings`, and the plots tab shows it above the charts. The
command never changes the governor itself. `--taskset CPUS` pins Chrome to some cores.
