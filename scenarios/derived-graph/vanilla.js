// The derived-graph scenario in vanilla JavaScript: the floor. A planning sheet written the way a
// careful person would write it by hand, without a library (see frameworks/vanilla/README.md).
//
// Style (recorded in every generated app's rr.json):
// - State is plain: one `let` per input cell and per formula (the sheet's variables), and a
//   `state` object for the items (`items`, `markup`, `nextId`, `rng`). Items are records edited
//   in place, each carrying its `<tr>`.
// - Each formula is a function `calcX()` that recomputes it from the variables it reads and
//   returns whether its value changed (numbers, bools and texts compare with `===`; lists and
//   group sums are new objects, so they count as changed). Each cell has a `showX()` that writes
//   the display nodes reading it; a node reading several cells is one `textN()` function that
//   every one of them calls. Nothing is interpreted: every expression, display and message
//   handler is that cell's own code.
// - A change recomputes only what it feeds, in dependency order, written out as straight-line
//   code per trigger: `changeX(v)` for an input (the formulas downstream of it), and
//   `itemsChanged()`, `qtyChanged()` and `activeChanged()` for the items (the formulas reading
//   the items, or the quantity, or the active flag, and everything downstream). A formula
//   downstream runs only if one of the formulas it reads changed (`const c4 = calcX()`, then
//   `(c4 || c7) && calcY()`), so an unchanged value stops the wave. A note is read by nothing.
// - Direct DOM operations: the sheet's markup is one static string with the display nodes found
//   by position; text is written with `textContent`; a top-k list is kept by a small keyed-list
//   helper (`src/lib.js`) that moves the `<li>`s it keeps; group rows are static `<li>`s whose text
//   is rewritten. Item rows are cloned from a `<tr>` template; a server change goes through the
//   keyed reconciler (`src/lib.js`), which keeps every `<tr>` whose id stays. Rows from a message
//   are copied before they become records.
// - Events: delegated listeners per section (click, input, change) switching on `data-role`.
//   A number input sends its value only while it holds an integer in range, and a control is
//   written only if it does not already hold the value, so a typed input keeps its caret.
// - `src/util.js` (app code): the PRNG step, formatters and the collection helpers formulas call
//   (`sumBy`, `topBy`, `groupSum`, …) with the formula's own code as the function.

import { templateFiles } from "../../frameworks/vanilla/framework.js";
import {
  cap, esc, escAttr, formatted, jsExpr, partShown, plan, readGraph, rootsOfField, rootsOfInput, rootsOfItems,
  str, topShown, tpl, utilSource,
} from "./shared/graph.js";

export const framework = "vanilla";

export const params = {
  derived: {
    default: "waves",
    choices: ["waves", "recompute"],
    help: "how a change recomputes the formulas: straight-line code per trigger that runs only what the change feeds (waves, the floor in work), or one recompute() that runs every calc in order and re-shows what changed (recompute, the floor in bytes)",
  },
};

const indent = (code, pad) => code.split("\n").map((l) => (l ? pad + l : l)).join("\n");

// ---------------------------------------------------------------------------------------------
// Shared files.

const LIB_FILE = `// Generic keyed-list helpers, independent of the app.

// Make the rows of \`parent\` those of \`list\`, in its order, and return \`list\`. A row whose id
// was already there keeps its <tr> (\`patch(old, row)\` rewrites the cells that changed; a record
// that is the same object needs nothing), a new id gets one from \`create(row)\`, and the <tr>s of
// ids that left are removed.
export function reconcile(parent, rows, list, create, patch) {
  const old = new Map();
  for (const r of rows) old.set(r.id, r);
  for (const r of list) {
    const o = old.get(r.id);
    if (!o) create(r);
    else {
      old.delete(r.id);
      if (o !== r) {
        r.tr = o.tr;
        patch(o, r);
      }
    }
  }
  for (const o of old.values()) o.tr.remove();
  place(parent, list);
  return list;
}

// Put the <tr>s of \`rows\` in that order in \`parent\`, in one forward pass: a row already in
// place stays, any other moves before the first row not yet placed.
function place(parent, rows) {
  let at = parent.firstChild;
  for (const r of rows) {
    if (r.tr === at) at = at.nextSibling;
    else parent.insertBefore(r.tr, at);
  }
}

// Make the children of \`ul\` one <li> per item of \`list\` (keyed by id, with \`text(item)\`), in
// order. An item that was there keeps its <li>; one that left loses it.
export function keyedList(ul, list, text, role) {
  const old = new Map();
  for (const li of ul.children) old.set(li.dataset.key, li);
  let at = ul.firstChild;
  for (const it of list) {
    const key = String(it.id);
    let li = old.get(key);
    if (li) old.delete(key);
    else {
      li = document.createElement("li");
      li.dataset.key = key;
      li.dataset.role = role;
    }
    const t = text(it);
    if (li.textContent !== t) li.textContent = t;
    if (li === at) at = at.nextSibling;
    else ul.insertBefore(li, at);
  }
  for (const li of old.values()) li.remove();
}
`;

