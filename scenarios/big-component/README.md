# Scenario: big-component

The contract of the `big-component` scenario. It adds to the global contract in `CLAUDE.md` and
never relaxes it.

## What it models

**An app that grows by making one component bigger.** A large settings form: one component,
one model, whose fields are added one after another, with their controls, displays, and the
derived values, conditions, validations and disabled states that tie them together. A small
companion widget beside it reads a few of its fields and stays the same at every size.

The other two scenarios grow the other way, by adding many small widgets:

| | `shared-components` | `unique-components` | `big-component` |
|---|---|---|---|
| the page is | N widgets from 13 kinds | N widgets, each its own component | **1 component** (+ 1 fixed companion) |
| one more unit of size is | one more widget instance | one more component type | **one more field in the same component** |
| fields per component | a handful | about 3 | **about N** |
| the slope measures | per-instance wiring | per-component code | **per-field code inside one component** |

It measures two things the others cannot:

- **Size:** the cost of one more field (its state, messages, update code and bindings) in one
  component, without per-component scaffolding to amortise.
- **Whether updates stay precise inside a component.** With small widgets, re-running all of one
  widget's bindings after an event (as the `digest` and `tea-local` prototypes do) looks cheap.
  Here the widget is the whole form, so such a strategy costs O(N) per event, while one that runs
  only the bindings reading what changed (signals, dirty bits, per-field binding groups) stays
  O(1). The locality check of `./rr check` (calls per local action may grow at most 8× from N to
  16 N) tells them apart, as it already does for "re-run the whole page".

## What "size" means

**Size is N, the number of field units in the big component.** Which sizes and seeds are
measured is set per framework in `runs.json`, not here.

- A **field unit** is one field with everything that belongs to it: its controls, its displays,
  and the bindings it adds over earlier fields. A list fed from a draft brings its draft text
  field, and a time-driven int its gate bool, so the model has about 1.06 N fields (271 at
  N = 256) and about 1.5 messages per unit.
- Data stays small: lists hold a handful of items.
- **Prefix stability:** for one seed, unit i (its fields, messages and view nodes, and where they
  sit) is identical at every N. Growing N only appends units, groups and sections. A node that
  reads several units appears with the latest of them (a group's summary with the group's last
  unit).
- The component carries a **token**, 4 seeded base-36 characters, in its heading; the companion
  has its own. Field names already differ (each group has its own noun prefix), so there is no
  per-field token.

## The component is its own code (scenario rule)

The rule of `unique-components` ("Each widget is its own code") applies to the big component and
its companion:

- **Its own code.** Each message's update logic (what it does to which fields), the event
  handlers, the bindings and the derived expressions are emitted as **the component's own
  code**, the way a developer or a compiler would write a large form.
- **Allowed:** generic runtime helpers independent of any field's behaviour (create an element,
  set a text, a keyed-list reconciler, event delegation), static markup templates, plain data
  that is genuinely data (labels, list items, initial values).
- **Not allowed:** behaviour encoded as data for an interpreter: op-code tables, action
  descriptors like `["add", "billingOrders", 2]`, view-description trees walked at runtime, a
  table of fields with "kind" tags driving one generic handler, or the spec's descriptions
  themselves.
- **Rule of thumb:** if deleting one field's code from the bundle would leave its behaviour
  still described somewhere as data that a generic routine executes, it is an interpreter.

Splitting the form into sub-components (per section or per group) is allowed where it is the
approach's idiom, but the state is **one model** (`state.widgets.w1`), and the bindings cross
groups (see the dependencies below), so a split has to pass the fields it reads.

The reference `update` and `render` in `spec.js` are interpreters: they are the specification,
not a model to copy.

## The vocabulary

**Exactly the vocabulary of `unique-components`** (its README, "The component vocabulary"):
widgets `{ id, kind, token, label, fields, messages, view }`; field types `int` (optionally
time-driven: `tick`, `tickWhen`), `bool`, `text`, `enum`, `list` (`checkable`, `feed`);
message kinds `click` (with `ops`), `input`, `check`, `select`, `item`; the ops; the typed
array expressions; the view nodes `text`, `button`, `input`, `check`, `select`, `list`,
`when`, `group` and the HTML each renders. Nothing is added. The differences:

| | `unique-components` | `big-component` |
|---|---|---|
| widgets | `w1`…`wN` | `w1` (`kind: "form"`), `w2` (`kind: "companion"`) |
| field names | single words (`orders`) | group noun + word, camelCase (`printerVolume`); unique in the component |
| messages | 1-2 fields each | the same: every message writes one field, or two (a combined button) |
| reads of another widget | readers of earlier widgets | only the companion, of three w1 fields |
| page root | `<div data-role="dashboard">` | `<div data-role="page">` |

