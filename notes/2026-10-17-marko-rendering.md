# 2026-10-17: how Marko 6 renders, against tea-inline

Read at `references/marko`, pinned to the tag `@marko/runtime-tags@6.4.6` (commit `2566315`,
2026-10-14). That package is the one npm publishes as `marko@6.4.6` (`latest`): the repo's own
`marko` package is still Marko 5 (5.39.46), and `packages/runtime-tags/package.json` says the
Tags API ships from there. Paths below are relative to `references/marko/packages/runtime-tags/`.
Builds: Node 26.11.1, brotli 1.2.0, Vite 8.3.4 (Rolldown 1.2.14), `@marko/vite` 6.1.13,
`@marko/compiler` 5.42.12, in a scratch directory that was deleted afterwards. These are probes,
not project measurements: they have no emitter, no scenario and no `results/` record.

## Answer first

**Marko 6 is a real version of what tea-inline imitates, in a language built so that the
analysis is always possible.** A Babel translator turns each `.marko` file into a static
dependency graph. Its nodes are *bindings*: `<let>` state, `<const>` derived values, `input`
properties down to member paths (`input.node.name`), and loop and body parameters. It groups the
DOM work by the exact set of bindings it reads and emits one small *signal* function per group.
A write to a `<let>` calls its signal, which writes the DOM nodes that read it and calls the
signals derived from it. Nothing is tracked at runtime: the graph is in the code.

The runtime keeps only what can't be known at build time. Per instance there is one plain
*scope* object of value slots, and every instance shares the same module-level signal functions.
On top of that the runtime holds the branch tree (`<if>`, `<for>`, dynamic tags), a priority
queue that orders updates, and LIS-based keyed reconciliation.

The four things the tea-inline critique says a compiler can't do, Marko does:

- it reads arbitrary JavaScript expressions;
- it creates and destroys subtrees, with cleanup;
- it reorders a list with the fewest moves;
- it compiles one file at a time, with lazy loading.

It pays for that in three ways:

- **A larger runtime:** 1.9 KB brotli for a counter and 3.4–3.7 KB for a few widgets, against
  tea-inline's 0.74 KB. Solid's is about 6.5 KB.
- **Immutable state:** a change to one list item replaces the array, and the loop then visits
  every row.
- **A language you must write in:** `<let>`, `<const>`, `<for by>`, assignment only, no context
  API.

## 1. The pipeline

**Phases** (`AGENTS.md:33-41`): parse → `migrate` → `transform` → `analyze` → `translate`, with
`analyze` shared and cached between the two outputs, `html` (SSR plus resume data) and `dom`
(client code). Analysis, in `RESUMABILITY.md:11-26`:

1. `sections.ts` splits a template into **sections**: the template body and every non-inlined tag
   body (`<if>` branch, `<for>` row, content). A section is the unit of code generation. Its
   runtime instance is a **scope**.
2. `bindings.ts` and `references.ts` record every **binding** and its reads, assignments, aliases,
   property paths and closures. Assignment is the only write: `trackAssignment`
   (`src/translator/util/references.ts:498-570`) accepts `x = …` / `x++` only inside a function
   (a handler or a `<script>`), and turns an assignment to `input.x` into a call of
   `input.xChange`. In-place mutation (`items.push(x)`) is invisible by design: the cheat sheet
   forbids it (`cheatsheet.md:11-15`).
3. `finalize-references.ts` resolves the sources, prunes unread bindings, and **canonicalises
   intersections**: a set of bindings whose shared work waits for all of them (`CONTEXT.md:98-101`).
4. `signals.ts` emits one **signal** per key: setup, one binding, or one intersection
   (`CONTEXT.md:103-108`). Lowering drops empty signals, inlines one-hop forwarders, and adds
   storage only where needed (`RESUMABILITY.md:115-123`). That storage is `_let` (state), `_const`
   (stored with an identity check) or `_or` (an intersection counter).

**How a dependency is represented: a direct call.** No bitmask and no subscriber list for
static structure. A source's signal calls its readers by name. A read of several sources is an
`_or` intersection, which counts arrivals within one render and runs once
(`src/dom/signals.ts:111-135`). A read from a child section (an `<if>` body, a `<for>` row) is a
**closure** in Marko's terms (`CONTEXT.md:61-64`). The owner's signal calls `_if_closure` or
`_for_closure`, which walk the live child scopes the owner already holds
(`src/dom/signals.ts:137-162, 241-267`). Child scopes therefore don't subscribe, and can't leak.

