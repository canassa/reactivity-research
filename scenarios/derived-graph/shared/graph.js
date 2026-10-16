// What the derived-graph emitters share (README, "Formulas are code"): reading an app spec as a
// compiler would, and printing a formula's expression as JavaScript. Nothing here is shipped: it
// runs at generation time, and each emitter writes every formula, input and display out as that
// app's own code. The reference (`update`, `render`, `evaluate`) is never used.

export const cap = (s) => s[0].toUpperCase() + s.slice(1);

// ---------------------------------------------------------------------------------------------
// The graph.

const IDENT = /^[A-Za-z_$][\w$]*$/;

// The cells an expression reads, in first-read order.
export function reads(e, out = []) {
  if (!Array.isArray(e)) return out;
  if (e[0] === "v") {
    if (!out.includes(e[1])) out.push(e[1]);
    return out;
  }
  if (e[0] === "k" || e[0] === "i") return out;
  for (let k = 1; k < e.length; k++) reads(e[k], out);
  return out;
}

// The item fields an expression reads (`["i", field]` anywhere in it).
export function fields(e, out = new Set()) {
  if (!Array.isArray(e)) return out;
  if (e[0] === "i") out.add(e[1]);
  else if (e[0] !== "k" && e[0] !== "v") for (let k = 1; k < e.length; k++) fields(e[k], out);
  return out;
}

// Whether an expression takes the items themselves as its source.
export const readsItems = (e) => Array.isArray(e) && (e[0] === "items" || (e[0] !== "k" && e.slice(1).some(readsItems)));

// The cells a display node reads.
export function nodeReads(n) {
  if (n.el === "text") return [...new Set(n.parts.filter((p) => typeof p !== "string").map((p) => p[1]))];
  if (n.el === "top" || n.el === "groups") return [n.cell];
  return [];
}

export function readGraph(spec) {
  const cells = new Map();
  const inputs = [];
  const formulas = [];
  for (const u of spec.units) {
    for (const c of u.inputs) {
      cells.set(c.name, c);
      inputs.push(c);
    }
    cells.set(u.cell.name, u.cell);
    formulas.push(u.cell);
  }
  const index = new Map(formulas.map((f, i) => [f.name, i]));
  const deps = new Map(formulas.map((f) => [f.name, reads(f.expr)]));
  const children = new Map([...cells.keys()].map((n) => [n, []]));
  for (const f of formulas) for (const d of deps.get(f.name)) children.get(d).push(f.name);
  const messages = new Map(spec.units.flatMap((u) => u.messages).map((m) => [m.name, m]));
  // Display nodes, each with the cells it reads.
  const nodes = [];
  for (const u of spec.units) {
    u.view.forEach((node, k) => nodes.push({ unit: u.index, k, node, reads: nodeReads(node) }));
  }
  // The nodes that show a cell's value: its display nodes, and for an input its controls.
  const shown = new Map([...cells.keys()].map((n) => [n, []]));
  for (const n of nodes) {
    for (const r of n.reads) shown.get(r).push(n);
    const m = n.node.msg && messages.get(n.node.msg);
    if (m && n.node.el !== "button") shown.get(m.cell).push(n);
  }
  return { spec, cells, inputs, formulas, index, deps, children, messages, nodes, shown };
}

// What recomputing after one change takes, in dependency order: `roots` are the formulas that
// read the change directly; every formula downstream of them is a member. A member that is not a
// root runs only if one of its `parents` (cells it reads that are members) changed.
export function plan(g, roots) {
  const members = new Set(roots);
  const stack = [...roots];
  while (stack.length) {
    for (const c of g.children.get(stack.pop())) {
      if (!members.has(c)) {
        members.add(c);
        stack.push(c);
      }
    }
  }
  const rootSet = new Set(roots);
  const ordered = [...members].sort((a, b) => g.index.get(a) - g.index.get(b));
  const steps = ordered.map((name) => ({
    name,
    parents: rootSet.has(name) ? null : g.deps.get(name).filter((d) => members.has(d)),
  }));
  const hasChildren = new Set(steps.flatMap((s) => s.parents || []));
  for (const s of steps) s.hasChildren = hasChildren.has(s.name);
  return steps;
}

// The formulas that read an input, one item field, or the items as a whole (any change to which
// rows exist, or to a field a user cannot edit).
export const rootsOfInput = (g, name) => g.children.get(name);
export const rootsOfField = (g, field) => g.formulas.filter((f) => fields(f.expr).has(field)).map((f) => f.name);
export const rootsOfItems = (g) => g.formulas.filter((f) => readsItems(f.expr)).map((f) => f.name);