### The shape of the component

```
section w1  <h2>{label}</h2>
├─ group div            a section: <strong>{title}</strong>, 2-4 groups, maybe a section total
│  ├─ group fieldset    a group: <em|strong|span>{title}</em>, 2-5 units, maybe "n of m set"
│  │  ├─ unit …         a unit's nodes (sometimes wrapped in a div/header/footer)
│  │  ├─ unit …
│  │  └─ text small     the group summary
│  └─ text p            the section total
└─ …
```

| Shape | What it is | Reads |
|---|---|---|
| **section** | `group div`: a title, 2-4 groups | — |
| **section total** | `<p>{title} total: a + b + c</p>`, the sum of the section's first three ints (60% of sections; none with fewer than three ints) | 3 fields |
| **group** | `group fieldset`: a title, 2-5 units | — |
| **gated group** | 30% of groups of 3+ units (never before unit 9): its first unit is a bool with a checkbox; the rest of the group is in `when ["f", gate]` | 1 field |
| **group summary** | `<small>{n} of {m} set</small>`, one term per unit: `["if", cond, 1, 0]` with cond int `> min`, bool on, text non-empty, enum not its first option, list non-empty (50% of groups) | every unit of the group |
| **unit** | one field and its controls and displays, as unique-components draws them per type (int 30%, bool 20%, text 20%, enum 15%, list 6%, time-driven int 2%) | its field |

And the bindings a unit adds over **earlier fields**, only those of the previous 6 units
(`WINDOW`), so no field is read by more than a bounded number of bindings:

| Dependency | How often | Example |
|---|---|---|
| derived text over this field and 1-2 earlier ones | 35% of units | `["+", ["f","printerDegrees"], ["f","printerVolume"]]` |
| conditional section over an earlier field (or two), wrapping some of the unit's nodes | 20% | `when [">=", ["f","printerVolume"], ["k",2]]` |
| validation over this text and an earlier field | 40% of texts | `["and", [">", ["f","printerDegrees"], ["k",-8]], ["==", ["len", ["f","syncCaption"]], ["k",0]]]` |
| disabled state reading an earlier field | 15% | `["or", ["<=", ["f","syncDegrees"], ["k",0]], ["f","printerLive"]]` |
| combined button writing this field and an earlier one | 12% | `ops: [["add","harborPlates",1], ["reset","contactCity"]]` |

