// ./rr measure <scenario> <framework|all|a,b> [--sizes 1,2 --seeds 1,2] [--force] [--jobs N]
//                [emitter options]
//
// For every size × seed × framework variant: generate, build, then measure what the browser
// downloads. HTML: not minified, brotli 11. JavaScript: the production (minified) bundle,
// brotli 11. Bytes are attributed with the source maps to runtime (libraries), tooling
// (unmapped bundler output), app code and the contract adapter; the adapter is excluded from
// the app's size. Results go to results/<date>-<scenario>/.
//
// Emitter options accept comma-separated lists (e.g. --some-option a,b) and every
// combination is measured. A record whose inputs (see codeHash) match a committed result is
// reused instead of rebuilt; --force measures everything again.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { parseArgs, loadScenario, loadEmitters, splitOptions, variantName, ROOT, RESULTS } from "./selection.js";
import { runJobs, defaultJobs, timingText } from "./pool.js";
import { bucketer, bytesPerSource } from "./sourcemap.js";
import { fitLine } from "./fit.js";
import { readConfig } from "./report.js";

export const BROTLI = { quality: 11, lgwin: 24, mode: "generic" };

export function brotli(text) {
  if (!text) return 0;
  return zlib.brotliCompressSync(Buffer.from(text), {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: BROTLI.quality,
      [zlib.constants.BROTLI_PARAM_LGWIN]: BROTLI.lgwin,
      [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_GENERIC,
    },
  }).length;
}

const bytes = (s) => Buffer.byteLength(s || "");

export function combinations(params, args) {
  let combos = [{}];
  for (const [k, p] of Object.entries(params || {})) {
    const values = String(args[k] ?? p.default).split(",");
    for (const v of values) if (p.choices && !p.choices.includes(v)) throw new Error(`--${k} must be among ${p.choices.join(", ")}`);
    combos = combos.flatMap((c) => values.map((v) => ({ ...c, [k]: v })));
  }
  return combos;
}

