# Scenario: big-component

The contract of the `big-component` scenario. It adds to the global contract in `CLAUDE.md` and
never relaxes it.

## What it models

**An app that grows by making one component bigger.** A large settings form: one component,
one model, whose fields are added one after another in one flat list, with their controls,
displays, and the derived values, conditions, validations and disabled states that tie them
together. A small companion widget beside it reads a few of its fields and stays the same at
every size.

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
  16 N) tells them apart, as it already does for "re-run the whole page". The form has no
  sections or groups, so there is no smaller block of the form to re-run instead of the whole.

## What "size" means

**Size is N, the number of field units in the big component.** Which sizes and seeds are
measured is set per framework in `runs.json`, not here.

- A **field unit** is one field with everything that belongs to it: its controls, its displays,
  and the bindings it adds over earlier fields. A list fed from a draft brings its draft text
  field, and a time-driven int its gate bool, so the model has about 1.07 N fields (275 at
  N = 256) and about 1.6 messages per unit.
- Data stays small: lists hold a handful of items.
- **Prefix stability:** for one seed, unit i (its fields, messages and view nodes, and where they
  sit) is identical at every N. Growing N only appends units. A node that reads several units
  appears with the latest of them.
- The component carries a **token**, 4 seeded base-36 characters, in its heading; the companion
  has its own. Field names already differ (each unit draws its own noun prefix), so there is no
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

Splitting the form into sub-components is allowed where it is the approach's idiom, but the
state is **one model** (`state.widgets.w1`), the spec draws no boundaries to split along, and a
binding may read a field from anywhere earlier in the form (see the dependencies below), so a
split is the implementation's own choice and has to pass the fields it reads.

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
| field names | single words (`orders`) | the unit's noun + word, camelCase (`lobbyCoins`); unique in the component |
| messages | 1-2 fields each | the same: every message writes one field, or two (a combined button) |
| reads of another widget | readers of earlier widgets | only the companion, of three w1 fields |
| page root | `<div data-role="dashboard">` | `<div data-role="page">` |

### The shape of the component

```
section w1  <h2>{label}</h2>
├─ unit 0 …     its nodes, directly in the section
├─ unit 1 …
├─ …
└─ unit N-1 …
```

The form is **one flat sequence of N field units**, directly in the component's section after
its heading. There are no sections, fieldsets or titled groups, no gated groups, no per-group
summaries and no totals over a block of the form: nothing in the spec marks a block of units.
A **unit** is one field and its controls and displays, as unique-components draws them per type
(int 30%, bool 20%, text 20%, enum 15%, list 6%, time-driven int 2%). Its own nodes sometimes
sit in a wrapper of their own (`group` with a `div`, `header` or `footer`, 25% of units); a
wrapper never holds nodes of another unit.

And the bindings a unit adds over **earlier fields**:

| Dependency | How often | Example |
|---|---|---|
| derived text over this field and (usually) 1-2 earlier ones | 50% of units | `["+", ["f","lobbyCoins"], ["f","projectCalls"]]` |
| conditional section over an earlier field (or two), wrapping some of the unit's nodes | 20% | `when ["<", ["f","lobbyCoins"], ["k",7]]` |
| validation over this text and an earlier field | 40% of texts | `["and", [">", ["f","lobbyCoins"], ["k",7]], ["==", ["len", ["f","deliveryTitle"]], ["k",0]]]` |
| disabled state reading an earlier field | 15% | `["<", ["f","backupVotes"], ["k",0]]` |
| combined button writing this field and an earlier one | 12% | `ops: [["add","backupVotes",-1], ["toggle","themeSynced"]]` |

An earlier field is usually a nearby one, but about a third of these reads reach further back,
as far as the first unit: a field can be read by a binding a hundred units after it. What stays
bounded is how many bindings read one field, whatever N:

