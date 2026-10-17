# 2026-10-17: Solid 1 passes the check's rewrite step (shared, unique, big-component)

**Done.** The three Solid 1 dashboard emitters re-assert number inputs after a same-value
external write, the way derived-graph does: the store holds an `epoch` signal
(`createSignal(undefined, { equals: false })`), bumped by `serverSet` and `snapshot`; the number
input binds `value={(epoch(), s.field)}`. unique-components and big-component also bump after a
click handler (a step clamped at a limit), and the widget gets `epoch`/`bump` from `useWidget`
only when it has a number input. The signal exists only when the app has one (shared-components:
the amount widget). `frameworks/solid/` is unchanged.

**Checked.** `./rr check <scenario> solid` passes at N = 1, 4, 16, 64 x seeds 1-3 for all three,
same-task pass included; the build is byte-identical on rebuild.

**Size (brotli total, seed 1, N=16 / 64):** shared +26 / +15 B, unique +120 / +180 B,
big-component +78 / +89 B. unique and big grow because every int widget gets a bump in each click handler.
