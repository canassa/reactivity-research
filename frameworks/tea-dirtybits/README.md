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
// Dirty bits: value 1. Message tags: dec 0, inc 1, reset 2.

export const kind = [               // the kind: [reducer, DOM factory]
  [                                  // the reducer: its arms by message tag, [bits, new slice]
    ([, , , step, min], s) => [1, { value: Math.max(min, s.value - step) }],     // dec
    ([, , , step, , max], s) => [1, { value: Math.min(max, s.value + step) }],   // inc
    // … reset …
  ],
  (parent, [, , , step, min, max], id) => {   // runs once: builds the DOM
    const [, , value, dec, inc, reset] = html(
      "<section data-role=widget-counter><h2></h2><output data-role=value></output>…", parent);
    dec.textContent = "-" + step;
    onClick(dec, id, 0);                      // event → message { widget: id, type: 0 }
    // … inc, reset …
    return (s) => {                           // the static patch: its one bit needs no test
      setText(value, s.value);
      prop(dec, "disabled", s.value <= min);
      prop(inc, "disabled", s.value >= max);
    };                                        // the app runs it once with every bit (-1)
  },
];
```

- **Bits and message tags are numbers** the compiler writes in place (with their names in a
  comment), the way Elm `--optimize` tags constructors, numbered in the order the view wires
  them. External events (`tick`, `notify`, `serverSet`, `snapshot`) keep their names.
- **A reducer is a table of its arms by message tag**, as a switch over dense tags compiles to
  a jump table (an array, or an object when external events are among the tags). Each arm
  returns the compile-time bits of the fields it writes with the new slice, `[bits, slice]`, or
  nothing when the slice is unchanged; the app reducer calls the arm of the message's tag and
  writes the bits into the runtime's `dirty` table under the widget. (A unique widget's arm
  returns only the fields it writes, and the app merges them into the slice.)
- **A patch test that every possible dirty mask passes is left out**: a patch only runs with
  some of its widget's bits set, so a component with one field patches without a test.
- **The DOM is one static HTML string per component**, parsed once by `html()` (through a
  detached `<div>`, whose selected elements start with the template's root); every kind
  destructures its nodes by their position in document order. Texts that
  come from a widget's config are written by `textContent`, once. The emitter writes the
  markup as a minifier would: closing tags at the very end of a template, and the end tags HTML
  makes optional (`</p>`, `</li>`, `</option>` where the next tag closes them), are left out.
- **Events build their message once**, when they are wired (`onClick(el, id, tag, itemId)`,
  and `onCheck`, which is the same function: a checkbox toggles on its click event, which the
  keyboard fires too), or carry the control's value (`onInput`, and `onInt` for a number input, which
  sends only an integer within its bounds), like Elm's `onClick Msg` and `onInput Msg`.

A click runs, in order:

1. the handler sends its message, `{ widget: "w1", type: 0 }`, built when it was wired;
2. the app reducer calls the counter's arm for tag 0, files the bits it returned under `w1`
   and returns the new model (immutable, with structural sharing);
3. one microtask later, the app's patch calls `w1`'s patch with its bits: only the bindings
   under bit 1 run, and each one writes the DOM only when the value differs.

All widgets of one kind share one module (`src/widgets/<kind>.js`). A widget adds only its
row: its initial slice, its label and its parameters (limits, items, rules, formats). The kind's
view parses its whole section (with an empty heading); the app's build loop keys the section by
the widget's id and writes the row's label into the heading. Config
records a kind reads by position are written as tuples (a tab's `[title, content]`, an
option's `[value, label]`).

## Lists, derived values, external events

- **Keyed lists** (todo, filter, feed): rows are built once per id from their own template (the
  list sets each row's `data-key`). On
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

- **Bound elements only.** `template()` returns the root and then the elements the code
  touches, in document order, so references are dense (`t[1]`, `t[2]`…) and read alike across
  widgets. It selects `[b],[data-role],:empty`: every element with a `data-role` (the section,
  the controls, error lines, list rows) is bound, and so is every empty one (a text or a list
  the code fills; the emitter numbers an empty element even when unused). Only conditional
  blocks carry the `b` marker, which `template()` removes (as Lit removes its own). List rows
  use the same function.

- **Its own template per widget.** The handlers take the widget id from the view's `id`
  parameter, and the app's build loop keys each section: repeating the id literal on every line
  broke brotli's matches between lines that were otherwise alike (about 13 B per widget).
- **A module registers itself.** `src/widgets/<id>.js` adds `[view, reducer, initial state]`
  under its id to the registry in `widget.js` when the app imports it (in page order), so no
  binding is named per widget.
- **Numbers count up the same way in every widget:** message tags in the order the view first
  sends them (its own handlers first, in wiring order, then its list rows'), field bits in the order it first reads them, handlers wired in one run after the
  branches and lists, patch tests ordered by mask. Enum cycles are compiled to a conditional
  chain (the compiler knows the options), and property bindings go through one setter per
  property (`setValue`, `setNumber`, `setChecked`, `setDisabled`).
- **Cross-widget reads:** a reader has one extra bit per field it reads; the app patch has one
  line per read that turns the source's dirty bit into the reader's (`snapshot` and `serverSet`
  mark every bit, so readers follow).
- **`tick`:** the app reducer checks each time-driven widget's gate inline and routes only to the
  running ones, so a tick costs one reducer call per running widget (the locality check fails
  with a per-widget loop of calls).
- **Cost:** the slope is per component type, about 190 B brotli per widget (N >= 16: 182 B),
  against 25 to 31 B per widget for the dashboard, where a widget is only a row.

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

## Size pass 2 (2026-10-16)

Total brotli, medians of seeds 1 to 3 (all sizes of `runs.json`), before and after. No
`./rr work` record rose (sizes 16 to 256, seed 1; summed calls 6,954 to 6,921 and 8,740 to
8,740):

| | N=1 | N=16 | N=64 | N=256 | fit, all N | fit, N >= 16 |
|---|---|---|---|---|---|---|
| shared-components | 1,277 → 1,255 | 3,837 → 3,669 | 5,513 → 5,302 | 10,072 → 9,793 | 2,525 + 31.9 → 2,419 + 31.1 | 3,681 + 25.4 → 3,499 + 25.0 |
| unique-components | 1,702 → 1,674 | 6,543 → 6,114 | 17,854 → 16,473 | 55,109 → 50,098 | 2,836 + 209.6 → 2,758 + 190.3 | 4,474 + 200.4 → 4,299 + 181.6 |

What did not help, measured: keeping only the template elements the code uses (`pick`, a list
of positions per widget, so references count 0, 1, 2…: unique N=256 +600 B, the position lists
cost more than the indices they saved); the dashboard row's key set by the list helper instead
of each row factory, a section helper or an app-created section for unique widgets, setters in
the dashboard kinds, attribute values unquoted where HTML allows, template literals for ARIA
strings, other orders for kind pairs, row fields and kind modules (each mixed: a few bytes
lower at some sizes, higher at others; a small change also renames the minifier's short names
across the bundle, which moves brotli by ±10 B on its own). Not done, as close to the rules:
deriving dashboard ids from row order (it fits the generator's naming), dropping Vite's
modulepreload polyfill, and moving `settled` from the runtime into the excluded adapter.

## Size pass 3 (2026-10-16)

Total brotli, medians of seeds 1 to 3 (all sizes of `runs.json`), before and after. Lower at
every measured size in both scenarios. No `./rr work` record rose (sizes 16 to 256, seed 1;
summed calls 6,921 to 6,257 and 8,740 to 8,074; blocks 7,924 to 7,229 and 9,797 to 9,131):

| | N=1 | N=16 | N=64 | N=256 | fit, all N | fit, N >= 16 |
|---|---|---|---|---|---|---|
| shared-components | 1,255 → 1,199 | 3,669 → 3,592 | 5,302 → 5,222 | 9,793 → 9,760 | 2,419 + 31.1 → 2,346 + 31.2 | 3,499 + 25.0 → 3,428 + 25.1 |
| unique-components | 1,674 → 1,651 | 6,114 → 6,030 | 16,473 → 16,066 | 50,098 → 48,296 | 2,758 + 190.3 → 2,748 + 183.8 | 4,299 + 181.6 → 4,299 + 175.1 |

What changed: arms return `[bits, slice]` instead of calling `mark()` for the app to `take()`
(two calls fewer per message), and the reducer is a table of arms by tag; the app writes bits
straight into the runtime's `dirty` table (no `touch()` call); patch tests that every possible
mask passes are left out; the keyed list sets row keys; unique arms return only the fields they
write; unique templates mark their bound elements; unique tags number the widget's own handlers
first; the dashboard's sections are keyed and labelled by the app. Brotli rewarded regularity
more than raw bytes again: putting the bits first in an arm's result (`[1, {…}]`, so every arm
starts alike) saved 170 B at unique N=256 for no change in raw size.

What did not help, measured: dropping unused patch and arm parameters (`e=>` for `(e,t)=>`),
expression-bodied patches, always passing `(s, d, w)`, other orders of a unique module's triple
(view, arms, init stays best), wiring before the branches and lists, markers right after the tag
name, initial slices in bit order, a "widget being built" global instead of the id argument to
handlers (unique N=256 +450 B), merging the app's `set` into `route`, `(c, s, msg)` on every
dashboard arm, dashboard arms returning only the written fields, summary triggers written as
`dirty.w1` for one-field kinds or as `(dirty.w1 | dirty.w3) & 1`, and `parent?.append`. Most moved
results by ±10 to 40 B either way: at the dashboard's large sizes, where the rows are only data,
the size of a small change is mostly brotli's (and the HTML's hashed script name's) noise.
Marking template elements costs about 20 B at N <= 16 (the marker-removing loop) and saves
about 470 B at N=256.

## Size pass 4 (2026-10-16)

Total brotli, medians of seeds 1 to 3 (all sizes of `runs.json`), before and after. Lower at
every measured size in both scenarios. No `./rr work` record rose (sizes 16 to 256, seed 1;
calls 6,257 and 8,074, blocks 7,229 and 9,131, all unchanged record by record):

| | N=1 | N=16 | N=64 | N=256 | fit, all N | fit, N >= 16 |
|---|---|---|---|---|---|---|
| shared-components | 1,199 → 1,177 | 3,592 → 3,566 | 5,222 → 5,184 | 9,760 → 9,697 | 2,346 + 31.2 → 2,324 + 31.1 | 3,428 + 25.1 → 3,400 + 25.0 |
| unique-components | 1,651 → 1,637 | 6,030 → 6,012 | 16,066 → 15,988 | 48,296 → 48,186 | 2,748 + 183.8 → 2,724 + 183.4 | 4,299 + 175.1 → 4,261 + 174.7 |

What changed: unique templates select `[b],[data-role],:empty`, so only conditional blocks
keep a marker (this also removes round 3's marker cost at small sizes); templates are parsed in
a detached div and selected from it, so the root comes first and no spread is needed; a branch
reads its state from its anchor; the dirty table is no longer reset when a program starts; the
three dashboard kinds that indexed their nodes destructure them like the others; the counter's
tags follow its wiring order.

What did not help, measured over 12 seeds (single changes move brotli by ±30 B per build, so
3 seeds cannot judge them): handing a unique view its template's elements from the app
(+600 B at N=256: the patch can no longer reuse the view's parameter names); list rows built by
the list from their markup; branch and list handles kept in the template array instead of
locals (+2 KB at N=256); patch statements sorted by helper; `value += ""` in `setText`;
`"" + x` for `String(x)` in the dashboard kinds; indexing every dashboard kind's nodes (+15 B
per build); `Math.min(s.x + k, max)` operand order; the rating's buttons from `Array.from`;
choice options by `forEach`; `parent?.append`. Close to the rules, not done: event delegation
by `data-role` (it would leave a widget's handlers as attributes for a generic routine).

## big-component

The emitter for `big-component` (`scenarios/big-component/tea-dirtybits.js`) has the same
strategy with one widget of about N fields, which does not fit the one integer of bits the other
two scenarios use (bitwise operators are 32-bit). What it adds:

- **Dirty words.** A widget's fields are numbered in the order its view first reads them; field
  `g` is bit `g % 31` of word `g / 31`. The widget's dirty set is a sparse array of words
  (`dirty.w1[k]`), and an arm marks its fields at compile time as `[word, bits, word, bits…]`
  (the app ORs them in). Adjacent units sit in the same word, and a binding reads at most the
  previous 6 units, so nearly every binding reads one word.
- **A patch per word.** The view returns an array of static patches, one per word, each with
  the tests of its own bindings. The app runs `patches[id][k]` only for the words set, so an
  event costs the bindings of one word (31 fields), not of the form. A group of bindings that
  reads two words (a derived text across a word boundary, a section spanning one) is a
  function that the patch of each word it reads calls behind a test of both words; running it
  twice when both are dirty is harmless, as every write is guarded.
- **Nested patches test the same words** (`d[k] & bits`); `src/words.js` (new in `template/`,
  included only here, counted as runtime) holds `ALL`, the array of full words (what
  `serverSet`, `snapshot` and a section shown again pass), and a `branch` that passes it.
- **Cross-widget reads:** the companion reads three fields of the form; the app patch has one
  line per read that turns the form's word bit into the companion's.
- **Locality:** calls per local action are flat from N=16 to 256 (1.00 ratio, 12 to 23 calls);
  only the whole-state actions (`snapshot`, `serverSet` of the form) grow, as they must.

## big-table

The emitter for `big-table` (`scenarios/big-table/tea-dirtybits.js`) keeps the strategy with rows
as dynamic data. What it adds: `template/grid.js` (the keyed grid, its bit-driven patch and the row
template cloner: generic machinery, counted as runtime), and `template/rows.js` (the reducers' row
edits) and `template/format.js` (number and date formats), which are scenario code and count as
app, as every js-framework-benchmark entry ships its own helpers. All three are included only here:

- **Dirty bits.** A table's own: rows 1, selected 2, gone 4, moved 8, added 16. A row's cells:
  one bit per data column from 32 up, in the same word. An arm returns `[bits, fields, payload]`.
  The bits are compile-time constants; the payload is a **delta side-channel**: the list of rows
  the event touched (ids for gone and moved, row objects for added and edited cells), filed under
  the table for the next patch. It is not state the patch reads: the patch applies the one column
  word to each listed row, and the model stays the reference's shape.
- **What each action does.** Select marks the old and the new row (by id); remove drops one node;
  swap moves two; append builds the new rows; toggle, bump and `updateEvery` call the row's static
  patch with the column bit of the cell they wrote (a computed cell tests every column its
  expression reads). Create, sort, clear and `serverRows` run the keyed reconcile of the whole list
  (bit 1: new rows built, changed items patched, gone rows removed, one walk moves misplaced nodes).
- **Two events in one tick fall back to a full O(rows) reconcile.** A table already dirty gets
  bit 1 filed with the second event, because one payload cannot describe both.
- **A row is one cloned template**, its record `[tr, item, …bound cells]`, its patch a static
  function with a test per cell. Events are delegated: one click listener per table, a switch on
  `data-role`. A row's control sends `{table, type, id}`; the arm finds the row with `findIndex`
  and does nothing if it is gone (a stale click in the same tick).
- **External events** (`serverRows`, `serverUpdate`, `serverDelete`) are handled in `app.js`
  (they name no column); the snapshot handler assumes every table is present, as the reference
  state always has them.
- **Rows axis** (N=16, 1,000 to 10,000 rows; `./rr work`, calls and blocks):
  - **O(1) in the rows' DOM work:** select, swap, and the DOM side of remove, toggle and bump
    (one node or one row's cells).
  - **O(position) in the reducer:** remove, toggle, bump and select find the row with
    `findIndex`, so they cost the row's index. The work actions pick rows near the start
    (index 1 to 7), which is why their counts (17 to 28 calls) do not move between 1,000 and
    10,000 rows; a row near the end would cost proportionally more. Remove, toggle, bump and swap
    also copy the rows array (`toSpliced`, `with`, `slice`), natively and O(rows).
  - **O(rows):** `serverUpdate` (1,767 to 28,890 calls: the message names an id that does not
    exist, so `findIndex` scans everything), `serverDelete` and `removeChecked` (`filter`),
    `updateEvery`, create, append, clear, sort and `serverRows`.

## routed-app

The emitter for `routed-app` (`scenarios/routed-app/tea-dirtybits.js`) keeps the strategy and adds
**lifetime**: only the shell and the page shown (with its open tab and modal) are built, and
anything left is disposed. The critique's weakness 2 (`notes/2026-10-16-tea-inline-critique.md`) was
that a component built eagerly stays subscribed for ever; here a page is a unit that mounts and
unmounts. What it adds is a new `template/routes.js` (counted as runtime, included only here): the
generic `slot`, and a `program` that wraps the runtime's loop so that `dispose` runs the stop which
`view` returns (the adapter is the standard one, importing `program` from `./routes`). The model's
shape, the reference's id rule and the message of a link are app code, `src/model.js`.

- **A page is a unit.** `src/pages/<id>.js` registers `[mount, reducer, initial local state]`. `mount()`
  builds the page from one static template and returns `[root, patch, stop]`. The model has the
  reference's shape, `{ route, menu, global, page: { fields, tab, panel, modal } }`; navigation replaces
  `page` with the next page's initial state, so local state resets on its own.
- **`slot(place, mount)`** is the whole lifetime machinery: `update(key, s, d, m)` mounts the unit
  when the key appears (patching it with every bit), patches it with the event's bits while the key
  stays, and, when the key changes, runs the unit's `stop` and removes its root. The shell has two
  slots (the page, keyed by `route`; the "All pages" menu, keyed by `menu`), a page has one for its
  tab panel (keyed by the active tab) and one for its modal (keyed by "open"). A time-driven field
  starts one `setInterval` in its unit's mount and the unit's `stop` clears it (a page's stop also
  stops its tab slot). A tick is a message to the page's reducer.
- **One dirty word, no mapping.** `dirty.a` holds, in bits 0 to 5, the six global fields (the same
  numbers in every page), then the page's own fields, its tab bit, the fields of its tab panels (all
  panels share the same bits, since one is mounted at a time) and the modal's. A global write marks
  its bit in that word, and a page patch tests its global reads like any other bit, so a global
  field no mounted unit reads costs one failed test per binding of the page shown, and a page that is
  not mounted has no patch at all. `dirty.n` holds the shell's route and menu bits.
- **Reducers.** One table per page for the page, its tabs and its modal, by tag; an arm returns
  `[bits, model]`, written with four setters (`setF`, `setP`, `setM`, `setG`) and the moves of the
  local state (`putModal`, `putTab`). `pagePush` is a named arm and reaches only the page shown.
- **Menu.** A static template of every page's entry, parsed when the menu opens and removed when it
  closes or on navigation: the one O(N) part, which the locality check marks global.
- **Same-task events (stale handlers).** A unit is removed at the microtask patch, so until then its
  handlers can still send. Two guards, both decided at compile time: (1) *ownership* - every message
  of a page carries its page id (`widget`, the runtime's event shape) and the app reducer drops one
  whose id is not the route; tab arms and ticks test `m.page.tab === "t1"`, modal arms test
  `m.page.modal`, like matching on `(msg, model.page)` in Elm; (2) *generation keys* - a counter
  in the model (`gen` for navigation, the page's `t` for a tab selected, `o` for a modal opened)
  is the key of the unit's slot, so leaving and re-entering a unit before the patch (deepLink p2 then
  p1, tab A to B to A, modal closed then opened) still builds it again with fresh state. Without
  (2) the DOM kept the old fields while the model had the initial ones; without (1) an arm ran on
  another unit's fields (a TypeError) or created a ghost modal. Tested by firing both events in one
  task: navigate then click the old page, tab switch then click the old panel, modal close then
  type, navigate then a clock tick, deepLink p2 then p1, tab A to B to A, modal close then open.

## derived-graph

The emitter for `derived-graph` (`scenarios/derived-graph/tea-dirtybits.js`) keeps the strategy for
a sheet of N formulas over inputs and a table of items, whose cells read each other. What it adds:
`template/graph.js` (`touch`, `markAll`, the sweep and the numbered-message events: about 400 B
brotli, counted as runtime), included only here. Everything tied to the scenario is generated and
counts as app: the formulas and displays, the formats, the collection helpers, the top-k and group
lists and the items table (big-table's keyed grid with this scenario's bit layout).

- **A bit per cell.** Every formula, display and input control is a cell, numbered (`g`) so each
  comes after the cells it reads: a unit's controls, its formula, its displays. The dirty set is
  an array of 31-bit words (bit `g % 31` of word `g / 31`), as in big-component. Cell `g` is a
  closure in one table, built once with the DOM, so the number is its position and no cell has
  a name (inputs keep string keys in `IN`/`CTRL`, formulas are named variables).
- **Arms mark readers.** A control sends a numbered message and its arm returns the new state with
  the input changed (`set`). The bits it marks are the compile-time numbers of the cells that read
  that input (`IN[name]`: the formulas, displays and controls reading it), so no pass finds
  readers at run time. `serverInputs` goes through the same `set` per named input.
- **A flush is one ascending sweep over the marked range.** `touch` and `markAll` record the lowest
  and highest word marked, and `sweep` visits only those, taking the lowest set bit of each word in
  turn and running that cell with the model. Marks only point to higher cells (a reader is always after its
  source), so one pass settles the graph and no cell runs twice.
- **Propagation is dynamic, value-gated and push-based:** which readers run depends on whether the
  value changed, and a source marks its readers. The reader lists are compile-time; the decision is
  not.
- **A derived value is computed once and stored.** A formula is a module-level `let` plus its cell
  function (a cache outside the model, which keeps the reference's shape): recompute from the model and the stored values of the cells it reads, compare with the
  stored value and, only when it differs, mark its readers (`touch([…])`, written out per formula).
  Its readers read the variable. A display reads the variables it shows and writes a guarded text.
- **The unchanged-value case.** A formula whose value did not change marks nothing, so its readers
  do not run (the cut-off input's bool, a count that stays). Numbers, booleans and words compare by
  `!==`; a filtered list compares its items by identity (an edit of an item outside the list leaves
  its readers alone); a top-k list whose key reads only item fields compares like a list (items are
  immutable, so the same items have the same keys). A top-k list whose key reads a scalar cell, and
  a group sum, are taken as changed every time they are recomputed (their displays then rewrite
  equal texts, guarded): the same items can have new keys, and a group is a new object each time.
- **Same-value writes still rewrite the controls.** `set` touches the input's controls (`CTRL`)
  even when the value is unchanged, so a number input holding invalid typed text shows the value
  again after `serverInputs` or a raise clamped at its maximum. A snapshot forces the fill of every
  row (bit 2), so typed text in a quantity does not survive it.
- **Items are data with compile-time bits too.** The emitter knows which fields each formula reads
  (an item expression's `i.qty`), so an edit of a quantity marks the formulas that read quantities
  (`M_QTY`), the active flag marks those that read it (`M_ACTIVE`), a note marks none, and load,
  add, remove and `serverItems` mark every formula that reads the items (`M_ITEMS`). A formula
  that is a list holds item objects, so it is also refreshed by the fields its readers read
  through it (otherwise they would read stale items). Aggregates recompute in full (no incremental
  sums), so an item edit costs O(rows) per aggregate that reads the field.
- **The table is big-table's.** One cloned template per row, patched by column bits (quantity,
  active, note, markup); the markup is a bit every row tests; add, remove and edits patch the rows
  they touched; load, `serverItems` and the snapshot reconcile the keyed rows. Events are delegated.
- **Honest limits.** The sweep still walks the words between the lowest and the highest one marked
  (at most N/31 loop steps, no calls); a local action whose cells sit far apart pays for the gap.
  The cell numbers are global to the sheet (adding a unit shifts nothing, since units are appended). The analysis is easy because the
  formulas are a closed vocabulary, as with tea-inline (critique, weakness 1). `serverItems` marks
  every formula over the items even when only a price changed.
