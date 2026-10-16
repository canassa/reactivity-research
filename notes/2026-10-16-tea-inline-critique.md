# 2026-10-16: tea-inline, an adversarial review

A critical review of the tea-inline prototype: how it works, what our benchmarks do not show, and
scenarios that would test the claim that it is the leading approach (best bytes and CPU, passes
locality everywhere). Every point is marked **verified** (by reading the code or by a small
experiment, with numbers) or **predicted**. Read at commit `69f0555`. Experiments used the repo's
own emitters, runtime and Chrome driver (`harness/chrome.js`), Solid 1.9.17, Node 26.11.1 and
headless Chrome. The scratch scripts were not committed.

## Answer first: the five most important hidden weaknesses

1. **The compiler does not exist, and the emitter's analysis is easy only because the input is a
   closed IR.** The "compiler" pattern-matches the spec's expression and op vocabulary
   (`["f", x]`, `["w", id, x]`, `add/set/toggle/cycle/push/...`), so each binding's read set is
   just the syntax of its expression, and each arm's write set is the list of its ops
   (`scenarios/unique-components/tea-inline.js:99-119, 219-222`). Real TEA or TS code has helper
   functions, `viewHeader model`, `List.map` with `if item.id == id`, nested record updates,
   dynamic keys and aliasing. When the analysis can't see through one of these, the only safe
   fallback is "this binding reads everything" or "this arm writes everything", which is what
   digest and tea-local do, and they fail locality on big-component. Svelte 3 and 4 shipped this
   design (compile-time dependency analysis with dirty bits) and Svelte 5 replaced it with runtime
   signals, mainly because dependencies inside functions and across modules were invisible.
   tea-inline's numbers are the output of an *ideal* compiler for an *easy* language, set against a
   real framework that pays for generality. *(Verified for the emitter; the generality cost is
   predicted.)*
2. **There is no notion of dynamic lifetime: no ownership, no disposal, no lazy subtrees.**
   Subscriptions are append-only arrays (`G[i].push`, `R[src][k].push`, `readers[src].push`), and
   nothing ever removes one. Conditional content is built at mount and stays subscribed while
   hidden (`when` only swaps the node out: `runtime.js:72-75`; README: "Nothing is built lazily").
   This works only because every component in our scenarios is mounted exactly once. Measured
   (synthetic spec through the real emitters, 16 readers widgets whose texts sit in a hidden
   `when`): one click on a source field costs tea-inline 16 → 56 → 116 calls as the hidden texts
   grow 64 → 256 → 1,024, while Solid stays at 56 (`<Show>` creates nothing while hidden). Mount
   goes 346 → 730 → 2,266 calls for tea-inline against a flat 1,862 for Solid. At 1,024 hidden
   bindings tea-inline does more work than Solid both at mount and per event. Routes, tabs with
   real content, modals and recursive trees all need lazy creation plus cleanup, which is new
   runtime that we haven't measured. *(Verified.)*
3. **The keyed reconcile is O(n) DOM moves for an ordinary move.** The forward pass
   (`runtime.js:109-110`, `rows.js:69-70`) moves every row when the first item goes to the end.
   Measured on 10,000 rows: **9,999 `insertBefore` calls against 2 for Solid's `reconcileArrays`**.
   That costs 17–21 ms of script and 110–165 ms of layout, against 0.5–3 ms and 11–18 ms. A swap
   that arrives as a replaced array (from a server push or a snapshot) costs about 1,000 moves:
   2–3.5 ms against 0.1–0.4 ms. The benches never show this, because big-table's swap is an
   in-place op with its own `swap` edit. The README admits "the worst case is a rotation", but
   "move to the end" is a common operation (drag reordering, most-recent-last, a server re-sort).
   Part of the baseline lead comes from here: the README puts Solid 2's reconciler at about 500 B
   brotli more. *(Verified.)*
