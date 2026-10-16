// The unique-components scenario in Elm 0.19 (built with 0.19.3, see frameworks/elm/).
//
// Style (recorded in every generated app's rr.json), following the Elm guide and common
// practice, as the shared-components emitter does. Every generated module is laid out as
// elm-format 0.8.8 would lay it out, and exposes only what the app uses.
// - The Elm Architecture with `Browser.element`: one `Model` record in `Main` (one field per
//   widget), one `update`, one `view`, and a `Msg` with one constructor per widget wrapping
//   that widget's own `Msg` (`GotDailyBoardR157`), routed by one-line branches and `Html.map`.
// - Every widget is its own module (`Widget.DailyBoardR157`, named after its label), written
//   out from its description: its `Model` record (one typed field per state field), `Msg` (one
//   constructor per message), `update` (one branch per message, the ops of a click message
//   written out as record updates), `view` (the view tree as `Html` code, each expression
//   compiled into an Elm expression), a JSON `decoder` and `init`. Nothing is shared between
//   widgets but `Ui`: generic helpers (the widget section, `when`, `option`, `nextId`,
//   `toggleDone`, the number-input event) and the two attribute names.
// - Types: an `int` is an `Int`, a `bool` a `Bool`, a `text` and an `enum` a `String` (the
//   options are data of the view and of `update`'s cycle), a `list` a `List` of a type alias
//   per list (`TasksItem`) built by its positional constructor.
// - Derived values stay in `view`. An `if` becomes a `let` binding of the function that needs it
//   (elm-format always lays an `if` out on several lines, so this keeps the markup readable).
// - A conditional section (`when`) is a view function of its own (`viewSection`), called as
//   `Ui.when condition (viewSection model)`, which renders an empty text node while the
//   condition fails, so the siblings keep their positions (and the inputs their focus).
// - Cross-widget reads: the widget's `view` takes the `Model` of every widget it reads, before
//   its own (`view depotConsole model`), and `Main` passes them.
// - Keyed lists with `Html.Keyed` (`Keyed.ul`/`Keyed.ol` and a `viewTasksItem` function per
//   list); plain `Html.Events` handlers (`onInput` for text inputs and the select, `onClick`
//   for buttons and checkboxes), and `Ui.onNumberInput` for the number inputs, a decoder that
//   fails on anything but an integer within the field's range, so only a valid number is sent.
// - External events arrive through one incoming port, `events : (Value -> msg) -> Sub msg`,
//   decoded with `Json.Decode`: `serverSet` into the widget's `Replaced`, `notify` into the
//   feed's `Notified`, `tick` into `Tick` (each widget with a time-driven field has a `tick`),
//   `snapshot` into `GotSnapshot` with a whole new `Model` (a local `andMap` pipeline).
// - No `Html.Lazy`, as in the shared-components emitter.
// - Production build: `elm make --optimize`, then the guide's two uglify-js passes.

import { templateFiles } from "../../frameworks/elm/framework.js";
import { camelCase, pascal } from "../../frameworks/shared/jsx.js";

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

// A record or list laid out the way elm-format keeps it: on one line when it fits, else one
// entry per line with leading commas, anchored at `col`.
function block(open, close, entries, col, multiline = false) {
  if (entries.length === 0) return `${open}${close}`;
  const flat = `${open} ${entries.map((e) => e.flat).join(", ")} ${close}`;
  if (!multiline && col + flat.length <= MAX_WIDTH && !flat.includes("\n")) return flat;
  const lines = entries.map((e, i) => `${i === 0 ? open : ","} ${e.multi ? e.multi(col + 2) : e.flat}`);
  return `${lines.join(`\n${sp(col)}`)}\n${sp(col)}${close}`;
}

function listBlock(items, col) {
  return block("[", "]", items.map((flat) => ({ flat })), col);
}

// A record entry `name = value`, where the value may be a list of items too long for one line.
function recordEntry(name, value, items) {
  const flat = `${name} = ${value}`;
  if (!items) return { flat };
  return {
    flat,
    // `col` is the column where the entry's text starts (marker column + 2).
    multi: (col) => (col + flat.length <= MAX_WIDTH ? flat : `${name} =\n${sp(col + 2)}${listBlock(items, col + 2)}`),
  };
}

// ---------------------------------------------------------------------------------------------
// Expressions: a widget's expressions compiled to Elm, with precedence (10 for an atom, 9 for an
// application, then the operators), a type (Int, Bool, String or a list) and hoisted `if`s.

const PREC = { "||": 2, "&&": 3, cmp: 4, "++": 5, "+": 6, "-": 6 };

function wrap(e, min) {
  return e.prec < min ? `(${e.s})` : e.s;
}

