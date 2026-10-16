# 2026-10-17: routed-app in tea-local

## Done

- `scenarios/routed-app/tea-local.js` and `frameworks/tea-local/template/routed.js`. Pages, tab
  panels and modals are instances created when shown and destroyed on leave (unwatch, clear
  timers, destroy children). Global state is one instance that mounted readers watch.
- `./rr check` passes at sizes 1 to 256, seeds 1 to 3; locality 1.00x from N=16 to 256 (limit 8x).
- `runs.json`: tea-local under routed-app. Other scenarios' tea-local builds are byte-identical.

## Learned

- Instances map onto pages: lifetime came out as slots plus `destroy`, with no new mechanism in
  the strategy. Coarse watching (re-run the whole patch) costs a constant because only mounted
  components watch.
- A bug worth remembering: the emitter chose the helpers to import by scanning only the page
  code, so `nextId`, used only by a global reducer arm, was missing in small apps. The check
  caught it only through a stale shell counter, not an error line.
- Size: 4364 B + 296 B per page (R2 0.99).
