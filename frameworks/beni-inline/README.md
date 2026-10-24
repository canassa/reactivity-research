# beni on browser-inline

beni's `browser-inline` platform (beni's `docs/design/browser-inline.md`): the same Elm
Architecture program, compiled whole where its constructor (`Tea.element`) is called, with no
task kernel, no `Dict` and no run-time renderer to fall back on. What it cannot compile exactly
is a build error, never a fallback. beni is unreleased; the compiler is pinned to commit
`2556986c6` and built from source: see [`../beni/README.md`](../beni/README.md) for the pin, the
build and the byte attribution. (beni's earlier platforms, `browser-tea` and `browser-direct`,
were measured here as `beni-tea` and `beni-direct` until 2026-10-17; their results stay in
`results/`, their setups were dropped when the rewrite began.)

## How the app is written

From the generators in `scenarios/<scenario>/shared/beni.js`, one beni source per scenario:
`browser-inline`'s `Tea` keeps `browser-tea`'s signatures, so the source written for the earlier
platforms builds unchanged. The page (`index.html`) and the project's platform layer
(`Push.beni`, `"platforms": ["browser-inline"]`) are the shared ones.

## The adapter (`template/adapter.js`)

- `mount` imports the module (a second mount under a query string, a fresh module record);
- `dispatch` fires `rr-push` on `window`;
- `settled` resolves once the module has loaded: the platform writes the DOM synchronously inside
  each dispatch, so there is nothing to flush or wait for;
- `dispose` calls the module's exported `stop`, the platform's unmount, which removes the
  program's root node, its listeners and its timers. It needs none of the listener patching or
  `$$root` clearing the shared adapter does for a platform without an unmount.

## Status: slice S1 builds only the apps without keyed lists

S1 compiles holes and handlers, but not a `For` and not a non-property attribute whose value
changes ("A limit of the compiler", class 1). Its bar is the `--lists none` variant of
unique-components and big-component, which builds and passes `./rr check` at every size; the
other apps are refused at build time (`notes/2026-10-25-beni-inline-s1-pin.md`):

- shared-components, unique-components, big-component (default lists): `For`, and in
  shared-components also a changing `aria-expanded`; shared-components builds at N=1 only.
- big-table, derived-graph, routed-app: `RECORD MAY BE SHARED` from the record ownership check
  (beni issue #879); at N=1, big-table and routed-app hit `For` first.

beni-inline is in no scenario of `runs.json` yet.

```sh
frameworks/beni/install.sh                    # once: the pinned compiler
./rr check unique-components beni-inline --lists none
```
