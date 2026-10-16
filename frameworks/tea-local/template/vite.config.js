// The production build: Vite with no framework plugin, the same bundler, minifier and target as
// the Solid setup, so size differences come from the code. `sourcemap: "hidden"` writes source
// maps for byte attribution without touching the bundle.
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: { target: "esnext", sourcemap: "hidden" },
});
