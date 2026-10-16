# Scenario: routed-app

The contract of the `routed-app` scenario. It adds to the global contract in `CLAUDE.md` and never
relaxes it. The generator and the reference are `spec.js`.

## What it models

**An app of pages.** A back office, a SaaS dashboard, a settings area: a shell with a nav bar, one
page shown at a time, tabs whose panels hold real content, modals that open over a page, and
**global state** (the signed-in user, a cart, notifications, a currency, a balance, a connection
flag) that the shell and many pages read and that pages and server pushes write.

Every other scenario mounts everything once and keeps it. Real apps do not: pages, tab panels and
modals **mount and unmount**, and that exposes something the dashboards cannot, **lifetime**
(`notes/2026-10-16-tea-inline-critique.md`, weakness 2 and its scenario 1):

- does an approach **build only what is shown** (the shell and the current page), or everything?
- does it **dispose what it leaves**: nodes, listeners, timers, subscriptions to global state?
- does the work of one event stay proportional to the **shown** UI, or grow with the whole app?

| | `unique-components` | `routed-app` |
|---|---|---|
| the page is | N widgets, all mounted at once | a shell and **one of N pages** |
| one more unit of size is | one more widget component | **one more page: its component, maybe tabs and a modal** |
| state | per widget, plus cross-widget reads | **global** (read across pages) plus **page-local** (lives with the page) |
| what it adds | | **mount and unmount, timers that start and stop, global reads from unmounted code** |

## What "size" means

**Size is the number of pages (routes), N.** Which sizes and seeds are measured is chosen per
framework in `runs.json` at the repository root, not here.

- Each page is its own component, composed at random from the primitives of `unique-components`
  (typed fields, messages made of ops, texts, buttons, inputs, checkboxes, selects, keyed lists,
  conditional sections, groups), plus reads and writes of global state, links to other pages, and
  sometimes tabs and a modal. A page is about the size of two dashboard widgets.
- Data stays small: lists hold a handful of items. More pages means more code, never more data.
- **No two pages of an app have the same structure**, even ignoring every text, number and name
  (the generator checks a structural signature over the page, its tabs and its modal).
- Each page carries a **token**, 4 seeded base-36 characters, in its title (heading, nav, menu)
  and in one caption, so near-twin pages cannot compress away.
- **Prefix-stable:** page i is identical at every N for a seed (it links only to earlier pages).
  The shell's nav bar holds the first four pages, so the shell stops changing from N = 4.
- At N = 256 (seed 1): 29% of pages have tabs (2 to 4), 33% a modal, 6% a time-driven field in
  the page and 7% one in a tab, 8% a feed for `pagePush`; a page reads 2.4 global fields on
  average and holds about 5 fields and 9 messages across its components.

## Each page is its own code (scenario rule)

The rule of `unique-components` applies to every page, tab panel and modal: each one's update
logic, handlers, bindings and derived expressions are emitted as **its own code**, the way a
developer or a compiler would write the component; generic helpers (create an element, a keyed
reconciler, event delegation, a router that switches on the route) and static templates are
allowed; behaviour encoded as data for a generic routine is not. The nav bar's and the menu's
**list of pages** (id and title) is genuine data and may be a table. The reference `update` and
`render` in `spec.js` are interpreters: they are the specification, not a model to copy.

## Routing (decided)

**Routing is in-app state, not the browser's URL.** The current route is a field of the state
(`route`, a page id); links are `<button>`s; nothing reads or writes `location` or `history`. So
every approach routes the same way, the reference stays the single truth, and the serve panel can
drive and compare it. Either form is fine: a route field and a switch on it (`<Show>`/`<Switch>` in
Solid, a `case` in Elm's view, a conditional in JSX), or a lookup of the page component by route
(`<Dynamic>` in Solid), each page a component mounted by it.
An implementation may use its framework's idiomatic router only in a memory mode (no URL, no
history) that renders exactly the same DOM and behaves identically; the emitter records the
choice. Prototypes route with plain in-app state.

