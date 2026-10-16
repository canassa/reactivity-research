# 2026-10-16: digest on big-table

Wrote `scenarios/big-table/digest.js` and `frameworks/digest/runtime-table.js`.

## What was done

- **Emitter and runtime.** One function per table (state object, pools, row builder, template,
  toolbar handlers, row template, row bindings, row handlers), a list per table with one binding
  (the rows' reconciler) and a list per row. Row controls digest only their row (select also the
  previously selected row); the reconciler digests a row only if it is new or replaced; handlers
  that edit some rows in place digest those rows. `receive` is generic.
- **Checks.** `./rr check big-table digest` passes at sizes 1, 4, 16, 64, seeds 1-3, locality
  1.00× (N=16 to 256, and 64 to 1024). The other digest scenarios check as before
  (big-component's locality failure is the recorded dead end). Builds are byte-identical.
- **Sizes** (`./rr measure`, not committed): N=1 1,896 B, N=16 5,569, N=256 35,979; fit N >= 4
  3,492 + 128.6 B per table.
- **Work.** Flat in N for all 24 local actions. Rows axis: select, toggle, bump and a small
  `serverUpdate` are O(1); remove, serverDelete, removeChecked, update every k-th, sort, create,
  append and serverRows are O(rows) in calls; swap and remove are also O(rows) in time through the
  reconciler's walk even though swap is 6 calls.

## Review follow-up

- **rowDigest option.** `runtime-table.js` digests a row only when it is new or replaced and
  relies on by-hand row digests (`every`, `serverUpdate`, `sel`'s previous row, a dynamic
  dependency edge). The emitter now has `rowDigest: changed | all`; `all` runs every row's list
  as the other digest runtimes do. Both pass the checks (sizes 1-64, seeds 1-3, locality 1.00x).
  `all` is 33 B smaller at N=1 and 720 B at N=256, but every row control costs O(rows) calls
  (select 7,005 at 1k rows, 70,005 at 10k); `changed` stays at 11-26. Both are in `runs.json`.
- **Counter shaping in unique-components.** `rm` (splice, "one call") is gone; removal is a
  `filter`, +4 calls per remove (57 to 61), sizes within +65 B at N=256 and -10 B at N=1.
- **Smaller fixes.** `serverRows` uses `reduce` for `nextId` (no spread of every id); `dispose`
  resets `X`; the emitter collects its imports in a used-set instead of a regexp over its text;
  the README lists the scenario-specific helpers in `runtime-table.js`.
- **/tmp filled up** (other jobs' leaked chrome profiles) and the shell lost its output, so the
  runs used `TMPDIR` under the home directory and results were read from files.

## What was learned

- **Call counts can hide work.** The first version removed rows with `indexOf` and `splice` and
  looked flat (13 calls at any row count); the reviewer's rule is to write scans naturally, so it
  now uses `filter` (501-1,012 calls at 1,000 rows) and the README reports which actions are
  O(rows). The reconciler's per-row walk is not a call either, so its cost was timed by hand.
- **Table independence makes locality free.** With no state shared between tables there is no
  `dep` wiring at all; the per-row list is what keeps select and toggle from touching every row.
- **A swap needs a smarter cursor.** The reconciler's usual "insert before the cursor" moves
  about n nodes for a swap of rows 1 and n-2; leaving a node whose next sibling is the row's
  where it is makes it two moves.
- **The glyph inside a link:** a real click on the remove `×` has the `<span>` as its target, so
  the delegated handler uses `closest("a,button,input")`.
