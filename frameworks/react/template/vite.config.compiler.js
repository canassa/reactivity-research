// The production build: create-vite's `react-compiler` template config (the React Compiler as a
// Babel preset), plus `base: "./"` (relative asset paths, so the page can be served from any
// directory) and `sourcemap: "hidden"` (source maps for byte attribution; the bundle is unchanged).
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
  base: "./",
  build: { sourcemap: "hidden" },
});
