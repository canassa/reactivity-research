// Timing one rep out of a long Chrome trace.
//
// The rule is js-framework-benchmark's (webdriver-ts/src/timeline.ts, `computeResultsCPU` and
// `computeResultsJS`), as ported by beni's bench/ui/lib/trace.mjs: a rep runs from its input
// event (js-framework-benchmark: the click's EventDispatch) to the end of the first Commit after
// the last of {input event, FireAnimationFrame, TimerFire, Layout, FunctionCall}; `total` is that
// span and `script` the union of the JavaScript events inside it. Three things differ, because
// one trace here holds many reps instead of one:
//
//   - every rep is cut out of the trace between two user-timing marks the driver writes (its
//     start mark just before the input, its end mark after a fixed wait), and only the renderer
//     main thread of the page is read (the pid and tid of those marks);
//   - the input event is not always a click: a typed character or a key starts at the first of
//     keydown/beforeinput/textInput/input, and an external event (dispatch) at the TimerFire of
//     the zero-delay timer that calls rr.dispatch (its timerId is known);
//   - `script` counts, of the EventDispatch events, the ones the app listens to (click, input,
//     change), as js-framework-benchmark counts the click; the native editing work inside a
//     keydown or textInput (layout of the edited text) is not JavaScript and is left out. The
//     union of intervals is a true union (timeline.ts only drops nested intervals; for nested
//     events, the common case, the two agree).

export const CATEGORIES = ["blink.user_timing", "devtools.timeline", "disabled-by-default-devtools.timeline"];

const JS_NAMES = new Set(["EvaluateScript", "v8.evaluateModule", "FunctionCall", "TimerFire", "FireIdleCallback", "FireAnimationFrame", "RunMicrotasks", "V8.Execute"]);
const APP_EVENTS = new Set(["click", "input", "change"]);
const KEY_STARTS = new Set(["keydown", "beforeinput", "textInput", "input"]);
const PAINT_NAMES = new Set(["UpdateLayoutTree", "Layout", "Commit", "Paint", "Layerize", "PrePaint"]);
// Startup also counts compiling the scripts on the main thread.
const COMPILE_NAMES = new Set(["v8.compile", "v8.compileModule", "V8.CompileCode", "v8.produceModuleCache", "v8.produceCache"]);

const isMark = (e) => e.cat && e.cat.includes("blink.user_timing") && typeof e.name === "string" && e.name.startsWith("rr-");

// Index one trace: events sorted by start, the rr- marks by name, the page's main thread.
export function indexTrace(events) {
  const sorted = events.filter((e) => e.ts > 0).sort((a, b) => a.ts - b.ts);
  const marks = new Map();
  let pid = null, tid = null;
  for (const e of sorted) {
    if (!isMark(e)) continue;
    marks.set(e.name, e);
    pid = e.pid;
    tid = e.tid;
  }
  return { events: sorted.filter((e) => e.pid === pid), marks, pid, tid };
}

const union = (intervals) => {
  intervals.sort((a, b) => a[0] - b[0]);
  let sum = 0, cs = -Infinity, ce = -Infinity;
  for (const [s, e] of intervals) {
    if (s > ce) { if (ce > cs) sum += ce - cs; cs = s; ce = e; } else if (e > ce) ce = e;
  }
  if (ce > cs) sum += ce - cs;
  return sum;
};