**What a counter compiles to** (production `optimize` output of the `dom` compile; the source
reads `count` in 3 places, `doubled = count * 2` in 2, and `count >= input.max` in 1):

```js
export const $template = "<section data-role=counter><output> </output><p>Doubled: <!></p><p>Even: <!></p><button>+</button><button>-</button></section>";
export const $walks = "E lDb%l Db%l b l";            // where to find the bound nodes after a clone
const $doubled = ($scope, doubled) => {               // a derived value: computed once, passed in
  _text($scope.b, doubled);
  _attr($scope.c, "title", `x${doubled}`);
};
const $input_max__OR__count = _or(11, $scope => _attr($scope.e, "disabled", $scope.k >= $scope.j));
const $count = _let(10, $scope => {                   // the state's signal: every reader, by name
  _text($scope.a, $scope.k);
  _text($scope.d, $scope.k % 2 === 0 ? "yes" : "no");
  $doubled($scope, $scope.k * 2);
  $input_max__OR__count($scope);
});
export const $input_start = $count;                   // the parent calls these per attribute
export const $input_max = _const(9, $input_max__OR__count);
const $setup__script = _script("qzwOo83", $scope => {
  _on($scope.e, "click", function () { $count($scope, +$scope.k + 1); });   // count++
  _on($scope.f, "click", function () { $count($scope, +$scope.k - 1); });
});
```

This is tea-inline's output almost line for line: an action writes the slot and runs exactly the
bindings that read it. There is no message and no diff. The differences:

- **State sits in a scope object.** Each `count` is `$scope.k`, and the signal functions are
  shared by every instance, where tea-inline uses an `s` object plus per-instance closures.
- **The DOM is cloned from a template string** and the walk string finds the bound nodes, where
  tea-inline uses `E[n]` by `querySelectorAll`.

**Across templates** a parent compiles against the child's params tree, the per-property shape
it reads (`knownTagAnalyze`, `src/translator/util/known-tag.ts:134-196`). It then calls the
child's per-property signals directly, and even concatenates the child's template and walk
strings into its own:

```js
// app.marko: <counter start=1 max=10/> <todo items=[…]/>
export const $template = ((_w0, _w1) => `${_w0}${_w1}<ul data-role=rows></ul>`)(_counter_template, _todo_template);
export function $setup($scope) {
  _counter($scope.a); _counter_input_start($scope.a, 1); _counter_input_max($scope.a, 10);
  …
}
```

This is cross-file analysis one import deep. The child's analysis is compiled and cached, but
nothing is numbered across the program: accessors are dense per section (`AGENTS.md:56`). That
is why code splitting still works (§5).

**A keyed list** (the todo, abridged):

```js
const $for = _for_of(2, "<li><input type=checkbox> <button>x</button></li>", " D b b ", $for_content__setup, $for_content__$params);
const $for_content__item = _const(5, $scope => {          // row param, identity-checked
  $for_content__item_text($scope, $scope.f?.text);        // property path: item.text alone
  $for_content__items__OR__item__OR__i($scope);
});
const $items = _let(7, $scope => {
  $remaining($scope, $scope.h.filter(t => !t.done).length);
  $for($scope, [$scope.h, "id"]);                         // reconcile by key
  $for_content__items($scope);                            // _for_closure: rows that read `items`
});
// a row's handler: items = items.toSpliced(i, 1)
_on($scope.d, "click", function () { $items($scope._, $scope._.h.toSpliced($scope.i, 1)); });
```

## 2. The runtime

`src/dom/` is about 5,000 lines of TypeScript, and `src/common/` adds about 1,000. Everything is
tree-shaken: helpers are `/*@__PURE__*/` and features sit behind *latches* (`withBranches`,
`*.feat.ts`) that fold away when unused (`AGENTS.md:86-90`).

