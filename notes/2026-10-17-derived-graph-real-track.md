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

## Review round: fixes and style variants

**Fixes.**
- A number input holding a typed text that was never sent (invalid) must show the value again when
  an event writes the value the app already had. vanilla returned early in `changeX` and `patch`
  skipped unchanged fields; both now re-assert the controls (the `setValue` guard skips no-op
  writes). Solid binds an `epoch` signal in its number inputs' `value` (bumped by external events
  and by a step at a limit). Tested by sequence (typed invalid, then a same-value `serverInputs`,
  a step at the limit, a same-value `snapshot`, a same-value `serverItems`, a same-markup snapshot)
  in all six variants.
- The review said Elm was fine. It was not, for a different reason: `onInput` sends every text, so
  an invalid text sent a no-op message and the next frame wrote the old value back over it
  (the typed text did not survive even without an external event). Number inputs now use
  `onNumber`, an `input` decoder (`stopPropagationOn`, so the redraw stays synchronous) that fails
  unless the text is an integer in range: no message, no redraw, the text stays. In the `lazy`
  variant a section skipped by `Html.Lazy` would also keep the text on a same-value event, so
  sections with a number input take an `epoch` that steps and external inputs bump.
- Unused imports dropped.

**Variants (recorded styles; `runs.json` multiplies them with the three fanout levels: 6 vanilla
and 9 Elm variants).**
- vanilla `derived: waves | recompute`. `waves` is the floor in work; `recompute` (one function that
  runs every `calcX` in order and re-shows what changed) is the floor in bytes.
- Elm `derived: view | model | lazy`. **`view` is naive TEA** (everything in `view`), not Elm's slope.
  `model` keeps a `Derived` record in the model, recomputed in `update` when a message can change
  what formulas read (not a note or the markup) and the state changed. `lazy` is a function per unit
  taking only the inputs and items it transitively reads and computing the formulas it needs, under
  `Html.Lazy.lazyN`. `Html.Lazy` stops at 8 arguments, so a unit reading more than 8 values is
  called directly: 157 of 256 units at N = 256 seed 1, which is why `lazy` is worse than `view`.

**Numbers (seed 1, mid fanout; bytes brotli, N=16 to N=256 calls, 30 rows).**

| variant | N=1 | N=64 | N=256 | slope N>=16 | chain input | unchanged cut-off | note | hub input | item qty edit |
|---|---|---|---|---|---|---|---|---|---|
| vanilla waves | 2,314 | 12,316 | 39,242 | 142.4 | 36 / 36 | 7 / 7 | 7 / 7 | 168 / 1,644 | 716 / 5,698 |
| vanilla recompute | 2,327 | 10,642 | 31,976 | 113.0 | 510 / 7,634 | 483 / 7,607 | 7 / 7 | 740 / 8,298 | 780 / 8,411 |
| solid | 8,228 | 17,293 | 40,413 | 123.3 | 196 / 196 | 76 / 76 | 81 / 81 | 1,106 / 12,998 | 5,601 / 42,749 |
| elm view (naive TEA) | 8,939 | 15,045 | 29,928 | 78.9 | 7,981 / 82,961 | 7,947 / 82,927 | 8,529 / 83,509 | 8,410 / 84,196 | 8,970 / 84,877 |
| elm model | 9,007 | 15,625 | 31,402 | 84.2 | 8,015 / 83,209 | 7,979 / 83,170 | 5,617 / 45,935 | 8,440 / 84,412 | 9,011 / 85,068 |
| elm lazy | 8,979 | 18,669 | 53,203 | 178.1 | 2,384 / 584,045 | 1,973 / 583,634 | 18,320 / 764,993 | 17,806 / 734,591 | 18,801 / 766,362 |

`model` does not help work here: every input message still runs the whole `derive`, and `==` on the
state costs a pass over it. Only the note keystroke saves (it skips `derive`, but still diffs the
view).

**Notes.**
- Solid's `(x) => x.id === id` path setter is the documented pattern, but it costs an O(rows) scan
  per keystroke (1,051 calls at 1,000 rows, 10,051 at 10,000, for a note).
- vanilla's `src/lib.js` holds scenario-shaped helpers (the keyed row reconciler and the top-k list
  keeper) that the vanilla framework counts as runtime (296 B); they are generic only in the sense
  that they take callbacks.
- Elm's `mergeItems` is O(upsert x rows) with `List.member`; a `Set` would do.
