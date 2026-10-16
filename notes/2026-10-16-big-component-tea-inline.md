# 2026-10-16: big-component in tea-inline

- Wrote `scenarios/big-component/tea-inline.js` from the unique-components emitter (page root
  `data-role=page`, one form module and a companion module). No change to the runtime, the
  framework module or the harness.
- `./rr check big-component tea-inline` passes at sizes 1, 4, 16, 64 and seeds 1-3, locality
  included; the shared- and unique-components checks still pass; builds are byte-identical.
- Learned: the per-field binding groups keep an action's work constant in a single big
  component (12 calls at every size from 16 to 256), where the form is the whole widget.
- Added the `big-component` entry to `runs.json` (sizes 1..256, seeds 1-3).