// ---------------------------------------------------------------------------------------------
// The sheet.

const unitRef = (n) => `u[${n.unit + 1}]`;
const refName = (prefix, n) => `${prefix}${n.unit}_${n.k}`;

function nodeHTML(g, n) {
  const spec = g.spec;
  switch (n.el) {
    case "text": return `<${n.tag}>${n.parts.every((p) => typeof p === "string") ? esc(n.parts.join("")) : ""}</${n.tag}>`;
    case "input": return `<label>${esc(n.label)}<input type='number' data-role='${escAttr(n.msg)}'></label>`;
    case "button": return `<button data-role='${escAttr(n.msg)}'>${esc(n.text)}</button>`;
    case "check": return `<label><input type='checkbox' data-role='${escAttr(n.msg)}'>${esc(n.label)}</label>`;
    case "select": {
      const c = g.cells.get(g.messages.get(n.msg).cell);
      return `<label>${esc(n.label)}<select data-role='${escAttr(n.msg)}'>${c.options.map((o) => `<option value='${escAttr(o)}'>${esc(o)}</option>`).join("")}</select></label>`;
    }
    case "top": return `<${n.tag} data-role='${escAttr(n.cell)}'></${n.tag}>`;
    case "groups":
      return `<ul data-role='${escAttr(n.cell)}'>${spec.categories.map((c) => `<li data-key='${escAttr(c)}' data-role='${escAttr(n.cell)}Row'></li>`).join("")}</ul>`;
  }
  throw new Error(`unknown view node ${n.el}`);
}

