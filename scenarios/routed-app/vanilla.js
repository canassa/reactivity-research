// The routed-app scenario in vanilla JavaScript: the floor, written the way a person writes a small
// multi-page app by hand with no library (see frameworks/vanilla/README.md).
//
// Style (recorded in every generated app's rr.json):
// - `src/app.js` is the shell: the global state as one plain object `g`, the route, the nav bar,
//   the "All pages" menu (built when it opens, removed when it closes) and the router. `go(route)`
//   disposes the page shown and mounts the next one; going to the page already shown only closes
//   the menu. One delegated click listener on the app element serves the nav bar and the menu.
// - Each page is its own module (`src/pages/pN.js`) exporting `mount(a)`, written out from its
//   description alone. `a` is the app's small interface (`g`, `go(route)`, `changed()`, which
//   repaints the shell and the page after a write to global state). `mount` builds the page's DOM
//   from one static HTML string (comment anchors mark where a conditional section goes), keeps
//   the page's state as plain objects in its closure (`s` the page's fields, `t` the active tab
//   panel's, `m` the open modal's) and returns `{ el, render, push, dispose }`. Nothing is
//   interpreted at runtime: handlers, bindings and expressions are that page's own code.
// - Each page has one `render()`, which writes every binding from the state, idempotently
//   (`setText`/`setValue` write only what differs, so nodes, focus and caret stay). A handler
//   changes the state and calls it. Keyed lists go through `sync` (`src/lib.js`, the only generic
//   helper, counted as runtime), which keeps each item's node across reorders. A conditional
//   section is created and removed after its comment anchor; a tab panel and the modal are built
//   when selected or opened, with fresh state, and dropped when left or closed.
// - Events: one delegated `click`, `input` and `change` listener per page, on its `<main>`,
//   switching on the target's `data-role`; an item control finds its id with `closest("li")`. A
//   number input sends its message only for an integer within the field's range. The listeners
//   sit on nodes that leave the document with the page, so a page's dispose clears its timers
//   and removes its `<main>`.
// - Time: one `setInterval` per mounted time-driven field, started when the page (or the tab
//   panel) is built and cleared when it is left.
// - External events: `receive` in `app.js` (deepLink, serverSet, notify, snapshot). A `pagePush`
//   reaches only the page shown, through its `push`. Lists are replaced, never mutated, and
//   items taken from a message are copied, so a dispatched message is never adopted.

import { templateFiles } from "../../frameworks/vanilla/framework.js";
import { literal, tplText } from "../../frameworks/shared/jsx.js";

export const framework = "vanilla";

export const params = {};