// Measure one built app.
export function measureBuild(built, framework) {
  const html = fs.readFileSync(built.html, "utf8");
  const parts = { runtime: "", tooling: "", app: "", adapter: "" };
  const files = {};
  let full = "";
  let js = "";
  let runtime = "";
  for (const s of built.scripts) {
    const code = fs.readFileSync(s.file, "utf8");
    const map = JSON.parse(fs.readFileSync(s.map, "utf8"));
    full += code;
    const only = bucketer(code, map, (src) => framework.classify(src), "tooling");
    for (const k of Object.keys(parts)) parts[k] += only(k);
    // The app's JavaScript is the bundle without the adapter's bytes; the runtime is the
    // bundle with only library and tooling bytes. Both keep the file order.
    js += only("runtime", "tooling", "app");
    runtime += only("runtime", "tooling");
    for (const [src, n] of Object.entries(bytesPerSource(code, map))) {
      const key = src.replace(/^(\.\.\/)+/, "").replace(/^.*node_modules\//, "node_modules/");
      files[key] = (files[key] || 0) + n;
    }
  }
  const jsBr = brotli(js);
  const runtimeBr = brotli(runtime);
  const htmlBr = brotli(html);
  const fullBr = brotli(full);
  return {
    html: { raw: bytes(html), br: htmlBr },
    js: { raw: bytes(js), br: jsBr },
    total: { raw: bytes(html) + bytes(js), br: htmlBr + jsBr },
    // Raw minified bytes per bucket; brotli split by deletion: runtime alone, and app as what
    // it adds on top of the runtime.
    attribution: {
      raw: { runtime: bytes(parts.runtime), tooling: bytes(parts.tooling), app: bytes(parts.app) },
      br: { runtime: runtimeBr, app: jsBr - runtimeBr },
    },
    adapter: { raw: bytes(parts.adapter), br: fullBr - jsBr },
    bundle: { raw: bytes(full), br: fullBr, files: built.scripts.length },
    perSource: files,
  };
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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

function resultsDir(scenario) {
  const base = path.join(RESULTS, `${today()}-${scenario}`);
  let dir = base;
  for (let i = 2; fs.existsSync(dir); i++) dir = `${base}-${i}`;
  return dir;
}

const METRICS = {
  "total.br": (m) => m.total.br, "js.br": (m) => m.js.br, "html.br": (m) => m.html.br,
  "runtime.br": (m) => m.attribution.br.runtime, "app.br": (m) => m.attribution.br.app,
  "total.raw": (m) => m.total.raw, "js.raw": (m) => m.js.raw, "html.raw": (m) => m.html.raw,
  "runtime.raw": (m) => m.attribution.raw.runtime + m.attribution.raw.tooling, "app.raw": (m) => m.attribution.raw.app,
  "adapter.br": (m) => m.adapter.br,
};

// Per variant: a fit over every size (`all`) and, when the scenario names a size from which
// its growth is steady, one over those sizes (`steady`).
export function fitAll(records, steadyFrom) {
  const out = {};
  for (const v of [...new Set(records.map((r) => r.variant))]) {
    const rs = records.filter((r) => r.variant === v);
    out[v] = { all: {} };
    for (const [name, get] of Object.entries(METRICS)) out[v].all[name] = fitLine(rs.map((r) => [r.size, get(r)]));
    const steady = rs.filter((r) => steadyFrom && r.size >= steadyFrom);
    if (new Set(steady.map((r) => r.size)).size >= 2) {
      out[v].steady = { from: steadyFrom };
      for (const [name, get] of Object.entries(METRICS)) out[v].steady[name] = fitLine(steady.map((r) => [r.size, get(r)]));
    }
    const smallest = Math.min(...rs.map((r) => r.size));
    const at = rs.filter((r) => r.size === smallest).map((r) => r.total.br).sort((a, b) => a - b);
    out[v].smallest = { size: smallest, "total.br median": at[Math.floor(at.length / 2)] };
  }
  return out;
}

function readme(run, fits) {
  const row = (v, f, which) => {
    const t = f[which]["total.br"];
    return `| ${v} | ${which === "all" ? "all" : "≥ " + f.steady.from} | ${t.baseline.toFixed(0)} | ${t.slope.toFixed(1)} | ${t.r2.toFixed(3)} | ${f[which]["js.br"].slope.toFixed(1)} | ${f[which]["app.br"].slope.toFixed(1)} | ${f.smallest["total.br median"]} |`;
  };
  const rows = Object.entries(fits).flatMap(([v, f]) => [row(v, f, "all"), ...(f.steady ? [row(v, f, "steady")] : [])]);
  return `# ${run.scenario}: sizes measured ${run.date}

Generated by \`./rr measure\`. Raw data: \`measurements.json\`; fits: \`fit.json\`; versions and
options: \`run.json\`.

Sizes ${run.sizes.join(", ")} × seeds ${run.seeds.join(", ")}. Compressed = brotli quality ${BROTLI.quality}
(window ${BROTLI.lgwin}); JavaScript minified by the framework's production build, HTML not minified.
The contract adapter is excluded from every number below (it is in \`adapter\`).

Least-squares fit of the compressed total against N (bytes = baseline + slope × N):

| variant | sizes fitted | baseline (B) | slope (B/widget) | R² | JS slope | app-code slope | measured total at N=${Math.min(...run.sizes)} (median, B) |
|---|---|---|---|---|---|---|---|
${rows.join("\n")}
`;
}

// Everything that can change a measurement, hashed: the scenario generator, the emitter, code
// shared by the scenario's emitters (scenarios/<scenario>/shared/), the framework's files and lockfile, shared emitter helpers, the harness code that builds
// and measures, and the Node and brotli versions. Options, size and seed are added per record.
const HASHED_HARNESS = ["harness/generate.js", "harness/measure.js", "harness/sourcemap.js"];

function filesUnder(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    if (d.name === "node_modules") return [];
    const f = path.join(dir, d.name);
    return d.isDirectory() ? filesUnder(f) : [f];
  });
}

export function codeHash(scenario, emitter) {
  const files = [
    scenario.specFile, emitter.file,
    // Code shared by several emitters of this scenario (scenarios/<scenario>/shared/).
    ...filesUnder(path.join(scenario.dir, "shared")),
    ...filesUnder(emitter.frameworkDir), ...filesUnder(path.join(ROOT, "frameworks", "shared")),
    ...HASHED_HARNESS.map((f) => path.join(ROOT, f)),
  ].sort();
  const h = crypto.createHash("sha256");
  for (const f of files) h.update(path.relative(ROOT, f) + "\0").update(fs.readFileSync(f)).update("\0");
  h.update(process.version + "\0" + process.versions.brotli);
  return h.digest("hex");
}

