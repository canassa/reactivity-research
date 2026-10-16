// The production build: Vite with @marko/vite, as its README sets it up, with `linked: false`
// because the page is a plain client-rendered Vite app (an index.html that mounts the root
// template) rather than a Marko server render. `vite build` runs in production mode, so
// @marko/vite compiles with `optimize`. `sourcemap: "hidden"` writes source maps for byte
// attribution without touching the bundle.
import { defineConfig } from "vite";
import marko from "@marko/vite";

export default defineConfig({
  plugins: [marko({ linked: false })],
  base: "./",
  build: { sourcemap: "hidden" },
});
