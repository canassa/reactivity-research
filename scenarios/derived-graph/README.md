# Scenario: derived-graph

The contract of the `derived-graph` scenario. It adds to the global contract in `CLAUDE.md` and
never relaxes it. The generator and the reference are `spec.js`; no emitter exists yet.

## What it models

**A spreadsheet or financial dashboard.** A planning sheet: input cells (numbers, toggles, selects),
**formulas** over the inputs and over earlier formulas, chained several levels deep, displays all
over the sheet that show those values, and a table of **line items** that totals, filtered counts,
top-5 lists and per-category sums are computed over. The app grows by adding formulas, each with
its displays (and, half the time, a new input it reads).

| | `big-component` | `big-table` | `derived-graph` |
|---|---|---|---|
| the page is | 1 form of N fields | N tables, each its own component | **1 sheet of N formulas over inputs and a table of items** |
| one more unit of size is | one more field | one more table | **one more formula, its displays and maybe an input** |
| data | a handful of items | 1,000-11,000 rows per table | **one table of items (2,000 by default)** |
| reads per value | average 3, max 7-8 | 1 per cell | **average 5.2, max 48 (default); 3.2 / 32 and 9.2 / 88 as variants** |
| what it adds | precision inside a component | keyed lists at scale | **derived values: chains, fan-out and fan-in, memoization, aggregates over a collection** |

Our other generators cap readers per field at about 6-8, and most bindings read one field. This
scenario exists to expose what they hide (`notes/2026-10-16-tea-inline-critique.md`, weakness 4,
§2.2 and proposed scenario 2):

- **Fan-out and fan-in.** Values read by many formulas and displays (hubs read by up to 48 sites at
  the default), and formulas reading many values (up to 12). Bytes per read edge differ between
  approaches: a compiler that registers every read spends bytes per edge; one that inlines a
  derived value into each reader spends bytes per reader times the size of the chain.
- **Memoization.** A derived value read by many bindings should be computed once per change. The
  contract fixes what is **shown**, not how it is computed (see *Memoization*), and the work
  actions show the difference.
- **Derived data over a collection that changes one item at a time.** Totals, filtered counts,
  averages, extremes, top-k lists and group sums over 2,000 items, chained (filter → top, filter →
  sum), read by many displays.

## What "size" means

**Size is N, the number of formulas (derived cells).** Which sizes and seeds are measured is set
per framework in `runs.json`, not here.

- A **unit** is one formula with everything that belongs to it: its displays, and in about half the
  units a new input that the formula reads (about 0.5 N inputs in all: 123-132 at N = 256).
- **Items are data, never size.** The number of items changes no code: the **Load** button makes
  `--rows` items (default 2,000) with the app's own generator, and `--rows` appears in the code only
  in that button's count and text. It matters for CPU (`./rr bench`) and work (`./rr work`). Size
  measurements use the default.