// ---------------------------------------------------------------------------------------------
// Formulas as JavaScript. `o.ref(name)` is how a cell is read, `o.items` the items, `o.used` a set
// that collects the helpers the code calls (see utilSource).

const atom = (s) => ({ s, p: 20 });
const wrap = (r, min) => (r.p >= min ? r.s : `(${r.s})`);
const COMPARE = { "<": ["<", 9], "<=": ["<=", 9], ">": [">", 9], ">=": [">=", 9], "==": ["===", 8], "!=": ["!==", 8] };

function js(e, o) {
  const w = (x, min) => wrap(js(x, o), min);
  const use = (n) => (o.used?.add(n), n);
  switch (e[0]) {
    case "k":
      if (typeof e[1] === "string") return atom(JSON.stringify(e[1]));
      return e[1] < 0 ? { s: String(e[1]), p: 14 } : atom(String(e[1]));
    case "v": return atom(o.ref(e[1]));
    case "i": return atom(`it.${e[1]}`);
    case "items": return atom(o.items);
    case "+": return { s: e.slice(1).map((x) => w(x, 11)).join(" + "), p: 11 };
    case "-": return { s: `${w(e[1], 11)} - ${w(e[2], 12)}`, p: 11 };
    case "*": return { s: `${w(e[1], 12)} * ${w(e[2], 13)}`, p: 12 };
    case "div": return atom(`Math.floor(${w(e[1], 12)} / ${w(e[2], 13)})`);
    case "pct": return atom(`Math.floor((${w(e[1], 12)} * ${w(e[2], 13)}) / 100)`);
    case "min": case "max": return atom(`Math.${e[0]}(${e.slice(1).map((x) => w(x, 2)).join(", ")})`);
    case "abs": return atom(`Math.abs(${w(e[1], 2)})`);
    case "if": return { s: `${w(e[1], 3)} ? ${w(e[2], 3)} : ${w(e[3], 2)}`, p: 2 };
    case "<": case "<=": case ">": case ">=": case "==": case "!=": {
      const [op, p] = COMPARE[e[0]];
      return { s: `${w(e[1], p + 1)} ${op} ${w(e[2], p + 1)}`, p };
    }
    case "and": return { s: e.slice(1).map((x) => w(x, 5)).join(" && "), p: 4 };
    case "or": return { s: e.slice(1).map((x) => w(x, 5)).join(" || "), p: 3 };
    case "not": return { s: `!${w(e[1], 14)}`, p: 14 };
    case "count": return atom(`${w(e[1], 17)}.length`);
    case "sum": return atom(`${use("sumBy")}(${w(e[1], 2)}, (it) => ${w(e[2], 2)})`);
    case "avg": return atom(`${use("avgBy")}(${w(e[1], 2)}, (it) => ${w(e[2], 2)})`);
    case "maxOf": return atom(`${use("maxBy")}(${w(e[1], 2)}, (it) => ${w(e[2], 2)})`);
    case "minOf": return atom(`${use("minBy")}(${w(e[1], 2)}, (it) => ${w(e[2], 2)})`);
    case "filter": return atom(`${w(e[1], 17)}.filter((it) => ${w(e[2], 2)})`);
    case "top": return atom(`${use("topBy")}(${w(e[1], 2)}, (it) => ${w(e[2], 2)}, ${e[3] === "desc" ? -1 : 1}, ${e[4]})`);
    case "groupSum": return atom(`${use("groupSum")}(${w(e[1], 2)}, (it) => ${w(e[2], 2)})`);
    case "at": return atom(IDENT.test(e[2]) ? `${w(e[1], 17)}.${e[2]}` : `${w(e[1], 17)}[${JSON.stringify(e[2])}]`);
  }
  throw new Error(`unknown expression ${JSON.stringify(e)}`);
}

export const jsExpr = (e, o) => js(e, o).s;

// A value as text: the JavaScript expression and what follows it (`%` for a percent). `words` is
// a bool's display pair.
export function formatted(format, value, used, words) {
  if (words) return { expr: `${value} ? ${JSON.stringify(words[0])} : ${JSON.stringify(words[1])}`, suffix: "" };
  switch (format) {
    case "plain": case undefined: return { expr: value, suffix: "" };
    case "pct": return { expr: value, suffix: "%" };
    case "grouped": used?.add("grouped"); return { expr: `grouped(${value})`, suffix: "" };
    case "currency": used?.add("money"); return { expr: `money(${value})`, suffix: "" };
  }
  throw new Error(`unknown number format ${format}`);
}

