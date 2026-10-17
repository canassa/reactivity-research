// derived-graph as tea-dirtybits, a prototype strategy (see frameworks/tea-dirtybits/README.md).
//
// This emitter plays the compiler: it writes what an ideal TEA compiler would emit for a planning
// sheet, from the spec's formulas, which it compiles to code (nothing is interpreted at runtime).
// Style (recorded in every generated app's rr.json):
// - The sheet is one module (src/sheet.js). Every formula is a module-level `let` (its stored
//   value, computed once) and a cell function; every display and every input control is a cell
//   function too. Cells are numbered in an order in which each comes after the cells it reads
//   (a unit's controls, its formula, its displays), and a cell's dirty bit is its number.
// - Messages and reducer arms are real: a control sends a numbered message and the arm returns the
//   new state with the input changed. The arm's bits are the compile-time numbers of the cells that
//   read the field it wrote (`IN[name]`, the formulas, displays and controls reading the input).
// - A flush (src/graph.js, `sweep`) runs the marked cells in ascending order. A formula recomputes
//   from the model and the stored values of the cells it reads, compares with its stored value and,
//   only when it differs, marks the cells that read it (written out per formula). A formula whose
//   value did not change marks nothing, so its readers do not run. Numbers, booleans and words
//   compare with `!==`; a filtered list compares its items by identity; a top-k list and a group sum
//   are always taken as changed when recomputed.
// - The items are data: the formulas over them have compile-time bits too. An item edit marks the
//   formulas that read the edited field (a quantity, the active flag) and a structural change (load,
//   add, remove, server items) marks every formula that reads the items; a note marks none.
//   Formulas read item fields only through the item expressions of their own code, so a formula
//   that is a list (filter) is refreshed by every field its readers read.
// - Item rows are cloned from one template and patched by column bits (src/graph.js `table`), as in
//   big-table. The markup is one bit read by every row.

import { templateFiles, templateFile, trimTemplate } from "../../frameworks/tea-dirtybits/framework.js";

export const framework = "tea-dirtybits";

export const params = {};

const J = JSON.stringify;
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ESC[c]);
const IDENT = /^[A-Za-z_$][\w$]*$/;
const member = (o, k) => (IDENT.test(k) ? `${o}.${k}` : `${o}[${J(k)}]`);
const attr = (v) => (/^[\w-]+$/.test(v) ? v : `"${esc(v)}"`);

// Identifiers the generated modules use: a cell may not be named like one of them.
const RESERVED = new Set(("s d i t v k m g b Math Map Set Array Number Object String undefined null true false NaN " +
  "set IN ARMS INITIAL SIZE build view update init make file edit at sumBy avgBy maxBy minBy topBy groupBy same CATS " +
  "money group touch sweep markAll onClick onInput onInt ranked groups table clone idOf template html setText setValue " +
  "setChecked setNumber send dirty M_ITEMS M_QTY M_ACTIVE await break case catch class const continue debugger default " +
  "delete do else enum export extends finally for function if import in instanceof let new return super switch this " +
  "throw try typeof var void while with yield").split(" "));

// ---------------------------------------------------------------------------------------------
// Expressions: the spec's formula vocabulary compiled to JavaScript. Precedence levels:
// 1 ?:, 2 ||, 3 &&, 4 equality, 5 relational, 6 + -, 7 *, 8 unary, 10 call or member.

const REL = new Set(["<", "<=", ">", ">="]);
const HELPER = { sum: "sumBy", avg: "avgBy", maxOf: "maxBy", minOf: "minBy", groupSum: "groupBy" };

