// ./rr bench <scenario|all> <framework|all|a,b> [--sizes 16,64,256] [--seeds 1,2] [--sessions 2]
//            [--taskset 1-5,7-11] [--chrome PATH] [--out DIR] [--quick] [--aa] [--max-load 1.0]
//            [--remote HOST] [--wait MS] [--loads N] [--jobs N] [emitter options]
//
// CPU time: how long does one event take, and does it grow as the app grows? The time
// counterpart of ./rr work's call counts. For every app (framework, size, seed) in every session:
//
//   startup  `loads` fresh tabs of a bench page (the app's own index.html, mounting on load, no
//            panel): script and total time from the navigation to the first paint after mount,
//            and the JavaScript heap in use after mount and a forced GC;
//   events   one page, and ./rr work's actions made repeatable (harness/bench/<scenario>.js): each
//            rep is real input through the DevTools protocol, timed out of a Chrome trace with
//            js-framework-benchmark's rule (harness/bench/lib/trace.js); 5 warm-up reps, then reps
//            until the median's 95% bootstrap interval is within ±3%, from 10 to 40 reps.
//
// No CPU throttling. Every app is first run through ./rr check's script check on the same build
// and skipped if it fails. Sessions are fresh browsers, the framework order rotated and reversed
// between them; the 1-minute load is recorded per batch and a batch above --max-load is redone.
// Results go to results/cpu/<date>-<scenario>[-n]/ (run.json, samples.json, summary.json).
// harness/bench/README.md has the method and the remote recipe.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { parseArgs, loadScenario, loadEmitters, splitOptions, variantName, listScenarios, ROOT, RESULTS } from "./selection.js";
import { runJobs, defaultJobs } from "./pool.js";
import { serveHandler } from "./serve.js";
import { listen } from "./tunnel.js";
import { launch, findChrome } from "./chrome.js";
import { readConfig } from "./report.js";
import { scriptCheck, checkReport } from "./check.js";
import { benchHandler, startupLoads, eventReps } from "./bench/lib/driver.js";
import { describe, median } from "./bench/lib/stats.js";

const FLAGS = ["sizes", "seeds", "sessions", "taskset", "chrome", "out", "quick", "aa", "maxLoad", "remote", "wait", "loads", "jobs", "workers", "workerTasksets"];
const BOOLEANS = ["quick", "aa"];
export const DEFAULT_SIZES = [64];
export const DEFAULT_SEEDS = [1];

// The method, in the numbers it uses. --quick is for development: one size, one seed, one
// session, few reps, no load gating.
// One session: the two seeds already give two pages per framework and size, which is what a
// second session added. The stop rule is ±5%: at ±3% tiny events ran every action to the cap.
const FULL = { warmup: 3, minReps: 10, maxReps: 20, chunk: 10, tol: 0.05, loads: 5, sessions: 1 };
const QUICK = { warmup: 2, minReps: 5, maxReps: 5, chunk: 5, tol: 0.05, loads: 3, sessions: 1 };
const WAIT_MS = 40;       // after each warm-up input: a frame (Elm renders on rAF) and its commit, with room
const MIN_WAIT_MS = 20;   // the floor of the per-action wait the warm-up reps set (see eventReps)
const LOAD_WAIT_S = 120;  // how long to wait for the load to fall below --max-load before a batch
const REDOS = 2;          // how many times a batch measured above --max-load is redone

// Chrome flags: js-framework-benchmark's (webdriverCDPAccess.ts), less the throttling.
const CHROME_FLAGS = [
  "--disable-background-networking", "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows", "--disable-gpu", "--enable-precise-memory-info", "--window-size=1280,1000",
];

// Known remote machines: the taskset and the Chrome to use there unless the flags say otherwise.
export const REMOTES = {
  // workers: one Chrome per entry, each on its own two physical cores (CPU n and n+6 are siblings);
  // core 0 and core 5 are left to the OS and the harness.
  azathoth: { taskset: "1-5,7-11", workers: ["1-2,7-8", "3-4,9-10"], chrome: "/nix/store/ds7933z0wp7872ic6zqzrwsbpj0m8g6l-google-chrome-154.0.8037.97/bin/google-chrome" },
};
const REMOTE_DIR = "src/github.com/canassa/reactivity-research";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = (v) => String(v).split(",").map((x) => Number(x.trim()));