## Lifetime (decided)

**Page-local state lives and dies with its page.** A page's fields are initialised when it
mounts (from their `initial` values) and are gone when it unmounts; returning to a page shows its
initial state again. The same holds one level down: a **tab panel's** fields start fresh each time
the tab is selected, and a **modal's** fields each time it opens. **Global state persists** across
navigation.

Why: this is component-local state, the default in every approach (React's `useState`, Solid's
signals created in a component, Vue's `setup`, Elm's SPA pattern where `Page.init` runs on every
route change). It keeps one model, so the reference stays the truth: the reference's state holds
only the current page's local state, and navigation replaces it with the new page's initial
state. And it makes lifetime observable: an approach that keeps hidden pages alive must still
show fresh state when one comes back, and one that leaves a subscription behind when a page
unmounts applies the next push twice when the page mounts again.

What must hold:

- **After navigating away, nothing of the old page remains in the DOM.** The page is
  `<main data-key="{page id}" data-role="page">`, so the old page's keyed elements simply vanish;
  the check's keyed-replacement rule compares only keys that exist both before and after a step, and
  every key under a page starts with the page's id, so a legitimate unmount is never flagged.
- **A page's listeners and timers are disposed with it.** A time-driven field's timer runs only
  while its page (or its tab panel) is mounted. The serve panel checks after every step that no
  more intervals run than the reference's mounted time-driven fields (`maxIntervals`): a timer left
  behind by an unmounted page fails the step.
- **Subscriptions to external events are disposed with their page:** `pagePush` reaches only the
  page shown (below), so a leaked handler shows up as a doubled entry.
- **Nodes that did not change are not replaced:** the shell (`data-key="shell"`), its nav buttons
  and every keyed element of the page shown keep their nodes across navigation, global updates and
  page events.

## Time (decided)

Some pages and tab panels have a **time-driven field**: an int that advances by `by` every
`every` ms, up to its `max`, for as long as its component is mounted. Implementations use **one
`setInterval(…, every)` per mounted time-driven field** (one shared timer for several is allowed),
started when the component mounts and cleared when it unmounts: no `setTimeout` chains, no
`requestAnimationFrame` loops.

On served pages (`./rr serve`, `./rr check`, `./rr work`) intervals run on a **virtual clock**
(`harness/serve/hooks.js`): they are recorded but never fire by themselves. A script step
`{ do: "clock" }`, and the panel's **clock** button, fire every running interval once and apply
the reference message `{ type: "clock" }`, which advances every mounted time-driven field once.
So the reference follows time exactly, and a timer that should have stopped either shows in the
interval count or advances a field twice. On `./rr bench` pages (no hooks) intervals are real;
the bench never times the clock.

## The app

The reference render, from the root:

```html
<div data-role="app">
  <header data-key="shell" data-role="shell">
    <strong>{app name}</strong>
    <nav data-role="nav">
      <button data-key="p1" data-role="navLink" aria-current="page">{p1 title}</button>   <!-- the first 4 pages -->
      …
      <button data-role="menu" aria-expanded="false">All pages</button>
    </nav>
    <p><span data-role="user">Signed in as {user}</span> · <span data-role="cartCount">Cart: {n}</span> · <span data-role="noticeCount">{n} notices</span></p>
  </header>
  <nav data-role="menuList">                                   <!-- only while the menu is open -->
    <button data-key="p1" data-role="menuLink">{title}</button>  <!-- every page -->
  </nav>
  <main data-key="{route}" data-role="page">
    <h1>{title}</h1>
    …the page's view…
    <aside data-key="modal" data-role="dialog"><h2>{modal title}</h2>…modal view…</aside>  <!-- only while open -->
  </main>
</div>
```

- `aria-current="page"` is on the nav button of the current route only (absent elsewhere).
- The shell reads `user`, `cart` (its length) and `notices` (its length), and nothing else.
- The "All pages" menu is the only place that lists every page. It is built when opened and
  removed when closed (and on any navigation), so it is the one part of the UI that is O(N).
