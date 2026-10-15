// ./rr <command> <scenario> <framework|all|a,b> [options]

import path from "node:path";
import { parseArgs, loadScenario, loadEmitters, splitOptions, ROOT } from "./selection.js";
import { runJobs, defaultJobs, timingText } from "./pool.js";

const USAGE = `usage: ./rr <command> <scenario> <framework|all|a,b> [options]

commands:
  generate   write generated/<scenario>/n<size>-s<seed>/<framework>/
  build      generate, then the framework's production build
  measure    build every size and seed and write sizes into results/
  serve      build, serve with the dispatch panel, expose through cloudflared
  check      quick aid: run the interaction script on one small build in headless Chrome
  plots      build the plots page from results/ and serve it
  report     measure every run in runs.json (only what changed), then serve the plots

selection options:
  --size N --seed S                    (generate, build, serve; generate and build take lists: --size 1,2,4)
  --jobs N                             (generate, build, measure, report) parallel builds, default min(32, cores)
  --sizes 1,2,4 --seeds 1,2            (measure; default: the scenario's own lists)
  --force                              (measure, report) remeasure even if nothing changed
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
      case "check":
        return await (await import("./check.js")).checkCommand(rest);
      case "report":
        return await (await import("./report.js")).reportCommand(rest);
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

// --size and --seed take comma-separated lists here; every combination is built, in parallel.
async function generateOrBuild(command, rest) {
  const { args, scenario, emitters, scenarioOptions, emitterOptions } = await selection(rest, ["jobs"]);
  const list = (v, d) => String(v ?? d).split(",").map(Number);
  const jobs = [];
  for (const emitter of emitters) {
    for (const size of list(scenarioOptions.size, 16)) {
      for (const seed of list(scenarioOptions.seed, 1)) {
        jobs.push({
          scenario: scenario.name, emitter: emitter.name, emitterOptions: emitterOptions(emitter),
          scenarioOptions: { ...scenarioOptions, size, seed }, generateOnly: command === "generate",
        });
      }
    }
  }
  await runJobs(jobs, {
    jobs: Number(args.jobs || defaultJobs()),
    onDone: (job, r) => console.log(`${command === "build" ? "built" : "generated"} ${rel(r.dir)} (${timingText(r.timing)})`),
  });
}