export async function benchCommand(rest) {
  const args = parseArgs(rest, BOOLEANS);
  if (args.remote) return remoteBench(args, rest);
  const [which, frameworks] = args._;
  if (!which) throw new Error("usage: ./rr bench <scenario|all> <framework|all|a,b> [options] (./rr help)");
  const scenarios = which === "all" ? listScenarios().filter((s) => fs.existsSync(benchModule(s))) : which.split(",");
  if (args.out && scenarios.length > 1) throw new Error("--out names one scenario's results directory; bench one scenario at a time with it");
  for (const name of scenarios) await benchScenario(name, frameworks || "all", args);
}

const benchModule = (scenario) => path.join(ROOT, "harness", "bench", `${scenario}.js`);

async function benchScenario(name, which, args) {
  const t0 = performance.now();
  const scenario = await loadScenario(name);
  if (!fs.existsSync(benchModule(name))) throw new Error(`no bench actions for ${name} (expected harness/bench/${name}.js)`);
  const { benchActions } = await import(pathToFileURL(benchModule(name)));
  const emitters = await loadEmitters(scenario.name, which);
  const { scenarioOptions, emitterOptions } = splitOptions(args, scenario, emitters, FLAGS);
  delete scenarioOptions.size;
  delete scenarioOptions.seed;
  const quick = !!args.quick;
  const m = { ...(quick ? QUICK : FULL) };
  if (args.loads) m.loads = Number(args.loads);
  const sessions = Number(args.sessions ?? m.sessions);
  const waitMs = Number(args.wait ?? WAIT_MS);
  // Worker tasksets: --workers N splits nothing by itself (each Chrome gets --taskset); a known
  // remote's list pins each worker to its own cores.
  const nWorkers = Math.max(1, Number(args.workers ?? 1));
  const workerSets = Array.from({ length: nWorkers }, (_, i) => (args.workerTasksets ? String(args.workerTasksets).split("/")[i] : null) ?? args.taskset);
  // The bench's own Chromes keep the 1-minute load near one per worker: the gate is for load
  // from anything else.
  const maxLoad = Number(args.maxLoad ?? 1.0 + 1.5 * nWorkers);

  // The matrix: runs.json's "$bench" block (or the defaults), within each framework's own runs.
  const config = readConfig()[name] || {};
  const block = config.$bench || {};
  let sizes = args.sizes ? list(args.sizes) : block.sizes || DEFAULT_SIZES;
  let seeds = args.seeds ? list(args.seeds) : block.seeds || DEFAULT_SEEDS;
  // --quick takes one size and one seed, unless the flags name them.
  if (quick && !args.sizes) sizes = sizes.slice(0, 1);
  if (quick && !args.seeds) seeds = seeds.slice(0, 1);
  const skipped = [];
  const plan = [];
  // "$bench".also names frameworks left out of the size runs (they fail a rule there) that are
  // timed anyway, for reference, with the reason carried into the results and onto the card.
  const also = block.also || {};
  for (const e of emitters) {
    const entry = config[e.name] || (also[e.name] ? {} : null);
    if (!entry) { skipped.push({ variant: e.name, why: `not in runs.json for ${name}` }); continue; }
    for (const size of sizes) {
      if (entry.sizes && !entry.sizes.includes(size)) { skipped.push({ variant: e.name, size, why: `size ${size} is not in its runs.json sizes` }); continue; }
      for (const seed of seeds) {
        const opts = emitterOptions(e);
        plan.push({ emitter: e, opts, variant: variantName(e, opts), size, seed, options: scenario.mod.normalizeOptions({ ...scenarioOptions, size, seed }) });
      }
    }
  }
  for (const s of skipped) console.log(`skip ${s.variant}${s.size ? ` n=${s.size}` : ""}: ${s.why}`);
  if (plan.length === 0) throw new Error(`nothing to bench in ${name}`);

  // Build.
  const jobs = Number(args.jobs || defaultJobs());
  console.log(`${name}: building ${plan.length} app(s)`);
  const built = await runJobs(plan.map((p) => ({ scenario: name, emitter: p.emitter.name, variant: p.variant, scenarioOptions: p.options, emitterOptions: p.opts })), { jobs, tolerant: true });
  plan.forEach((p, i) => {
    if (built[i].error) skipped.push({ variant: p.variant, size: p.size, seed: p.seed, why: `build failed: ${String(built[i].error).split("\n").find((l) => l.trim())}` });
    else p.dist = built[i].outDir;
  });

  // Correctness gate: ./rr check's script check on every build.
  const chromeBin = findChrome(args.chrome);
  const ok = await gate(scenario, plan.filter((p) => p.dist), chromeBin, skipped);
  const apps = plan.filter((p) => p.dist && ok.has(p));
  if (args.aa) {
    for (const p of [...apps]) apps.push({ ...p, variant: `${p.variant}-aa`, twinOf: p.variant });
  }
  if (apps.length === 0) throw new Error(`no app of ${name} passed the gate`);
  for (const p of apps) p.key = `n${p.size}-s${p.seed}/${p.variant}`;

  const dir = args.out ? path.resolve(args.out) : resultsDir(name);
  fs.mkdirSync(dir, { recursive: true });
  const server = await listen(benchHandler(new Map(apps.map((p) => [p.key, p.dist]))), 0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const variants = [...new Set(apps.map((p) => p.variant))].sort();
  const samples = [], startup = [], batches = [], failures = [];
  let chromeVersion = null;
  const write = () => fs.writeFileSync(path.join(dir, "samples.json"), JSON.stringify({ events: samples, startup, failures }, null, 1) + "\n");

  try {
    for (let session = 1; session <= sessions; session++) {
      // Session 2 runs session 1's framework order reversed; sessions 3 and 4 do the same with the
      // order rotated by one, and so on. (Rotating every session as well would undo the reversal:
      // with two frameworks, rotate-then-reverse is the original order.)
      const shift = Math.floor((session - 1) / 2);
      const order = variants.map((_, i) => variants[(i + shift) % variants.length]);
      if (session % 2 === 0) order.reverse();
      // The session's apps in order (size, seed, then framework), shared by the workers: each takes
      // the next app when it is free, so neighbours in the order run at about the same time.
      const queue = [];
      for (const size of sizes) for (const seed of seeds) for (const variant of order) {
        const app = apps.find((p) => p.variant === variant && p.size === size && p.seed === seed);
        if (app) queue.push(app);
      }
      const worker = async (w) => {
        const chrome = await launch({ args: CHROME_FLAGS, chrome: chromeBin, taskset: workerSets[w], profilePrefix: "rr-bench-chrome-" });
        chromeVersion ||= await chrome.version();
        try {
          for (let app; (app = queue.shift()); ) {
            const { variant, size, seed } = app;
            const spec = scenario.mod.generate(app.options);
            const ctx = { spec, ref: scenario.mod, actions: benchActions(spec, scenario.mod) };
            for (let attempt = 0; ; attempt++) {
              const loadBefore = quick ? os.loadavg()[0] : await waitForLoad(maxLoad);
              const tb = performance.now();
              const tag = { variant, size, seed, session, worker: w };
              let r;
              try {
                const su = await startupLoads(chrome, `${base}/${app.key}/`, m.loads);
                const ev = await eventReps(chrome, `${base}/${app.key}/`, ctx, { ...m, waitMs, minWaitMs: Math.min(MIN_WAIT_MS, waitMs) });
                r = { su, ev };
              } catch (err) {
                failures.push({ ...tag, error: err.message });
                console.log(`FAIL ${name}/${variant} n=${size} s=${seed} session ${session}: ${err.message}`);
                break;
              }
              const loadAfter = os.loadavg()[0];
              const seconds = Math.round(performance.now() - tb) / 1000;
              const redo = !quick && Math.max(loadBefore, loadAfter) > maxLoad && attempt < REDOS;
              batches.push({ ...tag, attempt, loadBefore, loadAfter, seconds, kept: !redo, at: new Date().toISOString() });
              if (redo) { console.log(`redo ${variant} n=${size} s=${seed}: load ${loadAfter.toFixed(2)} > ${maxLoad}`); continue; }
              for (const x of r.su) startup.push({ ...tag, ...x });
              for (const x of r.ev.samples) samples.push({ ...tag, ...x });
              for (const x of r.ev.failures) failures.push({ ...tag, ...x });
              const loc = r.ev.samples.filter((x) => x.scope === "local").map((x) => x.scriptUs);
              console.log(`${name}/${variant} n=${size} s=${seed} session ${session} worker ${w}: ${r.ev.samples.length} reps, local script median ${median(loc).toFixed(0)} µs, ` +
                `startup ${median(r.su.map((x) => x.totalMs)).toFixed(1)} ms, load ${loadBefore.toFixed(2)}→${loadAfter.toFixed(2)} (${seconds.toFixed(1)}s)`);
              write();
              break;
            }
          }
        } finally {
          await chrome.close().catch((err) => console.log(`(closing Chrome: ${err.message})`));
        }
      };
      await Promise.all(workerSets.map((_, w) => worker(w)));
    }
  } finally {
    server.close();
    server.closeAllConnections?.();
  }

  const variantsInfo = {};
  for (const p of apps) {
    variantsInfo[p.variant] ||= {
      emitter: p.emitter.name, framework: p.emitter.mod.framework, label: p.emitter.framework.label + (p.twinOf ? " (A/A twin)" : ""),
      track: p.emitter.framework.track, emitterOptions: p.opts, versions: p.emitter.framework.versions(), ...(p.twinOf ? { twinOf: p.twinOf } : {}),
      ...(also[p.emitter.name] ? { excluded: also[p.emitter.name] } : {}),
    };
  }
  const run = {
    scenario: name, kind: "cpu", date: today(), started: new Date(Date.now() - (performance.now() - t0)).toISOString(), finished: new Date().toISOString(),
    sizes, seeds, sessions, quick, aa: !!args.aa, workers: workerSets,
    scenarioOptions: (({ size, seed, ...rest }) => rest)(scenario.mod.normalizeOptions({ ...scenarioOptions, size: 1, seed: 1 })),
    method: { ...m, waitMs, maxLoad, throttling: 1, chromeFlags: CHROME_FLAGS, rule: "js-framework-benchmark timeline.ts (via beni bench/ui/lib/trace.mjs), per rep between user-timing marks; see harness/bench/README.md" },
    variants: variantsInfo, skipped, batches,
    machine: machineInfo(args.taskset),
    versions: { node: process.version, chrome: chromeVersion, chromeBin, chromeVersionLine: chromeVersionLine(chromeBin), git: gitInfo() },
    wallSeconds: Math.round(performance.now() - t0) / 1000,
  };
  const summary = summarize(samples, startup, run);
  fs.writeFileSync(path.join(dir, "run.json"), JSON.stringify(run, null, 2) + "\n");
  write();
  fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify(summary, null, 1) + "\n");
  console.log(summaryText(summary, run));
  console.log(`wrote ${path.relative(ROOT, dir)}/ (${run.wallSeconds.toFixed(0)} s)`);
}

