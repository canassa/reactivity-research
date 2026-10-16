# beni (shared by beni-tea and beni-direct)

[beni](https://github.com/canassa/beni) is a statically typed ML-family language (Elm's
architecture and guarantees, JSX markup, no currying) whose compiler, written in Zig, emits
JavaScript. It is **unreleased** (pre-1.0, changing daily), but it is a real compiler with its
own production build, so both setups are on the `framework` track. It has two browser
platforms, measured separately from **one source**:

- [`beni-tea`](../beni-tea/): `browser-tea`, The Elm Architecture over compiled templates;
- [`beni-direct`](../beni-direct/): `browser-direct`, the same TEA program compiled to direct
  DOM writes, one function per message.

This directory holds what both setups share for every scenario. Each links these files into its
own directory (`beni.js`, `template/*`), so a change here changes both setups' measurement hash.
The dashboard's source, also shared, is `scenarios/dashboard/shared/beni.js`.

## The pinned compiler

- **Commit:** `6a1b567fad5410fe80c8bc4e0a1f6733279fd908`, beni's `origin/master` on
  2026-10-16 (`COMMIT` in `beni.js`).
- **Build:** beni's own instructions (`docs/getting-started.md`): its flake's dev shell
  (Zig 0.17.0, Node 24, pinned by its `flake.lock`) and `zig build -Doptimize=ReleaseFast`.
- **Identity:** `beni version` prints `beni 0.1.0-m1 ee040d874c1f0f73e43a0e7ef109007d`, a build
  id derived from the compiler's sources; `versions()` records it with the binary's sha256.

Build it once (needs the network once, for the sources and beni's Nix toolchain):

```sh
frameworks/beni/install.sh                       # sources from GitHub
BENI_REPO=~/src/beni frameworks/beni/install.sh  # or fetched from a local clone, which it leaves alone
```

It clones exactly that commit into `compiler/6a1b567fad54/` (gitignored, and named so the
measurement hash never reads it) and builds `compiler/6a1b567fad54/zig-out/bin/beni`. To move
to another commit, change `COMMIT` in `beni.js` and run it again. After that every app builds
offline.

## How an app is built

`beni.js` runs beni's production build in the generated app's directory:

```sh
beni build --release --source-maps --no-cache --jobs=1
```

`--release` is beni's own minifier (dead bindings out, short names, compact printing, its
`Minify.zig` for hand-written JavaScript), so nothing else minifies. The output is one
scope-hoisted ES module and its source map; `--jobs=1` because the harness builds apps in
parallel (beni's output is the same for every `--jobs`). Then the build:

- drops the `//# sourceMappingURL` comment (the maps are for attribution only, like the other
  setups' hidden maps);
- serves the module as `dist/_main.js`: the harness's static server gives `.mjs` no JavaScript
  type, and a browser refuses a module without one (the bytes are beni's);
- copies the adapter next to the page.

## The pieces every app gets (`template/`)

- **`Push.beni`, the project's platform layer.** beni has no ports (withdrawn, `boundary.md`
  §3.1): a binding the shipped platform lacks is written as the project's own platform layered on
  it. The layer (`platform/beni.json`, `"platforms": ["browser-tea"]` or `["browser-direct"]`)
  has one module, a subscription to a `window` event:

  ```elm
  pub onPush : (Value → msg) → Sub msg
  onPush tag = Sub.on Pushed (Listen.on "window" "rr-push" detail _) tag
  ```

- **`index.html`**, beni's page (`beni.json`'s `"html"`), with `{{entry}}` where the program's
  script goes, here in the adapter's `data-entry`.
- **`adapter.js`**, the contract (`window.rr`), not counted in the app's size:
  - `mount` imports the module (a beni program starts when its module is evaluated, mounting at
    `Browser.mountAt … "root"`); a second mount imports it again under a query string, a new
    module record, so it is a fresh program;
  - `dispatch` fires `rr-push` on `window`;
  - `settled` calls the module's exported `flush` ("render every program with a message
    waiting, now"; browser-direct writes while it handles an event and exports none), then
    waits one macrotask, for the zero-delay timeout with which beni puts a clicked checkbox back
    to the model;
  - `dispose`: **beni has no unmount** (`boundary.md` §9.8.14, "W51, unmount: not now"; a stopped
    page leaves its listeners on the document, inert). So the adapter does what that unmount
    would: it records the listeners the program adds to `window` and `document` while mounted
    and removes them, empties the root and clears the runtime's mark on it (`$$root`). This is
    the one place where the adapter reaches past beni's own API.

## Byte attribution

From beni's release source map: `../src/…` is the app; `beni:///core/…`, `beni:///platforms/…`
and the project's layer (`../platform/Push.beni`, the counterpart of Elm's port runtime) are
runtime. beni leaves hand-written JavaScript and its link step's glue unmapped; the build points
those stretches at a source of their own, `beni:///(unmapped)`, counted as runtime (otherwise
the harness would give them to the source that follows them, sometimes the app). The adapter is
its own file and bucket.

## The dashboard source

One generator, `scenarios/dashboard/shared/beni.js`, writes the app for both platforms
(`browser-direct`'s `Tea` is `browser-tea`'s API, "so one source builds on both"); the emitters
`scenarios/dashboard/beni-tea.js` and `beni-direct.js` only pick the framework. Its style is
described at its top and in each setup's README. Every generated module is laid out exactly as
`beni fmt` writes it:

```sh
cp -r generated/dashboard/n16-s1/beni-tea/src /tmp/src && frameworks/beni/compiler/6a1b567fad54/zig-out/bin/beni fmt /tmp/src
diff -r generated/dashboard/n16-s1/beni-tea/src /tmp/src   # no output
```