function inputsHash(code, scenarioOptions, emitterOptions) {
  return crypto.createHash("sha256").update(code).update(JSON.stringify({ scenarioOptions, emitterOptions })).digest("hex").slice(0, 16);
}

// Previously measured records of a scenario, by inputs hash, from every committed run.
function previousRecords(scenarioName) {
  const out = new Map();
  if (!fs.existsSync(RESULTS)) return out;
  for (const d of fs.readdirSync(RESULTS).sort((a, b) => a.localeCompare(b, "en", { numeric: true }))) {
    const runFile = path.join(RESULTS, d, "run.json");
    if (!fs.existsSync(runFile)) continue;
    const run = JSON.parse(fs.readFileSync(runFile, "utf8"));
    if (run.scenario !== scenarioName) continue;
    for (const r of JSON.parse(fs.readFileSync(path.join(RESULTS, d, "measurements.json"), "utf8"))) {
      if (r.inputs) out.set(r.inputs, { record: r, variant: run.variants[r.variant], frameworks: run.frameworks });
    }
  }
  return out;
}

function latestRun(scenarioName) {
  if (!fs.existsSync(RESULTS)) return null;
  const dirs = fs.readdirSync(RESULTS).filter((d) => {
    const f = path.join(RESULTS, d, "run.json");
    return fs.existsSync(f) && JSON.parse(fs.readFileSync(f, "utf8")).scenario === scenarioName;
  }).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  return dirs.length ? path.join(RESULTS, dirs[dirs.length - 1]) : null;
}

