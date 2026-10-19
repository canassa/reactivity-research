// ./rr parse [--points 8] [--from-kb 25] [--to-kb 3000] [--seed 1] [--modes external,inline]
//            [--min-reps 10] [--max-reps 40] [--tol 0.03] [--quick] [--out DIR] [--chrome PATH]
//            [--taskset CPUS] [--max-load 1.0] [--load-wait 120]
//
// How long does Chrome take to parse and compile JavaScript, against its size? One generated
// program (harness/parse/generate.js) at a geometric series of sizes, each in three forms
// (unminified, esbuild, esbuild + terser), each load a fresh page that fetches the script from a
// local HTTP server (external) or has it inside the HTML (inline, a cross-check that keeps all
// the work on the main thread). Every load is traced and read with harness/parse/analyse.js.
//
// Statistics follow ./rr bench: a discarded warm-up load per point, then loads in rounds that visit
// every point in turn (so drift lands on all of them), until the median's 95% bootstrap interval is
// within ±tol for compile and for evaluate, from min to max loads. Results go to
// results/parse/<date>[-n]/ (run.json, samples.json, summary.json). Method: harness/parse/README.md.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { parseArgs, ROOT, RESULTS } from "./selection.js";
import { launch, findChrome } from "./chrome.js";
import { CATEGORIES } from "./bench/lib/trace.js";
import { describe, precise } from "./bench/lib/stats.js";
import { buildPayload, FORMS, versions as toolVersions } from "./parse/payloads.js";
import { analyseLoad, fit } from "./parse/analyse.js";

