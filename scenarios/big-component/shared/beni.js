// The unique-components scenario written in beni, for its browser-inline platform (frameworks/beni-inline/):
// the emitter (scenarios/big-component/beni-inline.js) calls `emitApp` with the framework's template
// files. It lives in the scenario's shared folder, which every measurement's inputs hash covers.
//
// Style (recorded in every generated app's rr.json), following beni's README, its getting-started
// guide and its Conduit example (elm-spa-example's structure, in beni), and the same architecture
// as scenarios/shared-components/shared/beni.js:
// - The Elm Architecture with `Tea.element`, mounted with `Browser.mountAt` at the page's root:
//   one `Model` record in `Main` holding every widget's state (one field per widget), one
//   `update`, one `view` written as markup.
// - One module per widget (`Widget.W1`, `Widget.W2`, …), each written for that widget alone: its
//   own `Model` (one typed field per spec field, lists as records with their own `Item` type),
//   `init`, `Msg` (one constructor per message), `update` (one case arm per message, the ops of a
//   click written out as record updates, `clamp`, `not`, list edits), `view` (markup, every
//   binding and derived text an expression written out in place) and `replace` (its state read
//   from a host value with a derived codec). Time-driven widgets add `tick`, feed widgets
//   `notify`. A widget that reads earlier widgets takes their `Model`s as extra arguments of
//   `view`. Nothing is a table that a routine interprets.
// - `Main` only routes: one `Msg` constructor per widget wrapping the widget's `Msg`
//   (`Html.map` in `view`, one-line branches in `update`), the pushed events, and the schema.
// - Two small generic helpers in `Ui` (independent of every widget): reading an integer within
//   limits, and what a number input shows.
// - Markup: keyed `<For keyed={.id}>` for lists, static markup (text, labels, options) written
//   as markup, conditional sections as `if` holes whose other branch is the empty fragment,
//   `onClick` for buttons and checkboxes, `onInput` for text, number and select inputs. Inputs
//   are controlled, as beni's are: an int with a number input keeps what the user typed beside
//   its last valid number (`Maybe String`), so an input that holds no valid number keeps its text.
// - External events arrive through the project's platform layer (`Push.onPush Pushed`, a
//   subscription; beni has no ports, frameworks/beni/template/Push.beni) as host values. `update`
//   reads one with a `schema` declaration (`Event`, tagged on "type") and hands the widget it names
//   its new state, which the widget reads with a derived codec. A list read from the host is
//   copied (`List.copy`) where the model takes it, as beni's ownership checker asks (lists
//   are edited in place); decoding in `update`, rather than in the subscription's function, is
//   also what that checker accepts.
// - Production build: `beni build --release --source-maps` (frameworks/beni/beni.js).

import { beniString, beniValue } from "../../shared-components/shared/beni.js";

export const STYLE = {
  architecture: "The Elm Architecture: Tea.element, one Model record in Main, one update, one view (markup)",
  components: "one module per widget (Model, init, Msg, update, view, replace; tick and notify where it needs them); Main only routes",
  routing: "one Msg constructor per widget wrapping its Msg, plus Pushed for host events; Html.map in view",
  crossReads: "a widget that reads earlier widgets takes their Models as extra arguments of view",
  lists: "keyed For (.id) for every list",
  conditional: "if holes with an empty fragment",
  derived: "expressions written out in the widget's view (interpolation or markup holes)",
  helpers: "Ui: intIn (integer within limits) and shown (number input text), independent of every widget",
  externalEvents: "project platform layer Push.onPush (Sub.on over a window event), read with a schema declaration and derived codecs",
  inputs: "controlled inputs; an int with a number input keeps its typed text beside its last valid number",
  build: "beni build --release --source-maps (beni's own minifier)",
};

const raw = (text) => ({ raw: text });
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const num = (w) => Number(w.id.slice(1));
const mod = (w) => `W${num(w)}`;

// Words beni reserves as identifiers (docs/design/language.md §2.4).
// Top-level nodes of the big form's view per helper.
const PART = 8;

const RESERVED = new Set("if then else case of let in type alias pub opaque import as exposing foreign".split(" "));

// ---------------------------------------------------------------------------------------------
// Expressions