function gen(e, cx) {
  const c = (x, min = 0) => {
    const [code, prec] = gen(x, cx);
    return prec < min ? `(${code})` : code;
  };
  switch (e[0]) {
    case "k": return typeof e[1] === "string" ? [J(e[1]), 10] : [String(e[1]), e[1] < 0 ? 8 : 10];
    case "v": return [cx.ref(e[1]), 10];
    case "i": return [`i.${e[1]}`, 10];
    case "items": return ["s.items", 10];
    case "+": return [e.slice(1).map((x) => c(x, 6)).join(" + "), 6];
    case "-": return [`${c(e[1], 6)} - ${c(e[2], 7)}`, 6];
    case "*": return [`${c(e[1], 7)} * ${c(e[2], 7)}`, 7];
    case "div": return [`Math.floor(${c(e[1], 7)} / ${c(e[2], 8)})`, 10];
    case "pct": return [`Math.floor(${c(e[1], 7)} * ${c(e[2], 8)} / 100)`, 10];
    case "min": case "max": return [`Math.${e[0]}(${e.slice(1).map((x) => c(x, 1)).join(", ")})`, 10];
    case "abs": return [`Math.abs(${c(e[1], 1)})`, 10];
    case "if": return [`${c(e[1], 2)} ? ${c(e[2], 1)} : ${c(e[3], 1)}`, 1];
    case "==": return [`${c(e[1], 5)} === ${c(e[2], 5)}`, 4];
    case "!=": return [`${c(e[1], 5)} !== ${c(e[2], 5)}`, 4];
    case "and": return [e.slice(1).map((x) => c(x, 3)).join(" && "), 3];
    case "or": return [e.slice(1).map((x) => c(x, 2)).join(" || "), 2];
    case "not": return [`!${c(e[1], 8)}`, 8];
    case "count": return [`${c(e[1], 10)}.length`, 10];
    case "sum": case "avg": case "maxOf": case "minOf": case "groupSum":
      return [`${HELPER[e[0]]}(${c(e[1], 1)}, (i) => ${c(e[2], 1)})`, 10];
    case "filter": return [`${c(e[1], 10)}.filter((i) => ${c(e[2], 1)})`, 10];
    case "top": return [`topBy(${c(e[1], 1)}, (i) => ${c(e[2], 1)}, ${e[3] === "desc"}, ${e[4]})`, 10];
    case "at": return [member(c(e[1], 10), e[2]), 10];
  }
  if (REL.has(e[0])) return [`${c(e[1], 6)} ${e[0]} ${c(e[2], 6)}`, 5];
  throw new Error(`expression ${J(e)}`);
}
const compile = (e, cx) => gen(e, cx)[0];

// The cells an expression reads, in first-read order; the item fields it reads; whether it reads
// the items.
function reads(e, out = []) {
  if (!Array.isArray(e) || e[0] === "k" || e[0] === "i") return out;
  if (e[0] === "v") return out.includes(e[1]) ? out : (out.push(e[1]), out);
  for (let k = 1; k < e.length; k++) reads(e[k], out);
  return out;
}
function fieldsIn(e, out = new Set()) {
  if (!Array.isArray(e) || e[0] === "k" || e[0] === "v") return out;
  if (e[0] === "i") return out.add(e[1]);
  for (let k = 1; k < e.length; k++) fieldsIn(e[k], out);
  return out;
}
const hasItems = (e) => Array.isArray(e) && (e[0] === "items" || e.slice(1).some(hasItems));

// A number in its format; `r` is the source of the value.
const format = (f, r) => (f === "plain" ? r : f === "grouped" ? `group(${r})` : f === "currency" ? `money(${r})` : `${r} + "%"`);
const formatter = (f) => (f === "plain" ? "String" : f === "grouped" ? "group" : f === "currency" ? "money" : '(v) => v + "%"');

// ---------------------------------------------------------------------------------------------

// The optional end tags of table markup, left out as an HTML minifier would.
const tableTags = (m) => m
  .replace(/<\/t([dh])>(?=<t[dh][\s>]|<\/tr>)/g, "")
  .replace(/<\/tr>(?=<tr[\s>]|<\/tbody>|<\/thead>)/g, "")
  .replace(/<\/thead>(?=<tbody)/g, "");

