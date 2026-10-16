// Marko 6 (the Tags API), as it ships: Vite + @marko/vite production build of a client-rendered
// page, pinned in package.json and package-lock.json next to this file. Every Marko emitter
// shares this module; see README.md for the build, the attribution and how to write emitters.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PINNED = JSON.parse(fs.readFileSync(path.join(HERE, "package.json"), "utf8"));

export const name = "marko";
export const label = "Marko 6";
export const track = "real";

// Files every Marko app gets unchanged: the HTML shell, package.json, the build config and the
// adapter. The emitter adds src/app.marko (the root template) and its tags.
export function templateFiles({ name, title }) {
  const read = (f) => fs.readFileSync(path.join(HERE, "template", f), "utf8");
  return {
    "package.json": read("package.json").replace("%NAME%", name)
      .replace(/%([\w@/-]+)%/g, (_, dep) => PINNED.dependencies[dep]),
    "index.html": read("index.html").replace("%TITLE%", title),
    "vite.config.js": read("vite.config.js"),
    "src/adapter.js": read("adapter.js"),
  };
}

// Which bucket a source-map source belongs to. The Marko runtime is in node_modules/marko; the
// compiled templates map back to src/**/*.marko. Their template strings (`$template`, `$walks`)
// carry no mappings of their own, and the measurement assigns unmapped characters to the source
// that follows them, which is the template's own code (see README.md, "Attribution"). Vite's
// module-preload polyfill has no mapping at all and comes first, so the measurement counts it as
// tooling, never through this function. Virtual modules (`\0…`, e.g. Vite's helpers) and
// node_modules (Marko, and Vite's own client code) are runtime.
export function classify(source) {
  if (source.includes("/node_modules/") || source.startsWith("\0")) return "runtime";
  if (/(^|\/)src\/adapter\.js$/.test(source)) return "adapter";
  return "app";
}

// Make the pinned node_modules visible to the generated app.
export async function prepare(dir) {
  const link = path.join(dir, "node_modules");
  fs.rmSync(link, { force: true, recursive: true });
  fs.symlinkSync(path.relative(dir, path.join(HERE, "node_modules")), link);
}

// `vite build` in the app's directory, in its own process, as `npm run build` runs it. Marko's
// compiler finds the project (its package.json, and from it the translator, `marko/translator`)
// from the working directory once per process (@marko/compiler/modules.js), so an in-process
// build from the repository root would not find it.
export async function build(dir) {
  const outDir = path.join(dir, "dist");
  fs.rmSync(outDir, { recursive: true, force: true });
  const vite = path.join(HERE, "node_modules", "vite", "bin", "vite.js");
  // NODE_ENV=production, as Marko's Vite example builds (`cross-env NODE_ENV=production vite
  // build`), whatever the caller's environment. MARKO_DEBUG would override the production
  // `optimize` setting (@marko/vite), so it is cleared.
  const env = { ...process.env, NODE_ENV: "production" };
  delete env.MARKO_DEBUG;
  try {
    execFileSync(process.execPath, [vite, "build", "--logLevel", "warn"], { cwd: dir, env, stdio: "pipe", encoding: "utf8" });
  } catch (e) {
    throw new Error(`vite build failed in ${dir}:\n${e.stderr || ""}${e.stdout || ""}`);
  }
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
    marko: v("marko"),
    "@marko/compiler": v("@marko/compiler"),
    "@marko/vite": v("@marko/vite"),
    "@babel/core": v("@babel/core"),
    vite: v("vite"),
    "rolldown (bundler and Oxc minifier)": v("rolldown"),
  };
}
