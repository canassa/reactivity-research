# digest (prototype)

A rendering strategy that no framework ships as such: the output an ideal compiler would produce
for **compiled dirty checking**. It sits in the prototype track.

**The idea in one line:** state is plain mutable data. Every dynamic DOM property is a closure,
kept in its widget's binding list. After an event, a local digest runs the list of the widget
the event touched, and writes the DOM only where a value changed. There is no dependency
tracking, no virtual DOM and no scheduler.

It is AngularJS's digest loop, but compiled and scoped to one widget: the compiler writes the
watchers as direct property writes, and the per-instance constants become rows of data. (The
first version digested the whole page after every event. That is now a dead end: see
[Locality](#locality).)

## How it works

### A widget kind compiles to one factory

The compiler sees the app's description (each kind's state, messages and view) and emits **one
factory per widget kind** that the app uses. The factory holds the kind's template, its bindings
and its handlers. Here is the counter, as `scenarios/shared-components/digest.js` emits it:

```js
const counter = (s, l, st, mn, mx, v0) => {
  s.value = v0;                                    // initial state
  widget("counter", l, `<output data-role=value></output><button data-role=dec>-${st}</button>…`, [
    () => s.value = Math.max(mn, s.value - st), // dec: the update arms, one per control,
    () => s.value = Math.min(mx, s.value + st), // inc  in the template's document order
    () => s.value = v0, // reset
  ]);
  text(1, () => s.value);                          // view: one binding per dynamic property,
  bind(2, "disabled", () => s.value <= mn);        // on the template's element at that position
  bind(3, "disabled", () => s.value >= mx);        // (0 is the heading)
};
```

**Handlers go to controls by position, and bindings name elements by position.** The compiler
knows the template, so it writes the handlers in the order of the template's controls (its
buttons, inputs and selects), and `widget()` hands them out in that order (`c.h = h[i]`, the
way Solid stores `$$click` on the element). A binding names its element by its index in the
template. Neither needs a `data-role` lookup or repeats a role name in the code; the
`data-role` attributes stay in the template, where the contract wants them. Where a template
repeats a control (toggles, tabs, rating stars), the factory computes the positions from the
stride (the i-th checkbox of toggles is element 4 + 3i).

**Each instance is one row of data:** the factory, then the instance's constants and initial
state. The app is the table of rows in page order:

```js
export default app([
  [counter, "Design tickets", 5, 0, 20, 0],
  [field, "Office tag", "Your tag", "[^]{5}", "Needs 5 or more characters", ""],
  [amount, "Fleet deposit", 1, "", " kg", 85],
  …
], receive);
```

**The compiler partially evaluates the rules into data:**
- every field rule becomes one regular expression: `required` becomes `\S`, and `minLength 5`
  becomes `[^]{5}`;
- every amount format becomes a prefix, a number of decimals and a suffix;
- choice extras become option indices, and flags become 0/1.

Code is emitted only where it is used. A kind's metric and phrase, which a summary reads, are
emitted only when some summary reads a widget of that kind. The branches of `receive` are
emitted only for events the app can receive (`tick` only with a clock, `notify` only with a
feed).

### From an event to the DOM

The runtime puts one delegated `click` and one `input` listener on the dashboard element. It
calls the target's handler with the element, then digests **the target's section's bindings
only**:

```js
const onEvent = ({ target: t }) => {
  if (t.h) { t.h(t); run(t.closest("section").b); }   // .b: this widget's list
};

// a binding: write the i-th element's n[k] only when f() changed since the last write
const bind = (i, k, f, last, n = N[i]) => B.push(() => last !== (last = f()) && (n[k] = last));
```

`widget()` starts a fresh list for each section (`W[id] = x.b = B = []`), so every binding the
factory creates lands in its own widget's list. A click on a counter runs the counter's three
bindings, whatever the size of the page. `run` is a plain `for…of` over the list, so a binding
costs one call.

Handlers that read form controls read the element (`s.on[i] = t.checked`, `s.text = t.value`),
so they are idempotent. That matters because a checkbox fires both `click` and `input`.

**The last written value is cached, not compared with the DOM.** An input the user is typing
into is never written back with the same text, so it keeps focus and caret. The amount rule
works the same way: while the number input is invalid, no handler runs, the state keeps its
last value, and the binding stays silent, so the input keeps what the user typed.

### Keyed lists and conditional content

A list is one more binding. It reconciles items by `id` in place and runs each item's own
bindings. Item bindings read `r.i`, the item's current value, so a snapshot that sends new item
objects with the same ids updates the existing nodes. The runtime makes the `<li data-key>`
from the item template; the item's bindings name its elements by position, and it returns the
handlers of its controls, which close over `r`:

```js
list(3, () => s.items, `<input type=checkbox data-role=toggle><span></span><button data-role=remove>${rm}</button>`, (r) => (
  bind(0, "checked", () => r.i.done),
  text(1, () => r.i.text),
  [
    (t) => r.i.done = t.checked, // toggle
    () => s.items = s.items.filter((i) => i != r.i), // remove
  ]
));
```

`r.i` is the very object in `s.items` (state is mutated in place, and every event and external
replacement is followed by a digest that refreshes `r.i`), so an item handler needs no id
lookup.

Conditional content (`panel` body, `field` error, `choice` extra input, `feed` "no news") is a
binding that swaps one node with an empty text node that keeps its place. It touches nothing
else.

### Summaries

A summary is a binding that reads other widgets. The compiler knows its sources, so instead of a
subscription it **adds the same binding to each source's list**: a source's digest runs the
summary line too, and nothing else on the page. The row gives the sources as distances back
from the summary (a summary reads recent widgets, so the numbers stay short as the page grows):

```js
const w = widget("summary", l, "<p data-role=summary></p>");
text(1, () => { const v = src.map((e) => e.m()); … });
src = src.map((k) => (k = "w" + (id.slice(1) - k), W[k].push(...w), E[k]));   // E: m() and p(n)
```

### External events