function sheetFiles(spec) {
  const inputs = new Map(), formulas = new Map(), msgs = new Map();
  for (const u of spec.units) {
    for (const c of u.inputs) inputs.set(c.name, c);
    formulas.set(u.cell.name, u.cell);
    for (const m of u.messages) msgs.set(m.name, m);
  }
  for (const name of [...inputs.keys(), ...formulas.keys()]) {
    if (RESERVED.has(name)) throw new Error(`the cell name ${name} clashes with a generated identifier`);
  }
  const cell = (name) => inputs.get(name) || formulas.get(name);
  const cx = { ref: (name) => (inputs.has(name) ? `s.inputs.${name}` : name) };

  // --- The cells: a unit's controls, its formula, then its displays. -------------------------
  const isRead = (n) => n.el === "text" && n.parts.some(Array.isArray);
  const cells = [];
  const of = new Map(); // view node -> cell
  let g = 0;
  for (const u of spec.units) {
    for (const n of u.view) if (n.el === "input" || n.el === "check" || n.el === "select") of.set(n, cells[cells.push({ kind: "ctrl", node: n, g: g++ }) - 1]);
    const f = { kind: "formula", c: u.cell, g: g++ };
    cells.push(f);
    of.set(u.cell, f);
    for (const n of u.view) if (isRead(n) || n.el === "top" || n.el === "groups") of.set(n, cells[cells.push({ kind: n.el, node: n, g: g++ }) - 1]);
  }

  // --- Readers: for every cell, the cells that read it. ---------------------------------------
  const readers = new Map([...inputs.keys(), ...formulas.keys()].map((n) => [n, []]));
  const readBy = (name, cellOfReader) => readers.get(name).push(cellOfReader.g);
  for (const k of cells) {
    if (k.kind === "formula") for (const name of reads(k.c.expr)) readBy(name, k);
    else if (k.kind === "ctrl") readBy(msgs.get(k.node.msg).cell, k);
    else if (k.kind === "text") for (const name of new Set(k.node.parts.filter(Array.isArray).map((p) => p[1]))) readBy(name, k);
    else readBy(k.node.cell, k);
  }

  // A reader's cell number must exceed its source's, or one sweep would not settle the graph.
  for (const k of cells) {
    const names = k.kind === "formula" ? reads(k.c.expr) : k.kind === "text" ? k.node.parts.filter(Array.isArray).map((p) => p[1]) : k.kind === "top" || k.kind === "groups" ? [k.node.cell] : [];
    for (const name of names) if (formulas.has(name) && of.get(formulas.get(name)).g >= k.g) throw new Error(`cell ${k.g} reads ${name}, which does not come first`);
  }
  const ctrls = new Map([...inputs.keys()].map((n) => [n, []]));
  for (const k of cells) if (k.kind === "ctrl") ctrls.get(msgs.get(k.node.msg).cell).push(k.g);

  // --- Item fields: which formulas an edit of a field dirties. -----------------------------------
  // A formula that is a list holds item objects, so it is refreshed by every field its readers
  // read through it (otherwise it would hand them stale items).
  const unitsRev = [...spec.units].reverse();
  const readersOf = new Map([...formulas.keys()].map((n) => [n, []]));
  for (const f of formulas.values()) for (const name of reads(f.expr)) if (readersOf.has(name)) readersOf.get(name).push(f);
  const fields = new Map();
  for (const u of unitsRev) {
    const f = u.cell, set = new Set(fieldsIn(f.expr));
    if (f.type === "list" || f.type === "top") for (const r of readersOf.get(f.name)) for (const x of fields.get(r.name)) set.add(x);
    fields.set(f.name, set);
  }
  const gOf = (name) => of.get(formulas.get(name)).g;
  const direct = [...formulas.values()].filter((f) => hasItems(f.expr));
  const masks = {
    M_ITEMS: direct.map((f) => gOf(f.name)),
    M_QTY: direct.filter((f) => fields.get(f.name).has("qty")).map((f) => gOf(f.name)),
    M_ACTIVE: direct.filter((f) => fields.get(f.name).has("active")).map((f) => gOf(f.name)),
  };

  // --- The markup and the cell functions ----------------------------------------------------------
  let bound = 0;
  const idx = new Map(); // view node -> index among the template's bound elements
  const bind = (n) => (idx.set(n, bound), `t[${bound++}]`);
  const T = (n) => `t[${idx.get(n)}]`;
  bind("root");
  let markup = `<section data-key=sheet data-role=sheet><h2>${esc(spec.title)}</h2>`;
  const wires = [];
  const arms = [];
  const addArm = (code) => arms.push(code) - 1;
  const setters = { input: "setNumber", check: "setChecked", select: "setValue" };
  const used = new Set();

  const show = (p) => {
    const ref = cx.ref(p[1]);
    if (p[0] === "count") return `${ref}.length`;
    const c = cell(p[1]);
    if (p[0] === "at") return format(cell(p[1]).format, member(ref, p[2]));
    if (c.type === "num") return format(c.format, ref);
    if (c.type === "bool") return `(${ref} ? ${J(c.words[0])} : ${J(c.words[1])})`;
    return ref;
  };
  const fns = [];
  // Strings and reads alternate: merge adjacent strings, quote them, leave expressions.
  const textCode = (parts) => {
    const pieces = [];
    for (const p of parts) {
      if (typeof p === "string") {
        if (pieces.length && pieces[pieces.length - 1].lit !== undefined) pieces[pieces.length - 1].lit += p;
        else pieces.push({ lit: p });
      } else pieces.push({ code: show(p) });
    }
    const code = pieces.map((x) => (x.lit !== undefined ? J(x.lit) : x.code));
    if (pieces[0].code !== undefined) code.unshift('""');
    return code.join(" + ");
  };

  const ctrlFn = (k) => {
    const n = k.node, name = msgs.get(n.msg).cell;
    return `(s) => ${setters[n.el]}(${T(n)}, s.inputs.${name}),`;
  };

  for (const u of spec.units) {
    markup += "<div>";
    for (const n of u.view) {
      switch (n.el) {
        case "text":
          if (isRead(n)) markup += `<${n.tag}></${n.tag}>`, bind(n);
          else markup += `<${n.tag}>${esc(n.parts.join(""))}</${n.tag}>`;
          break;
        case "input": markup += `<label>${esc(n.label)}<input type=number data-role=${n.msg}></label>`; bind(n); break;
        case "button": markup += `<button data-role=${n.msg}>${esc(n.text)}</button>`; bind(n); break;
        case "check": markup += `<label><input type=checkbox data-role=${n.msg}>${esc(n.label)}</label>`; bind(n); break;
        case "select": {
          const c = cell(msgs.get(n.msg).cell);
          markup += `<label>${esc(n.label)}<select data-role=${n.msg}>${c.options.map((o) => `<option value=${attr(o)}>${esc(o)}</option>`).join("")}</select></label>`;
          bind(n);
          break;
        }
        case "top": markup += `<${n.tag} data-role=${n.cell}></${n.tag}>`; bind(n); break;
        case "groups": markup += `<ul data-role=${n.cell}></ul>`; bind(n); break;
        default: throw new Error(`view node ${n.el}`);
      }
    }
    markup += "</div>";
  }

  // The events, wired in view order; each control's message tag is its arm's index.
  const lists = []; // the local handles of top and group displays
  for (const u of spec.units) {
    for (const n of u.view) {
      const m = msgs.get(n.msg);
      switch (n.el) {
        case "input": {
          const tagN = addArm(`(s, { value }) => set(s, ${J(m.cell)}, value),`);
          const c = cell(m.cell);
          wires.push(`onInt(${T(n)}, ${tagN}, ${c.min}, ${c.max});`);
          used.add("onInt");
          break;
        }
        case "select": {
          const tagN = addArm(`(s, { value }) => set(s, ${J(m.cell)}, value),`);
          wires.push(`onInput(${T(n)}, ${tagN});`);
          used.add("onInput");
          break;
        }
        case "check": {
          const tagN = addArm(`(s) => set(s, ${J(m.cell)}, !s.inputs.${m.cell}),`);
          wires.push(`onClick(${T(n)}, ${tagN});`);
          used.add("onClick");
          break;
        }
        case "button": {
          const c = cell(m.cell);
          const sum = m.k < 0 ? `s.inputs.${m.cell} - ${-m.k}` : `s.inputs.${m.cell} + ${m.k}`;
          const tagN = addArm(`(s) => set(s, ${J(m.cell)}, Math.${m.k < 0 ? "max" : "min"}(${m.k < 0 ? c.min : c.max}, ${sum})),`);
          wires.push(`onClick(${T(n)}, ${tagN});`);
          used.add("onClick");
          break;
        }
      }
    }
  }

  // The cell functions in cell order.
  const touchCode = (name) => {
    const gs = readers.get(name);
    return gs.length ? `touch([${gs.join(", ")}]);` : "";
  };
  for (const k of cells) {
    if (k.kind === "ctrl") fns.push(ctrlFn(k));
    else if (k.kind === "formula") {
      const c = k.c, code = compile(c.expr, cx), arg = /\bs\./.test(code) ? "s" : "";
      const mark = touchCode(c.name);
      const keyFree = c.type === "top" && reads(c.expr[2]).length === 0; // a key of item fields only: same items, same keys
      if ((c.type === "top" && !keyFree) || c.type === "group") fns.push(`(${arg}) => {\n  ${c.name} = ${code};\n  ${mark}\n},`);
      else {
        const same = c.type === "list" || keyFree ? `!same(v, ${c.name})` : `v !== ${c.name}`;
        fns.push(`(${arg}) => {\n  const v = ${code};\n  if (${same}) {\n    ${c.name} = v;\n    ${mark}\n  }\n},`);
      }
    } else if (k.kind === "text") {
      const code = textCode(k.node.parts);
      fns.push(`(${/\bs\./.test(code) ? "s" : ""}) => setText(${T(k.node)}, ${code}),`);
    } else if (k.kind === "top") {
      const n = k.node, c = formulas.get(n.cell);
      const key = compile(c.expr[2], cx);
      const text = `(i) => i.name + ": " + ${format(c.format, key)}`;
      const h = `r${k.g}`;
      lists.push(`const ${h} = ranked(${T(n)}, ${J(n.cell)});`);
      fns.push(`(${/\bs\./.test(text) ? "s" : ""}) => ${h}(${n.cell}, ${text}),`);
    } else if (k.kind === "groups") {
      const n = k.node, c = formulas.get(n.cell);
      const h = `r${k.g}`;
      lists.push(`const ${h} = groups(${T(n)}, ${J(n.cell)});`);
      fns.push(`() => ${h}(${n.cell}, ${formatter(c.format)}),`);
    }
  }
  const helperNames = ["setText", "setNumber", "setChecked", "setValue"].filter((h) => fns.some((f) => f.includes(`${h}(`)));
  const usesRanked = lists.some((l) => l.includes("ranked("));
  const usesGroups = lists.some((l) => l.includes("groups("));
  const graphNames = ["touch", ...used].sort();
  const listNames = ["CATS", "same", ...(usesRanked ? ["ranked"] : []), ...(usesGroups ? ["groups"] : []), "sumBy", "avgBy", "maxBy", "minBy", "topBy", "groupBy"].filter((h) => new RegExp(`\\b${h}\\b`).test(fns.join("\n") + lists.join("\n")));
  const fmtNames = ["group", "money"].filter((h) => new RegExp(`\\b${h}\\b`).test(fns.join("\n") + lists.join("\n")));

  // The `let` declarations of the formulas' stored values.
  const names = [...formulas.keys()];
  const decl = [];
  for (let k = 0; k < names.length; ) {
    let line = "let " + names[k++];
    while (k < names.length && line.length + names[k].length < 90) line += ", " + names[k++];
    decl.push(line + ";");
  }

  const body = (code) => code.split("\n").map((l) => (l ? "  " + l : l)).join("\n");
  const IN = [...inputs.keys()].map((n) => `  ${n}: [${readers.get(n).join(", ")}],`).join("\n");
  const CTRL = [...inputs.keys()].map((n) => `  ${n}: [${ctrls.get(n).join(", ")}],`).join("\n");
  const initial = [...inputs.values()].map((c) => `  ${c.name}: ${J(c.initial)},`).join("\n");
  const sheet = `import { template, ${helperNames.join(", ")} } from "./runtime.js";
import { ${graphNames.join(", ")} } from "./graph.js";
${listNames.length ? `import { ${listNames.join(", ")} } from "./lists.js";\n` : ""}${fmtNames.length ? `import { ${fmtNames.join(", ")} } from "./format.js";\n` : ""}
// Cells ${cells.length}: a unit's controls, its formula and its displays, each after the cells it
// reads. A cell's dirty bit is its number. The formulas' stored values:
${decl.join("\n")}

export const SIZE = ${cells.length};

// The cells that read each input: the dirty bits an arm marks for the field it writes.
export const IN = {
${IN}
};

// The cells that read the items: all of them (load, add, remove, server items), and those that
// read a quantity or the active flag.
export const M_ITEMS = [${masks.M_ITEMS.join(", ")}];
export const M_QTY = [${masks.M_QTY.join(", ")}];
export const M_ACTIVE = [${masks.M_ACTIVE.join(", ")}];

// The controls of each input: a write that changes nothing still rewrites them (a number input
// may hold text the user typed that is not the value).
const CTRL = {
${CTRL}
};

export const INITIAL = {
${initial}
};

// One input changed, or none: the arm marks the cells that read it.
export function set(s, name, value) {
  if (s.inputs[name] === value) return touch(CTRL[name]), s;
  touch(IN[name]);
  return { ...s, inputs: { ...s.inputs, [name]: value } };
}

// The sheet's reducer: its arms by message tag.
export const ARMS = [
${body(arms.join("\n"))}
];

// The sheet's DOM, built once; returns its cells.
export function build(page) {
  const t = template(${J(trimTemplate(markup))}, page);
${body(lists.join("\n"))}
${body(wires.join("\n"))}
  return [
${body(body(fns.join("\n")))}
  ];
}
`;
  return { sheet, cellCount: cells.length };
}

