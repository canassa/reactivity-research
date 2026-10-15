// Elm 0.19.3, as it ships: `elm make --optimize`, then the two-pass uglify-js minification the
// Elm guide recommends (https://guide.elm-lang.org/optimization/asset_size.html): a compress
// pass with `pure_funcs` over Elm's F2…F9/A2…A9 helpers, then a mangle pass. Compiler, minifier
// and Elm packages are pinned (package.json + package-lock.json, template/elm.json); the
// packages are pre-fetched into ELM_HOME by install.js, so builds run offline. Every Elm emitter
// shares this module.
//
// Byte attribution. Elm writes no source maps, so the build makes one for the compiler's
// output before minifying. Elm emits one flat list of top-level declarations inside a wrapper
// function, each named after where it comes from:
//   $author$project$Widget$Counter$view   the app's own modules     → src/Widget/Counter.elm
//   $elm$core$List$map                    Elm package code          → elm-packages/elm/core/List.elm
//   _VirtualDom_render, F2, A2, …         the JavaScript kernel     → elm-kernel/VirtualDom.js, …
// The adapter is appended after the Elm code (→ src/adapter.js). The build parses that file
// with uglify-js's own parser and maps every line of every top-level statement to the source
// its name points to; uglify-js composes this input map through both passes (its
// `sourceMap.content` option), so each byte of the minified bundle keeps its owner.
// `classify` then puts src/*.elm in "app", src/adapter.js in "adapter" and the rest (packages,
// kernel, the wrapper) in "runtime".

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

export const name = "elm";
export const label = "Elm 0.19.3";
export const track = "framework";

// Where install.js puts the pinned Elm packages. Under node_modules: installed, not committed,
// rebuilt by `npm ci`, and (like node_modules) not part of the measurements' inputs hash, which
// covers the pinned versions through template/elm.json and the lockfile instead.
export const ELM_HOME = path.join(HERE, "node_modules", ".elm-home");

export function elmBinary() {
  return require.resolve(`@elm_binaries/${process.platform}_${process.arch}/elm`);
}

// The guide's settings, as its uglifyjs command lines pass them.
const PURE_FUNCS = ["F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9"];
const COMPRESS = { pure_funcs: PURE_FUNCS, pure_getters: true, keep_fargs: false, unsafe_comps: true, unsafe: true };

// Files every Elm app gets unchanged: elm.json, the HTML shell and the adapter.
export function templateFiles({ title }) {
  const read = (f) => fs.readFileSync(path.join(HERE, "template", f), "utf8");
  return {
    "elm.json": read("elm.json"),
    "index.html": read("index.html").replace("%TITLE%", title),
    "src/adapter.js": read("adapter.js"),
  };
}

// Which bucket a source-map source belongs to.
export function classify(source) {
  if (source === "src/adapter.js") return "adapter";
  if (/^src\/.*\.elm$/.test(source)) return "app";
  return "runtime";
}

export async function prepare() {
  if (!fs.existsSync(path.join(ELM_HOME, "0.19.3", "packages", "registry.dat"))) {
    throw new Error(`Elm packages are not installed: run npm ci in ${path.relative(process.cwd(), HERE)} (see its README.md)`);
  }
}

export async function build(dir) {
  const outDir = path.join(dir, "dist");
  const work = path.join(dir, "build");
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(work, { recursive: true });

  // 1. The official production compile.
  const elmJs = path.join(work, "elm.js");
  try {
    execFileSync(elmBinary(), ["make", "src/Main.elm", "--optimize", `--output=${elmJs}`], {
      cwd: dir, env: { ...process.env, ELM_HOME }, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8",
    });
  } catch (err) {
    throw new Error(`elm make failed in ${dir}:\n${err.stdout || ""}${err.stderr || ""}`);
  }

  // 2. Elm's output followed by the adapter, with the attribution map described above.
  const elm = fs.readFileSync(elmJs, "utf8");
  const adapter = fs.readFileSync(path.join(dir, "src", "adapter.js"), "utf8");
  const code = elm.replace(/\n?$/, "\n") + adapter;
  const inputMap = attributionMap(code, elm.split("\n").length);
  fs.writeFileSync(path.join(work, "bundle.js"), code);
  fs.writeFileSync(path.join(work, "bundle.js.map"), JSON.stringify(inputMap));

  // 3. The guide's two passes: compress (no mangling), then mangle (no compression).
  const UglifyJS = require("uglify-js");
  const pass = (input, map, options) => {
    const r = UglifyJS.minify({ "main.js": input }, { ...options, sourceMap: { content: map } });
    if (r.error) throw r.error;
    return r;
  };
  const compressed = pass(code, inputMap, { compress: COMPRESS, mangle: false });
  const mangled = pass(compressed.code, compressed.map, { compress: false, mangle: true });

  const main = path.join(outDir, "main.js");
  fs.writeFileSync(main, mangled.code);
  fs.writeFileSync(main + ".map", mangled.map);
  fs.copyFileSync(path.join(dir, "index.html"), path.join(outDir, "index.html"));
  return { outDir, html: path.join(outDir, "index.html"), scripts: [{ file: main, map: main + ".map" }] };
}

