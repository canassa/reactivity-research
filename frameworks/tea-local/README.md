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
  const self = instance(c, model, update, patch);  // the model lives in this closure
  const root = widget(parent, c, "counter");       // DOM built once
  const value = text(element(root, "output"));
  const dec = element(root, "button", null, "-");
  on(dec, "click", () => self.send(Dec));          // the event goes to this instance only
  // …
  function patch() {                               // this instance's binding list
    const m = self.model();
    setText(value, m.value);                       // skipped if the text is unchanged
    setProp(dec, "disabled", m.value <= c.min);    // skipped if already equal
  }
  patch();
  return self;
}
```

`send` is tiny and lives in the runtime:

```js
send: (msg) => set(update(model, msg, config)),
set(next) { if (next !== model) { model = next; schedule(patch); /* + watchers */ } },
```

`schedule` collects patches in a `Set` and runs them in one microtask, so several messages
cost one patch. There are no dirty bits, no dependency tracking, and no comparison of
anything except the final DOM values.

Each widget is one call with its own config and initial model:

```js
const w1 = counter(main, { id: "w1", label: "Design tickets", step: 5, min: 0, max: 20, start: 0 }, { value: 0 });
```

## Lists, summaries and external events

**Keyed lists** (`todo`, `filter`, `feed`) use the runtime's `list(parent, key, row)`. Each
patch walks the new items by key. A row whose item object changed is patched in place, and a
new key builds a detached row. If the sequence of rows changed (an add, a remove, filtering, a
reorder), Solid 2's `reconcileArrays` moves the nodes. It is vendored unchanged, MIT, in
`template/reconcile.js`. The PR's array edit journal, which comes from beni's owned lists, is
left out: the first pass already skips unchanged rows.

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

- **Small baseline.** The runtime is about 1.3 kB brotli at full catalogue, with the keyed
  reconcile included. There is no reactive graph, scheduler or component system to ship.
- **The slope follows the source.** The per-widget cost is the widget's config, its initial
  model and one factory call, which should be close to what a hand-written vanilla app with
  shared components carries. The reducers and binding lists are paid once per kind.
- **Re-running a whole binding list costs CPU.** Every message to a widget recomputes all its
  bindings, including the filtering of a list. That is cheap for widget-sized components but
  would grow with big components. A summary re-runs on every change to any source.
- **It depends on the compiler sharing factories per kind.** Without that sharing, the PR
  measured a 10× gap to vanilla.