- The modal is the last child of the page's `<main>` (no portal), so it leaves with its page.

## The component vocabulary

A page is plain data: `{ id, token, title, fields, messages, view, tabs?, modal? }`. Its tabs are
`[{ id: "t1", label, fields, messages, view }]` and its modal `{ title, fields, messages, view }`:
three kinds of **component**, each with its own fields, messages and view. Message names are
unique within a page, across its tabs and modal; field names are unique within a page and never a
global field's name.

### References

Every field reference, in expressions, messages and ops, is a **ref**:

| Ref | Means |
|---|---|
| `["f", name]` | a field of the component itself (the page, the tab panel or the modal) |
| `["p", name]` | a field of the page, read from one of its tabs or written from its modal's confirm |
| `["g", name]` | a global field |

### Fields

As in `unique-components` (`int`, `bool`, `text`, `enum`, `list`, with `min`/`max`/`initial`,
`options`, `checkable`, `feed`), except that the time-driven int is now
`{ type: "int", min: 0, max, initial, every, by }` (no gate: it runs while mounted). At most one
time-driven field per component, only in a page or a tab, never in the first page. A page has at
most one `feed` list (the target of `pagePush`); tabs and modals have none. Modals hold no lists.

### Global state

| Field | Type | Initial | Read by | Written by |
|---|---|---|---|---|
| `user` | text | `"Ada"` | the shell; pages (greetings, its length) | a "Display name" input or a "Browse as Guest" button on some pages; `serverSet`; `snapshot` |
| `cart` | list `{ id, text }` | 2 items | the shell (count); pages (count, a list with remove) | "Add {product}" buttons, item remove, "Empty the cart"; modal confirms; `snapshot` |
| `notices` | list `{ id, text }` | 2 items | the shell (count); pages (count, a list with dismiss) | dismiss, "Mark all read"; `notify`; `snapshot` |
| `currency` | enum `EUR`/`USD`/`GBP`/`JPY` | `"EUR"` | pages only | a select or a "Switch currency" button on some pages; `serverSet`; `snapshot` |
| `balance` | int 0 to 9999 | `120` | pages only | "Spend k"/"Top up k" buttons (disabled when they cannot apply); modal confirms; `serverSet`; `snapshot` |
| `online` | bool | `true` | pages only (a text, or an "offline" section) | `serverSet`; `snapshot` |

### Messages

Every page message is `{ page, type: <message name>, …payload }`. The kinds of
`unique-components` (`click` with `ops`, `input`, `check`, `select`, `item`), with a ref in
`field`, plus:

| `kind` | Where | Effect |
|---|---|---|
| `open` | page | open the modal, its fields at their `initial` values |
| `close` | modal | close the modal (its state is dropped) |
| `confirm` | modal | apply `ops` in order (they may read the modal's fields and write the page's fields or global state), then close |

Selecting a tab is the message `{ page, type: "tab", tab }`: if it is not the active tab, its panel
mounts with fresh state.

### Ops

Those of `unique-components` with a ref as target (`["add", ref, k]`, `["set", ref, c]`,
`["toggle", ref]`, `["reset", ref]`, `["cycle", ref]`, `["push", listRef, draftRef]`,
`["pushText", listRef, text]`, `["pop", …]`, `["shift", …]`, `["clear", …]`, `["clearDone", …]`),
plus `["copy", ref, fromRef]`: set a field to another field's value (a modal's text or bool into
the page's field of the same type). `reset` targets only the component's own fields.

### Expressions

Those of `unique-components`, with refs instead of `["f", …]`/`["w", …]`.

### View nodes

Those of `unique-components` (`text`, `button`, `input`, `check`, `select`, `list`, `when`,
`group`), with a list item's `data-role` being `{list field name}Item` (so `cartItem` and
`noticesItem` for the global lists), plus:

