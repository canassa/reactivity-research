// The production build: plain Vite, no framework plugin, the same settings as the Solid
// template (`target: "esnext"`). `sourcemap: "hidden"` writes source maps for byte attribution
// without touching the bundle.
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: { target: "esnext", sourcemap: "hidden" },
});
