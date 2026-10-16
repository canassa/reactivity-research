// derived-graph as tea-local, a prototype strategy (frameworks/tea-local/README.md): what an ideal
// compiler would emit from a TEA source of a planning sheet (N formulas over inputs and a table of
// items), with local message routing.
//
// The strategy is kept as it is written for the other scenarios; the structure follows the
// sheet's own units, never a chunk size:
//
// - A cell is a component instance that owns its model. Each input is one (its model is its
//   value; an event on its control sends it a real message), each formula is one (its model is
//   its last value, a cache the compiler chose to keep so that a value read by many bindings is
//   computed once), and the items section is one (`{ items, markup, nextId, rng }`).
// - A formula is a reader. It watches the cells its expression reads; when one of them changes it
//   is sent its one message, whose arm recomputes the value from the sources' current models. A
//   value that did not change (`===`, or the same items for a list) tells nobody: its own binding
//   list and its readers do not run. That is the cut-off.
// - A unit's displays are the binding list of its formula's instance (the unit's view). The list
//   re-runs whole, skipping every write that changes nothing, when its formula changes or when
//   any cell its displays read changes. Which cells those are is written by the compiler from
//   the displays' reads, as a summary's sources are in the dashboards. An input's control is the
//   binding list of the input's own instance.
// - The jobs of one flush run in rank order (graph.js): a cell made later is run later, so each
//   formula is recomputed once after the cells it reads, whatever the shape of the graph.
// - Messages the formulas do not read (a note, the markup) are `quiet` arms of the items
//   instance: its rows are patched, its readers are not told. Without that every keystroke in a
//   note would recompute every formula over the items (see the README).
// - Formulas are code: each expression is compiled into its arm (`Math.floor(a * b / 100)`);
//   generic collection helpers (`sum`, `top`, `groupSum`) take the formula's own function.
// - External events: `serverInputs` sets the named inputs (`inputs.name.set`), `serverItems` is a
//   message of the items instance, `snapshot` sets every input and the items instance. The
//   formulas follow by themselves.
// - Rows are not instances (the big-table decision): plain objects and `<tr>` nodes, a keyed
//   list, one delegated listener per event type on the table body.

import { templateFiles, runtimeFile } from "../../frameworks/tea-local/framework.js";

export const framework = "tea-local";

export const params = {};

