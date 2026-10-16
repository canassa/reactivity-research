# tea-dirtybits (prototype)

A rendering strategy that no framework ships yet. It comes from beni PR #180 ("strategy B,
static reactivity"): the output of a TEA (The Elm Architecture) compiler that **keeps messages
and the reducer**. The emitter plays the compiler, so it is reported on the prototype track.

**The idea in one line:** each reducer arm marks compile-time dirty bits for the fields it
writes, and a static patch runs only the DOM bindings behind those bits. There is no virtual
DOM and no dependency tracking at runtime.

## From a click to the DOM

The TEA source a developer would write for a counter:

```js
update(msg, s) = case msg of
  Inc -> { s | value = min max (s.value + step) }
  Dec -> { s | value = max min (s.value - step) }

view(s) = section [ output [ text s.value ]
                  , button [ onClick Dec, disabled (s.value <= min) ] [ text "-" ]
                  , button [ onClick Inc, disabled (s.value >= max) ] [ text "+" ] ]
```

What this strategy emits, once per widget kind and configured per widget (`c`):

```js
export const VALUE = 1;                       // one bit per model field

export function update(c, s, msg) {
  switch (msg.type) {
    case "inc": mark(VALUE); return { value: Math.min(c.max, s.value + c.step) };
    case "dec": mark(VALUE); return { value: Math.max(c.min, s.value - c.step) };
  }
  return s;
}

export function view(parent, c, s, send) {    // runs once: builds the DOM
  const root = section(parent, c, "counter");
  const value = text(element(root, "output", "value"), "");
  const dec = element(root, "button", "dec");
  on(dec, "click", () => send({ widget: c.id, type: "dec" }));   // event → message
  // … inc …
  const patch = (s, dirty) => {               // the static dispatch
    if (dirty & VALUE) {
      setText(value, s.value);
      prop(dec, "disabled", s.value <= c.min);
      prop(inc, "disabled", s.value >= c.max);
    }
  };
  patch(s, -1);                               // first render: every bit
  return patch;
}
```

A click runs, in order:

1. the handler builds `{ widget: "w1", type: "inc" }` and calls `send`;
2. the app reducer routes it to the counter's `update`, files the marked bits under `w1` and
   returns the new model (immutable, with structural sharing);
3. one microtask later, the app's patch calls `w1`'s patch with its bits: only the bindings
   under `VALUE` run, and each one writes the DOM only when the value differs.

All widgets of one kind share one module (`src/widgets/<kind>.js`). A widget adds only its
config (label, limits, items, rules, formats) and its slice of the initial model.

## Lists, derived values, external events

- **Keyed lists** (todo, filter, feed): rows are built once per id. On a patch, rows whose item
  changed are patched in place; if the order of nodes changed (add, remove, reorder) the full
  keyed reconcile runs, with Solid 2's `reconcileArrays` (vendored unmodified, MIT).
- **Derived values:** a summary reads other widgets. The compiler knows which fields it reads,
  so the app's patch recomputes it only when one of those bits is set:

  ```js
  if (dirty.w1 & counter.VALUE || dirty.w7 & clock.SECONDS) patches.w8(w);
  ```

- **External events** go through the same `send` and reducer. `tick` and `notify` are reducer
  arms of the clock and the feed; `serverSet` and `snapshot` replace whole slices and mark all
  their bits, so lists fall back to the keyed reconcile and keep their nodes.

The adapter (`template/adapter.js`, excluded from size) maps `mount`, `dispatch`, `settled` and
`dispose` onto the runtime's `program`, `send`, pending microtask and root clearing.

## Expected trade-off

- **Baseline:** small. The runtime (`template/runtime.js`, `reconcile.js`) is DOM helpers, the
  bit bookkeeping and the keyed list, about 1.3 KB brotli with every kind present, and less in
  apps without lists.
- **Slope:** per widget only a config object and an initial state, as with a component
  framework. Per kind, the code is explicit: the DOM is built by `createElement` calls and every
  binding is written out, where a template-cloning compiler would ship HTML strings. A new kind
  of widget is likely to cost more than in Solid; a new instance about the same.
- **Limits:** bits are per field, so a write to one list item marks the whole list (the keyed
  diff then finds the row). More than 31 fields in one component would need a second word.

## Files

- `framework.js`: the build (plain Vite, no framework plugin, hidden source maps) and byte
  attribution: `src/runtime.js` and `src/reconcile.js` count as runtime, `src/adapter.js` as
  adapter, the rest as app.
- `template/`: the HTML shell, the Vite config, the adapter and the runtime, copied into every
  app.
- `../../scenarios/shared-components/tea-dirtybits.js`: the emitter (the "compiler") for the dashboard.
