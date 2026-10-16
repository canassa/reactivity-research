# Scenario: big-table

The contract of the `big-table` scenario. It adds to the global contract in `CLAUDE.md` and never
relaxes it. **No generator or emitter exists yet**: this README is written first, for the owner to
review, and every example below is illustrative.

## What it models

**An app made of data tables.** An admin back office, a reporting page, an inventory screen: a
page of tables, each with its own columns, cell formats, toolbar and row controls, filled with
hundreds or thousands of rows. It is the app [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark)
models, the reference everyone quotes for UI speed, grown the way a real back office grows: by
adding **tables**, never by adding rows.

| | `shared-components` | `unique-components` | `big-component` | `big-table` |
|---|---|---|---|---|
| the page is | N widgets from 13 kinds | N widgets, each its own component | 1 form of N fields | **N tables, each its own component** |
| one more unit of size is | one more widget instance | one more component type | one more field | **one more table: columns, toolbar, row controls** |
| data | a handful of items | a handful of items | a handful of items | **1,000 to 11,000 rows per table** |
| what it adds | | | | **keyed lists at scale, and CPU calibrated against js-framework-benchmark** |

It measures:

- **Size:** the cost of one more table (its row template, its row builder, its operations, its
  formatting) against a baseline that is, at N = 1, js-framework-benchmark's app.
- **Speed, calibrated:** at N = 1 the app is js-framework-benchmark's, so `./rr bench`'s figures
  can be set against the official relative standing (for example Solid 1.9 ≈ 1.08× vanillajs on
  the official weighted geometric mean, reproduced by beni research 83 §7 on a quiet machine).
  If our harness ranks the frameworks the same way there, its figures on the other scenarios gain
  credibility; if not, the difference is a finding about the method.
- **Locality with real data:** an event in one table must not cost work in the others, and a
  select or a swap in a table of 1,000 rows should not cost work for every row.

## What "size" means

**Size is N, the number of tables.** Which sizes and seeds are measured is set per framework in
`runs.json`, not here.

- **Rows are data, never size.** The number of rows a table holds changes no code: it is the
  `--rows` parameter (default 1,000), and it only matters for CPU (`./rr bench`) and for work
  counts (`./rr work`). Size measurements always use the default.
- **Table 1 is js-framework-benchmark's table** at every N (see *Table 1*). Tables 2 to N are
  generated, each different.
- **No two tables have the same structure**, even ignoring every text, number and name (the
  generator checks a structural signature, as unique-components does, and redraws on a collision).
- **Prefix stability:** for one seed, table i is identical at every N; growing N only appends
  tables.
- Each table carries a **token**, 4 seeded base-36 characters (for example `q7rd`), in its
  heading. It is real content every implementation renders, so near-twin tables cannot compress
  away. It adds about 10 bytes per table after brotli. It never appears inside a row.
- From N = 4 every cell kind and every operation is present (tables 2 to 4 are forced, below),
  so `steadyFrom = 4`: baseline and slope are fitted over N ≥ 4, and N = 1 (the
  js-framework-benchmark app alone) is reported beside them as its own point.

## Each table is its own code (scenario rule)

The rule of `unique-components` ("Each widget is its own code") applies to every table:

- **Its own code.** Each table's row template, its row builder (which pools, ranges and formats it
  draws from), its operations (what each button does to which rows and cells), its row controls,
  its computed cells and its formatting calls are emitted as **that table's own code**, the way a
  developer or a compiler would write the component.
- **Allowed:** generic helpers independent of any table's behaviour: create an element, set a
  text, a keyed-list reconciler, event delegation, the PRNG step (below), a thousands-grouping
  function; static markup templates; plain data that is genuinely data (word pools, labels).
- **Not allowed:** a table of column descriptors (`{ kind: "number", format: "currency", … }`)
  driving one generic table component, op-code tables for the operations, or the spec's table
  descriptions themselves.
- **Rule of thumb:** if deleting one table's code from the bundle would leave its columns or its
  behaviour still described somewhere as data that a generic routine executes, it is an
  interpreter.

### One shared table component, or every table its own?

The two existing dashboards split this axis into two scenarios. Here it could be a parameter:
`--tables shared` (one generic table component, used N times with N column configurations) against
`--tables unique` (every table its own component). **Recommendation: only `unique`, no
parameter**, because:

1. **The shared axis is already measured.** `shared-components` measures per-instance wiring of a
   reused component; a shared table would measure it again.
