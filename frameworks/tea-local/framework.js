// tea-local, a prototype strategy no framework implements: compiled TEA with local message
// routing (one closure per component instance, its own reducer and binding list). See README.md.
//
// The build is a plain Vite production build with no framework plugin, pinned in package.json
// and package-lock.json next to this file: the same bundler, minifier and target as the Solid
// setup, so differences come from the code. Every tea-local emitter shares this module.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PINNED = JSON.parse(fs.readFileSync(path.join(HERE, "package.json"), "utf8"));

export const name = "tea-local";
export const label = "tea-local (prototype)";
export const track = "prototype";

// Files every tea-local app gets unchanged: the HTML shell, the build config, the adapter and
// the runtime.
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

// A runtime file only some scenarios use (the keyed tables of big-table): the app asks for it
// by name, so the other scenarios' output stays byte-identical.
export function runtimeFile(file) {
  return fs.readFileSync(path.join(HERE, "template", file), "utf8");
}

// Which bucket a source-map source belongs to. The runtime has no package of its own: it is
// the runtime file every app gets from the template.
export function classify(source) {
  if (source.includes("/node_modules/") || source.startsWith("\0") || source.includes("vite/")) return "runtime";
  if (/(^|\/)src\/(runtime|table|routed)\.js$/.test(source)) return "runtime";
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

// The exact versions of everything that shapes the output, from the lockfile.
export function versions() {
  const lock = JSON.parse(fs.readFileSync(path.join(HERE, "package-lock.json"), "utf8"));
  const v = (p) => lock.packages[`node_modules/${p}`]?.version ?? null;
  return {
    vite: v("vite"),
    "rolldown (bundler and Oxc minifier)": v("rolldown"),
  };
}
