// The actions ./rr work performs on unique-components: one step each, on the first widget that
// has a capability (there are no kinds to pick by). The generator is prefix-stable and forces
// these capabilities into the first eight widgets (spec.js FORCED, README "The first widgets"),
// so the same action touches the same widget at every size from 8 up.
//
// An action is { name, scope, step(state) → step }. `step` builds a script step (click, type,
// select, dispatch) from the reference state, which the runner advances with the reference
// `update` between actions. `scope` is "local" (one widget) or "global" (the whole state).
// Actions run in this order; `setup: true` marks one that only prepares the next.

export function actions(spec, ref) {
  // Every control of a widget that is always rendered (not inside a conditional section).
  const always = (w, name) => {
    const c = ref.controls(w).get(name);
    return c && !c.inWhen ? c.node : null;
  };
  // With `--lists none` the generator forces no list, so the list actions and notify are left
  // out (`optional`); every other capability is still forced.
  const noLists = spec.options.lists === "none";
  const find = (what, pred, optional = false) => {
    for (const w of spec.widgets) {
      for (const m of w.messages) {
        const node = always(w, m.name);
        if (node && pred(w, m, node)) return { w, m, node };
      }
    }
    if (optional) return null;
    throw new Error(`unique-components work: no widget with ${what} (the defaults force one into the first 8 widgets)`);
  };
  const isPush = (w, field) => w.messages.some((x) => x.kind === "click" && x.ops.some((op) => op[0] === "push" && op[2] === field));
  const click = (w, name, item) => ({ do: "click", target: ref.target(w.id, name, item), msg: { widget: w.id, type: name, ...(item != null ? { id: item } : {}) } });
  const type = (w, name, value) => ({ do: "type", target: ref.target(w.id, name), value, msg: { widget: w.id, type: name, value } });

  // 1. A button adding k > 0 to an int, with no disabled state.
  const add = find("an add button", (w, m, node) => m.kind === "click" && m.ops.length === 1 && m.ops[0][0] === "add" && m.ops[0][2] > 0 && !node.disabled);
  // 2. A text input (not a list's draft).
  const text = find("a text input", (w, m) => m.kind === "input" && ref.fieldOf(w, m.field).type === "text" && !isPush(w, m.field));
  // 3. A list fed from a draft: the draft input, the push button and the item remove control.
  const push = find("a list push from a draft", (w, m) => m.kind === "click" && m.ops.length === 1 && m.ops[0][0] === "push" &&
    w.messages.some((x) => x.kind === "input" && x.field === m.ops[0][2] && always(w, x.name)) &&
    w.messages.some((x) => x.kind === "item" && x.op === "remove" && x.field === m.ops[0][1] && always(w, x.name)), noLists);
  const listField = push?.m.ops[0][1], draftField = push?.m.ops[0][2];
  const draft = push?.w.messages.find((x) => x.kind === "input" && x.field === draftField);
  const remove = push?.w.messages.find((x) => x.kind === "item" && x.op === "remove" && x.field === listField);
  // 4. A bool toggle: a checkbox or a toggle button (not the gate of a time-driven field, which
  // the tick action needs on).
  const isGate = (w, name) => w.fields.some((f) => f.tickWhen === name);
  const toggle = find("a bool toggle", (w, m) => (m.kind === "check" && !isGate(w, m.field)) ||
    (m.kind === "click" && m.ops.length === 1 && m.ops[0][0] === "toggle" && !isGate(w, m.ops[0][1])));
  // 5. An enum control: a select or a cycle button.
  const choice = find("an enum control", (w, m) => m.kind === "select" || (m.kind === "click" && m.ops.length === 1 && m.ops[0][0] === "cycle"));
  // 6. A number input whose field a later widget reads. Only readers among the first 8 widgets
  // count, so a reader added at a bigger size cannot change the choice.
  const reads = new Set();
  const visit = (e) => { if (Array.isArray(e)) { if (e[0] === "w") reads.add(`${e[1]}/${e[2]}`); e.slice(1).forEach(visit); } };
  const walk = (n) => { (n.parts || []).forEach(visit); (n.text || []).forEach(visit); if (n.cond) visit(n.cond); (n.children || []).forEach(walk); };
  for (const w of spec.widgets.slice(0, 8)) w.view.forEach(walk);
  const number = find("a number input read by another widget", (w, m) => m.kind === "input" && ref.fieldOf(w, m.field).type === "int" && reads.has(`${w.id}/${m.field}`));
  const numberField = ref.fieldOf(number.w, number.m.field);
  // 7. A time-driven field whose gate can be turned on by a control.
  const gate = find("a time-driven field with a gate control", (w, m, node) => {
    const timed = w.fields.find((f) => f.tick);
    if (!timed) return false;
    const g = timed.tickWhen;
    return (m.kind === "check" && m.field === g) || (m.kind === "click" && m.ops.length === 1 && m.ops[0][1] === g &&
      (m.ops[0][0] === "toggle" || (m.ops[0][0] === "set" && m.ops[0][2] === true)));
  });
  // 8. A feed list, for notify.
  const feed = spec.widgets.find((w) => ref.feedField(w));
  if (!feed && !noLists) throw new Error("unique-components work: no feed list (the defaults force one into the first 8 widgets)");

  return [
    { name: "button: add to an int", scope: "local", step: () => click(add.w, add.m.name) },
    { name: "input: type a character", scope: "local", step: (s) => type(text.w, text.m.name, s.widgets[text.w.id][text.m.field] + "k") },
    ...(push ? [
      { name: "list: type in the draft", scope: "local", step: () => type(push.w, draft.name, "Buy milk") },
      { name: "list: push the draft", scope: "local", step: () => click(push.w, push.m.name) },
      { name: "list: remove an item", scope: "local", step: (s) => click(push.w, remove.name, s.widgets[push.w.id][listField][0].id) },
    ] : []),
    { name: "bool: toggle", scope: "local", step: () => click(toggle.w, toggle.m.name) },
    { name: "enum: select or cycle", scope: "local", step: (s) => {
      if (choice.m.kind !== "select") return click(choice.w, choice.m.name);
      const f = ref.fieldOf(choice.w, choice.m.field);
      const value = f.options.find((o) => o !== s.widgets[choice.w.id][f.name]);
      return { do: "select", target: ref.target(choice.w.id, choice.m.name), value, msg: { widget: choice.w.id, type: choice.m.name, value } };
    } },
    { name: "number: type a digit (read by another widget)", scope: "local", step: (s) => {
      const cur = String(s.widgets[number.w.id][numberField.name]);
      let v = cur + "7";
      if (cur === "0" || cur.startsWith("-") || Number(v) > numberField.max) v = cur === "7" ? "8" : "7";
      return { do: "type", target: ref.target(number.w.id, number.m.name), value: v, msg: { widget: number.w.id, type: number.m.name, value: Number(v) } };
    } },
    { name: "gate: start a time-driven field", scope: "local", setup: true, step: () => click(gate.w, gate.m.name) },
    { name: "dispatch: tick (one field running)", scope: "local", step: () => ({ do: "dispatch", msg: { type: "tick" } }) },
    { name: "dispatch: serverSet one widget", scope: "local", step: (s) => ({ do: "dispatch", msg: { type: "serverSet", widget: add.w.id, state: ref.serverState(spec, s, add.w.id, "work") } }) },
    ...(feed ? [{ name: "dispatch: notify one feed", scope: "local", step: (s) => ({ do: "dispatch", msg: ref.notifyMsg(spec, s, feed.id, "work") }) }] : []),
    { name: "dispatch: whole-state snapshot", scope: "global", step: (s) => ({ do: "dispatch", msg: { type: "snapshot", state: ref.snapshot(spec, s, "work") } }) },
  ];
}
