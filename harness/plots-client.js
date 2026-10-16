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
  const views = () => [...DATA.scenarios.map((sc) => sc.name), ...(DATA.scenarios.length > 1 ? ["compare"] : [])];
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

  // ---- CPU time per event: ./rr bench's script time of one event, against N.
  let cpuEvent = "";   // "" = the median of the local events
  function cpuCard(sc) {
    const c = sc.cpu;
    if (!c) return card("CPU time per event against N", null, el("p", { class: "note", text: "No CPU results for this scenario yet. Run ./rr bench " + sc.name + " all: it times one event (and the startup) from Chrome traces at several sizes, and this chart appears here." }), sc.variants);
    const { run, summary } = c;
    const names = Object.keys(run.variants).sort((a, b) => NAMES.indexOf(a) - NAMES.indexOf(b));
    const label = (n) => n + (run.variants[n].track === "prototype" ? " (prototype)" : "");
    const halves = [...new Map(summary.events.map((e) => [e.half, e.scope])).entries()];
    const ev = (n, size, half) => summary.events.find((e) => e.variant === n && e.size === size && e.half === half);
    const sizesOf = (n) => [...new Set(summary.events.filter((e) => e.variant === n).map((e) => e.size))].sort((a, b) => a - b);
    const point = (n, size) => {
      if (cpuEvent) {
        const e = ev(n, size, cpuEvent);
        return e ? { x: size, y: e.script.median, lo: e.script.p25, hi: e.script.p75 } : null;
      }
      const es = summary.events.filter((e) => e.variant === n && e.size === size && e.scope === "local");
      return es.length ? { x: size, y: median(es.map((e) => e.script.median)), lo: median(es.map((e) => e.script.p25)), hi: median(es.map((e) => e.script.p75)) } : null;
    };
    const us = (t) => (t >= 100 ? fmt(t) : t >= 10 ? t.toFixed(0) : t.toFixed(1));
    const series = names.map((n) => ({ name: label(n), color: colorOfName(n), points: sizesOf(n).map((s) => point(n, s)).filter(Boolean), endLabel: true })).filter((s) => s.points.length);
    const chart = el("div", { class: "chart" });
    chart.append(lineChart({ series, unit: "µs", width: 1060, height: 380, yLog: true, yFmt: us, spread: "IQR" }));
    const select = el("select", { onchange: (e) => { cpuEvent = e.target.value; render(); } },
      el("option", { value: "", text: "median of the local events" }),
      ...halves.map(([h, scope]) => el("option", { value: h, text: h + (scope === "global" ? " (global by nature)" : ""), ...(cpuEvent === h ? { selected: "" } : {}) })));
    if (!cpuEvent) select.firstChild.selected = true;

    // Growth, next to the call counts' growth from ./rr work over the same sizes where it has them.
    const w = sc.work;
    const callsRatio = (n, lo, hi) => {
      if (!w || !w.run.variants[n]) return "—";
      const has = (s) => w.run.sizes.includes(s);
      const [a, b] = has(lo) && has(hi) ? [lo, hi] : [w.run.sizes[0], w.run.sizes[w.run.sizes.length - 1]];
      const locals = w.run.actions.filter((x) => !x.setup && x.scope === "local").map((x) => x.name);
      const rs = w.run.seeds.flatMap((seed) => locals.map((act) => {
        const at = (size) => w.records.find((r) => r.variant === n && r.seed === seed && r.size === size && r.action === act)?.calls;
        return at(b) / at(a);
      })).filter((x) => Number.isFinite(x));
      return rs.length ? `${median(rs).toFixed(2)}× (N=${a}→${b})` : "—";
    };
    const growthRows = names.filter((n) => summary.growth[n]).map((n) => {
      const g = summary.growth[n];
      return [label(n), `${g.lo}→${g.hi}`, `${us(g.medianLo)} → ${us(g.medianHi)}`, g.medianRatio.toFixed(2) + "×", `${g.maxRatio.toFixed(2)}× (${g.worst})`, callsRatio(n, g.lo, g.hi)];
    });

    // Startup.
    const startSeries = names.map((n) => ({ name: label(n), color: colorOfName(n), endLabel: true,
      points: summary.startup.filter((s) => s.variant === n).sort((a, b) => a.size - b.size).map((s) => ({ x: s.size, y: s.total.median, lo: s.total.p25, hi: s.total.p75 })) })).filter((s) => s.points.length);
    const startChart = el("div", { class: "chart" });
    startChart.append(lineChart({ series: startSeries, unit: "ms", width: 1060, height: 300, yFmt: (t) => t.toFixed(t >= 10 ? 0 : 1), spread: "IQR" }));

    const m = run.machine, v = run.versions, meth = run.method;
    const fwv = Object.entries(run.variants).map(([n, x]) => `${n}: ${Object.entries(x.versions || {}).map(([k, y]) => `${k} ${y}`).join(", ")}`);
    const rowsAll = summary.events.slice().sort((a, b) => NAMES.indexOf(a.variant) - NAMES.indexOf(b.variant) || a.size - b.size)
      .filter((e) => !cpuEvent || e.half === cpuEvent)
      .map((e) => [e.variant, e.size, e.half + (e.scope === "global" ? " *" : ""), us(e.script.median), `${us(e.script.p25)}–${us(e.script.p75)}`, `${us(e.script.ci[0])}–${us(e.script.ci[1])}`, e.script.n, e.total.median.toFixed(2)]);
    const out = [el("h3", { text: "CPU time per event against N" }),
      el("p", { class: "note", text: "Script time (µs) of one event, from a Chrome trace: from the input event to the first commit after the app's work, the JavaScript inside (js-framework-benchmark's rule, no CPU throttling). Each event is ./rr work's action as real input through the DevTools protocol, repeated from the same state many times on one page; median over the reps, seeds and sessions, with the interquartile range as a pale bar; both axes logarithmic. Flat means the cost is local to what changed." + (run.quick ? " This is a --quick run: one size, one seed, few reps; for development, not for conclusions." : "") }),
      el("div", { class: "controls" }, el("label", {}, "event ", select)),
      hoverLegend(series.map((s) => [s.name, s.color]), chart), chart,
      details("Table", table(["variant", "N", "event", "script µs (median)", "IQR", "95% CI of the median", "n", "total ms (median)"], rowsAll)),
      el("h4", { text: "Growth of a local event's script time, smallest to largest size" }),
      growthRows.length ? table(["variant", "N", "median script µs", "median ratio", "worst ratio (event)", "calls ratio (./rr work)"], growthRows)
        : el("p", { class: "note", text: "Needs at least two sizes." }),
      el("p", { class: "note", text: "ratio = the median script time at the largest size ÷ at the smallest, per local event; the median and the worst over the events. The calls ratio is ./rr work's count of JavaScript calls for the same actions over the same sizes: time and work should grow together." }),
      el("h4", { text: "Startup: navigation to the first paint after mount" }),
      hoverLegend(startSeries.map((s) => [s.name, s.color]), startChart), startChart,
      details("Table", table(["variant", "N", "total ms (median)", "IQR", "script ms (median)", "compile ms", "JS heap after mount (MB)", "loads"],
        summary.startup.slice().sort((a, b) => NAMES.indexOf(a.variant) - NAMES.indexOf(b.variant) || a.size - b.size)
          .map((s) => [s.variant, s.size, s.total.median.toFixed(1), `${s.total.p25.toFixed(1)}–${s.total.p75.toFixed(1)}`, s.script.median.toFixed(2), s.compileMs.toFixed(2), (s.heapBytes / 1e6).toFixed(2), s.total.n])))];
    if (summary.aa) {
      out.push(el("h4", { text: "A/A check: one app under two names" }),
        table(["app", "twin", "cells", "intervals overlap", "median |difference|", "max |difference|"],
          Object.entries(summary.aa).map(([n, x]) => [n, x.twin, x.cells, x.overlapping, (x.medianAbsDiff * 100).toFixed(1) + "%", (x.maxAbsDiff * 100).toFixed(1) + "%"])));
    }
    out.push(el("div", { class: "source" },
      el("div", { text: `Results: results/cpu/${c.dir} · commit ${v.git ? v.git.commit.slice(0, 7) + (v.git.dirty ? " (dirty)" : "") : "?"} · sizes ${run.sizes.join(",")} × seeds ${run.seeds.join(",")} · ${run.sessions} session(s) · reps ${meth.warmup} warm-up + ${meth.minReps}–${meth.maxReps} (stop at ±${meth.tol * 100}%) · startup ${meth.loads} loads${run.quick ? " · --quick" : ""}` }),
      el("div", { text: `${m.hostname}: ${m.cpu}, ${m.threads} threads, governor ${m.governor ?? "?"}, no_turbo ${m.noTurbo ?? "—"}, boost ${m.boost ?? "—"}, taskset ${m.taskset ?? "none"} · ${m.kernel} · ${v.chrome} (${v.chromeBin}) · Node ${v.node}` }),
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

  function render() {
    hideTip();
    const total = DATA.scenarios.reduce((a, s) => a + s.variants.length, 0);
    if (!views().includes(view)) view = DATA.scenarios[0].name;
    const tabs = el("nav", { class: "tabs" }, views().map((v) => el("a", {
      href: "#" + encodeURIComponent(v), class: v === view ? "on" : "",
      onclick: (e) => { e.preventDefault(); view = v; history.replaceState(null, "", "#" + encodeURIComponent(v)); render(); },
    }, v === "compare" ? "Compare scenarios" : v)));
    app.replaceChildren(
      el("h1", { text: "How many bytes does a reactive UI ship?" }),
      el("p", { class: "lead", text: `Everything the browser downloads, HTML + JavaScript, against the size of the app. ${DATA.scenarios.length} scenario(s), ${NAMES.length} framework variant(s); the latest run per variant and scenario.` }),
      el("div", { class: "controls" },
        el("label", {}, el("input", { type: "radio", name: "mode", value: "br", ...(mode === "br" ? { checked: "" } : {}), onchange: () => { mode = "br"; render(); } }), "compressed (brotli 11)"),
        el("label", {}, el("input", { type: "radio", name: "mode", value: "raw", ...(mode === "raw" ? { checked: "" } : {}), onchange: () => { mode = "raw"; render(); } }), "raw")),
      tabs,
      ...(view === "compare" ? renderCompare() : renderScenario(DATA.scenarios.find((sc) => sc.name === view))));
  }
  window.addEventListener("hashchange", () => { view = decodeURIComponent(location.hash.slice(1)); render(); });
  render();
})();
