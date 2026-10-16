// The derived-graph scenario as tea-inline, a prototype strategy (see frameworks/tea-inline/README.md).
//
// The emitter plays the compiler of a TEA app whose `view` shows the values of a graph of formulas.
// It sees the whole graph at build time, so it works out, once, for every cell (an input or a
// formula) who reads it, and writes that into the cell's own code:
//
// - A formula is a node: `const calcTax = node(() => { … })`. It recomputes its value from the
//   cells it reads, stops there when the value is the same as before (the equality cut-off: a
//   list or a group compares its items), and otherwise writes the displays that show it, queues
//   the formulas that read it and collects the displays that read several values. Nobody
//   registers at mount: the reader lists are in the writer's code, resolved at compile time.
// - A display that reads one cell is part of that cell's code (no function, no subscription).
//   A display that reads several is a function `show…` that each of its cells collects.
// - The formulas run once per flush, in dependency order (the graph is a DAG; the queue is sorted
//   by rank, which is the creation order of the nodes), and the collected displays run after
//   them, so no formula sees a stale value and no display sees a half-updated graph. This is
//   compile-time memoization: a derived value read by many bindings is computed once per change.
//   The alternative, recomputing a formula inside each binding that shows it, would compute a hub
//   once per reader and re-sum 2,000 items per reader when `total` is inlined; it also makes
//   every read cost the formula's chain in bytes. Memoization costs one variable and one node
//   per formula instead.
// - Every message (a `case` of the update) is inlined into the action of its control. An input's
//   action is its setter `P.name(x)`: it writes the cell, its control and its displays, queues the
//   formulas that read it and collects its displays. An item's action writes the item in place and
//   queues the formulas that read the field it wrote (`byQty`, `byActive`), or, for a change to the
//   set of items, every formula that reads the items or a field of them (`byItems`).
// - External events stay messages: `receive` applies `serverInputs` (through the setters),
//   `serverItems` and `snapshot` (a whole state, applied like the initial state is: the setters
//   for the inputs, the items replaced and the formulas over them queued).
//
// Style choices (also in `style` below): the whole sheet is one static HTML string parsed once and
// every element is `E[n]`, its place in document order (labels and options left out); cells are
// local variables, formulas are written as expressions over them; formula nodes with an equality
// cut-off and compile-time reader lists; collection helpers take the formula's own code as a
// function (sheet.js); items as in big-table (a row template cloned per row, keyed list, rows
// edited in place).

import { templateFiles } from "../../frameworks/tea-inline/framework.js";

export const framework = "tea-inline";

export const params = {};

const str = JSON.stringify;
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const escText = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const attrValue = (v) => (/^[\w.:-]+$/.test(v) ? v : `"${v.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`);

// Names the generated code uses itself: no cell may share one.
const RESERVED = new Set([
  "s", "E", "P", "L", "R", "x", "n", "e", "it", "item", "old", "row", "tr", "li", "t", "v", "i", "k",
  "load", "make", "root", "board", "start", "receive", "stop", "putInputs", "own", "set", "mk",
  "byItems", "byQty", "byActive", "money", "CATS", "ADJ", "NOUN", "INIT",
  "el", "text", "prop", "on", "schedule", "flush", "cancel", "list", "rows", "tpl",
  "node", "queue", "paint", "same", "reset", "part", "next", "pick", "between", "group", "grp", "cash",
  "sum", "avg", "maxOf", "minOf", "top", "byCat", "typed", "Math", "Number", "Object", "Map", "Set",
  "structuredClone", "String", "document", "window",
]);

// ---------------------------------------------------------------------------------------------
// Formulas, compiled to JavaScript over the cells (each a local variable named like the cell).

