// The events ./rr bench times on derived-graph: ./rr work's actions (harness/work/
// derived-graph.js), on the same forced inputs and items, made repeatable as do/undo pairs.
// See harness/bench/shared-components.js for what a bench action is.
//
//   number inputs   type the work action's value, then the old value back
//   cut-off         a value that leaves the bool alone and back; a value that flips it and back
//   filter select   the neighbouring category and back
//   toggle, active  flip, flip back
//   hub input       raise, lower (one step each way)
//   note            type a character, then delete it (one Backspace)
//   add / remove    add an item, then remove that new item
//   serverInputs    the closed inputs' new values (A), then their old ones (B)
//   serverItems     one item's new price (A), then its old price (B)
//   snapshot        snapshots A and B
//
// Every action's untimed setup loads the items (--rows of them, 2,000 by default) when the
// count is not --rows, so the actions see the same table whatever ran before.

import { actions as workActions } from "../work/derived-graph.js";
import { snapshotPair } from "./lib/pairs.js";

export function benchActions(spec, ref) {
  const work = new Map(workActions(spec, ref).map((a) => [a.name, a]));
  const w = (prefix) => {
    const a = [...work.values()].find((x) => x.name.startsWith(prefix));
    if (!a) throw new Error(`derived-graph bench: no work action starting "${prefix}"`);
    return a;
  };
  const f = spec.forced;
  const load = w("setup: load the items");
  const loaded = (s) => (s.items.length === spec.options.rows ? [] : [load.step(s)]);
  const msgFor = (cell, kind) => spec.units.flatMap((u) => u.messages).find((x) => x.cell === cell && x.kind === kind).name;

  // A typed number and back: the work action's step, then the value it started from.
  const typedBack = (prefix, back) => {
    const a = w(prefix);
    return { name: a.name, scope: a.scope, setup: loaded, halves: (s0) => [{ name: a.name, step: a.step }, { name: `${a.name} (back)`, step: () => back(s0) }] };
  };
  const sheetType = (name, value) => ({ do: "type", target: ref.target("sheet", name), value: String(value), msg: { type: name, value } });
  const twice = (prefix) => {
    const a = w(prefix);
    return { name: a.name, scope: a.scope, setup: loaded, halves: () => [{ name: a.name, step: a.step }, { name: `${a.name} (back)`, step: a.step }] };
  };

  const chain = w("chain input"), same = w("cut-off input: type a number that leaves"), flip = w("cut-off input: type a number that flips");
  const select = w("filter select"), threshold = w("threshold"), markup = w("markup"), note = w("item: type a note");
  const hub = w("hub input"), qty = w("item: type a quantity"), add = w("item: add one");
  const inputsBack = (s0, msg) => ({ do: "dispatch", msg: { type: "serverInputs", values: Object.fromEntries(Object.keys(msg.values).map((k) => [k, s0.inputs[k]])) } });

  return [
    typedBack(chain.name, (s0) => sheetType(msgFor(f.chainInput, "input"), s0.inputs[f.chainInput])),
    typedBack(same.name, (s0) => sheetType(msgFor(f.cutoffInput, "input"), s0.inputs[f.cutoffInput])),
    typedBack(flip.name, (s0) => sheetType(msgFor(f.cutoffInput, "input"), s0.inputs[f.cutoffInput])),
    { name: select.name, scope: select.scope, setup: loaded, halves: (s0) => {
      const m = msgFor(f.filterInput, "select"), was = s0.inputs[f.filterInput];
      return [{ name: select.name, step: select.step },
        { name: `${select.name} (back)`, step: () => ({ do: "select", target: ref.target("sheet", m), value: was, msg: { type: m, value: was } }) }];
    } },
    twice("toggle"),
    typedBack(threshold.name, (s0) => sheetType(msgFor(f.thresholdInput, "input"), s0.inputs[f.thresholdInput])),
    typedBack(markup.name, (s0) => ({ do: "type", target: ref.target("items", "markup"), value: String(s0.markup), msg: { type: "markup", value: s0.markup } })),
    { name: note.name, scope: note.scope, setup: loaded, halves: (s0) => {
      const it = s0.items[Math.min(3, s0.items.length - 1)];
      return [{ name: note.name, step: note.step },
        { name: "item: delete the note character", step: () => ({ do: "type", target: ref.target("items", "note", it.id), value: it.note, msg: { type: "note", id: it.id, value: it.note } }) }];
    } },
    { name: "dispatch: serverInputs of the closed inputs", scope: "local", setup: loaded, halves: (s0) => {
      const a = ref.serverInputsMsg(spec, s0, "bench", [f.chainInput, f.cutoffInput, f.thresholdInput]);
      return [{ name: "dispatch: serverInputs of the closed inputs", step: () => ({ do: "dispatch", msg: a }) },
        { name: "dispatch: serverInputs of the closed inputs (back)", step: () => inputsBack(s0, a) }];
    } },
    { name: hub.name, scope: hub.scope, setup: loaded, halves: () => {
      const lower = spec.units.flatMap((u) => u.messages).find((x) => x.cell === f.hubInput && x.kind === "add" && x.k < 0).name;
      return [{ name: hub.name, step: hub.step }, { name: "hub input: lower", step: () => ({ do: "click", target: ref.target("sheet", lower), msg: { type: lower } }) }];
    } },
    { name: qty.name, scope: qty.scope, setup: loaded, halves: (s0) => {
      const it = s0.items[Math.min(4, s0.items.length - 1)];
      return [{ name: qty.name, step: qty.step },
        { name: `${qty.name} (back)`, step: () => ({ do: "type", target: ref.target("items", "qty", it.id), value: String(it.qty), msg: { type: "qty", id: it.id, value: it.qty } }) }];
    } },
    twice("item: toggle active"),
    { name: "item: add one, remove it", scope: "global", setup: loaded, halves: () => [
      { name: add.name, step: add.step },
      { name: "item: remove the new one", step: (s) => {
        const id = s.items[s.items.length - 1].id;
        return { do: "click", target: ref.target("items", "remove", id), msg: { type: "remove", id } };
      } },
    ] },
    { name: "dispatch: serverItems (one price)", scope: "global", setup: loaded, halves: (s0) => {
      const a = ref.serverItemsMsg(spec, s0, "bench", { change: 1, add: 0, remove: 0, field: "price" });
      const was = s0.items.find((it) => it.id === a.upsert[0].id);
      return [{ name: "dispatch: serverItems (one price)", step: () => ({ do: "dispatch", msg: a }) },
        { name: "dispatch: serverItems (the price back)", step: () => ({ do: "dispatch", msg: { type: "serverItems", upsert: [was], remove: [] } }) }];
    } },
    { name: "dispatch: whole-state snapshot", scope: "global", setup: loaded, halves: (s0) => snapshotPair(spec, ref, s0) },
  ];
}
