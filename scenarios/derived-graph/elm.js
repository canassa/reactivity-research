// The derived-graph scenario in Elm 0.19 (built with 0.19.3, see frameworks/elm/).
//
// Style (recorded in every generated app's rr.json):
// - The Elm Architecture with `Browser.element`: one `Model` holding every input as a record
//   field (`taxRate : Int`, `countUnits : Bool`, `spotlight : String`) and the items
//   (`items : List Item`, `markup`, `nextId`, `rng`), one `Msg` with a constructor per control
//   (`SetTaxRate String`, `RaiseTaxRate`, `ToggleCountUnits Bool`, `PickSpotlight String`) and per
//   item control, one `update` (a case branch per message, written out as record updates) and
//   one `view`.
// - Derived values are computed in `view`, as the Elm guide teaches ("keep the model minimal,
//   derive the rest"): `viewSheet` opens with a `let` that binds every formula, in dependency
//   order, to its own expression over `model` and the formulas above it
//   (`dutyOwed = pct grossSales model.taxRate`), so each is computed once per view however many
//   displays read it. The model caches nothing: there is no staleness to keep consistent, and
//   `update` stays a set of one-field record updates. The price is that every event recomputes
//   every formula (an item edit re-sums every aggregate, a note keystroke as well); `Html.Lazy`
//   skips the work of a row, not of a formula, so rows (`lazy2 viewRow markup item`) are the only
//   lazy part.
// - Items: `Html.Keyed.node "tbody"` with `( String.fromInt item.id, lazy2 viewRow model.markup item )`,
//   an `Item` record that is replaced, never mutated, by `mapItem id`, so an untouched item keeps
//   its reference and its row is skipped. A missing id is a no-op. Top-k lists and group sums are
//   `Html.Keyed` lists too (items keyed by id, groups by category).
// - Numbers are `Int`; division is `floor (toFloat a / toFloat b)` (`fdiv`), never `//`, which is
//   32-bit. A number input sends its text and `onInt` applies it only while it is an integer in
//   range, so an invalid text leaves the model and the view alone.
// - External events: one incoming port, `events : (Value -> msg) -> Sub msg`, decoded with
//   `Json.Decode` into `ServerInputs` (a `Dict String Value`, read per input by `readInputs`),
//   `ServerItems` and `Snapshot` (the same `readInputs`, plus markup, items and the generator).
//   Items from a message are decoded into new records.
// - `src/Util.elm` (app code): the `Item` type, the PRNG step and word pools, formatters, the
//   collection helpers formulas call (`sumBy`, `topBy`, `groupSum`, …), decoders and attribute
//   helpers.
// - Production build: `elm make --optimize`, then the guide's two uglify-js passes.

import { templateFiles } from "../../frameworks/elm/framework.js";
import { cap, fields, jsExpr, readGraph, readsItems, rootsOfItems, str } from "./shared/graph.js";

export const framework = "elm";

export const params = {};