function js(e, cats) {
  const a = (k) => js(e[k], cats);
  const all = (from = 1) => e.slice(from).map((x) => js(x, cats));
  switch (e[0]) {
    case "k": return typeof e[1] === "string" ? str(e[1]) : e[1] < 0 ? `(${e[1]})` : String(e[1]);
    case "v": return e[1];
    case "i": return `it.${e[1]}`;
    case "items": return "s.items";
    case "+": return `(${all().join(" + ")})`;
    case "-": return `(${a(1)} - ${a(2)})`;
    case "*": return `(${a(1)} * ${a(2)})`;
    case "div": return `Math.floor(${a(1)} / ${a(2)})`;
    case "pct": return `Math.floor((${a(1)} * ${a(2)}) / 100)`;
    case "min": return `Math.min(${all().join(", ")})`;
    case "max": return `Math.max(${all().join(", ")})`;
    case "abs": return `Math.abs(${a(1)})`;
    case "if": return `(${a(1)} ? ${a(2)} : ${a(3)})`;
    case "<": case "<=": case ">": case ">=": return `(${a(1)} ${e[0]} ${a(2)})`;
    case "==": return `(${a(1)} === ${a(2)})`;
    case "!=": return `(${a(1)} !== ${a(2)})`;
    case "and": return `(${all().join(" && ")})`;
    case "or": return `(${all().join(" || ")})`;
    case "not": return `!${a(1)}`;
    case "count": return `${a(1)}.length`;
    case "sum": case "avg": case "maxOf": case "minOf": return `${e[0]}(${a(1)}, (it) => ${a(2)})`;
    case "filter": return `${a(1)}.filter((it) => ${a(2)})`;
    case "top": return `top(${a(1)}, (it) => ${a(2)}, ${e[3] === "desc" ? -1 : 1}, ${e[4]})`;
    case "groupSum": return `byCat(${a(1)}, (it) => ${a(2)}, CATS)`;
    case "at": return `${a(1)}[${cats.indexOf(e[2])}]`;
  }
  throw new Error(`unknown expression ${JSON.stringify(e)}`);
}

// What an expression reads: cells, the items as a whole, fields of an item.
function reads(e, out = { cells: [], items: false, fields: new Set() }) {
  if (!Array.isArray(e)) return out;
  if (e[0] === "v") { if (!out.cells.includes(e[1])) out.cells.push(e[1]); return out; }
  if (e[0] === "items") out.items = true;
  if (e[0] === "i") out.fields.add(e[1]);
  if (e[0] === "k") return out;
  for (let k = 1; k < e.length; k++) reads(e[k], out);
  return out;
}

// ---------------------------------------------------------------------------------------------

