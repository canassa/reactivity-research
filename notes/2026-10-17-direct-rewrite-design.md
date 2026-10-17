# 2026-10-17: the direct platform's rewrite, designed from this project's results

A design session, not a measuring one. The owner asked whether a pure functional language with
an advanced compiler can ship what tea-inline ships, and what beni is missing to get there.

## Done

- Read the six scenarios' latest fits and CPU runs, the tea-inline README and its adversarial
  critique, the two held-out scenarios built after it, and beni's own design documents
  (write sets, browser-direct, the ownership checker, research 58–106).
- Wrote the plan of the rewrite in beni (`plans/direct-rewrite.md`) and its issues: the parent
  (#295), seven slices S0–S6 (#296–#302) and `Dict` on a JavaScript `Map` (#294) as sub-issues.
  tea-inline's generated output is the goldens; each slice is measured here, on the scenario that
  exercises it, against tea-inline (bytes and CPU ≤ 1.1×, locality flat, compile linear at 256).
- Fixed the plots page: the routed-app tab threw on a CPU event timed once (`ci = [null, null]`
  from `./rr bench`); the table now shows `—` for such an interval (`harness/plots-client.js`).
  Found by a Sonnet agent in headless Chrome through `harness/chrome.js`.
- beni's side left a `beni-inline` setup here (`frameworks/beni-inline/`, one emitter stub per
  scenario) and moved the shared beni pin to `ca8b52fb0` (the merge of S0). Not committed in this
  session: the pin is shared with beni-tea and beni-direct, so moving it remeasures both (see
  Open).

## Learned

- The answer is yes, and the evidence is already here: tea-inline beats hand-written vanilla's
  slope on every scenario that has one and is within ~10% of its CPU; Elm (a pure language with a
  conventional runtime) shows the language alone buys nothing. beni already has two of the three
  analyses the output needs (write sets: 90 of Conduit's 91 keys bounded; read sets); ownership is
  the third and exists in report mode.
- beni-direct's 5–10× gap to tea-inline is seven nameable decisions, none a limit of the approach:
  `Tea.element` dragging the fiber kernel and `Dict` in (~8 kB of a 13 kB page), messages and the
  `case` surviving across module boundaries, per-instance specialisation with no sharing by kind,
  derived values recomputed as a block (N² compile), the ownership width cap, no lifetime,
  guarantees priced per page. The 32% of a one-widget bundle that is the app (`W1` + `Main`,
  14.9 kB raw against tea-inline's 2.4 kB) is where the slope comes from.
- Decisions the owner made during the session: error instead of coarse fallback (no `patchAll`,
  no value path); `Dict` is the keyed collection (a JS `Map` plus an order array, insertion order,
  Int/String keys, `eq` includes order, no `compare`), `List` is positional only, no idiom
  recogniser, departing from Elm's `List.map … if r.id == id`; this project's beni generators move
  to `Dict` once the ordered API exists; in-place record writes need the checker to judge records
  first (beni #315), with per-field liveness and hoisted reads so correct programs are not
  refused.
- The ownership checker's one permanent limit is sharing that depends on depth in a recursive
  structure; nothing in the corpus, the bench or the six scenarios hits it.

## Open

- The shared beni pin: keep one pin for the three setups (and remeasure beni-tea and
  beni-direct at `ca8b52fb0`), or give beni-inline a pin of its own. Owner's call before the
  beni-inline files are committed.
- S1 needs a "no list widgets" variant of unique-components and big-component (a generator
  option), since D2 makes every list widget a build error until S2 and the `Dict` generators
  land; who adds it is the owner's call.
- `./rr plots --help` starts a server instead of printing help; `./rr bench` could record no
  interval for a single-rep event instead of `[null, null]`.
