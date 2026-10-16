# Scenario: big-table

The contract of the `big-table` scenario. It adds to the global contract in `CLAUDE.md` and never
relaxes it. The generator and the reference are `spec.js`; no emitter exists yet.

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
  counts (`./rr work`). It appears in the code only as constants (the counts of create and
  append, their button texts, the swap indices). Size measurements always use the default.
- **Table 1 is js-framework-benchmark's table** at every N (see *Table 1*). Tables 2 to N are
  generated, each different.
- **No two tables have the same structure**, even ignoring every text, number and name (the
  generator checks a structural signature, as unique-components does, and redraws on a collision).
- **Prefix stability:** for one seed (and one `--rows`), table i is identical at every N; growing
  N only appends tables.
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
  function, the number and date formatters; static markup templates; plain data that is genuinely
  data (word pools, labels, status options).
- **Not allowed:** a table of column descriptors (`{ kind: "number", format: "currency", … }`)
  driving one generic table component, op-code tables for the operations, or the spec's table
  descriptions themselves.
- **Rule of thumb:** if deleting one table's code from the bundle would leave its columns or its
  behaviour still described somewhere as data that a generic routine executes, it is an
  interpreter.

The reference `update` and `render` in `spec.js` *are* such interpreters: they are the
specification, not a model to copy.

### Every table its own component (decided)

The two existing dashboards split the shared/unique axis into two scenarios. Here it could have
been a parameter (`--tables shared`: one generic table component used N times with N column
configurations). **The owner decided: one style only, every table its own component, no
parameter**, because:

1. **The shared axis is already measured.** `shared-components` measures per-instance wiring of a
   reused component; a shared table would measure it again.
2. **A shared table turns size into data.** With one generic grid, growing N adds column configs,
   which are data, compress well and cost the same in every approach. The slope would measure the
   configuration format, not the approach, and the approaches would converge on "one grid plus
   JSON": exactly what the scenario must not measure.
3. **It keeps N = 1 honest.** Every js-framework-benchmark entry hand-writes its one table: row
   template, keyed loop, handlers. Every table its own component is that, N times.

The column-definition grid (TanStack Table, AG Grid: column defs with render functions) is a real
idiom; if it is ever measured, it is as an **emitter style option** of the real frameworks (a
generic `<Grid>` with per-column `cell` functions, which are code, not data), not as a scenario
parameter.

## Table 1: js-framework-benchmark's app

Table 1 is the same at every N, built from js-framework-benchmark's `frameworks/keyed/vanillajs`:

- rows `{ id, label }`, `id` from 1 and incremented for every row ever created (never reset
  except by a snapshot), `label` = adjective + " " + colour + " " + noun from **their three word
  lists, verbatim** (25 adjectives, 11 colours with `brown` twice, 13 nouns; `JFB_ADJECTIVES`,
  `JFB_COLOURS`, `JFB_NOUNS` in `spec.js`);
- six buttons: **Create 1,000 rows** (`run`), **Create 10,000 rows** (`runlots`), **Append 1,000
  rows** (`add`), **Update every 10th row** (`update`), **Clear** (`clear`), **Swap Rows**
  (`swaprows`); the counts are `--rows` and 10 × `--rows`;
- per row, a **select** link on the label (the row gets `class="danger"`; one row at most) and a
  **remove** link;
- the heading is `Rows {token}`; there is no `<thead>`.

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

**Each table carries its own PRNG state in the app state**, a Park–Miller ("minstd") generator
(`next`, `pick`, `between` in `spec.js`):

```js
// One draw: advance the state, then use it. Every product stays below 2^47, exact in a double,
// so the same code works in JavaScript, Elm and any language with 53-bit integers or better.
const next = (s) => (s * 48271) % 2147483647;          // s in 1 … 2147483646
const pick = (s, list) => list[s % list.length];          // after advancing
const between = (s, min, max) => min + (s % (max - min + 1));
```

- A table's state holds `rng` (the current PRNG state) and `nextId`. Creating a row draws, for
  each of its generated cells in column order, its value, then takes `id = nextId++`:
  - `label`: one draw per pool, `pick` from it; the words joined by single spaces (table 1:
    three draws, adjective, colour, noun);
  - `text`: one draw, `pick` from its pool;
  - `number`: one draw, `between(s, min, max)`;
  - `date`: one draw, `between(s, 1, 365)`;
  - `status`: one draw, `pick` from its options;
  - `flag`: one draw, `s % 2 === 1`;
  - `id`, `computed` and the control and spacer columns draw nothing.
