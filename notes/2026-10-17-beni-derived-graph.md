# 2026-10-17: derived-graph in beni (both browser platforms)

## Done

- `scenarios/derived-graph/shared/beni.js`, one generator for both platforms, and the emitters
  `beni-tea.js` and `beni-direct.js` (they only pick the framework's template files). Nothing in
  `frameworks/beni*/`, the harness, the spec or the README changed.
- Style (recorded in the generator's header and every app's `rr.json`):
  - The Elm Architecture with `Tea.element`; one `Model` in `Main` = `inputs : Inputs` (one field per
    input) + `stock : Items.Model`; `Main` has one `Msg` constructor per sheet message, `ItemsMsg`
    wrapping `Items.Msg` (`Html.map`) and `Pushed`.
  - **Derived values are computed in the view, not cached in the model.** Every formula is one
    constant `let` of `view` (`dutyOwed = Num.pct grossSales model.inputs.taxRate`), in dependency
    order, and displays read the `let`s. That is what beni's language reference calls a derived value
    and what browser-direct compiles into a slot recomputed by the keys that can reach it
    (`docs/design/browser-direct.md` 5.4; browser-tea guards each `let` by the leaf values it read).
    Caching in the model would mean a field per formula and every `update` arm that can reach one
    recomputing its chain: N fields and N chains of calls, exactly what the platform does for the
    program. The model holds state only (inputs, items, the generator's `nextId` and `rng`).
  - Formulas are the app's own code: inline arithmetic and comparisons, `Num.floorDiv` (beni's `//`
    truncates; the contract floors and values can be negative) and `Num.pct`, and generic collection
    helpers that take the formula's own function (`Agg.sumBy items λit → it.qty * it.price`, `avgBy`,
    `maxBy`, `minBy`, `topBy`, `groupSum`). `Int` is a double, so values up to 2^50 are exact.
  - Controlled number inputs: a `Maybe String` field `<name>Draft` beside the number keeps the typed
    text while it is not an integer in range (the derived codec reads a missing key as `Nothing`, so
    a snapshot drops every draft). Same for an item's `qtyDraft` and the markup.
  - The items section is one module (`Items`: Item, Model, Msg, the Park-Miller builder written like
    js-framework-benchmark's, `update`, `serverItems`, `snapshot`, the table's `view`). Item edits
    are the TodoMVC `List.map model.items λitem → if item.id == id then { item | ... } else item`
    written inline in each arm, which beni's write-set analysis recognises. Keyed `For` (.id) for rows
    and top-k lists, (.category) for group rows. External events are read with `schema Event tagged
    "type"` (host values) and derived codecs (`Values` with `Maybe` fields for `serverInputs`).
  - N=1 has no input at all (unit 0 has none): the generator then leaves out `Inputs` and
    `serverInputs`.
- A name is checked: a beni keyword is refused anywhere, a formula (a local of `view`) must not shadow
  a function the generated code calls (an input is a record field, so `floor` or `cap` are fine).
  All of sizes 1 to 512, seeds 1 to 7, the three fan-outs emit.

## Checks (`./rr check`, quick-check rows 30)

- beni-tea and beni-direct: sizes 1, 4, 16, 64 with seeds 1, 2, 3, plus `--fanout low` and `high` at
  size 16: **all pass** (0 mismatches, 0 focus losses, 0 keyed replacements, clean disposal).
  Also beni-tea 128 and 256 (seed 1), beni-direct 32 and 128 (seeds 1 to 3).
- Builds are byte-identical on rebuild (tea n64 s2, direct n32 s3: same `_main.js` sha256).

## Limit: browser-direct stops building at about N=160 (compiler memory), no message

| N | build time | peak RSS | raw JS |
|---|---|---|---|
| 64 | 7 s | | 368 kB |
| 128 | 39 s | 3.9 GB | 1.16 MB |
| 160 | 83 s | 8.1 GB | |
| 192 | killed (SIGTERM) after 78 s | past 12 GB | |
| 256 | killed after 109 s | | |

The process is terminated with no diagnostic (probably the host's memory guard; the machine had
about 12 GB free). The cost is the output: in every input's handler the compiler inlines the whole
block of derived values it can reach, so raw JS grows about with N squared (beni-tea: 90 kB at 16,
218 kB at 64, 405 kB at 128, 786 kB at 256). `runs.json` measures beni-direct at 1 to 128, with a
`$comment`. Nothing in the code is bent around it.

## Measured (`./rr measure derived-graph <fw> --jobs 4 --out /tmp/rr-dg2-measure-*`, not committed)

Medians over seeds 1 to 3 are in the per-run files; the fits (brotli, HTML + JS):