**Reads per field** (binding sites reading a field: each expression in a text, a disabled
state, a condition, a validation, and the value binding of an input, checkbox, select or list;
the companion's reads included), seeds 1-3:

| N | 16 | 32 | 64 | 128 | 256 |
|---|---|---|---|---|---|
| max | 6-8 | 6-8 | 6-8 | 6-8 | 6-8 |
| average | 2.5-3.3 | 2.8-3.3 | 2.9-3.3 | 2.9-3.3 | 3.1 |

At N = 256 (average of seeds 1-3): 271 fields, 397 messages, 75 groups, 106 texts reading two or
more fields, 71 conditional sections, 20 cross-field disabled states, 18 two-field validations,
31 combined buttons, 16 keyed lists, 5 time-driven ints; nesting up to 6 levels.

### The first units

So the work actions find the same targets at every size, the first nine units each carry one
capability, never inside a conditional section, and the groups holding them are never gated:

| Unit | Always is |
|---|---|
| 0 | an int with an "add k" button that is never disabled |
| 1 | a text with an input |
| 2 | a list fed from a draft (input and push button) with an item remove control |
| 3 | a bool with a checkbox or a toggle button |
| 4 | an enum with a select or a cycle button |
| 5 | a feed list (the target of `notify`) |
| 6 | an int with a number input |
| 7 | a time-driven int with its gate bool and a control for the gate |
| 8 | an int with a derived text reading unit 6's field, and a conditional section over unit 3's bool |

### The companion

`w2`, the same at every N ≥ 7: a `pinned` checkbox, a `reviewer` input (error while empty),
one text per w1 field it reads (units 0, 3 and 6, through `["w", "w1", name]`), their sum when
two are ints, and an `aside` shown while pinned. At N < 7 it reads only the units that exist.

## State and messages

- **State:** `{ widgets: { w1: { [field]: value }, w2: { pinned, reviewer } } }`.
- **User messages** come from DOM events on the controls, as in unique-components:
  `{ widget, type: <message name>, …payload }`.
- **External events (through `dispatch(msg)`):**
  - `{ type: "serverSet", widget, state }`: replace one widget's whole state: `w2`, or `w1`,
    the **whole component** (every field changes except bools, which flip at random; lists
    lose one item and gain one);
  - `{ type: "tick" }`: every time-driven int whose `tickWhen` bool is on becomes
    `min(max, value + tick)`; every gate starts off;
  - `{ type: "notify", widget: "w1", field, item }`: append `item` (`{ id, text }`) to the
    component's feed list;
  - `{ type: "snapshot", state }`: a whole new state, every field changed, keyed lists keeping
    their ids but partly reordered (a reversed slice), each with one new item.
- **The reference `update`** applies exactly these rules; `render` produces exactly the HTML of
  the vocabulary. No timers: time moves only through `tick`.

## Selectors

- Widgets: `[data-key="w1"]` and `[data-key="w2"]`, `data-role="widget"`.
- A control: `[data-key="w1"] [data-role="{message name}"]`; message names are unique in the
  component.
- An item control: `[data-key="w1"] [data-key="{item id}"] [data-role="{message name}"]`; the
  item is `<li data-key="{id}" data-role="{field}Item">`.
- A validation error: `data-role="{message name}Error"`.

## The interaction script

Generated from the app, the same for every framework:
1. mount;
2. a sample of the component's units: every unit up to N = 32, else the first 12 and 20 others
   (seeded). For each sampled unit, the messages writing its fields, 1-2 times each: inputs
   first (typed character by character), then selects, checkboxes, buttons and item controls;
   then a second pass retries the controls a conditional section hid. A number input first gets
   two invalid values (above its max, not an integer) that send no message and are exempt from
   the value comparison (`exemptValue`). Then the companion's messages;
3. `serverSet w2`, `serverSet w1` (the whole component), the gates of up to two time-driven
   fields turned on, 3 `tick`s, 2 `notify`s;
4. a reorder through `snapshot`;
5. a final round: every sampled unit with a list (all its messages), one message of three other
   sampled units, the companion;
6. dispose.

The script stays short as N grows: 60-85 steps at N = 16, 95-150 at N = 32 to 256. About 88%
of the sampled units' messages are exercised (76-100% per spec) (the rest sit behind conditions that stay closed,
disabled states that stay on, or lists left empty). Every step is only generated when its
control is rendered and enabled in the reference at that moment.

## Scenario-specific expectations

On top of the global contract, the same as unique-components':
- **Keyed lists:** items keep their DOM node across pushes, removes, toggles and the snapshot
  reorder.
- **Focus and caret:** every text and number input keeps focus and caret while typed into, even
  when the component re-renders around it (an error appearing, a derived text or a summary
  changing). No input is inside a conditional section whose condition reads the input's field.
- **Conditional content:** `when` sections (gated groups included) and validation errors appear
  and disappear without replacing their siblings.
- **Precise updates:** nodes whose content did not change are not replaced, however big the
  component. (Work per event is measured by `./rr work`; prototypes are held to locality.)
- **Number inputs:** the message is sent only while the input holds an integer within
  `[min, max]`; otherwise no message, the state keeps its last valid value and the input keeps
  what the user typed. Number-input fields have `min <= 0` and `max >= 20`.
- **Disabled buttons** follow their expression; the script never clicks a disabled one.

## A worked example

`--size 4 --seed 1`: the first four units, all in the first group of the first section. One
line per field and message:

```json
{ "id": "w1", "kind": "form", "token": "04zc", "label": "Warehouse preferences 04zc",
  "fields": [
    { "name": "keyboardStamps", "type": "int", "min": 1, "max": 25, "initial": 8 },
    { "name": "keyboardRemark", "type": "text", "initial": "zip" },
    { "name": "keyboardIdeas", "type": "list", "checkable": true, "initial": [
      { "id": 1, "text": "Check the supplier", "done": false }, { "id": 2, "text": "Send the slides", "done": false } ] },
    { "name": "keyboardEntry", "type": "text", "initial": "" },
    { "name": "keyboardPinned", "type": "bool", "initial": false } ],
  "messages": [
    { "name": "growKeyboardStamps", "kind": "click", "ops": [["add", "keyboardStamps", 1]] },
    { "name": "setKeyboardStampsTo17", "kind": "click", "ops": [["set", "keyboardStamps", 17]] },
    { "name": "writeKeyboardRemark", "kind": "input", "field": "keyboardRemark" },
    { "name": "toggleInKeyboardIdeas", "kind": "item", "field": "keyboardIdeas", "op": "toggle" },
    { "name": "deleteFromKeyboardIdeas", "kind": "item", "field": "keyboardIdeas", "op": "remove" },
    { "name": "editKeyboardEntry", "kind": "input", "field": "keyboardEntry" },
    { "name": "appendToKeyboardIdeas", "kind": "click", "ops": [["push", "keyboardIdeas", "keyboardEntry"]] },
    { "name": "emptyKeyboardIdeas", "kind": "click", "ops": [["clear", "keyboardIdeas"]] },
    { "name": "toggleKeyboardPinned", "kind": "click", "ops": [["toggle", "keyboardPinned"]] } ],
  "view": [
    { "el": "group", "tag": "div", "children": [
      { "el": "text", "tag": "strong", "parts": ["Billing"] },
      { "el": "group", "tag": "fieldset", "children": [
        { "el": "text", "tag": "strong", "parts": ["Keyboard options"] },
        { "el": "text", "tag": "p", "parts": ["Stamps: ", ["f", "keyboardStamps"]] },
        { "el": "button", "msg": "growKeyboardStamps", "text": ["Up 1"] },
        { "el": "button", "msg": "setKeyboardStampsTo17", "text": ["= 17"] },
        { "el": "input", "msg": "writeKeyboardRemark", "label": "Remark" },
        { "el": "text", "tag": "p", "parts": ["Together: ", ["+", ["len", ["f", "keyboardRemark"]], ["f", "keyboardStamps"]]] },
        { "el": "input", "msg": "editKeyboardEntry", "placeholder": "Next step" },
        { "el": "button", "msg": "appendToKeyboardIdeas", "text": ["Append"] },
        { "el": "button", "msg": "emptyKeyboardIdeas", "text": ["Clear all"] },
        { "el": "list", "field": "keyboardIdeas", "tag": "ul", "check": "toggleInKeyboardIdeas",
          "remove": "deleteFromKeyboardIdeas", "removeText": "×" },
        { "el": "button", "msg": "toggleKeyboardPinned", "text": [["if", ["f", "keyboardPinned"], ["k", "Stop"], ["k", "Start"]]] } ] } ] } ] }
```

The companion at this size reads units 0 and 3 (unit 6 does not exist yet):

```json
{ "id": "w2", "kind": "companion", "token": "1dbt", "label": "Summary 1dbt",
  "fields": [{ "name": "pinned", "type": "bool", "initial": false }, { "name": "reviewer", "type": "text", "initial": "" }],
  "messages": [{ "name": "checkPinned", "kind": "check", "field": "pinned" }, { "name": "editReviewer", "kind": "input", "field": "reviewer" }],
  "view": [
    { "el": "check", "msg": "checkPinned", "label": "Pinned" },
    { "el": "input", "msg": "editReviewer", "label": "Reviewer",
      "invalid": { "when": ["==", ["len", ["f", "reviewer"]], ["k", 0]], "message": "Name a reviewer" } },
    { "el": "text", "tag": "p", "parts": ["Stamps: ", ["w", "w1", "keyboardStamps"]] },
    { "el": "text", "tag": "p", "parts": ["Pinned: ", ["if", ["w", "w1", "keyboardPinned"], ["k", "yes"], ["k", "no"]]] },
    { "el": "when", "tag": "aside", "cond": ["f", "pinned"], "children": [{ "el": "text", "tag": "small", "parts": ["Pinned for review 1dbt"] }] } ] }
```

The reference HTML of the initial state (indented for reading; whitespace is ignored):

```html
<div data-role="page">
  <section data-key="w1" data-role="widget">
    <h2>Warehouse preferences 04zc</h2>
    <div>
      <strong>Billing</strong>
      <fieldset>
        <strong>Keyboard options</strong>
        <p>Stamps: 8</p>
        <button data-role="growKeyboardStamps">Up 1</button>
        <button data-role="setKeyboardStampsTo17">= 17</button>
        <label>Remark<input type="text" data-role="writeKeyboardRemark" value="zip"></label>
        <p>Together: 11</p>
        <input type="text" data-role="editKeyboardEntry" placeholder="Next step" value="">
        <button data-role="appendToKeyboardIdeas">Append</button>
        <button data-role="emptyKeyboardIdeas">Clear all</button>
        <ul>
          <li data-key="1" data-role="keyboardIdeasItem"><input type="checkbox" data-role="toggleInKeyboardIdeas"><span>Check the supplier</span><button data-role="deleteFromKeyboardIdeas">×</button></li>
          <li data-key="2" data-role="keyboardIdeasItem"><input type="checkbox" data-role="toggleInKeyboardIdeas"><span>Send the slides</span><button data-role="deleteFromKeyboardIdeas">×</button></li>
        </ul>
        <button data-role="toggleKeyboardPinned">Start</button>
      </fieldset>
    </div>
  </section>
  <section data-key="w2" data-role="widget">
    <h2>Summary 1dbt</h2>
    <label><input type="checkbox" data-role="checkPinned">Pinned</label>
    <label>Reviewer<input type="text" data-role="editReviewer" value=""></label>
    <p data-role="editReviewerError">Name a reviewer</p>
    <p>Stamps: 8</p>
    <p>Pinned: no</p>
  </section>
</div>
```