// `fn` is the function being written: its let bindings (`hoists`), the widgets it reads
// (`reads`) and the name generator.
function compile(e, fn, w, spec) {
  const atom = (s, t) => ({ s, prec: 10, t });
  const app = (s, t) => ({ s, prec: 9, t });
  const sub = (x) => compile(x, fn, w, spec);
  const fieldType = (widget, name) => {
    const f = widget.fields.find((x) => x.name === name);
    return f.type === "int" ? "Int" : f.type === "bool" ? "Bool" : f.type === "list" ? "List" : "String";
  };
  switch (e[0]) {
    case "f": return atom(`model.${e[1]}`, fieldType(w, e[1]));
    case "w": {
      const src = spec.widgets.find((x) => x.id === e[1]);
      fn.reads.add(src.id);
      return atom(`${fn.names[src.id].value}.${e[2]}`, fieldType(src, e[2]));
    }
    case "k": {
      const v = e[1];
      if (typeof v === "string") return atom(elmString(v), "String");
      if (typeof v === "boolean") return atom(v ? "True" : "False", "Bool");
      return atom(String(v), "Int");
    }
    case "+": case "-": {
      const a = sub(e[1]), b = sub(e[2]);
      return { s: `${wrap(a, 6)} ${e[0]} ${wrap(b, 7)}`, prec: 6, t: "Int" };
    }
    case "count": return app(`List.length ${wrap(sub(e[1]), 10)}`, "Int");
    case "done": return app(`List.length (List.filter .done ${wrap(sub(e[1]), 10)})`, "Int");
    case "left": return app(`List.length (List.filter (not << .done) ${wrap(sub(e[1]), 10)})`, "Int");
    case "len": return app(`String.length ${wrap(sub(e[1]), 10)}`, "Int");
    case "has": return app(`String.contains ${elmString(e[2])} ${wrap(sub(e[1]), 10)}`, "Bool");
    case "==": case "!=": case "<": case "<=": case ">": case ">=": {
      const op = e[0] === "!=" ? "/=" : e[0];
      const a = sub(e[1]), b = sub(e[2]);
      return { s: `${wrap(a, 5)} ${op} ${wrap(b, 5)}`, prec: 4, t: "Bool" };
    }
    case "and": case "or": {
      const op = e[0] === "and" ? "&&" : "||";
      const p = PREC[op];
      const a = sub(e[1]), b = sub(e[2]);
      return { s: `${wrap(a, p + 1)} ${op} ${wrap(b, p)}`, prec: p, t: "Bool" };
    }
    case "not": return app(`not ${wrap(sub(e[1]), 10)}`, "Bool");
    case "if": {
      const c = sub(e[1]), a = sub(e[2]), b = sub(e[3]);
      const name = fn.fresh();
      fn.hoists.push({ name, cond: c.s, a: a.s, b: b.s });
      return atom(name, a.t);
    }
  }
  throw new Error(`unknown expression ${JSON.stringify(e)}`);
}

