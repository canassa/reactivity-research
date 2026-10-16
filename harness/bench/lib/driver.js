// Driving one app in headless Chrome for ./rr bench: the bench page, one step as real input
// through the DevTools protocol, reps traced in chunks, and the startup loads.

import fs from "node:fs";
import path from "node:path";
import { send, TYPES } from "../../serve.js";
import { CATEGORIES, indexTrace, analyseRep, analyseLoad } from "./trace.js";
import { precise } from "./stats.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The bench page is the app's own built index.html with this at the end of <body>: mount on load,
// then mark when rr.settled() resolves and tell the harness (a binding, so it need not poll the
// page with evaluations that would land in the trace). No serve panel and no hooks: the panel's
// code must not run, and the hooks wrap addEventListener and the timers, which would slow the app.
const BOOT = `<script type="module">
const go = () => {
  if (!window.rr) return setTimeout(go, 0);
  window.rr.mount(document.getElementById("root"));
  window.rr.settled().then(() => { performance.mark("rr-mounted"); window.__rrMounted = true; window.rrBenchMounted?.(""); });
};
go();
</script>
`;

// Serves apps (key "n<size>-s<seed>/<variant>" → dist directory) at /<key>/ as bench pages.
export function benchHandler(apps) {
  return (req, res) => {
    const parts = decodeURIComponent(new URL(req.url, "http://x").pathname).split("/").filter(Boolean);
    const dist = apps.get(parts.slice(0, 2).join("/"));
    if (!dist) return send(res, 404, "not found");
    const rel = parts.slice(2).join("/") || "index.html";
    const file = path.join(dist, rel);
    if (!file.startsWith(dist + path.sep) || !fs.existsSync(file)) return send(res, 404, "not found");
    if (rel === "index.html") return send(res, 200, fs.readFileSync(file, "utf8").replace(/<\/body>/i, `${BOOT}</body>`), TYPES[".html"]);
    send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || "application/octet-stream");
  };
}

// Open the bench page and resolve once the app is mounted. `beforeNavigate` may start a trace.
async function openMounted(chrome, url, beforeNavigate) {
  let resolve;
  const mounted = new Promise((r) => { resolve = r; });
  const page = await chrome.open(url, {
    beforeNavigate: async (p) => {
      p.on((m) => { if (m.method === "Runtime.bindingCalled" && m.params.name === "rrBenchMounted") resolve(); });
      await p.cdp("Runtime.addBinding", { name: "rrBenchMounted" });
      if (beforeNavigate) await beforeNavigate(p);
    },
  });
  const t = setTimeout(() => resolve("timeout"), 30000);
  const r = await mounted;
  clearTimeout(t);
  if (r === "timeout") {
    await page.close();
    throw new Error(`the app did not mount in 30 s${page.errors.length ? `: ${page.errors[0]}` : ""}`);
  }
  return page;
}

// Collect the trace of `body`. `page` may be a page or the { cdp, on } of beforeNavigate.
export async function startTrace(page) {
  const events = [];
  const off = page.on((m) => { if (m.method === "Tracing.dataCollected") events.push(...m.params.value); });
  let done;
  const complete = new Promise((r) => { done = r; });
  const off2 = page.on((m) => { if (m.method === "Tracing.tracingComplete") done(); });
  await page.cdp("Tracing.start", { traceConfig: { includedCategories: CATEGORIES }, transferMode: "ReportEvents" });
  return async () => {
    await page.cdp("Tracing.end");
    await complete;
    off();
    off2();
    return events;
  };
}

// --- One step ---------------------------------------------------------------------------------

