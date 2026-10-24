# 2026-10-25: beni-inline in runs.json, on the no-lists variant

**Why.** The owner agreed to measure beni-inline at pin `2556986c6`
(`notes/2026-10-25-beni-inline-s1-pin.md`) where it builds: `--lists none` of unique-components
and big-component. The other four scenarios stay out, because they do not build yet (`For`, and
beni issue #879).

**Done.**
- `runs.json`: `beni-inline` in unique-components and big-component, `"lists": "none"`, sizes
  1–256, seeds 1–3, the same as tea-inline's `lists=none`.
- `./rr report unique-components,big-component --jobs 8`, under Node v26.11.1 (the project's
  flake, via `direnv exec .`). It wrote `results/2026-10-25-unique-components/` (243 measured)
  and `results/2026-10-25-big-component/` (216 measured).

**Two false starts, nothing written.**
1. The first `./rr report` ran under Node v24.19.0. That was beni's Node, which was on the shell's
   `PATH` because the session started in the beni repository. The measurement hash includes
   `process.version`, and every committed result was measured with v26.11.1, so nothing was
   reused. I stopped it. Always run `./rr` through `direnv exec .` or `nix develop`.
2. Under v26.11.1, a plain `./rr report` still reused nothing, even in shared-components. The
   cause is not Node: 78977aa (2026-10-17 22:06) edited `scenarios/<scenario>/shared/beni.js`
   in all six scenarios after their last results (fcbdf5f, 04:47 that day). `codeHash` reads all
   of `shared/` for **every** emitter of a scenario, so every framework in every scenario has a
   stale hash. I stopped it and ran only the two approved scenarios.

**Open.** shared-components, big-table, derived-graph and routed-app are stale in the same way.
The next full `./rr report` will remeasure every framework there. Their numbers should not move,
as the two scenarios here show. A beni-only edit to `shared/` making every framework stale is a
hash-scope problem in the harness: the beni generator is shared only by beni emitters.

**Checked.** Every framework remeasured here gives the same brotli total as on 2026-10-17, to
the byte, at all 27 size/seed points. Only `beni-inline-lists=none` and `tea-inline-lists=none`
are new.

**Fits** (brotli total, all sizes, seeds 1–3):

| | unique-components | big-component |
|---|---|---|
| beni-inline, lists=none | 2,653 + 171.5 B/widget | 1,899 + 82.0 B/unit |
| tea-inline, lists=none | 2,072 + 148.5 | 1,567 + 72.5 |
| beni-inline ÷ tea-inline | 1.28× baseline, 1.16× slope | 1.21× baseline, 1.13× slope |
| tea-inline | 2,745 + 171.9 | 1,960 + 80.8 |
| tea-local | 2,575 + 161.2 | 2,027 + 74.8 |
| tea-dirtybits | 2,724 + 183.4 | 1,994 + 87.8 |
| digest | 2,346 + 134.7 | — |
| marko | 5,841 + 342.3 | 5,137 + 101.8 |
| solid | 8,659 + 230.9 | 7,729 + 91.9 |
| elm | 8,690 + 249.2 | 7,788 + 86.3 |

The pin has had the owner's hand check through `./rr serve` (rule 2), so beni-inline's numbers
count.