function sheetFile(spec, g, mode) {
  const used = new Set();
  const o = { ref: (name) => name, items: "state.items", used };
  const lib = new Set();
  const lines = [];

  // The display nodes the sheet writes, found by position: text nodes that read a cell, the
  // controls of inputs and the top-k and group lists.
  const refs = [];
  const byUnit = new Map();
  for (const n of g.nodes) {
    const e = n.node;
    const prefix = e.el === "text" && n.reads.length ? "t" : e.el === "top" || e.el === "groups" ? "l" : e.el === "input" || e.el === "check" || e.el === "select" ? "c" : null;
    if (prefix) (byUnit.get(n.unit) ?? byUnit.set(n.unit, []).get(n.unit)).push([n.k, refName(prefix, n)]);
  }
  for (const [unit, list] of byUnit) {
    const slots = [];
    for (const [k, name] of list) slots[k] = name;
    refs.push(`const [${Array.from(slots, (name) => name ?? "").join(", ")}] = u[${unit + 1}].children;`);
  }
  // A control is the <input> or <select> inside its <label>.
  const control = (n) => `${refName("c", n)}.${n.node.el === "check" ? "firstChild" : "lastChild"}`;

  // The text of a text node, as a template literal.
  const textOf = (node) => {
    const body = node.parts.map((p) => {
      if (typeof p === "string") return tpl(p);
      const s = partShown(g, p, o);
      return `\${${s.expr}}${s.suffix}`;
    }).join("");
    return `\`${body}\``;
  };

  // A node reading more than one cell is one function every one of them calls.
  const multi = g.nodes.filter((n) => n.node.el === "text" && n.reads.length > 1);
  const nodeFns = multi.map((n) => `function ${refName("text", n)}() {\n  ${refName("t", n)}.textContent = ${textOf(n.node)};\n}`);

  // show: what writes a cell's display nodes.
  const shows = new Map();
  for (const c of g.cells.values()) {
    const body = [];
    for (const n of g.shown.get(c.name)) {
      const e = n.node;
      if (e.el === "text") body.push(n.reads.length > 1 ? `${refName("text", n)}();` : `${refName("t", n)}.textContent = ${textOf(e)};`);
      else if (e.el === "input") {
        used.add("setValue");
        body.push(`setValue(${control(n)}, ${c.name});`);
      }
      else if (e.el === "check") body.push(`${control(n)}.checked = ${c.name};`);
      else if (e.el === "select") body.push(`${control(n)}.value = ${c.name};`);
      else if (e.el === "top") {
        lib.add("keyedList");
        const t = topShown(c, o);
        body.push(`keyedList(${refName("l", n)}, ${c.name}, (it) => \`\${it.name}: \${${t.expr}}${t.suffix}\`, ${str(c.name + "Item")});`);
      } else if (e.el === "groups") {
        used.add("CATEGORIES");
        const t = formatted(c.format, `${c.name}[category]`, used);
        body.push(`let row = 0;\nfor (const category of CATEGORIES) ${refName("l", n)}.children[row++].textContent = \`\${category}: \${${t.expr}}${t.suffix}\`;`);
      }
    }
    if (body.length) shows.set(c.name, `function show${cap(c.name)}() {\n${indent(body.join("\n"), "  ")}\n}`);
  }

  // calc: one function per formula.
  const calcs = g.formulas.map((f) => {
    const expr = jsExpr(f.expr, o);
    if (f.type === "num" || f.type === "bool" || f.type === "text") {
      return `function calc${cap(f.name)}() {\n  const v = ${expr};\n  if (v === ${f.name}) return false;\n  ${f.name} = v;\n  return true;\n}`;
    }
    return `function calc${cap(f.name)}() {\n  ${f.name} = ${expr};\n  return true;\n}`;
  });

  // A trigger's straight-line recomputation.
  const flag = (name) => `c${g.index.get(name)}`;
  const wave = (roots) => {
    if (mode === "recompute") return ["recompute();"];
    const out = [];
    for (const s of plan(g, roots)) {
      const cond = s.parents ? (s.parents.length === 1 ? flag(s.parents[0]) : `(${s.parents.map(flag).join(" || ")})`) : null;
      const call = `${cond ? cond + " && " : ""}calc${cap(s.name)}()`;
      const show = shows.has(s.name) ? `show${cap(s.name)}();` : null;
      if (s.hasChildren) {
        out.push(`const ${flag(s.name)} = ${call};`);
        if (show) out.push(`if (${flag(s.name)}) ${show}`);
      } else out.push(show ? `if (${call}) ${show}` : `${call};`);
    }
    return out;
  };

  // The inputs: their variables, the function that changes one and the messages their controls send.
  const clicks = [], inputsCases = [], changes = [];
  const changeFns = g.inputs.map((c) => {
    // A value the input already holds still re-asserts its controls: an invalid text typed into
    // a number input is replaced by the value, as the reference render does.
    const controls = g.shown.get(c.name).filter((n) => n.node.el === "input" || n.node.el === "check" || n.node.el === "select");
    const assert = controls.map((n) => (n.node.el === "input" ? `setValue(${control(n)}, ${c.name});` : n.node.el === "check" ? `${control(n)}.checked = ${c.name};` : `${control(n)}.value = ${c.name};`));
    const body = [`if (v === ${c.name}) {`, ...assert.map((l) => "  " + l), "  return;", "}", `${c.name} = v;`];
    if (shows.has(c.name)) body.push(`show${cap(c.name)}();`);
    body.push(...wave(rootsOfInput(g, c.name)));
    return `function change${cap(c.name)}(v) {\n${indent(body.join("\n"), "  ")}\n}`;
  });
  for (const m of g.messages.values()) {
    const c = g.cells.get(m.cell), C = `change${cap(c.name)}`;
    if (m.kind === "add") clicks.push(`case ${str(m.name)}:\n  ${C}(clamp(${c.name} ${m.k < 0 ? "-" : "+"} ${Math.abs(m.k)}, ${c.min}, ${c.max}));\n  break;`);
    else if (m.kind === "input") inputsCases.push(`case ${str(m.name)}:\n  if (isInt(el.value, ${c.min}, ${c.max})) ${C}(+el.value);\n  break;`);
    else if (m.kind === "check") changes.push(`case ${str(m.name)}:\n  ${C}(el.checked);\n  break;`);
    else changes.push(`case ${str(m.name)}:\n  ${C}(el.value);\n  break;`);
  }
  if (clicks.length) used.add("clamp");
  if (inputsCases.length) used.add("isInt");
  const listener = (name, cases) =>
    `function ${name}(e) {\n  const el = e.target;\n  switch (el.dataset.role) {\n${indent(cases.join("\n"), "    ")}\n  }\n}`;
  const handlers = [
    ["onClick", "click", clicks],
    ["onInput", "input", inputsCases],
    ["onChange", "change", changes],
  ].filter(([, , cases]) => cases.length);

  // The items' triggers.
  const triggers = [
    ["itemsChanged", rootsOfItems(g)],
    ["qtyChanged", rootsOfField(g, "qty")],
    ["activeChanged", rootsOfField(g, "active")],
  ].map(([name, roots]) => ({ name, steps: wave(roots) }));
  // recompute: one function for every trigger, every calc in order, each re-shown if it changed.
  const recomputeFn = `function recompute() {\n${indent(g.formulas.map((f) => (shows.has(f.name) ? `if (calc${cap(f.name)}()) show${cap(f.name)}();` : `calc${cap(f.name)}();`)).join("\n"), "  ")}\n}`;
  const triggerFns = mode === "recompute" ? [recomputeFn] : triggers.filter((t) => t.steps.length).map((t) => `function ${t.name}() {\n${indent(t.steps.join("\n"), "  ")}\n}`);

  // Variables.
  const initial = (c) => (c.type === "bool" ? String(spec.initialState.inputs[c.name]) : str(spec.initialState.inputs[c.name]));
  const inputVars = g.inputs.map((c) => `let ${c.name} = ${initial(c)};`);
  const formulaVars = [];
  let row = "let ";
  const names = g.formulas.map((f) => f.name);
  names.forEach((name, i) => {
    const piece = name + (i === names.length - 1 ? ";" : ", ");
    if ((row + piece).length > 100) {
      formulaVars.push(row.trimEnd());
      row = "    ";
    }
    row += piece;
  });
  formulaVars.push(row);

  // Everything, in order, for the first render and a snapshot.
  const refreshBody = [
    ...g.formulas.map((f) => `calc${cap(f.name)}();`),
    ...[...g.cells.keys()].filter((n) => shows.has(n)).sort((a, b) => cellOrder(g, a) - cellOrder(g, b)).map((n) => `show${cap(n)}();`),
  ];

  const body = [
    `export function sheet(page, state) {`,
    `  page.insertAdjacentHTML("beforeend", SHEET);`,
    `  const section = page.lastChild, u = section.children;`,
    indent(refs.join("\n"), "  "),
    ``,
    indent(inputVars.join("\n"), "  "),
    indent(formulaVars.join("\n"), "  "),
    ``,
    indent([...calcs, ...nodeFns, ...[...shows.values()], ...changeFns].join("\n\n"), "  "),
    ``,
    ...(triggerFns.length ? [indent(triggerFns.join("\n\n"), "  "), ``] : []),
    `  function refresh() {`,
    indent(refreshBody.join("\n"), "    "),
    `  }`,
    ``,
    `  // A snapshot's inputs, taken without recomputing; refresh() follows.`,
    `  function restore(values) {`,
    indent(g.inputs.map((c) => `${c.name} = values.${c.name};`).join("\n"), "    "),
    `  }`,
    ``,
    `  const setters = { ${g.inputs.map((c) => `${c.name}: change${cap(c.name)}`).join(", ")} };`,
    ``,
    `  // The inputs an external event names, each through its own change.`,
    `  function setInputs(values) {`,
    `    for (const name in values) setters[name]?.(values[name]);`,
    `  }`,
    ``,
    ...handlers.map(([name, , cases]) => `${indent(listener(name, cases), "  ")}\n`),
    ...handlers.map(([name, event]) => `  section.addEventListener("${event}", ${name});`),
    ``,
    `  function stop() {`,
    ...handlers.map(([name, event]) => `    section.removeEventListener("${event}", ${name});`),
    `  }`,
    ``,
    `  return { refresh, restore, setInputs, ${mode === "recompute" ? "itemsChanged: recompute, qtyChanged: recompute, activeChanged: recompute" : triggers.filter((t) => t.steps.length).map((t) => t.name).join(", ")}, stop };`,
    `}`,
  ].join("\n").replace(/\n{3,}/g, "\n\n");

  const html = spec.units.map((u) => `  "<div>${u.view.map((n) => nodeHTML(g, n)).join("")}</div>"`).join(" +\n");
  const head = `"<section data-key='sheet' data-role='sheet'><h2>${esc(spec.title)}</h2>" +\n${html} +\n  "</section>"`;
  const utilNames = [...used].sort();
  return `// The sheet: ${spec.units.length} formulas over ${g.inputs.length} inputs.
import { ${lib.size ? [...lib].join(", ") : ""} } from "./lib.js";
import { ${utilNames.join(", ")} } from "./util.js";

const SHEET = ${head};

${body}
`.replace('import {  } from "./lib.js";\n', "");
}

