// beni on its `browser-inline` platform: the same Elm Architecture source, compiled whole where
// the program's constructor is called, with no task kernel and no run-time renderer
// (docs/design/browser-inline.md in beni). Built with beni's own release build; see README.md
// here and in frameworks/beni/, whose shared helper this links as ./beni.js.
//
// Its adapter is its own (template/adapter.js): the runtime exports `stop`, the page's unmount,
// and writes the DOM inside each dispatch, so the adapter needs none of the listener tracking and
// `flush` the other two beni setups' shared adapter does. The page and `Push.beni` are shared.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as beni from "./beni.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const name = "beni-inline";
export const label = `beni browser-inline (${beni.COMMIT.slice(0, 9)})`;
export const track = "framework";
export const platform = "browser-inline";

export const templateFiles = (opts) => ({
  ...beni.templateFiles(platform, opts),
  "adapter.js": fs.readFileSync(path.join(HERE, "template", "adapter.js"), "utf8"),
});
export const classify = beni.classify;
export const prepare = beni.prepare;
export const build = beni.build;
export const versions = () => ({ ...beni.versions(), platform });