- **Prefix stability:** for one seed and one `--fanout`, unit i (its input, formula, messages and
  displays) is identical at every N; growing N only appends units. **Formulas and inputs are also
  identical across `--fanout`**: only the displays differ (checked by the generator's tests below).
- **Variety and tokens.** Every formula draws its own shape, operators, constants, names, words and
  formats, and carries a **token**, 4 seeded base-36 characters, in its primary display ("Duty owed
  pf0r: €2,374.26"), so near-twin formulas cannot compress away. The sheet has its own token in its
  heading.
- The first 11 units are forced (see *The first units*), so `steadyFrom = 16`: baseline and slope
  are fitted over N ≥ 16.

## Formulas are code (scenario rule)

The rule of `unique-components` ("Each widget is its own code") applies to every formula, input and
display:

- **Its own code.** Each formula's expression, each input's messages and update logic, and each
  display's binding are emitted as **the app's own code**, the way a developer writing the sheet by
  hand, or a compiler, would: `const dutyOwed = createMemo(() => Math.floor(grossSales() * taxRate() / 100))`,
  `dutyOwed model = (grossSales model * model.taxRate) // 100` (with the floor division of *Numbers*),
  or the same expression inlined in a binding.
- **Allowed:** generic helpers independent of any formula: create an element, set a text, a keyed-list
  reconciler, event delegation, the PRNG step, the number formatters, and generic collection helpers
  that take the formula's own code as a function (`sumBy(list, (it) => it.qty * it.price)`,
  `topBy(list, key, desc, 5)`, a group-by over the categories); static markup templates; plain data
  (word pools, categories, labels).
- **Not allowed:** formula trees, operator tables, display descriptions or the spec's unit
  descriptions shipped as data and evaluated by a generic routine.
- **Rule of thumb:** if deleting one formula's code from the bundle would leave it still described
  somewhere as data that a generic routine executes, it is an interpreter.

The reference `update`, `evaluate` and `render` in `spec.js` *are* such interpreters: they are the
specification, not a model to copy.

## The vocabulary

The spec is plain data: `spec.units` (each `{ index, inputs, cell, messages, view }`), the sheet's
`title`, the items section's constants (`categories`, `itemWords`, `currency`, `markup`,
`loadText`, `itemsTitle`, the app PRNG seed `rng`, `initialItems`), `forced` (the names of the forced
units' cells, used by the work and bench actions) and `initialState`.

### Inputs

| `type` | Value | Description keys | Controls (messages) |
|---|---|---|---|
| `num` | integer in `[min, max]` | `min <= 0`, `max >= 20`, `initial`, `format` (`plain` or `pct`, a whole percent) | a number input (`set{Name}`, kind `input`) and/or 1-2 step buttons (`raise{Name}` / `lower{Name}`, kind `add`, `k`); without a number input a text shows its value |
| `bool` | boolean | `initial`, `words` (a display pair such as `["On track", "Behind"]`) | a checkbox (`toggle{Name}`, kind `check`) |
| `enum` | one of `options` | `options` (strings), `categories` (true when the options are the item categories), `initial` | a select (`pick{Name}`, kind `select`) |

Every input cell also carries `name`, `label`, `level: 0`, and the descriptive flags `hub` and
`closed` (below). Names are camelCase, valid identifiers everywhere, and unique in the app.

### Formulas

A formula cell is `{ name, label, token, type, expr, level, hub, closed }` plus, by type:

| `type` | Value | Extra keys | Shown by its primary display as |
|---|---|---|---|
| `num` | integer | `format`: `plain`, `grouped`, `currency` (cents) or `pct` | `{label} {token}: {formatted}` |
| `bool` | boolean | `words` | `{label} {token}: {words[0] or words[1]}` |
| `text` | one of `values` | `values` (2-3 words) | `{label} {token}: {word}` |
| `list` | a list of items (a filter, in item order) | | `{label} {token}: {count} items` (or lines, matches) |
| `top` | a list of at most k items, sorted | `format` (of its key) | a heading `{label} {token}`, then an `<ol>`/`<ul>` of `{name}: {formatted key}` |
| `group` | a sum per category | `format` | a heading, then a `<ul>` with one `{category}: {formatted}` per category |

`level` is 1 + the largest level among the cells it reads (inputs and the items are level 0).

### The formula vocabulary

Expressions are arrays. Every implementation compiles them into code.

| Expression | Type | Meaning |
|---|---|---|
| `["v", name]` | the cell's | another cell (an input or an earlier formula) |
| `["k", c]` | c's | a constant (an integer or a string) |
| `["i", field]` | field's | a field of the item in scope (inside `sum`, `filter`, `top`, …): `qty`, `price`, `active`, `category` |
| `["items"]` | list | the items, in table order |
| `["+", a, b, …]`, `["-", a, b]` | int | arithmetic (`+` takes 2 to 12 operands) |
| `["*", a, b]` | int | product: a value times a constant, or `qty × price` inside an item expression |
| `["div", a, ["k", c]]` | int | **floor** division by a positive constant |
| `["pct", a, b]` | int | `floor(a × b / 100)`, b a constant, a percent input or (in item expressions) a scalar percent cell |
| `["min", a, b, …]`, `["max", …]`, `["abs", a]` | int | |
| `["if", c, a, b]` | a's | |
| `["<" "<=" ">" ">=" "==" "!=", a, b]` | bool | comparisons (strict equality) |
| `["and", …]`, `["or", …]`, `["not", a]` | bool | |
| `["count", L]` | int | the length of a list |
| `["sum", L, e]`, `["avg", L, e]`, `["maxOf", L, e]`, `["minOf", L, e]` | int | over the items of L, with `e` an item expression; `avg` floors; `avg`, `maxOf` and `minOf` of an empty list are 0 |
| `["filter", L, p]` | list | the items of L for which the item predicate `p` holds, in order |
| `["top", L, e, "asc" or "desc", k]` | list | the first k items of L ordered by `e` (ties by id ascending, whatever the direction) |
| `["groupSum", L, e]` | group | for every category (in `spec.categories` order), the sum of `e` over its items of L |
| `["at", G, category]` | int | one category of a group |

Item expressions and predicates may read scalar cells (`[">=", ["i", "qty"], ["v", "minQty"]]`,
`["==", ["i", "category"], ["v", "focusCategory"]]`, `["pct", ["i", "price"], ["v", "royalty"]]`):
then a formula over the items depends on the collection **and** on scalars, which is common in
real sheets (a threshold, a focus category, a rate).

### Numbers

Every value is an integer exact in a double: the generator bounds every expression statically and
keeps it below 2^50, assuming at most 2 × 100,000 items, a quantity up to 999 and a price up to
99.99. Values above 2^31 are common at the default rows (totals in cents), so **integer division is
`Math.floor(a / b)` on doubles**: an Elm emitter must not use `//` or `modBy` (32-bit), but
`floor (toFloat a / toFloat b)` or equivalent. Negative values are possible.

**Formats** (no locale APIs, so every language formats alike; `formatNumber` in `spec.js` is the
reference): `plain` `-1234`; `grouped` `-1,234`; `currency` (cents) `-€12.34` (the symbol is per
app); `pct` `18%`. Grouping is a comma every three digits.

### Displays and view nodes

The sheet is `<section data-key="sheet" data-role="sheet"><h2>{title}</h2>` and then one `<div>`
per unit, in order, holding that unit's view nodes:

| Node | Renders |
|---|---|
| `{ el: "text", tag, parts }` | `<{tag}>{text}</{tag}>`, tag `p`, `span`, `small`, `strong`, `em`, `output` or `div`; parts are strings and reads: `["v", name]` (formatted by the cell's type and format, a bool by its words), `["count", name]` (a list's length, plain), `["at", name, category]` (one category of a group, formatted) |
| `{ el: "input", msg, label }` | `<label>{label}<input type="number" data-role="{msg}"></label>`, value = the input |
| `{ el: "button", msg, text }` | `<button data-role="{msg}">{text}</button>` |
| `{ el: "check", msg, label }` | `<label><input type="checkbox" data-role="{msg}">{label}</label>`, checked = the bool |
| `{ el: "select", msg, label }` | `<label>{label}<select data-role="{msg}">` with one `<option value="o">o</option>` per option`</select></label>`, value = the enum |
| `{ el: "top", cell, tag }` | `<{tag} data-role="{cell}">` with one `<li data-key="{item id}" data-role="{cell}Item">{name}: {formatted key}</li>` per item, in order |
| `{ el: "groups", cell }` | `<ul data-role="{cell}">` with one `<li data-key="{category}" data-role="{cell}Row">{category}: {formatted}</li>` per category |

A display node never computes: it reads values and formats them. All computation lives in formulas,
so the dependency graph is explicit in the spec. Input values, checkbox `checked` and select values
are live DOM properties.

### The items section

Fixed, the same at every N (part of the baseline):

```html
<section data-key="items" data-role="items">
  <h2>{itemsTitle}</h2>
  <div>
    <button data-role="load">Load 2,000 items</button>
    <button data-role="addItem">Add item</button>
    <label>Markup %<input type="number" data-role="markup"></label>
  </div>
  <table>
    <thead><tr><th>Item</th><th>Category</th><th>Qty</th><th>Price</th><th>Line</th><th>With markup</th><th>Active</th><th>Note</th><th></th></tr></thead>
    <tbody>
      <tr data-key="{id}" data-role="item">
        <td>{name}</td><td>{category}</td>
        <td><input type="number" data-role="qty"></td>
        <td>{price, currency}</td>
        <td>{qty × price, currency}</td>
        <td>{floor(qty × price × (100 + markup) / 100), currency}</td>
        <td><input type="checkbox" data-role="active"></td>
        <td><input type="text" data-role="note" placeholder="Note"></td>
        <td><button data-role="remove">×</button></td>
      </tr>
    </tbody>
  </table>
</section>
```

- An item is `{ id, name, category, qty, price, active, note }`. **The markup is a value read by
  every row** (the critique's "one value read by thousands of bindings", §2.3), and by nothing else.
- **The app's own generator** (big-table's Park-Miller PRNG, `next`, `pick`, `between` in
  `spec.js`): the state carries `rng` and `nextId`; one item draws, in order, an adjective and a
  noun from `itemWords` (its name, joined by a space), a category, `qty = between(1, 99)`,
  `price = between(100, 9999)` (cents) and `active = s % 4 !== 0`; `note` is `""`; `id = nextId++`.
  **Load** replaces the items with `--rows` new items; **Add item** appends one. The 6 initial
  items come from the seed's `rng` the same way (an implementation may embed them or build them at
  start-up).