2. **A shared table turns size into data.** With one generic grid, growing N adds column configs,
   which are data, compress well and cost the same in every approach. The slope would measure the
   configuration format, not the approach, and the approaches would converge on "one grid plus
   JSON": exactly what the scenario must not measure.
3. **It keeps N = 1 honest.** Every js-framework-benchmark entry hand-writes its one table: row
   template, keyed loop, handlers. `unique` is that, N times.

The column-definition grid (TanStack Table, AG Grid: column defs with render functions) is a real
idiom. If the owner wants it measured, it is better as an **emitter style option** of the real
frameworks (a generic `<Grid>` with per-column `cell` functions, which are code, not data) than as
a scenario parameter. See the open questions.

## Table 1: js-framework-benchmark's app

Table 1 is the same at every N, built from js-framework-benchmark's `frameworks/keyed/vanillajs`:

- rows `{ id, label }`, `id` from 1 and incremented for every row ever created (never reset
  except by a snapshot), `label` = adjective + " " + colour + " " + noun from **their three word
  lists, verbatim** (25 adjectives, 11 colours with `brown` twice, 13 nouns);
- six buttons: **Create 1,000 rows** (`run`), **Create 10,000 rows** (`runlots`), **Append 1,000
  rows** (`add`), **Update every 10th row** (`update`), **Clear** (`clear`), **Swap Rows**
  (`swaprows`); the counts are `--rows` and 10 × `--rows`;
- per row, a **select** link on the label (the row gets `class="danger"`; one row at most) and a
  **remove** link.

The row markup is theirs: `<tr>` with four `<td>`: the id, the label in an `<a>`, the remove
`<a>` around a `<span aria-hidden="true">`, and an empty spacer cell.

### How close N = 1 is, and where it must differ

| | js-framework-benchmark | big-table, N = 1 |
|---|---|---|
| operations and their semantics | the nine benchmarks' six buttons, select, remove | **the same** (swap: indices 1 and 998 when there are more than 998 rows; here 1 and `rows − 2`, identical at the default) |
| word lists, label shape, ids | their lists; ids from 1 | **the same** |
| element structure of a row | `tr > td, td > a, td > a > span, td` | **the same elements** |
| labels' randomness | `Math.random` | a **seeded PRNG in the state** (below): same distribution, deterministic |
| attributes | `id`s on buttons, Bootstrap classes on cells and buttons | `data-role` on buttons and links, `data-key` and `data-role` on rows (contract); **no classes** except `danger` |
| remove link content | an empty glyphicon `<span>`, sized by CSS | the same `<span aria-hidden="true">` with the text `×`, since there is no CSS to give it a size and the bench must be able to click it |
| page around the table | static HTML: jumbotron, `<h1>`, buttons, CSS | rendered by `mount` into the root: a `<section>` with an `<h2>`, the buttons, the table; no CSS |
| external events | none | `dispatch` events (`serverRows`, `serverUpdate`, `serverDelete`, `snapshot`), which every implementation must support, so N = 1 ships code no js-framework-benchmark entry has |
| selection after append or update | vanillajs's store nulls it but its DOM keeps the highlight; Solid, Svelte and others keep it | **kept** (the DOM behaviour of every entry); create, create-many and clear drop it |
| timing | `total` (click to paint), 4× CPU throttling on select, swap, remove, update; fresh page per sample | `script` µs unthrottled, many reps on one page (`harness/bench/README.md`) |

So N = 1 is js-framework-benchmark's app minus its CSS and static shell, plus the contract's
selectors and external events. Sizes are therefore **not** comparable with the official size
column (vanillajs 2.5 kB brotli there); CPU ratios to vanilla are what calibrates.

## Labels, and every other random value

js-framework-benchmark draws labels with `Math.random`. The reference `update` must be
deterministic and every implementation must reach the same state without calling it, so:

**Each table carries its own PRNG state in the app state**, a Park–Miller ("minstd") generator:

```js
// One draw: advance the state, then use it. Every product stays below 2^47, exact in a double,
// so the same code works in JavaScript, Elm and any language with 53-bit integers or better.
const next = (s) => (s * 48271) % 2147483647;          // s in 1 … 2147483646
const pick = (s, list) => list[s % list.length];          // after advancing
const between = (s, min, max) => min + (s % (max - min + 1));
```

