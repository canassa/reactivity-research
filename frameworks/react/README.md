# React 19

Shared by every React emitter (`scenarios/*/react.js`). Real-framework track (`track: "real"`),
measured as it ships, client-rendered (`createRoot`), as create-vite's React templates set it up.

## What is here

- `framework.js`: label, track, the `compiler` parameter, the template files, `classify`, the
  build and the versions.
- `template/`: the HTML shell, the two Vite configs and the contract adapter, which every
  generated app gets unchanged (`package.json` is written by `templateFiles`).
- `package.json` and `package-lock.json`: the pinned toolchain.

## Versions

Pinned exactly, with the lockfile. These are what create-vite **9.3.3** (npm `latest`,
2026-10-29) writes for `--template react` and `--template react-compiler`, resolved to their
latest matching releases:

- `react` and `react-dom` **19.3.1**, which bring `scheduler` 0.27;
- `@vitejs/plugin-react` **6.1.2**, `vite` **8.3.5** (Rolldown and the Oxc minifier);
- for `compiler=on` only: `babel-plugin-react-compiler` **1.0.0**, `@rolldown/plugin-babel`
  **0.2.4**, `@babel/core` **7.29.7** (the template's `^0.2.4` and `^7.29.7`; newer majors exist,
  0.3.0 and 8.0.9, but the official template does not use them).

`framework.js` `versions()` reads the exact versions from the lockfile into every result.

## Install (needs the network once)

```sh
npm ci      # in frameworks/react/
```

Builds then run offline. Each generated app's `node_modules` is a symlink to this directory's.

## Build

`vite build` (in-process, `mode: "production"`), with create-vite's config plus `base: "./"`
(relative asset paths) and `sourcemap: "hidden"` (source maps for byte attribution; the bundle is
unchanged). No `build.target`: the template sets none, so Vite 8's default
(`baseline-widely-available`) and its module-preload polyfill apply, as for Marko. The output is
one JavaScript bundle plus `index.html`. React's production builds (`react.production.js`,
`react-dom-client.production.js`) are selected by `process.env.NODE_ENV`, which Vite replaces.

## The `compiler` parameter

React's docs now recommend the React Compiler, and create-vite offers it as its own template
(`react-compiler`), but the default `react` template leaves it off. Both are measured:

- `compiler=off` (default): `plugins: [react()]`, `template/vite.config.js`;
- `compiler=on`: `plugins: [react(), babel({ presets: [reactCompilerPreset()] })]`,
  `template/vite.config.compiler.js`, exactly the `react-compiler` template's config. The
  compiler memoizes components and hooks automatically and imports `react/compiler-runtime`.

**The source is the same in both.** Emitters write plain React with no manual `memo`,
`useMemo` or `useCallback`, as the docs recommend for code the compiler handles, and as an
expert writes React without the compiler when nothing is measurably slow (re-rendering never
replaces DOM nodes, so node identity holds either way).

## Attribution (`classify`)

- `node_modules/` (React, ReactDOM, the scheduler, `react/compiler-runtime`) and virtual modules
  (`\0…`) → **runtime**.
- `src/adapter.jsx` → **adapter**, excluded from the app's size. It imports `flushSync` and
  `StrictMode`, both in modules the app ships anyway (`react-dom` is one module, not
  tree-shaken), and `react-dom/client`'s `createRoot`.
- Everything else → **app**.
- Vite's module-preload polyfill has no mapping and lands in the **tooling** bucket, as for every
  Vite-built framework.

## The adapter

`template/adapter.jsx`. The app's root component is `src/App.jsx`'s default export, rendered as
`<StrictMode><App events={events} /></StrictMode>` (StrictMode as create-vite's `main.jsx`; it
does nothing in production).

- **External events.** `events.subscribe(listener)` returns the unsubscribe function. The app
  subscribes in an effect, `useEffect(() => events.subscribe(…), [events])`, the way React's docs
  connect a component to an outside system, and turns each message into a state update.
- `mount(root)`: `createRoot(root)`, then `root.render(…)` inside `flushSync`, so the first render
  and its effects (the subscription) have run when `mount` returns.
- `dispatch(msg)`: calls the subscribers inside `flushSync`, so the DOM and the handlers' state
  are current before the caller goes on in the same task.
- `settled()`: user events are discrete, and React renders their updates synchronously in a
  microtask after the event; `flushSync()` with no callback renders any such work still pending.
- `dispose()`: `root.unmount()`, then the workaround below.

**Known dependency on an undocumented ReactDOM detail.** `createRoot` calls
`listenToAllSupportedEvents`, which adds a capturing and a bubbling listener for every event type
React supports to the container, and one `selectionchange` listener to the document, and marks
both with a property `_reactListening<random>` so a second root on the same container adds none
(`react-dom-client.production.js`, `listenToAllSupportedEvents`). Unmounting removes none of
them, so without the workaround they stay on the (still connected) root after dispose. As with Solid's
`clearDelegatedEvents` and the Marko adapter: while `createRoot` runs, the adapter shadows
`addEventListener` on the container and the document and notes each listener; on dispose it
removes exactly those and deletes React's marks, so a later `mount()` registers them again.
Listeners added by anything else are never touched. Re-read `listenToAllSupportedEvents` after
every upgrade.

## The harness and controlled inputs

React keeps a value tracker on each input element (it redefines `value` on the element itself)
and ignores an `input` event whose value equals the tracked one. A script that types by assigning
`input.value = …` updates the tracker, so React sees no change and never calls `onChange`; real
typing does not go through that property. The serve panel and `./rr work` therefore set the
value through the prototype's setter (`HTMLInputElement.prototype`'s `value`), which is what
typing does and changes nothing for the other frameworks. `./rr bench` types through the
DevTools protocol and needs nothing.

## Writing an emitter

An emitter returns `{ files, style }` like any other (see `scenarios/shared-components/react.js`):

- `export const params = { ...params }` from `framework.js` (the `compiler` switch), and
  `...templateFiles({ name, title }, options)`, plus **`src/App.jsx`** and what it imports.
- **Idiom**, from react.dev: function components and hooks; state lifted to the closest common
  parent when several components read it, shared through a context when it is many levels deep;
  updater functions (`setX((x) => …)`) when the next state depends on the previous one, so two
  events before a render both apply; immutable updates; lists with `.map` and a stable `key`;
  `&&` or a ternary for conditional content; derived values computed during render (no state
  that mirrors props, no effects to derive state); controlled inputs with `onChange`; effects only
  to synchronise with outside systems (here, the external events). No manual memoization.
- **Number inputs:** a controlled `<input type="number">` is written back to its state's value
  after every change event, so a text that is not a number yet (empty, a lone `-`) would be
  replaced. Keep a draft of such text in local state and drop it when the value changes, with
  the docs' "adjusting some state when a prop changes" (compare the slice to the one last seen,
  during render).