// The text of a `text` node's parts: an Elm String expression (as an operand: prec).
function textExpr(parts, fn, w, spec) {
  const pieces = [];
  for (const p of parts) {
    if (typeof p === "string") {
      if (typeof pieces[pieces.length - 1] === "string") pieces[pieces.length - 1] += p;
      else pieces.push(p);
    } else {
      const c = compile(p, fn, w, spec);
      pieces.push(c.t === "Int" ? { s: `String.fromInt ${wrap(c, 10)}`, prec: 9 } : c);
    }
  }
  if (pieces.length === 0) return { s: '""', prec: 10 };
  const items = pieces.map((p) => (typeof p === "string" ? { s: elmString(p), prec: 10 } : p));
  if (items.length === 1) return items[0];
  return { s: items.map((i) => wrap(i, 6)).join(" ++ "), prec: 5 };
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
// One widget's module

function widgetModule(spec, w, names) {
  const me = names[w.id];
  const used = { html: new Set(), attrs: new Set(), events: new Set(), ui: new Set(), keyed: false, decode: true };
  const H = (n) => (used.html.add(n), n);
  const A = (n) => (used.attrs.add(n), n);
  const E = (n) => (used.events.add(n), n);
  const U = (n) => (used.ui.add(n), n);
  const bare = (n) => (used.ui.add(n), n);
  const declarations = []; // helper functions after `view`
  let sections = 0;

  const field = (name) => w.fields.find((f) => f.name === name);
  const itemType = (f) => `${cap(f.name)}Item`;
  const typeOf = (f) => (f.type === "int" ? "Int" : f.type === "bool" ? "Bool" : f.type === "list" ? `List ${itemType(f)}` : "String");
  const ctor = (m) => cap(m.name);
  const lists = w.fields.filter((f) => f.type === "list");
  const feed = lists.find((f) => f.feed);
  const ticks = w.fields.filter((f) => f.tick);
  const msgByName = (n) => w.messages.find((m) => m.name === n);

  // ---- values
  const valueText = (f, v) => {
    if (f.type === "int") return String(v);
    if (f.type === "bool") return v ? "True" : "False";
    if (f.type === "list") return null;
    return elmString(v);
  };
  const itemText = (f, it) => `${itemType(f)} ${it.id} ${elmString(it.text)}${f.checkable ? ` ${it.done ? "True" : "False"}` : ""}`;

  // ---- types
  const itemAliases = lists.map((f) => `type alias ${itemType(f)} =
    { id : Int
    , text : String${f.checkable ? "\n    , done : Bool" : ""}
    }`);
  const modelAlias = `type alias Model =
    ${block("{", "}", w.fields.map((f) => ({ flat: `${f.name} : ${typeOf(f)}` })), 4, w.fields.length > 1)}`;

  // ---- Msg
  const payload = (m) => (m.kind === "input" ? (field(m.field).type === "int" ? " Int" : " String") : m.kind === "select" ? " String" : m.kind === "item" ? " Int" : "");
  const ctors = w.messages.map((m) => `${ctor(m)}${payload(m)}`);
  ctors.push("Replaced Model");
  if (feed) ctors.push(`Notified ${itemType(feed)}`);
  const msgType = `type Msg\n    = ${ctors.join("\n    | ")}`;

  // ---- update
  const nameOf = (m) => `new${cap(m.field)}`;
  const branches = w.messages.map((m) => {
    const pat = m.kind === "input" || m.kind === "select" ? `${ctor(m)} ${nameOf(m)}` : m.kind === "item" ? `${ctor(m)} id` : ctor(m);
    return `        ${pat} ->\n${updateBody(m)}`;
  });
  branches.push("        Replaced new ->\n            new");
  if (feed) branches.push(`        Notified entry ->\n            { model | ${feed.name} = model.${feed.name} ++ [ entry ] }`);

  function recordUpdate(assignments, indent = 12) {
    const flat = `{ model | ${assignments.map(([n, v]) => `${n} = ${v}`).join(", ")} }`;
    if (indent + flat.length <= MAX_WIDTH) return `${sp(indent)}${flat}`;
    return `${sp(indent)}{ model\n${assignments.map(([n, v], i) => `${sp(indent + 4)}${i === 0 ? "|" : ","} ${n} = ${v}`).join("\n")}\n${sp(indent)}}`;
  }

  function updateBody(m) {
    switch (m.kind) {
      case "input": case "select": return recordUpdate([[m.field, nameOf(m)]]);
      case "check": return recordUpdate([[m.field, `not model.${m.field}`]]);
      case "item": {
        const l = `model.${m.field}`;
        if (m.op === "toggle") { U("toggleDone"); return recordUpdate([[m.field, `Ui.toggleDone id ${l}`]]); }
        return recordUpdate([[m.field, `List.filter (\\item -> item.id /= id) ${l}`]]);
      }
      case "click": return clickBody(m);
    }
    throw new Error(`unknown message kind ${m.kind}`);
  }

  function clickBody(m) {
    const push = m.ops.find((op) => op[0] === "push");
    if (push) {
      if (m.ops.length !== 1) throw new Error(`${w.id}.${m.name}: a push with other ops`);
      const [, list, draft] = push;
      const f = field(list);
      const l = `model.${list}`;
      U("nextId");
      const item = `${itemType(f)} (Ui.nextId ${l}) (String.trim model.${draft})${f.checkable ? " False" : ""}`;
      return `            if String.isEmpty (String.trim model.${draft}) then
                model

            else
${recordUpdate([[list, `${l} ++ [ ${item} ]`], [draft, '""']], 16)}`;
    }
    const assigned = new Map();
    for (const op of m.ops) {
      const [kind, name] = op;
      if (assigned.has(name)) throw new Error(`${w.id}.${m.name}: two ops on ${name}`);
      const f = field(name);
      const cur = `model.${name}`;
      let rhs;
      switch (kind) {
        case "add": rhs = `clamp ${f.min} ${f.max} (${cur} ${op[2] < 0 ? "-" : "+"} ${Math.abs(op[2])})`; break;
        case "set": rhs = f.type === "bool" ? (op[2] ? "True" : "False") : f.type === "int" ? String(op[2]) : elmString(op[2]); break;
        case "toggle": rhs = `not ${cur}`; break;
        case "reset": rhs = valueText(f, f.initial); break;
        case "cycle": rhs = `${cycleName(f)} ${cur}`; break;
        case "pushText": {
          U("nextId");
          rhs = `${cur} ++ [ ${itemType(f)} (Ui.nextId ${cur}) ${elmString(op[2])}${f.checkable ? " False" : ""} ]`;
          break;
        }
        case "pop": rhs = `List.take (List.length ${cur} - 1) ${cur}`; break;
        case "shift": rhs = `List.drop 1 ${cur}`; break;
        case "clear": rhs = "[]"; break;
        case "clearDone": rhs = `List.filter (not << .done) ${cur}`; break;
        default: throw new Error(`unknown op ${kind}`);
      }
      assigned.set(name, rhs);
    }
    return recordUpdate([...assigned]);
  }

  // The next option of each enum a message cycles.
  const cycles = new Map();
  for (const m of w.messages) for (const op of m.ops || []) if (op[0] === "cycle") cycles.set(op[1], field(op[1]));
  function cycleName(f) { return `next${cap(f.name)}`; }
  const cycleFunctions = [...cycles.values()].map((f) => {
    const head = f.options.slice(0, -1).map((o, i) => `        ${elmString(o)} ->\n            ${elmString(f.options[i + 1])}`);
    return `${cycleName(f)} : String -> String
${cycleName(f)} current =
    case current of
${[...head, `        _ ->\n            ${elmString(f.options[0])}`].join("\n\n")}`;
  });

  // ---- tick
  let tickFn = "";
  if (ticks.length === 1) {
    const f = ticks[0];
    tickFn = `tick : Model -> Model
tick model =
    if model.${f.tickWhen} then
        { model | ${f.name} = min ${f.max} (model.${f.name} + ${f.tick}) }

    else
        model`;
  } else if (ticks.length > 1) {
    tickFn = `tick : Model -> Model
tick model =
    let
${ticks.map((f) => `        ${f.name}Next =
            if model.${f.tickWhen} then
                min ${f.max} (model.${f.name} + ${f.tick})

            else
                model.${f.name}`).join("\n\n")}
    in
    { model | ${ticks.map((f) => `${f.name} = ${f.name}Next`).join(", ")} }`;
  }

  // ---- view
  function newFn(base) {
    let n = 0;
    return { hoists: [], reads: new Set(), names, fresh: () => `${base}${++n === 1 ? "" : n}` };
  }
  const handler = (m, args = "") => `onClick ${args ? `(${ctor(m)} ${args})` : ctor(m)}`;
  const role = (n) => `${bare("dataRole")} ${elmString(n)}`;

  function buildNodes(nodes, fn) {
    return nodes.flatMap((n) => buildNode(n, fn));
  }

  function textDoc(parts, fn) {
    const t = textExpr(parts, fn, w, spec);
    H("text");
    return raw(`text ${t.prec >= 10 ? t.s : `(${t.s})`}`);
  }

  function buildNode(n, fn) {
    const x = (e) => compile(e, fn, w, spec);
    switch (n.el) {
      case "text": return [el(H(n.tag), [], [textDoc(n.parts, fn)])];
      case "button": {
        const m = msgByName(n.msg);
        const attrs = [role(n.msg)];
        if (n.disabled) attrs.push(`${A("disabled")} ${wrap(x(n.disabled), 10)}`);
        attrs.push(handler(m)); E("onClick");
        return [el(H("button"), attrs, [textDoc(n.text, fn)])];
      }
      case "input": {
        const m = msgByName(n.msg);
        const f = field(m.field);
        let attrs;
        if (f.type === "int") {
          attrs = [`${A("type_")} "number"`, role(n.msg), `${A("value")} (String.fromInt model.${f.name})`, `Ui.onNumberInput ${f.min} ${f.max} ${ctor(m)}`];
          U("onNumberInput");
        } else {
          attrs = [`${A("type_")} "text"`, role(n.msg)];
          if (n.placeholder != null) attrs.push(`${A("placeholder")} ${elmString(n.placeholder)}`);
          attrs.push(`${A("value")} model.${f.name}`, `${E("onInput")} ${ctor(m)}`);
        }
        const input = el(H("input"), attrs, []);
        const out = [n.label ? el(H("label"), [], [raw(`text ${elmString(n.label)}`), input]) : input];
        if (n.label) H("text");
        if (n.invalid) {
          U("when");
          const cond = x(n.invalid.when);
          out.push(raw(`Ui.when ${wrap(cond, 10)} (${flatDoc(el(H("p"), [role(`${n.msg}Error`)], [raw(`text ${elmString(n.invalid.message)}`)]))})`));
          H("text");
        }
        return out;
      }
      case "check": {
        const m = msgByName(n.msg);
        const input = el(H("input"), [`${A("type_")} "checkbox"`, role(n.msg), `${A("checked")} model.${m.field}`, handler(m)], []);
        E("onClick"); H("text");
        return [el(H("label"), [], [input, raw(`text ${elmString(n.label)}`)])];
      }
      case "select": {
        const m = msgByName(n.msg);
        const f = field(m.field);
        U("option");
        E("onInput");
        const sel = raw(`${H("select")} [ ${role(n.msg)}, onInput ${ctor(m)} ] (List.map (Ui.option model.${f.name}) [ ${f.options.map(elmString).join(", ")} ])`);
        if (!n.label) return [sel];
        H("text");
        return [el(H("label"), [], [raw(`text ${elmString(n.label)}`), sel])];
      }
      case "list": {
        const f = field(n.field);
        const fnName = `view${cap(n.field)}Item`;
        listViews.push({ n, f, fnName });
        used.keyed = true;
        return [raw(`Keyed.${n.tag} [] (List.map ${fnName} model.${f.name})`)];
      }
      case "when": {
        U("when");
        const cond = x(n.cond);
        const name = sections++ === 0 ? "viewSection" : `viewSection${sections}`;
        const inner = newFn("shown");
        const kids = buildNodes(n.children, inner);
        const body = el(H(n.tag), [], kids);
        declarations.push(viewFunction(name, inner, body));
        const args = [...inner.reads].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
        for (const r of args) fn.reads.add(r);
        return [raw(`Ui.when ${wrap(cond, 10)} (${[name, ...args.map((r) => names[r].value), "model"].join(" ")})`)];
      }
      case "group": {
        return [el(H(n.tag), [], buildNodes(n.children, fn))];
      }
    }
    throw new Error(`unknown view node ${n.el}`);
  }

  const listViews = [];

  // A view function: its signature depends on the widgets its body reads.
  function viewFunction(name, fn, body) {
    const reads = [...fn.reads].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
    const params = [...reads.map((r) => names[r].value), "model"];
    const types = [...reads.map((r) => `${names[r].mod}.Model`), "Model", "Html Msg"];
    const doc = layoutDoc(body, 4, 0);
    let lets = "";
    if (fn.hoists.length) {
      lets = `    let
${fn.hoists.map((h) => `        ${h.name} =
            if ${h.cond} then
                ${h.a}

            else
                ${h.b}`).join("\n\n")}
    in
`;
    }
    return `${name} : ${types.join(" -> ")}
${name} ${params.join(" ")} =
${lets}    ${doc}`;
  }

  // The top-level view.
  const rootFn = newFn("shown");
  const rootKids = buildNodes(w.view, rootFn);
  const rootDoc = (() => {
    const head = `Ui.widget ${elmString(w.id)} ${elmString(w.label)}`;
    const flat = `${head} ${listBlock(rootKids.map(flatDoc), 0)}`;
    if (4 + flat.length <= MAX_WIDTH && !flat.includes("\n")) return flat;
    return `${head.replace(/ ("[^"]*")$/, "\n        $1")}\n        ${kidsLines(rootKids, 8)}`;
  })();
  U("widget");
  const viewText = (() => {
    const reads = [...rootFn.reads].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
    const params = [...reads.map((r) => names[r].value), "model"];
    const types = [...reads.map((r) => `${names[r].mod}.Model`), "Model", "Html Msg"];
    let lets = "";
    if (rootFn.hoists.length) {
      lets = `    let
${rootFn.hoists.map((h) => `        ${h.name} =
            if ${h.cond} then
                ${h.a}

            else
                ${h.b}`).join("\n\n")}
    in
`;
    }
    return `view : ${types.join(" -> ")}
view ${params.join(" ")} =
${lets}    ${rootDoc}`;
  })();

  // Item views.
  const itemViews = listViews.map(({ n, f, fnName }) => {
    const kids = [];
    if (n.check) {
      const m = msgByName(n.check);
      kids.push(el(H("input"), [`${A("type_")} "checkbox"`, role(n.check), `${A("checked")} item.done`, `${E("onClick")} (${ctor(m)} item.id)`], []));
    }
    kids.push(el(H("span"), [], [raw(`${H("text")} item.text`)]));
    if (n.remove) {
      const m = msgByName(n.remove);
      kids.push(el(H("button"), [role(n.remove), `${E("onClick")} (${ctor(m)} item.id)`], [raw(`${H("text")} ${elmString(n.removeText)}`)]));
    }
    const li = el(H("li"), [`${bare("dataKey")} (String.fromInt item.id)`, role(`${n.field}Item`)], kids);
    const flatTuple = `( String.fromInt item.id, ${flatDoc(li)} )`;
    const body = 4 + flatTuple.length <= MAX_WIDTH
      ? flatTuple
      : `( String.fromInt item.id\n    , ${layoutDoc(li, 4, 2)}\n    )`;
    return `${fnName} : ${itemType(f)} -> ( String, Html Msg )
${fnName} item =
    ${body}`;
  });

  // ---- decoders
  const decoderOf = (f) => (f.type === "int" ? "Decode.int" : f.type === "bool" ? "Decode.bool" : f.type === "list" ? `(Decode.list ${f.name}ItemDecoder)` : "Decode.string");
  const fieldDecoder = (f) => `(Decode.field ${elmString(f.name)} ${decoderOf(f)})`;
  const mapN = (ctorName, fields, mapper) => {
    const n = fields.length;
    if (n > 8) throw new Error(`${w.id}: ${n} fields`);
    const fn = n === 1 ? "Decode.map" : `Decode.map${n}`;
    const head = `${fn} ${ctorName}`;
    const flat = `${head} ${fields.map(mapper).join(" ")}`;
    if (4 + flat.length <= MAX_WIDTH) return flat;
    return `${head}\n${fields.map((f) => `        ${mapper(f)}`).join("\n")}`;
  };
  const decoder = `decoder : Decoder Model
decoder =
    ${mapN("Model", w.fields, fieldDecoder)}`;
  const itemDecoders = lists.map((f) => {
    const fields = [["id", "Decode.int"], ["text", "Decode.string"], ...(f.checkable ? [["done", "Decode.bool"]] : [])];
    return `${f.name}ItemDecoder : Decoder ${itemType(f)}
${f.name}ItemDecoder =
    ${mapN(itemType(f), fields, ([k, d]) => `(Decode.field ${elmString(k)} ${d})`)}`;
  });

  // ---- init
  const initEntries = w.fields.map((f) => (f.type === "list"
    ? recordEntry(f.name, listBlock(f.initial.map((it) => itemText(f, it)), 0), f.initial.map((it) => itemText(f, it)))
    : recordEntry(f.name, valueText(f, f.initial))));
  const init = `init : Model
init =
    ${block("{", "}", initEntries, 4)}`;

  // ---- assemble
  const exposed = ["Model", "Msg(..)", "decoder", "init", "update", "view"];
  if (ticks.length) exposed.push("tick");
  if (feed) exposed.push(`${feed.name}ItemDecoder`);
  const htmlNames = new Set(["Html", ...used.html]);
  const imports = [];
  imports.push(`import Html exposing (${exposing(htmlNames)})`);
  if (used.attrs.size) imports.push(`import Html.Attributes exposing (${exposing(used.attrs)})`);
  if (used.events.size) imports.push(`import Html.Events exposing (${exposing(used.events)})`);
  if (used.keyed) imports.push("import Html.Keyed as Keyed");
  imports.push("import Json.Decode as Decode exposing (Decoder)");
  const uiBare = ["dataKey", "dataRole"].filter((n) => used.ui.has(n));
  imports.push(`import Ui${uiBare.length ? ` exposing (${exposing(uiBare)})` : ""}`);
  for (const r of [...rootFn.reads].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))) imports.push(`import Widget.${names[r].mod} as ${names[r].mod}`);

  const parts = [
    `module Widget.${me.mod} exposing (${exposing(exposed)})\n\n${imports.sort().join("\n")}`,
    ...itemAliases,
    modelAlias,
    init,
    msgType,
    `update : Msg -> Model -> Model\nupdate msg model =\n    case msg of\n${branches.join("\n\n")}`,
    ...cycleFunctions,
    ...(tickFn ? [tickFn] : []),
    viewText,
    ...declarations,
    ...itemViews,
    decoder,
    ...itemDecoders,
  ];
  return { source: parts.join("\n\n\n") + "\n", uses: used.ui };
}

