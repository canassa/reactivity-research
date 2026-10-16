# tea-local (prototype)

A rendering strategy no framework implements yet, so it is reported on the **prototype track**.
It is the output an ideal compiler could produce from an app written in the Elm Architecture
(TEA): messages and a reducer per component, as in the source, but no global dispatch.

It comes from strategy C ("local reducers") of the beni rendering-design research
(canassa/beni#180), the best performer of that study.

**The idea in one line:** every component instance keeps its model in a closure, and a DOM event
runs only that instance's reducer and then only that instance's bindings.

## From a click to a DOM write

The TEA source of a counter:

```elm
type Msg = Inc | Dec

update msg model =
    case msg of
        Inc -> { model | value = min config.max (model.value + config.step) }
        Dec -> { model | value = max config.min (model.value - config.step) }

view model =
    section []
        [ output [] [ text (String.fromInt model.value) ]
        , button [ onClick Dec, disabled (model.value <= config.min) ] [ text "-" ]
        , button [ onClick Inc ] [ text "+" ]
        ]
```

What tea-local emits, once per widget **kind** (every counter shares it):

```js
// type Msg = Inc | Dec | Reset                 (Inc is tag 0, Dec tag 1, Reset tag 2)

export function counter(parent, heading, step, min, max, start, model) {
  const patch = () => {                               // this instance's binding list (it runs
    const m = self.m;                                 // after mount, so it can come first)
    setText(value, m.value);                          // skipped if the text is unchanged
    setProp(dec, "disabled", m.value <= min);         // skipped if already equal
  };
  const self = instance(model, [                      // the model lives in this closure
    (model, value) => ({ value: Math.min(max, model.value + step) }), // the reducer: one
    (model, value) => ({ value: Math.max(min, model.value - step) }), // branch of `case msg of`
    (model, value) => ({ value: start }),                             // per constructor, by tag
  ], patch);
  const root = widget(parent, heading, "counter", self); // DOM built once; registered as w1, w2, …
  const value = element(root, "output", null, " ");  // a dynamic text: a placeholder node
  const dec = on(element(root, "button", null, "-"), "click", () => self.send(1));
  // …                                                // Dec, to this instance only (on returns
  //                                                  // its node: built, wired and named at once)
}                                                     // instance() scheduled the first patch
```

A message is sent as its constructor's tag and its argument, if any (`send(1)`,
`send(0, text)`): the same message as a `[tag, value]` array, without allocating it. `send` is
tiny and lives in the runtime:

```js
send: (tag, value) => set(update[tag](self.m, value)),
set(next) { if (next !== self.m) { self.m = next; schedule(patch); /* + watchers */ } },
```

`schedule` collects patches in a `Set` and runs them in one microtask (queued with the first
patch scheduled after the last flush), so several messages cost one patch. There are no dirty
bits, no dependency tracking, and no comparison of anything except the final DOM values.

**The reducer is a jump table.** `case msg of` compiles to an array with one function per
constructor, indexed by its tag, each with the same signature `(model, value)`: the reducer
and its arms are kept as written, and `send` runs exactly the arm of the message (one call,
as the switch was). The table is the instance's second argument, next to the initial model.