4. **Bytes grow with dependency edges, and our scenarios have few of them.** tea-inline spells
   every read twice: once in the expression and once in a registration (`R[1][14].push(G[1]);`).
   It also spells the group of every written field in each action. Solid spells a read once and
   tracks it at runtime. The test used a synthetic spec through both real emitters: 256 texts
   reading `r` random fields of a 16-field source. tea-inline's app code costs **2.4 B brotli per
   extra read edge, against 1.1 B for Solid** (30.9 against 8.1 B raw). Its app code is already
   bigger than Solid's from about 4 reads per binding (6,452 against 5,506 B at r = 4, and 11,065
   against 7,439 B at r = 12). The total gap shrinks from 5.6 KB to 1.8 KB and crosses, by
   extrapolation, near r ≈ 17. Our generators cap readers at 6–8 per field and most bindings read
   one field, so the slope lead depends on sparse state. *(Verified to r = 12; the crossover is
   predicted.)*
5. **Model mutation in place, with the DOM a microtask behind, breaks correctness.** The
   stale-click bug fixed in big-table is still there in **shared-components, unique-components and
   big-component**: `s.items.splice(s.items.indexOf(item), 1)`
   (`scenarios/shared-components/tea-inline.js:186, 378`, `unique-components/tea-inline.js:256`,
   `big-component/tea-inline.js:243`). Measured: two clicks on one remove button in one task (N=16,
   seed 1). The page then shows rows `2,3,4` with the text "1 of 2 done", while the model has also
   lost item 4. In shared-components the rows are `2,3` but the text says "1 left". Solid shows
   "2 of 3 done" and "2 left", which is correct. A native double-click is safe, because the flush
   runs between tasks. Programmatic clicks, test tools and handlers that fire synthetic events are
   not. The in-place mutation also drops TEA's value semantics (undo history, time travel,
   sharing old models), so a real compiler would need alias analysis to emit it. *(Verified.)*

Next in importance: whole-program numbering rules out code splitting, HMR and third-party
components (§2.6). Derived values have no memo or common-subexpression elimination (§2.2). The
CPU lead on the dashboards is real in script time but tiny in absolute terms (§2.9).

## Part 1: how it works

**What the compiler knows.** Everything, at build time: every component, the fields each binding
reads, the fields each `update` arm writes, every cross-widget read, the page order, and the
element each binding touches. The emitter turns that into plain DOM code with no runtime
dependency tracking.

- **Messages are erased into actions.** Each arm is inlined into the listener of its control. It
  writes the fields in place and schedules the groups of exactly those fields:

  ```js
  on(E[0], () => { s.officeHours = Math.min(35, s.officeHours + 3); schedule(onOfficeHours); });
  ```
  (generated big-component, N=16; emitter `unique-components/tea-inline.js:170-175, 225-244`.)
- **Per-field binding groups.** A binding that reads one field sits inline in that field's group.
  A binding that reads several fields, or another widget, is its own entry `G[n]` and is pushed
  into each group it reads (`unique-components/tea-inline.js:406-430`). A list is the first
  binding of its field's group.
- **`schedule`/flush** (`runtime.js:16-28`): a module-global `Set` and one microtask. Each binding
  runs once per flush and writes the DOM only if the value differs (`text`, `prop`). Bindings never
  write state, so an insertion-ordered flush is glitch-free *today*. That holds only because there
  are no derived nodes.
- **Readers across widgets.** A reader pushes its binding into the source's table by index,
  `R[src][groupIndex].push(G[k])` (`unique-components/tea-inline.js:426-430`). The source widget
  must already be mounted, so the emitter throws if a widget reads one below it (line 428). In
  shared-components a summary pushes into `readers[source]`, per widget rather than per field
  (`shared-components/tea-inline.js:451`). Kinds decide statically which arms schedule their
  readers.
- **The DOM** is one static HTML string per widget, parsed once. Elements are picked by
  document-order index (`E[n]`, `querySelectorAll(":not(h2,label,option)")`,
  `unique-components/tea-inline.js:52-55`).
- **Lists and rows.** `list` (`runtime.js:91-127`) and `rows` (`rows.js:29-108`) key rows by
  `item.id`. A row builder returns `[node, set, mark?]`, and the row's controls carry their arm
  with `item` in a closure. In-place edits schedule `add`, `drop` or `swap`, or a row's `set`.
  Replacing the array reconciles in one forward pass, and in `rows.js` the edits are dropped if the
  array was replaced since. Selection is a special case in the emitter: `s.selected === item.id`
  schedules only the old and the new row's `mark` (`big-table/tea-inline.js:130, 201-209`).
