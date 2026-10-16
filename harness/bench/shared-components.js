// The events ./rr bench times on the dashboard: ./rr work's actions (harness/work/
// shared-components.js), on the same first widget of each kind, made repeatable from the same
// state so that one page can run each of them many times.
//
// A bench action is { name, scope, setup?, halves, reset? }:
//   setup(s0)  → steps run once before the action, not timed (e.g. start a clock);
//   halves(s0) → [{ name, step(s) }], the timed steps of one rep, in order; together they return
//                the state to where the rep started (a do/undo pair), so every rep is alike;
//   reset(s, s0) → a step to run after a rep, not timed, or null (for an action with no natural
//                undo, before it would stop changing anything).
// Steps use ./rr work's vocabulary (click, type, select, dispatch) and its targets; the reference
// state `s` is advanced with the reference update between steps.

import { actions as workActions } from "../work/shared-components.js";
import { serverPair, snapshotPair } from "./lib/pairs.js";

const sel = (widget, role, { key, item } = {}) =>
  `[data-key="${widget}"] ${item != null ? `[data-key="${item}"] ` : ""}[data-role="${role}"]${key != null ? `[data-key="${key}"]` : ""}`;

export function benchActions(spec, ref) {
  const work = new Map(workActions(spec, ref).map((a) => [a.name, a]));
  const w = (name) => {
    if (!work.has(name)) throw new Error(`shared-components bench: no work action "${name}"`);
    return work.get(name).step;
  };
  const first = (kind) => spec.widgets.find((x) => x.kind === kind);
  const counter = first("counter"), tabs = first("tabs"), amount = first("amount"), todo = first("todo");
  const filter = first("filter"), field = first("field"), toggles = first("toggles"), panel = first("panel");
  const rating = first("rating"), feed = first("feed");
  const S = (s, x) => s.widgets[x.id];
  const click = (x, role, msg, opts) => ({ do: "click", target: sel(x.id, role, opts), msg: { widget: x.id, ...msg } });
  const type = (x, role, value, msg) => ({ do: "type", target: sel(x.id, role), value, msg: { widget: x.id, ...msg } });
  const twice = (name, back, step) => () => [{ name, step }, { name: back, step }];

  return [
    { name: "counter: click + / −", scope: "local", halves: (s0) => {
      const inc = { name: "counter: click +", step: w("counter: click +") };
      const dec = { name: "counter: click −", step: () => click(counter, "dec", { type: "dec" }) };
      return S(s0, counter).value + counter.step <= counter.max ? [inc, dec] : [dec, inc];
    } },
    { name: "tabs: select a tab", scope: "local", halves: (s0) => {
      const from = S(s0, tabs).active, to = from === 1 ? 0 : 1;
      const pick = (i) => () => click(tabs, "tab", { type: "select", index: i }, { key: String(i) });
      return [{ name: "tabs: select a tab", step: pick(to) }, { name: "tabs: select it back", step: pick(from) }];
    } },
    { name: "amount: type a digit", scope: "local", halves: (s0) => {
      const v = S(s0, amount).value;
      return [{ name: "amount: type a digit", step: w("amount: type a digit") },
        { name: "amount: delete it", step: () => type(amount, "input", String(v), { type: "set", value: v }) }];
    } },
    { name: "todo: type, add, remove", scope: "local", halves: () => [
      { name: "todo: type in the draft", step: w("todo: type in the draft") },
      { name: "todo: add", step: w("todo: add") },
      { name: "todo: remove the new item", step: (s) => {
        const id = S(s, todo).items.at(-1).id;
        return click(todo, "remove", { type: "remove", id }, { item: String(id) });
      } },
    ] },
    { name: "todo: toggle an item", scope: "local", halves: twice("todo: toggle an item", "todo: toggle it back", w("todo: toggle an item")) },
    { name: "filter: type a letter", scope: "local", halves: (s0) => {
      const q = S(s0, filter).query;
      return [{ name: "filter: type a letter", step: w("filter: type a letter") },
        { name: "filter: delete it", step: () => type(filter, "query", q, { type: "edit", query: q }) }];
    } },
    { name: "field: type", scope: "local", halves: (s0) => {
      const t = S(s0, field).text;
      return [{ name: "field: type", step: w("field: type") },
        { name: "field: delete it", step: () => type(field, "input", t, { type: "edit", text: t }) }];
    } },
    { name: "toggles: flip one", scope: "local", halves: twice("toggles: flip one", "toggles: flip it back", w("toggles: flip one")) },
    { name: "panel: open or close", scope: "local", halves: (s0) => {
      const [a, b] = S(s0, panel).open ? ["panel: close", "panel: open"] : ["panel: open", "panel: close"];
      return [{ name: a, step: w("panel: open or close") }, { name: b, step: w("panel: open or close") }];
    } },
    { name: "rating: rate", scope: "local", halves: (s0) => {
      const from = S(s0, rating).stars;
      const back = from >= 1 && from !== 2 ? from : 3 <= rating.stars ? 3 : 1;
      const rate = (k) => () => click(rating, "star", { type: "rate", stars: k }, { key: String(k) });
      return [{ name: "rating: rate", step: w("rating: rate") }, { name: "rating: rate again", step: rate(back) }];
    } },
    { name: "feed: notify, dismiss", scope: "local", halves: () => [
      { name: "dispatch: notify one feed", step: w("dispatch: notify one feed") },
      { name: "feed: dismiss an entry", step: (s) => {
        const id = S(s, feed).entries.at(-1).id;
        return click(feed, "dismiss", { type: "dismiss", id }, { item: String(id) });
      } },
    ] },
    { name: "dispatch: tick (one clock running)", scope: "local", setup: (s0) => [w("clock: start")(s0)],
      halves: () => [{ name: "dispatch: tick (one clock running)", step: w("dispatch: tick (one clock running)") }] },
    { name: "dispatch: serverSet one widget", scope: "local", halves: (s0) => serverPair(spec, ref, s0, counter.id, "dispatch: serverSet one widget") },
    { name: "dispatch: whole-state snapshot", scope: "global", halves: (s0) => snapshotPair(spec, ref, s0) },
  ];
}