// What a text node's read part shows, as { expr, suffix }.
export function partShown(g, part, o) {
  const c = g.cells.get(part[1]);
  switch (part[0]) {
    case "v":
      if (c.type === "bool") return formatted(null, o.ref(c.name), o.used, c.words);
      return formatted(c.type === "num" ? c.format : "plain", o.ref(c.name), o.used);
    case "count": return formatted("plain", `${o.ref(c.name)}.length`, o.used);
    case "at": return formatted(c.format, js(["at", ["v", c.name], part[2]], o).s, o.used);
  }
  throw new Error(`unknown part ${JSON.stringify(part)}`);
}

// A top-k item's key as text (the item is `it`).
export function topShown(c, o) {
  return formatted(c.format, jsExpr(c.expr[2], o), o.used);
}

// ---------------------------------------------------------------------------------------------
// Source text.

export const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
export const escAttr = (s) => String(s).replace(/&/g, "&amp;").replace(/'/g, "&#39;");
export const tpl = (s) => String(s).replace(/[`\\]|\$\{/g, (c) => "\\" + c);
export const str = JSON.stringify;

// The helpers no formula owns (README, "Formulas are code"): the item generator's PRNG step and
// word pools, number formatting, and collection helpers that take a formula's own code as a
// function. The bundler keeps only those an app uses.
export function utilSource(spec) {
  const words = (list) => `[${list.map(str).join(", ")}]`;
  return `// Helpers that belong to no formula: the items' PRNG and word pools, number formatting and
// collection helpers that take the formula's own code as a function.

export const CATEGORIES = ${words(spec.categories)};
const ADJECTIVES = ${words(spec.itemWords.adjectives)};
const NOUNS = ${words(spec.itemWords.nouns)};
const CURRENCY = ${str(spec.currency)};

// \`count\` new items from the Park–Miller generator (one draw advances the state, then uses it):
// an adjective and a noun, a category, a quantity, a price in cents and an active flag.
export function makeItems(rng, nextId, count) {
  const items = [];
  let s = rng;
  for (let k = 0; k < count; k++) {
    s = (s * 48271) % 2147483647;
    const adjective = ADJECTIVES[s % ADJECTIVES.length];
    s = (s * 48271) % 2147483647;
    const noun = NOUNS[s % NOUNS.length];
    s = (s * 48271) % 2147483647;
    const category = CATEGORIES[s % CATEGORIES.length];
    s = (s * 48271) % 2147483647;
    const qty = 1 + (s % 99);
    s = (s * 48271) % 2147483647;
    const price = 100 + (s % 9900);
    s = (s * 48271) % 2147483647;
    items.push({ id: nextId + k, name: adjective + " " + noun, category, qty, price, active: s % 4 !== 0, note: "" });
  }
  return { items, rng: s, nextId: nextId + count };
}

// A number input holds an integer in [min, max].
export const isInt = (text, min, max) => /^-?\\d+$/.test(text) && +text >= min && +text <= max;
export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// 1234567 → "1,234,567", with a sign: -1234 → "-1,234". Cents as "€12.34".
const group = (n) => String(n).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ",");
export const grouped = (n) => (n < 0 ? "-" : "") + group(Math.abs(n));
export const money = (cents) => {
  const a = Math.abs(cents);
  return (cents < 0 ? "-" : "") + CURRENCY + group(Math.floor(a / 100)) + "." + String(a % 100).padStart(2, "0");
};

export const sumBy = (list, f) => list.reduce((s, it) => s + f(it), 0);
export const avgBy = (list, f) => (list.length ? Math.floor(sumBy(list, f) / list.length) : 0);
export const maxBy = (list, f) => (list.length ? list.reduce((m, it) => Math.max(m, f(it)), -Infinity) : 0);
export const minBy = (list, f) => (list.length ? list.reduce((m, it) => Math.min(m, f(it)), Infinity) : 0);

// The first \`k\` items by \`sign * key\`, ties by id.
export const topBy = (list, key, sign, k) =>
  list.slice().sort((a, b) => sign * (key(a) - key(b)) || a.id - b.id).slice(0, k);

// The sum of \`f\` per category, as { category: sum }.
export function groupSum(list, f) {
  const sums = {};
  for (const c of CATEGORIES) sums[c] = 0;
  for (const it of list) sums[it.category] += f(it);
  return sums;
}
`;
}
