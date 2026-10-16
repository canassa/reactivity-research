// The unique-components scenario as tea-inline, a prototype strategy (see
// frameworks/tea-inline/README.md).
//
// The emitter plays the compiler of a TEA app, as in shared-components, but here there are no
// kinds to share: every widget is its own component (src/widgets/<id>.js), written out from
// its description as that widget's own code.
// - A widget builds its DOM once from one static HTML string (conditional sections included,
//   swapped out by `when` while hidden) and picks the elements its code uses by document
//   order; keyed list rows are built with `el(...)` by a row builder written for that list.
// - Every dynamic expression (a text, a disabled state, a condition, a validation rule) is
//   compiled to JavaScript and becomes a binding. The emitter works out at compile time which
//   fields each binding reads, and groups the bindings per field (`onVisits = [...]`).
// - Every message (a `case` arm of the widget's `update`) is inlined into the action its
//   control calls: it writes the fields its ops change, in place, and schedules the groups of
//   exactly those fields, plus the bindings of other widgets that read them (`R[widget].<field>`,
//   only for the fields some widget reads). No `Msg` object, no switch, no op table.
// - External events stay messages: `receive(msg)` routes serverSet/snapshot to a widget's
//   `load`, `tick` to the widgets that have a time-driven field and `notify` to the feed.
//
// Style choices (also in `style` below): one module per widget, static markup parsed once,
// in-place model edits, per-field binding groups, one microtask flush, keyed list rows patched
// in place by the action that knows which row it touched (other list edits replace the array
// and reconcile by id), and the runtime of tea-inline. The only generic code is the runtime and
// three small helpers in widgets/widget.js (section, loader, nextId); no widget behaviour is
// kept as data.

import { templateFiles } from "../../frameworks/tea-inline/framework.js";
import { literal, tplText } from "../../frameworks/shared/jsx.js";

export const framework = "tea-inline";

export const params = {};

const cap = (s) => s[0].toUpperCase() + s.slice(1);
// A widget's number: widget `wN` is number N, its position in page order counted from 1 (the
// emitter checks the ids).
const pos = (id) => Number(id.slice(1));
const str = JSON.stringify;
// HTML escaping for the static markup: text, and attribute values (unquoted when safe).
const escText = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const attrValue = (v) => (/^[\w.:-]+$/.test(v) ? v : `"${v.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`);

const WIDGET_FILE = `import { schedule } from "../runtime.js";

// A widget's DOM: its section, keyed by its id (widget number i is wi), with the markup inside
// (its heading and everything it shows), appended to \`parent\`, and returned as its elements in
// document order.
export function section(parent, i, html) {
  parent.insertAdjacentHTML("beforeend", \`<section data-key=w\${i} data-role=widget>\${html}</section>\`);
  return parent.lastChild.querySelectorAll(":not(h2,label,option)");
}

// Schedule every binding of a widget for its first render, and return its handle: its load for
// serverSet and snapshot (replace the widget's state, a copy since the message is not ours to
// edit, and run every binding it has again, and those of the widgets reading it), carrying its
// external arms.
export const loader = (s, all, arms) => (
  schedule(all),
  Object.assign((next) => {
    Object.assign(s, structuredClone(next));
    schedule(all);
  }, arms)
);

// A new list item's id: one more than the largest.
export const nextId = (items) => items.reduce((max, item) => Math.max(max, item.id), 0) + 1;

// The widgets by number, from 1: each widget's module adds its markup and its function when the
// app imports it, in page order.
export const W = [,];

`;

// ---------------------------------------------------------------------------------------------
// Expressions: compiled to JavaScript over the widget's state \`s\` and the slices of the
// widgets it reads. \`deps\` records the fields an expression reads.

// Drop the parentheses around a whole expression.
function bare(code) {
  if (code[0] !== "(" || code.at(-1) !== ")") return code;
  let depth = 0;
  for (let i = 0; i < code.length - 1; i++) {
    if (code[i] === '"') i = code.indexOf('"', i + 1);
    else if (code[i] === "(") depth++;
    else if (code[i] === ")" && --depth === 0) return code;
  }
  return code.slice(1, -1);
}

const exprCode = (e, deps) => bare(inner(e, deps));

