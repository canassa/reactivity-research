// The big-table app in beni, on its browser-tea platform (see frameworks/beni-tea/).
//
// beni's two browser platforms build one source (browser-direct's `Tea` is browser-tea's API),
// so both emitters write the same app: the generator and its style notes are in
// scenarios/big-table/shared/beni.js. Every table is its own module, with its own Row, Model,
// Msg, row builder, update and view.

import { emitApp } from "./shared/beni.js";
import { templateFiles } from "../../frameworks/beni-tea/framework.js";

export const framework = "beni-tea";

export const params = {};

export function emit(spec) {
  return emitApp(spec, templateFiles);
}