| Node | Renders |
|---|---|
| `{ el: "link", to, text }` | `<button data-key="{to}" data-role="pageLink">{text}</button>`; a click navigates to `to` (always an earlier page) |
| `{ el: "open", msg, text }` | `<button data-role="{msg}">{text}</button>`; a click opens the modal |
| `{ el: "tabs" }` | `<nav data-role="tabs">` with one `<button data-key="{tab id}" data-role="tab" aria-selected="true\|false">{label}</button>` per tab, then `<section data-key="{active tab id}" data-role="panel">…its view…</section>` |

`link` and `open` take a plain string `text`; a `button`'s `text` is a list of parts.

### How pages vary

Each page draws, from the seed: 1 to 4 fields of its own (and their controls, displays, derived
texts, combined messages, as in `unique-components`); 1 to 3 global fields it reads, each with a
display and, about half the time, a control that writes it; 0 to 2 links to earlier pages; tabs
(30%), each panel 1 to 3 fields, sometimes a display of a page field (`["p", …]`) or of a global;
a modal (35%), a small form with a confirm that pushes into a page list, copies into a page field,
or writes global state; 0 to 2 conditional sections (over its fields or a global); grouping;
the order of everything. Labels come from word pools; each page adds its token.

### The first pages

So the work actions find the same targets at every size, the first five pages each carry one
capability on top of their random composition, never inside a conditional section:

| Page | Always has |
|---|---|
| p1 (the first route) | an int with an "add k" button (never disabled) and a reset button; a text input; a display of `balance`. It never reads or writes `currency`, and has no tabs, modal or time-driven field |
| p2 | an "Add {product}" button (writes `cart`, which the shell reads) and a feed list with dismiss |
| p3 | tabs (2 to 4) |
| p4 | a time-driven field in the page itself |
| p5 | a modal with a text input and a confirm |

## State and messages