function inner(e, deps) {
  const go = (x) => inner(x, deps);
  switch (e[0]) {
    case "f": deps.own.add(e[1]); return `s.${e[1]}`;
    case "w": deps.cross.add(`${e[1]}.${e[2]}`); return `model[${pos(e[1])}].${e[2]}`;
    case "k": return str(e[1]);
    case "+": case "-": return `(${go(e[1])} ${e[0]} ${go(e[2])})`;
    case "count": case "len": return `${go(e[1])}.length`;
    case "done": return `${go(e[1])}.filter((item) => item.done).length`;
    case "left": return `${go(e[1])}.filter((item) => !item.done).length`;
    case "has": return `${go(e[1])}.includes(${str(e[2])})`;
    case "==": return `(${go(e[1])} == ${go(e[2])})`;
    case "!=": return `(${go(e[1])} != ${go(e[2])})`;
    case "<": case "<=": case ">": case ">=": return `(${go(e[1])} ${e[0]} ${go(e[2])})`;
    case "and": return `(${go(e[1])} && ${go(e[2])})`;
    case "or": return `(${go(e[1])} || ${go(e[2])})`;
    case "not": return `!${go(e[1])}`;
    case "if": return `(${go(e[1])} ? ${go(e[2])} : ${go(e[3])})`;
  }
  throw new Error(`unknown expression ${JSON.stringify(e)}`);
}

// The text parts as an expression: a template literal, or a plain string when static.
function partsCode(parts, deps) {
  if (parts.every((p) => typeof p === "string")) return { static: parts.join("") };
  if (parts.length === 1) return { code: exprCode(parts[0], deps) };
  return { code: "`" + parts.map((p) => (typeof p === "string" ? tplText(p) : `\${${exprCode(p, deps)}}`)).join("") + "`" };
}

// Every cross-widget read of a view, to know which fields other widgets read.
function crossReads(nodes, out) {
  const expr = (e) => {
    if (!Array.isArray(e)) return;
    if (e[0] === "w") out.push([e[1], e[2]]);
    else e.slice(1).forEach(expr);
  };
  for (const n of nodes) {
    for (const p of n.parts || []) expr(p);
    for (const p of n.text || []) expr(p);
    if (n.disabled) expr(n.disabled);
    if (n.cond) expr(n.cond);
    if (n.invalid) expr(n.invalid.when);
    crossReads(n.children || [], out);
  }
}

// ---------------------------------------------------------------------------------------------
// One widget: its module.