// ./rr check's script check on every build, grouped by size and seed. Returns the apps that pass.
async function gate(scenario, plan, chromeBin, skipped) {
  const ok = new Set();
  const chrome = await launch({ chrome: chromeBin, profilePrefix: "rr-bench-chrome-" });
  try {
    const groups = new Map();
    for (const p of plan) {
      const k = `${p.size}/${p.seed}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(p);
    }
    for (const group of groups.values()) {
      const spec = scenario.mod.generate(group[0].options);
      const server = await listen(serveHandler(scenario, spec, new Map(group.map((p) => [p.variant, p.dist]))), 0);
      const base = `http://127.0.0.1:${server.address().port}`;
      try {
        const results = await Promise.all(group.map((p) => scriptCheck(chrome, `${base}/${p.variant}/`, { timeout: 180000 }).catch((err) => ({ error: err.message }))));
        group.forEach((p, i) => {
          const r = results[i];
          if (r.error) { skipped.push({ variant: p.variant, size: p.size, seed: p.seed, why: `check could not run: ${r.error}` }); return; }
          const { ok: passed, text } = checkReport(scenario.name, p.variant, spec, r);
          if (passed) ok.add(p);
          else {
            console.log(text);
            skipped.push({ variant: p.variant, size: p.size, seed: p.seed, why: "fails ./rr check's script check" });
          }
        });
      } finally {
        server.close();
        server.closeAllConnections?.();
      }
    }
  } finally {
    await chrome.close();
  }
  console.log(`gate: ${ok.size} of ${plan.length} build(s) pass ./rr check's script check`);
  return ok;
}

