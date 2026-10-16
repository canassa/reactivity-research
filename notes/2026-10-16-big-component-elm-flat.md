# 2026-10-16: the Elm emitter for the flat big-component

## Done

- `scenarios/big-component/elm.js` no longer assumes sections and fieldsets. The form's view is
  split per field unit: each top-level node is assigned to the latest unit (from `units()` in
  spec.js) whose field it reads or writes, runs of one unit become `viewX : Model -> List (Html Msg)`
  named after the unit's main field, and `view` is `Ui.widget ... (List.concat [ ... ])`. A unit's
  own wrapper group stays inline; `when` sections and list items are helpers as before.
- `./rr check big-component elm` passes at N = 1, 4, 16, 64 with seeds 1-3 (`--no-locality`);
  elm-format validates the output (N = 16 and 256); the N = 16 build is byte-identical twice.

## Numbers

- `./rr work`: calls per local action grow 10.1x from N=16 to 256 (3256 to 32971): linear, as
  before; Elm is not held to locality.
- `./rr measure` (not committed), seeds 1-3: N=1 about 7.0 KB, N=16 9.4-9.8 KB, N=64 13.8-14.3 KB,
  N=256 28.7-30.0 KB; fit baseline 7792 B + 86.2 B per unit (R2 0.992). Runtime flat at about
  6.1-6.9 KB.