const BOOLEANS = ["quick"];
// Chrome flags: the ones ./rr bench uses (no throttling, no background throttling, no GPU).
const CHROME_FLAGS = [
  "--disable-background-networking", "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows", "--disable-gpu", "--window-size=1280,1000",
];
// "v8" holds v8.compile and v8.parseOnBackground; devtools.timeline the page's events.
const TRACE_CATEGORIES = [...new Set([...CATEGORIES, "v8"])];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function parseCommand(rest) {
  const args = parseArgs(rest, BOOLEANS);
  const quick = !!args.quick;
  const o = {
    points: Number(args.points ?? (quick ? 3 : 8)),
    fromKb: Number(args.fromKb ?? 25),
    toKb: Number(args.toKb ?? 3000),
    seed: Number(args.seed ?? 1),
    modes: String(args.modes ?? "external,inline").split(","),
    minReps: Number(args.minReps ?? (quick ? 4 : 10)),
    maxReps: Number(args.maxReps ?? (quick ? 4 : 40)),
    tol: Number(args.tol ?? 0.03),
    step: 2,
    maxLoad: Number(args.maxLoad ?? 1.0),
    loadWaitS: Number(args.loadWait ?? 120),
  };
  if (o.points < 2) throw new Error("--points must be at least 2");
  for (const m of o.modes) if (!["external", "inline"].includes(m)) throw new Error(`unknown mode "${m}" (external, inline)`);
  const machine = machineInfo();
  const git = gitInfo();   // taken now: the tree may change while a long run goes on
  const warnings = [];
  if (machine.governor !== "performance") {
    warnings.push(`CPU governor is "${machine.governor}", not "performance": small timings can read about 3x too high on this machine. Treat the absolute numbers with care.`);
    console.warn(`\n!!! ${warnings[0]}\n`);
  }

  // The payloads.
  const tmp = path.join(RESULTS, "tmp", "parse");
  fs.mkdirSync(tmp, { recursive: true });
  const ratio = (o.toKb / o.fromKb) ** (1 / (o.points - 1));
  const targets = Array.from({ length: o.points }, (_, i) => Math.round(o.fromKb * 1000 * ratio ** i));
  console.log(`generating ${o.points} payloads (${targets.map((t) => Math.round(t / 1000) + " kB").join(", ")}), seed ${o.seed}`);
  const payloads = [];
  for (const targetBytes of targets) {
    const p = await buildPayload({ targetBytes, seed: o.seed, dir: tmp });
    for (const f of Object.values(p.forms)) f.brotli = zlib.brotliCompressSync(f.code, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: f.bytes } }).length;
    payloads.push(p);
    console.log(`  ${Math.round(targetBytes / 1000)} kB: ${p.modules} modules; ${FORMS.map((f) => `${f} ${p.forms[f].bytes}`).join(", ")}`);
  }

  // The points: one per (mode, form, size).
  const points = [];
  for (const mode of o.modes) {
    for (const form of FORMS) {
      payloads.forEach((p, i) => points.push({ key: `${mode}/${form}/${i}`, mode, form, index: i, id: `${form}-${i}`, bytes: p.forms[form].bytes, modules: p.modules }));
    }
  }
  const bodies = new Map(points.map((pt) => [pt.id, Buffer.from(payloads[pt.index].forms[pt.form].code)]));

  // The server. Every response is no-store; every load has its own query string.
  const server = await new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      const u = new URL(req.url, "http://x");
      const [, kind, id] = u.pathname.split("/");
      const head = { "cache-control": "no-store" };
      const marker = `<script>performance.mark("rr-parse-done");window.rrParseDone&&window.rrParseDone("")</script>`;
      if (kind === "js" && bodies.has(id.replace(/\.js$/, ""))) {
        res.writeHead(200, { ...head, "content-type": "text/javascript; charset=utf-8" });
        res.end(bodies.get(id.replace(/\.js$/, "")));
      } else if (kind === "external" && bodies.has(id)) {
        res.writeHead(200, { ...head, "content-type": "text/html; charset=utf-8" });
        res.end(`<!doctype html><meta charset="utf-8"><title>parse</title><script src="/js/${id}.js?r=${u.searchParams.get("r")}"></script>${marker}`);
      } else if (kind === "inline" && bodies.has(id)) {
        res.writeHead(200, { ...head, "content-type": "text/html; charset=utf-8" });
        res.end(Buffer.concat([Buffer.from(`<!doctype html><meta charset="utf-8"><title>parse</title><script>`), bodies.get(id), Buffer.from(`</script>${marker}`)]));
      } else {
        res.writeHead(404, head);
        res.end("not found");
      }
    });
    s.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  const chrome = await launch({ args: CHROME_FLAGS, chrome: args.chrome, taskset: args.taskset, profilePrefix: "rr-parse-" });
  const started = new Date();
  const loadavg = [];
  // Before a round: wait up to loadWaitS for the 1-minute load average to fall below maxLoad (the
  // project's benches do the same); a round that starts above it is recorded as noisy.
  async function quiet(at) {
    const t0 = Date.now();
    while (load().load1 >= o.maxLoad && Date.now() - t0 < o.loadWaitS * 1000) await sleep(5000);
    const l = load();
    loadavg.push({ at, ...l, waitedS: Math.round((Date.now() - t0) / 1000), noisy: l.load1 >= o.maxLoad });
  }
  const samples = new Map(points.map((pt) => [pt.key, []]));
  let seq = 0, loads = 0;

  // One fresh page: trace from before the navigation to the script's end, then read the trace.
  async function loadOnce(pt) {
    const n = ++seq;
    const events = [];
    let done;
    const finished = new Promise((r) => { done = r; });
    const url = pt.mode === "external" ? `${base}/external/${pt.id}?r=${n}` : `${base}/inline/${pt.id}?r=${n}`;
    const scriptUrl = pt.mode === "external" ? `${base}/js/${pt.id}.js?r=${n}` : url;
    let stopped;
    const traceDone = new Promise((r) => { stopped = r; });
    const page = await chrome.open(url, {
      beforeNavigate: async (p) => {
        p.on((m) => {
          if (m.method === "Tracing.dataCollected") events.push(...m.params.value);
          if (m.method === "Tracing.tracingComplete") stopped();
          if (m.method === "Runtime.bindingCalled" && m.params.name === "rrParseDone") done();
        });
        await p.cdp("Runtime.addBinding", { name: "rrParseDone" });
        await p.cdp("Network.enable");
        await p.cdp("Network.setCacheDisabled", { cacheDisabled: true });
        await p.cdp("Tracing.start", { traceConfig: { includedCategories: TRACE_CATEGORIES }, transferMode: "ReportEvents" });
      },
    });
    const timer = setTimeout(() => done("timeout"), 60000);
    const r = await finished;
    clearTimeout(timer);
    if (r === "timeout") throw new Error(`${pt.key}: the script did not finish in 60 s${page.errors.length ? `: ${page.errors[0]}` : ""}`);
    await page.cdp("Tracing.end");
    await traceDone;
    // Outside the trace: the program really ran, and the page had no errors.
    const count = await page.evaluate("window.Backoffice && window.Backoffice.booted.count");
    if (page.errors.length) throw new Error(`${pt.key}: page errors: ${page.errors.slice(0, 2).join("; ")}`);
    if (count !== pt.modules) throw new Error(`${pt.key}: the page booted ${count} modules, expected ${pt.modules}`);
    await page.close();
    loads++;
    return analyseLoad(events, { scriptUrl, inline: pt.mode === "inline" });
  }

  const isPrecise = (xs, tol) => xs.length >= o.minReps && precise(xs, tol);
  const settledPoint = (pt) => {
    const s = samples.get(pt.key);
    if (s.length >= o.maxReps) return true;
    return s.length >= o.minReps && isPrecise(s.map((x) => x.compileUs), o.tol) && isPrecise(s.map((x) => x.evaluateUs), o.tol);
  };

  try {
    console.log(`${points.length} points (${o.modes.join(", ")} x ${FORMS.length} forms x ${o.points} sizes), Chrome ${await chrome.version()}`);
    await quiet("start");
    // The discarded warm-up load of every point.
    for (const pt of points) await loadOnce(pt);
    let round = 0;
    for (;;) {
      const active = points.filter((pt) => !settledPoint(pt));
      if (!active.length) break;
      if (round % 2) active.reverse();
      await quiet(`round ${round + 1}`);
      for (const pt of active) {
        for (let i = 0; i < o.step && samples.get(pt.key).length < o.maxReps; i++) samples.get(pt.key).push(await loadOnce(pt));
      }
      round++;
      console.log(`round ${round}: ${active.length} point(s) still going, ${loads} loads`);
    }
  } finally {
    await chrome.close();
    server.close();
  }
  loadavg.push({ at: "end", ...load() });
  const noisy = loadavg.filter((l) => l.noisy).length;
  if (noisy) {
    warnings.push(`The 1-minute load average was at or above ${o.maxLoad} when ${noisy} of ${loadavg.length - 1} rounds started (highest ${Math.max(...loadavg.map((l) => l.load1))}) on a ${machine.threads}-thread machine, so other processes were competing with Chrome: timings are inflated and noisy.`);
    console.warn(`\n!!! ${warnings[warnings.length - 1]}\n`);
  }

  // Summaries.
  const ms = (us) => us / 1000;
  const metrics = ["compileUs", "compileMainUs", "compileBackgroundUs", "evaluateUs", "requestToEvaluatedUs"];
  const summary = { points: [], fits: [] };
  for (const pt of points) {
    const s = samples.get(pt.key);
    const row = {
      key: pt.key, mode: pt.mode, form: pt.form, sizeIndex: pt.index, bytes: pt.bytes, brotliBytes: payloads[pt.index].forms[pt.form].brotli, modules: pt.modules, n: s.length,
      streamedLoads: s.filter((x) => x.streamed).length, hitMax: s.length >= o.maxReps && !(isPrecise(s.map((x) => x.compileUs), o.tol) && isPrecise(s.map((x) => x.evaluateUs), o.tol)),
    };
    for (const m of metrics) {
      const xs = s.map((x) => x[m]).filter((v) => v != null).map(ms);
      if (!xs.length) continue;
      const d = describe(xs, 4);
      row[m.replace(/Us$/, "Ms")] = { ...d, precisionPct: d.median ? +(((d.ci[1] - d.ci[0]) / 2 / d.median) * 100).toFixed(2) : null };
    }
    summary.points.push(row);
  }
  for (const mode of o.modes) {
    for (const form of FORMS) {
      const rows = summary.points.filter((p) => p.mode === mode && p.form === form);
      for (const m of ["compileMs", "evaluateMs"]) {
        summary.fits.push({ mode, form, metric: m, ...fit(rows.map((p) => ({ bytes: p.bytes, ms: p[m].median }))) });
      }
    }
  }

  // Write.
  const date = started.toISOString().slice(0, 10);
  const parseRoot = path.join(RESULTS, "parse");
  let dir = args.out ? path.resolve(args.out) : path.join(parseRoot, date);
  if (!args.out) for (let k = 2; fs.existsSync(dir); k++) dir = path.join(parseRoot, `${date}-${k}`);
  fs.mkdirSync(dir, { recursive: true });
  const run = {
    kind: "parse", date, started: started.toISOString(), finished: new Date().toISOString(), quick,
    options: { ...o, forms: FORMS, generator: "harness/parse/generate.js", tolerance: `±${o.tol * 100}% on the 95% bootstrap interval of the median, compile and evaluate both` },
    versions: { node: process.version, chrome: `${await chromeVersionString(args.chrome)}`, ...toolVersions(), brotli: brotliVersion(), git },
    machine, warnings,
    chromeFlags: CHROME_FLAGS, traceCategories: TRACE_CATEGORIES,
    cacheDefence: "unique query string per load, Cache-Control: no-store, Network.setCacheDisabled; every load's v8.compile event is checked for cacheKind/cacheRejected/consumedCacheSize and a cache notStreamedReason, and the response for fromCache; any hit aborts the run",
    loadsTotal: loads, loadavg,
    payloads: payloads.map((p) => ({ targetBytes: p.targetBytes, modules: p.modules, forms: Object.fromEntries(FORMS.map((f) => [f, { bytes: p.forms[f].bytes, brotliBytes: p.forms[f].brotli, sha256: p.forms[f].sha256 }])) })),
  };
  fs.writeFileSync(path.join(dir, "run.json"), JSON.stringify(run, null, 2) + "\n");
  fs.writeFileSync(path.join(dir, "samples.json"), JSON.stringify(Object.fromEntries(samples), null, 1) + "\n");
  fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(`wrote ${path.relative(ROOT, dir)} (${loads} loads)`);
  for (const f of summary.fits.filter((x) => x.mode === o.modes[0])) {
    console.log(`  ${f.mode} ${f.form} ${f.metric}: ${f.msPer100kB} ms/100kB (R2 ${f.r2}), exponent ${f.exponent} +- ${f.exponentSe} ${f.linear ? "linear" : "NOT linear"}`);
  }
  if (warnings.length) console.warn(`\n!!! ${warnings[0]}`);
}