async function waitForLoad(maxLoad) {
  const t0 = Date.now();
  let l = os.loadavg()[0];
  while (l > maxLoad && Date.now() - t0 < LOAD_WAIT_S * 1000) {
    await sleep(5000);
    l = os.loadavg()[0];
  }
  return l;
}

// --- Summary ----------------------------------------------------------------------------------

// Pooled over seeds and sessions: per variant, size, action and half, the median, quartiles, n and
// the median's 95% interval of script (µs) and total (ms); per variant and size, startup and heap;
// per variant, the growth of each local half's median from its smallest to its largest size.
export function summarize(samples, startup, run) {
  const group = (xs, key) => {
    const g = new Map();
    for (const x of xs) {
      const k = key(x);
      if (!g.has(k)) g.set(k, []);
      g.get(k).push(x);
    }
    return g;
  };
  const events = [];
  for (const xs of group(samples, (x) => JSON.stringify([x.variant, x.size, x.action, x.half])).values()) {
    const { variant, size, action, half, scope } = xs[0];
    const seedMedians = {};
    for (const [seed, ys] of group(xs, (x) => x.seed)) seedMedians[seed] = Math.round(median(ys.map((y) => y.scriptUs)) * 10) / 10;
    events.push({ variant, size, action, half, scope, script: describe(xs.map((x) => x.scriptUs), 1), total: describe(xs.map((x) => x.totalMs), 3), seeds: seedMedians });
  }
  const loads = [];
  for (const xs of group(startup, (x) => JSON.stringify([x.variant, x.size])).values()) {
    const { variant, size } = xs[0];
    loads.push({ variant, size, script: describe(xs.map((x) => x.scriptUs / 1000), 3), total: describe(xs.map((x) => x.totalMs), 2),
      compileMs: Math.round(median(xs.map((x) => x.compileUs)) ) / 1000, heapBytes: Math.round(median(xs.map((x) => x.heapBytes))) });
  }
  const growth = {};
  for (const v of Object.keys(run.variants)) {
    const mine = events.filter((e) => e.variant === v);
    const sizes = [...new Set(mine.map((e) => e.size))].sort((a, b) => a - b);
    if (sizes.length < 2) continue;
    const lo = sizes.includes(16) ? 16 : sizes[0], hi = sizes.includes(256) ? 256 : sizes[sizes.length - 1];
    if (hi <= lo) continue;
    const halves = mine.filter((e) => e.scope === "local" && e.size === lo).map((e) => {
      const top = mine.find((x) => x.size === hi && x.half === e.half);
      return top ? { half: e.half, lo: e.script.median, hi: top.script.median, ratio: top.script.median / e.script.median } : null;
    }).filter(Boolean);
    if (!halves.length) continue;
    const worst = halves.reduce((a, b) => (b.ratio > a.ratio ? b : a));
    growth[v] = { lo, hi, medianRatio: round3(median(halves.map((h) => h.ratio))), maxRatio: round3(worst.ratio), worst: worst.half,
      medianLo: median(halves.map((h) => h.lo)), medianHi: median(halves.map((h) => h.hi)), halves: halves.map((h) => ({ ...h, ratio: round3(h.ratio) })) };
  }
  const out = { events, startup: loads, growth };
  if (run.aa) out.aa = aaSummary(events, run);
  return out;
}

