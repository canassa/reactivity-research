// The events ./rr bench times on big-table: js-framework-benchmark's nine CPU benchmarks on table
// 1 (their app), as do/undo pairs (README, "CPU (./rr bench)"), plus the contract's own events.
// The bench runs at N = 1 with the default --rows (1,000), so the figures can be set against the
// official standing; at other sizes the same actions run on t1 with the other tables idle.
//
// See harness/bench/shared-components.js for what a bench action is. Every action brings t1 to
// the state it needs with untimed setup steps (a `run`, a `runlots` or a `clear`), so the actions
// do not depend on each other's end state. The untimed resets put the setup rows back with a
// serverRows of exactly those rows (keyed, so an implementation only patches what differs).

import { snapshotPair } from "./lib/pairs.js";

export function benchActions(spec, ref) {
  const t1 = spec.tables[0];
  const R = spec.options.rows;
  const rows = (s) => s.tables.t1.rows;
  const click = (name, row) => () => ({ do: "click", target: ref.target("t1", name, row), msg: { table: "t1", type: name, ...(row != null ? { id: row } : {}) } });
  const clickRow = (name, i) => (s) => click(name, rows(s)[i].id)();
  const restore = (s0) => ({ do: "dispatch", msg: { type: "serverRows", table: "t1", rows: rows(s0) } });
  // Untimed setup: t1 with exactly `count` rows built by its own create (`run` or `runlots`), or empty.
  const filled = (name) => () => [click(name)()];
  const empty = (s) => (rows(s).length || s.tables.t1.selected != null ? [click("clear")()] : []);

  return [
    { name: "01 create rows", scope: "local", setup: empty,
      halves: () => [{ name: `create ${R} rows`, step: click("run") }, { name: `clear ${R} rows`, step: click("clear") }] },
    { name: "02 replace all rows", scope: "local", setup: filled("run"),
      halves: () => [{ name: `replace ${R} rows`, step: click("run") }] },
    { name: "03 partial update", scope: "local", setup: filled("runlots"),
      halves: () => [{ name: `update every 10th row of ${10 * R}`, step: click("update") }],
      // Every 8 reps, the setup labels come back (each rep appends " !!!" to every 10th label).
      reset: (s, s0) => (rows(s)[0].label.length - rows(s0)[0].label.length >= 8 * t1.ops.find((o) => o.name === "update").suffix.length ? restore(s0) : null) },
    { name: "04 select row", scope: "local", setup: filled("run"),
      halves: () => [{ name: "select row 2", step: clickRow("select", 1) }, { name: "select row 3", step: clickRow("select", 2) }] },
    { name: "05 swap rows", scope: "local", setup: filled("run"),
      halves: () => [{ name: "swap rows", step: click("swaprows") }, { name: "swap rows back", step: click("swaprows") }] },
    { name: "06 remove row", scope: "local", setup: filled("run"),
      halves: () => [{ name: "remove the 4th row", step: clickRow("remove", 3) }],
      // Keep the table within 5% of its setup size.
      reset: (s, s0) => (rows(s).length < 0.95 * rows(s0).length ? restore(s0) : null) },
    { name: "07 create many rows", scope: "local", setup: empty,
      halves: () => [{ name: `create ${10 * R} rows`, step: click("runlots") }, { name: `09 clear ${10 * R} rows`, step: click("clear") }] },
    { name: "08 append to a large table", scope: "local", setup: filled("runlots"),
      halves: () => [{ name: `append ${R} rows to ${10 * R}`, step: click("add") }],
      reset: (s, s0) => restore(s0) },
    { name: "dispatch: serverUpdate of 10 rows", scope: "local", setup: filled("run"), halves: (s0) => {
      // A changes 10 rows (plus an id that does not exist); B puts their values back.
      const a = ref.serverUpdateMsg(spec, s0, "t1", "bench", 10);
      const was = new Map(rows(s0).map((r) => [r.id, r[a.column]]));
      const b = { ...a, changes: a.changes.map((c) => ({ id: c.id, value: was.has(c.id) ? was.get(c.id) : c.value })) };
      return [{ name: "serverUpdate of 10 rows", step: () => ({ do: "dispatch", msg: a }) },
        { name: "serverUpdate of 10 rows back", step: () => ({ do: "dispatch", msg: b }) }];
    } },
    { name: "dispatch: whole-state snapshot", scope: "global", setup: filled("run"), halves: (s0) => snapshotPair(spec, ref, s0) },
  ];
}
