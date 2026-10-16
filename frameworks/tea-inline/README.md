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
as its texts and a todo's initial items as `[text, done]` pairs (the compiler checks they are
numbered 1, 2, … and the factory numbers them).
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
  `readers` of each widget it reads. Summaries read only widgets above them (the compiler checks),
  so the app gives each widget its empty `readers[N]` list as it mounts, and a page without
  summaries has none at all. A widget schedules its readers only from the actions that
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
fields in place and schedules the per-field binding groups. The groups live in the widget's
**binding table** `G`, by place: `G[0]`, `G[1]`, … one per field, then every binding that
reads several fields or other widgets, which adds itself at mount to the group of each field
it reads (`G[0].push(G[4])`). A list is the first binding of its field's group, and its row
edits are `G[1][0].add(item)` and `G[1][0].drop(item.id)`. A binding reading another widget
reads its slice in place (`model[3].email`) and adds itself to the group of that field in that
widget's table (`R[3][1].push(G[5])`): widgets read only widgets above them (the compiler
checks), so the table is there already, and the writing widget lists nobody. An enum cycle is
a chain of comparisons (`s.tone == "A" ? "B" : …`), since the compiler knows the options, and
comparisons of values of one known type use loose equality.

A widget's whole markup, conditional sections included, is one static HTML string, with the end
tags HTML makes optional left out (`</option>`, and `</p>` before a block or its parent's end),
and the run of end tags at its very end left out too, with the section's own (the parser closes
them at the end of the string, as it does for Solid's templates).
Each widget module adds `[markup, function]` to the array `W` when the app imports it, in page
order, and the app mounts them with one `W.map`, so no widget is named or numbered in the
bundle: for widget number N, `section` parses the markup once into the widget's section (keyed
`wN`) and the app calls the function with the markup's elements and the widget's slice as its
first parameters, then its empty binding table (`(E, s, G[, R, model])`); the app, not the
widget, then hands the table to `loader`, which schedules it all and returns the handle (with
the external arms the widget returns, if any). The code refers to an element by its
place, `E[n]`, counting in document order every element but headings, labels and options (which
no code refers to, so `section` leaves them out). The initial model is an array by number, its
lists numbered 1, 2, … written as `items("a", "b")` (texts, or `[text, done]` pairs). The only
generic code beyond the runtime is four helpers in `widgets/widget.js` (`section`, `loader`,
`items`, `nextId`) and `W`. An input handler reads its control as `e.target`, which spells
the same in every widget, where `E[n]` does not.

Why it is written this way: the minifier names each widget function's locals itself, skipping
the letters of the runtime functions that widget happens to use, so a widget's every own
variable is a letter that differs from its neighbours'. Destructuring the elements into one
variable each, or naming another widget's slice, cost about 4% at N=256 against `E[n]` and
`model[N]`; passing the elements and the slice as parameters, which get the same two letters
in every widget, saved 1.4% more. The binding table goes further the same way: one parameter,
the same letter in every widget, for every group, list and shared binding, which were each a
local with a letter of its own (−7% at N=256 in round 4, most of it from the table and from
readers pushing into the source's table instead of a registry keyed by field name).

What did not help here: building list rows from a parsed template or from markup (more bytes than
`el(...)` calls at N=256), a single binding as a bare function instead of a one-item group, and
moving each widget's initial state into the widget module or its call, or writing numbered list
items compactly (`L("a", "b")`) (all smaller at small N but larger at N=256: the init tree
compresses better in one place, and a helper costs its bytes in small apps). Nor did keeping
fields in local variables (as digest does; the minifier's per-function letters make alike
widgets differ, +2% at N=256), keeping the binding groups in one object by field name (`G.tone`,
+4.6%), fusing a field's bindings into one function (fewer calls, more bytes), or marking the
referenced elements with an attribute removed at mount (−0.8% at N=256 but +25 B for small
apps). Round 4 dead ends: pushing the shared bindings into `G` first, in a `G.push` of their
own before the groups that list them (+160 B at N=256 against adding them to their groups
afterwards), the widget's own readers as a parameter, a handle table keyed by `wN`,
`W.push(markup, function)` without the pair, an int handler reusing its event parameter (all
noise or larger), `items` split into one helper per kind of list (small apps grew), and
exporting the runtime's pending set instead of `cancel` (+560 B at N=256 in unique-components:
one top-level name less shifts every minified letter). In shared-components, building
factories from static markup also lost: the per-widget
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

## big-table

