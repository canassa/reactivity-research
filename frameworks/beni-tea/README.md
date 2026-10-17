# beni on browser-tea

beni's `browser-tea` platform: The Elm Architecture written in beni over the `browser` platform,
whose markup lowering compiles each `view` site to a template that is cloned once and patched
where a value changed (a port of dom-expressions' compiler), rendering once per task on a
microtask. beni is unreleased; the compiler is pinned to commit `ca8b52fb0` and built from
source: see [`../beni/README.md`](../beni/README.md) for the pin, the build, the adapter and the
byte attribution, which this setup shares with [`beni-direct`](../beni-direct/).

## How the app is written

The emitter (`scenarios/shared-components/beni-tea.js`, generator in
`scenarios/shared-components/shared/beni.js`) writes the app the way beni's README, its getting-started
guide and its Conduit example write one:

- **One module per widget kind** (`src/Widget/Counter.beni`, …), written once: a `Config` for
  what varies per instance, a `Model`, a `Msg`, `update`, `view` (markup) and `replace` (its
  state read from what the host sent, with a derived codec):

  ```elm
  pub update : Config, Msg, Model → Model
  update config msg model =
      case msg of
          Increment →
              { model | value = min config.max (model.value + config.step) }
          …

  pub replace : Value, Model → Model
  replace state model = Result.withDefault (Json.decodeValue state) model
  ```

- **`Main`** holds only per-widget data and routing: one `Config` value per widget, one `Model`
  field and one `Msg` constructor each, `Html.map` in `view`, and the summaries' lines computed
  from the model with string interpolation:

  ```elm
  designTickets : Counter.Config
  designTickets = { id = "w1", label = "Design tickets", step = 5, min = 0, max = 20, start = 0 }

  view model =
      <div data-role="dashboard">
          {Html.map (Counter.view designTickets model.designTickets) DesignTickets}
          …
  ```

- `Tea.element` (needed for its subscriptions), mounted with `Browser.mountAt … "root"`.
- Keyed `<For keyed={.id}>` for todo, filter and feed items, positional `<For keyed={False}>`
  for toggles and tabs; conditional content is a `case`/`if` hole whose other branch is `<></>`.
- **External events** arrive through `Push.onPush Pushed` (the project's platform layer) and are
  read in `update` with a `schema` declaration, tagged on `"type"`:

  ```elm
  schema Event tagged "type" of
      ServerSet as "serverSet"
          widget : String
          state : Value
      Tick as "tick"
      …
  ```

- **Inputs are controlled** (beni puts an input back to the model after each event), so the
  amount widget keeps the text typed beside its last valid number: while the input holds no
  number it keeps what the user typed and the number stays.
- A list read from the host is copied (`List.copy`) where the model takes it: browser-direct's
  ownership checker asks for it, and the source is shared.

## Build, check, measure

```sh
frameworks/beni/install.sh                 # once: the pinned compiler
./rr check shared-components beni-tea --size 64    # the interaction script in headless Chrome
./rr serve shared-components beni-tea --local      # by hand
./rr measure shared-components beni-tea --out /tmp/beni-tea-m
```

The build is `beni build --release --source-maps` (beni's own minifier); the bundle is one ES
module, `dist/_main.js`.

## What it ships

Measured 2026-10-16 (sizes 1–256, seeds 1–3, brotli 11), next to the setups of
`results/2026-10-16-shared-components-3/`:

| | N=1 total | baseline + slope, all sizes | baseline + slope, N ≥ 16 |
|---|---|---|---|
| beni-tea | 9 298 B | 13 931 + 112.5 B/widget | 17 659 + 91.4 B/widget |
| Elm 0.19.3 | 6 851 B | 8 533 + 61.1 | 10 120 + 52.2 |
| Solid 1 | 6 583 B | 8 293 + 35.8 | 9 652 + 28.1 |

The runtime is about 7.9 kB brotli at N=1 and 10.5 kB once every kind is present: beyond the
template runtime (`browser/Rt.beni`), `Tea.element` brings core's fiber runtime (`Task`), `Dict`
(its command and subscription tables) and part of `Schema`. The app's code grows about 90 B per
widget from N=16 on.
