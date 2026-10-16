// Deletion accounting for the disposal bookkeeping of routed-app/tea-inline: strip the `reg` calls and
// the pages' leave disposers from a generated build, rebuild, print raw and brotli JS sizes. The stripped
// app leaks and is not correct; it only counts bytes of that bookkeeping.
// Usage (from the repo root, after ./rr build routed-app tea-inline --size N --seed S):
//   node notes/2026-10-17-routed-app-tea-inline-strip.mjs generated/routed-app/nN-sS/tea-inline /tmp/x yes|no
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";

const [src, dst, strip] = process.argv.slice(2);
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(src, dst, { recursive: true, dereference: false });
fs.rmSync(path.join(dst, "dist"), { recursive: true, force: true });
if (strip === "yes") {
  const dir = path.join(dst, "src/pages");
  for (const f of fs.readdirSync(dir)) {
    if (!/^p\d+\.js$/.test(f)) continue;
    let t = fs.readFileSync(path.join(dir, f), "utf8");
    t = t.replace(/^[ \t]*reg\([^\n]*\n/gm, "");
    t = t.replace(/\n[ \t]*\/\/ Leave with the page\.\n[ \t]*D\.push\(\(\) => \{\n(?:[^\n]*\n)*?[ \t]*\}\);\n/g, "\n");
    fs.writeFileSync(path.join(dir, f), t);
  }
}
execFileSync("npx", ["--no-install", "vite", "build", "--logLevel", "error"], { cwd: dst, stdio: "inherit" });
const assets = path.join(dst, "dist/assets");
for (const f of fs.readdirSync(assets).filter((x) => x.endsWith(".js"))) {
  const b = fs.readFileSync(path.join(assets, f));
  const br = zlib.brotliCompressSync(b, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_LGWIN]: 24, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: b.length } });
  console.log(strip, f, "raw", b.length, "br", br.length);
}