| Part | Where | What it does |
|---|---|---|
| Signals | `src/dom/signals.ts:39-135` | `_let`: inside a render, writes the slot and runs the readers; outside one, compares, stores and queues. `_const`: stores on identity change. `_or`: counts intersection arrivals. |
| Closures | `src/dom/signals.ts:137-330` | the owner notifies the live child scopes: `_if_closure`, `_for_closure`, `_for_selector`, and `_closure` for dynamic content (a `Set` of subscribers, removed on destroy) |
| Queue | `src/dom/queue.ts:22-77, 214-251` | a binary heap keyed `scopeId * 1e6 + signalId`, so owners run before children and sources before readers; `runId` marks a render generation |
| Scheduling | `src/dom/schedule.ts:6-51` | the first write in a frame flushes in a microtask; later ones wait for `requestAnimationFrame` plus a `MessageChannel` task |
| Effects | `src/dom/queue.ts:129-183`, `abort-signal.ts` | `<script>` and handler wiring run after renders. Cleanup is `$signal`, an `AbortController` per effect, aborted when its branch is destroyed. |
| Control flow | `src/dom/control-flow.ts` | `_if` (463-500), `_show` (503), `_dynamic_tag` (606), `setBranch` (804-854), loops (856-1047), `reorderKeyed` (1049-1108), `<await>`/`<try>` |
| Lifetime | `src/dom/scope.ts:67-110` | destroying a branch sets each nested scope's generation to 0 (later renders skip it), removes its subscriptions and aborts its signals |
| Events | `src/dom/event.ts:21-34` | one capturing listener per event type on `document`, with the handler as an element property (`el["1click"]`) |
| Controlled inputs | `src/dom/controllable.ts` | `value:=x` and friends keep the caret (`resolve-cursor-position.ts`) |
| Resume | `src/dom/resume.ts`, `load.ts` | SSR adoption and lazy chunks; mostly tree-shaken away in a client-only build |

**Size.** Upstream's own `.sizes.json` (repo root) gives a counter **1,719 B** of runtime brotli
(**1,204 B** in a resumed build), and **10,231 B** for the whole DOM runtime. My client-only Vite
builds (`mount` into a root; every figure is the minified bundle compressed with brotli 11):

| App | Total | Runtime (alone) | App code (alone) |
|---|---|---|---|
| one counter | 2,153 B | 1,884 B | 184 B (counter) + 71 B (entry) |
| counter + todo (`<if>`, `<for>`, `value:=`, checkbox) + keyed rows | 4,199 B | 3,351 B | 160 + 474 + 195 B |
| 64 generated widgets, 4 shapes (counter, validated input, todo, select + `<if>`), all names, labels and limits varied | 9,027 B | 3,696 B | ≈5.3 KB |

The generated-widget probe grows like this:

| N | 1 | 2 | 4 | 8 | 16 | 32 | 64 |
|---|---|---|---|---|---|---|---|
| brotli total (B) | 2,037 | 2,986 | 4,653 | 5,012 | 5,632 | 6,804 | 9,027 |

From N=8 on, every runtime feature is in, and the slope is **about 71–75 B per widget**. Our
numbers come from other apps, but tea-inline's per-unit cost on big-component is 80.5 B and
Solid's 91.6 B (`notes/2026-10-16-consolidated-report.md`). Per widget, Marko lands in the same
range as the precise prototypes. The baseline lands between them and Solid.

**A build trap worth recording:** with `"type": "commonjs"` in `package.json` (what `npm init`
writes today), Rolldown wraps every module in a lazy-init function. That cost +11 to +14% (10,251
against 9,027 B at N=64). An emitter must write `"type": "module"`.

## 3. Dynamic structure

- **Conditionals mount and unmount.** `<if>` builds its branch when the condition becomes true and
  destroys it when it turns false (`setBranch`, `src/dom/control-flow.ts:804-854`). Destroying it
  zeroes the generations, removes the `Set` subscriptions and aborts the `$signal`s
  (`src/dom/scope.ts:67-102`). While hidden it costs nothing: the owner's `_if_closure` only queues
  a branch that is live and selected (`src/dom/signals.ts:254-263`). `<show>` is the other
  choice: it stays mounted and keeps its state (`cheatsheet.md:71-74`). This is the dynamic
  lifetime the tea-inline critique finds missing (weakness 2), and it is solved *structurally*.
  The owner holds its child scopes, so a static child needs no subscription list. Only dynamic
  content (`_closure`) uses a `Set`, and destroy cleans it.
- **Keyed lists reorder with the fewest moves.** The loop reuses rows by key, skips the common
  prefix and suffix, then computes a longest increasing subsequence of the old indices and moves
  only the rows outside it (`reorderKeyed`, `src/dom/control-flow.ts:1049-1108`). "First to last"
  is one move, not tea-inline's n−1 (critique weakness 3). The fast path removes every row with
  `textContent = ""` when no key matches (`:948-958`). Unkeyed loops (no `by`) are keyed by index
  and ship without `reorderKeyed` (`:1037-1047`).