Clearing Remark shows "Together: 8" (`len("") + 8`); clicking **Up 1** then shows "Stamps: 9"
in both widgets and "Together: 9". At every bigger size, everything above stays exactly as it is
(unit 4 joins this group, which has no summary).

**Dependencies at a bigger size.** At `--size 16 --seed 1`, unit 8 (printer group) and the gated
"Sync details" group (units 9-11):

```json
{ "el": "text", "tag": "p", "parts": ["Together: ", ["+", ["f", "printerDegrees"], ["f", "printerVolume"]]] },
{ "el": "when", "tag": "div", "cond": ["not", ["f", "keyboardPinned"]], "children": [
  { "el": "text", "tag": "p", "parts": ["Lunch is served from noon."] },
  { "el": "text", "tag": "span", "parts": [["f", "printerDegrees"], " degrees"] } ] }

{ "el": "group", "tag": "fieldset", "children": [
  { "el": "text", "tag": "em", "parts": ["Sync details"] },
  { "el": "check", "msg": "tickSyncSeparate", "label": "Separate" },
  { "el": "text", "tag": "p", "parts": [["if", ["and", ["f", "syncSeparate"], ["f", "keyboardPinned"]], ["k", "All set"], ["k", "Not yet"]]] },
  { "el": "when", "tag": "div", "cond": ["f", "syncSeparate"], "children": [
    { "el": "text", "tag": "p", "parts": ["Gap: ", ["-", ["f", "syncDegrees"], ["f", "printerElapsed"]]] },
    { "el": "button", "msg": "lowerSyncDegrees", "text": ["Down 1"],
      "disabled": ["or", ["<=", ["f", "syncDegrees"], ["k", 0]], ["f", "printerLive"]] },
    { "el": "text", "tag": "output", "parts": [["f", "syncDegrees"]] },
    { "el": "button", "msg": "zeroSyncDegrees", "text": ["Reset"] },
    { "el": "when", "tag": "div", "cond": [">=", ["f", "printerVolume"], ["k", 2]], "children": [
      { "el": "input", "msg": "typeSyncCaption", "placeholder": "Enter a caption",
        "invalid": { "when": ["and", [">", ["f", "printerDegrees"], ["k", -8]], ["==", ["len", ["f", "syncCaption"]], ["k", 0]]],
                     "message": "Required when degrees is above -8" } },
      { "el": "text", "tag": "small", "parts": [["len", ["f", "syncCaption"]], " chars"] } ] } ] },
  { "el": "text", "tag": "small", "parts": [["+", ["+",
    ["if", ["f", "syncSeparate"], ["k", 1], ["k", 0]],
    ["if", [">", ["f", "syncDegrees"], ["k", 0]], ["k", 1], ["k", 0]]],
    ["if", [">", ["len", ["f", "syncCaption"]], ["k", 0]], ["k", 1], ["k", 0]]], " of 3 set"] } ] }
```

Typing into the volume number input (unit 6) must update unit 8's "Together", the printer
group's summary, the companion's "Volume" and "Combined", and open or close the caption section
in the next group, and nothing else. Changing `keyboardPinned` (unit 3) updates its button,
unit 8's section, the gate's "All set" in another group and the companion.

## How to implement it

Write the form as one component (or the approach's idiomatic split of it) in your approach's
idiom, from the descriptions alone, as for a unique-components widget: one typed field per entry
in `fields`, one message or handler per entry in `messages` written out as code, the `view`
rendered once with each expression compiled into a binding, and the companion's
`["w", "w1", name]` reads through whatever the approach uses for shared state.

## Parameters

| Parameter | Default | Meaning |
|---|---|---|
| `--size` | 16 | N, the number of field units in the big component |
| `--seed` | 1 | the random seed |

`./rr check` builds N = 16 by default (`quickCheckSize`), which also starts the locality check
(16 to 256). The work actions (`harness/work/big-component.js`) need N ≥ 9. Each framework's
emitter may take its own style parameters; it records which it used, and runs in its documented
idiomatic style by default.

## Not in this scenario

No CSS, no network, no routing: one page, as in unique-components.
