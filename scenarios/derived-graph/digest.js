// derived-graph in digest (prototype): compiled dirty checking, the whole sheet as one binding
// list (fails locality on purpose: see below).
//
// What a compiler for this approach would produce for a planning sheet:
// - One function, `main`, per app. Its state is plain mutable variables: one per input, one per
//   formula (its latest value), the markup, the items and the app's PRNG. Its template is the
//   sheet's static HTML (every unit's displays and controls, escaped at build time, without the
//   end tags the end of the template closes), the items section's, and one row's. Nothing is kept
//   as data for a generic routine: no formula trees, no operator tables, no display descriptions.
// - Each formula is one line of JavaScript, compiled from its expression: `calc(() => $x = ...)`,
//   in unit order, so the cells it reads are already computed when it runs. The collection
//   helpers (sum, avg, maxOf, minOf, top, grp) take the formula's own code as a function.
// - Each display is one binding: `text(d, () => `Label tok: ${format($x)}`)`, on the element at
//   position d from the previous binding's, written only when the string changed. The keyed
//   top-k lists and the group rows are the same bindings on their own elements.
// - The sheet is ONE binding list, formulas and displays in unit order. A formula may read any
//   earlier cell (the scenario draws no locality window and no sections), so there is no block to
//   cut the list along, and an event on the sheet re-runs all of it. That is O(N) calls per
//   event, so `./rr check` fails its locality. A list per unit, with every handler digesting the
//   lists its input feeds through the chains, would have the compiler schedule the exact set of
//   bindings an action runs: tea-inline's mechanism under another name. See
//   frameworks/digest/README.md, "derived-graph".
// - The items section is two levels of lists as big-table's: one for the rows' reconciler (it
//   re-runs every row's own list), one list per row. A row control digests its row's list; the
//   handler digests the sheet by hand when the edit changes what the sheet reads (the quantity,
//   the active flag, a removed row).
// - The items are built at start-up and by Load/Add item with the app's own PRNG, so --rows
//   reaches the code only in the Load button's count and text.
// - The runtime (frameworks/digest/runtime-graph.js) is generic: a section built from a
//   template, bind/text/calc, a keyed-list reconciler, one delegated click/input listener.

import { templateFiles } from "../../frameworks/digest/framework.js";

export const framework = "digest";

export const params = {};

