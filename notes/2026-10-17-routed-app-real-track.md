# 2026-10-17: routed-app on the real track (vanilla, Solid 1, Elm)

## Done

- Three emitters for `routed-app`: `vanilla.js`, `solid.js`, `elm.js`, and their `runs.json` entries (sizes 1 to
  256, seeds 1 to 3).
- `./rr check` passes for all three at N = 1, 4, 16 and 64 with seeds 1 to 3: 0 mismatches, 0 focus losses,
  0 keyed replacements, nothing left after dispose. Builds are byte-identical.
- Measurements were taken (to `/tmp`, not committed).

## Styles

- **vanilla:** a module per page exporting `mount(a)`; the page's state as plain objects in its closure; one
  idempotent `render()` per page (`setText`/`setValue` write only what differs); delegated listeners on the page's
  `<main>`; a keyed `sync` helper (the only runtime); conditional sections after comment anchors; tab panels and the
  modal built when selected or opened. `go(route)` disposes the old page and mounts the new one.
- **Solid 1:** an in-app `route` signal with `<Dynamic>` over a table of page components (a `switch` variant with
  `<Switch>`/`<Match>` is also recorded, see below); a store created inside each page,
  tab panel and modal component, so state resets on remount; `setInterval` with `onCleanup`; a `pagePush`
  subscription registered by the page and removed with it.
- **Elm:** `Browser.element`; a `Page` custom type holding the shown page's model (its `init` runs on every
  navigation); `Global` as a module; one `Msg` per page covering its tabs and modal; `Time.every` only for the
  mounted page's time-driven fields; the app root is `Keyed.node` so pages never reuse each other's DOM. A
  `pagePush` to a page not shown is dropped because the model holds another page.

## Numbers (median of 3 seeds, brotli bytes)

| | N=1 | N=16 | N=64 | N=256 | baseline | slope |
|---|---|---|---|---|---|---|
| vanilla | 1,599 | 11,143 | 38,485 | 115,934 | 4,202 | 450.5 |
| Solid 1 | 10,552 | 19,765 | 45,283 | 118,856 | 13,038 | 426.9 |
| Elm | 7,988 | 17,568 | 40,131 | 106,970 | 11,099 | 385.6 |

Work (calls, N=16 against 256): every local action is flat (ratio 1.00) in all three. Only the "All pages" menu
grows. Mount and navigation: vanilla 21 and 13 to 39 calls, Solid 518 and 265 to 413, Elm 857 and 849 to 1,834.

## Learned

- **vanilla is the floor only at N=1.** Its baseline is 1.6 KB against 8 to 10 KB, but its slope (450 B per page) is
  above Solid's and Elm's. Each page ships its HTML, a path to every bound node, a `render()` and three event
  switches, written out in plain DOM calls, and none of that is shared. Elm's view DSL is the densest.
- **Elm's costs are constant but high** (about 1,000 calls per page event), because the virtual DOM diffs the
  whole page each time; it does not depend on N.

## Review round (same day)

A code review found all three fair and asked for fixes, now applied:

- **Elm:** `dispose()` left `Time.every` running (the script ended on p1, so the check missed it). The adapter now
  sends `{type:"stop"}` first; routed-app answers by dropping every subscription, the other Elm scenarios ignore it.
  Verified in headless Chrome on p4: 1 interval, 0 after dispose. A stale `Go` from a page already left no longer
  navigates (`Main.update` matches `( msg, model.page )`). Output is elm-format-clean at 1 to 256; checkboxes use
  `onCheck`. The dead `Go _` branches stay: the exhaustive `case` needs them.
- **Solid:** a number input re-asserts its value on every writer (a per-field signal), opening an open modal resets it
  (it remounts), tab panels and modals get the page store only when they use it.
- **vanilla:** opening the modal again removes the old `<aside>` first.
- **Routing, Solid:** the first note blamed `<Switch>`/`<Match>` on the call counter, which rule 3 forbids as a
  reason. `routing: "dynamic" | "switch"` is now a recorded variant (`runs.json` options) and both are reported.
  `<Dynamic>` stays the default because it is how a router resolves a component, **not** because it is smaller:
  it adds about 2.4 KB of baseline (slopes equal, about 431 B per page).

| Solid, median of 3 seeds | N=1 | N=16 | N=64 | N=256 | baseline | slope |
|---|---|---|---|---|---|---|
| dynamic | 10,552 | 19,852 | 45,437 | 119,787 | 13,053 | 430.3 |
| switch | 8,175 | 17,382 | 43,135 | 117,461 | 10,633 | 431.0 |

Work, N=16 to 256: `dynamic` is flat on every local action (navigation 390, mount 518); `switch` is not (navigation
745 to 36,625, mount 976 to 38,296, because every `Match` is evaluated). As a prototype it would fail the locality
bound; as a real framework it is only reported.

After the fixes (median of 3 seeds): vanilla 1,599 / 11,186 / 38,608 / 115,997 (slope 451.0); Elm 8,045 / 17,688 /
40,313 / 107,738 (baseline 11,142, slope 388.2). Elm's app dispose now costs 932 calls instead of 5 (the stop event).