- **Where a list update costs O(n).** State is immutable, so toggling one todo replaces the array.
  The loop then calls every row's `params` signal (`:925`), and `_const` stops at the unchanged
  item objects. If rows close over the list (here the handlers read `items`), `_for_closure` also
  re-runs a signal in every row (`src/dom/signals.ts:144-159`), which allocates a new handler per
  row. That is O(rows) per local edit, where tea-inline costs O(1) with in-place edits. It matches
  Solid with immutable arrays and no store.
- **The selection pattern, as in tea-inline.** `detectForSelector`
  (`src/translator/util/for-selector.ts:31-52`) recognises a row expression that only compares a
  closure with the row key (`selected === row.id`). It compiles it to `_for_selector`, which
  re-runs only the previous and the new row (`src/dom/signals.ts:164-214`). That is the same
  hand-specialised case tea-inline uses in big-table, here written generically in a real compiler.
  Any other global read in a row (`row.price > limit`) becomes `_for_closure`: every row.
- **Recursion** is a known tag that renders itself. It is analysed at program exit
  (`analyzeRecursiveTags`, `known-tag.ts:198-207`), and the compiler rejects a self-render outside
  a branch, which could never terminate (`:209-224`). A probe `tree-node.marko` compiled to a
  `_for_of` over its own `$template`/`$walks`, with its own `$setup` per child.
- **Components chosen at runtime:** `<${which ? Todo : Counter} …/>` compiles to `_dynamic_tag`.
  The child's params tree is unknown here, so the whole input goes in as one object, through a
  getter (`() => ({ start: 1, max: 3, items: [] })`), and the child splits it in its own `$input`.
  **This is where compile-time analysis stops:** per-property signals reach only a tag the compiler
  can resolve.
- **Cross-component data flow:**
  - **props:** per-property signals across known tags;
  - **two-way binding:** `:=` binds a child's `<let>` to a parent value;
  - **child-to-parent values:** `<return>` and a tag variable;
  - **context: none.** The cheat sheet says to drill props or use `$global`
    (`cheatsheet.md:139-143, 230`), and `$global` is fixed at mount, so it isn't reactive.
    Upstream issue #3155 (April 2026, open) asks for a context API. Shared state lives in a
    common parent or in a plain module that components subscribe to from `<script>`.

## 4. Derived values and memoization

- **Computed once per change, by construction.** A derived value is computed in its source's
  signal and passed as an argument to one function that writes all its readers: `doubled` above
  is computed once and feeds two bindings. This is common-subexpression elimination for free,
  which tea-inline lacks (critique §2.2).
- **Chains** forward the same way: `total` → `expensive` → texts. A plain forwarder has no
  equality cutoff. In the `rows` probe, `expensive = total > 100` re-ran its two texts whenever
  `total` changed, and `_text` compared before writing. The cutoff (`_const`: store and compare)
  appears only where a value must be stored, because a closure, a handler, an intersection or a
  child reads it later (`RESUMABILITY.md:119-121`).
- **Intersections** (`count >= input.max`) run once per render, after every member has arrived
  (`_or`). The queue's ordering (`scopeId * 1e6 + signalId`) prevents glitches.

## 5. Code splitting, resumability, client-only use

- **Splitting.** `import W from "<w>" with { load: "idle" | "visible#sel" | … }` makes a lazy tag
  (`cheatsheet.md:172-179`). The parent still analyses it against the child's params tree, and
  only loads its setup and per-property signals through `_load_setup` and `_load_signal`, behind
  a dynamic import (`src/translator/visitors/tag/custom-tag.ts:297-320`, `src/dom/load.ts:73,
  171`). The one loss: a lazy tag can't have a tag variable (`custom-tag.ts:89-98`).
  **Analysis is per file, against the interfaces of its imports, so whole-program analysis never
  meets lazy code.** Numbering is per section (`AGENTS.md:56`), which is exactly what blocks
  tea-inline (critique §2.6).
- **Resumability.** Marko's main mode is SSR plus *resume*, not hydration. The server serialises
  only the scope slots that some client code can read, and ships only the signals that can run
  (`AGENTS.md:26-29`, `RESUMABILITY.md:28-47, 80-113`). Most of the translator's complexity
  ("reasons", "write guards", registrations) is for this. In a client-only build its visible cost
  is small: `_script` ids and `_resumed.xx = fn` registrations survive minification (`q.c1=xt`,
  a few bytes each).
