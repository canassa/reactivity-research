# `./rr bench`: CPU time per event

The rest of the project measures size. `./rr bench` measures time: **how long does one event take,
and does it grow as the app grows?** It is the time counterpart of `./rr work`, which counts the
JavaScript calls of the same events. Real frameworks and prototypes are measured alike.

```sh
./rr bench shared-components all --quick                 # development: one size, one seed, a few reps
./rr bench shared-components all                         # the matrix in runs.json ("$bench"), 2 sessions
./rr bench shared-components solid --aa --sizes 16 --seeds 1   # A/A: the same app under two names
./rr bench all all --remote azathoth                     # on a quiet machine, results copied back
./rr plots --out /tmp/rr-bench-plots.html                # the CPU card, one per scenario
```

## What is measured

For every app (framework, size, seed), in every session:

- **Events.** One page, and every `./rr work` action (`harness/work/<scenario>.js`) many times on
  it. The primary figure is **`script`**, the JavaScript time of one event in µs, as its median and
  IQR; the secondary is **`total`**, from the input to the commit of the frame that shows it, in ms.
- **Startup.** 10 fresh tabs of a bench page that mounts the app on load: `script` and `total`
  from the navigation to the first commit after mount.
- **Heap.** After each startup load, a forced GC, then the JavaScript heap in use
  (`Runtime.getHeapUsage`).

### Making every event repeatable

An action of `./rr work` runs once; here it must run 15 to 45 times from the same state. Each
scenario's `harness/bench/<scenario>.js` turns the work actions into **do/undo pairs** on the same
targets, and both halves are reported: toggle and toggle back, type a character and delete it
(one Backspace), type into a list's draft, push it and remove the pushed item, server state A then
B, snapshot A then B. An action with no natural undo (an add button, a tick) repeats on its own,
and an untimed `serverSet` puts its field back before it would reach the maximum where it stops
changing anything. `lib/fields.js` documents the pairs for unique-components and big-component.

### One rep

Each step of a rep is real input through the DevTools protocol, never a synthetic DOM event:

| step | input | the rep starts at |
|---|---|---|
| click | `Input.dispatchMouseEvent` press and release at the element's centre | the `click` EventDispatch |
| type | `Input.insertText` (caret at the end), or a Backspace key; a number input is selected and retyped | the first `keydown`/`beforeinput`/`textInput`/`input` |
| select | ArrowDown or ArrowUp on the focused `<select>` | the `keydown` |
| dispatch | the message is stored, then a zero-delay timer calls `rr.dispatch`, as a server push arrives as its own task | that timer's `TimerFire` |

Before the input, the harness prepares the target and writes a user-timing mark; after it, it
waits 40 ms without running anything in the page (a frame, for Elm's rAF rendering, and its
commit), then writes a second mark and only then calls `rr.settled()`, so neither the harness nor
the adapter is ever timed. A rep is the trace between its two marks, timed with
**js-framework-benchmark's rule** (`webdriver-ts/src/timeline.ts`, ported from beni's
`bench/ui/lib/trace.mjs` into `lib/trace.js`): from the input event to the end of the first
`Commit` after the last of {input, `FireAnimationFrame`, `TimerFire`, `Layout`, `FunctionCall`}
(or the last commit, if none follows); `script` is the union of the JavaScript events inside. Of
the event dispatches, the ones the app listens to (click, input, change) count, as the rule counts
the click; the native editing inside a keydown is not JavaScript and does not. Only the page's
renderer main thread is read. Trace categories: `devtools.timeline`,
`disabled-by-default-devtools.timeline`, `blink.user_timing` (not the V8 sampling profiler, which
inflates `script`).

### How many reps

Per action: 5 warm-up reps, discarded; then reps in traced chunks (one trace per 10 or 5 reps on
the one page) until the median's 95% bootstrap interval is within ±3% for every half, with at
least 10 and at most 40 reps. A rep whose trace has no commit is dropped and recorded in
`samples.json`'s failures.

### Order, load and correctness

- **Sessions** (default 2) are fresh browsers. Session 2 runs the framework order of session 1
  reversed; sessions 3 and 4 do the same rotated by one. Without this, a drift (a warming browser,
  a load burst) lands on whichever framework always comes first.
- **Load.** The 1-minute load average is recorded before and after each batch (one app in one
  session). Before a batch the harness waits up to 2 minutes for it to fall below `--max-load`
  (default 1.0); a batch that ends above it is redone, at most twice, and every attempt is in
  `run.json`. `--quick` records the load but neither waits nor redoes.
- **Correctness gate.** Every build is first run through `./rr check`'s script check (the same
  code); a build that fails it is not benchmarked, and `run.json`'s `skipped` says why. Locality
  (`./rr check` on prototypes) is a property of the generator, not of one build, and is not rerun.
