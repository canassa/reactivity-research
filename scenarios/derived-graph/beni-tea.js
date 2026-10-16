// The derived-graph app in beni, on its browser-tea platform (see frameworks/beni-tea/).
//
// beni's two browser platforms build one source (browser-direct's `Tea` is browser-tea's API),
// so both emitters write the same app: the generator and its style notes are in
// scenarios/derived-graph/shared/beni.js. The sheet's formulas are constant `let`s of one view; the
// items section is its own module.

import { emitApp } from "./shared/beni.js";
import { templateFiles } from "../../frameworks/beni-tea/framework.js";

export const framework = "beni-tea";

export const params = {};

export function emit(spec) {
  return emitApp(spec, templateFiles);
}