`../../scenarios/big-table/tea-inline.js` is the unique-components emitter applied to N data tables,
each its own module (`src/tables/<id>.js`), with the same strategy and
two additive files, `template/rows.js` and `template/scenario.js` (included only by this
scenario, through `templateFiles({ extra: ["rows.js", "scenario.js"] })`; the other scenarios'
output is byte-identical). `rows.js` is the generic runtime, counted as runtime: `tpl` (a row
template, parsed once) and `rows` (the keyed row list). `scenario.js` is what the scenario asks of
every table, counted as app code like the equivalent in the other implementations: the row
builder's PRNG step (`next`, `pick`, `between`), the number and date formatters, a table's state
(`state`, with `nextId` and `rng`) and `keepSelected`.

Style choices: one module per table; the table's markup (heading, toolbar, header, empty body) is
one static HTML string parsed once, and its buttons and body are `E[n]`; a row is cloned from one
row template per table (parsed once, `tpl`) and its elements are `E[n]` in document order; each row
control carries its arm inline, with the row's item in scope; the table's state is edited in place
(`s.rows`, `s.selected`, `s.rng`, `s.nextId`); the row builder is written out per table (one draw
per random cell in column order, then the id; word pools are hoisted constants); initial rows are
built at mount with that builder; sorts, `removeChecked`, `clear` and `create` replace the array
and schedule the list; no op table, no column table, no spec descriptions as data.

Who reads what (decided at compile time, by the emitter):

| Written | Read by | The action schedules |
|---|---|---|
| `s.rows` replaced (create, clear, sort, removeChecked, server events) | the list | the list: a reconcile by id (nothing reused: the body is emptied in one go; else one forward pass) |
| `s.rows` edited in place (append, remove, swap) | the list, one row | `add(rows)`, `drop(id)`, `swap(a, b)`: each dropped if the array was replaced since |
| an item's cell (toggle, bump, updateEvery, serverUpdate) | the item's row `set`, which paints all of its cells | the `set` of the rows it touched (`list.get(id)[1]`) |
| `s.selected` | each row's `mark`, `s.selected === item.id` | the `mark` of the old and the new selected row, found by id: no binding per row |

The row's `set` paints the whole row (a handful of `text`/`prop` calls that write only on change)
rather than one binding per cell: a closure per cell per row would cost an allocation per cell on
every create, for no saving on the rare edit. The list does not repaint a reused row whose item is
the same object (every in-place edit schedules its own row).

External events are the same for every table, so they live once in `src/app.js`, not per table:
`serverRows`, `serverUpdate` and `serverDelete` copy the message's rows into the table state
(`structuredClone`: the message is not ours to edit) and schedule the list or the touched rows;
`snapshot` assigns each table's state and schedules its list.

Granularity: a row's `set` is a whole-row binding. One write to an item schedules the repaint of all
of the row's cells, which is coarser than per-field groups; it is bounded by the table's columns
(2 to 8 cells, each written only if its text changed), never by N or by the rows.

Stale handlers: a row's controls look the item up by id in the current array before they act
(`findIndex` for remove, `find` for toggle and bump) and do nothing when it is gone, as the
reference does. A click on a row that a `serverRows`, a snapshot or an earlier remove has
dropped, before the flush, therefore changes nothing; without the lookup `indexOf` returns -1 and
`splice(-1, 1)` removes the last row.

Markup: the optional end tags (`</td>`, `</th>`, `</tr>`, `</thead>`) are left out and attribute
values are unquoted where HTML allows it, as in unique-components. Measured: writing them all out
costs +110 B at N=64 (+0.8%) and +335 B at N=256 (+0.8%), seed 1.

External events go through one shared switch in `src/app.js` for every table (`serverRows`,
`serverUpdate`, `serverDelete`, `snapshot`). It moves data (rows, ids, one column name from the
message) and never reads a table's columns, so it is accepted as consistent with the scenario's
no-interpreter rule (the same reading as the shared `receive` of unique-components).

Cost in rows, by class (calls from `./rr work`, N=16, 1,000 against 10,000 rows):

- Constant: select (7 to 9 calls), swap (8), clear (6). Select and swap touch one or two rows.
- Constant calls, a scan of the array in the worst case: toggle (13), bump (23) and remove (10 to
  12) look the item up by id (`find`, `findIndex`), so they cost O(position of the row); the
  work actions use rows near the start, which is why the counts do not move. Indexed rows would
  make them constant; none is kept, as in any implementation without an index.
- Proportional to the rows they touch: `updateEvery` (rows / k), `serverUpdate` (a `find` per
  change, O(rows) each).
- Proportional to the rows the table holds: create, append, clear of many rows, sort,
  `removeChecked`, `serverRows`, `serverDelete`.