const lit = (v) => JSON.stringify(v);
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ESC[c]);
// Text inside a JavaScript template literal.
const tpl = (s) => s.replace(/[\\`]|\$\{/g, (m) => "\\" + m);
// An attribute value, unquoted when HTML allows.
const q = (v) => (/^[\w-]+$/.test(v) ? v : `"${esc(v)}"`);
// The end tags a template ends with: the end of the HTML closes the elements still open.
const trim = (html) => html.replace(/(<\/\w+>)+$/, "");

const V = (name) => "$" + name;

// One cell's code, expressions and formats. `cells` maps every input and formula name to its
// description.
let cells, cur;

// A formula's expression as JavaScript. Every operator is parenthesised; the minifier removes
// what it can.
function ex(e) {
  const x = ex;
  switch (e[0]) {
    case "v": return V(e[1]);
    case "k": return lit(e[1]);
    case "i": return `i.${e[1]}`;
    case "items": return "items";
    case "+": case "-": case "*": return `(${e.slice(1).map(x).join(` ${e[0]} `)})`;
    case "div": return `Math.floor(${x(e[1])} / ${x(e[2])})`;
    case "pct": return `Math.floor(${x(e[1])} * ${x(e[2])} / 100)`;
    case "min": case "max": return `Math.${e[0]}(${e.slice(1).map(x).join(", ")})`;
    case "abs": return `Math.abs(${x(e[1])})`;
    case "if": return `(${x(e[1])} ? ${x(e[2])} : ${x(e[3])})`;
    case "<": case "<=": case ">": case ">=": return `(${x(e[1])} ${e[0]} ${x(e[2])})`;
    case "==": return `(${x(e[1])} === ${x(e[2])})`;
    case "!=": return `(${x(e[1])} !== ${x(e[2])})`;
    case "and": return `(${e.slice(1).map(x).join(" && ")})`;
    case "or": return `(${e.slice(1).map(x).join(" || ")})`;
    case "not": return `!${x(e[1])}`;
    case "count": return `${x(e[1])}.length`;
    case "sum": case "avg": case "maxOf": case "minOf": return `${e[0]}(${x(e[1])}, (i) => ${x(e[2])})`;
    case "filter": return `${x(e[1])}.filter((i) => ${x(e[2])})`;
    case "top": return `top(${x(e[1])}, (i) => ${x(e[2])}, ${e[3] === "desc" ? -1 : 1}, ${e[4]})`;
    case "groupSum": return `grp(CAT, ${x(e[1])}, (i) => ${x(e[2])})`;
    case "at": return `${x(e[1])}.${e[2]}`;
  }
  throw new Error(`digest: unknown expression ${lit(e)}`);
}

// A number as a piece of a template literal.
function numFrag(format, js) {
  switch (format) {
    case "plain": return "${" + js + "}";
    case "pct": return "${" + js + "}%";
    case "grouped": return "${sg(" + js + ")}";
    case "currency": return "${cur(" + js + ")}";
  }
  throw new Error(`digest: unknown number format ${format}`);
}

// A display part (a read) as a piece of a template literal.
function frag(p) {
  const c = cells.get(p[1]);
  if (p[0] === "count") return "${" + V(c.name) + ".length}";
  if (p[0] === "at") return numFrag(c.format, `${V(c.name)}.${p[2]}`);
  if (c.type === "num") return numFrag(c.format, V(c.name));
  if (c.type === "bool") return "${" + `${V(c.name)} ? ${lit(c.words[0])} : ${lit(c.words[1])}` + "}";
  return "${" + V(c.name) + "}";
}

// The handler of a sheet control, from its message.
function handler(m) {
  const c = cells.get(m.cell), v = V(c.name);
  switch (m.kind) {
    case "input": return `() => ${v} = num(X.value, ${c.min}, ${c.max}, ${v})`;
    // A value always lies within its range, so adding k > 0 can only pass the top and k < 0 the
    // bottom: one bound is checked.
    case "add": return m.k > 0 ? `() => ${v} = Math.min(${v} + ${m.k}, ${c.max})` : `() => ${v} = Math.max(${v} - ${-m.k}, ${c.min})`;
    case "check": return `() => ${v} = X.checked`;
    case "select": return `() => ${v} = X.value`;
  }
  throw new Error(`digest: unknown message kind ${m.kind}`);
}

// The sheet: its HTML, its controls' handlers and its bindings (formulas and displays), in unit
// order.
function sheet(spec) {
  const html = [`<h2>${esc(spec.title)}</h2>`], hs = [], code = [], consts = [];
  const msgs = new Map(spec.units.flatMap((u) => u.messages).map((m) => [m.name, m]));
  let n = 1, at = 0; // n: the next element's index in the section (0 is the heading)
  const ref = (i) => {
    const d = i - at;
    at = i;
    return d;
  };
  for (const u of spec.units) {
    html.push("<div>");
    n++;
    const c = u.cell, v = V(c.name);
    if (c.type === "top") {
      consts.push(`const key${c.name} = (i) => ${ex(c.expr[2])};`);
      code.push(`calc(() => ${v} = ${ex(c.expr)});`);
    } else code.push(`calc(() => ${v} = ${ex(c.expr)});`);
    for (const node of u.view) {
      switch (node.el) {
        case "text": {
          const i = n++;
          if (node.parts.every((p) => typeof p == "string")) {
            html.push(`<${node.tag}>${esc(node.parts.join(""))}</${node.tag}>`);
          } else {
            html.push(`<${node.tag}></${node.tag}>`);
            code.push(`text(${ref(i)}, () => \`${node.parts.map((p) => (typeof p == "string" ? tpl(p) : frag(p))).join("")}\`);`);
          }
          break;
        }
        case "input": {
          const m = msgs.get(node.msg);
          n++;
          const i = n++;
          html.push(`<label>${esc(node.label)}<input type=number data-role=${node.msg}></label>`);
          hs.push(handler(m));
          code.push(`bind(${ref(i)}, () => ${V(m.cell)});`);
          break;
        }
        case "button":
          n++;
          html.push(`<button data-role=${node.msg}>${esc(node.text)}</button>`);
          hs.push(handler(msgs.get(node.msg)));
          break;
        case "check": {
          const m = msgs.get(node.msg);
          n++;
          const i = n++;
          html.push(`<label><input type=checkbox data-role=${node.msg}>${esc(node.label)}</label>`);
          hs.push(handler(m));
          code.push(`bind(${ref(i)}, () => ${V(m.cell)}, "checked");`);
          break;
        }
        case "select": {
          const m = msgs.get(node.msg), os = cells.get(m.cell).options;
          n++;
          const i = n++;
          n += os.length;
          html.push(`<label>${esc(node.label)}<select data-role=${node.msg}>${os.map((o) => `<option value=${q(o)}>${esc(o)}</option>`).join("")}</select></label>`);
          hs.push(handler(m));
          code.push(`bind(${ref(i)}, () => ${V(m.cell)});`);
          break;
        }
        case "top": {
          const i = n++, c2 = cells.get(node.cell);
          html.push(`<${node.tag} data-role=${node.cell}></${node.tag}>`);
          code.push(`list(${ref(i)}, () => ${V(node.cell)}, "li", "${node.cell}Item", "", (r) => void text(0, () => \`\${r.i.name}: ${numFrag(c2.format, `key${node.cell}(r.i)`)}\`, r.n));`);
          break;
        }
        case "groups": {
          const c2 = cells.get(node.cell);
          n++;
          html.push(`<ul data-role=${node.cell}>`);
          for (const cat of spec.categories) {
            const i = n++;
            html.push(`<li data-key=${q(cat)} data-role=${node.cell}Row></li>`);
            code.push(`text(${ref(i)}, () => \`${tpl(cat)}: ${numFrag(c2.format, `${V(node.cell)}.${cat}`)}\`);`);
          }
          html.push("</ul>");
          break;
        }
        default: throw new Error(`digest: unknown view node ${node.el}`);
      }
    }
    html.push("</div>");
  }
  return { html: trim(html.join("")), hs, code, consts };
}

