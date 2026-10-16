# 2026-10-17: Marko 6 on unique-components and big-component

## Done

- Emitters `scenarios/{unique-components,big-component}/marko.js`, both through the new
  `frameworks/marko/widgets.js` (one widget description to one tag; the two scenarios share their
  vocabulary). Added to `runs.json` (sizes 1..256, seeds 1-3).
- `./rr check` passes at sizes 1, 4, 16, 64 and seeds 1-3 for both (0 mismatches, 0 focus losses,
  0 keyed replacements, clean dispose). Builds are byte-identical. The two-events-in-one-task step
  had not landed on main.
- `./rr work` is flat for local actions (max ratio 1.10 on unique-components, 1.77 on
  big-component, from 16 to 256).

## Learned

- **State in each tag does not work in Marko 6.4.6.** The root cannot reach a child's state except
  through the tag variable, and a root `<return>` function that reads tag variables compiles to a
  module-level function with an undefined `$scope`; collecting them in a `<const>` gives the
  hoisting getters. External `serverSet`/`snapshot`/`tick` set every widget's state, so state
  lives in the root, bound down with `:=`.
- The big-component form is best written in the root template: a separate tag adds a binding per
  field (N=256: 37.0 KB against 29.7 KB; slope 126.9 against 98.6 B per field).
- `--layout object` (one `<let>` per widget): unique-components 377 against 391 B per widget,
  big-component 106.6 against 98.6 B per field. Not the bottleneck.
- Marko's per-widget cost on unique-components is 391 B (Solid 228): each widget compiles to a
  small signal graph (`_let_change`, `_or`, `_const` per field and binding, plus `$input_*`
  setters, `_resumed` registrations), whatever the layout.
- Baselines: unique-components 5.9 KB, big-component 4.9 KB; runtime about 4.0 KB flat from N=8.
