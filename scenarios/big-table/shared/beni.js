// The big-table scenario written in beni: one source for both of beni's browser platforms
// (browser-tea and browser-direct; browser-direct's `Tea` is "the API of browser-tea's Tea, so
// one source builds on both"). The two emitters (scenarios/big-table/beni-tea.js and
// beni-direct.js) call `emitApp` with their own framework's template files. It lives in the
// scenario's shared folder, which every measurement's inputs hash covers.
//
// Style (recorded in every generated app's rr.json), following beni's own js-framework-benchmark
// app (beni/bench/ui/apps/beni/Main.beni and bench/jfb/frameworks/keyed/beni-*), beni's README
// and getting-started guide, and the architecture of the other scenarios' beni emitters:
// - The Elm Architecture with `Tea.element`, mounted with `Browser.mountAt` at the page's root:
//   one `Model` record in `Main` holding every table's state (one field per table), one `update`,
//   one `view` written as markup.
// - One module per table (`Table.T1`, `Table.T2`, ...), each written for that table alone: its own
//   `Row` and `Model` (`rows`, `selected`, `nextId`, `rng`), `init`, `Msg` (one constructor per
//   toolbar operation and per row control), `update` (one case arm per message), its own row
//   builder (`build`, the Park-Miller draws of its columns in order, written out like
//   js-framework-benchmark's `buildData`), the external events (`serverRows`, `serverUpdate`,
//   `serverDelete`, `replace` for a snapshot) and `view` (markup, the row written inline in the
//   keyed `For`, every cell and computed expression written out in place). Table 1 is
//   js-framework-benchmark's app in beni: its word lists, `Run`/`RunLots`/`Add`/`Update`/`Clear`/
//   `SwapRows`/`Select`/`Remove`, built in the spirit of beni's own `Main.beni` (which swaps with `List.indexedMap`; this uses `List.swap`).
// - Operations are written the way a developer writes them: a new list built from `model.rows`
//   (`List.indexedMap` for every k-th row, `List.swap`, `List.sortWith` with a comparison, a
//   filter, `++` for append). Nothing is a table that a routine interprets.
// - `Main` only routes: one `Msg` constructor per table wrapping the table's `Msg`
//   (`Html.map` in `view`, one-line branches in `update`), the pushed events and the schema.
// - Three small generic modules independent of every table: `Rng` (the Park-Miller step and a
//   pick from a word list), `Fmt` (the thousands grouping, the number and date formatters) and
//   `Change` / `Sort` (a keyed change list applied to rows, the id tie-break of a sort).
// - Keyed `For` (.id) for the rows; the selection marker is a `class` hole (or, for tables whose
//   marker is `aria-selected`, see ARIA below); computed cells are expressions in the markup.
// - External events arrive through the project's platform layer (`Push.onPush Pushed`, a
//   subscription; beni has no ports, frameworks/beni/template/Push.beni) as host values. `update`
//   reads one with a `schema` declaration (`Event`, tagged on "type") and hands the table it names
//   its part, which the table reads with a derived codec. A list read from the host is copied
//   (`List.copy`) where the model takes it, as beni's ownership checker asks (browser-direct
//   edits lists in place); decoding in `update`, rather than in the subscription's function, is
//   also what that checker accepts.
// - ARIA (a dead end for now, counted at N=1 only): the language and both lowerings support a
//   `Maybe String` attribute, removed on `Nothing` (beni docs/design/language.md, Rt.beni, Direct.beni),
//   which is what a marker absent when unselected needs. The blocker is the shipped vocabulary:
//   platforms/html/Html.beni declares `pub attribute "aria-*" : String`, a project cannot add its own
//   declaration (the chain uses a single vocabulary module, boundary.md) and element spread is
//   deferred. An upstream one-line change, `pub attribute "aria-selected" : Maybe String` (the exact
//   name outranks the wildcard), plus a new compiler pin, would let this emitter write a single
//   `<tr aria-selected={if ... then Just "true" else Nothing}>`. Until then a table whose marker is
//   `aria-selected` writes the row's cells once (`cells row`, a fragment) and the `<tr>` twice, in an
//   `if` hole on the selection; selecting such a row replaces its `<tr>`, which `./rr check` reports
//   as a replaced keyed node. See notes/2026-10-16-beni-big-table.md.
// - Production build: `beni build --release --source-maps` (frameworks/beni/beni.js).

import { beniString, beniValue } from "../../shared-components/shared/beni.js";

export const STYLE = {
  architecture: "The Elm Architecture: Tea.element, one Model record in Main, one update, one view (markup)",
  components: "one module per table (Row, Model, Msg, init, build, update, server events, view); Main only routes",
  table1: "js-framework-benchmark's app as beni's own Main.beni writes it: Park-Miller draws in a recursive buildFrom, List.indexedMap, List.swap, a keyed For",
  operations: "a new list from model.rows per operation (indexedMap, swap, sortWith, filter, ++); the selection read in the row (class hole)",
  routing: "one Msg constructor per table wrapping its Msg, plus Pushed for host events; Html.map in view",
  lists: "keyed For (.id) for the rows; the row's markup inline in the For",
  helpers: "Rng (next, pick), Fmt (group, unit, currency, percent, dates), Change (find, patch), Sort (tie, flag): independent of every table",
  externalEvents: "project platform layer Push.onPush (Sub.on over a window event), read with a schema declaration and derived codecs",
  ariaMarker: "a table whose marker is aria-selected writes its <tr> in two branches of an if hole (cells shared): the platform has no absent String attribute",
  build: "beni build --release --source-maps (beni's own minifier)",
};

