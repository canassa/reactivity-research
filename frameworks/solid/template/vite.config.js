// The production build: Vite with vite-plugin-solid, as Solid's own templates set it up.
// `sourcemap: "hidden"` writes source maps for byte attribution without touching the bundle.
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  base: "./",
  build: { sourcemap: "hidden" },
});