- **Client-only rendering** is a supported API, not a hack. `Template.mount(input, node,
  position?)` is in the public types (`index.d.ts:110-115`), and it returns `{ value, update(input),
  destroy() }` (`src/dom/template.ts:45-153`). `@marko/vite` with `linked: false` only compiles
  `.marko` files for a plain Vite SPA. It is less common than SSR in Marko's own guidance, which
  is written around `@marko/run`, but it is documented and idiomatic for a client-rendered page.

## 6. Weaknesses and limits found

- **Event delegation leaks on dispose.** `_on` adds one capturing listener per event type on
  `document`, and nothing ever removes it (`src/dom/event.ts:30-34`). A headless-Chrome run with
  our `harness/serve/hooks.js` showed `click`, `input` and `reset` capture listeners still on
  `document` after `destroy()`, with an empty root. There is no public `clearDelegatedEvents` like
  Solid's.
- **Frame-batched scheduling.** A second update in the same frame waits for `rAF` and a macrotask
  (`src/dom/schedule.ts:22-51`). The probe showed it: one click was visible after a microtask, and
  the second only after rAF plus a `MessageChannel` message. Upstream marks hidden-tab batching
  "won't fix" (`:22-23`). There is no public `tick()` or `flush()`.
- **Immutable updates are mandatory,** so a local edit to a collection costs O(n) in the loop (§3).
  Mutation fails silently (`cheatsheet.md:11-15`).
- **Bytes per dependency edge.** Each edge is a call written in the source's signal, and each
  distinct read set adds an `_or` wrapper. A read is therefore spelled twice, once in the
  expression and once as a call, as in tea-inline:

  ```js
  const $a__OR__b = _or(6, $scope => _text($scope.b, $scope.e + $scope.f));
  const $a = _let(4, $scope => { $a__OR__b($scope); $a__OR__b__OR__c($scope); });
  const $b = _let(5, $scope => { $a__OR__b($scope); $a__OR__b__OR__c($scope); $b__OR__c($scope); });
  ```

  Probe: 256 texts in one template, each one expression reading r random fields of 16 (whole
  bundle, brotli): r = 1: 2,812 B; 2: 4,184; 4: 6,265; 8: 7,979; 12: 8,492. Going from one
  source to two costs **5.4 B per edge**, because every binding becomes its own `_or` signal.
  From 4 to 12 reads it costs **1.1 B per edge**, and 2.0 B on average over 1 → 12 (12.3 B raw).
  The critique's synthetic spec gave tea-inline 2.4 B and Solid 1.1 B per edge. It is a
  different app, so this is only an order of magnitude: Marko is in tea-inline's range, not
  Solid's.
- **No context API**, and no reactive `$global` (§3).
- **Syntax traps that compile silently:** a `>` hugging an attribute value ends the tag (the
  compiler rejects only the ambiguous whitespace form), and a bare line at the root parses as a
  tag (`cheatsheet.md:7-8`). An emitter has to parenthesise comparisons.
- **The `@marko/vite` known-templates glob** ignores paths matching `*test*`, `*build*`, `*example*`
  and the like under the Vite root (`getKnownTemplates` in `@marko/vite/dist/index.mjs`). It only
  shortens registration ids, so it doesn't break anything, but a generated app's directory names
  shouldn't hit those patterns.

## Comparison

| | Marko 6 | tea-inline (prototype) | tea-dirtybits (prototype) | Solid 1 |
|---|---|---|---|---|
| Dependency knowledge from | the compiler, from real JS expressions in a language that confines state to `<let>`/`<const>`/`input` and writes to assignment | the emitter, pattern-matching a closed IR of expressions and ops | the emitter: compile-time dirty bits per field, set by reducer arms | runtime tracking: reads inside a computation subscribe |
| Update granularity | a signal per binding or read set; one DOM write per binding; property paths (`item.text`) | a group of bindings per field; a whole row's `set` in big-table | a component's static patch, gated by bit tests | one effect per binding |
| Runtime (brotli) | 1.9 KB (counter) to 3.4–3.7 KB (if, for, inputs, select); 10.2 KB if everything is used | 0.74 KB | about 0.8 KB | about 6.5 KB |
| Lifetime and disposal | branch tree: `<if>`/`<for>` create and destroy; owners pull from live child scopes; `$signal` aborts; document listeners leak | none: everything built at mount, subscriptions append-only, hidden content stays subscribed | built once; `branch` swaps nodes and repatches on show | owner tree, `onCleanup`, `<Show>`/`<For>` create and dispose |
| List reorder | LIS, fewest moves | one forward pass, n−1 moves for first → last | moves only out-of-place nodes in one walk | `reconcileArrays` (udomdiff-style), 2 moves for first → last |
| Local edit to one list item | O(n): immutable array, every row's params visited, identity cut-off | O(1): in-place edit, one row | O(n) keyed diff of the list behind the bit | O(n) with immutable arrays; O(1) with a store |
| Memoization | derived values computed once and passed down; cut-off where stored (`_const`); selector pattern for `x === row.key` | none: every reader inlines the expression | a summary recomputes when its bits are set | `createMemo`, explicit |
| Code splitting | per-file compile against child interfaces; lazy tags via `with { load }` | blocked: whole-program numbering | blocked in practice: a registry of widgets by id and bits numbered per program | `lazy()` per component |
| What a developer writes | `.marko` templates: `<let>`, `<const>`, `<for by>`, handlers that assign, no in-place mutation | nothing yet; would need a pure TEA language and a whole-program compiler | TEA: `update` and `view` | JSX with signals and stores |