const cap = (s) => s[0].toUpperCase() + s.slice(1);
const num = (t) => Number(t.id.slice(1));
const mod = (t) => `T${num(t)}`;

// Constructor names a table's operations and controls must not take (the prelude's).
const TAKEN_CTORS = new Set(["Ok", "Err", "Just", "Nothing", "True", "False", "LT", "EQ", "GT", "Msg", "Model", "Row"]);
const RESERVED = new Set("if then else case of let in type alias pub opaque import as exposing foreign".split(" "));
const IND = "    ";
const pad = (lines, n) => lines.map((l) => (l ? " ".repeat(n) + l : l));
const SAFE_TEXT = /^[A-Za-z0-9,.:;!?'()\-+/*%$#@=_]+(?: [A-Za-z0-9,.:;!?'()\-+/*%$#@=_]+)*$/;
const raw = (text) => ({ raw: text });

// Text in markup: plain when it is safe, else a string hole.
const textPart = (s) => (SAFE_TEXT.test(s) ? s : `{${beniString(s)}}`);

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

// A record update `{ base | a = x, b = y }`, on one line when it fits at `indent`, else one field
// per line with leading separators, as `beni fmt` writes it.
function recordSet(base, fields, indent) {
  const flat = `{ ${base} | ${fields.map(([k, v]) => `${k} = ${v}`).join(", ")} }`;
  if (flat.length + indent <= 100 && !flat.includes("\n")) return [flat];
  const lines = fields.flatMap(([k, v], i) => {
    const lead = i ? ", " : "| ";
    if (v.includes("\n")) {
      const [first, ...rest] = v.split("\n");
      return [`${lead}${k} =`, IND + first, ...rest.map((l) => IND + l)];
    }
    const one = `${lead}${k} = ${v}`;
    if (indent + 4 + one.length <= 100) return [one];
    return [`${lead}${k} =`, IND + v];
  });
  return [`{ ${base}`, ...pad(lines, 4), "}"];
}

// A record value, on one line when it fits at `indent`, else one field per line.
function recordFlat(fields, indent) {
  const flat = `{ ${fields.map(([k, v]) => `${k} = ${v}`).join(", ")} }`;
  if (flat.length + indent <= 100) return flat;
  return fields.map(([k, v], i) => `${i ? ", " : "{ "}${k} = ${v}`).join("\n" + " ".repeat(indent)) + "\n" + " ".repeat(indent) + "}";
}

// ---------------------------------------------------------------------------------------------
// A table's pieces

const dataOf = (t) => t.columns.filter((c) => ["label", "text", "number", "date", "status", "flag"].includes(c.kind));
const typeOfColumn = (c) => ({ label: "String", text: "String", number: "Int", date: "Int", status: "String", flag: "Bool" })[c.kind];
const colOf = (t, name) => t.columns.find((c) => c.name === name);

// The names of a table's word lists: table 1 keeps js-framework-benchmark's.
function poolNames(t, c) {
  if (t.id === "t1") return ["adjectives", "colours", "nouns"];
  if (c.kind === "label") return c.pools.map((_, i) => `${c.name}Words${i + 1}`);
  if (c.kind === "status") return [`${c.name}Options`];
  return [`${c.name}Words`];
}

function poolDecls(t) {
  const out = [];
  for (const c of t.columns) {
    if (c.kind === "label") c.pools.forEach((p, i) => out.push([poolNames(t, c)[i], p]));
    else if (c.kind === "text") out.push([poolNames(t, c)[0], c.pool]);
    else if (c.kind === "status") out.push([poolNames(t, c)[0], c.options]);
  }
  return out.map(([name, words]) => {
    const flat = beniValue(words, "");
    return `${name} : List String\n${name} ${flat.length + name.length + 3 <= 100 && !flat.includes("\n") ? `= ${flat}` : `=\n    ${beniValue(words, "    ")}`}`;
  });
}

// The row builder: one Park-Miller step per generated cell, in column order (a label: one per
// pool), then the id.
function buildDecls(t) {
  const data = dataOf(t);
  const draws = [];
  const fields = [["id", "id"]];
  let k = 0;
  const s = () => `s${++k}`;
  const prev = () => (k === 0 ? "seed" : `s${k}`);
  for (const c of data) {
    switch (c.kind) {
      case "label": {
        const names = poolNames(t, c);
        const words = c.pools.map((_, i) => {
          const v = s();
          draws.push(`${v} = Rng.next ${k === 1 ? "seed" : `s${k - 1}`}`);
          return `\${Rng.pick ${names[i]} ${v}}`;
        });
        fields.push([c.name, `"${words.join(" ")}"`]);
        break;
      }
      case "text": { const v = s(); draws.push(`${v} = Rng.next ${k === 1 ? "seed" : `s${k - 1}`}`); fields.push([c.name, `Rng.pick ${poolNames(t, c)[0]} ${v}`]); break; }
      case "status": { const v = s(); draws.push(`${v} = Rng.next ${k === 1 ? "seed" : `s${k - 1}`}`); fields.push([c.name, `Rng.pick ${poolNames(t, c)[0]} ${v}`]); break; }
      case "number": { const v = s(); draws.push(`${v} = Rng.next ${k === 1 ? "seed" : `s${k - 1}`}`); fields.push([c.name, `${c.min} + Int.mod ${v} ${c.max - c.min + 1}`]); break; }
      case "date": { const v = s(); draws.push(`${v} = Rng.next ${k === 1 ? "seed" : `s${k - 1}`}`); fields.push([c.name, `1 + Int.mod ${v} 365`]); break; }
      case "flag": { const v = s(); draws.push(`${v} = Rng.next ${k === 1 ? "seed" : `s${k - 1}`}`); fields.push([c.name, `Int.mod ${v} 2 == 1`]); break; }
    }
  }
  const last = prev();
  const record = `{ ${fields.map(([n, v]) => `${n} = ${v}`).join(", ")} }`;
  const call = `buildFrom (id + 1) stop ${last}`;
  const flat = `${call} [ …rows, ${record} ]`;
  const next = flat.length + 8 <= 100
    ? [flat]
    : [call, `${IND}[ …rows`, ...(record.length + 14 <= 100 ? [`${IND}, ${record}`] : recordMulti(fields).map((l) => IND + l)), `${IND}]`];
  return [
    `build : Int, Int, Int → List Row × Int\nbuild count id seed = buildFrom id (id + count) seed []`,
    `buildFrom : Int, Int, Int, List Row → List Row × Int\nbuildFrom id stop seed rows =\n    if id ≥ stop then\n        ( rows, seed )\n    else\n${pad([...draws, "", ...next].map((l, i, a) => l), 8).join("\n")}`,
  ];
}

// A record literal one field per line, as `beni fmt` writes one inside a list: the first line
// carries the list's `, `.
function recordMulti(fields) {
  return fields.flatMap(([n, v], i) => {
    const lead = i === 0 ? ", { " : "  , ";
    const one = `${lead}${n} = ${v}`;
    if (8 + 4 + one.length <= 100) return [one];
    return [`${lead}${n} =`, `  ${IND}${v}`];
  }).concat("  }");
}

// ---------------------------------------------------------------------------------------------
// Cells

function numberText(c, v, need) {
  // `v` is a bare access or an expression; `need` says whether it is an argument position.
  const arg = need && !/^[\w.]+$/.test(v) ? `(${v})` : v;
  switch (c.format) {
    case "plain": return { text: v, fmt: null };
    case "grouped": return { text: `Fmt.group ${arg}`, fmt: "Fmt" };
    case "unit": return { text: `Fmt.unit ${arg} ${beniString(c.unit)}`, fmt: "Fmt" };
    case "currency": return { text: `Fmt.currency ${beniString(c.symbol)} ${arg}`, fmt: "Fmt" };
    case "percent": return { text: `Fmt.percent ${arg}`, fmt: "Fmt" };
  }
  throw new Error(`beni emitter: unknown number format ${c.format}`);
}

// A computed expression over the row, as beni source (a hole's content).
function computedHole(c, ctx) {
  const e = c.expr;
  switch (e[0]) {
    case "*": { const n = numberText(c, `row.${e[1]} * row.${e[2]}`, true); if (n.fmt) ctx.fmt = true; return n.text; }
    case "+": { const n = numberText(c, `row.${e[1]} + row.${e[2]}`, true); if (n.fmt) ctx.fmt = true; return n.text; }
    case "len": return `String.length row.${e[1]}`;
    case "if": {
      const cond = e[1];
      const test = cond[0] === ">" ? `row.${cond[1]} > ${cond[2]}` : cond[0] === "==" ? `row.${cond[1]} == ${beniString(cond[2])}` : `row.${cond[1]}`;
      return `if ${test} then ${beniString(e[2])} else ${beniString(e[3])}`;
    }
  }
  throw new Error(`beni emitter: unknown expression ${JSON.stringify(e)}`);
}

// One `<td>` (lines), at column `ind`.
function cell(t, c, ctx, ind) {
  const td = (content, attrs = []) => element("td", attrs, content, ind);
  const link = (role, content) => element("a", [`data-role=${beniString(role)}`, `onClick={${cap(role)} row.id}`], content, ind + 4);
  switch (c.kind) {
    case "id": return td("{row.id}");
    case "label": case "text": {
      if (!c.select) return td(`{row.${c.name}}`);
      const a = link(c.select, `{row.${c.name}}`);
      return td(a.length === 1 ? a[0] : a);
    }
    case "number": {
      const n = numberText(c, `row.${c.name}`, true);
      if (n.fmt) ctx.fmt = true;
      return td(`{${n.text}}`);
    }
    case "date": ctx.fmt = true; return td(`{Fmt.${{ "mon-d": "monD", "d-mon": "dMon", "mm-dd": "mmDd" }[c.format]} row.${c.name}}`);
    case "status": return td(`<${c.tag}>{row.${c.name}}</${c.tag}>`);
    case "flag": {
      const input = element("input", [`type="checkbox"`, `data-role=${beniString(c.toggle)}`, `checked={row.${c.name}}`, `onClick={${cap(c.toggle)} row.id}`], null, ind + 4);
      return td(input.length === 1 ? input[0] : input);
    }
    case "computed": return td(`{${computedHole(c, ctx)}}`);
    case "remove": {
      const inner = c.glyph ? `<span aria-hidden="true">${textPart(c.text)}</span>` : textPart(c.text);
      const a = element(c.element, [`data-role=${beniString(c.role)}`, `onClick={${cap(c.role)} row.id}`], inner, ind + 4);
      return td(a.length === 1 ? a[0] : a);
    }
    case "bump": {
      const b = element("button", [`data-role=${beniString(c.role)}`, `onClick={${cap(c.role)} row.id}`], textPart(c.text), ind + 4);
      return td(b.length === 1 ? b[0] : b);
    }
    case "spacer": return ["<td />"];
  }
  throw new Error(`beni emitter: unknown column kind ${c.kind}`);
}

// ---------------------------------------------------------------------------------------------
// The table module

// A column whose name is a beni keyword (`alias`) is a field with a suffix; its table declares
// `schema Row` so the host's key still reads as the field. Returns the table with names mapped,
// and the (field, key) pairs renamed.
function renamed(t, initial) {
  const safe = (n) => (RESERVED.has(n) ? `${n}Col` : n);
  const pairs = t.columns.filter((c) => c.name && safe(c.name) !== c.name).map((c) => [safe(c.name), c.name]);
  if (!pairs.length) return { t, initial, pairs };
  const expr = (e) => {
    switch (e[0]) {
      case "*": case "+": return [e[0], safe(e[1]), safe(e[2])];
      case "len": return [e[0], safe(e[1])];
      case "if": return ["if", e[1][0] === ">" || e[1][0] === "==" ? [e[1][0], safe(e[1][1]), e[1][2]] : [e[1][0], safe(e[1][1])], e[2], e[3]];
    }
    return e;
  };
  const columns = t.columns.map((c) => ({
    ...c,
    ...(c.name ? { name: safe(c.name) } : {}),
    ...(c.column ? { column: safe(c.column) } : {}),
    ...(c.expr ? { expr: expr(c.expr) } : {}),
    ...(c.name && safe(c.name) !== c.name ? { key: c.name } : {}),
  }));
  const ops = t.ops.map((o) => (o.column ? { ...o, column: safe(o.column) } : o));
  const rows = initial.rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [safe(k), v])));
  return { t: { ...t, columns, ops }, initial: { ...initial, rows }, pairs };
}

function tableModule(t0, initial0) {
  const { t, initial, pairs } = renamed(t0, initial0);
  const data = dataOf(t);
  const keyOf = (c) => c.key ?? c.name;
  const ctx = { fmt: false };
  const ctorsSeen = new Set();
  const ctor = (name) => {
    const n = cap(name);
    if (TAKEN_CTORS.has(n) || ctorsSeen.has(n)) throw new Error(`beni emitter: ${t.id} constructor ${n} is taken`);
    ctorsSeen.add(n);
    return n;
  };
  const hasKind = (k) => t.ops.some((o) => o.kind === k);
  const ops = t.ops;
  const controls = [];
  for (const c of t.columns) {
    if (c.select) controls.push({ kind: "select", role: c.select, column: c.name });
    if (c.toggle) controls.push({ kind: "toggle", role: c.toggle, column: c.name });
    if (c.kind === "remove") controls.push({ kind: "remove", role: c.role });
    if (c.kind === "bump") controls.push({ kind: "bump", role: c.role, column: c.column, delta: c.delta });
  }
  const statusAfter = new Set(ops.filter((o) => o.kind === "updateEvery" && colOf(t, o.column).kind === "status").map((o) => o.column));
  const statusRank = new Set(ops.filter((o) => o.kind === "sort" && o.column !== "id" && colOf(t, o.column).kind === "status").map((o) => o.column));

  // View first: it finds the helper modules the table uses.
  const markerAria = t.marker && t.marker.attr === "aria-selected";
  const cellsAt = (ind) => t.columns.flatMap((c) => cell(t, c, ctx, ind));
  const rowAttrs = [`data-key={String.fromInt row.id}`, `data-role="row"`];
  const view = viewLines(t, ctx, rowAttrs, markerAria, cellsAt, ops);

  const imports = ["import Html exposing (Html)", "import Json", "import Rng", "import Schema exposing (Value)"];
  imports.push("import Change");
  if (ctx.fmt) imports.push("import Fmt");
  if (hasKind("sort")) imports.push("import Sort");
  imports.sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));

  const out = [];
  out.push(`--! ${t.title}: ${t.columns.length} columns, ${ops.length} operations, ${controls.length} row control${controls.length === 1 ? "" : "s"}.\n\n${imports.join("\n")}`);

  out.push(pairs.length
    ? `pub schema RowJson =\n    id : Int\n${data.map((c) => `    ${c.name} : ${typeOfColumn(c)}${c.key ? ` as ${beniString(c.key)}` : ""}`).join("\n")}\n\n\npub type alias Row =\n    RowJson.Type\n\n\nschema Wire =\n    rows : Value`
    : `pub type alias Row =\n    id : Int\n${data.map((c) => `    ${c.name} : ${typeOfColumn(c)}`).join("\n")}`);
  out.push(`pub type alias Model =\n    rows : List Row\n    selected : Maybe Int\n    nextId : Int\n    rng : Int`);

  for (const decl of poolDecls(t)) out.push(decl);

  const init = { rows: initial.rows, selected: raw("Nothing"), nextId: initial.nextId, rng: initial.rng };
  const initFlat = beniValue(init, "");
  out.push(`pub init : ⊤ → Model\n${initFlat.length + 9 <= 100 && !initFlat.includes("\n") ? `init ⊤ = ${initFlat}` : `init ⊤ =\n    ${beniValue(init, "    ")}`}`);

  const ctors = [...ops.map((o) => ctor(o.name)), ...controls.map((c) => `${ctor(c.role)} Int`)];
  out.push(`pub type Msg\n    = ${ctors.join("\n    | ")}`);

  out.push(...buildDecls(t));

  // Helpers some operations need.
  for (const name of statusAfter) {
    const c = colOf(t, name);
    const arms = c.options.slice(0, -1).flatMap((o, i) => [`${beniString(o)} →`, `    ${beniString(c.options[i + 1])}`, ""]);
    out.push(`${name}After : String → String\n${name}After status =\n    case status of\n${pad([...arms, "_ →", `    ${beniString(c.options[0])}`], 8).join("\n")}`);
  }
  for (const name of statusRank) {
    const c = colOf(t, name);
    const arms = c.options.slice(1).flatMap((o, i) => [`${beniString(o)} →`, `    ${i + 1}`, ""]);
    out.push(`${name}Rank : String → Int\n${name}Rank status =\n    case status of\n${pad([...arms, "_ →", "    0"], 8).join("\n")}`);
  }
  {
    out.push(`kept : Maybe Int, List Row → Maybe Int\nkept selected rows =\n    case selected of\n        Just id →\n            if List.any rows λrow → row.id == id then selected else Nothing\n\n        Nothing →\n            Nothing`);
  }

  // update
  const arms = [];
  for (const o of ops) arms.push(`${cap(o.name)} →\n${pad(opBody(t, o), 4).join("\n")}`);
  for (const c of controls) arms.push(`${cap(c.role)} id →\n${pad(controlBody(t, c), 4).join("\n")}`);
  out.push(`pub update : Msg, Model → Model\nupdate msg model =\n    case msg of\n${pad(arms.join("\n\n").split("\n"), 8).join("\n")}`);

  // External events.
  // A table with a keyword column reads its rows through the declared schema (the host's key
  // stays "alias"), the rest of its state through the derived codec.
  const decodeRows = pairs.length ? "Schema.read (Schema.list (RowJson.schema ⊤)) value" : "Json.decodeValue value";
  const replaceBody = pairs.length
    ? `    case Schema.read (Wire.schema ⊤) state of
        Ok wire →
            case Schema.read (Schema.list (RowJson.schema ⊤)) wire.rows of
                Ok rows →
                    case Json.decodeValue state of
                        Ok rest →
                            { model
                                | rows = List.copy rows
                                , selected = rest.selected
                                , nextId = rest.nextId
                                , rng = rest.rng
                            }

                        Err _ →
                            model

                Err _ →
                    model

        Err _ →
            model`
    : `    case Json.decodeValue state of
        Ok new →
            ${recordFlat([["rows", "List.copy new.rows"], ["selected", "new.selected"], ["nextId", "new.nextId"], ["rng", "new.rng"]], 12)}

        Err _ →
            model`;
  out.push(`--| The page of rows the server sent: the rows replaced, the selection kept if its row is still there.\npub serverRows : Value, Model → Model\nserverRows value model =\n    case ${decodeRows} of\n        Ok rows →\n            { model\n                | rows = List.copy rows\n                , selected = kept model.selected rows\n                , nextId = List.foldl rows model.nextId λrow highest → max (row.id + 1) highest\n            }\n\n        Err _ →\n            model`);

  const colArms = data.map((c) =>
    `${beniString(keyOf(c))} →\n    case Json.decodeValue changes of\n        Ok list →\n${pad(recordSet("model", [["rows", `Change.patch model.rows list .id λrow value → { row | ${c.name} = value }`]], 20), 12).join("\n")}\n\n        Err _ →\n            model`);
  out.push(`--| Rows' new values in one column, by id; an id that is not here is ignored.\npub serverUpdate : String, Value, Model → Model\nserverUpdate column changes model =\n    case column of\n${pad([...colArms.join("\n\n").split("\n"), "", "_ →", "    model"], 8).join("\n")}`);

  out.push(`--| Rows deleted elsewhere: dropped, and the selection with them.\npub serverDelete : List Int, Model → Model\nserverDelete ids model =\n    { model\n        | rows = List.filter model.rows λrow → not (List.member ids row.id)\n        , selected =\n            case model.selected of\n                Just id →\n                    if List.member ids id then Nothing else model.selected\n\n                Nothing →\n                    Nothing\n    }`);

  out.push(`--| The state the host sent, or the model as it was when it sent none.\npub replace : Value, Model → Model\nreplace state model =\n${replaceBody}`);

  out.push(view);
  return out.join("\n\n\n") + "\n";
}

// ---------------------------------------------------------------------------------------------
// Operations

function opBody(t, o) {
  switch (o.kind) {
    case "create":
      return [
        `( rows, seed ) = build ${o.count} model.nextId model.rng`,
        ...recordSet("model", [["rows", "rows"], ["selected", "Nothing"], ["nextId", `model.nextId + ${o.count}`], ["rng", "seed"]], 12),
      ];
    case "append":
      return [
        `( rows, seed ) = build ${o.count} model.nextId model.rng`,
        ...recordSet("model", [["rows", "model.rows ++ rows"], ["nextId", `model.nextId + ${o.count}`], ["rng", "seed"]], 12),
      ];
    case "updateEvery": {
      const c = colOf(t, o.column);
      const cur = `row.${c.name}`;
      const effect = {
        label: `${cur} ++ ${beniString(o.suffix)}`, text: `${cur} ++ ${beniString(o.suffix)}`,
        number: `${cur} + ${o.delta}`, date: `Int.mod (${cur} - 1 + ${o.days}) 365 + 1`,
        status: `${c.name}After ${cur}`, flag: `not ${cur}`,
      }[c.kind];
      const one = `if Int.mod i ${o.k} == 0 then { row | ${c.name} = ${effect} } else row`;
      const body = one.length + 24 <= 100 ? [one] : [`if Int.mod i ${o.k} == 0 then`, `${IND}{ row | ${c.name} = ${effect} }`, "else", `${IND}row`];
      return ["{ model", `${IND}| rows =`, `${IND}${IND}List.indexedMap model.rows λi row →`, ...pad(body, 12), "}"];
    }
    case "clear": return ["{ model | rows = [], selected = Nothing }"];
    case "swap":
      return [`if List.length model.rows > ${o.j} then`, `${IND}{ model | rows = List.swap model.rows ${o.i} ${o.j} }`, "else", `${IND}model`];
    case "sort": {
      const [x, y] = o.dir === "asc" ? ["a", "b"] : ["b", "a"];
      let compare;
      if (o.column === "id") compare = `compare ${x}.id ${y}.id`;
      else {
        const c = colOf(t, o.column);
        const k = (v) => `${v}.${c.name}`;
        compare = {
          label: `String.compare ${k(x)} ${k(y)}`, text: `String.compare ${k(x)} ${k(y)}`,
          number: `compare ${k(x)} ${k(y)}`, date: `compare ${k(x)} ${k(y)}`,
          status: `compare (${c.name}Rank ${k(x)}) (${c.name}Rank ${k(y)})`,
          flag: `compare (Sort.flag ${k(x)}) (Sort.flag ${k(y)})`,
        }[c.kind];
      }
      const sorted = `List.sortWith model.rows λa b → Sort.tie (${compare}) a.id b.id`;
      return recordSet("model", [["rows", sorted.length + 20 <= 100 ? sorted : `List.sortWith model.rows λa b →\n${IND}Sort.tie (${compare}) a.id b.id`]], 12);
    }
    case "removeChecked":
      return [`rows = List.filter model.rows λrow → not row.${o.column}`, ...recordSet("model", [["rows", "rows"], ["selected", "kept model.selected rows"]], 12)];
  }
  throw new Error(`beni emitter: unknown operation ${o.kind}`);
}

function controlBody(t, c) {
  switch (c.kind) {
    case "select": return ["{ model | selected = Just id }"];
    case "remove":
      return recordSet("model", [
        ["rows", "List.filter model.rows λrow → row.id ≠ id"],
        ["selected", "if model.selected == Just id then Nothing else model.selected"],
      ], 12);
    case "toggle": case "bump": {
      const f = c.column;
      const v = c.kind === "toggle" ? `not row.${f}` : `row.${f} + ${c.delta}`;
      return ["{ model", `${IND}| rows =`, `${IND}${IND}List.map model.rows λrow →`, `${IND}${IND}${IND}if row.id == id then { row | ${f} = ${v} } else row`, "}"];
    }
  }
  throw new Error(`beni emitter: unknown control ${c.kind}`);
}

// ---------------------------------------------------------------------------------------------
// The view

function viewLines(t, ctx, rowAttrs, markerAria, cellsAt, ops) {
  const buttons = ops.flatMap((o) => element("button", [`data-role=${beniString(o.name)}`, `onClick={${cap(o.name)}}`], textPart(o.text), 12));
  const head = t.thead
    ? ["<thead>", ...pad(["<tr>", ...pad(t.columns.flatMap((c) => (c.header === "" ? ["<th />"] : [`<th>${textPart(c.header)}</th>`])), 4), "</tr>"], 4), "</thead>"]
    : [];
  const marker = t.marker;
  let row;
  if (!marker) {
    row = ["{λrow →", ...pad(["<tr " + rowAttrs.join(" ") + ">", ...pad(cellsAt(28), 4), "</tr>"], 4), "}"];
  } else if (marker.attr === "class") {
    const attrs = [...rowAttrs, `class={if model.selected == Just row.id then ${beniString(marker.value)} else ""}`];
    row = ["{λrow →", ...pad(openClose("tr", attrs, cellsAt(28), 24), 4), "}"];
  } else {
    // aria-selected: see ARIA at the top of this file.
    row = ["{λrow →", ...pad([
      "if model.selected == Just row.id then",
      ...pad(openClose("tr", [...rowAttrs, `aria-selected="true"`], ["{cells row}"], 28), 4),
      "else",
      ...pad(openClose("tr", rowAttrs, ["{cells row}"], 28), 4),
    ], 4), "}"];
  }
  const body = [
    `<section data-key=${beniString(t.id)} data-role="table">`,
    ...pad(element("h2", [], textPart(t.title), 8), 4),
    "    <div>",
    ...pad(buttons, 8),
    "    </div>",
    "    <table>",
    ...pad(head, 8),
    "        <tbody>",
    '            <For each={model.rows} keyed={.id}>',
    ...pad(row, 16),
    "            </For>",
    "        </tbody>",
    "    </table>",
    "</section>",
  ];
  let text = `pub view : Model → Html Msg\nview model =\n${pad(body, 4).join("\n")}`;
  if (markerAria) {
    const cells = ["<>", ...pad(cellsAt(8), 4), "</>"];
    text = `cells : Row → Html Msg\ncells row =\n${pad(cells, 4).join("\n")}\n\n\n${text}`;
  }
  return text;
}

// An element opened with attributes, laid out multi-line when its opening tag does not fit.
function openClose(tag, attrs, content, ind) {
  const open = `<${tag} ${attrs.join(" ")}>`;
  if (open.length + ind <= 100) return [open, ...pad(content, 4), `</${tag}>`];
  return [`<${tag}`, ...attrs.map((a) => IND + a), ">", ...pad(content, 4), `</${tag}>`];
}

// ---------------------------------------------------------------------------------------------
// Helper modules (independent of every table)

const RNG_MODULE = `--! What every table's row builder shares, independent of any one of them.

--| One step of the Park-Miller generator: every product stays below 2^47, so an
--| \`Int\` holds it exactly.
pub next : Int → Int
next seed = Int.mod (seed * 48271) 2147483647


--| A word of the list, by a draw.
pub pick : List String, Int → String
pick words draw = List.get words (Int.mod draw (List.length words)) ▷ Maybe.withDefault ""
`;

const FMT_MODULE = `--! How numbers and dates are shown, independent of any one table: no locale, so
--! every platform writes them alike.

monthDays : List Int
monthDays = [ 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31 ]


monthNames : List String
monthNames = [ "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec" ]


--| A number with a comma every three digits.
pub group : Int → String
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


twoDigits : Int → String
twoDigits n = if n < 10 then "0\${n}" else String.fromInt n


--| A number and its unit.
pub unit : Int, String → String
unit n suffix = "\${group n} \${suffix}"


--| Cents as a price with a currency symbol.
pub currency : String, Int → String
currency symbol cents = "\${symbol}\${group (cents // 100)}.\${twoDigits (Int.mod cents 100)}"


--| Tenths of a percent.
pub percent : Int → String
percent tenths = "\${group (tenths // 10)}.\${Int.mod tenths 10}%"


-- The month (from 0) and the day of the month of a day of the year (1 to 365).
monthAndDay : Int, Int → Int × Int
monthAndDay day month =
    case List.get monthDays month of
        Just length →
            if day > length then monthAndDay (day - length) (month + 1) else ( month, day )

        Nothing →
            ( 11, day )


monthName : Int → String
monthName month = List.get monthNames month ▷ Maybe.withDefault ""


--| \`Mar 14\`
pub monD : Int → String
monD day =
    ( month, dayOfMonth ) = monthAndDay day 0
    "\${monthName month} \${dayOfMonth}"


--| \`14 Mar\`
pub dMon : Int → String
dMon day =
    ( month, dayOfMonth ) = monthAndDay day 0
    "\${dayOfMonth} \${monthName month}"


--| \`03-14\`
pub mmDd : Int → String
mmDd day =
    ( month, dayOfMonth ) = monthAndDay day 0
    "\${twoDigits (month + 1)}-\${twoDigits dayOfMonth}"
`;

const CHANGE_MODULE = `--! Changes the server sent, by row id, independent of any one table.

--| A new value for the row with this id.
pub type alias Change a =
    id : Int
    value : a


--| The value a change list holds for an id, if it holds one.
pub find : List (Change a), Int → Maybe a
find changes id =
    case changes of
        [] →
            Nothing

        [ change, …rest ] →
            if change.id == id then Just change.value else find rest id


--| The rows with each change applied to the row it names. A list that names an id twice
--| applies the first (the reference applies the last); the generated events never do.
pub patch : List row, List (Change a), (row → Int), (row, a → row) → List row
patch rows changes idOf set = List.map rows λrow →
    case find changes (idOf row) of
        Just value →
            set row value

        Nothing →
            row
`;

const SORT_MODULE = `--! What a sort shares, independent of any one table.

--| An order, broken by the rows' ids when it is a tie.
pub tie : Order, Int, Int → Order
tie order a b =
    case order of
        EQ →
            compare a b

        _ →
            order


--| False before true.
pub flag : Bool → Int
flag value = if value then 1 else 0
`;

// ---------------------------------------------------------------------------------------------
// Main

function mainModule(spec) {
  const tables = spec.tables;
  const wname = (t) => t.id;
  const ctor = (t) => `${mod(t)}Msg`;
  const out = [];

  const imports = [
    "import Browser", "import Cmd exposing (Cmd)", "import Html exposing (Html)", "import Push",
    "import Schema exposing (Value)", "import Sub exposing (Sub)", "import Tea",
    ...tables.map((t) => `import Table.${mod(t)} as ${mod(t)}`),
  ].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  out.push(`--! The page: ${tables.length} table${tables.length === 1 ? "" : "s"}, each written by its own module (\`Table.T*\`), in The Elm
--! Architecture: one model holding every table's state, one update that hands each
--! table its own messages, and one view.

${imports.join("\n")}


main : Tea.Program
main =
    Browser.mountAt
        (Tea.element { init = init, update = update, view = view, subscriptions = subscriptions })
        "root"`);

  out.push(`-- ---- Model ---------------------------------------------------------------------


type alias Model =
${tables.map((t) => `    ${wname(t)} : ${mod(t)}.Model`).join("\n")}`);
  out.push(`init : ⊤ → Model × Cmd Msg
init ⊤ =
    ( ${beniValue(Object.fromEntries(tables.map((t) => [wname(t), raw(`${mod(t)}.init ⊤`)])), "      ")}
    , Cmd.none
    )`);

  const set = (fields, indent) => recordSet("model", fields, indent).join("\n" + " ".repeat(indent));
  out.push(`-- ---- Update --------------------------------------------------------------------


type Msg
    = ${[...tables.map((t) => `${ctor(t)} ${mod(t)}.Msg`), "Pushed Value"].join("\n    | ")}`);
  out.push(`update : Msg, Model → Model × Cmd Msg
update msg model = ( step msg model, Cmd.none )`);
  const arms = tables.map((t) => `        ${ctor(t)} tableMsg →\n            ${set([[wname(t), `${mod(t)}.update tableMsg model.${wname(t)}`]], 12)}`);
  out.push(`step : Msg, Model → Model
step msg model =
    case msg of
${arms.join("\n\n")}

        Pushed value →
            pushed value model`);

  const byTable = (name, args, call) => `${name} : String, ${args.types}Model → Model
${name} table ${args.names}model =
    case table of
${tables.map((t) => `        ${beniString(t.id)} →\n            ${set([[wname(t), `${mod(t)}.${call} ${args.pass}model.${wname(t)}`]], 12)}`).join("\n\n")}

        _ →
            model`;

  out.push(`-- ---- External events -----------------------------------------------------------


subscriptions : Model → Sub Msg
subscriptions _ = Push.onPush Pushed`);
  out.push(`--| What the host pushes: a table's page of rows, new values for one column, rows deleted
--| elsewhere, or a new state for every table at once.
schema Event tagged "type" of
    ServerRows as "serverRows"
        table : String
        rows : Value
    ServerUpdate as "serverUpdate"
        table : String
        column : String
        changes : Value
    ServerDelete as "serverDelete"
        table : String
        ids : List Int
    Snapshot as "snapshot"
        state : Snapshot`);
  out.push(`schema Snapshot =
    tables : Tables`);
  out.push(`schema Tables =
${tables.map((t) => `    ${wname(t)} : Value as ${beniString(t.id)}`).join("\n")}`);
  const snapshotFields = tables.map((t) => [wname(t), `${mod(t)}.replace tables.${wname(t)} model.${wname(t)}`]);
  const snapshotRecord = snapshotFields.map(([k, v], i) => {
    const one = `${i ? ", " : "{ "}${k} = ${v}`;
    return one.length + 12 <= 100 ? one : `${i ? ", " : "{ "}${k} =\n                ${v}`;
  }).join("\n            ") + "\n            }";
  out.push(`pushed : Value, Model → Model
pushed value model =
    case Schema.read (Event.schema ⊤) value of
        Ok (Event.ServerRows event) →
            serverRows event.table event.rows model

        Ok (Event.ServerUpdate event) →
            serverUpdate event.table event.column event.changes model

        Ok (Event.ServerDelete event) →
            serverDelete event.table event.ids model

        Ok (Event.Snapshot event) →
            tables = event.state.tables
            ${snapshotRecord}

        Err _ →
            model`);
  out.push(byTable("serverRows", { types: "Value, ", names: "rows ", pass: "rows " }, "serverRows"));
  out.push(byTable("serverUpdate", { types: "String, Value, ", names: "column changes ", pass: "column changes " }, "serverUpdate"));
  out.push(byTable("serverDelete", { types: "List Int, ", names: "ids ", pass: "ids " }, "serverDelete"));

  const hole = (fn, args) => {
    const flat = `        {${fn} ${args.join(" ")}`;
    if (flat.length + 1 <= 100) return flat + "}";
    if (flat.length <= 100) return flat + "\n        }";
    return `        {${fn}\n${args.map((a) => "            " + a).join("\n")}\n        }`;
  };
  const views = tables.map((t) => hole("Html.map", [`(${mod(t)}.view model.${wname(t)})`, ctor(t)]));
  out.push(`-- ---- View ----------------------------------------------------------------------


view : Model → Html Msg
view model =
    <div data-role="page">
${views.join("\n")}
    </div>`);
  return out.join("\n\n\n") + "\n";
}

// ---------------------------------------------------------------------------------------------
// The app

export function emitApp(spec, templateFiles) {
  const files = {
    ...templateFiles({ name: `rr-bigtable-n${spec.options.size}-s${spec.options.seed}`, title: `big-table n=${spec.options.size} seed=${spec.options.seed}` }),
    "src/Main.beni": mainModule(spec),
    "src/Rng.beni": RNG_MODULE,
    "src/Fmt.beni": FMT_MODULE,
    "src/Change.beni": CHANGE_MODULE,
    "src/Sort.beni": SORT_MODULE,
  };
  for (const t of spec.tables) files[`src/Table/${mod(t)}.beni`] = tableModule(t, spec.initialState.tables[t.id]);
  // A section's heading comment is followed by one blank line, as `beni fmt` writes it.
  for (const [name, text] of Object.entries(files)) {
    if (name.endsWith(".beni")) files[name] = text.replace(/^(-- ---- .*)\n\n\n/gm, "$1\n\n");
  }
  return { files, style: STYLE };
}
