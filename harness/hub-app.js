// The ./rr hub child: the actual server behind the hub's stable address. ./rr hub restarts it
// whenever harness/, scenarios/ or frameworks/ change, so it always runs current code.
//
//   /                                  index: plots, scenarios, frameworks, sizes
//   /plots/                            the plots page, rebuilt from results/ on every request
//   /apps/<scenario>/n<N>-s<S>/        every framework side by side (one spec)
//   /apps/<scenario>/n<N>-s<S>/<fw>/   one framework's production build, with the panel
//
// Apps are built on first request, and rebuilt when their generator, framework or options
// changed since (the same inputs hash ./rr measure uses); otherwise the build on disk is reused.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { listScenarios, loadScenario, loadEmitters, appDir, variantName, ROOT } from "./selection.js";
import { buildApp } from "./generate.js";
import { codeHash } from "./measure.js";
import { serveHandler, send, TYPES } from "./serve.js";
import { pageData, page } from "./plots.js";

const port = Number(process.argv[2]);
const sets = new Map(); // "<scenario>/<nN-sS>" → Promise<{ handler, variants }>

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// Build (or reuse) one app; returns its dist directory.
async function ensureBuilt(scenario, emitter, options, opts) {
  const dir = appDir(scenario, options, emitter, opts);
  const key = crypto.createHash("sha256").update(codeHash(scenario, emitter)).update(JSON.stringify({ options, opts })).digest("hex");
  const keyFile = path.join(dir, ".rr-hub-key");
  if (fs.existsSync(path.join(dir, "dist", "index.html")) && fs.existsSync(keyFile) && fs.readFileSync(keyFile, "utf8") === key) {
    return path.join(dir, "dist");
  }
  const t = performance.now();
  const out = await buildApp(scenario, emitter, options, opts);
  fs.writeFileSync(keyFile, key);
  console.log(`hub: built ${path.relative(ROOT, out.built.outDir)} (${((performance.now() - t) / 1000).toFixed(1)}s)`);
  return out.built.outDir;
}

async function appSet(name, ns) {
  const id = `${name}/${ns}`;
  if (!sets.has(id)) {
    const p = (async () => {
      const m = ns.match(/^n(\d+)-s(\d+)$/);
      if (!m) throw new Error(`bad size/seed "${ns}" (expected n16-s1)`);
      const scenario = await loadScenario(name);
      const emitters = await loadEmitters(scenario.name, "all");
      const options = scenario.mod.normalizeOptions({ size: Number(m[1]), seed: Number(m[2]) });
      const spec = scenario.mod.generate(options);
      const apps = new Map();
      for (const emitter of emitters) {
        const opts = Object.fromEntries(Object.entries(emitter.mod.params || {}).map(([k, p]) => [k, p.default]));
        try {
          apps.set(variantName(emitter, opts), await ensureBuilt(scenario, emitter, spec.options, opts));
        } catch (err) {
          console.error(`hub: ${emitter.name} failed to build: ${err.message}`);
        }
      }
      return { handler: serveHandler(scenario, spec, apps, `/apps/${id}/`), variants: [...apps.keys()] };
    })();
    sets.set(id, p);
    p.catch(() => sets.delete(id));
  }
  return sets.get(id);
}

async function index() {
  const rows = [];
  for (const name of listScenarios()) {
    const emitters = await loadEmitters(name, "all");
    const sizes = [1, 4, 16, 64, 256];
    rows.push(`<section><h2>${esc(name)}</h2>
<p>Side by side: ${sizes.map((n) => `<a href="/apps/${name}/n${n}-s1/">N=${n}</a>`).join(" · ")}</p>
<table><tr><th>framework</th>${sizes.map((n) => `<th>N=${n}</th>`).join("")}</tr>
${emitters.map((e) => `<tr><td>${esc(e.name)} <small>${esc(e.framework.label)}${e.framework.track === "prototype" ? " · prototype" : ""}</small></td>${sizes.map((n) => `<td><a href="/apps/${name}/n${n}-s1/${e.name}/">open</a></td>`).join("")}</tr>`).join("\n")}
</table>
<form onsubmit="location.href='/apps/${name}/n'+this.n.value+'-s'+this.s.value+'/';return false">Other size: N <input name="n" value="16" size="4"> seed <input name="s" value="1" size="2"> <button>open</button></form>
</section>`);
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Reactivity research hub</title>
<style>
  :root { color-scheme: light dark; --bg: #fcfcfb; --fg: #0b0b0b; --muted: #6b6a66; --line: #e3e2de; }
  @media (prefers-color-scheme: dark) { :root { --bg: #1a1a19; --fg: #f4f4f2; --muted: #a3a29b; --line: #33332f; } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.5 system-ui, sans-serif; }
  main { max-width: 900px; margin: 0 auto; padding: 20px 16px; }
  a { color: inherit; } small { color: var(--muted); }
  table { border-collapse: collapse; margin: 6px 0 10px; } td, th { padding: 3px 10px 3px 0; text-align: left; border-bottom: 1px solid var(--line); }
  .big { font-size: 17px; }
</style></head><body><main>
<h1>Reactivity research</h1>
<p class="big"><a href="/plots/">Plots</a>: every measurement in results/, rebuilt on each load.</p>
<p><small>Apps build on first open (a few seconds), and rebuild when their generator or framework changed.</small></p>
${rows.join("\n")}
</main></body></html>`;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    const parts = decodeURIComponent(url.pathname).split("/").filter(Boolean);
    if (parts.length === 0) return send(res, 200, await index(), TYPES[".html"]);
    if (parts[0] === "plots") {
      if (!url.pathname.endsWith("/")) { res.writeHead(302, { location: "/plots/" }); return res.end(); }
      const data = pageData(null);
      return send(res, 200, data.scenarios.length || data.parse ? page(data) : "no results yet: run ./rr report", TYPES[".html"]);
    }
    if (parts[0] === "apps" && parts.length >= 3) {
      const [, name, ns] = parts;
      if (parts.length === 3 && !url.pathname.endsWith("/")) { res.writeHead(302, { location: `/apps/${name}/${ns}/` }); return res.end(); }
      const set = await appSet(name, ns);
      req.url = "/" + parts.slice(3).join("/") + (url.pathname.endsWith("/") && parts.length > 3 ? "/" : "") + url.search;
      return set.handler(req, res);
    }
    send(res, 404, "not found");
  } catch (err) {
    send(res, 500, String(err.stack || err));
  }
});

server.listen(port, "127.0.0.1", () => process.send?.("ready"));
