# 2026-10-16: optimizer finished, big-component flattened, consolidated report

## Done

- The prototype size optimizer stopped after its last rounds (digest 6, tea-local 5, tea-inline 4,
  tea-dirtybits 4). Every round was validated on every scenario: checks pass, no call count rose.
- `big-component` landed, with emitters for every framework. Its form was first built from
  fieldsets and sections. digest and tea-local passed locality by re-running one fieldset per event,
  which the owner judged cheating: the generator handed them the boundaries. The form is now one
  flat list of field units, and dependencies reach anywhere earlier.
- One consolidated `./rr report` and `./rr work` for all three scenarios.

## Learned

- **Whole-component re-runs do not scale to one big component.** On the flat form, digest's single
  binding list costs 181 → 1,556 calls per local action from N=16 to 256 (8.6×, 14× from 64 to
  1024). The only way to stay local is a list per field, scheduled per action at build time, which
  is tea-inline's mechanism. digest is out of big-component's runs as a dead end.
- **tea-local stays local by making every field unit an instance** (1.3–1.6×). Its whole-form
  version fails at 8–11× and is recorded as a dead end. The per-unit version is counted, labelled
  as per-field granularity; whether it is fair is the owner's call.
- **Per field, the precise approaches cost about the same** on big-component: tea-local 74.8,
  tea-inline 80.5, Elm 86.2, tea-dirtybits 87.8 and Solid 91.6 B per unit. They differ in their
  runtime (about 0.8 KB against 6.5 KB) and, for Elm, in work that grows with the form.

## Headline (median brotli at N=256)

| | shared | unique | big |
|---|---|---|---|
| digest | 7,345 | 35,617 | dead end |
| tea-local | 8,976 | 42,560 | 20,891 |
| tea-inline | 8,926 | 45,134 | 22,061 |
| tea-dirtybits | 9,697 | 48,186 | 24,280 |
| Solid 1 | 16,740 | 65,600 | 30,675 |
| Elm | 23,309 | 70,897 | 29,333 |
| beni-tea | 40,792 | 159,979 | 62,661 |
| beni-direct | no build | no build | 70,695 |