// ---------------------------------------------------------------------------------------------
// Ui: what every widget shares

function uiModule(uses) {
  const defs = {
    dataKey: `dataKey : String -> Attribute msg
dataKey =
    attribute "data-key"`,
    dataRole: `dataRole : String -> Attribute msg
dataRole =
    attribute "data-role"`,
    widget: `widget : String -> String -> List (Html msg) -> Html msg
widget id heading children =
    section [ dataKey id, dataRole "widget" ] (h2 [] [ text heading ] :: children)`,
    when: `when : Bool -> Html msg -> Html msg
when condition content =
    if condition then
        content

    else
        text ""`,
    option: `option : String -> String -> Html msg
option current choice =
    Html.option [ value choice, selected (choice == current) ] [ text choice ]`,
    nextId: `nextId : List { a | id : Int } -> Int
nextId items =
    1 + List.foldl (\\item highest -> max item.id highest) 0 items`,
    toggleDone: `toggleDone : Int -> List { a | id : Int, done : Bool } -> List { a | id : Int, done : Bool }
toggleDone id =
    List.map
        (\\item ->
            if item.id == id then
                { item | done = not item.done }

            else
                item
        )`,
    onNumberInput: `{-| Only an integer within the range makes a message: while the input holds anything else
(empty, a lone "-", a number out of range), the decoder fails, nothing is sent, and the input
keeps what the user typed. Like \`onInput\`, it stops propagation, which makes Elm redraw at once
rather than on the next frame.
-}
onNumberInput : Int -> Int -> (Int -> msg) -> Attribute msg
onNumberInput low high toMsg =
    stopPropagationOn "input"
        (targetValue
            |> Decode.andThen
                (\\raw ->
                    case String.toInt raw of
                        Just number ->
                            if number >= low && number <= high then
                                Decode.succeed ( toMsg number, True )

                            else
                                Decode.fail "out of range"

                        Nothing ->
                            Decode.fail "not an integer"
                )
        )`,
  };
  const order = ["dataKey", "dataRole", "widget", "when", "option", "nextId", "toggleDone", "onNumberInput"];
  const always = new Set(["dataKey", "dataRole", "widget"]);
  const names = order.filter((n) => always.has(n) || uses.has(n));
  const exported = names.filter((n) => n !== "dataKey" || uses.has("dataKey"));
  const imports = [`import Html exposing (${exposing(["Attribute", "Html", "h2", "section", "text"])})`,
    `import Html.Attributes exposing (${exposing(uses.has("option") ? ["attribute", "selected", "value"] : ["attribute"])})`];
  if (uses.has("onNumberInput")) {
    imports.push("import Html.Events exposing (stopPropagationOn, targetValue)");
    imports.push("import Json.Decode as Decode");
  }
  return `module Ui exposing (${exposing(exported)})

{-| What the widgets share: the section with its heading, the attributes the markup uses and
a few view and update helpers that know nothing of any widget.
-}

${imports.sort().join("\n")}


${names.map((n) => defs[n]).join("\n\n\n")}
`;
}

