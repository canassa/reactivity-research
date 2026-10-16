// The derived-graph scenario written in beni: one source for both of beni's browser platforms
// (browser-tea and browser-direct; browser-direct's `Tea` is "the API of browser-tea's Tea, so one
// source builds on both"). The two emitters (scenarios/derived-graph/beni-tea.js and
// beni-direct.js) call `emitApp` with their own framework's template files. It lives in the
// scenario's shared folder, which every measurement's inputs hash covers.
//
// Style (recorded in every generated app's rr.json), following beni's README and getting-started
// guide, its language reference's rule for a `view`'s constant `let`s (docs/design/language.md
// §11.11: "a derived value"), and the architecture of the other scenarios' beni emitters:
// - The Elm Architecture with `Tea.element`, mounted with `Browser.mountAt` at the page's root:
//   one `Model` in `Main` (the sheet's inputs, and the items section's own model), one `update`,
//   one `view` written as markup.
// - **Derived values are computed in the view, not cached in the model.** Each formula is one
//   constant `let` of `view`, written as the expression the spec describes, in dependency order:
//   `dutyOwed = Num.pct grossSales model.inputs.taxRate`. beni treats a `let` that only markup
//   reads as a derived value (docs/design/browser-direct.md §5.4: a slot recomputed only by the
//   messages whose write set reaches what the `let` reads, in dependency order; browser-tea
//   guards each by the values it read). So every formula is computed once per change of its
//   inputs and read by as many displays as show it, with no cache for the program to keep in step
//   (a model field per formula would have to be recomputed by every `update` arm that can reach
//   it: N fields, N chains of calls). The model holds only state: the inputs and the items.
// - Formulas are the app's own code: arithmetic and comparisons inline, `Num.floorDiv` and
//   `Num.pct` for the floor division of the contract (beni's `//` truncates, and a value may be
//   negative), and generic collection helpers that take the formula's own code as a function
//   (`Agg.sumBy items λit → it.qty * it.price`, `Agg.topBy`, `Agg.groupSum`).
// - Inputs are controlled, as beni's are. A number input beside its number keeps the text typed
//   while it is not a number in range, as `Maybe String` field `<name>Draft` of the same record
//   (the derived codec reads a missing key as `Nothing`, so a snapshot drops every draft).
// - One module for the items section (`Items`: its Item and Model, Msg, the app's Park-Miller
//   builder written like js-framework-benchmark's, update, the server's item events, the table's
//   view); `Main` routes (`Html.map`), owns the sheet's inputs and every formula and display.
//   Generic helpers independent of any formula: `Rng`, `Fmt` (the number formats), `Num`, `Agg`.
// - Keyed `For` (.id) for the rows and the top-k lists, (.category) for the group rows.
// - External events arrive through the project's platform layer (`Push.onPush Pushed`, a
//   subscription; beni has no ports, frameworks/beni/template/Push.beni) as host values, read in
//   `update` with `schema` declarations tagged on "type". A list read from the host is copied
//   (`List.copy`) where the model takes it, as beni's ownership checker asks.
// - Production build: `beni build --release --source-maps` (frameworks/beni/beni.js).

import { beniString, beniValue } from "../../shared-components/shared/beni.js";

export const STYLE = {
  architecture: "The Elm Architecture: Tea.element, one Model in Main (inputs + the items section's model), one update, one view (markup)",
  derived: "each formula is a constant let of view, in dependency order (beni's derived values): computed once per change of what it reads, no cache in the model",
  formulas: "the spec's expression written out as beni code per formula (inline arithmetic, Num.floorDiv, Num.pct, Agg.sumBy/avgBy/maxBy/minBy/topBy/groupSum with the formula's own function)",
  inputs: "controlled; a number input keeps its typed text in a Maybe String field beside the number while it is not an integer in range",
  components: "Items (item type, model, messages, builder, update, server events, table view); Main owns the sheet; Rng, Fmt, Num, Agg generic helpers",
  routing: "one Msg constructor per sheet message, ItemsMsg wrapping Items.Msg (Html.map), Pushed for host events",
  lists: "keyed For for rows (.id), top-k lists (.id) and group rows (.category)",
  externalEvents: "project platform layer Push.onPush, read with schema declarations (Event tagged on type, Snapshot, Values with Maybe fields)",
  build: "beni build --release --source-maps (beni's own minifier)",
};

