# 2026-10-17: Marko same-task fixes

`./rr check` same-task failures in Marko, fixed in the emitters (correctness only).

- **shared-components:** the todo and feed items were found by loop index (`toSpliced(i, …)`); now by
  id (`map`/`filter`). A control on a removed item is a no-op.
- **big-table:** the select link sets `selected` only if the row is still there.
- **routed-app:** a page's click that touches a global runs through the root's `edit(page, change)`
  (current `<let>`s, dropped when `nav.route` is not that page); the `Change` handlers of bound
  globals check the same. Found on the way: `spend5` twice read the page's controllable copy
  twice (one -5, not two), a failure that predates this work (n=1 seed 3).
- **adapter (all Marko apps):** `dispatch` calls `run()` from `marko/dom` after the write, so a click
  in the same task sees the DOM and state after the event (snapshot, then toggle failed at n=1
  seed 3 in shared-components). Adapter bytes are not counted; `run` is already in the bundle.
- What a handler reads: plain `<let>` current, controllable `<let>` stale until the parent renders
  (see `frameworks/marko/README.md`, "Same-task events").
- Checked: `./rr check` of all six scenarios, sizes 1, 4, 16, 64 x seeds 1-3, passes.

Size (brotli total, seed 1, N=16 / 64, change from the 2026-10-17 results; big-table from a rebuild
of the old emitter, JS only): shared-components +234 / +214, big-table +44 / +113,
routed-app +1544 / +4881 (the `edit` wrappers in every global-writing handler; the page-level
guard itself is small). Builds are byte-identical on rebuild. Not analysed further.
