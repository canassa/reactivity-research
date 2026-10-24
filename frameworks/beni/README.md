# beni (shared by every beni setup)

[beni](https://github.com/canassa/beni) is a statically typed ML-family language (Elm's
architecture and guarantees, JSX markup, no currying) whose compiler, written in Zig, emits
JavaScript. It is **unreleased** (pre-1.0, changing daily), but it is a real compiler with its
own production build, so its setups are on the `framework` track. One browser platform is
measured today:

- [`beni-inline`](../beni-inline/): `browser-inline`, The Elm Architecture program compiled
  whole at its constructor's call, with no task kernel (in progress: slice S1, holes and
  handlers, has no keyed lists yet).

Two earlier platforms, `browser-tea` (TEA over compiled templates, rendered once per task) and
`browser-direct` (the same program compiled to direct DOM writes, one function per message),
were measured here as `beni-tea` and `beni-direct` until 2026-10-17, at the pin `6a1b567fa`.
Their setups were dropped when the direct platform's rewrite began; their results stay in
`results/` and their notes in `notes/`.

This directory holds what the setups share for every scenario. Each links these files into its
own directory (`beni.js`, `template/*`; the contract adapter is each setup's own), so a change
here changes every setup's measurement hash.
The dashboard's source, also shared, is `scenarios/shared-components/shared/beni.js`.

## The pinned compiler

- **Commit:** `2556986c68fa4d20a97245c83b0123f6ca7c1539`, beni's `master` on 2026-10-24, where
  the owner closed `browser-inline`'s slice S1 (`COMMIT` in `beni.js`). Before it, `ca8b52fb0`
  (2026-10-17, the first slice, which built no generated app), and before that `6a1b567fa`; the
  results of 2026-10-16 and earlier were measured with `6a1b567fa`.
- **Build:** beni's own instructions (`docs/getting-started.md`): its flake's dev shell
  (Zig 0.17.0, Node 24, pinned by its `flake.lock`) and `zig build -Doptimize=ReleaseFast`.
- **Identity:** `beni version` prints `beni 0.1.0-m1 36b93dcdce3d0a071bf39f0eb21d22e8`, a build
  id derived from the compiler's sources; `versions()` records it with the binary's sha256.

Build it once (needs the network once, for the sources and beni's Nix toolchain):

```sh
frameworks/beni/install.sh                       # sources from GitHub
BENI_REPO=~/src/beni frameworks/beni/install.sh  # or fetched from a local clone, which it leaves alone
```

It clones exactly that commit into `compiler/2556986c68fa/` (gitignored, and named so the
measurement hash never reads it) and builds `compiler/2556986c68fa/zig-out/bin/beni`. To move
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
  it. The layer (`platform/beni.json`, `"platforms"` naming the setup's platform) has one
  module, a subscription to a `window` event:

  ```elm
  pub onPush : (Value → msg) → Sub msg
  onPush tag = Sub.on Pushed (Listen.on "window" "rr-push" detail _) tag
  ```

- **`index.html`**, beni's page (`beni.json`'s `"html"`), with `{{entry}}` where the program's
  script goes, here in the adapter's `data-entry`.
- The contract adapter (`window.rr`, not counted in the app's size) is **each setup's own**
  (`frameworks/<setup>/template/adapter.js`), because what `settled` and `dispose` have to do
  depends on the platform: see the setup's README.

## Byte attribution

From beni's release source map: `../src/…` is the app; `beni:///core/…`, `beni:///platforms/…`
and the project's layer (`../platform/Push.beni`, the counterpart of Elm's port runtime) are
runtime. beni leaves hand-written JavaScript and its link step's glue unmapped; the build points
those stretches at a source of their own, `beni:///(unmapped)`, counted as runtime (otherwise
the harness would give them to the source that follows them, sometimes the app). The adapter is
its own file and bucket.

## The dashboard source

One generator, `scenarios/shared-components/shared/beni.js`, writes the app (every beni browser
platform keeps `Tea`'s signatures, so one source builds on each); the emitter
`scenarios/shared-components/beni-inline.js` only picks the framework. Its style is described at
its top and in the setup's README. Every generated module is laid out exactly as `beni fmt`
writes it:

```sh
cp -r generated/shared-components/n16-s1/beni-inline/src /tmp/src && frameworks/beni/compiler/2556986c68fa/zig-out/bin/beni fmt /tmp/src
diff -r generated/shared-components/n16-s1/beni-inline/src /tmp/src   # no output
```