const cap = (s) => s[0].toUpperCase() + s.slice(1);
const IND = "    ";
const pad = (lines, n) => lines.map((l) => (l ? " ".repeat(n) + l : l));
const SAFE_TEXT = /^ ?(?:[A-Za-z0-9,.:;!?'()\-+/*%$#@=_]+ )*[A-Za-z0-9,.:;!?'()\-+/*%$#@=_]+ ?$/;
const raw = (text) => ({ raw: text });
const lit = (n) => (n < 0 ? `(${n})` : String(n));
const textPart = (s) => (SAFE_TEXT.test(s) ? s : `{${beniString(s)}}`);

// Names a cell or message must not take. A beni keyword is refused everywhere. A formula is a local
// of `view`, so it must not shadow a function or a variable the generated code uses (an input is a
// record field, which only the keywords forbid).
const KEYWORDS = new Set("if then else case of let in type alias pub opaque import as exposing foreign where schema tagged".split(" "));
const SHADOWS = new Set(
  ("min max abs not compare clamp floor toFloat identity always model msg value inputs it g item items view update " +
    "init main step pushed subscriptions snapshot serverInputs event state values typed option upsert").split(" "),
);
const TAKEN_CTORS = new Set(["Ok", "Err", "Just", "Nothing", "True", "False", "LT", "EQ", "GT", "Msg", "Model", "Pushed", "ItemsMsg"]);

// ---------------------------------------------------------------------------------------------
// Expressions: the spec's formula expression written as beni code. `{ s, p }`: the text and its
// precedence (0 if/lambda, 1 ||, 2 &&, 3 comparison, 4 + -, 5 *, 6 application, 7 atom).

const need = (x, p) => (x.p >= p ? x.s : `(${x.s})`);
const atom = (s) => ({ s, p: 7 });

function expression(spec, cells, e, item = "it") {
  const ex = (x) => expression(spec, cells, x, item);
  const arg = (x) => need(ex(x), 7);
  const lambda = (body) => `λ${item} → ${ex(body).s}`;
  const op = (sym, p, parts) => ({ s: parts.join(` ${sym} `), p });
  switch (e[0]) {
    case "k": return typeof e[1] === "string" ? atom(beniString(e[1])) : e[1] < 0 ? atom(`(${e[1]})`) : atom(String(e[1]));
    case "v": {
      const c = cells.get(e[1]);
      return atom(c.kind === "input" ? `model.inputs.${c.name}` : c.name);
    }
    case "i": return atom(`${item}.${e[1]}`);
    case "items": return atom("model.stock.items");
    case "+": return op("+", 4, e.slice(1).map((x, i) => need(ex(x), i ? 5 : 4)));
    case "-": return op("-", 4, [need(ex(e[1]), 4), need(ex(e[2]), 5)]);
    case "*": return op("*", 5, [need(ex(e[1]), 5), need(ex(e[2]), 6)]);
    case "div": return { s: `Num.floorDiv ${arg(e[1])} ${arg(e[2])}`, p: 6 };
    case "pct": return { s: `Num.pct ${arg(e[1])} ${arg(e[2])}`, p: 6 };
    case "min": case "max": {
      const args = e.slice(1).map(ex);
      const nest = (list) => (list.length === 1 ? list[0].s : `${e[0]} ${need(list[0], 7)} ${need({ s: nest(list.slice(1)), p: list.length > 2 ? 6 : list[1].p }, 7)}`);
      return { s: nest(args), p: args.length === 1 ? args[0].p : 6 };
    }
    case "abs": return { s: `abs ${arg(e[1])}`, p: 6 };
    case "if": return { s: `if ${need(ex(e[1]), 1)} then ${need(ex(e[2]), 1)} else ${ex(e[3]).s}`, p: 0 };
    case "<": case "<=": case ">": case ">=": case "==": case "!=": {
      const sym = { "<": "<", "<=": "≤", ">": ">", ">=": "≥", "==": "==", "!=": "≠" }[e[0]];
      return op(sym, 3, [need(ex(e[1]), 4), need(ex(e[2]), 4)]);
    }
    case "and": return op("&&", 2, e.slice(1).map((x) => need(ex(x), 3)));
    case "or": return op("||", 1, e.slice(1).map((x) => need(ex(x), 2)));
    case "not": return { s: `not ${arg(e[1])}`, p: 6 };
    case "count": return { s: `List.length ${arg(e[1])}`, p: 6 };
    case "sum": return { s: `Agg.sumBy ${arg(e[1])} ${lambda(e[2])}`, p: 0 };
    case "avg": return { s: `Agg.avgBy ${arg(e[1])} ${lambda(e[2])}`, p: 0 };
    case "maxOf": return { s: `Agg.maxBy ${arg(e[1])} ${lambda(e[2])}`, p: 0 };
    case "minOf": return { s: `Agg.minBy ${arg(e[1])} ${lambda(e[2])}`, p: 0 };
    case "filter": return { s: `List.filter ${arg(e[1])} ${lambda(e[2])}`, p: 0 };
    case "top": return { s: `Agg.topBy ${arg(e[1])} ${e[4]} Agg.${cap(e[3])} ${lambda(e[2])}`, p: 0 };
    case "groupSum": return { s: `Agg.groupSum ${arg(e[1])} ${lambda(e[2])}`, p: 0 };
    case "at": return { s: `Agg.at ${arg(e[1])} ${beniString(e[2])}`, p: 6 };
  }
  throw new Error(`beni emitter: unknown expression ${JSON.stringify(e)}`);
}

// ---------------------------------------------------------------------------------------------
// Cells

const beniType = (c) => {
  if (c.kind === "input") return { num: "Int", bool: "Bool", enum: "String" }[c.type];
  return { num: "Int", bool: "Bool", text: "String", list: "List Items.Item", top: "List Items.Item", group: "List Agg.Share" }[c.type];
};

// A number as the page shows it: the text of a hole's content.
function formatted(format, x) {
  const a = need(x, 7);
  switch (format) {
    case "plain": return x.s;
    case "grouped": return `Fmt.grouped ${a}`;
    case "currency": return `Fmt.money ${a}`;
    case "pct": return `Fmt.percent ${a}`;
  }
  throw new Error(`beni emitter: unknown number format ${format}`);
}

// One part of a display's text: a string, or a read of a cell.
function textPartHole(cells, part, refOf) {
  if (typeof part === "string") return textPart(part);
  const c = cells.get(part[1]);
  const ref = refOf(c);
  if (part[0] === "count") return `{List.length ${need(ref, 7)}}`;
  if (part[0] === "at") return `{${formatted(c.format, { s: `Agg.at ${need(ref, 7)} ${beniString(part[2])}`, p: 6 })}}`;
  if (c.type === "num") return `{${formatted(c.format, ref)}}`;
  if (c.type === "bool") return `{if ${ref.s} then ${beniString(c.words[0])} else ${beniString(c.words[1])}}`;
  return `{${ref.s}}`;
}

// An element at column `ind`, laid out on one line when it fits in 100 columns.
function element(tag, attrs, content, ind) {
  const width = 100 - ind;
  const attrText = attrs.length ? " " + attrs.join(" ") : "";
  if (content === null) {
    const flat = `<${tag}${attrText} />`;
    if (flat.length <= width) return [flat];
    return [`<${tag}`, ...attrs.map((a) => IND + a), "/>"];
  }
  if (typeof content === "string") {
    const flat = `<${tag}${attrText}>${content}</${tag}>`;
    if (flat.length <= width) return [flat];
    if (!attrs.length) return [`<${tag}>`, IND + content, `</${tag}>`];
    return [`<${tag}`, ...attrs.map((a) => IND + a), ">", IND + content, `</${tag}>`];
  }
  const open = `<${tag}${attrText}>`;
  if (open.length <= width) return [open, ...pad(content, 4), `</${tag}>`];
  return [`<${tag}`, ...attrs.map((a) => IND + a), ">", ...pad(content, 4), `</${tag}>`];
}

// ---------------------------------------------------------------------------------------------
// The sheet

function sheetCells(spec) {
  const cells = new Map();
  for (const u of spec.units) {
    for (const c of u.inputs) cells.set(c.name, { ...c, kind: "input" });
    cells.set(u.cell.name, { ...u.cell, kind: "formula" });
  }
  return cells;
}

const hasDraft = (spec, c) => spec.units.some((u) => u.messages.some((m) => m.cell === c.name && m.kind === "input"));
const draftOf = (c) => `${c.name}Draft`;

function checkNames(spec) {
  const seen = new Set();
  const names = [];
  const local = new Set();
  for (const u of spec.units) {
    for (const c of u.inputs) names.push(c.name, `${c.name}Draft`);
    names.push(u.cell.name);
    local.add(u.cell.name);
    for (const m of u.messages) names.push(m.name);
  }
  for (const n of names) {
    if (KEYWORDS.has(n) || (local.has(n) && SHADOWS.has(n))) throw new Error(`beni emitter: the name ${n} is reserved in the generated source`);
    if (seen.has(n)) throw new Error(`beni emitter: the name ${n} is used twice`);
    seen.add(n);
  }
  const ctors = new Set();
  for (const u of spec.units) {
    for (const m of u.messages) {
      const k = cap(m.name);
      if (TAKEN_CTORS.has(k) || ctors.has(k)) throw new Error(`beni emitter: constructor ${k} is taken`);
      ctors.add(k);
    }
  }
}

// The `Inputs` record, its initial value, and the update arm of every message.
function inputsDecl(spec) {
  const lines = [];
  for (const u of spec.units) {
    for (const c of u.inputs) {
      lines.push(`    ${c.name} : ${beniType(c)}`);
      if (hasDraft(spec, c)) lines.push(`    ${draftOf(c)} : Maybe String`);
    }
  }
  return `pub type alias Inputs =\n${lines.join("\n")}`;
}

function inputsInit(spec) {
  const fields = [];
  for (const u of spec.units) {
    for (const c of u.inputs) {
      fields.push([c.name, spec.initialState.inputs[c.name]]);
      if (hasDraft(spec, c)) fields.push([draftOf(c), raw("Nothing")]);
    }
  }
  return Object.fromEntries(fields);
}

function messageArm(spec, cells, m) {
  const c = cells.get(m.cell);
  const set = (fields) => {
    const flat = `{ model | inputs = { inputs | ${fields.map(([k, v]) => `${k} = ${v}`).join(", ")} } }`;
    return flat.length + 12 <= 100 ? [flat] : ["{ model", `${IND}| inputs =`, `${IND}${IND}{ inputs`, ...fields.map(([k, v], i) => `${IND}${IND}${IND}${i ? ", " : "| "}${k} = ${v}`), `${IND}${IND}}`, "}"];
  };
  const withInputs = (body) => ["inputs = model.inputs", ...body];
  const ctor = cap(m.name);
  switch (m.kind) {
    case "input":
      return [`${ctor} typed →`, ...pad([
        "inputs = model.inputs",
        `case Num.within ${lit(c.min)} ${lit(c.max)} typed of`,
        `${IND}Just value →`,
        ...pad(set([[c.name, "value"], [draftOf(c), "Nothing"]]), 8),
        "",
        `${IND}Nothing →`,
        ...pad(set([[draftOf(c), "Just typed"]]), 8),
      ], 4)];
    case "add": {
      const next = `clamp (inputs.${c.name} ${m.k < 0 ? "-" : "+"} ${Math.abs(m.k)}) ${lit(c.min)} ${lit(c.max)}`;
      const fields = [[c.name, next]];
      if (hasDraft(spec, c)) fields.push([draftOf(c), "Nothing"]);
      return [`${ctor} →`, ...pad(withInputs(set(fields)), 4)];
    }
    case "check": return [`${ctor} →`, ...pad(withInputs(set([[c.name, `not inputs.${c.name}`]])), 4)];
    case "select": return [`${ctor} option →`, ...pad(withInputs(set([[c.name, "option"]])), 4)];
  }
  throw new Error(`beni emitter: unknown message kind ${m.kind}`);
}

// The sheet's markup: one `<div>` per unit.
function unitView(spec, cells, u) {
  const ref = (c) => atom(c.kind === "input" ? `model.inputs.${c.name}` : c.name);
  const out = [];
  const msgCell = (name) => cells.get(u.messages.find((m) => m.name === name)?.cell ?? spec.units.flatMap((x) => x.messages).find((m) => m.name === name).cell);
  const valueOf = (c) => (hasDraft(spec, c)
    ? `Maybe.withDefault model.inputs.${draftOf(c)} (String.fromInt model.inputs.${c.name})`
    : `String.fromInt model.inputs.${c.name}`);
  for (const n of u.view) {
    switch (n.el) {
      case "text": {
        const content = n.parts.map((p) => textPartHole(cells, p, ref)).join("");
        out.push(...element(n.tag, [], content, 8));
        break;
      }
      case "input": {
        const c = msgCell(n.msg);
        const input = element("input", ['type="number"', `data-role=${beniString(n.msg)}`, `value={${valueOf(c)}}`, `onInput={${cap(n.msg)}}`], null, 12);
        out.push(...labelWith(n.label, input, 8));
        break;
      }
      case "button": out.push(...element("button", [`data-role=${beniString(n.msg)}`, `onClick={${cap(n.msg)}}`], textPart(n.text), 8)); break;
      case "check": {
        const c = msgCell(n.msg);
        const input = element("input", ['type="checkbox"', `data-role=${beniString(n.msg)}`, `checked={model.inputs.${c.name}}`, `onClick={${cap(n.msg)}}`], null, 12);
        out.push(...labelAround(input, n.label, 8));
        break;
      }
      case "select": {
        const c = msgCell(n.msg);
        const options = c.options.map((o) => `<option value=${beniString(o)}>${textPart(o)}</option>`);
        const select = element("select", [`data-role=${beniString(n.msg)}`, `value={model.inputs.${c.name}}`, `onInput={${cap(n.msg)}}`], options, 12);
        out.push(...labelWith(n.label, select, 8));
        break;
      }
      case "top": {
        const c = cells.get(n.cell);
        const key = formatted(c.format, expression(spec, cells, c.expr[2], "it"));
        const li = element("li", ['data-key={String.fromInt it.id}', `data-role=${beniString(`${n.cell}Item`)}`], `{it.name}: {${key}}`, 16);
        out.push(...element(n.tag, [`data-role=${beniString(n.cell)}`], [`<For each={${n.cell}} keyed={.id}>`, ...pad([`{λit →`, ...pad(li, 4), "}"], 4), "</For>"], 8));
        break;
      }
      case "groups": {
        const c = cells.get(n.cell);
        const li = element("li", ["data-key={g.category}", `data-role=${beniString(`${n.cell}Row`)}`], `{g.category}: {${formatted(c.format, atom("g.total"))}}`, 16);
        out.push(...element("ul", [`data-role=${beniString(n.cell)}`], [`<For each={${n.cell}} keyed={.category}>`, ...pad([`{λg →`, ...pad(li, 4), "}"], 4), "</For>"], 8));
        break;
      }
      default: throw new Error(`beni emitter: unknown view node ${n.el}`);
    }
  }
  return ["<div>", ...pad(out, 4), "</div>"];
}

// `<label>text{control}</label>`, and `<label>{control}text</label>`.
function labelWith(text, control, ind) {
  const flat = `<label>${textPart(text)}${control.length === 1 ? control[0] : ""}</label>`;
  if (control.length === 1 && flat.length <= 100 - ind) return [flat];
  return ["<label>", ...pad([textPart(text), ...control], 4), "</label>"];
}
function labelAround(control, text, ind) {
  const flat = `<label>${control.length === 1 ? control[0] : ""}${textPart(text)}</label>`;
  if (control.length === 1 && flat.length <= 100 - ind) return [flat];
  return ["<label>", ...pad([...control, textPart(text)], 4), "</label>"];
}

function mainModule(spec) {
  const cells = sheetCells(spec);
  checkNames(spec);
  const units = spec.units;
  const messages = units.flatMap((u) => u.messages);
  const inputsList = units.flatMap((u) => u.inputs);
  const out = [];

  const none = inputsList.length === 0; // N = 1: the first unit has no input
  out.push(`--! ${spec.title}: a planning sheet of ${units.length} formula${units.length === 1 ? "" : "s"} over ${inputsList.length} input${inputsList.length === 1 ? "" : "s"}
--! and a table of line items, in The Elm Architecture. The model holds the inputs and the items;
--! every formula is a \`let\` of \`view\`, computed from them, and every display reads one.

@@IMPORTS@@


main : Tea.Program
main =
    Browser.mountAt
        (Tea.element { init = init, update = update, view = view, subscriptions = subscriptions })
        "root"`);

  out.push(`-- ---- Model ---------------------------------------------------------------------


${none ? "" : inputsDecl(spec) + "\n\n\n"}type alias Model =
${none ? "" : "    inputs : Inputs\n"}    stock : Items.Model`);

  const init = none ? { stock: raw("Items.init ⊤") } : { inputs: inputsInit(spec), stock: raw("Items.init ⊤") };
  const initText = beniValue(init, "      ");
  out.push(`init : ⊤ → Model × Cmd Msg
init ⊤ =
    ( ${initText}
    , Cmd.none
    )`);

  const ctors = [
    ...messages.map((m) => {
      const k = cap(m.name);
      return m.kind === "input" || m.kind === "select" ? `${k} String` : k;
    }),
    "ItemsMsg Items.Msg",
    "Pushed Value",
  ];
  out.push(`-- ---- Update --------------------------------------------------------------------


type Msg
    = ${ctors.join("\n    | ")}`);
  out.push(`update : Msg, Model → Model × Cmd Msg
update msg model = ( step msg model, Cmd.none )`);
  const arms = messages.map((m) => messageArm(spec, cells, m).join("\n"));
  arms.push(`ItemsMsg itemsMsg →\n    { model | stock = Items.update itemsMsg model.stock }`);
  arms.push(`Pushed value →\n    pushed value model`);
  out.push(`step : Msg, Model → Model
step msg model =
    case msg of
${pad(arms.join("\n\n").split("\n"), 8).join("\n")}`);

  // External events
  out.push(`-- ---- External events -----------------------------------------------------------


subscriptions : Model → Sub Msg
subscriptions _ = Push.onPush Pushed`);
  out.push(`--| What the host pushes: new input values, changed items, or a new state.
schema Event tagged "type" of
    ServerInputs as "serverInputs"
        values : Value
    ServerItems as "serverItems"
        upsert : Value
        remove : List Int
    Snapshot as "snapshot"
        state : Value`);
  if (!none) out.push(`--| The inputs a server push names; the others are left as they are.
type alias Values =
${inputsList.map((c) => `    ${c.name} : Maybe ${beniType(c)}`).join("\n")}`);
  out.push(`--| A whole state: ${none ? "" : "the inputs, "}the markup and the items.
type alias State =
${none ? "" : "    inputs : Inputs\n"}    markup : Int
    items : List Items.Item
    nextId : Int
    rng : Int`);

  const apply = inputsList.flatMap((c) => {
    const l = [`${c.name} = Maybe.withDefault values.${c.name} inputs.${c.name}`];
    if (hasDraft(spec, c)) l.push(`${draftOf(c)} = Num.settle values.${c.name} inputs.${draftOf(c)}`);
    return l;
  });
  out.push(`pushed : Value, Model → Model
pushed value model =
    case Schema.read (Event.schema ⊤) value of
        Ok (Event.ServerInputs event) →
${none ? "            model" : `            case Json.decodeValue event.values of
                Ok values →
                    { model | inputs = serverInputs values model.inputs }

                Err _ →
                    model`}

        Ok (Event.ServerItems event) →
            case Json.decodeValue event.upsert of
                Ok upsert →
                    { model | stock = Items.serverItems upsert event.remove model.stock }

                Err _ →
                    model

        Ok (Event.Snapshot event) →
            case Json.decodeValue event.state of
                Ok state →
                    snapshot state

                Err _ →
                    model

        Err _ →
            model`);
  out.push(`snapshot : State → Model
snapshot state =
    { ${none ? "" : "inputs = state.inputs\n    , "}stock = Items.snapshot state.markup state.items state.nextId state.rng
    }`);
  if (!none) out.push(`--| Each named input takes the pushed value, and drops what was typed in it.
serverInputs : Values, Inputs → Inputs
serverInputs values inputs =
    { inputs
        | ${apply.join("\n        , ")}
    }`);

  // View
  const lets = units.map((u) => {
    const c = u.cell;
    const e = expression(spec, cells, c.expr, "it");
    const one = `${c.name} = ${e.s}`;
    return one.length <= 100 ? one : `${c.name} =\n${IND}${e.s}`;
  });
  const sheet = units.flatMap((u) => unitView(spec, cells, u));
  out.push(`-- ---- View ----------------------------------------------------------------------


view : Model → Html Msg
view model =
${pad(lets.flatMap((l) => l.split("\n")), 4).join("\n")}
    <div data-role="page">
        <section data-key="sheet" data-role="sheet">
            <h2>${textPart(spec.title)}</h2>
${pad(sheet, 12).join("\n")}
        </section>
        {Html.map (Items.view model.stock) ItemsMsg}
    </div>`);
  const body = out.join("\n\n\n") + "\n";
  const used = (mod) => body.includes(`${mod}.`);
  const imports = [
    "Agg", "Browser", "Cmd exposing (Cmd)", "Fmt", "Html exposing (Html)", "Items", "Json", "Num", "Push",
    "Schema exposing (Value)", "Sub exposing (Sub)", "Tea",
  ].filter((i) => !["Agg", "Fmt", "Num"].includes(i) || used(i));
  return body.replace("@@IMPORTS@@", imports.map((i) => `import ${i}`).join("\n"));
}

// ---------------------------------------------------------------------------------------------
// The items section

function itemsModule(spec) {
  const init = spec.initialState;
  const item = (it) => ({ ...it, qtyDraft: raw("Nothing") });
  const initial = { markup: init.markup, markupDraft: raw("Nothing"), items: init.items.map(item), nextId: init.nextId, rng: init.rng };
  const initFlat = beniValue(initial, "");
  const pool = (name, words) => {
    const flat = beniValue(words, "");
    return `${name} : List String\n${name} ${flat.length + name.length + 3 <= 100 && !flat.includes("\n") ? `= ${flat}` : `=\n    ${beniValue(words, "    ")}`}`;
  };
  const rows = spec.options.rows;
  const row = [
    "<tr data-key={String.fromInt item.id} data-role=\"item\">",
    "    <td>{item.name}</td>",
    "    <td>{item.category}</td>",
    "    <td>",
    "        <input",
    "            type=\"number\"",
    "            data-role=\"qty\"",
    "            value={Maybe.withDefault item.qtyDraft (String.fromInt item.qty)}",
    "            onInput={Qty item.id _}",
    "        />",
    "    </td>",
    "    <td>{Fmt.money item.price}</td>",
    "    <td>{Fmt.money (item.qty * item.price)}</td>",
    "    <td>{Fmt.money (item.qty * item.price * (100 + model.markup) // 100)}</td>",
    "    <td><input type=\"checkbox\" data-role=\"active\" checked={item.active} onClick={Active item.id} /></td>",
    "    <td>",
    "        <input",
    "            type=\"text\"",
    "            data-role=\"note\"",
    "            placeholder=\"Note\"",
    "            value={item.note}",
    "            onInput={Note item.id _}",
    "        />",
    "    </td>",
    "    <td><button data-role=\"remove\" onClick={Remove item.id}>×</button></td>",
    "</tr>",
  ];
  const parts = [];
  parts.push(`--! The items section: the table of line items, its toolbar and the markup every row reads.
--! An item's quantity and the markup are number inputs, controlled, so each keeps what was typed
--! in a \`Maybe String\` beside its number while that text is not a whole number in range.

import Fmt
import Html exposing (Html)
import Num
import Rng`);
  parts.push(`pub type alias Item =
    id : Int
    name : String
    category : String
    qty : Int
    price : Int
    active : Bool
    note : String
    qtyDraft : Maybe String


pub type alias Model =
    markup : Int
    markupDraft : Maybe String
    items : List Item
    nextId : Int
    rng : Int`);
  parts.push(pool("adjectives", spec.itemWords.adjectives));
  parts.push(pool("nouns", spec.itemWords.nouns));
  parts.push(`pub ${pool("categories", spec.categories)}`);
  parts.push(`pub init : ⊤ → Model\n${initFlat.length + 9 <= 100 && !initFlat.includes("\n") ? `init ⊤ = ${initFlat}` : `init ⊤ =\n    ${beniValue(initial, "    ")}`}`);
  parts.push(`pub type Msg
    = Load
    | AddItem
    | Markup String
    | Qty Int String
    | Active Int
    | Note Int String
    | Remove Int`);
  parts.push(`--| \`count\` items from the generator \`seed\`, their ids from \`id\`: the name, category, quantity, price and
--| whether it is active are one Park-Miller draw each.
build : Int, Int, Int → List Item × Int
build count id seed = buildFrom id (id + count) seed []


buildFrom : Int, Int, Int, List Item → List Item × Int
buildFrom id stop seed items =
    if id ≥ stop then
        ( items, seed )
    else
        s1 = Rng.next seed
        s2 = Rng.next s1
        s3 = Rng.next s2
        s4 = Rng.next s3
        s5 = Rng.next s4
        s6 = Rng.next s5
        buildFrom (id + 1) stop s6
            [ …items
            , { id = id
              , name = "\${Rng.pick adjectives s1} \${Rng.pick nouns s2}"
              , category = Rng.pick categories s3
              , qty = 1 + Int.mod s4 99
              , price = 100 + Int.mod s5 9900
              , active = Int.mod s6 4 ≠ 0
              , note = ""
              , qtyDraft = Nothing
              }
            ]`);
  parts.push(`pub update : Msg, Model → Model
update msg model =
    case msg of
        Load →
            ( items, seed ) = build ${rows} model.nextId model.rng
            { model | items = items, nextId = model.nextId + ${rows}, rng = seed }

        AddItem →
            ( added, seed ) = build 1 model.nextId model.rng
            { model | items = model.items ++ added, nextId = model.nextId + 1, rng = seed }

        Markup typed →
            case Num.within 0 100 typed of
                Just markup →
                    { model | markup = markup, markupDraft = Nothing }

                Nothing →
                    { model | markupDraft = Just typed }

        Qty id typed →
            case Num.within 0 999 typed of
                Just qty →
                    { model
                        | items =
                            List.map model.items λitem →
                                if item.id == id then { item | qty = qty, qtyDraft = Nothing } else item
                    }

                Nothing →
                    { model
                        | items =
                            List.map model.items λitem →
                                if item.id == id then { item | qtyDraft = Just typed } else item
                    }

        Active id →
            { model
                | items =
                    List.map model.items λitem →
                        if item.id == id then { item | active = not item.active } else item
            }

        Note id typed →
            { model
                | items =
                    List.map model.items λitem →
                        if item.id == id then { item | note = typed } else item
            }

        Remove id →
            { model | items = List.filter model.items λitem → item.id ≠ id }`);
  parts.push(`find : List Item, Int → Maybe Item
find items id =
    case items of
        [] →
            Nothing

        [ item, …rest ] →
            if item.id == id then Just item else find rest id


--| The server changed some items: those it names are replaced where they stand, new ones are
--| appended, and the removed ones go.
pub serverItems : List Item, List Int, Model → Model
serverItems upsert remove model =
    kept = List.filter model.items λitem → not (List.member remove item.id)
    replaced = List.map kept λitem → Maybe.withDefault (find upsert item.id) item
    fresh =
        List.filter upsert λitem →
            not (List.member remove item.id) && find model.items item.id == Nothing
    { model
        | items = List.copy replaced ++ fresh
        , nextId = List.foldl upsert model.nextId λitem next → max next (item.id + 1)
    }


--| The state the server sent: the markup and the items, with nothing typed.
pub snapshot : Int, List Item, Int, Int → Model
snapshot markup items nextId rng =
    { markup = markup
    , markupDraft = Nothing
    , items = List.copy items
    , nextId = nextId
    , rng = rng
    }`);
  parts.push(`pub view : Model → Html Msg
view model =
    <section data-key="items" data-role="items">
        <h2>${textPart(spec.itemsTitle)}</h2>
        <div>
            <button data-role="load" onClick={Load}>${textPart(spec.loadText)}</button>
            <button data-role="addItem" onClick={AddItem}>Add item</button>
            <label>
                Markup %
                <input
                    type="number"
                    data-role="markup"
                    value={Maybe.withDefault model.markupDraft (String.fromInt model.markup)}
                    onInput={Markup}
                />
            </label>
        </div>
        <table>
            <thead>
                <tr>
                    <th>Item</th>
                    <th>Category</th>
                    <th>Qty</th>
                    <th>Price</th>
                    <th>Line</th>
                    <th>With markup</th>
                    <th>Active</th>
                    <th>Note</th>
                    <th />
                </tr>
            </thead>
            <tbody>
                <For each={model.items} keyed={.id}>
                    {λitem →
${pad(row, 24).join("\n")}
                    }
                </For>
            </tbody>
        </table>
    </section>`);
  return parts.join("\n\n\n") + "\n";
}

// ---------------------------------------------------------------------------------------------
// Helper modules (independent of every formula)

const RNG_MODULE = `--! What the item builder shares: the Park-Miller generator and a pick from a word list.

--| One step of the Park-Miller generator: every product stays below 2^47, so an
--| \`Int\` holds it exactly.
pub next : Int → Int
next seed = Int.mod (seed * 48271) 2147483647


--| A word of the list, by a draw.
pub pick : List String, Int → String
pick words draw = List.get words (Int.mod draw (List.length words)) ▷ Maybe.withDefault ""
`;

const fmtModule = (spec) => `--! How numbers are shown, with no locale: a comma every three digits, cents as a price, a whole
--! percent.

symbol : String
symbol = ${beniString(spec.currency)}


--| A non-negative number with a comma every three digits.
group : Int → String
group n =
    if n < 1000 then
        String.fromInt n
    else
        "\${group (n // 1000)},\${threeDigits (Int.mod n 1000)}"


threeDigits : Int → String
threeDigits n =
    if n < 10 then
        "00\${n}"
    else if n < 100 then
        "0\${n}"
    else
        String.fromInt n


--| A number with a comma every three digits.
pub grouped : Int → String
grouped n = if n < 0 then "-\${group (0 - n)}" else group n


--| Cents as a price, with the currency symbol.
pub money : Int → String
money cents =
    sign = if cents < 0 then "-" else ""
    a = abs cents
    rest = Int.mod a 100
    zero = if rest < 10 then "0" else ""
    "\${sign}\${symbol}\${group (a // 100)}.\${zero}\${rest}"


--| A whole percent.
pub percent : Int → String
percent n = "\${n}%"
`;

const NUM_MODULE = `--! Whole numbers: the floor division the sheet's formulas use, and reading a typed number.

--| Division rounded down. \`//\` rounds towards zero, which differs for a negative number.
pub floorDiv : Int, Int → Int
floorDiv a b = floor (toFloat a / toFloat b)


--| A percent of a number, rounded down.
pub pct : Int, Int → Int
pct a percent = floorDiv (a * percent) 100


--| What was typed, if it is a whole number between the two limits.
pub within : Int, Int, String → Maybe Int
within low high typed =
    case String.toInt typed of
        Just n →
            if n ≥ low && n ≤ high then Just n else Nothing

        Nothing →
            Nothing


--| What was typed in an input stays, unless a value arrived for it.
pub settle : Maybe a, Maybe String → Maybe String
settle arrived typed =
    case arrived of
        Just _ →
            Nothing

        Nothing →
            typed
`;

const AGG_MODULE = `--! Collections: what a formula over the items shares, each taking the formula's own code as a
--! function.

import Items
import Num


--| The order of a top-k list.
pub type Dir
    = Asc
    | Desc


--| One category's total.
pub type alias Share =
    category : String
    total : Int


pub sumBy : List a, (a → Int) → Int
sumBy items value = List.foldl items 0 λitem sum → sum + value item


--| The mean rounded down; 0 for no items.
pub avgBy : List a, (a → Int) → Int
avgBy items value =
    if List.isEmpty items then 0 else Num.floorDiv (sumBy items value) (List.length items)


--| The largest value; 0 for no items.
pub maxBy : List a, (a → Int) → Int
maxBy items value =
    case items of
        [] →
            0

        [ first, …rest ] →
            List.foldl rest (value first) λitem best → max best (value item)


--| The smallest value; 0 for no items.
pub minBy : List a, (a → Int) → Int
minBy items value =
    case items of
        [] →
            0

        [ first, …rest ] →
            List.foldl rest (value first) λitem best → min best (value item)


--| The first \`k\` items by a value, ties by id whichever way it runs.
pub topBy : List Items.Item, Int, Dir, (Items.Item → Int) → List Items.Item
topBy items k dir value =
    List.take (List.sortWith items λa b → tie (order dir (value a) (value b)) a.id b.id) k


order : Dir, Int, Int → Order
order dir a b =
    case dir of
        Asc →
            compare a b

        Desc →
            compare b a


tie : Order, Int, Int → Order
tie by a b =
    case by of
        EQ →
            compare a b

        _ →
            by


--| A total of the items per category, in the categories' order.
pub groupSum : List Items.Item, (Items.Item → Int) → List Share
groupSum items value =
    List.map Items.categories λcategory →
        { category = category
        , total = sumBy items λitem → if item.category == category then value item else 0
        }


--| One category's total; 0 for a category not listed.
pub at : List Share, String → Int
at shares category =
    case shares of
        [] →
            0

        [ share, …rest ] →
            if share.category == category then share.total else at rest category
`;

// ---------------------------------------------------------------------------------------------
// The app

export function emitApp(spec, templateFiles) {
  const files = {
    ...templateFiles({ name: `rr-derivedgraph-n${spec.options.size}-s${spec.options.seed}`, title: `derived-graph n=${spec.options.size} seed=${spec.options.seed}` }),
    "src/Main.beni": mainModule(spec),
    "src/Items.beni": itemsModule(spec),
    "src/Rng.beni": RNG_MODULE,
    "src/Fmt.beni": fmtModule(spec),
    "src/Num.beni": NUM_MODULE,
    "src/Agg.beni": AGG_MODULE,
  };
  // A section's heading comment is followed by one blank line, as `beni fmt` writes it.
  for (const [name, text] of Object.entries(files)) {
    if (name.endsWith(".beni")) files[name] = text.replace(/^(-- ---- .*)\n\n\n/gm, "$1\n\n");
  }
  return { files, style: STYLE };
}
