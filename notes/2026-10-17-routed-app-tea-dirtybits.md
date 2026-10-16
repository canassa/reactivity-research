# 2026-10-17: routed-app in tea-dirtybits

## Done

- Emitter `scenarios/routed-app/tea-dirtybits.js`; new runtime `frameworks/tea-dirtybits/template/routes.js`
  (`slot`, events without a widget, model setters) and `routes-adapter.js` (dispose calls the app's
  `stop` first). `framework.js` counts `routes.js` as runtime. Other scenarios' output is unchanged.
- `runs.json`: tea-dirtybits under routed-app, sizes 1 to 256, seeds 1 to 3.

## Design (lifetime inside dirty bits)

- A page is a unit with its own reducer, patch and `stop`, mounted by a `slot` keyed by the route;
  tab panels and modals are units mounted by slots inside the page; the menu is a slot too.
- One dirty word: bits 0 to 5 are the global fields in every page, then the page's own, so a global
  write needs no mapping and only the mounted page's patch tests it.

## Results

- `./rr check`: passes at sizes 1, 4, 16, 64 with seeds 1, 2, 3, locality included (calls 17 → 17
  from N=16 to 256 for the worst action, ratio 1.00); the other four scenarios' checks still pass.
- `./rr work` (N=16 → 256, seed 1): every local action is flat (ratio 1.00): page events 15 to 20
  calls, navigation 40 to 117 (p2 → p3 is the largest page), tab switch 34 and 55, mount 56, dispose 5.
  Only the menu opening grows (50 → 530, global by nature).
- `./rr measure` (written to /tmp/rr-ra4-measure, not committed): baseline 4,603 B + 366.4 B per page
  (R² 0.992); runtime 1,061 B; N=1 about 2.2 KB, N=16 about 10 to 11.5 KB, N=256 about 94 to 97 KB.

## Learned

- Lifetime costs very little in dirty bits: `slot` is about 20 lines and the pages need no
  subscription code, because a patch only exists while its page is mounted.
- A page costs about twice a `unique-components` widget (366 against about 175 B), as the README expects.