- A table's state holds `rng` (the current PRNG state) and `nextId`. Creating a row draws, for
  each of its generated cells in column order, one value (table 1: three draws, adjective, colour,
  noun), then takes `id = nextId++`.
- The initial `rng` of each table comes from the seed and is part of `initialState`; a snapshot
  carries new values of both.
- **Why in the state, not in the message:** a click carries no data, so a user's "create 1,000
  rows" can only be intent; the rows must come from somewhere every implementation can reproduce.
  Rows that *do* come from outside arrive in messages (`serverRows`).
- **Fairness:** the generator is part of the app, exactly as every js-framework-benchmark entry
  ships its `buildData` and its word lists. It costs one multiply and one modulo per draw, as
  `Math.random` does; the label sequence is the same on every load, which beni research 83 §5
  found the official rules do not forbid. An implementation keeps `rng` and `nextId` wherever
  its idiom keeps non-rendered state (a plain variable, a model field, a store); they are never
  displayed.

## The table catalogue

Every table is `<section data-key="t{i}" data-role="table">`: an `<h2>` (title and token), a
toolbar `<div>` of buttons, and a `<table>` (tables 2 to N with a `<thead>` row of `<th>`
headers; table 1 has none, as js-framework-benchmark). Each body row is
`<tr data-key="{id}" data-role="row">`, with the selection marker when selected.

### Cell kinds

A row is `{ id, [column]: value }`; only generated cells are stored. Tables 2 to N draw 3 to 7
columns.

| Kind | Value | Drawn (per row) | Renders `<td>…</td>` | `updateEvery` effect |
|---|---|---|---|---|
| `id` | the row id | nothing | `{id}` | none |
| `label` | string | 2-3 words, one per pool, joined by spaces | the text; inside `<a data-role="{select}">` if the table has select | append the table's suffix (`" !!!"` in table 1) |
| `text` | string | one word from its pool | the text, or a select link as above | append a suffix |
| `number` | integer ≥ 0 | `between(min, max)` | formatted (below) | add a positive delta |
| `date` | day of the year, 1-365 | `between(1, 365)` | `Mar 14`, `14 Mar` or `03-14` (per column) | add k days, wrapping 365 → 1 |
| `status` | one of 2-4 options | `pick(options)` | `<b>`, `<em>`, `<mark>` or `<strong>` around the option | the next option, wrapping |
| `flag` | boolean | `s % 2 === 1` | `<input type="checkbox" data-role="{toggle}">`, `checked` = value (a live property) | negate |
| `computed` | none stored | nothing | an expression over **its own row's** cells (below), formatted | recomputed |
| `remove` | control | nothing | `<a data-role="{remove}">…</a>` or `<button data-role="{remove}">…</button>` | |
| `bump` | control | nothing | `<button data-role="{bump}">{text}</button>`, adds a delta to one number column | |
| `spacer` | table 1 only | nothing | empty | |

**Number formats** (values are never negative): `plain` (`1234`), `grouped` (`1,234`),
`unit` (`1,234 kg`, the unit per column), `currency` (the value in cents: `$12.34`, `€1,234.50`,
`£0.05`), `percent` (the value in tenths: `12.5%`). Grouping is a comma every three digits; no
locale APIs, so every language formats alike.

**Computed cells** are typed expressions over the row, in unique-components' array notation,
compiled by each implementation into code: `["*", a, b]` and `["+", a, b]` over number columns
(with a format), `["len", textColumn]`, and `["if", cond, "yes text", "no text"]` with `cond` one
of `[">", numberColumn, k]`, `["==", statusColumn, "option"]` or `["f", flagColumn]`.

### Operations (the toolbar)

Each is a `<button data-role="{name}">{text}</button>`, names and texts drawn per table
(`load`, `fetch`, `refill`…; "Load 1,000 shipments").

| Kind | Effect | In table 1 | Tables 2 to N |
|---|---|---|---|
| `create` | replace all rows with `count` new rows; drop the selection | `run` (rows), `runlots` (10 × rows) | always, count = rows |
| `append` | append `count` new rows; keep the selection | `add` | 40% |
| `updateEvery` | rows at index 0, k, 2k, … get the effect on one column (table above) | `update`, k = 10, label + `" !!!"` | 60%, k in 2-12 |
| `clear` | no rows; drop the selection; `nextId` continues | `clear` | 50% |
| `swap` | if there are more than j rows, swap the rows at indices i and j | `swaprows`, i = 1, j = rows − 2 | 40%, i in 0-2, j = rows − 1 − (0-2) |
| `sort` | order the rows by one column, ascending or descending (per op), ties by id ascending | | 35%, 1-2 sort ops |
| `removeChecked` | drop every row whose flag is set (and the selection, if it was one of them) | | 50% of tables with a flag |