// ---------------------------------------------------------------------------------------------
// Main

function namer(spec) {
  const names = {};
  for (const w of spec.widgets) names[w.id] = { mod: pascal(w.label), value: camelCase(w.label), got: `Got${pascal(w.label)}` };
  return names;
}

function mainModule(spec, names, tickers, feeds) {
  const widgets = spec.widgets;
  const n = (w) => names[w.id];
  const out = [];
  const imports = [
    "import Browser",
    "import Html exposing (Html, div)",
    "import Json.Decode as Decode exposing (Decoder)",
    "import Ui",
    ...widgets.map((w) => `import Widget.${n(w).mod} as ${n(w).mod}`),
  ].sort();
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


{-| External events (server pushes, ticks, snapshots), as JSON.
-}
port events : (Decode.Value -> msg) -> Sub msg`);

  out.push(`-- MODEL


type alias Model =
    ${block("{", "}", widgets.map((w) => ({ flat: `${n(w).value} : ${n(w).mod}.Model` })), 4)}


init : () -> ( Model, Cmd Msg )
init _ =
    ( initialModel, Cmd.none )


initialModel : Model
initialModel =
    ${block("{", "}", widgets.map((w) => ({ flat: `${n(w).value} = ${n(w).mod}.init` })), 4)}`);

  const ctors = widgets.map((w) => `${n(w).got} ${n(w).mod}.Msg`);
  if (tickers.length) ctors.push("Tick");
  ctors.push("GotSnapshot Model", "UnknownEvent");
  const cases = widgets.map((w) => `        ${n(w).got} widgetMsg ->
            ( { model | ${n(w).value} = ${n(w).mod}.update widgetMsg model.${n(w).value} }, Cmd.none )`);
  if (tickers.length) {
    cases.push(`        Tick ->
            ( { model
                | ${tickers.map((w) => `${n(w).value} = ${n(w).mod}.tick model.${n(w).value}`).join("\n                , ")}
              }
            , Cmd.none
            )`);
  }
  cases.push("        GotSnapshot snapshot ->\n            ( snapshot, Cmd.none )");
  cases.push("        UnknownEvent ->\n            ( model, Cmd.none )");
  out.push(`-- UPDATE


type Msg
    = ${ctors.join("\n    | ")}


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
${cases.join("\n\n")}`);

  const eventCases = [`                    "serverSet" ->
                        Decode.field "widget" Decode.string
                            |> Decode.andThen (\\id -> Decode.field "state" (serverState id))`];
  if (tickers.length) eventCases.push(`                    "tick" ->
                        Decode.succeed Tick`);
  if (feeds.length) eventCases.push(`                    "notify" ->
                        Decode.field "widget" Decode.string
                            |> Decode.andThen (\\id -> Decode.field "item" (notification id))`);
  eventCases.push(`                    "snapshot" ->
                        Decode.map GotSnapshot (Decode.at [ "state", "widgets" ] modelDecoder)`);
  eventCases.push(`                    _ ->
                        Decode.fail ("unknown event: " ++ kind)`);
  const serverCases = widgets.map((w) => `        ${elmString(w.id)} ->
            Decode.map (${n(w).got} << ${n(w).mod}.Replaced) ${n(w).mod}.decoder`);
  serverCases.push('        _ ->\n            Decode.fail ("unknown widget: " ++ id)');
  const notifyCases = feeds.map(({ w, f }) => `        ${elmString(w.id)} ->
            Decode.map (${n(w).got} << ${n(w).mod}.Notified) ${n(w).mod}.${f.name}ItemDecoder`);
  notifyCases.push('        _ ->\n            Decode.fail ("no feed: " ++ id)');
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
${eventCases.join("\n\n")}
            )


serverState : String -> Decoder Msg
serverState id =
    case id of
${serverCases.join("\n\n")}
${feeds.length ? `

notification : String -> Decoder Msg
notification id =
    case id of
${notifyCases.join("\n\n")}
` : ""}

modelDecoder : Decoder Model
modelDecoder =
    Decode.succeed Model
        ${widgets.map((w) => `|> andMap (Decode.field ${elmString(w.id)} ${n(w).mod}.decoder)`).join("\n        ")}


andMap : Decoder a -> Decoder (a -> b) -> Decoder b
andMap =
    Decode.map2 (|>)`);

  const kids = widgets.map((w) => raw(`Html.map ${n(w).got} (${n(w).mod}.view ${readsOf(w).map((r) => `model.${names[r].value} `).join("")}model.${n(w).value})`));
  const root = `div [ Ui.dataRole "dashboard" ]`;
  const flat = `${root} ${listBlock(kids.map(flatDoc), 0)}`;
  out.push(`-- VIEW


view : Model -> Html Msg
view model =
    ${4 + flat.length <= MAX_WIDTH ? flat : `${root}\n        ${kidsLines(kids, 8)}`}`);

  return out.map((d) => (d.startsWith("-- ") ? "\n" + d : d)).join("\n\n\n") + "\n";
}