function appFile(spec) {
  cells = new Map(spec.units.flatMap((u) => [...u.inputs, u.cell]).map((c) => [c.name, c]));
  const s = sheet(spec);
  const inputs = spec.units.flatMap((u) => u.inputs);
  const formulas = spec.units.map((u) => u.cell);
  const sym = spec.currency;

  const decls = [
    ...inputs.map((c) => `${V(c.name)} = ${lit(c.initial)}`),
    ...formulas.map((c) => V(c.name)),
  ];
  // The items section: two buttons, the markup, and the table of keyed rows.
  const items = `<h2>${esc(spec.itemsTitle)}</h2><div><button data-role=load>${esc(spec.loadText)}</button><button data-role=addItem>Add item</button><label>Markup %<input type=number data-role=markup></label></div><table><thead><tr>${["Item", "Category", "Qty", "Price", "Line", "With markup", "Active", "Note", ""].map((t) => `<th>${t}</th>`).join("")}</tr></thead><tbody></tbody></table>`;
  const row = `<td></td><td></td><td><input type=number data-role=qty></td><td></td><td></td><td></td><td><input type=checkbox data-role=active></td><td><input type=text data-role=note placeholder=Note></td><td><button data-role=remove>×</button></td>`;
  const draws = spec.initialItems;

  const body = `export default app(() => {
  // State: plain variables. Inputs and formulas first, then the items and the app's PRNG.
  let ${decls.join(", ")};
  let markup = ${spec.markup.initial}, rng = ${spec.rng}, nextId = 1, items = [];
  const CAT = ${lit(spec.categories)}, ADJ = ${lit(spec.itemWords.adjectives)}, NOUN = ${lit(spec.itemWords.nouns)};
  const d = () => (rng = (rng * 48271) % 2147483647);
  const mk = (n) => {
    while (n--) items.push({ id: nextId++, name: ADJ[d() % ${spec.itemWords.adjectives.length}] + " " + NOUN[d() % ${spec.itemWords.nouns.length}], category: CAT[d() % ${spec.categories.length}], qty: 1 + (d() % 99), price: 100 + (d() % 9900), active: d() % 4 != 0, note: "" });
  };
  mk(${draws});
${s.consts.map((c) => "  " + c).join("\n")}

  // The inputs' setter for external events: only the named inputs change.
  const set = (v) => ({ ${inputs.map((c) => `${c.name}: ${V(c.name)} = ${V(c.name)}`).join(", ")} } = v);

  // The sheet: its template, its controls' handlers in document order, then its bindings.
  const sh = widget("sheet", \`${tpl(s.html)}\`,
${s.hs.map((h) => "    " + h).join(",\n")}
  );
${s.code.map((c) => "  " + c).join("\n")}

  // The items.
  const tl = widget("items", \`${tpl(trim(items))}\`,
    () => ((items = []), mk(${spec.options.rows}), go(sh)), // load
    () => (mk(1), go(sh)), // addItem
    () => (markup = num(X.value, ${spec.markup.min}, ${spec.markup.max}, markup)),
  );
  bind(5, () => markup);
  list(13, () => items, "tr", "item", \`${tpl(trim(row))}\`, (r) => (
    text(0, () => r.i.name),
    text(1, () => r.i.category),
    bind(2, () => r.i.qty),
    text(1, () => cur(r.i.price)),
    text(1, () => cur(r.i.qty * r.i.price)),
    text(1, () => cur(Math.floor((r.i.qty * r.i.price * (100 + markup)) / 100))),
    bind(2, () => r.i.active, "checked"),
    bind(2, () => r.i.note),
    [
      () => ((r.i.qty = num(X.value, 0, 999, r.i.qty)), go(sh)), // qty
      () => ((r.i.active = X.checked), go(sh)), // active
      () => (r.i.note = X.value), // note
      () => ((items = items.filter((i) => i != r.i)), go(tl), go(sh)), // remove
    ]
  ));

  // External events: new input values, changes to some items, a whole new state.
  return (m) => {
    if (m.type == "serverInputs") set(m.values);
    else {
      if (m.type == "serverItems") {
        items = items.filter((i) => !m.remove.includes(i.id));
        for (const u of m.upsert) {
          const at = items.findIndex((i) => i.id == u.id);
          m.remove.includes(u.id) || (at < 0 ? items.push({ ...u }) : (items[at] = { ...u }));
        }
        nextId = Math.max(nextId, ...m.upsert.map((u) => u.id + 1));
      } else {
        set(m.state.inputs);
        ({ markup, nextId, rng } = m.state);
        items = structuredClone(m.state.items);
      }
      go(tl);
    }
    go(sh);
  };
});
`;
  const uses = (x) => new RegExp(`(^|[^\\w.$])${x}\\b`, "m").test(body);
  const names = ["app", "widget", "bind", "text", "calc", "list", "go", "X"].filter(uses);
  const helpers = ["num", "sum", "avg", "maxOf", "minOf", "top", "grp"].filter(uses);
  const fmt = [];
  const usesFmt = (x) => new RegExp(`\\b${x}\\(`).test(s.code.join("\n"));
  if (usesFmt("sg")) fmt.push(`const sg = (v) => (v < 0 ? "-" : "") + gr(Math.abs(v));`);
  return `// Generated by scenarios/derived-graph/digest.js. Do not edit.
import { ${names.join(", ")} } from "./runtime.js";
import { ${helpers.join(", ")} } from "./helpers.js";

// Number formats: no locale APIs. \`cur\` is cents.
const gr = (n) => String(n).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ",");
${fmt.join("\n")}${fmt.length ? "\n" : ""}const cur = (v, a = Math.abs(v)) => (v < 0 ? "-${sym}" : "${sym}") + gr(Math.floor(a / 100)) + "." + String(a % 100).padStart(2, "0");

${body}`;
}

