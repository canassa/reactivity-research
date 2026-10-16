// tea-inline, a prototype (no framework implements it): compiled TEA with every reducer arm
// specialized into an action that writes model fields and schedules the bindings that read
// them (see README.md). Built with Vite alone, no framework plugin: the same bundler and
// minifier as the Solid setup, so differences come from the code. Pinned in package.json and
// package-lock.json next to this file. Every tea-inline emitter shares this module.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PINNED = JSON.parse(fs.readFileSync(path.join(HERE, "package.json"), "utf8"));

export const name = "tea-inline";
export const label = "TEA inline (prototype)";
export const track = "prototype";

// Files every tea-inline app gets unchanged: the HTML shell, the build config, the adapter and
// the runtime (DOM helpers, microtask batching, keyed lists). A scenario that needs more
// runtime asks for it with `extra`: names of files in template/ that land in src/ (big-table
// asks for rows.js: its long keyed rows, PRNG step and formatters).
export function templateFiles({ name, title, extra = [] }) {
  const read = (f) => fs.readFileSync(path.join(HERE, "template", f), "utf8");
  return {
    "package.json": read("package.json").replace("%NAME%", name)
      .replace(/%([\w@/-]+)%/g, (_, dep) => PINNED.dependencies[dep]),
    "index.html": read("index.html").replace("%TITLE%", title),
    "vite.config.js": read("vite.config.js"),
    "src/adapter.js": read("adapter.js"),
    "src/runtime.js": read("runtime.js"),
    ...Object.fromEntries(extra.map((f) => [`src/${f}`, read(f)])),
  };
}

// Which bucket a source-map source belongs to. The runtime is the support code every app
// ships whatever it contains; everything the emitter writes is app code.
export function classify(source) {
  if (source.includes("/node_modules/") || source.startsWith("\0") || source.includes("vite/")) return "runtime";
  if (/(^|\/)src\/(runtime|rows)\.js$/.test(source)) return "runtime";
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