- The initial `rng` of each table comes from the seed (the description's `rng`); the table's
  initial rows (`initialRows`, 3 to 5; none in table 1) are built from it, so `initialState`
  holds those rows and the advanced `rng`. An implementation may embed the initial rows or build
  them at start-up with its own row builder. A snapshot carries new values of both.
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
headers, control columns with an empty `<th></th>`; table 1 has none, as js-framework-benchmark).
Each body row is `<tr data-key="{id}" data-role="row">`, with the selection marker when selected.

### Cell kinds

A row is `{ id, [column]: value }`; only generated cells are stored. Tables 2 to N have 2 to 5
generated (data) columns, an id column (60%, always first), 0 to 2 computed columns, and their
control columns (last).

| Kind | Value | Drawn (per row) | Renders `<td>…</td>` | `updateEvery` effect |
|---|---|---|---|---|
| `id` | the row id | nothing | `{id}` | none |
| `label` | string | 2-3 words, one per pool, joined by spaces | the text; inside `<a data-role="{select}">` if the column has the select control | append the op's suffix (`" !!!"` in table 1) |
| `text` | string | one word from its pool | the text, or a select link as above | append the op's suffix |
| `number` | integer ≥ 0 | `between(min, max)` | formatted (below) | add the op's positive delta |
| `date` | day of the year, 1-365 (no leap years) | `between(1, 365)` | `Mar 14` (`mon-d`), `14 Mar` (`d-mon`) or `03-14` (`mm-dd`), per column | add the op's days, wrapping 365 → 1 |
| `status` | one of 2-4 options (the string) | `pick(options)` | `<b>`, `<em>`, `<mark>` or `<strong>` (the column's `tag`) around the option | the next option, wrapping |
| `flag` | boolean | `s % 2 === 1` | `<input type="checkbox" data-role="{toggle}">`, `checked` = value (a live property) | negate |
| `computed` | none stored | nothing | an expression over **its own row's** cells (below), formatted | recomputed |
| `remove` | control | nothing | `<a data-role="{role}">{text}</a>` or `<button data-role="{role}">{text}</button>`; table 1: `<a data-role="remove"><span aria-hidden="true">×</span></a>` | |
| `bump` | control | nothing | `<button data-role="{role}">{text}</button>`, adds `delta` to one number column; the text is `+` and the delta formatted as that column | |
| `spacer` | table 1 only | nothing | empty | |

**Number formats** (values are never negative): `plain` (`1234`), `grouped` (`1,234`),
`unit` (`1,234 kg`, the unit per column), `currency` (the value in cents: `$12.34`, `€1,234.50`,
`£0.05`), `percent` (the value in tenths: `12.5%`). Grouping is a comma every three digits of the
integer part (`unit`, `currency` and `percent` group too); no locale APIs, so every language
formats alike. `formatNumber` and `formatDate` in `spec.js` are the reference.

**Computed cells** are typed expressions over the row, in unique-components' array notation with
column names as plain strings, compiled by each implementation into code:

- `["*", a, b]`: a non-currency, non-percent number column times a currency column, formatted as
  currency with the currency column's symbol;
- `["+", a, b]`: two number columns of the same format (and unit or symbol), in that format;
- `["len", c]`: the length (UTF-16 code units) of a text or label column, `plain`;
- `["if", cond, "yes text", "no text"]` with `cond` one of `[">", numberColumn, k]`,
  `["==", statusColumn, "option"]` or `["f", flagColumn]` (the flag is set): the text itself.

### Operations (the toolbar)

Each is a `<button data-role="{name}">{text}</button>`, names and texts drawn per table
(`load`, `fetch`, `refill`…; "Load 1,000 shipments"); the create comes first, the others in a
random order.

| Kind | Effect | In table 1 | Tables 2 to N |
|---|---|---|---|
| `create` | replace all rows with `count` new rows; drop the selection | `run` (rows), `runlots` (10 × rows) | always, count = rows |
| `append` | append `count` new rows; keep the selection | `add` | 40%, count = rows |
| `updateEvery` | rows at index 0, k, 2k, … get the effect on one column (table above) | `update`, k = 10, label + `" !!!"` | 60%, k in 2-12, on any data column |
| `clear` | no rows; drop the selection; `nextId` and `rng` continue | `clear` | 50% |
| `swap` | if there are more than j rows, swap the rows at indices i and j | `swaprows`, i = 1, j = rows − 2 | 40%, i in 0-2, j = rows − 1 − (0-2) (i = 0, j = rows − 1 if that leaves j ≤ i) |
| `sort` | order the rows by one column, ascending or descending (per op), ties by id ascending | | 35%, 1-2 sort ops |
| `removeChecked` | drop every row whose flag is set (and the selection, if it was one of them) | | 50% of tables with a flag |

Sort order: numbers, dates and ids numerically, texts and labels by UTF-16 code units (JS `<`),
statuses by option index, flags false before true. A descending sort reverses the column order
only: ties stay by id ascending.

### Row controls

| Kind | Effect | Table 1 | Tables 2 to N |
|---|---|---|---|
| `select` | `selected = id` (one row at most); clicking the selected row keeps it | the label link | 50%, a link on a label or text cell (needs one) |
| `remove` | drop the row; if it was selected, no selection | the remove link | 70%, a link or a button |
| `toggle` | negate the row's flag | | every flag column |
| `bump` | add the delta to one number column of the row | | 40% of tables with a number column |

The **selection marker** is per table: `class="danger"` (table 1), `class="selected"`,
`class="active"` or `aria-selected="true"`. An unselected row has no marker attribute.

### How tables vary

Every table draws, from the seed: a title (a plural noun from a pool, "Shipments"), its token,
its data column count, kinds, names and order, whether it shows an id column; each text column's
pool (5-10 words drawn from one of the scenario's master vocabularies) and each label column's
2-3 pools (from distinct vocabularies); ranges, formats, units and currency symbols; status
options and tag; date format; computed expressions and their texts; its operations, their k,
deltas, days, suffixes, swap indices, sort columns and directions; its row controls, their
element (link or button) and texts; its selection marker; its initial `rng` and row count (3-5);
every `data-role` name (unique within the table, never `row`, `table`, `page` or an external
event's name).

**The first tables.** So every cell kind and operation is present from N = 4 and the work and
bench actions find the same targets at every size (`FORCED` in `spec.js`):

| Table | Always has |
|---|---|
| t1 | js-framework-benchmark's table (above), starting **empty** as theirs does |
| t2 | a flag column with `toggle`, `removeChecked` on it, two sort ops (one ascending on a text column, one descending on a date column), `remove` |
| t3 | a label column with `select`, a number column (plain, grouped or unit) with `bump` and `updateEvery` on it, a computed product of that column and a currency column, `append`, `swap` |
| t4 | a status column with `updateEvery` cycling it, a computed `if` over the status (`==`), `select` with a marker other than `danger`, `clear` |

### The table descriptions (`spec.tables`)

What an emitter reads, one object per table (the worked example below shows two):

- `id` (`"t1"`…), `token`, `title` (the `<h2>` text, token included), `thead` (boolean), `rng`
  (the PRNG state the initial rows are built from), `initialRows`, `marker` (`{ attr, value }`,
  or `null` for a table without select);
- `columns`, in display order, each with `kind` and `header`:
  - `id`: `name: "id"`;
  - `label`: `name`, `pools` (2-3 word lists; table 1: js-framework-benchmark's three), optional
    `select` (the select link's role);
  - `text`: `name`, `pool`, optional `select`;
  - `number`: `name`, `format`, `min`, `max`, and `unit` or `symbol` for those formats;
  - `date`: `name`, `format`;
  - `status`: `name`, `options`, `tag`;
  - `flag`: `name`, `toggle` (the checkbox's role);
  - `computed`: `name`, `expr`, and `format` (plus `unit`/`symbol`) unless it is an `if`;
  - `remove`: `role`, `element` (`a` or `button`), `text`, and `glyph: true` in table 1 (the
    text inside `<span aria-hidden="true">`);
  - `bump`: `role`, `column`, `delta`, `text`;
  - `spacer` (table 1).
- `ops`, in toolbar order, each with `kind`, `name` (its role and message type) and `text`:
  `create` and `append` with `count`; `updateEvery` with `k`, `column` and `suffix`, `delta` or
  `days` by the column's kind; `swap` with `i` and `j`; `sort` with `column` (possibly `"id"`)
  and `dir`; `removeChecked` with `column`.

`rowControls(table)` in `spec.js` lists a table's row controls from its columns.

## State and messages

- **State:** `{ tables: { [id]: { rows: [{ id, …cells }], selected: id | null, nextId, rng } } }`,
  plain data. Updates are immutable with structural sharing: an operation that edits some rows
  makes new objects for those rows and a new array, and keeps every other row object.
- **User messages** come from DOM events on the toolbar and row controls:
  `{ table, type: <op name> }` and `{ table, type: <control role>, id }`. They say what was
  clicked, never what the new rows are.
- **External events (through `dispatch(msg)`):**

| Message | Intent | Effect |
|---|---|---|
| `{ type: "serverRows", table, rows }` | "the server sent this page of rows" | replace the rows with `rows` (each with its id and cells); keep the selection if its id is still there; `nextId = max(nextId, largest id + 1)`; `rng` unchanged |
| `{ type: "serverUpdate", table, column, changes: [{ id, value }] }` | "these rows' prices (or statuses…) changed" | set `column` of each listed row that exists; others untouched (a change may name an id that does not exist) |
| `{ type: "serverDelete", table, ids }` | "these rows were deleted elsewhere" | drop them (ids that do not exist are ignored); the selection goes if it was one of them |
| `{ type: "snapshot", state }` | "here is the whole state" | the whole state replaced |

- **What the builders send** (`serverRowsMsg`, `serverUpdateMsg`, `serverDeleteMsg`, `snapshot`
  in `spec.js`, used by the script and the serve panel): `serverRows` keeps most current rows
  (about 1 in 10 dropped, 1 in 5 with a cell changed, a slice reversed) and appends 2-3 new rows
  with ids from `nextId` up, one id skipped; `serverUpdate` changes 3 rows (the first row among
  them) on a column a computed cell reads where there is one, plus an id that does not exist;
  `serverDelete` names the selected row (if any) and another, plus an id that does not exist; a
  snapshot replaces every table: rows keep their ids but a slice is reversed, one row is gone,
  one new row is inserted at a random place, every third row has a cell edited, the selection
  moves (in tables with select), and `rng` and `nextId` are new.
- **The reference `update`** applies exactly the tables above; `render` produces exactly the HTML
  above. No timers.

## Selectors

- Table: `[data-key="t3"]`, `data-role="table"`.
- A toolbar button: `[data-key="t3"] [data-role="{op name}"]`; table 1's are `run`, `runlots`,
  `add`, `update`, `clear`, `swaprows`.
- A row: `[data-key="t3"] tr[data-key="{id}"]`, `data-role="row"`.
- A row control: `[data-key="t3"] tr[data-key="{id}"] [data-role="{control role}"]`; table 1's
  are `select` and `remove`.

## The interaction script

Generated from the app, the same for every framework, about 150 steps at N = 16. It exercises
every table up to N = 16; above, tables 1 to 4 and 12 others (`scriptTables` in `spec.js`):
1. mount;
2. table 1, in js-framework-benchmark's spirit: `run`, select row 5, `update`, `swaprows`, remove
   row 3, remove the selected row, `add`, select a row, `runlots`, `swaprows` twice, `clear`,
   `run`;
3. every other exercised table: `create`; select two rows (the second stays selected); each
   `toggle` and `bump` on 2 rows (the selected row among them, where there is one); every other
   operation once; remove the selected row (or another); `clear` followed by a new `create`;
4. external events: `serverRows` on t1 and one other table, `serverUpdate` on 2 tables (with a
   computed cell, where there are such tables), `serverDelete` on a table with select, its
   selected row among the ids (selecting one first if none is);
5. a reorder through `snapshot`;
6. a final round: select, swap and remove in t1, one row control in every other exercised table
   with rows;
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
- **The marker attribute:** an empty `class=""` on an unselected row counts as no class; the
  serve panel's comparison (and so `./rr check`) treats them alike, since Solid and others leave
  the empty attribute after deselecting. Any other leftover (`aria-selected="false"`) is a
  difference.
- **Isolation:** an event in one table changes no node of another table.

The serve panel's own stylesheet (not measured) highlights the selected row, which the app's
markup alone does not show.

## Locality, work and CPU

### Locality (`./rr check`, prototype track, enforced)

As CLAUDE.md fixes it: the calls of one local action may grow at most 8× when **N** grows 16×
(N = 16 → 256 from `quickCheckSize`), **with `--rows` fixed** at the quick-check options' 40.
The work actions (`harness/work/big-table.js`) run on t1 to t4, each filled by an untimed setup
create; every other table keeps its 3-5 initial rows.

- **Local** (one table): every user action and every `serverRows`, `serverUpdate` and
  `serverDelete`, including `create`, `clear`, `sort` and `updateEvery`. These may cost work
  proportional to the **table's** rows, but the table does not grow with N, so their cost must
  stay flat as tables are added. `updateEvery` touches every k-th row by nature: it is local to
  its table, and data-proportional within it.
- **Global:** `snapshot` only (reported, not held to the bound).

### Work against rows (`./rr work … --rows`, reported, not enforced)

The second axis: the same actions at a fixed N, `--rows 1000` against `--rows 10000`
(`./rr work big-table <fw> --sizes 16 --rows 10000`; `--rows` passes through like any scenario
option).

| Action | Expected growth with rows | Why |
|---|---|---|
| select, swap, remove, toggle, bump, `serverUpdate`/`serverDelete` of a few ids | flat in DOM work; an implementation may still search by index | the change is 1-2 rows |
| `updateEvery` | proportional (rows / k) | it touches every k-th row |
| create, append, clear, sort, `serverRows` | proportional | every row |

It is reported for every framework (a virtual-DOM select re-renders every row; Solid's
`createSelector` touches two), and **not enforced**, even on prototypes (decided): an idiomatic
`findIndex` over the rows is O(rows) calls in any approach, vanilla included.

### CPU (`./rr bench`)

The bench runs **one app per framework at N = 1** (`"$bench": { "sizes": [1], "seeds": [1] }`
in `runs.json`, decided), the js-framework-benchmark app, with the default `--rows 1000`. Growth
with N is left to `./rr work`, as in the other scenarios. js-framework-benchmark's nine CPU
benchmarks, as do/undo pairs (`harness/bench/big-table.js`); every action brings t1 to its
starting state with untimed setup steps:

| js-framework-benchmark | Bench action | Halves (timed) | Untimed setup / reset |
|---|---|---|---|
| 01 create rows (1k) | create 1k / clear | `run` on an empty table, then `clear` | setup: `clear` if not empty |
| 02 replace all rows | replace 1k | `run` on 1k rows, repeated on its own | setup: `run` |
| 03 partial update (10k) | update every 10th | `update`, repeated on its own | setup: `runlots`; every 8 reps, `serverRows` of the setup rows puts the labels back |
| 04 select row | select | select row 2, then row 3 | setup: `run` |
| 05 swap rows | swap / swap back | `swaprows`, `swaprows` | setup: `run` |
| 06 remove row | remove | remove the 4th row, repeated on its own | setup: `run`; reset: `serverRows` of the setup rows when the table falls below 95% of them |
| 07 create many rows | create 10k / clear 10k | `runlots` on an empty table, then `clear` (this half is **09 clear rows**) | setup: `clear` if not empty |
| 08 append to large table | append 1k | `add` on 10k rows | setup: `runlots`; reset after every rep: `serverRows` of the setup rows |
| 09 clear rows (10k) | (in 07) | | |

Plus, for the contract's own events: `serverUpdate` of 10 rows and back (the same ids, their old
values), and `snapshot` A/B (global). The CPU card can then show js-framework-benchmark's
**weighted geometric mean** over the nine, computed from our `script` medians with their
weights, beside the official figure. Our method differs (unthrottled `script`, reps on one page,
no CSS, so no layout of a styled table), so it is the **order and the ratios to vanillajs** that
calibrate, not the milliseconds.

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
| `--rows` | 1000 | the row count of every `create` and `append` (table 1's `runlots` makes 10×), at least 4; data, not size |

`quickCheckSize = 16` (the locality check then runs 16 → 256), `steadyFrom = 4`, and
`quickCheckOptions = { rows: 40 }`: `./rr check` (its script check and its locality build) uses
the scenario's quick-check options unless the flags say otherwise, so the script's `runlots`
compares 400 rows, not 10,000, against the reference; the code is the same. `./rr serve` and the
hub use the default 1,000 rows (`--rows 40` for a lighter page).
Each framework's emitter may take its own style parameters; it records which it used and runs in
its documented idiomatic style by default.

## A worked example

`--size 2 --seed 1 --rows 4`, from the generator. Table 1's description (its pools are
js-framework-benchmark's three lists):

```json
{ "id": "t1", "token": "amgi", "title": "Rows amgi", "thead": false, "rng": 91397855, "initialRows": 0,
  "marker": { "attr": "class", "value": "danger" },
  "columns": [
    { "kind": "id", "name": "id", "header": "" },
    { "kind": "label", "name": "label", "header": "", "pools": ["JFB_ADJECTIVES", "JFB_COLOURS", "JFB_NOUNS"], "select": "select" },
    { "kind": "remove", "role": "remove", "header": "", "element": "a", "text": "×", "glyph": true },
    { "kind": "spacer", "header": "" } ],
  "ops": [
    { "kind": "create", "name": "run", "count": 4, "text": "Create 4 rows" },
    { "kind": "create", "name": "runlots", "count": 40, "text": "Create 40 rows" },
    { "kind": "append", "name": "add", "count": 4, "text": "Append 4 rows" },
    { "kind": "updateEvery", "name": "update", "k": 10, "column": "label", "suffix": " !!!", "text": "Update every 10th row" },
    { "kind": "clear", "name": "clear", "text": "Clear" },
    { "kind": "swap", "name": "swaprows", "i": 1, "j": 2, "text": "Swap Rows" } ] }
```

Table 2 (forced: a flag with its toggle and `removeChecked`, an ascending sort on a text column, a
descending sort on a date column, `remove`; it drew no id column, no select and no computed
column):

```json
{ "id": "t2", "token": "wukr", "title": "Recipes wukr", "thead": true, "rng": 521195024, "initialRows": 4, "marker": null,
  "columns": [
    { "kind": "text", "name": "carrier", "pool": ["Iris", "Ember", "Ridge", "Fjord", "Nimbus", "Meridian", "Dune"], "header": "Carrier" },
    { "kind": "date", "name": "closed", "format": "mon-d", "header": "Closed" },
    { "kind": "flag", "name": "pinned", "toggle": "markPinned", "header": "Pinned" },
    { "kind": "remove", "role": "drop", "header": "", "element": "button", "text": "Delete" } ],
  "ops": [
    { "kind": "create", "name": "refill", "count": 4, "text": "Refill 4 recipes" },
    { "kind": "sort", "name": "sortByCarrier", "column": "carrier", "dir": "asc", "text": "By carrier ↑" },
    { "kind": "sort", "name": "sortByClosed", "column": "closed", "dir": "desc", "text": "By closed ↓" },
    { "kind": "updateEvery", "name": "postponeEvery12", "k": 12, "column": "closed", "text": "Postpone every 12th", "days": 16 },
    { "kind": "removeChecked", "name": "dropPinned", "column": "pinned", "text": "Drop pinned" } ] }
```

Its initial state, the 4 rows drawn in column order (carrier, closed, pinned) from `rng`
521195024:

```json
{ "rows": [
    { "id": 1, "carrier": "Fjord", "closed": 354, "pinned": true },
    { "id": 2, "carrier": "Meridian", "closed": 95, "pinned": true },
    { "id": 3, "carrier": "Nimbus", "closed": 189, "pinned": true },
    { "id": 4, "carrier": "Meridian", "closed": 153, "pinned": false } ],
  "selected": null, "nextId": 5, "rng": 295285994 }
```

Table 1 starts empty with `rng` 91397855. After clicking **Create 4 rows** and the label of row
2, its state is

```json
{ "rows": [
    { "id": 1, "label": "odd purple keyboard" },
    { "id": 2, "label": "quaint yellow burger" },
    { "id": 3, "label": "clean pink mouse" },
    { "id": 4, "label": "quaint blue keyboard" } ],
  "selected": 2, "nextId": 5, "rng": 883896246 }
```

and the reference HTML is (indented for reading; whitespace is ignored):

```html
<div data-role="page">
  <section data-key="t1" data-role="table">
    <h2>Rows amgi</h2>
    <div>
      <button data-role="run">Create 4 rows</button>
      <button data-role="runlots">Create 40 rows</button>
      <button data-role="add">Append 4 rows</button>
      <button data-role="update">Update every 10th row</button>
      <button data-role="clear">Clear</button>
      <button data-role="swaprows">Swap Rows</button>
    </div>
    <table><tbody>
      <tr data-key="1" data-role="row"><td>1</td><td><a data-role="select">odd purple keyboard</a></td><td><a data-role="remove"><span aria-hidden="true">×</span></a></td><td></td></tr>
      <tr data-key="2" data-role="row" class="danger"><td>2</td><td><a data-role="select">quaint yellow burger</a></td><td><a data-role="remove"><span aria-hidden="true">×</span></a></td><td></td></tr>
      <tr data-key="3" data-role="row"><td>3</td><td><a data-role="select">clean pink mouse</a></td><td><a data-role="remove"><span aria-hidden="true">×</span></a></td><td></td></tr>
      <tr data-key="4" data-role="row"><td>4</td><td><a data-role="select">quaint blue keyboard</a></td><td><a data-role="remove"><span aria-hidden="true">×</span></a></td><td></td></tr>
    </tbody></table>
  </section>
  <section data-key="t2" data-role="table">
    <h2>Recipes wukr</h2>
    <div>
      <button data-role="refill">Refill 4 recipes</button>
      <button data-role="sortByCarrier">By carrier ↑</button>
      <button data-role="sortByClosed">By closed ↓</button>
      <button data-role="postponeEvery12">Postpone every 12th</button>
      <button data-role="dropPinned">Drop pinned</button>
    </div>
    <table>
      <thead><tr><th>Carrier</th><th>Closed</th><th>Pinned</th><th></th></tr></thead>
      <tbody>
        <tr data-key="1" data-role="row"><td>Fjord</td><td>Dec 20</td><td><input type="checkbox" data-role="markPinned" checked></td><td><button data-role="drop">Delete</button></td></tr>
        <tr data-key="2" data-role="row"><td>Meridian</td><td>Apr 5</td><td><input type="checkbox" data-role="markPinned" checked></td><td><button data-role="drop">Delete</button></td></tr>
        <tr data-key="3" data-role="row"><td>Nimbus</td><td>Jul 8</td><td><input type="checkbox" data-role="markPinned" checked></td><td><button data-role="drop">Delete</button></td></tr>
        <tr data-key="4" data-role="row"><td>Meridian</td><td>Jun 2</td><td><input type="checkbox" data-role="markPinned"></td><td><button data-role="drop">Delete</button></td></tr>
      </tbody>
    </table>
  </section>
</div>
```

Then, in table 1: **Swap Rows** swaps indices 1 and `rows − 2` = 2 (rows 2 and 3 trade places,
both `<tr>`s kept, row 2 still marked); **Update every 10th row** touches index 0 only:
"odd purple keyboard !!!". In table 2: **Refill 4 recipes** replaces the rows with ids 5 to 8
(Fjord Jun 19, Ember Mar 4, Fjord Nov 3, Nimbus Aug 29; 5 and 8 pinned); **By carrier ↑** orders
them 6, 5, 7, 8 (the two Fjords by id); **By closed ↓** orders them 7, 8, 5, 6; **Postpone every
12th** moves row 7 (index 0) by 16 days to Nov 19; **Drop pinned** removes rows 8 and 5, leaving
the `<tr>`s of 7 and 6 in place.

## Decisions

The owner's answers to the questions this contract first left open:

1. **One table style:** every table its own component; no `--tables shared` parameter.
2. **Bench at N = 1 only**, the calibration point: `runs.json`'s `"$bench"` is sizes `[1]`,
   seeds `[1]`.
3. **Rows axis:** reported by `./rr work`, not enforced by the locality check.
4. **`quickCheckOptions`:** a spec export (`{ rows: 40 }`) the harness uses wherever it builds the
   quick-check app (`./rr check` and its locality build); locality compares N at the same small
   row count.
5. **No text inputs.** (A per-table filter box belongs to the "filtering and derived data"
   family, and would make N = 1 differ from js-framework-benchmark.)
6. **The serve page** highlights the selected row in the panel's own stylesheet
   (`harness/serve/panel.css`, not measured), and the panel's comparison treats an empty `class`
   attribute as absent.
