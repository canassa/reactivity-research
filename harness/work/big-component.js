// The actions ./rr work performs on big-component: one step each, on the first control of the
// big component (w1) that has a capability. The generator is prefix-stable and forces these
// capabilities into the first nine field units (spec.js FORCED, README "The first units"), so
// the same action touches the same field at every size from 9 up, while the component around it
// grows. A strategy that re-runs every binding of the component after an event costs O(N) here;
// one that runs only the bindings reading what changed stays flat.
//
// An action is { name, scope, step(state) → step }. `step` builds a script step (click, type,
// select, dispatch) from the reference state, which the runner advances with the reference
// `update` between actions. `scope` is "local" (a few fields) or "global" (replaces a whole
// state that grows with N: the component's serverSet and the snapshot). Actions run in this
// order; `setup: true` marks one that only prepares the next.

export function actions(spec, ref) {
  const [big, companion] = spec.widgets;
  if (ref.units(big).length < ref.FORCED.length) {
    throw new Error(`big-component work: needs at least ${ref.FORCED.length} field units (the first ${ref.FORCED.length} carry the actions' targets)`);
  }
  // A control of w1 that is always rendered (not inside a conditional section).
  const always = (name) => {
    const c = ref.controls(big).get(name);
    return c && !c.inWhen ? c.node : null;
  };
  const find = (what, pred) => {
    for (const m of big.messages) {
      const node = always(m.name);
      if (node && pred(m, node)) return m;
    }
    throw new Error(`big-component work: no ${what} in w1 (the generator forces one into the first ${ref.FORCED.length} units)`);
  };
  const one = (m, op) => m.kind === "click" && m.ops.length === 1 && m.ops[0][0] === op;
  const isPush = (field) => big.messages.some((x) => x.kind === "click" && x.ops.some((op) => op[0] === "push" && op[2] === field));
  const isGate = (name) => big.fields.some((f) => f.tickWhen === name);
  const click = (name, item) => ({ do: "click", target: ref.target(big.id, name, item), msg: { widget: big.id, type: name, ...(item != null ? { id: item } : {}) } });
  const type = (name, value) => ({ do: "type", target: ref.target(big.id, name), value, msg: { widget: big.id, type: name, value } });

  // What the bindings of the first units read: a field counts as "read by a derived value or a
  // condition" only through nodes that touch nothing but early fields, so a binding added at a
  // bigger size cannot change the choice.
  const early = new Set(ref.units(big).slice(0, ref.FORCED.length).flatMap((u) => u.names));
  const fieldsOf = (e, out = new Set()) => {
    if (Array.isArray(e)) { if (e[0] === "f") out.add(e[1]); else if (e[0] !== "k") e.slice(1).forEach((x) => fieldsOf(x, out)); }
    return out;
  };
  const derivedReads = new Set(), condReads = new Set();
  const walk = (n) => {
    const parts = [...(n.parts || [])].filter((p) => typeof p !== "string");
    const inParts = new Set(parts.flatMap((p) => [...fieldsOf(p)]));
    if (n.el === "text" && inParts.size >= 2 && [...inParts].every((f) => early.has(f))) for (const f of inParts) derivedReads.add(f);
    if (n.el === "when") {
      const c = fieldsOf(n.cond);
      if ([...c].every((f) => early.has(f))) for (const f of c) condReads.add(f);
    }
    (n.children || []).forEach(walk);
  };
  big.view.forEach(walk);

  // 1. A button adding k > 0 to an int, with no disabled state.
  const add = find("add button", (m, node) => one(m, "add") && m.ops[0][2] > 0 && !node.disabled);
  // 2. A text input (not a list's draft).
  const text = find("text input", (m) => m.kind === "input" && ref.fieldOf(big, m.field).type === "text" && !isPush(m.field));
  // 3. A list fed from a draft: the draft input, the push button and the item remove control.
  const push = find("list push from a draft", (m) => one(m, "push") &&
    big.messages.some((x) => x.kind === "input" && x.field === m.ops[0][2] && always(x.name)) &&
    big.messages.some((x) => x.kind === "item" && x.op === "remove" && x.field === m.ops[0][1] && always(x.name)));
  const listField = push.ops[0][1], draftField = push.ops[0][2];
  const draft = big.messages.find((x) => x.kind === "input" && x.field === draftField);
  const remove = big.messages.find((x) => x.kind === "item" && x.op === "remove" && x.field === listField);
  // 4. A bool toggle (checkbox or toggle button) whose field a conditional section reads.
  const toggle = find("bool toggle read by a conditional section", (m) =>
    (m.kind === "check" && !isGate(m.field) && condReads.has(m.field)) || (one(m, "toggle") && !isGate(m.ops[0][1]) && condReads.has(m.ops[0][1])));
  // 5. An enum control: a select or a cycle button.
  const choice = find("enum control", (m) => m.kind === "select" || one(m, "cycle"));
  // 6. A number input whose field a derived value (and the companion) reads.
  const number = find("number input read by a derived value", (m) => m.kind === "input" && ref.fieldOf(big, m.field).type === "int" && derivedReads.has(m.field));
  const numberField = ref.fieldOf(big, number.field);
  // 7. A time-driven field whose gate can be turned on by a control.
  const timed = big.fields.find((f) => f.tick);
  const gate = find("gate control of a time-driven field", (m) =>
    (m.kind === "check" && m.field === timed?.tickWhen) ||
    (m.kind === "click" && m.ops.length === 1 && m.ops[0][1] === timed?.tickWhen && (m.ops[0][0] === "toggle" || (m.ops[0][0] === "set" && m.ops[0][2] === true))));
  // 8. The feed list, for notify.
  if (!ref.feedField(big)) throw new Error("big-component work: no feed list in w1");

  return [
    { name: "button: add to an int", scope: "local", step: () => click(add.name) },
    { name: "input: type a character", scope: "local", step: (s) => type(text.name, s.widgets[big.id][text.field] + "k") },
    { name: "list: type in the draft", scope: "local", step: () => type(draft.name, "Buy milk") },
    { name: "list: push the draft", scope: "local", step: () => click(push.name) },
    { name: "list: remove an item", scope: "local", step: (s) => click(remove.name, s.widgets[big.id][listField][0].id) },
    { name: "bool: toggle (a conditional section reads it)", scope: "local", step: () => click(toggle.name) },
    { name: "enum: select or cycle", scope: "local", step: (s) => {
      if (choice.kind !== "select") return click(choice.name);
      const f = ref.fieldOf(big, choice.field);
      const value = f.options.find((o) => o !== s.widgets[big.id][f.name]);
      return { do: "select", target: ref.target(big.id, choice.name), value, msg: { widget: big.id, type: choice.name, value } };
    } },
    { name: "number: type a digit (a derived value reads it)", scope: "local", step: (s) => {
      const cur = String(s.widgets[big.id][numberField.name]);
      let v = cur + "7";
      if (cur === "0" || cur.startsWith("-") || Number(v) > numberField.max) v = cur === "7" ? "8" : "7";
      return { do: "type", target: ref.target(big.id, number.name), value: v, msg: { widget: big.id, type: number.name, value: Number(v) } };
    } },
    { name: "gate: start a time-driven field", scope: "local", setup: true, step: () => click(gate.name) },
    { name: "dispatch: tick (one field running)", scope: "local", step: () => ({ do: "dispatch", msg: { type: "tick" } }) },
    { name: "dispatch: serverSet the companion", scope: "local", step: (s) => ({ do: "dispatch", msg: { type: "serverSet", widget: companion.id, state: ref.serverState(spec, s, companion.id, "work") } }) },
    { name: "dispatch: notify the feed", scope: "local", step: (s) => ({ do: "dispatch", msg: ref.notifyMsg(spec, s, big.id, "work") }) },
    { name: "dispatch: whole-state snapshot", scope: "global", step: (s) => ({ do: "dispatch", msg: { type: "snapshot", state: ref.snapshot(spec, s, "work") } }) },
    { name: "dispatch: serverSet the whole component", scope: "global", step: (s) => ({ do: "dispatch", msg: { type: "serverSet", widget: big.id, state: ref.serverState(spec, s, big.id, "work") } }) },
  ];
}
