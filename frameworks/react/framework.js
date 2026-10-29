// React 19, as it ships: Vite + @vitejs/plugin-react production build, the setup of create-vite
// 9.3.3's `react` template, pinned in package.json and package-lock.json next to this file.
// Every React emitter shares this module; see README.md for the build, the adapter and the
// compiler variant.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PINNED = JSON.parse(fs.readFileSync(path.join(HERE, "package.json"), "utf8"));

export const name = "react";
export const label = "React 19";
export const track = "real";

// The style parameter every React emitter takes: the React Compiler, off as in create-vite's
// default `react` template, on as in its `react-compiler` template. The source is the same.
export const params = {
  compiler: { default: "off", choices: ["off", "on"] },
};

// Files every React app gets unchanged: the HTML shell, package.json, the build config and the
// adapter. The emitter adds src/App.jsx (the root component) and whatever it imports.
export function templateFiles({ name, title }, { compiler = "off" } = {}) {
  const read = (f) => fs.readFileSync(path.join(HERE, "template", f), "utf8");
  const deps = (list) => Object.fromEntries(list.map((d) => [d, PINNED.dependencies[d]]));
  const pkg = {
    name,
    private: true,
    version: "0.0.0",
    type: "module",
    scripts: { dev: "vite", build: "vite build", preview: "vite preview" },
    dependencies: deps(["react", "react-dom"]),
    devDependencies: deps(["@vitejs/plugin-react", "vite",
      ...(compiler === "on" ? ["@babel/core", "@rolldown/plugin-babel", "babel-plugin-react-compiler"] : [])]),
  };
  return {
    "package.json": JSON.stringify(pkg, null, 2) + "\n",
    "index.html": read("index.html").replace("%TITLE%", title),
    "vite.config.js": read(compiler === "on" ? "vite.config.compiler.js" : "vite.config.js"),
    "src/adapter.jsx": read("adapter.jsx"),
  };
}

// Which bucket a source-map source belongs to: React, ReactDOM, the scheduler and the compiler
// runtime are in node_modules.
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
  await viteBuild({ root: dir, configFile: path.join(dir, "vite.config.js"), mode: "production", logLevel: "warn" });
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
    react: v("react"),
    "react-dom": v("react-dom"),
    scheduler: v("scheduler"),
    "@vitejs/plugin-react": v("@vitejs/plugin-react"),
    vite: v("vite"),
    "rolldown (bundler and Oxc minifier)": v("rolldown"),
    "babel-plugin-react-compiler (compiler=on)": v("babel-plugin-react-compiler"),
    "@rolldown/plugin-babel (compiler=on)": v("@rolldown/plugin-babel"),
    "@babel/core (compiler=on)": v("@babel/core"),
  };
}
