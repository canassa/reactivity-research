# vanilla

The floor CLAUDE.md asks for: what a careful developer writes by hand with no library, reported
with the real frameworks (`track: "real"`). Every other approach's size is set against it (the
plots' "ratio to vanilla").

## What is here

- `framework.js`: label, track, the template files, `classify`, the build and the versions.
- `template/`: the HTML shell, the Vite config and the contract adapter.
- `package.json` and `package-lock.json`: Vite 8.3.4 alone, pinned, as bundler and minifier.

**The floor is what a hand-writer ships.** The Vite config matches the other Vite setups
(`target: "esnext"`, hidden source maps) with one exception: `modulePreload: { polyfill: false }`.
The app is one script with no dynamic imports, and a hand-written page would not include Vite's
module-preload polyfill, which cost about 280 B brotli (15% of the N=1 app). The other frameworks
keep their tools' defaults, because they are measured as they ship.

There is **no runtime library**. The emitter writes everything as plain DOM code, and `classify`
puts it all in the app except `src/lib.js`. That file is a small generic helper an emitter may
write (big-table: the keyed reconciler for the server events and the snapshot). **It is
classified as runtime even though it is hand-written helper code**, so for vanilla the stacked
chart's "runtime" means "shared helpers", not a library. It must stay small and independent of
the app.

The adapter (`src/adapter.js`) maps the contract onto the app's `start(root)` →
`{ receive, stop }`. It contains no app logic, and `settled()` resolves right away because the app
writes the DOM synchronously in every handler. It is excluded from size.

## Emitters

- **big-table** (`scenarios/big-table/vanilla.js`): js-framework-benchmark's
  `frameworks/keyed/vanillajs`, once per table. Each table is its own module: a cloned `<tr>`
  template, its own row builder (Park–Miller draws), cell setters, operations and row controls,
  one delegated click listener on its section, plain mutable state in its closure, and
  vanillajs's fast paths (`textContent = ""` to clear, a detached `<tbody>` while an empty table
  fills, two `insertBefore` for a swap, the previously selected `<tr>` remembered). Only
  `serverRows`, `serverDelete` and the snapshot use the reconciler in `src/lib.js`. The style is
  recorded in the emitter's header and in every app's `rr.json`.

Other scenarios (shared-components, unique-components, big-component) have no vanilla emitter
yet. They could get one later, written the same way: each widget written out by hand as direct
DOM code, with shared building blocks moved here only if the emitters start to repeat each
other.
