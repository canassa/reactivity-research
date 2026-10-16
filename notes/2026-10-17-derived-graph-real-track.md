# 2026-10-17: derived-graph on the real track (vanilla, Solid 1, Elm)

**Done.** Three emitters for `derived-graph`, with `scenarios/derived-graph/shared/graph.js` (reads
the spec as a compiler would: the dependency graph, trigger plans, a JavaScript expression
printer, the shared `util.js` text) and `runs.json` entries (sizes 1-256, seeds 1-3, fanout
low/mid/high). `./rr check` passes for all three at N = 1, 4, 16, 64 (seeds 1-3) and at fanout low
and high (N = 16); builds are byte-identical; Elm output is `elm-format --validate` clean at
N = 1 to 256.

**Style.**
- vanilla: a `let` per cell, `calcX()` per formula returning "changed", `showX()` per cell, and
  straight-line recomputation per trigger (`changeX`, `itemsChanged`, `qtyChanged`,
  `activeChanged`) in dependency order; a downstream formula runs only if a formula it reads
  changed. Items are records carrying their `<tr>`; generic keyed helpers in `src/lib.js`
  (counted as runtime); everything else app.
- Solid: `createMemo` per formula inside the render root (a store-reading aggregate subscribes to
  the fields it reads), stores for inputs/items/meta, `<For>` for items, top-k and groups.
- Elm: derived values in `view` as one `let` (computed once per view, nothing cached in the
  model), `Html.Keyed` + `lazy2` rows, `fdiv` on doubles instead of `//`, a port decoded with
  `Json.Decode`. Every event recomputes every formula (an expert's default; `Html.Lazy` can skip
  rows, not formulas).

**Learned.**
- Elm's calls per event are ~O(N x rows) for any action (8,000 -> 83,000 from N = 16 to 256 at 30
  rows; 307,000 -> 3.6 million from 1,000 to 10,000 rows at N = 64): nothing is local.
- Solid's note keystroke is O(rows) (1,051 -> 10,051 calls at 1,000 -> 10,000 rows) only because
  the path setter `(x) => x.id === id` scans the rows; no formula runs.
- vanilla's local actions are flat in N and rows (chain 36, note 7 calls); the unchanged cut-off
  stops after 7 calls, Solid 75, Elm ~8,000.
- Elm's `modBy`/`remainderBy` are double `%` in the kernel; only `//` is 32-bit.
