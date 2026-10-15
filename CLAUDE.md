# Reactivity research

A standalone research project, about **size only: how many bytes does a reactive browser UI
ship, and how much does it grow as the app grows?** It studies every approach to building an
app (vanilla, signals and fine-grained reactivity, virtual DOM, the Elm Architecture, compiled
and reactive-free output, and anything new) under one common contract, on generated scenarios.

Implementations must be correct and fair (below), because an incorrect or degenerate
implementation can always be made smaller.

It is independent of any language or framework project.

## The goal

Find the approaches whose shipped code comes closest to hand-written vanilla JavaScript in
**size**: everything the browser downloads for the app, as two numbers:

- **baseline:** what the smallest app in a scenario family ships (runtime plus wiring);
- **slope:** the bytes each additional feature adds as the app grows.

Some approaches have a small baseline but a steep slope; others the reverse. **We want both low**,
and we want to know *why* each approach lands where it does: which parts of its output
(runtime, per-component scaffolding, update code, templates, names) grow with the app.

## The contract every implementation follows

The contract fixes **what happens**, never **how state is stored or how the UI updates**.
Signals, virtual DOM, TEA, compiled output, vanilla and anything else must all fit inside it.

**The harness provides, per scenario (the reference, the single source of truth):**

```js
initialState                    // plain data
update(state, msg) → newState   // pure reference reducer; immutable, with structural sharing
render(state) → reference DOM   // the correctness oracle
```

**Every implementation provides:**

```js
mount(root)       // render the initial state into root
dispatch(msg)     // handle an EXTERNAL event: server push, timer, a whole-state snapshot
settled()         // → Promise resolved when the DOM reflects every event so far
dispose()         // remove everything: nodes, listeners, timers, subscriptions
```

**How the harness drives it** (in a DOM implementation running under Node, such as happy-dom or
jsdom, at a pinned version; no browser is needed for size work):

- **User actions arrive as DOM events:** clicks, input, keys, dispatched by selector. Each
  implementation wires its events its own natural way.
- **External events go through `dispatch(msg)`.** Messages describe *intent* ("toggled row 5",
  "server sent page 3", "here is a whole new state"), never a state diff and never "the new
  model".
- The harness applies the same intents to the reference `update` to know what the page must
  show.

**What must hold after every step** (checked by the harness after awaiting `settled()`):

1. **Same DOM.** The page's normalized DOM equals `render(state)`. Normalization ignores
   attribute order, framework marker comments, empty text nodes and insignificant whitespace,
   and includes live properties (`value`, `checked`, `selected`).
2. **Node identity.** Keyed items keep their DOM node across reorders and edits. Nodes whose
   content did not change are not replaced. An input being typed into keeps focus and caret.
   (This rules out the degenerate "rebuild everything with `innerHTML`" implementation, which
   would be small but wrong.)
3. **Clean disposal.** After `dispose()`, the root is empty and no listeners, timers or
   subscriptions the implementation created remain.

**Stable selectors:** the reference render puts `data-key` and `data-role` on interactive and
keyed elements, and every implementation must emit the same attributes.

**No peeking:** an implementation must not call the reference `update` or `render`, or read
harness state. They exist only for checking. (An approach *derived from* a pure `update`, such
as TEA or a compiler that analyses it, implements its own equivalent.)

## Everything is generated

**Every implementation is written by a generator, never by hand.** There are two kinds of
generators, joined by one intermediate description:

- **The scenario generator** produces an **app spec**: a framework-neutral description of one
  app (its state, messages, the reference `update` and `render`, the UI shapes it composes,
  the interaction script), for a given family, size, seed and options.
- **One emitter per approach** turns an app spec into that approach's source code (React,
  Vue, Svelte, Solid, Elm, vanilla, a prototype strategy, …), plus its contract adapter and its
  build configuration. Emitters, not people, write every implementation.

Both are **configurable and parametrizable**: the family, the size, the seed, the mix of UI
shapes, and the approach's own style choices (for example component granularity, where state
lives, stores or local state, keyed or not) are parameters, so a variation is a run of the
generator, never an edit to generated code. Generated code is never edited by hand; a fix goes
into the generator.

