// Solid 1, as it ships: Vite + vite-plugin-solid production build, pinned in package.json and
// package-lock.json next to this file. Every Solid emitter shares this module.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PINNED = JSON.parse(fs.readFileSync(path.join(HERE, "package.json"), "utf8"));

export const name = "solid";
export const label = "Solid 1";
export const track = "framework";

// Files every Solid app gets unchanged: the HTML shell, the build config and the adapter.
export function templateFiles({ name, title }) {
  const read = (f) => fs.readFileSync(path.join(HERE, "template", f), "utf8");
  return {
    "package.json": read("package.json").replace("%NAME%", name)
      .replace(/%([\w@/-]+)%/g, (_, dep) => PINNED.dependencies[dep]),
    "index.html": read("index.html").replace("%TITLE%", title),
    "vite.config.js": read("vite.config.js"),
    "src/adapter.jsx": read("adapter.jsx"),
  };
}

// Which bucket a source-map source belongs to.
export function classify(source) {
  if (source.includes("/node_modules/") || source.startsWith("\0") || source.includes("vite/")) return "runtime";
  if (/(^|\/)src\/adapter\.jsx$/.test(source)) return "adapter";
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
    "solid-js": v("solid-js"),
    "babel-preset-solid": v("babel-preset-solid"),
    "babel-plugin-jsx-dom-expressions": v("babel-plugin-jsx-dom-expressions"),
    "@babel/core": v("@babel/core"),
    "vite-plugin-solid": v("vite-plugin-solid"),
    vite: v("vite"),
    "rolldown (bundler and Oxc minifier)": v("rolldown"),
  };
}