**Reads per field** (binding sites reading a field: each expression in a text, a disabled
state, a condition, a validation, and the value binding of an input, checkbox, select or list;
the companion's reads included), seeds 1-3:

| N | 16 | 32 | 64 | 128 | 256 |
|---|---|---|---|---|---|
| max | 7 | 7 | 7 | 7-8 | 7-8 |
| average | 2.8-3.5 | 2.8-3.2 | 2.8-3.2 | 2.8-3.0 | 2.8-3.0 |

At N = 256 (average of seeds 1-3): 275 fields, 411 messages, 102 texts reading two or more
fields, 58 conditional sections, 20 cross-field disabled states, 22 two-field validations,
28 combined buttons, 21 keyed lists, 6 time-driven ints; nesting up to 3 levels inside the
component's section.

### The first units

So the work actions find the same targets at every size, the first nine units each carry one
capability, never inside a conditional section:

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

**`--lists none`** is a variant of the same form with no keyed list anywhere: unit 2 is then a
text input, unit 5 an int, and the random draw skips lists (every other draw is the same, so a
unit without a list is the same unit in both variants). It exists for an approach that has no
keyed lists yet, measured against the others on the same variant; the work actions and the bench
leave out the list actions and `notify`.

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

The script stays short as N grows: 65-100 steps at N = 16, 100-155 at N = 32 to 256. About
98% of the sampled units' messages are exercised (96-100% per spec; the rest sit behind
conditions that stay closed, disabled states that stay on, or lists left empty). Every step is only generated when its
control is rendered and enabled in the reference at that moment.

## Scenario-specific expectations

On top of the global contract, the same as unique-components':
- **Keyed lists:** items keep their DOM node across pushes, removes, toggles and the snapshot
  reorder.
- **Focus and caret:** every text and number input keeps focus and caret while typed into, even
  when the component re-renders around it (an error appearing, a derived text changing). No input is inside a conditional section whose condition reads the input's field.
- **Conditional content:** `when` sections and validation errors appear and disappear without
  replacing their siblings.
- **Precise updates:** nodes whose content did not change are not replaced, however big the
  component. (Work per event is measured by `./rr work`; prototypes are held to locality.)
- **Number inputs:** the message is sent only while the input holds an integer within
  `[min, max]`; otherwise no message, the state keeps its last valid value and the input keeps
  what the user typed. Number-input fields have `min <= 0` and `max >= 20`.
- **Disabled buttons** follow their expression; the script never clicks a disabled one.

## A worked example

`--size 4 --seed 1`: the first four units, one after another directly under the heading. One
line per field, message and top-level view node:

```json
{ "id": "w1", "kind": "form", "token": "04zc", "label": "Warehouse preferences 04zc",
  "fields": [
    { "name": "officeHours", "type": "int", "min": 0, "max": 35, "initial": 6 },
    { "name": "studioNickname", "type": "text", "initial": "" },
    { "name": "securityChores", "type": "list", "checkable": true, "initial": [
      { "id": 1, "text": "Call the venue", "done": false }, { "id": 2, "text": "Order the tickets", "done": true },
      { "id": 3, "text": "Review the car", "done": false }, { "id": 4, "text": "Sort the slides", "done": true }] },
    { "name": "securityJot", "type": "text", "initial": "" },
    { "name": "accountSilent", "type": "bool", "initial": false } ],
  "messages": [
    { "name": "boostOfficeHours", "kind": "click", "ops": [["add", "officeHours", 3]] },
    { "name": "setOfficeHoursTo8", "kind": "click", "ops": [["set", "officeHours", 8]] },
    { "name": "zeroOfficeHours", "kind": "click", "ops": [["reset", "officeHours"]] },
    { "name": "writeStudioNickname", "kind": "input", "field": "studioNickname" },
    { "name": "markInSecurityChores", "kind": "item", "field": "securityChores", "op": "toggle" },
    { "name": "removeFromSecurityChores", "kind": "item", "field": "securityChores", "op": "remove" },
    { "name": "typeSecurityJot", "kind": "input", "field": "securityJot" },
    { "name": "appendToSecurityChores", "kind": "click", "ops": [["push", "securityChores", "securityJot"]] },
    { "name": "switchAccountSilent", "kind": "click", "ops": [["toggle", "accountSilent"]] } ],
  "view": [
    { "el": "button", "msg": "boostOfficeHours", "text": ["3 more"] },
    { "el": "button", "msg": "setOfficeHoursTo8", "text": ["Set to 8"] },
    { "el": "text", "tag": "output", "parts": [["f", "officeHours"]] },
    { "el": "button", "msg": "zeroOfficeHours", "text": ["Undo all"] },
    { "el": "text", "tag": "small", "parts": [["if", [">", ["f", "officeHours"], ["k", 3]], ["k", "Many"], ["k", "Some"]]] },
    { "el": "input", "msg": "writeStudioNickname", "label": "Nickname" },
    { "el": "text", "tag": "p", "parts": ["Together: ", ["+", ["len", ["f", "studioNickname"]], ["f", "officeHours"]]] },
    { "el": "input", "msg": "typeSecurityJot", "placeholder": "Next step" },
    { "el": "button", "msg": "appendToSecurityChores", "text": ["Save"] },
    { "el": "list", "field": "securityChores", "tag": "ul", "check": "markInSecurityChores", "remove": "removeFromSecurityChores", "removeText": "×" },
    { "el": "text", "tag": "p", "parts": [["left", ["f", "securityChores"]], " left"] },
    { "el": "when", "tag": "div", "cond": ["==", ["count", ["f", "securityChores"]], ["k", 0]], "children": [{ "el": "text", "tag": "p", "parts": ["No news"] }] },
    { "el": "button", "msg": "switchAccountSilent", "text": ["Flip silent"] },
    { "el": "text", "tag": "span", "parts": ["Silent: ", ["if", ["f", "accountSilent"], ["k", "done"], ["k", "pending"]]] },
    { "el": "text", "tag": "p", "parts": [["if", ["and", ["f", "accountSilent"], [">", ["len", ["f", "studioNickname"]], ["k", 0]]], ["k", "Go"], ["k", "Wait"]]] } ] }
```