// Runs in the page before the input, outside the timed window: find and prepare the target, write
// the rep's start mark, and say what input to send. A dispatch step stores the message and arms a
// zero-delay timer that calls rr.dispatch: that timer's TimerFire is the rep's input event, as a
// server push arrives as a task of its own.
const prepare = (step, mark) => `(() => {
  const step = ${JSON.stringify(step)};
  const mark = ${JSON.stringify(mark)};
  if (step.do === "dispatch") {
    window.__rrMsg = step.msg;
    performance.mark(mark);
    return { kind: "timer", timerId: setTimeout(() => window.rr.dispatch(window.__rrMsg), 0) };
  }
  const el = document.querySelector(step.target);
  if (!el) return { error: "no element " + step.target };
  if (step.do === "click") {
    let r = el.getBoundingClientRect();
    if (r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) { el.scrollIntoView({ block: "center" }); r = el.getBoundingClientRect(); }
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    if (!hit || !(hit === el || el.contains(hit))) return { error: "the target is covered at its centre: " + step.target };
    performance.mark(mark);
    return { kind: "click", x, y };
  }
  if (document.activeElement !== el) el.focus();
  if (step.do === "select") {
    const d = [...el.options].findIndex((o) => o.value === step.value) - el.selectedIndex;
    if (Math.abs(d) !== 1) return { error: "a select step must move to a neighbouring option (" + d + ")" };
    performance.mark(mark);
    return { kind: "key", keys: [d > 0 ? "ArrowDown" : "ArrowUp"] };
  }
  if (step.do !== "type") return { error: "unknown step " + step.do };
  const cur = el.value, v = step.value, num = el.type === "number";
  if (!num && v.length > cur.length && v.startsWith(cur)) {
    el.setSelectionRange(cur.length, cur.length);
    performance.mark(mark);
    return { kind: "key", insert: v.slice(cur.length) };
  }
  if (!num && cur.length - v.length === 1 && cur.startsWith(v)) {
    el.setSelectionRange(cur.length, cur.length);
    performance.mark(mark);
    return { kind: "key", keys: ["Backspace"] };
  }
  el.select();
  performance.mark(mark);
  return v === "" ? { kind: "key", keys: ["Backspace"] } : { kind: "key", insert: v };
})()`;

// Runs in the page after the wait, outside the window: the end mark, then rr.settled() (whose
// own code is therefore never timed) and a check that a typed or selected value took.
const finish = (step, mark) => `(async () => {
  const step = ${JSON.stringify({ do: step.do, target: step.target, value: step.value })};
  performance.mark(${JSON.stringify(mark)});
  performance.clearMarks();
  await window.rr.settled();
  if (step.do === "type" || step.do === "select") {
    const el = document.querySelector(step.target);
    if (!el) return { ok: false, why: "the input is gone" };
    if (el.value !== String(step.value)) return { ok: false, why: "its value is " + JSON.stringify(el.value) + ", not " + JSON.stringify(step.value) };
  }
  return { ok: true };
})()`;

const KEYS = {
  Backspace: { code: "Backspace", windowsVirtualKeyCode: 8 },
  ArrowDown: { code: "ArrowDown", windowsVirtualKeyCode: 40 },
  ArrowUp: { code: "ArrowUp", windowsVirtualKeyCode: 38 },
};

let markSeq = 0;

// One step: prepare, send the real input, wait `waitMs` (passively: nothing of ours runs in the
// page meanwhile), then finish. Returns what analyseRep needs to time it.
export async function runStep(page, step, waitMs) {
  const k = ++markSeq;
  const from = `rr-s-${k}`, to = `rr-e-${k}`;
  const p = await page.evaluate(prepare(step, from));
  if (p.error) throw new Error(p.error);
  if (p.kind === "click") {
    const base = { x: p.x, y: p.y, button: "left", clickCount: 1 };
    await page.cdp("Input.dispatchMouseEvent", { type: "mousePressed", ...base });
    await page.cdp("Input.dispatchMouseEvent", { type: "mouseReleased", ...base });
  } else if (p.kind === "key") {
    if (p.insert != null) await page.cdp("Input.insertText", { text: p.insert });
    for (const key of p.keys || []) {
      await page.cdp("Input.dispatchKeyEvent", { type: "rawKeyDown", key, ...KEYS[key] });
      await page.cdp("Input.dispatchKeyEvent", { type: "keyUp", key, ...KEYS[key] });
    }
  }
  await sleep(waitMs);
  const f = await page.evaluate(finish(step, to));
  if (!f.ok) throw new Error(`${step.do} ${step.target || ""}: ${f.why}`);
  return { from, to, start: p.kind === "timer" ? { kind: "timer", timerId: p.timerId } : { kind: p.kind } };
}

