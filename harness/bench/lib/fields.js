// Bench actions for the scenarios whose widgets are generated from fields and messages
// (unique-components, big-component): ./rr work's actions, on the same targets, made repeatable.
// See harness/bench/shared-components.js for what a bench action is.
//
// Every work step names its widget and message (step.msg.widget, step.msg.type), so the undo of
// each is built from the work step itself, with the scenario's own target():
//   add to an int     timed: the click; untimed reset (serverSet the widget with the field put
//                     back) before the next click would hit the field's max, where it stops changing
//   type a character  then delete it (one Backspace)        number: type a digit, then delete it
//   list              type in the draft, push it, remove the pushed item (the last; ./rr work
//                     removes the first, but removing the new item is what returns the state)
//   bool              toggle, toggle back                   enum: select the neighbouring option and
//                     back, or a cycle button clicked once per rep (it wraps, so it never stops)
//   tick              gate switched on once (untimed); then ticks, with the untimed reset of an add
//   serverSet         two server states A and B, alternated  snapshot: the same, for the whole state
//   notify            notify, then dismiss the new entry (or, with no dismiss button rendered, an
//                     untimed reset of the list)

import { serverPair, snapshotPair, restoreField, adjacentOption } from "./pairs.js";

export function fieldBenchActions(spec, ref, list, scenario) {
  // The list and notify actions are absent from a spec generated with `--lists none`.
  const find = (prefix, optional = false) => {
    const a = list.find((x) => x.name.startsWith(prefix));
    if (!a && !optional) throw new Error(`${scenario} bench: no work action starting "${prefix}"`);
    return a ?? null;
  };
  const widget = (id) => ref.byId(spec, id);
  const message = (step) => ref.messageOf(widget(step.msg.widget), step.msg.type);
  const type = (id, name, value) => ({ do: "type", target: ref.target(id, name), value, msg: { widget: id, type: name, value } });
  const click = (id, name, item) => ({ do: "click", target: ref.target(id, name, item), msg: { widget: id, type: name, ...(item != null ? { id: item } : {}) } });
  const shown = (w, name) => {
    const c = ref.controls(w).get(name);
    return c && !c.inWhen;
  };

  const add = find("button: add to an int"), text = find("input: type a character");
  const draft = find("list: type in the draft", true), push = find("list: push the draft", true), remove = find("list: remove an item", true);
  const bool = find("bool: toggle"), choice = find("enum: select or cycle"), number = find("number: type a digit");
  const gate = find("gate: start a time-driven field"), tick = find("dispatch: tick");
  const server = list.find((a) => a.name.startsWith("dispatch: serverSet") && a.scope === "local");
  const notify = find("dispatch: notify", true), snapshot = find("dispatch: whole-state snapshot");
  const serverAll = list.find((a) => a.name.startsWith("dispatch: serverSet") && a.scope === "global");

  // The untimed reset for a field that only grows (an add button, a tick): put it back before
  // the next step would pass its max.
  const growing = (id, field, by) => (s, s0) => {
    const f = ref.fieldOf(widget(id), field);
    return s.widgets[id][field] + by > f.max ? restoreField(s, s0, id, field) : null;
  };

  const out = [
    { name: add.name, scope: "local", halves: () => [{ name: add.name, step: add.step }],
      reset: (s, s0) => {
        const st = add.step(s0), [, field, k] = message(st).ops[0];
        return growing(st.msg.widget, field, k)(s, s0);
      } },
    { name: text.name, scope: "local", halves: (s0) => {
      const st = text.step(s0), m = message(st), was = s0.widgets[st.msg.widget][m.field];
      return [{ name: text.name, step: text.step }, { name: "input: delete it", step: () => type(st.msg.widget, st.msg.type, was) }];
    } },
    ...(push ? [{ name: "list: type, push, remove", scope: "local", halves: (s0) => {
      const p = push.step(s0), field = message(p).ops[0][1], name = remove.step(s0).msg.type;
      return [
        { name: draft.name, step: draft.step },
        { name: push.name, step: push.step },
        { name: "list: remove the pushed item", step: (s) => click(p.msg.widget, name, s.widgets[p.msg.widget][field].at(-1).id) },
      ];
    } }] : []),
    { name: bool.name, scope: "local", halves: () => [{ name: bool.name, step: bool.step }, { name: "bool: toggle back", step: bool.step }] },
    { name: choice.name, scope: "local", halves: (s0) => {
      const st = choice.step(s0);
      if (st.do !== "select") return [{ name: "enum: cycle", step: choice.step }];
      const m = message(st), f = ref.fieldOf(widget(st.msg.widget), m.field), was = s0.widgets[st.msg.widget][m.field];
      const to = adjacentOption(f.options, was);
      const select = (value) => () => ({ do: "select", target: st.target, value, msg: { widget: st.msg.widget, type: st.msg.type, value } });
      return [{ name: "enum: select", step: select(to) }, { name: "enum: select back", step: select(was) }];
    } },
    { name: number.name, scope: "local", halves: (s0) => {
      const st = number.step(s0), m = message(st), was = s0.widgets[st.msg.widget][m.field];
      const back = () => ({ ...type(st.msg.widget, st.msg.type, String(was)), msg: { widget: st.msg.widget, type: st.msg.type, value: was } });
      return [{ name: number.name, step: number.step }, { name: "number: delete it", step: back }];
    } },
    { name: tick.name, scope: "local", setup: (s0) => [gate.step(s0)],
      halves: () => [{ name: tick.name, step: tick.step }],
      reset: (s, s0) => {
        const g = gate.step(s0), w = widget(g.msg.widget);
        const gateField = message(g).field ?? message(g).ops[0][1];
        const f = w.fields.find((x) => x.tick && x.tickWhen === gateField);
        return growing(w.id, f.name, f.tick)(s, s0);
      } },
  ];
  if (server) out.push({ name: server.name, scope: "local", halves: (s0) => serverPair(spec, ref, s0, server.step(s0).msg.widget, server.name) });
  if (notify) out.push({ name: "notify, dismiss", scope: "local", halves: (s0) => {
    const st = notify.step(s0), w = widget(st.msg.widget), field = st.msg.field;
    const dismiss = w.messages.find((m) => m.kind === "item" && m.op === "remove" && m.field === field && shown(w, m.name));
    const halves = [{ name: notify.name, step: notify.step }];
    if (dismiss) halves.push({ name: "feed: dismiss the new entry", step: (s) => click(w.id, dismiss.name, s.widgets[w.id][field].at(-1).id) });
    return halves;
  }, reset: (s, s0) => {
    const st = notify.step(s0), w = widget(st.msg.widget);
    const dismissable = w.messages.some((m) => m.kind === "item" && m.op === "remove" && m.field === st.msg.field && shown(w, m.name));
    return dismissable ? null : restoreField(s, s0, w.id, st.msg.field);
  } });
  // Global actions last: they leave the whole state (or the whole component) replaced.
  if (serverAll) out.push({ name: serverAll.name, scope: "global", halves: (s0) => serverPair(spec, ref, s0, serverAll.step(s0).msg.widget, serverAll.name) });
  out.push({ name: snapshot.name, scope: "global", halves: (s0) => snapshotPair(spec, ref, s0) });
  return out;
}
