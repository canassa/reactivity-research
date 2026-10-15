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

**Each scenario's spec provides (the reference, the single source of truth):**

```js
initialState                    // plain data
update(state, msg) → newState   // pure reference reducer; immutable, with structural sharing
render(state) → reference DOM   // what the page must show
```

**Every implementation provides:**

```js
mount(root)       // render the initial state into root
dispatch(msg)     // handle an EXTERNAL event: server push, timer, a whole-state snapshot
settled()         // → Promise resolved when the DOM reflects every event so far
dispose()         // remove everything: nodes, listeners, timers, subscriptions
```

**How it is driven:**

- **User actions arrive as DOM events:** clicks, input, keys. Each implementation wires its
  events its own natural way.
- **External events go through `dispatch(msg)`.** Messages describe *intent* ("toggled row 5",
  "server sent page 3", "here is a whole new state"), never a state diff and never "the new
  model".
**What must hold after every step.** Correctness is verified **manually by the owner**, through
`./rr serve` (below); there is no automated checker. Every implementation must still meet all of
this, because an incorrect or degenerate implementation can always be made smaller:

1. **Same page.** What the page shows matches `render(state)` for the state the reference
   `update` reaches (ignoring attribute order, framework marker comments and whitespace).
2. **Node identity.** Keyed items keep their DOM node across reorders and edits. Nodes whose
   content did not change are not replaced. An input being typed into keeps focus and caret.
   (This rules out the degenerate "rebuild everything with `innerHTML`" implementation, which
   would be small but wrong.)
3. **Clean disposal.** After `dispose()`, the root is empty and no listeners, timers or
   subscriptions the implementation created remain.

**Stable selectors:** the reference render puts `data-key` and `data-role` on interactive and
keyed elements, and every implementation must emit the same attributes.

**No peeking:** an implementation must not call the reference `update` or `render`; they are the
specification, not part of the app. (An approach *derived from* a pure `update`, such as TEA or a
compiler that analyses it, implements its own equivalent.)

## Everything is generated

**Every implementation is written by a generator, never by hand.** There are two kinds of
generators, joined by one intermediate description:

- **The scenario generator** produces an **app spec**: a framework-neutral description of one
  app (its state, messages, the reference `update` and `render`, the UI shapes it composes,
  the interaction script), for a given family, size, seed and options.
- **Emitters, one per scenario and approach** (`scenarios/<scenario>/<framework>.js`, sharing `frameworks/<name>/`), turn an app spec into that approach's source code (React,
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
2. **Only working implementations count.** The owner checks each one by hand through
   `./rr serve`. One that misbehaves is excluded from the numbers until fixed.
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

## Layout

```
scenarios/
  big-table/
    README.md          the scenario's own contract (see below)
    spec.js            the scenario generator: state, messages, update, render, script; its parameters
    solid.js           the emitter for this scenario in Solid
    vue.js             … in Vue
    react.js
    vanilla.js
  dashboard/
    spec.js
    solid.js
    …
frameworks/
  solid/               shared by every Solid emitter: adapter, build config, pinned package.json +
                       lockfile, helpers
  vue/
  …
generated/             emitter output: gitignored, reproducible from the generators, never edited
  big-table/
    n16-s1/            size 16, seed 1
      solid/           the app's source and its production build
      vue/
    n64-s1/
      …
harness/               the size runner and the serve page
results/               raw measurements, one directory per run, with versions (committed)
reports/               written findings, answer first
notes/                 a short log of each working session
```

- **`scenarios/<scenario>/README.md`** is that scenario's contract, written before its generator:
  - what kind of app it models and why it grows the way it does;
  - **what "size" means** for it (always an amount of UI and behaviour, never an amount of
    data: a table with more rows ships the same code), the sizes and the seeds;
  - the catalogue of UI shapes it composes, and how instances vary;
  - its state, its messages (user actions and external `dispatch` events) and the reference
    `update`/`render` in words;
  - its `data-key`/`data-role` selectors, and the scenario-specific expectations (which elements are
    keyed, which inputs must keep focus and caret, which snapshots are sent);
  - the parameters and their defaults.

  The global contract in this file applies to every scenario; a scenario README only adds to it
  and never relaxes it.
- **`scenarios/<scenario>/spec.js`** generates the app spec for that scenario;
  **`scenarios/<scenario>/<framework>.js`** is the emitter that writes it in that framework.
- **`frameworks/<name>/`** holds what every scenario shares for one framework, so a per-scenario
  emitter contains only what is specific to its scenario. If per-scenario emitters start
  repeating each other, move the shared building blocks (a list, a form, a widget) here.
- **`generated/`** is not committed. Anything in it must be reproducible from the generators,
  their options and the pinned versions. What is committed is the measurements in `results/`,
  with the generator options and versions that produced them.

## The CLI

One command line tool, `./rr` (Node, no global installs), drives everything. Every subcommand takes
the same selection: a scenario, a framework (or `all`), and the generator's options (`--size`,
`--seed`, and the scenario's and framework's own parameters, with their defaults from the
scenario README).

```sh
./rr generate dashboard solid --size 16 --seed 1   # write generated/dashboard/n16-s1/solid/
./rr build    dashboard solid --size 16 --seed 1   # generate + the production build
./rr measure  dashboard all                        # every size and seed: sizes into results/
./rr serve    dashboard solid --size 16 --seed 1   # build, serve, and expose through cloudflared
```

**`./rr serve`** is for a person to see that a generated app really works:
- it builds the production version, serves it on a local port, and opens a **cloudflared quick
  tunnel** (`cloudflared tunnel --url http://127.0.0.1:<port>`), then prints the public URL;
- the page shows the app as built, plus a small panel, outside the app's root and not counted in
  any size, that can send the scenario's external events through `dispatch` (including a
  whole-state snapshot), step through the scenario's interaction script, and reset;
- `--local` serves without the tunnel; `Ctrl-C` stops both the server and the tunnel;
- several frameworks can be served side by side (`./rr serve dashboard solid,vue,react`), one
  page per framework from the same spec, so they can be compared by eye.

## Working here

- The toolchain is pinned by `flake.nix`: Node (latest), brotli, jq and cloudflared. `direnv allow` puts
  them on `PATH`, or run `nix develop`.
- Use npm with a committed lockfile per package, and exact pinned versions.
- Keep a short log of each working session in `notes/` (date, what was done, what was learned).