function appFile(spec) {
  const cats = spec.categories;
  const cur = spec.currency;
  const lines = []; // the body of start()
  const out = (...l) => lines.push(...l);

  // ---- The cells, in unit order (inputs before the formula of their unit).
  const cell = new Map();
  const order = [];
  const info = (c) => {
    if (RESERVED.has(c.name)) throw new Error(`cell name ${c.name} is a name the generated code uses`);
    const i = { c, input: c.kind === "input", inl: [], fq: [], mq: [], always: [], calc: `calc${cap(c.name)}` };
    cell.set(c.name, i);
    order.push(i);
    return i;
  };
  for (const u of spec.units) {
    for (const c of u.inputs) info(c);
    info(u.cell);
  }
  const msg = new Map();
  for (const u of spec.units) for (const m of u.messages) msg.set(m.name, m);

  // ---- Values as text.
  const fmtNum = (format, v) => {
    switch (format) {
      case "plain": return v;
      case "grouped": return `grp(${v})`;
      case "currency": return `money(${v})`;
      case "pct": return `${v} + "%"`;
    }
    throw new Error(`unknown format ${format}`);
  };
  // A cell's value `v` as the text a display shows (an expression; parenthesized when it is not
  // an operand: `paren`).
  const fmt = (c, v) => {
    if (c.type === "bool") return `${v} ? ${str(c.words[0])} : ${str(c.words[1])}`;
    if (c.type === "num") return fmtNum(c.format, v);
    return v;
  };
  const operand = (code) => (/^[\w.]+(\[\d+\])?$/.test(code) ? code : `(${code})`);
  const partCode = (p, ident) => {
    if (typeof p === "string") return str(p);
    const c = cell.get(p[1]).c;
    if (p[0] === "count") return `${ident(p[1])}.length`;
    if (p[0] === "at") return operand(fmtNum(c.format, `${ident(p[1])}[${cats.indexOf(p[2])}]`));
    return operand(fmt(c, ident(p[1])));
  };
  const textCode = (parts, ident) => {
    const pieces = parts.map((p) => partCode(p, ident));
    return typeof parts[0] === "string" ? pieces.join(" + ") : `"" + ${pieces.join(" + ")}`;
  };

  // ---- The sheet's markup, and who reads whom. `ix` counts the elements code can refer to (all
  // but labels and options), in document order: E[n].
  let ix = 0;
  let html = "";
  const open = (tag, attrs = {}) => {
    html += `<${tag}${Object.entries(attrs).map(([k, v]) => ` ${k}=${attrValue(String(v))}`).join("")}>`;
    return tag === "label" || tag === "option" ? -1 : ix++;
  };
  const el = (tag, attrs, content = "") => {
    const n = open(tag, attrs);
    html += `${escText(content)}</${tag}>`;
    return n;
  };
  const control = {}; // message name → element index
  const showDefs = [];
  const topLists = [];

  open("section", { "data-key": "sheet", "data-role": "sheet" });
  el("h2", {}, spec.title);

  spec.units.forEach((u, ui) => {
    open("div");
    for (const n of u.view) {
      switch (n.el) {
        case "text": {
          const names = [...new Set(n.parts.filter(Array.isArray).map((p) => p[1]))];
          // A heading with nothing to read is part of the markup.
          const e = el(n.tag, {}, names.length ? "" : n.parts.join(""));
          if (names.length === 0) {
            // static
          } else if (names.length === 1) {
            // One cell: part of that cell's code.
            const c = cell.get(names[0]);
            c.inl.push(`text(E[${e}], ${textCode(n.parts, () => "x")});`);
          } else {
            const name = `show${showDefs.length}`;
            showDefs.push(`const ${name} = () => text(E[${e}], ${textCode(n.parts, (nm) => nm)});`);
            for (const nm of names) cell.get(nm).mq.push(name);
          }
          break;
        }
        case "input": {
          const m = msg.get(n.msg);
          open("label");
          html += escText(n.label);
          control[n.msg] = open("input", { type: "number", "data-role": n.msg });
          html += "</label>";
          cell.get(m.cell).inl.push(`prop(E[${control[n.msg]}], String(x));`);
          break;
        }
        case "button": {
          control[n.msg] = el("button", { "data-role": n.msg }, n.text);
          break;
        }
        case "check": {
          const m = msg.get(n.msg);
          open("label");
          control[n.msg] = open("input", { type: "checkbox", "data-role": n.msg });
          html += `${escText(n.label)}</label>`;
          cell.get(m.cell).inl.push(`prop(E[${control[n.msg]}], x, "checked");`);
          break;
        }
        case "select": {
          const m = msg.get(n.msg);
          const c = cell.get(m.cell).c;
          open("label");
          html += escText(n.label);
          control[n.msg] = open("select", { "data-role": n.msg });
          for (const o of c.options) {
            open("option", { value: o });
            html += escText(o);
          }
          html += "</select></label>";
          cell.get(m.cell).inl.push(`prop(E[${control[n.msg]}], x);`);
          break;
        }
        case "top": {
          const c = cell.get(n.cell);
          const e = el(n.tag, { "data-role": n.cell });
          const key = c.c.expr[2];
          const name = `list${cap(n.cell)}`;
          topLists.push(
            `const ${name} = list(E[${e}], () => ${n.cell}, (item) => {`,
            `  const li = el("li", null, { "data-key": item.id, "data-role": ${str(n.cell + "Item")} });`,
            `  return [li, (it) => text(li, it.name + ": " + ${operand(fmtNum(c.c.format, js(key, cats)))})];`,
            "});");
          c.always.push(name);
          break;
        }
        case "groups": {
          const c = cell.get(n.cell);
          open("ul", { "data-role": n.cell });
          let first = ix;
          for (const cat of cats) {
            open("li", { "data-key": cat, "data-role": `${n.cell}Row` });
            html += "</li>";
          }
          html += "</ul>";
          c.inl.push(`x.forEach((v, i) => text(E[${first} + i], CATS[i] + ": " + ${operand(fmtNum(c.c.format, "v"))}));`);
          break;
        }
        default: throw new Error(`unknown view node ${n.el}`);
      }
    }
    html += "</div>";
  });
  html += "</section>";

  // The items section.
  open("section", { "data-key": "items", "data-role": "items" });
  el("h2", {}, spec.itemsTitle);
  open("div");
  const loadIx = el("button", { "data-role": "load" }, spec.loadText);
  const addIx = el("button", { "data-role": "addItem" }, "Add item");
  open("label");
  html += "Markup %";
  const markupIx = open("input", { type: "number", "data-role": "markup" });
  html += "</label></div>";
  open("table");
  open("thead");
  open("tr");
  for (const h of ["Item", "Category", "Qty", "Price", "Line", "With markup", "Active", "Note", ""]) {
    open("th");
    html += escText(h);
  }
  const bodyIx = open("tbody");

  // ---- Who reads what.
  const byItems = [], byQty = [], byActive = [];
  for (const i of order) {
    if (i.input) continue;
    const r = reads(i.c.expr);
    for (const n of r.cells) cell.get(n).fq.push(i.calc);
    if (r.items || r.fields.size) byItems.push(i.calc);
    if (r.fields.has("qty")) byQty.push(i.calc);
    if (r.fields.has("active")) byActive.push(i.calc);
  }
  const queueOf = (names) => (names.length ? [`queue(${names.join(", ")});`] : []);
  const paintOf = (names) => (names.length ? [`paint(${names.join(", ")});`] : []);

  // ---- The code.
  out(`root.insertAdjacentHTML("beforeend", "<div data-role=page>");`);
  out("const board = root.lastChild;");
  out(`const E = part(board, ${str(html)});`);
  out("const s = { items: [], markup: 0, nextId: 1, rng: 0 };");
  const names = order.map((i) => i.c.name);
  out(names.length ? `let ${names.join(", ")};` : "");

  // The item builder: one draw per random field in order, then the id.
  out("",
    "// The item builder (the PRNG state is the app's): adjective and noun, category, quantity, price, active.",
    "const make = (n) => {",
    "  let r = s.rng;",
    "  const out = [];",
    "  while (n--) {",
    "    out.push({",
    "      id: s.nextId++,",
    "      name: pick((r = next(r)), ADJ) + \" \" + pick((r = next(r)), NOUN),",
    "      category: pick((r = next(r)), CATS),",
    "      qty: between((r = next(r)), 1, 99),",
    "      price: between((r = next(r)), 100, 9999),",
    "      active: (r = next(r)) % 4 !== 0,",
    "      note: \"\",",
    "    });",
    "  }",
    "  s.rng = r;",
    "  return out;",
    "};");

  // The formulas, in unit order (a node's rank is its creation order).
  out("", "// The formulas, in dependency order.");
  spec.units.forEach((u) => {
    const i = cell.get(u.cell.name);
    const c = i.c;
    const l = [`const ${i.calc} = node(() => {`, `  const x = ${js(c.expr, cats)};`];
    if (c.type === "top") {
      l.push(`  const old = ${c.name};`, `  ${c.name} = x;`, `  paint(${i.always.join(", ")});`, "  if (same(x, old)) return;");
    } else {
      const eq = c.type === "list" || c.type === "group" ? `same(x, ${c.name})` : `x === ${c.name}`;
      l.push(`  if (${eq}) return;`, `  ${c.name} = x;`);
    }
    l.push(...i.inl.map((t) => "  " + t), ...queueOf(i.fq).map((t) => "  " + t), ...paintOf(i.mq).map((t) => "  " + t));
    l.push("});");
    // Lists first: the node refers to them.
    out(...l);
  });
  if (showDefs.length) out("", "// Displays of several cells.", ...showDefs);
  if (topLists.length) out("", "// Keyed lists of items.", ...topLists);

  // The inputs' actions.
  const inputs = order.filter((i) => i.input);
  out("", "// The inputs: one action each, by name (the controls call them; so do external events).", "const P = {");
  for (const i of inputs) {
    out(`  ${i.c.name}(x) {`, `    if (x === ${i.c.name}) return;`, `    ${i.c.name} = x;`,
      ...i.inl.map((t) => "    " + t), ...queueOf(i.fq).map((t) => "    " + t), ...paintOf(i.mq).map((t) => "    " + t), "  },");
  }
  out("};", "const putInputs = (values) => {", "  for (const k in values) P[k]?.(values[k]);", "};");

  // The controls call the actions: each message inlined.
  out("");
  for (const u of spec.units) {
    for (const m of u.messages) {
      const c = cell.get(m.cell).c;
      const at = `E[${control[m.name]}]`;
      switch (m.kind) {
        case "input": out(`on(${at}, typed(P.${c.name}, ${c.min}, ${c.max}), "input");`); break;
        case "add":
          out(m.k > 0 ? `on(${at}, () => P.${c.name}(Math.min(${c.max}, ${c.name} + ${m.k})));`
            : `on(${at}, () => P.${c.name}(Math.max(${c.min}, ${c.name} - ${-m.k})));`);
          break;
        case "check": out(`on(${at}, () => P.${c.name}(!${c.name}));`); break;
        case "select": out(`on(${at}, (e) => P.${c.name}(e.target.value), "input");`); break;
        default: throw new Error(`unknown message kind ${m.kind}`);
      }
    }
  }

  // ---- The items.
  const money = (v) => `money(${v})`;
  const rowHtml = "<tr data-role=item><td><td><td><input type=number data-role=qty><td><td><td><td><input type=checkbox data-role=active><td><input type=text data-role=note placeholder=Note><td><button data-role=remove>×";
  out("",
    "// The formulas that read the items, or a field of them.",
    `const byItems = [${byItems.join(", ")}];`,
    `const byQty = [${byQty.join(", ")}];`,
    `const byActive = [${byActive.join(", ")}];`,
    "",
    "// A row: cloned from the template; its binding `set` paints the row's item, `mk` its markup cell.",
    `const row = tpl(${str(rowHtml)});`,
    `const L = rows(E[${bodyIx}], () => s.items, (item) => {`,
    "  const tr = row.cloneNode(true);",
    '  const R = tr.querySelectorAll("*");',
    '  tr.setAttribute("data-key", item.id);',
    "  const own = () => s.items.find((x) => x.id === item.id);",
    `  const mk = () => text(R[6], ${money("Math.floor((item.qty * item.price * (100 + s.markup)) / 100)")});`,
    "  const set = (fresh = item) => {",
    "    item = fresh;",
    "    text(R[0], item.name);",
    "    text(R[1], item.category);",
    "    prop(R[3], String(item.qty));",
    `    text(R[4], ${money("item.price")});`,
    `    text(R[5], ${money("item.qty * item.price")});`,
    '    prop(R[8], item.active, "checked");',
    "    prop(R[10], item.note);",
    "    mk();",
    "  };",
    "  on(R[3], typed((n) => {",
    "    const it = own();",
    "    if (!it) return;",
    "    it.qty = n;",
    "    schedule(set);",
    "    queue(...byQty);",
    "  }, 0, 999), \"input\");",
    "  on(R[8], () => {",
    "    const it = own();",
    "    if (!it) return;",
    "    it.active = !it.active;",
    "    schedule(set);",
    "    queue(...byActive);",
    "  });",
    "  on(R[10], (e) => {",
    "    const it = own();",
    "    if (it) it.note = e.target.value;",
    '  }, "input");',
    "  on(R[12], () => {",
    "    const it = own();",
    "    if (!it) return;",
    "    s.items.splice(s.items.indexOf(it), 1);",
    "    L.drop(item.id);",
    "    queue(...byItems);",
    "  });",
    "  return [tr, set, mk];",
    "});",
    "",
    "// The toolbar.",
    `on(E[${loadIx}], () => {`,
    `  s.items = make(${spec.options.rows});`,
    "  schedule(L);",
    "  queue(...byItems);",
    "});",
    `on(E[${addIx}], () => {`,
    "  const added = make(1);",
    "  s.items.push(...added);",
    "  L.add(added);",
    "  queue(...byItems);",
    "});",
    `on(E[${markupIx}], typed((n) => {`,
    "  s.markup = n;",
    "  for (const it of s.items) schedule(L.get(it.id)?.[2]);",
    "}, 0, 100), \"input\");",
    "",
    "// A whole state, the initial one or a snapshot: the inputs through their actions, the items",
    "// replaced (the rows reconcile by id), the formulas over them queued.",
    "const load = ({ inputs, ...state }) => {",
    "  putInputs(inputs);",
    "  Object.assign(s, state);",
    `  prop(E[${markupIx}], String(s.markup));`,
    "  schedule(L);",
    "  queue(...byItems);",
    "};",
    `load(${str({ inputs: spec.initialState.inputs, markup: spec.initialState.markup, items: [], nextId: 1, rng: spec.rng })});`,
    `s.items = make(${spec.initialItems});`,
    "flush();",
    "",
    "// The external events: they move data (copies of the message's), the same shape for every app.",
    "function receive(msg) {",
    "  switch (msg.type) {",
    '    case "serverInputs":',
    "      putInputs(msg.values);",
    "      break;",
    '    case "serverItems": {',
    "      const up = new Map(structuredClone(msg.upsert).map((it) => [it.id, it]));",
    "      const gone = new Set(msg.remove);",
    "      const known = new Set(s.items.map((it) => it.id));",
    "      s.items = s.items.filter((it) => !gone.has(it.id)).map((it) => up.get(it.id) || it);",
    "      for (const it of up.values()) if (!known.has(it.id) && !gone.has(it.id)) s.items.push(it);",
    "      s.nextId = Math.max(s.nextId, ...msg.upsert.map((it) => it.id + 1));",
    "      schedule(L);",
    "      queue(...byItems);",
    "      break;",
    "    }",
    '    case "snapshot":',
    "      load(structuredClone(msg.state));",
    "      break;",
    "  }",
    "}",
    "",
    "function stop() {",
    "  cancel();",
    "  reset();",
    "  board.remove();",
    "}",
    "",
    "return { receive, stop };");

  // ---- Assemble.
  const body = lines.map((l) => (l ? "  " + l : l)).join("\n");
  const data = [
    `const CATS = ${str(cats)};`,
    `const ADJ = ${str(spec.itemWords.adjectives)};`,
    `const NOUN = ${str(spec.itemWords.nouns)};`,
    `const money = (v) => cash(${str(cur)}, v);`,
  ].join("\n");
  const imports = (from, list) => {
    const have = list.filter((n) => new RegExp(`(^|[^\\w.$])${n}\\(`).test(body + data));
    return have.length ? `import { ${have.join(", ")} } from "${from}";\n` : "";
  };
  return `${imports("./runtime.js", ["el", "text", "prop", "on", "schedule", "flush", "cancel", "list"])}${imports("./rows.js", ["rows", "tpl"])}${imports("./graph.js", ["node", "queue", "paint", "same", "reset", "part"])}${imports("./sheet.js", ["next", "pick", "between", "cash", "grp", "sum", "avg", "maxOf", "minOf", "top", "byCat", "typed"])}
// The sheet's constants: the categories, the item builder's word pools, the currency.
${data}

export function start(root) {
${body}
}
`;
}

