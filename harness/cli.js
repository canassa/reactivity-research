// ./rr <command> <scenario> <framework|all|a,b> [options]

import path from "node:path";
import { parseArgs, loadScenario, loadEmitters, splitOptions, ROOT } from "./selection.js";
import { generateApp, buildApp } from "./generate.js";

const USAGE = `usage: ./rr <command> <scenario> <framework|all|a,b> [options]

commands:
  generate   write generated/<scenario>/n<size>-s<seed>/<framework>/
  build      generate, then the framework's production build
  measure    build every size and seed and write sizes into results/
  serve      build, serve with the dispatch panel, expose through cloudflared
  plots      build the plots page from results/ and serve it

selection options:
  --size N --seed S                    (generate, build, serve)
  --sizes 1,2,4 --seeds 1,2            (measure; default: the scenario's own lists)
  plus the scenario's options and each emitter's own options (./rr help <scenario>)

serve/plots options:
  --local      no cloudflared tunnel
  --port P     local port (default: any free port)
  --out FILE   (plots) only write the page`;

const rel = (p) => path.relative(ROOT, p);

export async function main(argv) {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case "generate":
      case "build":
        return await generateOrBuild(command, rest);
      case "measure":
        return await (await import("./measure.js")).measureCommand(rest);
      case "serve":
        return await (await import("./serve.js")).serveCommand(rest);
      case "plots":
        return await (await import("./plots.js")).plotsCommand(rest);
      case "help":
        return await help(rest[0]);
      default:
        console.log(USAGE);
        process.exitCode = command ? 1 : 0;
    }
  } catch (err) {
    console.error(`rr: ${err.message}`);
    if (process.env.RR_DEBUG) console.error(err.stack);
    process.exitCode = 1;
  }
}

async function help(scenarioName) {
  console.log(USAGE);
  if (!scenarioName) return;
  const scenario = await loadScenario(scenarioName);
  const emitters = await loadEmitters(scenario.name, "all");
  console.log(`\n${scenario.name} options:`);
  for (const [k, p] of Object.entries(scenario.mod.params)) console.log(`  --${k} (default ${p.default}): ${p.help}`);
  for (const e of emitters) {
    for (const [k, p] of Object.entries(e.mod.params || {})) console.log(`  --${k} [${e.name}] (default ${p.default}): ${p.help}`);
  }
}

// Shared by the commands that act on one size and seed.
export async function selection(rest, extra = []) {
  const args = parseArgs(rest, ["local"]);
  const [scenarioName, which] = args._;
  const scenario = await loadScenario(scenarioName);
  const emitters = await loadEmitters(scenario.name, which || "all");
  const { scenarioOptions, emitterOptions } = splitOptions(args, scenario, emitters, extra);
  return { args, scenario, emitters, scenarioOptions, emitterOptions };
}

async function generateOrBuild(command, rest) {
  const { scenario, emitters, scenarioOptions, emitterOptions } = await selection(rest);
  for (const emitter of emitters) {
    const run = command === "build" ? buildApp : generateApp;
    const out = await run(scenario, emitter, scenarioOptions, emitterOptions(emitter));
    console.log(`${command === "build" ? "built" : "generated"} ${rel(out.dir)}${out.built ? ` → ${rel(out.built.outDir)}` : ""}`);
  }
}