// The source a top-level name of Elm's output comes from.
function sourceOf(name) {
  if (!name) return "elm-kernel/wrapper.js";
  if (name.startsWith("$author$project$")) {
    const parts = name.slice("$author$project$".length).split("$");
    return `src/${parts.slice(0, -1).join("/")}.elm`;
  }
  if (name.startsWith("$")) {
    const [author, pkg, ...rest] = name.slice(1).split("$");
    return `elm-packages/${author}/${pkg.replace(/_/g, "-")}/${rest.slice(0, -1).join("/")}.elm`;
  }
  const kernel = /^_([A-Z][A-Za-z]*)_/.exec(name);
  if (kernel) return `elm-kernel/${kernel[1]}.js`;
  return "elm-kernel/Utils.js"; // F, F2…F9, A2…A9
}

// A source map (v3) for `code`: lines up to `elmLines` are Elm's output, attributed per
// top-level statement of its wrapper function; the rest is the adapter. Every line gets a
// segment at column 0, plus one where each statement starts, mapping to the same line and
// column in its (virtual) source: uglify-js resolves each token through the nearest segment at
// or before it on its line.
function attributionMap(code, elmLines) {
  const UglifyJS = require("uglify-js");
  const ast = UglifyJS.parse(code);
  const body = wrapperBody(ast);
  const lineStarts = [0];
  for (let i = 0; i < code.length; i++) if (code.charCodeAt(i) === 10) lineStarts.push(i + 1);
  const lineOf = (pos) => {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  // segments[line] = [[column, source], …]
  const segments = lineStarts.map(() => []);
  const wrapper = sourceOf(null);
  for (let l = 0; l < elmLines; l++) segments[l].push([0, wrapper]);
  for (const stmt of body) {
    const src = sourceOf(declaredName(stmt));
    const first = lineOf(stmt.start.pos);
    const last = lineOf(stmt.end.endpos - 1);
    const col = stmt.start.pos - lineStarts[first];
    const segs = segments[first];
    if (segs.length && segs[segs.length - 1][0] === col) segs[segs.length - 1][1] = src;
    else segs.push([col, src]);
    for (let l = first + 1; l <= last; l++) segments[l] = [[0, src]];
  }
  for (let l = elmLines; l < lineStarts.length; l++) segments[l] = [[0, "src/adapter.js"]];

  const sources = [];
  const index = new Map();
  let prevSrc = 0, prevLine = 0, prevCol = 0;
  const lines = segments.map((segs, line) => {
    let prevGen = 0;
    return segs.map(([col, src]) => {
      if (!index.has(src)) { index.set(src, sources.length); sources.push(src); }
      const s = index.get(src);
      const out = vlq(col - prevGen) + vlq(s - prevSrc) + vlq(line - prevLine) + vlq(col - prevCol);
      prevGen = col; prevSrc = s; prevLine = line; prevCol = col;
      return out;
    }).join(",");
  });
  return { version: 3, sources, names: [], mappings: lines.join(";") };
}

// The statements of Elm's wrapper, `(function(scope){ … }(this));`.
function wrapperBody(ast) {
  const first = ast.body[0];
  const call = first && first.body;
  const fn = call && call.expression;
  if (!fn || !Array.isArray(fn.body)) throw new Error("unexpected shape of elm make's output");
  return fn.body;
}

function declaredName(stmt) {
  if (stmt.TYPE === "Defun") return stmt.name.name;
  if (stmt.TYPE === "Var" || stmt.TYPE === "Let" || stmt.TYPE === "Const") return stmt.definitions[0].name.name;
  return null;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
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

// The exact versions of everything that shapes the output.
export function versions() {
  const lock = JSON.parse(fs.readFileSync(path.join(HERE, "package-lock.json"), "utf8"));
  const v = (p) => lock.packages[`node_modules/${p}`]?.version ?? null;
  const elmJson = JSON.parse(fs.readFileSync(path.join(HERE, "template", "elm.json"), "utf8"));
  const packages = { ...elmJson.dependencies.direct, ...elmJson.dependencies.indirect };
  return {
    "elm (compiler, npm installer)": v("elm"),
    [`@elm_binaries/${process.platform}_${process.arch}`]: v(`@elm_binaries/${process.platform}_${process.arch}`),
    "uglify-js": v("uglify-js"),
    ...Object.fromEntries(Object.entries(packages).sort().map(([k, ver]) => [k, ver])),
  };
}