Each widget is one call with its heading, config fields (positional, in its kind's order)
and initial model; the widget frame keeps the instance in a registry, so the app keeps
nothing. Widget ids are `w1`, `w2`, … in page order (the emitter checks it), so the registry
is an array in page order (`w3` is `widgets[2]`; emptied on dispose): the frame numbers the
next widget with what `push` returns, and the app does not spell ids (tea-inline numbers its
widgets the same way). A kind whose `init` is a constant (the rating's `{ stars: 0 }`) builds
its model itself, and its widgets pass none (the emitter checks it):

```js
counter(main, "Design tickets", 5, 0, 20, 0, { value: 0 });
```

## Lists, summaries and external events

**Keyed lists** (`todo`, `filter`, `feed`) use the runtime's `list(parent, build, patch)`,
keyed by `item.id` (which it writes as the row's `data-key`). A row is an array of its
elements, the row's node first, built by `build(item)`; `patch(row, item)` is the row's
binding list, so no `{ node, patch }` object per row. Each patch walks the new items by key. A
row whose item object changed is patched in place, and a new key builds a detached row. If the
sequence of rows changed (an add, a remove, filtering, a reorder), the rows that left are
removed and one forward pass places the rest: a node already in place stays, any other is
inserted before the first node not yet placed. That moves nothing for adds, removes and
filtering, and all but one node of a reversed run, like the Solid 2 `reconcileArrays` it
replaced (vendored until October 2026, about 480 B brotli); its worst case is a rotation,
which moves every node but one. The PR's array edit journal, which comes from beni's owned
lists, is left out: the first pass already skips unchanged rows. A list owns every child of its
parent, so the nodes in place are the parent's `childNodes`: it keeps no copy of the last order.

A dashboard kind listens for `click` on buttons and checkboxes and for `input` on text and
number inputs and selects, as the unique widgets' `wire` does (two event types, not three).

**Summaries** read other widgets' state. A summary subscribes to the instances it reads,
by their index in the registry (`widgets[2].watch(patch)` for w3). When one of their models changes, for any reason,
the summary's patch is scheduled in the same flush. It recomputes its line from the sources'
current models (a term read once is written in place; a breakdown, which shows each term and
their total, names them):

```js
summary(main, "…", (m3, m6) => `Total: ${m3.value + m6.value}`, [2, 5]);
```

**External events** go from the adapter's `dispatch` to `App.receive`, which routes them:

| Event | Becomes |
|---|---|
| `serverSet` | `widgets[n - 1].set(state)` for `wn`: the instance's model is replaced |
| `snapshot` | `set` on every instance, each with its own new model |
| `tick` | the clock's own `Tick` message, sent to each clock instance |
| `notify` | the feed's `Notify entry` message, sent to that feed |

`settled()` (in the runtime; the adapter only calls it) resolves after the microtask flush. `dispose()` removes the dashboard's element: every listener
sits on a node inside it, and the app has no timers or global listeners.

## The expected trade-off

- **Small baseline.** The runtime is about 0.8 kB brotli at full catalogue (Vite's module
  preload polyfill included). There is no reactive graph, scheduler or component system to ship.
- **The slope follows the source.** The per-widget cost is the widget's config, its initial
  model and one factory call, which should be close to what a hand-written vanilla app with
  shared components carries. The reducers and binding lists are paid once per kind.
- **Re-running a whole binding list costs CPU.** Every message to a widget recomputes all its
  bindings, including the filtering of a list. That is cheap for widget-sized components but
  would grow with big components. A summary re-runs on every change to any source.
- **It depends on the compiler sharing factories per kind.** Without that sharing, the PR
  measured a 10× gap to vanilla.

## unique-components

`scenarios/unique-components/tea-local.js` runs the same strategy when every widget is its own
component type. Nothing is shared per kind, so each widget gets its own code. A factory per
widget would be called once, so the compiler inlines it: each widget is a block of the app's
`dashboard(main)` function, in page order (no factory name or call per widget, and every block
reuses the same local names, so the minifier's names repeat from widget to widget). The block
has its initial model and its own reducer table in its `instance` call (one arm per message,
written out from the message's kind and ops, never interpreted), its own static template and
`patch` (derived texts become template literals; a cycled enum's next option is a chain of
comparisons over its options, as tea-inline compiles it). The template is the widget's markup
as one string (trailing end tags left out, as Solid's compiler does); `widget()` inserts it
with its section in one `insertAdjacentHTML` (the app's dashboard comes from markup too, so
unique apps ship no `element()`) and returns its elements in document order, which the
block addresses as `e[3]` (indexes compress better than names, measured). Only generic
helpers are shared: this runtime and a small `widgets/frame.js` (the widget frame and its
registry, readers, list rows, conditional content, next item id, subscriptions, and a
`setProp(node, value, key = "value")` whose key defaults to a form control's value, the most
common property binding; the runtime's `setProp(node, key, value)` keeps its order, as the same
change measured larger in the dashboard).

- **Events, as Elm's `onClick msg` and `onInput Tag`:** a compiler chooses its constructor
  tags, so the controls of the widget's template take tags 0, 1, 2, … in document order, then
  each list row's controls the next ones, then the other messages (Tick, Notify). The runtime's
  `wire(root, self, first, id)` attaches them by position from `first`: a button or checkbox
  sends its message when clicked, a text input, select or number input sends its tag with its
  value on input; a list row passes its item's id as the argument. No tag list is written per
  widget or row. One listener per control and one `send` per event. A number input sends its
  `valueAsNumber`; its reducer case takes it only as an integer within [min, max] (anything else
  returns the same model, so nothing is patched), and it is written through `valueAsNumber`.
- **Conditional content** (`when`, validation errors) is in the template; `place(node, shown)`
  swaps it with an empty text node of its own while hidden, so it needs neither its parent nor
  its later siblings to find its way back.
- **List rows:** `list(e[9], row(html, self, first), (r, item) => …)`: the frame's `row`
  parses the row's template once and, per new item, clones it, wires its controls from `first`
  with the item's id and returns its elements (`wire` returns them); the third argument is the
  row's binding list over `r[1]`, `r[2]`.
- **The frame registers every instance in page order** (an array, `w1` first, checked by
  the emitter): a block keeps nothing for later, and a cross-widget reader reads the earlier
  widget's model from the registry in its `patch` (`const m3 = widgets[2].m`). Its instance
  is made by the frame's `reader([2], model, update, patch)`, which has the patch watch its
  sources and then calls `instance`, so a reader's patch is an inline arrow like every other
  block's (no name, no `watch` call per source, and the same minified names in every block).
  `reader` is tree-shaken from an app without readers.
- A time-driven int is a subscription, like Elm's `subscriptions`: while its gate is on, the
  widget's `tick` is in a shared `running` set, and the app's `tick` event calls only those.
  Otherwise `tick` would cost one call per widget and fail the locality check. An app routes
  `tick` only if it has such a widget, and `notify` only if it has a feed.
- A widget with a feed keeps its Notify tag (`self.notify = 5`), and the app sends that message
  to it; `serverSet` and `snapshot` use `set`.
- The slope is the per-component code: model, reducer, template, event tags and bindings.

## big-component

`scenarios/big-component/tea-local.js` poses the strategy's weak point: one component whose model
grows with N. The form is one **flat** list of N field units with no sections or groups, and a
binding may read a field from anywhere earlier in it. The emitter takes a style parameter,
`--grain unit|form`.

A first version split the form into one instance per fieldset and passed locality. The owner
judged that a cheat: the fieldset was a boundary the generator handed it, a convenient block and
not a precision. The scenario no longer has fieldsets, so the question is again whether the
strategy can be local on its own terms.

### `--grain unit` (default): one instance per field unit

A **field unit** is what the spec defines as one field with everything that belongs to it: its
controls, its displays and the bindings it adds over earlier fields (a list brings the draft text
it is fed from, a time-driven int its gate bool). The emitter finds units from the spec's fields
and messages, as the scenario's script does (a push message names the draft, a `tickWhen` names the
gate); it never chunks by position or by count.

- **Per-field granularity, stated plainly.** This is the strategy applied at the smallest grain
  the app's own structure offers, not a coarser one. The instance is still a TEA component: a
  model in its closure, a reducer with one arm per message, `send(tag, value)` routed to that
  instance, and its whole binding list re-run after each message. What changed is only the size
  of the component, and it is the size of a field and its controls.
- **Why it is within the strategy.** Per-field dependency tracking would be a mechanism that,
  after a change, finds the bindings reading that field: dirty bits, read sets per action,
  signals. None of these is here. The instance re-runs *all* its bindings every time (a handful,
  whatever N), skipping unchanged writes at the DOM, and nothing knows which of them read the
  field that changed. The only dependency knowledge is the one tea-local already has for the
  summaries of the sibling scenarios: a reader instance names the instances it reads (`follow`)
  and re-runs its whole list when one of them changes. Here a unit's patch is a reader of the
  earlier units it reads. That is a coarse, per-instance subscription, written by the compiler
  from the spec's `["f", name]` reads, and the same as the summaries'.
- **The honest caveat.** The compiler's choice of grain is what makes it local, and at one field
  per component it gets very close to per-field work: an event runs the patch of the unit, plus
  the patch of each unit reading it. For a flat form with cross-reads that is what the strategy
  reduces to; it is not a different mechanism, but the cost of locality here is that the
  component boundaries are drawn by the compiler (one per unit), where TEA code normally has a
  developer draw a few. That is why it is recorded as per-field granularity, and why the
  bytes below are the price of it.
- **State and reducers.** Each instance owns the slice of its unit's fields. Its reducer arms (one
  per message, written out from the message's kind and ops) only touch the slice, so no reducer
  ever copies the whole form. Message 0 of every instance is `Load`, which picks its own fields
  from a whole-state `serverSet` or `snapshot` (the global events, O(N) by nature; not held to
  locality).
- **Which instance builds which view node.** A top-level node belongs to the instance of the latest
  field it touches (reads or writes): a derived text over this field and an earlier one, a
  validation, a combined button, a `when` over an earlier field wrapping the unit's nodes. A
  unit's nodes are a run of siblings in the form, so the template is parsed in a fragment and
  appended (`unit(form, html, self)` in the frame); the element indexes in the block are those of
  the fragment's elements in document order.
- **Cross-unit bindings.** A binding reading another unit's field reads that instance's slice from
  the frame's registry (`units[3].m`) in `patch` and the reader follows it, so an event runs the
  unit's patch and the patches of the units that read it (at most 7-8 bindings read a field, the
  scenario's cap). Distance does not matter: a unit 100 positions later is as cheap as the next.
- **Combined buttons** write a field of another unit: the button's instance runs its arm for its
  own fields and sends the other instance a message of its own (`forward`); the reducer stays pure.
- **Results.** `./rr check big-component tea-local` passes at sizes 1, 4, 16, 64 and seeds 1-3,
  locality included. Calls per local action grow at most 1.3-1.6x from N=16 to 256 (or 64 to 1024)
  (`./rr work`: the first action, add to an int, costs 38 calls at every size; median 29 to 29 for
  seed 1; the slowest grower is the tick, 31 to 43 calls, and typing goes from 14 to 18). Whole-state events (`serverSet` of the form,
  `snapshot`) cost O(N), 230 to 2470 calls from 16 to 256, marked global.
- **Bytes.** Brotli totals (mean of seeds 1-3): N=1 1427, N=16 3566, N=64 7411, N=256 20771;
  fit 2027 B + 74.8 B per unit (R2 0.993). The runtime is 614-784 B and the HTML about 145 B. The
  per-instance scaffolding (a `patch`, an `instance`, the `Load` arm that repeats the field names,
  `follow` and `forward` lines) is paid N times.

### `--grain form`: the whole form as one instance (dead end)

The strategy exactly as written for the other scenarios: one model with N fields, one reducer, one
`patch` over every binding of the form. It is generated and correct (`./rr check` passes the
script at sizes 4, 16 and 64), and fails locality:

| N | 16 | 32 | 64 | 128 | 256 |
|---|---|---|---|---|---|
| calls, add to an int | 83 | 120 | 194 | 355 | 683 |
| calls, tick | 85 | 122 | 196 | 357 | 685 |

- Locality check, seed 1: 8.2x from N=16 to 256 and 13.6x from N=64 to 1024 (limit 8x;
  seeds 2 and 3: 10.7x and 10.6x at 16 to 256). Every local action costs the same, whichever
  field it touches, because the binding list is re-run whole: 83 to 683 calls, about 2.5 calls per
  unit, per event.
- It also does work the counter cannot see: every reducer arm writes `{ ...m, field: value }`
  over the form's ~1.07 N fields, a copy that grows with N. The numbers above understate it.
- Bytes: 2000 B + 68.3 B per unit (N=256: 19096 B mean, against 20771 B for `unit`). So the
  per-instance scaffolding costs 6.5 B per unit (about 9%); that is the price of passing.
- Why it lost: re-running the whole binding list of an instance is the strategy's defining trait,
  and on a form that is one component it makes work linear in the form. Nothing smaller than the
  whole form exists in it unless the compiler draws one. Passing needs the component boundaries
  the unit grain draws.

## big-table

`scenarios/big-table/tea-local.js` runs the strategy on N data tables, each with 1,000 to 11,000
rows. It is the first scenario where a component owns a list that grows with the data, not with
the app.

- **One instance per table.** The table is a TEA component: its model
  `{ rows, selected, nextId, rng }` lives in the instance's closure, an event sends a real
  message to it, its reducer (a jump table with one arm per operation and per row control,
  written out from the table's description) runs, then its binding list re-runs. Constructors
  0-2 are the external events (`serverRows`, `serverUpdate`, `serverDelete`), then the toolbar,
  then the row controls at `base + column`. A snapshot sets every instance's model.
- **The binding list has three bindings, each skipping when nothing changed:** the rows (the
  keyed list, written only if `m.rows` is not the array already on screen), each row's cells (a
  patch per row *object* that changed), and the selection marker (moved between two rows found
  by key, so O(1)). A select changes only `selected`, so it touches no row.
- **Rows are not instances (decided, with the reasons).** The strategy at the row grain would
  give every row a closure, a model and a watcher list: 10,000 of them for js-framework-benchmark's
  "create 10,000 rows", which is the case it is calibrated on. It would also scatter the data
  the table's own operations (sort, swap, `updateEvery`, `removeChecked`, `serverRows`, a
  snapshot) need whole, so each would gather and scatter across instances. The only messages that
  would gain are the row's own edits (toggle, bump): select and remove change the table's
  `selected` and membership, so in TEA they are the parent's messages anyway. A row is therefore
  a plain object in the model and a `<tr>` on the page, as the todo and feed rows of the
  dashboards. No chunking of rows into groups was tried.
- **Events:** toolbar buttons are wired by position (`wire`); the rows' controls by one
  delegated `click` listener on the table body (`rowEvents`), which sends `base + the control's
  cell index` with the row's key. One listener per table, not one per row.
- **Runtime addition:** `template/table.js` (opt-in, counted as runtime): `keyed` (rows are
  nodes, `get(id)`), `mark`, `rowEvents`. The number and date formatters, the PRNG step and the
  reducer steps of the external events are generic app helpers (`tables/frame.js`).
- **Reducer helpers use the ordinary array methods** (`findIndex`, `filter`, `some`, `map`,
  `reduce`), as the other tea-local emitters do. `./rr work` counts function calls, so the
  rows-proportional cost shows in the counts.

### Results

- `./rr check big-table tea-local` passes at sizes 1, 4, 16 and 64 with seeds 1-3, locality
  included: 1.0x from N=16 to 256 (median 498 calls at both ends). Builds are byte-identical.
- Over **N** every local action is flat (the table grows by tables, not rows); only the snapshot
  grows (27,367 to 36,071 calls, global).
- **Rows axis** (N=16, `--rows 1000` against `10000`, calls; reported, not enforced):
  - **O(1) in rows:** select (10 to 10) and swap (11 to 11). Select binds nothing to the rows
    (the marker is found by key); swap copies the array and the keyed walk finds two nodes out of
    place.
  - **O(rows):** remove (t1 1021 to 10021, t2 498 to 5040), `serverDelete` (498 to 5040),
    `serverUpdate` (1053 to 10053), `removeChecked` (1010 to 10010), `serverRows` (3647 to
    36076). Each filters or maps the rows array, then the keyed list walks every row.
  - **Toggle and bump look flat (20 to 20, 31 to 31) but are not O(1).** The action targets a row
    near the front, so `findIndex` stops after a few callbacks. The reducer still slices the rows
    array (a copy of 10,000 pointers) and the keyed list walks all rows, comparing each row object;
    neither makes a call, and the blocks count does not see the list's plain walk either. Treat
    them as O(rows) with a small constant, not as a result.
  - **Proportional by nature:** `updateEvery` (311 to 3011 in t1), create, append, sort. Clear
    is flat (11 to 11).
  - Any message that changes `rows` makes the keyed list visit every row. Rows as instances
    would remove that for toggle and bump only.
- **The keyed list moves the fewest nodes.** The runtime `list` places rows with one forward pass
  (a node already in place stays, any other is inserted before the first node not yet placed),
  which is fine for adds, removes and filters but moves every row between the two ends of a swap:
  a swap of rows 1 and 998 was 997 `insertBefore`s, 7.3 ms of script in the CPU bench. The
  table's own `keyed` (`table.js`) keeps the rows whose old positions already increase (a longest
  increasing subsequence, O(n log n)) and inserts only the others, walking from the end. A swap
  moves two nodes, an insert or a remove none. A local timing in headless Chrome (1,000 rows,
  click to settled, median of 15; `performance.now` is coarse): swap 1.3 to 0.3 ms, `serverRows`
  with two rows swapped 1.1 to 0.2 ms, alternating sorts 1.7 to 1.7 ms, `serverRows` reversed
  1.3 to 1.6 ms (a reverse moves all but one row either way, and pays the subsequence search).
- **Bytes** (brotli, mean of 3 seeds): N=1 2303, 16 6671, 64 14590, 256 41316. Fit 4265 B +
  147.5 B per table over N >= 4 (3641 + 151.1 over all sizes). Runtime 1013 B (1005 at N=1; the
  reorder added about 126 B), HTML about 145 B; the rest is app code. The per-table cost is its
  pools, row builder, row template, patch and reducer arms.
