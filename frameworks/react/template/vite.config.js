// The production build: create-vite's `react` template config, plus `base: "./"` (relative asset
// paths, so the page can be served from any directory) and `sourcemap: "hidden"` (source maps for
// byte attribution; the bundle is unchanged).
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: { sourcemap: "hidden" },
});
