// ./rr measure <scenario> <framework|all|a,b> [--sizes 1,2 --seeds 1,2] [emitter options]
//
// For every size × seed × framework variant: generate, build, then measure what the browser
// downloads. HTML: not minified, brotli 11. JavaScript: the production (minified) bundle,
// brotli 11. Bytes are attributed with the source maps to runtime (libraries), tooling
// (unmapped bundler output), app code and the contract adapter; the adapter is excluded from
// the app's size. Results go to results/<date>-<scenario>/.
//
// Emitter options accept comma-separated lists (e.g. --granularity kind,instance) and every
// combination is measured.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { parseArgs, loadScenario, loadEmitters, splitOptions, variantName, ROOT, RESULTS } from "./selection.js";
import { buildApp } from "./generate.js";
import { bucketer, bytesPerSource } from "./sourcemap.js";
import { fitLine } from "./fit.js";

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

function combinations(params, args) {
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

export async function measureCommand(rest) {
  const args = parseArgs(rest);
  const [scenarioName, which] = args._;
  const scenario = await loadScenario(scenarioName);
  const emitters = await loadEmitters(scenario.name, which || "all");
  const { scenarioOptions } = splitOptions(args, scenario, emitters, ["sizes", "seeds", "out"]);
  delete scenarioOptions.size;
  delete scenarioOptions.seed;
  const sizes = args.sizes ? String(args.sizes).split(",").map(Number) : scenario.mod.sizes;
  const seeds = args.seeds ? String(args.seeds).split(",").map(Number) : scenario.mod.seeds;

  const records = [];
  const variants = {};
  for (const emitter of emitters) {
    for (const opts of combinations(emitter.mod.params, args)) {
      const variant = variantName(emitter, opts);
      for (const size of sizes) {
        for (const seed of seeds) {
          const out = await buildApp(scenario, emitter, { ...scenarioOptions, size, seed }, opts);
          const m = measureBuild(out.built, emitter.framework);
          variants[variant] = {
            emitter: emitter.name, framework: emitter.mod.framework, label: emitter.framework.label,
            track: emitter.framework.track, emitterOptions: opts, style: out.info.style,
          };
          records.push({ variant, size, seed, options: out.spec.options, ...m });
          console.log(`${variant} n=${size} s=${seed}: total ${m.total.br} B br (html ${m.html.br}, js ${m.js.br}; runtime ${m.attribution.br.runtime}, app ${m.attribution.br.app}; adapter ${m.adapter.br} excluded)`);
        }
      }
    }
  }

  const frameworks = {};
  for (const e of emitters) frameworks[e.mod.framework] = { label: e.framework.label, track: e.framework.track, versions: e.framework.versions() };
  const run = {
    scenario: scenario.name,
    date: today(),
    sizes,
    seeds,
    scenarioOptions: { ...scenario.mod.normalizeOptions({ ...scenarioOptions, size: sizes[0], seed: seeds[0] }), size: undefined, seed: undefined },
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
  };
  const fits = fitAll(records, scenario.mod.steadyFrom);
  const dir = args.out ? path.resolve(args.out) : resultsDir(scenario.name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "run.json"), JSON.stringify(run, null, 2) + "\n");
  fs.writeFileSync(path.join(dir, "measurements.json"), JSON.stringify(records, null, 1) + "\n");
  fs.writeFileSync(path.join(dir, "fit.json"), JSON.stringify(fits, null, 2) + "\n");
  fs.writeFileSync(path.join(dir, "README.md"), readme(run, fits));
  console.log(`\nwrote ${path.relative(ROOT, dir)}/`);
  for (const [v, f] of Object.entries(fits)) {
    for (const which of ["all", "steady"]) {
      if (!f[which]) continue;
      const t = f[which]["total.br"];
      console.log(`${v} (${which === "all" ? "all sizes" : "N ≥ " + f.steady.from}): baseline ${t.baseline.toFixed(0)} B + ${t.slope.toFixed(1)} B/widget (R² ${t.r2.toFixed(3)})`);
    }
  }
}