// For each A/A pair: on how many (size, half) cells the two medians' 95% intervals overlap, and
// how far apart the medians are.
function aaSummary(events, run) {
  const out = {};
  for (const [twin, info] of Object.entries(run.variants)) {
    if (!info.twinOf) continue;
    const cells = events.filter((e) => e.variant === info.twinOf).map((a) => {
      const b = events.find((e) => e.variant === twin && e.size === a.size && e.half === a.half);
      if (!b) return null;
      const overlap = a.script.ci[0] <= b.script.ci[1] && b.script.ci[0] <= a.script.ci[1];
      return { size: a.size, half: a.half, a: a.script.median, b: b.script.median, diff: round3((b.script.median - a.script.median) / a.script.median), overlap };
    }).filter(Boolean);
    const diffs = cells.map((c) => Math.abs(c.diff));
    out[info.twinOf] = { twin, cells: cells.length, overlapping: cells.filter((c) => c.overlap).length, medianAbsDiff: round3(median(diffs)), maxAbsDiff: round3(Math.max(...diffs)), detail: cells };
  }
  return out;
}

const round3 = (x) => Math.round(x * 1000) / 1000;

function summaryText(summary, run) {
  const lines = ["", "median script µs over the local halves · startup total ms (script ms) · heap MB after mount"];
  const variants = Object.keys(run.variants);
  for (const size of run.sizes) {
    lines.push(`N=${size}`);
    for (const v of variants) {
      const ev = summary.events.filter((e) => e.variant === v && e.size === size && e.scope === "local");
      const su = summary.startup.find((s) => s.variant === v && s.size === size);
      if (!ev.length) continue;
      lines.push(`  ${v.padEnd(18)} ${median(ev.map((e) => e.script.median)).toFixed(0).padStart(6)} µs` +
        (su ? `   startup ${su.total.median.toFixed(1).padStart(6)} ms (${su.script.median.toFixed(1)} ms)   heap ${(su.heapBytes / 1e6).toFixed(2)} MB` : ""));
    }
  }
  const g = Object.entries(summary.growth);
  if (g.length) {
    lines.push("", "growth of a local event's script time, smallest to largest size (median and worst half)");
    for (const [v, x] of g) lines.push(`  ${v.padEnd(18)} N=${x.lo}→${x.hi}: ${x.medianRatio.toFixed(2)}× (worst ${x.maxRatio.toFixed(2)}×, ${x.worst})`);
  }
  if (summary.aa) {
    lines.push("", "A/A: the same app under two names");
    for (const [v, x] of Object.entries(summary.aa)) lines.push(`  ${v} vs ${x.twin}: intervals overlap on ${x.overlapping} of ${x.cells} cells; median |diff| ${(x.medianAbsDiff * 100).toFixed(1)}%, max ${(x.maxAbsDiff * 100).toFixed(1)}%`);
  }
  return lines.join("\n");
}

