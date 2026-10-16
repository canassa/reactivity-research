// ./rr work <scenario> <framework|all|a,b> [--sizes 16,32,64,128,256] [--seed 1] [--runs 2]
//           [--jobs N] [--out DIR] [emitter options]
//
// How much work does one event cost, and does it grow with the size of the app? For every
// framework and size the same actions (harness/work/<scenario>.js) are performed on the same
// early widgets (the generators are prefix-stable) in headless Chrome, and the JavaScript the
// app itself runs for each is counted with the DevTools profiler's precise coverage:
//
//   calls   function invocations, summed over the app's own scripts (the built bundle; not
//           the serve panel, its hooks or the reference code, which are other scripts)
//   blocks  basic-block executions, summed the same way (a finer count: it also sees loop
//           iterations and branches, and does not depend on which functions V8 inlines)
//
// An action is: take (and so reset) the counters, perform it, await settled(), take them. Each
// framework variant is measured in `runs` fresh pages, to show the counts are deterministic.
// Results go to results/work/<date>-<scenario>/ (apart from the size runs, whose readers scan
// results/*/run.json) with the versions and options.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs, loadScenario, loadEmitters, splitOptions, variantName, ROOT, RESULTS } from "./selection.js";
import { runJobs, defaultJobs } from "./pool.js";
import { serveHandler } from "./serve.js";
import { listen } from "./tunnel.js";
import { launch } from "./chrome.js";
import { fitLine } from "./fit.js";
import { execFileSync } from "node:child_process";

export const DEFAULT_SIZES = [16, 32, 64, 128, 256];

// V8 flags for the counting pages. Without the optimizing compilers every function runs in the
// interpreter or the baseline tier, so what is counted is what the code does, not what TurboFan
// happened to inline: with them on, counts depend on warm-up and differ between runs, and
// callees inlined into hot callers vanish from the count (the same Solid action cost 306 calls
// at N=16 and 166 at N=64 only because the larger page had warmed the code up further).
export const DEFAULT_JS_FLAGS = "--no-turbofan --no-maglev";

// Runs in the page: perform one script step the way the serve panel does, then wait for the
// app to settle. The expression has no URL, so the profiler does not count it.
function stepExpression(step) {
  const s = JSON.stringify(step);
  return `(async () => {
    const step = ${s};
    if (step.do === "click") document.querySelector(step.target).click();
    else if (step.do === "type") {
      const t = document.querySelector(step.target);
      t.focus();
      t.value = step.value;
      if (t.type !== "number") t.setSelectionRange(step.value.length, step.value.length);
      t.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: step.value.slice(-1) || null }));
    } else if (step.do === "select") {
      const t = document.querySelector(step.target);
      t.value = step.value;
      t.dispatchEvent(new Event("input", { bubbles: true }));
      t.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (step.do === "dispatch") window.rr.dispatch(structuredClone(step.msg));
    else throw new Error("unknown step " + step.do);
    await window.rr.settled();
  })()`;
}

// Sum a Profiler.takePreciseCoverage result over the scripts under `prefix` (a URL path).
export function sumCoverage(result, prefix) {
  let calls = 0, blocks = 0, scripts = 0;
  for (const script of result) {
    let pathname;
    try { pathname = new URL(script.url).pathname; } catch { continue; }
    if (!pathname.startsWith(prefix) || !pathname.endsWith(".js")) continue;
    scripts++;
    for (const fn of script.functions) {
      calls += fn.ranges[0].count;
      for (const r of fn.ranges) blocks += r.count;
    }
  }
  return { calls, blocks, scripts };
}

// One fresh page: every action in order; returns [{ calls, blocks }] per action.
async function runPage(chrome, url, prefix, list, ref, spec) {
  const page = await chrome.open(url);
  try {
    await page.waitFor("window.rrPanel && window.rrPanel.ready === true");
    await page.cdp("Profiler.enable");
    await page.cdp("Profiler.startPreciseCoverage", { callCount: true, detailed: true });
    await page.cdp("Profiler.takePreciseCoverage"); // reset
    let state = spec.initialState;
    const out = [];
    for (const action of list) {
      const step = action.step(state);
      await page.evaluate(`new Promise((r) => setTimeout(r, 0))`); // let the page go idle first
      await page.cdp("Profiler.takePreciseCoverage");
      await page.evaluate(stepExpression(step));
      const { result } = await page.cdp("Profiler.takePreciseCoverage");
      const sum = sumCoverage(result, prefix);
      if (sum.scripts === 0) throw new Error(`no coverage for the app's scripts under ${prefix}`);
      out.push({ calls: sum.calls, blocks: sum.blocks });
      if (step.msg) state = ref.update(spec, state, step.msg);
    }
    await page.cdp("Profiler.stopPreciseCoverage");
    if (page.errors.length) throw new Error(`page errors in ${url}: ${page.errors.slice(0, 3).join("; ")}`);
    return out;
  } finally {
    await page.close();
  }
}

function chromeVersion(bin) {
  try { return execFileSync(bin, ["--version"], { encoding: "utf8" }).trim(); } catch { return null; }
}