- **The matrix** is runs.json's `"$bench"` block per scenario (sizes 16, 64, 256 and seeds 1, 2 by
  default), within each framework's own runs: a framework missing from a scenario (digest in
  big-component) or a size missing from its list (beni-direct at 256) is skipped.
- **No CPU throttling** (rate 1), and Chrome's background throttling is off.

## Why it differs from js-framework-benchmark

The timing rule is theirs. The protocol is not, because our events are tiny: one keystroke in a
form costs 10–300 µs of script, against their 1–60 ms operations.

- **One page per app and session, many reps inside it,** instead of a fresh tab and trace per
  sample. A fresh tab costs 1–2 s per sample; here a rep costs about 45 ms. It also measures what
  a user meets: an app that has been running, not the first event after a load.
- **No CPU throttling.** On Linux the throttler interrupts the main thread every ~200 µs and
  busy-waits, which makes any operation under ~1 ms bimodal; the published `script` IQRs there are
  50–500% (beni research 84). Unthrottled, the same operations have IQRs of a few percent on a
  quiet machine.
- **An adaptive count** (10–40 reps, stop at ±3%) instead of a fixed 15.
- **Rotated, reversed sessions** instead of every iteration of a framework back to back, and the
  load recorded and enforced: beni measured ±5–30% on a busy machine against ±1% on a quiet one.

## Results

`results/cpu/<date>-<scenario>[-n]/` (with `--remote`, `-<host>` before the counter):

- `run.json`: the machine (CPU model, threads, governor, `no_turbo`/`boost`, kernel, taskset),
  Chrome (binary and version), Node, git commit, sessions, the method's numbers, every batch with
  its load, and what was skipped and why;
- `samples.json`: every rep (`events`), every startup load (`startup`), and every failure;
- `summary.json`: per variant, size, action and half, the median, quartiles, n and 95% interval
  of `script` (µs) and `total` (ms), pooled over seeds and sessions, with each seed's median; per
  variant and size, startup and heap; per variant, the growth of each local half's median from the
  smallest to the largest size (N=256 over N=16 where both exist); with `--aa`, the A/A table.

The plots page shows the latest run per scenario as its CPU card.

## Remote

`--remote HOST` runs the same command on another machine at exactly this commit:

1. it requires a clean working tree whose `HEAD` is on `origin/main` (commit and push first);
2. over ssh, in `~/src/github.com/canassa/reactivity-research` (cloned from the origin if it is
   missing): `git fetch`, `git checkout --detach <sha>`, then under `nix develop` `npm ci` in every
   `frameworks/*/` with a lockfile and `frameworks/beni/install.sh`;
3. `nix develop -c ./rr bench …` there, one scenario at a time, with `--out results/cpu/<dir>`;
4. `rsync` of each results directory back into this checkout.

Known hosts get their defaults unless the flags say otherwise; for **azathoth** (Intel Xeon
E-2386G, 6 cores / 12 threads, CPU n and n+6 siblings, NixOS) that is `--taskset 1-5,7-11` (whole
cores 1–5, core 0 left to the OS, the harness and the server) and beni's pinned Chrome 154,
`/nix/store/ds7933z0wp7872ic6zqzrwsbpj0m8g6l-google-chrome-154.0.8037.97/bin/google-chrome`.
The harness never touches CPU frequency settings; it records them.

## Resolution: the A/A check

`--aa` benchmarks every app twice under two names in the same sessions. On a shared, busy machine
(Solid, shared-components N=16, 2 sessions) the two copies' 95% intervals overlapped on 26 of 28
halves, with a median |difference| of 3.2% (max 13.6%). The interval is a bootstrap over the reps
of one page, so it does not include the few percent by which two pages of the same app differ:
read differences below about 5% as noise there, and rerun the A/A on the machine that produces
the results before trusting finer ones.

## CPU frequency

Each rep follows 40 ms of idle. On an idle machine with a power-saving governor the core drops to
its lowest clock in between, and a sub-millisecond event runs before it ramps up: on azathoth
(`powersave`, idle cores at 800 MHz) the first quick run read about 3.3× the script times of a
loaded desktop, with the frameworks in the same order and ratio. Compare absolute times only
between runs with the same governor (`run.json` records it, with `no_turbo` or `boost`); the
harness never changes it.

## Speed

A step costs about 45 ms of wall time (prepare, input, the 40 ms wait, finish). On a busy machine
every action runs to the 40-rep cap: about 60 s per app per session on shared-components (14
actions, 28 halves), plus the startup loads; a `--quick` app takes 7–10 s. The full matrix (134
apps, 2 sessions) is then about 4 hours, less on a quiet machine where actions stop early.
