// ./rr check <scenario> <framework|all|a,b> [--size N --seed S] [scenario/emitter options]
//
// A quick aid, not the verdict (the owner checks by hand through ./rr serve): builds one small
// app per framework (default: the scenario's quick-check size, seed 1), serves it with the
// panel, and runs the whole interaction script in headless Chrome. For every step the panel
// compares the page with the reference render and checks keyed-node identity and focus/caret;
// after dispose, that the root is empty and no listeners or timers are left. Exits non-zero on
// any failure.

import path from "node:path";
import { selection } from "./cli.js";
import { prepareServe } from "./serve.js";
import { listen } from "./tunnel.js";
import { launch } from "./chrome.js";
import { ROOT } from "./selection.js";

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

export async function checkCommand(rest) {
  const t0 = performance.now();
  const { scenario, emitters, scenarioOptions, emitterOptions } = await selection(rest);
  const options = { size: scenario.mod.quickCheckSize ?? 16, seed: 1, ...scenarioOptions };
  const { spec, variants, handler } = await prepareServe(scenario, emitters, options, emitterOptions, { quiet: true });
  const tBuilt = performance.now();
  const server = await listen(handler, 0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const chrome = await launch();
  let failed = false;
  try {
    const results = await Promise.all(variants.map(async (v) => {
      const t = performance.now();
      const page = await chrome.open(`${base}/${v}/`);
      await page.waitFor("window.rrPanel && window.rrPanel.ready === true");
      const r = await page.evaluate(RUN);
      await page.close();
      return { v, r, errors: page.errors, seconds: (performance.now() - t) / 1000 };
    }));
    for (const { v, r, errors, seconds } of results) {
      const t = r.tally;
      const ok = r.fails.length === 0 && errors.length === 0;
      failed ||= !ok;
      console.log(`${ok ? "ok  " : "FAIL"} ${scenario.name}/${v} n=${spec.options.size} s=${spec.options.seed}: ${t.total} steps, ${t.compared} compared with the reference, ` +
        `${t.mismatches} mismatches, ${t.focusLost} focus losses, ${t.keyedReplaced} keyed replacements; ` +
        `after dispose ${r.end.listeners} listeners, ${r.end.timers} timers (${seconds.toFixed(1)}s)`);
      for (const f of r.fails.slice(0, 5)) console.log(`     step ${f.step} (${f.label}): ${f.bad.join("; ").replace(/\n/g, "\n       ")}`);
      if (r.fails.length > 5) console.log(`     … ${r.fails.length - 5} more failing steps`);
      for (const e of errors.slice(0, 5)) console.log(`     page error: ${e}`);
    }
  } finally {
    await chrome.close();
    server.close();
    server.closeAllConnections?.();
  }
  console.log(`build ${((tBuilt - t0) / 1000).toFixed(1)}s, total ${((performance.now() - t0) / 1000).toFixed(1)}s · generated in ${path.relative(ROOT, "generated/" + scenario.name)}/`);
  if (failed) process.exitCode = 1;
}