`receive` is app code, and it changes state in place. The adapter only forwards `dispatch` to
it. Each branch digests only the widgets the event names (`up(k)` runs widget `k`'s list), and
every clock registers its tick function in `T`, so a tick never visits the rest of the page:

```js
const receive = (m) => {
  if (m.type == "serverSet") Object.assign(S[m.widget], m.state), up(m.widget);
  else if (m.type == "snapshot") for (const k in m.state.widgets) Object.assign(S[k], m.state.widgets[k]), up(k);
  else if (m.type == "tick") for (const t of T) t();                     // only with a clock
  else if (m.type == "notify") S[m.widget].entries.push(m.entry), up(m.widget);   // only with a feed
};

// in the clock factory
T.push(() => s.running && (s.seconds++, run(w)));   // w: this clock's binding list
```

A snapshot replaces the whole state, so it digests every widget: it is global by nature.

`dispose()` removes the dashboard element, and its two listeners go with it. The runtime creates
no timers. `settled()` resolves at once, because every update is synchronous.

## Why it's small

Dashboard, compressed totals (brotli 11), 9 sizes × 3 seeds, adapter excluded:

| | N=1 (median) | fit, all sizes | fit, N ≥ 16 |
|---|---|---|---|
| **digest** (local) | **1,062 B** | 2,161 + 24.2 B/widget | **3,190 + 18.4 B/widget** |
| tea-local (prototype) | 1,153 B | 2,764 + 37.0 | 4,157 + 29.1 |
| tea-inline (prototype) | 1,127 B | 2,762 + 36.0 | 4,125 + 28.3 |
| Solid 1 | 6,583 B | 8,293 + 35.8 | 9,652 + 28.1 |

Where the bytes go:
- **The runtime is 694 B br at N=1 and 874 B with lists and conditionals.** About 270 B of
  that is Vite's modulepreload polyfill, which every Vite build in this repo ships. The core
  (bind, show, list, widget, delegation, mount and dispose) is about 120 lines of source.
- **Per kind:** 150 to 400 B br of app code (the template, bindings and handlers), paid once.
  At N=16 the app code is about 2.2 KB.
- **Per widget: about 18.4 B, close to the data floor.** The instance rows are almost all
  content strings: labels, texts, items. Brotli of the strings alone grows by 14.4 B/widget
  (N=16 to 256). The full rows grow by 19.1. Only a few bytes per widget are structure:
  brackets, the factory reference, numbers.
- **Nothing per instance is code.** No closures are written per instance, no component
  boilerplate, no message types. Everything that varies is data the factory reads.
- **Locality is nearly free in bytes,** because it needs no reactive graph: a binding list per
  widget, one `push` per summary source, and a list of clocks. The compiler already knows who
  reads whom, so the wiring is a few lines of code paid once, never per instance.

### Positional handlers and bindings (second pass)

The table above is from the first local version. A second pass, on both scenarios, changed how
the code finds its elements, not the strategy: handlers go to controls by document order
instead of a map keyed by `data-role`, bindings name elements by position instead of querying
`data-role`, item handlers close over their item (`r.i`) instead of looking up `data-key`,
`run` is a `for…of` instead of a `forEach` callback, a reader copies its bindings into its
sources' lists instead of a closure that runs its list, and (shared-components) summary
sources are distances back. Brotli totals, `runs.json` sizes (1 to 256) and seeds (1 to 3):

| | N=1 | N=16 | N=256 | fit, all sizes | fit, N ≥ 16 |
|---|---|---|---|---|---|
| shared-components, before | 1,068 B | 3,298 B | 7,810 B | 2,172 + 24.26 B/widget | 3,203 + 18.45 B/widget |
| shared-components, after | **1,059 B** | **3,196 B** | **7,648 B** | **2,105 + 23.86** | **3,097 + 18.27** |
| unique-components, before | 1,445 B | 5,551 B | 44,363 B | 2,520 + 168.7 B/widget | 3,983 + 160.5 B/widget |
| unique-components, after | **1,438 B** | **5,282 B** | **41,281 B** | **2,458 + 156.6** | **3,835 + 148.8** |

- **On unique-components the role-name keys were 7% of the bundle.** Every message's name was
  written twice: as `data-role` in the template and as the handler's key. Brotli copies the
  second one, but a copy of a name that occurs once per widget still costs 2 to 3 bytes, about
  11 B per widget. Positions are short numbers instead.
- **On shared-components the gain is in the factories** (−106 B of baseline from N=16): no
  `role("…")` lookups, no keyed handler maps. The rows were already at the data floor; the
  summaries' shorter source numbers are the only per-instance change (−0.18 B/widget).
- **Every action costs fewer calls,** none more (`./rr work`, seed 1, every size 16 to 256):
  15,257 → 12,059 calls in total on shared-components, 32,025 → 19,977 on unique-components.
  Median local action, N=16 → 256: 35 → 41 became 30 → 31 (shared), 86 → 125 became 50 → 64
  (unique). The worst growth is still a tick, which calls every clock: 2.5× → 2.6× (shared),
  2.5× → 2.1× (unique). Because the cheap actions got cheaper, the tick's share grew at some
  sizes and seeds (`./rr check` unique-components n=64 seed 2: 4.3× → 5.1×, under the 8× limit).

## Locality

`./rr check` holds prototypes to a locality rule: the calls one local action costs may grow at
most 8× when the app grows 16×. The first digest re-ran every binding of the page after every
event. It shipped the fewest bytes, but its work grew with the whole page, which the rule
excludes the same way the contract excludes rebuilding with `innerHTML`. **Global dirty
checking is a dead end.**

Calls per action (`./rr work`, seed 1), N=16 → N=256:

| | median, local actions | worst ratio, user actions | worst ratio, external events | snapshot (global) |
|---|---|---|---|---|
| digest, global (dropped) | 283 → 4,526 | 16.1× (feed dismiss) | 16.2× (serverSet) | 300 → 4,832 |
| **digest, local** | **35 → 41** | 1.7× (filter) | 2.5× (tick) | 416 → 6,200 |
| tea-local | 23 → 24 | 1.7× (filter) | 3.4× (tick) | 231 → 3,687 |
| Solid 1 | 128 → 168 | 2.0× (filter) | 3.8× (tick) | 1,898 → 33,568 |

What remains grows for good reasons: later summaries read early widgets (more readers to
update), and a tick calls every clock (one call for each stopped one). The snapshot runs summary
lines once per source, a little more than the global digest did.

What locality cost, against the global version (same sizes and seeds):

| Change | N=1 | fit, all sizes | fit, N ≥ 16 |
|---|---|---|---|
| a binding list per widget, `up(k)`, the clock list `T` (runtime) | +29 B | +30 B baseline | +27 B baseline |
| summaries push into their sources, `up` in `receive`, clocks register (app) | +8 B | +16 B baseline, same slope | +32 B baseline, −0.1 B/widget |
| **total** | **1,027 → 1,062 B** | 2,115 + 24.3 → 2,161 + 24.2 | 3,130 + 18.6 → 3,190 + 18.4 |

The size lead survives: digest still ships about 1,000 B less than tea-local at every size from
N=16 (3,287 against 4,348 at N=16; 7,803 against 11,482 at N=256), and its slope is about 10
B/widget lower.

## Tried and dropped

Every number below comes from the same quick measurement: sizes 1, 4, 16, 64 and 256, seeds 1 to
3. "≥16" is the fit over N ≥ 16.

| Idea | Effect | Verdict |
|---|---|---|
| Flags as 0/1, choice extras as indices | −0.05 B/widget | kept (harmless, more compiler-like) |
| Shared helpers: `model` (two-way value binding), `ids`, `drop`, `prop` | +15 B at N=1, +14 B baseline, −0.1 B/widget | dropped: brotli already makes the repeated inline code nearly free, and the helpers cost more than they save |
| Section built with `insertAdjacentHTML` instead of `dataset` writes | +17 B at N=1, +32 B baseline | dropped |
| Drop optional closing tags in templates | −8 B baseline, +8 B at N=1 | dropped: noise, and less readable |
| Instance rows as delimiter-joined strings (`"a\|b\|c"`) | about −0.5 B/widget before the parser's cost (measured offline on the rows) | dropped: no real gain, and an odd format |
| Turn off Vite's modulepreload polyfill | −271 B at N=1 (756 B), all sizes | not adopted: it is a toolchain setting, not part of the approach, and Solid and the other prototypes keep it. Any Vite approach could take it. |
| Compare against the live DOM instead of a cached last value | no size change | dropped: it breaks the amount rule (an invalid input would be overwritten on the next digest) and fights the caret |
| Global digest: every binding of the page after every event (the first version) | −35 B at N=1, −60 B baseline (N ≥ 16) | dropped: work grows with the page (16× for 16× widgets), which the locality rule excludes. See [Locality](#locality) |

Second pass (`runs.json` sizes and seeds, or offline on the minified N=256 seed 1 bundle where
marked):

| Idea | Effect | Verdict |
|---|---|---|
| Handlers by control position, bindings by element position (both scenarios) | unique: −12 B/widget; shared: −106 B baseline | kept |
| Summary sources as distances back, no empty prefix for list summaries (shared) | −0.18 B/widget, +7 B baseline | kept |
| A helper for the number-input check (`s.n = int(t, lo, hi, s.n)`) (unique) | −63 B at N=256 before the helper's own ~30 B (offline) | dropped: brotli already makes the repeated inline check nearly free, and it costs a call per keystroke |
| Constant-fold `cl(s.x + -2, …)` to `cl(s.x - 2, …)` (unique) | ±0 (noise) | dropped |
| Drop optional closing tags (`</p>`, `</li>`, `</option>`) (unique) | −200 B at N=256, about −0.8 B/widget (offline) | not adopted, as on shared-components: a minifier's choice no compiler of this kind makes by default |

## Honest limits

- **An event re-runs all of its widget's bindings,** with no memoization: about five, plus a
  list's items and the summaries that read the widget. That is the same granularity as
  tea-local's per-instance patch. It would grow with big components, not with the page.
- **A widget can only change its own state.** A handler mutates its own `s`, and only the
  digest of that widget (and its readers) follows. A kind whose handler wrote to another widget
  would need the compiler to digest that widget too; this scenario has none.
- **Templates are HTML strings with compile-time constants spliced in.** The emitter escapes
  them when it writes them. Values that come from state (todo text, feed entries) only ever
  reach the DOM through `textContent` or properties, never through `innerHTML`. A template is
  parsed once per widget and once per new list item.
- **Some assumptions are checked at build time, not handled.** The emitter asserts that widget
  ids are `w1…wN` in order and that initial list ids are 1…k. Lists are keyed by an `id` field.
  A different spec would need explicit ids in the rows: a few bytes per widget.
- **External replacements merge with `Object.assign`.** This assumes `serverSet` and
  `snapshot` send a widget's whole state, as the scenario specifies.
- **Disposal relies on detaching the dashboard element:** its listeners are not reachable once
  it is gone, which the serve page confirms (0 listeners, 0 timers).
- **ARIA attributes are written through reflected properties** (`ariaSelected`, `ariaPressed`,
  `ariaExpanded`): Chrome, Safari, and Firefox 119 and later.
- **A non-canonical number spelling stays as typed.** If you type `1e2` into an amount whose
  value is already 100, the input still shows `1e2`. Solid's controlled input behaves the same.

## unique-components

`scenarios/unique-components/digest.js` writes every widget as **its own function**, with no
per-kind factories and no data rows (the shared-components size win came from rows, which the
scenario's rule forbids). A widget function holds, as code: its state literal, its template (one
static HTML string), its handlers (one arrow function per control, in the template's order, the
ops compiled to statements), its bindings (derived expressions compiled to JavaScript) and, for
a time-driven field, its tick function. Only initial values and texts are data.

It uses `runtime-unique.js` instead of `runtime.js`: the same strategy (binding closures that
write on change, a local digest, handlers and bindings by position), but it knows nothing about
widget kinds. `widget(html, s, h)` builds the section, hands `h` to its controls in document
order, and makes its elements the ones bindings refer to by position (`text(3, …)`).
Differences from `runtime.js`:
- the delegated listener finds the widget by `data-role=widget`, because a conditional section
  may itself be a `<section>`;
- a list item is `<li data-key data-role>` (the item role is `{field}Item`);
- a reader widget copies its bindings into each source's list (`dep`, a compile-time fact), so
  a source's change digests the readers too, and nothing else;
- external events deep-copy what they receive (`structuredClone`), because handlers mutate
  the widget's lists in place and must not alter the sender's data.