function widgetFile(w, reads) {
  const field = (name) => w.fields.find((f) => f.name === name);
  const message = (name) => w.messages.find((m) => m.name === name);
  const ids = {};
  const id = (p) => p + (ids[p] = (ids[p] || 0) + 1);
  // An element the code refers to: a placeholder, written at the end as the element's place in
  // the markup (`E[n]`).
  const ref = (p) => `\0${id(p)}\0`;

  const build = []; // construction lines
  const bindings = []; // { code, own, cross, name }
  const actions = []; // thunks writing the handlers, once the binding groups are known
  const lists = {}; // list field -> its variable

  const bind = (mk, name) => {
    const deps = { own: new Set(), cross: new Set() };
    const code = mk(deps);
    bindings.push({ code, own: [...deps.own], cross: [...deps.cross], name });
  };

  const attrs = (o) => `{ ${Object.entries(o).map(([k, v]) => `${/^\w+$/.test(k) ? k : str(k)}: ${v}`).join(", ")} }`;

  // The scheduling call of an action writing \`fields\`.
  const sched = (fields, args = []) => {
    for (const f of new Set(fields)) {
      if (groupFields.has(f)) args.push("on" + cap(f));
    }
    return args.length ? [`schedule(${args.join(", ")});`] : [];
  };
  let groupFields = new Set();

  // The code of a click message: its ops, inlined.
  function opLines(m) {
    const lines = [];
    for (const op of m.ops) {
      const [kind, name] = op;
      const f = field(name);
      const v = `s.${name}`;
      switch (kind) {
        case "add":
          lines.push(op[2] > 0 ? `${v} = Math.min(${f.max}, ${v} + ${op[2]});` : `${v} = Math.max(${f.min}, ${v} - ${-op[2]});`);
          break;
        case "set": lines.push(`${v} = ${str(op[2])};`); break;
        case "toggle": lines.push(`${v} = !${v};`); break;
        case "reset": lines.push(`${v} = ${literal(f.initial)};`); break;
        case "cycle": {
          // The option after the current one, wrapping around: the compiler knows the options.
          const o = f.options;
          lines.push(`${v} = ${o.map((x, i) => `${v} == ${str(o.at(i - 1))} ? ${str(x)} : `).slice(0, -1).join("")}${str(o.at(-1))};`);
          break;
        }
        case "push": case "pushText": {
          if (m.ops.length !== 1) throw new Error("push inside a combined message");
          const item = (text) => `{ id: nextId(${v}), text: ${text}${f.checkable ? ", done: false" : ""} }`;
          if (kind === "push") {
            lines.push(`const title = s.${op[2]}.trim();`, "if (!title) return;", `const item = ${item("title")};`);
          } else lines.push(`const item = ${item(str(op[2]))};`);
          lines.push(`${v}.push(item);`);
          if (kind === "push") lines.push(`s.${op[2]} = "";`);
          if (lists[name]) lines.push(`${lists[name]}.add(item);`);
          break;
        }
        case "pop": lines.push(`${v} = ${v}.slice(0, -1);`); break;
        case "shift": lines.push(`${v} = ${v}.slice(1);`); break;
        case "clear": lines.push(`${v} = [];`); break;
        case "clearDone": lines.push(`${v} = ${v}.filter((item) => !item.done);`); break;
        default: throw new Error(`unknown op ${kind}`);
      }
    }
    return lines;
  }

  const writesOf = (m) => {
    if (m.kind !== "click") return [m.field];
    return m.ops.flatMap((op) => (op[0] === "push" ? [op[1], op[2]] : [op[1]]));
  };

  // The handler of a message on the element \`node\`.
  function handler(node, m) {
    actions.push(() => {
      const f = m.field && field(m.field);
      const done = sched(writesOf(m));
      const wrap = (event, body) => [`on(${node}, "${event}", () => {`, ...body.map((l) => "  " + l), "});"];
      switch (m.kind) {
        case "click": return wrap("click", [...opLines(m), ...done]);
        case "check": return wrap("change", [`s.${f.name} = !s.${f.name};`, ...done]);
        case "select": return wrap("change", [`s.${f.name} = ${node}.value;`, ...done]);
        case "input":
          if (f.type === "int") {
            return wrap("input", [`const value = ${node}.valueAsNumber;`,
              `if (!Number.isInteger(value) || value < ${f.min} || value > ${f.max}) return;`,
              `s.${f.name} = value;`, ...done]);
          }
          return wrap("input", [`s.${f.name} = ${node}.value;`, ...done]);
      }
      throw new Error(`unknown message kind ${m.kind}`);
    });
  }

  // The action of an item control (toggle or remove), inlined into the row's handler, which
  // knows its item; written once the binding groups are known (see `itemBodies`). A toggle
  // writes its item's `done`, so it schedules the row's own binding (`set`) with the field's
  // group.
  const itemBodies = {};
  function itemAction(name) {
    const m = message(name);
    itemBodies[name] = () => {
      const v = `s.${m.field}`;
      if (m.op === "toggle") return ["item.done = !item.done;", ...sched([m.field], ["set"])];
      return [`${v}.splice(${v}.indexOf(item), 1);`, `${lists[m.field]}.drop(item.id);`, ...sched([m.field])];
    };
    return `@@${name}@@`;
  }

  // The widget's static markup, as one HTML string, and the elements the code refers to: the
  // n-th element of the markup (in document order) is \`refs[n]\`.
  let html = "";
  let count = 0;
  const refs = [];
  const open = (tag, a = {}, name) => {
    if (name) refs[count] = name;
    if (!["h2", "label", "option"].includes(tag)) count++;
    html += `<${tag}${Object.entries(a).map(([k, v]) => ` ${k}=${attrValue(String(v))}`).join("")}>`;
  };
  const close = (tag) => (html += `</${tag}>`);
  const element = (tag, a, content, name) => {
    open(tag, a, name);
    if (tag !== "input") html += escText(content ?? "") + `</${tag}>`;
  };

  function node(n) {
    switch (n.el) {
      case "text": {
        const p = partsCode(n.parts, { own: new Set(), cross: new Set() });
        if (p.static !== undefined) element(n.tag, {}, p.static);
        else {
          const t = ref("t");
          element(n.tag, {}, "", t);
          bind((deps) => `() => text(${t}, ${partsCode(n.parts, deps).code})`);
        }
        return;
      }
      case "button": {
        const b = ref("b");
        const p = partsCode(n.text, { own: new Set(), cross: new Set() });
        element("button", { "data-role": n.msg }, p.static ?? "", b);
        if (p.static === undefined) bind((deps) => `() => text(${b}, ${partsCode(n.text, deps).code})`);
        if (n.disabled) bind((deps) => `() => prop(${b}, "disabled", ${exprCode(n.disabled, deps)})`);
        handler(b, message(n.msg));
        return;
      }
      case "input": {
        const m = message(n.msg);
        const f = field(m.field);
        const num = f.type === "int";
        if (n.label) {
          open("label");
          html += escText(n.label);
        }
        const i = ref("i");
        const o = { type: num ? "number" : "text", "data-role": n.msg };
        if (n.placeholder) o.placeholder = n.placeholder;
        element("input", o, null, i);
        if (n.label) close("label");
        bind((deps) => `() => prop(${i}, "value", ${num ? `String(${exprCode(["f", f.name], deps)})` : exprCode(["f", f.name], deps)})`);
        handler(i, m);
        if (n.invalid) {
          const e = ref("e");
          element("p", { "data-role": n.msg + "Error" }, n.invalid.message, e);
          bind((deps) => `() => when(${e}, ${exprCode(n.invalid.when, deps)})`);
        }
        return;
      }
      case "check": {
        const m = message(n.msg);
        const c = ref("c");
        open("label");
        element("input", { type: "checkbox", "data-role": n.msg }, null, c);
        html += escText(n.label);
        close("label");
        bind((deps) => `() => prop(${c}, "checked", ${exprCode(["f", m.field], deps)})`);
        handler(c, m);
        return;
      }
      case "select": {
        const m = message(n.msg);
        const f = field(m.field);
        if (n.label) {
          open("label");
          html += escText(n.label);
        }
        const o = ref("o");
        open("select", { "data-role": n.msg }, o);
        for (const value of f.options) element("option", { value }, value);
        close("select");
        if (n.label) close("label");
        bind((deps) => `() => prop(${o}, "value", ${exprCode(["f", f.name], deps)})`);
        handler(o, m);
        return;
      }
      case "list": {
        const f = field(n.field);
        const l = id("ls");
        const u = ref("n");
        lists[n.field] = l;
        element(n.tag, {}, "", u);
        const row = [`const node = el("li", null, ${attrs({ "data-key": "item.id", "data-role": str(n.field + "Item") })});`];
        const set = [];
        if (n.check) {
          row.push(`const box = el("input", node, ${attrs({ type: str("checkbox"), "data-role": str(n.check) })});`);
          set.push('prop(box, "checked", item.done);');
        }
        row.push('const label = el("span", node);');
        set.push("text(label, item.text);");
        // The row's binding: the list hands it the item of its id, so the row keeps its item
        // current for its controls' arms; a toggle schedules it as is.
        row.push(`const set = (next = item) => { item = next; ${set.join(" ")} };`);
        if (n.check) row.push(`on(box, "change", () => {`, itemAction(n.check), "});");
        if (n.remove) {
          row.push(`on(el("button", node, ${attrs({ "data-role": str(n.remove) })}, ${str(n.removeText)}), "click", () => {`, itemAction(n.remove), "});");
        }
        row.push("return [node, set];");
        build.push(`const ${l} = list(${u}, () => s.${f.name}, (item) => {`,
          ...row.map((r) => "  " + r), "});");
        bindings.push({ code: l, own: [f.name], cross: [], name: l });
        return;
      }
      case "when": {
        const g = ref("g");
        open(n.tag, {}, g);
        for (const c of n.children) node(c);
        close(n.tag);
        bind((deps) => `() => when(${g}, ${exprCode(n.cond, deps)})`);
        return;
      }
      case "group": {
        open(n.tag);
        for (const c of n.children) node(c);
        close(n.tag);
        return;
      }
    }
    throw new Error(`unknown view node ${n.el}`);
  }

  // The section itself is written by `section`: the markup is what goes inside, from element 0.
  element("h2", {}, w.label);
  for (const n of w.view) node(n);
  // Leave out the end tags HTML makes optional: `</option>` before an option or the select's
  // end, `</p>` before a block element or its parent's end (none of the parents here is one
  // that keeps it, like `<a>`); the parsed DOM is the same.
  html = html.replace(/<\/option>(?=<option|<\/select>)/g, "")
    .replace(/<\/p>(?=<(?:aside|div|fieldset|footer|header|ol|p|section|ul)[\s>]|<\/|$)/g, "");

  // The bindings: those reading one field of this widget and nothing else are written inline in
  // that field's group; the others are named and listed in each group they belong to.
  let named = 0;
  for (const b of bindings) {
    if (!b.name && !(b.own.length === 1 && b.cross.length === 0)) b.name = "u" + ++named;
  }
  const namedLines = bindings.filter((b) => b.name && !/^ls\d+$/.test(b.name)).map((b) => `const ${b.name} = ${b.code};`);
  const groups = new Map();
  for (const b of bindings) for (const f of b.own) groups.set(f, [...(groups.get(f) || []), b.name || b.code]);
  // A field other widgets read: its group also holds their bindings, registered at mount.
  for (const f of w.fields) if (reads[w.id]?.has(f.name)) groups.set(f.name, [...(groups.get(f.name) || []), `R[widget].${f.name}`]);
  groupFields = new Set(groups.keys());
  const groupLines = [...groups].flatMap(([f, items]) => {
    const flat = `const on${cap(f)} = [${items.join(", ")}];`;
    return flat.length <= 100 ? [flat] : [`const on${cap(f)} = [`, ...items.map((i) => "  " + i + ","), "];"];
  });
  const alone = bindings.filter((b) => b.own.length === 0).map((b) => b.name);
  const crossPushes = bindings.flatMap((b) => b.cross.map((c) => `R[${pos(c.split(".")[0])}].${c.split(".")[1]}.push(${b.name});`));

  // External arms.
  const arms = [];
  const tickFields = w.fields.filter((f) => f.tick);
  if (tickFields.length) {
    const body = tickFields.flatMap((f) => [
      `if (s.${f.tickWhen}) {`,
      `  const value = Math.min(${f.max}, s.${f.name} + ${f.tick});`,
      `  if (value !== s.${f.name}) {`,
      `    s.${f.name} = value;`,
      ...sched([f.name]).map((l) => "    " + l),
      "  }",
      "}",
    ]);
    arms.push(["// The external arm: tick.", "tick() {", ...body.map((l) => "  " + l), "},"]);
  }
  const feed = w.fields.find((f) => f.feed);
  if (feed) {
    arms.push(["// The external arm: notify(item).", "notify(item) {", `  s.${feed.name}.push(item);`, `  ${lists[feed.name]}.add(item);`,
      ...sched([feed.name]).map((l) => "  " + l), "},"]);
  }

  const handlerLines = actions.map((a) => a());
  const expand = (lines) => lines.flatMap((l) => {
    const m = /^(\s*)@@(\w+)@@$/.exec(l);
    return m ? itemBodies[m[2]]().map((b) => m[1] + "  " + b) : [l];
  });

  const all = [...groups.keys()].map((f) => "on" + cap(f)).concat(alone);
  const body = [
    ...expand(build),
    "",
    ...(namedLines.length ? ["// Bindings reading several fields, or other widgets."] : []),
    ...namedLines,
    "// The bindings, grouped by the field they read.",
    ...groupLines,
    ...(crossPushes.length ? ["", "// Register with the widgets this one reads.", ...crossPushes] : []),
    ...(handlerLines.length ? ["", "// The arms of update, as actions."] : []),
    ...handlerLines.flat(),
    "",
    ...(arms.length
      ? [`return loader(s, [${all.join(", ")}], {`, ...arms.flat().map((l) => "  " + l), "});"]
      : [`return loader(s, [${all.join(", ")}]);`]),
  ];
  const at = new Map(Object.entries(refs).map(([n, r]) => [r, n]));
  const text = (body[0] === "" ? body.slice(1) : body).map((l) => (l ? "  " + l : l)).join("\n").replace(/\0\w+\0/g, (r) => `E[${at.get(r)}]`);

  const rt = ["el", "text", "prop", "on", "when", "list", "schedule"].filter((n) => new RegExp(`\\b${n}\\(`).test(text));
  const wi = ["loader", "nextId"].filter((n) => new RegExp(`\\b${n}\\(`).test(text));
  // The widget's markup, and its function: given the markup's elements (in document order, those
  // the code refers to are E[n]), its state slice, the readers, its number, and the model when it
  // reads other widgets.
  return `import { ${rt.join(", ")} } from "../runtime.js";
import { ${["W", ...wi].join(", ")} } from "./widget.js";

// Widget ${w.id}: its markup, and its code over the markup's elements.
W.push([${str(html)}, (E, s, R, widget${text.includes("model[") ? ", model" : ""}) => {
${text}
}]);
`;
}

