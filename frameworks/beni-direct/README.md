# beni on browser-direct

beni's `browser-direct` platform (beni's `docs/design/browser-direct.md`): the same Elm
Architecture program, compiled instead of run. There is no `view` at run time: the page is HTML
with every constant baked in, each message key is one JavaScript function that runs its `update`
arm and writes exactly the DOM nodes its write set can reach, lists are edited in place, and a
keyed reconciler ships only for lists a message replaces or permutes. beni is unreleased; the
compiler is pinned to commit `6a1b567fa` and built from source: see
[`../beni/README.md`](../beni/README.md) for the pin, the build, the adapter and the byte
attribution, shared with [`beni-tea`](../beni-tea/).

## How the app is written

Exactly as for beni-tea, from the same generator (`scenarios/shared-components/shared/beni.js`):
`browser-direct`'s `Tea` is `browser-tea`'s API, "so one source builds on both". See
[`../beni-tea/README.md`](../beni-tea/README.md) for the style. Two of its choices come from this
platform's ownership checker, which proves every in-place list edit safe or refuses the build:

- a list the host sent is copied where the model takes it (`List.copy` in each kind's `replace`),
  as its message asks ("the list came from JavaScript");
- the pushed event is read in `update` (`Pushed value → pushed value model`), not in the
  subscription's function: decoding there, or sending `update` a message built from the event,
  made the checker refuse the in-place list edits of every widget.

## Build, check, measure

```sh
frameworks/beni/install.sh                    # once: the pinned compiler
./rr check shared-components beni-direct --size 64
./rr measure shared-components beni-direct --out /tmp/beni-direct-m
```

## Limit: no N=256 (the ownership checker's width cap)

At N=256 the build is refused, for every seed, by the ownership checker:

```
-- LIST MAY BE SHARED -------------------------------------- src/Main.beni:30:10

`update` changes `model` in place, and the checker cannot show that nothing else
still holds the list.
…
This is a limit of the checker, not proof of sharing: the list came from
JavaScript.
```

The model's lists are all fresh (literals in `init`, `List.copy` where the host's arrive), and
smaller apps pass. The cause is the checker's width cap (`ownership-checker.md` §16.7: a summary
tracks at most 64 paths, past which it is coarsened and its in-place writes become approximate):
`update`'s summary covers every widget's paths, so a large flat model goes over it. Where it
lands depends on the mix: seed 1 fails at N = 70–88 and passes at 64 and 92–128; the sizes
`runs.json` measures (1–128) pass for seeds 1–3, so its `beni-direct` entry stops at 128. The
N=256 compile itself is fine otherwise (3–7 s, 2.3–2.5 GB).

Options, none taken: copy each list where `update` edits it (`List.copy model.items`, at the
three kinds' edit sites) — tried, and N=256 then builds, but it is a workaround for the
checker that costs every edit a copy; split the model so no summary passes 64 paths (a flat TEA
model cannot); or wait for beni to raise the cap or track a record of independent fields
without coarsening.

## What it ships

Measured 2026-10-16 (sizes 1–128, seeds 1–3, brotli 11):

| | N=1 total | baseline + slope, all sizes | baseline + slope, N ≥ 16 |
|---|---|---|---|
| beni-direct | 10 091 B | 14 826 + 194.1 B/widget | 19 359 + 144.2 B/widget |
| beni-tea (sizes ≤ 128) | 9 298 B | 13 147 + 144.8 | 17 231 + 99.9 |

Its runtime is a little larger than beni-tea's (8.2 kB brotli at N=1, 11.8 kB with every kind),
and its app code grows faster: the shared widget modules are compiled per instance (each
widget's handlers and node writes are specialised to its place), so `Main` alone is about 142 kB
of minified JavaScript at N=64, against 36 kB on browser-tea.
