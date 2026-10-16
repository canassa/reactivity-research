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
- **Solid 1:** an in-app `route` signal with `<Dynamic>` over a table of page components (`<Switch>`/`<Match>`
  built N matches per mount and per navigation, 40x more work from N=16 to 256); a store created inside each page,
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
- **`<Switch>`/`<Match>` is not a router for many pages:** Solid evaluates every `Match` condition, so routing
  through it makes mount and navigation grow with the page count. `<Dynamic>` over a lookup keeps them flat.
- **Elm's costs are constant but high** (about 1,000 calls per page event), because the virtual DOM diffs the
  whole page each time; it does not depend on N.
