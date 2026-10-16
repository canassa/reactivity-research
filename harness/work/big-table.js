// The actions ./rr work performs on big-table: one step each, on the first four tables, which the
// generator forces to carry the targets (spec.js FORCED, README "The first tables") and keeps the
// same at every size (prefix stability). Untimed setup creates fill t1 to t4 with --rows rows;
// every other table keeps its 3 to 5 initial rows.
//
// Two axes:
//   N     (./rr work big-table <fw> --sizes 16,256): tables are added, rows stay fixed. Every
//         action but the snapshot is local to one table and must stay flat (enforced on
//         prototypes by ./rr check's locality rule, at the quick-check --rows).
//   rows  (./rr work big-table <fw> --sizes 16 --rows 1000, then --rows 10000): the same actions
//         on tables ten times longer; reported, not enforced (README, "Work against rows").
//         --rows passes through like any scenario option.
//
// An action is { name, scope, step(state) → step }. `step` builds a script step (click, dispatch)
// from the reference state, which the runner advances with the reference `update` between
// actions. `scope` is "local" (one table) or "global" (the whole state). Actions run in this
// order; `setup: true` marks one that only prepares the next.

export function actions(spec, ref) {
  if (spec.tables.length < 4) throw new Error("big-table work: needs at least 4 tables (t2 to t4 carry the actions' targets)");
  const [t1, t2, t3, t4] = spec.tables;
  const rows = (s, t) => s.tables[t.id].rows;
  const op = (t, kind, pred = () => true) => {
    const o = t.ops.find((x) => x.kind === kind && pred(x));
    if (!o) throw new Error(`big-table work: ${t.id} has no ${kind} operation (the generator forces one)`);
    return o.name;
  };
  const ctl = (t, kind) => {
    const c = ref.rowControls(t).find((x) => x.kind === kind);
    if (!c) throw new Error(`big-table work: ${t.id} has no ${kind} control (the generator forces one)`);
    return c;
  };
  const click = (t, name, row) => ({ do: "click", target: ref.target(t.id, name, row), msg: { table: t.id, type: name, ...(row != null ? { id: row } : {}) } });
  const dispatch = (msg) => ({ do: "dispatch", msg });
  // The row at index i (or the last row), the same at every N: the rows come from the table's own PRNG.
  const at = (s, t, i) => { const rs = rows(s, t); return rs[Math.min(i, rs.length - 1)].id; };
  const create = (t) => op(t, "create");

  const toggle = ctl(t2, "toggle"), remove2 = ctl(t2, "remove");
  const select3 = ctl(t3, "select"), bump3 = ctl(t3, "bump");
  const select4 = ctl(t4, "select");
  const sortAsc = op(t2, "sort", (o) => o.dir === "asc"), sortDesc = op(t2, "sort", (o) => o.dir === "desc");

  return [
    // js-framework-benchmark's table.
    { name: "setup: t1 create rows", scope: "local", setup: true, step: () => click(t1, "run") },
    { name: "t1: select a row", scope: "local", step: (s) => click(t1, "select", at(s, t1, 4)) },
    { name: "t1: select another row", scope: "local", step: (s) => click(t1, "select", at(s, t1, 7)) },
    { name: "t1: update every 10th row", scope: "local", step: () => click(t1, "update") },
    { name: "t1: swap rows", scope: "local", step: () => click(t1, "swaprows") },
    { name: "t1: remove a row", scope: "local", step: (s) => click(t1, "remove", at(s, t1, 3)) },
    { name: "t1: append rows", scope: "local", step: () => click(t1, "add") },
    { name: "t1: replace all rows", scope: "local", step: () => click(t1, "run") },
    { name: "dispatch: serverRows t1", scope: "local", step: (s) => dispatch(ref.serverRowsMsg(spec, s, t1.id, "work")) },
    { name: "t1: clear", scope: "local", step: () => click(t1, "clear") },
    // t2: flags, sorts, removeChecked.
    { name: "setup: t2 create rows", scope: "local", setup: true, step: () => click(t2, create(t2)) },
    { name: "t2: toggle a flag", scope: "local", step: (s) => click(t2, toggle.role, at(s, t2, 2)) },
    { name: "t2: sort ascending (text)", scope: "local", step: () => click(t2, sortAsc) },
    { name: "t2: sort descending (date)", scope: "local", step: () => click(t2, sortDesc) },
    { name: "t2: remove checked rows", scope: "local", step: () => click(t2, op(t2, "removeChecked")) },
    { name: "t2: remove a row", scope: "local", step: (s) => click(t2, remove2.role, at(s, t2, 1)) },
    { name: "dispatch: serverDelete t2", scope: "local", step: (s) => dispatch(ref.serverDeleteMsg(spec, s, t2.id, "work")) },
    // t3: select, bump, updateEvery on a number a computed cell reads, swap, append.
    { name: "setup: t3 create rows", scope: "local", setup: true, step: () => click(t3, create(t3)) },
    { name: "t3: select a row", scope: "local", step: (s) => click(t3, select3.role, at(s, t3, 4)) },
    { name: "t3: bump a number (a computed cell reads it)", scope: "local", step: (s) => click(t3, bump3.role, at(s, t3, 5)) },
    { name: "t3: update every k-th row (number)", scope: "local", step: () => click(t3, op(t3, "updateEvery")) },
    { name: "t3: swap rows", scope: "local", step: () => click(t3, op(t3, "swap")) },
    { name: "dispatch: serverUpdate t3", scope: "local", step: (s) => dispatch(ref.serverUpdateMsg(spec, s, t3.id, "work")) },
    { name: "t3: append rows", scope: "local", step: () => click(t3, op(t3, "append")) },
    // t4: status cycling, select with another marker, clear.
    { name: "setup: t4 create rows", scope: "local", setup: true, step: () => click(t4, create(t4)) },
    { name: "t4: update every k-th row (status)", scope: "local", step: () => click(t4, op(t4, "updateEvery")) },
    { name: "t4: select a row", scope: "local", step: (s) => click(t4, select4.role, at(s, t4, 3)) },
    { name: "t4: clear", scope: "local", step: () => click(t4, op(t4, "clear")) },
    // The whole state.
    { name: "dispatch: whole-state snapshot", scope: "global", step: (s) => dispatch({ type: "snapshot", state: ref.snapshot(spec, s, "work") }) },
  ];
}
