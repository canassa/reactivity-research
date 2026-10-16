// The production build: plain Vite with no framework plugin (the same bundler and minifier as
// the Solid setup), with `target: "esnext"` as there. `sourcemap: "hidden"` writes source maps
// for byte attribution without touching the bundle.
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: { target: "esnext", sourcemap: "hidden" },
});