// The widgets whose models a widget's view takes: those its expressions read, in order.
function readsOf(w) {
  const reads = new Set();
  const visit = (e) => {
    if (!Array.isArray(e)) return;
    if (e[0] === "w") reads.add(e[1]);
    for (const x of e) visit(x);
  };
  const walk = (n) => {
    for (const k of ["parts", "text"]) if (n[k]) n[k].forEach(visit);
    for (const k of ["cond", "disabled"]) if (n[k]) visit(n[k]);
    if (n.invalid) visit(n.invalid.when);
    (n.children || []).forEach(walk);
  };
  w.view.forEach(walk);
  return [...reads].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}

export function emit(spec) {
  const template = templateFiles({ title: "Unique components" });
  const names = namer(spec);
  const elmJson = JSON.parse(template["elm.json"]);
  delete elmJson.dependencies.direct["elm/regex"];
  const files = { ...template, "elm.json": JSON.stringify(elmJson, null, 4) + "\n" };
  const uses = new Set();
  for (const w of spec.widgets) {
    const { source, uses: u } = widgetModule(spec, w, names);
    for (const x of u) uses.add(x);
    files[`src/Widget/${names[w.id].mod}.elm`] = source;
  }
  files["src/Ui.elm"] = uiModule(uses);
  const tickers = spec.widgets.filter((w) => w.fields.some((f) => f.tick));
  const feeds = spec.widgets.flatMap((w) => w.fields.filter((f) => f.feed).map((f) => ({ w, f })));
  files["src/Main.elm"] = mainModule(spec, names, tickers, feeds);
  return {
    files,
    style: {
      architecture: "TEA with Browser.element: one Model record in Main (a field per widget), one update, one view; a Msg constructor per widget wrapping the widget's Msg (Html.map)",
      components: "one module per widget (Model, Msg, init, update, view, decoder), written out from its description: a record field per state field, a Msg constructor per message, a case branch per message with the ops as record updates, the view tree as Html code; nothing shared but Ui's generic helpers (widget, when, option, nextId, toggleDone, onNumberInput)",
      types: "int Int, bool Bool, text and enum String (options as data in the view and in a case for cycle), list a List of a type alias per list built by its positional constructor",
      derived: "computed in view; an if is a let binding of the view function",
      conditionals: "a view function per conditional section, called as Ui.when condition (viewSection model), which renders an empty text node while the condition fails",
      crossReads: "the view takes the Model of each widget it reads, before its own",
      lists: "Html.Keyed (Keyed.ul / Keyed.ol) with a viewXItem function per list",
      externalEvents: "one incoming port; Json.Decode into the app's messages (serverSet → the widget's Replaced, notify → the feed's Notified, tick → Tick calling each time-driven widget's tick, snapshot → GotSnapshot)",
      events: "onInput for text inputs and the select, onClick for buttons and checkboxes, Ui.onNumberInput (an integer in range, else no message) for number inputs",
      formatting: "as elm-format 0.8.8 writes it; elm.json lists only the dependencies the app imports",
      build: "elm make --optimize, then uglify-js compress (pure_funcs) and mangle passes, as the Elm guide recommends",
    },
  };
}
