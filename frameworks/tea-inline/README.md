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
  () => prop(incButton, s.value >= c.max, "disabled"),
];

// the `inc` arm, as an action that the click calls directly
on(incButton, () => {
  s.value = Math.min(c.max, s.value + c.step);
  schedule(onValue);
});
```

(`on` listens to clicks unless given another type, and `prop` writes a form control's `value`
unless given another key: the two most frequent cases spell nothing.)

- **No message:** the click calls the arm itself, so there is no `Msg` object and no `switch`.
- **No diff:** the action schedules the bindings that read `value`. One microtask later each
  scheduled binding runs once and writes the DOM only if its value changed.
- **The DOM is built once** per component. In shared-components it is built with `createElement`,
  by one factory per widget kind, and every use passes its own arguments (label, limits, items,
  rules, formats): one `counter` factory serves every counter on the page. In
  unique-components each widget parses one static HTML string and picks the elements it uses
  by document order (see below).

The shared-components app is a table of rows `[factory, initial state, label, ...arguments]`
in page order; row N is widget `wN`, number N, so no row spells out its id. The table is a
function called on each mount (`page()`), so every row's initial state (TEA's `init`, split per
widget) is a fresh object, and each factory is handed its own slice and its number (a summary,
which has no state, is handed the model it reads and its sources' numbers). The model and the
readers are keyed by number (`model[N]`, `readers[N]`); only a section's `data-key` spells
`wN`. Tabs and options travel as `[title, content]` and `[value, label]` pairs, a filter's pool
as its texts (the compiler checks they are numbered 1, 2, … and the factory numbers them).
(Spelling the arguments positionally and keeping each initial state in its row saved about 5%
at N=256; deriving ids from row order about 6% more: property names, ids and a second tree
keyed by id no longer repeat per widget.)

## Lists, derived values, external events

- **Keyed lists.** A list is a binding over an array in the model. A row builder returns
  `[node, set]`, where `set` is the row's binding: the list hands it the item of its id, and the
  row keeps that item current. A row's own controls (toggle, remove, dismiss) carry their arm
  inline in the row's handler, with the row's item in scope: a toggle writes `item.done` and
  schedules the row's `set` with its field's group; a remove splices the item out (by identity)
  and schedules the row's removal (`items.drop(item.id)`); an add schedules the new row
  (`items.add(item)`). When the array itself is replaced (by a server push, a snapshot or a
  filtered view), the list binding reconciles by `item.id`: it reuses rows, removes those whose
  id left, and puts the rest in order in one forward pass (a row already in place stays; any
  other moves before the first row not yet placed); an add or drop that such a reconcile in the
  same flush already made is skipped. A list that only gains or loses rows moves nothing, a
  reversed run moves all rows but one; the worst case is a rotation. Solid 2's
  `reconcileArrays` did the same jobs for about 500 B brotli more.
- **Conditional blocks.** `when(node, cond)` is called by a binding on a node built in place with
  the rest of the DOM; while hidden, the node is swapped with an empty text node kept on it
  (`node.anchor`). Nothing is built lazily.
- **Derived values.** A summary reads other widgets' state. At mount it adds its binding to the
  `readers` of each widget it reads. A widget schedules its readers only from the actions that
  write a field a summary reads: `todo` does it on `add`, `toggle` and `remove`, but not on
  `editDraft`. The readers sit in the binding group of the field they read, so the action
  schedules one group.
- **External events stay messages.** `dispatch(msg)` reaches `receive(msg)`, the part of
  `update` that a message still reaches. A widget's handle is its load function, carrying its
  external arms: `serverSet` and `snapshot` call it to replace the widget's state and run all its
  bindings; `tick` and `notify` call the widget's own arms (`views[N].tick()`).
- **`settled()`** waits for the pending microtask flush. **`dispose()`** drops pending work and
  removes the dashboard's root node. There are no timers and no listeners outside the root.

## Expected trade-off

- **Baseline: small.** The runtime is well under 1 kB brotli, against about 6.5 kB for Solid. It has
  no reactive graph, no scheduler beyond a `Set`, and no diffing apart from the keyed list.
- **Per kind: larger.** Each factory spells out its DOM construction and one action per arm,
  where a template compiler would clone a static HTML string. The first use of a kind costs more.
- **Per use: about the same as any configured component.** A new widget adds a config row:
  a label, its parameters and its initial state. Messages and diffs add nothing. The slope
  should match a component framework such as Solid, not beat it, because both pay for the same
  per-instance data.
- **What this design avoids:** the PR's prototypes wrote one factory per instance, and the PR names
  that as the cause of their 10× gap to vanilla. Sharing factories per kind is what keeps the
  per-use cost down to config.

## Files

- `template/runtime.js`: `el`, `text`, `prop` (a control's value by default, also checked,
  disabled and reflected ARIA states), `on` (clicks by default), `when` (conditional blocks),
  `list` (keyed by `item.id`), `schedule`/`flush`/`settled`. It is counted as runtime.
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
fields in place and schedules the per-field binding groups (`onVisits = [...]`); a field other
widgets read lists their bindings (`R[widget].<field>`, registered at mount) in its own group;
a binding reading another widget reads its slice in place (`model[3].email`). An enum cycle is
a chain of comparisons (`s.tone == "A" ? "B" : …`), since the compiler knows the options, and
comparisons of values of one known type use loose equality.

A widget's whole markup, conditional sections included, is one static HTML string, with the end
tags HTML makes optional left out (`</option>`, and `</p>` before a block or its parent's end).
Each widget module adds `[markup, function]` to the array `W` when the app imports it, in page
order, and the app mounts them with one `W.map`, so no widget is named or numbered in the
bundle: for widget number N, `section` parses the markup once into the widget's section (keyed
`wN`) and the app calls the function with the markup's elements and the widget's slice as its
first parameters (`(E, s, readers, widget[, model])`). The code refers to an element by its
place, `E[n]`, counting in document order every element but headings, labels and options (which
no code refers to, so `section` leaves them out). The initial model is an array by number. The
only generic code beyond the runtime is three helpers in `widgets/widget.js` (`section`,
`loader`, `nextId`) and `W`.

Why it is written this way: the minifier names each widget function's locals itself, skipping
the letters of the runtime functions that widget happens to use, so a widget's every own
variable is a letter that differs from its neighbours'. Destructuring the elements into one
variable each, or naming another widget's slice, cost about 4% at N=256 against `E[n]` and
`model[N]`; passing the elements and the slice as parameters, which get the same two letters
in every widget, saved 1.4% more.

What did not help here: building list rows from a parsed template or from markup (more bytes than
`el(...)` calls at N=256), a single binding as a bare function instead of a one-item group, and
moving each widget's initial state into the widget module or its call, or writing numbered list
items compactly (`L("a", "b")`) (all smaller at small N but larger at N=256: the init tree
compresses better in one place, and a helper costs its bytes in small apps). Nor did keeping
fields in local variables (as digest does; the minifier's per-function letters make alike
widgets differ, +2% at N=256), keeping the binding groups in one object by field name (`G.tone`,
+4.6%), fusing a field's bindings into one function (fewer calls, more bytes), or marking the
referenced elements with an attribute removed at mount (−0.8% at N=256 but +25 B for small
apps). In shared-components, building factories from static markup also lost: the per-widget
texts then need one assignment each. Expect the slope to be the cost of per-widget DOM
construction and actions, with no shared factory to amortize it.

## big-component

`../../scenarios/big-component/tea-inline.js` is the unique-components emitter applied to one
form of about N fields plus the fixed companion, with the same runtime, unchanged (no new runtime
file was needed). The form is one module: one static HTML string, every message inlined into the
action of its control, and one binding group per field that lists every binding reading it (a
binding reading three fields sits in three groups). The companion's three cross-widget reads
register in `R` as before.

Style choices: one module for the form and one for the companion; static markup parsed once, with
`E[n]` for the elements; in-place model edits; per-field groups; one microtask flush; list rows
edited in place by the action that knows the row; no op table or field table (nothing is data
that a routine interprets).

Locality is flat: calls per local action are the same from N=16 to N=256 (median 12, worst
ratio 1.00), because an action schedules only the groups of the fields it writes and each field
is read by at most 6-8 bindings. Only the global events (whole-state `snapshot`, `serverSet` of
the form) grow with N, by nature. Size: about 82 B brotli per unit; the runtime stays 743 B.
