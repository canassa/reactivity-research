// ./rr plots [scenario,…] [--local] [--port P] [--out FILE]
//
// Reads results/, keeps for every scenario and framework variant its latest run, and writes one
// self-contained HTML page (data embedded, charts drawn as inline SVG by an inline script, no
// network). Served locally and through a cloudflared quick tunnel unless --out is given; the
// served page is rebuilt from results/ on every request.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, RESULTS, ROOT } from "./selection.js";
import { serveUntilInterrupted } from "./tunnel.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function collect(only) {
  if (!fs.existsSync(RESULTS)) return [];
  const runs = fs.readdirSync(RESULTS).sort()
    .filter((d) => fs.existsSync(path.join(RESULTS, d, "run.json")))
    .map((d) => ({ dir: d, run: JSON.parse(fs.readFileSync(path.join(RESULTS, d, "run.json"), "utf8")) }))
    .filter((r) => !only || only.includes(r.run.scenario));
  const scenarios = new Map();
  // Later runs (sorted by directory name: date, then -2, -3…) replace earlier ones per variant.
  runs.sort((a, b) => a.dir.localeCompare(b.dir, "en", { numeric: true }));
  for (const { dir, run } of runs) {
    const records = JSON.parse(fs.readFileSync(path.join(RESULTS, dir, "measurements.json"), "utf8"));
    const fits = JSON.parse(fs.readFileSync(path.join(RESULTS, dir, "fit.json"), "utf8"));
    if (!scenarios.has(run.scenario)) scenarios.set(run.scenario, new Map());
    const variants = scenarios.get(run.scenario);
    for (const [name, info] of Object.entries(run.variants)) {
      variants.set(name, {
        name, ...info,
        run: { dir, date: run.date, git: run.versions.git, sizes: run.sizes, seeds: run.seeds, scenarioOptions: run.scenarioOptions },
        versions: { ...run.versions, framework: run.frameworks[info.framework]?.versions },
        compression: run.compression,
        fit: fits[name],
        records: records.filter((r) => r.variant === name).map((r) => ({
          size: r.size, seed: r.seed, html: r.html, js: r.js, total: r.total, attribution: r.attribution, adapter: r.adapter,
        })),
      });
    }
  }
  return [...scenarios].map(([name, variants]) => ({ name, variants: [...variants.values()] }));
}

