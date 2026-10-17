# beni on browser-inline

beni's `browser-inline` platform (beni's `docs/design/browser-inline.md`): the same Elm
Architecture program, compiled whole where its constructor (`Tea.element`) is called, with no
task kernel, no `Dict` and no run-time renderer to fall back on. What it cannot compile exactly
is a build error, never a fallback. beni is unreleased; the compiler is pinned to commit
`ca8b52fb0` and built from source: see [`../beni/README.md`](../beni/README.md) for the pin, the
build and the byte attribution, shared with [`beni-tea`](../beni-tea/) and
[`beni-direct`](../beni-direct/).

## How the app is written

Exactly as for beni-tea, from the same generators (`scenarios/<scenario>/shared/beni.js`):
`browser-inline`'s `Tea` keeps `browser-tea`'s signatures, so one source builds on all three
platforms. The page (`index.html`) and the project's platform layer (`Push.beni`,
`"platforms": ["browser-inline"]`) are the shared ones.

## The adapter (`template/adapter.js`, its own)

- `mount` imports the module, as for the other two (a second mount under a query string, a
  fresh module record);
- `dispatch` fires `rr-push` on `window`;
- `settled` resolves once the module has loaded: the platform writes the DOM synchronously inside
  each dispatch, so there is nothing to flush or wait for;
- `dispose` calls the module's exported `stop`, the platform's unmount, which removes the
  program's root node, its listeners and its timers. It needs none of the listener patching or
  `$$root` clearing the shared adapter does for a platform without an unmount.

## Status: the first slice (S0) builds no generated app

S0 compiles only the minimal view (one text binding, written in place in `Main`'s `view`). The
generated apps compose widget modules through `Html.map (W.view model.w) WMsg`, so every one is
refused at build time with beni's "A limit of the compiler" diagnostics (class 1, *not compiled
yet*): a hole that is not text, and markup returned by a widget's `view`. They should build once
the later slices land.

```sh
frameworks/beni/install.sh                    # once: the pinned compiler
./rr check unique-components beni-inline --size 1
```