// ---------------------------------------------------------------------------------------------
// The app: init, the widgets in page order, and the external arms of update.

function appFile(spec, reads) {
  const ticking = spec.widgets.filter((w) => w.fields.some((f) => f.tick));
  const cases = [`      case "serverSet":
        views[msg.widget.slice(1)](msg.state);
        break;`];
  if (ticking.length) {
    cases.push(`      case "tick":
${ticking.map((w) => `        views[${pos(w.id)}].tick();`).join("\n")}
        break;`);
  }
  if (spec.widgets.some((w) => w.fields.some((f) => f.feed))) {
    cases.push(`      case "notify":
        views[msg.widget.slice(1)].notify(msg.item);
        break;`);
  }
  cases.push(`      case "snapshot":
        for (const id in msg.state.widgets) views[id.slice(1)](msg.state.widgets[id]);
        break;`);

  const readers = {};
  for (const [wid, fs] of Object.entries(reads)) readers[pos(wid)] = Object.fromEntries([...fs].map((f) => [f, []]));
  const imports = [`import { flush, cancel } from "./runtime.js";`,
    `import { W, section } from "./widgets/widget.js";`,
    ...spec.widgets.map((w) => `import "./widgets/${w.id}.js";`)];

  return `${imports.join("\n")}

export function start(root) {
  // The initial model (TEA's \`init\`: its widgets by number, from 1), fresh for every mount.
  const model = [, ${literal(spec.widgets.map((w) => spec.initialState.widgets[w.id]), "  ").slice(1)};
  // The dashboard, from its markup like every widget.
  root.insertAdjacentHTML("beforeend", "<div data-role=dashboard></div>");
  const board = root.lastChild;
  // For each field another widget reads, the bindings reading it: the widget schedules them
  // when it writes the field.
  const R = ${literal(readers, "  ")};
  // Every widget in page order, given its markup's elements and its number (widget \`wN\` is number N,
  // its position from 1: its slice of the model is \`model[N]\`, its handle \`views[N]\`; \`map\` skips
  // the hole at 0). A handle is its load for serverSet and snapshot, carrying its external arms.
  const views = W.map(([html, widget], i) => widget(section(board, i, html), model[i], R, i, model));
  flush();

  // The arms of update still reached by a message: external events.
  function receive(msg) {
    switch (msg.type) {
${cases.join("\n")}
    }
  }

  function stop() {
    cancel();
    board.remove();
  }

  return { receive, stop };
}
`;
}