// Precedence of the rendered expression: 1 `||`, 2 `&&`, 3 comparison, 4 `+ -`, 6 application,
// 7 atom. `if` is 0.
function expr(e, ctx) {
  const wrap = ([s, p], need) => (p < need ? `(${s})` : s);
  const sub = (x, need) => wrap(go(x), need);
  const go = (x) => {
    switch (x[0]) {
      case "f": return [`model.${x[1]}`, 7];
      case "w": ctx.reads.add(x[1]); return [`${x[1]}.${x[2]}`, 7];
      case "k": {
        const v = x[1];
        if (typeof v === "string") return [beniString(v), 7];
        if (typeof v === "boolean") return [v ? "True" : "False", 7];
        return v < 0 ? [`(${v})`, 7] : [String(v), 7];
      }
      case "+": return [`${sub(x[1], 4)} + ${sub(x[2], 5)}`, 4];
      case "-": return [`${sub(x[1], 4)} - ${sub(x[2], 5)}`, 4];
      case "count": return [`List.length ${sub(x[1], 7)}`, 6];
      case "done": return [`List.length (List.filter ${sub(x[1], 7)} λitem → item.done)`, 6];
      case "left": return [`List.length (List.filter ${sub(x[1], 7)} λitem → not item.done)`, 6];
      case "len": return [`String.length ${sub(x[1], 7)}`, 6];
      case "has": return [`String.contains ${sub(x[1], 7)} ${beniString(x[2])}`, 6];
      case "==": return [`${sub(x[1], 4)} == ${sub(x[2], 4)}`, 3];
      case "!=": return [`${sub(x[1], 4)} ≠ ${sub(x[2], 4)}`, 3];
      case "<": return [`${sub(x[1], 4)} < ${sub(x[2], 4)}`, 3];
      case "<=": return [`${sub(x[1], 4)} ≤ ${sub(x[2], 4)}`, 3];
      case ">": return [`${sub(x[1], 4)} > ${sub(x[2], 4)}`, 3];
      case ">=": return [`${sub(x[1], 4)} ≥ ${sub(x[2], 4)}`, 3];
      case "and": return [`${sub(x[1], 2)} && ${sub(x[2], 3)}`, 2];
      case "or": return [`${sub(x[1], 1)} || ${sub(x[2], 2)}`, 1];
      case "not": return [`not ${sub(x[1], 7)}`, 6];
      case "if": return [`if ${sub(x[1], 0)} then ${sub(x[2], 0)} else ${sub(x[3], 0)}`, 0];
    }
    throw new Error(`beni emitter: unknown expression ${JSON.stringify(x)}`);
  };
  return go(e)[0];
}

// ---------------------------------------------------------------------------------------------
// Markup