- **State:** `{ route, menu, global, page }`, where `page` is the current page's local state:
  `{ fields, tab, panel, modal }` (its own fields; the active tab id and that panel's fields, or
  `null`s; the open modal's fields, or `null`).
- **User messages** come from DOM events: page messages as above, and the shell's
  `{ type: "navigate", route }` (nav bar, menu, page links) and `{ type: "menu" }` (open or close the
  menu). Navigating closes the menu; navigating to the current route changes nothing else.
- **External events (through `dispatch(msg)`):**
  - `{ type: "deepLink", route }`: open a route from outside (a notification, the OS); the same
    effect as `navigate`;
  - `{ type: "serverSet", field, value }`: the server's new value of `user`, `currency`, `balance`
    or `online`;
  - `{ type: "notify", item }`: append `item` (`{ id, text }`) to `notices`;
  - `{ type: "pagePush", page, item }`: append `item` to that page's feed list **if that page is
    shown**; otherwise nothing happens (the page's subscription does not exist while it is
    unmounted);
  - `{ type: "snapshot", global }`: a whole new global state (a re-sync): every scalar changes
    (`online` flips at random), `cart` and `notices` keep their ids but are partly reordered, each
    with one new item. Page-local state is not part of a server snapshot: it is component state.
- **Time:** `{ type: "clock" }`, never dispatched: it stands for one tick of every running interval
  (see "Time").
- **The reference `update`** applies exactly these rules; `render` produces exactly the HTML above.

## Selectors

- The shell: `[data-key="shell"]`; a nav button `[data-role="navLink"][data-key="p3"]`; the menu
  button `[data-role="menu"]`; a menu entry `[data-role="menuLink"][data-key="p3"]`.
- A page: `[data-key="p3"][data-role="page"]`. A control: `[data-key="p3"][data-role="page"]
  [data-role="{message name}"]`. An item control: `… [data-key="{item id}"] [data-role="{message
  name}"]`. A link: `… [data-role="pageLink"][data-key="p1"]`. A tab: `… [data-role="tab"][data-key="t2"]`;
  its panel `[data-role="panel"][data-key="t2"]`; the modal `[data-key="modal"][data-role="dialog"]`.
- A validation error: `data-role="{message name}Error"`.

## The interaction script

Generated from the app, the same for every framework:

1. mount (on p1), then a clock tick with nothing running;
2. for each page in order: navigate to it, by its nav button (pinned pages), a link on the current
   page, the menu (open it, pick the page) or a deep link; exercise its messages (inputs typed
   character by character, number inputs with two invalid values first, then selects, checkboxes,
   buttons, item controls, with a second pass for controls a conditional section hid); two clock
   ticks if it has a time-driven field; each tab in turn (selected, exercised, two clock ticks if
   time-driven), then the first tab again (fresh state); the modal opened, exercised, confirmed
   (or closed if confirm is disabled), opened again (fresh state) and closed; external events
   while it is shown (sometimes a `serverSet` or a `notify`, a `pagePush` to it if it has a feed,
   sometimes a `pagePush` to a page not shown); sometimes the menu opened and closed, and
   sometimes a link back to an earlier page (its initial state);
3. a `snapshot` of the global state;
4. back to p1 and a final round on it;
5. the first page with a time-driven field by deep link, a clock tick, back to p1, and a clock
   tick with nothing running;
6. dispose.

About 25 steps per page (406 at N = 16, 1,573 at N = 64, 5,426 at N = 256 for seed 1). A step is
only generated when its control is rendered and enabled in the reference at that moment.

## Scenario-specific expectations

On top of the global contract and "Lifetime" above:

- **Keyed lists** keep their nodes across pushes, removes, toggles and the snapshot reorder,
  including the global lists shown on a page.
- **Focus and caret:** every input keeps focus and caret while typed into, including the global
  "Display name" input, whose value the shell also shows.
- **Global reads:** after any change to a global field, the shell and the page shown are correct;
  nodes that do not read it keep their nodes.
- **Number inputs and disabled buttons:** as in `unique-components`.

## Locality, work and CPU

### Locality (`./rr check`, prototype track, enforced)

As CLAUDE.md fixes it: the calls of one local action may grow at most 8× when N grows 16×
(N = 16 → 256). The work actions (`harness/work/routed-app.js`) run on p1 to p5 (prefix-stable, so
the same pages at both sizes):

- **Local**, everything that touches the shell and one page: page events; external events while
  p1 is shown (`serverSet currency`, which neither the shell nor p1 reads, must cost almost
  nothing; `serverSet balance`, which p1 reads, must update it; `notify`, which the shell reads;
  a `pagePush` to a page not shown, which must cost nothing); navigation (p1 → p2 → p3 → p4 → p5
  → p1: unmounting one page and mounting another); a tab switch and back; a clock tick on p4; the
  modal opened, typed into and closed; the global `snapshot` (only the shell and the page shown
  read it); and the **app's own dispose and mount** (only the shell and p1 may be built).
- **Global:** opening and closing the "All pages" menu, which lists every page.

An approach that builds every page at mount, or keeps hidden pages' bindings subscribed to
global state, fails the bound here: its mount grows with N, and so does a global write that only
hidden pages read.

### Harness support (added with this scenario)

- `./rr work` performs `clock`, `dispose` and `mount` steps (`harness/work.js`), so a timer tick,
  the app's dispose and its mount are counted like any other action.
- Served pages run intervals on the virtual clock, and the panel and `./rr check` fail a step that
  leaves more intervals running than the spec's `maxIntervals(spec, state)` allows (a generic hook:
  any scenario may export it). Problems of this kind are reported per step (`problems`).

### CPU (`./rr bench`)

