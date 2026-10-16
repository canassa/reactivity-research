# Marko 6

Shared by every Marko emitter (`scenarios/*/marko.js`). Real-framework track (`track: "real"`),
measured as it ships. The investigation behind this setup, with what Marko compiles to and how
its runtime works, is `notes/2026-10-17-marko-rendering.md`; the Marko source it cites is the
`references/marko` submodule, pinned to the tag `@marko/runtime-tags@6.4.6`
(`git submodule update --init references/marko`).

## What is here

- `framework.js`: label, track, the template files, `classify`, the build and the versions.
- `template/`: `package.json`, the HTML shell, the Vite config and the contract adapter, which
  every generated app gets unchanged.
- `source.js`: helpers for emitters (attribute values as JavaScript literals; re-exports of
  `frameworks/shared/jsx.js`).
- `package.json` and `package-lock.json`: the pinned toolchain.

## Versions

Pinned exactly, with the lockfile:

- `marko` **6.4.6** (npm `latest`; the Tags API, published from the repo's
  `packages/runtime-tags`. The repo's own `marko` package is still Marko 5).
- `@marko/vite` **6.1.13** (`latest`), which brings `@marko/compiler` 5.42.12.
- `vite` **8.3.4** (`latest`; `@marko/vite` 6 needs Vite 8), bundling and minifying with
  Rolldown 1.2.14 and Oxc.

`framework.js` `versions()` reads the exact versions from the lockfile into every result.

## Install (needs the network once)

```sh
npm ci      # in frameworks/marko/
```

Builds then run offline. Each generated app's `node_modules` is a symlink to this directory's.

## Build

`vite build` in the generated app's directory, in a child process, exactly as `npm run build`
runs it there. It has to run there: Marko's compiler finds the project (its `package.json`, and
from its dependencies the translator, `marko/translator`) from the working directory, once per
process (`@marko/compiler/modules.js`), so a build started in-process from the repository root
fails with "Cannot find module 'marko/translator'". The child always gets
`NODE_ENV=production` (as Marko's Vite example builds: `cross-env NODE_ENV=production vite
build`), and `MARKO_DEBUG` is cleared from its environment, because it would override the
production setting.

`template/vite.config.js` is `@marko/vite`'s README example with `linked: false`, plus
`base: "./"` (relative asset paths, so the page can be served from any directory) and
`sourcemap: "hidden"` (source maps for byte attribution; the bundle is unchanged). In
production mode `@marko/vite` compiles with `optimize` (short accessors, no debug checks). The
output is one JavaScript bundle plus `index.html`.

**Build target: the official starter's.** The project's rule is that each real framework uses
its official starter's build configuration. Marko's default starter (`examples/basic` in
`marko-js/examples`, what `npm create marko` scaffolds) is a `@marko/run` app, which derives the
target from browserslist; it is a server app, not a client-rendered page. The official example
that matches this setup, Vite plus `@marko/vite` (`examples/vite-express`, checked 2026-10-17),
sets **no `build.target`**, so this config keeps Vite 8's default (`baseline-widely-available`)
and the default module-preload polyfill. (Solid's and vanilla's setups set `target: "esnext"`
because Solid's own Vite template does; that is their starter, not a project-wide setting.)
**Effect, measured:** with `target: "esnext"` the shared-components bundles are byte-identical
to the default target's, at every size, seed and state variant (2026-10-17, 54 builds each). The
compiled templates and Marko's runtime use nothing the default target lowers.

`template/package.json` has `"type": "module"`. Without it Rolldown wraps every module in a
lazy-init function and the bundle grows 11–14% (the investigation measured 10,251 against
9,027 B at N=64). Keep it.

## Client-only rendering

The app is **rendered in the browser**: `index.html` has an empty `<div id="root">` and the
adapter calls `App.mount(input, root)`, the public client API (`Template.mount` in
`references/marko/packages/runtime-tags/index.d.ts:111`, implemented in
`src/dom/template.ts:45-153`). There is no server render and no resume.

- **Why this is the fair mode here.** The contract is `mount(root)`: render the initial state
  into an empty root. Every other approach in this project is measured the same way, so the
  HTML is a near-empty shell for all of them and the JavaScript carries the whole UI. Marko's
  headline mode, server rendering plus *resume*, would ship a different thing: HTML holding the
  rendered page and its serialised state, and JavaScript only for the parts that can change.
  That is a different contract (and an SSR comparison would need every framework's SSR), so it
  is out of scope here, not dismissed.
- **Is it idiomatic?** It is supported and documented, but less common: Marko's guidance is
  written around `@marko/run` and SSR. `@marko/vite` with `linked: false` is its documented
  way to compile `.marko` files for a plain Vite page. The client-only bundle still carries a few
  resume leftovers that cannot be tree-shaken (`_resumed` registrations such as
  `x.a3=Ra`, a few bytes per handler); they are real shipped bytes and count.
- Record results as "client-rendered Marko".

## Attribution (`classify`)

- `node_modules/` (the Marko runtime, `marko/dist/dom*.mjs`) and Rollup/Vite virtual modules
  (sources starting with `\0`) → **runtime**.
- `src/adapter.js` → **adapter**, excluded from the app's size.
- Everything else, the compiled `src/**/*.marko` → **app**.
- **Vite's module-preload polyfill** never reaches `classify`: it has no mapping and comes
  before the first mapped character, so the measurement puts it in its **tooling** bucket
  (`harness/sourcemap.js`, `harness/measure.js`), the same for every Vite-built framework.

**The template strings.** Each compiled template starts with its `$template` HTML string and its
`$walks` string, and the source map has **no mappings** for them (about 2.9 KB raw of a 24.6 KB
bundle at N=16). The measurement gives an unmapped character to the source that follows it, and
in Marko's output that is always the template's own code: every unmapped run sits at the head of
one module, right before that module's first mapped character. So the strings count as app code
of the template they belong to, with no special case in `classify`. Checked run by run:

- N=16 seed 1: 15 unmapped runs, each the `$template`/`$walks` of the module that follows; the
  root's composed string (`` `<div data-role=dashboard>${e}${t}…` ``) is in `app.marko`'s run;
- N=1 seed 1: the polyfill's run (670 B raw) ends exactly at its closing `})();` and is
  followed by Marko's runtime (mapped); the counter's strings are a separate run after the
  runtime, followed by the counter's own code. Template strings never merge into the polyfill.

**What "runtime" means in the numbers.** `./rr measure` reports the brotli runtime as
`brotli(runtime + tooling)` for every framework, so its runtime figure includes the polyfill
(325 B brotli alone). Marko's runtime **without** the polyfill (brotli, shared-components, seed 1,
measured with the same bucketing): **1,948 B** at N=1 (one counter) and **4,019 B** at N=16
(every kind: `<if>`, keyed `<for>`, controlled inputs, checkboxes and selects), against 2,220 and
4,246 B with it. It is flat as N grows. The widget-local variant (below) adds about 160 B of
runtime for tag variables and hoisted reads.

## The adapter and the disposal compromise

`template/adapter.js` (excluded from size):

- `mount(root)`: `App.mount({}, root)`, where `App` is `src/app.marko`. A second `mount()` without
  `dispose()` throws ("the app is already mounted").
- `dispatch(msg)`: calls the root's tag variable, `mounted.value(msg)`. The root template
  `<return>`s one function that handles the external events. (If that function is a value
  declared deeper than the root, the tag variable is Marko's hoisted getter, which forwards its
  arguments to the function it reads, `src/dom/signals.ts:484-486`; the call is the same.)
- `settled()`: Marko has no public flush. A write schedules a microtask that renders, and later
  writes in the same frame render in a `MessageChannel` task posted from the next animation frame
  (`src/dom/schedule.ts:6-51`). `settled()` queues a microtask (so it runs after Marko's), waits
  for an animation frame, then for a `MessageChannel` message of its own, posted after Marko's.
  A hidden tab never runs the frame; headless Chrome does.
- `dispose()`: `mounted.destroy()` empties the root and tears down the branch tree, then the
  workaround below. A `dispose()` with nothing mounted does nothing.

**Known dependency on an undocumented runtime detail.** Marko delegates events: the first
handler (`_on`) or controlled input for an event type adds one capturing listener on `document`
and marks the handler function as registered with a property named after the type, `"1" +
type` (`src/dom/event.ts:30-34`, called from `event.ts:21-23` for handlers and
`controllable.ts:558-559` for controlled inputs, which register `input` and `reset`). Nothing
removes them, and there is no public API like Solid's `clearDelegatedEvents`; without the
workaround, `./rr check` reports 3 listeners (`click`, `input`, `reset`) left on `document` after
`destroy()` (verified 2026-10-17). The owner accepted this compromise, the same as Solid's
adapter:

- while the app is mounted, the adapter shadows `document.addEventListener` with a function that
  notes each capturing listener (`options === true`, a function handler) and forwards every call
  to `EventTarget.prototype.addEventListener`;
- on dispose it removes the shadow, then, for the noted listeners **whose handler carries Marko's
  `"1" + type` mark** (set right after the call, so it is checked at dispose), removes the
  listener and deletes the mark, so a later `mount()` registers it again. Listeners added by the
  serve panel or any other page code are never touched.

If a Marko upgrade renames that mark or moves the listeners, dispose will leave listeners (the
check reports it) or a remount will lose its events (the check's script fails after a reset).
Re-read `event.ts` and `controllable.ts` after every upgrade. Tested: the shared-components script
twice in one page (dispose, then remount) passes both rounds with 0 listeners left.

## Changes since the first setup (for emitter authors)

All backward-compatible; the root's contract with the adapter is unchanged.

- 2026-10-17: the build child process sets `NODE_ENV=production`; `classify` no longer matches a
  bare `vite/` substring (virtual `\0` modules and `node_modules` only; same buckets in practice);
  the adapter only removes Marko-marked document listeners, throws on a second `mount()` without
  `dispose()`, and tolerates `dispose()` with nothing mounted; the README documents the target
  policy and the hoisting pitfall below.

## Writing an emitter

An emitter returns `{ files, style }` like any other (see `scenarios/shared-components/marko.js`):

- `...templateFiles({ name, title })`, plus **`src/app.marko`**, the root template the adapter
  mounts, and its tags.
- **The root's contract with the adapter:** `src/app.marko` must `<return>` one function that
  applies an external event message (`<return=(msg) => { … }>`, or `<return=receive>` for a
  `<const/receive=(msg) => { … }>` declared elsewhere in the template). It owns (or reaches) the
  state those events change; Marko compiles assignments to signal calls. It receives no input.
- **Tags** go in `src/tags/<name>.marko`; they are auto-discovered by file name, with no import.
  Avoid names of native elements (`summary`, `output`, `select`…): shared-components suffixes
  its tags with `-widget`. Avoid directory and file names containing `test`, `build` or
  `example` (the `@marko/vite` known-templates glob skips them; harmless, but it changes ids).
- **Idiom** (from `node_modules/marko/cheatsheet.md`, which every emitter author should read):
  `<let/x=…>` for state, assigned in handlers; `<const/y=…>` for derived values; `static` for
  module-level constants and helpers; `<for|item, i| of=list by="id">` for keyed lists;
  `<if>`/`<else>`; `onClick() { … }` handlers in markup; `value:=x`, `checked=… checkedChange(…)`,
  `<select value:=x>` for controlled inputs; `<let/x:=input.x>` for state a parent may own;
  immutable updates only (`concat`, `toSpliced`, spreads); `<return>` plus a tag variable to hand
  a value or an API to the parent (`<child/api …/>`, then `api.value`, `api.set(…)`). There is no
  context API: lift shared state to the common parent and bind it down with `:=`, or let children
  own it and `<return>` it.
- **Syntax traps:** parenthesise comparisons in attribute values (`disabled=(n >= max)`; a `>`
  hugging a value ends the tag silently), and keep text at a template's root inside an element.
  Attribute values are JavaScript expressions: write data as literals (`source.js` `attrs`,
  `attrValue`). `<return>` cannot sit inside a native element.
- **Tag variables and hoisting (a compiler bug to avoid).** A tag variable read from outside the
  element body that declares it (for example a child `<w/x/>` inside `<div>`, read at the
  template root) is *hoisted*: it becomes a getter. Read in a `<const>` declared *before* the
  tag, it is not the child's value yet (shared-components hit `undefined` fields at mount).
  Read inside a **function** at the root, Marko 6.4.6 compiles the getter call with a free
  `$scope` and the function throws `ReferenceError: $scope is not defined` when called. The fix
  is to declare whatever reads tag variables **in the same body, after the tags**: the
  summaries' `<const>`s and the `<const/receive=…>` in shared-components' local variant sit
  inside the dashboard `<div>`, after the widgets, and the root ends with `<return=receive>`.
- **A number input** that must keep an invalid edit (empty, a lone `-`) cannot be a plain
  controlled `value:=n`: Marko resets a controlled input to its value after the change handler.
  Keep the edit in a local `<let/pending=null>`, the cheat sheet's pattern for uncommitted edits,
  but **remember which value it was made over**, or a later value from outside (a server event, a
  snapshot) never shows: `pending = { over: value, text }` and
  `<const/draft=(pending?.over === value ? pending.text : value)>` (shared-components'
  `amount-widget`).
- **What it compiles to matters for the slope.** Calling a function attribute as a method
  (`input.validate(text)`) makes the parent pass the whole `input` object (one `$input` signal)
  instead of one signal per attribute; a `:=` binding costs the parent a `<let>` signal, a change
  closure and a resume registration; a tag variable costs a `_var` registration. To see the
  compiled output of one template:
  ```js
  // in the generated app's directory
  require("./node_modules/@marko/compiler").compileFileSync("src/app.marko", { output: "dom", optimize: true }).code
  ```
- Check the generated app by hand with `./rr serve <scenario> marko`; `./rr check` is the quick aid.

## Emitters

- **shared-components** (`scenarios/shared-components/marko.js`): one tag per widget kind. Its
  `state` parameter (both measured, `runs.json`):
  - `root` (default, variant `marko`): every widget's state lifted into `app.marko` as `<let>`s
    bound down with `:=` to controllable `<let>`s in the kind tags; the root's `<return>`ed
    function assigns them for `serverSet`, `tick`, `notify` and `snapshot`. Fit over N >= 16:
    8,195 B + 66.0 B/widget.
  - `local` (variant `marko-state=local`): each tag owns its `<let>`s and `<return>`s its state
    with `set` (and `tick`/`notify`); the root reads the widgets' tag variables for the summaries
    and the external events. Fit over N >= 16: 8,434 B + 55.2 B/widget.

  The style is recorded in the emitter's header and in every app's `rr.json`.

- **unique-components** and **big-component** (`scenarios/*/marko.js`, both through
  `widgets.js`): each widget is its own tag and **all state is in the root template**. A layout
  with state in each tag and the root calling the returned API (`<widget/w1>`, `w1.set(…)` in the
  root's `<return>`ed function) does not compile correctly in 6.4.6: the function is emitted at
  module level with an undefined `$scope`, and a `<const>` collecting the tag variables holds the
  hoisting getters, not the values. The big-component form is written in the root template
  itself by default (`--form inline`); a separate tag only adds a `:=` binding per field (+25%
  at N=256). `--layout object` (one `<let>` per widget) is 3.5% smaller on unique-components and
  8% larger on big-component, so one `<let>` per field is the default.
