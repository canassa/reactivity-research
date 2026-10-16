// The production build: plain Vite, no framework plugin (the app is plain DOM code), with the
// same settings as the other Vite setups: `target: "esnext"`, and `sourcemap: "hidden"` to write
// source maps for byte attribution without touching the bundle. One difference: no module-preload
// polyfill. The app is one script with no dynamic imports, and a hand-written page would not ship
// it (the other setups keep their tools' defaults).
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: { target: "esnext", sourcemap: "hidden", modulePreload: { polyfill: false } },
});