The companion at this size reads units 0 and 3 (unit 6 does not exist yet):

```json
{ "id": "w2", "kind": "companion", "token": "1dbt", "label": "Summary 1dbt",
  "fields": [{ "name": "pinned", "type": "bool", "initial": false }, { "name": "reviewer", "type": "text", "initial": "" }],
  "messages": [{ "name": "checkPinned", "kind": "check", "field": "pinned" }, { "name": "editReviewer", "kind": "input", "field": "reviewer" }],
  "view": [
    { "el": "check", "msg": "checkPinned", "label": "Pinned" },
    { "el": "input", "msg": "editReviewer", "label": "Reviewer", "invalid": { "when": ["==", ["len", ["f", "reviewer"]], ["k", 0]], "message": "Name a reviewer" } },
    { "el": "text", "tag": "p", "parts": ["Hours: ", ["w", "w1", "officeHours"]] },
    { "el": "text", "tag": "p", "parts": ["Silent: ", ["if", ["w", "w1", "accountSilent"], ["k", "yes"], ["k", "no"]]] },
    { "el": "when", "tag": "aside", "cond": ["f", "pinned"], "children": [{ "el": "text", "tag": "small", "parts": ["Pinned for review 1dbt"] }] } ] }
```

The reference HTML of the initial state (indented for reading; whitespace is ignored):

```html
<div data-role="page">
  <section data-key="w1" data-role="widget">
    <h2>Warehouse preferences 04zc</h2>
    <button data-role="boostOfficeHours">3 more</button>
    <button data-role="setOfficeHoursTo8">Set to 8</button>
    <output>6</output>
    <button data-role="zeroOfficeHours">Undo all</button>
    <small>Many</small>
    <label>Nickname<input type="text" data-role="writeStudioNickname" value></label>
    <p>Together: 6</p>
    <input type="text" data-role="typeSecurityJot" placeholder="Next step" value>
    <button data-role="appendToSecurityChores">Save</button>
    <ul>
      <li data-key="1" data-role="securityChoresItem"><input type="checkbox" data-role="markInSecurityChores"><span>Call the venue</span><button data-role="removeFromSecurityChores">×</button></li>
      <li data-key="2" data-role="securityChoresItem"><input type="checkbox" data-role="markInSecurityChores" checked><span>Order the tickets</span><button data-role="removeFromSecurityChores">×</button></li>
      <li data-key="3" data-role="securityChoresItem"><input type="checkbox" data-role="markInSecurityChores"><span>Review the car</span><button data-role="removeFromSecurityChores">×</button></li>
      <li data-key="4" data-role="securityChoresItem"><input type="checkbox" data-role="markInSecurityChores" checked><span>Sort the slides</span><button data-role="removeFromSecurityChores">×</button></li>
    </ul>
    <p>2 left</p>
    <button data-role="switchAccountSilent">Flip silent</button>
    <span>Silent: pending</span>
    <p>Wait</p>
  </section>
  <section data-key="w2" data-role="widget">
    <h2>Summary 1dbt</h2>
    <label><input type="checkbox" data-role="checkPinned">Pinned</label>
    <label>Reviewer<input type="text" data-role="editReviewer" value></label>
    <p data-role="editReviewerError">Name a reviewer</p>
    <p>Hours: 6</p>
    <p>Silent: no</p>
  </section>
</div>
```

