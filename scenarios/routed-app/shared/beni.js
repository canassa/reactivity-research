// The routed-app scenario written in beni, for its browser-inline platform (frameworks/beni-inline/):
// the emitter (scenarios/routed-app/beni-inline.js) calls `emitApp` with the framework's template
// files. It lives in the scenario's shared folder, which every measurement's inputs hash covers.
//
// Style (recorded in every generated app's rr.json), following beni's README and getting-started
// guide, its Conduit example (elm-spa-example's structure, in beni: the model is the page the
// viewer is on, each page a model, messages, `update` and `view` of its own), and the same
// architecture as scenarios/unique-components/shared/beni.js, whose markup and update writers
// this file adapts to refs (page, tab, modal and global state):
// - The Elm Architecture with `Tea.element`, mounted with `Browser.mountAt` at the page's root.
//   `Main` holds `{ route, menu, global, page }`: the shell's state, the global state (one
//   `Global` record, module `Global`) and `page`, a custom type with a constructor per page
//   (`P1 P1.Model | P2 P2.Model | …`). Entering a route replaces `page` with that page's `init`,
//   so page-local state lives and dies with its page, as in Conduit.
// - One module per page (`Page.P1`, …), each written for that page alone: its own `Model` (page
//   fields, plus the active tab's panel as a custom type `Panel` with a constructor per tab, and
//   the open modal as a `Maybe`), `Msg` (one constructor per message, plus `Visit` for its links
//   and one constructor per tab and per timer), `update`, `view` (markup), and per tab and
//   modal a `view` function of their own. A tab panel's or modal's state is built when it mounts
//   (`ShowTab2`, `OpenNote`) and dropped when it leaves. A page that writes global state has
//   `update : Msg, Model, Global → Model × Global`; one that does not has `update : Msg, Model → Model`.
//   Nothing is a table that a routine interprets, except the shell's list of pages (`Pages`),
//   which is genuine data.
// - `Main` only routes: a constructor per page wrapping the page's `Msg` (`Html.map` in `view`,
//   a case on the pair `( msg, page )` in `update`, which drops a message for a page that was
//   left), the shell's own messages, the pushed events, and the schema. A link in a page is its
//   `Visit route` message, which `Main` turns into navigation.
// - Time: a time-driven field is a subscription of its page (or tab panel), `Interval.every`,
//   declared by the page's `subscriptions` only while the model holds that page (or that panel),
//   so beni starts it when the page mounts and cancels it when the page leaves (`Sub`'s contract:
//   "No program ever unsubscribes"). beni's own `Time.every` is a chain of `Task.sleep`s
//   (`setTimeout`); the scenario asks for one `setInterval` per mounted field, so `Interval`, in
//   the project's platform layer next to `Push` (a `Sub.on` over `setInterval`/`clearInterval`),
//   is that subscription.
// - External events arrive through the project's platform layer (`Push.onPush Pushed`, one
//   subscription for the whole app; beni has no ports). `update` reads one with a `schema`
//   declaration (`Event`, tagged on "type"). A `pagePush` is handed to the page shown and
//   dropped otherwise.
// - Markup: keyed `<For keyed={.id}>` for lists and for the shell's pages, static markup written
//   as markup, conditional sections as `if` holes whose other branch is the empty fragment,
//   `onClick` for buttons and checkboxes, `onInput` for text, number and select inputs. Inputs
//   are controlled, as beni's are: an int with a number input keeps what the user typed beside
//   its last valid number (`Maybe String`).
// - `aria-current` is written twice (a button with it and one without) in an `if`, because beni's
//   shipped vocabulary has `aria-*` only as a `String` attribute that is never removed. The
//   button of a page entering or leaving the nav bar's current mark is therefore replaced.
// - A list read from the host is copied (`List.copy`) where the model takes it, as beni's
//   ownership checker asks (lists are edited in place).
// - Production build: `beni build --release --source-maps` (frameworks/beni/beni.js).

import { beniString, beniValue } from "../../shared-components/shared/beni.js";

export const STYLE = {
  architecture: "The Elm Architecture: Tea.element; Main = { route, menu, global, page }, page a custom type with a constructor per page",
  components: "one module per page (Model, init, Msg, update, view; subscriptions, notify where it needs them); tab panels and the modal are types and view functions of their page's module",
  routing: "route in the model; Main.enter replaces `page` with the entered page's init (page state resets); a link is the page's Visit message",
  globalState: "module Global (one record); a page that writes it returns Model × Global from update; views take it as an argument",
  lifetime: "tab panel = Panel custom type built on ShowTabN; modal = Maybe, built on its open message; messages for what is gone are dropped",
  time: "Interval.every (project platform layer: Sub.on over setInterval/clearInterval), declared by the page's subscriptions only while the page or its panel is in the model",
  lists: "keyed For (.id) for every list",
  conditional: "if holes with an empty fragment",
  derived: "expressions written out in the page's view (interpolation or markup holes)",
  helpers: "Ui: intIn (integer within limits) and shown (number input text); Pages: the shell's table of pages",
  externalEvents: "project platform layer Push.onPush (Sub.on over a window event), read with a schema declaration; pagePush handed to the page shown",
  inputs: "controlled inputs; an int with a number input keeps its typed text beside its last valid number",
  ariaCurrent: "the nav button is written twice in an if (aria-* has no removable form in beni's vocabulary)",
  build: "beni build --release --source-maps (beni's own minifier)",
};

const raw = (text) => ({ raw: text });
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const modName = (p) => `P${p.id.slice(1)}`;

// Words beni reserves as identifiers (docs/design/language.md §2.4).
const RESERVED = new Set("if then else case of let in type alias pub opaque import as exposing foreign".split(" "));

// ---------------------------------------------------------------------------------------------
// Components: the page, a tab panel or the modal, with the variable its fields are read from.

function makeComp(kind, data, page, spec, index = 0) {
  const gdesc = Object.fromEntries(spec.global.map((f) => [f.name, f]));
  const comp = {
    kind, data, page, index,
    fields: data.fields, messages: data.messages, view: data.view,
    cv: kind === "page" ? "model" : kind === "tab" ? "panel" : "modal",
    gdesc,
  };
  const typed = new Set(data.messages.filter((m) => m.kind === "input" && m.field[0] === "f" && fieldIn(data.fields, m.field[1]).type === "int").map((m) => m.field[1]));
  comp.typed = typed;
  return comp;
}

