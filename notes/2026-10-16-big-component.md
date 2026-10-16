# 2026-10-16: the big-component scenario

A third growth axis beside `shared-components` and `unique-components`: one component with one
model that grows by fields, so that strategies re-running all of a component's bindings after
an event (digest, tea-local) cost O(N) per event and the locality check can catch them. The
contract, the generator and reference, and the work actions; no emitters yet.

## What was done

- `scenarios/big-component/README.md`: the contract, written against the vocabulary of
  unique-components (nothing added), the shape of the form (sections, fieldsets, gated groups,
  group summaries, section totals), the cross-field dependencies, the first nine forced units,
  the companion, and a worked example checked against the generator.
- `scenarios/big-component/spec.js`: field units drawn one by one from `rng("unit", seed, i)`,
  each looking back only at the previous 6 units (`WINDOW`); the layout from size-independent
  streams. The reference `update`/`render`/expressions are copied from unique-components.
- `harness/work/big-component.js`: actions on the forced units 0-8; serverSet of the whole
  component and the snapshot are global.

## Checks (scratch scripts, not committed)

- Deterministic: N = 1..256 (powers of two), seeds 1-3, generated twice: identical JSON.
- Prefix-stable: at each N, w1's fields, messages and view equal those of N = 256 filtered to
  the first N units (nodes touching a later field removed, emptied containers dropped); the
  companion is identical from N = 7.
- The reference replays the whole script at every size and seed.
- Headless Chrome: all 1,747 targeted steps resolve in the parsed reference HTML at the moment
  they run (unique, enabled, right tag), and parsing keeps every element count.
- Work actions resolve, change the state and pick the same targets at N = 9..256 (seeds 1-3) and
  at N = 9, 16, 256 for seeds 1-60.
- Reads per field: max 6-8, average 2.5-3.3, flat from N = 16 to 256.
- unique-components untouched (nothing factored out; see below).

## Learned

- The spec module cannot import a shared file: the serve handler serves only the scenario's
  `spec.js` at `/__rr/spec.js`, so a relative import 404s in the panel. The vocabulary and the
  reference are copied from unique-components. If a third scenario wants them, the harness could
  serve `scenarios/` (or a shared module) under `/__rr/`.
- "Belongs to the latest unit it reads" is what makes a cross-field node prefix-stable. A
  section total over "the section's ints" broke it (it depended on units not yet generated);
  it is now the sum of the section's first three ints, shown once the third exists.
- Gated groups lose some script coverage (the gate's checkbox may end unchecked after 1-2
  clicks): about 88% of the sampled messages are exercised.
