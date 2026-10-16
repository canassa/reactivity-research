# 2026-10-17: routed-app in beni (both browser platforms)

## Done

- `scenarios/routed-app/shared/beni.js`, one generator for both platforms, and the emitters
  `beni-tea.js` and `beni-direct.js` (they only pick the framework's template files). The markup
  and update writers are adapted from `unique-components/shared/beni.js` (copied, not imported:
  that file exports only `emitApp`) to refs (`f`/`p`/`g`) and to three kinds of component.
- Style (header of the generator and every app's `rr.json`), after beni's Conduit example
  (elm-spa-example in beni: the model is the page the viewer is on):
  - `Main.Model = { route, menu, global, page }`; `page` is a custom type with a constructor per
    page (`P1 P1.Model | …`); entering a route replaces it with that page's `init`, which is the
    scenario's "page state resets on remount". `update` is a `case ( msg, model.page )`, whose last
    arm drops a message for a page that was left.
  - One module per page (`Page.P3`): `Model` (page fields; `panel : Panel` for tabs, `Panel`
    being a custom type with a constructor per tab; `modal : Maybe Modal`), a flat `Msg` (one
    constructor per message, `Visit String` for links, `ShowTabK`, `TickPage`/`TickTabK`),
    `update`, `view`, and `viewTabK`/`viewModal` for the panels and the modal. A tab's state is
    built by `ShowTabK`, the modal's by its open message, and both are dropped when they leave.
  - `Global` module: one record, `init`, `set` (a `serverSet`), `notify`, `replace` (a snapshot,
    `List.copy` for direct). A page that writes global state has
    `update : Msg, Model, Global → Model × Global`; one that does not has `Msg, Model → Model`.
    `Main.withGlobal` puts the pair back.
  - `Pages` module: the shell's table of pages (id, title), `pinned = List.take all 4`; nav bar
    and "All pages" menu are keyed `For`s over it. The menu exists only while open.
  - A link is the page's own `Visit route` message, which `Main` turns into navigation.
  - External events: `Push.onPush Pushed`, one subscription, read with `schema Event` tagged on
    "type". `pagePush` is handed to the page shown (`route == model.route`), dropped otherwise.
- **Timers.** beni's `Time.every` is a chain of `Task.sleep`s (`setTimeout` underneath), which
  breaks the scenario's "one `setInterval` per mounted field" and the virtual clock. So the
  emitter adds `platform/Interval.beni` beside `Push` (the project's own platform layer, written
  like `Push.beni`): `every ms tag = Sub.on (Every ms) (start ms _) λ_ → tag`, a `setInterval`
  whose remover is `clearInterval`. A page's `subscriptions : Model → Sub Msg` declares it only
  while the model holds that page (or that tab's panel); beni starts and cancels it
  ("No program ever unsubscribes"). Two declarations of one period share one timer.
- Generated source is `beni fmt`-clean except a very rare over-long derived expression (checked
  on N=1, 4, 16, 64, 256 and seeds 1 to 3: 0 to 3 differing lines).
- `runs.json`: `beni-tea` and `beni-direct` under `routed-app`, sizes 1 to 256, seeds 1 to 3.

## Checks

`./rr check routed-app <fw>` (script, no locality) at sizes 1, 4, 16, 64, 128, 256 and seeds 1 to 3
(a scratch copy of the check that lists every failing step): on both platforms 0 mismatches with
the reference render, 0 focus losses, no interval left running (the panel's `maxIntervals`
check), nothing left after dispose, no page errors. **The only failing rule is keyed-node
identity, from N = 4, and only for the nav bar's buttons** (`shell/pK|navLink`, 6 to 15 steps per
run, at the steps that move the current page between two pinned pages). N = 1 passes outright.

Builds are byte-identical on rebuild (tea 16 and 64, direct 16 and 64: `_main.js`, `index.html`
and `Main.beni` equal).

## Limit: `aria-current` is not removable (the big-table limit again)

The README fixes `aria-current="page"` on the current nav button and absent elsewhere. beni's
shipped vocabulary has `aria-*` only as `String` (`platforms/html/Html.beni` 645), written with
`setAttribute` and never removed, and a project cannot add its own attribute declaration
(`notes/2026-10-16-beni-big-table.md`, limit 1). So the nav button is written twice in an `if`
(with and without `aria-current`) and the two buttons whose mark changes are replaced. The page is
right at every step. `aria-selected` (always `"true"` or `"false"`) and `aria-expanded` need no
removal and are plain string holes. A one-line upstream change
(`pub attribute "aria-current" : Maybe String`, the exact name outranking the wildcard) plus a new
pin would fix it. `runs.json` keeps all sizes with a `$comment`; whether the owner counts them
until then is the owner's call (README, rule 2).

## Browser-direct has no size cap here

Every size up to 256 builds and checks on both platforms, all seeds. The 64-path width cap that
stops `shared-components` at 128 and `big-table` at 15 does not apply: `update`'s summary of
`Main` covers only `route`, `menu`, `global` and `page`, and each page's model is a different
constructor of one custom type, so no summary holds more than one page's paths. N = 256 takes about
25 s to build (tea 11 s).

## Measured (`./rr measure routed-app <fw> --out /tmp/rr-ra2-measure-*`, not committed)

Brotli bytes; N = 1 / 16 / 64 / 256, seed 1 (median of three seeds in brackets where it differs):

| | N=1 | N=16 | N=64 | N=256 | fit, all sizes |
|---|---|---|---|---|---|
| beni-tea total | 13 317 | 33 093 | 80 014 | 223 865 (227 172) | 17 498 + 841.4 B/page |
| runtime / app | 9 604 / 3 574 | 10 825 / 22 128 | 12 159 / 67 712 | 16 044 / 207 690 | |
| beni-direct total | 15 431 | 38 773 | 95 061 | 272 803 (275 057) | 20 149 + 1 022.1 B/page |
| runtime / app | 11 111 / 4 181 | 12 631 / 26 002 | 13 908 / 81 010 | 17 854 / 254 818 | |

HTML is 130 to 143 B. A page is a lot of code: its own `Model`, `Msg`, `update`, `view`, tab
panels and modal (about 2 widgets of `unique-components`, whose beni-tea slope is about 90 to
110 B/widget from N = 16: the page's module, the compiled templates and the page type's arms in
`Main` add up to about 750 B/page between N = 64 and 256 on tea, 930 on direct).

## Work (`./rr work routed-app beni-tea,beni-direct --sizes 16,256`, calls per action)

Median over the local actions 1.02× for both; every page event, navigation, tab, modal, timer
tick, snapshot and push to a page not shown is flat (tea 102 to 303 calls, direct 160 to 634):

| action | tea 16 → 256 | direct 16 → 256 |
|---|---|---|
| p1: add to an int | 103 → 105 | 183 → 188 |
| serverSet currency (p1 does not read it) | 127 → 129 | 177 → 182 |
| pagePush to a page not shown | 110 → 112 | 160 → 165 |
| navigate p1 → p2 | 195 → 197 | 369 → 374 |
| navigate p3 → p4 (starts its timer) | 243 → 247 | 389 → 398 |
| clock: one tick | 177 → 181 | 251 → 261 |
| app: dispose | 15 → 15 | 17 → 17 |
| **app: mount (shell and p1)** | **374 → 2 327 (6.2×)** | **998 → 9 726 (9.8×)** |
| menu: open (global by nature) | 253 → 2 415 | 262 → 987 |

**Mount grows with N** on both. It is not a page being built (no page but p1 is) but the module's
top level (not profiled further): the tea bundle creates every page's compiled templates when the
module is evaluated (`va("<main …>")` per template, about 8 calls per page), direct about 38
calls per page of per-page setup, and `Pages.all` is a 256-entry list. beni has no lazily loaded
modules. A prototype's locality rule (8× for 16× the size) would reject direct's
mount (9.8×); real frameworks are not held to it.

## What was learned

- Putting each page's model in a custom type held by `Main` is what keeps browser-direct inside
  its ownership checker at 256 pages, where the flat models of the dashboards stop at 128 and 15.
- Time is not in beni's `Time.every` for a scenario that asks for `setInterval`; the project's
  platform layer is the place for it, and it costs a page nothing beyond its `subscriptions`
  function.
- A tab panel as a custom type (`Panel1 Tab1 | Panel2 Tab2`) gives fresh state on `ShowTabK` and
  makes a stale tick or message for a panel that is gone a `_ →` arm, with no flag to keep in step.