Sort order: numbers, dates and ids numerically, texts and labels by UTF-16 code units (JS `<`),
statuses by option index, flags false before true.

### Row controls

| Kind | Effect | Table 1 | Tables 2 to N |
|---|---|---|---|
| `select` | `selected = id` (one row at most); clicking the selected row keeps it | the label link | 50%, a link on the label or a text cell |
| `remove` | drop the row; if it was selected, no selection | the remove link | 70%, a link or a button |
| `toggle` | negate the row's flag | | every flag column |
| `bump` | add the delta to one number column of the row | | 40% of tables with a number column |

The **selection marker** is per table: `class="danger"` (table 1), `class="selected"`,
`class="active"` or `aria-selected="true"`.

### How tables vary

Every table draws, from the seed: a title (a noun from a pool, plural, "Shipments"), its token,
its column count, kinds, names, headers and order; each text column's pool (5-10 words drawn from
the scenario's master vocabularies) and each label column's 2-3 pools; ranges, formats, units and
currency symbols; status options and tag; date format; computed expressions; its operations,
their counts, k, deltas, suffixes, swap indices, sort columns and directions; its row controls,
their element (link or button) and texts; its selection marker; its initial rows (3-5, built by
its own row builder from its initial `rng`, so an implementation may embed them or build them at
start-up); every `data-role` name (unique within the table).

**The first tables.** So every cell kind and operation is present from N = 4 and the work and
bench actions find the same targets at every size:

| Table | Always has |
|---|---|
| t1 | js-framework-benchmark's table (above), starting **empty** as theirs does |
| t2 | a flag column with `toggle`, `removeChecked`, two sort ops (one ascending on a text column, one descending on a date column), `remove` |
| t3 | a label column with `select`, a number column with `bump` and `updateEvery` on it, a computed product of two number columns (currency), `append`, `swap` |
| t4 | a status column with `updateEvery` cycling it, a computed `if` over the status, `select` with a marker other than `danger`, `clear` |

## State and messages

- **State:** `{ tables: { [id]: { rows: [{ id, …cells }], selected: id | null, nextId, rng } } }`,
  plain data. Updates are immutable with structural sharing: an operation that edits some rows
  makes new objects for those rows and a new array, and keeps every other row object.
- **User messages** come from DOM events on the toolbar and row controls:
  `{ table, type: <op name> }` and `{ table, type: <control name>, id }`. They say what was
  clicked, never what the new rows are.
- **External events (through `dispatch(msg)`):**

| Message | Intent | Effect |
|---|---|---|
| `{ type: "serverRows", table, rows }` | "the server sent this page of rows" | replace the rows with `rows` (each with its id and cells); keep the selection if its id is still there; `nextId = max(nextId, largest id + 1)` |
| `{ type: "serverUpdate", table, column, changes: [{ id, value }] }` | "these rows' prices (or statuses…) changed" | set `column` of each listed row that exists; others untouched |
| `{ type: "serverDelete", table, ids }` | "these rows were deleted elsewhere" | drop them; the selection goes if it was one of them |
| `{ type: "snapshot", state }` | "here is the whole state" | every table replaced: rows keep their ids but a slice is reversed, one row is gone, one new, every third row edited, the selection moved; new `rng` and `nextId` |

- **The reference `update`** applies exactly the tables above; `render` produces exactly the HTML
  above. No timers.

## Selectors

- Table: `[data-key="t3"]`, `data-role="table"`.
- A toolbar button: `[data-key="t3"] [data-role="{op name}"]`; table 1's are `run`, `runlots`,
  `add`, `update`, `clear`, `swaprows`.
- A row: `[data-key="t3"] tr[data-key="{id}"]`, `data-role="row"`.
- A row control: `[data-key="t3"] tr[data-key="{id}"] [data-role="{control name}"]`; table 1's
  are `select` and `remove`.

## The interaction script

Generated from the app, the same for every framework:
1. mount;
2. table 1, in js-framework-benchmark's spirit: `run`, select row 5, `update`, `swaprows`, remove
   row 3, remove the selected row, `add`, select a row, `runlots`, `swaprows` twice, `clear`,
   `run`;
