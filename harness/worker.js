// A pool worker: builds (and optionally measures) one app per message.

import { loadScenario, loadEmitter } from "./selection.js";
import { generateApp } from "./generate.js";
import { measureBuild } from "./measure.js";

const seconds = (t0) => Math.round(performance.now() - t0) / 1000;

process.on("message", async ({ i, job }) => {
  try {
    const scenario = await loadScenario(job.scenario);
    const emitter = await loadEmitter(job.scenario, job.emitter);
    const timing = {};
    let t0 = performance.now();
    const out = await generateApp(scenario, emitter, job.scenarioOptions, job.emitterOptions);
    timing.generate = seconds(t0);
    if (job.generateOnly) return process.send({ i, result: { dir: out.dir, timing } });
    t0 = performance.now();
    const built = await emitter.framework.build(out.dir);
    timing.build = seconds(t0);
    const result = { dir: out.dir, outDir: built.outDir, options: out.spec.options, style: out.info.style, timing };
    if (job.measure) {
      t0 = performance.now();
      result.measurement = measureBuild(built, emitter.framework);
      timing.measure = seconds(t0);
    }
    process.send({ i, result });
  } catch (err) {
    process.send({ i, error: err.stack || String(err) });
  }
});