export function emit(spec) {
  const files = {
    ...templateFiles({ name: "derived-graph", title: "Derived graph", extra: ["rows.js", "graph.js", "sheet.js"] }),
    "src/app.js": appFile(spec),
  };
  return {
    files,
    style: {
      track: "prototype: no framework implements this strategy",
      components: "no components: the sheet is one static HTML string parsed once, every element is E[n] (its place in document order, labels and options left out); the items are a row template cloned per row",
      messages: "erased for DOM events: each update arm is inlined into the action its control calls (an input's setter P.name, an item's handler in its row)",
      derivedValues: "compile-time memoization: every formula is a node that recomputes its value once per flush, in dependency order (a sorted queue of nodes ranked by creation order), with an equality cut-off (a list or a group compares its items); the readers of a cell are written into the cell's own code, resolved at build time, so nobody registers at mount",
      cutoff: "yes: a formula whose value did not change queues no reader and paints nothing; a top-k list always repaints its keyed list (a field of a listed item may have changed in place) but cuts off its readers",
      displays: "a display that reads one cell is inlined into that cell's code; one that reads several is a function that each of its cells collects and that runs after the formulas",
      itemEdits: "an item edit writes the item in place and queues the formulas that read the field it wrote (by qty, by active) or, for a change to the set of items, every formula that reads the items; no incremental aggregates: each affected formula recomputes over the items",
      lists: "keyed by id: rows.js for the items table (reconcile on a replaced array, add/drop in place), runtime.js list for the top-k lists",
      externalEvents: "receive(msg): serverInputs through the input actions, serverItems and snapshot move copies of the message's data into the state; a snapshot is applied like the initial state",
      build: "Vite with no framework plugin, production defaults, hidden source maps",
    },
  };
}
