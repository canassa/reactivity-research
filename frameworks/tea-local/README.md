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
  const dec = element(root, "button", null, "-");
  on(dec, "click", () => self.send(1));               // Dec, to this instance only
  // …
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
and initial model; the widget frame keeps the instance in a registry by id, so the app keeps
nothing. Widget ids are `w1`, `w2`, … in page order (the emitter checks it), so the frame
takes the next one from its registry's size (emptied on dispose) and the app does not spell
them (tea-inline numbers its widgets the same way):

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
lists, is left out: the first pass already skips unchanged rows.

**Summaries** read other widgets' state. A summary subscribes to the instances it reads,
named by id (`widgets.get(id).watch(patch)`). When one of their models changes, for any reason,
the summary's patch is scheduled in the same flush. It recomputes its line from the sources'
current models (a term read once is written in place; a breakdown, which shows each term and
their total, names them):

```js
summary(main, "…", (m3, m6) => `Total: ${m3.value + m6.value}`, ["w3", "w6"]);
```

**External events** go from the adapter's `dispatch` to `App.receive`, which routes them:

| Event | Becomes |
|---|---|
| `serverSet` | `widgets.get(id).set(state)`: the instance's model is replaced |
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
component type. Nothing is shared per kind, so each widget gets its own module: a factory with
its initial model and its own reducer table in its `instance` call (one arm per message,
written out from the message's kind and ops, never interpreted), its own static template and
`patch` (derived texts become template literals; a cycled enum's next option is a chain of
comparisons over its options, as tea-inline compiles it). The template is the widget's markup
as one string (trailing end tags left out, as Solid's compiler does); `widget()` inserts it
with its section in one `insertAdjacentHTML` (the app's dashboard comes from markup too, so
unique apps ship no `element()`) and returns its elements in document order, which the
factory addresses as `e[3]` (indexes compress better than names, measured). Only generic
helpers are shared: this runtime and a small `widgets/frame.js` (the widget frame and its
registry, list rows, conditional content, next item id, subscriptions).

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
- **The frame registers every instance by id**, numbering widgets in page order (`w1`, `w2`,
  …, checked by the emitter): the app calls each factory without keeping what it returns, and a
  cross-widget reader takes the earlier widget's instance from the registry
  (`const w3 = widgets.get("w3")`) right after its `patch`, watches it and reads its model in
  `patch`.
- A time-driven int is a subscription, like Elm's `subscriptions`: while its gate is on, the
  widget's `tick` is in a shared `running` set, and the app's `tick` event calls only those.
  Otherwise `tick` would cost one call per widget and fail the locality check. An app routes
  `tick` only if it has such a widget, and `notify` only if it has a feed.
- `notify` is a method of the widgets that have a feed; `serverSet` and `snapshot` use `set`.
- The slope is the per-component code: model, reducer, template, event tags and bindings.