const elm = (s) => '"' + String(s).replace(/[\\"\n\r\t]/g, (c) => ({ "\\": "\\\\", '"': '\\"', "\n": "\\n", "\r": "\\r", "\t": "\\t" })[c]) + '"';
const sp = (n) => " ".repeat(n);
const pad = (code, n) => code.split("\n").map((l) => (l ? sp(n) + l : l)).join("\n");
const exposing = (names) => [...names].sort().join(", ");
const stringList = (list) => `[ ${list.map(elm).join(", ")} ]`;

// ---------------------------------------------------------------------------------------------
// Formulas as Elm expressions, over `model` (inputs), let-bound formulas and the item `it`.
//
// elm-format always lays an `if` out over several lines, so an `if` is written as the whole body
// of a binding (a chain of `else if`s included), and any other `if` is bound to a name of its
// own in the formula's `let`: an `if` inside an operator or an argument becomes `salesA`, and a
// lambda whose body has an `if` becomes a local function `salesB it`, with its own `let`.

const A = 11; // an atom: a name, a literal, a field access
const atom = (s) => ({ s, p: A });
const app = (s) => ({ s, p: 10 });
const wrapE = (r, min) => (r.p >= min ? r.s : `(${r.s})`);
const CMP = { "<": "<", "<=": "<=", ">": ">", ">=": ">=", "==": "==", "!=": "/=" };
const hasIf = (e) => Array.isArray(e) && e[0] !== "k" && (e[0] === "if" || e.slice(1).some(hasIf));

// A binding context: the formula's name, a counter for the names it makes, and the bindings made
// so far, which go before the formula's own.
const newCtx = (base, counter = { n: 0 }) => ({ base, counter, defs: [] });
const fresh = (ctx) => `${ctx.base}${String.fromCharCode(65 + ctx.counter.n++)}`;
const defText = (d) => `${d.head} =\n${pad(d.body, 4)}`;
const withLets = (defs, body) => (defs.length ? `let\n${pad(defs.map(defText).join("\n\n"), 8)}\nin\n${body}` : body);

// The text of an expression as the body of a binding: an `if` over several lines.
function body(e, g, ctx) {
  if (e[0] !== "if") return elmExpr(e, g, ctx).s;
  const cond = elmExpr(e[1], g, ctx).s;
  const otherwise = e[3][0] === "if" ? `else ${body(e[3], g, ctx)}` : `else\n${pad(body(e[3], g, ctx), 4)}`;
  return `if ${cond} then\n${pad(body(e[2], g, ctx), 4)}\n\n${otherwise}`;
}

// A local function of the item `it` whose body is `make(ctx)`, bound in `ctx`; its name.
function liftFn(ctx, make) {
  const name = fresh(ctx);
  const sub = { ...ctx, defs: [] };
  const text = make(sub);
  ctx.defs.push({ head: `${name} it`, body: withLets(sub.defs, text) });
  return name;
}

function elmExpr(e, g, ctx) {
  const w = (x, min) => wrapE(elmExpr(x, g, ctx), min);
  const lam = (x) => (hasIf(x) ? liftFn(ctx, (sub) => body(x, g, sub)) : `(\\it -> ${w(x, 0)})`);
  switch (e[0]) {
    case "k":
      if (typeof e[1] === "string") return atom(elm(e[1]));
      return atom(String(e[1])); // a negative literal is bare, as elm-format writes it
    case "v": return atom(g.cells.get(e[1]).kind === "input" ? `model.${e[1]}` : e[1]);
    case "i": return atom(`it.${e[1]}`);
    case "items": return atom("model.items");
    case "+": return { s: e.slice(1).map((x) => w(x, 6)).join(" + "), p: 6 };
    case "-": return { s: `${w(e[1], 6)} - ${w(e[2], 7)}`, p: 6 };
    case "*": return { s: `${w(e[1], 7)} * ${w(e[2], 8)}`, p: 7 };
    case "div": return app(`fdiv ${w(e[1], A)} ${w(e[2], A)}`);
    case "pct": return app(`pct ${w(e[1], A)} ${w(e[2], A)}`);
    case "min": case "max": {
      const args = e.slice(1).map((x) => elmExpr(x, g, ctx));
      const fold = (list) => (list.length === 1 ? list[0].s : `${e[0]} ${wrapE(list[0], A)} ${list.length === 2 ? wrapE(list[1], A) : `(${fold(list.slice(1))})`}`);
      return args.length === 1 ? args[0] : app(fold(args));
    }
    case "abs": return app(`abs ${w(e[1], A)}`);
    case "if": {
      // Not the body of a binding: bind it.
      const name = fresh(ctx);
      ctx.defs.push({ head: name, body: body(e, g, ctx) });
      return atom(name);
    }
    case "<": case "<=": case ">": case ">=": case "==": case "!=":
      return { s: `${w(e[1], 5)} ${CMP[e[0]]} ${w(e[2], 5)}`, p: 4 };
    case "and": return { s: e.slice(1).map((x) => w(x, 4)).join(" && "), p: 3 };
    case "or": return { s: e.slice(1).map((x) => w(x, 4)).join(" || "), p: 2 };
    case "not": return app(`not ${w(e[1], A)}`);
    case "count": return app(`List.length ${w(e[1], A)}`);
    case "sum": return app(`sumBy ${lam(e[2])} ${w(e[1], A)}`);
    case "avg": return app(`avgBy ${lam(e[2])} ${w(e[1], A)}`);
    case "maxOf": return app(`maxBy ${lam(e[2])} ${w(e[1], A)}`);
    case "minOf": return app(`minBy ${lam(e[2])} ${w(e[1], A)}`);
    case "filter": return app(`List.filter ${lam(e[2])} ${w(e[1], A)}`);
    case "top": {
      // A key with an `if` is a local function (the view reads it as `salesKey it`).
      const key = lam(e[2]);
      if (hasIf(e[2])) ctx.keyFn = key;
      const sorted = e[3] === "asc" ? key : hasIf(e[2]) ? `(\\it -> negate (${key} it))` : `(\\it -> negate ${w(e[2], A)})`;
      return app(`topBy ${e[4]} ${sorted} ${w(e[1], A)}`);
    }
    case "groupSum": return app(`groupSum ${lam(e[2])} ${w(e[1], A)}`);
    case "at": return app(`at ${elm(e[2])} ${w(e[1], A)}`);
  }
  throw new Error(`unknown expression ${JSON.stringify(e)}`);
}

// A value as a String expression (a piece of a ++ chain).
function shownElm(format, v, words) {
  const arg = /^[\w.]+$/.test(v) ? v : `(${v})`;
  if (words) return `words ${elm(words[0])} ${elm(words[1])} ${arg}`;
  switch (format) {
    case "plain": case undefined: return `String.fromInt ${arg}`;
    case "pct": return `String.fromInt ${arg} ++ "%"`;
    case "grouped": return `grouped ${arg}`;
    case "currency": return `money ${arg}`;
  }
  throw new Error(`unknown number format ${format}`);
}


// ---------------------------------------------------------------------------------------------
// Util.elm

function utilModule(spec) {
  return `module Util exposing
    ( Item
    , at
    , avgBy
    , buildItems
    , categories
    , dataKey
    , fdiv
    , field
    , groupSum
    , grouped
    , itemDecoder
    , mapItem
    , maxBy
    , mergeItems
    , minBy
    , money
    , onInt
    , options
    , pct
    , role
    , sumBy
    , topBy
    , words
    )

import Dict exposing (Dict)
import Html exposing (Attribute, Html)
import Html.Attributes exposing (attribute, selected, value)
import Json.Decode as Decode exposing (Decoder)


type alias Item =
    { id : Int
    , name : String
    , category : String
    , qty : Int
    , price : Int
    , active : Bool
    , note : String
    }


categories : List String
categories =
    ${stringList(spec.categories)}


adjectives : List String
adjectives =
    ${stringList(spec.itemWords.adjectives)}


nouns : List String
nouns =
    ${stringList(spec.itemWords.nouns)}


currency : String
currency =
    ${elm(spec.currency)}



-- ATTRIBUTES


role : String -> Attribute msg
role =
    attribute "data-role"


dataKey : String -> Attribute msg
dataKey =
    attribute "data-key"


options : List String -> String -> List (Html msg)
options list current =
    List.map (\\o -> Html.option [ value o, selected (o == current) ] [ Html.text o ]) list


{-| A bool's display words.
-}
words : String -> String -> Bool -> String
words yes no isYes =
    if isYes then
        yes

    else
        no



-- NUMBERS


{-| Floor division on doubles: \`//\` is 32-bit and the sheet's totals are not.
-}
fdiv : Int -> Int -> Int
fdiv a b =
    floor (toFloat a / toFloat b)


pct : Int -> Int -> Int
pct a b =
    fdiv (a * b) 100


{-| 1234567 as "1,234,567", with a sign.
-}
grouped : Int -> String
grouped n =
    (if n < 0 then
        "-"

     else
        ""
    )
        ++ groupDigits (String.fromInt (abs n))


groupDigits : String -> String
groupDigits digits =
    if String.length digits <= 3 then
        digits

    else
        groupDigits (String.dropRight 3 digits) ++ "," ++ String.right 3 digits


{-| Cents as "€12.34".
-}
money : Int -> String
money cents =
    let
        a =
            abs cents
    in
    (if cents < 0 then
        "-"

     else
        ""
    )
        ++ currency
        ++ grouped (fdiv a 100)
        ++ "."
        ++ String.padLeft 2 '0' (String.fromInt (remainderBy 100 a))


{-| Apply a number input's text while it is an integer in [lo, hi]; otherwise leave the model.
-}
onInt : Int -> Int -> String -> model -> (Int -> model) -> model
onInt lo hi typed model apply =
    case String.toInt typed of
        Just n ->
            if n >= lo && n <= hi && not (String.startsWith "+" typed) then
                apply n

            else
                model

        Nothing ->
            model



-- COLLECTIONS


sumBy : (Item -> Int) -> List Item -> Int
sumBy f items =
    List.sum (List.map f items)


avgBy : (Item -> Int) -> List Item -> Int
avgBy f items =
    case items of
        [] ->
            0

        _ ->
            fdiv (sumBy f items) (List.length items)


maxBy : (Item -> Int) -> List Item -> Int
maxBy f items =
    Maybe.withDefault 0 (List.maximum (List.map f items))


minBy : (Item -> Int) -> List Item -> Int
minBy f items =
    Maybe.withDefault 0 (List.minimum (List.map f items))


{-| The first \`k\` items by key, ties by id.
-}
topBy : Int -> (Item -> Int) -> List Item -> List Item
topBy k key items =
    List.take k (List.sortBy (\\it -> ( key it, it.id )) items)


{-| The sum of \`f\` per category, in category order.
-}
groupSum : (Item -> Int) -> List Item -> List ( String, Int )
groupSum f items =
    List.map (\\c -> ( c, sumBy f (List.filter (\\it -> it.category == c) items) )) categories


at : String -> List ( String, Int ) -> Int
at category sums =
    case sums of
        [] ->
            0

        ( c, total ) :: rest ->
            if c == category then
                total

            else
                at category rest


mapItem : Int -> (Item -> Item) -> List Item -> List Item
mapItem id f items =
    List.map
        (\\it ->
            if it.id == id then
                f it

            else
                it
        )
        items


{-| The server's changes: listed ids replaced in place, new ids appended, listed ids removed.
-}
mergeItems : List Item -> List Int -> List Item -> List Item
mergeItems upsert gone items =
    let
        known =
            List.map .id items

        kept =
            List.filter (\\it -> not (List.member it.id gone)) items

        replaced =
            List.map (\\it -> Maybe.withDefault it (List.head (List.filter (\\u -> u.id == it.id) upsert))) kept

        fresh =
            List.filter (\\u -> not (List.member u.id known || List.member u.id gone)) upsert
    in
    replaced ++ fresh



-- ITEMS


next : Int -> Int
next seed =
    remainderBy 2147483647 (seed * 48271)


pick : Int -> List String -> String
pick seed list =
    Maybe.withDefault "" (List.head (List.drop (remainderBy (List.length list) seed) list))


{-| \`count\` new items from the Park-Miller generator, with the generator's new state.
-}
buildItems : Int -> Int -> Int -> ( List Item, Int )
buildItems count firstId rng =
    let
        build id ( built, seed ) =
            let
                s1 =
                    next seed

                s2 =
                    next s1

                s3 =
                    next s2

                s4 =
                    next s3

                s5 =
                    next s4

                s6 =
                    next s5
            in
            ( { id = id
              , name = pick s1 adjectives ++ " " ++ pick s2 nouns
              , category = pick s3 categories
              , qty = 1 + remainderBy 99 s4
              , price = 100 + remainderBy 9900 s5
              , active = remainderBy 4 s6 /= 0
              , note = ""
              }
                :: built
            , s6
            )
    in
    List.foldl build ( [], rng ) (List.range firstId (firstId + count - 1))
        |> Tuple.mapFirst List.reverse



-- DECODERS


itemDecoder : Decoder Item
itemDecoder =
    Decode.map7 Item
        (Decode.field "id" Decode.int)
        (Decode.field "name" Decode.string)
        (Decode.field "category" Decode.string)
        (Decode.field "qty" Decode.int)
        (Decode.field "price" Decode.int)
        (Decode.field "active" Decode.bool)
        (Decode.field "note" Decode.string)


{-| The value an event gives an input, or the current one.
-}
field : Decoder a -> String -> Dict String Decode.Value -> a -> a
field decoder name values current =
    Dict.get name values
        |> Maybe.andThen (\\v -> Result.toMaybe (Decode.decodeValue decoder v))
        |> Maybe.withDefault current
`;
}

// ---------------------------------------------------------------------------------------------
// Main.elm

const typeOf = (c) => (c.type === "num" ? "Int" : c.type === "bool" ? "Bool" : "String");
const decoderOf = (c) => (c.type === "num" ? "Decode.int" : c.type === "bool" ? "Decode.bool" : "Decode.string");
const valueOf = (c, v) => (c.type === "bool" ? (v ? "True" : "False") : c.type === "num" ? String(v) : elm(v));

function mainModule(spec, g) {
  const out = [];
  const html = new Set(["Html"]);
  const attrs = new Set(["attribute"]);
  const events = new Set();
  const lazy = new Set();
  const util = new Set(["Item", "dataKey", "role"]);
  const H = (n) => (html.add(n), n);
  const U = (n) => (util.add(n), n);

  const msgName = (m) => cap(m.name);
  const inputs = g.inputs;

  // ---- the model
  const modelFields = [...inputs.map((c) => `${c.name} : ${typeOf(c)}`), "markup : Int", "items : List Item", "nextId : Int", "rng : Int"];
  const initial = spec.initialState;
  const item = (it) => `{ id = ${it.id}, name = ${elm(it.name)}, category = ${elm(it.category)}, qty = ${it.qty}, price = ${it.price}, active = ${it.active ? "True" : "False"}, note = ${elm(it.note)} }`;
  const initFields = [...inputs.map((c) => `${c.name} = ${valueOf(c, initial.inputs[c.name])}`), `markup = ${initial.markup}`, `items =\n        [ ${initial.items.map(item).join("\n        , ")}\n        ]`, `nextId = ${initial.nextId}`, `rng = ${initial.rng}`];

  out.push(`type alias Model =
    { ${modelFields.join("\n    , ")}
    }`);
  out.push(`init : Model
init =
    { ${initFields.join("\n    , ")}
    }`);

  // ---- messages
  const ctors = [];
  for (const m of g.messages.values()) {
    const c = g.cells.get(m.cell);
    const arg = m.kind === "input" || m.kind === "select" ? " String" : m.kind === "check" ? " Bool" : "";
    ctors.push(`${msgName(m)}${arg}`);
  }
  ctors.push("Load", "AddItem", "SetMarkup String", "SetQty Int String", "ToggleActive Int Bool", "SetNote Int String", "Remove Int");
  ctors.push("ServerInputs (Dict String Decode.Value)", "ServerItems (List Item) (List Int)", "Snapshot (Dict String Decode.Value) Int (List Item) Int Int", "Event Decode.Value");
  out.push(`type Msg
    = ${ctors.join("\n    | ")}`);

  // ---- update
  const branches = [];
  const upd = (pattern, body) => branches.push(`${pattern} ->\n${pad(body, 4)}`);
  for (const m of g.messages.values()) {
    const c = g.cells.get(m.cell);
    switch (m.kind) {
      case "input":
        U("onInt");
        upd(`${msgName(m)} typed`, `onInt ${c.min} ${c.max} typed model (\\n -> { model | ${c.name} = n })`);
        break;
      case "add":
        upd(msgName(m), `{ model | ${c.name} = clamp ${valueOf(c, c.min)} ${valueOf(c, c.max)} (model.${c.name} ${m.k < 0 ? "-" : "+"} ${Math.abs(m.k)}) }`);
        break;
      case "check": upd(`${msgName(m)} isOn`, `{ model | ${c.name} = isOn }`); break;
      case "select": upd(`${msgName(m)} chosen`, `{ model | ${c.name} = chosen }`); break;
    }
  }
  const rows = spec.options.rows;
  U("buildItems"); U("mapItem"); U("mergeItems"); U("onInt");
  upd("Load", `let\n    ( items, rng ) =\n        buildItems ${rows} model.nextId model.rng\nin\n{ model | items = items, nextId = model.nextId + ${rows}, rng = rng }`);
  upd("AddItem", `let\n    ( items, rng ) =\n        buildItems 1 model.nextId model.rng\nin\n{ model | items = model.items ++ items, nextId = model.nextId + 1, rng = rng }`);
  upd("SetMarkup typed", `onInt 0 100 typed model (\\n -> { model | markup = n })`);
  upd("SetQty id typed", `onInt 0 999 typed model (\\n -> { model | items = mapItem id (\\it -> { it | qty = n }) model.items })`);
  upd("ToggleActive id isOn", `{ model | items = mapItem id (\\it -> { it | active = isOn }) model.items }`);
  upd("SetNote id typed", `{ model | items = mapItem id (\\it -> { it | note = typed }) model.items }`);
  upd("Remove id", `{ model | items = List.filter (\\it -> it.id /= id) model.items }`);
  upd("ServerInputs values", `readInputs values model`);
  upd("ServerItems upsert gone", `{ model\n    | items = mergeItems upsert gone model.items\n    , nextId = List.foldl (\\it n -> max n (it.id + 1)) model.nextId upsert\n}`);
  upd("Snapshot values markup items nextId rng", `readInputs values { model | markup = markup, items = items, nextId = nextId, rng = rng }`);
  upd("Event json", `case Decode.decodeValue eventDecoder json of\n    Ok event ->\n        update event model\n\n    Err _ ->\n        model`);
  out.push(`update : Msg -> Model -> Model
update msg model =
    case msg of
${pad(branches.join("\n\n"), 8)}`);

  // ---- the external events
  U("field"); U("itemDecoder");
  out.push(inputs.length === 0
    ? `readInputs : Dict String Decode.Value -> Model -> Model
readInputs _ model =
    model`
    : `readInputs : Dict String Decode.Value -> Model -> Model
readInputs values model =
    { model
${inputs.map((c, i) => `        ${i === 0 ? "|" : ","} ${c.name} = field ${decoderOf(c)} ${elm(c.name)} values model.${c.name}`).join("\n")}
    }`);
  out.push(`eventDecoder : Decoder Msg
eventDecoder =
    Decode.field "type" Decode.string
        |> Decode.andThen
            (\\kind ->
                case kind of
                    "serverInputs" ->
                        Decode.map ServerInputs (Decode.field "values" (Decode.dict Decode.value))

                    "serverItems" ->
                        Decode.map2 ServerItems
                            (Decode.field "upsert" (Decode.list itemDecoder))
                            (Decode.field "remove" (Decode.list Decode.int))

                    "snapshot" ->
                        Decode.field "state"
                            (Decode.map5 Snapshot
                                (Decode.field "inputs" (Decode.dict Decode.value))
                                (Decode.field "markup" Decode.int)
                                (Decode.field "items" (Decode.list itemDecoder))
                                (Decode.field "nextId" Decode.int)
                                (Decode.field "rng" Decode.int)
                            )

                    _ ->
                        Decode.fail ("unknown event: " ++ kind)
            )`);

  // ---- the sheet's view: first the let, with every formula (and what an \`if\` needs) in order
  const keyFns = new Map();
  const defs = g.formulas.flatMap((f) => {
    const ctx = newCtx(f.name);
    const main = { head: f.name, body: body(f.expr, g, ctx) };
    if (ctx.keyFn) keyFns.set(f.name, ctx.keyFn);
    return [...ctx.defs, main];
  });
  const node = (n) => {
    switch (n.el) {
      case "text": {
        const pieces = n.parts.map((p) => {
          if (typeof p === "string") return elm(p);
          const c = g.cells.get(p[1]);
          const ref = c.kind === "input" ? `model.${c.name}` : c.name;
          if (p[0] === "count") return shownElm("plain", `List.length ${ref}`);
          if (p[0] === "at") { U("at"); return shownElm(c.format, `at ${elm(p[2])} ${ref}`); }
          if (c.type === "bool") return (U("words"), shownElm(null, ref, c.words));
          if (c.type === "num") {
            if (c.format === "grouped") U("grouped");
            if (c.format === "currency") U("money");
            return shownElm(c.format, ref);
          }
          return ref;
        });
        // merge neighbouring literals
        const merged = [];
        for (const piece of pieces) {
          const last = merged[merged.length - 1];
          if (last && last.startsWith('"') && piece.startsWith('"') && !piece.includes(" ++ ") && !last.includes(" ++ ")) merged[merged.length - 1] = last.slice(0, -1) + piece.slice(1);
          else merged.push(piece);
        }
        const content = merged.length === 1 && merged[0].startsWith('"') ? `text ${merged[0]}` : `text (${merged.join(" ++ ")})`;
        const tagFn = ["p", "span", "small", "strong", "em", "div"].includes(n.tag) ? H(n.tag) : null;
        H("text");
        return tagFn ? `${tagFn} [] [ ${content} ]` : `${H("node")} ${elm(n.tag)} [] [ ${content} ]`;
      }
      case "input": {
        const m = g.messages.get(n.msg), c = g.cells.get(m.cell);
        attrs.add("type_"); attrs.add("value"); events.add("onInput"); H("label"); H("input"); H("text");
        return `label [] [ text ${elm(n.label)}, input [ type_ "number", role ${elm(n.msg)}, value (String.fromInt model.${c.name}), onInput ${msgName(m)} ] [] ]`;
      }
      case "button": {
        const m = g.messages.get(n.msg);
        events.add("onClick"); H("button"); H("text");
        return `button [ role ${elm(n.msg)}, onClick ${msgName(m)} ] [ text ${elm(n.text)} ]`;
      }
      case "check": {
        const m = g.messages.get(n.msg), c = g.cells.get(m.cell);
        attrs.add("type_"); attrs.add("checked"); events.add("onCheck"); H("label"); H("input"); H("text");
        return `label [] [ input [ type_ "checkbox", role ${elm(n.msg)}, checked model.${c.name}, onCheck ${msgName(m)} ] [], text ${elm(n.label)} ]`;
      }
      case "select": {
        const m = g.messages.get(n.msg), c = g.cells.get(m.cell);
        events.add("onInput"); H("label"); H("select"); H("text"); U("options");
        const list = c.categories ? "categories" : stringList(c.options);
        if (c.categories) U("categories");
        return `label [] [ text ${elm(n.label)}, select [ role ${elm(n.msg)}, onInput ${msgName(m)} ] (options ${list} model.${c.name}) ]`;
      }
      case "top": {
        const c = g.cells.get(n.cell);
        H("li"); H("text");
        const key = keyFns.has(c.name) ? `${keyFns.get(c.name)} it` : elmExpr(c.expr[2], g, newCtx(c.name)).s;
        const shown = shownElm(c.format, key);
        return `Keyed.${n.tag} [ role ${elm(n.cell)} ] (List.map (\\it -> ( String.fromInt it.id, li [ dataKey (String.fromInt it.id), role ${elm(n.cell + "Item")} ] [ text (it.name ++ ": " ++ ${shown}) ] )) ${n.cell})`;
      }
      case "groups": {
        const c = g.cells.get(n.cell);
        H("li"); H("text");
        const shown = shownElm(c.format, "total");
        return `Keyed.ul [ role ${elm(n.cell)} ] (List.map (\\( category, total ) -> ( category, li [ dataKey category, role ${elm(n.cell + "Row")} ] [ text (category ++ ": " ++ ${shown}) ] )) ${n.cell})`;
      }
    }
    throw new Error(`unknown view node ${n.el}`);
  };

  const lets = defs.map(defText);
  const unitDivs = spec.units.map((u) => {
    const kids = u.view.map(node);
    H("div");
    return `${kids.map((k, i) => `${i === 0 ? "[ " : ", "}${k}`).join("\n")}\n]`;
  });
  // formulas are used by name; util helpers by their imports
  for (const f of g.formulas) usedHelpers(f.expr, U);
  for (const n of g.nodes) if (n.node.el === "top") usedHelpers(g.cells.get(n.node.cell).expr, U);
  util.add("money"); util.add("grouped");
  H("h2"); H("section"); H("text");
  out.push(`viewSheet : Model -> Html Msg
viewSheet model =
    let
${pad(lets.join("\n\n"), 8)}
    in
    section [ dataKey "sheet", role "sheet" ]
        [ h2 [] [ text ${elm(spec.title)} ]
${unitDivs.map((d) => `        , div []\n${pad(d, 12)}`).join("\n")}
        ]`);

  // ---- the items' view
  for (const n of ["button", "div", "h2", "input", "label", "li", "section", "table", "tbody", "td", "text", "th", "thead", "tr"]) H(n);
  for (const a of ["checked", "placeholder", "type_", "value"]) attrs.add(a);
  for (const e of ["onCheck", "onClick", "onInput"]) events.add(e);
  lazy.add("lazy2");
  util.add("fdiv"); util.add("money");
  const headers = ["Item", "Category", "Qty", "Price", "Line", "With markup", "Active", "Note", ""];
  out.push(`viewItems : Model -> Html Msg
viewItems model =
    section [ dataKey "items", role "items" ]
        [ h2 [] [ text ${elm(spec.itemsTitle)} ]
        , div []
            [ button [ role "load", onClick Load ] [ text ${elm(spec.loadText)} ]
            , button [ role "addItem", onClick AddItem ] [ text "Add item" ]
            , label [] [ text "Markup %", input [ type_ "number", role "markup", value (String.fromInt model.markup), onInput SetMarkup ] [] ]
            ]
        , table []
            [ thead [] [ tr [] [ ${headers.map((h) => `th [] [${h ? ` text ${elm(h)} ` : ""}]`).join(", ")} ] ]
            , Keyed.node "tbody" [] (List.map (\\it -> ( String.fromInt it.id, lazy2 viewRow model.markup it )) model.items)
            ]
        ]`);
  out.push(`viewRow : Int -> Item -> Html Msg
viewRow markup it =
    tr [ dataKey (String.fromInt it.id), role "item" ]
        [ td [] [ text it.name ]
        , td [] [ text it.category ]
        , td [] [ input [ type_ "number", role "qty", value (String.fromInt it.qty), onInput (SetQty it.id) ] [] ]
        , td [] [ text (money it.price) ]
        , td [] [ text (money (it.qty * it.price)) ]
        , td [] [ text (money (fdiv (it.qty * it.price * (100 + markup)) 100)) ]
        , td [] [ input [ type_ "checkbox", role "active", checked it.active, onCheck (ToggleActive it.id) ] [] ]
        , td [] [ input [ type_ "text", role "note", placeholder "Note", value it.note, onInput (SetNote it.id) ] [] ]
        , td [] [ button [ role "remove", onClick (Remove it.id) ] [ text "×" ] ]
        ]`);
  out.push(`view : Model -> Html Msg
view model =
    div [ role "page" ] [ viewSheet model, viewItems model ]`);

  // ---- the program
  out.push(`port events : (Decode.Value -> msg) -> Sub msg`);
  out.push(`main : Program () Model Msg
main =
    Browser.element
        { init = \\_ -> ( init, Cmd.none )
        , update = \\msg model -> ( update msg model, Cmd.none )
        , view = view
        , subscriptions = \\_ -> events Event
        }`);

  // The user-visible helpers a sheet uses.
  for (const name of ["groupSum", "sumBy"]) void name;

  const imports = [
    ["Browser", "import Browser"],
    ["Dict", "import Dict exposing (Dict)"],
    ["Html", `import Html exposing (${exposing(html)})`.replace("(Html,", "(Html,")],
    ["Html.Attributes", `import Html.Attributes exposing (${exposing(attrs)})`],
    ["Html.Events", `import Html.Events exposing (${exposing(events)})`],
    ["Html.Keyed", "import Html.Keyed as Keyed"],
    ["Html.Lazy", `import Html.Lazy exposing (${exposing(lazy)})`],
    ["Json.Decode", "import Json.Decode as Decode exposing (Decoder)"],
    ["Util", `import Util exposing (${exposing(util)})`],
  ].sort((x, y) => (x[0] < y[0] ? -1 : 1));
  return `port module Main exposing (main)

${imports.map((x) => x[1]).join("\n")}


${out.join("\n\n\n")}
`;
}

// The Util helpers an expression calls.
function usedHelpers(e, U) {
  if (!Array.isArray(e)) return;
  const byOp = { div: "fdiv", pct: "pct", sum: "sumBy", avg: "avgBy", maxOf: "maxBy", minOf: "minBy", top: "topBy", groupSum: "groupSum", at: "at" };
  if (byOp[e[0]]) U(byOp[e[0]]);
  if (e[0] === "k" || e[0] === "v" || e[0] === "i") return;
  for (let k = 1; k < e.length; k++) usedHelpers(e[k], U);
}

export function emit(spec) {
  const g = readGraph(spec);
  const template = templateFiles({ title: spec.title });
  const elmJson = JSON.parse(template["elm.json"]);
  delete elmJson.dependencies.direct["elm/regex"];
  const files = {
    ...template,
    "elm.json": JSON.stringify(elmJson, null, 4) + "\n",
    "src/Util.elm": utilModule(spec),
    "src/Main.elm": mainModule(spec, g),
  };
  return {
    files,
    style: {
      architecture: "TEA with Browser.element: one Model (a record field per input, items, markup, nextId, rng), one Msg (a constructor per control and per item control), one update (a case branch per message as record updates), one view",
      derived: "computed in view: viewSheet opens with a let binding every formula, in dependency order, to its own expression over model and the formulas above it, so each is computed once per view; the model caches nothing, update stays one-field record updates; every event recomputes every formula (Html.Lazy skips rows, not formulas)",
      rows: "Html.Keyed.node \"tbody\" with ( String.fromInt item.id, lazy2 viewRow model.markup item ); items replaced, never mutated, by mapItem id (a missing id is a no-op)",
      lists: "top-k lists and group sums as Html.Keyed lists (by item id, by category)",
      numbers: "Int throughout; division is floor (toFloat a / toFloat b) (fdiv), never // (32-bit); number input text applied by onInt only while an integer in range",
      externalEvents: "one incoming port events : (Value -> msg) -> Sub msg, decoded with Json.Decode into ServerInputs (Dict String Value, read per input by readInputs), ServerItems and Snapshot",
      helpers: "src/Util.elm (app code): Item, PRNG step and word pools, formatters, sumBy/avgBy/maxBy/minBy/topBy/groupSum, decoders, attribute helpers",
      formatting: "as elm-format 0.8.8 writes it (an if is a whole binding body, or bound to a name of its own); elm.json lists only the dependencies the app imports",
      build: "elm make --optimize, then uglify-js compress (pure_funcs) and mangle passes, as the Elm guide recommends",
    },
  };
}
