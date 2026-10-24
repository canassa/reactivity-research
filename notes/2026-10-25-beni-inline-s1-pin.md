# 2026-10-25: beni-inline at the commit where slice S1 closed

**Why.** The owner closed slice S1 (holes and handlers) of beni's `browser-inline` platform.
This session moves beni-inline's pin there and asks what S1 builds and ships.

**Done.**
- `COMMIT` in `frameworks/beni/beni.js`: `ca8b52fb0d3a…` → `2556986c68fa4d20a97245c83b0123f6ca7c1539`
  (beni `master`, 2026-10-24). Built with `install.sh` from the local clone, in 5.5 min.
  `beni version`: `beni 0.1.0-m1 36b93dcdce3d0a071bf39f0eb21d22e8`. Updated the two READMEs.
- `./rr check <scenario> beni-inline` on all six scenarios that have a beni-inline emitter, at the
  quick-check size N=16, seed 1. Also N=1, and builds at N=2, 4, 8 (seeds 1–3) for the two
  scenarios that build at N=1.
- Scratch measurements (under `/tmp`, not in `results/`) of the variant that builds,
  `--lists none` of unique-components and big-component, for beni-inline and tea-inline at
  sizes 1–256, seeds 1–3.

**No `results/` were written, and `runs.json` is unchanged.** This is why:
1. `runs.json` lists beni-inline in no scenario, and `results/` holds no beni-inline record at
   any pin. At `ca8b52fb0` it built no generated app. `./rr report` therefore measures nothing
   for it, and there is no old-pin number to compare with.
2. A failed build rejects the whole `./rr measure`/`./rr report` run (`harness/pool.js`). The
   tooling cannot leave a failed run out.
3. `./rr report` would remeasure every framework in unique-components and big-component even
   without beni. Their `spec.js` changed on 2026-10-18 (the `--lists none` commit, b2b45bf),
   after their last results (2026-10-17), and `runs.json` asks for `tea-inline-lists=none`, which
   has never been committed. The 2026-10-18 note lists this as open.

To add beni-inline to `runs.json` (for example for `lists: ["none"]` in those two scenarios) is
the owner's decision. It would also commit the remeasurement of item 3.

**What builds** (all failures at build time, beni exits 1):

| scenario | N=16 s=1 (check size) | N=1 s=1 |
|---|---|---|
| shared-components | NOT IMPLEMENTED YET: `For` (Choice, Feed, Rating, Tabs, Todo, Toggles); a changing `aria-expanded` (Panel) | builds, check ok; N=2/4/8 fail on `For` (all seeds) |
| unique-components | NOT IMPLEMENTED YET: `For` (W1, W12, W13, W14, W3, W5, W8, W9) | `For` (W1:136) |
| big-component | NOT IMPLEMENTED YET: `For` (W1:367) | builds, check ok; N=2 builds; N=4/8 fail on `For` |
| big-table | RECORD MAY BE SHARED (Main:33, `update` changes `model.tK.rows[*]` in place) | `For` (T1:251) |
| derived-graph | RECORD MAY BE SHARED (Main:22, `model.stock.items[*]`) | RECORD MAY BE SHARED (Main:21) |
| routed-app | RECORD MAY BE SHARED ×2 (Main:35, `model.page#P4.0.modal#Just.0`, `#P7`) | `For` (Main:156) |
| unique-components `--lists none` | builds at 1, 16, 256; check ok (149 steps) | builds |
| big-component `--lists none` | builds at 1, 16, 256; check ok (84 steps) | builds |

The `For` diagnostic: "A limit of the compiler: `browser-inline` does not compile a `For` yet
(`docs/design/browser-inline.md` §5, class 1)." The record diagnostic (big-table):

```
-- RECORD MAY BE SHARED ------------------------------------ src/Main.beni:33:10
`update` changes the record at `model`, `model.t1`, `model.t1.rows[*]`, … in place, and the
checker cannot show that nothing else still holds the record.
33|        (Tea.element { init = init, update = update, view = view, subscriptions = subscriptions })
Copy the record with `Record.copy` where the model gets it, …
This is a limit of the checker, not proof of sharing: the callee needs the list's elements to
hold no record at two positions, and they may.
```

routed-app's says instead: "the function that does it goes where the checker cannot see every
call of it: no provenance names where its base's object comes from." These are beni issue #879.
Nothing was changed to get around them.

**Measured** (`--lists none`, brotli total, median of seeds 1–3; fit over all sizes):

| | N=1 | N=16 | N=64 | N=256 | fit |
|---|---|---|---|---|---|
| unique-components, beni-inline | 1,493 | 5,937 | 15,174 | 45,267 | 2,653 + 171.5 B/widget (R² 0.993) |
| unique-components, tea-inline | 1,337 | 4,707 | 12,876 | 39,123 | 2,072 + 148.5 (R² 0.994) |
| big-component, beni-inline | 1,545 | 3,442 | 7,560 | 22,411 | 1,899 + 82.0 B/unit (R² 0.995) |
| big-component, tea-inline | 1,315 | 2,923 | 6,653 | 19,719 | 1,567 + 72.5 (R² 0.996) |

tea-inline's figures are the same as in the 2026-10-18 note to the byte. Runtime (brotli,
median): beni-inline's grows with N, from 593 to 2,571 B on unique-components and from 685 to
908 B on big-component, while tea-inline's stays at 467–498 B. The app code is also larger:
42,575 against 38,479 B at unique-components N=256. So beni-inline is about 16% above tea-inline
at N=256 on unique-components, and 14% on big-component.

**Not done.** The owner's check by hand through `./rr serve` is still owed for this pin (rule 2):
these numbers are not a result until then. The generated sources are still `beni fmt`-clean with
the new compiler (unique-components `--lists none` N=16 and shared-components N=16).
