// The big-table scenario in Elm 0.19 (built with 0.19.3, see frameworks/elm/).
//
// Table 1 is written the way js-framework-benchmark's `frameworks/keyed/elm` entry writes its
// table (Html.Keyed rows, Html.Lazy on every row, rows in an Array, one Msg per button); tables
// 2 to N are the same shape, each with its own columns. Style (recorded in every generated
// app's rr.json); every module is laid out as elm-format 0.8.8 would lay it out, and exposes
// only what the app uses.
// - The Elm Architecture with `Browser.element`: `Main` holds `Model = { table1, …, tableN }`, one
//   `update`, one `view`, and a `Msg` with `GotTable<i> Table<i>.Msg` per table (`Html.map`).
// - A module per table (`Table<i>`) with its own `Model` (`rows : Array Row`, `selected : Maybe
//   Int` where the table has a select control, `nextId`, `rng`), `Row` record (a typed field per
//   data column), `Msg` (a constructor per toolbar button and per row control), `update` (a
//   case branch per message, written out as record updates), `newRow` (the row builder: one
//   draw of the Park-Miller generator per generated cell, in column order), `view` and decoders.
//   No column table, no interpreter.
// - The PRNG lives in the model (`rng`, advanced by `Ui.next`), as the js-framework-benchmark
//   entry keeps its `Random.Seed` there. `Ui.build` runs a table's `newRow` over a range of ids.
//   A table's initial rows are built at start-up by the same function.
// - Rows: `Html.Keyed.node "tbody"` with `( String.fromInt row.id, lazy2 viewRow selected row )`
//   (`lazy` where the table has no select), as the js-framework-benchmark entry does; the rows
//   of an Array are walked with one `Array.foldr` (`viewRowHelp`), as there.
// - `Html.Lazy` also on each table: `Html.map GotTableN (lazy TableN.view model.tableN)`, so an
//   event in one table does not diff the others' rows (a table's model is unchanged, by
//   reference, while another table changes).
// - Types: an `int`, a `number` and a `date` are `Int`, a `flag` a `Bool`, a `label`, a `text`
//   and a `status` a `String` (status options as an `Array String`, cycled with `Ui.cycle`).
// - Computed cells are written into the row view as expressions over `row`; an `if` is a `let`
//   binding of the row view.
// - Events: `onClick` on buttons, links and checkboxes, no `Html.Events` decoders.
// - External events: one incoming port, `events : (Value -> msg) -> Sub msg`, decoded with
//   `Json.Decode`: each table module has `external kind`, which decodes `serverRows`,
//   `serverUpdate` (one constructor per data column) and `serverDelete` into its own messages;
//   `snapshot` into `GotSnapshot` with a whole new `Model` (a decoder per table, an `andMap`
//   pipeline in `Main`, since the model has more than 8 fields).
// - Production build: `elm make --optimize`, then the guide's two uglify-js passes.

import { templateFiles } from "../../frameworks/elm/framework.js";
import { dataColumns, rowControls } from "./spec.js";

export const framework = "elm";

export const params = {};

const MAX_WIDTH = 100;

// ---------------------------------------------------------------------------------------------
// Elm text

