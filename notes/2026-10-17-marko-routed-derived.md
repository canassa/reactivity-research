# 2026-10-17: Marko 6 on routed-app and derived-graph

Emitters: `scenarios/routed-app/marko.js`, `scenarios/derived-graph/marko.js`; `runs.json` entries added.
Style choices are in each emitter's header and in every app's `rr.json`.

## routed-app
- `<if>`/`<else if>` chain, one branch per page; page, tab panel and modal are tags; local state is
  `<let>`s that die with the tag; globals are root `<let>`s passed down (`x=x` to read, `x:=x` to
  write, `<let/x:=input.x>` in the page); timers and the `pagePush` subscription in `<lifecycle>`
  (`feeds` Map in a root `<const>`); numbers via an `int-field` tag with a `pending` `<let>`.
- check: sizes 1, 4, 16, 64 x seeds 1-3 pass, no leaked listeners or intervals. Two-events-in-one-task
  step has not landed on main yet. Builds byte-identical (N=256).
- work (calls, N=16 -> 256): page events, navigation, tab, modal, clock, pagePush are flat. Growing:
  `serverSet` of a global the page does not read 28 -> 126, balance 51 -> 174, notify 42 -> 140,
  snapshot 157 -> 761, mount 462 -> 1066, menu open 615 -> 9015 (global by nature). The growth in
  global writes and mount is the page chain: the compiled root checks/passes into N branches. Not
  shaped to the counter; a dynamic tag over a table of pages is an untested variant.
- size (brotli, 3 seeds): baseline 7,918 B + 650 B/page (R2 0.996); runtime flat at 4.4 KB.

## derived-graph
- One root template: `<let>` inputs/items, `<const>` per formula, static helpers (PRNG, formats,
  `sumBy`...), rows inline `<for by="id">`, `int-field` for number inputs.
- check: sizes 1, 4, 16, 64 x seeds 1-3, plus fanout low/high at N=16, pass. Builds byte-identical.
- work (calls, flat N=16 -> 256): chain 111, cut-off unchanged 54, flip 75, flip back 500, toggle 42,
  filter select 2,456. Note keystroke 139,945 -> 777,765 (x5.6): items are immutable, so every
  `<const>` that reads `items` reruns although no formula reads a note. Item edits ~156k -> 796k and
  hub input 2,217 -> 94,645 (global by nature).
- size (N=64 / 256, seed 1): low 12,081 / 28,058 B; mid 13,386 / 33,960 B; high 15,720 / 43,555 B.
  Mid fit over N>=16: 6,496 B + 108.6 B/formula (R2 1.000).
- Dead end noted: a controlled number input resets invalid text, so `pending` is needed per input
  (one shared tag); an external set after an invalid edit leaves the invalid text shown.
