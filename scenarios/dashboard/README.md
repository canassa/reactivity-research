# Scenario: dashboard

The contract of the `dashboard` scenario. It adds to the global contract in `CLAUDE.md` and never
relaxes it.

## What it models

**An app that grows by adding features.** A dashboard is a page of independent widgets (a
counter, a form field, a small list, tabs, a summary…), each with its own state, events and update
logic, plus a few widgets that read the state of others. That is how most real apps grow: not
more data, but more different pieces of UI.

It measures what each approach costs at the start (**baseline**) and what each added feature costs
(**slope**): per-component scaffolding, update wiring per feature, and how much runtime a new kind
of feature pulls in.

## What "size" means

**Size is the number of widgets, N.** Sizes: **1, 2, 4, 8, 16, 32, 64**. Seeds: **1, 2, 3** per size.

- The amount of data stays small. Lists inside widgets hold a handful of items, because more
  data would not change the shipped code.
- **No two widgets are identical**, even of the same kind (see *How instances vary*). Growing
  must add real code, never a copy that brotli would erase.
- From N = 16 upwards, every widget kind in the catalogue appears at least once.

## The widget catalogue

Each widget is a `<section data-key="w{i}" data-role="widget-{kind}">` with a heading
(`<h2>`, its label) and the content below. Every interactive element carries a `data-role`.

| Kind | State | Messages (user) | Renders |
|---|---|---|---|
| `counter` | `value: number` | `inc`, `dec`, `reset` | the value; buttons `inc`, `dec`, `reset`; `dec`/`inc` disabled at the limits |
| `toggles` | `on: boolean[]` | `toggle(i)` | k checkboxes with labels; a line "n of k on" |
| `field` | `text: string` | `edit(text)` | a text input; an error message when the text breaks the rule, else none |
| `todo` | `items: {id, text, done}[]`, `draft: string` | `editDraft`, `add`, `toggle(id)`, `remove(id)` | an input and an `add` button; a keyed list (`data-key` = item id) with checkbox, text, `remove`; "n left" |
| `tabs` | `active: number` | `select(i)` | k tab buttons (the active one marked with `aria-selected="true"`) and the active tab's content |
| `panel` | `open: boolean` | `toggle` | a button; the body only when open |
| `choice` | `option: string`, `extra: string` | `choose(o)`, `editExtra(t)` | a select; a dependent text input shown only for some options |
| `amount` | `value: number` | `set(n)` | a number input; the value formatted (currency, percent or unit, per instance) |
| `filter` | `query: string` | `edit(q)` | an input; a fixed keyed list showing only the items that match; "n matches" |
| `rating` | `stars: number` | `rate(n)` | k star buttons, those ≤ stars marked; a label for the rating |
| `feed` | `entries: {id, text}[]` | `dismiss(id)` | a keyed list of entries with `dismiss`; "no news" when empty. Entries arrive by `dispatch` |
| `clock` | `seconds: number`, `running: boolean` | `start`, `stop`, `reset` | the time as `m:ss`; buttons. Time advances only by `dispatch` (`tick`) |
| `summary` | none of its own | none | a derived line computed from 2–3 earlier widgets (for example "total = counter w1 + amount w5; 3 todos left") |

## How instances vary

Every instance draws its own parameters from the seed:
- its **label**;
- its **sizes** (number of toggles, tabs, stars, initial list items, from 2 to 6);
- its **texts** (option labels, item texts, tab contents);
- its **rules**:
  - `counter`: step and limits;
  - `field`: required, minimum length or a pattern, with its own error message;
  - `choice`: which options show the extra input;
  - `amount`: the format;
  - `filter`: the item set;
- for `summary`: **which widgets it reads** (chosen among the earlier widgets of suitable kinds),
  and the formula.

The generator chooses kinds with a seeded random order that cycles through the catalogue, so each
size has a varied mix. The same seed and N always give the same app (byte-identical spec).

## State and messages

- **State:** `{ widgets: { [id]: widgetState } }`: plain data, one entry per widget except
  `summary`, which derives its line from others.
- **User messages:** `{ widget: id, type, …payload }`, produced by DOM events on the widget's
  elements.
- **External events (through `dispatch(msg)`):**
  - `serverSet`: replace one widget's state (for example set a counter's value, or a todo list's
    items);
  - `tick`: advance every running `clock` by one second;
  - `notify`: append an entry to a `feed`;
  - `snapshot`: a whole new state for the dashboard: every widget's state replaced at once,
    keeping the widget ids, with keyed lists partly reordered.
- **The reference `update`** applies exactly the rules in the catalogue table. Limits clamp,
  `add` ignores an empty draft and clears it, filtering is case-insensitive substring matching,
  and `summary` recomputes whenever a widget it reads changes.

Implementations must not use timers of their own: time only moves through `tick`.

## The interaction script

Generated from the app, the same for every framework:
1. mount;
2. for each widget, 2–4 user actions that exercise its messages, including typing character by
   character into every text input;
3. external events: a `serverSet` on a few widgets, 3 `tick`s, 2 `notify`s;
4. a reorder through `snapshot`;
5. a final round of user actions on widgets the snapshot changed;
6. dispose.

Every step must leave the page as the global contract requires; the owner verifies it by hand
through `./rr serve`.

## Scenario-specific expectations

On top of the global contract:
- **Keyed lists** (`todo`, `filter`, `feed`): items keep their DOM node across adds, removes,
  filtering and the snapshot reorder.
- **Focus and caret:** while typing into a `field`, `todo` draft, `choice` extra input,
  `amount` or `filter` input, the input keeps focus and caret, even when the widget re-renders
  (an error message appearing, the list filtering).
- **Cross-widget updates:** after any message to a widget a `summary` reads, that summary's text
  is correct, and widgets that did not change keep their nodes.
- **Conditional content:** `panel` bodies, `choice` extra inputs and `field` errors appear and
  disappear without replacing their siblings.

## Parameters

| Parameter | Default | Meaning |
|---|---|---|
| `--size` | 16 | N, the number of widgets |
| `--seed` | 1 | the random seed |
| `--kinds` | all | restrict the catalogue (for example `counter,todo,summary`) |
| `--summaries` | 1 per 8 widgets | how many `summary` widgets, and so how much cross-widget state |

Each framework's emitter may also take its own style parameters (for example one component per
widget kind or one per instance, store or local state). It records which it used, and runs in its
documented idiomatic style by default.

## Not in this scenario

No CSS: the page ships HTML and JavaScript only, unstyled. No network: all data is generated or
arrives through `dispatch`. No routing: one page.