const q = JSON.stringify;
const esc = (s) => String(s).replace(/[&<]/g, (c) => (c === "&" ? "&amp;" : "&lt;"));
const attr = (v) => (/^[^\s"'=<>`]+$/.test(v) ? v : `"${String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`);
const attrs = (a) => Object.entries(a).map(([k, v]) => ` ${k}=${attr(v)}`).join("");
const trim = (html) => html.replace(/(<\/\w+>)+$/, "");
const tpl = (s) => s.replace(/[`\\]|\$\{/g, (c) => "\\" + c);
const indent = (s, n = 2) => s.replace(/^(?=.)/gm, " ".repeat(n));
const v$ = (name) => `$${name}`; // a cell's variable

// ---------------------------------------------------------------------------------------------
// Shared helpers (src/sheet/frame.js). Generic: nothing in them knows a formula.

function frameFile(spec) {
  return `// Helpers every sheet shares: the app's PRNG step, collection helpers that take the formula's own
// function, the number formats and the reducer steps of the items.

// The PRNG (a Park-Miller generator whose state the items model keeps).
export const next = (s) => (s * 48271) % 2147483647;

export const sum = (list, f) => list.reduce((s, it) => s + f(it), 0);
export const avg = (list, f) => (list.length ? Math.floor(sum(list, f) / list.length) : 0);
export const maxOf = (list, f) => (list.length ? list.reduce((m, it) => Math.max(m, f(it)), -Infinity) : 0);
export const minOf = (list, f) => (list.length ? list.reduce((m, it) => Math.min(m, f(it)), Infinity) : 0);

// The first k items by f (ties by id), in order.
export const top = (list, f, desc, k) =>
  list.map((it) => [f(it), it]).sort((a, b) => (a[0] - b[0]) * (desc ? -1 : 1) || a[1].id - b[1].id).slice(0, k).map((p) => p[1]);

// The sum of f over the items of each category, in the order of \`cats\`.
export const groupSum = (cats, list, f) => cats.map((c) => sum(list.filter((it) => it.category === c), f));

// The old array when the new one holds the same items: a list that did not change tells nobody.
export const keep = (m, v) => (m && m.length === v.length && v.every((x, i) => x === m[i]) ? m : v);

export const group = (n) => String(n).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ",");
export const grouped = (v) => (v < 0 ? "-" : "") + group(Math.abs(v));
export const money = (v) => {
  const a = Math.abs(v);
  return \`\${v < 0 ? "-" : ""}${spec.currency}\${group(Math.floor(a / 100))}.\${String(a % 100).padStart(2, "0")}\`;
};

// The items model with one item changed (found by its key; every other item object is kept).
export function edit(m, id, change) {
  const i = m.items.findIndex((it) => it.id === id);
  const it = i < 0 ? undefined : change(m.items[i]);
  if (!it || it === m.items[i]) return m;
  const items = m.items.slice();
  items[i] = it;
  return { ...m, items };
}

// The message of the server: items with a listed id are replaced in place, new ids appended in
// order, listed ids removed.
export function serverItems(m, { upsert, remove }) {
  const byId = new Map(upsert.map((it) => [it.id, it]));
  const gone = new Set(remove);
  const known = new Set(m.items.map((it) => it.id));
  const items = m.items.filter((it) => !gone.has(it.id)).map((it) => byId.get(it.id) || it);
  for (const it of upsert) if (!known.has(it.id) && !gone.has(it.id)) items.push(it);
  return { ...m, items, nextId: Math.max(m.nextId, ...upsert.map((it) => it.id + 1)) };
}
`;
}

// ---------------------------------------------------------------------------------------------
// Formulas → JavaScript, with the precedence of each operator so that parentheses appear only
// where they are needed. `min` is the lowest precedence the context accepts.

const PREC = { "||": 2, "&&": 3, "==": 4, "!=": 4, "<": 5, "<=": 5, ">": 5, ">=": 5, "+": 6, "-": 6, "*": 7 };
const CMP = { "==": "===", "!=": "!==" };

class Emit {
  constructor(spec, cells) {
    this.spec = spec;
    this.cells = cells;
  }

  ex(e, min = 0) {
    const [s, p] = this.raw(e);
    return p < min ? `(${s})` : s;
  }

  list(e) {
    return this.ex(e, 9);
  }

  raw(e) {
    const ex = (x, m) => this.ex(x, m);
    switch (e[0]) {
      case "k": return [q(e[1]), typeof e[1] === "number" && e[1] < 0 ? 8 : 9];
      case "v": return [`${v$(e[1])}.m`, 9];
      case "i": return [`it.${e[1]}`, 9];
      case "items": return ["$items.m.items", 9];
      case "+": return [e.slice(1).map((x, i) => ex(x, i ? 7 : 6)).join(" + "), 6];
      case "-": return [`${ex(e[1], 6)} - ${ex(e[2], 7)}`, 6];
      case "*": return [`${ex(e[1], 7)} * ${ex(e[2], 8)}`, 7];
      case "div": return [`Math.floor(${ex(e[1], 7)} / ${ex(e[2], 8)})`, 9];
      case "pct": return [`Math.floor(${ex(e[1], 7)} * ${ex(e[2], 8)} / 100)`, 9];
      case "min": case "max": return [`Math.${e[0]}(${e.slice(1).map((x) => ex(x)).join(", ")})`, 9];
      case "abs": return [`Math.abs(${ex(e[1])})`, 9];
      case "if": return [`${ex(e[1], 2)} ? ${ex(e[2], 1)} : ${ex(e[3], 1)}`, 1];
      case "<": case "<=": case ">": case ">=": return [`${ex(e[1], 6)} ${e[0]} ${ex(e[2], 6)}`, 5];
      case "==": case "!=": return [`${ex(e[1], 5)} ${CMP[e[0]]} ${ex(e[2], 5)}`, 4];
      case "and": return [e.slice(1).map((x) => ex(x, 3)).join(" && "), 3];
      case "or": return [e.slice(1).map((x) => ex(x, 2)).join(" || "), 2];
      case "not": return [`!${ex(e[1], 8)}`, 8];
      case "count": return [`${this.list(e[1])}.length`, 9];
      case "sum": case "avg": case "maxOf": case "minOf":
        return [`${e[0]}(${ex(e[1])}, (it) => ${ex(e[2])})`, 9];
      case "filter": return [`${this.list(e[1])}.filter((it) => ${ex(e[2])})`, 9];
      case "top": return [`top(${ex(e[1])}, (it) => ${ex(e[2])}, ${e[3] === "desc"}, ${e[4]})`, 9];
      case "groupSum": return [`groupSum(categories, ${ex(e[1])}, (it) => ${ex(e[2])})`, 9];
      case "at": return [`${this.list(e[1])}[${this.spec.categories.indexOf(e[2])}]`, 9];
    }
    throw new Error(`unknown expression ${q(e)}`);
  }

  // One read of a display: its piece of a template literal, and (when the read is a whole text by
  // itself) the expression alone.
  read(part) {
    const c = this.cells.get(part[1]);
    const m = `${v$(c.name)}.m`;
    if (part[0] === "count") return { lit: `\${${m}.length}`, alone: `${m}.length` };
    const value = part[0] === "at" ? `${m}[${this.spec.categories.indexOf(part[2])}]` : m;
    if (part[0] === "v" && c.type === "bool") {
      const words = `${value} ? ${q(c.words[0])} : ${q(c.words[1])}`;
      return { lit: `\${${words}}`, alone: words };
    }
    if (part[0] === "v" && (c.type === "text" || c.type === "enum")) return { lit: `\${${value}}`, alone: value };
    switch (c.format) {
      case "plain": return { lit: `\${${value}}`, alone: value };
      case "grouped": return { lit: `\${grouped(${value})}`, alone: `grouped(${value})` };
      case "currency": return { lit: `\${money(${value})}`, alone: `money(${value})` };
      case "pct": return { lit: `\${${value}}%`, alone: null };
    }
    throw new Error(`unknown format ${c.format}`);
  }

  // The text of a display: a string literal, a lone expression, or a template literal.
  text(parts) {
    if (parts.every((x) => typeof x === "string")) return q(parts.join(""));
    if (parts.length === 1) {
      const r = this.read(parts[0]);
      if (r.alone) return r.alone;
    }
    return `\`${parts.map((x) => (typeof x === "string" ? tpl(x) : this.read(x).lit)).join("")}\``;
  }
}

// The cells a display or an expression reads.
function reads(e, out = new Set()) {
  if (!Array.isArray(e)) return out;
  if (e[0] === "v") out.add(e[1]);
  else if (e[0] !== "k" && e[0] !== "i") for (let k = 1; k < e.length; k++) reads(e[k], out);
  return out;
}
const readsItems = (e) => Array.isArray(e) && (e[0] === "items" || e.slice(1).some(readsItems));
const partReads = (parts) => parts.filter((p) => Array.isArray(p)).map((p) => p[1]);

// ---------------------------------------------------------------------------------------------
// One unit: its input (if any), its formula and its displays.

function unitBlock(spec, cx, u) {
  const cells = cx.cells;
  const out = new Emit(spec, cells);
  const f = u.cell;
  const input = u.inputs[0] ?? null;
  if (u.inputs.length > 1) throw new Error(`unit ${u.index}: more than one input`);

  // The template, element by element in document order (`e[i]`), the controls in the order of
  // their messages, and the bindings of the controls (the input's) and of the displays (the
  // formula's).
  let html = "<div>";
  let index = 1;
  const open = (tag, a = {}) => {
    html += `<${tag}${attrs(a)}>`;
    return `e[${index++}]`;
  };
  const close = (tag) => (html += `</${tag}>`);
  const controls = []; // the messages, by tag
  const ctl = []; // the input's binding list
  const view = []; // the formula's binding list
  const shown = new Set();
  const lists = [];

  const control = (name) => {
    const m = u.messages.find((x) => x.name === name);
    if (!m) throw new Error(`unit ${u.index}: no message ${name}`);
    controls.push(m);
  };

  for (const n of u.view) {
    switch (n.el) {
      case "text": {
        const v = open(n.tag);
        const dynamic = n.parts.some((p) => typeof p !== "string");
        if (!dynamic) html += esc(n.parts.join(""));
        else {
          html += " ";
          view.push(`setText(${v}, ${out.text(n.parts)});`);
          for (const r of partReads(n.parts)) shown.add(r);
        }
        close(n.tag);
        break;
      }
      case "input": {
        open("label");
        html += esc(n.label);
        const v = open("input", { type: "number", "data-role": n.msg });
        close("label");
        control(n.msg);
        ctl.push(`setProp(${v}, "valueAsNumber", ${v$(input.name)}.m);`);
        break;
      }
      case "button": {
        open("button", { "data-role": n.msg });
        html += esc(n.text);
        close("button");
        control(n.msg);
        break;
      }
      case "check": {
        open("label");
        const v = open("input", { type: "checkbox", "data-role": n.msg });
        html += esc(n.label);
        close("label");
        control(n.msg);
        ctl.push(`setProp(${v}, "checked", ${v$(input.name)}.m);`);
        break;
      }
      case "select": {
        open("label");
        html += esc(n.label);
        const v = open("select", { "data-role": n.msg });
        for (const o of input.options) {
          open("option", { value: o });
          html += esc(o);
          close("option");
        }
        close("select");
        close("label");
        control(n.msg);
        ctl.push(`setProp(${v}, "value", ${v$(input.name)}.m);`);
        break;
      }
      case "top": {
        const c = cells.get(n.cell);
        const ul = open(n.tag, { "data-role": c.name });
        close(n.tag);
        const key = c.expr[2];
        const scalars = [...reads(key)];
        const k = lists.length / 2 + 1;
        // The row text is "name: key". The key may read scalar cells (a rate); then the rows are
        // made fresh on each patch, so a row whose item did not change is still rewritten.
        const fmt = { plain: (x) => `\${${x}}`, grouped: (x) => `\${grouped(${x})}`, currency: (x) => `\${money(${x})}`, pct: (x) => `\${${x}}%` }[c.format];
        const label = `\`\${it.name}: ${fmt(out.ex(key))}\``;
        lists.push(`const t${k} = template(${q(trim(`<li${attrs({ "data-role": c.name + "Item" })}> `))});`);
        if (scalars.length) {
          lists.push(`const l${k} = list(${ul}, () => [t${k}()], (r, it) => setText(r[0], it.text));`);
          view.push(`l${k}(${v$(c.name)}.m.map((it) => ({ id: it.id, text: ${label} })));`);
          for (const r of scalars) shown.add(r);
        } else {
          lists.push(`const l${k} = list(${ul}, () => [t${k}()], (r, it) => setText(r[0], ${label}));`);
          view.push(`l${k}(${v$(c.name)}.m);`);
        }
        break;
      }
      case "groups": {
        const c = cells.get(n.cell);
        const ul = open("ul", { "data-role": c.name });
        for (const cat of spec.categories) {
          open("li", { "data-key": cat, "data-role": c.name + "Row" });
          html += " ";
          close("li");
        }
        close("ul");
        const val = c.format === "currency" ? "money" : c.format === "grouped" ? "grouped" : null;
        const g = `${v$(c.name)}.m[i]`;
        const shownValue = c.format === "pct" ? `\${${g}}%` : val ? `\${${val}(${g})}` : `\${${g}}`;
        view.push(`categories.forEach((c, i) => setText(${ul}.children[i], \`\${c}: ${shownValue}\`));`);
        break;
      }
      default: throw new Error(`unknown view node ${n.el}`);
    }
  }
  close("div");

  // The messages of the input, one arm per control.
  const used = new Set(controls.map((m) => m.name));
  for (const m of u.messages) if (!used.has(m.name)) throw new Error(`unit ${u.index}: message ${m.name} has no control`);
  const arm = (m) => {
    switch (m.kind) {
      case "input": return `(m, v) => (Number.isInteger(v) && v >= ${input.min} && v <= ${input.max} ? v : m)`;
      case "select": return `(m, v) => v`;
      case "check": return `(m) => !m`;
      case "add": return `(m) => Math.max(${input.min}, Math.min(${input.max}, m ${m.k < 0 ? "-" : "+"} ${Math.abs(m.k)}))`;
    }
    throw new Error(`unknown message kind ${m.kind}`);
  };

  // The formula's arm: the expression over its sources' current models.
  const expr = out.ex(f.expr);
  const derive = f.type === "list" || f.type === "top" || f.type === "group" ? `(m) => keep(m, ${expr})` : `() => ${expr}`;
  const sources = [...reads(f.expr)].map(v$);
  if (readsItems(f.expr)) sources.push("$items");
  shown.delete(f.name);
  const shownCells = [...shown].map(v$);

  const body = [];
  if (input) {
    const patch = ctl.length ? `() => {\n${indent(ctl.join("\n"))}\n}` : null;
    body.push(`inputs.${input.name} = ${v$(input.name)} = cell(${q(input.initial)}, [${controls.map(arm).join(", ")}]${patch ? `, ${patch}` : ""});`);
  }
  body.push(`${v$(f.name)} = formula(${derive}, () => {\n${indent(view.join("\n"))}\n}, [${sources.join(", ")}], [${shownCells.join(", ")}]);`);
  body.push(`const e = unit(sheet, ${q(trim(html))}${input && ctl.length + controls.length ? `, ${v$(input.name)}` : ""});`);
  // The lists are made after `e` (the first patch runs after mount).
  const tail = lists;
  return {
    code: `// ${f.label} (${f.name})\n{\n${indent([...body, ...tail].join("\n"))}\n}`,
    names: [...(input ? [input.name] : []), f.name],
    uses: { list: tail.length > 0, template: tail.length > 0 },
  };
}

// ---------------------------------------------------------------------------------------------
// The items section: one instance, a keyed table.

function itemsBlock(spec) {
  const money = "money";
  const rows = spec.options.rows;
  const cols = [2, 6, 7, 8]; // qty, active, note, remove
  const rowHtml = "<tr data-role=item><td> </td><td> </td><td><input type=number data-role=qty></td><td> </td><td> </td><td> </td><td><input type=checkbox data-role=active></td><td><input type=text data-role=note placeholder=Note></td><td><button data-role=remove>×</button></td>";
  const lines = [
    `// The items`,
    `const rowTemplate = template(${q(rowHtml)});`,
    `const fill = keyed(body, rowTemplate, (tr, it) => {`,
    `  const c = tr.children;`,
    `  setText(c[0], it.name);`,
    `  setText(c[1], it.category);`,
    `  setProp(c[2].firstChild, "valueAsNumber", it.qty);`,
    `  setText(c[3], ${money}(it.price));`,
    `  setText(c[4], ${money}(it.qty * it.price));`,
    `  setText(c[5], ${money}(Math.floor(it.qty * it.price * (100 + $items.m.markup) / 100)));`,
    `  setProp(c[6].firstChild, "checked", it.active);`,
    `  setProp(c[7].firstChild, "value", it.note);`,
    `});`,
    `let shown, marked = ${spec.markup.initial};`,
    `$items = cell(make({ markup: ${spec.markup.initial}, rng: ${spec.rng}, nextId: 1 }, [], ${spec.initialItems}), [`,
    `  (m) => make(m, [], ${rows}),`,
    `  (m) => make(m, m.items.slice(), 1),`,
    `  (m, v) => (Number.isInteger(v) && v >= ${spec.markup.min} && v <= ${spec.markup.max} ? { ...m, markup: v } : m),`,
    `  serverItems,`,
    `  (m, id, v) => (Number.isInteger(v) && v >= 0 && v <= 999 ? edit(m, id, (it) => (it.qty === v ? it : { ...it, qty: v })) : m),`,
    `  (m, id) => edit(m, id, (it) => ({ ...it, active: !it.active })),`,
    `  (m, id, v) => edit(m, id, (it) => ({ ...it, note: v })),`,
    `  (m, id) => ({ ...m, items: m.items.filter((it) => it.id !== id) }),`,
    `], () => {`,
    `  const m = $items.m;`,
    `  if (m.items !== shown) fill((shown = m.items));`,
    `  if (m.markup !== marked) {`,
    `    marked = m.markup;`,
    `    for (const it of m.items) setText(fill.get(it.id).children[5], ${money}(Math.floor(it.qty * it.price * (100 + marked) / 100)));`,
    `  }`,
    `  setProp(bar[4], "valueAsNumber", m.markup);`,
    `}, [2, 6]);`,
    `const bar = wire(main.lastChild.children[1], $items, 0);`,
    `rowEvents(body, $items, 4, ${q(cols)});`,
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------------------------

export function emit(spec) {
  const cells = new Map();
  spec.units.forEach((u, i) => {
    if (u.index !== i) throw new Error(`expected unit ${i}, got ${u.index}`);
    for (const c of [...u.inputs, u.cell]) cells.set(c.name, c);
  });
  const cx = { cells };
  const blocks = spec.units.map((u) => unitBlock(spec, cx, u));
  const names = blocks.flatMap((b) => b.names);

  const files = {
    ...templateFiles({ name: "derived-graph", title: "Derived graph" }),
    "src/table.js": runtimeFile("table.js"),
    "src/graph.js": runtimeFile("graph.js"),
    "src/sheet/frame.js": frameFile(spec),
  };

  const itemRows = [
    `<div data-role=page><section data-key=sheet data-role=sheet><h2>${esc(spec.title)}</h2></section>`,
    `<section data-key=items data-role=items><h2>${esc(spec.itemsTitle)}</h2>`,
    `<div><button data-role=load>${esc(spec.loadText)}</button><button data-role=addItem>Add item</button>`,
    `<label>Markup %<input type=number data-role=markup></label></div>`,
    `<table><thead><tr>${["Item", "Category", "Qty", "Price", "Line", "With markup", "Active", "Note", ""].map((t) => `<th>${t}</th>`).join("")}</tr></thead><tbody></tbody></table>`,
  ].join("");

  const used = (list, text) => list.filter((h) => new RegExp(`\\b${h}\\b`).test(text));
  const FRAME = ["next", "sum", "avg", "maxOf", "minOf", "top", "groupSum", "keep", "grouped", "money", "edit", "serverItems"];
  const RUNTIME = ["template", "setText", "setProp", "wire", "list"];
  const makeFn = `  // The items of the app's own generator (word pools, categories): \`n\` more, from the model's PRNG.
  const categories = ${q(spec.categories)};
  const adjectives = ${q(spec.itemWords.adjectives)};
  const nouns = ${q(spec.itemWords.nouns)};
  const make = (m, items, n) => {
    let s = m.rng, id = m.nextId;
    while (n--) {
      const adjective = adjectives[(s = next(s)) % ${spec.itemWords.adjectives.length}];
      const noun = nouns[(s = next(s)) % ${spec.itemWords.nouns.length}];
      const category = categories[(s = next(s)) % ${spec.categories.length}];
      const qty = 1 + ((s = next(s)) % 99);
      const price = 100 + ((s = next(s)) % ${9999 - 100 + 1});
      items.push({ id: id++, name: adjective + " " + noun, category, qty, price, active: (s = next(s)) % 4 !== 0, note: "" });
    }
    return { ...m, items, rng: s, nextId: id };
  };`;

  // Import only what the blocks use.
  const code = [makeFn, itemsBlock(spec), ...blocks.map((b) => b.code)].join("\n");
  files["src/app.js"] = `import { ${used(RUNTIME, code).join(", ")} } from "./runtime.js";
import { cell, formula, unit, rowEvents } from "./graph.js";
import { keyed } from "./table.js";
import { ${used(FRAME, code).join(", ")} } from "./sheet/frame.js";

export function App(root) {
  root.insertAdjacentHTML("beforeend", ${q(trim(itemRows))});
  const main = root.lastChild;
  const sheet = main.firstChild;
  const body = main.lastChild.lastChild.lastChild;
  // Every cell's instance, in the order the sheet defines them (a formula is made after what it reads).
  let $items, ${names.map(v$).join(", ")};
  const inputs = {};
${makeFn}
${indent(itemsBlock(spec))}
${indent(blocks.map((b) => b.code).join("\n"))}

  return {
    // External events: the inputs are named, the items are a message of the items instance, and
    // the formulas follow by themselves.
    receive(msg) {
      switch (msg.type) {
        case "serverInputs":
          for (const k in msg.values) inputs[k].set(msg.values[k]);
          break;
        case "serverItems":
          $items.send(3, msg);
          break;
        case "snapshot": {
          const s = msg.state;
          for (const k in s.inputs) inputs[k].set(s.inputs[k]);
          $items.set({ items: s.items, markup: s.markup, nextId: s.nextId, rng: s.rng });
          break;
        }
      }
    },
    dispose() {
      main.remove();
    },
  };
}
`;
  return {
    files,
    style: {
      components: "one instance per input (model: its value), per formula (model: its last value, the cache the compiler keeps) and one for the items section; no chunking by position or count. A unit's displays are the binding list of its formula's instance, an input's control the binding list of the input's instance",
      reads: "a formula is a reader: it watches the cells its expression reads and is sent its one message when one changes; its binding list also watches the cells its displays read. A value that did not change (=== , or the same items for a list) tells nobody. Jobs run in rank order, so a formula is recomputed once after the cells it reads",
      formulas: "each expression compiled into its formula's arm; generic collection helpers (sum, avg, top, groupSum) take the formula's own function; lists and group sums are cached as arrays and compared item by item",
      items: "quiet arms: a note and the markup are not read by any formula, so the items instance patches its rows and does not tell its readers",
      events: "controls wired by position (wire) to the cell that owns them; the rows by one delegated listener per event type on the table body",
      externalEvents: "serverInputs sets the named inputs, serverItems is a message of the items instance, a snapshot sets every input and the items instance",
      lists: "runtime keyed list for the top-k lists (src/runtime.js) and the minimal-move keyed table for the items (src/table.js)",
      dom: "each unit's markup as one static template (trailing end tags left out), placeholders for dynamic texts",
      build: "Vite production build, no framework plugin, hidden source maps",
    },
  };
}