const str = JSON.stringify;
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const escText = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const escAttr = (s) => escText(s).replace(/"/g, "&quot;");
const indent = (lines, pad) => lines.map((l) => (l ? pad + l : l));

const LIB_FILE = `// The app's only generic helper: keep the children of a keyed list in step with an array of items.
// A child whose key (\`data-key\`) is still there keeps its node, a new item gets a clone of
// \`tpl\`, the nodes of items that left are removed, and \`patch(node, item)\` writes what an item
// shows.
export function sync(parent, items, tpl, patch) {
  const old = new Map();
  for (const node of parent.children) old.set(node.dataset.key, node);
  let at = parent.firstChild;
  for (const item of items) {
    const key = String(item.id);
    let node = old.get(key);
    if (node) old.delete(key);
    else {
      node = tpl.cloneNode(true);
      node.dataset.key = key;
    }
    patch(node, item);
    if (node === at) at = at.nextSibling;
    else parent.insertBefore(node, at);
  }
  for (const node of old.values()) node.remove();
}
`;

const UTIL_FILE = `// Small helpers the pages share.

// Write only what differs, so a node keeps its text node, its focus and its caret.
export const setText = (el, text) => {
  if (el.textContent !== text) el.textContent = text;
};

export const setValue = (el, value) => {
  if (el.value !== value) el.value = value;
};

// The id for a new list item: one more than the largest.
export const nextId = (items) => items.reduce((max, item) => Math.max(max, item.id), 0) + 1;

// The option after \`value\` in \`options\`, wrapping around.
export const next = (value, options) => options[(options.indexOf(value) + 1) % options.length];

// A copy of a list item that came in a message.
export const copy = (item) => ({ id: item.id, text: item.text });
`;

// ---------------------------------------------------------------------------------------------
// Expressions: the spec's typed arrays as JavaScript. `sv` is the variable of the component the
// expression is read in (`s`, `t` or `m`).

const COMPARE = { "==": "===", "!=": "!==", "<": "<", "<=": "<=", ">": ">", ">=": ">=" };

function expr(e, sv, top = true) {
  const wrap = (code) => (top ? code : `(${code})`);
  const sub = (x) => expr(x, sv, false);
  switch (e[0]) {
    case "f": return `${sv}.${e[1]}`;
    case "p": return `s.${e[1]}`;
    case "g": return `g.${e[1]}`;
    case "k": return str(e[1]);
    case "+": return wrap(`${sub(e[1])} + ${sub(e[2])}`);
    case "-": return wrap(`${sub(e[1])} - ${sub(e[2])}`);
    case "count": case "len": return `${sub(e[1])}.length`;
    case "done": return `${sub(e[1])}.filter((it) => it.done).length`;
    case "left": return `${sub(e[1])}.filter((it) => !it.done).length`;
    case "has": return `${sub(e[1])}.includes(${str(e[2])})`;
    case "and": return wrap(`${sub(e[1])} && ${sub(e[2])}`);
    case "or": return wrap(`${sub(e[1])} || ${sub(e[2])}`);
    case "not": return `!${sub(e[1])}`;
    case "if": return wrap(`${sub(e[1])} ? ${sub(e[2])} : ${sub(e[3])}`);
  }
  if (COMPARE[e[0]]) return wrap(`${sub(e[1])} ${COMPARE[e[0]]} ${sub(e[2])}`);
  throw new Error(`unknown expression ${JSON.stringify(e)}`);
}

// A string built from a text node's parts.
function template(parts, sv) {
  return "`" + parts.map((p) => (typeof p === "string" ? tplText(p) : `\${${expr(p, sv)}}`)).join("") + "`";
}

// ---------------------------------------------------------------------------------------------
// DOM descriptions. A region is a piece of DOM built from one HTML string; the nodes the code
// must reach (to bind them) are found by their position, as a path of `childNodes` indexes.

const el = (tag, attrs = [], kids = []) => ({ tag, attrs, kids });
const txt = (text) => ({ text });
const VOID = new Set(["input"]);

function serialize(d) {
  if (d.anchor) return "<!---->";
  if (d.text !== undefined) return escText(d.text);
  const attrs = d.attrs.map(([k, v]) => ` ${k}="${escAttr(String(v))}"`).join("");
  return VOID.has(d.tag) ? `<${d.tag}${attrs}>` : `<${d.tag}${attrs}>${d.kids.map(serialize).join("")}</${d.tag}>`;
}

// `name = root.childNodes[i].childNodes[j]` for every described node that has a variable.
function paths(kids, root, out = []) {
  kids.forEach((d, i) => {
    const p = `${root}.childNodes[${i}]`;
    if (d.v) out.push([d.v, p]);
    if (d.kids) paths(d.kids, p, out);
  });
  return out;
}

// ---------------------------------------------------------------------------------------------
// One page

function pageFile(spec, page) {
  const uses = new Set();
  const use = (n) => (uses.add(n), n);

  // The page's code, in the closure of `mount`.
  const P = {
    counters: {},
    lets: [],      // names declared with `let`
    setup: [],     // statements before the first render: templates, patches
    fns: [],       // functions in the closure
    name(prefix) {
      P.counters[prefix] = (P.counters[prefix] || 0) + 1;
      return `${prefix}${P.counters[prefix]}`;
    },
  };

  const globalField = (name) => spec.global.find((f) => f.name === name);
  // The description of the field a ref names, as seen from component `comp`.
  const fieldOf = (ref, comp) => (ref[0] === "g" ? globalField(ref[1]) : (ref[0] === "p" ? page : comp).fields.find((f) => f.name === ref[1]));

  // -------- views

  // A region of one component: `comp` and its state variable `sv`; `refs` get variables.
  const newRegion = (comp, sv) => ({ comp, sv, render: [], nested: [] });

  function bind(R, d) {
    d.v = P.name("n");
    return d;
  }

  // Lower view nodes to DOM descriptions; bindings go to R.render.
  const lower = (nodes, R) => nodes.flatMap((n) => lowerNode(n, R));

  function textKids(parts) {
    const s = parts.join("");
    return s === "" ? [] : [txt(s)];
  }

  function lowerNode(n, R) {
    const { comp, sv } = R;
    const msg = (name) => comp.messages.find((m) => m.name === name);
    switch (n.el) {
      case "text": {
        if (n.parts.every((p) => typeof p === "string")) return [el(n.tag, [], textKids(n.parts))];
        const d = bind(R, el(n.tag));
        R.render.push(`${use("setText")}(${d.v}, ${template(n.parts, sv)});`);
        return [d];
      }
      case "button": {
        const d = el("button", [["data-role", n.msg]]);
        if (n.text.every((p) => typeof p === "string")) d.kids = textKids(n.text);
        else {
          bind(R, d);
          R.render.push(`${use("setText")}(${d.v}, ${template(n.text, sv)});`);
        }
        if (n.disabled) {
          if (!d.v) bind(R, d);
          R.render.push(`${d.v}.disabled = ${expr(n.disabled, sv)};`);
        }
        return [d];
      }
      case "link": return [el("button", [["data-key", n.to], ["data-role", "pageLink"]], [txt(n.text)])];
      case "open": return [el("button", [["data-role", n.msg]], [txt(n.text)])];
      case "input": {
        const m = msg(n.msg);
        const f = fieldOf(m.field, comp);
        const attrs = [["type", f.type === "int" ? "number" : "text"], ["data-role", n.msg]];
        if (n.placeholder != null) attrs.push(["placeholder", n.placeholder]);
        const d = bind(R, el("input", attrs));
        const value = expr(m.field, sv);
        R.render.push(f.type === "int" ? `if (${d.v}.valueAsNumber !== ${value}) ${d.v}.value = ${value};` : `${use("setValue")}(${d.v}, ${value});`);
        const out = [n.label ? el("label", [], [txt(n.label), d]) : d];
        if (n.invalid) out.push(...optional(R, expr(n.invalid.when, sv), "p", [["data-role", `${n.msg}Error`]], () => textKids([n.invalid.message])));
        return out;
      }
      case "check": {
        const m = msg(n.msg);
        const d = bind(R, el("input", [["type", "checkbox"], ["data-role", n.msg]]));
        R.render.push(`${d.v}.checked = ${expr(m.field, sv)};`);
        return [el("label", [], [d, txt(n.label)])];
      }
      case "select": {
        const m = msg(n.msg);
        const f = fieldOf(m.field, comp);
        const d = bind(R, el("select", [["data-role", n.msg]], f.options.map((o) => el("option", [["value", o]], [txt(o)]))));
        R.render.push(`${use("setValue")}(${d.v}, ${expr(m.field, sv)});`);
        return [n.label ? el("label", [], [txt(n.label), d]) : d];
      }
      case "list": {
        const d = bind(R, el(n.tag));
        const tpl = P.name("item");
        const patch = P.name("patch");
        const kids = [];
        const lines = [];
        let at = 0;
        if (n.check) {
          kids.push(el("input", [["type", "checkbox"], ["data-role", n.check]]));
          lines.push(`node.childNodes[${at++}].checked = item.done;`);
        }
        kids.push(el("span"));
        lines.push(`${use("setText")}(node.childNodes[${at++}], item.text);`);
        if (n.remove) kids.push(el("button", [["data-role", n.remove]], [txt(n.removeText)]));
        P.setup.push(`const ${tpl} = document.createElement("li");`);
        P.setup.push(`${tpl}.dataset.role = ${str(`${n.field[1]}Item`)};`);
        P.setup.push(`${tpl}.innerHTML = \`${tplText(kids.map(serialize).join(""))}\`;`);
        P.setup.push(`const ${patch} = (node, item) => {\n${indent(lines, "  ").join("\n")}\n};`);
        R.render.push(`${use("sync")}(${d.v}, ${expr(n.field, sv)}, ${tpl}, ${patch});`);
        return [d];
      }
      case "when":
        return optional(R, expr(n.cond, sv), n.tag, [], (R2) => lower(n.children, R2));
      case "group": return [el(n.tag, [], lower(n.children, R))];
      case "tabs": {
        const nav = bind(R, el("nav", [["data-role", "tabs"]], page.tabs.map((t, i) =>
          el("button", [["data-key", t.id], ["data-role", "tab"], ["aria-selected", String(i === 0)]], [txt(t.label)]))));
        const section = bind(R, el("section", [["data-key", page.tabs[0].id], ["data-role", "panel"]]));
        P.tabsNav = nav.v;
        P.panel = section.v;
        return [nav, section];
      }
    }
    throw new Error(`unknown view node ${n.el}`);
  }

  // A part of the view that exists only while `cond` holds: created after a comment anchor when it
  // starts to hold, removed when it stops. `kids(R2)` describes its content in its own region.
  function optional(R, cond, tag, attrs, kids) {
    const anchor = bind(R, { anchor: true });
    const w = P.name("w");
    const fn = P.name("show");
    const R2 = newRegion(R.comp, R.sv);
    const children = kids(R2);
    P.lets.push(w);
    const own = [];
    const collect = (d) => { if (d.v) own.push(d.v); (d.kids || []).forEach(collect); };
    children.forEach(collect);
    P.lets.push(...own);
    const create = [
      `${w} = document.createElement(${str(tag)});`,
      ...attrs.map(([k, v]) => `${w}.dataset.${k.slice(5)} = ${str(v)};`),
      ...(children.length ? [`${w}.innerHTML = \`${tplText(children.map(serialize).join(""))}\`;`] : []),
      ...paths(children, w).map(([v, p]) => `${v} = ${p};`),
      `${anchor.v}.after(${w});`,
    ];
    const gone = [w, ...R2.nested].join(" = ");
    R.nested.push(w, ...R2.nested);
    P.fns.push([
      `function ${fn}() {`,
      `  if (${cond}) {`,
      `    if (!${w}) {`,
      ...indent(create, "      "),
      `    }`,
      ...indent(R2.render, "    "),
      `  } else if (${w}) {`,
      `    ${w}.remove();`,
      `    ${gone} = undefined;`,
      `  }`,
      `}`,
    ].join("\n"));
    R.render.push(`${fn}();`);
    return [anchor];
  }

  // -------- state, messages

  const initial = (comp, pad = "") => literal(Object.fromEntries(comp.fields.map((f) => [f.name, f.initial])), pad);
  const lvalue = (ref, sv) => (ref[0] === "g" ? `g.${ref[1]}` : ref[0] === "p" ? `s.${ref[1]}` : `${sv}.${ref[1]}`);
  const isList = (ref, comp) => fieldOf(ref, comp).type === "list";

  // The statements of one op.
  function opLines(op, comp, sv) {
    const [kind, ref] = op;
    const X = lvalue(ref, sv);
    const f = fieldOf(ref, comp);
    const entry = (list, text) => `{ id: ${use("nextId")}(${list}), text: ${text}${f.checkable ? ", done: false" : ""} }`;
    switch (kind) {
      case "add": return [`${X} = Math.min(${f.max}, Math.max(${f.min}, ${X} ${op[2] < 0 ? "-" : "+"} ${Math.abs(op[2])}));`];
      case "set": return [`${X} = ${str(op[2])};`];
      case "toggle": return [`${X} = !${X};`];
      case "reset": return [`${X} = ${literal(f.initial)};`];
      case "cycle": return [`${X} = ${use("next")}(${X}, ${literal(f.options)});`];
      case "copy": return [`${X} = ${lvalue(op[2], sv)};`];
      case "push": {
        const D = lvalue(op[2], sv);
        return [`if (${D}.trim()) {`, `  ${X} = [...${X}, ${entry(X, `${D}.trim()`)}];`, `  ${D} = "";`, `}`];
      }
      case "pushText": return [`${X} = [...${X}, ${entry(X, str(op[2]))}];`];
      case "pop": return [`${X} = ${X}.slice(0, -1);`];
      case "shift": return [`${X} = ${X}.slice(1);`];
      case "clear": return [`${X} = [];`];
      case "clearDone": return [`${X} = ${X}.filter((it) => !it.done);`];
    }
    throw new Error(`unknown op ${kind}`);
  }

  const writesGlobal = (m) => {
    if (m.kind === "click" || m.kind === "confirm") return m.ops.some((op) => op[1][0] === "g");
    return m.field && m.field[0] === "g";
  };

  // The `case` of a message in its event's switch. `sv` is the state variable of the component
  // that owns it.
  function caseOf(comp, sv, m) {
    const X = m.field ? lvalue(m.field, sv) : null;
    const body = [];
    let end = ["break;"];
    const finish = () => { if (writesGlobal(m)) end = ["return a.changed();"]; };
    switch (m.kind) {
      case "click":
        body.push(...m.ops.flatMap((op) => opLines(op, comp, sv)));
        finish();
        break;
      case "confirm":
        body.push(...m.ops.flatMap((op) => opLines(op, comp, sv)), "closeModal();");
        finish();
        break;
      case "open": body.push("openModal();"); break;
      case "close": body.push("closeModal();"); break;
      case "input": {
        const f = fieldOf(m.field, comp);
        if (f.type === "int") {
          body.push("const value = e.target.valueAsNumber;");
          body.push(`if (!Number.isInteger(value) || value < ${f.min} || value > ${f.max}) return;`);
          body.push(`${X} = value;`);
        } else body.push(`${X} = e.target.value;`);
        finish();
        break;
      }
      case "select": body.push(`${X} = e.target.value;`); finish(); break;
      case "check": body.push(`${X} = !${X};`); finish(); break;
      case "item": {
        body.push("const id = Number(e.target.closest(\"li\").dataset.key);");
        body.push(m.op === "remove"
          ? `${X} = ${X}.filter((it) => it.id !== id);`
          : `${X} = ${X}.map((it) => (it.id === id ? { ...it, done: !it.done } : it));`);
        finish();
        break;
      }
      default: throw new Error(`unknown message kind ${m.kind}`);
    }
    return { event: { input: "input", select: "change", check: "change", item: m.op === "toggle" ? "change" : "click" }[m.kind] || "click", lines: [`case ${str(m.name)}: {`, ...indent([...body, ...end], "  "), "}"] };
  }

  // -------- assemble the page

  const hasModal = !!page.modal;
  const hasTabs = !!page.tabs;

  // The page's own region.
  const R = newRegion(page, "s");
  const title = el("h1", [], [txt(page.title)]);
  const kids = [title, ...lower(page.view, R)];
  const pageRefs = paths(kids, "main");

  // Tab panels and the modal, each its own region.
  const panels = (page.tabs || []).map((tab) => {
    const R2 = newRegion(tab, "t");
    const content = lower(tab.view, R2);
    return { tab, R: R2, content };
  });
  let modal = null;
  if (hasModal) {
    const R2 = newRegion(page.modal, "m");
    const content = [el("h2", [], [txt(page.modal.title)]), ...lower(page.modal.view, R2)];
    modal = { R: R2, content };
  }

  // Messages, grouped by the event that carries them.
  const events = { click: [], input: [], change: [] };
  const addCases = (comp, sv) => {
    for (const m of comp.messages) {
      const { event, lines } = caseOf(comp, sv, m);
      events[event].push(lines);
    }
  };
  addCases(page, "s");
  for (const p of panels) addCases(p.tab, "t");
  if (modal) addCases(page.modal, "m");
  if (pageHasLinks(page)) events.click.push([`case "pageLink":`, `  return a.go(e.target.dataset.key);`]);
  if (hasTabs) events.click.push([`case "tab":`, `  return selectTab(e.target.dataset.key);`]);

  // Time-driven fields.
  const timers = (comp, sv, name) => comp.fields.filter((f) => f.every).map((f) =>
    `${name} = setInterval(() => {\n  ${sv}.${f.name} = Math.min(${f.max}, ${sv}.${f.name} + ${f.by});\n  render();\n}, ${f.every});`);
  const pageTimer = timers(page, "s", "timer");

  const out = [];
  const lets = [...P.lets];
  if (pageTimer.length) lets.push("timer");
  if (hasTabs) lets.push("tab", "t", "tabTimer");
  if (hasModal) lets.push("m", "aside");
  const refLets = [];

  // Tab panels: open and render functions.
  const panelFns = panels.map(({ tab, R: R2, content }) => {
    const refs = [];
    const gather = (ds) => ds.forEach((d) => { if (d.v) refs.push(d.v); if (d.kids) gather(d.kids); });
    gather(content);
    refLets.push(...refs);
    const open = [
      `function open${cap(tab.id)}() {`,
      `  t = ${initial(tab, "  ")};`,
      `  ${P.panel}.dataset.key = ${str(tab.id)};`,
      `  ${P.panel}.innerHTML = \`${tplText(content.map(serialize).join(""))}\`;`,
      ...indent(paths(content, P.panel).map(([v, p]) => `${v} = ${p};`), "  "),
      ...indent(R2.nested.length ? [`${R2.nested.join(" = ")} = undefined;`] : [], "  "),
      ...indent(timers(tab, "t", "tabTimer"), "  "),
      `}`,
    ];
    const render = [`function render${cap(tab.id)}() {`, ...indent(R2.render, "  "), `}`];
    return [open.join("\n"), render.join("\n")];
  });

  const selectTab = hasTabs ? [
    `function selectTab(id) {`,
    `  if (id === tab) return;`,
    `  clearInterval(tabTimer);`,
    `  tab = id;`,
    `  for (const button of ${P.tabsNav}.children) button.setAttribute("aria-selected", button.dataset.key === id);`,
    `  switch (id) {`,
    ...page.tabs.flatMap((tb) => [`    case ${str(tb.id)}:`, `      open${cap(tb.id)}();`, `      break;`]),
    `  }`,
    `  render();`,
    `}`,
  ].join("\n") : "";

  // The modal.
  let modalFns = [];
  if (modal) {
    const refs = [];
    const gather = (ds) => ds.forEach((d) => { if (d.v) refs.push(d.v); if (d.kids) gather(d.kids); });
    gather(modal.content);
    refLets.push(...refs);
    modalFns = [
      [
        `function openModal() {`,
        `  m = ${initial(page.modal, "  ")};`,
        `  aside = document.createElement("aside");`,
        `  aside.dataset.key = "modal";`,
        `  aside.dataset.role = "dialog";`,
        `  aside.innerHTML = \`${tplText(modal.content.map(serialize).join(""))}\`;`,
        ...indent(paths(modal.content, "aside").map(([v, p]) => `${v} = ${p};`), "  "),
        ...indent(modal.R.nested.length ? [`${modal.R.nested.join(" = ")} = undefined;`] : [], "  "),
        `  main.append(aside);`,
        `}`,
      ].join("\n"),
      `function closeModal() {\n  aside.remove();\n  aside = m = undefined;\n}`,
      [`function renderModal() {`, ...indent(modal.R.render, "  "), `}`].join("\n"),
    ];
  }

  // render()
  const renderBody = [...R.render];
  if (hasTabs) {
    renderBody.push("switch (tab) {");
    for (const tb of page.tabs) renderBody.push(`  case ${str(tb.id)}:`, `    render${cap(tb.id)}();`, "    break;");
    renderBody.push("}");
  }
  if (hasModal) renderBody.push("if (m) renderModal();");

  // The feed.
  const feed = page.fields.find((f) => f.feed);

  // Handlers.
  const listener = (type, cases) => {
    if (!cases.length) return null;
    return [
      `main.addEventListener(${str(type)}, (e) => {`,
      `  switch (e.target.dataset.role) {`,
      ...indent(cases.flat(), "    "),
      `    default:`,
      `      return;`,
      `  }`,
      `  render();`,
      `});`,
    ].join("\n");
  };

  // Refs of the page region: constants (the page's static DOM), the others assigned later.
  const staticRefs = pageRefs.map(([v, p]) => `const ${v} = ${p};`);
  const allLets = [...lets, ...refLets];

  const body = [];
  body.push(`const { g } = a;`);
  body.push(`const s = ${initial(page)};`);
  if (allLets.length) body.push(`let ${[...new Set(allLets)].join(", ")};`);
  body.push(`const main = document.createElement("main");`);
  body.push(`main.dataset.key = ${str(page.id)};`);
  body.push(`main.dataset.role = "page";`);
  body.push(`main.innerHTML = \`${tplText(kids.map(serialize).join(""))}\`;`);
  body.push(...staticRefs);
  body.push(...P.setup);
  const sections = [
    body.filter((l) => l !== "").join("\n"),
    ...P.fns,
    ...panelFns.flat(),
    ...(selectTab ? [selectTab] : []),
    ...modalFns,
    `function render() {\n${indent(renderBody, "  ").join("\n")}\n}`,
    ...[listener("click", events.click), listener("input", events.input), listener("change", events.change)].filter(Boolean),
  ];
  if (hasTabs) sections.push(`tab = ${str(page.tabs[0].id)};\nopen${cap(page.tabs[0].id)}();`);
  if (pageTimer.length) sections.push(pageTimer.join("\n"));
  sections.push("render();");
  const ret = [
    `return {`,
    `  el: main,`,
    `  render,`,
    ...(feed ? [`  push(item) {\n    s.${feed.name} = [...s.${feed.name}, ${use("copy")}(item)];\n    render();\n  },`] : []),
    `  dispose() {`,
    ...(pageTimer.length ? [`    clearInterval(timer);`] : []),
    ...(hasTabs ? [`    clearInterval(tabTimer);`] : []),
    `    main.remove();`,
    `  },`,
    `};`,
  ];
  // Imports last: `use` has seen every helper by now.
  const helpers = [...uses].filter((n) => n !== "sync").sort();
  const imports = [];
  if (uses.has("sync")) imports.push(`import { sync } from "../lib";`);
  if (helpers.length) imports.push(`import { ${helpers.join(", ")} } from "../util";`);

  return `${imports.join("\n")}${imports.length ? "\n\n" : ""}// ${page.title}
export function mount(a) {
${indent([...sections.join("\n\n").split("\n"), "", ...ret], "  ").join("\n")}
}
`;
}

function pageHasLinks(page) {
  let found = false;
  const visit = (n) => { if (n.el === "link") found = true; (n.children || []).forEach(visit); };
  page.view.forEach(visit);
  return found;
}

// ---------------------------------------------------------------------------------------------
// The shell

function appFile(spec) {
  const g = spec.initialState.global;
  const feeds = spec.pages.some((p) => p.fields.some((f) => f.feed));
  const pinned = Math.min(4, spec.pages.length);
  return `import { copy, setText } from "./util";
${spec.pages.map((p) => `import { mount as ${p.id} } from "./pages/${p.id}";`).join("\n")}

// The pages: the route, the title and the page's mount function.
const pages = {
${spec.pages.map((p) => `  ${p.id}: [${str(p.title)}, ${p.id}],`).join("\n")}
};

export function start(root) {
  // Global state: read by the shell and the pages, written by pages and by the server.
  const g = ${literal(g, "  ")};
  let route = ${str(spec.pages[0].id)};
  let page;
  let menu;

  const app = document.createElement("div");
  app.dataset.role = "app";
  app.innerHTML = \`<header data-key="shell" data-role="shell"><strong>${escText(spec.app)}</strong><nav data-role="nav">\${Object.entries(pages)
    .slice(0, ${pinned})
    .map(([id, [title]]) => \`<button data-key="\${id}" data-role="navLink">\${title}</button>\`)
    .join("")}<button data-role="menu">All pages</button></nav><p><span data-role="user"></span> · <span data-role="cartCount"></span> · <span data-role="noticeCount"></span></p></header>\`;
  const header = app.firstChild;
  const nav = header.childNodes[1];
  const [user, cartCount, noticeCount] = header.lastChild.children;
  const menuButton = nav.lastChild;

  function renderShell() {
    setText(user, "Signed in as " + g.user);
    setText(cartCount, "Cart: " + g.cart.length);
    setText(noticeCount, g.notices.length + " notices");
  }

  // Repaint after a write to global state.
  function changed() {
    renderShell();
    page.render();
  }

  function toggleMenu() {
    if (menu) {
      menu.remove();
      menu = undefined;
    } else {
      menu = document.createElement("nav");
      menu.dataset.role = "menuList";
      menu.innerHTML = Object.entries(pages)
        .map(([id, [title]]) => \`<button data-key="\${id}" data-role="menuLink">\${title}</button>\`)
        .join("");
      header.after(menu);
    }
    menuButton.setAttribute("aria-expanded", !!menu);
  }

  function go(to) {
    if (menu) toggleMenu();
    if (to === route && page) return;
    if (page) page.dispose();
    route = to;
    page = pages[to][1](a);
    app.append(page.el);
    for (const button of nav.children) {
      if (button.dataset.key === route) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
  }

  const a = { g, go, changed };

  app.addEventListener("click", (e) => {
    switch (e.target.dataset.role) {
      case "navLink":
      case "menuLink":
        return go(e.target.dataset.key);
      case "menu":
        return toggleMenu();
    }
  });

  menuButton.setAttribute("aria-expanded", false);
  renderShell();
  go(route);
  root.append(app);

  return {
    receive(msg) {
      switch (msg.type) {
        case "deepLink":
          return go(msg.route);
        case "serverSet":
          g[msg.field] = msg.value;
          return changed();
        case "notify":
          g.notices = [...g.notices, copy(msg.item)];
          return changed();
        case "pagePush":
          if (msg.page === route && page.push) page.push(msg.item);
          return;
        case "snapshot":
          Object.assign(g, msg.global, { cart: msg.global.cart.map(copy), notices: msg.global.notices.map(copy) });
          return changed();
      }
    },
    stop() {
      page.dispose();
      app.remove();
    },
  };
}
`;
}

// ---------------------------------------------------------------------------------------------

export function emit(spec) {
  for (const p of spec.pages) if (/[<&]/.test(p.title)) throw new Error(`${p.id}: title needs escaping`);
  const files = {
    ...templateFiles({ name: "routed-app", title: "Routed app" }),
    "src/app.js": appFile(spec),
    "src/lib.js": LIB_FILE,
    "src/util.js": UTIL_FILE,
  };
  for (const page of spec.pages) files[`src/pages/${page.id}.js`] = pageFile(spec, page);
  return {
    files,
    style: {
      shell: "src/app.js: global state as one plain object, the route, the nav bar, the menu built on open; go(route) disposes the page and mounts the next, one delegated click listener on the app element",
      pages: "one module per page exporting mount(a) -> { el, render, push, dispose }, written out from its description; state as plain objects in the closure (s page, t tab panel, m modal); nothing interpreted",
      rendering: "one idempotent render() per page that writes every binding from the state (setText/setValue write only what differs); a handler changes the state and calls it, or a.changed() after a write to global state",
      lists: "sync() in src/lib.js (the only generic helper, runtime): keyed by data-key, nodes kept across reorders",
      conditionals: "created and removed after a comment anchor; tab panels and the modal built when selected or opened with fresh state",
      events: "one delegated click, input and change listener per page on its <main>, switching on data-role; number inputs send only integers within range",
      time: "one setInterval per mounted time-driven field, started when its page or tab panel is built, cleared when it is left",
      externalEvents: "receive() in app.js; pagePush reaches only the page shown, through its push; lists replaced never mutated, message items copied",
      build: "Vite, no framework plugin, no module-preload polyfill, hidden source maps",
    },
  };
}
