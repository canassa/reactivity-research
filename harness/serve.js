// ./rr serve <scenario> <framework|all|a,b> [--size --seed …] [--local] [--port P]
//
// Builds each app (production build), serves it with the panel injected outside its root, and
// exposes everything through a cloudflared quick tunnel. Several frameworks get one page each
// plus a side-by-side page at /.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { selection } from "./cli.js";
import { buildApp } from "./generate.js";
import { variantName, ROOT } from "./selection.js";
import { serveUntilInterrupted } from "./tunnel.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".map": "application/json; charset=utf-8", ".svg": "image/svg+xml",
};

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

function sendFile(res, file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, "not found");
  send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || "application/octet-stream");
}

// The built page with the hooks first in <head> and the panel at the end of <body>.
function injectPanel(html) {
  return html
    .replace(/<head>/i, `<head>\n    <script src="/__rr/hooks.js"></script>`)
    .replace(/<\/body>/i, `  <link rel="stylesheet" href="/__rr/panel.css" />\n    <script type="module" src="/__rr/panel.js"></script>\n  </body>`);
}

function comparePage(scenario, options, variants) {
  const frames = variants.map((v) => `<figure><figcaption><a href="/${v}/">${v}</a></figcaption><iframe src="/${v}/"></iframe></figure>`).join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${scenario} side by side</title>
<style>
  body { margin: 0; font: 13px system-ui, sans-serif; }
  header { padding: 6px 10px; }
  main { display: flex; gap: 6px; height: calc(100vh - 34px); }
  figure { margin: 0; flex: 1; display: flex; flex-direction: column; min-width: 0; }
  iframe { flex: 1; border: 1px solid #ccc; width: 100%; }
</style></head>
<body><header><strong>${scenario}</strong> n=${options.size} seed=${options.seed} · one page per framework, same spec</header>
<main>${frames}</main></body></html>`;
}

export async function serveCommand(rest) {
  const { args, scenario, emitters, scenarioOptions, emitterOptions } = await selection(rest, ["local", "port"]);
  const apps = new Map();
  let spec;
  for (const emitter of emitters) {
    const opts = emitterOptions(emitter);
    const out = await buildApp(scenario, emitter, scenarioOptions, opts);
    spec = out.spec;
    apps.set(variantName(emitter, opts), out.built.outDir);
    console.log(`built ${path.relative(ROOT, out.built.outDir)}`);
  }
  const specJson = JSON.stringify(spec);
  const variants = [...apps.keys()];

  const handler = (req, res) => {
    const url = new URL(req.url, "http://x");
    const parts = decodeURIComponent(url.pathname).split("/").filter(Boolean);
    if (parts.length === 0) {
      if (variants.length === 1) {
        res.writeHead(302, { location: `/${variants[0]}/` });
        return res.end();
      }
      return send(res, 200, comparePage(scenario.name, spec.options, variants), TYPES[".html"]);
    }
    if (parts[0] === "__rr") {
      const name = parts.slice(1).join("/");
      if (name === "spec.js") return sendFile(res, scenario.specFile);
      if (name === "spec.json") return send(res, 200, specJson, TYPES[".json"]);
      if (["hooks.js", "panel.js", "panel.css"].includes(name)) return sendFile(res, path.join(HERE, "serve", name));
      return send(res, 404, "not found");
    }
    const dist = apps.get(parts[0]);
    if (!dist) return send(res, 404, "not found");
    if (parts.length === 1 && !url.pathname.endsWith("/")) {
      res.writeHead(302, { location: `/${parts[0]}/` });
      return res.end();
    }
    const rel = parts.slice(1).join("/") || "index.html";
    const file = path.join(dist, rel);
    if (!file.startsWith(dist + path.sep)) return send(res, 403, "forbidden");
    if (rel === "index.html") return send(res, 200, injectPanel(fs.readFileSync(file, "utf8")), TYPES[".html"]);
    return sendFile(res, file);
  };

  const pages = variants.map((v) => `/${v}/`).join(", ");
  await serveUntilInterrupted(handler, {
    port: args.port ?? 0,
    local: !!args.local,
    what: `serving ${scenario.name} n=${spec.options.size} seed=${spec.options.seed}: ${pages}${variants.length > 1 ? " (side by side at /)" : ""}`,
  });
}
