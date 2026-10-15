// The plots page's script (inlined by harness/plots.js). Draws every chart as inline SVG from
// the embedded results; no libraries, no network.
(() => {
  const DATA = JSON.parse(document.getElementById("data").textContent);
  const SVG = "http://www.w3.org/2000/svg";
  const SLOTS = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--s5)", "var(--s6)", "var(--s7)", "var(--s8)"];
  const app = document.getElementById("app");
  const tip = document.getElementById("tip");
  let mode = "br";

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
  function lineChart({ series, curves = [], yMax, unit = "B", width = 560, height = 260, pointsOnly = false, yFmt = fmt, xLabel = "N (widgets, log scale)" }) {
    const W = width, H = height, L = 56, R = 14, T = 24, B = 34;
    const xs = [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))].sort((a, b) => a - b);
    const lx = (x) => Math.log2(x);
    const x0 = lx(xs[0]), x1 = lx(xs[xs.length - 1]) || 1;
    const X = (x) => L + ((lx(x) - x0) / (x1 - x0 || 1)) * (W - L - R);
    const max = yMax ?? Math.max(...series.flatMap((s) => s.points.map((p) => p.hi)), ...curves.flatMap((c) => xs.map((x) => c.fn(x))));
    const ticks = niceTicks(max);
    const top = ticks[ticks.length - 1];
    const Y = (y) => T + (1 - y / top) * (H - T - B);
    const svg = sv("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });
    for (const t of ticks) {
      svg.append(sv("line", { class: "gridline", x1: L, x2: W - R, y1: Y(t), y2: Y(t) }));
      svg.append(sv("text", { x: L - 6, y: Y(t) + 4, "text-anchor": "end", text: yFmt(t) }));
    }
    for (const x of xs) svg.append(sv("text", { x: X(x), y: H - B + 16, "text-anchor": "middle", text: String(x) }));
    svg.append(sv("text", { x: (L + W - R) / 2, y: H - 4, "text-anchor": "middle", text: xLabel }));
    svg.append(sv("text", { x: L - 6, y: 11, "text-anchor": "end", text: unit }));
    svg.append(sv("line", { class: "axis", x1: L, x2: W - R, y1: Y(0), y2: Y(0) }));
    for (const c of curves) {
      const pts = [];
      const from = c.from ?? xs[0], to = c.to ?? xs[xs.length - 1];
      for (let i = 0; i <= 64; i++) { const x = 2 ** (lx(from) + (i / 64) * (lx(to) - lx(from))); pts.push(`${X(x).toFixed(1)},${Y(c.fn(x)).toFixed(1)}`); }
      svg.append(sv("polyline", { points: pts.join(" "), fill: "none", stroke: c.color, "stroke-width": c.width ?? 1.5, "stroke-opacity": c.opacity ?? 1, "stroke-dasharray": c.dash || "" }));
    }
    for (const s of series) {
      for (const p of s.points) if (p.hi > p.lo) svg.append(sv("line", { x1: X(p.x), x2: X(p.x), y1: Y(p.lo), y2: Y(p.hi), stroke: s.color, "stroke-width": 6, "stroke-opacity": 0.25, "stroke-linecap": "round" }));
      if (!pointsOnly) svg.append(sv("polyline", { points: s.points.map((p) => `${X(p.x)},${Y(p.y)}`).join(" "), fill: "none", stroke: s.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
      for (const p of s.points) svg.append(sv("circle", { cx: X(p.x), cy: Y(p.y), r: 4, fill: s.color, stroke: "var(--card)", "stroke-width": 2 }));
      if (s.endLabel) {
        const p = s.points[s.points.length - 1];
        svg.append(sv("text", { x: X(p.x) - 6, y: Y(p.y) - 9, "text-anchor": "end", text: fmt(p.y) }));
      }
    }
    // Crosshair: snap to the nearest N and list every series there.
    const cross = sv("line", { class: "crosshair", y1: T, y2: H - B, visibility: "hidden" });
    const hit = sv("rect", { x: L, y: T, width: W - L - R, height: H - T - B, fill: "transparent" });
    svg.append(cross, hit);
    hit.addEventListener("pointermove", (e) => {
      const r = svg.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      const x = xs.reduce((a, b) => (Math.abs(X(b) - px) < Math.abs(X(a) - px) ? b : a));
      cross.setAttribute("x1", X(x)); cross.setAttribute("x2", X(x)); cross.setAttribute("visibility", "visible");
      const rows = series.map((s) => { const p = s.points.find((q) => q.x === x); return p ? [s.color, `${fmt(p.y)} ${unit}`, `${s.name}${p.hi > p.lo ? ` (seeds ${fmt(p.lo)}–${fmt(p.hi)})` : ""}`] : null; }).filter(Boolean);
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

  function renderScenario(sc) {
    const out = [el("h2", { text: `Scenario: ${sc.name}` })];
    const vs = sc.variants;
    const color = (i) => SLOTS[i % SLOTS.length];
    const unit = mode === "br" ? "B brotli" : "B raw";

    // 1. Size against N, per variant: total, JS, HTML.
    const yMax = Math.max(...vs.flatMap((v) => v.records.map(M.total)));
    const multiples = el("div", { class: "grid2" }, vs.map((v) => {
      const series = [["total", M.total, SLOTS[0]], ["JavaScript", M.js, SLOTS[1]], ["HTML", M.html, SLOTS[2]]]
        .map(([name, get, c], i) => ({ name, color: c, points: bySize(v.records, get), endLabel: i === 0 }));
      return el("div", { class: "card" }, el("h3", { text: v.name }), el("div", { class: "note", text: `${v.label}${v.track === "prototype" ? " · prototype" : ""}` }),
        lineChart({ series, yMax, unit }));
    }));
    out.push(card(`Size against N (${mode === "br" ? "compressed" : "raw"})`,
      "Median of the seeds per size, with the spread of the seeds as a pale bar. JavaScript excludes the contract adapter; total = HTML + JavaScript, each compressed on its own.",
      [legend([["total", SLOTS[0]], ["JavaScript", SLOTS[1]], ["HTML", SLOTS[2]]]), multiples,
        details("Table", table(["variant", "N", "seeds", "total (median)", "JS (median)", "HTML (median)", "total min–max"],
          vs.flatMap((v) => bySize(v.records, M.total).map((p) => {
            const js = bySize(v.records, M.js).find((q) => q.x === p.x), html = bySize(v.records, M.html).find((q) => q.x === p.x);
            return [v.name, p.x, p.n, fmt(p.y), fmt(js.y), fmt(html.y), `${fmt(p.lo)}–${fmt(p.hi)}`];
          }))))], vs));

    // 2. Fitted baseline and slope.
    const metricKey = mode === "br" ? "total.br" : "total.raw";
    const curves = vs.flatMap((v, i) => {
      const c = [];
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
      for (const which of ["all", "steady"]) {
        const f = v.fit[which];
        if (!f) continue;
        const pick = (k) => f[`${k}.${mode}`];
        const row = [v.name, which === "all" ? "all" : `N ≥ ${f.from}`];
        for (const k of ["total", "js", "html", "runtime", "app"]) { const g = pick(k); row.push(fmt(g.baseline), g.slope.toFixed(1)); }
        row.push(pick("total").r2.toFixed(3));
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
    return out;
  }

  function render() {
    hideTip();
    const total = DATA.scenarios.reduce((a, s) => a + s.variants.length, 0);
    app.replaceChildren(
      el("h1", { text: "How many bytes does a reactive UI ship?" }),
      el("p", { class: "lead", text: `Everything the browser downloads, HTML + JavaScript, against the size of the app. ${DATA.scenarios.length} scenario(s), ${total} framework variant(s); the latest run per variant.` }),
      el("div", { class: "controls" },
        el("label", {}, el("input", { type: "radio", name: "mode", value: "br", ...(mode === "br" ? { checked: "" } : {}), onchange: () => { mode = "br"; render(); } }), "compressed (brotli 11)"),
        el("label", {}, el("input", { type: "radio", name: "mode", value: "raw", ...(mode === "raw" ? { checked: "" } : {}), onchange: () => { mode = "raw"; render(); } }), "raw")),
      ...DATA.scenarios.flatMap(renderScenario));
  }
  render();
})();
