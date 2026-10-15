// Pre-fetch the pinned Elm packages (template/elm.json, direct and indirect) into a local
// ELM_HOME, so builds never touch the network. Runs after `npm ci` (the postinstall script);
// needs the network once. See README.md.
//
// It compiles a throwaway program against template/elm.json, which makes the Elm compiler
// download every listed package and build its artifacts into ELM_HOME. Later builds find them
// all there and run offline; they only read ELM_HOME, so any number can share it at once.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ELM_HOME, elmBinary } from "./framework.js";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rr-elm-install-"));
try {
  fs.copyFileSync(path.join(HERE, "template", "elm.json"), path.join(tmp, "elm.json"));
  fs.mkdirSync(path.join(tmp, "src"));
  // One import per direct dependency, so each is used (indirect ones are built regardless).
  fs.writeFileSync(path.join(tmp, "src", "Main.elm"), `module Main exposing (main)

import Browser
import Html
import Json.Decode
import Regex


main : Program () () ()
main =
    Browser.element
        { init = \\_ -> ( (), Cmd.none )
        , view = \\_ -> Html.text (Debug.toString (Json.Decode.decodeString Json.Decode.int "1", Regex.never))
        , update = \\_ m -> ( m, Cmd.none )
        , subscriptions = \\_ -> Sub.none
        }
`);
  fs.mkdirSync(ELM_HOME, { recursive: true });
  execFileSync(elmBinary(), ["make", "src/Main.elm", "--output=/dev/null"], {
    cwd: tmp,
    env: { ...process.env, ELM_HOME },
    stdio: "inherit",
  });
  console.log(`Elm packages ready in ${path.relative(process.cwd(), ELM_HOME) || ELM_HOME}`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