// Measure a set of runs of one scenario: [{ emitter, emitterOptions, sizes, seeds }].
// Records whose inputs hash matches a committed result are reused unless `force`.
// Writes a results directory unless `onlyIfChanged` and the latest one already holds exactly
// these records. Returns the directory written (or null) and the fits.
export async function measureScenario(scenario, scenarioOptions, plan, { force = false, out = null, onlyIfChanged = false, jobs = defaultJobs() } = {}) {
  const previous = force ? new Map() : previousRecords(scenario.name);
  const slots = [];
  const frameworks = {};
  for (const { emitter, emitterOptions: opts, sizes, seeds } of plan) {
    const variant = variantName(emitter, opts);
    const code = codeHash(scenario, emitter);
    frameworks[emitter.mod.framework] = { label: emitter.framework.label, track: emitter.framework.track, versions: emitter.framework.versions() };
    for (const size of sizes) {
      for (const seed of seeds) {
        const options = scenario.mod.normalizeOptions({ ...scenarioOptions, size, seed });
        const inputs = inputsHash(code, options, opts);
        slots.push({ emitter, opts, variant, code, sizes, seeds, size, seed, options, inputs, hit: previous.get(inputs) });
      }
    }
  }
  for (const s of slots.filter((s) => s.hit)) console.log(`${s.variant} n=${s.size} s=${s.seed}: unchanged, reusing ${s.hit.record.total.br} B br`);

  // Build and measure what is not cached, in parallel worker processes.
  const todo = slots.filter((s) => !s.hit);
  if (todo.length) console.log(`building and measuring ${todo.length} app(s) with up to ${Math.min(jobs, todo.length)} parallel jobs`);
  const results = await runJobs(todo.map((s) => ({
    scenario: scenario.name, emitter: s.emitter.name, variant: s.variant, scenarioOptions: s.options, emitterOptions: s.opts, measure: true,
  })), {
    jobs,
    onDone: (job, r) => {
      const m = r.measurement;
      console.log(`${job.variant} n=${job.scenarioOptions.size} s=${job.scenarioOptions.seed}: total ${m.total.br} B br (html ${m.html.br}, js ${m.js.br}; runtime ${m.attribution.br.runtime}, app ${m.attribution.br.app}; adapter ${m.adapter.br} excluded) [${timingText(r.timing)}]`);
    },
  });
  todo.forEach((s, k) => { s.result = results[k]; });
  const fresh = todo.length;

  const records = [];
  const variants = {};
  for (const s of slots) {
    const record = s.hit
      ? { ...s.hit.record, variant: s.variant }
      : { variant: s.variant, size: s.size, seed: s.seed, options: s.result.options, inputs: s.inputs, ...s.result.measurement };
    records.push(record);
    variants[s.variant] ||= {
      emitter: s.emitter.name, framework: s.emitter.mod.framework, label: s.emitter.framework.label,
      track: s.emitter.framework.track, emitterOptions: s.opts, style: s.hit ? s.hit.variant?.style : s.result.style,
      sizes: s.sizes, seeds: s.seeds, code: s.code.slice(0, 16),
    };
  }
  const fits = fitAll(records, scenario.mod.steadyFrom);

  if (onlyIfChanged && !force) {
    const latest = latestRun(scenario.name);
    const key = (rs) => rs.map((r) => `${r.variant}|${r.size}|${r.seed}|${r.inputs}`).sort().join("\n");
    if (latest && key(JSON.parse(fs.readFileSync(path.join(latest, "measurements.json"), "utf8"))) === key(records)) {
      console.log(`${scenario.name}: nothing changed since ${path.relative(ROOT, latest)}/`);
      return { dir: null, fits, fresh };
    }
  }

  const union = (k) => [...new Set(plan.flatMap((p) => p[k]))].sort((a, b) => a - b);
  const run = {
    scenario: scenario.name,
    date: today(),
    sizes: union("sizes"),
    seeds: union("seeds"),
    scenarioOptions: (({ size, seed, ...rest }) => rest)(scenario.mod.normalizeOptions({ ...scenarioOptions, size: 1, seed: 1 })),
    variants,
    frameworks,
    versions: {
      node: process.version,
      brotli: `${process.versions.brotli} (node:zlib)`,
      platform: `${os.platform()} ${os.release()} ${os.arch()}`,
      git: gitInfo(),
    },
    compression: { brotli: BROTLI, html: "not minified", js: "minified by the framework's production build" },
    attribution: "source maps: node_modules → runtime; unmapped bundler output → tooling (counted with runtime); the adapter file → adapter (excluded); everything else → app. Brotli split: runtime = brotli(runtime+tooling); app = brotli(app JS) − runtime.",
    reused: records.length - fresh,
  };
  const dir = out ? path.resolve(out) : resultsDir(scenario.name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "run.json"), JSON.stringify(run, null, 2) + "\n");
  fs.writeFileSync(path.join(dir, "measurements.json"), JSON.stringify(records, null, 1) + "\n");
  fs.writeFileSync(path.join(dir, "fit.json"), JSON.stringify(fits, null, 2) + "\n");
  fs.writeFileSync(path.join(dir, "README.md"), readme(run, fits));
  console.log(`\nwrote ${path.relative(ROOT, dir)}/ (${fresh} measured, ${records.length - fresh} reused)`);
  for (const [v, f] of Object.entries(fits)) {
    for (const which of ["all", "steady"]) {
      if (!f[which]) continue;
      const t = f[which]["total.br"];
      console.log(`${v} (${which === "all" ? "all sizes" : "N ≥ " + f.steady.from}): baseline ${t.baseline.toFixed(0)} B + ${t.slope.toFixed(1)} B/widget (R² ${t.r2.toFixed(3)})`);
    }
  }
  return { dir, fits, fresh };
}

export async function measureCommand(rest) {
  const args = parseArgs(rest, ["force"]);
  const [scenarioName, which] = args._;
  const scenario = await loadScenario(scenarioName);
  const emitters = await loadEmitters(scenario.name, which || "all");
  const { scenarioOptions } = splitOptions(args, scenario, emitters, ["sizes", "seeds", "out", "force", "jobs"]);
  delete scenarioOptions.size;
  delete scenarioOptions.seed;
  // Sizes and seeds: from the flags, else from the emitter's entry in runs.json.
  const config = readConfig()[scenario.name] || {};
  const listOf = (flag, emitter, key) => {
    const v = args[flag] ?? config[emitter.name]?.[key];
    if (v == null) throw new Error(`no ${key} for ${scenario.name}/${emitter.name}: pass --${flag} or add it to runs.json`);
    return Array.isArray(v) ? v : String(v).split(",").map(Number);
  };
  const plan = emitters.flatMap((emitter) => combinations(emitter.mod.params, args).map((emitterOptions) => ({
    emitter, emitterOptions, sizes: listOf("sizes", emitter, "sizes"), seeds: listOf("seeds", emitter, "seeds"),
  })));
  await measureScenario(scenario, scenarioOptions, plan, { force: !!args.force, out: args.out, jobs: Number(args.jobs || defaultJobs()) });
}
