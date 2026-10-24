# 2026-10-25: derived-graph's beni upsert copies the record it puts in place

**Why.** beni's ownership checker now writes record updates in place, and it refused the
generated beni-inline app of derived-graph at every size and seed: `update entry …
model.stock.items[*]: exclusive` (beni issue #879). The refusal is correct. In `serverItems`,
`Maybe.withDefault (find upsert item.id) item` puts the upsert's record at every kept position
whose id matches. Two kept items with one id are reachable: a push or a snapshot that names a
new id twice adds two items with that id. Then one record sits at two positions, and a later
`Active id` toggles that one object twice in place, so it does not change. Value semantics
toggles both items.

**Done.** `scenarios/derived-graph/shared/beni.js`: each kept item that has an upsert takes
`Record.copy` of it. This is how beni writes "keep the old value apart" (beni
`ownership-checker.md` §31.15). The doc comment says why. The other emitters are unchanged:
only beni-inline uses the file.

**Checked.** `beni check --platform=./platform src` passes at sizes 16, 64 and 128, seeds 1–3,
with beni at origin/master 7aa6b06c9 (newer than the pin). `./rr check derived-graph
beni-inline` still stops before that, on `For`, which `browser-inline` does not compile yet.
The generated `Items.beni` is byte-identical over two runs. No `results/` were written.
