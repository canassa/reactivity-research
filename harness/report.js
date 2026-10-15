// ./rr report [scenario,…] [--force] [--jobs N] [--local] [--port P] [--out FILE]
//
// Reads runs.json (per scenario, per emitter: sizes, seeds, options), measures every run,
// reusing committed results whose inputs have not changed, writes results/ for each scenario
// whose measurements changed, then builds and serves the plots page.

import fs from "node:fs";
import path from "node:path";
import { parseArgs, loadScenario, loadEmitter, ROOT } from "./selection.js";
import { measureScenario, combinations } from "./measure.js";
import { defaultJobs } from "./pool.js";
import { plotsCommand } from "./plots.js";

export function readConfig() {
  const file = path.join(ROOT, "runs.json");
  if (!fs.existsSync(file)) throw new Error("no runs.json at the repository root");
  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  delete config.$comment;
  return config;
}

export async function reportCommand(rest) {
  const args = parseArgs(rest, ["force", "local"]);
  const only = args._[0] ? args._[0].split(",") : null;
  const config = readConfig();
  for (const [scenarioName, entries] of Object.entries(config)) {
    if (only && !only.includes(scenarioName)) continue;
    const scenario = await loadScenario(scenarioName);
    const scenarioOptions = entries.$options || {};
    const plan = [];
    for (const [emitterName, entry] of Object.entries(entries)) {
      if (emitterName.startsWith("$")) continue;
      const emitter = await loadEmitter(scenario.name, emitterName);
      const options = Object.fromEntries(Object.entries(entry.options || {}).map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : v]));
      for (const k of Object.keys(options)) if (!(k in (emitter.mod.params || {}))) throw new Error(`runs.json: ${scenarioName}/${emitterName}: unknown option ${k}`);
      for (const emitterOptions of combinations(emitter.mod.params, options)) {
        if (!entry.sizes || !entry.seeds) throw new Error(`runs.json: ${scenarioName}/${emitterName} needs sizes and seeds`);
        plan.push({ emitter, emitterOptions, sizes: entry.sizes, seeds: entry.seeds });
      }
    }
    await measureScenario(scenario, scenarioOptions, plan, { force: !!args.force, onlyIfChanged: true, jobs: Number(args.jobs || defaultJobs()) });
  }
  const plotArgs = [];
  if (only) plotArgs.push(only.join(","));
  if (args.local) plotArgs.push("--local");
  if (args.port) plotArgs.push("--port", String(args.port));
  if (args.out) plotArgs.push("--out", String(args.out));
  await plotsCommand(plotArgs);
}