export function page(data) {
  const client = fs.readFileSync(path.join(HERE, "plots-client.js"), "utf8");
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Reactivity size plots</title>
<style>
:root {
  color-scheme: light;
  --surface: #fcfcfb; --card: #ffffff; --text: #0b0b0b; --text-2: #52514e; --muted: #8a8984;
  --grid: #e8e7e3; --axis: #c9c8c2;
  --s1: #2a78d6; --s2: #eb6834; --s3: #1baf7a; --s4: #eda100; --s5: #e87ba4; --s6: #008300; --s7: #4a3aa7; --s8: #e34948;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --surface: #1a1a19; --card: #232321; --text: #ffffff; --text-2: #c3c2b7; --muted: #8d8c85;
    --grid: #33332f; --axis: #4a4a45;
    --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500; --s5: #d55181; --s6: #008300; --s7: #9085e9; --s8: #e66767;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --surface: #1a1a19; --card: #232321; --text: #ffffff; --text-2: #c3c2b7; --muted: #8d8c85;
  --grid: #33332f; --axis: #4a4a45;
  --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500; --s5: #d55181; --s6: #008300; --s7: #9085e9; --s8: #e66767;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--surface); color: var(--text); font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1120px; margin: 0 auto; padding: 20px 16px 60px; }
h1 { font-size: 22px; margin: 0 0 4px; }
h2 { font-size: 18px; margin: 34px 0 6px; }
h3 { font-size: 15px; margin: 0 0 2px; }
p.lead, .note { color: var(--text-2); margin: 4px 0 12px; }
.controls { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; margin: 12px 0; }
.controls label { display: inline-flex; gap: 6px; align-items: center; color: var(--text-2); }
.card { background: var(--card); border: 1px solid var(--grid); border-radius: 8px; padding: 14px 14px 10px; margin: 12px 0; }
.grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 12px; }
.grid2 .card { margin: 0; }
svg { display: block; width: 100%; height: auto; overflow: visible; }
svg text { fill: var(--text-2); font-size: 11px; }
svg .gridline { stroke: var(--grid); stroke-width: 1; }
svg .axis { stroke: var(--axis); stroke-width: 1; }
svg .crosshair { stroke: var(--muted); stroke-width: 1; }
.legend { display: flex; flex-wrap: wrap; gap: 4px 14px; margin: 6px 0 2px; color: var(--text-2); font-size: 12px; }
.legend i { display: inline-block; width: 14px; height: 0; border-top: 2px solid; vertical-align: middle; margin-right: 5px; }
.legend i.box { height: 10px; border: 0; border-radius: 2px; }
.legend .hover { cursor: default; padding: 2px 4px; border-radius: 4px; }
.legend .hover:hover, .legend .hover:focus { background: var(--grid); outline: none; }
.chart.hl g.series { opacity: .12; transition: opacity .12s; }
.chart.hl g.series.on { opacity: 1; }
.chart g.series polyline { stroke-width: 2; }
.chart.hl g.series.on polyline { stroke-width: 3; }
/* End labels collide when curves converge: show them only for the highlighted curve. */
.chart g.series .end { display: none; }
.chart.hl g.series.on .end { display: inline; fill: var(--text); font-weight: 600; }
.source { color: var(--muted); font-size: 11.5px; margin-top: 6px; }
table { border-collapse: collapse; font-size: 12.5px; font-variant-numeric: tabular-nums; }
th, td { text-align: right; padding: 3px 9px; border-bottom: 1px solid var(--grid); }
th:first-child, td:first-child { text-align: left; }
th { color: var(--text-2); font-weight: 600; }
details { margin-top: 6px; }
summary { cursor: pointer; color: var(--text-2); font-size: 12px; }
.scroll { overflow-x: auto; }
#tip { position: fixed; pointer-events: none; background: var(--card); color: var(--text); border: 1px solid var(--axis);
  border-radius: 6px; padding: 6px 8px; font-size: 12px; box-shadow: 0 2px 8px rgba(0,0,0,.12); display: none; z-index: 5; }
#tip .row { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
#tip .row i { width: 12px; border-top: 2px solid; }
#tip b { font-variant-numeric: tabular-nums; }
#tip .head { color: var(--text-2); margin-bottom: 2px; }
</style>
</head>
<body>
<main id="app"></main>
<div id="tip" role="tooltip"></div>
<script id="data" type="application/json">${json}</script>
<script>
${client}
</script>
</body>
</html>
`;
}

export async function plotsCommand(rest) {
  const args = parseArgs(rest, ["local"]);
  const only = args._[0] ? args._[0].split(",") : null;
  const scenarios = collect(only);
  if (scenarios.length === 0) throw new Error(`no results${only ? ` for ${only.join(", ")}` : ""} in results/ (run ./rr measure first)`);
  const html = page({ scenarios });
  if (args.out) {
    fs.writeFileSync(path.resolve(args.out), html);
    console.log(`wrote ${path.relative(ROOT, path.resolve(args.out)) || args.out}`);
    return;
  }
  // Rebuilt from results/ on every request, so new results appear on reload.
  await serveUntilInterrupted((req, res) => {
    const fresh = collect(only);
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(fresh.length ? page({ scenarios: fresh }) : html);
  }, {
    port: args.port ?? 0,
    local: !!args.local,
    what: `serving plots for ${scenarios.map((s) => `${s.name} (${s.variants.map((v) => v.name).join(", ")})`).join("; ")}`,
  });
}