- The quantity input accepts integers in `[0, 999]`; the markup input `[0, 100]`.

### How units vary

Every generated unit (from unit 11) draws, from its own stream:

- **a new input** with probability 0.5 (num 60%, of which 30% percents; bool 20%; enum 20%, of which
  40% over the categories), which its formula reads;
- **its formula's kind:** a number over other cells 42%, a bool 12%, a text 8%, an aggregate over
  the items or an earlier list 20% (`sum` 35%, `count` 20%, `avg`, `maxOf`, `minOf` 15% each), a
  filtered list 8%, a top-k 5% (k 3-6, descending 70%), a group sum 5%;
- **for a scalar formula, how many cells it reads** (before the caps trim it): 1 10%, 2 25%, 3 25%,
  4 15%, 5 8%, 6 6%, 8 5%, 10 3%, 12 3%; each read becomes a term (the value, ×k, div k, a percent
  of it, a constant minus it; a bool or enum through `if`; a list through `count` or `sum`; a group
  through `at`), and the terms are combined by `+` (n-ary for 5 or more), `-`, `min`, `max` or a
  positive part `if a > b then a - b else 0`; bools compare terms with constants and combine them
  with `and`/`or`; texts pick 2-3 words through nested `if`s;
- **for a formula over the items,** its source (the items, or an earlier list 30%), its predicate
  (item-only clauses: active, a category, a quantity or price threshold; and clauses reading 0-2
  scalar cells), its item value (`qty`, `price`, `qty × price`, `qty` if active, or a percent of a
  price);
- **whether it is a hub** (10%, below), its name (a qualifier and a metric, such as `dutyOwed`,
  `netMargin`), its token, its display tags, labels and separators.

