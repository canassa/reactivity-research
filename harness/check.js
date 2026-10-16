// ./rr check <scenario> <framework|all|a,b> [--size N --seed S] [scenario/emitter options]
//
// A quick aid, not the verdict (the owner checks by hand through ./rr serve): builds one small
// app per framework (default: the scenario's quick-check size and options, seed 1), serves it with the
// panel, and runs the whole interaction script in headless Chrome. For every step the panel
// compares the page with the reference render and checks keyed-node identity and focus/caret;
// after dispose, that the root is empty and no listeners or timers are left.
//
// Prototype-track frameworks also get a locality check: the JavaScript calls each local action
// costs (./rr work's measure) at the quick-check size and at 16× it may grow at most
// LOCALITY_MAX_RATIO times. An approach must not buy bytes with work that grows with the whole
// page (e.g. re-evaluating every binding after every event). Real frameworks are measured as they
// ship and are not held to it. --no-locality skips it. Exits non-zero on any failure.

import path from "node:path";
import { selection } from "./cli.js";
import { prepareServe } from "./serve.js";
import { listen } from "./tunnel.js";
import { launch } from "./chrome.js";
import fs from "node:fs";
import { ROOT } from "./selection.js";
import { workScenario, locality } from "./work.js";
import { defaultJobs } from "./pool.js";

export const LOCALITY_MAX_RATIO = 8;

// Runs in the page: every step of the script, collecting what failed.
const RUN = `(async () => {
  const fails = [];
  await rrPanel.reset();
  while (rrPanel.tally.pos < rrPanel.tally.total) {
    await rrPanel.stepOnce();
    const r = rrPanel.last;
    const bad = [];
    if (r.error) bad.push("error: " + r.error);
    if (r.match === false) bad.push("page differs from reference\\n" + r.diff);
    if (r.keyedReplaced && r.keyedReplaced.length) bad.push("keyed elements replaced: " + r.keyedReplaced.join(", "));
    if (r.targetKept === false) bad.push("target element replaced");
    if (r.focus === false) bad.push("focus or caret lost");
    if (r.rootEmpty === false) bad.push("root not empty after dispose");
    if (r.rootEmpty && (r.listeners || r.timers)) bad.push(r.listeners + " listeners and " + r.timers + " timers left after dispose");
    if (bad.length) fails.push({ step: rrPanel.tally.pos, label: r.label, bad });
  }
  return { tally: rrPanel.tally, fails, end: rrPanel.last };
})()`;

// Run the whole interaction script on one served page (with the panel). Also used by ./rr bench
// as its correctness gate.
export async function scriptCheck(chrome, url, { timeout = 15000 } = {}) {
  const t = performance.now();
  const page = await chrome.open(url);
  try {
    await page.waitFor("window.rrPanel && window.rrPanel.ready === true", timeout);
    const r = await page.evaluate(RUN);
    return { r, errors: page.errors, ok: r.fails.length === 0 && page.errors.length === 0, seconds: (performance.now() - t) / 1000 };
  } finally {
    await page.close();
  }
}

// The lines ./rr check prints for one script check.
export function checkReport(scenarioName, v, spec, { r, errors, ok, seconds }) {
  const t = r.tally;
  const lines = [`${ok ? "ok  " : "FAIL"} ${scenarioName}/${v} n=${spec.options.size} s=${spec.options.seed}: ${t.total} steps, ${t.compared} compared with the reference, ` +
    `${t.mismatches} mismatches, ${t.focusLost} focus losses, ${t.keyedReplaced} keyed replacements; ` +
    `after dispose ${r.end.listeners} listeners, ${r.end.timers} timers (${seconds.toFixed(1)}s)`];
  for (const f of r.fails.slice(0, 5)) lines.push(`     step ${f.step} (${f.label}): ${f.bad.join("; ").replace(/\n/g, "\n       ")}`);
  if (r.fails.length > 5) lines.push(`     … ${r.fails.length - 5} more failing steps`);
  for (const e of errors.slice(0, 5)) lines.push(`     page error: ${e}`);
  return { ok, text: lines.join("\n") };
}

export async function checkCommand(rest) {
  const t0 = performance.now();
  const { args, scenario, emitters, scenarioOptions, emitterOptions } = await selection(rest, ["noLocality"]);
  // The scenario's quick-check size and options (e.g. fewer rows of data), unless the flags say
  // otherwise; the locality check below builds with the same options.
  const options = { size: scenario.mod.quickCheckSize ?? 16, seed: 1, ...(scenario.mod.quickCheckOptions || {}), ...scenarioOptions };
  const { spec, variants, handler } = await prepareServe(scenario, emitters, options, emitterOptions, { quiet: true });
  const tBuilt = performance.now();
  const server = await listen(handler, 0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const chrome = await launch();
  let failed = false;
  try {
    const results = await Promise.all(variants.map((v) => scriptCheck(chrome, `${base}/${v}/`)));
    variants.forEach((v, i) => {
      const { ok, text } = checkReport(scenario.name, v, spec, results[i]);
      failed ||= !ok;
      console.log(text);
    });
  } finally {
    await chrome.close();
    server.close();
    server.closeAllConnections?.();
  }
  if (!args.noLocality) {
    failed = (await checkLocality(scenario, emitters, options, emitterOptions)) || failed;
  }
  console.log(`build ${((tBuilt - t0) / 1000).toFixed(1)}s, total ${((performance.now() - t0) / 1000).toFixed(1)}s · generated in ${path.relative(ROOT, "generated/" + scenario.name)}/`);
  if (failed) process.exitCode = 1;
}

// The locality check, for prototype-track variants only. Returns true if any failed.
async function checkLocality(scenario, emitters, options, emitterOptions) {
  const prototypes = emitters.filter((e) => e.framework.track === "prototype");
  if (prototypes.length === 0) return false;
  if (!fs.existsSync(path.join(ROOT, "harness", "work", `${scenario.name}.js`))) {
    console.log(`locality: no work actions for ${scenario.name}, skipped`);
    return false;
  }
  // The work actions need one widget of each kind, so start no smaller than the quick-check size
  // (the smallest with every kind), whatever --size the script check used.
  const lo = Math.max(options.size, scenario.mod.quickCheckSize ?? options.size), hi = lo * 16;
  const t = performance.now();
  const { records, run } = await workScenario(scenario, { ...options, size: undefined }, prototypes, emitterOptions,
    { sizes: [lo, hi], runs: 1, jobs: defaultJobs(), log: () => {} });
  let failed = false;
  for (const [v, l] of Object.entries(locality(records, run))) {
    const ok = l.maxRatio <= LOCALITY_MAX_RATIO;
    failed ||= !ok;
    console.log(`${ok ? "ok  " : "FAIL"} locality ${scenario.name}/${v}: calls per local action grow at most ${l.maxRatio.toFixed(1)}× from n=${lo} to n=${hi} ` +
      `(limit ${LOCALITY_MAX_RATIO}×; worst: ${l.worst}; median ${l.callsAtMin} → ${l.callsAtMax} calls)`);
  }
  console.log(`locality ${((performance.now() - t) / 1000).toFixed(1)}s`);
  return failed;
}
