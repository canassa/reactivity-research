// The payloads of ./rr parse: one generated program at several sizes, each in three forms.
//
//   unminified   as generated (comments, indentation)
//   esbuild      esbuild's minifier (what Vite's production build uses here), target es2020
//   terser       the esbuild output passed through terser (compress + mangle)
//
// Every file is written to `dir`, checked with `node --check`, and run once in node (all of its
// modules required), so none of them can be a broken or degenerate program.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import * as esbuild from "esbuild";
import { minify as terserMinify } from "terser";
import { generate } from "./generate.js";

export const FORMS = ["unminified", "esbuild", "terser"];

const require = createRequire(import.meta.url);
export const versions = () => ({
  esbuild: esbuild.version,
  terser: require("terser/package.json").version,
});

// A script that loads a payload in node and requires every module, printing how many ran.
const RUN = `require(process.argv[1]);
const app = globalThis.Backoffice;
const names = app.modules();
for (const name of names) app.use(name);
if (app.booted.count !== names.length) throw new Error("boot saw " + app.booted.count + " modules, registry has " + names.length);
console.log(names.length);`;

export async function buildPayload({ targetBytes, seed, dir }) {
  const { source, modules } = generate({ bytes: targetBytes, seed });
  const esb = esbuild.transformSync(source, { minify: true, target: "es2020", legalComments: "none" }).code;
  const ter = (await terserMinify(esb, { ecma: 2020, compress: { passes: 1 }, mangle: true, format: { comments: false } })).code;
  const codes = { unminified: source, esbuild: esb, terser: ter };
  const out = { targetBytes, modules, forms: {} };
  for (const form of FORMS) {
    const code = codes[form];
    const file = path.join(dir, `seed${seed}-${Math.round(targetBytes / 1000)}k-${form}.js`);
    fs.writeFileSync(file, code);
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    const ran = Number(execFileSync(process.execPath, ["-e", RUN, file], { encoding: "utf8" }).trim());
    if (ran !== modules) throw new Error(`${file}: ran ${ran} modules, expected ${modules}`);
    out.forms[form] = { file, code, bytes: Buffer.byteLength(code), sha256: crypto.createHash("sha256").update(code).digest("hex") };
  }
  return out;
}