**What the generators must guarantee:**
- **Idiomatic output.** Each emitter writes code the way an expert in that approach would, as
  its documentation recommends. Check samples of every emitter's output against the
  approach's docs, and record the style choices it makes.
- **Real variety.** A generated app composes genuinely different UI shapes, and no two
  instances of a shape are identical (fields, labels, nesting, which messages touch which
  state). Never grow an app by copying one widget N times: brotli makes duplicates nearly free,
  and the slope would be meaningless.
- **Determinism.** The same spec, seed and options always produce byte-identical output.
- **Coverage of growth:** families that stress growth differently (tables and keyed lists,
  independent widgets and dashboards, forms with validation, trees and recursive structures,
  routing and pages, filtering and derived data, whole-state snapshots, and any family that
  exposes a weakness), at least 6 sizes per family, and several seeds per size.

## The approaches

Two tracks, reported separately:

1. **Real frameworks, as they ship**, each at a pinned latest stable version and built with its
   own official tooling and production settings: virtual DOM (React, Preact, Inferno,
   Mithril), signals and fine-grained (Solid 1 and 2, Vue 3 and Vue Vapor where usable,
   Angular with signals, Preact Signals), compiled (Svelte 5, Marko 6), the Elm Architecture
   (Elm, with `--optimize` and its usual minify step), light-weight (Lit, Alpine), and
   **vanilla** as the floor. Add others when they reveal something.
2. **Strategies no framework implements yet:** emitters for ideal outputs of new approaches
   (for example compiled TEA with partial evaluation, or instance-local message routing through
   closures). They must pass the same contract and are always labelled as prototypes.

**The adapter:** every implementation exposes the contract (`mount`, `dispatch`, `settled`,
`dispose`) through a thin adapter that the emitter writes, using the framework's own
mechanisms (its render and unmount calls, a store or port for external events, its flush or
tick for `settled`). Inside the adapter, the framework is used exactly as its documentation
recommends. The adapter's bytes are reported separately and **excluded from the app's size**.

## Rules

1. **Measure, don't argue.** Every claim rests on a reproducible measurement: the script, the
   raw results and the versions of everything (Node, libraries, build tools, compressors). No
   conclusion from a single build or a single scenario.
2. **The contract is checked, never trusted.** An implementation that fails a check after any
   step is excluded from the numbers until fixed, and the failure is reported.
3. **Fair implementations.** Each emitter writes its approach as an expert would,
   idiomatically, with its own best practices (keyed lists, components, its normal build
   pipeline). Use real libraries at pinned versions where they exist. No golfing that the
   approach's users wouldn't do: compare what each approach really ships. A straw man is worse
   than no comparison.
4. **What is measured: everything shipped to the browser, HTML and JavaScript.**
   - **HTML** is not minified, only compressed with brotli (quality 11).
   - **JavaScript** is minified, then compressed with brotli (quality 11). Use the production
     build the approach's own tooling recommends, as one bundle per app unless the approach
     requires otherwise.
   - The size of an app is the sum of its HTML and its JavaScript, each compressed on its own.
     Report HTML and JavaScript separately as well as the total, and raw sizes beside the
     compressed ones; the compressed total is the headline.
5. **Attribute the bytes.** Split every bundle into runtime/library code and app code (source
   maps or deletion accounting), so baseline and slope can be explained, not just reported.
6. **Separate baseline from slope** in every size result, and fit them over the sizes. A single
   bundle size is not a result.
7. **Report dead ends.** An approach or idea that loses is a result: record it with its
   numbers and why it lost.
8. **No network at measurement time.** Dependencies are installed and pinned before a run.

## Layout (to grow into)

```
harness/       the contract checker, the DOM normaliser, the size runner
spec/          the app-spec format and the scenario generator (families, shapes, options)
emitters/<n>/  one emitter per approach: vanilla, react, vue, svelte, solid, elm, prototypes …
generated/     emitter output (reproducible; never edited by hand)
results/       raw measurements, one directory per run, with versions
reports/       written findings, answer first
```

## Working here

- The toolchain is pinned by `flake.nix`: Node (latest), brotli and jq. `direnv allow` puts
  them on `PATH`, or run `nix develop`.
- Use npm with a committed lockfile per package, and exact pinned versions.
- Keep a short log of each working session in `notes/` (date, what was done, what was learned).
