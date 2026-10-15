// The selection every subcommand takes: a scenario, a framework list (or `all`), and options.
//
// Scenarios are discovered as scenarios/<name>/spec.js; their emitters as every other
// scenarios/<name>/<emitter>.js. Nothing here knows a scenario or a framework by name.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SCENARIOS = path.join(ROOT, "scenarios");
export const FRAMEWORKS = path.join(ROOT, "frameworks");
export const GENERATED = path.join(ROOT, "generated");
export const RESULTS = path.join(ROOT, "results");

// Parse `positional... --key value --key=value --flag` into { _: [...], key: value }.
// A flag is boolean when it is in `booleans` or is followed by another flag or nothing.
export function parseArgs(argv, booleans = []) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { out._.push(a); continue; }
    const eq = a.indexOf("=");
    if (eq > 0) { out[camel(a.slice(2, eq))] = a.slice(eq + 1); continue; }
    const key = camel(a.slice(2));
    if (booleans.includes(key) || i + 1 >= argv.length || argv[i + 1].startsWith("--")) out[key] = true;
    else out[key] = argv[++i];
  }
  return out;
}

const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const kebab = (s) => s.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());

export function listScenarios() {
  return fs.readdirSync(SCENARIOS).filter((d) => fs.existsSync(path.join(SCENARIOS, d, "spec.js"))).sort();
}

export async function loadScenario(name) {
  if (!name) throw new Error(`name a scenario: ${listScenarios().join(", ")}`);
  const file = path.join(SCENARIOS, name, "spec.js");
  if (!fs.existsSync(file)) throw new Error(`no scenario "${name}" (have: ${listScenarios().join(", ")})`);
  const mod = await import(pathToFileURL(file));
  return { name, dir: path.dirname(file), specFile: file, mod };
}

export function listEmitters(scenario) {
  return fs.readdirSync(path.join(SCENARIOS, scenario))
    .filter((f) => f.endsWith(".js") && f !== "spec.js")
    .map((f) => f.slice(0, -3))
    .sort();
}

export async function loadEmitter(scenario, name) {
  const file = path.join(SCENARIOS, scenario, `${name}.js`);
  if (!fs.existsSync(file)) throw new Error(`no ${name} emitter for ${scenario} (have: ${listEmitters(scenario).join(", ")})`);
  const mod = await import(pathToFileURL(file));
  const fwDir = path.join(FRAMEWORKS, mod.framework);
  const framework = await import(pathToFileURL(path.join(fwDir, "framework.js")));
  return { name, file, mod, framework, frameworkDir: fwDir };
}

export async function loadEmitters(scenario, which) {
  const names = !which || which === "all" ? listEmitters(scenario) : which.split(",").map((s) => s.trim());
  return Promise.all(names.map((n) => loadEmitter(scenario, n)));
}

// Split the parsed flags into scenario options and each emitter's own options, filling defaults
// and rejecting unknown flags. `extra` lists flags the subcommand itself takes.
export function splitOptions(args, scenario, emitters, extra = []) {
  const scenarioKeys = ["size", "seed", ...Object.keys(scenario.mod.params || {})];
  const emitterKeys = new Set(emitters.flatMap((e) => Object.keys(e.mod.params || {})));
  for (const k of Object.keys(args)) {
    if (k === "_" || extra.includes(k) || scenarioKeys.includes(k) || emitterKeys.has(k)) continue;
    throw new Error(`unknown option --${kebab(k)}`);
  }
  const scenarioOptions = {};
  for (const k of scenarioKeys) if (args[k] !== undefined) scenarioOptions[k] = args[k];
  const emitterOptions = (e) => {
    const out = {};
    for (const [k, p] of Object.entries(e.mod.params || {})) {
      const v = args[k] ?? p.default;
      if (p.choices && !p.choices.includes(v)) throw new Error(`--${kebab(k)} must be one of ${p.choices.join(", ")}`);
      out[k] = v;
    }
    return out;
  };
  return { scenarioOptions, emitterOptions };
}

// generated/<scenario>/n<size>-s<seed>[-<k>=<v>…]/<emitter>[-<k>=<v>…]/
// Options at their defaults are left out of the names.
export function appDir(scenario, options, emitter, emitterOptions) {
  const extra = Object.entries(options)
    .filter(([k, v]) => k !== "size" && k !== "seed" && String(v) !== String(scenario.mod.params[k].default))
    .map(([k, v]) => `-${kebab(k)}=${v}`).join("");
  return path.join(GENERATED, scenario.name, `n${options.size}-s${options.seed}${extra}`, variantName(emitter, emitterOptions));
}

export function variantName(emitter, emitterOptions) {
  const extra = Object.entries(emitterOptions)
    .filter(([k, v]) => String(v) !== String(emitter.mod.params[k].default))
    .map(([k, v]) => `-${kebab(k)}=${v}`).join("");
  return emitter.name + extra;
}
