# 2026-10-16: Elm 0.19.3, and a review of the generated Elm

## Done

- **Upgrade.** Elm 0.19.1 → **0.19.3** (npm `elm@0.19.3-0`, the `latest` dist-tag; GitHub
  release 2026-10-02, not a pre-release, "no language changes"). `elm-version` in
  `template/elm.json` is now 0.19.3. The Elm packages were already at their latest releases
  (core 1.0.5, browser 1.0.2, html 1.0.1, json 1.1.4, regex 1.0.0, virtual-dom 1.0.5,
  time/url 1.0.0). The guide's asset-size page still recommends the same two uglify-js passes,
  and uglify-js 3.19.3 is still the latest. The package cache moved to
  `node_modules/.elm-home/0.19.3/`. Builds still run offline (`unshare -rn`) and are
  byte-identical when repeated.
- **elm-format 0.8.8** is pinned as a dev dependency, only to check the layout
  (`elm-format --validate`), not in the build.
- **Review.** Checked the output against the guide (Structure, Ports, Optimization), the
  package docs, elm-format and elm-review (NoUnused.*, Simplify, elm-review-common, run from
  a scratch config on 27 apps, sizes 1 to 256, seeds 1 to 3). Fixed in the emitter:
  - layout: three blank lines before section comments, sorted exposing lists, no parentheses
    around function applications in `++` chains. All 27 apps now match elm-format exactly;
  - NoUnused.Exports: `Toggles.count`, `Todo.left` and `Filter.matches` are exposed only when a
    summary reads them, and `Ui.dataKey` only when a kind imports it. `Ui.ariaFlag` is written
    only when tabs, panel or rating are present;
  - NoUnused.Dependencies: `elm/regex` is in `elm.json` only when a pattern rule exists;
  - NoPrematureLetComputation: the todo's `nextId` moved into the branch that uses it;
  - `Decode.at [ "state", "widgets" ]` in place of nested `Decode.field`.
  All 27 apps now pass the elm-review rule set with no errors.
- `./rr check dashboard elm` passes at sizes 1, 4, 16 and 64, seeds 1 to 3, and so does
  `./rr check dashboard all`.

## Size (scratch measurement, not committed)

N=1 median 6850 B br (was 6818). Fit over all sizes: 8538 + 61.2 B/widget (was 8519 + 61.4).
For N ≥ 16: 10124 + 52.3 (was 10113 + 52.4). The compiler upgrade adds about 20 B of runtime.
The emitter changes move totals by ±40 B, which is noise. The fixes are about idiom, not size.

## Learned

- elm-format 0.8.8 sorts `exposing` lists alphabetically (upper case first).
- elm-review `--template` hits GitHub's anonymous rate limit after a few runs. A local review
  config, with packages installed through `elm install`, avoids it.
- The structure (nested TEA with `Html.map`, one module per kind, organised around its types)
  is what the guide says to avoid when building "components" for their own sake. Under the
  owner's shared-components rule, it is the form elm-spa-example uses for pages, and the right
  way to write it.

## Left alone

- No `Html.Lazy`: the guide presents it as an optimization for expensive views.
- A local `andMap`, not NoRedInk/elm-json-decode-pipeline: both are common, and the local one
  adds no dependency.
- The port stays in `Main`: with a single port, that is how the guide's own example does it.
- The adapter: initialising on a child node, a single `Value` port, waiting two frames in
  `settled`, and removing nodes in `dispose` is already the cleanest use of Elm's mechanisms.
  Elm has no unmount API.
