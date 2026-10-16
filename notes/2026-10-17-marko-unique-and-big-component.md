# 2026-10-17: Marko 6 on unique-components and big-component

## Done

- Emitters `scenarios/{unique-components,big-component}/marko.js`, both through the new
  `frameworks/marko/widgets.js` (one widget description to one tag; the two scenarios share their
  vocabulary). Added to `runs.json` (sizes 1..256, seeds 1-3).
- `./rr check` passes at sizes 1, 4, 16, 64 and seeds 1-3 for both (0 mismatches, 0 focus losses,
  0 keyed replacements, clean dispose). Builds are byte-identical. The two-events-in-one-task step
  had not landed on main.
- `./rr work` (16 to 256): local actions stay flat (max ratio 1.35 on unique-components, 1.77 on
  big-component, one input whose count steps from 48 to 85).

## Where state lives (measured, seeds 1-3, all sizes)

| | baseline | slope |
|---|---|---|
| unique-components, local (default) | 5.8 KB | 341 B/widget |
| unique-components, root, `:=` per field | 5.9 KB | 399 B/widget |
| unique-components, root, object per widget | 5.9 KB | 377 B/widget (before the number-input fix) |
| big-component, local, form tag (default) | 5.1 KB | 101.3 B/field |
| big-component, local, form in the root | 5.1 KB | 101.4 B/field |
| big-component, root, form in the root | 4.9 KB | 101.2 B/field |
| big-component, root, form tag | 5.0 KB | 126.9 B/field |

Local is the idiom and the smaller one on unique-components (-14% slope). On big-component the
form costs the same wherever it is written, as long as its state is its own; a form tag with its
fields bound from the root pays a `:=` binding per field (N=256: 37.0 KB against 29.7 KB).
Solid's unique-components slope is 228 B/widget: Marko compiles each widget to a signal graph
(`_let`, `_or`, `_const` per field and binding, `_resumed` registrations) and `:=` adds more.

## Learned

- My first attempt at local state failed on the 6.4.6 hoisting trap (a root function reading tag
  variables gets an undefined `$scope`; a `<const>` before the tags holds getters) and I fell back
  to root state. The shared-components session found the fix (declare the router after the tags,
  inside the element) while I was working; with it local state works, and wins.
- The number input must remember the value its pending edit was made over, or a value from
  outside never shows (same finding as shared-components).
- The Marko runtime is about 3.9-4.4 KB (brotli) from N=16, flat as the apps grow.