function load() {
  const [a, b, c] = os.loadavg();
  return { load1: +a.toFixed(2), load5: +b.toFixed(2), load15: +c.toFixed(2) };
}

const read = (f) => { try { return fs.readFileSync(f, "utf8").trim(); } catch { return null; } };
function machineInfo() {
  const cpu = "/sys/devices/system/cpu/cpu0/cpufreq/";
  return {
    hostname: os.hostname(), cpu: os.cpus()[0]?.model ?? null, threads: os.cpus().length, memoryGB: Math.round(os.totalmem() / 1e9),
    governor: read(cpu + "scaling_governor") ?? "unknown", availableGovernors: read(cpu + "scaling_available_governors"),
    scalingDriver: read(cpu + "scaling_driver"), curFreqKHz: Number(read(cpu + "scaling_cur_freq")) || null, maxFreqKHz: Number(read(cpu + "cpuinfo_max_freq")) || null,
    minFreqKHz: Number(read(cpu + "cpuinfo_min_freq")) || null, energyPerformancePreference: read(cpu + "energy_performance_preference"),
    noTurbo: read("/sys/devices/system/cpu/intel_pstate/no_turbo"), platform: `${os.platform()} ${os.release()} ${os.arch()}`,
  };
}
async function chromeVersionString(explicit) {
  const bin = findChrome(explicit);
  try { return execFileSync(bin, ["--version"], { encoding: "utf8" }).trim(); } catch { return bin; }
}
function brotliVersion() {
  try { return execFileSync("brotli", ["--version"], { encoding: "utf8" }).trim(); } catch { return null; }
}
function gitInfo() {
  try {
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" }).trim().length > 0;
    return { commit, dirty };
  } catch { return null; }
}