// ---------------------------------------------------------------------------------------------
// The items section, the app

function itemsFile(spec) {
  const cols = ["Item", "Category", "Qty", "Price", "Line", "With markup", "Active", "Note", ""];
  const head = `<thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>`;
  const section = `<section data-key=items data-role=items><h2>${esc(spec.itemsTitle)}</h2><div><button data-role=load>${esc(spec.loadText)}</button><button data-role=addItem>Add item</button><label>Markup %<input type=number data-role=markup></label></div><table>${head}<tbody></tbody></table></section>`;
  const row = "<tr data-role=item><td></td><td></td><td><input type=number data-role=qty></td><td></td><td></td><td></td><td><input type=checkbox data-role=active></td><td><input type=text data-role=note placeholder=Note></td><td><button data-role=remove>×</button></td></tr>";
  const words = (a) => J(a);
  return `import { html, send, setChecked, setNumber, setText, setValue } from "./runtime.js";
import { CATS } from "./lists.js";
import { money } from "./format.js";

${TABLE_CODE}

const ADJECTIVES = ${words(spec.itemWords.adjectives)};
const NOUNS = ${words(spec.itemWords.nouns)};

// New items from the app's own generator: for each, in order, an adjective, a noun, a category, a
// quantity, a price in cents and the active flag.
export const make = (s, n) => {
  let r = s.rng, id = s.nextId;
  const items = [];
  while (n--) {
    r = r * 48271 % 2147483647;
    const adjective = ADJECTIVES[r % ${spec.itemWords.adjectives.length}];
    r = r * 48271 % 2147483647;
    const name = adjective + " " + NOUNS[r % ${spec.itemWords.nouns.length}];
    r = r * 48271 % 2147483647;
    const category = CATS[r % ${spec.categories.length}];
    r = r * 48271 % 2147483647;
    const qty = 1 + r % 99;
    r = r * 48271 % 2147483647;
    const price = 100 + r % 9900;
    r = r * 48271 % 2147483647;
    items.push({ id: id++, name, category, qty, price, active: r % 4 !== 0, note: "" });
  }
  return { items, rng: r, nextId: id };
};

// A row: a clone of one template; its record is the row, its item (set by the table) and the
// cells the patch writes.
const row = clone(${J(trimTemplate(tableTags(row)))}, (tr) => {
  const [name, category, qty, price, line, markup, active, note] = tr.children;
  return [tr, 0, name, category, qty.firstChild, price, line, markup, active.firstChild, note.firstChild];
});

// The row's static patch: its cells whose bits are set (1 the fixed columns, 32 the quantity,
// 64 the active flag, 128 the note, 256 the markup).
const fill = (r, row, b, markup) => {
  if (b & 1) {
    setText(r[2], row.name);
    setText(r[3], row.category);
    setText(r[5], money(row.price));
  }
  if (b & 32) setNumber(r[4], row.qty);
  if (b & 33) setText(r[6], money(row.qty * row.price));
  if (b & 289) setText(r[7], money(Math.floor(row.qty * row.price * (100 + markup) / 100)));
  if (b & 64) setChecked(r[8], row.active);
  if (b & 128) setValue(r[9], row.note);
};

const int = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

// Builds the section (events delegated by data-role); returns its patch \`(model, bits, payload)\`.
export function view(page) {
  const t = html(${J(trimTemplate(tableTags(section)))}, page);
  t[0].addEventListener("click", (e) => {
    const el = e.target;
    switch (el.dataset.role) {
      case "load": return send({ type: "load" });
      case "addItem": return send({ type: "addItem" });
      case "remove": return send({ type: "remove", id: idOf(el) });
      case "active": return send({ type: "active", id: idOf(el) });
    }
  });
  t[0].addEventListener("input", (e) => {
    const el = e.target, value = el.valueAsNumber;
    switch (el.dataset.role) {
      case "qty": if (int(value, 0, 999)) send({ type: "qty", id: idOf(el), value }); return;
      case "markup": if (int(value, 0, 100)) send({ type: "markup", value }); return;
      case "note": return send({ type: "note", id: idOf(el), value: el.value });
    }
  });
  const patch = table(t[${10 + cols.length}], row, fill);
  return (s, bits, p) => {
    if (bits & 256) setNumber(t[6], s.markup);
    patch(s, bits, p);
  };
}
`;
}