function cellOrder(g, name) {
  const c = g.cells.get(name);
  return c.kind === "input" ? -1 : g.index.get(name);
}

// ---------------------------------------------------------------------------------------------
// The items section.

function itemsFile(spec, g, hooks) {
  const section = `<section data-key='items' data-role='items'><h2>${esc(spec.itemsTitle)}</h2><div>` +
    `<button data-role='load'>${esc(spec.loadText)}</button><button data-role='addItem'>Add item</button>` +
    `<label>Markup %<input type='number' data-role='markup'></label></div><table><thead><tr>` +
    ["Item", "Category", "Qty", "Price", "Line", "With markup", "Active", "Note", ""].map((h) => `<th>${esc(h)}</th>`).join("") +
    `</tr></thead><tbody></tbody></table></section>`;
  const row = "<td></td><td></td><td><input type='number' data-role='qty'></td><td></td><td></td><td></td>" +
    "<td><input type='checkbox' data-role='active'></td><td><input type='text' data-role='note' placeholder='Note'></td>" +
    "<td><button data-role='remove'>×</button></td>";
  const initial = spec.initialState.items.map((it) => `  { id: ${it.id}, name: ${str(it.name)}, category: ${str(it.category)}, qty: ${it.qty}, price: ${it.price}, active: ${it.active}, note: ${str(it.note)} },`);
  const sheetCall = (name) => (hooks[name] ? `sheet.${name}();` : null);
  const lines = (...ls) => ls.filter(Boolean);
  const qtyCalls = lines(sheetCall("qtyChanged"));
  const activeCalls = lines(sheetCall("activeChanged"));
  const itemsCalls = lines(sheetCall("itemsChanged"));
  return `// The items: a table of rows, each a record carrying its <tr>.
import { reconcile } from "./lib.js";
import { isInt, makeItems, money, setValue } from "./util.js";

const SECTION = ${str(section)};

const INITIAL = [
${initial.join("\n")}
];

const rowTemplate = document.createElement("tr");
rowTemplate.dataset.role = "item";
rowTemplate.innerHTML = ${str(row)};

export function items(page, state, sheet) {
  page.insertAdjacentHTML("beforeend", SECTION);
  const section = page.lastChild, tbody = section.lastChild.lastChild;
  const markupInput = section.querySelector("[data-role=markup]");

  // The record of the row a control is in.
  function find(el) {
    const id = +el.closest("tr").dataset.key;
    return state.items.find((it) => it.id === id);
  }

  const writeLine = (it) => {
    it.tr.children[4].textContent = money(it.qty * it.price);
  };
  const writeMarkup = (it) => {
    it.tr.children[5].textContent = money(Math.floor((it.qty * it.price * (100 + state.markup)) / 100));
  };

  function createRow(it) {
    const tr = rowTemplate.cloneNode(true), c = tr.children;
    tr.dataset.key = it.id;
    c[0].textContent = it.name;
    c[1].textContent = it.category;
    c[2].firstChild.value = it.qty;
    c[3].textContent = money(it.price);
    c[6].firstChild.checked = it.active;
    c[7].firstChild.value = it.note;
    it.tr = tr;
    writeLine(it);
    writeMarkup(it);
  }

  // A server row \`r\` replacing the record \`o\` with the same id (its <tr> is already r.tr).
  function patch(o, r) {
    const c = r.tr.children;
    if (o.name !== r.name) c[0].textContent = r.name;
    if (o.category !== r.category) c[1].textContent = r.category;
    // A control is re-asserted even if the record did not change: a typed text that was never sent
    // is replaced by the value, as the reference render does.
    setValue(c[2].firstChild, r.qty);
    if (o.price !== r.price) c[3].textContent = money(r.price);
    c[6].firstChild.checked = r.active;
    setValue(c[7].firstChild, r.note);
    if (o.qty !== r.qty || o.price !== r.price) {
      writeLine(r);
      writeMarkup(r);
    }
  }

  // The items become \`list\`, keeping the <tr>s of the ids that stay.
  function replace(list) {
    state.items = reconcile(tbody, state.items, list, createRow, patch);
  }

  // \`count\` new items from the app's generator.
  function build(count) {
    const made = makeItems(state.rng, state.nextId, count);
    state.rng = made.rng;
    state.nextId = made.nextId;
    return made.items;
  }

  function onClick(e) {
    const el = e.target;
    switch (el.dataset.role) {
      case "load":
        replace(build(${spec.options.rows}));
${indent(itemsCalls.join("\n"), "        ")}${itemsCalls.length ? "\n" : ""}        break;
      case "addItem":
        replace(state.items.concat(build(1)));
${indent(itemsCalls.join("\n"), "        ")}${itemsCalls.length ? "\n" : ""}        break;
      case "remove": {
        const it = find(el);
        if (it) {
          state.items = state.items.filter((x) => x !== it);
          it.tr.remove();
${indent(itemsCalls.join("\n"), "          ")}${itemsCalls.length ? "\n" : ""}        }
        break;
      }
    }
  }

  function onInput(e) {
    const el = e.target;
    switch (el.dataset.role) {
      case "qty": {
        const it = isInt(el.value, 0, 999) && find(el);
        if (it) {
          it.qty = +el.value;
          writeLine(it);
          writeMarkup(it);
${indent(qtyCalls.join("\n"), "          ")}${qtyCalls.length ? "\n" : ""}        }
        break;
      }
      case "note": {
        const it = find(el);
        if (it) it.note = el.value;
        break;
      }
      case "markup":
        if (isInt(el.value, 0, 100)) {
          state.markup = +el.value;
          state.items.forEach(writeMarkup);
        }
        break;
    }
  }

  function onChange(e) {
    const el = e.target;
    if (el.dataset.role === "active") {
      const it = find(el);
      if (it) {
        it.active = el.checked;
${indent(activeCalls.join("\n"), "        ")}${activeCalls.length ? "\n" : ""}      }
    }
  }

  // The server's changes: listed ids replaced in place, new ids appended, listed ids removed.
  function receive(msg) {
    const gone = new Set(msg.remove);
    const byId = new Map(msg.upsert.map((r) => [r.id, r]));
    const known = new Set(state.items.map((it) => it.id));
    const list = state.items.filter((it) => !gone.has(it.id)).map((it) => (byId.has(it.id) ? { ...byId.get(it.id) } : it));
    for (const r of msg.upsert) {
      if (!known.has(r.id) && !gone.has(r.id)) list.push({ ...r });
      state.nextId = Math.max(state.nextId, r.id + 1);
    }
    replace(list);
${indent(itemsCalls.join("\n"), "    ")}${itemsCalls.length ? "\n" : ""}  }

  // A snapshot's items, markup and generator state.
  function restore(snapshot) {
    state.markup = snapshot.markup;
    state.nextId = snapshot.nextId;
    state.rng = snapshot.rng;
    setValue(markupInput, state.markup);
    replace(snapshot.items.map((it) => ({ ...it })));
    state.items.forEach(writeMarkup);
  }

  state.nextId = ${spec.initialState.nextId};
  state.rng = ${spec.initialState.rng};
  setValue(markupInput, state.markup);
  replace(INITIAL.map((it) => ({ ...it })));
  section.addEventListener("click", onClick);
  section.addEventListener("input", onInput);
  section.addEventListener("change", onChange);

  function stop() {
    section.removeEventListener("click", onClick);
    section.removeEventListener("input", onInput);
    section.removeEventListener("change", onChange);
  }

  return { receive, restore, stop };
}
`;
}

