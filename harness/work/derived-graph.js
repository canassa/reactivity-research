// The actions ./rr work performs on derived-graph: one step each, on the first eleven units, which
// the generator forces to carry the targets (spec.js FORCED, README "The first units") and keeps
// the same at every size (prefix stability). An untimed setup Load fills the items with --rows.
//
// What counts as local (README, "Locality"): an action whose downstream closure (the formulas and
// displays that depend on what it changes) is the same at every N. The forced chain, cut-off,
// filter, toggle and threshold inputs are closed (nothing outside the forced units reads them or
// what they feed), the markup is read only by the rows, and a note by nothing, so those actions
// are local and must stay flat as units are added. The hub input and every edit of the items are
// global by nature: the hub's readers, and the aggregates over the items, grow with N.
//
// Two axes:
//   N     (./rr work derived-graph <fw> --sizes 16,256): units are added, rows stay fixed.
//   rows  (./rr work derived-graph <fw> --sizes 64 --rows 1000, then --rows 10000): the same
//         actions on ten times more items; reported, not enforced (README, "Work against rows").
//
// An action is { name, scope, step(state) → step }. `step` builds a script step (click, type,
// select, dispatch) from the reference state, which the runner advances with the reference
// `update` between actions. Actions run in this order; `setup: true` marks one that only prepares
// the next.

export function actions(spec, ref) {
  const f = spec.forced;
  if (spec.units.length < ref.FORCED.length) {
    throw new Error(`derived-graph work: needs at least ${ref.FORCED.length} units (the first ${ref.FORCED.length} carry the actions' targets)`);
  }
  const msgFor = (cell, kind) => {
    const m = spec.units.flatMap((u) => u.messages).find((x) => x.cell === cell && x.kind === kind);
    if (!m) throw new Error(`derived-graph work: no ${kind} control for ${cell} (the generator forces one)`);
    return m.name;
  };
  const sheetClick = (name) => ({ do: "click", target: ref.target("sheet", name), msg: { type: name } });
  const sheetType = (name, value) => ({ do: "type", target: ref.target("sheet", name), value: String(value), msg: { type: name, value } });
  const itemAt = (s, k) => s.items[Math.min(k, s.items.length - 1)];
  const cell = (name) => ref.cellOf(spec, name);

  // A new value for a number input: `pref` away from the current one, or back the other way.
  const moved = (c, v, by) => (v + by <= c.max ? v + by : v - by);
  // The cut-off input: a value on the same side of its constant (the bool keeps its value), or
  // the other side (the bool flips).
  const sameSide = (s) => {
    const c = cell(f.cutoffInput), v = s.inputs[c.name], k = f.cutoffAt;
    const up = v + 1 <= c.max && (v + 1 >= k) === (v >= k);
    return up ? v + 1 : v - 1;
  };
  const otherSide = (s) => (s.inputs[f.cutoffInput] >= f.cutoffAt ? f.cutoffAt - 1 : f.cutoffAt);

  return [
    { name: "setup: load the items", scope: "local", setup: true, step: () => ({ do: "click", target: ref.target("items", "load"), msg: { type: "load" } }) },
    // Local: closures fixed at every N.
    { name: "chain input: type a number (3 closed formulas downstream)", scope: "local",
      step: (s) => sheetType(msgFor(f.chainInput, "input"), moved(cell(f.chainInput), s.inputs[f.chainInput], 7)) },
    { name: "cut-off input: type a number that leaves its bool unchanged", scope: "local",
      step: (s) => sheetType(msgFor(f.cutoffInput, "input"), sameSide(s)) },
    { name: "cut-off input: type a number that flips its bool", scope: "local",
      step: (s) => sheetType(msgFor(f.cutoffInput, "input"), otherSide(s)) },
    { name: "cut-off input: flip the bool back", scope: "local",
      step: (s) => sheetType(msgFor(f.cutoffInput, "input"), otherSide(s)) },
    { name: "filter select: pick another category (re-filters the items)", scope: "local", step: (s) => {
      const c = cell(f.filterInput), i = c.options.indexOf(s.inputs[c.name]);
      const value = c.options[i + 1 < c.options.length ? i + 1 : i - 1];
      return { do: "select", target: ref.target("sheet", msgFor(c.name, "select")), value, msg: { type: msgFor(c.name, "select"), value } };
    } },
    { name: "toggle: flip a bool (one formula over the filtered items)", scope: "local", step: () => sheetClick(msgFor(f.toggleInput, "check")) },
    { name: "threshold: type a number (re-filters and sorts the items for a top 5)", scope: "local", step: (s) => {
      const v = s.inputs[f.thresholdInput];
      return sheetType(msgFor(f.thresholdInput, "input"), v > 50 ? v - 20 : v + 20);
    } },
    { name: "markup: type a number (every row's markup cell)", scope: "local", step: (s) => {
      const v = moved(spec.markup, s.markup, 7);
      return { do: "type", target: ref.target("items", "markup"), value: String(v), msg: { type: "markup", value: v } };
    } },
    { name: "item: type a note character (nothing reads it)", scope: "local", step: (s) => {
      const it = itemAt(s, 3), value = it.note + "x";
      return { do: "type", target: ref.target("items", "note", it.id), value, msg: { type: "note", id: it.id, value } };
    } },
    { name: "dispatch: serverInputs of the closed inputs", scope: "local",
      step: (s) => ({ do: "dispatch", msg: ref.serverInputsMsg(spec, s, "work", [f.chainInput, f.cutoffInput, f.thresholdInput]) }) },
    // Global by nature: what reads the hub, and the aggregates over the items, grow with N.
    { name: "hub input: raise (the hub and tax read by many)", scope: "global", step: () => sheetClick(msgFor(f.hubInput, "add")) },
    { name: "item: type a quantity (every aggregate over qty)", scope: "global", step: (s) => {
      const it = itemAt(s, 4), v = it.qty < 999 ? it.qty + 1 : it.qty - 1;
      return { do: "type", target: ref.target("items", "qty", it.id), value: String(v), msg: { type: "qty", id: it.id, value: v } };
    } },
    { name: "item: toggle active", scope: "global", step: (s) => {
      const it = itemAt(s, 5);
      return { do: "click", target: ref.target("items", "active", it.id), msg: { type: "active", id: it.id } };
    } },
    { name: "item: add one", scope: "global", step: () => ({ do: "click", target: ref.target("items", "addItem"), msg: { type: "addItem" } }) },
    { name: "item: remove one", scope: "global", step: (s) => {
      const it = itemAt(s, 6);
      return { do: "click", target: ref.target("items", "remove", it.id), msg: { type: "remove", id: it.id } };
    } },
    { name: "dispatch: serverItems (one price)", scope: "global",
      step: (s) => ({ do: "dispatch", msg: ref.serverItemsMsg(spec, s, "work", { change: 1, add: 0, remove: 0, field: "price" }) }) },
    { name: "dispatch: whole-state snapshot", scope: "global", step: (s) => ({ do: "dispatch", msg: { type: "snapshot", state: ref.snapshot(spec, s, "work") } }) },
  ];
}
