// Generate (spec → emitter → files) and build (the framework's own production build).

import fs from "node:fs";
import path from "node:path";
import { appDir, GENERATED } from "./selection.js";

export function writeFiles(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
}

export async function generateApp(scenario, emitter, scenarioOptions, emitterOptions) {
  const spec = scenario.mod.generate(scenarioOptions);
  const dir = appDir(scenario, spec.options, emitter, emitterOptions);
  if (!dir.startsWith(GENERATED + path.sep)) throw new Error(`refusing to write outside generated/: ${dir}`);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  // Several workers may write this same (identical) file at once: write, then rename.
  const specFile = path.join(path.dirname(dir), "spec.json");
  const tmp = `${specFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(spec, null, 1) + "\n");
  fs.renameSync(tmp, specFile);

  const { files, style } = emitter.mod.emit(spec, emitterOptions);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  writeFiles(dir, files);
  const info = {
    scenario: scenario.name,
    options: spec.options,
    emitter: emitter.name,
    framework: emitter.mod.framework,
    emitterOptions,
    style,
  };
  fs.writeFileSync(path.join(dir, "rr.json"), JSON.stringify(info, null, 2) + "\n");
  await emitter.framework.prepare(dir);
  return { spec, dir, info };
}

export async function buildApp(scenario, emitter, scenarioOptions, emitterOptions) {
  const generated = await generateApp(scenario, emitter, scenarioOptions, emitterOptions);
  const built = await emitter.framework.build(generated.dir);
  return { ...generated, built };
}
