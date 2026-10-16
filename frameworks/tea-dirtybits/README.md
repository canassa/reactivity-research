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

What this strategy emits, once per widget kind and configured per widget by its row
(`[kind, initial state, label, step, min, max, start]`, destructured by position):

```js
// Dirty bits: value 1. Message tags: inc 0, dec 1, reset 2.

function update([, , , step, min, max, start], s, msg) {
  switch (msg.type) {
    case 0: mark(1); return { value: Math.min(max, s.value + step) };   // inc
    case 1: mark(1); return { value: Math.max(min, s.value - step) };   // dec
    // … reset …
  }
  return s;
}

function view(parent, [, , label, step, min, max], id) {   // runs once: builds the DOM
  const [, , value, dec, inc, reset] = section(parent, id, label, "counter",
    "<output data-role=value></output><button data-role=dec></button>…");   // static template
  dec.textContent = "-" + step;
  onClick(dec, id, 1);                        // event → message { widget: id, type: 1 }
  // … inc, reset …
  return (s, d) => {                          // the static patch
    if (d & 1) {
      setText(value, s.value);
      prop(dec, "disabled", s.value <= min);
      prop(inc, "disabled", s.value >= max);
    }
  };                                          // the app runs it once with every bit (-1)
}
```

- **Bits and message tags are numbers** the compiler writes in place (with their names in a
  comment), the way Elm `--optimize` tags constructors. External events (`tick`, `notify`,
  `serverSet`, `snapshot`) keep their names.
- **The DOM is one static HTML string per component**, parsed once by `html()` (through a
  `<template>` element); the code finds each node by its position in document order. Texts that
  come from a widget's config are written by `textContent`, once.
- **Events build their message once**, when they are wired (`onClick(el, id, tag, itemId)`,
  `onCheck`), or carry the control's value (`onInput`, and `onInt` for a number input, which
  sends only an integer within its bounds), like Elm's `onClick Msg` and `onInput Msg`.

A click runs, in order:

1. the handler sends its message, `{ widget: "w1", type: 0 }`, built when it was wired;
2. the app reducer routes it to the counter's `update`, files the marked bits under `w1` and
   returns the new model (immutable, with structural sharing);
3. one microtask later, the app's patch calls `w1`'s patch with its bits: only the bindings
   under bit 1 run, and each one writes the DOM only when the value differs.

All widgets of one kind share one module (`src/widgets/<kind>.js`). A widget adds only its
row: its initial slice, its label and its parameters (limits, items, rules, formats).

## Lists, derived values, external events

- **Keyed lists** (todo, filter, feed): rows are built once per id from their own template. On
  a patch, new rows and rows whose item changed are patched; rows whose id is gone are removed,
  and one walk over the rest moves only the nodes out of place. (Solid 2's `reconcileArrays` did
  this until it was replaced: these lists only append, remove and filter, and it cost about
  500 B brotli of baseline.)
- **Conditional content** (validation errors, panel bodies, `when` sections) is part of the
  template and built once; `branch` swaps it for an empty comment while hidden and, when it
  shows again, runs its nested patch with every bit.
- **Derived values:** a summary reads other widgets. The compiler knows which fields it reads,
  so the app's patch recomputes it only when one of those bits is set:

  ```js
  if (dirty.w1 & 1 || dirty.w7 & 1) patches.w8(w);   // counter.value, clock.seconds
  ```

- **External events** go through the same `send` and reducer. `tick` and `notify` are reducer
  arms of the clock and the feed; `serverSet` and `snapshot` replace whole slices and mark all
  their bits, so lists fall back to the keyed reconcile and keep their nodes.

The adapter (`template/adapter.js`, excluded from size) maps `mount`, `dispatch`, `settled` and
`dispose` onto the runtime's `program`, `send`, pending microtask and root clearing.

## Expected trade-off

- **Baseline:** small. The runtime (`template/runtime.js`) is the loop, the bit bookkeeping,
  the template parser, event wiring, guarded writes, `branch` and the keyed list: about 800 B
  brotli with every kind present (Vite's modulepreload polyfill, about 270 B, included).
- **Slope:** per widget only its row (initial state, label, parameters), as with a component
  framework. Per kind, a template string plus every binding written out.
- **Limits:** bits are per field, so a write to one list item marks the whole list (the keyed
  diff then finds the row). More than 31 fields in one component would need a second word.

## Files

- `framework.js`: the build (plain Vite, no framework plugin, hidden source maps) and byte
  attribution: `src/runtime.js` counts as runtime, `src/adapter.js` as
  adapter, the rest as app.
- `template/`: the HTML shell, the Vite config, the adapter and the runtime, copied into every
  app.
- `../../scenarios/shared-components/tea-dirtybits.js`: the emitter (the "compiler") for the dashboard.

## unique-components

The emitter for the `unique-components` scenario (`scenarios/unique-components/tea-dirtybits.js`)
uses the same strategy with no shared kinds: every widget is its own module
(`src/widgets/<id>.js`) with its own bits (one per field), reducer (one arm per message, the ops
written out as code), initial state, DOM factory and static patch, all written from that widget's
description. Nothing is interpreted at runtime. What it adds:

- **Its own template per widget.** The section's `data-key` and the handlers take the widget
  id from the view's `id` parameter: repeating the id literal on every line broke brotli's
  matches between lines that were otherwise alike (about 13 B per widget).
- **Cross-widget reads:** a reader has one extra bit per field it reads; the app patch has one
  line per read that turns the source's dirty bit into the reader's (`snapshot` and `serverSet`
  mark every bit, so readers follow).
- **`tick`:** the app reducer checks each time-driven widget's gate inline and routes only to the
  running ones, so a tick costs one reducer call per running widget (the locality check fails
  with a per-widget loop of calls).
- **Cost:** the slope is per component type, about 210 B brotli per widget (N >= 16: 200 B),
  against 25 to 32 B per widget for the dashboard, where a widget is only a row.

## Size pass (2026-10-16)

Total brotli, medians of seeds 1 to 3 (`./rr measure`, sizes from `runs.json`), before and
after. No `./rr work` count rose (summed calls 8,240 to 6,954 and 11,763 to 8,740):

| | N=1 | N=16 | N=256 | fit, all N | fit, N >= 16 |
|---|---|---|---|---|---|
| shared-components | 1,352 → 1,277 | 4,880 → 3,837 | 11,703 → 10,072 | 3,147 + 36.6 → 2,525 + 31.9 | 4,681 + 27.9 → 3,681 + 25.4 |
| unique-components | 1,923 → 1,702 | 8,689 → 6,543 | 73,975 → 55,109 | 3,590 + 282.3 → 2,836 + 209.6 | 5,567 + 271.2 → 4,474 + 200.4 |

What did not help, measured: destructuring each template's nodes into named locals instead of
`t[i]` (unique N=256 +1.9 KB: varying names compress worse than the repeated `t[`); one factory
for `onClick` and `onCheck` (+12 B at N=1: the duplicate compresses to almost nothing). Not
tried, because each would add a call per event: a shared `cycle` helper for enum ops, a
per-widget `send` wrapper. Vite's modulepreload polyfill stays, as in every Vite setup here.
