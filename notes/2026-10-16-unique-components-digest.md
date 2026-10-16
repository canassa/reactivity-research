# 2026-10-16: unique-components in digest

## Done

- `scenarios/unique-components/digest.js`: one function per widget, emitted in full from its
  description (state literal, template, a handler per message, a binding per dynamic property,
  tick function). `frameworks/digest/runtime-unique.js` is the generic runtime;
  `templateFiles` takes a `runtime` option. `runtime.js` is untouched.
- `./rr check unique-components digest` passes at sizes 1, 4, 16, 64, seeds 1 to 3, locality
  included (worst 4.4x from n=64 to n=1024; at n=16 to 256 worst 3.4x). `./rr check
  shared-components digest` still passes. Builds are byte-identical twice.

## Numbers (brotli, total)

- N=1 1,445 B (median), N=16 5,525, N=64 14,636, N=256 44,102.
- All sizes: 2,503 + 167.9 B/widget; N >= 16: 3,961 + 159.7. Runtime 959 B at N >= 8, the rest
  is app code. Shared-components digest: 2,161 + 24.2 (N >= 16: 3,190 + 18.4).

## Learned

- Without rows the slope is about 7x the shared one: the per-widget cost is now the template,
  handlers and bindings that are really different in every widget.
- Adjacent conditionals broke the old `show` (insertBefore a removed sibling); an empty text
  node as anchor fixes it.
