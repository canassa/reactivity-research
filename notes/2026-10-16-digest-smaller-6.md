# 2026-10-16: a smaller digest, sixth round

## Done

- unique-components: the widgets' templates are hoisted into one table in page order,
  `app([templates], [widgets], receive)`; the dashboard element keeps it (`D.h`) and `widget()`
  takes the next one.
- unique-components: a text's static prefix stays in the template (`<p>Gap: </p>`), and every
  text binding writes a text node of its own at the end of its element, as Solid does.
- Both: templates leave out the end tags they close with (Solid's templates do too).
- shared-components: the labels are a table of their own after the rows; the setter rides on the
  binding list (`W[k].s`); the delegated listener is one expression.
- unique-components, small: a remove is an in-place `rm(list, item)` (fewer calls), a checklist
  with no done item is a plain `L(…)` list, an item's record is its binding list, `show` takes
  its bool as it is, `bind` takes the node before the cache.

## Numbers

Brotli totals, adapter excluded, `runs.json` (sizes 1 to 256, seeds 1 to 3), medians, Node
26.11.1, Vite 8.3.4:

| | N=1 | N=16 | N=64 | N=256 | all sizes | N ≥ 16 |
|---|---|---|---|---|---|---|
| shared, before | 1,009 | 3,074 | 4,309 | 7,514 | 2,028 + 23.51 | 2,987 + 18.10 |
| shared, after | 1,009 | 3,074 | 4,264 | 7,345 | 2,032 + 22.86 | 2,996 + 17.43 |
| unique, before | 1,356 | 4,923 | 12,604 | 37,255 | 2,331 + 140.9 | 3,596 + 133.8 |
| unique, after | 1,356 | 4,829 | 12,185 | 35,617 | 2,339 + 134.5 | 3,603 + 127.4 |

No median is higher at any size; shared is equal at N=1 and N=16, unique at N=1. Sums over all
27 builds: shared −874 B, unique −9,692 B. Calls (`./rr work`, seed 1, sizes 16 to 256), record by
record: none higher; 11,798 → 11,798 (shared), 19,962 → 19,942 (unique, five remove records
lower).

`./rr check` passes on both at sizes 1, 4, 16 and 64, seeds 1 to 3, locality included. Builds are
byte-identical twice.

## Tried, didn't help

- Templates as named constants (+827 B summed), as each widget function's parameter, or the
  item templates in the same table: worse than the plain table.
- A static suffix in the template too (`${n} minutes`), item bindings and handlers taking the
  item as an argument, `add` without `done`, `[]` for an empty initial list, the number check on
  `X.v`, `el()` with a default parameter, unquoted option values: noise or worse.
- shared: every string of a row in the table (+683 B against the labels alone), the item record
  as its binding list, `show` without `!!`, a new todo item without `done`: noise or worse.

## Learned

- **Where a string sits matters as much as how long it is.** Moving unique's templates out of
  the widget code, byte for byte the same, took 2.7% off the largest bundles; the labels out of
  shared's rows took 2%. HTML next to HTML and code next to code compress better than the two
  interleaved, as long as nothing per widget has to name its piece.
- **The small sizes are a lottery of a few bytes.** The page names the bundle by its content
  hash, and the page's brotli size moves between 138 and 152 B with the hash alone. Any change
  moves every build's total by up to ±7 B at random, so at N=1 to N=8 a change was judged by its
  JavaScript bytes and the sum over all builds, and the final medians were checked against the
  start. One kept form (shared's setter written with the list, `(W[id] = B = []).s = set`) costs
  48 B more JavaScript summed than its neighbour but lands every small-size total at or below
  the start.
- A new runtime variable renames the minified runtime and can cost more than it saves; keeping
  the template table on the dashboard element instead of a module variable saved 3 to 8 B at N=1.
