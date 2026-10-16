# 2026-10-16: beni on unique-components

## Done

- `scenarios/unique-components/shared/beni.js`, one generator for both beni platforms, and the
  emitters `beni-tea.js` and `beni-direct.js` (they only pick the framework's template files).
- Every widget is its own module (`Widget.W1`, …) with its own `Model`, `init`, `Msg`, `update`,
  `view` and `replace` (plus `tick` for a time-driven int and `notify` for a feed). Click ops are
  written out as record updates, `clamp`, `not`, list edits; every expression is compiled into the
  widget's own code. Cross-widget reads are extra `Model` arguments of `view`. `Main` only routes
  (one `Msg` constructor per widget, `Html.map`, the pushed events). `Ui` holds two generic
  helpers (`intIn`, `shown`) for number inputs. Style is in the emitter's `style` and header.
- Generated source matches `beni fmt` except a few over-long lines at some sizes (checked at
  N = 16, 64, 128, 256).
- `./rr check` passes on both platforms at N = 1, 4, 16, 64, seeds 1-3 (0 mismatches, 0 focus
  losses, 0 keyed replacements, nothing left after dispose); beni-tea also at N = 256, seed 1.
  The shared-components beni checks still pass. Builds are byte-identical.
- `runs.json`: beni-tea at 1-256, beni-direct at 1, 2, 4, 8, 16, 64.

## Measured (not committed; `./rr measure ... --out /tmp/uc-beni-*`)

| | N=1 | N=16 | N=64 | N=256 | all sizes | N >= 16 |
|---|---|---|---|---|---|---|
| beni-tea | 10 015 | 24 247 | 55 460 | 159 979 | 13 730 + 586.2 | 17 680 + 562.9 |
| beni-direct | 11 886 | 28 655 | 66 827 | (no build) | 13 169 + 854.1 | 15 931 + 795.3 |

Medians over seeds 1-3, brotli bytes; the all-sizes fits are the runner's (all points). Against
shared-components (results/2026-10-16-shared-components-6): beni-tea 13 734 + 113.6 (N >= 16:
17 638 + 91.6), beni-direct 14 508 + 198.1 (N >= 16: 19 343 + 144.7). One more component type costs
about five times what one more use of a kind does. The runtime is 7.8 kB (tea) / 9.0 kB (direct) at
N=1 and 12.5 kB (tea, N=256); the app code is the slope.

## Limit: browser-direct's ownership checker

`LIST MAY BE SHARED` ("`update` changes `model` in place, and the checker cannot show that nothing
else still holds the list", Main.beni, at `Tea.element`), the width cap of
`ownership-checker.md` §16.7 (every widget adds list paths to the one `update` summary):

- N=32 seed 3 fails (it names 18 paths, `model.w12.books` … `model.w6.plants`); seeds 1, 2 pass;
- N=96 (seed 1), 128 and 256 fail for every seed tried; N=48 (seed 3) and 64 (seeds 1-3) pass.

So `runs.json` measures beni-direct at 1, 2, 4, 8, 16, 64 (6 sizes) and leaves out 32, 128, 256.
Not bent around: the `List.copy`-at-every-edit workaround would build but costs every edit a copy.

## Learned

- A top-level `init` value is refused by browser-direct when `update` edits its lists in place
  (`TOP-LEVEL LIST CHANGED`): each widget's `init` is a function (`init ⊤ = …`).
- beni refuses shadowing of the prelude too: a widget field named `degrees` could not be a local.
- A number input needs the typed text beside the number (`Maybe String`), as the amount widget
  of shared-components did; the check never leaves it invalid.
