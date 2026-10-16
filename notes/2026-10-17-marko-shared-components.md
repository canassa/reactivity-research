# 2026-10-17: Marko 6 as a real framework, first emitter (shared-components)

Set up `frameworks/marko/` (marko 6.4.6, @marko/vite 6.1.13 with `linked: false`, Vite 8.3.4,
`"type": "module"`, lockfile) and wrote `scenarios/shared-components/marko.js`. Details for the
next emitters are in `frameworks/marko/README.md`.

- **Build:** `vite build` runs in the generated app's directory in a child process. In-process
  from the repository root, Marko's compiler cannot find `marko/translator`: it locates the
  project from `process.cwd()`, once per process (`@marko/compiler/modules.js`).
- **Client-only:** `App.mount({}, root)`. SSR plus resume would be a different contract (HTML
  carrying the page), so it is out of scope; the README explains why.
- **Attribution:** the `$template`/`$walks` strings are unmapped, but each sits at the head of
  its own module, so `harness/sourcemap.js` (an unmapped character goes to the following source)
  already counts them as that template's app code. Checked run by run on N=16 s1: 15 runs, each
  followed by its own module. No special case in `classify`.
- **Adapter:** `dispatch` calls the root's `<return>`ed function; `settled` waits a microtask,
  an animation frame and a `MessageChannel` message. **Disposal:** without the workaround,
  `./rr check` reports 3 listeners (`click`, `input`, `reset`) left on `document`. The adapter
  records `document.addEventListener` calls while mounted and on dispose removes them and deletes
  the `"1" + type` mark (`event.ts:30-34`), as the owner accepted. A scratch run of the script
  twice in one page (dispose, then remount) passed both rounds with 0 listeners.
- **Emitter:** one tag per kind (`<kind>-widget`, since `<summary>` is a native element); every
  widget's state as `<let>`s in `app.marko`, bound down with `:=` to controllable `<let>`s;
  `<const>`, keyed `<for by>`, `<if>`, handlers in markup, controlled inputs. The number input
  keeps an invalid edit in a local `pending` `<let>`: a controlled `value:=` would reset it.
- **Checks:** `./rr check` passes at N = 1, 4, 16, 64, seeds 1-3 (0 mismatches, focus losses,
  keyed replacements; nothing left after dispose). Builds are byte-identical.
- **Sizes** (`./rr measure`, not committed; brotli, median of 3 seeds): N=1 3,243 B (runtime
  2,569, app 523, HTML 151); N=16 8,845 (runtime 4,241, app 4,455); N=64 12,640 (4,256 /
  8,235); N=256 24,879 (4,287 / 20,451). Fit over N >= 16: 8,156 B + 66.0 B/widget (R2 0.998);
  all sizes 5,981 + 78.3. Solid's committed fit over N >= 16 is 9,549 + 28.2: Marko has the
  smaller baseline and a much steeper slope.
- **Why the slope:** lifting the state costs per widget field a `<let>` signal in the root, a
  change closure, a resume registration (`x.a3=Ra`) and two setup calls, and each static
  attribute is a setup call (`_counterWidget_input_step($scope.a, 5)`). The field and amount
  tags call a function attribute as a method (`input.validate(text)`), so the parent passes the
  whole input object for them. A variant with widget-local state (each widget `<return>`s an API
  for the root's events and the summaries) would show how much of the slope the lifting costs;
  the investigation flagged it as worth measuring. Not done here.
- **Work** (`./rr work`, N 16 to 256): every local action is flat (median ratio 1.00, worst 1.35
  for a tick); only the snapshot grows (16x, global by nature).

## Review fixes

- **Widget-local variant** (`--state local`, variant `marko-state=local`): each tag owns its
  `<let>`s and `<return>`s its state with `set` (and `tick`/`notify`); the root builds the
  summaries from the tag variables and routes external events through them. Fit over N >= 16:
  **8,434 B + 55.2 B/widget** (R2 0.997), against root-lifted state's 8,195 B + 66.0 (the
  numbers above are "Marko, root-lifted state"). Medians (brotli): N=1 3,471 / N=16 8,985 /
  N=64 12,208 / N=256 22,407, against root 3,294 / 8,907 / 12,644 / 24,908. Work: every local
  action flat (worst a tick, 1.61x from N=16 to 256).
- **A Marko 6.4.6 compiler bug** met on the way: tag variables declared inside the dashboard
  `<div>` and read from the root are hoisted getters; read inside a function at the root they
  compile with a free `$scope` (`ReferenceError` on call), and read in a `<const>` before the
  tags they are not values yet. Declaring the readers inside the `<div>`, after the widgets,
  works; the root ends with `<return=receive>`.
- **Build target:** Marko's official Vite example (`marko-js/examples` `vite-express`) sets no
  target, so Vite's default stays. With `target: "esnext"` every bundle (54 builds) is
  byte-identical.
- **Stale amount edit:** after clearing the input, a later serverSet or snapshot never showed
  (`pending ?? value`). The edit now remembers the value it was made over. A scratch test (clear,
  serverSet, clear, snapshot) shows the new value in both variants.
- **Adapter:** removes only document listeners carrying Marko's `"1" + type` mark; a second
  `mount()` throws. **Build:** `NODE_ENV=production` in the child. **classify:** no bare `vite/`
  match. The polyfill was already tooling; Marko's runtime without it is 1,948 B (N=1) and
  4,019 B (N=16) brotli, seed 1.
- Checks pass for both variants at N = 1, 4, 16, 64, seeds 1-3; builds byte-identical.