| | all sizes | N >= 16 |
|---|---|---|
| beni-tea mid | 13 875 + 321.8 B/formula | 14 575 + 317.9 |
| beni-tea low | 13 818 + 243.0 | 14 472 + 239.3 |
| beni-tea high | 13 865 + 459.5 | 14 558 + 455.6 |
| beni-direct mid (1-128) | 15 483 + 308.5 | 16 983 + 292.2 |
| beni-direct low | 15 504 + 233.7 | 17 055 + 216.8 |
| beni-direct high | 15 352 + 444.6 | 16 552 + 431.6 |

Totals at N=1, 16, 64, 128 (mid, seed 1): tea 13 296, 19 957, 34 650, 54 663; direct 14 901, 21 932,
35 064, 53 665. Tea at N=256: 94 230. The runtime is flat (tea 9.5 to 10.3 kB, direct 10.5 to 11.9 kB);
the rest is app code. Each read edge costs about 20 to 25 B (tea: slope 243 -> 318 -> 456 for 1, 4, 10
extra display reads per formula).

## Work (`./rr work`, calls per action, 2,000 items, no-JIT counting)

beni-tea, N=16 against 256 (seed 1; `*` global by nature):

| action | N=16 | N=256 | x |
|---|---|---|---|
| chain input: type a number | 201 | 233 | 1.16 |
| cut-off input: unchanged bool | 961 | 984 | 1.02 |
| cut-off input: flips the bool | 99 | 122 | 1.23 |
| cut-off input: flip back | 961 | 984 | 1.02 |
| filter select | 2 924 | 2 947 | 1.01 |
| toggle | 107 | 130 | 1.21 |
| threshold (filter and sort) | 74 073 | 74 097 | 1.00 |
| markup | 23 439 | 25 462 | 1.09 |
| item: type a note character | 112 961 | 1 533 055 | 13.57 |
| dispatch serverInputs (closed inputs) | 112 589 | 112 779 | 1.00 |
| hub input: raise * | 2 364 | 358 761 | 151.76 |
| item: type a quantity * | 151 360 | 1 571 888 | 10.39 |
| item: toggle active * | 151 370 | 1 571 685 | 10.38 |
| item: add one * | 149 546 | 1 574 239 | 10.53 |
| item: remove one * | 151 063 | 1 570 383 | 10.40 |
| dispatch serverItems * | 171 182 | 1 590 563 | 9.29 |
| dispatch snapshot * | 184 913 | 1 423 893 | 7.70 |

Local actions: median 1.02x, max 13.57x (the note keystroke: the items list gets a new identity and
every guard that read it re-runs; none of those formulas read a note).

beni-direct, N=16 against 128 (256 does not build; `*` global by nature):

| action | N=16 | N=128 | x (8x the size) |
|---|---|---|---|
| chain input | 75 876 | 595 910 | 7.85 |
| cut-off input: unchanged bool | 75 877 | 595 911 | 7.85 |
| cut-off input: flips the bool | 75 015 | 595 049 | 7.93 |
| cut-off input: flip back | 75 877 | 595 911 | 7.85 |
| filter select | 77 852 | 597 886 | 7.68 |
| toggle | 75 034 | 595 068 | 7.93 |
| threshold | 102 935 | 622 970 | 6.05 |
| markup | 154 296 | 676 330 | 4.38 |
| item: type a note character | 113 003 | 789 650 | 6.99 |
| dispatch serverInputs (closed inputs) | 149 419 | 826 362 | 5.53 |
| hub input: raise * | 141 277 | 661 419 | 4.68 |
| item: type a quantity * | 151 417 | 828 315 | 5.47 |
| item: toggle active * | 151 414 | 828 125 | 5.47 |
| item: add one * | 149 621 | 828 716 | 5.54 |
| item: remove one * | 151 088 | 827 132 | 5.47 |
| dispatch serverItems * | 171 283 | 847 555 | 4.95 |
| dispatch snapshot * | 200 057 | 670 265 | 3.35 |

Local actions: median 7.68x, max 7.93x for 8x the size, so a local action's work is linear in N on
beni-direct: every message key's handler re-runs the whole derived block (the chain input costs the
same 75 876 calls as the cut-off, the toggle or a filter pick). The same apps on beni-tea guard each
`let` by its leaf values and stay flat. `--rows` is 2,000 in these runs; the 75 k floor of a handler
at N=16 is the aggregates over 2,000 items. Not measured: the rows axis, and N=256 on beni-direct.

## Learned

- A `let` of `view` is the right home for a formula on both platforms, but the platforms do not use
  the dependency graph as finely as the spec's closures: on beni-direct a local input edit (chain
  input: 3 formulas downstream) still re-runs the derived block (75,876 calls at N=16, 595,910 at
  N=128; 7.85x for 8x the size), and a note keystroke re-runs every aggregate on both platforms
  (a note is read by no formula). beni-tea's guards compare leaf values, so its local actions are flat
  (chain input 201 -> 233 calls) except where the items list changes identity.