Constants (thresholds, caps) are chosen from the formula's value on a **nominal state** (the initial
inputs and 1,000 items from a fixed stream, independent of `--rows`), rounded to two significant
digits, so comparisons are neither always true nor always false.

## The graph

- **A DAG.** A formula reads only cells that already exist (inputs and earlier formulas), so there
  are no cycles.
- **No locality window.** Any earlier cell may be read: candidates are every earlier cell that is
  not closed, has level < 6 and has formula readers left, weighted by `(hub ? 6 : 1) × (1 + level)`
  (deeper and hub values are preferred, so chains form).
- **Bounded fan-out.** A value accepts at most 5 formula readers (24 for a hub) and, by `--fanout`,
  a number of display readers (below). Readers per value are therefore bounded whatever N, while
  the hubs' readers grow until they reach their caps.
- **Bounded fan-in:** at most 12 cells per formula.
- **Depth:** at most 6 levels (a level-6 formula is shown, never read by another formula).
- **Hubs:** the forced total, tax input, tax and group sums and active count, plus 10% of generated
  formulas and 8% of generated inputs. Displays pick hubs 8× more often.
- **Closed** values (the forced local targets, below) are read by nothing outside their forced
  units.

`hub`, `closed` and `level` are descriptive (the harness and this README use them); an
implementation must not need them, since a compiler sees the same graph in the expressions.

### Readers per value (`--fanout`)

