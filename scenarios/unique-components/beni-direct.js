// The unique-components app in beni, on its browser-direct platform (see frameworks/beni-direct/).
//
// beni's two browser platforms build one source (browser-direct's `Tea` is browser-tea's API),
// so both emitters write the same app: the generator and its style notes are in
// scenarios/unique-components/shared/beni.js. Every widget is its own module, with its own Model,
// Msg, update and view.

import { emitApp } from "./shared/beni.js";
import { templateFiles } from "../../frameworks/beni-direct/framework.js";

export const framework = "beni-direct";

export const params = {};

export function emit(spec) {
  return emitApp(spec, templateFiles);
}
