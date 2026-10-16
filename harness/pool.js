// Run build (and measure) jobs in parallel worker processes. Babel and the bundler are CPU-bound
// and single-threaded, so parallelism needs processes, not concurrent promises.

import os from "node:os";
import path from "node:path";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";

const WORKER = path.join(path.dirname(fileURLToPath(import.meta.url)), "worker.js");

export const MAX_JOBS = 32;

export function defaultJobs() {
  return Math.min(MAX_JOBS, os.availableParallelism?.() ?? os.cpus().length);
}

// jobs: [{ scenario, emitter, scenarioOptions, emitterOptions, measure }] (names, not modules).
// Calls onDone(job, result) as each finishes; resolves with results in job order.
// With `tolerant`, a failed job yields { error } in its slot instead of stopping the run.
export function runJobs(jobs, { jobs: n = defaultJobs(), onDone = () => {}, tolerant = false } = {}) {
  const results = new Array(jobs.length);
  if (jobs.length === 0) return Promise.resolve(results);
  const size = Math.max(1, Math.min(Number(n) || 1, MAX_JOBS, jobs.length));
  let next = 0;
  let done = 0;
  return new Promise((resolve, reject) => {
    const workers = [];
    const fail = (err) => {
      for (const w of workers) w.kill();
      reject(err);
    };
    const feed = (w) => {
      if (next >= jobs.length) return w.disconnect();
      const i = next++;
      w.current = i;
      w.send({ i, job: jobs[i] });
    };
    for (let k = 0; k < size; k++) {
      const w = fork(WORKER, [], { stdio: ["ignore", "inherit", "inherit", "ipc"] });
      workers.push(w);
      w.on("message", ({ i, result, error }) => {
        if (error && !tolerant) return fail(new Error(`${describe(jobs[i])}: ${error}`));
        results[i] = error ? { error } : result;
        if (!error) onDone(jobs[i], result);
        if (++done === jobs.length) {
          for (const x of workers) if (x.connected) x.disconnect();
          resolve(results);
        } else feed(w);
      });
      w.on("exit", (code) => {
        if (code && done < jobs.length) fail(new Error(`worker exited with code ${code} during ${describe(jobs[w.current])}`));
      });
      feed(w);
    }
  });
}

// "generate 0.05s, build 1.2s, measure 0.3s"
export function timingText(t) {
  return Object.entries(t || {}).map(([k, v]) => `${k} ${v.toFixed(2)}s`).join(", ");
}

export function describe(job) {
  return `${job.scenario}/${job.emitter} n=${job.scenarioOptions.size} s=${job.scenarioOptions.seed}`;
}
