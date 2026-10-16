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
const Inc = [0], Dec = [1];

function update(model, msg, c) {          // the reducer, kept as written
  switch (msg[0]) {
    case 0: return { value: Math.min(c.max, model.value + c.step) };
    case 1: return { value: Math.max(c.min, model.value - c.step) };
  }
}

export function counter(parent, c, model) {
  const self = instance(model, update, patch, c);  // the model lives in this closure
  const root = widget(parent, c, "counter", self); // DOM built once
  const value = element(root, "output", null, " "); // a dynamic text: a placeholder node
  const dec = element(root, "button", null, "-");
  on(dec, "click", () => self.send(Dec));          // the event goes to this instance only
  // …
  function patch() {                               // this instance's binding list
    const m = self.m;
    setText(value, m.value);                       // skipped if the text is unchanged
    setProp(dec, "disabled", m.value <= c.min);    // skipped if already equal
  }
  return self;                                     // instance() scheduled the first patch
}
```

`send` is tiny and lives in the runtime:

```js
send: (msg) => set(update(self.m, msg, config)),
set(next) { if (next !== self.m) { self.m = next; schedule(patch); /* + watchers */ } },
```

`schedule` collects patches in a `Set` and runs them in one microtask, so several messages
cost one patch. There are no dirty bits, no dependency tracking, and no comparison of
anything except the final DOM values.

Each widget is one call with its own config and initial model:

```js
const w1 = counter(main, { id: "w1", label: "Design tickets", step: 5, min: 0, max: 20, start: 0 }, { value: 0 });
```

## Lists, summaries and external events

**Keyed lists** (`todo`, `filter`, `feed`) use the runtime's `list(parent, row)`, keyed by
`item.id` (which it writes as the row's `data-key`). Each patch walks the new items by key. A
row whose item object changed is patched in place, and a new key builds a detached row. If the
sequence of rows changed (an add, a remove, filtering, a reorder), the rows that left are
removed and one forward pass places the rest: a node already in place stays, any other is
inserted before the first node not yet placed. That moves nothing for adds, removes and
filtering, and all but one node of a reversed run, like the Solid 2 `reconcileArrays` it
replaced (vendored until October 2026, about 480 B brotli); its worst case is a rotation,
which moves every node but one. The PR's array edit journal, which comes from beni's owned
lists, is left out: the first pass already skips unchanged rows.

**Summaries** read other widgets' state. A summary instance subscribes to the instances it reads
(`source.watch(patch)`). When one of their models changes, for any reason, the summary's patch
is scheduled in the same flush. It recomputes its line from the sources' current models:

```js
summary(main, { id: "w8", label: "…", text: (m3, m6) => `Total: ${m3.value + m6.value}` }, [w3, w6]);
```

**External events** go from the adapter's `dispatch` to `App.receive`, which routes them:

| Event | Becomes |
|---|---|
| `serverSet` | `widgets[id].set(state)`: the instance's model is replaced |
| `snapshot` | `set` on every instance, each with its own new model |
| `tick` | the clock's own `Tick` message, sent to each clock instance |
| `notify` | the feed's `Notify entry` message, sent to that feed |

`settled()` is the microtask flush. `dispose()` removes the dashboard's element: every listener
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
component type. Nothing is shared per kind, so each widget gets its own module: its initial
model, a reducer with one `case` per message (written out from the message's kind and ops, never
interpreted), and a factory with its own static template, event wiring and `patch` (derived
texts become template literals). The template is the widget's markup as one string (trailing
end tags left out, as Solid's compiler does); `widget()` puts it in the section and returns its
elements in document order, which the factory addresses as `e[3]` (indexes compress better than
names, measured). Events send messages through `onSend(node, self, msg)` (Elm's `onClick msg`),
`onValue(node, self, tag)` (`onInput Tag`) and `onInt` (a number input decoded as a bounded
integer). Only generic helpers are shared: this runtime and a small
`widgets/frame.js` (the widget frame, placing conditional content before its next attached
sibling, next item id).

- A cross-widget read is a factory parameter: the reader watches the earlier widget's instance.
- A time-driven int is a subscription, like Elm's `subscriptions`: while its gate is on, the
  widget's `patch` puts its `tick` in a shared `running` set, and the app's `tick` event calls
  only those. Otherwise `tick` would cost one call per widget and fail the locality check.
- `notify` is a method of the widgets that have a feed; `serverSet` and `snapshot` use `set`.
- The slope is the per-component code: model, reducer, DOM creation and bindings.