function appFile(spec) {
  return `import { dirty, html } from "./runtime.js";
import { markAll, sweep, touch } from "./graph.js";
import { ARMS, IN, INITIAL, M_ACTIVE, M_ITEMS, M_QTY, SIZE, build, set } from "./sheet.js";
import { make, view as itemsView } from "./items.js";

// The initial model, in the reference's shape: the inputs, the markup and the first items.
export const init = () => ({ inputs: INITIAL, markup: ${spec.markup.initial}, ...make({ rng: ${spec.rng}, nextId: 1 }, ${spec.initialItems}) });

// The items table's dirty bits (graph.js \`table\`); a second event of one tick asks for the whole
// list to be reconciled (bit 1), which covers both.
function file(bits, payload) {
  const f = dirty.items;
  dirty.items = f ? [f[0] | bits | 1] : [bits, payload];
}

const at = (items, id) => items.findIndex((it) => it.id === id);

// One item edited: \`change(item)\` returns its new fields; \`cells\` are the sheet cells that read them.
function edit(s, id, bits, cells, change) {
  const i = at(s.items, id);
  if (i < 0) return s;
  const next = { ...s.items[i], ...change(s.items[i]) };
  file(bits, [next]);
  touch(cells);
  return { ...s, items: s.items.with(i, next) };
}

// The app reducer. The items' messages and the server's events are handled here; a sheet
// control's numbered message goes to its arm.
export function update(s, msg) {
  switch (msg.type) {
    case "load": {
      file(1);
      touch(M_ITEMS);
      return { ...s, ...make(s, ${spec.options.rows}) };
    }
    case "addItem": {
      const m = make(s, 1);
      file(16, m.items);
      touch(M_ITEMS);
      return { ...s, items: s.items.concat(m.items), rng: m.rng, nextId: m.nextId };
    }
    case "markup":
      file(256);
      return { ...s, markup: msg.value };
    case "qty": return edit(s, msg.id, 32, M_QTY, () => ({ qty: msg.value }));
    case "active": return edit(s, msg.id, 64, M_ACTIVE, (it) => ({ active: !it.active }));
    case "note": return edit(s, msg.id, 128, [], () => ({ note: msg.value }));
    case "remove": {
      const i = at(s.items, msg.id);
      if (i < 0) return s;
      file(4, [msg.id]);
      touch(M_ITEMS);
      return { ...s, items: s.items.toSpliced(i, 1) };
    }
    case "serverInputs": {
      for (const name in msg.values) if (name in IN) s = set(s, name, msg.values[name]);
      return s;
    }
    case "serverItems": {
      const upsert = new Map(msg.upsert.map((it) => [it.id, it]));
      const gone = new Set(msg.remove);
      const known = new Set(s.items.map((it) => it.id));
      const items = s.items.filter((it) => !gone.has(it.id)).map((it) => upsert.get(it.id) || it);
      for (const it of msg.upsert) if (!known.has(it.id) && !gone.has(it.id)) items.push(it);
      file(1);
      touch(M_ITEMS);
      return { ...s, items, nextId: Math.max(s.nextId, msg.upsert.reduce((max, it) => Math.max(max, it.id), 0) + 1) };
    }
    case "snapshot":
      markAll(SIZE);
      file(259);
      return msg.state;
  }
  return ARMS[msg.type]?.(s, msg) ?? s;
}

// Builds the page once; the returned patch sweeps the marked cells of the sheet and patches the
// items table.
export function view(root, model) {
  const page = html("<div data-role=page>", root)[0];
  const cells = build(page);
  const items = itemsView(page);
  markAll(SIZE);
  sweep(cells, model);
  items(model, 257);
  return (s, d) => {
    sweep(cells, s);
    if (d.items) items(s, d.items[0], d.items[1]);
  };
}
`;
}

