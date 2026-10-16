# Scenario: unique-components

The contract of the `unique-components` scenario. It adds to the global contract in `CLAUDE.md`
and never relaxes it.

## What it models

**An app where every new feature is a new component.** Like `shared-components`, the page is a
dashboard of independent widgets, a few of which read the state of others. Unlike it, **no two
widgets share a structure**: each has its own state shape, its own messages, its own update logic
and its own view, and is used exactly once.

| | `shared-components` | `unique-components` |
|---|---|---|
| widgets come from | a catalogue of 13 kinds | primitives composed at random, per widget |
| one more widget costs | one more **use** of a kind (from N = 16) | one more **component type** |
| an implementation writes | one component per kind, instantiated N times | N components |
| what the slope measures | per-instance wiring | per-component code: model, messages, update, view |

Real apps grow both ways. This scenario measures the second: what each approach costs per
component written, once sharing per kind stops helping.

## What "size" means

**Size is the number of widgets, N.** Which sizes and seeds are measured is chosen per framework
in `runs.json` at the repository root, not here.

- Data stays small: lists hold a handful of items.
- **No two widgets of an app have the same structure**, even ignoring every text, number and
  name (the generator checks a structural signature and redraws on a collision).
- There is no steady point (no `steadyFrom`): every size adds new component types.
- Each widget carries a **token**, 4 seeded base-36 characters (for example `r157`), in its
  heading and in one caption. It is real content every implementation renders, so near-twin
  widgets cannot compress away. It adds about 10 bytes per widget after brotli, no more.

## Each widget is its own code (scenario rule)

The point of the scenario is that sharing per kind (one factory or handler table per kind, rows
of data) stops helping. An implementation could defeat that by embedding each widget's
description as data and shipping one runtime that interprets it. That is forbidden:

- **Its own code.** Each widget's update logic (what each message does to which fields), its
  event handlers, its bindings and its derived expressions are emitted as **that widget's own
  code**, the way a developer or a compiler would write the component.
- **Allowed:**
  - generic runtime helpers independent of any widget's behaviour (create an element, set a
    text, a keyed-list reconciler, an event-delegation mechanism);
  - static markup templates;
  - plain data that is genuinely data (labels, list items, initial values).
- **Not allowed:** behaviour encoded as data for an interpreter: op-code tables, action
  descriptors like `["add", 2, 3]`, view-description trees walked at runtime, or the spec's
  widget descriptions themselves.
- **Rule of thumb:** if deleting one widget's code from the bundle would leave its behaviour
  still described somewhere as data that a generic routine executes, it is an interpreter.

The reference `update` and `render` in `spec.js` *are* such interpreters: they are the
specification, not a model to copy.

## The component vocabulary

A widget is plain data: `{ id, kind, token, label, fields, messages, view }`. (`kind` is only a
display summary of the field types, such as `"int+list"`, shown by the serve panel; it is not a
component kind.)

### Fields (the widget's state)

A widget draws 1 to 5 fields (a reader 1 to 2), plus the draft field of a list fed from a draft
and the gate bool of a time-driven int (about 3.2 fields and 5 messages per widget on average).
Its state is `{ [field.name]: value }`.

| `type` | Value | Description keys |
|---|---|---|
| `int` | integer | `min`, `max`, `initial`; optional `tick` (k) and `tickWhen` (a bool field): **time-driven** |
| `bool` | boolean | `initial` |
| `text` | string | `initial` |
| `enum` | one of `options` | `options` (strings), `initial` |
| `list` | `[{ id, text }]`, or `[{ id, text, done }]` if `checkable` | `checkable`, `initial`; optional `feed: true` |

Field names are single lowercase words, valid identifiers everywhere (no JS or Elm keywords);
field and message names are unique within a widget.

### Messages

Every message is `{ widget, type: <message name>, …payload }`. A widget's `messages` list says
what each does:

| `kind` | Payload | Effect |
|---|---|---|
| `click` | none | apply `ops` in order, each to the result of the previous |
| `input` | `value` | set `field` to `value` (a string; a **number** for an `int` field) |
| `check` | none | negate the bool `field` |
| `select` | `value` | set the enum `field` to `value` |
| `item` | `id` | on list `field`: `op: "remove"` drops the item with that id; `op: "toggle"` negates its `done` |

The `ops` of a click message:

| Op | Effect |
|---|---|
| `["add", f, k]` | `f = clamp(f + k, min, max)` (k may be negative) |
| `["set", f, c]` | `f = c` (an int, bool, enum option or `""`) |
| `["toggle", f]` | `f = !f` |
| `["reset", f]` | `f = ` the field's `initial` (never used on lists) |
| `["cycle", f]` | the next enum option, wrapping around |
| `["push", list, draft]` | if `draft.trim()` is empty, nothing; else append `{ id, text: draft.trim() }` (with `done: false` if checkable) and set `draft = ""` |
| `["pushText", list, text]` | append `{ id, text }` (with `done: false` if checkable) |
| `["pop", list]`, `["shift", list]` | drop the last / first item (nothing if empty) |
| `["clear", list]`, `["clearDone", list]` | drop every item / every done item |

A new item's `id` is one more than the largest id in the list (1 for an empty list). Messages
with several ops touch several fields at once (a combined action, or "reset all"). A message
never removes from and pushes to the same list.

### Expressions

Bindings, derived texts, conditions and disabled states are typed expressions, written as
arrays:

| Expression | Type | Meaning |
|---|---|---|
| `["f", name]` | field's | the widget's own field |
| `["w", widgetId, name]` | field's | a field of an **earlier** widget (cross-widget read) |
| `["k", value]` | value's | a constant |
| `["+", a, b]`, `["-", a, b]` | int | arithmetic |
| `["count", L]`, `["done", L]`, `["left", L]` | int | items in a list; done items; not-done items |
| `["len", T]` | int | length of a text |
| `["has", T, "s"]` | bool | the text contains `s` (case-sensitive) |
| `["==", a, b]`, `["!=", …]`, `["<", …]`, `["<=", …]`, `[">", …]`, `[">=", …]` | bool | comparisons (strict equality) |
| `["and", a, b]`, `["or", a, b]`, `["not", a]` | bool | logic |
| `["if", c, a, b]` | a's | `a` when `c` holds, else `b` |

A **text** is a list of parts: strings, and expressions of type int (written in decimal) or text.

### View nodes

A widget renders as `<section data-key="{id}" data-role="widget"><h2>{label}</h2>…view…</section>`.

| Node | Renders |
|---|---|
| `{ el: "text", tag, parts }` | `<{tag}>{text}</{tag}>`; tag is `p`, `span`, `small`, `strong`, `em` or `output` |
| `{ el: "button", msg, text, disabled? }` | `<button data-role="{msg}">{text}</button>`, with `disabled` while the expression holds |
| `{ el: "input", msg, label?, placeholder?, invalid? }` | text field: `<input type="text" data-role="{msg}" placeholder="…">` bound to the field; int field: `<input type="number" data-role="{msg}">`. With `label`: `<label>{label}<input …></label>`. With `invalid: { when, message }`: right after it, `<p data-role="{msg}Error">{message}</p>` while `when` holds |
| `{ el: "check", msg, label }` | `<label><input type="checkbox" data-role="{msg}">{label}</label>`, checked = the bool |
| `{ el: "select", msg, label? }` | `<select data-role="{msg}">` with one `<option value="o">o</option>` per option, value = the enum (inside `<label>{label}…</label>` if given) |
| `{ el: "list", field, tag, check?, remove?, removeText? }` | `<{tag}>` (`ul` or `ol`) with one `<li data-key="{item.id}" data-role="{field}Item">` per item: `<input type="checkbox" data-role="{check}">` (checked = done) if `check`, `<span>{text}</span>`, `<button data-role="{remove}">{removeText}</button>` if `remove` |
| `{ el: "when", tag, cond, children }` | `<{tag}>children</{tag}>` while `cond` holds; nothing otherwise |
| `{ el: "group", tag, children }` | `<{tag}>children</{tag}>` always (`div`, `footer`, `header`, `fieldset`) |

Groups and conditional sections nest (up to about 5 levels). Input values, checkbox `checked`
and select values are live DOM properties, not attributes.

### How widgets vary

Every widget draws, from the seed: its field count and types; names, ranges, initial values and
options; for each field its controls (an int gets 1 to 3 of add k / subtract k / set c / reset
buttons and maybe a number input; a bool a checkbox, a toggle button or an on/off pair; a text
an input with optional validation; a list item controls, a draft-and-push or a constant push,
maybe a pop/shift/clear button; an enum a select or a cycle button); its displays; 0 to 2
derived texts (sums, differences, comparisons, conjunctions); sometimes a combined or
"reset all" message; 0 to 2 conditional sections (over bools, int thresholds, enum values, list
counts or text lengths, sometimes two at once); grouping and nesting; the order of everything.
Labels and texts come from word pools; each widget adds its token.

**Readers.** Every 8th widget (`--reader-every`) reads 2 to 3 fields of earlier widgets
(preferring recent ones, sometimes far back), sometimes with a sum over them; any other widget
reads one with probability 0.12.