3. every other table: `create` first, then each operation once (each sort twice), each row
   control on 2 rows (the selected row among them, where there is one);
4. external events: `serverRows` on t1 and one other table, `serverUpdate` on 2 tables (on a
   column a computed cell reads, where there is one), `serverDelete` on 1 (the selected row among
   the ids);
5. a reorder through `snapshot`;
6. a final round: select, swap and remove in t1, one row control in every other table with rows;
7. dispose.

Every step must leave the page as the global contract requires; the owner verifies it by hand
through `./rr serve`.

## Scenario-specific expectations

On top of the global contract:
- **Keyed rows:** every row keeps its `<tr>` (and every node inside it whose content did not
  change) across swap, sort, remove, append, `removeChecked`, `updateEvery`, `serverUpdate`,
  `serverDelete`, `serverRows` with ids already present, and the snapshot reorder. `create`
  replaces the rows, since they are new rows with new ids.
- **Selection** changes only the marker of the old and the new row: no row is replaced, and no
  other row is touched in the DOM.
- **`updateEvery`** changes only the touched cells' text (and the computed cells reading them).
- **Focus:** there are no text inputs. A row checkbox keeps its node, and so its focus, across
  its own toggle, `updateEvery`, sort and swap.
- **The marker attribute:** an empty `class=""` on an unselected row counts as no class (the
  check's comparison must treat them alike; Solid and others leave the empty attribute after
  deselecting).
- **Isolation:** an event in one table changes no node of another table.

## Locality, work and CPU

### Locality (`./rr check`, prototype track, enforced)

As CLAUDE.md fixes it: the calls of one local action may grow at most 8× when **N** grows 16×
(N = 16 → 256 from `quickCheckSize`), **with `--rows` fixed**. The work actions run on t1 (filled
by an untimed setup `run`) and t2-t4; every other table keeps its 3-5 initial rows.

- **Local** (one table): every user action and every `serverRows`, `serverUpdate` and
  `serverDelete`, including `create`, `clear`, `sort` and `updateEvery`. These may cost work
  proportional to the **table's** rows, but the table does not grow with N, so their cost must
  stay flat as tables are added. `updateEvery` touches every k-th row by nature: it is local to
  its table, and data-proportional within it.
- **Global:** `snapshot` only (reported, not held to the bound).

### Work against rows (`./rr work --rows`, reported, not enforced)

The second axis: one table, `--rows 1000` against `--rows 10000`, at a fixed N.

| Action | Expected growth with rows | Why |
|---|---|---|
| select, swap, remove, toggle, bump, `serverUpdate`/`serverDelete` of a few ids | flat in DOM work; an implementation may still search by index | the change is 1-2 rows |
| `updateEvery` | proportional (rows / k) | it touches every k-th row |
| create, append, clear, sort, `serverRows` | proportional | every row |

It is reported for every framework (a virtual-DOM select re-renders every row; Solid's
`createSelector` touches two), and **not enforced**, even on prototypes: an idiomatic
`findIndex` over the rows is O(rows) calls in any approach, vanilla included. (See the open
questions.)

### CPU (`./rr bench`)

The bench runs **one app per framework at N = 1** (`"$bench": { "sizes": [1], "seeds": [1] }`),
the js-framework-benchmark app, with the default `--rows 1000`. Growth with N is left to
`./rr work`, as in the other scenarios. js-framework-benchmark's nine CPU benchmarks, as do/undo
pairs (`harness/bench/big-table.js`):

| js-framework-benchmark | Bench action | Halves (timed) | Untimed setup / reset |
|---|---|---|---|
| 01 create rows (1k) | create 1k / clear | `run` on an empty table, then `clear` | |
| 02 replace all rows | replace 1k | `run` on 1k rows, repeated on its own | setup: `run` |
| 03 partial update (10k) | update every 10th | `update`, repeated on its own | setup: `runlots`; every 8 reps, `serverRows` of the setup rows puts the labels back |
| 04 select row | select | select row 2, then row 3 | setup: `run` |
| 05 swap rows | swap / swap back | `swaprows`, `swaprows` | setup: `run` |
| 06 remove row | remove | remove the 4th row, repeated on its own (the table stays within 5% of 1k rows) | setup: `run` |
| 07 create many rows | create 10k / clear 10k | `runlots` on an empty table, then `clear` (this half is **09 clear rows**) | |
| 08 append to large table | append 1k | `add` on 10k rows | setup: `runlots`; reset: `serverRows` of the setup rows |
| 09 clear rows (10k) | (in 07) | | |

