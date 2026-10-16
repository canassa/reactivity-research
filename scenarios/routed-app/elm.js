// The routed-app scenario in Elm 0.19 (built with 0.19.3, see frameworks/elm/).
//
// Style (recorded in every generated app's rr.json), following the Elm guide and the usual
// single-page-app shape of Elm programs ("Page.init runs on every route change"). Modules are
// laid out the way elm-format 0.8.8 lays them out where practical, and expose only what the
// app uses.
// - The Elm Architecture with `Browser.element`. `Main` holds `{ route, menu, global, page }`;
//   `page` is a custom type with one constructor per page that carries that page's own model
//   (`OnDailyOrders1abc DailyOrders1abc.Model`). Navigating replaces it with the new page's
//   `init`, so page-local state lives and dies with its page. `Global` (a module of its own)
//   holds the six global fields, the item type, their decoder and the currency cycle.
// - Every page is its own module (`Page.DailyOrders1abc`, named after its title), written out
//   from its description: its `Model` (one typed field per state field, plus `tab : Tab` when it
//   has tabs and `modal : Maybe Form` when it has a modal), one flat `Msg` (the page's, its tabs'
//   and its modal's messages, `Go String` for links, `SelectTabN`, `Pushed`, `Tick`), `update`,
//   `view`, `init` and, when something is time-driven, `subscriptions`. Nothing is interpreted.
// - Tabs: `type Tab = Tab1 Tab1Panel | Tab2 Tab2Panel …`, a custom type holding the active
//   panel's record, so selecting a tab builds that panel's initial record and the old one is
//   dropped. The modal is `Maybe Form` in the same way. A message for a panel or a modal that is
//   not mounted is a no-op (`case model.tab of … _ -> model`).
// - Global state: a page that writes any global field has `update : Msg -> Global -> Model ->
//   ( Model, Global )`, the others `Msg -> Model -> Model`. `Main` routes `GotPage msg` to the page
//   shown and ignores it when the model holds another page. `GotPage (Page.Go route)` navigates.
// - Types: an `int` is an `Int`, a `bool` a `Bool`, a `text` and an `enum` a `String`, a `list` a
//   `List` of a type alias per list built by its positional constructor.
// - Views: derived values stay in `view` (an `if` is a `let` binding), a conditional section is a
//   view function of its own called as `Ui.when condition (viewSection …)`, the page is
//   `Ui.page id title [ … ]`, the tab panel `viewPanel` (a `case` on `model.tab`) and the modal
//   `viewModal` (a `case` on `model.modal`, an empty text node while closed).
// - `Main.view` is `Keyed.node "div"` with the shell, the menu (while open) and the page keyed by
//   route id, so a page's DOM is never reused for another page.
// - Keyed lists with `Html.Keyed`; plain `Html.Events` handlers (`onInput` for text inputs and
//   selects, `onClick` for buttons and checkboxes), `Ui.onNumberInput` for number inputs (an
//   integer within the field's range, else no message).
// - Time: `Time.every ms (always Tick)` in the page's `subscriptions`, and for the active tab
//   `case model.tab of Tab2 _ -> Time.every …`; `Main.subscriptions` forwards the shown page's.
// - External events: one incoming port `events : (Value -> msg) -> Sub msg`, decoded with
//   `Json.Decode`: `deepLink` into `Navigate`, `serverSet` into `SetUser`/`SetCurrency`/`SetBalance`/
//   `SetOnline`, `notify` into `Notify`, `snapshot` into `Snapshot`, `pagePush` into the feed
//   page's `GotPage (Page.Pushed item)` (dropped by `Main.update` unless that page is shown).
// - No `Html.Lazy`. Items are found by id; an action on a missing item changes nothing.
// - Production build: `elm make --optimize`, then the guide's two uglify-js passes.

import { templateFiles } from "../../frameworks/elm/framework.js";
import { pascal } from "../../frameworks/shared/jsx.js";

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
const exposing = (names) => [...names].sort().join(", ");
const byNumber = (a, b) => Number(a.slice(1)) - Number(b.slice(1));

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

function recordEntry(name, value, items) {
  const flat = `${name} = ${value}`;
  if (!items) return { flat };
  return {
    flat,
    multi: (col) => (col + flat.length <= MAX_WIDTH ? flat : `${name} =\n${sp(col + 2)}${listBlock(items, col + 2)}`),
  };
}

// `{ base | a = 1, b = 2 }` on one line when it fits at column `col`, else one assignment per line.
// An assignment value is a string, or { cond, a, b } for an `if`, which elm-format lays out on
// several lines.
function rec(base, assigns, col, off = 4) {
  if (!assigns.length) return base;
  const multi = assigns.some(([, v]) => typeof v === "object");
  const flatV = (v) => (typeof v === "object" ? `if ${v.cond} then ${v.a} else ${v.b}` : v);
  const flat = `{ ${base} | ${assigns.map(([n, v]) => `${n} = ${flatV(v)}`).join(", ")} }`;
  if (!multi && col + flat.length <= MAX_WIDTH && !flat.includes("\n")) return flat;
  const P = col + off;
  const value = ([n, v]) => (typeof v === "object"
    ? `${n} =\n${sp(P + 4)}if ${v.cond} then\n${sp(P + 8)}${v.a}\n\n${sp(P + 4)}else\n${sp(P + 8)}${v.b}`
    : `${n} = ${v}`);
  return `{ ${base}\n${assigns.map((x, i) => `${sp(P)}${i === 0 ? "|" : ","} ${value(x)}`).join("\n")}\n${sp(col)}}`;
}

// ---------------------------------------------------------------------------------------------
// Expressions: compiled to Elm with precedence (10 for an atom, 9 for an application, then the
// operators), a type (Int, Bool, String or List) and hoisted `if`s.

const PREC = { "||": 2, "&&": 3, cmp: 4, "++": 5, "+": 6, "-": 6 };

function wrap(e, min) {
  return e.prec < min ? `(${e.s})` : e.s;
}

// `cx`: the component being written { spec, page, comp, own } where `own` is the variable that
// holds the component's fields (`model`, `panel` or `form`). `fn`: the function being written
// (its hoisted `if`s and the variables it uses).
function descOf(ref, cx) {
  if (ref[0] === "g") return cx.spec.global.find((f) => f.name === ref[1]);
  if (ref[0] === "p") return cx.page.fields.find((f) => f.name === ref[1]);
  return cx.comp.fields.find((f) => f.name === ref[1]);
}

function varOf(ref, cx) {
  return ref[0] === "g" ? "global" : ref[0] === "p" ? "model" : cx.own;
}

function typeName(f) {
  return f.type === "int" ? "Int" : f.type === "bool" ? "Bool" : f.type === "list" ? "List" : "String";
}