const LISTS = (spec) => `// Collection helpers of the sheet's formulas (scenario code): each takes the formula's own code as a function.
import { setText } from "./runtime.js";

export const CATS = ${J(spec.categories)};

export const sumBy = (list, f) => list.reduce((sum, i) => sum + f(i), 0);
export const avgBy = (list, f) => (list.length ? Math.floor(sumBy(list, f) / list.length) : 0);
export const maxBy = (list, f) => list.reduce((max, i, k) => (k ? Math.max(max, f(i)) : f(i)), 0);
export const minBy = (list, f) => list.reduce((min, i, k) => (k ? Math.min(min, f(i)) : f(i)), 0);

// The first \`k\` items ordered by \`f\` (ties by id, ascending whichever the direction).
export const topBy = (list, f, desc, k) =>
  list
    .map((i) => [f(i), i])
    .sort((a, b) => (a[0] !== b[0] ? (desc ? b[0] - a[0] : a[0] - b[0]) : a[1].id - b[1].id))
    .slice(0, k)
    .map((p) => p[1]);

// The sum of \`f\` over the items of each category.
export function groupBy(list, f) {
  const sums = {};
  for (const c of CATS) sums[c] = 0;
  for (const i of list) sums[i.category] += f(i);
  return sums;
}

// Whether a filtered list holds the same items (by identity) as before.
export const same = (list, old) => !!old && list.length === old.length && list.every((i, k) => i === old[k]);
${DISPLAY_LISTS}`;

