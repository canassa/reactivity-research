// beni on its `browser-direct` platform: the same Elm Architecture source, compiled instead of
// run (docs/design/browser-direct.md in beni): no view at run time, one function per message
// key that writes the DOM nodes its write set can reach, a keyed reconciler only for lists a
// message replaces or permutes. Built with beni's own release build; see README.md here and in
// frameworks/beni/, whose shared helper this links as ./beni.js.

import * as beni from "./beni.js";

export const name = "beni-direct";
export const label = `beni browser-direct (${beni.COMMIT.slice(0, 9)})`;
export const track = "framework";
export const platform = "browser-direct";

export const templateFiles = (opts) => beni.templateFiles(platform, opts);
export const classify = beni.classify;
export const prepare = beni.prepare;
export const build = beni.build;
export const versions = () => ({ ...beni.versions(), platform });
