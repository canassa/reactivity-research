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
const counter = (l, st, mn, mx, value, v0 = value) => {   // the state: plain variables of the factory
  widget("counter", l, `<output data-role=value></output><button data-role=dec>-${st}</button>…<button data-role=reset>Reset`,
    (v) => ({ value } = v),                        // the setter external replacements use
    () => value = Math.max(mn, value - st), // dec: the update arms, one per control,
    () => value = Math.min(mx, value + st), // inc  in the template's document order
    () => value = v0, // reset
  );
  text(1, () => value);                            // view: one binding per dynamic property,
  bind(2, "disabled", () => value <= mn);          // on the template's element at that position
  bind(3, "disabled", () => value >= mx);          // (0 is the heading)
};
```

**The state is the factory's own variables** (its parameters where it can be: tabs' `active`,
panel's `open`), so the minifier gives every reference a one-letter name. The names of the
fields appear once, in the setter `widget()` keeps for external events (on the widget's binding
list, `W[id].s`).

**A template leaves out the end tags it closes with** (`…<button data-role=reset>Reset`, no
`</button>`): the end of the HTML closes every element still open, so the DOM is the same. Solid's
compiler writes its templates the same way. End tags inside a template stay.

**Handlers go to controls by position, and bindings name elements by position.** The compiler
knows the template, so it writes the handlers in the order of the template's controls (its
buttons, inputs and selects), passes them to `widget()` after the setter, and `widget()` hands
them out in that order (`c.h = h[i]`, the way Solid stores `$click` on the element), with the
widget's binding list (`c.b`). A binding names its element by its index in the
template. Neither needs a `data-role` lookup or repeats a role name in the code; the
`data-role` attributes stay in the template, where the contract wants them. Where a template
repeats a control (toggles, tabs, rating stars), the factory computes the positions from the
stride (the i-th checkbox of toggles is element 4 + 3i).

**Each instance is one row of data:** the factory, then the instance's constants and initial
state. The app is the table of rows in page order, then the table of the widgets' labels in the
same order (the runtime passes a widget's label as its factory's first argument, `l`):

```js
export default app([
  [counter, 5, 0, 20, 0],
  [field, "Your tag", "[^]{5}", "Needs 5 or more characters", ""],
  [amount, 1, "", " kg", 85],
  …
], [
  "Design tickets",
  "Office tag",
  "Fleet deposit",
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
calls the target's handler with the element, then digests **the bindings of the target's
widget only**:

```js
const onEvent = ({ target: t }) => t.h && (t.h(t), run(t.b));   // .b: the list of the control's widget

// a binding: write the i-th element's n[k] only when f() changed since the last write
const bind = (i, k, f, last, n = N[i]) => B.push(() => last !== (last = f()) && (n[k] = last));
```

`widget()` starts a fresh list for each section (`W[id] = B = []`), so every binding the
factory creates lands in its own widget's list. A click on a counter runs the counter's three
bindings, whatever the size of the page. `run` is a plain `for…of` over the list, so a binding
costs one call.

Handlers that read form controls read the element (`on[i] = t.checked`, `str = t.value`; on
unique-components the runtime puts it in `X` before the call, so the handler takes no
parameter: `$motto = X.value`), so they are idempotent. That matters because a checkbox fires both `click` and `input`.

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
list(3, () => items, `<input type=checkbox data-role=toggle><span></span><button data-role=remove>${rm}`, (r) => (
  bind(0, "checked", () => r.i.done),
  text(1, () => r.i.text),
  [
    (t) => r.i.done = t.checked, // toggle
    () => items = items.filter((i) => i != r.i), // remove
  ]
));
```

`r.i` is the very object in `items` (state is mutated in place, and every event and external
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
it. A replacement goes through the widget's setter (`W[k].s`) and digests only the widgets the
event names (`run(W[k])` runs widget `k`'s list); a `serverSet` is a snapshot of one widget, so
the two share one branch. Every clock registers its tick function in `T`, so a tick never visits
the rest of the page. A feed keeps its entries on a record its factory returns (`E[k]`), which
`notify` pushes into:

```js
const receive = (m) => {
  if (m.type == "tick") for (const t of T) t();                                  // only with a clock
  else if (m.type == "notify") E[m.widget].e.push(m.entry), run(W[m.widget]);    // only with a feed
  // serverSet and snapshot; a tick or notify the app has no branch for has no state
  else for (const k in (m = structuredClone(m.type == "serverSet" ? { [m.widget]: m.state } : m.state?.widgets))) W[k].s(m[k]), run(W[k]);
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

### State in variables, distances, defaults (third pass)

A third pass changed how the compiled code stores state and names things, not the strategy:
- **State lives in plain variables.** On shared-components a kind's state is its factory's
  variables. On unique-components a field only its widget uses is a local of the widget's
  function, and a field another widget reads is a module variable, so the reader's binding
  reads it directly. The minifier shortens every reference. External replacements go through a
  setter each widget writes (`(v) => ({ sheets: $sheets, files: w1$files } = v)`), which holds
  the field names once, where the state literal held them before; feed lists stay on a record,
  because `notify` pushes into them by name.
- **unique-components bindings name their element by distance from the previous binding's**
  (`text(3, …)`, then `text(4, …)` for the element 4 further on). Bindings are made in document
  order, so the numbers are smaller and repeat more (half of them are 1).
- **unique-components readers name their sources by distance back** (`dep(2, 5)`), as summary
  sources already were on shared-components.
- **unique-components property bindings default to `value`** (`bind(1, () => $venue)`), the
  number check reuses the handler's parameter, and a one-statement click handler is that
  statement, not a block in a block.

Brotli totals, adapter excluded, `runs.json` sizes (1 to 256) and seeds (1 to 3), medians:

| | N=1 | N=16 | N=64 | N=256 | fit, all sizes | fit, N ≥ 16 |
|---|---|---|---|---|---|---|
| shared-components, before | 1,059 B | 3,196 B | 4,424 B | 7,648 B | 2,105 + 23.86 B/widget | 3,097 + 18.27 B/widget |
| shared-components, after | **1,053 B** | **3,154 B** | **4,399 B** | **7,634 B** | **2,088 + 23.78** | **3,062 + 18.29** |
| unique-components, before | 1,438 B | 5,282 B | 13,807 B | 41,281 B | 2,458 + 156.6 B/widget | 3,835 + 148.8 B/widget |
| unique-components, after | **1,420 B** | **5,068 B** | **13,029 B** | **38,790 B** | **2,400 + 146.7** | **3,680 + 139.5** |

Every size's median is lower on both scenarios (sizes 1 to 256). Calls (`./rr work`, seed 1,
sizes 16 to 256), record by record: none higher; 12,059 → 12,054 in total (shared-components),
19,977 → 19,967 (unique-components). A setter call replaces the `up(k)` call each external
event made before, so the counts stay level.

- **Field names that a widget repeats cost bytes even under brotli,** the lesson of the second
  pass again: `s.sheets` four times in a widget cost about 2 to 3 bytes per repeat. In variables
  they become one-letter names. The gain is smaller than an offline renaming suggested (−3,100 B
  at N=256), because a read field must stay reachable by its readers (a module variable gets a
  two-letter name) and the setter's structure costs a few bytes per widget.
- **Distances beat positions:** absolute positions were about 9 B per widget on
  unique-components (−2,357 B at N=256 when all were zeroed offline). Distances took −1,300 B of
  that.
- **On shared-components the state lived in per-kind code,** so variables shrink the baseline
  (−35 B from N=16) and leave the slope at the rows' data floor.

### Call shapes and range facts (fourth pass)

A fourth pass changed the shape of the calls the compiled code makes and used two facts the
compiler knows, not the strategy:
- **Handlers are `widget()`'s last arguments** (`widget(html, set, ...h)`), after the setter, so
  no widget writes an array around them, and a feed widget puts its record in `O` itself instead
  of every other widget passing a placeholder for it (unique). The dashboard kinds do the same.
- **A control carries its widget's binding list** (`c.b`, set with its handler), so the
  delegated listener runs `t.b` instead of looking the widget up with `closest()`.
- **An int add checks only the bound it can pass** (unique): an int field always lies within
  its range (ops clamp, the number input checks, external states send in-range values), so
  `+3` becomes `Math.min(x + 3, max)` and `-2` becomes `Math.max(x - 2, min)`, as the dashboard
  counter already did. The two-sided `cl` helper is gone, and with it one call per click.
- **Comparisons are loose** (unique): both sides of a typed comparison have the same type, so
  `==` is `===`.
- **Handlers are expressions where they can be:** a push keeps its trimmed draft in the click
  handler's unused parameter (`(t) => (t = d.trim()) && (add(l, t), d = "")`), every new item
  starts not done (the helper needs no `done` argument), the amount check, filter item and
  clock reset have no block, and an initial list's items are `L`'s arguments.
- **Small spellings on shared-components:** the reflected ARIA properties and an input's value
  take a boolean or a number as it is (no `"" +`), a rating star's character goes through
  `text`, a summary rounds its total only where it shows it (a list summary no longer computes
  it), and the feed's record keeps its entries under `e`.

Brotli totals, adapter excluded, `runs.json` sizes (1 to 256) and seeds (1 to 3), medians:

| | N=1 | N=16 | N=64 | N=256 | fit, all sizes | fit, N ≥ 16 |
|---|---|---|---|---|---|---|
| shared-components, before | 1,053 B | 3,154 B | 4,399 B | 7,634 B | 2,088 + 23.78 B/widget | 3,062 + 18.29 B/widget |
| shared-components, after | **1,045 B** | **3,110 B** | **4,359 B** | **7,580 B** | **2,061 + 23.68** | **3,019 + 18.28** |
| unique-components, before | 1,420 B | 5,068 B | 13,029 B | 38,790 B | 2,400 + 146.7 B/widget | 3,680 + 139.5 B/widget |
| unique-components, after | **1,382 B** | **4,997 B** | **12,925 B** | **38,437 B** | **2,356 + 145.4** | **3,623 + 138.2** |

Every size's median is lower on both scenarios (sizes 1 to 256). Calls (`./rr work`, seed 1,
sizes 16 to 256), record by record: none higher; 12,054 → 11,806 in total (shared-components:
a list summary skips its total, so every action that digests a summary costs a few calls
less), 19,967 → 19,962 (unique-components: an int click no longer calls `cl`).

- **What is left is mostly data and contract.** Removing offline, from the N=256 seed 1
  unique-components bundle (38.7 KB br): every `data-role` attribute −5.0 KB, every setter
  (the field names of the external protocol) −3.1 KB, every heading −1.4 KB. The code skeleton
  without any string costs 15.2 KB, of which 7 KB are identifiers.
- **A runtime change moves the app's bytes by up to ±120 B at N=256,** because the minifier
  names the app's module variables (the read fields) after the runtime's: one fewer runtime
  name renames every read field. Sizes of N ≥ 128 are noisy by that much for any change, so a
  change is kept only when it is smaller by construction and the sum over all sizes and seeds
  agrees.

### Initial state in the setter, the template last (fifth pass)

A fifth pass moved where the compiled code writes its initial state and in what order it hands
`widget()` its pieces, not the strategy:
- **The setter's defaults are the initial state** (unique): `(v) => ({ sheets: $sheets = 11,
  files: w1$files = L(…) } = v)`. `widget()` calls the setter once with `{}`, so no widget
  declares or initialises its state a second time: its own fields are its function's parameters,
  and the `let` and the read fields' assignments are gone. Each field name now sits next to its
  initial value, which brotli codes better. It is the largest step of the pass: about −720 B at
  N=256 on its own.
- **The setter rides on the widget's binding list** (`W[k].s`, unique), so there is no `S` map:
  `receive` calls `W[k].s(…)` and then `run(W[k])`.
- **`widget(set, ...handlers, html)`** (unique): the setter first, the template last
  (`h.pop()`), so the template sits next to the bindings that use its positions.
- **Two list helpers** (unique): `L(...texts)` and `C(...[text, done])` instead of one that
  tests `typeof`, so an app ships only the one it uses.
- **Small runtime spellings:** the delegated listener is one expression (unique); the widget
  number is a counter (`id = "w" + ++I`, so `dep` reads `I - k` instead of `id.slice(1)`)
  (unique); the heading is spliced into the section's HTML instead of set through
  `textContent`, and each widget is digested for the first time right after its factory runs
  (shared).

Brotli totals, adapter excluded, `runs.json` sizes (1 to 256) and seeds (1 to 3), medians:

| | N=1 | N=16 | N=64 | N=256 | fit, all sizes | fit, N ≥ 16 |
|---|---|---|---|---|---|---|
| shared-components, before | 1,045 B | 3,110 B | 4,359 B | 7,580 B | 2,061 + 23.68 B/widget | 3,019 + 18.28 B/widget |
| shared-components, after | **1,033 B** | **3,108 B** | **4,348 B** | **7,578 B** | **2,053 + 23.69** | **3,011 + 18.29** |
| unique-components, before | 1,382 B | 4,997 B | 12,925 B | 38,437 B | 2,356 + 145.4 B/widget | 3,623 + 138.2 B/widget |
| unique-components, after | **1,377 B** | **4,970 B** | **12,736 B** | **37,617 B** | 2,359 + **142.2** | 3,646 + **135.0** |

Every size's median is lower on both scenarios (sizes 1 to 256); the unique fits' baselines rise
only because the slope fell. Calls (`./rr work`, seed 1, sizes 16 to 256), record by record: none
higher; 11,806 → 11,798 in total (shared-components), 19,962 → 19,962 (unique-components).

- **The work counter undercounts a callback until its closure is warm.** Digesting each unique
  widget right after it is built (as shared-components now does) made "bool: toggle" cost 54 →
  56 calls: a summary's `filter((i) => i.done)` callback was counted once for three items
  before and three times after, because the old mount had run that binding more often. The
  count is closer to the truth, but the rule is per record, so unique-components keeps the
  digest after all widgets. The 8 fewer calls on shared-components are the same effect in the
  other direction, most likely (no code on those paths changed).
- **Brotli codes a name next to its value better than the same bytes apart.** Initial values as
  parameter defaults (`($sheets = 11) =>`, with a plain setter) were as long as the setter
  defaults and gained nothing (+612 B at N=256 against them).

### Names the minifier can't vary, bit masks (sixth pass)

A sixth pass took away names the minifier picked differently in every widget, and packed flags
into numbers, not the strategy:
- **Setters and handlers take no parameter** (unique). A setter destructured its own parameter,
  and an input, select or checkbox handler read the event's target from its own: the minifier
  named that parameter after whatever letters the widget's own variables had taken, so the same
  code started differently in every widget. Now `run(W[k], state)` puts the incoming state in
  the runtime's `S` before it calls the setter (`() => ({ miles: w6$miles = 11, … } = S)`;
  mount empties `S` for the initial call), and the delegated listener puts the target in `X`
  (`() => $motto = X.value`). Same calls, same order: the setter is still called once per
  replaced widget, the handler once per event.
- **A serverSet is a snapshot of one widget** (both): `receive` handles both in one loop over
  `{ [m.widget]: m.state }` or `m.state.widgets`, and `run(W[k], state)` applies the setter
  itself (unique). A tick or notify the app has no branch for has no `state` and replaces
  nothing.
- **Done and on flags as one bit mask** (both): a checklist's initial items are its texts after
  one number (`C(13, "Book the passport", …)`, bit i: item i), a todo's done flags and a toggles
  widget's switches are one number in the row, not a 0/1 each.
- **Small spellings:** `nx(value, ...options)` instead of an options array (unique), the counter's
  initial value and the todo's draft as parameter defaults instead of a `let` (shared), and
  `widget()` numbers the widget and writes its key itself, so the runtime keeps no `id` (unique).

Brotli totals, adapter excluded, `runs.json` sizes (1 to 256) and seeds (1 to 3), medians:

| | N=1 | N=16 | N=64 | N=256 | fit, all sizes | fit, N ≥ 16 |
|---|---|---|---|---|---|---|
| shared-components, before | 1,033 B | 3,108 B | 4,348 B | 7,578 B | 2,053 + 23.69 B/widget | 3,011 + 18.29 B/widget |
| shared-components, after | **1,009 B** | **3,074 B** | **4,309 B** | **7,514 B** | **2,028 + 23.51** | **2,987 + 18.10** |
| unique-components, before | 1,377 B | 4,970 B | 12,736 B | 37,617 B | 2,359 + 142.2 B/widget | 3,646 + 135.0 B/widget |
| unique-components, after | **1,356 B** | **4,923 B** | **12,604 B** | **37,255 B** | **2,331 + 140.9** | **3,596 + 133.8** |

Every size's median is lower on both scenarios (sizes 1 to 256; sums over all 27 builds: shared
−951 B, unique −2,691 B). Calls (`./rr work`, seed 1, sizes 16 to 256), record by record: none
higher, none lower; 11,798 in total (shared-components), 19,962 (unique-components).

- **A name the minifier picks per widget costs bytes even when it is one letter.** The setter's
  parameter was `r` in one widget and `i` or `a` in the next, so brotli could not copy the
  setter's opening and closing from the previous widget. One constant name, even a longer one,
  is cheaper: −1,060 B summed for the setters, −709 B for the handlers, mostly at large N.
- **A bit mask beats a 0/1 per item only when there are many items.** The checklist mask saves
  about 130 B at N=256 but costs up to 15 B between N=8 and N=32, where the decoder is paid
  for few lists. It is kept because every size still ends below the start.

### Templates apart, Solid's template spellings (seventh pass)

A seventh pass changed where the compiled code keeps its templates and how it spells them, not
the strategy:
- **unique-components hoists the templates** into one table, in page order: `app([templates],
  [widgets], receive)`. The dashboard element keeps the table (`D.h`, an expando like a
  control's `h`), and `widget()` takes the next template. Solid hoists its templates out of its
  components too (as named constants). A template is static markup, which the scenario allows
  as data; each widget's handlers, bindings and setter stay its own code. It is the largest step
  of the pass, about −1,000 B at N=256 on its own: HTML now sits with HTML and code with code,
  which brotli models better, and no widget names its template. The same templates as named
  constants (`const w6$html = …`) were +81 B at N=256 instead: a name per widget costs more than
  the separation gains.
- **A text's static prefix is in the template** (unique): `<p>Gap: </p>` and `text(3, () =>
  $motto.length - w6$miles)`. `text()` writes a text node of its own at the end of its element
  (`.data`), so the prefix stays in front of it, as Solid's compiler does with `<p>Gap: <!>`.
  Every text binding works this way, so the runtime has no second helper. About −340 B at N=256.
- **Templates leave out the end tags they close with** (both): `…<button
  data-role=reset>Reset`, no `</button>`. The end of the HTML closes every element still open,
  so the DOM is the same. Solid's compiler omits them too; end tags inside a template stay, as
  in Solid. About −190 B at N=256 (unique).
- **shared-components keeps the labels in a table of their own**, after the rows: `app([[counter,
  5, 0, 20, 0], …], ["Design tickets", …], receive)`; the runtime passes a widget's label as its
  factory's first argument. −160 B at N=256. Moving every string of a row into the table
  instead (one array per row) was +72 B.
- **Smaller pieces:** a list item's remove is `rm(list, r.i)`, an in-place splice (unique: one
  call where `filter` called back once per item, so a remove costs fewer calls); a checklist
  with no done item starts as a plain `L(…)` list (an absent `done` reads as not done; unique);
  an item's record is its binding list itself (`(r = B = []).n = …`, unique); `show` takes the
  condition as it is (every condition is a typed bool; unique); `bind(d, f, k, n, last)` takes
  the node before the cache, so `text` passes it without a placeholder (unique);
  shared-components keeps the setter on the binding list (`W[k].s`, no `S` map) and its
  delegated listener is one expression.

Brotli totals, adapter excluded, `runs.json` sizes (1 to 256) and seeds (1 to 3), medians:

| | N=1 | N=16 | N=64 | N=256 | fit, all sizes | fit, N ≥ 16 |
|---|---|---|---|---|---|---|
| shared-components, before | 1,009 B | 3,074 B | 4,309 B | 7,514 B | 2,028 + 23.51 B/widget | 2,987 + 18.10 B/widget |
| shared-components, after | 1,009 B | 3,074 B | **4,264 B** | **7,345 B** | 2,032 + **22.86** | 2,996 + **17.43** |
| unique-components, before | 1,356 B | 4,923 B | 12,604 B | 37,255 B | 2,331 + 140.9 B/widget | 3,596 + 133.8 B/widget |
| unique-components, after | 1,356 B | **4,829 B** | **12,185 B** | **35,617 B** | 2,339 + **134.5** | 3,603 + **127.4** |

No size's median is higher on either scenario (sizes 1 to 256): shared is equal at N=1 and
N=16 and lower at the seven other sizes, unique is equal at N=1 and lower at the eight others.
Sums over all 27 builds: shared −874 B, unique −9,692 B (−4.4% at N=256). The fits' baselines
rise a few bytes only because the slopes fell. Calls (`./rr work`, seed 1, sizes 16 to 256),
record by record: none higher; 11,798 → 11,798 in total (shared-components), 19,962 → 19,942
(unique-components: a remove no longer calls back per item).

- **Where a string sits matters as much as how long it is.** Moving the templates out of the
  widget code, unchanged, took 2.7% off the largest unique bundles; moving the labels out of the
  rows took 2% off the largest dashboards. Brotli's literal coding depends on the bytes before,
  so a stream of HTML and a stream of code cost less than the two interleaved.
- **The small sizes are a lottery of a few bytes.** The HTML page names the bundle by its
  content hash, and its brotli size moves between 138 and 152 B with that hash alone, so any
  change to the JavaScript moves every build's total by up to ±7 B at random. At N=1 the
  JavaScript of the two scenarios is within a few bytes of where it started (the template table
  and the text node cost about 15 B in the runtime of a one-widget unique app, which the other
  changes pay back), and the totals land equal.

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

Third pass (`runs.json` sizes and seeds, or offline on the minified N=256 seed 1 bundle where
marked):

| Idea | Effect | Verdict |
|---|---|---|
| State as variables, read fields as module variables, a setter per widget (unique) | −1,330 B at N=256, −64 B at N=16 | kept |
| The same, read fields on a record (`O.w1.files`) instead of module variables (unique) | −300 B at N=256 | replaced by module variables: a record keeps the read fields' names in every reference |
| Getters for read fields (`get files() { … }`) | not built | dropped: a getter is a call per read per digest, which the call-count rule forbids |
| State as factory variables (shared) | −13 B at N=1, −33 B at N=16 | kept |
| The same, the feed record in a separate map `O` (shared) | +4 B at N=1 | replaced by returning the record as the feed's `E` entry |
| Bindings by distance from the previous one (unique) | −1,320 B at N=256, −61 B at N=16 | kept |
| Readers' sources as distances back (unique) | −78 B at N=256 | kept |
| `bind` defaults to `value`, the property last (unique) | −87 B at N=256, ±4 B below N=16 | kept |
| The same on shared-components | ±15 B, mixed by size | dropped: noise |
| Number check on the handler's parameter, no block in a block (unique) | −93 B at N=256, −33 B at N=16 | kept |
| Separate `val`, `chk`, `dis` binding helpers (unique) | −150 B at N=256, +4 B at N=1 and N=8 | replaced by the default property, which needs no helper |
| Delta 1 as a default argument (unique) | −31 B at N=256 at best (offline) | dropped: brotli already codes `(1,()=>` as a copy |
| The item role from the field name in the runtime (`role + "Item"`) (unique) | +8 B at N=16, −58 B at N=128 | dropped: noise |
| The heading written by the runtime (`"<h2>" + …`) (unique) | +3 B at N=256 (offline) | dropped |

Fourth pass (`runs.json` sizes and seeds, each against the step before, or offline where
marked):

| Idea | Effect | Verdict |
|---|---|---|
| Handlers as `widget()`'s rest arguments after the setter (both) | unique −12 to −116 B at every size; shared −10 to −26 B from N=4 | kept |
| An int add checks only the bound it can pass, `Math.min`/`Math.max` inline (unique) | −7 B at N=1, −20 B at N=16, −127 B at N=256 | kept |
| The same through imported `min`/`max` aliases | +2 B at N=1, +10 B at N=64, −146 B at N=256 | replaced by `Math.min`/`Math.max` inline |
| The same with the bound first (`Math.min(max, x + k)`), or the tick's `Math.min` reordered to match | +3 to +54 B, or ±24 B | dropped: worse, or noise |
| A control carries its widget's binding list (`c.b`), no `closest()` (both) | −7 B at N=1 (unique), −8 B (shared) | kept |
| Loose equality for typed comparisons (unique) | −10 B at N=16, −60 B at N=256 | kept |
| Push as one expression on the handler's parameter, new items always not done (unique) | −30 to −74 B from N=32, ±5 B below | kept |
| Initial list items as `L`'s arguments (unique) | sum over all builds −160 B, +6 B at N=2 | kept |
| Dashboard handlers as expressions, summary total only where shown (shared) | −22 B at N=16, −14 B at N=4 | kept |
| ARIA states and the amount value without `"" +`, stars through `text`, numbers joined as numbers (shared) | −6 to −26 B from N=8 | kept |
| The feed record's entries as `e` (shared) | −29 B at N=256, +13 B at N=32, sum −138 B | kept |
| Static text prefix in the template, a text node of its own for the expression (`<p>Total: </p>` + `tail(…)`) (unique) | +8 B at N=1, +42 B at N=256 | dropped: brotli already codes `` `Total: ${`` well in the code, and the prefix in the template breaks other matches |
| `dis`/`chk` helpers beside the default property (unique) | +9 B at N=1, +18 B at N=256 | dropped |
| Enum cycles as a chain of comparisons (tea-dirtybits' idea) (unique) | +45 B at N=16, +257 B at N=256 | dropped: every option written twice |
| `!x.length` for "count is 0" (unique) | sum +211 B | dropped |
| `x % 1 == 0` for `Number.isInteger(x)` (unique) | +13 B at N=16, −41 B at N=256 | dropped: mixed, and golfing |
| `done` as 0/1 in initial items, no `!!` (unique) | sum +44 B | dropped |
| The item's `<li data-role>` in its template instead of set by the runtime (unique) | +45 B at N=64 | dropped |
| `nx(v, ...options)` instead of an options array (unique) | +6 B at N=4 and N=8, −48 B at N=256 | dropped: mixed |
| A todo's items and a feed's entries as the row's last arguments (shared) | +14 B at N=4, +9 B at N=16 | dropped |
| A one-field setter as an assignment (`(v) => x = v.x`) (both) | ±10 B, mixed by size | dropped: noise |
| Rows flattened into one argument stream, split by each factory's arity (shared) | −9 B at N=256 before the decoder (offline) | dropped: no gain, and fragile (a minifier may drop unused parameters) |
| `onclick`/`oninput` properties instead of `addEventListener` | not built | dropped: the serve page counts listeners through `addEventListener`, so the dispose check could no longer see them |

Fifth pass (`runs.json` sizes and seeds, each against the step before):

| Idea | Effect | Verdict |
|---|---|---|
| Initial state as the setter's defaults, called once with `{}` (unique) | −19 to −723 B from N=8, +2 to +3 B below (the call) | kept |
| The setter on the widget's binding list (`W[k].s`), no `S` map (unique) | −2 to −7 B below N=16 | kept |
| The same on shared-components | +21 B at N=128, +28 B at N=256, −7 B at N=1 | dropped: mixed |
| Setter first (`widget(set, html, ...h)`), then the template last (`widget(set, ...h, html)`) (unique) | sum over all builds −347 B, then −391 B | kept |
| Handlers first, then the setter and the template (`widget(...h, set, html)`) (unique) | +146 B at N=256, +11 B at N=1 | dropped |
| Handlers in a separate call after the bindings (`on(...h)`) (unique) | +172 B at N=256, +16 B at N=1 | dropped |
| Initial values as the widget function's parameter defaults, a plain setter (unique) | +612 B at N=256 against the setter defaults | dropped |
| `L` and `C` instead of one list helper that tests `typeof` (unique) | sum −100 B | kept |
| The delegated listener as one expression (unique) | sum −145 B | kept |
| The same on shared-components | +5 B at N=32 against the start | dropped: mixed |
| Each widget digested right after it is built (unique) | sum −129 B | dropped: the work counter then counted 2 more calls on a toggle (see above) |
| The same on shared-components, `run(W[id])` in the mount loop | sum −92 B | kept (no count higher) |
| The heading spliced into the section's HTML (shared) | −8 to −13 B below N=16, sum −131 B | kept |
| The section's key, role and heading in one wrapper's HTML (`el("div", …).firstChild`) (shared) | +145 B summed | dropped, as in the first pass |
| The widget number as a counter in shared-components | sum +196 B | dropped |
| Rows as factory calls (`counter("…", 5, 0, 20, 0)`), metrics registered by the factory (shared) | +35 B at N=256, +22 B at N=8 | dropped: brotli codes the array rows better, and single-use factories are no longer inlined |
| Unquoted option values and placeholders where HTML allows (unique) | +4 B at N=1, −39 B at N=256 | dropped: mixed |
| Consecutive text bindings in one variadic call (`text(3, f, 4, g)`) (unique) | +208 B at N=256, +19 B at N=1 | dropped: brotli already codes `),text(1,()=>` as one copy |
| The two listeners added in a loop (unique) | +2 to +4 B below N=4 | dropped |
| One `structuredClone` for a whole snapshot (unique) | ±2 B | dropped: noise |
| The item role suffixed by the runtime (`role + "Item"`) (unique) | +37 B at N=256, −14 B at N=16 | dropped: noise, as in the third pass |

Sixth pass (`runs.json` sizes and seeds, each against the step before, or offline on the
minified bundles where marked):

| Idea | Effect | Verdict |
|---|---|---|
| serverSet and snapshot in one branch (both) | shared −12 to −26 B at every size; unique sum −299 B | kept |
| Setters read the incoming state from `S` instead of a parameter (unique) | −11 to −143 B at every size | kept |
| `run(W[k], state)` applies the setter, setters keep their parameter (unique) | sum −57 B, ±10 B by size | replaced by the parameterless setter, where the gain is |
| The same `run(W[k], state)` on shared-components, the setter on the binding list | sum +44 B, then +119 B on top of the single branch | dropped |
| Handlers read their control from `X` instead of a parameter (unique) | −52 B at N=256, sum −709 B, +8 B at N=2 | kept |
| The same, the control in `S` (one variable for both) | sum −730 B | not adopted: the same bytes, and one name for two meanings |
| The same on shared-components | sum +55 B | dropped: its handlers are written once per kind, so their parameter never varies |
| Checklist done flags as one bit mask (unique) | −132 B at N=256, up to +15 B between N=8 and N=32 | kept (every size still below the start) |
| Todo done flags (shared) as a mask, then toggles' switches | sum −127 B, then −134 B | kept |
| Choice extras as a mask (shared) | sum −14 B, +7 B at N=8 | dropped: noise |
| `nx(value, ...options)` (unique), retried | sum −148 B, −61 B at N=256, +16 B at N=8 | kept this time: every size still below the start |
| The counter's initial value, then the todo's draft, as parameter defaults (shared) | sum −80 B, then −143 B | kept |
| The same for feed's record, filter's items, rating's stars, toggles' and todo's expanded masks, unique's feed record | ±30 B each, or worse | dropped: noise, or worse |
| The widget numbered inside `widget()`, no `id` (unique) | −8 to −19 B below N=16, sum −94 B | kept |
| The section appended with `appendChild`'s result, or built with `insertAdjacentHTML` (unique) | sum +84 B, or +644 B | dropped |
| `el()` with `Object.assign` (unique) | sum +258 B | dropped |
| `show` storing "hidden" to drop the `!!` (unique) | sum +66 B | dropped |
| Summary formula from whether a prefix is given (shared) | sum +25 B | dropped |
| `x = Math.min(x + k, max)` as `(x += k) > max && (x = max)` (unique) | +150 to +225 B at N=256 (offline) | dropped: `Math.min(` is one cheap copy |
| `data-role` before `type` on inputs (unique) | sum +507 B (offline) | dropped |
| Unquoted option values (unique), retried | sum −54 B, +23 B at N=64 | dropped: mixed |
| The item's text binding written by the list runtime (unique) | −484 B summed at best (offline) | not built: the binding would no longer be the widget's own code |

Seventh pass (`runs.json` sizes and seeds, sums of the 27 totals against the step before):

| Idea | Effect | Verdict |
|---|---|---|
| Templates in one table after the widgets, `app(defs, receive, html)` (unique) | sum −4,862 B, −999 B at N=256, +19 B at N=1 | replaced by the table first |
| The table first, `app(html, defs, receive)`; or between, `app(defs, html, receive)` | sum −5,252 B; or −4,771 B | kept the first |
| The table in a module variable `H`, then on the dashboard element (`D.h`) | `D.h` sum −134 B against `H`, and 3 to 8 B less JavaScript at N=1 | kept `D.h`: no new runtime variable, so the minifier renames nothing |
| Templates as named constants (`const w6$html = …`), as Solid writes them | sum +827 B, +81 B at N=256 | dropped: a name per widget costs more than the separation gains |
| Each widget function gets its template as its first parameter | sum −4,991 B, +24 B at N=1 | dropped: the table is smaller |
| Item templates in the same table, in creation order (`list` takes the next) | sum +520 B | dropped |
| A text's static prefix in the template, through a second helper (`tail`) | sum −583 B, +20 B below N=16 | replaced: every text binding writes its own text node (sum −2,045 B) |
| A static suffix too (`${n} minutes`), the text node put first (`text(d, f, 1)`) | sum +173 B | dropped |
| No end tags at a template's end (unique; then shared) | sum −1,529 B; −183 B | kept |
| The same on shared, keeping a final `</button>` | sum −12 B | dropped: the buttons were part of the gain |
| A list item's remove as an in-place `rm(list, item)` (unique) | sum −158 B, fewer calls per remove | kept |
| Item bindings take the item as their argument (`text(0, (i) => i.text)`) (unique) | about −150 B, then ±50 B once the rest was in | dropped: noise, and a runtime that passes arguments to every binding |
| The same for item handlers, the item on the control (`X.h(X.r?.i)`) | +26 B at N=1, then sum +135 B | dropped |
| An item's record as its binding list (`(r = B = []).n = …`) (unique; then shared) | the reverse costs +294 B; shared sum +10 B | kept on unique only |
| A checklist with no done item as a plain `L(…)` list (unique) | sum −350 B | kept |
| `add` leaving out `done: false` (unique) | sum +66 B (+73 B at N=256: the runtime renamed) | dropped |
| An empty initial list as `[]` instead of `L()` (unique) | sum +164 B | dropped: `L(` is a copy |
| `show` without `!!` (unique; then shared) | sum −35 B; +48 B | kept on unique only |
| The number check on `X.v`, so no handler names a parameter (unique) | sum −127 B, +61 B at N=256 | dropped: mixed |
| `el()` with a default parameter instead of a block (unique; shared) | sum −38 B, more JavaScript at N=1; ±0 | dropped |
| Unquoted option values (unique), a third time | sum +2 B | dropped: noise |
| `bind(d, f, k, n, last)`: the node before the cache (unique) | sum −91 B | kept |
| shared: the labels table before the rows; after them | sum −599 B; −675 B | kept after |
| shared: every string of a row in the table, one array per row | +683 B against the labels alone | dropped |
| shared: the delegated listener as one expression, retried | sum −240 B | kept |
| shared: the setter on the binding list (`W[k].s`, no `S` map), retried | −7 to −14 B below N=4, sum about level | kept: it lands the small sizes at or below the start |
| shared: a new todo item without `done` | sum −5 B | dropped: noise |


## Honest limits

- **An event re-runs all of its widget's bindings,** with no memoization: about five, plus a
  list's items and the summaries that read the widget. That is the same granularity as
  tea-local's per-instance patch. It would grow with big components, not with the page.
- **A widget can only change its own state.** A handler mutates its own variables, and only the
  digest of that widget (and its readers) follows. A kind whose handler wrote to another widget
  would need the compiler to digest that widget too; this scenario has none.
- **Templates are HTML strings with compile-time constants spliced in.** The emitter escapes
  them when it writes them. Values that come from state (todo text, feed entries) only ever
  reach the DOM through text nodes or properties, never through `innerHTML`. A template is
  parsed once per widget and once per new list item. A template leaves out the end tags it
  closes with, which relies on the HTML parser closing open elements at the end of the input
  (it always does).
- **Some assumptions are checked at build time, not handled.** The emitter asserts that widget
  ids are `w1…wN` in order and that initial list ids are 1…k. Lists are keyed by an `id` field.
  A different spec would need explicit ids in the rows: a few bytes per widget.
- **External replacements assign every field through the widget's setter.** This assumes
  `serverSet` and `snapshot` send a widget's whole state, as the scenario specifies. On
  unique-components the setter's defaults are the initial state, so a field missing from a
  `serverSet` would take its initial value (not `undefined`), and a field named like an
  `Object.prototype` property would read that property when the setter initialises the state
  with `{}` (the emitter refuses such a name). Both scenarios treat a `serverSet` as a snapshot
  of one widget, and ignore a message with no `state` that has no branch of its own.
- **unique-components passes values through two runtime variables:** a setter reads the state
  being applied from `S`, and a handler reads its control from `X`. Both are set right before
  the call and read synchronously inside it, so nothing else can change them in between.
- **Initial flags are bit masks** (a checklist's or todo's done items, a toggles widget's
  switches), so a list holds at most 30 items at the start (the emitter checks it); items added
  later are not limited.
- **shared-components splices a widget's label into its heading's HTML** and summaries read the
  same string as text, so a label must need no escaping (the emitter checks it; a label with
  `&` or `<` would need a second, escaped copy in its row).
- **An int add trusts the field's range.** It checks only the bound its step can pass, which is
  exact while the field is within `[min, max]`: every op and the number input keep it there,
  and the scenario's external states send in-range values. An out-of-range `serverSet` value
  would be clamped on one side only (the dashboard counter has always worked this way).
- **unique-components keeps a read field in a module variable,** which works because every
  widget there is used once. A widget used twice would need its read fields on a per-instance
  record, as before.
- **Disposal relies on detaching the dashboard element:** its listeners are not reachable once
  it is gone, which the serve page confirms (0 listeners, 0 timers).
- **ARIA attributes are written through reflected properties** (`ariaSelected`, `ariaPressed`,
  `ariaExpanded`): Chrome, Safari, and Firefox 119 and later.
- **unique-components hoists the templates into one table in page order,** which the dashboard
  element keeps during mount (`D.h`); the n-th `widget()` call takes the n-th template. This
  works because every widget is created once, in page order; a widget created twice, or out of
  order, would need its template by name.
- **A text binding writes a text node of its own** (unique), after the static prefix the
  template gives its element. The element holds two text nodes where the reference has one; the
  page reads the same and serializes the same, as with Solid's templates.
- **The items of a checklist that starts with no done item have no `done` field** (unique) until
  one is toggled or replaced: an absent `done` reads as not done, and the checkbox binding writes
  nothing while the value stays `undefined` (the checkbox starts unchecked).
- **A non-canonical number spelling stays as typed.** If you type `1e2` into an amount whose
  value is already 100, the input still shows `1e2`. Solid's controlled input behaves the same.

## unique-components

`scenarios/unique-components/digest.js` writes every widget as **its own function**, with no
per-kind factories and no data rows (the shared-components size win came from rows, which the
scenario's rule forbids). A widget function holds, as code: its state (local variables, and
module variables for the fields other widgets read), its handlers (one arrow function per control, in the template's order, the ops compiled to
statements), its setter, its bindings (derived expressions compiled to JavaScript) and, for a
time-driven field, its tick function. Only initial values and texts are data, and the widgets'
templates (static HTML strings), which the app keeps apart in one table, in page order.

It uses `runtime-unique.js` instead of `runtime.js`: the same strategy (binding closures that
write on change, a local digest, handlers and bindings by position), but it knows nothing about
widget kinds. `widget(set, ...h)` builds the section from the next template of the table,
hands `h` to its controls in document order, keeps the setter on the widget's
binding list (`W[k].s`) and calls it once while `S` is empty, so its defaults set the initial
state (a feed widget puts its record in `O` itself), and makes its elements the ones bindings
refer to, each by its distance from the previous binding's element (`text(3, …)`). A widget's
own fields are the parameters of its function; its setter reads the state being applied from
`S`, and its handlers read their control from `X`:

```js
const w6 = ($motto) => {
  widget(() => ({ miles: w6$miles = 11, motto: $motto = "Harbor" } = S),
    (t) => Number.isInteger((t = X.valueAsNumber)) && t >= 0 && t <= 52 && (w6$miles = t), // enterMiles
    () => (w6$miles = 11, $motto = "Harbor"), // restoreAll
    () => $motto = X.value, // writeMotto
  );
  bind(2, () => w6$miles);
  text(1, () => w6$miles);
  text(3, () => ($motto.length - w6$miles));   // after the template's "Gap: "
  …
};

export default app([
  …,
  `<h2>Trail panel 77xz</h2><div><input type=number data-role=enterMiles><output></output></div><div><small>Unit 77xz</small><p>Gap: </p></div>…<p>Plus one: `,
  …
], [w1, w2, w3, w4, w5, w6, …], receive);
```
Differences from `runtime.js`:
- a list item is `<li data-key data-role>` (the item role is `{field}Item`);
- a reader widget copies its bindings into each source's list (`dep`, a compile-time fact, the
  sources as distances back), so a source's change digests the readers too, and nothing else;
- external events deep-copy what they receive (`structuredClone`), because handlers mutate
  the widget's lists in place and must not alter the sender's data.

## big-component

**digest fails this scenario's locality check. This is a dead end, kept as the honest result.**

`scenarios/big-component/digest.js` writes the one big form, and its small companion, as one
function each, as unique-components does (state, template, handlers, setter, bindings, tick; no
data rows), with `runtime-big.js` as the runtime. The form's bindings are **one list**: an event
runs its handler, then re-runs every binding of the form, each writing a DOM property only if its
value changed. The page is correct (`./rr check big-component digest` passes every step at sizes
1, 4, 16 and 64, seeds 1-3, with no mismatch, focus loss or replaced keyed node), and the cost of
an event is O(N).

**Locality** (`./rr work`, seed 1, calls per local action): 181 at N=16, then 261, 425, 791 and
1,556 at N=256 (8.6× for 16× the size; 7.9-8.6× across actions; per seed up to 10.5×).
`./rr check` at N=64→1024: 13.8-14.5× (425 → 5,870 calls). An earlier run of the same emitter,
which still made a separate list of each unit's wrapper `div`/`header`/`footer` (a boundary that
is not precision either), had 141 → 1,415 calls (10.0×) and 14.4×. Both fail the 8× limit.

**Why the fieldset version passed, and why it is gone.** digest had passed with one list per
fieldset: the generator handed it groups, so "re-run a whole list" was bounded by a block of the
form somebody else had drawn. The owner judged that a convenient boundary, not precision, and the
groups were removed from the scenario. A flat form has no block to re-run.

**Why it is not rescued by a list per field unit.** The option was a list for each unit, each
handler digesting the lists of the units whose fields it writes, and each reader joining its
sources' lists, all wired at build time. I judge that to be tea-inline's mechanism under another
name, and did not build it:
- the compiler would have to know, for every binding, which fields it reads, and for every
  handler, which fields it writes, and emit the exact set of bindings an action runs. That is
  tea-inline's per-field binding groups scheduled by the fields an action writes;
- what would be left of digest is that a run re-executes a unit's bindings and lets each check
  itself, which only changes how many bindings of the same unit run (a unit has one to three),
  not what decides which ones run;
- the lists would be drawn by the emitter at the granularity of one field, which is the
  dirty-bit/per-field design that digest's own section says it does not try. Any coarser list
  (every k units) is the arbitrary chunking the owner rejected.

So "re-run a whole list of bindings and let each check itself" cannot be local when the form is
one component without boundaries; staying local needs per-field knowledge, and with it the
approach is another one.

**Sizes** (`./rr measure`, brotli, median of 3 seeds, sizes 1-256, not committed): N=1 1,383 B;
N=16 3,003; N=64 5,929; N=256 16,199 (html about 145, runtime 864 at N=1 and about 1,120 from
N=8). Fit over all sizes: 1,837 B + 57.7 B per unit. Smaller than with the fieldset lists (about
1,811 + 61.9) because there is no wiring, but it is the size of a version that does not stay
local, so it is not a competitive point.

Style choices recorded in the emitter's `style`: one list per widget, derived `dep` wiring for
the companion, state as plain variables (locals of the form's function, module variables for the
three fields the companion reads, `O.w1` for the feed list), deep-copied external states,
templates as static strings, delegated events.

## big-table

`scenarios/big-table/digest.js` writes N data tables, each its own function, with
`runtime-table.js` as the runtime. **It passes `./rr check`, locality included** (sizes 1, 4, 16
and 64, seeds 1-3; every local action costs the same number of calls from N=16 to N=256, 1.00×),
and it is local for a structural reason: tables share no state, so no list is wired to any other.

**Structure.** Two kinds of binding list, both digest's own:
- **A table's list holds one binding, the rows' reconciler** (membership and order, by `id`, with
  a cursor that leaves a displaced node in place, so a swap moves two nodes). A toolbar button,
  a server page or a delete digests it. It digests a row's list only when the row is new or its
  object was replaced (a server page, a snapshot).
- **A row has its own list**, made with the row (digest's list-item record). A row control
  digests it alone: toggle and bump edit the row object in place; select also digests the row
  that was selected (`sel`), because the marker is a per-row binding. Handlers that edit some
  rows in place (every k-th, a server update) digest those rows' lists themselves. Nothing
  re-checks every row because the table was digested.

State is a plain object per table with the protocol's four fields; the initial rows come from the
table's own row builder (the PRNG is a closure over the state), so no row data is embedded. The
selection is dropped by the reconciler when its row is gone, which is the only way the reference
loses it. `receive` is generic (rows are plain objects keyed by column name) and is the same text
in every app. Each table's pools, row builder, template, toolbar handlers, row template, row
bindings and row handlers are its own code; computed cells are JavaScript expressions in the row's
bindings. The number and date formats and a few helpers (swap, every k-th, order by, select) are
the runtime's. Style choices are in the emitter's `style`.

**Sizes** (`./rr measure`, brotli, median of 3 seeds, adapter excluded, not committed): N=1 1,896 B
(html 148, js 1,748: runtime 989, app 759); N=4 3,110; N=16 5,569; N=64 12,448; N=256 35,979.
Fit over N ≥ 4: 3,492 B + 128.6 B per table (all sizes: 2,978 + 131.6). The runtime is 1,258 B
from N=8 (about 270 B of it Vite's modulepreload polyfill); everything else is app code. A table
costs about 129 B: its pools and headers are data, its row template, bindings and handlers are
code.

**Work against N** (`./rr work`, seed 1, `--rows` 1,000): the 24 local actions are flat from N=16
to N=256 (median 491 calls, e.g. select 11-26, swap 6, toggle 23, remove 501-1,012, serverUpdate
69). Only the snapshot grows (49,213 to 64,799, 1.32×; global by nature).

**Work against rows** (`--sizes 16`, `--rows 1000` against `--rows 10000`):
- **O(1) in rows, in calls and in time:** select (11-26 calls), toggle (23), bump (25), a
  `serverUpdate` of a few ids (69), a swap in calls (6).
- **O(rows) in calls, as the reference's own scans are:** remove 501-1,012 calls at 1,000 rows and
  5,043-10,012 at 10,000 (`filter` over the rows), `serverDelete` 491 to 5,033, remove
  checked 1,005 to 10,005, update every k-th 806 to 8,006 (rows/k times the row's bindings),
  sort 18,906-25,944 to 194,496-359,379, create, append and `serverRows` 17,006-43,006 to
  170,006-430,006, clear 5.
- **O(rows) in time that the call counter does not see:** every operation that digests the table's
  list walks all its rows in the reconciler (one `Map` lookup and one identity check per row, in a
  loop, not a call). Swap is 6 calls at any size but took about 180 µs at 1,000 rows and 1,500 µs
  at 10,000 (about 0.15 µs a row); remove 310 to 1,520 µs. A select or a toggle is 10-25 µs at
  both. So **swap and remove are flat in DOM work (two moves, one removal) but not in JavaScript
  work**; an index-based version could do them in O(1). Timed by hand in Chrome, N=4, noisy; not
  a harness result.

Row scans are written the way the other digest emitters write them (`filter` for a removal,
`includes` for a delete), not rewritten to lower the call count: the first version removed rows
with `indexOf` and `splice`, which hid the scan from `./rr work`, and was changed back.

**Honest limits.** The row digest on `serverRows` and a snapshot re-checks every row (their
objects are new), as it must. Creating 10,000 rows runs about 17 calls a row (the record, the
clone, the bindings and their first run), which is more than a hand-written vanilla table.
