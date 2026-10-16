# digest (prototype)

A rendering strategy that no framework ships as such: the output an ideal compiler would produce
for **compiled dirty checking**. It sits in the prototype track.

**The idea in one line:** state is plain mutable data. Every dynamic DOM property is a closure.
After each event, one digest runs every closure once and writes the DOM only where the value
changed. There is no dependency tracking, no virtual DOM and no scheduler.

It is AngularJS's digest loop, but compiled: the compiler writes the watchers as direct property
writes, and the per-instance constants become rows of data.

## How it works

### A widget kind compiles to one factory

The compiler sees the app's description (each kind's state, messages and view) and emits **one
factory per widget kind** that the app uses. The factory holds the kind's template, its bindings
and its handlers. Here is the counter, as `scenarios/dashboard/digest.js` emits it:

```js
const counter = (s, l, st, mn, mx, v0) => {
  s.value = v0;                                    // initial state
  widget("counter", l, `<output data-role=value></output><button data-role=dec>-${st}</button>…`, {
    dec: () => { s.value = Math.max(mn, s.value - st); },   // update arms, keyed by data-role
    inc: () => { s.value = Math.min(mx, s.value + st); },
    reset: () => { s.value = v0; },
  });
  text("value", () => s.value);                    // view: one binding per dynamic property
  bind(role("dec"), "disabled", () => s.value <= mn);
  bind(role("inc"), "disabled", () => s.value >= mx);
};
```

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
finds the section the event came from, looks up the handler for the target's `data-role`, and
calls it with the element and the nearest `data-key`. Then it runs the digest:

```js
const onEvent = ({ target: t }) => {
  const f = t.closest("section")?.h?.[t.dataset.role];
  if (f) { f(t, t.closest("[data-key]").dataset.key); run(B); }
};

// a binding: write n[k] only when f() changed since the last write
const bind = (n, k, f, last) => B.push(() => last !== (last = f()) && (n[k] = last));
```

Handlers that read form controls read the element (`s.on[k] = t.checked`, `s.text = t.value`),
so they are idempotent. That matters because a checkbox fires both `click` and `input`.

**The last written value is cached, not compared with the DOM.** An input the user is typing
into is never written back with the same text, so it keeps focus and caret. The amount rule
works the same way: while the number input is invalid, no handler runs, the state keeps its
last value, and the binding stays silent, so the input keeps what the user typed.

### Keyed lists and conditional content

A list is one more binding. It reconciles items by `id` in place and runs each item's own
bindings. Item bindings read `r.i`, the item's current value, so a snapshot that sends new item
objects with the same ids updates the existing nodes:

```js
list($("ul"), () => s.items, (r, i) => {
  const li = el("li", `<input type=checkbox data-role=toggle><span></span><button data-role=remove>${rm}</button>`);
  li.dataset.key = i.id;
  bind(li.firstChild, "checked", () => r.i.done);
  bind(li.children[1], "textContent", () => r.i.text);
  return li;
});
```

Conditional content (`panel` body, `field` error, `choice` extra input, `feed` "no news") is a
binding that inserts or removes one node before the sibling it had in the template. It touches
nothing else.

### Summaries

A summary is just a binding that reads other widgets. It needs no subscription, because every
binding runs on every digest:

```js
src = src.map((i) => E["w" + i]);               // what the source widgets expose: m() and p(n)
text("summary", () => { const v = src.map((e) => e.m()); … });
```

### External events

`receive` is app code, and it changes state in place. The adapter only forwards `dispatch` to
it, and the runtime digests afterwards:

```js
const receive = (m) => {
  if (m.type == "serverSet") Object.assign(S[m.widget], m.state);
  else if (m.type == "snapshot") for (const k in m.state.widgets) Object.assign(S[k], m.state.widgets[k]);
  else if (m.type == "tick") for (const k in E) E[k]?.t?.();          // only with a clock
  else if (m.type == "notify") S[m.widget].entries.push(m.entry);    // only with a feed
};
```

`dispose()` removes the dashboard element, and its two listeners go with it. The runtime creates
no timers. `settled()` resolves at once, because every update is synchronous.

## Why it's small

Dashboard, compressed totals (brotli 11), 9 sizes × 3 seeds, adapter excluded:

| | N=1 (median) | fit, all sizes | fit, N ≥ 16 |
|---|---|---|---|
| **digest** | **1,027 B** | 2,115 + 24.3 B/widget | **3,130 + 18.6 B/widget** |
| Solid 1 | 6,583 B | 8,293 + 35.8 | 9,652 + 28.1 |
| tea-inline (prototype) | 1,127 B | 2,762 + 36.0 | 4,125 + 28.3 |

Where the bytes go:
- **The runtime is 665 B br at N=1 and 847 B with lists and conditionals.** About 270 B of
  that is Vite's modulepreload polyfill, which every Vite build in this repo ships. The core
  (bind, show, list, widget, delegation, mount and dispose) is about 120 lines of source.
- **Per kind:** 150 to 400 B br of app code (the template, bindings and handlers), paid once.
  At N=16 the app code is about 2.2 KB.
- **Per widget: about 18.6 B, close to the data floor.** The instance rows are almost all
  content strings: labels, texts, items. Brotli of the strings alone grows by 14.4 B/widget
  (N=16 to 256). The full rows grow by 19.1. Only a few bytes per widget are structure:
  brackets, the factory reference, numbers.
- **Nothing per instance is code.** No closures are written per instance, no component
  boilerplate, no message types. Everything that varies is data the factory reads.

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

## Honest limits

- **Every event runs every binding.** The work is O(bindings), about five per widget, with no
  memoization. The cost is CPU time, not bytes. This study measures only size, and
  fine-grained reactivity spends its runtime bytes on exactly this.
- **Templates are HTML strings with compile-time constants spliced in.** The emitter escapes
  them when it writes them. Values that come from state (todo text, feed entries) only ever
  reach the DOM through `textContent` or properties, never through `innerHTML`. A template is
  parsed once per widget and once per new list item.
- **Some assumptions are checked at build time, not handled.** The emitter asserts that widget
  ids are `w1…wN` in order and that initial list ids are 1…k. Lists are keyed by an `id` field.
  A different spec would need explicit ids in the rows: a few bytes per widget.
- **A conditional node must have a stable next sibling.** All four conditionals here are the
  last child, so this holds. Two adjacent conditionals would need an anchor comment.
- **External replacements merge with `Object.assign`.** This assumes `serverSet` and
  `snapshot` send a widget's whole state, as the scenario specifies.
- **Disposal relies on detaching the dashboard element:** its listeners are not reachable once
  it is gone, which the serve page confirms (0 listeners, 0 timers).
- **ARIA attributes are written through reflected properties** (`ariaSelected`, `ariaPressed`,
  `ariaExpanded`): Chrome, Safari, and Firefox 119 and later.
- **A non-canonical number spelling stays as typed.** If you type `1e2` into an amount whose
  value is already 100, the input still shows `1e2`. Solid's controlled input behaves the same.