function elmString(s) {
  return '"' + String(s).replace(/[\\"\n\r\t]/g, (c) => ({ "\\": "\\\\", '"': '\\"', "\n": "\\n", "\r": "\\r", "\t": "\\t" })[c]) + '"';
}

const cap = (s) => s[0].toUpperCase() + s.slice(1);
const sp = (n) => " ".repeat(n);
// elm-format sorts exposing lists (upper case first).
const exposing = (names) => [...names].sort().join(", ");
const group3 = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

// A record or list laid out the way elm-format keeps it: on one line when it fits, else one
// entry per line with leading commas, anchored at `col`.
function block(open, close, entries, col, multiline = false) {
  if (entries.length === 0) return `${open}${close}`;
  const flat = `${open} ${entries.join(", ")} ${close}`;
  if (!multiline && col + flat.length <= MAX_WIDTH && !flat.includes("\n")) return flat;
  const lines = entries.map((e, i) => `${i === 0 ? open : ","} ${e}`);
  return `${lines.join(`\n${sp(col)}`)}\n${sp(col)}${close}`;
}

// A list of strings (a pool), wrapped over lines of at most MAX_WIDTH, as a list literal.
function poolList(items, col) {
  return block("[", "]", items.map(elmString), col);
}

// ---------------------------------------------------------------------------------------------
// View documents: `{ tag, attrs, kids }` elements and `{ raw }` single-line expressions, laid
// out the way elm-format does: on one line when it fits; else the head (`tag [ attrs ]`), then
// the children list on the next line, a child per line.

const el = (tag, attrs, kids) => ({ tag, attrs, kids });
const raw = (s) => ({ raw: s });

function flatDoc(d) {
  if (d.raw !== undefined) return d.raw;
  const attrs = d.attrs.length ? `[ ${d.attrs.join(", ")} ]` : "[]";
  const kids = d.kids.length ? `[ ${d.kids.map(flatDoc).join(", ")} ]` : "[]";
  return `${d.tag} ${attrs} ${kids}`;
}

// `indent` is the column of the line the document starts on; `lead` the width of its marker.
function layoutDoc(d, indent, lead) {
  const flat = flatDoc(d);
  if (d.raw !== undefined || indent + lead + flat.length <= MAX_WIDTH) return flat;
  const inner = indent + 4;
  const attrs = d.attrs.length ? `[ ${d.attrs.join(", ")} ]` : "[]";
  const flatKids = d.kids.length ? `[ ${d.kids.map(flatDoc).join(", ")} ]` : "[]";
  const kids = !d.kids.length || inner + flatKids.length <= MAX_WIDTH ? flatKids : kidsLines(d.kids, inner);
  if (indent + lead + d.tag.length + attrs.length + 1 > MAX_WIDTH && d.attrs.length) {
    const attrList = `[ ${d.attrs.join(`\n${sp(inner)}, `)}\n${sp(inner)}]`;
    return `${d.tag}\n${sp(inner)}${attrList}\n${sp(inner)}${kids}`;
  }
  return `${d.tag} ${attrs}\n${sp(inner)}${kids}`;
}

// Children, one per line, anchored at `col`.
function kidsLines(kids, col) {
  const lines = kids.map((k, i) => `${i === 0 ? "[" : ","} ${layoutDoc(k, col, 2)}`);
  return `${lines.join(`\n${sp(col)}`)}\n${sp(col)}]`;
}

// ---------------------------------------------------------------------------------------------
// Names

const names = (t, i) => ({ mod: `Table${i + 1}`, value: `table${i + 1}`, got: `GotTable${i + 1}` });

const RESERVED_CONSTRUCTORS = new Set(["Model", "Msg", "Row", "Ok", "Err", "Just", "Nothing", "True", "False", "LT", "EQ", "GT"]);

const elmType = (c) => (c.kind === "number" || c.kind === "date" ? "Int" : c.kind === "flag" ? "Bool" : "String");
const decoderOf = (c) => (elmType(c) === "Int" ? "Decode.int" : elmType(c) === "Bool" ? "Decode.bool" : "Decode.string");

// ---------------------------------------------------------------------------------------------
// One table's module

function tableModule(t, index) {
  const me = names(t, index);
  const used = { html: new Set(["Html"]), attrs: new Set(), events: new Set(), ui: new Set(), lazy: new Set(), array: true };
  const H = (n) => (used.html.add(n), n);
  const A = (n) => (used.attrs.add(n), n);
  const U = (n) => (used.ui.add(n), `Ui.${n}`);
  const bare = (n) => (used.ui.add(n), n);

  const data = dataColumns(t);
  const col = (name) => t.columns.find((c) => c.name === name);
  const hasSelect = t.marker != null;
  const controls = rowControls(t);
  const field = (c) => c.name;

  // ---- messages
  const taken = new Set();
  const ctor = (name) => {
    const c = cap(name);
    if (RESERVED_CONSTRUCTORS.has(c) || taken.has(c)) throw new Error(`${t.id}: constructor ${c} clashes`);
    taken.add(c);
    return c;
  };
  const opCtor = new Map(t.ops.map((o) => [o.name, ctor(o.name)]));
  const ctlCtor = new Map(controls.map((c) => [c.role, ctor(c.role)]));
  // remove/select/toggle/bump controls appear once per role
  const serverSet = new Map(data.map((c) => [c.name, ctor(`serverSet${cap(c.name)}`)]));
  const ServerRows = ctor("ServerRows");
  const ServerDelete = ctor("ServerDelete");

  // ---- pools (plain data)
  const pools = []; // { name, items }
  const poolName = new Map();
  for (const c of data) {
    if (c.kind === "label") {
      c.pools.forEach((p, k) => {
        const name = `${c.name}Pool${k + 1}`;
        poolName.set(`${c.name}:${k}`, name);
        pools.push({ name, items: p });
      });
    } else if (c.kind === "text") {
      const name = `${c.name}Pool`;
      poolName.set(c.name, name);
      pools.push({ name, items: c.pool });
    } else if (c.kind === "status") {
      const name = `${c.name}Options`;
      poolName.set(c.name, name);
      pools.push({ name, items: c.options });
    }
  }
  const poolDecls = pools.map((p) => {
    const flat = poolList(p.items, 4);
    const body = 4 + "Array.fromList ".length + flat.length <= MAX_WIDTH && !flat.includes("\n") ? `Array.fromList ${flat}` : `Array.fromList\n        ${poolList(p.items, 8)}`;
    return `${p.name} : Array String\n${p.name} =\n    ${body}`;
  });

  // ---- types
  const rowAlias = `type alias Row =
    ${block("{", "}", ["id : Int", ...data.map((c) => `${field(c)} : ${elmType(c)}`)], 4, true)}`;
  const modelAlias = `type alias Model =
    ${block("{", "}", ["rows : Array Row", ...(hasSelect ? ["selected : Maybe Int"] : []), "nextId : Int", "rng : Int"], 4, true)}`;

  const ctors = [];
  for (const o of t.ops) ctors.push(opCtor.get(o.name));
  for (const c of controls) ctors.push(`${ctlCtor.get(c.role)} Int`);
  ctors.push(`${ServerRows} (Array Row)`);
  for (const c of data) ctors.push(`${serverSet.get(c.name)} (List ( Int, ${elmType(c)} ))`);
  ctors.push(`${ServerDelete} (List Int)`);
  const msgType = `type Msg\n    = ${ctors.join("\n    | ")}`;

  // ---- init
  const create = t.ops.find((o) => o.kind === "create");
  const initBody = t.initialRows === 0
    ? `    { rows = Array.empty, ${hasSelect ? "selected = Nothing, " : ""}nextId = 1, rng = ${t.rng} }`
    : `    let
        ( rows, rng ) =
            ${U("build")} newRow ${t.initialRows} 1 ${t.rng}
    in
    { rows = rows, ${hasSelect ? "selected = Nothing, " : ""}nextId = ${t.initialRows + 1}, rng = rng }`;
  const init = `init : Model\ninit =\n${initBody}`;

  // ---- update
  function recordUpdate(assignments, indent = 12) {
    const flat = `{ model | ${assignments.map(([n, v]) => `${n} = ${v}`).join(", ")} }`;
    if (indent + flat.length <= MAX_WIDTH) return `${sp(indent)}${flat}`;
    return `${sp(indent)}{ model\n${assignments.map(([n, v], i) => `${sp(indent + 4)}${i === 0 ? "|" : ","} ${n} = ${v}`).join("\n")}\n${sp(indent)}}`;
  }
  const buildLet = (count) => `            let
                ( rows, rng ) =
                    ${U("build")} newRow ${count} model.nextId model.rng
            in
`;

  // The updateEvery effect on one column, as a lambda over a row.
  function effectLambda(op) {
    const c = col(op.column);
    const f = field(c);
    switch (c.kind) {
      case "label": case "text": return `(\\row -> { row | ${f} = row.${f} ++ ${elmString(op.suffix)} })`;
      case "number": return `(\\row -> { row | ${f} = row.${f} + ${op.delta} })`;
      case "date": return `(\\row -> { row | ${f} = modBy 365 (row.${f} - 1 + ${op.days}) + 1 })`;
      case "status": return `(\\row -> { row | ${f} = ${U("cycle")} ${poolName.get(c.name)} row.${f} })`;
      case "flag": return `(\\row -> { row | ${f} = not row.${f} })`;
    }
    throw new Error(`updateEvery on a ${c.kind} column`);
  }

  // The comparison of a sort op.
  function comparator(op) {
    const c = op.column === "id" ? { kind: "id", name: "id" } : col(op.column);
    const key = (r) => c.kind === "status" ? `${U("rank")} ${poolName.get(c.name)} ${r}.${c.name}` : c.kind === "flag" ? `${U("bit")} ${r}.${c.name}` : `${r}.${c.name}`;
    const [x, y] = op.dir === "asc" ? ["a", "b"] : ["b", "a"];
    const wrapKey = (r) => (c.kind === "status" || c.kind === "flag" ? `(${key(r)})` : key(r));
    return `(\\a b -> compare ${wrapKey(x)} ${wrapKey(y)})`;
  }

  const branches = [];
  const branch = (pattern, body) => branches.push(`        ${pattern} ->\n${body}`);
  for (const o of t.ops) {
    const pat = opCtor.get(o.name);
    switch (o.kind) {
      case "create":
        branch(pat, buildLet(o.count) + recordUpdate([["rows", "rows"], ...(hasSelect ? [["selected", "Nothing"]] : []), ["nextId", `model.nextId + ${o.count}`], ["rng", "rng"]]));
        break;
      case "append":
        branch(pat, buildLet(o.count) + recordUpdate([["rows", "Array.append model.rows rows"], ["nextId", `model.nextId + ${o.count}`], ["rng", "rng"]]));
        break;
      case "updateEvery":
        branch(pat, recordUpdate([["rows", `${U("everyNth")} ${o.k} ${effectLambda(o)} model.rows`]]));
        break;
      case "clear":
        branch(pat, recordUpdate([["rows", "Array.empty"], ...(hasSelect ? [["selected", "Nothing"]] : [])]));
        break;
      case "swap":
        branch(pat, recordUpdate([["rows", `${U("swap")} ${o.i} ${o.j} model.rows`]]));
        break;
      case "sort":
        branch(pat, recordUpdate([["rows", `${U("sortRows")} ${comparator(o)} model.rows`]]));
        break;
      case "removeChecked": {
        const f = o.column;
        if (hasSelect) {
          branch(pat, `            let
                rows =
                    Array.filter (not << .${f}) model.rows
            in
${recordUpdate([["rows", "rows"], ["selected", `${U("keepSelected")} rows model.selected`]])}`);
        } else {
          branch(pat, recordUpdate([["rows", `Array.filter (not << .${f}) model.rows`]]));
        }
        break;
      }
      default: throw new Error(`unknown operation ${o.kind}`);
    }
  }
  for (const c of controls) {
    const pat = `${ctlCtor.get(c.role)} id`;
    switch (c.kind) {
      case "select":
        branch(pat, recordUpdate([["selected", "Just id"]]));
        break;
      case "remove":
        if (hasSelect) {
          branch(pat, `            let
                rows =
                    Array.filter (\\row -> row.id /= id) model.rows
            in
${recordUpdate([["rows", "rows"], ["selected", `${U("keepSelected")} rows model.selected`]])}`);
        } else {
          branch(pat, recordUpdate([["rows", "Array.filter (\\row -> row.id /= id) model.rows"]]));
        }
        break;
      case "toggle":
        branch(pat, recordUpdate([["rows", `${U("updateRow")} id (\\row -> { row | ${c.column} = not row.${c.column} }) model.rows`]]));
        break;
      case "bump":
        branch(pat, recordUpdate([["rows", `${U("updateRow")} id (\\row -> { row | ${c.column} = row.${c.column} + ${c.delta} }) model.rows`]]));
        break;
    }
  }
  // External events.
  branch(`${ServerRows} rows`, recordUpdate([
    ["rows", "rows"],
    ...(hasSelect ? [["selected", `${U("keepSelected")} rows model.selected`]] : []),
    ["nextId", `${U("nextAfter")} model.nextId rows`],
  ]));
  for (const c of data) {
    branch(`${serverSet.get(c.name)} changes`, recordUpdate([["rows", `${U("setCells")} (\\value row -> { row | ${field(c)} = value }) changes model.rows`]]));
  }
  if (hasSelect) {
    branch(`${ServerDelete} ids`, `            let
                rows =
                    Array.filter (\\row -> not (List.member row.id ids)) model.rows
            in
${recordUpdate([["rows", "rows"], ["selected", `${U("keepSelected")} rows model.selected`]])}`);
  } else {
    branch(`${ServerDelete} ids`, recordUpdate([["rows", "Array.filter (\\row -> not (List.member row.id ids)) model.rows"]]));
  }
  const update = `update : Msg -> Model -> Model\nupdate msg model =\n    case msg of\n${branches.join("\n\n")}`;

  // ---- the row builder: one draw per generated cell, in column order
  const lets = [];
  const entries = ["id = id"];
  let draw = 0;
  const drawn = () => {
    draw++;
    lets.push(`        s${draw} =
            ${U("next")} ${draw === 1 ? "seed" : `s${draw - 1}`}`);
    return `s${draw}`;
  };
  for (const c of data) {
    switch (c.kind) {
      case "label": {
        const words = c.pools.map((_, k) => `${U("pick")} ${drawn()} ${poolName.get(`${c.name}:${k}`)}`);
        entries.push(`${field(c)} = ${words.length === 1 ? words[0] : words.map((w) => `${w}`).join(' ++ " " ++ ')}`);
        break;
      }
      case "text": entries.push(`${field(c)} = ${U("pick")} ${drawn()} ${poolName.get(c.name)}`); break;
      case "number": entries.push(`${field(c)} = ${U("between")} ${c.min} ${c.max} ${drawn()}`); break;
      case "date": entries.push(`${field(c)} = ${U("between")} 1 365 ${drawn()}`); break;
      case "status": entries.push(`${field(c)} = ${U("pick")} ${drawn()} ${poolName.get(c.name)}`); break;
      case "flag": entries.push(`${field(c)} = modBy 2 ${drawn()} == 1`); break;
    }
  }
  const newRow = `newRow : Int -> Int -> ( Row, Int )
newRow id seed =
    let
${lets.join("\n\n")}

        row =
            ${block("{", "}", entries, 12, true)}
    in
    ( row, s${draw} )`;

  // ---- view
  const role = (n) => `${bare("dataRole")} ${elmString(n)}`;
  const text = (s) => (H("text"), `text ${s}`);
  const fn = { hoists: [] };

  // A number as text, by format.
  const numberText = (c, v) => {
    switch (c.format) {
      case "plain": return { s: `String.fromInt ${v.prec >= 10 ? v.s : `(${v.s})`}`, prec: 9 };
      case "grouped": return { s: `${U("group")} ${v.prec >= 10 ? v.s : `(${v.s})`}`, prec: 9 };
      case "unit": return { s: `${U("group")} ${v.prec >= 10 ? v.s : `(${v.s})`} ++ ${elmString(` ${c.unit}`)}`, prec: 5 };
      case "currency": return { s: `${U("currency")} ${elmString(c.symbol)} ${v.prec >= 10 ? v.s : `(${v.s})`}`, prec: 9 };
      case "percent": return { s: `${U("percent")} ${v.prec >= 10 ? v.s : `(${v.s})`}`, prec: 9 };
    }
    throw new Error(`unknown number format ${c.format}`);
  };
  const cell = (name) => ({ s: `row.${name}`, prec: 10 });

  function computedText(c) {
    const e = c.expr;
    switch (e[0]) {
      case "*": return numberText(c, { s: `row.${e[1]} * row.${e[2]}`, prec: 7 });
      case "+": return numberText(c, { s: `row.${e[1]} + row.${e[2]}`, prec: 6 });
      case "len": return { s: `String.fromInt (String.length row.${e[1]})`, prec: 9 };
      case "if": {
        const cond = e[1];
        const test = cond[0] === ">" ? `row.${cond[1]} > ${cond[2]}` : cond[0] === "==" ? `row.${cond[1]} == ${elmString(cond[2])}` : `row.${cond[1]}`;
        const name = `${c.name}Text`;
        fn.hoists.push(`        ${name} =
            if ${test} then
                ${elmString(e[2])}

            else
                ${elmString(e[3])}`);
        return { s: name, prec: 10 };
      }
    }
    throw new Error(`unknown expression ${JSON.stringify(e)}`);
  }

  const selectedHandlerAttrs = (roleName, ctlCtorName) => [role(roleName), `${(used.events.add("onClick"), "onClick")} (${ctlCtorName} row.id)`];
  const arg = (e) => (e.prec >= 10 ? e.s : `(${e.s})`);

  function cellDoc(c) {
    const td = (kids) => el(H("td"), [], kids);
    switch (c.kind) {
      case "id": return td([raw(text("(String.fromInt row.id)"))]);
      case "label": case "text": {
        const value = raw(text(`row.${c.name}`));
        if (!c.select) return td([value]);
        return td([el(H("a"), selectedHandlerAttrs(c.select, ctlCtor.get(c.select)), [value])]);
      }
      case "number": return td([raw(text(arg(numberText(c, cell(c.name)))))]);
      case "date": return td([raw(text(`(${U({ "mon-d": "monthDay", "d-mon": "dayMonth", "mm-dd": "monthNumberDay" }[c.format])} row.${c.name})`))]);
      case "status": return td([el(H(c.tag), [], [raw(text(`row.${c.name}`))])]);
      case "flag":
        return td([el(H("input"), [`${A("type_")} "checkbox"`, role(c.toggle), `${A("checked")} row.${c.name}`, ...[`onClick (${ctlCtor.get(c.toggle)} row.id)`].map((x) => (used.events.add("onClick"), x))], [])]);
      case "computed": return td([raw(text(arg(computedText(c))))]);
      case "remove": {
        const inner = c.glyph ? [el(H("span"), [`${A("attribute")} "aria-hidden" "true"`], [raw(text(elmString(c.text)))])] : [raw(text(elmString(c.text)))];
        return td([el(H(c.element), selectedHandlerAttrs(c.role, ctlCtor.get(c.role)), inner)]);
      }
      case "bump": return td([el(H("button"), selectedHandlerAttrs(c.role, ctlCtor.get(c.role)), [raw(text(elmString(c.text)))])]);
      case "spacer": return td([]);
    }
    throw new Error(`unknown column kind ${c.kind}`);
  }

  const cells = t.columns.map(cellDoc);
  const rowAttrs = [`${bare("dataKey")} (String.fromInt row.id)`, role("row")];
  if (hasSelect) {
    if (t.marker.attr === "class") rowAttrs.push(`${A("classList")} [ ( ${elmString(t.marker.value)}, isSelected ) ]`);
  }
  const rowDoc = hasSelect && t.marker.attr !== "class"
    ? (() => {
      const cons = `${rowAttrs.join(" :: ")} :: ${U("ariaSelected")} isSelected`;
      H("tr");
      const kids = cells;
      const flatKids = `[ ${kids.map(flatDoc).join(", ")} ]`;
      const kidsText = 8 + flatKids.length <= MAX_WIDTH ? flatKids : kidsLines(kids, 8);
      return `tr\n        (${cons})\n        ${kidsText}`;
    })()
    : layoutDoc(el(H("tr"), rowAttrs, cells), 4, 0);

  const letsText = fn.hoists.length ? `    let\n${fn.hoists.join("\n\n")}\n    in\n` : "";
  const rowParams = hasSelect ? "isSelected row" : "row";
  const rowSig = hasSelect ? "Bool -> Row -> Html Msg" : "Row -> Html Msg";
  const viewRow = `viewRow : ${rowSig}
viewRow ${rowParams} =
${letsText}    ${rowDoc}`;

  // The keyed row: ( id, lazy viewRow … ).
  used.lazy.add(hasSelect ? "lazy2" : "lazy");
  const viewKeyedRow = hasSelect
    ? `viewKeyedRow : Maybe Int -> Row -> ( String, Html Msg )
viewKeyedRow selected row =
    ( String.fromInt row.id, lazy2 viewRow (selected == Just row.id) row )`
    : `viewKeyedRow : Row -> ( String, Html Msg )
viewKeyedRow row =
    ( String.fromInt row.id, lazy viewRow row )`;

  const viewRowHelp = hasSelect
    ? `viewRowHelp : Maybe Int -> Row -> List ( String, Html Msg ) -> List ( String, Html Msg )
viewRowHelp selected row rest =
    viewKeyedRow selected row :: rest`
    : `viewRowHelp : Row -> List ( String, Html Msg ) -> List ( String, Html Msg )
viewRowHelp row rest =
    viewKeyedRow row :: rest`;

  // The table.
  const buttons = t.ops.map((o) => {
    used.events.add("onClick");
    return el(H("button"), [role(o.name), `onClick ${opCtor.get(o.name)}`], [raw(text(elmString(o.text)))]);
  });
  const header = t.thead
    ? [el(H("thead"), [], [el(H("tr"), [], t.columns.map((c) => (c.header === "" ? el(H("th"), [], []) : el(H("th"), [], [raw(text(elmString(c.header)))]))))])]
    : [];
  used.keyed = true;
  const rowsExpr = hasSelect
    ? `Keyed.node "tbody" [] (Array.foldr (viewRowHelp model.selected) [] model.rows)`
    : `Keyed.node "tbody" [] (Array.foldr viewRowHelp [] model.rows)`;
  const body = el(H("section"), [`${bare("dataKey")} ${elmString(t.id)}`, role("table")], [
    el(H("h2"), [], [raw(text(elmString(t.title)))]),
    el(H("div"), [], buttons),
    el(H("table"), [], [...header, raw(rowsExpr)]),
  ]);
  const view = `view : Model -> Html Msg
view model =
    ${layoutDoc(body, 4, 0)}`;

  // ---- decoders
  const rowDecoderFields = [["id", "Decode.int"], ...data.map((c) => [c.name, decoderOf(c)])];
  const mapN = (ctorName, fields) => {
    const n = fields.length;
    return `Decode.map${n} ${ctorName}\n${fields.map((f) => `        ${f}`).join("\n")}`;
  };
  const rowDecoder = `rowDecoder : Decoder Row
rowDecoder =
    ${mapN("Row", rowDecoderFields.map(([k, d]) => `(Decode.field ${elmString(k)} ${d})`))}`;
  const modelFields = [`(Decode.field "rows" (Decode.array rowDecoder))`, ...(hasSelect ? [`(Decode.field "selected" (Decode.nullable Decode.int))`] : []),
    `(Decode.field "nextId" Decode.int)`, `(Decode.field "rng" Decode.int)`];
  const decoder = `decoder : Decoder Model
decoder =
    ${mapN("Model", modelFields)}`;
  const changes = (c) => `(Decode.field "changes" (Decode.list (${U("changeDecoder")} ${decoderOf(c)})))`;
  const external = `external : String -> Decoder Msg
external kind =
    case kind of
        "serverRows" ->
            Decode.map ${ServerRows} (Decode.field "rows" (Decode.array rowDecoder))

        "serverUpdate" ->
            Decode.field "column" Decode.string
                |> Decode.andThen serverUpdate

        "serverDelete" ->
            Decode.map ${ServerDelete} (Decode.field "ids" (Decode.list Decode.int))

        _ ->
            Decode.fail ("unknown event: " ++ kind)


serverUpdate : String -> Decoder Msg
serverUpdate column =
    case column of
${data.map((c) => `        ${elmString(c.name)} ->\n            Decode.map ${serverSet.get(c.name)} ${changes(c)}`).join("\n\n")}

        _ ->
            Decode.fail ("unknown column: " ++ column)`;

  // ---- assemble
  const exposed = ["Model", "Msg(..)", "decoder", "external", "init", "update", "view"];
  const htmlNames = used.html;
  const imports = [["Array", `import Array exposing (Array)`], ["Html", `import Html exposing (${exposing(htmlNames)})`]];
  if (used.attrs.size) imports.push(["Html.Attributes", `import Html.Attributes exposing (${exposing(used.attrs)})`]);
  if (used.events.size) imports.push(["Html.Events", `import Html.Events exposing (${exposing(used.events)})`]);
  imports.push(["Html.Keyed", "import Html.Keyed as Keyed"]);
  imports.push(["Html.Lazy", `import Html.Lazy exposing (${exposing(used.lazy)})`]);
  imports.push(["Json.Decode", "import Json.Decode as Decode exposing (Decoder)"]);
  const uiBare = ["dataKey", "dataRole"].filter((n) => used.ui.has(n));
  imports.push(["Ui", `import Ui${uiBare.length ? ` exposing (${exposing(uiBare)})` : ""}`]);

  const parts = [
    `module ${me.mod} exposing (${exposing(exposed)})\n\n${imports.sort((x, y) => (x[0] < y[0] ? -1 : 1)).map((x) => x[1]).join("\n")}`,
    ...poolDecls,
    rowAlias,
    modelAlias,
    init,
    msgType,
    update,
    newRow,
    view,
    viewRowHelp,
    viewKeyedRow,
    viewRow,
    rowDecoder,
    decoder,
    external,
  ];
  return { source: parts.join("\n\n\n") + "\n", uses: used.ui, create };
}

// ---------------------------------------------------------------------------------------------
// Ui: what every table shares (nothing in it knows any table)

const UI_DEFS = {
  dataKey: { code: `dataKey : String -> Attribute msg
dataKey =
    attribute "data-key"`, imports: { "Html": ["Attribute"], "Html.Attributes": ["attribute"] } },
  dataRole: { code: `dataRole : String -> Attribute msg
dataRole =
    attribute "data-role"`, imports: { "Html": ["Attribute"], "Html.Attributes": ["attribute"] } },
  next: { code: `{-| One step of the Park-Miller generator. Every product stays below 2^47, exact in a double.
-}
next : Int -> Int
next seed =
    remainderBy 2147483647 (seed * 48271)`, imports: {} },
  pick: { code: `pick : Int -> Array String -> String
pick seed pool =
    Array.get (modBy (Array.length pool) seed) pool
        |> Maybe.withDefault ""`, imports: { "Array": ["Array"] } },
  between: { code: `between : Int -> Int -> Int -> Int
between low high seed =
    low + modBy (high - low + 1) seed`, imports: {} },
  build: { needs: ["buildHelp"], code: `{-| \`count\` new rows with ids from \`firstId\` up, and the generator's state after them.
-}
build : (Int -> Int -> ( row, Int )) -> Int -> Int -> Int -> ( Array row, Int )
build newRow count firstId seed =
    buildHelp newRow firstId (firstId + count) seed []`, imports: { "Array": ["Array"] } },
  buildHelp: { code: `buildHelp : (Int -> Int -> ( row, Int )) -> Int -> Int -> Int -> List row -> ( Array row, Int )
buildHelp newRow id end seed built =
    if id >= end then
        ( Array.fromList (List.reverse built), seed )

    else
        let
            ( row, nextSeed ) =
                newRow id seed
        in
        buildHelp newRow (id + 1) end nextSeed (row :: built)`, imports: { "Array": ["Array"] } },
  group: { code: `group : Int -> String
group n =
    if n < 1000 then
        String.fromInt n

    else
        group (n // 1000) ++ "," ++ String.padLeft 3 '0' (String.fromInt (modBy 1000 n))`, imports: {} },
  currency: { needs: ["group"], code: `currency : String -> Int -> String
currency symbol cents =
    symbol ++ group (floor (toFloat cents / 100)) ++ "." ++ String.padLeft 2 '0' (String.fromInt (modBy 100 cents))`, imports: {} },
  percent: { needs: ["group"], code: `percent : Int -> String
percent tenths =
    group (tenths // 10) ++ "." ++ String.fromInt (modBy 10 tenths) ++ "%"`, imports: {} },
  monthDay: { needs: ["splitDay"], code: `monthDay : Int -> String
monthDay day =
    let
        ( _, name, dayOfMonth ) =
            splitDay day
    in
    name ++ " " ++ String.fromInt dayOfMonth`, imports: {} },
  dayMonth: { needs: ["splitDay"], code: `dayMonth : Int -> String
dayMonth day =
    let
        ( _, name, dayOfMonth ) =
            splitDay day
    in
    String.fromInt dayOfMonth ++ " " ++ name`, imports: {} },
  monthNumberDay: { needs: ["splitDay"], code: `monthNumberDay : Int -> String
monthNumberDay day =
    let
        ( number, _, dayOfMonth ) =
            splitDay day
    in
    String.padLeft 2 '0' (String.fromInt number) ++ "-" ++ String.padLeft 2 '0' (String.fromInt dayOfMonth)`, imports: {} },
  splitDay: { needs: ["splitDayFrom"], code: `{-| The month number, its name and the day of the month of a day of the year (1 to 365).
-}
splitDay : Int -> ( Int, String, Int )
splitDay day =
    splitDayFrom 1 [ ( "Jan", 31 ), ( "Feb", 28 ), ( "Mar", 31 ), ( "Apr", 30 ), ( "May", 31 ), ( "Jun", 30 ), ( "Jul", 31 ), ( "Aug", 31 ), ( "Sep", 30 ), ( "Oct", 31 ), ( "Nov", 30 ), ( "Dec", 31 ) ] day`, imports: {} },
  splitDayFrom: { code: `splitDayFrom : Int -> List ( String, Int ) -> Int -> ( Int, String, Int )
splitDayFrom number months day =
    case months of
        ( name, length ) :: rest ->
            if day > length && not (List.isEmpty rest) then
                splitDayFrom (number + 1) rest (day - length)

            else
                ( number, name, day )

        [] ->
            ( number, "", day )`, imports: {} },
  rank: { code: `rank : Array String -> String -> Int
rank options option =
    options
        |> Array.toIndexedList
        |> List.filter (\\( _, candidate ) -> candidate == option)
        |> List.head
        |> Maybe.map Tuple.first
        |> Maybe.withDefault 0`, imports: { "Array": ["Array"] } },
  cycle: { needs: ["rank", "pick"], code: `cycle : Array String -> String -> String
cycle options current =
    pick (rank options current + 1) options`, imports: { "Array": ["Array"] } },
  bit: { code: `bit : Bool -> Int
bit flag =
    if flag then
        1

    else
        0`, imports: {} },
  swap: { code: `swap : Int -> Int -> Array a -> Array a
swap i j rows =
    case ( Array.get i rows, Array.get j rows ) of
        ( Just first, Just second ) ->
            rows
                |> Array.set i second
                |> Array.set j first

        _ ->
            rows`, imports: { "Array": ["Array"] } },
  everyNth: { code: `everyNth : Int -> (a -> a) -> Array a -> Array a
everyNth k change rows =
    Array.indexedMap
        (\\i row ->
            if modBy k i == 0 then
                change row

            else
                row
        )
        rows`, imports: { "Array": ["Array"] } },
  sortRows: { code: `{-| Order the rows by a comparison; rows that compare equal stay by id.
-}
sortRows : ({ r | id : Int } -> { r | id : Int } -> Order) -> Array { r | id : Int } -> Array { r | id : Int }
sortRows compareRows rows =
    rows
        |> Array.toList
        |> List.sortWith
            (\\a b ->
                case compareRows a b of
                    EQ ->
                        compare a.id b.id

                    order ->
                        order
            )
        |> Array.fromList`, imports: { "Array": ["Array"] } },
  updateRow: { code: `updateRow : Int -> ({ r | id : Int } -> { r | id : Int }) -> Array { r | id : Int } -> Array { r | id : Int }
updateRow id change =
    Array.map
        (\\row ->
            if row.id == id then
                change row

            else
                row
        )`, imports: { "Array": ["Array"] } },
  setCells: { code: `setCells : (v -> { r | id : Int } -> { r | id : Int }) -> List ( Int, v ) -> Array { r | id : Int } -> Array { r | id : Int }
setCells set changes rows =
    let
        values =
            Dict.fromList changes
    in
    Array.map
        (\\row ->
            case Dict.get row.id values of
                Just value ->
                    set value row

                Nothing ->
                    row
        )
        rows`, imports: { "Array": ["Array"], "Dict": [] } },
  keepSelected: { code: `keepSelected : Array { r | id : Int } -> Maybe Int -> Maybe Int
keepSelected rows =
    Maybe.andThen
        (\\id ->
            if Array.foldl (\\row found -> found || row.id == id) False rows then
                Just id

            else
                Nothing
        )`, imports: { "Array": ["Array"] } },
  nextAfter: { code: `nextAfter : Int -> Array { r | id : Int } -> Int
nextAfter current rows =
    Array.foldl (\\row highest -> max (row.id + 1) highest) current rows`, imports: { "Array": ["Array"] } },
  ariaSelected: { code: `ariaSelected : Bool -> List (Attribute msg)
ariaSelected isSelected =
    if isSelected then
        [ attribute "aria-selected" "true" ]

    else
        []`, imports: { "Html": ["Attribute"], "Html.Attributes": ["attribute"] } },
  changeDecoder: { code: `changeDecoder : Decoder a -> Decoder ( Int, a )
changeDecoder decoder =
    Decode.map2 Tuple.pair (Decode.field "id" Decode.int) (Decode.field "value" decoder)`, imports: { "Json.Decode": ["Decoder"] } },
};
const UI_ORDER = Object.keys(UI_DEFS);

function uiModule(uses) {
  const wanted = new Set();
  const add = (n) => {
    if (wanted.has(n)) return;
    wanted.add(n);
    for (const m of UI_DEFS[n].needs || []) add(m);
  };
  for (const n of uses) add(n);
  const nameList = UI_ORDER.filter((n) => wanted.has(n));
  const exported = nameList.filter((n) => uses.has(n));
  const imports = new Map();
  for (const n of nameList) {
    for (const [mod, items] of Object.entries(UI_DEFS[n].imports)) {
      if (!imports.has(mod)) imports.set(mod, new Set());
      for (const i of items) imports.get(mod).add(i);
    }
  }
  const importLines = [...imports.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([mod, items]) => {
    if (mod === "Json.Decode") return `import Json.Decode as Decode exposing (${exposing(items)})`;
    return items.size ? `import ${mod} exposing (${exposing(items)})` : `import ${mod}`;
  });
  return `module Ui exposing (${exposing(exported)})

{-| What the tables share: the attributes the markup uses, the pseudo-random generator, number
and date formatting, and a few helpers over rows that know nothing of any table.
-}

${importLines.join("\n")}


${nameList.map((n) => UI_DEFS[n].code).join("\n\n\n")}
`;
}

// ---------------------------------------------------------------------------------------------
// Main

function mainModule(spec) {
  const tables = spec.tables.map((t, i) => ({ t, ...names(t, i) }));
  const imports = [
    "import Browser",
    "import Html exposing (Html, div)",
    "import Html.Lazy exposing (lazy)",
    "import Json.Decode as Decode exposing (Decoder)",
    "import Ui",
    ...tables.map((x) => `import ${x.mod}`),
  ].sort((a, b) => {
    const ma = a.split(" ")[1], mb = b.split(" ")[1];
    return ma < mb ? -1 : ma > mb ? 1 : 0;
  });
  const out = [];
  out.push(`port module Main exposing (main)

${imports.join("\n")}


main : Program () Model Msg
main =
    Browser.element
        { init = init
        , view = view
        , update = update
        , subscriptions = subscriptions
        }


{-| External events (server pushes, snapshots), as JSON.
-}
port events : (Decode.Value -> msg) -> Sub msg`);

  out.push(`-- MODEL


type alias Model =
    ${block("{", "}", tables.map((x) => `${x.value} : ${x.mod}.Model`), 4, true)}


init : () -> ( Model, Cmd Msg )
init _ =
    ( initialModel, Cmd.none )


initialModel : Model
initialModel =
    ${block("{", "}", tables.map((x) => `${x.value} = ${x.mod}.init`), 4, true)}`);

  const ctors = tables.map((x) => `${x.got} ${x.mod}.Msg`);
  ctors.push("GotSnapshot Model", "UnknownEvent");
  const cases = tables.map((x) => `        ${x.got} tableMsg ->
            ( { model | ${x.value} = ${x.mod}.update tableMsg model.${x.value} }, Cmd.none )`);
  cases.push("        GotSnapshot snapshot ->\n            ( snapshot, Cmd.none )");
  cases.push("        UnknownEvent ->\n            ( model, Cmd.none )");
  out.push(`-- UPDATE


type Msg
    = ${ctors.join("\n    | ")}


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
${cases.join("\n\n")}`);

  const tableCases = tables.map((x) => `        ${elmString(x.t.id)} ->
            Decode.map ${x.got} (${x.mod}.external kind)`);
  tableCases.push('        _ ->\n            Decode.fail ("unknown table: " ++ id)');
  out.push(`-- SUBSCRIPTIONS


subscriptions : Model -> Sub Msg
subscriptions _ =
    events (Decode.decodeValue eventDecoder >> Result.withDefault UnknownEvent)


eventDecoder : Decoder Msg
eventDecoder =
    Decode.field "type" Decode.string
        |> Decode.andThen
            (\\kind ->
                case kind of
                    "snapshot" ->
                        Decode.map GotSnapshot (Decode.at [ "state", "tables" ] modelDecoder)

                    _ ->
                        Decode.field "table" Decode.string
                            |> Decode.andThen (tableEvent kind)
            )


tableEvent : String -> String -> Decoder Msg
tableEvent kind id =
    case id of
${tableCases.join("\n\n")}


modelDecoder : Decoder Model
modelDecoder =
    Decode.succeed Model
        ${tables.map((x) => `|> andMap (Decode.field ${elmString(x.t.id)} ${x.mod}.decoder)`).join("\n        ")}


andMap : Decoder a -> Decoder (a -> b) -> Decoder b
andMap =
    Decode.map2 (|>)`);

  const kids = tables.map((x) => raw(`Html.map ${x.got} (lazy ${x.mod}.view model.${x.value})`));
  const root = `div [ Ui.dataRole "page" ]`;
  out.push(`-- VIEW


view : Model -> Html Msg
view model =
    ${root}
        ${kidsLines(kids, 8)}`);

  return out.map((d) => (d.startsWith("-- ") ? "\n" + d : d)).join("\n\n\n") + "\n";
}

export function emit(spec) {
  const template = templateFiles({ title: "Big table" });
  const elmJson = JSON.parse(template["elm.json"]);
  delete elmJson.dependencies.direct["elm/regex"];
  const files = { ...template, "elm.json": JSON.stringify(elmJson, null, 4) + "\n" };
  const uses = new Set();
  spec.tables.forEach((t, i) => {
    const { source, uses: u } = tableModule(t, i);
    for (const x of u) uses.add(x);
    files[`src/${names(t, i).mod}.elm`] = source;
  });
  files["src/Ui.elm"] = uiModule(uses);
  files["src/Main.elm"] = mainModule(spec);
  return {
    files,
    style: {
      architecture: "TEA with Browser.element: Main holds { table1, …, tableN }, one update, one view; GotTable<i> wraps each module's Msg (Html.map)",
      components: "a module per table (Table<i>) with its own Model (rows : Array Row, selected : Maybe Int where the table has select, nextId, rng), Row record (a typed field per data column), Msg (a constructor per toolbar button and row control, plus ServerRows, ServerSet<Column> and ServerDelete), update (a case branch per message as record updates), newRow (one Park-Miller draw per generated cell in a let chain), view and decoders; Ui holds generic helpers (attributes, next/pick/between/build, number and date formatting, rows helpers)",
      prng: "in the model (rng, advanced by Ui.next), as the js-framework-benchmark entry keeps its Random.Seed there; initial rows built at start-up by the table's own newRow",
      rows: "Html.Keyed.node \"tbody\" with ( String.fromInt row.id, lazy2 viewRow isSelected row ) per row (lazy where no select), rows in an Array as in the js-framework-benchmark entry",
      lazy: "Html.Lazy on every row (as the js-framework-benchmark entry does) and on every table (Html.map GotTable<i> (lazy Table<i>.view model.table<i>)), so an event in one table does not diff the others",
      types: "int, number, date: Int; flag: Bool; label, text, status: String (status options as an Array String, cycled by Ui.cycle)",
      derived: "computed cells are expressions over row in the row view; an if is a let binding of viewRow",
      events: "onClick on buttons, links and checkboxes; no custom decoders",
      selection: "class marker via classList [ ( \"selected\", isSelected ) ]; aria-selected via Ui.ariaSelected, which renders no attribute while unselected",
      externalEvents: "one incoming port; Json.Decode: each table's external kind decodes serverRows, serverUpdate (a constructor per data column) and serverDelete into its own messages; snapshot into GotSnapshot with a decoder per table, an andMap pipeline in Main",
      formatting: "as elm-format 0.8.8 writes it; elm.json lists only the dependencies the app imports",
      build: "elm make --optimize, then uglify-js compress (pure_funcs) and mangle passes, as the Elm guide recommends",
    },
  };
}
