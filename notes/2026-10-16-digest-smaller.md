# 2026-10-16: a smaller digest

## Done

- Handlers go to controls by position. A widget's handlers are written in the order of its
  template's controls (buttons, inputs, selects), and `widget()` stores each one on its
  control (`c.h`). The delegated listener calls `t.h(t)` and digests the target's widget. The
  handler maps keyed by `data-role` are gone.
- Bindings name elements by their position in the template (`text(3, …)`), on both scenarios.
  shared-components no longer queries `data-role` (`role`, `roles`, `$` are gone); repeated
  controls use the stride (toggles: element 4 + 3i).
- List item handlers are created with the item and close over `r` (`r.i.done = t.checked`,
  `filter((i) => i != r.i)`), so there is no `data-key` or id lookup on an item event.
- `run` is a `for…of`, and so are the list's loops: a binding costs one call, not two.
- A reader copies its bindings into its sources' lists (`W[k].push(...B)`) instead of pushing a
  closure that runs its whole list.
- shared-components: summary sources are distances back, and a list summary has no prefix.
- Conditionals on shared-components swap with an empty text node, like unique-components.

## Numbers

Brotli totals, `runs.json` (sizes 1 to 256, seeds 1 to 3), Node 26.11.1, Vite 8.3.4, Rolldown
1.2.14:

| | N=1 | N=16 | N=256 | all sizes | N ≥ 16 |
|---|---|---|---|---|---|
| shared, before | 1,068 | 3,298 | 7,810 | 2,172 + 24.26 | 3,203 + 18.45 |
| shared, after | 1,059 | 3,196 | 7,648 | 2,105 + 23.86 | 3,097 + 18.27 |
| unique, before | 1,445 | 5,551 | 44,363 | 2,520 + 168.7 | 3,983 + 160.5 |
| unique, after | 1,438 | 5,282 | 41,281 | 2,458 + 156.6 | 3,835 + 148.8 |

Calls (`./rr work`, seed 1, sizes 16 to 256), record by record: none higher. Totals 15,257 →
12,059 (shared), 32,025 → 19,977 (unique).

`./rr check` passes on both at sizes 1, 4, 16 and 64, seeds 1 to 3, locality included (worst
5.1×, unique n=64 seed 2, a tick; it was 4.3×: the other actions got cheaper, the tick did not).
Builds are byte-identical twice.

## Tried, didn't help

- A helper for the number-input check: −63 B at N=256 before its own cost, and a call per
  keystroke. Dropped.
- Constant-folding `+ -2` to `- 2` in clamped adds: noise. Dropped.
- Dropping optional closing tags on unique-components: about −0.8 B/widget offline. Not adopted,
  same verdict as on shared-components.

## Learned

- **A name that a widget uses twice costs bytes even under brotli.** The role names occurred
  once in the template and once as handler keys; the second copy cost 2 to 3 bytes per handler,
  about 11 B per widget on unique-components (7% of the bundle). Repeated boilerplate, on the
  other hand, is nearly free: helpers that shorten it (the number check, `model`) never pay.
- **Fewer calls and fewer bytes went together here.** Positions replace lookups, closures
  replace id searches, `for…of` replaces callbacks.