const FORMAT = (spec) => `// Number formats of the sheet (scenario code). No locale APIs, so every language formats alike.

export const group = (n) => (n < 0 ? "-" : "") + ("" + Math.abs(n)).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ",");

// Cents as money.
export function money(cents) {
  const a = Math.abs(cents);
  return (cents < 0 ? "-" : "") + ${J(spec.currency)} + group(Math.floor(a / 100)) + "." + ("" + (a % 100)).padStart(2, "0");
}
`;

export function emit(spec) {
  const { sheet } = sheetFiles(spec);
  const files = {
    ...templateFiles({ name: "derived-graph", title: "Derived graph" }),
    "src/graph.js": templateFile("graph.js"),
    "src/format.js": FORMAT(spec),
    "src/lists.js": LISTS(spec),
    "src/sheet.js": sheet,
    "src/items.js": itemsFile(spec),
    "src/app.js": appFile(spec),
  };
  return {
    files,
    style: {
      components: "the sheet is one module (cells as module-level lets and cell functions, arms, DOM built once from one static template); the items section is another; every formula, display and control is written out as code from the spec, nothing interpreted at runtime",
      state: "one immutable TEA model in the reference's shape; formulas are not state: each stores its value in a module-level variable, computed once per change",
      dirtyBits: "one bit per cell (a formula, a display or a control), numbered so each cell comes after the cells it reads; an arm marks the bits of the cells that read the field it wrote (IN[name]); a flush sweeps the marked cells in ascending order",
      derivedValues: "a formula recomputes when marked, compares with its stored value and marks its readers only when it changed (numbers, booleans and words by !==, a filtered list by the identity of its items; a top-k list and a group sum count as changed every time they are recomputed)",
      items: "item edits mark the formulas that read the edited field (a quantity, the active flag) with compile-time bits, structural changes mark every formula that reads the items, a note marks none; formulas over the items recompute in full (no incremental aggregates)",
      rows: "one cloned template per row, patched by column bits (quantity, active, note, markup), as in big-table; events delegated by data-role",
      externalEvents: "through the same send: serverInputs sets the named inputs through the same arms, serverItems reconciles the table and marks the formulas over the items, snapshot marks every cell and reconciles the table",
      build: "Vite with no framework plugin, production defaults, hidden source maps",
    },
  };
}