One app per framework at **N = 64** (`"$bench": { "sizes": [64], "seeds": [1] }` in `runs.json`),
with the work actions made repeatable (`harness/bench/routed-app.js`): add to an int (reset by
p1's reset button before the max), type a character and delete it, `serverSet` to another value
and back (currency, balance), `notify` and "add to cart" (the list put back by an untimed
snapshot every 8 reps), a `pagePush` to a page not shown, a `pagePush` to p2 then dismissing it,
navigation there and back (p1 ↔ p2, and p3 ↔ p4, which starts and stops p4's timer), a tab and
back, the modal opened and closed, typing in the modal, the menu opened and closed (global), and
global snapshots A and B. Every action reaches its page with an untimed deep link. The clock is
not timed (bench pages have real intervals), and mount is timed by the bench's startup loads.

## A worked example

Page `p4` of `--size 64 --seed 1` (forced to have a time-driven field):

```json
{ "id": "p4", "token": "9im0", "title": "Garden overview 9im0",
  "fields": [
    { "name": "age", "type": "int", "min": 0, "max": 206, "initial": 4, "every": 1000, "by": 5 },
    { "name": "level", "type": "int", "min": 0, "max": 19, "initial": 7 },
    { "name": "tone", "type": "enum", "options": ["Basic", "Standard", "Premium"], "initial": "Standard" },
    { "name": "tier", "type": "enum", "options": ["Email", "Phone", "Letter"], "initial": "Phone" } ],
  "messages": [
    { "name": "resetLevel", "kind": "click", "ops": [["reset", ["f", "level"]]] },
    { "name": "selectTone", "kind": "select", "field": ["f", "tone"] },
    { "name": "nextTier", "kind": "click", "ops": [["cycle", ["f", "tier"]]] },
    { "name": "rename", "kind": "input", "field": ["g", "user"] },
    { "name": "openNote", "kind": "open" } ],
  "view": [
    { "el": "text", "tag": "output", "parts": [["f", "age"]] },
    { "el": "text", "tag": "output", "parts": [["f", "level"]] },
    { "el": "button", "msg": "resetLevel", "text": ["Restore"] },
    { "el": "select", "msg": "selectTone" },
    { "el": "text", "tag": "span", "parts": [["if", ["!=", ["f", "tier"], ["k", "Phone"]], ["k", "changed"], ["k", "as planned"]]] },
    { "el": "open", "msg": "openNote", "text": "Add note" },
    { "el": "button", "msg": "nextTier", "text": ["Tier: ", ["f", "tier"]] },
    { "el": "text", "tag": "strong", "parts": [["f", "tier"]] },
    { "el": "group", "tag": "footer", "children": [
      { "el": "link", "to": "p1", "text": "See Personal analytics 8pu5" },
      { "el": "link", "to": "p2", "text": "See Sales archive 8pqz" } ] },
    { "el": "text", "tag": "p", "parts": ["Hello, ", ["g", "user"]] },
    { "el": "input", "msg": "rename", "label": "Name", "invalid": { "when": ["==", ["len", ["g", "user"]], ["k", 0]], "message": "A name is required" } },
    { "el": "text", "tag": "small", "parts": ["Desk 9im0"] },
    { "el": "text", "tag": "p", "parts": ["Gap: ", ["-", ["f", "age"], ["f", "level"]]] } ],
  "modal": { "title": "Confirm note",
    "fields": [
      { "name": "note", "type": "text", "initial": "" },
      { "name": "theme", "type": "enum", "options": ["Sunny", "Cloudy", "Rainy", "Windy", "Snowy"], "initial": "Snowy" } ],
    "messages": [
      { "name": "writeNote", "kind": "input", "field": ["f", "note"] },
      { "name": "cycleTheme", "kind": "click", "ops": [["cycle", ["f", "theme"]]] },
      { "name": "saveNote", "kind": "confirm", "ops": [["add", ["g", "balance"], -20]] },
      { "name": "closeNote", "kind": "close" } ],
    "view": [
      { "el": "input", "msg": "writeNote", "label": "Note", "placeholder": "Type here" },
      { "el": "text", "tag": "output", "parts": [["f", "note"]] },
      { "el": "button", "msg": "cycleTheme", "text": ["Rotate"] },
      { "el": "text", "tag": "p", "parts": ["Theme: ", ["f", "theme"]] },
      { "el": "group", "tag": "footer", "children": [
        { "el": "button", "msg": "closeNote", "text": ["Close"] },
        { "el": "button", "msg": "saveNote", "text": ["Submit"], "disabled": ["<", ["g", "balance"], ["k", 20]] } ] } ] } }
```

Its page when it mounts, with the modal open (indented for reading; whitespace is ignored):

```html
<main data-key="p4" data-role="page">
  <h1>Garden overview 9im0</h1>
  <output>4</output>
  <output>7</output>
  <button data-role="resetLevel">Restore</button>
  <select data-role="selectTone"><option value="Basic">Basic</option><option value="Standard" selected>Standard</option><option value="Premium">Premium</option></select>
  <span>as planned</span>
  <button data-role="openNote">Add note</button>
  <button data-role="nextTier">Tier: Phone</button>
  <strong>Phone</strong>
  <footer>
    <button data-key="p1" data-role="pageLink">See Personal analytics 8pu5</button>
    <button data-key="p2" data-role="pageLink">See Sales archive 8pqz</button>
  </footer>
  <p>Hello, Ada</p>
  <label>Name<input type="text" data-role="rename" value="Ada"></label>
  <small>Desk 9im0</small>
  <p>Gap: -3</p>
  <aside data-key="modal" data-role="dialog">
    <h2>Confirm note</h2>
    <label>Note<input type="text" data-role="writeNote" placeholder="Type here" value=""></label>
    <output></output>
    <button data-role="cycleTheme">Rotate</button>
    <p>Theme: Snowy</p>
    <footer><button data-role="closeNote">Close</button><button data-role="saveNote">Submit</button></footer>
  </aside>
</main>
```

While p4 is shown, one interval runs (every 1,000 ms): each tick adds 5 to `age` (the first
`<output>` and "Gap"). Typing into "Name" updates "Hello, …" and the shell's "Signed in as …".
"Submit" takes 20 from `balance` and closes the modal; opening it again shows an empty note and
"Snowy". Navigating away removes the `<main>`, stops the interval, and drops every field of p4;
coming back shows `age` 4 and `level` 7 again.

## Parameters

| Parameter | Default | Meaning |
|---|---|---|
| `--size` | 16 | N, the number of pages |
| `--seed` | 1 | the random seed |

`./rr check` builds N = 16 by default (`quickCheckSize`), which also starts the locality check
(16 to 256). The work actions need N ≥ 5. Each framework's emitter may take its own style
parameters; it records which it used, and runs in its documented idiomatic style by default.

## Not in this scenario

No CSS. No network: all data is generated or arrives through `dispatch`. No browser URL or
history (see "Routing"). No code splitting or lazy-loaded routes: CLAUDE.md measures one bundle
per app; a lazy-route variant (a chunk per page, its bytes reported separately) is a possible
later option. No portals: the modal is inside its page.

## Decisions

Made while writing this contract, for the owner to confirm or overturn:

1. **Routing is in-app state** (buttons, a `route` field); a framework router only in a memory
   mode with identical DOM and behaviour; prototypes use plain state.
2. **Page-local state resets on remount** (and so do tab panels and modals); global state
   persists. The reference holds only the current page's local state.
3. **Time is a real `setInterval` per mounted time-driven field**, driven on served pages by a
   virtual clock (`hooks.js`), checked by `maxIntervals`. (The other scenarios forbid timers, so
   none of their apps is affected.)
4. **The nav bar holds the first four pages**; every page is in an "All pages" menu built only
   while open. A nav bar of all N pages would make the shell, and so every mount, O(N) by design,
   and the locality bound could not tell "builds hidden pages" from "renders a long nav".
5. **`pagePush` to a page not shown is dropped**, not queued: subscriptions live with their page.
6. **`snapshot` replaces global state only**; page-local state is component state, not a server
   snapshot.
7. **The menu is the only global action** for the locality check; the global snapshot is local
   (only the shell and the page shown read it).
8. **Bench at N = 64**, as the dashboards.
