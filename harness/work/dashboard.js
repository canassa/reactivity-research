// The actions ./rr work performs on the dashboard: one step each, on the first widget of each
// kind. The generator is prefix-stable (for one seed, the early widgets are identical at every
// size), so the same action touches the same widget at every size.
//
// An action is { name, scope, step(state) → step }. `step` builds a script step (the vocabulary
// of the interaction script: click, type, select, dispatch) from the reference state, which the
// runner advances with the reference `update` between actions. `scope` says what the action
// touches by nature: "local" (one widget) or "global" (the whole state, e.g. a snapshot).
// Actions run in this order; `setup: true` marks one that only prepares the next.

const sel = (widget, role, { key, item } = {}) =>
  `[data-key="${widget}"] ${item != null ? `[data-key="${item}"] ` : ""}[data-role="${role}"]${key != null ? `[data-key="${key}"]` : ""}`;

export function actions(spec, ref) {
  const first = (kind) => spec.widgets.find((x) => x.kind === kind);
  const click = (widget, role, msg, opts) => () => ({ do: "click", target: sel(widget, role, opts), msg });
  const type = (widget, role, value, msg) => ({ do: "type", target: sel(widget, role), value, msg });

  const counter = first("counter"), tabs = first("tabs"), amount = first("amount"), todo = first("todo");
  const filter = first("filter"), clock = first("clock"), panel = first("panel"), field = first("field");
  const toggles = first("toggles"), rating = first("rating"), feed = first("feed");

  return [
    { name: "counter: click +", scope: "local", step: click(counter.id, "inc", { widget: counter.id, type: "inc" }) },
    { name: "tabs: select a tab", scope: "local", step: click(tabs.id, "tab", { widget: tabs.id, type: "select", index: 1 }, { key: "1" }) },
    { name: "amount: type a digit", scope: "local", step: (s) => {
      const v = String(s.widgets[amount.id].value) + "7";
      return type(amount.id, "input", v, { widget: amount.id, type: "set", value: Number(v) });
    } },
    { name: "todo: type in the draft", scope: "local", step: () => type(todo.id, "draft", "Buy milk", { widget: todo.id, type: "editDraft", text: "Buy milk" }) },
    { name: "todo: add", scope: "local", step: click(todo.id, "add", { widget: todo.id, type: "add" }) },
    { name: "todo: toggle an item", scope: "local", step: (s) => {
      const id = s.widgets[todo.id].items[0].id;
      return { do: "click", target: sel(todo.id, "toggle", { item: String(id) }), msg: { widget: todo.id, type: "toggle", id } };
    } },
    { name: "filter: type a letter", scope: "local", step: (s) => {
      const q = s.widgets[filter.id].query;
      const v = (q + filter.items[0].text.toLowerCase()).slice(0, q.length + 1);
      return type(filter.id, "query", v, { widget: filter.id, type: "edit", query: v });
    } },
    { name: "field: type", scope: "local", step: (s) => {
      const v = s.widgets[field.id].text + "ok";
      return type(field.id, "input", v, { widget: field.id, type: "edit", text: v });
    } },
    { name: "toggles: flip one", scope: "local", step: click(toggles.id, "toggle", { widget: toggles.id, type: "toggle", index: 0 }, { key: "0" }) },
    { name: "panel: open or close", scope: "local", step: click(panel.id, "toggle", { widget: panel.id, type: "toggle" }) },
    { name: "rating: rate", scope: "local", step: click(rating.id, "star", { widget: rating.id, type: "rate", stars: 2 }, { key: "2" }) },
    { name: "feed: dismiss an entry", scope: "local", step: (s) => {
      const id = s.widgets[feed.id].entries[0].id;
      return { do: "click", target: sel(feed.id, "dismiss", { item: String(id) }), msg: { widget: feed.id, type: "dismiss", id } };
    } },
    { name: "clock: start", scope: "local", setup: true, step: click(clock.id, "start", { widget: clock.id, type: "start" }) },
    { name: "dispatch: tick (one clock running)", scope: "local", step: () => ({ do: "dispatch", msg: { type: "tick" } }) },
    { name: "dispatch: serverSet one widget", scope: "local", step: (s) => ({ do: "dispatch", msg: { type: "serverSet", widget: counter.id, state: ref.serverState(spec, s, counter.id, "work") } }) },
    { name: "dispatch: notify one feed", scope: "local", step: (s) => ({ do: "dispatch", msg: { type: "notify", widget: feed.id, entry: ref.notifyEntry(spec, s, feed.id, "work") } }) },
    { name: "dispatch: whole-state snapshot", scope: "global", step: (s) => ({ do: "dispatch", msg: { type: "snapshot", state: ref.snapshot(spec, s, "work") } }) },
  ];
}
