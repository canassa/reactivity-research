// The derived-graph app in beni, on its browser-inline platform (see frameworks/beni-inline/).
//
// browser-inline's `Tea` keeps browser-tea's signatures, so one source builds on all three beni
// platforms: the generator and its style notes are in scenarios/derived-graph/shared/beni.js. Its first
// slice (S0) compiles only the minimal view; a program it cannot compile yet is refused at build
// time with a "limit of the compiler" diagnostic.

import { emitApp } from "./shared/beni.js";
import { templateFiles } from "../../frameworks/beni-inline/framework.js";

export const framework = "beni-inline";

export const params = {};

export function emit(spec) {
  return emitApp(spec, templateFiles);
}