Typing "Ada" into Nickname shows "Together: 9" (`len("Ada") + 6`); clicking **3 more** then shows
"9" in the output, "Hours: 9" in the companion and "Together: 12". Turning silent on with
**Flip silent** shows "Silent: done" and "Go" (the nickname is no longer empty). At every bigger
size, everything above stays exactly as it is, and the next units follow `<p>Wait</p>`.

**Dependencies at a bigger size.** At `--size 32 --seed 1`, unit 8 (`lobbyCoins`, forced: a
derived text over unit 6's number input and a conditional section over unit 3's bool), then
two later units that read `lobbyCoins`: a validation in unit 13 and a text in unit 21:

```json
{ "el": "button", "msg": "setLobbyCoinsTo9", "text": ["Make it 9"] },
{ "el": "text", "tag": "strong", "parts": ["Coins = ", ["f", "lobbyCoins"]] },
{ "el": "button", "msg": "shrinkLobbyCoins", "text": ["Down 1"] },
{ "el": "button", "msg": "raiseLobbyCoins", "text": ["Add 1"], "disabled": [">=", ["f", "lobbyCoins"], ["k", 18]] },
{ "el": "text", "tag": "p", "parts": ["Together: ", ["+", ["f", "lobbyCoins"], ["f", "projectCalls"]]] },
{ "el": "when", "tag": "aside", "cond": ["not", ["f", "accountSilent"]], "children": [
  { "el": "text", "tag": "p", "parts": ["Printing is free for members."] },
  { "el": "text", "tag": "output", "parts": [["f", "lobbyCoins"]] } ] },
{ "el": "text", "tag": "strong", "parts": ["Overall: ", ["+", ["+", ["f", "lobbyCoins"], ["f", "officeHours"]], ["f", "privacyMinutes"]]] },

{ "el": "input", "msg": "typeDeliveryTitle", "placeholder": "Enter a title",
  "invalid": { "when": ["and", [">", ["f", "lobbyCoins"], ["k", 7]], ["==", ["len", ["f", "deliveryTitle"]], ["k", 0]]],
               "message": "Required when coins is above 7" } },

{ "el": "text", "tag": "p", "parts": [["if", ["and", ["f", "printerSigned"], [">", ["f", "lobbyCoins"], ["k", 0]]], ["k", "Go"], ["k", "Wait"]]] }
```

Clicking **Add 1** (unit 8) changes `lobbyCoins`. The bindings that read it are unit 8's
"Coins", its button's disabled state, its "Together", the output inside its aside and its
"Overall", unit 13's validation and unit 21's text; no other binding of the form needs to run.
At `--size 256`, unit 114 reads it too, 106 units further down:

```json
{ "el": "group", "tag": "footer", "children": [
  { "el": "when", "tag": "div", "cond": ["<", ["f", "lobbyCoins"], ["k", 7]], "children": [
    { "el": "check", "msg": "flagClinicOpen", "label": "Open" } ] },
  { "el": "text", "tag": "em", "parts": ["Open: ", ["if", ["f", "clinicOpen"], ["k", "done"], ["k", "pending"]]] } ] }
```

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
| `--lists` | `all` | `none`: no keyed list anywhere (see "The first units") |

`./rr check` builds N = 16 by default (`quickCheckSize`), which also starts the locality check
(16 to 256). The work actions (`harness/work/big-component.js`) need N ≥ 9. Each framework's
emitter may take its own style parameters; it records which it used, and runs in its documented
idiomatic style by default.

## Not in this scenario

No CSS, no network, no routing: one page, as in unique-components.

## What changed: a flat form (2026-10-16)

The first version built the form from bounded groups: sections of 2-4 fieldsets, each of 2-5
units, with gated fieldsets, an "n of m set" summary per fieldset and section totals, and every
cross-field binding looked back at most 6 units. Two prototypes (digest and tea-local) passed
locality by making a fieldset their unit of re-run: an event re-ran its fieldset and the few
fieldsets reading it, a cost bounded by the group size rather than by what changed. The groups
handed them the boundaries the scenario exists to take away.

By the owner's decision the form is now one flat list of units: no sections, fieldsets, gated
groups, summaries or totals, and no distance limit on dependencies (only a cap on how many
bindings read one field). Everything per unit is unchanged: fields and controls, derived texts,
conditional sections, validations, disabled states, combined buttons, lists, time-driven ints,
the forced first nine units, the companion, the external events and the script. Derived texts
are a little more frequent (50% of units, from 35%) so that the form keeps about as many texts
reading two or more fields as the group summaries gave it.
