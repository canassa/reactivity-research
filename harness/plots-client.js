// The plots page's script (inlined by harness/plots.js). Draws every chart as inline SVG from
// the embedded results; no libraries, no network.
(() => {
  const DATA = JSON.parse(document.getElementById("data").textContent);
  const SVG = "http://www.w3.org/2000/svg";
  const SLOTS = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--s5)", "var(--s6)", "var(--s7)", "var(--s8)"];
  const app = document.getElementById("app");
  const tip = document.getElementById("tip");
  let mode = "br";
  // One colour per framework across every scenario (colour follows the entity, not its position).
  // (CPU-only names, such as an A/A twin, come after every size result's, so they shift no colour.)
  const NAMES = [...new Set([...DATA.scenarios.flatMap((sc) => sc.variants.map((v) => v.name)),
    ...DATA.scenarios.flatMap((sc) => Object.keys(sc.cpu?.run.variants || {}))])];
  const colorOfName = (n) => SLOTS[NAMES.indexOf(n) % SLOTS.length];
  // Which view is shown: a scenario's name, or "compare". Kept in the URL hash.
  const views = () => [...DATA.scenarios.map((sc) => sc.name), ...(DATA.scenarios.length > 1 ? ["compare"] : []), ...(DATA.parse ? [PARSE_VIEW] : [])];
  let view = decodeURIComponent(location.hash.slice(1)) || "";

  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "text") e.textContent = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    e.append(...kids.flat().filter((k) => k != null));
    return e;
  };
  const sv = (tag, attrs = {}, ...kids) => {
    const e = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "text") e.textContent = v;
      else e.setAttribute(k, v);
    }
    e.append(...kids.flat().filter((k) => k != null));
    return e;
  };
  const fmt = (n) => Math.round(n).toLocaleString("en-US");
  const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

  // Metrics, per mode.
  const M = {
    total: (r) => r.total[mode],
    js: (r) => r.js[mode],
    html: (r) => r.html[mode],
  };
  const PARTS = {
    br: [["runtime", (r) => r.attribution.br.runtime], ["app code", (r) => r.attribution.br.app], ["HTML", (r) => r.html.br]],
    raw: [["runtime", (r) => r.attribution.raw.runtime], ["tooling", (r) => r.attribution.raw.tooling], ["app code", (r) => r.attribution.raw.app], ["HTML", (r) => r.html.raw]],
  };

  function bySize(records, get) {
    const sizes = [...new Set(records.map((r) => r.size))].sort((a, b) => a - b);
    return sizes.map((x) => {
      const ys = records.filter((r) => r.size === x).map(get);
      return { x, y: median(ys), lo: Math.min(...ys), hi: Math.max(...ys), n: ys.length };
    });
  }

  function niceTicks(max) {
    if (max <= 0) return [0, 1];
    const raw = max / 5;
    const p = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw);
    const ticks = [];
    for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
    if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
    return ticks;
  }

  // ---- tooltip
  function showTip(evt, head, rows) {
    tip.replaceChildren(el("div", { class: "head", text: head }),
      ...rows.map(([color, value, label]) => el("div", { class: "row" }, el("i", { style: `border-color:${color}` }), el("b", { text: value }), el("span", { text: label }))));
    tip.style.display = "block";
    const x = Math.min(evt.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
    const y = Math.min(evt.clientY + 14, window.innerHeight - tip.offsetHeight - 8);
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  }
  const hideTip = () => { tip.style.display = "none"; };

  // ---- line chart on a log2 N axis, with seed spread as whiskers and optional fitted curves.
  function lineChart({ series, curves = [], yMax, unit = "B", width = 560, height = 260, pointsOnly = false, yLog = false, yFmt = fmt, xLabel = "N (widgets, log scale)", spread = "seeds" }) {
    const W = width, H = height, L = 56, R = 14, T = 24, B = 34;
    const xs = [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))].sort((a, b) => a - b);
    const lx = (x) => Math.log2(x);
    const x0 = lx(xs[0]), x1 = lx(xs[xs.length - 1]) || 1;
    const X = (x) => L + ((lx(x) - x0) / (x1 - x0 || 1)) * (W - L - R);
    const max = yMax ?? Math.max(...series.flatMap((s) => s.points.map((p) => p.hi)), ...curves.flatMap((c) => xs.map((x) => c.fn(x))));
    // A log y axis (yLog) has a gridline at every power of ten from just below the smallest value.
    let ticks, top, Y, bottom = 0;
    if (yLog) {
      const min = Math.min(...series.flatMap((s) => s.points.map((p) => p.lo)));
      const e0 = Math.floor(Math.log10(Math.max(min, 1))), e1 = Math.max(e0 + 1, Math.ceil(Math.log10(max)));
      ticks = [];
      for (let e = e0; e <= e1; e++) ticks.push(10 ** e);
      bottom = ticks[0];
      Y = (y) => T + (1 - (Math.log10(Math.max(y, bottom)) - e0) / (e1 - e0)) * (H - T - B);
    } else {
      ticks = niceTicks(max);
      top = ticks[ticks.length - 1];
      Y = (y) => T + (1 - y / top) * (H - T - B);
    }
    const svg = sv("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });
    for (const t of ticks) {
      svg.append(sv("line", { class: "gridline", x1: L, x2: W - R, y1: Y(t), y2: Y(t) }));
      svg.append(sv("text", { x: L - 6, y: Y(t) + 4, "text-anchor": "end", text: yFmt(t) }));
    }
    for (const x of xs) svg.append(sv("text", { x: X(x), y: H - B + 16, "text-anchor": "middle", text: String(x) }));
    svg.append(sv("text", { x: (L + W - R) / 2, y: H - 4, "text-anchor": "middle", text: xLabel }));
    svg.append(sv("text", { x: L - 6, y: 11, "text-anchor": "end", text: unit }));
    svg.append(sv("line", { class: "axis", x1: L, x2: W - R, y1: Y(bottom), y2: Y(bottom) }));
    for (const c of curves) {
      const pts = [];
      const from = c.from ?? xs[0], to = c.to ?? xs[xs.length - 1];
      for (let i = 0; i <= 64; i++) { const x = 2 ** (lx(from) + (i / 64) * (lx(to) - lx(from))); pts.push(`${X(x).toFixed(1)},${Y(c.fn(x)).toFixed(1)}`); }
      svg.append(sv("polyline", { points: pts.join(" "), fill: "none", stroke: c.color, "stroke-width": c.width ?? 1.5, "stroke-opacity": c.opacity ?? 1, "stroke-dasharray": c.dash || "" }));
    }
    series.forEach((s, si) => {
      const g = sv("g", { class: "series", "data-s": si });
      svg.append(g);
      g.addEventListener("pointerenter", () => highlight(svg.parentNode, si));
      g.addEventListener("pointerleave", () => highlight(svg.parentNode, null));
      for (const p of s.points) if (p.hi > p.lo) g.append(sv("line", { x1: X(p.x), x2: X(p.x), y1: Y(p.lo), y2: Y(p.hi), stroke: s.color, "stroke-width": 6, "stroke-opacity": 0.25, "stroke-linecap": "round" }));
      if (!pointsOnly) g.append(sv("polyline", { points: s.points.map((p) => `${X(p.x)},${Y(p.y)}`).join(" "), fill: "none", stroke: s.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
      for (const p of s.points) g.append(sv("circle", { cx: X(p.x), cy: Y(p.y), r: 4, fill: s.color, stroke: "var(--card)", "stroke-width": 2 }));
      if (s.endLabel) {
        const p = s.points[s.points.length - 1];
        g.append(sv("text", { class: "end", x: X(p.x) - 6, y: Y(p.y) - 9, "text-anchor": "end", text: yFmt(p.y) }));
      }
    });
    // Crosshair: snap to the nearest N and list every series there.
    const cross = sv("line", { class: "crosshair", y1: T, y2: H - B, visibility: "hidden" });
    const hit = sv("rect", { x: L, y: T, width: W - L - R, height: H - T - B, fill: "transparent" });
    svg.insertBefore(hit, svg.querySelector("g.series"));
    svg.append(cross);
    hit.addEventListener("pointermove", (e) => {
      const r = svg.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      const x = xs.reduce((a, b) => (Math.abs(X(b) - px) < Math.abs(X(a) - px) ? b : a));
      cross.setAttribute("x1", X(x)); cross.setAttribute("x2", X(x)); cross.setAttribute("visibility", "visible");
      const rows = series.map((s) => { const p = s.points.find((q) => q.x === x); return p ? [s.color, `${yFmt(p.y)} ${unit}`, `${s.name}${p.hi > p.lo ? ` (${spread} ${yFmt(p.lo)}–${yFmt(p.hi)})` : ""}`] : null; }).filter(Boolean);
      showTip(e, `N = ${x}`, rows);
    });
    hit.addEventListener("pointerleave", () => { cross.setAttribute("visibility", "hidden"); hideTip(); });
    return svg;
  }

  // ---- stacked columns: one per N, segments in order, 2px surface gap between segments.
  function stackedChart({ sizes, parts, yMax }) {
    const W = 560, H = 260, L = 56, R = 14, T = 24, B = 34;
    const top = niceTicks(yMax)[niceTicks(yMax).length - 1];
    const ticks = niceTicks(yMax);
    const Y = (y) => T + (1 - y / top) * (H - T - B);
    const band = (W - L - R) / sizes.length;
    const bw = Math.min(24, band * 0.6);
    const svg = sv("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });
    for (const t of ticks) {
      svg.append(sv("line", { class: "gridline", x1: L, x2: W - R, y1: Y(t), y2: Y(t) }));
      svg.append(sv("text", { x: L - 6, y: Y(t) + 4, "text-anchor": "end", text: fmt(t) }));
    }
    svg.append(sv("text", { x: (L + W - R) / 2, y: H - 4, "text-anchor": "middle", text: "N (widgets), median of seeds" }));
    svg.append(sv("text", { x: L - 6, y: 11, "text-anchor": "end", text: "B" }));
    sizes.forEach((s, i) => {
      const cx = L + band * (i + 0.5);
      svg.append(sv("text", { x: cx, y: H - B + 16, "text-anchor": "middle", text: String(s.size) }));
      let acc = 0;
      const total = s.values.reduce((a, b) => a + b, 0);
      s.values.forEach((v, j) => {
        const y0 = Y(acc), y1 = Y(acc + v);
        acc += v;
        const h = Math.max(0, y0 - y1 - (j < s.values.length - 1 ? 2 : 0));
        const last = j === s.values.length - 1;
        const rect = last
          ? sv("path", { d: roundedTop(cx - bw / 2, y1, bw, Math.max(0, y0 - y1 - 2)), fill: parts[j].color })
          : sv("rect", { x: cx - bw / 2, y: y1 + (j < s.values.length - 1 ? 2 : 0), width: bw, height: h, fill: parts[j].color });
        rect.addEventListener("pointermove", (e) => showTip(e, `N = ${s.size} · total ${fmt(total)} B`, s.values.map((vv, k) => [parts[k].color, `${fmt(vv)} B`, parts[k].name]).reverse()));
        rect.addEventListener("pointerleave", hideTip);
        svg.append(rect);
      });
      svg.append(sv("text", { x: cx, y: Y(acc) - 5, "text-anchor": "middle", text: fmt(acc) }));
    });
    svg.append(sv("line", { class: "axis", x1: L, x2: W - R, y1: Y(0), y2: Y(0) }));
    return svg;
  }
  function roundedTop(x, y, w, h) {
    const r = Math.min(4, h, w / 2);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }

  // Emphasize one series (by index) in the chart(s) inside `root`; null restores all.
  function highlight(root, si) {
    if (!root) return;
    root.classList.toggle("hl", si != null);
    for (const g of root.querySelectorAll("[data-s]")) g.classList.toggle("on", si != null && g.dataset.s === String(si));
  }
  // A legend whose labels highlight their series in `root` on hover or focus.
  const hoverLegend = (items, root) => el("div", { class: "legend" }, items.map(([name, color], si) => {
    const item = el("span", { tabindex: "0", "data-s": si, class: "hover" }, el("i", { style: `border-color:${color}` }), name);
    for (const [on, off] of [["pointerenter", "pointerleave"], ["focus", "blur"]]) {
      item.addEventListener(on, () => highlight(root, si));
      item.addEventListener(off, () => highlight(root, null));
    }
    return item;
  }));
  const legend = (items, box = false) => el("div", { class: "legend" }, items.map(([name, color, style]) => el("span", {}, el("i", { class: box ? "box" : "", style: box ? `background:${color}` : `border-color:${color};${style || ""}` }), name)));
  const table = (head, rows) => el("div", { class: "scroll" }, el("table", {}, el("thead", {}, el("tr", {}, head.map((h) => el("th", { text: h })))), el("tbody", {}, rows.map((r) => el("tr", {}, r.map((c) => el("td", { text: String(c) })))))));
  const details = (label, content) => el("details", {}, el("summary", { text: label }), content);

  function sourceLine(variants) {
    const runs = [...new Set(variants.map((v) => v.run.dir))];
    const v0 = variants[0];
    const opts = Object.entries(v0.run.scenarioOptions || {}).map(([k, v]) => `${k}=${v}`).join(" ");
    const fw = variants.map((v) => `${v.name}: ${Object.entries(v.versions.framework || {}).map(([k, x]) => `${k} ${x}`).join(", ")}${Object.keys(v.emitterOptions || {}).length ? ` [${Object.entries(v.emitterOptions).map(([k, x]) => `${k}=${x}`).join(" ")}]` : ""}`);
    const git = [...new Set(variants.map((v) => v.run.git ? v.run.git.commit.slice(0, 7) + (v.run.git.dirty ? " (dirty)" : "") : "?"))];
    return el("div", { class: "source" },
      el("div", { text: `Results: results/${runs.join(", results/")} · commit ${git.join(", ")} · sizes ${v0.run.sizes.join(",")} × seeds ${v0.run.seeds.join(",")} · options ${opts}` }),
      el("div", { text: `Node ${v0.versions.node} · brotli ${v0.versions.brotli}, quality ${v0.compression.brotli.quality}, window ${v0.compression.brotli.lgwin} · ${fw.join(" · ")}` }));
  }

  function card(title, note, body, variants) {
    return el("section", { class: "card" }, el("h3", { text: title }), note ? el("p", { class: "note", text: note }) : null, body, sourceLine(variants));
  }

  // ---- work per event: JavaScript function calls one action costs, against N.
  let workAction = "";   // "" = the median of the local actions
  function workCard(sc) {
    const w = sc.work;
    if (!w) return card("Work per event against N", null, el("p", { class: "note", text: "No work results for this scenario yet. Run ./rr work " + sc.name + " all: it counts the JavaScript function calls one event costs, at several sizes, and this chart appears here." }), sc.variants);
    const names = sc.variants.map((v) => v.name).filter((n) => w.run.variants[n]);
    const colorOf = colorOfName;
    const acts = w.run.actions.filter((a) => !a.setup);
    const locals = acts.filter((a) => a.scope === "local").map((a) => a.name);
    const rowsOf = (n) => {
      if (workAction) return w.records.filter((r) => r.variant === n && r.action === workAction).map((r) => ({ size: r.size, seed: r.seed, calls: r.calls }));
      // The median over the local actions, per size and seed.
      const out = [];
      for (const size of w.run.sizes) for (const seed of w.run.seeds) {
        const cs = w.records.filter((r) => r.variant === n && r.size === size && r.seed === seed && locals.includes(r.action)).map((r) => r.calls);
        if (cs.length) out.push({ size, seed, calls: median(cs) });
      }
      return out;
    };
    const series = names.map((n) => ({ name: n + (w.run.variants[n].track === "prototype" ? " (prototype)" : ""), color: colorOf(n), points: bySize(rowsOf(n), (r) => r.calls), endLabel: true }));
    const chart = el("div", { class: "chart" });
    chart.append(lineChart({ series, unit: "calls", width: 1060, height: 380, yLog: true }));
    const select = el("select", { onchange: (e) => { workAction = e.target.value; render(); } },
      el("option", { value: "", text: "median of the local actions" }),
      ...acts.map((a) => el("option", { value: a.name, text: a.name + (a.scope === "global" ? " (global by nature)" : ""), ...(workAction === a.name ? { selected: "" } : {}) })));
    if (!workAction) select.firstChild.selected = true;
    // Growth from the smallest to the largest size, per variant: median and worst local action.
    const lo = w.run.sizes[0], hi = w.run.sizes[w.run.sizes.length - 1];
    const growth = names.map((n) => {
      const ratios = w.run.seeds.flatMap((seed) => locals.map((a) => {
        const at = (size) => w.records.find((r) => r.variant === n && r.seed === seed && r.size === size && r.action === a)?.calls;
        return at(hi) / at(lo);
      }));
      return [n, median(ratios).toFixed(2), Math.max(...ratios).toFixed(2)];
    });
    const versions = Object.entries(w.run.variants).map(([n, v]) => `${n}: ${Object.entries(v.versions || {}).map(([k, x]) => `${k} ${x}`).join(", ")}`);
    const gitInfo = w.run.versions.git;
    return el("section", { class: "card" }, el("h3", { text: "Work per event against N" }),
      el("p", { class: "note", text: "JavaScript function calls the app's own code makes to handle one action and settle, counted with Chrome's precise coverage, on the same early widgets at every size (the generator is prefix-stable). Flat means the work is local to what changed; a line that climbs with N does work proportional to the whole page. Median of the seeds, spread as a pale bar; both axes logarithmic. The mount is not counted; the serve panel and the reference code are not counted." }),
      el("div", { class: "controls" }, el("label", {}, "action ", select)),
      hoverLegend(series.map((s) => [s.name, s.color]), chart), chart,
      details("Table", table(["variant", "action", ...w.run.sizes.map((n) => "N=" + n), `×${hi / lo}`],
        names.flatMap((n) => acts.filter((a) => !workAction || a.name === workAction).map((a) => {
          const vals = w.run.sizes.map((size) => median(w.records.filter((r) => r.variant === n && r.action === a.name && r.size === size).map((r) => r.calls)));
          return [n, a.name + (a.scope === "global" ? " *" : ""), ...vals.map(fmt), (vals[vals.length - 1] / vals[0]).toFixed(2)];
        })))),
      el("h4", { text: `Growth of a local action from N=${lo} to N=${hi}` }),
      table(["variant", "median ratio", "worst ratio"], growth),
      el("p", { class: "note", text: "ratio = calls at the largest size ÷ calls at the smallest, over every local action and seed. The size grows " + hi / lo + "×, so 1 means flat and about " + hi / lo + " means work proportional to the whole page. The snapshot (*) is global by nature, it replaces every widget, and is left out of the ratios." }),
      el("div", { class: "source" },
        el("div", { text: `Results: results/work/${w.dir} · commit ${gitInfo ? gitInfo.commit.slice(0, 7) + (gitInfo.dirty ? " (dirty)" : "") : "?"} · sizes ${w.run.sizes.join(",")} × seeds ${w.run.seeds.join(",")} · ${w.run.runs} fresh page(s) per count · options ${Object.entries(w.run.scenarioOptions || {}).map(([k, x]) => `${k}=${x}`).join(" ")}` }),
        el("div", { text: `Node ${w.run.versions.node} · ${w.run.versions.chrome} · V8 flags ${w.run.jsFlags || "(none)"} · ${versions.join(" · ")}` })));
  }

  // ---- CPU: ./rr bench's absolute numbers, one app per framework (one size and seed).
  // One bar per framework, in its own colour, with its value above and its name below; the
  // whisker is the interquartile range when given.
  function bars({ items, unit, yFmt = fmt }) {
    const W = 1060, H = 280, L = 56, R = 14, T = 24, B = 70;
    const max = Math.max(1e-9, ...items.map((it) => it.hi ?? it.value));
    const ticks = niceTicks(max), top = ticks[ticks.length - 1];
    const Y = (y) => T + (1 - y / top) * (H - T - B);
    const band = (W - L - R) / Math.max(1, items.length), bw = Math.min(56, band * 0.6);
    const svg = sv("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });
    for (const t of ticks) {
      svg.append(sv("line", { class: "gridline", x1: L, x2: W - R, y1: Y(t), y2: Y(t) }));
      svg.append(sv("text", { x: L - 6, y: Y(t) + 4, "text-anchor": "end", text: yFmt(t) }));
    }
    svg.append(sv("text", { x: L - 6, y: 11, "text-anchor": "end", text: unit }));
    items.forEach((it, i) => {
      const cx = L + band * (i + 0.5), x = cx - bw / 2, y = Y(it.value), h = Math.max(0, Y(0) - y);
      const bar = sv("path", { d: roundedTop(x, y, bw, h), fill: it.color });
      const tip = [[it.color, `${yFmt(it.value)} ${unit}` + (it.lo != null ? ` (IQR ${yFmt(it.lo)}–${yFmt(it.hi)})` : ""), it.name]];
      bar.addEventListener("pointermove", (e) => showTip(e, it.name, tip));
      bar.addEventListener("pointerleave", hideTip);
      svg.append(bar);
      if (it.lo != null) svg.append(sv("line", { class: "axis", x1: cx, x2: cx, y1: Y(it.lo), y2: Y(it.hi) }));
      svg.append(sv("text", { x: cx, y: Y(it.hi ?? it.value) - 5, "text-anchor": "middle", text: yFmt(it.value) }));
      svg.append(sv("text", { x: cx, y: H - B + 16, "text-anchor": "middle", text: it.name }));
      if (it.sub) svg.append(sv("text", { x: cx, y: H - B + 31, "text-anchor": "middle", class: "sub", text: it.sub }));
    });
    svg.append(sv("line", { class: "axis", x1: L, x2: W - R, y1: Y(0), y2: Y(0) }));
    return svg;
  }

  let cpuEvent = "";   // "" = the median of the local events
  let cpuMetric = "script";   // the per-test table's metric: "script" (µs) or "total" (ms)
  // js-framework-benchmark's CPU weights (webdriver-ts-results Common.ts), by the big-table bench
  // test that stands for each of its nine benchmarks (01 run1k … 09 clear1k_x8).
  const JFB_WEIGHTS = {
    "create 1000 rows": 0.64280248137063, "replace 1000 rows": 0.5607178150466176,
    "update every 10th row of 10000": 0.5643800750716564, "select row 3": 0.1925635870170522,
    "swap rows": 0.13200612879341714, "remove the 4th row": 0.5277091212292658,
    "create 10000 rows": 0.5644449600965534, "append 1000 rows to 10000": 0.5508359820582848,
    "09 clear 10000 rows": 0.4225836631419211,
  };
  // One row per test, one column per framework: the median and its factor over the fastest, coloured
  // from green (fastest) to red (twice as slow or worse), as js-framework-benchmark's table does.
  function perTestTable(summary, names0, metric) {
    // Columns from fastest to slowest by the headline geometric mean, as js-framework-benchmark
    // orders its table: its weighted mean where its tests are present, else the local one.
    let names = names0;
    {
      const v = (n, h) => summary.events.find((e) => e.variant === n && e.half === h)?.[metric]?.median;
      const hs = [...new Set(summary.events.map((e) => e.half))];
      const jfb = hs.filter((h) => JFB_WEIGHTS[h]);
      const use = jfb.length ? jfb : [...new Set(summary.events.filter((e) => e.scope === "local").map((e) => e.half))];
      const score = (n) => { let sum = 0, W = 0; for (const h of use) { const x = v(n, h); const best = Math.min(...names0.map((m) => v(m, h)).filter((y) => y != null)); if (x == null) continue; const w = JFB_WEIGHTS[h] || 1; sum += w * Math.log(x / best); W += w; } return W ? sum / W : Infinity; };
      names = names0.slice().sort((x, y) => score(x) - score(y));
    }
    const val = (n, h) => summary.events.find((e) => e.variant === n && e.half === h)?.[metric]?.median;
    const tests = [...new Map(summary.events.map((e) => [e.half, e.scope])).entries()];
    const fmtV = metric === "script" ? (x) => (x >= 1000 ? fmt(Math.round(x)) : x >= 10 ? x.toFixed(0) : x.toFixed(1)) : (x) => x.toFixed(x >= 100 ? 0 : 1);
    const shade = (f) => `hsla(${Math.round(120 * (1 - Math.min(1, Math.log2(f))))}, 70%, 45%, 0.28)`;
    const cell = (x, best) => x == null ? el("td", { text: "—" }) : el("td", { style: `background:${shade(x / best)}`, title: `${(x / best).toFixed(2)}× the fastest` },
      fmtV(x), el("span", { class: "factor", text: ` (${(x / best).toFixed(2)})` }));
    const rows = tests.map(([h, scope]) => {
      const xs = names.map((n) => val(n, h)), best = Math.min(...xs.filter((x) => x != null));
      return el("tr", {}, el("th", { text: h + (scope === "global" ? " *" : "") + (JFB_WEIGHTS[h] ? " ◆" : "") }), ...xs.map((x) => cell(x, best)));
    });
    // Geometric means of the factors: js-framework-benchmark's weighted one over its nine tests, where
    // they are present, and an unweighted one over every local test.
    const geo = (pick) => {
      const ts = tests.filter(([h, scope]) => pick(h, scope));
      if (!ts.length) return null;
      const bests = ts.map(([h]) => Math.min(...names.map((n) => val(n, h)).filter((x) => x != null)));
      return names.map((n) => {
        let sum = 0, W = 0;
        ts.forEach(([h], i) => { const x = val(n, h); if (x == null) return; const w = JFB_WEIGHTS[h] && pick === jfbPick ? JFB_WEIGHTS[h] : 1; sum += w * Math.log(x / bests[i]); W += w; });
        return W ? Math.exp(sum / W) : null;
      });
    };
    const jfbPick = (h) => !!JFB_WEIGHTS[h];
    const geoRow = (label, g) => g && el("tr", { class: "geo" }, el("th", { text: label }), ...g.map((f) => f == null ? el("td", { text: "—" }) : el("td", { style: `background:${shade(f)}`, text: f.toFixed(2) })));
    const gj = geo(jfbPick), gl = geo((h, scope) => scope === "local");
    return el("div", { class: "scroll" }, el("table", { class: "pertest" },
      el("thead", {}, el("tr", {}, el("th", { text: "test" }), ...names.map((n) => el("th", { text: n })))),
      el("tbody", {}, rows, gj && tests.some(([h]) => JFB_WEIGHTS[h]) ? geoRow("js-framework-benchmark weighted geometric mean ◆", gj) : null, geoRow("geometric mean, local tests (unweighted)", gl))));
  }
  function cpuCard(sc) {
    const c = sc.cpu;
    if (!c) return card("CPU time", null, el("p", { class: "note", text: "No CPU results for this scenario yet. Run ./rr bench " + sc.name + " all --remote azathoth: it times one event and the startup of one app per framework from Chrome traces, and this card appears here." }), sc.variants);
    const { run, summary } = c;
    const names = Object.keys(run.variants).sort((a, b) => NAMES.indexOf(a) - NAMES.indexOf(b));
    const sub = (n) => (run.variants[n].excluded ? "fails a rule: reference only" : run.variants[n].track === "prototype" ? "prototype" : "");
    const excluded = names.filter((n) => run.variants[n].excluded);
    const halves = [...new Map(summary.events.map((e) => [e.half, e.scope])).entries()];
    const us = (t) => (t >= 100 ? fmt(t) : t >= 10 ? t.toFixed(0) : t.toFixed(1));
    const eventOf = (n) => {
      if (cpuEvent) {
        const e = summary.events.find((x) => x.variant === n && x.half === cpuEvent);
        return e ? { value: e.script.median, lo: e.script.p25, hi: e.script.p75 } : null;
      }
      const es = summary.events.filter((x) => x.variant === n && x.scope === "local");
      return es.length ? { value: median(es.map((x) => x.script.median)), lo: median(es.map((x) => x.script.p25)), hi: median(es.map((x) => x.script.p75)) } : null;
    };
    const evItems = names.map((n) => ({ name: n, sub: sub(n), color: colorOfName(n), ...eventOf(n) })).filter((x) => x.value != null);
    const st = (n) => summary.startup.find((x) => x.variant === n);
    const startItems = names.filter(st).map((n) => ({ name: n, sub: sub(n), color: colorOfName(n), value: st(n).total.median, lo: st(n).total.p25, hi: st(n).total.p75 }));
    const heapItems = names.filter(st).map((n) => ({ name: n, sub: sub(n), color: colorOfName(n), value: st(n).heapBytes / 1e6 }));
    const select = el("select", { onchange: (e) => { cpuEvent = e.target.value; render(); } },
      el("option", { value: "", text: "median of the local events" }),
      ...halves.map(([h, scope]) => el("option", { value: h, text: h + (scope === "global" ? " (global by nature)" : ""), ...(cpuEvent === h ? { selected: "" } : {}) })));
    if (!cpuEvent) select.firstChild.selected = true;
    const sizes = run.sizes.join(","), seeds = run.seeds.join(",");
    const m = run.machine, v = run.versions, meth = run.method;
    const fwv = Object.entries(run.variants).map(([n, x]) => `${n}: ${Object.entries(x.versions || {}).map(([k, y]) => `${k} ${y}`).join(", ")}`);
    const rowsAll = summary.events.slice().sort((a, b) => NAMES.indexOf(a.variant) - NAMES.indexOf(b.variant))
      .filter((e) => !cpuEvent || e.half === cpuEvent)
      .map((e) => [e.variant, e.half + (e.scope === "global" ? " *" : ""), us(e.script.median), `${us(e.script.p25)}–${us(e.script.p75)}`, e.script.ci[0] == null ? "—" : `${us(e.script.ci[0])}–${us(e.script.ci[1])}`, e.script.n, e.total.median.toFixed(2)]);
    const out = [el("h3", { text: `CPU time (N=${sizes}, seed ${seeds})` }),
      el("p", { class: "note", text: "One app per framework, at the same size. Script time (µs) of one event, from a Chrome trace: from the input event to the first commit after the app's work, the JavaScript inside (js-framework-benchmark's rule, no CPU throttling). Each event is ./rr work's action as real input through the DevTools protocol, repeated from the same state on one page; the bar is the median over the reps (of the median over the local events, unless one event is picked), the whisker the interquartile range. Lower is faster. Differences under about 10% are within the A/A noise." + (run.quick ? " This is a --quick run: few reps; for development, not for conclusions." : "") }),
      ...excluded.map((n) => el("p", { class: "note", text: `${n} is shown for reference only: it ${run.variants[n].excluded}. It is left out of this scenario's size results.` })),
      el("div", { class: "controls" }, el("label", {}, "event ", select)),
      el("div", { class: "chart" }, bars({ items: evItems, unit: "µs", yFmt: us })),
      details("Table", table(["variant", "event", "script µs (median)", "IQR", "95% CI of the median", "n", "total ms (median)"], rowsAll)),
      el("h4", { text: "Per test" }),
      el("p", { class: "note", text: "The median of every test for every framework, and in brackets its factor over the fastest framework on that test (1.00 = fastest), coloured from green to red at 2× and beyond, as js-framework-benchmark's results table shows them. ◆ marks the tests that stand for js-framework-benchmark's nine; their geometric mean uses its weights. * marks global tests. Script time is the stable measure; total time (to the paint, rasterised in software in headless Chrome) moved by up to 10% between runs of unchanged code." }),
      el("div", { class: "controls" }, el("label", {}, "metric ", el("select", { onchange: (e) => { cpuMetric = e.target.value; render(); } },
        el("option", { value: "script", text: "script (µs)", ...(cpuMetric === "script" ? { selected: "" } : {}) }),
        el("option", { value: "total", text: "total, input to paint (ms)", ...(cpuMetric === "total" ? { selected: "" } : {}) })))),
      perTestTable(summary, names, cpuMetric),
      el("h4", { text: "Startup: navigation to the first paint after mount" }),
      el("div", { class: "chart" }, bars({ items: startItems, unit: "ms", yFmt: (t) => t.toFixed(t >= 10 ? 0 : 1) })),
      el("h4", { text: "JS heap after mount, after a forced garbage collection" }),
      el("div", { class: "chart" }, bars({ items: heapItems, unit: "MB", yFmt: (t) => t.toFixed(2) })),
      details("Table", table(["variant", "startup total ms (median)", "IQR", "script ms (median)", "compile ms", "JS heap after mount (MB)", "loads"],
        names.filter(st).map((n) => { const s = st(n); return [n, s.total.median.toFixed(1), `${s.total.p25.toFixed(1)}–${s.total.p75.toFixed(1)}`, s.script.median.toFixed(2), s.compileMs.toFixed(2), (s.heapBytes / 1e6).toFixed(2), s.total.n]; })))];
    if (summary.aa) {
      out.push(el("h4", { text: "A/A check: one app under two names" }),
        table(["app", "twin", "cells", "intervals overlap", "median |difference|", "max |difference|"],
          Object.entries(summary.aa).map(([n, x]) => [n, x.twin, x.cells, x.overlapping, (x.medianAbsDiff * 100).toFixed(1) + "%", (x.maxAbsDiff * 100).toFixed(1) + "%"])));
    }
    out.push(el("div", { class: "source" },
      el("div", { text: `Results: results/cpu/${c.dir} · commit ${v.git ? v.git.commit.slice(0, 7) + (v.git.dirty ? " (dirty)" : "") : "?"} · N=${sizes} × seed ${seeds} · reps ${meth.warmup} warm-up + ${meth.minReps}–${meth.maxReps} (stop at ±${meth.tol * 100}%) · startup ${meth.loads} loads${run.quick ? " · --quick" : ""}` }),
      el("div", { text: `${m.hostname}: ${m.cpu}, ${m.threads} threads, governor ${m.governor ?? "?"}, no_turbo ${m.noTurbo ?? "—"}, taskset ${(run.workers || []).filter(Boolean).join(" / ") || m.taskset || "none"} · ${m.kernel} · ${v.chrome} · Node ${v.node}` }),
      el("div", { text: fwv.join(" · ") })));
    return el("section", { class: "card" }, out);
  }

  function renderScenario(sc) {
    const out = [el("h2", { text: `Scenario: ${sc.name}` })];
    const vs = sc.variants;
    const color = (i) => colorOfName(vs[i].name);
    const unit = mode === "br" ? "B brotli" : "B raw";

    // 1. Size against N: every framework's total on one graph.
    const totals = vs.map((v, i) => ({ name: v.name + (v.track === "prototype" ? " (prototype)" : ""), color: color(i), points: bySize(v.records, M.total), endLabel: true }));
    const sizeChart = el("div", { class: "chart" });
    sizeChart.append(lineChart({ series: totals, unit, width: 1060, height: 380 }));
    out.push(card(`Size against N (${mode === "br" ? "compressed" : "raw"})`,
      "Total = HTML + JavaScript (the adapter excluded), each compressed on its own. Median of the seeds per size, with their spread as a pale bar. Hover a label to pick out its curve; the HTML/JavaScript split is in the table and under Where the bytes go.",
      [hoverLegend(totals.map((s) => [s.name, s.color]), sizeChart), sizeChart,
        details("Table", table(["variant", "N", "seeds", "total (median)", "JS (median)", "HTML (median)", "total min–max"],
          vs.flatMap((v) => bySize(v.records, M.total).map((p) => {
            const js = bySize(v.records, M.js).find((q) => q.x === p.x), html = bySize(v.records, M.html).find((q) => q.x === p.x);
            return [v.name, p.x, p.n, fmt(p.y), fmt(js.y), fmt(html.y), `${fmt(p.lo)}–${fmt(p.hi)}`];
          }))))], vs));

    // 2. Fitted baseline and slope.
    const metricKey = mode === "br" ? "total.br" : "total.raw";
    // A variant measured at one size (e.g. beni on big-table) has no line to fit.
    const fitted = (v) => bySize(v.records, M.total).length >= 2;
    const curves = vs.flatMap((v, i) => {
      const c = [];
      if (!fitted(v)) return c;
      const a = v.fit.all[metricKey];
      c.push({ color: color(i), fn: (x) => a.baseline + a.slope * x, width: 1.5, opacity: 0.55, dash: "5 4" });
      if (v.fit.steady) {
        const s = v.fit.steady[metricKey];
        c.push({ color: color(i), fn: (x) => s.baseline + s.slope * x, from: v.fit.steady.from, width: 2, opacity: 0.9 });
      }
      return c;
    });
    const fitSeries = vs.map((v, i) => ({ name: v.name, color: color(i), points: bySize(v.records, M.total) }));
    const fitRows = [];
    for (const v of vs) {
      if (!fitted(v)) { fitRows.push([v.name, "one size: no fit", ...Array(11).fill("—")]); continue; }
      for (const which of ["all", "steady"]) {
        const f = v.fit[which];
        if (!f) continue;
        const pick = (k) => f[`${k}.${mode}`];
        const row = [v.name, which === "all" ? "all" : `N ≥ ${f.from}`];
        for (const k of ["total", "js", "html", "runtime", "app"]) { const g = pick(k); row.push(fmt(g.baseline), g.slope.toFixed(1)); }
        row.push(pick("total").r2 == null ? "—" : pick("total").r2.toFixed(3));
        fitRows.push(row);
      }
    }
    out.push(card("Fitted baseline and slope",
      "Least squares, bytes = baseline + slope × N, over all sizes (dashed) and over the sizes where the scenario's growth is steady (solid; for the dashboard, N ≥ 16, once every widget kind is present). Points are the measured medians; the x axis is logarithmic, so the fitted lines curve.",
      [legend([...vs.map((v, i) => [v.name + " (measured medians, fits)", color(i)]), ["fit, all sizes", "var(--muted)", "border-top-style:dashed"], ["fit, steady sizes", "var(--muted)"]]),
        lineChart({ series: fitSeries, curves, unit, width: 1060, height: 340, pointsOnly: true }),
        table(["variant", "sizes", "total base", "total slope", "JS base", "JS slope", "HTML base", "HTML slope", "runtime base", "runtime slope", "app base", "app slope", "R² (total)"], fitRows),
        el("p", { class: "note", text: `Bytes (${unit}); slopes in bytes per widget. "runtime" is library code plus bundler glue; "app" is everything else in the bundle except the adapter (brotli: what the app adds on top of the runtime).` })], vs));

    // 3. Where the bytes go.
    const parts = PARTS[mode];
    const stacks = vs.map((v) => {
      const sizes = [...new Set(v.records.map((r) => r.size))].sort((a, b) => a - b).map((size) => {
        const rs = v.records.filter((r) => r.size === size);
        return { size, values: parts.map(([, get]) => median(rs.map(get))) };
      });
      return { v, sizes };
    });
    const stackMax = Math.max(...stacks.flatMap((s) => s.sizes.map((x) => x.values.reduce((a, b) => a + b, 0))));
    const partColors = parts.map(([name], i) => ({ name, color: SLOTS[i] }));
    out.push(card(`Where the bytes go (${mode === "br" ? "compressed" : "raw"})`,
      mode === "br"
        ? "Runtime = the bundle's library code (plus bundler glue) compressed alone; app code = what the app's own code adds to the compressed JavaScript; HTML compressed on its own. Attribution by source map; the adapter is excluded."
        : "Raw minified bytes per source-map bucket: runtime (node_modules), tooling (bundler glue with no source), app code, and the unminified HTML. The adapter is excluded.",
      [legend(partColors.map((p) => [p.name, p.color]), true),
        el("div", { class: "grid2" }, stacks.map(({ v, sizes }) => el("div", { class: "card" }, el("h3", { text: v.name }), stackedChart({ sizes, parts: partColors, yMax: stackMax })))),
        details("Table", table(["variant", "N", ...parts.map(([n]) => n), "adapter (excluded)"],
          stacks.flatMap(({ v, sizes }) => sizes.map((s) => [v.name, s.size, ...s.values.map(fmt), fmt(median(v.records.filter((r) => r.size === s.size).map((r) => r.adapter[mode])))]))))], vs));

    // 4. Ratio to vanilla.
    const vanilla = vs.find((v) => v.emitter === "vanilla" || v.framework === "vanilla");
    if (!vanilla) {
      out.push(card("Ratio to vanilla", null, el("p", { class: "note", text: "No vanilla results for this scenario yet. This chart appears once a vanilla emitter has been measured: each variant's compressed total divided by vanilla's, per size." }), vs));
    } else {
      const base = bySize(vanilla.records, M.total);
      const series = vs.filter((v) => v !== vanilla).map((v, i) => ({
        name: v.name, color: color(vs.indexOf(v)),
        points: bySize(v.records, M.total).map((p) => { const b = base.find((q) => q.x === p.x); return { x: p.x, y: p.y / b.y, lo: p.lo / b.y, hi: p.hi / b.y }; }),
      }));
      out.push(card("Ratio to vanilla", "Each variant's total divided by vanilla's (medians), per size. 1 = as small as vanilla.",
        [legend(series.map((s) => [s.name, s.color])), lineChart({ series, unit: "× vanilla", width: 1060, height: 300, yFmt: (t) => t.toFixed(1) })], vs));
    }
    out.push(workCard(sc));
    out.push(cpuCard(sc));
    return out;
  }

  // Least squares over [x, y] points.
  function fit(points) {
    const n = points.length, mx = points.reduce((a, [x]) => a + x, 0) / n, my = points.reduce((a, [, y]) => a + y, 0) / n;
    let sxy = 0, sxx = 0;
    for (const [x, y] of points) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; }
    const slope = sxx ? sxy / sxx : 0;
    return { slope, baseline: my - slope * mx };
  }

  // Grouped vertical bars: one group per category, one bar per series.
  function groupedBars({ categories, series, unit, yFmt = fmt }) {
    const W = 1060, H = 300, L = 56, R = 14, T = 24, B = 54;
    const max = Math.max(1, ...series.flatMap((s) => s.values.filter((v) => v != null)));
    const ticks = niceTicks(max), top = ticks[ticks.length - 1];
    const Y = (y) => T + (1 - y / top) * (H - T - B);
    const band = (W - L - R) / categories.length;
    const bw = Math.min(24, (band * 0.7) / series.length);
    const svg = sv("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });
    for (const t of ticks) {
      svg.append(sv("line", { class: "gridline", x1: L, x2: W - R, y1: Y(t), y2: Y(t) }));
      svg.append(sv("text", { x: L - 6, y: Y(t) + 4, "text-anchor": "end", text: yFmt(t) }));
    }
    svg.append(sv("text", { x: L - 6, y: 11, "text-anchor": "end", text: unit }));
    categories.forEach((c, i) => {
      const cx = L + band * (i + 0.5);
      svg.append(sv("text", { x: cx, y: H - B + 16, "text-anchor": "middle", text: c }));
      series.forEach((s, j) => {
        const v = s.values[i];
        if (v == null) return;
        const x = cx - (series.length * (bw + 2)) / 2 + j * (bw + 2), y = Y(v), h = Math.max(0, Y(0) - y);
        const bar = sv("path", { d: roundedTop(x, y, bw, h), fill: s.color });
        bar.addEventListener("pointermove", (e) => showTip(e, c, series.map((q) => [q.color, q.values[i] == null ? "—" : `${yFmt(q.values[i])} ${unit}`, q.name])));
        bar.addEventListener("pointerleave", hideTip);
        svg.append(bar);
        svg.append(sv("text", { x: x + bw / 2, y: y - 4, "text-anchor": "middle", text: yFmt(v) }));
      });
    });
    svg.append(sv("line", { class: "axis", x1: L, x2: W - R, y1: Y(0), y2: Y(0) }));
    return svg;
  }

  // Every framework's growth in each scenario, side by side.
  function renderCompare() {
    const scs = DATA.scenarios;
    const from = 16;
    const stat = (sc, n) => {
      const v = sc.variants.find((x) => x.name === n);
      if (!v) return null;
      const pts = bySize(v.records, M.total);
      const steady = pts.filter((p) => p.x >= from);
      return { n1: pts.find((p) => p.x === Math.min(...pts.map((q) => q.x)))?.y, slope: steady.length >= 2 ? fit(steady.map((p) => [p.x, p.y])).slope : null, max: pts[pts.length - 1] };
    };
    const names = NAMES.filter((n) => scs.some((sc) => sc.variants.some((v) => v.name === n)));
    const scColor = (i) => SLOTS[i % SLOTS.length];
    const slopeSeries = scs.map((sc, i) => ({ name: sc.name, color: scColor(i), values: names.map((n) => stat(sc, n)?.slope ?? null) }));
    const baseSeries = scs.map((sc, i) => ({ name: sc.name, color: scColor(i), values: names.map((n) => stat(sc, n)?.n1 ?? null) }));
    const unit = mode === "br" ? "B brotli" : "B raw";
    const rows = names.map((n) => {
      const st = scs.map((sc) => stat(sc, n));
      const ratio = st.length === 2 && st[0]?.slope && st[1]?.slope ? (st[1].slope / st[0].slope).toFixed(1) + "×" : "—";
      return [n, ...st.flatMap((x) => [x?.n1 != null ? fmt(x.n1) : "—", x?.slope != null ? x.slope.toFixed(1) : "—"]), ratio];
    });
    // One entry per framework and run, for the source line.
    const allVariants = [...new Map(scs.flatMap((sc) => sc.variants).map((v) => [v.name + "|" + v.run.dir, v])).values()];
    return [
      el("h2", { text: "Compare scenarios" }),
      card(`Bytes per added widget (slope from N=${from})`,
        "Least squares over the medians at N ≥ " + from + ", the same way for every scenario, so the slopes compare. shared-components: one more use of an existing component kind. unique-components: one more component, used once.",
        [legend(slopeSeries.map((s) => [s.name, s.color]), true), groupedBars({ categories: names, series: slopeSeries, unit: unit + "/widget", yFmt: (t) => t.toFixed(0) })], allVariants),
      card("Baseline: the smallest app (N=1)", "Median total at the smallest measured size: mostly the runtime.",
        [legend(baseSeries.map((s) => [s.name, s.color]), true), groupedBars({ categories: names, series: baseSeries, unit })], allVariants),
      card("Table", null, table(["framework", ...scs.flatMap((sc) => [`${sc.name} N=1`, `${sc.name} slope`]), scs.length === 2 ? `slope ratio (${scs[1].name} / ${scs[0].name})` : ""], rows), allVariants),
    ];
  }

  // ---- parse time: how long Chrome takes to parse and compile JavaScript, against its size.
  const PARSE_VIEW = "parse time";
  const PARSE_FORMS = [["unminified", "unminified"], ["esbuild", "esbuild"], ["terser", "esbuild + terser"]];
  const PARSE_COLORS = { unminified: "var(--s1)", esbuild: "var(--s2)", terser: "var(--s3)" };
  let parseMode = "external";

  // x: raw bytes (linear), y: milliseconds (linear), one line per form, the 95% interval of each
  // median drawn as an error bar.
  function parseChart({ series, unit = "ms", width = 560, height = 300 }) {
    const W = width, H = height, L = 52, R = 16, T = 24, B = 38;
    const xTicks = niceTicks(Math.max(...series.flatMap((s) => s.points.map((p) => p.x))) / 1000).map((t) => t * 1000);
    const yTicks = niceTicks(Math.max(...series.flatMap((s) => s.points.map((p) => p.hi))));
    const xTop = xTicks[xTicks.length - 1], yTop = yTicks[yTicks.length - 1];
    const X = (x) => L + (x / xTop) * (W - L - R);
    const Y = (y) => T + (1 - y / yTop) * (H - T - B);
    const yFmt = (v) => (v >= 10 ? fmt(v) : String(+v.toFixed(1)));
    const svg = sv("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });
    for (const t of yTicks) {
      svg.append(sv("line", { class: "gridline", x1: L, x2: W - R, y1: Y(t), y2: Y(t) }));
      svg.append(sv("text", { x: L - 6, y: Y(t) + 4, "text-anchor": "end", text: yFmt(t) }));
    }
    for (const t of xTicks) svg.append(sv("text", { x: X(t), y: H - B + 16, "text-anchor": "middle", text: t >= 1e6 ? t / 1e6 + " MB" : t / 1000 + " kB" }));
    svg.append(sv("text", { x: (L + W - R) / 2, y: H - 4, "text-anchor": "middle", text: "raw script size (bytes of that form)" }));
    svg.append(sv("text", { x: L - 6, y: 11, "text-anchor": "end", text: unit }));
    svg.append(sv("line", { class: "axis", x1: L, x2: W - R, y1: Y(0), y2: Y(0) }));
    series.forEach((s, si) => {
      const g = sv("g", { class: "series", "data-s": si });
      svg.append(g);
      g.addEventListener("pointerenter", () => highlight(svg.parentNode, si));
      g.addEventListener("pointerleave", () => highlight(svg.parentNode, null));
      g.append(sv("polyline", { points: s.points.map((p) => `${X(p.x)},${Y(p.y)}`).join(" "), fill: "none", stroke: s.color, "stroke-width": 2, "stroke-linejoin": "round" }));
      for (const p of s.points) {
        g.append(sv("line", { x1: X(p.x), x2: X(p.x), y1: Y(p.lo), y2: Y(p.hi), stroke: s.color, "stroke-width": 1.5 }));
        for (const v of [p.lo, p.hi]) g.append(sv("line", { x1: X(p.x) - 3, x2: X(p.x) + 3, y1: Y(v), y2: Y(v), stroke: s.color, "stroke-width": 1.5 }));
        g.append(sv("circle", { cx: X(p.x), cy: Y(p.y), r: 3.5, fill: s.color, stroke: "var(--card)", "stroke-width": 1.5 }));
        const hit = sv("circle", { cx: X(p.x), cy: Y(p.y), r: 9, fill: "transparent" });
        hit.addEventListener("pointermove", (e) => showTip(e, `${s.name}: ${fmt(p.x)} bytes`, [
          [s.color, `${yFmt(p.y)} ${unit}`, `median of ${p.n}`],
          [s.color, `${p.lo.toFixed(2)}–${p.hi.toFixed(2)} ${unit}`, `95% interval (±${p.precisionPct}%)`],
        ]));
        hit.addEventListener("pointerleave", hideTip);
        g.append(hit);
      }
    });
    return svg;
  }

  function renderParse() {
    const P = DATA.parse, run = P.run, rows = P.summary.points.filter((p) => p.mode === parseMode);
    const fits = P.summary.fits.filter((f) => f.mode === parseMode);
    const modes = [...new Set(P.summary.points.map((p) => p.mode))];
    const fitOf = (form, metric) => fits.find((f) => f.form === form && f.metric === metric);
    const num = (x, d = 1) => (x == null ? "—" : x.toFixed(d));
    const formRows = (form) => rows.filter((r) => r.form === form).sort((a, b) => a.bytes - b.bytes);
    const series = (metric) => PARSE_FORMS.map(([form, name]) => ({
      name, color: PARSE_COLORS[form],
      points: formRows(form).map((r) => ({ x: r.bytes, y: r[metric].median, lo: r[metric].ci[0], hi: r[metric].ci[1], n: r[metric].n, precisionPct: r[metric].precisionPct })),
    }));
    const linear = PARSE_FORMS.every(([form]) => fitOf(form, "compileMs")?.linear);
    const compileText = PARSE_FORMS.map(([form, name]) => `${num(fitOf(form, "compileMs").msPer100kB, 1)} ms per 100 kB of ${name}`).join(", ");
    const evalText = PARSE_FORMS.map(([form, name]) => `${num(fitOf(form, "evaluateMs").msPer100kB, 2)} (${name})`).join(", ");
    const exps = PARSE_FORMS.map(([form]) => fitOf(form, "compileMs").exponent);
    const expText = `${num(Math.min(...exps), 2)}–${num(Math.max(...exps), 2)}`;
    const big = (form) => formRows(form)[formRows(form).length - 1];
    const perByteRatio = fitOf("esbuild", "compileMs").msPer100kB / fitOf("unminified", "compileMs").msPer100kB;
    const governorWarning = run.warnings?.length ? el("p", { class: "note", style: "color:var(--s8);font-weight:600", text: "Warning: " + run.warnings.join(" ") }) : null;
    const git = run.versions.git ? run.versions.git.commit.slice(0, 7) + (run.versions.git.dirty ? " (dirty)" : "") : "?";
    const source = () => el("div", { class: "source" },
      el("div", { text: `Results: results/parse/${P.dir} · commit ${git} · ${run.options.points} sizes × 3 forms × modes ${run.options.modes.join(", ")} · seed ${run.options.seed} · ${run.loadsTotal} loads · stop at ±${run.options.tol * 100}% (${run.options.minReps}–${run.options.maxReps} loads per point)` }),
      el("div", { text: `${run.versions.chrome} · Node ${run.versions.node} · esbuild ${run.versions.esbuild} · terser ${run.versions.terser} · ${run.machine.hostname}, ${run.machine.cpu} · CPU governor: ${run.machine.governor}` }));
    const card = (title, note, body) => el("section", { class: "card" }, el("h3", { text: title }), note ? el("p", { class: "note", text: note }) : null, body, source());
    const chartCard = (title, note, metric) => {
      const s = series(metric);
      const root = el("div", { class: "chart" }, parseChart({ series: s }));
      return card(title, note, [hoverLegend(s.map((x) => [x.name, x.color]), root), root]);
    };
    const pointRows = PARSE_FORMS.flatMap(([form, name]) => formRows(form).map((r) => [
      name, fmt(r.bytes), fmt(r.brotliBytes), r.n + (r.hitMax ? "*" : ""),
      `${num(r.compileMs.median, 2)} [${num(r.compileMs.ci[0], 2)}, ${num(r.compileMs.ci[1], 2)}] ±${num(r.compileMs.precisionPct, 1)}%`,
      num((r.compileMs.median / r.bytes) * 1e5, 2),
      `${num(r.evaluateMs.median, 2)} [${num(r.evaluateMs.ci[0], 2)}, ${num(r.evaluateMs.ci[1], 2)}] ±${num(r.evaluateMs.precisionPct, 1)}%`,
      parseMode === "external" ? `${num(r.compileBackgroundMs?.median, 2)} / ${num(r.compileMainMs?.median, 2)}` : "—",
    ]));
    const fitRows = PARSE_FORMS.flatMap(([form, name]) => ["compileMs", "evaluateMs"].map((m) => {
      const f = fitOf(form, m);
      return [name, m === "compileMs" ? "compile" : "evaluate", num(f.msPer100kB, 3), num(f.interceptMs, 2), num(f.r2, 4), `${num(f.exponent, 3)} ± ${num(f.exponentSe, 3)}`, f.linear ? "yes" : "no"];
    }));
    const answer = `Chrome ${run.versions.chrome.replace(/^.*?(\d+\.\d+\.\d+\.\d+).*$/, "$1")} parses and compiles ${compileText} (the slope of a straight line through the medians of ${run.options.points} sizes, ${parseMode} script, ${fmt(formRows("unminified")[0].bytes)} B to ${fmt(big("unminified").bytes)} B unminified). The relation is ${linear ? "linear" : "not (quite) linear"}: the straight-line fit has R² ≥ ${num(Math.min(...PARSE_FORMS.map(([form]) => fitOf(form, "compileMs").r2)), 3)} and a fixed cost of ${num(Math.min(...PARSE_FORMS.map(([form]) => fitOf(form, "compileMs").interceptMs)), 1)}–${num(Math.max(...PARSE_FORMS.map(([form]) => fitOf(form, "compileMs").interceptMs)), 1)} ms (power-law exponent ${expText}, where 1 is proportional). Per byte, minified code costs ${num(perByteRatio, 1)}× as much as unminified code, but it has ${num(big("unminified").bytes / big("esbuild").bytes, 1)}× fewer bytes, so the same program takes ${num((big("esbuild").compileMs.median / big("unminified").compileMs.median) * 100, 0)}% of the time once minified. Running the top level (evaluate) grows far more slowly, ${evalText} ms per 100 kB: the generated program only registers its modules there, so what grows with size is parsing, not running.`;
    return [
      el("h2", { text: "Parse and compile time against script size" }),
      el("p", { class: "lead", text: answer }),
      governorWarning,
      el("div", { class: "controls" }, modes.map((m) => el("label", {}, el("input", { type: "radio", name: "parsemode", value: m, ...(parseMode === m ? { checked: "" } : {}), onchange: () => { parseMode = m; render(); } }),
        m === "external" ? "external script (streamed, parsed off the main thread)" : "inline script (all on the main thread)"))),
      chartCard("Compile time", parseMode === "external"
        ? "v8.parseOnBackground (the worker thread that parses the streamed script) plus v8.compile (the main thread, which only finishes a streamed script). Median of fresh page loads; bars are the 95% bootstrap interval of the median."
        : "v8.compile on the main thread: the whole parse and compile of the script in the page. Median of fresh page loads; bars are the 95% bootstrap interval of the median.", "compileMs"),
      chartCard("Evaluate time", "EvaluateScript on the main thread: running the script's top level (it defines and registers modules and boots two) plus compiling the functions that run needs" + (parseMode === "inline" ? ", and here the whole compile too, which EvaluateScript contains when the script is not streamed." : ", on top of the compile above, which the worker thread did already."), "evaluateMs"),
      card("Straight-line and power-law fits", "ms = intercept + slope × bytes through the medians; the exponent is the slope of ln ms against ln bytes (1 means linear). Linear here means R² ≥ 0.99 for the straight line; a fixed cost (the intercept) pulls the exponent below 1.",
        table(["form", "metric", "ms per 100 kB", "intercept ms", "R²", "exponent ± se", "linear"], fitRows)),
      card("Every point", "Median [95% interval] ±half-width as a percentage of the median, in ms. * = stopped at the maximum number of loads without reaching the precision. Last column: the worker thread's parse / the main thread's compile in ms (external only). Brotli is the size on the wire, for context; parse time follows the raw bytes.",
        table(["form", "raw bytes", "brotli bytes", "loads", "compile ms", "compile ms / 100 kB", "evaluate ms", "background / main"], pointRows)),
    ];
  }

  function render() {
    hideTip();
    const total = DATA.scenarios.reduce((a, s) => a + s.variants.length, 0);
    if (!views().includes(view)) view = views()[0];
    const tabs = el("nav", { class: "tabs" }, views().map((v) => el("a", {
      href: "#" + encodeURIComponent(v), class: v === view ? "on" : "",
      onclick: (e) => { e.preventDefault(); view = v; history.replaceState(null, "", "#" + encodeURIComponent(v)); render(); },
    }, v === "compare" ? "Compare scenarios" : v === PARSE_VIEW ? "Parse time" : v)));
    app.replaceChildren(
      el("h1", { text: "How many bytes does a reactive UI ship?" }),
      ...(view === PARSE_VIEW ? [] : [
        el("p", { class: "lead", text: `Everything the browser downloads, HTML + JavaScript, against the size of the app. ${DATA.scenarios.length} scenario(s), ${NAMES.length} framework variant(s); the latest run per variant and scenario.` }),
      el("div", { class: "controls" },
        el("label", {}, el("input", { type: "radio", name: "mode", value: "br", ...(mode === "br" ? { checked: "" } : {}), onchange: () => { mode = "br"; render(); } }), "compressed (brotli 11)"),
        el("label", {}, el("input", { type: "radio", name: "mode", value: "raw", ...(mode === "raw" ? { checked: "" } : {}), onchange: () => { mode = "raw"; render(); } }), "raw"))]),
      tabs,
      ...(view === PARSE_VIEW ? renderParse() : view === "compare" ? renderCompare() : renderScenario(DATA.scenarios.find((sc) => sc.name === view))));
  }
  window.addEventListener("hashchange", () => { view = decodeURIComponent(location.hash.slice(1)); render(); });
  render();
})();
