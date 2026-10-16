# 2026-10-16: big-component as one flat form

The owner's decision: the big component's form is one flat list of field units, with no
sections, fieldsets, gated fieldsets, per-group summaries or section totals. digest and
tea-local had passed locality by re-running a whole fieldset (and the fieldsets reading it) per
event, so the groups handed them a bounded unit of re-run instead of precise updates.

## What was done

- `scenarios/big-component/spec.js`: the layout (sections, groups, gates, summaries, totals) is
  gone; w1's view is the units' nodes in order. Each unit draws its own noun for its field
  names. The 6-unit `WINDOW` is replaced by a pool of the last few units plus 4 fields drawn from
  anywhere earlier, skipping fields that later bindings already read 3 times (`READ_CAP`): reads
  per field stay bounded without a distance limit, and about a third of cross-unit reads reach
  more than six units back (up to the first unit). Derived texts went from 35% to 50% of units
  to keep about as many multi-field texts (102 at N = 256) as the summaries gave. `when` tags
  no longer use `<section>`. A unit's own optional wrapper (div/header/footer) stays.
- `scenarios/big-component/README.md`: shape, dependencies, figures, worked example (regenerated
  and checked against the generator: JSON equal, HTML byte-equal once indentation is removed,
  dependency nodes found in the view), and a "What changed" note.

## Checks (scratch scripts, not committed)

- Deterministic: N = 1..256 (powers of two), seeds 1-3, generated twice: identical JSON.
- Prefix-stable: w1's fields, messages, view and units at each N are exact prefixes of N = 256
  (no filtering needed now); companion identical from N = 7.
- The reference replays every script; headless Chrome: 2,010 targeted steps resolve (unique,
  enabled, right tag) in the parsed reference HTML at the moment they run; parsing keeps every
  element.
- Work actions resolve, change the state and hit the same targets at N = 9..256 (seeds 1-3) and
  at N = 9, 16, 256 for seeds 1-60.
- Reads per field: max 7-8, average 2.8-3.5 (N = 16) to 2.8-3.0 (N = 256). Script coverage of the
  sampled units' messages: 96-100% (was about 88%: gated groups hid controls).

## `./rr check big-component <fw>` at N = 16 and 64, seed 1

- solid, tea-inline, tea-dirtybits: pass; locality (prototypes) 1.2-1.4×.
- digest: page correct, **locality fails** (10.0× from 16 to 256, 14.4× from 64 to 1024): with no
  fieldsets, its per-group binding lists cover the whole form.
- elm, tea-local: the emitters assume sections and fieldsets at the top of the view and throw
  (`Cannot read properties of undefined`, `unexpected section`).
- beni-tea, beni-direct: the emitter writes one view function per top-level node; an input with
  a validation is two sibling roots (label and error), which the Beni parser rejects.

The emitters were left for separate fixes.