A value's **readers** are its binding sites: the formulas that read it plus the display nodes that
read it (a node reading it twice counts once; an input's own control does not count, a text showing
a button-only input's value does). Each unit makes its primary display plus `extra` display reads of
earlier values (or its own), packed 1-3 to a display node, and each value accepts at most `cap`
display readers (`hubCap` for a hub). Formula reads are the same at every level.

| `--fanout` | extra display reads per unit | display cap (hub) | readers per value at N = 256, mean | max | per hub, mean |
|---|---|---|---|---|---|
| `low` | 1 | 2 (8) | 3.2 | 32 | 10.7-12.3 |
| **`mid` (default)** | 4 | 5 (24) | 5.2-5.3 | 48 | 19.6-21.9 |
| `high` | 10 | 10 (64) | 9.1-9.3 | 88 | 40.6-44.6 |

`low` is about what our other scenarios have (big-component: average 3, max 7-8, but there no
value has 32 readers); the default is realistic for a dashboard (a total, a rate or a currency shown
in many places) and higher than any other scenario; `high` stresses it. Measured with `graphStats`
in `spec.js`, seeds 1-3:

| `mid` | N = 16 | 32 | 64 | 128 | 256 | 512 |
|---|---|---|---|---|---|---|
| inputs | 8-10 | 17-18 | 32-35 | 66-71 | 123-132 | 251-254 |
| display nodes (incl. primaries) | 69-72 | 125-137 | 250-260 | 500-514 | 982-1005 | 1970-1984 |
| readers per value, mean | 4.4-4.9 | 4.6-5.1 | 4.8-5.4 | 4.9-5.1 | 5.2-5.3 | 5.2-5.3 |
| readers per value, max | 23-25 | 30-34 | 39-41 | 43-47 | 48 | 48 |
| readers per hub, mean | 10.7-13 | 12.8-19.6 | 18.5-21.7 | 17.4-21.3 | 19.6-21.9 | 21-22.4 |

| `low` / `high` | N = 16 | 32 | 64 | 128 | 256 | 512 |
|---|---|---|---|---|---|---|
| readers per value, mean | 2.6-2.9 / 8.0-8.8 | 2.7-3.2 / 8.4-8.9 | 2.9-3.4 / 8.6-9.3 | 3.0-3.1 / 8.8-9.1 | 3.2 / 9.1-9.3 | 3.2-3.3 / 9.2-9.4 |
| readers per value, max | 11-12 / 47-57 | 14-16 / 62-74 | 21-24 / 79-81 | 27-31 / 83-87 | 32 / 88 | 32 / 88 |
| display nodes | 44-46 / 125-142 | 78-80 / 244-258 | 146-154 / 469-496 | 284-294 / 927-983 | 559-572 / 1869-1931 | 1113-1144 / 3724-3823 |

The same at every `--fanout`:

| | N = 16 | 32 | 64 | 128 | 256 | 512 |
|---|---|---|---|---|---|---|
| formula readers per value, mean | 0.9-1.1 | 1.2-1.6 | 1.3-1.8 | 1.6-1.7 | 1.7-1.8 | 1.8-1.9 |
| formula readers, max | 3-5 | 8-10 | 15-17 | 19-23 | 24 | 24 |
| fan-in (cells read, the items counted as one), mean | 1.9-2.0 | 2.2-2.8 | 2.4-3.0 | 2.7-2.8 | 2.9-3.0 | 2.9-3.1 |
| fan-in, max | 3-5 | 5-12 | 10-12 | 10-12 | 12 | 12 |
| formulas reading 6 or more values | 0 | 0-2 | 3-7 | 7-12 | 24-27 | 55 |
| deepest level | 5 | 5-6 | 6 | 6 | 6 | 6 |
| formulas at levels 4-6 | 2 | 6-12 | 21-29 | 56-60 | 126-132 | 243-296 |
| hubs | 6-7 | 7-12 | 10-15 | 18-28 | 34-41 | 59-76 |
| formulas over the items | 5-8 | 9-12 | 18-20 | 37-39 | 65-74 | 124-149 |

At N = 256 (seeds 1-3) the formulas are about 123 numbers over cells, 39 aggregates, 29 bools,
22 texts, 20 lists, 11 top-k lists and 10 group sums. Formula readers average below 2 because many
values cannot be read by formulas (level 6, closed, or the newest).

## The first units

So the work and bench actions find the same targets **with the same downstream closures** at every
size from 11 up, the first 11 units are fixed in shape (names, constants and display words still
vary by seed; `spec.forced` names their cells):

| Unit | Input | Formula | Read by |
|---|---|---|---|
| 0 | | `total` = `sum(items, qty × price)`, currency | **hub** (open) |
| 1 | hub input, a percent 0-40 with a number input, +1 and −1 | `tax` = `pct(total, hub input)` | **hubs** (open) |
| 2 | chain input 0-500, number input (**closed**) | `chain1` = `chain input × k + tax div k` | closed: 2 forced displays and the chain |
| 3 | | `chain2` = `max(chain1 − k, total div k)` | closed |
| 4 | | `chain3` = `chain2 + chain1 × k` | closed |
| 5 | cut-off input 0-100, number input (**closed**), starting above its constant | `cutoff` = `cut-off input >= k` (bool) | closed: 3 forced displays and `toggleCell` |
| 6 | filter select over the categories (**closed**) | `filtered` = `filter(items, category == filter select)` | closed: a forced display and `toggleCell` |
| 7 | toggle, a checkbox, starting on (**closed**) | `toggleCell` = `if cutoff then (if toggle then sum(filtered, qty) else count(filtered)) else 0` | closed |
| 8 | threshold 0-99, number input (**closed**) | `top` = `top(filter(items, qty >= threshold), price, desc, 5)` | closed |
| 9 | | `groups` = `groupSum(items, qty × price)` | **hub** (open) |
| 10 | | `active` = `count(filter(items, active))` | **hub** (open) |

The chain input's closure is three formulas deep (levels 3-5), whatever N. The cut-off input changes
a bool that four bindings and one formula read; most edits leave it unchanged.

## State and messages

- **State:** `{ inputs: { [input name]: value }, markup, items: [{ id, name, category, qty, price, active, note }], nextId, rng }`,
  plain data. Formulas are not state: they are functions of it. Updates are immutable with
  structural sharing (an edited item is a new object in a new array; other items keep theirs).
- **User messages** come from DOM events:
  - sheet controls: `{ type: "set{Name}", value }` (an integer), `{ type: "raise{Name}" }` /
    `{ type: "lower{Name}" }` (add `k`, clamped to `[min, max]`), `{ type: "toggle{Name}" }`,
    `{ type: "pick{Name}", value }`;
  - items: `{ type: "load" }`, `{ type: "addItem" }`, `{ type: "markup", value }`,
    `{ type: "qty", id, value }`, `{ type: "active", id }`, `{ type: "note", id, value }`,
    `{ type: "remove", id }`.
- **External events (through `dispatch(msg)`):**

| Message | Intent | Effect |
|---|---|---|
| `{ type: "serverInputs", values: { [name]: value } }` | "the server sent new input values" | each named input set (all valid) |
| `{ type: "serverItems", upsert: [item], remove: [id] }` | "the server changed some items" | items with a listed id replaced in place, new ids appended in order, listed ids removed (unknown ids ignored); `nextId = max(nextId, largest id + 1)` |
| `{ type: "snapshot", state }` | "here is the whole state" | the whole state replaced |

- **What the builders send** (`serverInputsMsg`, `serverItemsMsg`, `snapshot` in `spec.js`, used by
  the script, the work and bench actions and the serve panel): `serverInputs` changes 3 inputs (the
  hub input among them) unless given names; `serverItems` changes one field (price, qty, category or
  active) of 2 items (the first item among them), appends one new item (one id skipped), removes one
  and names an id that does not exist; a snapshot changes every input and the markup, reverses a
  slice of the items, removes one, edits every third, inserts a new one at a random place, and
  draws a new `rng` and `nextId`.
- **The reference `update`** applies exactly these rules; `render` produces exactly the HTML above.
  No timers.

## Selectors

- The sheet: `[data-key="sheet"]`, `data-role="sheet"`; a sheet control:
  `[data-key="sheet"] [data-role="{message name}"]`; a top-k list `[data-role="{cell}"]`, its items
  `li[data-key="{id}"][data-role="{cell}Item"]`; a group list's rows
  `li[data-key="{category}"][data-role="{cell}Row"]`.
- The items: `[data-key="items"]`, `data-role="items"`; a toolbar control:
  `[data-key="items"] [data-role="load"]` (`addItem`, `markup`); a row:
  `[data-key="items"] tr[data-key="{id}"]`, `data-role="item"`; a row control:
  `[data-key="items"] tr[data-key="{id}"] [data-role="qty"]` (`active`, `note`, `remove`).

Message names, cell names and the items' roles are distinct (the generator reserves `load`,
`addItem`, `markup`, `qty`, `active`, `note`, `remove` and the external events' names).

## The interaction script

Generated from the app, the same for every framework, about 60-95 steps:

1. mount; **Load** (`--rows` items);
2. every input of the exercised units (all units up to N = 32, else the 11 forced ones and 21
   others, seeded): a number input gets two invalid values (above its max, and `1.5`) that send no
   message and keep the typed text (`exemptValue`), then two valid integers; each step button once;
   a checkbox once; a select moves to a neighbouring option;
3. the items: a quantity typed (two invalid values first, then two valid) on one row and once on
   another, `active` toggled on two rows, a note typed character by character on the second row, a
   row removed, an item added and its quantity set, the markup typed (two invalid values, two valid);
4. `serverInputs`, `serverItems`;
5. a reorder through `snapshot`;
6. a final round: every forced input once more, a note typed on another row, a row removed;
7. dispose.

## Scenario-specific expectations

On top of the global contract:
- **Keyed items:** every row keeps its `<tr>` (and every node inside it whose content did not
  change) across edits, removes, adds, `serverItems` and the snapshot reorder. **Load** replaces the
  rows (new ids).
- **Keyed top-k lists:** an item that stays in a top-k list keeps its `<li>` when the list reorders
  or other items enter or leave; group rows keep theirs.
- **Focus and caret:** a quantity, note, markup or sheet number input keeps focus and caret while
  typed into, even when aggregates and top-k lists around it change.
- **Number inputs:** the message is sent only while the input holds an integer within `[min, max]`
  (`[0, 999]` for a quantity, `[0, 100]` for the markup); otherwise no message, the state keeps its
  last valid value and the input keeps what the user typed.
- **Precise updates:** nodes whose content did not change are not replaced. Work per event is
  measured by `./rr work`; prototypes are held to locality (below).

## Memoization (fairness)

The contract fixes what is **shown**, never how it is computed. An implementation may compute a
derived value however its approach naturally does: a memo or computed signal per formula
(`createMemo`, `computed`, `$derived`), recomputation inside each binding that shows it, a TEA
`view` that recomputes everything, a compile-time analysis that orders and caches formulas, an
incremental aggregate. What it may not do is precompute from the reference or skip a value that the
page shows. The work actions are built so the difference shows in the counts:

- **The hub input** (unit 1) feeds `tax`, a hub read by up to 24 formulas and 24 displays at the
  default. A memo computes `tax` once per change; inlining it computes it once per reader, and if
  `total` is inlined too, every reader re-sums 2,000 items.
- **One item edited** (a quantity, active, a server price) changes `total`, `groups`, `active` and
  every aggregate over the edited field, each read by many. A memo re-sums once per aggregate; an
  incremental one need not re-sum at all.
- **The cut-off input** changes a bool that most edits leave unchanged: with equality cut-off
  (Solid's memos, Vue's computeds) its four readers and `toggleCell` do not run; without it they do.
- **A note** is read by no formula: an approach whose collection memos depend on the whole items
  array (rather than on the fields they read) re-runs every aggregate on a keystroke in a note.
- **The markup** is read by every row and nothing else: O(rows) bindings, one each.

## Locality, work and CPU

### Locality (`./rr check`, prototype track, enforced)

As `CLAUDE.md` fixes it: the calls of one local action may grow at most 8× when **N** grows 16×
(N = 16 → 256 from `quickCheckSize`), **with `--rows` fixed** at the quick-check options' 30.
**Local means: the action's downstream closure (every formula and binding that depends on what it
changes) is the same at every N.** Editing an input must not cost work proportional to N beyond the
values that depend on it. The work actions (`harness/work/derived-graph.js`) run after an untimed
Load:

