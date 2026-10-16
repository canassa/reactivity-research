# 2026-10-16: the unique-components scenario

A sibling of `shared-components` for the other growth axis: every widget is a different
component, used once, so the slope is the cost of one more component type. Contract, generator
and reference, and work actions; no emitters yet (other sessions write them from the README).

## What was done

- `scenarios/unique-components/README.md`: the contract, the component vocabulary (field types,
  message kinds and ops, typed array expressions, view nodes and the exact HTML each renders),
  a worked example checked byte for byte against the generator, and the owner's rule that each
  widget compiles to its own code (no shipped interpreter of widget descriptions).
- `scenarios/unique-components/spec.js`: widgets composed from primitives, redrawn until their
  structural signature (texts, numbers and names abstracted away) is new in the app. The
  reference `update`/`render` are generic interpreters over the descriptions.
- `harness/work/unique-components.js`: actions picked by capability. The generator forces one
  capability into each of w1..w8 (add button, text input, list push, bool toggle, enum + feed,
  number input, gated tick, reader of w6), so targets are the same at every size from 8.

## Checks (scratch scripts, not committed)

- Deterministic: N = 1..256 (powers of two), seeds 1-3, generated twice: identical JSON.
- Prefix-stable: widget i and its initial state identical across sizes for each seed.
- The reference replays the whole script at every size and seed without throwing.
- Variety: 256 distinct structures out of 256 at N = 256 (all seeds).
- In headless Chrome, every script step's target resolves in the parsed reference HTML of its
  widget at that moment (buttons enabled, inputs and selects of the right tag), and the HTML
  parser keeps every page's element count.
- Work actions resolve, change the state, and pick the same targets at N = 8..256, seeds 1-3;
  the capabilities exist for seeds 1-60 at N = 8.

## Figures

- About 1.5 KB of spec JSON per widget, flat with N (1,490-1,570 B at N = 16..256); 3.2 fields
  and 5 messages per widget.
- The token (4 base-36 characters, in the heading and one caption) costs about 10 brotli bytes
  per widget.
- The script exercises about 95% of messages (the rest sit in conditional sections that never
  open, or act on lists left empty); 2,800-2,900 steps at N = 256.

## Learned

- A "first widget with capability X" choice is only prefix-stable if X depends on the widget
  and earlier ones: "a field some widget reads" must only count readers among the forced first
  eight, or a later reader changes the target at bigger sizes.
- Time-driven fields need a gate that starts off, as the clocks do in shared-components;
  otherwise `tick` work grows with the number of such fields and is not a local action.
