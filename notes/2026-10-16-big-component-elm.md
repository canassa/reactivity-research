# 2026-10-16: the Elm emitter for big-component

## Done

- `scenarios/big-component/elm.js`, derived from the unique-components emitter (same vocabulary,
  same expression compiler). One `Form` module with one flat `Model` record and one `Msg` (a
  constructor per control), a `Companion` module, `Main` with `{ form, companion }`.
- The view is split like a long Elm form is: `view` lists sections, a function per section and per
  group (fieldset), each taking the whole form `Model`. No `Html.Lazy`: one record changing on
  every message never hits `lazy`, and threading each group's exact fields is not what an expert
  writes.
- The form has more than 8 fields, so its decoder is an `andMap` pipeline (`Ui.andMap`).
- `./rr check` passes at N = 1, 4, 16, 64 with seeds 1-3; elm-format validates; builds are
  byte-identical twice.

## Learned

- Calls per action grow 10.4x from N=16 to 256 (2250 to 23401): linear, not constant. The record
  update copies every field of the 271-field `Model`, and the view diff walks the whole form.
  Elm is not held to locality.
- Fit over seeds 1-3: baseline 7714 B + 83.8 B per unit (R2 0.991); runtime is about 6.1 to 6.9
  KB, flat; the slope is all app code.
