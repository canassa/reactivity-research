// tea-dirtybits, a prototype strategy (no framework implements it): compiled TEA that keeps
// messages and reducers, with compile-time dirty bits and a static patch per component. See
// README.md. Built with plain Vite (no framework plugin), pinned in package.json and
// package-lock.json next to this file; the runtime ships as source files in template/.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PINNED = JSON.parse(fs.readFileSync(path.join(HERE, "package.json"), "utf8"));

export const name = "tea-dirtybits";
export const label = "TEA + dirty bits (prototype)";
export const track = "prototype";

// Files every app gets unchanged: the HTML shell, the build config, the adapter and the runtime.
export function templateFiles({ name, title }) {
  const read = (f) => fs.readFileSync(path.join(HERE, "template", f), "utf8");
  return {
    "package.json": read("package.json").replace("%NAME%", name)
      .replace(/%([\w@/-]+)%/g, (_, dep) => PINNED.dependencies[dep]),
    "index.html": read("index.html").replace("%TITLE%", title),
    "vite.config.js": read("vite.config.js"),
    "src/adapter.js": read("adapter.js"),
    "src/runtime.js": read("runtime.js"),
  };
}

// A template file only some scenarios include (big-component's `words.js`, big-table's `grid.js`).
export function templateFile(file) {
  return fs.readFileSync(path.join(HERE, "template", file), "utf8");
}

// Which bucket a source-map source belongs to: the shared runtime counts as runtime, like a
// framework's library code.
export function classify(source) {
  if (source.includes("/node_modules/") || source.startsWith("\0") || source.includes("vite/")) return "runtime";
  if (/(^|\/)src\/(runtime|words|grid)\.js$/.test(source)) return "runtime";
  if (/(^|\/)src\/adapter\.js$/.test(source)) return "adapter";
  return "app";
}

// Make the pinned node_modules visible to the generated app.
export async function prepare(dir) {
  const link = path.join(dir, "node_modules");
  fs.rmSync(link, { force: true, recursive: true });
  fs.symlinkSync(path.relative(dir, path.join(HERE, "node_modules")), link);
}

export async function build(dir) {
  const { build: viteBuild } = await import(import.meta.resolve("vite"));
  const outDir = path.join(dir, "dist");
  fs.rmSync(outDir, { recursive: true, force: true });
  await viteBuild({ root: dir, configFile: path.join(dir, "vite.config.js"), logLevel: "warn" });
  const assets = path.join(outDir, "assets");
  const scripts = fs.readdirSync(assets).filter((f) => f.endsWith(".js")).sort()
    .map((f) => ({ file: path.join(assets, f), map: path.join(assets, f + ".map") }));
  const other = fs.readdirSync(assets).filter((f) => !f.endsWith(".js") && !f.endsWith(".map"));
  if (other.length) throw new Error(`unexpected build output: ${other.join(", ")}`);
  return { outDir, html: path.join(outDir, "index.html"), scripts };
}

// A static template's markup with the closing tags at its very end left out, as Solid's
// compiler writes its templates: the HTML parser closes every element still open at the end of
// the input, so the parsed nodes are the same. Before that, the end tags HTML makes optional
// are left out too, as an HTML minifier's optional-tag pass does: `</option>` before another
// option or the end of its select, `</li>` before another item or the end of its list, and
// `</p>` before an element that closes a paragraph or the end of its parent.
const CLOSES_P = "address|article|aside|blockquote|details|dialog|div|dl|fieldset|figcaption|figure|footer|form|h[1-6]|header|hgroup|hr|main|menu|nav|ol|p|pre|search|section|table|ul";
const OPTIONAL_END = [
  /<\/option>(?=<option[\s>]|<\/select>)/g,
  /<\/li>(?=<li[\s>]|<\/[ou]l>)/g,
  new RegExp(`</p>(?=<(?:${CLOSES_P})[\\s>]|</(?!(?:a|audio|del|ins|map|noscript|video)>)[a-z][a-z0-9]*>)`, "g"),
];
export function trimTemplate(markup) {
  for (const re of OPTIONAL_END) markup = markup.replace(re, "");
  return markup.replace(/(<\/[a-z][a-z0-9]*>)+$/, "");
}

// The exact versions of everything that shapes the output, from the lockfile.
export function versions() {
  const lock = JSON.parse(fs.readFileSync(path.join(HERE, "package-lock.json"), "utf8"));
  const v = (p) => lock.packages[`node_modules/${p}`]?.version ?? null;
  return {
    "tea-dirtybits runtime": "prototype (frameworks/tea-dirtybits/template)",
    vite: v("vite"),
    "rolldown (bundler and Oxc minifier)": v("rolldown"),
  };
}
