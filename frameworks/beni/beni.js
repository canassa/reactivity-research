// beni, as it ships: what every beni setup shares (each links this file into its own directory,
// so a change here changes every setup's measurement hash). Today there is one, beni-inline;
// beni-tea and beni-direct were measured here until 2026-10-17 and dropped when the direct
// platform's rewrite began (their results stay in results/). See README.md.
//
// The compiler is a pinned commit of beni (an unreleased compiler, written in Zig), built by
// install.sh into compiler/<commit>/ (gitignored). An app is built with beni's own production
// build, `beni build --release --source-maps`: one scope-hoisted, minified ES module
// (`_main.mjs`) and its source map. beni minifies its own output (`--release`: dead bindings out,
// short names, compact printing; hand-written JavaScript compacted by its Minify.zig), so no
// other minifier runs. The page is beni's own `index.html` (beni.json's "html", with `{{entry}}`
// where the program's script goes).
//
// Byte attribution, from beni's release source map. Its `sources` are the beni modules the file
// holds: the app's (`../src/…`), beni's core and platforms (`beni:///core/…`,
// `beni:///platforms/…`) and the project's platform layer (`../platform/…`, see template/).
// Bytes no beni line wrote (hand-written JavaScript siblings and the link step's glue, which beni
// leaves unmapped with a one-field segment) would be counted with the source that follows them
// by the harness, so the build points them at a source of their own, `beni:///(unmapped)`.
// `classify` puts src/ in "app", the adapter in "adapter" and everything else in "runtime".

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

export const COMMIT = "ca8b52fb0d3ac96b30a75eab687879524b81c2b1";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const COMPILER = path.join(HERE, "compiler", COMMIT.slice(0, 12), "zig-out", "bin", "beni");
const UNMAPPED = "beni:///(unmapped)";

// Files every beni app gets unchanged, for one of beni's browser platforms: the project file,
// the page, and the project's platform layer over the shipped platform (template/Push.beni).
// The contract adapter is the setup's own (frameworks/<setup>/template/adapter.js).
export function templateFiles(platform, { name, title }) {
  const read = (f) => fs.readFileSync(path.join(HERE, "template", f), "utf8");
  const project = { name, html: "index.html", build: { platform: "./platform", paths: ["src"], out: "dist", base: "./" } };
  const layer = {
    platform: true,
    name: "rr",
    platforms: [platform],
    reexports: ["Browser", "Cmd", "Html", "Sub", "Tea"],
  };
  return {
    "beni.json": JSON.stringify(project, null, 2) + "\n",
    "index.html": read("index.html").replace("%TITLE%", title),
    "platform/beni.json": JSON.stringify(layer, null, 2) + "\n",
    "platform/Push.beni": read("Push.beni"),
  };
}

