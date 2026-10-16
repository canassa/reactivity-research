# 2026-10-16: making tea-inline smaller, round 4

Goal: fewer brotli bytes for the tea-inline prototype in both scenarios, strategy unchanged
(messages erased into actions, compile-time dependencies, DOM built once), no work action
making more calls than before, and no median growing at any size.

## Result

Same measurement as `./rr measure` (sizes 1–256, seeds 1–3, the harness's `measureBuild`),
compressed total, median of seeds:

| scenario | N=1 | N=16 | N=64 | N=256 | fit, all sizes | fit, N ≥ 16 |
|---|---|---|---|---|---|---|
| shared-components before | 1096 | 3502 | 5022 | 9131 | 2273 + 29.0/w | 3362 + 22.9/w |
| shared-components after | 1081 | 3502 | 4980 | 8926 | 2269 + 28.4/w | 3364 + 22.2/w |
| unique-components before | 1491 | 6155 | 16157 | 48698 | 2759 + 185.2/w | 4413 + 175.9/w |
| unique-components after | 1486 | 5901 | 15255 | 45134 | 2721 + 171.8/w | 4316 + 162.8/w |

No median of either scenario grew (shared N=16 is equal, every other size is smaller):
−2.2% and −7.3% at N=256. Work (`./rr work`, sizes 16–256, seed 1): no record went up; total
calls 7769 → 7689 (shared) and 12868 → 12626 (unique): one call less per list add, notify and
reconciled new row. `./rr check` passes at sizes 1, 4, 16 and 64, seeds 1–3, locality included;
two builds of all 54 measured apps are byte-identical.

## What helped (unique-components, in order of size)

- **A binding table per widget, `G`.** The per-field groups were locals (`onTone`), each a
  minified letter of its own that differs between widgets; they are now places in one array the
  app hands the widget as a parameter (`G[0]`, `G[1]`), the same letter everywhere. The app, not
  the widget, then calls `loader` with the table, so no widget ends in `return loader(...)`.
  −1,494 B at N=256.
- **Readers push into the source's table.** Widgets only read widgets above them, so a reader
  adds its binding straight to the group of the field it reads in the source's table
  (`R[3][1].push(G[5])`); the registry keyed by field name (`R = {3: {email: []}}`) and the
  source's `R[widget].email` entries are gone. −898 B at N=256.
- **Lists and shared bindings in the table too**: a list is the first binding of its field's
  group (`G[1][0].add(item)`), and a binding reading several fields or another widget is an
  entry of `G` added to each group it reads (`G[0].push(G[4])`). −658 B.
- **Markup**: the run of end tags at the very end of a widget (and the section's own) left out,
  as Solid's compiler does; the parser closes them. −173 B with the dashboard's own.
- **Initial lists as `items("a", "b")`** (texts, or `[text, done]` pairs), numbered by the
  helper. −135 B at N=256, but +15…+30 B for small apps; paid for by the other changes.
- **Input handlers read `e.target`** instead of `E[n]`. −118 B. The tick arm tests the maximum
  first instead of comparing after (`s.x != max && (s.x = Math.min(max, s.x + k))`), which is
  also fewer `Math.min` calls.

## What helped (both, and shared-components)

- **The keyed list's reconcile builds a new row inline** (`old.get(id) || row(item)`), and `add`
  inlines the row's construction: no `make` helper, one call less per new row. −185 B summed
  over shared builds, −0.5 kB over unique.
- **Shared readers lists made as each widget mounts** (summaries read only widgets above them,
  checked), instead of a literal of every read widget's number; **todo items as pairs**; and a
  page with no summary writes `model[n] = init` without the summary branch: −15 B at N=1,
  −205 B at N=256.

## What did not help

- Pushing shared bindings into `G` in a `G.push` of their own before the groups (+160 B at
  N=256 against adding them to their groups afterwards).
- The widget's own readers as a parameter, a handle table keyed by `wN`, `W.push(markup,
  function)` without the pair, an int handler reusing its event parameter: noise or larger.
- `items` split into one helper per kind of list, feed entries as texts in shared: smaller at
  N=256 but small apps grew past the line.
- Exporting the runtime's pending set instead of `cancel`: +560 B at N=256 in unique. Dropping a
  top-level declaration renames every minified runtime function, and with them every widget's
  locals.

## Learned

- The round-3 lesson held again and paid most: what a widget names itself costs, so anything
  that turns a local into a place in a parameter (the elements, now the bindings) shrinks the
  slope. The table also removed the cross-widget registry, because a table by place can be
  addressed from another widget at compile time.
- Small apps had headroom after the first big step, which let a change that costs a helper's
  bytes up front (`items`) through while every median stayed at or under main's.
- Close to a rule: leaving out the trailing end tags relies on the HTML parser's recovery at the
  end of the string (a parse error by the spec, though browsers all close the open elements);
  Solid's compiler emits the same kind of templates.