**How close does a real compiler get to tea-inline?** Closer than the critique expected on the
*output*: the signal code above is tea-inline's shape, and its per-widget slope in the probe
(about 71–75 B) is in the prototypes' range. The gap is the runtime, 1.2–3 KB more. That buys
dynamic lifetime, LIS reordering, intersections, effects with cleanup, `<await>`/`<try>`,
controlled inputs and lazy loading, which are exactly the features tea-inline lacks. What Marko
gives up to make the analysis sound is in-place mutation. That moves list edits to O(n), and
the selector pattern is how it wins back the common case.

## Would a Marko 6 emitter be feasible and fair here?

**Feasible, yes, with one contract question for the owner (disposal).** What it needs:

- **Pinned versions:** `marko` 6.4.6, `@marko/vite` 6.1.13, `vite` 8.3.4 (`@marko/vite` needs
  Vite 8), exact versions plus a lockfile in `frameworks/marko/`, and `"type": "module"`.
- **The build:** `vite build` in production mode (`@marko/vite` sets `optimize` from it), with
  `marko({ linked: false })` and hidden source maps, like the Solid setup. Attribution:
  `node_modules/marko` is runtime. Template strings came out **unmapped** in the source map in
  these probes (1.8 KB brotli at N=64), so they must count as app code, not drop out.
- **The source:** one `.marko` per widget under `src/tags/` (auto-discovered), state in `<let>`,
  derived values in `<const>`, `<for by="id">`, `<if>` for conditional sections (`<show>` where
  the reference keeps hidden state), `value:=` and `checked:=` for inputs (caret-safe), immutable
  updates, and comparisons parenthesised. Summaries that read other widgets need the state
  *lifted* to the common parent and bound down with `:=`, the idiomatic route with no context
  API. That is a style option to record, as Solid's emitter records where state lives.
- **The adapter** (excluded from size):
  - `mount(root)`: `App.mount({}, root)`.
  - `dispatch(msg)`: the root `<return>`s one function that routes intent messages to its
    widgets' `<return>`ed APIs (child `<return={ tick() { … } }>`, parent `<W/w1/>`). That
    compiles to plain signal calls; I verified the shape. A whole-state snapshot reassigns each
    widget's `<let>`s, and `<for by>` keeps the nodes.
  - `settled()`: no public flush, so wait for `requestAnimationFrame` and then a `MessageChannel`
    message, which covers both the microtask flush and the frame-batched one. Headless Chrome runs
    rAF; a hidden tab would stall it.
  - `dispose()`: `mounted.destroy()` empties the root, but **the delegated `document` listeners
    stay**. The only fix is in the adapter: record `document.addEventListener` calls made while
    the app is mounted, remove them on dispose, and delete the runtime's `handler["1"+type]` latch
    so a remount registers again. That is the same idea as Solid's `clearDelegatedEvents`, but it
    reaches into a private runtime convention. **Blocker to flag:** without it, `./rr check`
    reports three listeners left after dispose, and with it the adapter depends on a private
    property name.
- **Fairness risks:**
  - a lifted-state design multiplies `:=` bindings, so measure both variants;
  - the O(n) local list edit is a real cost of idiomatic Marko and must not be "fixed" with
    mutation;
  - the resume registrations are real shipped bytes in client-only mode, so they count.
  - Marko is SSR-first. A client-only build is a supported, documented use but not its
    headline, so record it as "client-rendered Marko", like every other framework here.