const IND = "    ";
const pad = (lines, n) => lines.map((l) => (l ? " ".repeat(n) + l : l));
const SAFE_TEXT = /^[A-Za-z0-9 ,.:;!?'()\-+/*%$#@=_]*$/;

// The children of a text-like element: markup text and holes. Static parts that are not plain
// (edge or doubled white space, markup characters) go in string holes.
// With `hoist`, a derived value that is not a plain access is bound to a local of the view first
// (a line that would not fit is shortened that way).
function inlineParts(parts, ctx, hoist = false) {
  return parts.map((p, i) => {
    if (typeof p !== "string") {
      const e = expr(p, ctx);
      if (!hoist || /^[\w.]+$/.test(e)) return `{${e}}`;
      const name = `shown${ctx.locals.length + 1}`;
      ctx.locals.push([name, e, p]);
      return `{${name}}`;
    }
    const edge = (i === 0 && /^\s/.test(p)) || (i === parts.length - 1 && /\s$/.test(p));
    if (p === "" ) return "";
    if (SAFE_TEXT.test(p) && !edge && !/\s\s/.test(p) && !/^\s*$/.test(p)) return p;
    return `{${beniString(p)}}`;
  }).join("");
}

// An element at column `ind`: attributes, then its content, laid out on one line when it fits in
// 100 columns, as `beni fmt` does.
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

// A conditional section: `{if cond then … else <></>}`.
function whenHole(cond, body) {
  return [`{if ${cond} then`, ...pad(body, 4), " else", ...pad(["<></>"], 4), "}"];
}

function viewNodes(nodes, w, ctx, ind) {
  const out = [];
  for (const n of nodes) out.push(...viewNode(n, w, ctx, ind));
  return out;
}

const messageOf = (w, name) => w.messages.find((m) => m.name === name);
const fieldOf = (w, name) => w.fields.find((f) => f.name === name);
const ctorOf = (m) => cap(m.name);

// One view node whose first line sits at column `ind`.
function viewNode(n, w, ctx, ind) {
  const el = (tag, attrs, content, at = ind) => element(tag, attrs, content, at);
  // An element whose content is text: derived values go to locals when the line would not fit.
  const textEl = (tag, attrs, parts) => {
    const flat = el(tag, attrs, inlineParts(parts, ctx));
    return flat.length === 1 ? flat : el(tag, attrs, inlineParts(parts, ctx, true));
  };
  switch (n.el) {
    case "text":
      return textEl(n.tag, [], n.parts);
    case "button": {
      const m = messageOf(w, n.msg);
      const attrs = [`data-role=${beniString(n.msg)}`];
      if (n.disabled) attrs.push(`disabled={${expr(n.disabled, ctx)}}`);
      attrs.push(`onClick={${ctorOf(m)}}`);
      return textEl("button", attrs, n.text);
    }
    case "input": {
      const m = messageOf(w, n.msg);
      const f = fieldOf(w, m.field);
      const attrs = f.type === "int"
        ? [`type="number"`, `data-role=${beniString(n.msg)}`, `value={Ui.shown model.${f.name}Typed model.${f.name}}`, `onInput={${ctorOf(m)}}`]
        : [`type="text"`, `data-role=${beniString(n.msg)}`, ...(n.placeholder != null ? [`placeholder=${beniString(n.placeholder)}`] : []),
          `value={model.${f.name}}`, `onInput={${ctorOf(m)}}`];
      const labelled = n.label
        ? el("label", [], [inlineParts([n.label], ctx), ...el("input", attrs, null, ind + 4)])
        : el("input", attrs, null);
      if (!n.invalid) return labelled;
      const error = el("p", [`data-role=${beniString(n.msg + "Error")}`], inlineParts([n.invalid.message], ctx), ind + 4);
      return [...labelled, ...whenHole(expr(n.invalid.when, ctx), error)];
    }
    case "check": {
      const m = messageOf(w, n.msg);
      const input = el("input", [`type="checkbox"`, `data-role=${beniString(n.msg)}`, `checked={model.${m.field}}`, `onClick={${ctorOf(m)}}`], null, ind + 4);
      return el("label", [], [...input, inlineParts([n.label], ctx)]);
    }
    case "select": {
      const m = messageOf(w, n.msg);
      const f = fieldOf(w, m.field);
      const at = n.label ? ind + 4 : ind;
      const options = f.options.flatMap((o) => el("option", [`value=${beniString(o)}`], inlineParts([o], ctx), at + 4));
      const select = el("select", [`data-role=${beniString(n.msg)}`, `value={model.${f.name}}`, `onInput={${ctorOf(m)}}`], options, at);
      return n.label ? el("label", [], [inlineParts([n.label], ctx), ...select]) : select;
    }
    case "list": {
      const at = ind + 16; // ul, For, the lambda's braces, li
      const item = [];
      if (n.check) item.push(...el("input", [`type="checkbox"`, `data-role=${beniString(n.check)}`, "checked={item.done}", `onClick={${ctorOf(messageOf(w, n.check))} item.id}`], null, at + 4));
      item.push("<span>{item.text}</span>");
      if (n.remove) item.push(...el("button", [`data-role=${beniString(n.remove)}`, `onClick={${ctorOf(messageOf(w, n.remove))} item.id}`], inlineParts([n.removeText], ctx), at + 4));
      const li = el("li", ["data-key={String.fromInt item.id}", `data-role=${beniString(n.field + "Item")}`], item, at);
      const each = [`<For each={model.${n.field}} keyed={.id}>`, ...pad(["{λitem →", ...pad(li, 4), "}"], 4), "</For>"];
      return el(n.tag, [], each);
    }
    case "when":
      return whenHole(expr(n.cond, ctx), el(n.tag, [], viewNodes(n.children, w, ctx, ind + 8), ind + 4));
    case "group":
      return el(n.tag, [], viewNodes(n.children, w, ctx, ind + 4));
  }
  throw new Error(`beni emitter: unknown view node ${n.el}`);
}

// ---------------------------------------------------------------------------------------------
// Updates

// A record update `{ base | a = x, b = y }`, on one line when it fits at `indent`.
function recordSet(base, fields, indent) {
  const flat = `{ ${base} | ${fields.map(([k, v]) => `${k} = ${v}`).join(", ")} }`;
  if (flat.length + indent <= 100 && !flat.includes("\n")) return [flat];
  const lines = fields.flatMap(([k, v], i) => {
    const lead = i ? ", " : "| ";
    const one = `${lead}${k} = ${v}`;
    if (indent + 4 + one.length <= 100 || v.includes("\n")) return [one];
    // A list that is an append is laid out one item per line, as `beni fmt` does.
    const append = v.match(/^\[ (…\S+), (\{.*\}) \]$/);
    if (indent + 8 + v.length > 100 && append) return [`${lead}${k} =`, `${IND}[ ${append[1]}`, `${IND}, ${append[2]}`, `${IND}]`];
    return [`${lead}${k} =`, IND + v];
  });
  return [`{ ${base}`, ...pad(lines, 4), "}"];
}

// An integer literal as a function argument or operand: a negative one in parentheses.
const lit = (n) => (n < 0 ? `(${n})` : String(n));

const itemType = (f) => `${cap(f.name)}Item`;
const nextIdFn = (f) => `next${cap(f.name)}Id`;

// The body of one message's arm, as lines. Ops of a click apply in order: those that touch
// independent fields share one record update; an op reading a field that an earlier op wrote
// starts a new step.
function armBody(w, m) {
  const fields = Object.fromEntries(w.fields.map((f) => [f.name, f]));
  switch (m.kind) {
    case "input": {
      const f = fields[m.field];
      if (f.type !== "int") return recordSet("model", [[f.name, "typed"]], 12);
      return [
        `case Ui.intIn typed ${lit(f.min)} ${lit(f.max)} of`,
        ...pad([`Just parsed →`, ...pad(recordSet("model", [[f.name, "parsed"], [`${f.name}Typed`, "Nothing"]], 16), 4), "",
          "Nothing →", ...pad(recordSet("model", [[`${f.name}Typed`, "Just typed"]], 16), 4)], 4),
      ];
    }
    case "check": return recordSet("model", [[m.field, `not model.${m.field}`]], 12);
    case "select": return recordSet("model", [[m.field, "chosen"]], 12);
    case "item": {
      const f = fields[m.field];
      if (m.op === "remove") return recordSet("model", [[f.name, `List.filter model.${f.name} λitem → item.id ≠ id`]], 12);
      return ["{ model", ...pad([`| ${f.name} =`, ...pad([`List.map model.${f.name} λitem →`, ...pad(["if item.id == id then { item | done = not item.done } else item"], 4)], 4)], 4), "}"];
    }
  }
  return clickBody(w, m, fields);
}

function clickBody(w, m, fields) {
  const stmts = []; // [name, lines]
  let base = "model";
  let pending = new Map();
  let steps = 0;
  const cur = (name) => `${base}.${name}`;
  const flush = () => {
    if (pending.size === 0) return;
    const name = `step${++steps}`;
    stmts.push([name, recordSet(base, [...pending], 4 + name.length + 3)]);
    base = name;
    pending = new Map();
  };
  const needs = (name) => { if (pending.has(name)) flush(); };
  for (const op of m.ops) {
    const [kind, name] = op;
    const f = fields[name];
    switch (kind) {
      case "add": {
        needs(name);
        const sum = op[2] < 0 ? `${cur(name)} - ${-op[2]}` : `${cur(name)} + ${op[2]}`;
        pending.set(name, `clamp (${sum}) ${lit(f.min)} ${lit(f.max)}`);
        break;
      }
      case "set": pending.set(name, typeof op[2] === "string" ? beniString(op[2]) : typeof op[2] === "boolean" ? (op[2] ? "True" : "False") : String(op[2])); break;
      case "toggle": needs(name); pending.set(name, `not ${cur(name)}`); break;
      case "reset": pending.set(name, beniValue(f.initial)); break;
      case "cycle": {
        needs(name);
        // Each option leads to the next; the last wraps to the first.
        const arms = f.options.slice(0, -1).flatMap((o, i) => [`${beniString(o)} →`, `    ${beniString(f.options[i + 1])}`, ""]);
        const next = `next${++steps}`;
        stmts.push([next, [`case ${cur(name)} of`, ...pad([...arms, "_ →", `    ${beniString(f.options[0])}`], 4)]]);
        pending.set(name, next);
        break;
      }
      case "push": {
        flush();
        const draft = op[2];
        const name2 = `step${++steps}`;
        const item = f.checkable ? `{ id = ${nextIdFn(f)} ${base}.${name}, text = trimmed${steps}, done = False }` : `{ id = ${nextIdFn(f)} ${base}.${name}, text = trimmed${steps} }`;
        stmts.push([`trimmed${steps}`, [`String.trim ${base}.${draft}`]]);
        // Laid out for the column of its `if`: 16 as a binding, 12 as the arm's value.
        const from = base;
        stmts.push([name2, (col) => ["if String.isEmpty trimmed" + steps + " then", ...pad([from], 4), "else", ...pad(recordSet(from, [[name, `[ …${from}.${name}, ${item} ]`], [draft, '""']], col + 4), 4)]]);
        base = name2;
        break;
      }
      case "pushText": {
        needs(name);
        const item = f.checkable ? `{ id = ${nextIdFn(f)} ${cur(name)}, text = ${beniString(op[2])}, done = False }` : `{ id = ${nextIdFn(f)} ${cur(name)}, text = ${beniString(op[2])} }`;
        pending.set(name, `[ …${cur(name)}, ${item} ]`);
        break;
      }
      case "pop": needs(name); pending.set(name, `List.pop ${cur(name)}`); break;
      case "shift": needs(name); pending.set(name, `List.drop ${cur(name)} 1`); break;
      case "clear": pending.set(name, "[]"); break;
      case "clearDone": needs(name); pending.set(name, `List.filter ${cur(name)} λitem → not item.done`); break;
      default: throw new Error(`beni emitter: unknown op ${kind}`);
    }
  }
  let final;
  if (pending.size) final = recordSet(base, [...pending], 12);
  else final = [base];
  // A last step that nothing follows is the arm's value itself.
  if (pending.size === 0 && stmts.length && stmts[stmts.length - 1][0] === base) final = stmts.pop()[1];
  if (typeof final === "function") final = final(12);
  const lines = [];
  for (const [name, build] of stmts) {
    const body = typeof build === "function" ? build(16) : build;
    if (body.length === 1 && name.length + body[0].length + 3 + 12 <= 100) lines.push(`${name} = ${body[0]}`);
    else lines.push(`${name} =`, ...pad(body, 4));
  }
  // Multi-line values: a `case` expression written as one inside a record field value is
  // flattened by the caller's layout; see `layout`.
  return [...lines, ...final];
}

// ---------------------------------------------------------------------------------------------
// The widget module

function layoutMultiline(lines) {
  // A record field whose value is a multi-line `case` is written below its name; the cycle
  // value is built with embedded newlines, indented here.
  const out = [];
  for (const l of lines) out.push(...l.split("\n"));
  return out;
}

function widgetModule(w, widgets) {
  const f = (name) => fieldOf(w, name);
  const numberFields = w.messages.filter((m) => m.kind === "input" && f(m.field).type === "int").map((m) => m.field);
  const typed = new Set(numberFields);
  for (const name of typed) {
    if (w.fields.some((x) => x.name === `${name}Typed`)) throw new Error(`beni emitter: ${w.id} has a field ${name}Typed`);
  }
  for (const x of w.fields) if (RESERVED.has(x.name)) throw new Error(`beni emitter: ${w.id} field ${x.name} is a beni keyword`);

  const ctx = { reads: new Set(), locals: [] };
  // The locals a view function binds first (derived values that would not fit on a line).
  const localsOf = (c) => c.locals.flatMap(([name, e, ast]) => {
    if (name.length + e.length + 7 <= 100) return [`${name} = ${e}`];
    if (ast[0] !== "if") return [`${name} =`, IND + e];
    // A long `if`, laid out as `beni fmt` does: the condition on the `if` line when it fits.
    const cx = expr(ast[1], c), ax = expr(ast[2], c), bx = expr(ast[3], c);
    const head = 8 + `if ${cx} then`.length <= 100 ? [`${IND}if ${cx} then`] : [`${IND}if`, `${IND}${IND}${cx}`, `${IND}then`];
    return [`${name} =`, ...head, `${IND}${IND}${ax}`, `${IND}else`, `${IND}${IND}${bx}`];
  });
  // The big form is one flat list of field units, so its view is split into helpers (`part1 model`,
  // …) of PART consecutive top-level nodes, each with its own locals and returned as a fragment
  // (`<>…</>`): a helper's view has one root, and an input with a validation is two nodes (label,
  // error). The companion keeps its view whole.
  const sections = [];
  const topNodes = w.kind === "form" ? w.view : null;
  const viewContent = topNodes
    ? Array.from({ length: Math.ceil(topNodes.length / PART) }, (_, i) => {
      const c = { reads: new Set(), locals: [] };
      const body = viewNodes(topNodes.slice(i * PART, (i + 1) * PART), w, c, 8);
      for (const r of c.reads) ctx.reads.add(r);
      sections.push(`part${i + 1} : Model → Html Msg\npart${i + 1} model =\n${pad([...localsOf(c), "<>", ...body, "</>"], 4).join("\n")}`);
      return [`{part${i + 1} model}`];
    }).flat()
    : viewNodes(w.view, w, ctx, 8);
  const viewBody = [
    `<section data-key=${beniString(w.id)} data-role="widget">`,
    ...pad(element("h2", [], inlineParts([w.label], ctx), 8), 4),
    ...pad(viewContent, 4),
    "</section>",
  ];
  const reads = [...ctx.reads].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  const locals = localsOf(ctx);

  const lists = w.fields.filter((x) => x.type === "list");
  const pushes = new Set();
  for (const m of w.messages) for (const op of m.ops || []) if (op[0] === "push" || op[0] === "pushText") pushes.add(op[1]);
  const typeOf = (x) => ({ int: "Int", bool: "Bool", text: "String", enum: "String", list: `List ${itemType(x)}` })[x.type];

  const out = [];
  const imports = ["import Html exposing (Html)", "import Json", "import Schema exposing (Value)"];
  if (typed.size) imports.push("import Ui");
  for (const id of reads) imports.push(`import Widget.${id.toUpperCase()} as ${id.toUpperCase()}`);
  imports.sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  out.push(`--! ${w.label}: ${w.fields.length} field${w.fields.length === 1 ? "" : "s"} (${w.kind}), ${w.messages.length} message${w.messages.length === 1 ? "" : "s"}.\n\n${imports.join("\n")}`);

  for (const l of lists) {
    out.push(`pub type alias ${itemType(l)} =\n    id : Int\n    text : String${l.checkable ? "\n    done : Bool" : ""}`);
  }
  const modelFields = w.fields.flatMap((x) => [`    ${x.name} : ${typeOf(x)}`, ...(typed.has(x.name) ? [`    ${x.name}Typed : Maybe String`] : [])]);
  out.push(`pub type alias Model =\n${modelFields.join("\n")}`);

  const initial = {};
  for (const x of w.fields) {
    initial[x.name] = x.type === "list" ? x.initial : x.initial;
    if (typed.has(x.name)) initial[`${x.name}Typed`] = raw("Nothing");
  }
  const initOne = beniValue(initial, "");
  const flatInit = beniValue(initial, "");
  out.push(`pub init : ⊤ → Model\n${flatInit.length + 9 <= 100 && !flatInit.includes("\n") ? `init ⊤ = ${flatInit}` : `init ⊤ =\n    ${beniValue(initial, "    ")}`}`);

  const ctorType = (m) => ({ input: " String", select: " String", item: " Int", check: "", click: "" })[m.kind];
  if (w.messages.length === 0) throw new Error(`beni emitter: ${w.id} has no messages`);
  out.push(`pub type Msg\n    = ${w.messages.map((m) => ctorOf(m) + ctorType(m)).join("\n    | ")}`);

  for (const l of lists) {
    if (pushes.has(l.name)) {
      out.push(`${nextIdFn(l)} : List ${itemType(l)} → Int\n${nextIdFn(l)} items = 1 + List.foldl items 0 λitem highest → max item.id highest`);
    }
  }

  const argName = { input: " typed", select: " chosen", item: " id", check: "", click: "" };
  const arms = w.messages.map((m) => `${ctorOf(m)}${argName[m.kind]} →\n${pad(layoutMultiline(armBody(w, m)), 4).join("\n")}`);
  out.push(`pub update : Msg, Model → Model\nupdate msg model =\n    case msg of\n${pad(arms.join("\n\n").split("\n"), 8).join("\n")}`);

  // replace
  const copies = w.fields.map((x) => `${x.name} = ${x.type === "list" ? `List.copy new.${x.name}` : `new.${x.name}`}`);
  const typedReset = [...typed].map((name) => `${name}Typed = Nothing`);
  if (lists.length === 0 && typed.size === 0) {
    out.push(`--| The state the host sent, or the model as it was when it sent none.\npub replace : Value, Model → Model\nreplace state model = Result.withDefault (Json.decodeValue state) model`);
  } else {
    const rec = beniValue(Object.fromEntries([...copies, ...typedReset].map((s) => { const i = s.indexOf(" = "); return [s.slice(0, i), raw(s.slice(i + 3))]; })), "            ");
    out.push(`--| The state the host sent, or the model as it was when it sent none.\npub replace : Value, Model → Model\nreplace state model =\n    case Json.decodeValue state of\n        Ok new →\n            ${rec}\n\n        Err _ →\n            model`);
  }

  // tick
  const ticks = w.fields.filter((x) => x.tick);
  if (ticks.length) {
    const step = (x) => `min ${lit(x.max)} (model.${x.name} + ${x.tick})`;
    let body;
    if (ticks.length === 1) {
      const x = ticks[0];
      body = `tick model =\n    if model.${x.tickWhen} then\n${pad(recordSet("model", [[x.name, step(x)]], 8), 8).join("\n")}\n    else\n        model`;
    } else {
      body = `tick model =\n${pad(recordSet("model", ticks.map((x) => [x.name, `if model.${x.tickWhen} then ${step(x)} else model.${x.name}`]), 4), 4).join("\n")}`;
    }
    out.push(`--| One tick of the host's clock.\npub tick : Model → Model\n${body}`);
  }

  // notify
  const feeds = w.fields.filter((x) => x.feed);
  if (feeds.length) {
    if (feeds.length > 1) throw new Error(`beni emitter: ${w.id} has several feeds`);
    const x = feeds[0];
    out.push(`--| The item the host sent, last; or the model as it was when it sent none.\npub notify : Value, Model → Model\nnotify item model =\n    case Json.decodeValue item of\n        Ok new →\n            { model | ${x.name} = [ …model.${x.name}, new ] }\n\n        Err _ →\n            model`);
  }

  const sig = ["Model", ...reads.map((id) => `${id.toUpperCase()}.Model`)].join(", ");
  for (const sec of sections) out.push(sec);
  out.push(`pub view : ${sig} → Html Msg\nview ${["model", ...reads].join(" ")} =\n${pad([...locals, ...viewBody], 4).join("\n")}`);
  return out.join("\n\n\n") + "\n";
}

const UI_MODULE = `--! What several widgets share, independent of any one of them.

--| The whole number a text holds, when it lies between the limits.
pub intIn : String, Int, Int → Maybe Int
intIn typed low high =
    case String.toInt typed of
        Just number →
            if number ≥ low && number ≤ high then Just number else Nothing

        Nothing →
            Nothing


--| What a number input shows: the text the user typed while it holds no valid
--| number, else the number.
pub shown : Maybe String, Int → String
shown typed number = Maybe.withDefault typed (String.fromInt number)
`;

// ---------------------------------------------------------------------------------------------
// Main

function mainModule(spec) {
  const widgets = spec.widgets;
  const wname = (w) => w.id;
  const ctor = (w) => `${mod(w)}Msg`;
  const clocks = widgets.filter((w) => w.fields.some((x) => x.tick));
  const feeds = widgets.filter((w) => w.fields.some((x) => x.feed));
  const out = [];

  const imports = [
    "import Browser", "import Cmd exposing (Cmd)", "import Html exposing (Html)", "import Push",
    "import Schema exposing (Value)", "import Sub exposing (Sub)", "import Tea",
    ...widgets.map((w) => `import Widget.${mod(w)} as ${mod(w)}`).sort(),
  ];
  out.push(`--! The dashboard: ${widgets.length} widget${widgets.length === 1 ? "" : "s"}, each written by its own module (\`Widget.W*\`), in The Elm
--! Architecture: one model holding every widget's state, one update that hands each
--! widget its own messages, and one view.

${imports.join("\n")}


main : Tea.Program
main =
    Browser.mountAt
        (Tea.element { init = init, update = update, view = view, subscriptions = subscriptions })
        "root"`);

  out.push(`-- ---- Model ---------------------------------------------------------------------


type alias Model =
${widgets.map((w) => `    ${wname(w)} : ${mod(w)}.Model`).join("\n")}`);
  out.push(`init : ⊤ → Model × Cmd Msg
init ⊤ =
    ( ${beniValue(Object.fromEntries(widgets.map((w) => [wname(w), raw(`${mod(w)}.init ⊤`)])), "      ")}
    , Cmd.none
    )`);

  const set = (fields, indent) => recordSet("model", fields, indent).join("\n" + " ".repeat(indent));
  out.push(`-- ---- Update --------------------------------------------------------------------


type Msg
    = ${[...widgets.map((w) => `${ctor(w)} ${mod(w)}.Msg`), "Pushed Value"].join("\n    | ")}`);
  out.push(`update : Msg, Model → Model × Cmd Msg
update msg model = ( step msg model, Cmd.none )`);
  const arms = widgets.map((w) => `        ${ctor(w)} widgetMsg →\n            ${set([[wname(w), `${mod(w)}.update widgetMsg model.${wname(w)}`]], 12)}`);
  out.push(`step : Msg, Model → Model
step msg model =
    case msg of
${arms.join("\n\n")}

        Pushed value →
            pushed value model`);

  const byWidget = (list, call) => list.map((w) =>
    `        ${beniString(w.id)} →\n            ${set([[wname(w), `${call(w)} model.${wname(w)}`]], 12)}`).join("\n\n");
  out.push(`-- ---- External events -----------------------------------------------------------


subscriptions : Model → Sub Msg
subscriptions _ = Push.onPush Pushed`);
  out.push(`--| What the host pushes: a widget's new state, a tick of the clocks, an item
--| for a feed, or a new state for every widget at once.
schema Event tagged "type" of
    ServerSet as "serverSet"
        widget : String
        state : Value
    Tick as "tick"
    Notify as "notify"
        widget : String
        item : Value
    Snapshot as "snapshot"
        state : Snapshot`);
  out.push(`schema Snapshot =
    widgets : Widgets`);
  out.push(`schema Widgets =
${widgets.map((w) => `    ${wname(w)} : Value as ${beniString(w.id)}`).join("\n")}`);
  const tick = clocks.length === 0 ? "model" : set(clocks.map((w) => [wname(w), `${mod(w)}.tick model.${wname(w)}`]), 12);
  const snapshotFields = widgets.map((w) => [wname(w), `${mod(w)}.replace widgets.${wname(w)} model.${wname(w)}`]);
  const snapshotRecord = snapshotFields.map(([k, v], i) => {
    const one = `${i ? ", " : "{ "}${k} = ${v}`;
    return one.length + 12 <= 100 ? one : `${i ? ", " : "{ "}${k} =\n                ${v}`;
  }).join("\n            ") + "\n            }";
  out.push(`pushed : Value, Model → Model
pushed value model =
    case Schema.read (Event.schema ⊤) value of
        Ok (Event.ServerSet event) →
            replaced event.widget event.state model

        Ok Event.Tick →
            ${tick}

        Ok (Event.Notify event) →
            ${feeds.length ? "notified event.widget event.item model" : "model"}

        Ok (Event.Snapshot event) →
            widgets = event.state.widgets
            ${snapshotRecord}

        Err _ →
            model`);
  out.push(`replaced : String, Value, Model → Model
replaced widget state model =
    case widget of
${byWidget(widgets, (w) => `${mod(w)}.replace state`)}

        _ →
            model`);
  if (feeds.length) {
    out.push(`notified : String, Value, Model → Model
notified widget item model =
    case widget of
${byWidget(feeds, (w) => `${mod(w)}.notify item`)}

        _ →
            model`);
  }

  const hole = (fn, args) => {
    const flat = `        {${fn} ${args.join(" ")}`;
    if (flat.length + 1 <= 100) return flat + "}";
    if (flat.length <= 100) return flat + "\n        }";
    return `        {${fn}\n${args.map((a) => "            " + a).join("\n")}\n        }`;
  };
  const views = widgets.map((w) => {
    const reads = readsOf(w);
    return hole("Html.map", [`(${mod(w)}.view ${["model." + wname(w), ...reads.map((id) => `model.${id}`)].join(" ")})`, ctor(w)]);
  });
  out.push(`-- ---- View ----------------------------------------------------------------------


view : Model → Html Msg
view model =
    <div data-role="page">
${views.join("\n")}
    </div>`);
  return out.join("\n\n\n") + "\n";
}

function readsOf(w) {
  const ctx = { reads: new Set(), locals: [] };
  viewNodes(w.view, w, ctx, 8);
  return [...ctx.reads].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}

// ---------------------------------------------------------------------------------------------
// The app

export function emitApp(spec, templateFiles) {
  const files = {
    ...templateFiles({ name: `rr-big-n${spec.options.size}-s${spec.options.seed}`, title: `big-component n=${spec.options.size} seed=${spec.options.seed}` }),
    "src/Main.beni": mainModule(spec),
  };
  if (spec.widgets.some((w) => w.messages.some((m) => m.kind === "input" && fieldOf(w, m.field).type === "int"))) files["src/Ui.beni"] = UI_MODULE;
  for (const w of spec.widgets) files[`src/Widget/${mod(w)}.beni`] = widgetModule(w, spec.widgets);
  // A section's heading comment is followed by one blank line, as `beni fmt` writes it.
  for (const [name, text] of Object.entries(files)) {
    if (name.endsWith(".beni")) files[name] = text.replace(/^(-- ---- .*)\n\n\n/gm, "$1\n\n");
  }
  return { files, style: STYLE };
}
