# 2026-10-17: tea-inline on derived-graph

**Done.** `scenarios/derived-graph/tea-inline.js`, `frameworks/tea-inline/template/graph.js`
(runtime: node, queue, paint, same, reset, part) and `sheet.js` (app: formatters, collection
helpers, `typed`, PRNG), `runs.json` entry (sizes 1-256, seeds 1-3, fanout low/mid/high). The other
four tea-inline scenarios build byte-identical (sha256 of dist at n16-s1 before and after).

**Derived values.** Static edges and memoization with a runtime rank-ordered flush: one node per
formula, run once per flush in rank order (a sorted queue; ranks are assigned when the module runs,
in creation order, which is topological), equality cut-off, reader lists written
into the writer's code (no mount-time registration). Displays reading one cell are inlined in that
cell's code, displays reading several are functions that run after all formulas. The unchanged
cut-off works: an unchanged value runs no reader (cut-off input unchanged: 10 calls; flip: 21).
Lists and groups compare their items; top-k always repaints its keyed list.

**Checks.** `./rr check` passes at sizes 1, 4, 16, 64 (seeds 1-3), 256 (seeds 1-3, no locality),
fanout low/high at 16; locality flat (ratio 1.00 for every local action, N=16 -> 256).

**Size** (brotli total, median of seeds 1-3; fit over N >= 16):

| fanout | N=64 | N=256 | baseline | slope |
|---|---|---|---|---|
| low | 8,472 | 22,267 | 3,572 B | 73.9 B/unit |
| mid | 10,079 | 29,317 | 3,472 B | 101.3 B/unit |
| high | 12,646 | 40,008 | 3,325 B | 143.3 B/unit |

So each extra display read edge costs about 7-9 B brotli (low->mid: 3 extra reads per unit, +27 B;
mid->high: 6, +42 B). That includes the display's own label and tag, which are unique per display
by design, so it is an upper bound for the edge itself. The critique's prediction (bytes grow with
edges) holds; the static reader lists do not make it flat. Without a Solid emitter on this
scenario the comparison is not yet possible.

**Work** (calls, 2,000 rows, N=16 -> 256): chain 44 -> 44, cut-off 10/21/446 flat, filter 2,417,
toggle 14, threshold 14,190, markup 14,004, note 7 (all x1.00); hub 2,157 -> 56,177, quantity
32,395 -> 257,015, active 4,061 -> 190,166, snapshot 67,450 -> 401,501 (global). Rows (N=64, 1,000
-> 10,000): chain, cut-off unchanged/flip, toggle, note flat; filter 1,221 -> 12,048; threshold
6,503 -> 83,414; markup 7,004 -> 70,004; hub 9,011 -> 86,205 (aggregates re-sum); quantity
32,191 -> 350,957.

**Learned / dead end.** Hoisting a cell's formatted text into one `const t` when two or more
inline displays show it is a common-subexpression gain in work (a hub formatted once, not 8 times)
and neutral in bytes (+50 B at N=256). Aggregates are not incremental: item edits are the costly
actions, as the README says.

## Review round (same day)

- **Number input, same value.** The control is now written before the setter's equality return.
  Tested in headless Chrome: invalid text typed, then `serverInputs` with the current value, shows
  the value again (it kept "999" before); a step clamped at the max after typed "1.5" shows 40.
- **Flush wedge.** `drain` resets the queue, the flags and `armed` in a `finally`, so a throw in a
  node or display no longer leaves the graph dead.
- **Hidden O(rows) scan.** The handlers' `find` over the items was invisible to the call counter,
  so "note: 7 calls" was wrong for rows. Now an id to item Map (built at the first edit after the
  set of items changes) serves the handlers, which is what an expert would emit rather than a scan
  per keystroke. The honest numbers: the first note edit after a Load costs 2,003 calls at 2,000
  rows (the index build), later ones O(1); remove is O(rows) (`indexOf`, `splice`); every other
  item edit queues aggregates that re-read the items. A qty write of the same value is skipped.
- **Wording:** "compile-time scheduling" became static edges + memoization + runtime rank-ordered
  flush. The emitter now throws if a formula reads an item's note.
- **Work after the fix** (N=16 -> 256, 2,000 rows): chain 45, cut-off 11/22/447, toggle 15, note
  2,003 (first edit), all x1.00; hub 2,158 -> 56,178; quantity 32,391 -> 257,011. Rows (N=64,
  1,000 -> 10,000): chain, cut-off, toggle flat; note 1,003 -> 10,003; hub 9,012 -> 86,206.
- **Size after the fixes** (median seeds 1-3; fit N >= 16): low N=64 8,527 / N=256 22,307, 3,614 B +
  73.7 B/unit; mid 10,115 / 29,279, 3,498 B + 101.3; high 12,657 / 39,995, 3,334 B + 143.5. Within
  0.4% of before (the runtime grew by about 15 B for the `finally`).
- **Checks:** 14 derived-graph checks (sizes 1, 4, 16, 64 x seeds 1-3, fanout low/high at 16) and
  the four other tea-inline scenarios pass with locality; their builds are byte-identical.