// The items table (scenario code): a keyed set of rows, each a clone of one template. `row()`
// builds a detached record [tr, item, …bound elements], `fill(record, item, bits, markup)` is the
// row's static patch. Dirty bits of the table: reconcile 1, force 2 (patch every row, even of an
// item that is the same object), gone 4, added 16, and one bit per cell group of a row from 32 up
// (the row patch tests them); 256 is the markup, which every row reads. The payload names the rows
// an event touched (ids for gone, items for added and edited cells). A second event of one tick
// files bit 1, which covers both.
const TABLE_CODE = `function table(body, row, fill) {
  let recs = new Map();
  const make = (item, s) => {
    const r = row();
    r[1] = item;
    r[0].dataset.key = item.id;
    fill(r, item, -1, s.markup);
    return r;
  };
  // The whole list: new items get rows, changed items are patched, gone rows are removed and one
  // walk moves only the nodes out of place.
  const sync = (s, force) => {
    const next = new Map();
    let hits = 0;
    for (const item of s.items) {
      let r = recs.get(item.id);
      if (r) {
        hits++;
        if (force || r[1] !== item) fill(r, (r[1] = item), -1, s.markup);
      } else r = make(item, s);
      next.set(item.id, r);
    }
    if (hits) {
      for (const [id, r] of recs) if (!next.has(id)) r[0].remove();
    } else body.textContent = "";
    let cur = body.firstChild;
    for (const r of next.values()) {
      if (r[0] === cur) cur = cur.nextSibling;
      else body.insertBefore(r[0], cur);
    }
    recs = next;
  };
  return (s, bits, p) => {
    if (bits & 1) sync(s, bits & 2);
    else if (bits & 4) {
      for (const id of p) {
        const r = recs.get(id);
        if (r) r[0].remove(), recs.delete(id);
      }
    } else if (bits & 16) {
      for (const item of p) {
        const r = make(item, s);
        recs.set(item.id, r);
        body.append(r[0]);
      }
    } else if (bits & 224) {
      for (const item of p) {
        const r = recs.get(item.id);
        if (r) fill(r, (r[1] = item), bits, s.markup);
      }
    }
    if (bits & 256) for (const r of recs.values()) fill(r, r[1], 256, s.markup);
  };
}

// The id of the row an element is in.
const idOf = (el) => +el.closest("tr").dataset.key;

// A row's static markup, parsed once; each row is a clone, \`bind\` finds its bound elements.
function clone(source, bind) {
  const t = document.createElement("template");
  t.innerHTML = source;
  const proto = t.content.firstChild;
  return () => bind(proto.cloneNode(true));
}`;

// Lists of derived values (scenario code). Both write guarded texts.
const DISPLAY_LISTS = `
// A keyed list of items (\`<li data-key=id data-role=roleItem>\`): the returned (items, text) writes
// every row's text (a row's key may change with a scalar cell although the item did not), builds
// the rows of new items, removes the rows of gone ones and moves only the misplaced nodes.
export function ranked(parent, role) {
  let rows = new Map();
  return (items, text) => {
    const next = new Map();
    for (const item of items) {
      let li = rows.get(item.id);
      if (!li) {
        li = document.createElement("li");
        li.dataset.key = item.id;
        li.dataset.role = role + "Item";
      }
      setText(li, text(item));
      next.set(item.id, li);
    }
    for (const [id, li] of rows) if (!next.has(id)) li.remove();
    let at = parent.firstChild;
    for (const li of next.values()) {
      if (li === at) at = at.nextSibling;
      else parent.insertBefore(li, at);
    }
    rows = next;
  };
}

// One row per category (\`<li data-key=category data-role=roleRow>\`); the returned (group, format)
// writes them.
export function groups(ul, role) {
  const rows = CATS.map((c) => {
    const li = document.createElement("li");
    li.dataset.key = c;
    li.dataset.role = role + "Row";
    ul.append(li);
    return li;
  });
  return (g, format) => rows.forEach((li, k) => setText(li, CATS[k] + ": " + format(g[CATS[k]])));
}
`;
