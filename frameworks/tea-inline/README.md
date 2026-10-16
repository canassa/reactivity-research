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
- **The DOM is built once** per component. In shared-components it is built with `createElement`,
  by one factory per widget kind, and every use passes its own arguments (label, limits, items,
  rules, formats): one `counter` factory serves every counter on the page. In
  unique-components each widget parses one static HTML string and picks the elements it uses
  by document order (see below).

The shared-components app is a table of rows `[factory, id, initial state, label, ...arguments]`
in page order; the model is made on each mount from a copy of every row's initial state (TEA's
`init`, split per widget). (Spelling the arguments positionally and keeping each initial state
in its row saved about 5% at N=256: property names and a second tree keyed by id no longer
repeat per widget.)

## Lists, derived values, external events

- **Keyed lists.** A list is a binding over an array in the model. An action that edits the array
  in place says which rows it touched (`items.add(item)`, `items.drop(id)`,
  `items.patch(item)`), and the flush patches only those rows. When the array itself is
  replaced (by a server push, a snapshot or a filtered view), the list reconciles by
  `item.id`: it reuses rows, removes those whose id left, and puts the rest in order in one
  forward pass (a row already in place stays; any other moves before the first row not yet
  placed). A list that only gains or loses rows moves nothing, a reversed run moves all rows
  but one; the worst case is a rotation. Solid 2's `reconcileArrays` did the same jobs for
  about 500 B brotli more.
- **Conditional blocks.** `when(node)` takes a node built in place with the rest of the DOM and
  swaps it with an empty text node while hidden; nothing is built lazily.
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

- **Baseline: small.** The runtime is well under 1 kB brotli, against about 6.5 kB for Solid. It has
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

- `template/runtime.js`: `el`, `text`, `prop` (also for reflected ARIA states), `on`, `when`
  (conditional blocks), `list` (keyed by `item.id`), `schedule`/`flush`/`settled`. It is
  counted as runtime.
- `template/adapter.js`: the contract (`mount`, `dispatch`, `settled`, `dispose`), excluded from
  size.
- `../../scenarios/shared-components/tea-inline.js`: the emitter, with one factory per widget kind.
- The build is Vite with no framework plugin, the same bundler and minifier as the Solid setup.
  Source maps are hidden.

## unique-components

`../../scenarios/unique-components/tea-inline.js` uses the same runtime and strategy, but with no
kinds to share: every widget is its own module (`src/widgets/<id>.js`), written out from its
description. The emitter compiles each widget's expressions to JavaScript, works out the fields
each binding reads, and inlines every message into the action of its control, which writes the
fields in place and schedules the per-field binding groups (`onVisits = [...]`) plus
`R[widget].<field>` for the fields other widgets read. A widget's whole markup, conditional
sections included, is one static HTML string that `section` parses once; the code takes the
elements it uses by document order (`const [, , i1, , g1] = section(parent, widget, "...")`).
The widget gets its own id as a parameter rather than repeating it as a literal, which keeps
alike lines alike for brotli. The only generic code beyond the runtime is three helpers in
`widgets/widget.js` (`section`, `loader`, `nextId`).

What did not help here: building list rows from a parsed template (more bytes than
`el(...)` calls), a single binding as a bare function instead of a one-item group, and moving
each widget's initial state or its own state slice into the widget module or its call (all
smaller at small N but larger at N=256: the init tree compresses better in one place). In
shared-components, building factories from static markup also lost: the per-widget texts then
need one assignment each. Expect the slope to be the cost of
per-widget DOM construction and actions, with no shared factory to amortize it.