// --- One app ----------------------------------------------------------------------------------

// `loads` fresh tabs: each load traced from before the navigation to after the first paint, then
// a forced GC and the heap in use. Returns [{ scriptUs, compileUs, totalMs, heapBytes }].
export async function startupLoads(chrome, url, loads) {
  const out = [];
  for (let i = 0; i < loads; i++) {
    let stop;
    const page = await openMounted(chrome, url, async (p) => { stop = await startTrace(p); });
    await sleep(150);
    const events = await stop();
    const r = analyseLoad(events);
    await page.cdp("HeapProfiler.collectGarbage");
    const { usedSize } = await page.cdp("Runtime.getHeapUsage");
    if (page.errors.length) throw new Error(`page errors while loading: ${page.errors.slice(0, 2).join("; ")}`);
    await page.close();
    out.push({ load: i, ...r, heapBytes: usedSize });
  }
  return out;
}

// Every bench action on one page. `o`: { warmup, minReps, maxReps, chunk, tol, waitMs, log }.
// Returns { samples: [{ action, half, scope, rep, scriptUs, totalMs, paintUs, commits }], failures }.
export async function eventReps(chrome, url, { spec, ref, actions }, o) {
  const page = await openMounted(chrome, url);
  const samples = [], failures = [];
  try {
    await sleep(200);
    let s = spec.initialState;
    const step = async (st) => {
      const r = await runStep(page, st, o.waitMs);
      if (st.msg) s = ref.update(spec, s, st.msg);
      return r;
    };
    for (const a of actions) {
      for (const st of a.setup ? a.setup(s) : []) await step(st);
      const s0 = s;
      const halves = a.halves(s0);
      const got = halves.map(() => []);
      let rep = 0;
      for (;;) {
        const measured = Math.max(0, rep - o.warmup);
        const n = measured === 0 ? o.warmup + o.minReps : Math.min(o.chunk, o.maxReps - measured);
        await page.cdp("HeapProfiler.collectGarbage");
        const recs = [];
        const stop = await startTrace(page);
        let events;
        try {
          for (let i = 0; i < n; i++, rep++) {
            for (let h = 0; h < halves.length; h++) recs.push({ rep, h, ...(await step(halves[h].step(s))) });
            const r = a.reset ? a.reset(s, s0) : null;
            if (r) await step(r);
          }
        } finally {
          events = await stop();
        }
        const index = indexTrace(events);
        for (const rc of recs) {
          if (rc.rep < o.warmup) continue;
          try {
            const t = analyseRep(index, rc.from, rc.to, rc.start);
            got[rc.h].push(t.scriptUs);
            samples.push({ action: a.name, half: halves[rc.h].name, scope: a.scope, rep: rc.rep - o.warmup, ...t });
          } catch (err) {
            failures.push({ action: a.name, half: halves[rc.h].name, rep: rc.rep - o.warmup, error: err.message });
          }
        }
        const done = rep - o.warmup;
        if (done >= o.maxReps) break;
        if (done >= o.minReps && got.every((xs) => xs.length >= o.minReps && precise(xs, o.tol))) break;
      }
      if (page.errors.length) throw new Error(`page errors during "${a.name}": ${page.errors.slice(0, 2).join("; ")}`);
      o.log?.(`  ${a.name}: ${rep - o.warmup} reps`);
    }
  } finally {
    await page.close();
  }
  return { samples, failures };
}
