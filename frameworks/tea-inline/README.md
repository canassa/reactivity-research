# tea-inline (prototype)

A rendering strategy that no framework ships yet. It is the output an ideal compiler would
produce from a TEA (Elm Architecture) app: `init`, `update` and `view` go in, and plain DOM code
comes out. The idea comes from beni PR #180 ("strategy A, partial evaluation").

**The idea in one line:** specialize every `case` of `update` into its own action, which writes the
model fields it changes and redraws only the bindings that read them.

## From a click to the DOM

The TEA source of a counter:

```js
// update
case "inc": return { ...model, value: Math.min(max, model.value + step) };

// view
h("output", {}, model.value),
h("button", { disabled: model.value >= max, onClick: () => send({ type: "inc" }) }, "+" + step),
```

What tea-inline emits:

```js
// built once, when the widget mounts
const value = el("output", root);
const incButton = el("button", root, null, "+" + c.step);

// the bindings that read `value`: the compiler knows this set
const onValue = [
  () => text(value, s.value),
  () => prop(incButton, "disabled", s.value >= c.max),
];

// the `inc` arm, as an action that the click calls directly
on(incButton, "click", () => {
  s.value = Math.min(c.max, s.value + c.step);
  schedule(onValue);
});
```

- **No message:** the click calls the arm itself, so there is no `Msg` object and no `switch`.
- **No diff:** the action schedules the bindings that read `value`. One microtask later each
  scheduled binding runs once and writes the DOM only if its value changed.
- **The DOM is built once** with `createElement`, by one factory per widget kind. Every use passes
  its own config (`c`: label, limits, items, rules, formats). In the dashboard, that is one
  `counter` factory shared by every counter on the page.

The app itself is a table of `[factory, config]` rows in page order, plus `init()` for the model.

## Lists, derived values, external events

- **Keyed lists.** A list is a binding over an array in the model. An action that edits the array
  in place says which rows it touched (`items.add(item)`, `items.drop(id)`,
  `items.patch(item)`), and the flush patches only those rows. When the array itself is
  replaced (by a server push, a snapshot or a filtered view), the list reconciles by key. It
  reuses rows and moves them with Solid 2's `reconcileArrays`, vendored in
  `template/reconcile.js` with its MIT notice.
- **Derived values.** A summary reads other widgets' state. At mount it adds its binding to the
  `readers` of each widget it reads. A widget schedules its readers only from the actions that
  write a field a summary reads: `todo` does it on `add`, `toggle` and `remove`, but not on
  `editDraft`.
- **External events stay messages.** `dispatch(msg)` reaches `receive(msg)`, the part of
  `update` that a message still reaches. `serverSet` and `snapshot` replace a widget's state and
  run all its bindings. `tick` and `notify` call the widget's own arms.
- **`settled()`** waits for the pending microtask flush. **`dispose()`** drops pending work and
  removes the dashboard's root node. There are no timers and no listeners outside the root.

## Expected trade-off

- **Baseline: small.** The runtime is about 1.3 kB brotli, against about 6.5 kB for Solid. It has
  no reactive graph, no scheduler beyond a `Set`, and no diffing apart from the keyed list.
- **Per kind: larger.** Each factory spells out its DOM construction and one action per arm,
  where a template compiler would clone a static HTML string. The first use of a kind costs more.
- **Per use: about the same as any configured component.** A new widget adds a config row: an id,
  a label, its parameters and its initial state. Messages and diffs add nothing. The slope
  should match a component framework such as Solid, not beat it, because both pay for the same
  per-instance data.
- **What this design avoids:** the PR's prototypes wrote one factory per instance, and the PR names
  that as the cause of their 10× gap to vanilla. Sharing factories per kind is what keeps the
  per-use cost down to config.

## Files

- `template/runtime.js`: `el`, `text`, `prop`, `attr`, `on`, `when` (conditional blocks), `list`,
  `schedule`/`flush`/`settled`. It is counted as runtime.
- `template/reconcile.js`: `reconcileArrays`, unchanged.
- `template/adapter.js`: the contract (`mount`, `dispatch`, `settled`, `dispose`), excluded from
  size.
- `../../scenarios/shared-components/tea-inline.js`: the emitter, with one factory per widget kind.
- The build is Vite with no framework plugin, the same bundler and minifier as the Solid setup.
  Source maps are hidden.