| Action | Scope | Closure |
|---|---|---|
| chain input: type a number | local | `chain1`-`chain3` (3 levels) and their 7 bindings |
| cut-off input: a value that leaves the bool unchanged; one that flips it; back | local | `cutoff` (and, when it flips, its 4 bindings, `toggleCell` and its 2) |
| filter select: another category | local | `filtered` (O(rows)) and `toggleCell` |
| toggle | local | `toggleCell` (a sum over the filtered items) |
| threshold: type a number | local | `top` (a filter and a sort, O(rows log rows)) |
| markup: type a number | local | every row's markup cell (O(rows)), nothing else |
| item: type a note character | local | the note's own input; no formula |
| `serverInputs` of the closed inputs | local | the union of the chain, cut-off and threshold closures |
| hub input: raise | **global** | `tax`, everything that reads the hub input, `tax` or `total`'s chains: grows with N until the hubs' caps fill (seed 1: 5, 25 and 55 formulas change at N = 16, 64, 256) |
| item: type a quantity; toggle active; add; remove; `serverItems` (one price) | **global** | every aggregate over the edited field and what reads it: aggregates are part of N (seed 1: 9, 30 and 84 formulas change for a quantity) |
| snapshot | **global** | everything |

The item edits are global **by nature**, not by convenience: the formulas over the items grow with
N (65-74 at N = 256), and even an ideal incremental engine must visit each aggregate that reads the
edited field. They are reported by `./rr work`, per N and per row count, but not held to the bound.

