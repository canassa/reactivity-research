# 2026-10-16: tea-local on the flat big-component form

The flat form removed the fieldsets tea-local had split along, so the emitter threw. Reworked
`scenarios/big-component/tea-local.js` with a `grain` parameter.

## What was done

- `--grain unit` (default): one instance per field unit (a main field with its draft or gate,
  found from the spec's fields and messages). A top-level view node belongs to the instance of the
  latest field it touches; the unit's nodes are a run of siblings, so its template is parsed in a
  fragment and appended to the form. Cross-unit reads go through the frame's registry and
  `follow`, as summaries do; combined buttons `forward` a message. No change to `runtime.js`,
  the spec or the harness; the frame (`widgets/frame.js`) is emitted with the app.
- `--grain form`: the whole form as one instance, built as the recorded dead end.

## Results (seed 1 unless noted)

- unit: `./rr check` passes at sizes 1, 4, 16, 64 with seeds 1-3, locality included (1.3-1.6x).
  `./rr work`: add to an int 38 calls at every N=16..256; median 29 to 29. Whole-state events
  O(N), as before. Sizes (mean of seeds): N=1 1427 B, 16 3566, 64 7411, 256 20771; fit
  2027 B + 74.8 B/unit.
- form: page correct, locality fails: 8.2x (16 to 256, seed 1), 10.7x and 10.6x (seeds 2, 3),
  13.6x (64 to 1024). 83 to 683 calls per action from N=16 to 256. 2000 B + 68.3 B/unit; N=256
  19096 B. The scaffolding for locality costs 6.5 B/unit.
- unique- and shared-components tea-local checks still pass.

## Learned

- The unit is already in the spec (the script's `units()` derives it the same way), so it is the
  app's own grain and not a boundary the emitter invents. The result is per-field granularity;
  the README says so and discusses whether it is still tea-local (the instance still re-runs its
  whole list; only the component got small).
- The 16 to 256 ratio of the single instance is only just over the limit (8.2x), because of the
  fixed overhead per event; 64 to 1024 shows the linear growth clearly.
- The single-instance reducers copy ~1.07 N fields per message, work the call counter cannot see.