// Which bucket a source-map source belongs to.
export function classify(source) {
  if (source === "adapter.js") return "adapter";
  if (/^(\.\.\/)*src\//.test(source)) return "app";
  return "runtime";
}

export async function prepare() {
  if (!fs.existsSync(COMPILER)) {
    throw new Error(`the pinned beni compiler is not built: run frameworks/beni/install.sh (see frameworks/beni/README.md)`);
  }
}

export async function build(dir) {
  const outDir = path.join(dir, "dist");
  fs.rmSync(outDir, { recursive: true, force: true });
  try {
    // One worker thread: the harness already builds many apps in parallel, and beni's output is
    // identical for every --jobs. No cache, so every build starts from the sources alone.
    execFileSync(COMPILER, ["build", "--release", "--source-maps", "--no-cache", "--jobs=1"], {
      cwd: dir, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    throw new Error(`beni build failed in ${dir}:\n${err.stdout || ""}${err.stderr || ""}`);
  }

  // The bundle without its `//# sourceMappingURL` comment: the maps are for attribution only,
  // as the other setups' hidden source maps are. It is served as `_main.js` (the page names it
  // so): the harness's static server gives `.js` a JavaScript type and `.mjs` none, and a browser
  // refuses a module served without one. The bytes are beni's.
  const built = path.join(outDir, "_main.mjs");
  const main = path.join(outDir, "_main.js");
  const code = fs.readFileSync(built, "utf8").replace(/\n\/\/# sourceMappingURL=\S+\n?$/, "\n");
  fs.writeFileSync(main, code);
  const map = JSON.parse(fs.readFileSync(built + ".map", "utf8"));
  fs.writeFileSync(main + ".map", JSON.stringify({ ...ownUnmapped(map), file: "_main.js" }));
  fs.rmSync(built);
  fs.rmSync(built + ".map");
  const page = path.join(outDir, "index.html");
  const html = fs.readFileSync(page, "utf8");
  if (!html.includes('data-entry="./_main.mjs"')) throw new Error(`unexpected page from beni build in ${dir}`);
  fs.writeFileSync(page, html.replace('data-entry="./_main.mjs"', 'data-entry="./_main.js"'));

  // The contract adapter, a file of its own next to the page, mapped whole to itself.
  const adapter = fs.readFileSync(path.join(dir, "adapter.js"), "utf8");
  fs.writeFileSync(path.join(outDir, "adapter.js"), adapter);
  fs.writeFileSync(path.join(outDir, "adapter.js.map"), JSON.stringify(wholeFile(adapter, "adapter.js")));

  return {
    outDir,
    html: path.join(outDir, "index.html"),
    scripts: [
      { file: main, map: main + ".map" },
      { file: path.join(outDir, "adapter.js"), map: path.join(outDir, "adapter.js.map") },
    ],
  };
}

// The exact versions of everything that shapes the output.
export function versions() {
  const out = { "beni (commit)": COMMIT };
  if (fs.existsSync(COMPILER)) {
    out["beni version (build id)"] = execFileSync(COMPILER, ["version"], { encoding: "utf8" }).trim();
    out["beni binary sha256"] = crypto.createHash("sha256").update(fs.readFileSync(COMPILER)).digest("hex");
  }
  out["zig, node (beni's flake.lock at that commit)"] = "zig 0.17.0, node 24";
  return out;
}

// ---------------------------------------------------------------------------------------------
// Source maps (v3)

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64I = Object.fromEntries([...B64].map((c, i) => [c, i]));

function decodeVlqs(str) {
  const out = [];
  let value = 0, shift = 0;
  for (const c of str) {
    const d = B64I[c];
    value += (d & 31) << shift;
    if (d & 32) shift += 5;
    else {
      out.push(value & 1 ? -(value >>> 1) : value >>> 1);
      value = 0;
      shift = 0;
    }
  }
  return out;
}

function vlq(n) {
  let v = n < 0 ? (-n << 1) | 1 : n << 1;
  let out = "";
  do {
    let d = v & 31;
    v >>>= 5;
    if (v) d |= 32;
    out += B64[d];
  } while (v);
  return out;
}

// Decode to absolute segments per line: [column] or [column, source, line, col(, name)].
function decodeMappings(mappings) {
  let src = 0, line = 0, col = 0, name = 0;
  return mappings.split(";").map((l) => {
    let gen = 0;
    return l.split(",").filter(Boolean).map((s) => {
      const f = decodeVlqs(s);
      gen += f[0];
      if (f.length === 1) return [gen];
      src += f[1]; line += f[2]; col += f[3];
      if (f.length === 5) { name += f[4]; return [gen, src, line, col, name]; }
      return [gen, src, line, col];
    });
  });
}

function encodeMappings(lines) {
  let src = 0, line = 0, col = 0, name = 0;
  return lines.map((segs) => {
    let gen = 0;
    return segs.map((s) => {
      let out = vlq(s[0] - gen);
      gen = s[0];
      if (s.length > 1) {
        out += vlq(s[1] - src) + vlq(s[2] - line) + vlq(s[3] - col);
        src = s[1]; line = s[2]; col = s[3];
        if (s.length === 5) { out += vlq(s[4] - name); name = s[4]; }
      }
      return out;
    }).join(",");
  }).join(";");
}

// Every unmapped stretch (a one-field segment) mapped to a source of its own.
function ownUnmapped(map) {
  const lines = decodeMappings(map.mappings);
  if (!lines.some((segs) => segs.some((s) => s.length === 1))) return map;
  const sources = [...map.sources, UNMAPPED];
  const k = sources.length - 1;
  const fixed = lines.map((segs) => segs.map((s) => (s.length === 1 ? [s[0], k, 0, 0] : s)));
  const out = { ...map, sources, mappings: encodeMappings(fixed) };
  if (map.sourcesContent) out.sourcesContent = [...map.sourcesContent, null];
  return out;
}

// A map attributing every line of `code` to `source`.
function wholeFile(code, source) {
  const n = code.split("\n").length;
  const lines = Array.from({ length: n }, (_, i) => [[0, 0, i, 0]]);
  return { version: 3, sources: [source], names: [], mappings: encodeMappings(lines) };
}
