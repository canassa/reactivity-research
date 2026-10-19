// Reading one page load out of a Chrome trace, and fitting the results.
//
// Where V8's parse and compile work shows up in the trace, for an external script:
//   v8.parseOnBackground   a worker thread: the script streamed and parsed while it downloads
//                          (Chrome streams external scripts of at least 30 kB)
//   v8.compile             the main thread: all of the work for a script that is not streamed,
//                          only the finishing for one that is
//   EvaluateScript         the main thread: running the script (its top level, plus the lazy
//                          compilation of every function it calls); it contains v8.compile
// For a script in the page's own HTML ("inline"), v8.compile holds all of it on the main thread.

const urlOf = (e) => e.args?.data?.url ?? e.args?.url ?? e.args?.fileName ?? "";
const CACHE_KEYS = ["cacheKind", "cacheRejected", "consumedCacheSize", "cacheConsumeOptions"];

// `scriptUrl`: the URL the script's events carry (the payload URL, or the page URL for inline).
// `inline`: the script is part of the page; its events are the longest ones with the page's URL.
export function analyseLoad(events, { scriptUrl, inline }) {
  const of = (name) => events.filter((e) => e.name === name && e.ph === "X" && urlOf(e) === scriptUrl);
  const longest = (xs) => (inline ? xs.slice().sort((a, b) => b.dur - a.dur).slice(0, 1) : xs);
  const compiles = longest(of("v8.compile"));
  const evals = longest(of("EvaluateScript"));
  const background = of("v8.parseOnBackground");
  if (compiles.length !== 1) throw new Error(`expected one v8.compile for ${scriptUrl}, found ${compiles.length}`);
  if (evals.length !== 1) throw new Error(`expected one EvaluateScript for ${scriptUrl}, found ${evals.length}`);

  // The code cache must not have been used or rejected: any of these fields on the compile event
  // means a cache was in play (checked against a positive control, a repeated load of one URL).
  const data = compiles[0].args.data;
  const cacheFields = CACHE_KEYS.filter((k) => k in data);
  const reason = data.notStreamedReason ?? "";
  if (cacheFields.length || /cache/i.test(reason)) {
    throw new Error(`code cache involved for ${scriptUrl}: ${JSON.stringify(data)}`);
  }
  const received = events.find((e) => e.name === "ResourceReceiveResponse" && e.args?.data?.url === scriptUrl);
  if (received?.args.data.fromCache) throw new Error(`${scriptUrl} came from the HTTP cache`);

  const send = events.find((e) => e.name === "ResourceSendRequest" && e.args?.data?.url === scriptUrl);
  const ev = evals[0];
  const mainUs = compiles[0].dur;
  const backgroundUs = background.reduce((a, e) => a + e.dur, 0);
  return {
    compileMainUs: mainUs,
    compileBackgroundUs: backgroundUs,
    compileUs: mainUs + backgroundUs,
    evaluateUs: ev.dur,
    // From the request to the end of EvaluateScript (external only): fetch from loopback, streamed
    // parse, finishing, execution.
    requestToEvaluatedUs: send ? ev.ts + ev.dur - send.ts : null,
    streamed: data.streamed === true,
    notStreamedReason: reason || null,
    backgroundEvents: background.length,
  };
}

// ---- fitting -------------------------------------------------------------------------------
export function regress(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); syy += (ys[i] - my) ** 2; }
  const slope = sxy / sxx, intercept = my - slope * mx;
  const sse = ys.reduce((a, y, i) => a + (y - (intercept + slope * xs[i])) ** 2, 0);
  const se = n > 2 ? Math.sqrt(sse / (n - 2) / sxx) : NaN;
  return { slope, intercept, r2: syy ? 1 - sse / syy : 1, slopeSe: se };
}

// Fit median ms against raw bytes. Two fits:
//   linear     ms = a + b·bytes          → msPer100kB = b·1e5, the fixed cost a, and R²
//   power law  ln ms = c + k·ln bytes    → k = 1 means linear, k > 1 super-linear; with its standard error
// `points`: [{ bytes, ms }]. "Linear" here means |k − 1| ≤ 0.1 and R² ≥ 0.99.
export function fit(points) {
  const lin = regress(points.map((p) => p.bytes), points.map((p) => p.ms));
  const pow = regress(points.map((p) => Math.log(p.bytes)), points.map((p) => Math.log(p.ms)));
  const r = (x, d) => (Number.isFinite(x) ? +x.toFixed(d) : null);
  return {
    msPer100kB: r(lin.slope * 1e5, 4), interceptMs: r(lin.intercept, 4), r2: r(lin.r2, 5),
    exponent: r(pow.slope, 4), exponentSe: r(pow.slopeSe, 4), exponentR2: r(pow.r2, 5),
    linear: Math.abs(pow.slope - 1) <= 0.1 && lin.r2 >= 0.99,
  };
}
