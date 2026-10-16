# 2026-10-16: beni emitters for the flat big-component

The form is one flat list of field units, so the beni emitters' one-helper-per-top-level-section
split no longer applied, and an input with a validation (label plus error, two sibling roots) was
rejected by the parser. `scenarios/big-component/shared/beni.js` now splits the form's view into
helpers (`part1 model`, ...) of 8 consecutive top-level nodes, each with its own locals and
returned as a fragment (`<>...</>`), so a helper may end between or inside a unit's nodes. Both
beni-tea and beni-direct use it; frameworks/beni*, the spec and README are untouched.

- `./rr check` passes for both at N = 1, 4, 16, 64, seeds 1-3. Builds are byte-identical on rebuild
  (N = 64 seed 1 compared, hashes of all generated files).
- Work (calls per local action, N=16 -> 256): beni-tea median 3.66x (max 3.92x, 144 -> 527);
  beni-direct median 10.27x (max 13.57x, 426 -> 4270).
- Totals (br, seed 1): beni-tea N=1 9851, 16 17008, 64 26721, 256 63392; beni-direct N=1 11665,
  16 19827, 64 31586, 256 71178. Fits (all sizes): tea 12051 B + 200.9 B/unit; direct 14377 B +
  226.7 B/unit. Results not committed.