function compile(e, fn, cx) {
  const atom = (s, t) => ({ s, prec: 10, t });
  const app = (s, t) => ({ s, prec: 9, t });
  const sub = (x) => compile(x, fn, cx);
  switch (e[0]) {
    case "f": case "p": case "g": {
      const v = varOf(e, cx);
      fn.uses.add(v);
      return atom(`${v}.${e[1]}`, typeName(descOf(e, cx)));
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

function textExpr(parts, fn, cx) {
  const pieces = [];
  for (const p of parts) {
    if (typeof p === "string") {
      if (typeof pieces[pieces.length - 1] === "string") pieces[pieces.length - 1] += p;
      else pieces.push(p);
    } else {
      const c = compile(p, fn, cx);
      pieces.push(c.t === "Int" ? { s: `String.fromInt ${wrap(c, 10)}`, prec: 9 } : c);
    }
  }
  if (pieces.length === 0) return { s: '""', prec: 10 };
  const items = pieces.map((p) => (typeof p === "string" ? { s: elmString(p), prec: 10 } : p));
  if (items.length === 1) return items[0];
  return { s: items.map((i) => wrap(i, 6)).join(" ++ "), prec: 5 };
}

// ---------------------------------------------------------------------------------------------
// View documents (as in unique-components)

const el = (tag, attrs, kids) => ({ tag, attrs, kids });
const raw = (s) => ({ raw: s });

function flatDoc(d) {
  if (d.raw !== undefined) return d.raw;
  const attrs = d.attrs.length ? `[ ${d.attrs.join(", ")} ]` : "[]";
  const kids = d.kids.length ? `[ ${d.kids.map(flatDoc).join(", ")} ]` : "[]";
  return `${d.tag} ${attrs} ${kids}`;
}

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

function kidsLines(kids, col) {
  const lines = kids.map((k, i) => `${i === 0 ? "[" : ","} ${layoutDoc(k, col, 2)}`);
  return `${lines.join(`\n${sp(col)}`)}\n${sp(col)}]`;
}

// ---------------------------------------------------------------------------------------------
// One page's module

function pageModule(spec, page, names) {
  const me = names[page.id];
  const used = { html: new Set(), attrs: new Set(), events: new Set(), ui: new Set(), keyed: false, time: false, maybe: false };
  const H = (n) => (used.html.add(n), n);
  const A = (n) => (used.attrs.add(n), n);
  const E = (n) => (used.events.add(n), n);
  const U = (n) => (used.ui.add(n), n);
  const role = (n) => `${U("dataRole")} ${elmString(n)}`;
  const key = (s) => `${U("dataKey")} ${s}`;

  const tabs = page.tabs || [];
  const modal = page.modal || null;
  const tabName = (t) => `Tab${t.id.slice(1)}`; // Tab1
  const panelType = (t) => `${tabName(t)}Panel`;
  const comps = [
    { kind: "page", comp: page, own: "model" },
    ...tabs.map((t) => ({ kind: "tab", comp: t, own: "panel", tab: t })),
    ...(modal ? [{ kind: "modal", comp: modal, own: "form" }] : []),
  ];
  for (const c of comps) Object.assign(c, { spec, page });
  const cxPage = comps[0];
  const cxModal = comps.find((c) => c.kind === "modal");

  const itemType = (f) => `${cap(f.name)}Item`;
  const typeOf = (f) => (f.type === "int" ? "Int" : f.type === "bool" ? "Bool" : f.type === "list" ? `List ${itemType(f)}` : "String");
  const ctor = (m) => cap(m.name);
  const hasLinks = (() => {
    let found = false;
    const visit = (n) => { if (n.el === "link") found = true; (n.children || []).forEach(visit); };
    page.view.forEach(visit);
    return found;
  })();
  const feed = page.fields.find((f) => f.feed);

  // ---- does the page write global state?
  const writesGlobal = comps.some((c) => c.comp.messages.some((m) => {
    if (m.field && m.field[0] === "g") return true;
    return (m.ops || []).some((op) => op[1][0] === "g");
  }));

  // ---- values
  const valueText = (f, v) => {
    if (f.type === "int") return String(v);
    if (f.type === "bool") return v ? "True" : "False";
    return elmString(v);
  };
  const itemText = (f, it) => `${itemType(f)} ${it.id} ${elmString(it.text)}${f.checkable ? ` ${it.done ? "True" : "False"}` : ""}`;
  const itemTextG = (it) => `Global.Item ${it.id} ${elmString(it.text)}`;

  // ---- types
  const lists = [...page.fields, ...tabs.flatMap((t) => t.fields)].filter((f) => f.type === "list");
  const itemAliases = lists.map((f) => `type alias ${itemType(f)} =
    { id : Int
    , text : String${f.checkable ? "\n    , done : Bool" : ""}
    }`);
  const recordType = (fields, extra) => {
    const entries = [...fields.map((f) => ({ flat: `${f.name} : ${typeOf(f)}` })), ...extra.map((flat) => ({ flat }))];
    return block("{", "}", entries, 4, entries.length > 1);
  };
  const modelAlias = `type alias Model =
    ${recordType(page.fields, [...(tabs.length ? ["tab : Tab"] : []), ...(modal ? ["modal : Maybe Form"] : [])])}`;
  const tabType = tabs.length ? `type Tab
    = ${tabs.map((t) => `${tabName(t)} ${panelType(t)}`).join("\n    | ")}` : "";
  const panelAliases = tabs.map((t) => `type alias ${panelType(t)} =
    ${recordType(t.fields, [])}`);
  const formAlias = modal ? `type alias Form =
    ${recordType(modal.fields, [])}` : "";

  // ---- init
  const initOf = (fields, col) => block("{", "}", fields.map((f) => (f.type === "list"
    ? recordEntry(f.name, listBlock(f.initial.map((it) => itemText(f, it)), 0), f.initial.map((it) => itemText(f, it)))
    : recordEntry(f.name, valueText(f, f.initial)))), col);
  const pageInitEntries = page.fields.map((f) => (f.type === "list"
    ? recordEntry(f.name, listBlock(f.initial.map((it) => itemText(f, it)), 0), f.initial.map((it) => itemText(f, it)))
    : recordEntry(f.name, valueText(f, f.initial))));
  if (tabs.length) pageInitEntries.push({ flat: `tab = ${tabName(tabs[0])} ${tabName(tabs[0]).toLowerCase()}Init` });
  if (modal) pageInitEntries.push({ flat: "modal = Nothing" });
  const initDecl = `init : Model
init =
    ${block("{", "}", pageInitEntries, 4, pageInitEntries.length > 1 && false)}`;
  const panelInits = tabs.map((t) => `${tabName(t).toLowerCase()}Init : ${panelType(t)}
${tabName(t).toLowerCase()}Init =
    ${initOf(t.fields, 4)}`);
  const formInit = modal ? `formInit : Form
formInit =
    ${initOf(modal.fields, 4)}` : "";

  // ---- Msg
  const payload = (m, cx) => {
    if (m.kind === "input") return descOf(m.field, cx).type === "int" ? " Int" : " String";
    if (m.kind === "select") return " String";
    if (m.kind === "check") return " Bool";
    if (m.kind === "item") return " Int";
    return "";
  };
  const msgCtors = [];
  for (const c of comps) for (const m of c.comp.messages) msgCtors.push(`${ctor(m)}${payload(m, c)}`);
  for (const t of tabs) msgCtors.push(`Select${tabName(t)}`);
  if (hasLinks) msgCtors.push("Go String");
  if (feed) msgCtors.push("Pushed Global.Item");
  const pageLive = page.fields.find((f) => f.every);
  if (pageLive) msgCtors.push("Tick");
  const liveTabs = tabs.map((t) => ({ t, f: t.fields.find((f) => f.every) })).filter((x) => x.f);
  for (const { t } of liveTabs) msgCtors.push(`${tabName(t)}Tick`);
  const msgType = `type Msg\n    = ${msgCtors.join("\n    | ")}`;

  // ---- update
  const ret = (m, g, col) => {
    if (!writesGlobal) return m;
    const flat = `( ${m}, ${g} )`;
    if (col + flat.length <= MAX_WIDTH && !flat.includes("\n")) return flat;
    return `( ${m}\n${sp(col)}, ${g}\n${sp(col)})`;
  };
  const noop = () => (writesGlobal ? "( model, global )" : "model");

  const cycles = new Map();
  for (const c of comps) for (const m of c.comp.messages) for (const op of m.ops || []) {
    if (op[0] === "cycle" && op[1][0] !== "g") cycles.set(op[1][1], descOf(op[1], c));
  }
  const cycleName = (f) => `next${cap(f.name)}`;
  const cycleFunctions = [...cycles.values()].map((f) => {
    const head = f.options.slice(0, -1).map((o, i) => `        ${elmString(o)} ->\n            ${elmString(f.options[i + 1])}`);
    return `${cycleName(f)} : String -> String
${cycleName(f)} current =
    case current of
${[...head, `        _ ->\n            ${elmString(f.options[0])}`].join("\n\n")}`;
  });

  // The assignments of one message, by the variable they write: { model: [[field, rhs]], panel, form, global }.
  function assignments(m, cx) {
    const out = { model: [], panel: [], form: [], global: [] };
    const put = (ref, rhs) => {
      const v = varOf(ref, cx);
      if (out[v].some(([n]) => n === ref[1])) throw new Error(`${page.id}.${m.name}: two writes to ${ref[1]}`);
      out[v].push([ref[1], rhs]);
    };
    const cur = (ref) => `${varOf(ref, cx)}.${ref[1]}`;
    const newItem = (ref, f, text) => {
      const c = `${cur(ref)}`;
      return ref[0] === "g" ? `Global.Item (Ui.nextId ${c}) ${text}` : `${itemType(f)} (Ui.nextId ${c}) ${text}${f.checkable ? " False" : ""}`;
    };
    switch (m.kind) {
      case "input": case "select": put(m.field, `new${cap(m.field[1])}`); break;
      case "check": put(m.field, `new${cap(m.field[1])}`); break;
      case "item":
        U("nextId");
        if (m.op === "toggle") { U("toggleDone"); put(m.field, `Ui.toggleDone id ${cur(m.field)}`); }
        else put(m.field, `List.filter (\\item -> item.id /= id) ${cur(m.field)}`);
        break;
      case "click": case "confirm": {
        for (const op of m.ops) {
          const [kind, ref] = op;
          const f = descOf(ref, cx);
          const c = cur(ref);
          switch (kind) {
            case "add": put(ref, `clamp ${f.min} ${f.max} (${c} ${op[2] < 0 ? "-" : "+"} ${Math.abs(op[2])})`); break;
            case "set": put(ref, f.type === "bool" ? (op[2] ? "True" : "False") : f.type === "int" ? String(op[2]) : elmString(op[2])); break;
            case "toggle": put(ref, `not ${c}`); break;
            case "reset": put(ref, valueText(f, f.initial)); break;
            case "cycle": put(ref, ref[0] === "g" ? `Global.next${cap(ref[1])} ${c}` : `${cycleName(f)} ${c}`); break;
            case "copy": put(ref, cur(op[2])); break;
            case "push": {
              U("nextId");
              const draft = cur(op[2]);
              const pushed = `${c} ++ [ ${newItem(ref, f, `(String.trim ${draft})`)} ]`;
              if (m.kind === "confirm") put(ref, { cond: `String.isEmpty (String.trim ${draft})`, a: c, b: pushed });
              else { put(ref, pushed); put(op[2], '""'); }
              break;
            }
            case "pushText": U("nextId"); put(ref, `${c} ++ [ ${newItem(ref, f, elmString(op[2]))} ]`); break;
            case "pop": put(ref, `List.take (List.length ${c} - 1) ${c}`); break;
            case "shift": put(ref, `List.drop 1 ${c}`); break;
            case "clear": put(ref, "[]"); break;
            case "clearDone": put(ref, `List.filter (not << .done) ${c}`); break;
            default: throw new Error(`unknown op ${kind}`);
          }
        }
        break;
      }
      default: throw new Error(`unknown message kind ${m.kind}`);
    }
    return out;
  }

  // The new `( model, global )` (or `model`) of an assignment set, written at column `col`.
  function resultOf(cx, m, a, col) {
    const inner = col + (writesGlobal ? 2 : 0);
    const modelAssigns = [...a.model];
    if (cx.kind === "tab" && a.panel.length) modelAssigns.push(["tab", `${tabName(cx.tab)} ${rec("panel", a.panel, -1e6)}`]);
    if (cx.kind === "modal") {
      if (m.kind === "confirm") modelAssigns.push(["modal", "Nothing"]);
      else if (a.form.length) modelAssigns.push(["modal", `Just ${rec("form", a.form, -1e6)}`]);
    }
    const off = writesGlobal ? 2 : 4;
    return ret(rec("model", modelAssigns, inner, off), rec("global", a.global, inner, off), col);
  }

  function branchFor(m, cx) {
    const pat = m.kind === "input" || m.kind === "select" || m.kind === "check" ? `${ctor(m)} new${cap(m.field[1])}` : m.kind === "item" ? `${ctor(m)} id` : ctor(m);
    if (m.kind === "open") return `        ${pat} ->\n            ${ret("{ model | modal = Just formInit }", "global", 12)}`;
    if (m.kind === "close") return `        ${pat} ->\n            ${ret("{ model | modal = Nothing }", "global", 12)}`;
    const a = assignments(m, cx);
    const push = (m.ops || []).find((op) => op[0] === "push");
    const pushGuard = push && m.kind === "click" ? `String.isEmpty (String.trim ${varOf(push[2], cx)}.${push[2][1]})` : null;
    // The body at column `col`.
    const body = (col) => {
      const res = (c2) => resultOf(cx, m, a, c2);
      if (!pushGuard) return `${sp(col)}${res(col)}`;
      return `${sp(col)}if ${pushGuard} then\n${sp(col + 4)}${noop()}\n\n${sp(col)}else\n${sp(col + 4)}${res(col + 4)}`;
    };
    if (cx.kind === "page") return `        ${pat} ->\n${body(12)}`;
    if (cx.kind === "tab") {
      return `        ${pat} ->
            case model.tab of
                ${tabName(cx.tab)} ${/\bpanel\b/.test(body(20)) ? "panel" : "_"} ->
${body(20)}

                _ ->
                    ${noop()}`;
    }
    return `        ${pat} ->
            case model.modal of
                Just ${/\bform\b/.test(body(20)) ? "form" : "_"} ->
${body(20)}

                Nothing ->
                    ${noop()}`;
  }

  const branches = [];
  for (const c of comps) for (const m of c.comp.messages) branches.push(branchFor(m, c));
  for (const t of tabs) {
    branches.push(`        Select${tabName(t)} ->
            case model.tab of
                ${tabName(t)} _ ->
                    ${noop()}

                _ ->
                    ${ret(`{ model | tab = ${tabName(t)} ${tabName(t).toLowerCase()}Init }`, "global", 20)}`);
  }
  if (hasLinks) branches.push(`        Go _ ->\n            ${noop()}`);
  if (feed) branches.push(`        Pushed entry ->\n            ${ret(`{ model | ${feed.name} = model.${feed.name} ++ [ entry ] }`, "global", 12)}`);
  const advance = (v, f) => `min ${f.max} (${v}.${f.name} + ${f.by})`;
  if (pageLive) branches.push(`        Tick ->\n            ${ret(`{ model | ${pageLive.name} = ${advance("model", pageLive)} }`, "global", 12)}`);
  for (const { t, f } of liveTabs) {
    branches.push(`        ${tabName(t)}Tick ->
            case model.tab of
                ${tabName(t)} panel ->
                    ${ret(`{ model | tab = ${tabName(t)} { panel | ${f.name} = ${advance("panel", f)} } }`, "global", 20)}

                _ ->
                    ${noop()}`);
  }
  const updateDecl = writesGlobal
    ? `update : Msg -> Global -> Model -> ( Model, Global )\nupdate msg global model =\n    case msg of\n${branches.join("\n\n")}`
    : `update : Msg -> Model -> Model\nupdate msg model =\n    case msg of\n${branches.join("\n\n")}`;

  // ---- subscriptions
  let subsDecl = "";
  if (pageLive || liveTabs.length) {
    used.time = true;
    const pageSub = pageLive ? `Time.every ${pageLive.every} (always Tick)` : null;
    const tabSub = (ind) => `case model.tab of
${liveTabs.map(({ t, f }) => `${sp(ind + 4)}${tabName(t)} _ ->\n${sp(ind + 8)}Time.every ${f.every} (always ${tabName(t)}Tick)`).join("\n\n")}

${sp(ind + 4)}_ ->
${sp(ind + 8)}Sub.none`;
    const head = "subscriptions : Model -> Sub Msg\n";
    if (pageSub && !liveTabs.length) subsDecl = `${head}subscriptions _ =\n    ${pageSub}`;
    else if (!pageSub) subsDecl = `${head}subscriptions model =\n    ${tabSub(4)}`;
    else subsDecl = `${head}subscriptions model =\n    Sub.batch\n        [ ${pageSub}\n        , ${tabSub(8)}\n        ]`;
  }

  // ---- view
  const declarations = []; // helper view functions
  const listViews = [];
  let sections = 0;
  const typeOfVar = (v, cx) => (v === "global" ? "Global" : v === "model" ? "Model" : cx.kind === "tab" ? panelType(cx.tab) : "Form");

  function newFn(base) {
    let n = 0;
    return { hoists: [], uses: new Set(), fresh: () => `${base}${++n === 1 ? "" : n}` };
  }
  function lets(fn) {
    if (!fn.hoists.length) return "";
    return `    let
${fn.hoists.map((h) => `        ${h.name} =
            if ${h.cond} then
                ${h.a}

            else
                ${h.b}`).join("\n\n")}
    in
`;
  }
  // A view function. `all`: take every argument of the component (an unused one as `_`); else only
  // those used, which the caller then passes.
  function viewFunction(name, fn, body, cx, all) {
    const order = cx.kind === "page" ? ["global", "model"] : ["global", "model", cx.own];
    const params = all ? order : order.filter((v) => fn.uses.has(v));
    const types = [...params.map((v) => typeOfVar(v, cx)), "Html Msg"];
    const names = params.map((v) => (fn.uses.has(v) ? v : "_"));
    const doc = layoutDoc(body, 4, 0);
    return { text: `${name} : ${types.join(" -> ")}\n${name} ${names.join(" ")}${names.length ? " " : ""}=\n${lets(fn)}    ${doc}`, params };
  }

  const textDoc = (parts, fn, cx) => {
    const t = textExpr(parts, fn, cx);
    H("text");
    return raw(`text ${t.prec >= 10 ? t.s : `(${t.s})`}`);
  };

  const msgByName = (cx, n) => cx.comp.messages.find((m) => m.name === n);
  const ownerOf = (n) => comps.find((c) => c.comp.messages.some((m) => m.name === n));

  function buildNodes(nodes, fn, cx) {
    return nodes.flatMap((n) => buildNode(n, fn, cx));
  }

  function buildNode(n, fn, cx) {
    const x = (e) => compile(e, fn, cx);
    switch (n.el) {
      case "text": return [el(H(n.tag), [], [textDoc(n.parts, fn, cx)])];
      case "button": {
        const m = msgByName(cx, n.msg);
        const attrs = [role(n.msg)];
        if (n.disabled) attrs.push(`${A("disabled")} ${wrap(x(n.disabled), 10)}`);
        attrs.push(`${E("onClick")} ${ctor(m)}`);
        return [el(H("button"), attrs, [textDoc(n.text, fn, cx)])];
      }
      case "link": {
        H("text");
        return [el(H("button"), [key(elmString(n.to)), role("pageLink"), `${E("onClick")} (Go ${elmString(n.to)})`], [raw(`text ${elmString(n.text)}`)])];
      }
      case "open": {
        const m = msgByName(cx, n.msg);
        H("text");
        return [el(H("button"), [role(n.msg), `${E("onClick")} ${ctor(m)}`], [raw(`text ${elmString(n.text)}`)])];
      }
      case "input": {
        const m = msgByName(cx, n.msg);
        const f = descOf(m.field, cx);
        const value = x(m.field).s;
        let attrs;
        if (f.type === "int") {
          attrs = [`${A("type_")} "number"`, role(n.msg), `${A("value")} (String.fromInt ${value})`, `Ui.onNumberInput ${f.min} ${f.max} ${ctor(m)}`];
          U("onNumberInput");
        } else {
          attrs = [`${A("type_")} "text"`, role(n.msg)];
          if (n.placeholder != null) attrs.push(`${A("placeholder")} ${elmString(n.placeholder)}`);
          attrs.push(`${A("value")} ${value}`, `${E("onInput")} ${ctor(m)}`);
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
        const m = msgByName(cx, n.msg);
        const input = el(H("input"), [`${A("type_")} "checkbox"`, role(n.msg), `${A("checked")} ${x(m.field).s}`, `${E("onCheck")} ${ctor(m)}`], []);
        H("text");
        return [el(H("label"), [], [input, raw(`text ${elmString(n.label)}`)])];
      }
      case "select": {
        const m = msgByName(cx, n.msg);
        const f = descOf(m.field, cx);
        U("option");
        E("onInput");
        const sel = raw(`${H("select")} [ ${role(n.msg)}, onInput ${ctor(m)} ] (List.map (Ui.option ${x(m.field).s}) [ ${f.options.map(elmString).join(", ")} ])`);
        if (!n.label) return [sel];
        H("text");
        return [el(H("label"), [], [raw(`text ${elmString(n.label)}`), sel])];
      }
      case "list": {
        const f = descOf(n.field, cx);
        const base = `view${cap(n.field[1])}Item`;
        let entry = listViews.find((l) => l.base === base && l.n.check === n.check && l.n.remove === n.remove && l.n.removeText === n.removeText && l.cx.kind === cx.kind);
        if (!entry) {
          const same = listViews.filter((l) => l.base === base).length;
          entry = { n, f, cx, base, fnName: same ? `${base}${same + 1}` : base };
          listViews.push(entry);
        }
        used.keyed = true;
        return [raw(`Keyed.${n.tag} [] (List.map ${entry.fnName} ${x(n.field).s})`)];
      }
      case "when": {
        U("when");
        const cond = x(n.cond);
        const name = sections++ === 0 ? "viewSection" : `viewSection${sections}`;
        const inner = newFn("shown");
        const kids = buildNodes(n.children, inner, cx);
        const fnDecl = viewFunction(name, inner, el(H(n.tag), [], kids), cx, false);
        declarations.push(fnDecl.text);
        for (const v of fnDecl.params) fn.uses.add(v);
        return [raw(`Ui.when ${wrap(cond, 10)} ${fnDecl.params.length ? `(${[name, ...fnDecl.params].join(" ")})` : name}`)];
      }
      case "group": return [el(H(n.tag), [], buildNodes(n.children, fn, cx))];
      case "tabs": {
        fn.uses.add("global");
        fn.uses.add("model");
        U("ariaSelected");
        H("text");
        const buttons = tabs.map((t) => el(H("button"), [key(elmString(t.id)), role("tab"), `ariaSelected (active == ${elmString(t.id)})`, `${E("onClick")} Select${tabName(t)}`], [raw(`text ${elmString(t.label)}`)]));
        fn.tabsActive = true;
        return [el(H("nav"), [role("tabs")], buttons), raw("viewPanel global model")];
      }
    }
    throw new Error(`unknown view node ${n.el}`);
  }

  // The page's own view.
  const rootFn = newFn("shown");
  let rootKids = buildNodes(page.view, rootFn, cxPage);
  if (modal) {
    rootFn.uses.add("global");
    rootFn.uses.add("model");
    rootKids = [...rootKids, raw("viewModal global model")];
  }
  U("page");
  const rootDoc = (() => {
    const head = `Ui.page ${elmString(page.id)} ${elmString(page.title)}`;
    const flat = `${head} ${listBlock(rootKids.map(flatDoc), 0)}`;
    if (4 + flat.length <= MAX_WIDTH && !flat.includes("\n")) return flat;
    return `Ui.page ${elmString(page.id)}\n        ${elmString(page.title)}\n        ${kidsLines(rootKids, 8)}`;
  })();
  let viewText = (() => {
    const hoist = lets(rootFn);
    const active = rootFn.tabsActive ? "        active =\n            tabId model.tab\n" : "";
    let letText = hoist;
    if (active) {
      letText = hoist ? hoist.replace("    let\n", `    let\n${active}\n`) : `    let\n${active}    in\n`;
    }
    const names = ["global", "model"].map((v) => (rootFn.uses.has(v) ? v : "_"));
    return `view : Global -> Model -> Html Msg\nview ${names.join(" ")} =\n${letText}    ${rootDoc}`;
  })();

  // Tab panels and the modal.
  const tabViews = [];
  const tabHelpers = [];
  if (tabs.length) {
    tabHelpers.push(`tabId : Tab -> String
tabId tab =
    case tab of
${tabs.map((t) => `        ${tabName(t)} _ ->\n            ${elmString(t.id)}`).join("\n\n")}`);
    tabHelpers.push(`viewPanel : Global -> Model -> Html Msg
viewPanel global model =
    case model.tab of
${tabs.map((t) => `        ${tabName(t)} panel ->\n            view${tabName(t)} global model panel`).join("\n\n")}`);
    for (const c of comps.filter((x) => x.kind === "tab")) {
      const fn = newFn("shown");
      const kids = buildNodes(c.comp.view, fn, c);
      const doc = el(H("section"), [key(elmString(c.comp.id)), role("panel")], kids);
      tabViews.push(viewFunction(`view${tabName(c.tab)}`, fn, doc, c, true).text);
    }
  }
  let modalViews = [];
  if (modal) {
    modalViews.push(`viewModal : Global -> Model -> Html Msg
viewModal global model =
    case model.modal of
        Just form ->
            viewForm global model form

        Nothing ->
            text ""`);
    H("text");
    const fn = newFn("shown");
    H("h2");
    const kids = [el("h2", [], [raw(`text ${elmString(modal.title)}`)]), ...buildNodes(modal.view, fn, cxModal)];
    H("text");
    const doc = el(H("aside"), [key('"modal"'), role("dialog")], kids);
    modalViews.push(viewFunction("viewForm", fn, doc, cxModal, true).text);
  }

  // Item views.
  const itemViews = listViews.map(({ n, f, cx, fnName }) => {
    const m = (name) => msgByName(cx, name);
    const kids = [];
    if (n.check) kids.push(el(H("input"), [`${A("type_")} "checkbox"`, role(n.check), `${A("checked")} item.done`, `${E("onClick")} (${ctor(m(n.check))} item.id)`], []));
    kids.push(el(H("span"), [], [raw(`${H("text")} item.text`)]));
    if (n.remove) kids.push(el(H("button"), [role(n.remove), `${E("onClick")} (${ctor(m(n.remove))} item.id)`], [raw(`${H("text")} ${elmString(n.removeText)}`)]));
    const li = el(H("li"), [`${U("dataKey")} (String.fromInt item.id)`, role(`${n.field[1]}Item`)], kids);
    const flatTuple = `( String.fromInt item.id, ${flatDoc(li)} )`;
    const body = 4 + flatTuple.length <= MAX_WIDTH ? flatTuple : `( String.fromInt item.id\n    , ${layoutDoc(li, 4, 2)}\n    )`;
    const type = n.field[0] === "g" ? "Global.Item" : itemType(f);
    return `${fnName} : ${type} -> ( String, Html Msg )\n${fnName} item =\n    ${body}`;
  });

  // ---- assemble
  const exposed = ["Model", "Msg(..)", "init", "update", "view"];
  if (subsDecl) exposed.push("subscriptions");
  const htmlNames = new Set(["Html", ...used.html]);
  const imports = ["import Global exposing (Global)"];
  imports.push(`import Html exposing (${exposing(htmlNames)})`);
  if (used.attrs.size) imports.push(`import Html.Attributes exposing (${exposing(used.attrs)})`);
  if (used.events.size) imports.push(`import Html.Events exposing (${exposing(used.events)})`);
  if (used.keyed) imports.push("import Html.Keyed as Keyed");
  if (used.time) imports.push("import Time");
  const uiBare = ["ariaSelected", "dataKey", "dataRole"].filter((n) => used.ui.has(n));
  imports.push(`import Ui${uiBare.length ? ` exposing (${exposing(uiBare)})` : ""}`);

  const parts = [
    `module Page.${me.mod} exposing (${exposing(exposed)})\n\n${imports.sort().join("\n")}`,
    ...itemAliases,
    modelAlias,
    ...(tabType ? [tabType] : []),
    ...panelAliases,
    ...(formAlias ? [formAlias] : []),
    initDecl,
    ...panelInits,
    ...(formInit ? [formInit] : []),
    msgType,
    updateDecl,
    ...cycleFunctions,
    ...(subsDecl ? [subsDecl] : []),
    viewText,
    ...tabHelpers,
    ...tabViews,
    ...modalViews,
    ...declarations,
    ...itemViews,
  ];
  return { source: parts.join("\n\n\n") + "\n", uses: used.ui, hasLinks, feed, subs: !!subsDecl, writesGlobal };
}

// ---------------------------------------------------------------------------------------------
// Ui: what every page shares

function uiModule(uses) {
  const defs = {
    dataKey: `dataKey : String -> Attribute msg
dataKey =
    attribute "data-key"`,
    dataRole: `dataRole : String -> Attribute msg
dataRole =
    attribute "data-role"`,
    page: `page : String -> String -> List (Html msg) -> Html msg
page id heading children =
    main_ [ dataKey id, dataRole "page" ] (h1 [] [ text heading ] :: children)`,
    ariaSelected: `ariaSelected : Bool -> Attribute msg
ariaSelected selected =
    attribute "aria-selected"
        (if selected then
            "true"

         else
            "false"
        )`,
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
  const order = ["dataKey", "dataRole", "page", "ariaSelected", "when", "option", "nextId", "toggleDone", "onNumberInput"];
  const always = new Set(["dataKey", "dataRole", "page"]);
  const names = order.filter((n) => always.has(n) || uses.has(n));
  const htmlNames = ["Attribute", "Html", "h1", "main_", "text"];
  const attrNames = ["attribute"];
  if (uses.has("option")) attrNames.push("selected", "value");
  const imports = [`import Html exposing (${exposing(htmlNames)})`, `import Html.Attributes exposing (${exposing(attrNames)})`];
  if (uses.has("onNumberInput")) {
    imports.push("import Html.Events exposing (stopPropagationOn, targetValue)");
    imports.push("import Json.Decode as Decode");
  }
  return `module Ui exposing (${exposing(names)})

{-| What the pages share: the page with its heading, the attributes the markup uses and a few
view and update helpers that know nothing of any page.
-}

${imports.sort().join("\n")}


${names.map((n) => defs[n]).join("\n\n\n")}
`;
}

// ---------------------------------------------------------------------------------------------
// Global: the six global fields

function globalModule(spec) {
  const g = Object.fromEntries(spec.global.map((f) => [f.name, f]));
  const items = (list) => listBlock(list.map((it) => `Item ${it.id} ${elmString(it.text)}`), 4);
  const opts = g.currency.options;
  const head = opts.slice(0, -1).map((o, i) => `        ${elmString(o)} ->\n            ${elmString(opts[i + 1])}`);
  return `module Global exposing (Global, Item, decoder, init, itemDecoder, nextCurrency)

{-| The global state: what the shell shows and the pages read and write, and what a server
snapshot replaces.
-}

import Json.Decode as Decode exposing (Decoder)


type alias Item =
    { id : Int
    , text : String
    }


type alias Global =
    { user : String
    , cart : List Item
    , notices : List Item
    , currency : String
    , balance : Int
    , online : Bool
    }


init : Global
init =
    { user = ${elmString(g.user.initial)}
    , cart =
        ${items(g.cart.initial).replace(/\n {4}/g, "\n        ")}
    , notices =
        ${items(g.notices.initial).replace(/\n {4}/g, "\n        ")}
    , currency = ${elmString(g.currency.initial)}
    , balance = ${g.balance.initial}
    , online = ${g.online.initial ? "True" : "False"}
    }


nextCurrency : String -> String
nextCurrency current =
    case current of
${[...head, `        _ ->\n            ${elmString(opts[0])}`].join("\n\n")}


decoder : Decoder Global
decoder =
    Decode.map6 Global
        (Decode.field "user" Decode.string)
        (Decode.field "cart" (Decode.list itemDecoder))
        (Decode.field "notices" (Decode.list itemDecoder))
        (Decode.field "currency" Decode.string)
        (Decode.field "balance" Decode.int)
        (Decode.field "online" Decode.bool)


itemDecoder : Decoder Item
itemDecoder =
    Decode.map2 Item
        (Decode.field "id" Decode.int)
        (Decode.field "text" Decode.string)
`;
}

// ---------------------------------------------------------------------------------------------
// Main

function mainModule(spec, names, infos) {
  const pages = spec.pages;
  const n = (p) => names[p.id];
  const imports = [
    "import Browser",
    "import Global exposing (Global)",
    "import Html exposing (Html, button, header, nav, p, span, strong, text)",
    "import Html.Attributes exposing (attribute)",
    "import Html.Events exposing (onClick)",
    "import Html.Keyed as Keyed",
    "import Json.Decode as Decode exposing (Decoder)",
    "import Ui exposing (dataKey, dataRole)",
    ...pages.map((p) => `import Page.${n(p).mod} as ${n(p).mod}`),
  ].sort();
  const timed = pages.filter((p) => infos[p.id].subs);
  const linked = pages.filter((p) => infos[p.id].hasLinks);
  const feeds = pages.filter((p) => infos[p.id].feed);

  const pagesTable = listBlock(pages.map((p) => `( ${elmString(p.id)}, ${elmString(p.title)} )`), 4);
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


{-| External events (deep links, server pushes, snapshots), as JSON.
-}
port events : (Decode.Value -> msg) -> Sub msg`);

  out.push(`-- MODEL


type alias Model =
    { route : String
    , menu : Bool
    , global : Global
    , page : Page
    , stopped : Bool
    }


{-| The page shown, with its own model. Navigating replaces it with the new page's \`init\`.
-}
type Page
    = ${pages.map((p) => `${n(p).on} ${n(p).mod}.Model`).join("\n    | ")}


init : () -> ( Model, Cmd Msg )
init _ =
    ( { route = ${elmString(pages[0].id)}
      , menu = False
      , global = Global.init
      , page = ${n(pages[0]).on} ${n(pages[0]).mod}.init
      , stopped = False
      }
    , Cmd.none
    )


{-| Every page, for the "All pages" menu.
-}
pages : List ( String, String )
pages =
    ${pagesTable}`);

  const ctors = ["Navigate String", "ToggleMenu", ...pages.map((p) => `${n(p).got} ${n(p).mod}.Msg`),
    "SetUser String", "SetCurrency String", "SetBalance Int", "SetOnline Bool", "Notify Global.Item", "Snapshot Global", "Stop", "Ignored"];
  const pageCases = pages.map((p) => {
    const mod = n(p).mod;
    const go = linked.includes(p) ? `        ( ${n(p).got} (${mod}.Go route), ${n(p).on} _ ) ->
            ( navigate route model, Cmd.none )

` : "";
    const upd = infos[p.id].writesGlobal
      ? `updateWith ${n(p).on} (${mod}.update pageMsg model.global pageModel) model`
      : `( { model | page = ${n(p).on} (${mod}.update pageMsg pageModel) }, Cmd.none )`;
    return `${go}        ( ${n(p).got} pageMsg, ${n(p).on} pageModel ) ->
            ${upd}`;
  });
  const anyGlobal = pages.some((p) => infos[p.id].writesGlobal);
  const navCases = pages.map((p) => `            ${elmString(p.id)} ->
                { model | route = route, menu = False, page = ${n(p).on} ${n(p).mod}.init }`);
  out.push(`-- UPDATE


type Msg
    = ${ctors.join("\n    | ")}


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case ( msg, model.page ) of
        ( Navigate route, _ ) ->
            ( navigate route model, Cmd.none )

        ( ToggleMenu, _ ) ->
            ( { model | menu = not model.menu }, Cmd.none )

${pageCases.join("\n\n")}

        ( SetUser user, _ ) ->
            ( withGlobal (\\global -> { global | user = user }) model, Cmd.none )

        ( SetCurrency currency, _ ) ->
            ( withGlobal (\\global -> { global | currency = currency }) model, Cmd.none )

        ( SetBalance balance, _ ) ->
            ( withGlobal (\\global -> { global | balance = balance }) model, Cmd.none )

        ( SetOnline online, _ ) ->
            ( withGlobal (\\global -> { global | online = online }) model, Cmd.none )

        ( Notify notice, _ ) ->
            ( withGlobal (\\global -> { global | notices = global.notices ++ [ notice ] }) model, Cmd.none )

        ( Snapshot global, _ ) ->
            ( { model | global = global }, Cmd.none )

        ( Stop, _ ) ->
            ( { model | stopped = True }, Cmd.none )

        _ ->
            ( model, Cmd.none )


withGlobal : (Global -> Global) -> Model -> Model
withGlobal change model =
    { model | global = change model.global }
${anyGlobal ? `

updateWith : (pageModel -> Page) -> ( pageModel, Global ) -> Model -> ( Model, Cmd Msg )
updateWith toPage ( pageModel, global ) model =
    ( { model | page = toPage pageModel, global = global }, Cmd.none )
` : ""}

{-| Go to a page: its model starts from \`init\`. The page already shown only closes the menu.
-}
navigate : String -> Model -> Model
navigate route model =
    if route == model.route then
        { model | menu = False }

    else
        case route of
${navCases.join("\n\n")}

            _ ->
                model`);

  const eventCases = [
    `                    "deepLink" ->
                        Decode.map Navigate (Decode.field "route" Decode.string)`,
    `                    "serverSet" ->
                        Decode.field "field" Decode.string
                            |> Decode.andThen
                                (\\field ->
                                    case field of
                                        "user" ->
                                            Decode.map SetUser (Decode.field "value" Decode.string)

                                        "currency" ->
                                            Decode.map SetCurrency (Decode.field "value" Decode.string)

                                        "balance" ->
                                            Decode.map SetBalance (Decode.field "value" Decode.int)

                                        "online" ->
                                            Decode.map SetOnline (Decode.field "value" Decode.bool)

                                        _ ->
                                            Decode.fail ("unknown field: " ++ field)
                                )`,
    `                    "notify" ->
                        Decode.map Notify (Decode.field "item" Global.itemDecoder)`,
    `                    "snapshot" ->
                        Decode.map Snapshot (Decode.field "global" Global.decoder)`,
    `                    "stop" ->
                        Decode.succeed Stop`,
  ];
  if (feeds.length) {
    eventCases.push(`                    "pagePush" ->
                        Decode.field "page" Decode.string
                            |> Decode.andThen
                                (\\id ->
                                    case id of
${feeds.map((p) => `                                        ${elmString(p.id)} ->
                                            Decode.map (${n(p).got} << ${n(p).mod}.Pushed) (Decode.field "item" Global.itemDecoder)`).join("\n\n")}

                                        _ ->
                                            Decode.fail ("no feed: " ++ id)
                                )`);
  }
  eventCases.push(`                    _ ->
                        Decode.fail ("unknown event: " ++ kind)`);
  const subCases = timed.map((p) => `        ${n(p).on} pageModel ->
            Sub.map ${n(p).got} (${n(p).mod}.subscriptions pageModel)`);
  out.push(`-- SUBSCRIPTIONS


subscriptions : Model -> Sub Msg
subscriptions model =
    if model.stopped then
        Sub.none

    else
        Sub.batch
            [ events (Decode.decodeValue eventDecoder >> Result.withDefault Ignored)
            , pageSubscriptions model.page
            ]


{-| A page's timers exist only while it is shown.
-}
pageSubscriptions : Page -> Sub Msg
pageSubscriptions page =
    case page of
${subCases.length ? subCases.join("\n\n") + (timed.length < pages.length ? "\n\n        _ ->\n            Sub.none" : "") : "        _ ->\n            Sub.none"}


eventDecoder : Decoder Msg
eventDecoder =
    Decode.field "type" Decode.string
        |> Decode.andThen
            (\\kind ->
                case kind of
${eventCases.join("\n\n")}
            )`);

  const pinned = spec.pinned.map((id) => pages.find((p) => p.id === id));
  const pageViews = pages.map((p) => `        ${n(p).on} pageModel ->
            Html.map ${n(p).got} (${n(p).mod}.view model.global pageModel)`);
  out.push(`-- VIEW


view : Model -> Html Msg
view model =
    Keyed.node "div"
        [ dataRole "app" ]
        (( "shell", viewShell model )
            :: (if model.menu then
                    [ ( "menu", viewMenu ) ]

                else
                    []
               )
            ++ [ ( model.route, viewPage model ) ]
        )


viewPage : Model -> Html Msg
viewPage model =
    case model.page of
${pageViews.join("\n\n")}


viewShell : Model -> Html Msg
viewShell model =
    header [ dataKey "shell", dataRole "shell" ]
        [ strong [] [ text ${elmString(spec.app)} ]
        , nav [ dataRole "nav" ]
            [ ${pinned.map((p) => `viewNavLink model.route ${elmString(p.id)} ${elmString(p.title)}`).join("\n            , ")}
            , button
                [ dataRole "menu"
                , attribute "aria-expanded"
                    (if model.menu then
                        "true"

                     else
                        "false"
                    )
                , onClick ToggleMenu
                ]
                [ text "All pages" ]
            ]
        , p []
            [ span [ dataRole "user" ] [ text ("Signed in as " ++ model.global.user) ]
            , text " · "
            , span [ dataRole "cartCount" ] [ text ("Cart: " ++ String.fromInt (List.length model.global.cart)) ]
            , text " · "
            , span [ dataRole "noticeCount" ] [ text (String.fromInt (List.length model.global.notices) ++ " notices") ]
            ]
        ]


viewNavLink : String -> String -> String -> Html Msg
viewNavLink current id title =
    button
        (dataKey id
            :: dataRole "navLink"
            :: onClick (Navigate id)
            :: (if current == id then
                    [ attribute "aria-current" "page" ]

                else
                    []
               )
        )
        [ text title ]


viewMenu : Html Msg
viewMenu =
    nav [ dataRole "menuList" ] (List.map viewMenuLink pages)


viewMenuLink : ( String, String ) -> Html Msg
viewMenuLink ( id, title ) =
    button [ dataKey id, dataRole "menuLink", onClick (Navigate id) ] [ text title ]`);

  return out.map((d) => (d.startsWith("-- ") ? "\n" + d : d)).join("\n\n\n") + "\n";
}

// ---------------------------------------------------------------------------------------------

export function emit(spec) {
  const template = templateFiles({ title: "Routed app" });
  const elmJson = JSON.parse(template["elm.json"]);
  delete elmJson.dependencies.direct["elm/regex"];
  // The pages import Time for their timers: elm/time moves from indirect to direct.
  elmJson.dependencies.direct["elm/time"] = elmJson.dependencies.indirect["elm/time"];
  delete elmJson.dependencies.indirect["elm/time"];
  const files = { ...template, "elm.json": JSON.stringify(elmJson, null, 4) + "\n" };

  const names = {};
  for (const p of spec.pages) {
    const mod = pascal(p.title);
    names[p.id] = { mod, got: `Got${mod}`, on: `On${mod}` };
  }
  const uses = new Set();
  const infos = {};
  for (const p of spec.pages) {
    const r = pageModule(spec, p, names);
    infos[p.id] = r;
    for (const x of r.uses) uses.add(x);
    files[`src/Page/${names[p.id].mod}.elm`] = r.source;
  }
  files["src/Ui.elm"] = uiModule(uses);
  files["src/Global.elm"] = globalModule(spec);
  files["src/Main.elm"] = mainModule(spec, names, infos);
  return {
    files,
    style: {
      architecture: "TEA with Browser.element: Main holds { route, menu, global, page }; page is a custom type with a constructor per page carrying that page's model, replaced by the new page's init on navigation (page-local state resets); Global is a module of its own",
      pages: "one module per page (Model, Msg, init, update, view, subscriptions), written out from its description; one flat Msg for the page, its tabs and its modal; Go String for links",
      tabsAndModal: "tab : Tab, a custom type holding the active panel's record (selecting builds its init); modal : Maybe Form; messages for an unmounted panel or modal are no-ops",
      globalState: "update : Msg -> Global -> Model -> ( Model, Global ) when the page writes a global field, else Msg -> Model -> Model; Main forwards GotPage to the page shown and ignores it otherwise",
      routing: "in-app state: a route field and a case on the Page custom type; links and the nav bar send Navigate / GotPage (Page.Go route); no URL",
      types: "int Int, bool Bool, text and enum String (options as data in the view, a case for cycle), list a List of a type alias per list built by its positional constructor",
      derived: "computed in view; an if is a let binding of the view function",
      conditionals: "a view function per conditional section, called as Ui.when condition (viewSection …)",
      lists: "Html.Keyed (Keyed.ul / Keyed.ol) with a viewXItem function per list; the app's children are Keyed.node keyed by shell, menu and route id",
      time: "Time.every in the page's subscriptions (and the active tab's), forwarded by Main.subscriptions only for the page shown",
      externalEvents: "one incoming port; Json.Decode into the app's messages (deepLink → Navigate, serverSet → SetX, notify → Notify, snapshot → Snapshot, pagePush → the feed page's Pushed)",
      events: "onInput for text inputs and selects, onClick for buttons and checkboxes, Ui.onNumberInput (an integer in range, else no message) for number inputs",
      formatting: "as elm-format 0.8.8 writes it where practical; elm.json lists only the dependencies the app imports",
      build: "elm make --optimize, then uglify-js compress (pure_funcs) and mangle passes, as the Elm guide recommends",
    },
  };
}