export function emit(spec) {
  const files = templateFiles({ name: "derived-graph", title: "Derived graph", runtime: "runtime-graph.js" });
  return {
    files: {
      ...files,
      "src/helpers.js": fsHelpers(),
      "src/app.js": appFile(spec),
    },
    style: {
      approach: "compiled dirty checking over one binding list for the whole sheet (formulas and displays in unit order) and one list per items row: an event on the sheet re-runs every binding, each writing a DOM property only when its value changed; O(N) per event, so it fails locality",
      components: "one function for the app; the formulas, the inputs' handlers and the displays are written out in full from their descriptions (no formula trees, operator tables or display descriptions); the collection helpers take the formula's own code as a function",
      lists: "the sheet is one list (a formula may read any earlier cell, so there is no block to cut along); the items section has the rows' reconciler and one list per row; a row control digests its row, and the handler digests the sheet by hand when the edit changes what the sheet reads",
      state: "plain mutable variables, one per input and per formula (its latest value); the items are plain objects edited in place; initial items built at start-up by the app's own PRNG; snapshots are deep-copied and assigned, serverInputs assigns the named inputs through one destructuring setter",
      templates: "one static HTML string for the sheet (every unit), one for the items section and one for a row, escaped at build time; end tags left out only where the end of the template closes them; the row is cloned from a prototype; nodes are found by position, bindings by distance from the previous one",
      handlers: "one arrow function per control, given to the controls in document order; a number input accepts an integer in range and otherwise keeps the state's value",
      derived: "formulas are recomputed in order on every sheet digest (no memoization, no dirty tracking); collection helpers sum, avg, maxOf, minOf, top and grp; formats are small shared functions",
      keyedLists: "keyed by item id, reconciled in place by the runtime (the items' rows and the top-k lists); the group rows are static elements with bindings",
      events: "one delegated click and input listener that calls the target's handler",
      build: "Vite production build, no plugin, hidden source maps",
    },
  };
}

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const fsHelpers = () => fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../frameworks/digest/graph-helpers.js"), "utf8");
