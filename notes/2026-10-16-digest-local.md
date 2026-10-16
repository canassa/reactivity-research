# 2026-10-16: a local digest

## Done

- digest now digests only the widget an event touched. Each widget has its own binding list
  (`W[id]`, also on the section as `x.b`). A summary adds its binding to each source's list. In
  `receive`, `serverSet` and `notify` call `up(widget)`, a snapshot calls `up` on every widget,
  and `tick` calls the clocks' tick functions, which each clock registers in `T`.
- `./rr check dashboard digest` passes at sizes 1, 4, 16 and 64, seeds 1 to 3. Locality passes
  from 16 and 64 (worst 2.2× to 3.7×). From 1 and 4 the locality step stops on a harness error
  (`Cannot read properties of undefined (reading 'id')`): the work actions need one widget of
  every kind, which small apps don't have. tea-local hits the same error. `./rr check dashboard
  all` passes.
- Scratch fuzzer (not committed): 2,500 random user actions, external events and
  dispose/remount per app, at sizes 1, 4, 16 and 64, seeds 1 to 3, each step compared with the
  reference: 0 failures. Without the summary `push`, it caught 498 failing steps.
- Builds are byte-identical twice.

## Numbers

- Calls per local action, N=16 → 256: median 283 → 4,526 before, 35 → 41 now (tea-local 23 → 24,
  Solid 128 → 168). The worst is tick at 2.5×, because a tick calls every clock.
- Size: N=1 1,027 → 1,062 B; all sizes 2,115 + 24.3 → 2,161 + 24.2; N ≥ 16 3,130 + 18.6 →
  3,190 + 18.4. The runtime costs +29 B, the app +8 B at N=1 and +32 B baseline from N=16. Still
  about 1 KB below tea-local from N=16, with a slope about 10 B/widget lower.

## Learned

- **Global dirty checking bought only about 35 to 60 B.** Its size lead came from the
  positional rows and the compiled rules, not from skipping dependency tracking. Locality needs
  no graph, because the compiler knows who reads whom.
- **A fuzzer must stick to canonical number spellings** (`String(Number(t)) === t`). Typing
  `472.94470` leaves the input showing what was typed, which is the documented limit, not a bug.