### Work against rows (`./rr work … --rows`, reported, not enforced)

The second axis: the same actions at a fixed N, `--rows 1000` against `--rows 10000`
(`./rr work derived-graph <fw> --sizes 64 --rows 10000`).

| Action | Expected growth with rows | Why |
|---|---|---|
| chain, cut-off, note, `serverInputs` of the closed inputs | flat | no formula over the items is in the closure |
| hub input | flat with memos; proportional when `total` is inlined into `tax`'s readers | `tax` reads `total`, which does not change |
| filter select, toggle, threshold, markup | proportional | a re-filter, a sum over the filtered items, a filter and a sort, one cell per row |
| an item edit, add, remove, `serverItems` | proportional for a recomputing implementation; flat per aggregate for an incremental one | each affected aggregate re-reads the items; neither is required |
| Load, snapshot | proportional | every row |

Not enforced, even on prototypes, as in big-table: a `findIndex` over the items is O(rows) calls in
any approach.

### CPU (`./rr bench`)

One app per framework at **N = 64**, seed 1, with the default 2,000 items (`"$bench"` in
`runs.json`), the work actions made repeatable as do/undo pairs (`harness/bench/derived-graph.js`):
a typed number and its old value back, the cut-off without and with a flip and back, the
neighbouring category and back, the toggle and the active flag flipped twice, the hub raised and
lowered, a note character typed and deleted, an item added and that item removed, `serverInputs` and
`serverItems` A and back, snapshots A and B. Each action's untimed setup loads the items when their
count is not `--rows`.

## Parameters

| Parameter | Default | Meaning |
|---|---|---|
| `--size` | 16 | N, the number of formulas (units) |
| `--seed` | 1 | the random seed |
| `--rows` | 2000 | the items the Load button makes (4 to 100,000); data, not size |
| `--fanout` | `mid` | readers per value: `low`, `mid` or `high` (only displays change; formulas are identical) |

`quickCheckSize = 16` (the locality check runs 16 → 256), `steadyFrom = 16`, and
`quickCheckOptions = { rows: 30 }`: `./rr check` builds with 30 items, so its comparisons stay fast;
the code is the same. `./rr serve` and the hub use the default 2,000 (`--rows 30` for a lighter
page). A `--fanout` variant is measured from `runs.json` by listing it in an entry's `options`
(`"options": { "fanout": ["low", "mid", "high"] }`), which names the variant `solid-fanout=high`; the
default keeps the plain name. Each framework's emitter may take its own style parameters; it records
which it used and runs in its documented idiomatic style by default.

## A worked example

`--size 3 --seed 1 --fanout low --rows 4`. The sheet (`title` "Margin review x4ak", currency `€`,
categories Outdoor, Books, Kitchen, Tools, Sports) has three units:

```json
{ "index": 0, "inputs": [], "messages": [],
  "cell": { "name": "grossSales", "label": "Gross sales", "token": "7mtn", "type": "num", "format": "currency",
            "expr": ["sum", ["items"], ["*", ["i", "qty"], ["i", "price"]]], "level": 1, "hub": true, "closed": false },
  "view": [ { "el": "text", "tag": "div", "parts": ["Gross sales 7mtn: ", ["v", "grossSales"]] },
            { "el": "text", "tag": "em", "parts": ["Gross sales = ", ["v", "grossSales"]] } ] }
{ "index": 1,
  "inputs": [ { "name": "taxRate", "label": "Tax rate", "type": "num", "format": "pct", "min": 0, "max": 40, "initial": 18, "hub": true } ],
  "messages": [ { "name": "setTaxRate", "kind": "input", "cell": "taxRate" },
                { "name": "raiseTaxRate", "kind": "add", "cell": "taxRate", "k": 1 },
                { "name": "lowerTaxRate", "kind": "add", "cell": "taxRate", "k": -1 } ],
  "cell": { "name": "dutyOwed", "label": "Duty owed", "token": "pf0r", "type": "num", "format": "currency",
            "expr": ["pct", ["v", "grossSales"], ["v", "taxRate"]], "level": 2, "hub": true },
  "view": [ { "el": "input", "msg": "setTaxRate", "label": "Tax rate" },
            { "el": "button", "msg": "raiseTaxRate", "text": "+1" }, { "el": "button", "msg": "lowerTaxRate", "text": "−1" },
            { "el": "text", "tag": "output", "parts": ["Duty owed pf0r: ", ["v", "dutyOwed"]] },
            { "el": "text", "tag": "span", "parts": ["Duty owed = ", ["v", "dutyOwed"]] } ] }
{ "index": 2,
  "inputs": [ { "name": "baseOrders", "label": "Base orders", "type": "num", "format": "plain", "min": 0, "max": 500, "initial": 71, "closed": true } ],
  "messages": [ { "name": "setBaseOrders", "kind": "input", "cell": "baseOrders" } ],
  "cell": { "name": "partnerStock", "label": "Partner stock", "token": "gmai", "type": "num", "format": "currency",
            "expr": ["+", ["*", ["v", "baseOrders"], ["k", 310]], ["div", ["v", "dutyOwed"], ["k", 2]]], "level": 3, "closed": true },
  "view": [ { "el": "input", "msg": "setBaseOrders", "label": "Base orders" },
            { "el": "text", "tag": "span", "parts": ["Partner stock gmai: ", ["v", "partnerStock"]] },
            { "el": "text", "tag": "span", "parts": ["Partner stock = ", ["v", "partnerStock"]] },
            { "el": "text", "tag": "em", "parts": ["Partner stock: ", ["v", "partnerStock"]] },
            { "el": "text", "tag": "small", "parts": ["Gross sales: ", ["v", "grossSales"]] } ] }
```