// --- Environment ------------------------------------------------------------------------------

const readFile = (f) => { try { return fs.readFileSync(f, "utf8").trim(); } catch { return null; } };

function machineInfo(taskset) {
  const cpus = fs.existsSync("/sys/devices/system/cpu") ? fs.readdirSync("/sys/devices/system/cpu").filter((d) => /^cpu\d+$/.test(d)) : [];
  const governors = [...new Set(cpus.map((c) => readFile(`/sys/devices/system/cpu/${c}/cpufreq/scaling_governor`)).filter(Boolean))];
  return {
    hostname: os.hostname(), cpu: os.cpus()[0]?.model ?? null, threads: os.cpus().length, memoryGB: Math.round(os.totalmem() / 1e9),
    kernel: `${os.type()} ${os.release()} ${os.arch()}`, governor: governors.join(",") || null,
    noTurbo: readFile("/sys/devices/system/cpu/intel_pstate/no_turbo"), boost: readFile("/sys/devices/system/cpu/cpufreq/boost"),
    taskset: taskset ?? null,
  };
}

function chromeVersionLine(bin) {
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

function resultsDir(scenario, suffix = "") {
  const base = path.join(RESULTS, "cpu", `${today()}-${scenario}${suffix}`);
  let dir = base;
  for (let i = 2; fs.existsSync(dir); i++) dir = `${base}-${i}`;
  return dir;
}

// --- Remote -----------------------------------------------------------------------------------

// Run the same bench on another machine over ssh, at this exact commit, and copy the results back.
async function remoteBench(args, rest) {
  const host = String(args.remote);
  const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8" }).trim();
  // Untracked files (e.g. local results/cpu runs) do not change what the remote checks out.
  if (git("status", "--porcelain", "--untracked-files=no")) throw new Error("--remote needs a clean working tree: commit (and push) first");
  git("fetch", "-q", "origin");
  const sha = git("rev-parse", "HEAD");
  const pushed = spawnSync("git", ["merge-base", "--is-ancestor", sha, "origin/main"], { cwd: ROOT }).status === 0;
  if (!pushed) throw new Error(`HEAD ${sha.slice(0, 12)} is not on origin/main: push it first`);
  // Cloned over HTTPS: the remote may have no ssh key for GitHub, and the repository is public.
  const origin = git("remote", "get-url", "origin").replace(/^git@([^:]+):/, "https://$1/");
  const [which] = args._;
  if (!which) throw new Error("usage: ./rr bench <scenario|all> <framework|all> --remote HOST");
  const scenarios = which === "all" ? listScenarios().filter((s) => fs.existsSync(benchModule(s))) : which.split(",");
  const defaults = REMOTES[host] || {};

  // The same arguments, less --remote and --out, plus the machine's defaults.
  const passed = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    const key = a.replace(/^--/, "").split("=")[0];
    if (a.startsWith("--") && (key === "remote" || key === "out")) {
      if (!a.includes("=") && !BOOLEANS.includes(key) && rest[i + 1] && !rest[i + 1].startsWith("--")) i++;
      continue;
    }
    passed.push(a);
  }
  if (!args.taskset && defaults.taskset) passed.push("--taskset", defaults.taskset);
  if (!args.workers && defaults.workers) passed.push("--workers", String(defaults.workers.length), "--worker-tasksets", defaults.workers.join("/"));
  if (!args.chrome && defaults.chrome) passed.push("--chrome", defaults.chrome);
  const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const ssh = (script) => {
    // -n and no stdin: with an inherited stdin that never closes (a background job), the session
    // stayed open after the remote script had exited.
    const r = spawnSync("ssh", ["-n", host, "bash", "-lc", q(script)], { stdio: ["ignore", "inherit", "inherit"] });
    if (r.status !== 0) throw new Error(`ssh ${host} failed (exit ${r.status})`);
  };

  console.log(`remote ${host}: preparing ${sha.slice(0, 12)}`);
  ssh([
    "set -euo pipefail",
    `R=~/${REMOTE_DIR}`,
    `[ -d "$R/.git" ] || git clone -q ${q(origin)} "$R"`,
    `cd "$R"`,
    "git fetch -q origin",
    `git checkout -q --detach ${sha}`,
    `nix develop -c bash -c ${q("set -e; for d in frameworks/*/; do if [ -f \"$d/package-lock.json\" ]; then (cd \"$d\" && npm ci --silent --no-audit --no-fund); fi; done; frameworks/beni/install.sh")}`,
  ].join("\n"));
  for (const name of scenarios) {
    const local = resultsDir(name, `-${host}`);
    const rel = path.relative(ROOT, local);
    // Only the first positional is the scenario: with `all all`, the framework `all` stays.
    const at = passed.indexOf(which);
    const argv = passed.map((a, i) => (i === at ? name : a));
    console.log(`remote ${host}: ./rr bench ${argv.join(" ")} --out ${rel}`);
    ssh([
      "set -euo pipefail",
      `cd ~/${REMOTE_DIR}`,
      `nix develop -c ./rr bench ${argv.map(q).join(" ")} --out ${q(rel)}`,
    ].join("\n"));
    fs.mkdirSync(local, { recursive: true });
    const r = spawnSync("rsync", ["-a", `${host}:${REMOTE_DIR}/${rel}/`, `${local}/`], { stdio: "inherit" });
    if (r.status !== 0) throw new Error(`rsync from ${host} failed (exit ${r.status})`);
    console.log(`copied ${rel}/ from ${host}`);
  }
}
