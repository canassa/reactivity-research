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
  return [...scenarios].map(([name, variants]) => ({ name, variants: [...variants.values()], work: latestWork(name) }));
}

// The latest ./rr work run of a scenario (results/work/<date>-<scenario>[-n]/), or null.
function latestWork(scenario) {
  const base = path.join(RESULTS, "work");
  if (!fs.existsSync(base)) return null;
  const dirs = fs.readdirSync(base).filter((d) => fs.existsSync(path.join(base, d, "run.json")) && fs.existsSync(path.join(base, d, "work.json")))
    .filter((d) => JSON.parse(fs.readFileSync(path.join(base, d, "run.json"), "utf8")).scenario === scenario)
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  if (!dirs.length) return null;
  const dir = dirs[dirs.length - 1];
  const read = (f) => JSON.parse(fs.readFileSync(path.join(base, dir, f), "utf8"));
  return { dir, run: read("run.json"), records: read("work.json").map(({ runs, ...r }) => r) };
}

export function page(data) {
  const client = fs.readFileSync(path.join(HERE, "plots-client.js"), "utf8");
  const css = fs.readFileSync(path.join(HERE, "plots.css"), "utf8");
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Reactivity size plots</title>
<style>
${css}</style>
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
