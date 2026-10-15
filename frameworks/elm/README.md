# Elm 0.19.1

Shared by every Elm emitter (`scenarios/*/elm.js`).

- **Compiler:** the `elm` npm installer, pinned in `package.json` and `package-lock.json`. It
  brings the platform's binary as `@elm_binaries/<platform>_<arch>`, which `framework.js`
  runs directly.
- **Minifier:** `uglify-js`, pinned likewise, with the two passes from the Elm guide's
  [asset size page](https://guide.elm-lang.org/optimization/asset_size.html).
- **Elm packages:** pinned with exact versions in `template/elm.json`, which every generated
  app gets.

## Install (needs the network once)

```sh
npm ci      # in frameworks/elm/
```

The `postinstall` script (`install.js`) then compiles a throwaway program against
`template/elm.json`, so the compiler downloads every pinned package and builds it into
`node_modules/.elm-home/`. Every build runs with `ELM_HOME` set to that directory: it finds
everything there and never touches the network. Builds only read it, so the harness's
parallel workers (up to 32) share it safely. `npm ci` wipes `node_modules/` and runs the
pre-fetch again. After changing a package version in `template/elm.json`, run `node install.js`.

## Build

`framework.js`: `elm make src/Main.elm --optimize`, then the adapter is appended and the bundle
is minified in two uglify-js passes (compress with `pure_funcs`, then mangle) into
`dist/main.js`, next to an unminified `dist/index.html`. Elm writes no source maps, so the build
writes one that attributes each top-level declaration of Elm's output to the app
(`src/*.elm`), Elm packages or the kernel, and the adapter to `src/adapter.js`. uglify-js
composes it through both passes (see the comment at the top of `framework.js`).

Kernel code that uglify-js inlines into the app's functions (for example a tuple's `{a:…,b:…}`)
keeps its kernel source, so a few dozen compressed bytes that grow with the app count as runtime.
