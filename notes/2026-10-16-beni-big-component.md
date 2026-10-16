# 2026-10-16: big-component in beni (both browser platforms)

Done: `scenarios/big-component/{beni-tea,beni-direct}.js` over one source,
`scenarios/big-component/shared/beni.js` (adapted from unique-components' beni emitter: same
vocabulary, same style; page root is `data-role="page"`).

Style choices (recorded in each app's rr.json): The Elm Architecture (`Tea.element`), one module per
widget (`Widget.W1` the form, `Widget.W2` the companion), one `Model` record for the form with a
typed field per spec field, one `Msg` constructor and one case arm per message written out, `Main`
only routing; keyed `For` lists, `if` holes for conditions, derived texts as expressions in place.
New here: the form's view is split into one helper per top-level section (`section1 model`, ...),
each with its own locals; the companion's view stays whole.

Results:
- `./rr check` passes for both at N = 1, 4, 16, 64, seeds 1-3 (and 256 seed 2 on direct).
- Both build at every size and seed, N = 1..256, including browser-direct: the 64-path width cap
  did not trigger (one flat model of ~270 fields, few lists). No `$comment` needed in runs.json.
- Builds are byte-identical on rebuild.
- Totals (br, seed 1): beni-tea N=1 9755, 16 16477, 64 26564, 256 64363; beni-direct N=1 11523,
  16 19031, 64 30934, 256 71697. Fits over all sizes: tea 11855 B + 214.5 B/unit, direct 14091 B +
  238.7 B/unit. Runtime is about 9.6-11 KB (tea) and 10.9-12.3 KB (direct) and nearly flat; the
  slope is app code (204.9 and 229.3 B/unit).
- Work (calls per local action, N=16 -> 256): beni-tea median 2.36x (max 2.54x, 129 -> 301);
  beni-direct median 9.2x (max 12.7x, 278 -> 2432): per-action work in direct grows with the
  form, so it would fail the 8x locality bound if it were a prototype (beni is not held to it).
- Dead end / trade-off: the section helpers cost work (direct N=256 add-to-int 2819 unsplit vs
  3478 split; tea median 1.65x unsplit vs 2.36x) but save bytes (N=64 s1: tea 26564 vs 26945,
  direct 30934 vs 31057). Kept the split as the idiomatic way to write a long view.