Plus, for the contract's own events: `serverUpdate` of 10 ids and `snapshot` A/B (global). The
CPU card can then show js-framework-benchmark's **weighted geometric mean** over the nine,
computed from our `script` medians with their weights, beside the official figure. Our method
differs (unthrottled `script`, reps on one page, no CSS, so no layout of a styled table), so it is
the **order and the ratios to vanillajs** that calibrate, not the milliseconds.

## Implementations

**vanilla** is the floor CLAUDE.md asks for, modelled on js-framework-benchmark's
`vanillajs-keyed`: per table, a row `<template>` cloned with `cloneNode(true)`, its own row
builder and store (`rows`, `selected`, `nextId`, `rng`), one delegated click listener per table,
direct DOM operations (`textContent = ""` for clear, two `insertBefore` for swap, the previously
selected `<tr>` remembered). What the contract adds to theirs: `dispatch` handlers that apply the
server events and a snapshot through a small keyed reconciler (a generic helper), `dispose`
removing its listeners, and the selection rule above (theirs nulls `selected` on append in the
store only). Like theirs, it must not do hidden O(page) work.

Every other emitter writes each table as its approach's component, from its description alone:
one typed field per column, the row builder and operations written out as code, the row template
with each computed expression compiled into a binding, the framework's keyed list (`For`,
`key`, `{#each … (id)}`, `Html.Keyed`) for the body.

## Parameters

