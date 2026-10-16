// The production build: plain Vite, no framework plugin (the app is plain DOM code), with the
// same settings as the other Vite setups: `target: "esnext"`, and `sourcemap: "hidden"` to write
// source maps for byte attribution without touching the bundle.
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: { target: "esnext", sourcemap: "hidden" },
});
