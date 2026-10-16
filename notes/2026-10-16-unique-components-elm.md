# 2026-10-16: unique-components in Elm

## Done

- `scenarios/unique-components/elm.js`: one Elm module per widget (`Widget.<Label>`: `Model`,
  `Msg`, `init`, `update`, `view`, `decoder`, plus `tick` / the feed's item decoder where
  needed), written out from the description. `Main` holds the `Model` (a field per widget), a
  `Got<Widget>` message per widget routed with `Html.map`, the port and the snapshot decoder.
  Only `Ui` is shared, with generic helpers (`widget`, `when`, `option`, `nextId`, `toggleDone`,
  `onNumberInput`). No widget description is data at runtime.
- Output matches elm-format 0.8.8 (`--validate` is `[]` at every size 1 to 256, seeds 1 to 3).
- `./rr check unique-components elm` passes at sizes 1, 4, 16, 64 and seeds 1 to 3. Builds are
  byte-identical and work offline (`unshare -rn`). `shared-components elm` still passes.
- `runs.json`: `unique-components` / `elm`, sizes 1 to 256, seeds 1 to 3.

## Choices

- An `if` is a `let` binding of the view function: elm-format always lays an `if` out on
  several lines, which would wreck the markup layout otherwise.
- A conditional section is a view function (`viewSection`) called as `Ui.when cond (viewSection
  model)`. `when` renders `text ""` while the condition fails, so siblings keep their positions
  in Elm's non-keyed child diff (otherwise a section in the middle would shift its siblings and
  replace nodes or lose focus).
- Cross-widget reads: the reader's `view` takes the models it reads, before its own.
- Enum values stay `String` (options are data in the view, a `case` for cycle): option names
  repeat across widgets and fields, so a custom type per enum would need prefixes.

## Size (scratch, not committed; `/tmp/uc-elm`)

Median total br: N=1 7304, 16 13296, 64 26461, 256 70897. Fit over all sizes
8683 + 249.4 B/widget; N >= 16: 10593 + 238.7. Runtime is about 6.3 KB at N=1 and 7.0 KB from
N=32 on, so the slope is app code: about 247 B/widget compressed (1.46 KB raw).
shared-components in Elm for comparison: 8538 + 61.2 (N >= 16: 10124 + 52.3).
