// The routed-app app in beni, on its browser-tea platform (see frameworks/beni-tea/).
//
// beni's two browser platforms build one source (browser-direct's `Tea` is browser-tea's API),
// so both emitters write the same app: the generator and its style notes are in
// scenarios/routed-app/shared/beni.js. Every page is its own module, with its own Model, Msg,
// update and view; `Main` holds the shell, the global state and the page shown.

import { emitApp } from "./shared/beni.js";
import { templateFiles } from "../../frameworks/beni-tea/framework.js";

export const framework = "beni-tea";

export const params = {};

export function emit(spec) {
  return emitApp(spec, templateFiles);
}