| Parameter | Default | Meaning |
|---|---|---|
| `--size` | 16 | N, the number of tables |
| `--seed` | 1 | the random seed |
| `--rows` | 1000 | the row count of every `create` and `append` (table 1's `runlots` makes 10×); data, not size |

`quickCheckSize = 16` (the locality check then runs 16 → 256), `steadyFrom = 4`. `./rr check`
should build with `--rows 40` (a `quickCheckOptions` export, a small harness addition), so the
script's `runlots` compares 400 rows, not 10,000, against the reference; the code is the same.
Each framework's emitter may take its own style parameters; it records which it used and runs in
its documented idiomatic style by default.

## A worked example (illustrative)

`--size 2 --seed 1 --rows 4`. No generator exists yet, so the values are invented, but the rows
follow the PRNG above from the `rng` shown. Table 2 is kept short and ignores the forced
capabilities of the first tables:

```json
{ "id": "t2", "token": "q7rd", "title": "Shipments q7rd", "rng": 7919, "initialRows": 3,
  "columns": [
    { "name": "id", "kind": "id", "header": "#" },
    { "name": "carrier", "kind": "text", "header": "Carrier", "pool": ["Acme", "Birch", "Cobalt", "Dune", "Ember"] },
    { "name": "weight", "kind": "number", "header": "Weight", "min": 1, "max": 90, "format": "unit", "unit": "kg" },
    { "name": "cost", "kind": "number", "header": "Cost", "min": 500, "max": 20000, "format": "currency", "symbol": "$" },
    { "name": "size", "kind": "computed", "header": "Size", "expr": ["if", [">", "weight", 40], "heavy", "light"] },
    { "name": "late", "kind": "flag", "header": "Late", "toggle": "markLate" },
    { "name": "drop", "kind": "remove", "header": "", "element": "button", "text": "Drop" } ],
  "ops": [
    { "name": "load", "kind": "create", "text": "Load 4 shipments" },
    { "name": "sortByWeight", "kind": "sort", "column": "weight", "dir": "asc", "text": "Lightest first" },
    { "name": "raiseEvery2", "kind": "updateEvery", "k": 2, "column": "cost", "delta": 250, "text": "Raise every 2nd" },
    { "name": "dropLate", "kind": "removeChecked", "column": "late", "text": "Drop late" } ] }
```

Its initial rows, drawn in column order (carrier, weight, cost, late) from `rng` 7919:

```json
{ "rows": [
    { "id": 1, "carrier": "Ember", "weight": 6, "cost": 10466, "late": true },
    { "id": 2, "carrier": "Ember", "weight": 24, "cost": 1691, "late": false },
    { "id": 3, "carrier": "Cobalt", "weight": 61, "cost": 7544, "late": false } ],
  "selected": null, "nextId": 4, "rng": 1563029494 }
```

Table 1 starts empty with `rng` 104729 (here). After clicking **Create 4 rows** and the label of
row 2, the reference HTML (indented for reading; whitespace is ignored):

```html
<div data-role="page">
  <section data-key="t1" data-role="table">
    <h2>Rows 3k9z</h2>
    <div>
      <button data-role="run">Create 4 rows</button>
      <button data-role="runlots">Create 40 rows</button>
      <button data-role="add">Append 4 rows</button>
      <button data-role="update">Update every 10th row</button>
      <button data-role="clear">Clear</button>
      <button data-role="swaprows">Swap Rows</button>
    </div>
    <table><tbody>
      <tr data-key="1" data-role="row"><td>1</td><td><a data-role="select">helpful red pizza</a></td><td><a data-role="remove"><span aria-hidden="true">×</span></a></td><td></td></tr>
      <tr data-key="2" data-role="row" class="danger"><td>2</td><td><a data-role="select">tall brown table</a></td><td><a data-role="remove"><span aria-hidden="true">×</span></a></td><td></td></tr>
      <tr data-key="3" data-role="row"><td>3</td><td><a data-role="select">helpful white bbq</a></td><td><a data-role="remove"><span aria-hidden="true">×</span></a></td><td></td></tr>
      <tr data-key="4" data-role="row"><td>4</td><td><a data-role="select">pretty red house</a></td><td><a data-role="remove"><span aria-hidden="true">×</span></a></td><td></td></tr>
    </tbody></table>
  </section>
  <section data-key="t2" data-role="table">
    <h2>Shipments q7rd</h2>
    <div>
      <button data-role="load">Load 4 shipments</button>
      <button data-role="sortByWeight">Lightest first</button>
      <button data-role="raiseEvery2">Raise every 2nd</button>
      <button data-role="dropLate">Drop late</button>
    </div>
    <table>
      <thead><tr><th>#</th><th>Carrier</th><th>Weight</th><th>Cost</th><th>Size</th><th>Late</th><th></th></tr></thead>
      <tbody>
        <tr data-key="1" data-role="row"><td>1</td><td>Ember</td><td>6 kg</td><td>$104.66</td><td>light</td><td><input type="checkbox" data-role="markLate" checked></td><td><button data-role="drop">Drop</button></td></tr>
        <tr data-key="2" data-role="row"><td>2</td><td>Ember</td><td>24 kg</td><td>$16.91</td><td>light</td><td><input type="checkbox" data-role="markLate"></td><td><button data-role="drop">Drop</button></td></tr>
        <tr data-key="3" data-role="row"><td>3</td><td>Cobalt</td><td>61 kg</td><td>$75.44</td><td>heavy</td><td><input type="checkbox" data-role="markLate"></td><td><button data-role="drop">Drop</button></td></tr>
      </tbody>
    </table>
  </section>
</div>
```

Then, in table 1: **Swap Rows** swaps indices 1 and `rows − 2` = 2 (rows 2 and 3 trade places,
both `<tr>`s kept, row 2 still marked); **Update every 10th row** touches index 0 only:
"helpful red pizza !!!". In table 2: **Raise every 2nd** makes rows 1 and 3 cost $107.16 and
$77.94; ticking row 2's checkbox and **Drop late** removes rows 1 and 2, leaving row 3's `<tr>`
in place.

## Open questions for the owner

1. **One table style or two?** Recommended: every table its own component, no `--tables shared`
   parameter (above). A column-definition grid could instead be an emitter style option for the
   real frameworks.
2. **Bench at N = 1 only?** It is the calibration point. Adding N = 64 (as the other scenarios)
   would time events with 63 other tables on the page, which `./rr work`'s locality already
   covers in calls.
3. **Rows axis for prototypes:** reported only. It could be enforced for `select` alone (the one
   action every good implementation does in O(1): two rows' markers), to catch a prototype that
   re-runs every row's bindings on a click.
4. **`--rows 40` for `./rr check`** needs a `quickCheckOptions` export the harness does not have
   yet; the alternative is to check at 1,000 rows with a 10,000-row `runlots` step (slower).
5. **No text inputs.** A per-table filter box would add focus-and-caret checks and derived lists,
   but that is the "filtering and derived data" family; left out to keep N = 1 equal to
   js-framework-benchmark.
6. **The serve page:** without CSS the `danger` row is invisible to the eye; the serve panel's own
   stylesheet (not measured) could highlight `[data-role="row"].danger` and the other markers.