function gitInfo() {
  try {
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain", "--", "scenarios", "frameworks", "harness"], { cwd: ROOT, encoding: "utf8" }).trim() !== "";
    return { commit, dirty };
  } catch {
    return null;
  }
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function resultsDir(scenario) {
  const base = path.join(RESULTS, "work", `${today()}-${scenario}`);
  let dir = base;
  for (let i = 2; fs.existsSync(dir); i++) dir = `${base}-${i}`;
  return dir;
}

// Measure the work of `emitters` at each of `sizes`. Returns the records and the run header.
export async function workScenario(scenario, scenarioOptions, emitters, emitterOptions, { sizes, runs, jobs, jsFlags = DEFAULT_JS_FLAGS, log = console.log }) {
  const actionsFile = path.join(ROOT, "harness", "work", `${scenario.name}.js`);
  if (!fs.existsSync(actionsFile)) throw new Error(`no work actions for ${scenario.name} (expected harness/work/${scenario.name}.js)`);
  const { actions } = await import(pathToFileURL(actionsFile));

  // Generate and build everything in parallel worker processes.
  const plan = emitters.flatMap((emitter) => sizes.map((size) => ({
    emitter, opts: emitterOptions(emitter), size, variant: variantName(emitter, emitterOptions(emitter)),
    options: scenario.mod.normalizeOptions({ ...scenarioOptions, size }),
  })));
  log(`building ${plan.length} app(s) with up to ${Math.min(jobs, plan.length)} parallel jobs`);
  const built = await runJobs(plan.map((p) => ({
    scenario: scenario.name, emitter: p.emitter.name, variant: p.variant, scenarioOptions: p.options, emitterOptions: p.opts,
  })), { jobs });
  plan.forEach((p, i) => { p.outDir = built[i].outDir; });

  const chrome = await launch({ args: jsFlags ? [`--js-flags=${jsFlags}`] : [] });
  const records = [];
  let listActions = null;
  try {
    for (const size of sizes) {
      const here = plan.filter((p) => p.size === size);
      const spec = scenario.mod.generate(here[0].options);
      const ref = scenario.mod;
      const list = actions(spec, ref);
      listActions ||= list.map((a) => ({ name: a.name, scope: a.scope, setup: !!a.setup }));
      const server = await listen(serveHandler(scenario, spec, new Map(here.map((p) => [p.variant, p.outDir]))), 0);
      const base = `http://127.0.0.1:${server.address().port}`;
      try {
        for (const p of here) {
          const repeats = [];
          for (let i = 0; i < runs; i++) repeats.push(await runPage(chrome, `${base}/${p.variant}/`, `/${p.variant}/`, list, ref, spec));
          list.forEach((a, k) => {
            const calls = repeats.map((r) => r[k].calls), blocks = repeats.map((r) => r[k].blocks);
            records.push({
              variant: p.variant, size, seed: p.options.seed, action: a.name, scope: a.scope, setup: !!a.setup,
              calls: calls[0], blocks: blocks[0],
              deterministic: calls.every((c) => c === calls[0]) && blocks.every((c) => c === blocks[0]),
              runs: { calls, blocks },
            });
          });
          log(`${p.variant} n=${size}: ${repeats.length} run(s) done`);
        }
      } finally {
        server.close();
        server.closeAllConnections?.();
      }
    }
  } finally {
    await chrome.close();
  }

  const variants = {};
  for (const p of plan) {
    variants[p.variant] ||= {
      emitter: p.emitter.name, framework: p.emitter.mod.framework, label: p.emitter.framework.label,
      track: p.emitter.framework.track, emitterOptions: p.opts, versions: p.emitter.framework.versions(),
    };
  }
  const bin = (await import("./chrome.js")).findChrome();
  const run = {
    scenario: scenario.name, kind: "work", date: today(),
    sizes, seeds: [Number(scenarioOptions.seed ?? 1)], runs, jsFlags,
    scenarioOptions: (({ size, seed, ...rest }) => rest)(scenario.mod.normalizeOptions({ ...scenarioOptions, size: 1, seed: 1 })),
    actions: listActions, variants,
    versions: { node: process.version, chrome: chromeVersion(bin), platform: `${os.platform()} ${os.release()} ${os.arch()}`, git: gitInfo() },
    method: "Profiler.startPreciseCoverage({ callCount: true, detailed: true }); per action: take (reset), perform, await settled(), take; summed over the app's own scripts (URLs under /<variant>/); calls = function invocations, blocks = basic-block executions",
  };
  return { records, run };
}

// Per variant, over the local actions: the growth of the calls from the smallest to the largest
// size (calls at N_max / calls at N_min), as its median and its worst action, plus the fitted
// extra calls per extra widget for the median action.
export function locality(records, run) {
  const lo = run.sizes[0], hi = run.sizes[run.sizes.length - 1];
  const median = (xs) => { const s = [...xs].sort((x, y) => x - y); return s[Math.floor((s.length - 1) / 2)]; };
  const out = {};
  for (const v of Object.keys(run.variants)) {
    const rows = run.actions.filter((a) => !a.setup).map((a) => {
      const at = (n) => records.find((r) => r.variant === v && r.size === n && r.action === a.name)?.calls;
      const fit = fitLine(run.sizes.map((n) => [n, at(n)]));
      return { action: a.name, scope: a.scope, lo: at(lo), hi: at(hi), ratio: at(hi) / at(lo), perWidget: fit.slope };
    });
    const local = rows.filter((r) => r.scope === "local");
    out[v] = {
      sizes: [lo, hi], medianRatio: median(local.map((r) => r.ratio)), maxRatio: Math.max(...local.map((r) => r.ratio)),
      worst: local.reduce((m, r) => (r.ratio > m.ratio ? r : m)).action, medianPerWidget: median(local.map((r) => r.perWidget)),
      callsAtMin: median(local.map((r) => r.lo)), callsAtMax: median(local.map((r) => r.hi)),
      snapshotRatio: rows.filter((r) => r.scope === "global").map((r) => r.ratio)[0] ?? null,
    };
  }
  return out;
}

function localityText(loc) {
  const rows = Object.entries(loc).map(([v, l]) => [v, String(l.callsAtMin), String(l.callsAtMax), l.medianRatio.toFixed(2), l.maxRatio.toFixed(2), l.medianPerWidget.toFixed(1), l.worst]);
  const head = ["variant", `median calls N=${Object.values(loc)[0].sizes[0]}`, `N=${Object.values(loc)[0].sizes[1]}`, "median ratio", "max ratio", "calls/widget", "worst action"];
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const fmt = (r) => r.map((c, i) => (i === 0 || i === 6 ? c.padEnd(w[i]) : c.padStart(w[i]))).join("  ");
  return [fmt(head), ...rows.map(fmt)].join("\n");
}

function table(records, run) {
  const sizes = run.sizes;
  const lines = [];
  for (const metric of ["calls"]) {
    for (const v of Object.keys(run.variants)) {
      lines.push(`\n${v} (${metric} per action)`);
      const head = ["action", ...sizes.map((n) => `N=${n}`), `×${sizes[sizes.length - 1] / sizes[0]}`];
      const rows = run.actions.filter((a) => !a.setup).map((a) => {
        const vals = sizes.map((n) => records.find((r) => r.variant === v && r.size === n && r.action === a.name)?.[metric]);
        return [a.name + (a.scope === "global" ? " *" : ""), ...vals.map(String), (vals[vals.length - 1] / vals[0]).toFixed(2)];
      });
      const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
      const fmt = (r) => r.map((c, i) => (i === 0 ? c.padEnd(w[i]) : c.padStart(w[i]))).join("  ");
      lines.push(fmt(head), ...rows.map(fmt));
    }
  }
  return lines.join("\n");
}

export async function workCommand(rest) {
  const args = parseArgs(rest, []);
  const [scenarioName, which] = args._;
  const scenario = await loadScenario(scenarioName);
  const emitters = await loadEmitters(scenario.name, which || "all");
  const { scenarioOptions, emitterOptions } = splitOptions(args, scenario, emitters, ["sizes", "seeds", "runs", "jobs", "out", "jsFlags"]);
  delete scenarioOptions.size;
  const sizes = args.sizes ? String(args.sizes).split(",").map(Number) : DEFAULT_SIZES;
  const runs = Number(args.runs || 2);
  const jsFlags = args.jsFlags === undefined ? DEFAULT_JS_FLAGS : args.jsFlags === true ? "" : String(args.jsFlags);
  const seeds = String(args.seeds ?? args.seed ?? 1).split(",").map(Number);
  const records = [];
  let run;
  for (const seed of seeds) {
    const r = await workScenario(scenario, { ...scenarioOptions, seed }, emitters, emitterOptions, { sizes, runs, jobs: Number(args.jobs || defaultJobs()), jsFlags });
    records.push(...r.records);
    run ||= r.run;
  }
  run.seeds = seeds;

  const bad = records.filter((r) => !r.deterministic);
  const loc = {};
  for (const seed of seeds) {
    const rs = records.filter((r) => r.seed === seed);
    console.log(`\n=== seed ${seed} ===`);
    console.log(table(rs, run));
    loc[seed] = locality(rs, run);
    console.log("\nGrowth of the work of a local action, smallest to largest size:\n" + localityText(loc[seed]));
  }
  console.log(`\n* global by nature (replaces the whole state)`);
  console.log(bad.length ? `NOT deterministic: ${bad.length} of ${records.length} counts differ between runs` : `deterministic: all ${records.length} counts equal across ${runs} fresh page(s)`);

  const dir = args.out ? path.resolve(args.out) : resultsDir(scenario.name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "run.json"), JSON.stringify(run, null, 2) + "\n");
  fs.writeFileSync(path.join(dir, "locality.json"), JSON.stringify(loc, null, 2) + "\n");
  fs.writeFileSync(path.join(dir, "work.json"), JSON.stringify(records, null, 1) + "\n");
  console.log(`wrote ${path.relative(ROOT, dir)}/`);
}