**The first widgets.** So the work actions find the same targets at every size, the first eight
widgets each carry one capability on top of their random composition, never inside a
conditional section:

| Widget | Always has |
|---|---|
| w1 | an int with an "add k" button that is never disabled |
| w2 | a text input |
| w3 | a list fed from a draft (input and push button) with an item remove control |
| w4 | a bool with a checkbox or a toggle button |
| w5 | an enum with a select or a cycle button, and a feed list |
| w6 | an int with a number input |
| w7 | a time-driven int with its gate bool and a control for the gate |
| w8 | a reader whose first read is w6's number-input field |

## State and messages

- **State:** `{ widgets: { [id]: { [field]: value } } }`, one entry per widget.
- **User messages** come from DOM events on a widget's controls, as in the tables above.
- **External events (through `dispatch(msg)`):**
  - `{ type: "serverSet", widget, state }`: replace one widget's whole state;
  - `{ type: "tick" }`: every time-driven int whose `tickWhen` bool is true becomes
    `min(max, value + tick)`; every gate starts off;
  - `{ type: "notify", widget, field, item }`: append `item` (`{ id, text }`) to the widget's
    feed list `field`;
  - `{ type: "snapshot", state }`: a whole new state, every widget changed, keyed lists keeping
    their ids but partly reordered (a reversed slice), each with one new item.
- **The reference `update`** applies exactly the rules above; `render` produces exactly the HTML
  above. Implementations must not use timers: time moves only through `tick`.

## Selectors

- Widget: `[data-key="w7"]`, `data-role="widget"`.
- A control: `[data-key="w7"] [data-role="{message name}"]`; message names are unique in a widget.
- An item control: `[data-key="w7"] [data-key="{item id}"] [data-role="{message name}"]`; the
  item is `<li data-key="{id}" data-role="{field}Item">`.
- A validation error: `data-role="{message name}Error"`.

## The interaction script

Generated from the app, the same for every framework:
1. mount;
2. for each widget, each message exercised 1 to 2 times: inputs first (typing character by
   character), then selects, checkboxes, buttons and item controls; a second pass retries
   controls a conditional section hid. A step is only generated when its control is rendered
   and enabled in the reference at that moment, so about 95% of messages are exercised. A
   number input first gets two invalid values, one above its max and one that is not an
   integer: no message may be sent, and those steps do not compare the input's displayed
   value (it keeps the typed text);
3. `serverSet` on 3 widgets, the gates of up to two time-driven fields turned on, 3 `tick`s,
   2 `notify`s;
4. a reorder through `snapshot`;
5. a final round on every widget with a list and 3 others;
6. dispose.

## Scenario-specific expectations

On top of the global contract:
- **Keyed lists:** items keep their DOM node across pushes, removes, toggles and the snapshot
  reorder.
- **Focus and caret:** every text and number input keeps focus and caret while typed into,
  even when its widget re-renders (an error appearing, a derived text changing). The generator
  never puts an input inside a conditional section whose condition reads the input's field.
- **Conditional content:** `when` sections and validation errors appear and disappear without
  replacing their siblings.
- **Cross-widget reads:** after any change to a field another widget reads, that widget's text
  is correct, and widgets that did not change keep their nodes.
- **Number inputs:** the message is sent only while the input holds an integer within
  `[min, max]` (`value` is that number). Otherwise no message is sent, the state keeps its last
  valid value, and the input keeps what the user typed, with focus; until it holds a valid
  number again its displayed value is exempt from "same page". The script never leaves it so.
  (Number-input fields always have `min <= 0` and `max >= 20`.)
- **Disabled buttons** follow their expression; the script never clicks a disabled one.

## How to implement a widget

Write each widget as a component in your approach's idiom, from its description alone:

1. **Model:** one typed field per entry in `fields`, initialised from `initial`.
2. **Messages:** one message (or handler) per entry in `messages`, named after it, doing what
   its `kind` and `ops` say, written out as code.
3. **View:** the `view` tree, rendered once per node as the table says, with each expression
   compiled into a binding.
4. **Cross reads** (`["w", id, field]`) subscribe to or read the other widget's state through
   whatever your approach uses for shared state.

### A worked example

Widget `w3` of `--size 64 --seed 1`:

```json
{
  "id": "w3", "kind": "list+text", "token": "r157", "label": "Depot console r157",
  "fields": [
    { "name": "ideas", "type": "list", "checkable": true, "initial": [
      { "id": 1, "text": "Book the passport", "done": true },
      { "id": 2, "text": "Test the roof", "done": false },
      { "id": 3, "text": "Email the schedule", "done": true },
      { "id": 4, "text": "Renew the parcel", "done": true } ] },
    { "name": "draft", "type": "text", "initial": "" }
  ],
  "messages": [
    { "name": "toggleInIdeas", "kind": "item", "field": "ideas", "op": "toggle" },
    { "name": "discardFromIdeas", "kind": "item", "field": "ideas", "op": "remove" },
    { "name": "editDraft", "kind": "input", "field": "draft" },
    { "name": "saveToIdeas", "kind": "click", "ops": [["push", "ideas", "draft"]] }
  ],
  "view": [
    { "el": "list", "field": "ideas", "tag": "ol", "check": "toggleInIdeas",
      "remove": "discardFromIdeas", "removeText": "Remove" },
    { "el": "input", "msg": "editDraft", "placeholder": "Next step" },
    { "el": "group", "tag": "fieldset", "children": [
      { "el": "button", "msg": "saveToIdeas", "text": ["Add"] },
      { "el": "text", "tag": "p", "parts": [["done", ["f", "ideas"]], " of ", ["count", ["f", "ideas"]], " done"] },
      { "el": "text", "tag": "small", "parts": ["Slot r157"] } ] },
    { "el": "when", "tag": "section", "cond": [">=", ["count", ["f", "ideas"]], ["k", 2]], "children": [
      { "el": "text", "tag": "p", "parts": ["Plus one: ", ["+", ["len", ["f", "draft"]], ["k", 1]]] } ] }
  ]
}
```

The reference HTML of its initial state (indented here for reading; whitespace is ignored):

```html
<section data-key="w3" data-role="widget">
  <h2>Depot console r157</h2>
  <ol>
    <li data-key="1" data-role="ideasItem"><input type="checkbox" data-role="toggleInIdeas" checked><span>Book the passport</span><button data-role="discardFromIdeas">Remove</button></li>
    <li data-key="2" data-role="ideasItem"><input type="checkbox" data-role="toggleInIdeas"><span>Test the roof</span><button data-role="discardFromIdeas">Remove</button></li>
    <li data-key="3" data-role="ideasItem"><input type="checkbox" data-role="toggleInIdeas" checked><span>Email the schedule</span><button data-role="discardFromIdeas">Remove</button></li>
    <li data-key="4" data-role="ideasItem"><input type="checkbox" data-role="toggleInIdeas" checked><span>Renew the parcel</span><button data-role="discardFromIdeas">Remove</button></li>
  </ol>
  <input type="text" data-role="editDraft" placeholder="Next step" value="">
  <fieldset>
    <button data-role="saveToIdeas">Add</button>
    <p>3 of 4 done</p>
    <small>Slot r157</small>
  </fieldset>
  <section><p>Plus one: 1</p></section>
</section>
```

Typing "Tea" into the draft and clicking **Add** appends `<li data-key="5">` with "Tea"
(unchecked), empties the input, and shows "3 of 5 done" and "Plus one: 1"; removing items until
fewer than two remain removes the inner `<section>`.

### Allowed and not allowed

**Allowed:** the widget's behaviour emitted as its own code (any approach; plain JS shown).

```js
function update3(s, msg) {
  switch (msg.type) {
    case "saveToIdeas": {
      const text = s.draft.trim();
      if (!text) return s;
      return { ...s, ideas: [...s.ideas, { id: nextId(s.ideas), text, done: false }], draft: "" };
    }
    case "editDraft": return { ...s, draft: msg.value };
    // …
  }
}
// in the view: `${s.ideas.filter((i) => i.done).length} of ${s.ideas.length} done`
```

**Not allowed:** the behaviour kept as data, executed by a generic routine.

```js
const W3 = { msgs: { saveToIdeas: [["push", "ideas", "draft"]] },
             view: [["text", "p", [["done", "ideas"], " of ", ["count", "ideas"], " done"]]] };
function runOps(state, ops) { for (const op of ops) state = OPS[op[0]](state, op); return state; }
```

## Parameters

| Parameter | Default | Meaning |
|---|---|---|
| `--size` | 16 | N, the number of widgets |
| `--seed` | 1 | the random seed |
| `--reader-every` | 8 | every k-th widget is a reader of earlier widgets; 0 for none. The w8 guarantee above holds only at the default |

`./rr check` builds N = 16 by default (`quickCheckSize`), which also starts the locality check
(16 to 256). Each framework's emitter may take its own style parameters; it records which it
used, and runs in its documented idiomatic style by default.

## Not in this scenario

No CSS: the page ships HTML and JavaScript only, unstyled. No network: all data is generated or
arrives through `dispatch`. No routing: one page.