export function emit(spec) {
  // Widgets are numbered in page order (their ids are w1, w2, …): the model is an array by number.
  if (spec.widgets.some((w, i) => w.id !== `w${i + 1}`)) throw new Error("widget ids are not w1, w2, … in order");
  // The fields other widgets read.
  const reads = {};
  for (const w of spec.widgets) {
    const out = [];
    crossReads(w.view, out);
    for (const [wid, f] of out) (reads[wid] ||= new Set()).add(f);
  }
  const files = {
    ...templateFiles({ name: "unique-components", title: "Unique components" }),
    "src/app.js": appFile(spec, reads),
    "src/widgets/widget.js": WIDGET_FILE,
  };
  for (const w of spec.widgets) files[`src/widgets/${w.id}.js`] = widgetFile(w, reads);
  return {
    files,
    style: {
      track: "prototype: no framework implements this strategy",
      components: "one module per widget, each written out from its own description; DOM built once from one static HTML string, elements picked by document order; conditional sections swapped out by when while hidden; list rows built with createElement",
      messages: "erased for DOM events: each update arm is inlined into the action its control calls, which writes the widget's fields in place",
      updates: "each action schedules the per-field binding groups of the fields it writes (known at compile time); one microtask flush",
      derived: "cross-widget reads register their bindings at mount in R.<widget>.<field>, only for fields some widget reads; the writing action schedules them",
      lists: "keyed: add, remove and toggle patch their rows; other edits replace the array and reconcile by id in one forward pass",
      externalEvents: "receive(msg): serverSet and snapshot replace a widget's state (a copy) and run all its bindings and its readers; tick and notify call the widgets' external arms",
      build: "Vite with no framework plugin, production defaults, hidden source maps",
    },
  };
}