// ---------------------------------------------------------------------------------------------
// The app.

function appFile(spec) {
  return `import { sheet } from "./sheet.js";
import { items } from "./items.js";

// Render the sheet and the items into a new page, then put the page in \`root\`.
export function start(root) {
  const page = document.createElement("div");
  page.dataset.role = "page";
  const state = { items: [], markup: ${spec.markup.initial}, nextId: 1, rng: 1 };
  const s = sheet(page, state);
  const i = items(page, state, s);
  root.appendChild(page);
  s.refresh();

  // An external event.
  function receive(msg) {
    switch (msg.type) {
      case "serverInputs":
        s.setInputs(msg.values);
        break;
      case "serverItems":
        i.receive(msg);
        break;
      case "snapshot":
        i.restore(msg.state);
        s.restore(msg.state.inputs);
        s.refresh();
        break;
    }
  }

  function stop() {
    s.stop();
    i.stop();
    page.remove();
  }

  return { receive, stop };
}
`;
}

const UTIL_EXTRA = `
// Write a control's value only if it does not hold it already, so a typed input keeps its caret.
export const setValue = (el, v) => {
  if (el.value !== String(v)) el.value = v;
};
`;

export function emit(spec, options = {}) {
  const mode = options.derived ?? "waves";
  const g = readGraph(spec);
  const hooks = {
    itemsChanged: mode === "recompute" || rootsOfItems(g).length > 0,
    qtyChanged: mode === "recompute" || rootsOfField(g, "qty").length > 0,
    activeChanged: mode === "recompute" || rootsOfField(g, "active").length > 0,
  };
  const files = {
    ...templateFiles({ name: "derived-graph", title: spec.title }),
    "src/app.js": appFile(spec),
    "src/sheet.js": sheetFile(spec, g, mode),
    "src/items.js": itemsFile(spec, g, hooks),
    "src/lib.js": LIB_FILE,
    "src/util.js": utilSource(spec) + UTIL_EXTRA,
  };
  return {
    files,
    style: {
      model: "hand-written style: plain let variables for the inputs and formulas, a state object for the items, records edited in place",
      formulas: "one calcX() per formula, its own expression as JavaScript, returning whether the value changed (=== for numbers, bools and texts; lists and group sums always count as changed)",
      derived: options.derived === "recompute"
        ? "recompute: every trigger calls one recompute() that runs every calcX() in order and re-shows what changed (the floor in bytes; work grows with N)"
        : "waves: a change recomputes what it feeds, in dependency order, as straight-line code per trigger (changeX per input; itemsChanged, qtyChanged, activeChanged for the items); a formula downstream runs only if a formula it reads changed (the floor in work)",
      displays: "one showX() per cell writing the text nodes that read it (textContent); a node reading several cells is a function every one of them calls; found by position in a static markup string",
      lists: "top-k lists through a generic keyed-list helper (src/lib.js, runtime) that keeps the <li> of an item that stays; group rows are static <li>s",
      items: "rows cloned from a <tr> template, records carrying their <tr>; server items and snapshots through the generic keyed reconciler (src/lib.js, runtime), fed copies of the message's items",
      events: "delegated click, input and change listeners per section, switching on data-role; a number input sends only while valid; controls written only when they differ",
      helpers: "src/util.js (app code): PRNG step, formatters, sumBy/avgBy/maxBy/minBy/topBy/groupSum taking the formula's own code as a function",
      build: "Vite with no framework plugin, production defaults, hidden source maps",
    },
  };
}