// One rep: the events between marks `from` and `to`. `start` says which event is the input:
// { kind: "click" } | { kind: "key" } | { kind: "timer", timerId }. Returns µs and ms figures,
// or throws when the trace does not hold a complete rep (no input event, no commit after it).
export function analyseRep(index, from, to, start) {
  const a = index.marks.get(from), b = index.marks.get(to);
  if (!a || !b) throw new Error(`marks ${from}/${to} not in the trace`);
  const seg = index.events.filter((e) => e.ts >= a.ts && e.ts <= b.ts);
  const onMain = seg.filter((e) => e.tid === index.tid);
  const data = (e) => e.args?.data || {};
  let first;
  if (start.kind === "click") first = onMain.find((e) => e.name === "EventDispatch" && data(e).type === "click");
  else if (start.kind === "key") first = onMain.find((e) => e.name === "EventDispatch" && KEY_STARTS.has(data(e).type));
  else first = onMain.find((e) => e.name === "TimerFire" && e.ph === "X" && data(e).timerId === start.timerId);
  if (!first) throw new Error(`no ${start.kind} input event between ${from} and ${to}`);
  const t0 = +first.ts, t0end = t0 + (+first.dur || 0);

  // The last of {input, FireAnimationFrame, TimerFire, Layout, FunctionCall} after the input.
  const ev = (e) => ({ name: e.name, ts: +e.ts, end: +e.ts + (e.name === "TimerFire" ? 0 : +e.dur || 0) });
  const relevant = onMain.filter((e) => e.ph === "X" && (e.ts > t0end || e === first) &&
    (e === first || e.name === "FireAnimationFrame" || e.name === "TimerFire" || e.name === "Layout" || e.name === "FunctionCall")).map(ev);
  relevant.sort((x, y) => x.end - y.end);
  const last = relevant[relevant.length - 1];
  const commits = onMain.filter((e) => e.ph === "X" && e.name === "Commit" && e.ts > t0end).map(ev);
  // timeline.ts: with no commit after that event (e.g. a timer that changed nothing), the last
  // commit after the input.
  let commit = commits.find((c) => c.ts > last.end);
  const fallback = !commit;
  if (fallback) commit = commits[commits.length - 1];
  if (!commit) throw new Error(`no commit after the input between ${from} and ${to} (the wait may be too short)`);
  let tEnd = commit.end;
  let total = tEnd - t0;

  // timeline.ts's correction for a requestAnimationFrame that waited more than 16 ms.
  const rafs = onMain.filter((e) => e.name === "RequestAnimationFrame" && e.ts >= t0 && e.ts <= t0end);
  const fafs = onMain.filter((e) => e.ph === "X" && e.name === "FireAnimationFrame" && e.ts >= t0 && e.ts < commit.ts);
  const layouts = onMain.filter((e) => e.ph === "X" && e.name === "Layout" && e.ts > t0end);
  let rafLongDelay = 0;
  if (rafs.length === 1 && fafs.length === 1) {
    const wait = (fafs[0].ts - t0end) / 1000;
    if (wait > 16 && !layouts.some((l) => l.ts < fafs[0].ts)) { rafLongDelay = wait - 16; total -= rafLongDelay * 1000; }
  }

  const within = (names, extra) => union(onMain.filter((e) => e.ph === "X" && e.ts >= t0 && e.ts <= tEnd &&
    (names.has(e.name) || (extra && extra(e)))).map((e) => [+e.ts, +e.ts + (+e.dur || 0)]));
  const script = within(JS_NAMES, (e) => e.name === "EventDispatch" && APP_EVENTS.has(data(e).type));
  const paint = within(PAINT_NAMES);
  return { scriptUs: round(script), totalMs: round(total / 1000, 4), paintUs: round(paint), commits: commits.length, rafLongDelayMs: round(rafLongDelay, 3), ...(fallback ? { lastCommit: true } : {}) };
}

// A page load: from the navigation to the end of the first Commit after the event in which the
// bench page's `rr-mounted` mark fell (it is written when rr.settled() resolves after rr.mount).
// `script` is all JavaScript on the page's main thread in that span: compiling and evaluating the
// bundle, mounting, and the bench page's three-line boot script.
export function analyseLoad(events) {
  const index = indexTrace(events);
  const mounted = index.marks.get("rr-mounted");
  if (!mounted) throw new Error("no rr-mounted mark in the load trace");
  const main = index.events.filter((e) => e.tid === index.tid);
  const navs = index.events.filter((e) => e.name === "navigationStart" && e.ts <= mounted.ts && (e.args?.data?.isLoadingMainFrame ?? true) &&
    String(e.args?.data?.documentLoaderURL ?? "http").startsWith("http"));
  const nav = navs[navs.length - 1];
  if (!nav) throw new Error("no navigationStart before rr-mounted");
  const containing = main.filter((e) => e.ph === "X" && JS_NAMES.has(e.name) && e.ts <= mounted.ts && e.ts + (+e.dur || 0) >= mounted.ts);
  const mountedEnd = Math.max(mounted.ts, ...containing.map((e) => +e.ts + (+e.dur || 0)));
  // The first paint after rr.settled() resolved. An app whose settled() waits a task (beni) has
  // already painted by then and nothing changes after, so Chrome paints no more: its startup
  // ends at the last paint before the mark instead (flagged as `paintedBeforeSettled`).
  let commit = main.find((e) => e.ph === "X" && e.name === "Commit" && e.ts > mountedEnd);
  const paintedBeforeSettled = !commit;
  if (!commit) commit = main.filter((e) => e.ph === "X" && e.name === "Commit" && e.ts > nav.ts && e.ts <= mounted.ts).at(-1);
  if (!commit) throw new Error("no commit after the navigation and around rr-mounted");
  const t0 = +nav.ts, tEnd = +commit.ts + (+commit.dur || 0);
  const pick = (pred) => union(main.filter((e) => e.ph === "X" && e.ts >= t0 && e.ts <= tEnd && pred(e)).map((e) => [+e.ts, +e.ts + (+e.dur || 0)]));
  const script = pick((e) => JS_NAMES.has(e.name) || COMPILE_NAMES.has(e.name));
  const compile = pick((e) => COMPILE_NAMES.has(e.name));
  return { scriptUs: round(script), compileUs: round(compile), totalMs: round((tEnd - t0) / 1000, 4), ...(paintedBeforeSettled ? { paintedBeforeSettled } : {}) };
}

const round = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;