After **Load 4 items** (ids 7-10, drawn by the app's PRNG after the 6 initial items):

```html
<div data-role="page">
  <section data-key="sheet" data-role="sheet">
    <h2>Margin review x4ak</h2>
    <div><div>Gross sales 7mtn: €13,190.34</div><em>Gross sales = €13,190.34</em></div>
    <div>
      <label>Tax rate<input type="number" data-role="setTaxRate" value="18"></label>
      <button data-role="raiseTaxRate">+1</button><button data-role="lowerTaxRate">−1</button>
      <output>Duty owed pf0r: €2,374.26</output><span>Duty owed = €2,374.26</span>
    </div>
    <div>
      <label>Base orders<input type="number" data-role="setBaseOrders" value="71"></label>
      <span>Partner stock gmai: €1,407.23</span><span>Partner stock = €1,407.23</span>
      <em>Partner stock: €1,407.23</em><small>Gross sales: €13,190.34</small>
    </div>
  </section>
  <section data-key="items" data-role="items">
    <h2>Products</h2>
    <div><button data-role="load">Load 4 items</button><button data-role="addItem">Add item</button>
      <label>Markup %<input type="number" data-role="markup" value="25"></label></div>
    <table>
      <thead><tr><th>Item</th><th>Category</th><th>Qty</th><th>Price</th><th>Line</th><th>With markup</th><th>Active</th><th>Note</th><th></th></tr></thead>
      <tbody>
        <tr data-key="7" data-role="item"><td>lucky saddle</td><td>Sports</td><td><input type="number" data-role="qty" value="88"></td><td>€56.88</td><td>€5,005.44</td><td>€6,256.80</td><td><input type="checkbox" data-role="active" checked></td><td><input type="text" data-role="note" placeholder="Note" value=""></td><td><button data-role="remove">×</button></td></tr>
        <tr data-key="8" data-role="item"><td>humble helmet</td><td>Outdoor</td><td><input type="number" data-role="qty" value="75"></td><td>€85.78</td><td>€6,433.50</td><td>€8,041.87</td><td><input type="checkbox" data-role="active"></td><td><input type="text" data-role="note" placeholder="Note" value=""></td><td><button data-role="remove">×</button></td></tr>
        <!-- rows 9 (eager saddle, Sports, 98 × €10.66) and 10 (eager blanket, Books, 14 × €50.48) -->
      </tbody>
    </table>
  </section>
</div>
```

`grossSales` = 5,005.44 + 6,433.50 + 1,044.68 + 706.72 = €13,190.34; `dutyOwed` =
floor(1,319,034 × 18 / 100) cents = €2,374.26; `partnerStock` = 71 × 310 + floor(237,426 / 2) =
140,723 cents. Typing 9 into the quantity of row 9 changes its line (€95.94), `grossSales`,
`dutyOwed` and `partnerStock`; typing 100 into Base orders changes only `partnerStock`. At every
bigger size these three units stay exactly as they are, and the next units follow.

## Decisions

Made while writing this contract (the owner may revisit any of them):

1. **N counts formulas;** inputs come with about half of them, so readers per value stay bounded as
   N grows. Fixed inputs would make every input's fan-out grow with N.
2. **Displays never compute.** All computation is in formulas, so the graph is explicit and
   "computed once or once per reader" is a property of the implementation, not of the spec.
3. **`--fanout` changes only displays;** formulas are byte-for-byte the same, so a variant isolates
   the cost of read edges (and of inlining chains into readers).
4. **Closed forced closures** make locality meaningful: the local actions' closures are identical at
   every N, so any growth is the implementation's. The hub input and item edits are classified
   global and reported.
5. **Items are loaded by the app's own generator** (as big-table creates rows), so `--rows` never
   reaches the bundle; the 6 initial items are data and the same at every size.
6. **Integers only**, exact in a double, with floor division and no locale formatting, so every
   language reaches the same text.
7. **The bench runs at N = 64** (the dashboards' size), with 2,000 items.

## Not in this scenario

No CSS, no network, no routing, no conditional sections (every value is always shown, so the check
verifies all of them; lazy evaluation of hidden content is the routed-app scenario's subject).
