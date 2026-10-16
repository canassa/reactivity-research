// Do/undo pairs that several scenarios' bench actions share.

// Two server states A and B for one widget, worked out once from the state the action starts
// in (B from A, so the two differ): the reps alternate A, B, A, B.
export function serverPair(spec, ref, s0, id, name) {
  const msg = (s, salt) => ({ type: "serverSet", widget: id, state: ref.serverState(spec, s, id, salt) });
  const a = msg(s0, "bench-a");
  const b = msg(ref.update(spec, s0, a), "bench-b");
  return [{ name, step: () => ({ do: "dispatch", msg: a }) }, { name: `${name} (again)`, step: () => ({ do: "dispatch", msg: b }) }];
}

// The same for the whole state: snapshots A and B.
export function snapshotPair(spec, ref, s0, name = "dispatch: whole-state snapshot") {
  const a = { type: "snapshot", state: ref.snapshot(spec, s0, "bench-a") };
  const b = { type: "snapshot", state: ref.snapshot(spec, a.state, "bench-b") };
  return [{ name, step: () => ({ do: "dispatch", msg: a }) }, { name: `${name} (again)`, step: () => ({ do: "dispatch", msg: b }) }];
}

// A widget's state with one field put back to its value in s0, sent as a serverSet: the untimed
// reset of an action with no natural undo (an add button, a tick), before the field reaches the
// maximum the reference clamps it to.
export function restoreField(s, s0, id, field) {
  return { do: "dispatch", msg: { type: "serverSet", widget: id, state: { ...s.widgets[id], [field]: s0.widgets[id][field] } } };
}

// The neighbour of the current option of an enum field, so a select step is one key press
// (ArrowDown or ArrowUp) on the focused <select>.
export function adjacentOption(options, current) {
  const i = options.indexOf(current);
  return options[i + 1 < options.length ? i + 1 : i - 1];
}