See `notes/2026-10-16-big-table-tea-inline.md` for the figures.

## routed-app

`../../scenarios/routed-app/tea-inline.js` adds what the dashboards never needed: **lifetime**. Pages,
tab panels and modals mount and unmount, and the critique's weakness 2 (hidden content built at mount,
bindings never disposed) is exactly what the scenario's locality bound measures. The runtime stays
as it is; `template/routes.js` (included only by this scenario, through `extra: ["routes.js"]`, so
the other scenarios' output is byte-identical) adds three functions.

**The design.** A *unit* (the shell, a page, a tab panel, the modal) is a markup string and a
function over its elements. `up(ref, at, html, fn)` parses the markup, calls `fn(E, G, D, root)` with
the elements `E` in document order, a fresh binding table `G` and a list of disposers `D`, schedules
the table for its first render and returns the arms `fn` returned plus `down`, which runs the
disposers once. Everything a unit puts outside itself registers a disposer:

- its nodes (`root.remove()`, the first disposer);
- its timers: `every(D, ms, tick)` is a `setInterval` that `down` clears;
- its readers of state that outlives it: `reg(D, group, item)` pushes `item` into `group` and removes
  it on `down`. The groups of a global field are a list outside every unit (`GR.balance`, in
  `src/state.js`); the shell adds its three bindings when it is built, and a page adds a group of its
  own (`reg(D, GR.balance, G[3])`). A tab or the modal reading a page field registers with the page's
  group of that field (`reg(C, G[2], H[1])`) the same way.

Page-local state is a `const` of the unit's function, so it is fresh every time the unit is built,
which is the scenario's lifetime rule for pages, tab panels and modals. A page's tabs and modal are
functions inside the page's module, because they share its state: the panel is built by `up(nav,
"afterend", ...)` when its tab is selected (the old panel's `down` first), the modal by `up(root,
"beforeend", ...)` when it opens. The page's own disposers end both.

**What a write costs.** Actions are inlined as before, and schedule the groups of the fields they
write, chosen at compile time: the unit's own, the page's, or `GR.x` for a global field (left out
when neither the shell nor any unit of that page reads it). Because only mounted units are
registered, `GR.balance` holds the page shown and nothing else: a write costs the same at N = 256 as
at N = 16. The shell is the one unit that lives as long as the app. The pages' titles are the only
O(N) data (`PAGES`, which the menu lists when opened). Navigation is one delegated click listener on
the app's root, reading `data-key` from the nav bar's, the menu's and the pages' link buttons, so no
page wires a link.

Style choices: one module per page; static markup per unit, parsed once per build, with the optional
end tags left out; `E[n]` by place; page-local lists edit rows in place on add (`add`) and replace
the array on remove (a click on a row that something else dropped already changes nothing); global
lists are replaced and their groups reconcile (the action cannot know which lists are mounted);
`reg` calls are one per global field a unit reads, not one per binding.

**Locality** (`./rr work routed-app tea-inline --sizes 16,256`, seed 1, calls per action, N = 16 →
256): flat in all 22 local actions (worst ratio 1.00; the first navigation, 53 → 52, is the largest
change): a page event 8 to 9 calls, `serverSet` of a global no page shown reads 5, a navigation 49 to
147 calls (it builds the new page's whole markup and bindings; p2 → p3 is the heaviest, with tabs
and a feed), the app's mount (shell and p1) 61 and its dispose 14. Opening the menu is global by
nature: 36 → 516.

**Size** (seeds 1 to 3, sizes 1 to 256): baseline 4,451 B, slope 307 B per page (R² 0.990); N = 256
ships 78.9 to 82.6 kB brotli. The runtime is 884 B from N = 4 (661 to 698 at N = 1), against 730 B in
the dashboards: `routes.js` costs about 140 B. The lifetime machinery in the generated code (the
`reg` calls and the pages' disposers, deleted from a build to count them) costs 242 B at N = 16
(2.3%), 874 B at N = 64 and 2,480 B at N = 256 (3.1%), about 10 B per page; the `D`/`C` parameters
and the registrations are all of it. Building only what is shown costs 3% of the bytes.

**What is not disposed.** A binding already scheduled in the same tick that its unit goes still runs
once, on its detached nodes: the runtime's pending set is private, and `routes.js` does not edit
`runtime.js` (it would change every scenario's output). It is wasted work bounded by one page's
bindings, never a leak: nothing outside the unit keeps it. Rows of a page-local list keep the
runtime's `drop` method unused (removals reconcile), which costs its few bytes in this scenario.