- **External events** stay messages. `receive(msg)` routes `serverSet` and `snapshot` to a
  widget's loader, which runs `Object.assign(s, structuredClone(next))` and schedules *all* the
  widget's bindings (`unique-components/tea-inline.js:61-67`). `tick` and `notify` call the
  widget's own arms. Big-table copies the rows and schedules the list, and every row whose item
  object changed is repainted.

## Part 2: what the benches don't show

### 2.1 Dynamic structure the compiler can't see

- **Conditional subtrees: verified (see weakness 2).** They are built eagerly and stay subscribed
  while hidden. That is cheap to toggle (8 calls against Solid's 158–1,058 to show the block), but
  mount and per-event work grow with hidden content. **Solid is better** once hidden content is
  large or rarely shown.
- **Trees and recursion: predicted, severe.** Eager `when` can't build an unbounded tree. Children
  must be created on expand and destroyed on collapse, and their reads of global state (selection,
  search highlight) need subscriptions that are removed on destroy. None of that exists, so it
  would be new runtime, closer to Solid's owner tree. Solid handles it with `<For>`, `<Show>`,
  recursion and automatic cleanup.
- **Heterogeneous lists and dynamic components: predicted, moderate.** A row builder per item
  type, dispatched on `item.type`, would work. But a change of type needs the row keyed on
  `(id, type)`, and the K candidate components are either all built (eager, every binding live) or
  need lazy mounting (see above). Solid's `<Dynamic>` creates one component at a time.
- **Portals: predicted, minor.** Static markup plus `E[n]` can append a node elsewhere, but its
  lifetime is the owner's problem again (no disposal).
- **Element lookup by position (`E[n]`): verified safe today.** It is safe only because markup is
  static and lists append after the lookup. A component that takes children or slots, or renders
  data-dependent markup, can't be numbered at compile time.

### 2.2 Derived and computed state

- **No memos and no common-subexpression elimination: verified.** Every binding inlines its whole
  expression. In big-component N=16, `s.securityChores.filter((item) => !item.done).length` is
  written and evaluated in 2 bindings, and `displayErrands`'s filter in 2 more. In
  shared-components, `filter` calls `shown()` from both the list and the "n matches" text
  (`shared-components/tea-inline.js:331`), so it filters twice per keystroke. A chain a → b → c is
  inlined into every reader of c: code grows with readers × chain length, and work with readers ×
  cost. **Our Solid emitters don't use `createMemo` either**, so the benches tie. Idiomatic Solid
  would compute it once and, through equality, stop propagation when a derived value doesn't
  change.
- **Adding memos to tea-inline: predicted.** It is feasible statically: the compiler knows the
  graph, so it could topologically order the groups. But with today's insertion-ordered flush, a
  reader that is scheduled directly and again through a memo runs twice, once with a stale value.
  Doing it right adds bytes per derived node and per edge, the same cost as weakness 4. It then
  starts to look like a static signal graph.
- **Derived data over collections.** Toggling one item reruns every reader's O(items) filter. That
  is K × n, against n for a Solid memo. Our lists hold about 5 items, so no bench sees it.

### 2.3 Cross-component data flow

- **Bytes per edge: verified (see weakness 4).** 2.4 B against 1.1 B brotli per read edge.
- **Work per edge: verified to be equal.** One write runs every reader in both approaches (calls
  in the synthetic run: tea-inline 16 or 56, Solid 121 or 381, so tea-inline costs less per
  reader).
- **One value read by thousands of bindings (a locale, currency or theme read by every row):
  predicted.** Rows have no way to unsubscribe, so the compiler would either emit "repaint every
  row" (the whole-row `set`: O(rows × columns)) or add per-row registration with removal on
  `drop` (new runtime). Solid reruns one effect per row (O(rows)), one cell each. DOM writes are
  equal, because `text` compares first.
- **Readers must sit above their source: verified constraint.** The emitter throws
  (`unique-components/tea-inline.js:428`), and the generators only produce backward reads. A
  two-phase mount would fix it cheaply, but that path is untested.
- **Context and global stores:** the same as cross reads: a global table indexed by compile-time
  numbers.

### 2.4 Fine-grained updates inside collections

- **One property of one item among 10,000: verified, O(1) calls.** But the work actions lean on
  `find` and `findIndex`, which are O(position) and invisible to the call counter; the README says
  so.
- **Whole-row granularity: verified, bounded.** `set` repaints all of the row's cells, 2–8 in
  big-table. With wide rows (50 columns) or rows that hold a nested list, one edit costs O(row
  width), against O(1) for Solid's per-cell effects.
- **Moving items between lists:** both recreate the DOM node (separate `<For>`s), so they are
  even. Moving within a list costs O(n) for tea-inline (weakness 3).

### 2.5 Async and effects: predicted

None of this exists in the prototype. Time and pushes arrive only through `dispatch`. TEA would
express them as `Cmd` and `Sub`. A compiled action could inline `fetch(...).then(arm)`, and a
"subscription depending on state" (an interval while `running`) could be a binding in the
`running` group that starts and stops it. That works, but it needs per-effect cleanup state, and
nothing protects against stale responses (both approaches leave that to the app). Solid's runtime
already has `createEffect`, `onCleanup`, `createResource` and `Suspense`, which is part of why its
baseline is 5.9 KB. **The baseline gap partly reflects a feature set closed to what the scenarios
need.** Each real feature adds runtime to tea-inline too.

### 2.6 Code splitting, lazy routes, third-party code, incremental builds: verified coupling

- A widget's number is its import order (`W.map(([html, widget], i) => …)`, `app.js`), and
  messages find widgets by number (`views[msg.widget.slice(1)]`). A dynamically imported widget
  would get a wrong number.
- A reader references private positions in another module's binding table (`R[3][1]`). Adding one
  binding to widget 3 renumbers its groups and forces a recompile of every reader, so HMR can't
  stop at one module.
- The README credits whole-program numbering tricks with roughly 15–20% of the size savings
  (positional arguments −5%, ids from row order −6%, binding table by place −7%). A compiler that
  works one file at a time (like Svelte or Solid) or a split build would lose most of that.
- Third-party components can't be analysed: an opaque consumer of the store forces a coarse
  subscription. Third-party Solid components join the tracking for free.

### 2.7 Developer model

You can't write tea-inline by hand: its source would have to be a pure TEA-like language that the
compiler can analyse (Elm-like, whole program). Interop with stateful JS libraries (maps, editors,
charts) goes through ports-style boundaries. Hot reload would have to recompile dependents
(§2.6). The output mutates a model that the source language treats as immutable.

### 2.8 Other correctness hazards

- **Stale closures: verified (weakness 5).**
- **A scheduler shared by the module:** `pending` and `done` are module globals
  (`runtime.js:11-12`), and `stop()` calls `cancel()`, which clears *all* pending work. Two
  instances on one page would drop each other's updates. *(Verified by reading.)*
- **A binding that throws** aborts the flush loop and leaves later bindings pending until the next
  `schedule`, with no error boundary. *(Verified by reading.)*
- **Focus and scroll after an update** need `await settled()`, because the DOM is a microtask
  late. TEA has no "after render" hook, so tea-inline would need one. *(Predicted.)*

### 2.9 What the CPU and memory numbers really say

- **Script time:** tea-inline beats Solid on every dashboard event, for example 66 against 110 µs
  to add to an int at unique-components N=64 (`results/cpu/2026-10-16-unique-components-azathoth`).
  But the total frame is about 10 ms, and the totals overlap within their CIs, so no user would
  notice. Only big-table separates them in absolute terms (create 10k: 42 against 63 ms of
  script). *(Verified from committed results.)*
- **Memory is a real, unmeasured strength.** JS heap after "create 10,000 rows": tea-inline
  318 B/row, Solid 1,108 B/row, vanilla 183 B/row. *(Verified.)*
- **Locality can't detect fan-out problems.** It compares calls at N against 16N, and readers per
  field are a property of the field, not of N. It also doesn't count native scans
  (`indexOf`, `find`).

### 2.10 Compile time and build complexity: predicted

The emitter takes 0.03 s, but it solves no analysis problem. A real compiler needs read and write
sets across functions and modules, alias analysis to justify in-place mutation, recognition of
patterns (update item by id, `selected === item.id`, push or splice) to get row precision, and
topological ordering if memos are added. Each pattern it fails to recognise falls back to replacing
the array (a full reconcile plus every binding that reads the field). The selection rule in
particular is hand-specialised to `s.selected === item.id`. A multi-select (`selected.has(id)`) or
a threshold (`item.price > s.limit`) puts a global read in every row.

### 2.11 The prototype's output is tuned to these generators

Four rounds of size optimisation ran against the same generators at N=256 (`notes/*tea-inline-smaller*`).
Several choices are fitted to the generators' distributions: `items()` numbering, readers only
above, readers per field and per widget rather than per edge, and `E[n]` that skips
`h2,label,option`. Solid's emitter writes plain idiomatic JSX. Without a held-out scenario we
can't tell how much of the lead is overfitting.

## Part 3: scenarios that would break it (ranked by how likely they are to change the conclusion)

### 1. `routed-app`: pages, modals and global state (most likely to change the conclusion)

- **Models:** an app of N routes (pages), each its own component, plus a few modals. Only one page
  is shown. Every page reads 2–4 global fields (user, cart count, locale, currency).
- **Grows with N:** one more page component, with its own fields, arms and bindings.
- **Key operations:** navigate (mount one page, unmount another), open and close a modal, edit a
  global field (read by every page that exists), external `snapshot`, and a lazy route as an
  optional build variant.
- **Prediction:** as built today, tea-inline mounts every page at start (mount O(N)). A global
  edit runs every page's readers, which is O(N) per local action and **fails the 8× locality
  rule**. Fixing that needs lazy mounting plus unsubscribe on unmount, which is new runtime bytes
  and per-page cleanup code. Lazy routes break the whole-program numbering. Solid: `<Switch>`,
  `<Match>` or `<Dynamic>`, O(visible) work, automatic cleanup. The synthetic hidden-`when` run
  above is a first measurement of this effect (crossover at about 1,000 hidden bindings).

### 2. `derived-graph`: a spreadsheet of formulas

- **Models:** N formulas, each its own code, over a few inputs and a 2,000-item collection: chains
  of depth 2–5 (filter → sort → group → aggregate), fan-out of 5–50 readers, and some formulas
  whose value rarely changes.
- **Grows with N:** one more formula and its readers.
- **Key operations:** edit an input, toggle one item, edit an attribute that no aggregate reads.
- **Prediction:** today, tea-inline inlines each chain into every reader, so code grows with
  readers × depth and CPU is K × O(items) per edit. With memos added, it pays 2.4 B per edge
  against 1.1 B (verified) and needs a topological order. Solid needs one `createMemo` per node,
  O(items) once, and equality stops propagation (`count` unchanged ⇒ no reader runs). **Solid
  should win on CPU outright and on slope from about 4 reads per binding.**

### 3. `tree`: a recursive outline or file explorer

- **Models:** N node kinds (folder, file, link, image, task…), each its own row view and actions,
  in a tree of fixed depth and data.
- **Grows with N:** one more node kind.
- **Key operations:** expand and collapse subtrees (create and destroy), move a node to another
  parent, a global selection and search highlight read by every visible node, and a snapshot.
- **Prediction:** tea-inline can't build eagerly, because the tree is unbounded. It needs
  instances, disposal and per-node global subscriptions, so its runtime grows toward an owner tree.
  The selection pattern helps only for `selected === id`, not for the highlight. **Solid:** the
  same code it writes for flat lists.

### 4. `reorder`: kanban and priority lists

- **Models:** N boards, each with its own card view, using drag to reorder, "move to end",
  re-sorting on the server (`serverRows` with one item moved), and moves between columns.
- **Grows with N:** one more board.
- **Key operations:** move first to last, move one item via a replaced array, move between lists.
- **Prediction (verified):** 9,999 moves against 2, about 8–10× slower script and layout at 10k
  rows. This one is fixable by adopting udomdiff (about +500 B brotli). It changes the CPU picture
  more than the size picture.

**A cheap harness change:** add a step that fires two events in one task (`click(); click()`)
to `./rr check`. It catches weakness 5 today.

## What holds up

Locality on our scenarios is real, script time and memory are lower than Solid's, and the precise
per-field scheduling is the right mechanism for big-component. The doubts are about generality,
lifetime, connectivity and reordering, none of which our four scenarios exercise.
