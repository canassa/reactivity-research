// beni on its `browser-tea` platform: The Elm Architecture written in beni over the `browser`
// platform's template runtime (compiled templates cloned once and patched where a value
// changed, one render per task on a microtask). Built with beni's own release build; see
// README.md here and in frameworks/beni/, whose shared helper this links as ./beni.js.

import * as beni from "./beni.js";

export const name = "beni-tea";
export const label = `beni browser-tea (${beni.COMMIT.slice(0, 9)})`;
export const track = "framework";
export const platform = "browser-tea";

export const templateFiles = (opts) => beni.templateFiles(platform, opts);
export const classify = beni.classify;
export const prepare = beni.prepare;
export const build = beni.build;
export const versions = () => ({ ...beni.versions(), platform });