function fieldIn(fields, name) {
  const f = fields.find((x) => x.name === name);
  if (!f) throw new Error(`beni emitter: no field ${name}`);
  return f;
}

// The field a ref names, seen from `comp`.
function descOf(ref, comp) {
  if (ref[0] === "g") return comp.gdesc[ref[1]];
  if (ref[0] === "p") return fieldIn(comp.page.fields, ref[1]);
  return fieldIn(comp.fields, ref[1]);
}

// The variable a ref's record lives in, in a view.
function refVar(ref, comp) {
  return ref[0] === "g" ? "global" : ref[0] === "p" ? "model" : comp.cv;
}

const messageOf = (comp, name) => comp.messages.find((m) => m.name === name);
const ctorOf = (m) => cap(m.name);
const itemType = (f) => `${cap(f.name)}Item`;
const nextIdFn = (f) => `next${cap(f.name)}Id`;

// ---------------------------------------------------------------------------------------------
// Expressions

// Precedence of the rendered expression: 1 `||`, 2 `&&`, 3 comparison, 4 `+ -`, 6 application,
// 7 atom. `if` is 0.
function expr(e, comp) {
  const wrap = ([s, p], need) => (p < need ? `(${s})` : s);
  const sub = (x, need) => wrap(go(x), need);
  const go = (x) => {
    switch (x[0]) {
      case "f": case "p": case "g": return [`${refVar(x, comp)}.${x[1]}`, 7];
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
// (edge or doubled white space, markup characters) go in string holes. With `hoist`, a derived
// value that is not a plain access is bound to a local of the view first.
function inlineParts(parts, ctx, hoist = false) {
  return parts.map((p, i) => {
    if (typeof p !== "string") {
      const e = expr(p, ctx.comp);
      if (!hoist || /^[\w.]+$/.test(e)) return `{${e}}`;
      const name = `shown${ctx.locals.length + 1}`;
      ctx.locals.push([name, e, p]);
      return `{${name}}`;
    }
    const edge = (i === 0 && /^\s/.test(p)) || (i === parts.length - 1 && /\s$/.test(p));
    if (p === "") return "";
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

function viewNodes(nodes, ctx, ind) {
  const out = [];
  for (const n of nodes) out.push(...viewNode(n, ctx, ind));
  return out;
}

// One view node whose first line sits at column `ind`.
function viewNode(n, ctx, ind) {
  const comp = ctx.comp;
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
      const m = messageOf(comp, n.msg);
      const attrs = [`data-role=${beniString(n.msg)}`];
      if (n.disabled) attrs.push(`disabled={${expr(n.disabled, comp)}}`);
      attrs.push(`onClick={${ctorOf(m)}}`);
      return textEl("button", attrs, n.text);
    }
    case "link": {
      ctx.visits = true;
      const attrs = [`data-key=${beniString(n.to)}`, `data-role="pageLink"`, `onClick={Visit ${beniString(n.to)}}`];
      return el("button", attrs, inlineParts([n.text], ctx));
    }
    case "open": {
      const m = messageOf(comp, n.msg);
      return el("button", [`data-role=${beniString(n.msg)}`, `onClick={${ctorOf(m)}}`], inlineParts([n.text], ctx));
    }
    case "tabs": return tabsNode(ctx, ind);
    case "input": {
      const m = messageOf(comp, n.msg);
      const f = descOf(m.field, comp);
      const v = refVar(m.field, comp);
      const attrs = f.type === "int"
        ? [`type="number"`, `data-role=${beniString(n.msg)}`, `value={Ui.shown ${v}.${f.name}Typed ${v}.${f.name}}`, `onInput={${ctorOf(m)}}`]
        : [`type="text"`, `data-role=${beniString(n.msg)}`, ...(n.placeholder != null ? [`placeholder=${beniString(n.placeholder)}`] : []),
          `value={${v}.${f.name}}`, `onInput={${ctorOf(m)}}`];
      const labelled = n.label
        ? el("label", [], [inlineParts([n.label], ctx), ...el("input", attrs, null, ind + 4)])
        : el("input", attrs, null);
      if (!n.invalid) return labelled;
      const error = el("p", [`data-role=${beniString(n.msg + "Error")}`], inlineParts([n.invalid.message], ctx), ind + 4);
      return [...labelled, ...whenHole(expr(n.invalid.when, comp), error)];
    }
    case "check": {
      const m = messageOf(comp, n.msg);
      const input = el("input", [`type="checkbox"`, `data-role=${beniString(n.msg)}`, `checked={${refVar(m.field, comp)}.${m.field[1]}}`, `onClick={${ctorOf(m)}}`], null, ind + 4);
      return el("label", [], [...input, inlineParts([n.label], ctx)]);
    }
    case "select": {
      const m = messageOf(comp, n.msg);
      const f = descOf(m.field, comp);
      const at = n.label ? ind + 4 : ind;
      const options = f.options.flatMap((o) => el("option", [`value=${beniString(o)}`], inlineParts([o], ctx), at + 4));
      const select = el("select", [`data-role=${beniString(n.msg)}`, `value={${refVar(m.field, comp)}.${f.name}}`, `onInput={${ctorOf(m)}}`], options, at);
      return n.label ? el("label", [], [inlineParts([n.label], ctx), ...select]) : select;
    }
    case "list": {
      const at = ind + 16; // ul, For, the lambda's braces, li
      const item = [];
      if (n.check) item.push(...el("input", [`type="checkbox"`, `data-role=${beniString(n.check)}`, "checked={item.done}", `onClick={${ctorOf(messageOf(comp, n.check))} item.id}`], null, at + 4));
      item.push("<span>{item.text}</span>");
      if (n.remove) item.push(...el("button", [`data-role=${beniString(n.remove)}`, `onClick={${ctorOf(messageOf(comp, n.remove))} item.id}`], inlineParts([n.removeText], ctx), at + 4));
      const li = el("li", ["data-key={String.fromInt item.id}", `data-role=${beniString(n.field[1] + "Item")}`], item, at);
      const each = [`<For each={${refVar(n.field, comp)}.${n.field[1]}} keyed={.id}>`, ...pad(["{λitem →", ...pad(li, 4), "}"], 4), "</For>"];
      return el(n.tag, [], each);
    }
    case "when":
      return whenHole(expr(n.cond, comp), el(n.tag, [], viewNodes(n.children, ctx, ind + 8), ind + 4));
    case "group":
      return el(n.tag, [], viewNodes(n.children, ctx, ind + 4));
  }
  throw new Error(`beni emitter: unknown view node ${n.el}`);
}

// The tab bar and the active panel's view.
function tabsNode(ctx, ind) {
  const page = ctx.comp.page;
  const buttons = page.tabs.flatMap((t, i) =>
    element("button", [`data-key=${beniString(t.id)}`, `data-role="tab"`, `aria-selected={selected ${beniString(t.id)} model.panel}`, `onClick={ShowTab${i + 1}}`],
      inlineParts([t.label], ctx), ind + 4));
  const arms = page.tabs.flatMap((t, i) => [`Panel${i + 1} panel →`, `    viewTab${i + 1} panel model global`, ""]);
  arms.pop();
  return [...element("nav", [`data-role="tabs"`], buttons, ind), "{case model.panel of", ...pad(arms, 4), "}"];
}

// The locals a view hoisted, as bindings.
function localsLines(ctx) {
  return ctx.locals.flatMap(([name, e, ast]) => {
    if (name.length + e.length + 7 <= 100) return [`${name} = ${e}`];
    if (ast[0] !== "if") return [`${name} =`, IND + e];
    // A long `if`, laid out as `beni fmt` does: the condition on the `if` line when it fits.
    const c = expr(ast[1], ctx.comp), a = expr(ast[2], ctx.comp), b = expr(ast[3], ctx.comp);
    const head = 8 + `if ${c} then`.length <= 100 ? [`${IND}if ${c} then`] : [`${IND}if`, `${IND}${IND}${c}`, `${IND}then`];
    return [`${name} =`, ...head, `${IND}${IND}${a}`, `${IND}else`, `${IND}${IND}${b}`];
  });
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
    const append = v.match(/^\[ (…\S+), (\{.*\}) \]$/);
    if (indent + 8 + v.length > 100 && append) return [`${lead}${k} =`, ...pad(appendList(append[1].slice(1), append[2], indent + 8), 4)];
    return [`${lead}${k} =`, IND + v];
  });
  return [`{ ${base}`, ...pad(lines, 4), "}"];
}

// A pair on one line when it fits at `col`, else one element per line.
function pair(a, b, col) {
  const flat = `( ${a.join("\n")}, ${b} )`;
  if (a.length === 1 && flat.length + col <= 100) return [flat];
  return [`( ${a[0]}`, ...a.slice(1).map((l) => (l === "}" ? "  }" : l)), `, ${b}`, ")"];
}

const lit = (n) => (n < 0 ? `(${n})` : String(n));
const valueLit = (v) => (typeof v === "string" ? beniString(v) : typeof v === "boolean" ? (v ? "True" : "False") : lit(v));

// The ops of a message (or the single effect of an input, a check, a select, an item control) as
// bindings and the new record for each of the page (P), the component (C, a tab panel or the
// modal) and the global state (G). Ops apply in order: those that touch independent fields share
// one record update; an op reading a field that an earlier op wrote starts a new step.
// `[ …list, item ]`, one item per line when it does not fit at `indent`.
function appendList(list, item, indent) {
  const flat = `[ …${list}, ${item} ]`;
  if (flat.length + indent <= 100) return [flat];
  if (`, ${item}`.length + indent <= 100) return [`[ …${list}`, `, ${item}`, "]"];
  // The item does not fit either: its fields one per line.
  const fields = item.slice(2, -2).split(/, (?=text = |done = )/);
  return [`[ …${list}`, `, { ${fields[0]}`, ...fields.slice(1).map((f) => `  , ${f}`), "  }", "]"];
}

function messageProgram(comp, m, col) {
  const kindOf = (ref) => (ref[0] === "g" ? "G" : ref[0] === "p" || comp.kind === "page" ? "P" : "C");
  const cur = { P: "model", C: comp.cv, G: "global" };
  const pending = { P: new Map(), C: new Map(), G: new Map() };
  const stmts = []; // [name, lines | (col) => lines]
  let steps = 0;
  const used = { P: false, C: false, G: false };
  const flush = (rec) => {
    if (pending[rec].size === 0) return;
    const name = `step${++steps}`;
    stmts.push([name, recordSet(cur[rec], [...pending[rec]], col + 4)]);
    cur[rec] = name;
    pending[rec] = new Map();
  };
  // The current value of a field: flushes first when an earlier op of this message wrote it.
  const read = (ref) => {
    const rec = kindOf(ref);
    if (pending[rec].has(ref[1])) flush(rec);
    return `${cur[rec]}.${ref[1]}`;
  };
  const write = (ref, value) => {
    const rec = kindOf(ref);
    used[rec] = true;
    pending[rec].set(ref[1], value);
    if (ref[0] === "f" && comp.typed.has(ref[1])) pending[rec].set(`${ref[1]}Typed`, "Nothing");
  };
  const nextId = (ref) => (ref[0] === "g" ? "Global.nextId" : nextIdFn(descOf(ref, comp)));
  const newItem = (ref, list, text) => {
    const f = descOf(ref, comp);
    return f.checkable ? `{ id = ${nextId(ref)} ${list}, text = ${text}, done = False }` : `{ id = ${nextId(ref)} ${list}, text = ${text} }`;
  };

  const ops = m.ops || [];
  switch (m.kind) {
    case "input": {
      const f = descOf(m.field, comp);
      if (f.type !== "int") { write(m.field, "typed"); break; }
      const rec = kindOf(m.field);
      used[rec] = true;
      const base = cur[rec];
      stmts.push(["updated", [
        `case Ui.intIn typed ${lit(f.min)} ${lit(f.max)} of`,
        ...pad([`Just parsed →`, ...pad(recordSet(base, [[f.name, "parsed"], [`${f.name}Typed`, "Nothing"]], col + 12), 4), "",
          "Nothing →", ...pad(recordSet(base, [[`${f.name}Typed`, "Just typed"]], col + 12), 4)], 4),
      ]]);
      cur[rec] = "updated";
      break;
    }
    case "check": write(m.field, `not ${read(m.field)}`); break;
    case "select": write(m.field, "chosen"); break;
    case "item": {
      const l = read(m.field);
      if (m.op === "remove") write(m.field, `List.filter ${l} λitem → item.id ≠ id`);
      else {
        stmts.push(["toggled", [`List.map ${l} λitem →`, "    if item.id == id then { item | done = not item.done } else item"], true]);
        write(m.field, "toggled");
      }
      break;
    }
    case "click": case "confirm": {
      for (const op of ops) {
        const [kind, ref] = op;
        const f = descOf(ref, comp);
        switch (kind) {
          case "add": {
            const c = read(ref);
            write(ref, `clamp (${op[2] < 0 ? `${c} - ${-op[2]}` : `${c} + ${op[2]}`}) ${lit(f.min)} ${lit(f.max)}`);
            break;
          }
          case "set": write(ref, valueLit(op[2])); break;
          case "toggle": write(ref, `not ${read(ref)}`); break;
          case "reset": write(ref, beniValue(f.initial)); break;
          case "copy": write(ref, read(op[2])); break;
          case "cycle": {
            const c = read(ref);
            // Each option leads to the next; the last wraps to the first.
            const arms = f.options.slice(0, -1).flatMap((o, i) => [`${beniString(o)} →`, `    ${beniString(f.options[i + 1])}`, ""]);
            const next = `next${++steps}`;
            stmts.push([next, [`case ${c} of`, ...pad([...arms, "_ →", `    ${beniString(f.options[0])}`], 4)]]);
            write(ref, next);
            break;
          }
          case "push": {
            const draft = op[2];
            const d = read(draft), l = read(ref);
            const n = ++steps;
            stmts.push([`trimmed${n}`, [`String.trim ${d}`]]);
            stmts.push([`added${n}`, [`if String.isEmpty trimmed${n} then`, `    ${l}`, "else", ...pad(appendList(l, newItem(ref, l, `trimmed${n}`), col + 8), 4)]]);
            write(ref, `added${n}`);
            // The draft is emptied when its text was kept; a modal's draft goes with the modal.
            if (!(comp.kind === "modal" && draft[0] === "f")) write(draft, `if String.isEmpty trimmed${n} then ${d} else ""`);
            break;
          }
          case "pushText": {
            const l = read(ref);
            write(ref, `[ …${l}, ${newItem(ref, l, beniString(op[2]))} ]`);
            break;
          }
          case "pop": write(ref, `List.pop ${read(ref)}`); break;
          case "shift": write(ref, `List.drop ${read(ref)} 1`); break;
          case "clear": write(ref, "[]"); break;
          case "clearDone": write(ref, `List.filter ${read(ref)} λitem → not item.done`); break;
          default: throw new Error(`beni emitter: unknown op ${kind}`);
        }
      }
      break;
    }
    default: throw new Error(`beni emitter: message kind ${m.kind}`);
  }
  return { cur, pending, stmts, flush, used, steps: () => steps };
}

// An arm's lines: bindings, then the page record (and the global state, if the page returns it).
// `col` is the column of the arm's first line.
function armLines(comp, m, wg, col) {
  const prog = messageProgram(comp, m, col);
  const { cur, pending, stmts } = prog;
  const needC = comp.kind !== "page";
  const inlineOnly = !needC && !wg; // the page record alone is the arm's value
  // A page's own record (and the global state) go in the result itself when a line holds them.
  const inline = {};
  for (const r of ["P", "G"]) {
    if (comp.kind !== "page" || pending[r].size === 0) continue;
    const lines1 = recordSet(cur[r], [...pending[r]], inlineOnly ? col : col + 2);
    if (inlineOnly || (lines1.length === 1 && lines1[0].length + col + 20 <= 100)) inline[r] = lines1.join("\n");
  }
  for (const r of ["P", "C", "G"]) if (!inline[r]) prog.flush(r);
  const wrap = (p) => (wg ? `( ${p}, ${inline.G ?? cur.G} )` : p);
  let result;
  if (comp.kind === "page") result = wrap(inline.P ?? cur.P);
  else if (comp.kind === "tab") result = wrap(`{ ${cur.P} | panel = Panel${comp.index + 1} ${cur.C} }`);
  else result = wrap(m.kind === "confirm" ? `{ ${cur.P} | modal = Nothing }` : `{ ${cur.P} | modal = Just ${cur.C} }`);

  const lines = [];
  for (const [name, body, headOnLine] of stmts) {
    if (body.length === 1 && name.length + body[0].length + 3 + col <= 100) lines.push(`${name} = ${body[0]}`);
    else if (headOnLine) lines.push(`${name} = ${body[0]}`, ...body.slice(1));
    else lines.push(`${name} =`, ...pad(body, 4));
  }
  return [...lines, ...result.split("\n")];
}

// The arm of a message, unwrapping the tab panel or the modal it belongs to.
function messageArm(comp, m, wg) {
  const ctor = ctorOf(m);
  const arg = { input: " typed", select: " chosen", item: " id", check: "", click: "", open: "", close: "", confirm: "" }[m.kind];
  const stale = wg ? "( model, global )" : "model";
  const ret = (e) => (wg ? `( ${e}, global )` : e);
  if (m.kind === "open") return [`${ctor} →`, ...pad([ret(`{ model | modal = Just (initModal ⊤) }`)], 4)];
  if (m.kind === "close") return [`${ctor}${arg} →`, ...pad([ret(`{ model | modal = Nothing }`)], 4)];
  if (comp.kind === "page") return [`${ctor}${arg} →`, ...pad(armLines(comp, m, wg, 12), 4)];
  const [scrutinee, pattern, other] = comp.kind === "tab"
    ? ["model.panel", `Panel${comp.index + 1} panel`, "_"]
    : ["model.modal", "Just modal", "Nothing"];
  return [`${ctor}${arg} →`, ...pad([`case ${scrutinee} of`, ...pad([`${pattern} →`, ...pad(armLines(comp, m, wg, 20), 4), "", `${other} →`, ...pad([stale], 4)], 4)], 4)];
}

// Whether a message writes global state.
function writesGlobal(m) {
  const refs = [];
  if (m.kind === "click" || m.kind === "confirm") for (const op of m.ops) refs.push(op[1]);
  else if (m.field) refs.push(m.field);
  return refs.some((r) => r[0] === "g");
}

// ---------------------------------------------------------------------------------------------
// The page module

function pageModule(page, spec) {
  const comps = [makeComp("page", page, page, spec)];
  (page.tabs || []).forEach((t, i) => comps.push(makeComp("tab", t, page, spec, i)));
  if (page.modal) comps.push(makeComp("modal", page.modal, page, spec));
  const [pageComp, ...rest] = comps;
  const tabComps = rest.filter((c) => c.kind === "tab");
  const modalComp = rest.find((c) => c.kind === "modal");

  for (const c of comps) {
    for (const x of c.fields) {
      if (RESERVED.has(x.name) || x.name === "panel" || x.name === "modal") throw new Error(`beni emitter: ${page.id} field ${x.name} is a beni keyword or a name of the generator`);
    }
  }
  const wg = comps.some((c) => c.messages.some(writesGlobal));
  const typeOf = (x) => ({ int: "Int", bool: "Bool", text: "String", enum: "String", list: `List ${itemType(x)}` })[x.type];
  const out = [];

  // Views first: they find links, and what the module imports.
  const views = comps.map((c) => {
    const ctx = { comp: c, locals: [], visits: false };
    let body;
    if (c.kind === "page") {
      const nodes = viewNodes(c.view, ctx, 8);
      const modalHole = modalComp
        ? ["{case model.modal of", "    Just modal →", "        viewModal modal model global", "", "    Nothing →", "        <></>", "}"]
        : [];
      body = [`<main data-key=${beniString(page.id)} data-role="page">`,
        ...pad(element("h1", [], inlineParts([page.title], ctx), 8), 4), ...pad(nodes, 4), ...pad(modalHole, 4), "</main>"];
    } else if (c.kind === "tab") {
      body = [`<section data-key=${beniString(c.data.id)} data-role="panel">`, ...pad(viewNodes(c.view, ctx, 8), 4), "</section>"];
    } else {
      body = [`<aside data-key="modal" data-role="dialog">`, ...pad(element("h2", [], inlineParts([c.data.title], ctx), 8), 4), ...pad(viewNodes(c.view, ctx, 8), 4), "</aside>"];
    }
    return { ctx, text: pad([...localsLines(ctx), ...body], 4).join("\n") };
  });
  const visits = views.some((v) => v.ctx.visits);

  const lists = [];
  for (const c of comps) for (const x of c.fields) if (x.type === "list") lists.push(x);
  const pushed = new Set();
  for (const c of comps) {
    for (const m of c.messages) {
      for (const op of m.ops || []) {
        if ((op[0] === "push" || op[0] === "pushText") && op[1][0] !== "g") pushed.add(op[1][1]);
      }
    }
  }
  const typedAny = comps.some((c) => c.typed.size);
  const liveFields = (c) => c.fields.filter((x) => x.every);
  const live = comps.some((c) => liveFields(c).length);
  const feed = page.fields.find((x) => x.feed);

  const imports = ["import Global exposing (Global)", "import Html exposing (Html)"];
  if (feed) imports.push("import Json", "import Schema exposing (Value)");
  if (live) imports.push("import Interval", "import Sub exposing (Sub)");
  if (typedAny) imports.push("import Ui");
  imports.sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  const summary = [`${page.fields.length} field${page.fields.length === 1 ? "" : "s"}`, `${page.messages.length} message${page.messages.length === 1 ? "" : "s"}`];
  if (tabComps.length) summary.push(`${tabComps.length} tabs`);
  if (modalComp) summary.push("a modal");
  out.push(`--! ${page.title}: ${summary.join(", ")}. The page, its tab panels and its modal live here, and\n--! all of their state is dropped when the page is left.\n\n${imports.join("\n")}`);

  // Types.
  for (const l of lists) {
    out.push(`pub type alias ${itemType(l)} =\n    id : Int\n    text : String${l.checkable ? "\n    done : Bool" : ""}`);
  }
  const modelFields = (c, extra = []) => [
    ...c.fields.flatMap((x) => [`    ${x.name} : ${typeOf(x)}`, ...(c.typed.has(x.name) ? [`    ${x.name}Typed : Maybe String`] : [])]),
    ...extra,
  ];
  tabComps.forEach((c, i) => out.push(`pub type alias Tab${i + 1} =\n${modelFields(c).join("\n")}`));
  if (modalComp) out.push(`pub type alias Modal =\n${modelFields(modalComp).join("\n")}`);
  if (tabComps.length) {
    out.push(`--| The panel of the tab shown: a tab's state exists only while it is.\npub type Panel\n    = ${tabComps.map((c, i) => `Panel${i + 1} Tab${i + 1}`).join("\n    | ")}`);
  }
  out.push(`pub type alias Model =\n${modelFields(pageComp, [...(tabComps.length ? ["    panel : Panel"] : []), ...(modalComp ? ["    modal : Maybe Modal"] : [])]).join("\n")}`);

  // init
  const initialOf = (c) => {
    const o = {};
    for (const x of c.fields) {
      o[x.name] = x.initial;
      if (c.typed.has(x.name)) o[`${x.name}Typed`] = raw("Nothing");
    }
    return o;
  };
  const initFn = (name, type, o) => {
    const flat = beniValue(o, "");
    return `${name} : ⊤ → ${type}\n${flat.length + name.length + 5 <= 100 && !flat.includes("\n") ? `${name} ⊤ = ${flat}` : `${name} ⊤ =\n    ${beniValue(o, "    ")}`}`;
  };
  tabComps.forEach((c, i) => out.push(initFn(`initTab${i + 1}`, `Tab${i + 1}`, initialOf(c))));
  if (modalComp) out.push(initFn("initModal", "Modal", initialOf(modalComp)));
  out.push("pub " + initFn("init", "Model", {
    ...initialOf(pageComp),
    ...(tabComps.length ? { panel: raw("Panel1 (initTab1 ⊤)") } : {}),
    ...(modalComp ? { modal: raw("Nothing") } : {}),
  }));

  // Msg
  const ctorArg = { input: " String", select: " String", item: " Int", check: "", click: "", open: "", close: "", confirm: "" };
  const ctors = [];
  const seen = new Set();
  const add = (name, text) => {
    if (seen.has(name)) throw new Error(`beni emitter: ${page.id} has two constructors named ${name}`);
    seen.add(name);
    ctors.push(text);
  };
  for (const c of comps) for (const m of c.messages) add(ctorOf(m), ctorOf(m) + ctorArg[m.kind]);
  if (visits) add("Visit", "Visit String");
  tabComps.forEach((_, i) => add(`ShowTab${i + 1}`, `ShowTab${i + 1}`));
  if (liveFields(pageComp).length) add("TickPage", "TickPage");
  tabComps.forEach((c, i) => { if (liveFields(c).length) add(`TickTab${i + 1}`, `TickTab${i + 1}`); });
  out.push(`pub type Msg\n    = ${ctors.join("\n    | ")}`);

  for (const l of lists) {
    if (pushed.has(l.name)) {
      out.push(`${nextIdFn(l)} : List ${itemType(l)} → Int\n${nextIdFn(l)} items = 1 + List.foldl items 0 λitem highest → max item.id highest`);
    }
  }

  // update
  const arms = [];
  for (const c of comps) for (const m of c.messages) arms.push(messageArm(c, m, wg));
  if (visits) arms.push(["Visit _ →", ...pad([wg ? "( model, global )" : "model", ], 4)]);
  tabComps.forEach((c, i) => {
    arms.push([`ShowTab${i + 1} →`, ...pad(["case model.panel of", `    Panel${i + 1} _ →`, `        ${wg ? "( model, global )" : "model"}`, "", "    _ →",
      ...pad([wg ? `( { model | panel = Panel${i + 1} (initTab${i + 1} ⊤) }, global )` : `{ model | panel = Panel${i + 1} (initTab${i + 1} ⊤) }`], 8)], 4)]);
  });
  const step = (x) => `min ${lit(x.max)} (${"%V"}.${x.name} + ${x.every ? x.by : 0})`;
  const tickRecord = (cv, x) => `{ ${cv} | ${x.name} = ${step(x).replace("%V", cv)} }`;
  if (liveFields(pageComp).length) {
    const x = liveFields(pageComp)[0];
    arms.push(["TickPage →", ...pad([wg ? `( ${tickRecord("model", x)}, global )` : tickRecord("model", x)], 4)]);
  }
  tabComps.forEach((c, i) => {
    if (!liveFields(c).length) return;
    const x = liveFields(c)[0];
    const next = recordSet("model", [["panel", `Panel${i + 1} ${tickRecord("panel", x)}`]], 20 + (wg ? 2 : 0));
    arms.push([`TickTab${i + 1} →`, ...pad(["case model.panel of", `    Panel${i + 1} panel →`, ...pad(wg ? pair(next, "global", 20) : next, 8), "", "    _ →", `        ${wg ? "( model, global )" : "model"}`], 4)]);
  });
  const armText = arms.map((a) => pad(a, 8).join("\n")).join("\n\n");
  out.push(wg
    ? `pub update : Msg, Model, Global → Model × Global\nupdate msg model global =\n    case msg of\n${armText}`
    : `pub update : Msg, Model → Model\nupdate msg model =\n    case msg of\n${armText}`);

  // subscriptions
  if (live) {
    const pageSub = liveFields(pageComp).length ? `Interval.every ${liveFields(pageComp)[0].every} TickPage` : null;
    const tabArms = tabComps.flatMap((c, i) => (liveFields(c).length ? [`Panel${i + 1} _ →`, `    Interval.every ${liveFields(c)[0].every} TickTab${i + 1}`, ""] : []));
    const panelSub = tabArms.length ? ["case model.panel of", ...pad([...tabArms, "_ →", "    Sub.none"], 4)] : null;
    let body;
    if (pageSub && panelSub) body = `subscriptions model =\n    Sub.batch\n        [ ${pageSub}\n        , ${panelSub.join("\n" + " ".repeat(10))}\n        ]`;
    else if (pageSub) body = `subscriptions _ = ${pageSub}`;
    else body = `subscriptions model =\n${pad(panelSub, 4).join("\n")}`;
    out.push(`--| The timers the page needs now: one for the time-driven field of the page, one for that of the tab shown.\npub subscriptions : Model → Sub Msg\n${body}`);
  }

  // The feed
  if (feed) {
    out.push(`--| The item the host sent, last; or the model as it was when it sent none.\npub notify : Value, Model → Model\nnotify item model =\n    case Json.decodeValue item of\n        Ok new →\n            { model | ${feed.name} = [ …model.${feed.name}, new ] }\n\n        Err _ →\n            model`);
  }

  // views
  if (tabComps.length) {
    out.push(`tabId : Panel → String\ntabId panel =\n    case panel of\n${tabComps.map((_, i) => `        Panel${i + 1} _ →\n            "t${i + 1}"`).join("\n\n")}`);
    out.push(`selected : String, Panel → String\nselected id panel = if tabId panel == id then "true" else "false"`);
  }
  tabComps.forEach((c, i) => out.push(`viewTab${i + 1} : Tab${i + 1}, Model, Global → Html Msg\nviewTab${i + 1} panel model global =\n${views[1 + i].text}`));
  if (modalComp) out.push(`viewModal : Modal, Model, Global → Html Msg\nviewModal modal model global =\n${views[views.length - 1].text}`);
  out.push(`pub view : Model, Global → Html Msg\nview model global =\n${views[0].text}`);
  return out.join("\n\n\n") + "\n";
}

// ---------------------------------------------------------------------------------------------
// Shared modules

const UI_MODULE = `--! What several pages share, independent of any one of them.

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

const INTERVAL_MODULE = `--! Timers for the program, in the project's platform layer. beni's own \`Time.every\` is a
--! chain of \`Task.sleep\`s; a page's clock is one \`setInterval\` that lives while the subscription
--! is in the set, and is cleared when it leaves.

import Js
import Sub exposing (Sub)


type Key
    = Every Int


--| A message every \`ms\` milliseconds, for as long as the subscription is declared. Two
--| declarations of one period share one timer.
pub every : Int, msg → Sub msg
every ms tag = Sub.on (Every ms) (start ms _) λ_ → tag


start : Int, sync (⊤ → ⊤) → (⊤ → ⊤)
start ms send =
    timer = Js.apply (Js.global "setInterval") [ Js.from λ⊤ → send ⊤, Js.from ms ]
    λ⊤ → Js.to (Js.apply (Js.global "clearInterval") [ timer ])
`;

function globalModule(spec) {
  const initial = Object.fromEntries(spec.global.map((f) => [f.name, f.initial]));
  const init = beniValue(initial, "    ");
  const copy = (name) => `${name} = List.copy new.${name}`;
  return `--! The state every page shares, and the shell reads: the signed-in user, the cart, the
--! notices, a currency, a balance and a connection flag. It lives in \`Main\`'s model and outlives
--! the pages; pages receive it and, where they change it, return it.

import Json
import Schema exposing (Value)


pub type alias Item =
    id : Int
    text : String


pub type alias Global =
    user : String
    cart : List Item
    notices : List Item
    currency : String
    balance : Int
    online : Bool


pub init : ⊤ → Global
init ⊤ =
    ${init}


pub nextId : List Item → Int
nextId items = 1 + List.foldl items 0 λitem highest → max item.id highest


--| The server's new value of one field, or the state as it was when the field or the value
--| is not one it knows.
pub set : String, Value, Global → Global
set field value global =
    case field of
        "user" →
            { global | user = Result.withDefault (Json.decodeValue value) global.user }

        "currency" →
            { global | currency = Result.withDefault (Json.decodeValue value) global.currency }

        "balance" →
            { global | balance = Result.withDefault (Json.decodeValue value) global.balance }

        "online" →
            { global | online = Result.withDefault (Json.decodeValue value) global.online }

        _ →
            global


--| The item the server sent, last.
pub notify : Value, Global → Global
notify item global =
    case Json.decodeValue item of
        Ok new →
            { global | notices = [ …global.notices, new ] }

        Err _ →
            global


--| A whole new state, as the server sends it on a re-sync.
pub replace : Value, Global → Global
replace state global =
    case Json.decodeValue state of
        Ok new →
            { user = new.user
            , ${copy("cart")}
            , ${copy("notices")}
            , currency = new.currency
            , balance = new.balance
            , online = new.online
            }

        Err _ →
            global
`;
}

function pagesModule(spec) {
  const links = spec.pages.map((p) => ({ id: p.id, title: p.title }));
  return `--! The shell's list of pages, for the nav bar and the "All pages" menu: genuine data, one
--! entry per page.

pub type alias Link =
    id : String
    title : String


pub all : List Link
${(() => { const flat = beniValue(links, ""); return flat.length + 6 <= 100 && !flat.includes("\n") ? `all = ${flat}` : `all =\n    ${beniValue(links, "    ")}`; })()}


--| The pages the nav bar links to.
pub pinned : List Link
pinned = List.take all ${spec.pinned.length}
`;
}

// ---------------------------------------------------------------------------------------------
// Main

function mainModule(spec) {
  const pages = spec.pages;
  const P = modName;
  const livePages = pages.filter((p) => p.fields.some((f) => f.every) || (p.tabs || []).some((t) => t.fields.some((f) => f.every)));
  const feedPages = pages.filter((p) => p.fields.some((f) => f.feed));
  const linkPages = pages.filter((p) => hasLink(p));
  const wgPages = new Set(pages.filter((p) => [p, ...(p.tabs || []), ...(p.modal ? [p.modal] : [])].some((c) => c.messages.some(writesGlobal))).map((p) => p.id));
  const out = [];

  const imports = [
    "import Browser", "import Cmd exposing (Cmd)", "import Global exposing (Global)", "import Html exposing (Html)", "import Pages", "import Push",
    "import Schema exposing (Value)", "import Sub exposing (Sub)", "import Tea",
    ...pages.map((p) => `import Page.${P(p)} as ${P(p)}`),
  ].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  out.push(`--! ${spec.app}: ${pages.length} page${pages.length === 1 ? "" : "s"} behind a shell, in The Elm Architecture. The model is the shell's
--! state, the global state and the page shown (each page its own module: model, messages, \`update\` and
--! \`view\`); entering a route replaces the page, so a page's state lives and dies with it.

${imports.join("\n")}


main : Tea.Program
main =
    Browser.mountAt
        (Tea.element { init = init, update = update, view = view, subscriptions = subscriptions })
        "root"`);

  out.push(`-- ---- Model ---------------------------------------------------------------------


--| The page shown, with its own state.
type Page
    = ${pages.map((p) => `${P(p)} ${P(p)}.Model`).join("\n    | ")}


type alias Model =
    route : String
    menu : Bool
    global : Global
    page : Page`);
  out.push(`init : ⊤ → Model × Cmd Msg
init ⊤ =
    ( { route = ${beniString(pages[0].id)}
      , menu = False
      , global = Global.init ⊤
      , page = ${P(pages[0])} (${P(pages[0])}.init ⊤)
      }
    , Cmd.none
    )`);

  out.push(`-- ---- Update --------------------------------------------------------------------


type Msg
    = Navigate String
    | ToggleMenu
${pages.map((p) => `    | ${P(p)}Msg ${P(p)}.Msg`).join("\n")}
    | Pushed Value`);
  out.push(`update : Msg, Model → Model × Cmd Msg
update msg model = ( step msg model, Cmd.none )`);

  const arm = (p) => {
    const m = P(p);
    const wg = wgPages.has(p.id);
    const visit = linkPages.includes(p) ? [`        ( ${m}Msg (${m}.Visit route), _ ) →\n            navigate route model\n`] : [];
    const body = wg
      ? `        ( ${m}Msg pageMsg, ${m} page ) →\n            withGlobal ${m} (${m}.update pageMsg page model.global) model`
      : `        ( ${m}Msg pageMsg, ${m} page ) →\n            { model | page = ${m} (${m}.update pageMsg page) }`;
    return [...visit, body].join("\n");
  };
  out.push(`step : Msg, Model → Model
step msg model =
    case ( msg, model.page ) of
        ( Navigate route, _ ) →
            navigate route model

        ( ToggleMenu, _ ) →
            { model | menu = not model.menu }

${pages.map(arm).join("\n\n")}

        ( Pushed value, _ ) →
            pushed value model${pages.length > 1 ? `

        -- A message of a page that has been left.
        _ →
            model` : ""}`);
  if (wgPages.size) {
    out.push(`--| A page's new state with the global state it returned.
withGlobal : (page → Page), page × Global, Model → Model
withGlobal toPage ( page, global ) model = { model | page = toPage page, global = global }`);
  }
  out.push(`--| Go to a route: the page entered starts from its initial state. The route being
--| left behind, and the menu, are closed over.
navigate : String, Model → Model
navigate route model =
    if route == model.route then
        { model | menu = False }
    else
        enter route model


enter : String, Model → Model
enter route model =
    case route of
${pages.map((p) => `        ${beniString(p.id)} →\n            { model | route = route, menu = False, page = ${P(p)} (${P(p)}.init ⊤) }`).join("\n\n")}

        _ →
            model`);

  out.push(`-- ---- External events -----------------------------------------------------------


subscriptions : Model → Sub Msg
subscriptions ${livePages.length ? "model" : "_"} = ${livePages.length ? "Sub.batch [ Push.onPush Pushed, pageSubscriptions model.page ]" : "Push.onPush Pushed"}`);
  if (livePages.length) out.push(`--| The page shown declares its timers; a page that has been left declares none.
pageSubscriptions : Page → Sub Msg
pageSubscriptions page =
    case page of
${livePages.map((p) => `        ${P(p)} state →\n            Sub.map (${P(p)}.subscriptions state) ${P(p)}Msg`).join("\n\n")}${livePages.length < pages.length ? "\n\n        _ →\n            Sub.none" : ""}`);
  out.push(`--| What the host pushes: a route to open, a new value of a global field, a notice,
--| an item for the feed of a page, or a new global state.
schema Event tagged "type" of
    DeepLink as "deepLink"
        route : String
    ServerSet as "serverSet"
        field : String
        value : Value
    Notify as "notify"
        item : Value
    PagePush as "pagePush"
        page : String
        item : Value
    Snapshot as "snapshot"
        global : Value`);
  out.push(`pushed : Value, Model → Model
pushed value model =
    case Schema.read (Event.schema ⊤) value of
        Ok (Event.DeepLink event) →
            navigate event.route model

        Ok (Event.ServerSet event) →
            { model | global = Global.set event.field event.value model.global }

        Ok (Event.Notify event) →
            { model | global = Global.notify event.item model.global }

        Ok (Event.PagePush event) →
            ${feedPages.length ? "pagePush event.page event.item model" : "model"}

        Ok (Event.Snapshot event) →
            { model | global = Global.replace event.global model.global }

        Err _ →
            model`);
  if (feedPages.length) out.push(`--| An item for the feed of a page: the page shown takes it, no other page exists to.
pagePush : String, Value, Model → Model
pagePush route item model =
    if route ≠ model.route then
        model
    else
        case model.page of
${feedPages.map((p) => `            ${P(p)} page →\n                { model | page = ${P(p)} (${P(p)}.notify item page) }`).join("\n\n")}${feedPages.length < pages.length ? "\n\n            _ →\n                model" : ""}`);

  out.push(`-- ---- View ----------------------------------------------------------------------


view : Model → Html Msg
view model =
    <div data-role="app">
        <header data-key="shell" data-role="shell">
            <strong>${spec.app}</strong>
            <nav data-role="nav">
                <For each={Pages.pinned} keyed={.id}>
                    {λpage →
                        if model.route == page.id then
                            <button
                                data-key={page.id}
                                data-role="navLink"
                                aria-current="page"
                                onClick={Navigate page.id}
                            >
                                {page.title}
                            </button>
                        else
                            <button
                                data-key={page.id}
                                data-role="navLink"
                                onClick={Navigate page.id}
                            >
                                {page.title}
                            </button>
                    }
                </For>
                <button
                    data-role="menu"
                    aria-expanded={if model.menu then "true" else "false"}
                    onClick={ToggleMenu}
                >
                    All pages
                </button>
            </nav>
            <p>
                <span data-role="user">Signed in as {model.global.user}</span>
                {" · "}
                <span data-role="cartCount">Cart: {List.length model.global.cart}</span>
                {" · "}
                <span data-role="noticeCount">{List.length model.global.notices} notices</span>
            </p>
        </header>
        {if model.menu then
            <nav data-role="menuList">
                <For each={Pages.all} keyed={.id}>
                    {λpage →
                        <button data-key={page.id} data-role="menuLink" onClick={Navigate page.id}>
                            {page.title}
                        </button>
                    }
                </For>
            </nav>
         else
            <></>
        }
        {case model.page of
${pages.map((p) => `            ${P(p)} page →\n                Html.map (${P(p)}.view page model.global) ${P(p)}Msg`).join("\n\n")}
        }
    </div>`);
  return out.join("\n\n\n") + "\n";
}

function hasLink(page) {
  const visit = (n) => n.el === "link" || (n.children || []).some(visit);
  return [page, ...(page.tabs || []), ...(page.modal ? [page.modal] : [])].some((c) => c.view.some(visit));
}

// ---------------------------------------------------------------------------------------------
// The app

export function emitApp(spec, templateFiles) {
  const files = {
    ...templateFiles({ name: `rr-routed-n${spec.options.size}-s${spec.options.seed}`, title: `routed-app n=${spec.options.size} seed=${spec.options.seed}` }),
    "platform/Interval.beni": INTERVAL_MODULE,
    "src/Main.beni": mainModule(spec),
    "src/Global.beni": globalModule(spec),
    "src/Pages.beni": pagesModule(spec),
  };
  const anyTyped = spec.pages.some((p) => [p, ...(p.tabs || []), ...(p.modal ? [p.modal] : [])].some((c) => c.messages.some((m) => m.kind === "input" && m.field[0] === "f" && fieldIn(c.fields, m.field[1]).type === "int")));
  if (anyTyped) files["src/Ui.beni"] = UI_MODULE;
  for (const p of spec.pages) files[`src/Page/${modName(p)}.beni`] = pageModule(p, spec);
  // A section's heading comment is followed by one blank line, as `beni fmt` writes it.
  for (const [name, text] of Object.entries(files)) {
    if (name.endsWith(".beni")) files[name] = text.replace(/^(-- ---- .*)\n\n\n/gm, "$1\n\n");
  }
  return { files, style: STYLE };
}
