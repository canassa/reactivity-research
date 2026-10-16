// The derived-graph scenario generator and its reference: a planning sheet of N formulas (derived
// cells) over input cells and a collection of line items, like a spreadsheet or a financial
// dashboard. Formulas read inputs, earlier formulas and aggregates over the items (totals, filtered
// counts, top-k lists, group sums); displays all over the sheet read those values.
//
// This module is the single source of truth for the scenario (see README.md). It runs both in Node
// (the CLI generates specs with it) and in the browser (the serve panel imports it alone from
// /__rr/spec.js and uses the reference `update` and `render` and the external-event builders), so
// it imports nothing.
//
// `generate(options)` returns a plain-data app spec: the units (each one formula with its new
// input, if any, and its displays), the items section, the initial state and the interaction
// script. The reference `update` and `render` are generic interpreters over the formula
// descriptions; implementations must not be (README, "Formulas are code").
//
// Prefix stability: for one seed (and one --fanout), unit i is the same at every size. Unit i is
// drawn from its own random streams and only reads what earlier units built, so growing N only
// appends units. Formulas do not depend on --fanout (their stream and their reader caps ignore
// display reads); only the displays do.
//
// Size is the number of formulas (derived cells). Rows are data: --rows sets the count of the
// "Load" button and nothing else.

export const scenario = "derived-graph";

// From N = 11 every forced capability is present (README, "The first units"); 16 is the first
// measured size above it, so baseline and slope are fitted over N >= 16.
export const steadyFrom = 16;

// The size ./rr check builds by default (and the locality check's smaller size), and the options
// it builds with: 30 rows, so the script's Load compares 30 rows, not 2,000. The code is the same
// at every --rows.
export const quickCheckSize = 16;
export const quickCheckOptions = { rows: 30 };

export const MAX_ROWS = 100000;

// Readers per value (README, "Readers per value"). Formulas are the same at every level: --fanout
// sets only how many extra display reads each unit makes (`extra`) and how many display reads one
// value accepts (`cap`, `hubCap`).
export const FANOUT = {
  low: { extra: 1, cap: 2, hubCap: 8 },
  mid: { extra: 4, cap: 5, hubCap: 24 },
  high: { extra: 10, cap: 10, hubCap: 64 },
};

// Formula readers one value accepts (independent of --fanout), and the deepest level a value may
// have and still be read by a formula (inputs and the items are level 0).
export const FORMULA_CAP = 5;
export const FORMULA_HUB_CAP = 24;
export const MAX_LEVEL = 6;

export const params = {
  rows: { default: 2000, help: "items made by the Load button: data, not size" },
  fanout: { default: "mid", help: "readers per value: low, mid or high (only displays change; formulas are the same)" },
};

export function normalizeOptions(raw = {}) {
  const size = int(raw.size ?? 16, "size");
  const seed = int(raw.seed ?? 1, "seed");
  if (size < 1) throw new Error("--size must be at least 1");
  const rows = int(raw.rows ?? 2000, "rows");
  if (rows < 4 || rows > MAX_ROWS) throw new Error(`--rows must be between 4 and ${MAX_ROWS}`);
  const fanout = String(raw.fanout ?? "mid");
  if (!FANOUT[fanout]) throw new Error(`--fanout must be one of ${Object.keys(FANOUT).join(", ")}`);
  return { size, seed, rows, fanout };
}

function int(v, name) {
  const n = Number(v);
  if (!Number.isInteger(n)) throw new Error(`--${name} must be an integer, got ${v}`);
  return n;
}

// ---------------------------------------------------------------------------------------------
// The app's own PRNG, as in big-table: a Park–Miller ("minstd") generator whose state the app
// carries (`rng`). One draw advances the state, then uses it. Every product stays below 2^47.

export const PRNG_MOD = 2147483647;
export const next = (s) => (s * 48271) % PRNG_MOD;          // s in 1 … 2147483646
export const pick = (s, list) => list[s % list.length];     // after advancing
export const between = (s, min, max) => min + (s % (max - min + 1));

// Item ranges (README, "The items"). A user can type a quantity up to QTY_MAX; the builder draws
// 1-99.
export const QTY_MAX = 999;
export const PRICE_MIN = 100, PRICE_MAX = 9999;

// One item from the PRNG state `s`, in draw order: adjective, noun, category, qty, price, active.
export function buildItem(spec, s, id) {
  s = next(s); const adj = pick(s, spec.itemWords.adjectives);
  s = next(s); const noun = pick(s, spec.itemWords.nouns);
  s = next(s); const category = pick(s, spec.categories);
  s = next(s); const qty = between(s, 1, 99);
  s = next(s); const price = between(s, PRICE_MIN, PRICE_MAX);
  s = next(s); const active = s % 4 !== 0;
  return { item: { id, name: `${adj} ${noun}`, category, qty, price, active, note: "" }, rng: s };
}

export function buildItems(spec, st, count) {
  let s = st.rng, id = st.nextId;
  const items = [];
  for (let k = 0; k < count; k++) {
    const b = buildItem(spec, s, id++);
    items.push(b.item);
    s = b.rng;
  }
  return { items, rng: s, nextId: id };
}

// ---------------------------------------------------------------------------------------------
// The generator's own seeded randomness (not part of any app).

function hash(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

export function rng(...parts) {
  let a = hash(parts.join(":"));
  const nxt = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const r = {
    next: nxt,
    int: (lo, hi) => lo + Math.floor(nxt() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(nxt() * arr.length)],
    chance: (p) => nxt() < p,
    weighted: (pairs) => {
      const total = pairs.reduce((s, [, w]) => s + w, 0);
      let x = nxt() * total;
      for (const [v, w] of pairs) if ((x -= w) < 0) return v;
      return pairs[pairs.length - 1][0];
    },
    shuffle: (arr) => {
      const a2 = arr.slice();
      for (let i = a2.length - 1; i > 0; i--) {
        const j = Math.floor(nxt() * (i + 1));
        [a2[i], a2[j]] = [a2[j], a2[i]];
      }
      return a2;
    },
    sample: (arr, n) => r.shuffle(arr).slice(0, n),
  };
  return r;
}

// ---------------------------------------------------------------------------------------------
// Vocabularies. Names are camelCase words, valid identifiers in every target language.

const CATEGORY_POOL = ["Tools", "Garden", "Kitchen", "Office", "Sports", "Toys", "Books", "Audio", "Bath", "Outdoor",
  "Travel", "Pets"];
const ITEM_ADJECTIVES = ["swift", "quiet", "bold", "bright", "calm", "eager", "gentle", "humble", "lucky", "noble",
  "proud", "rapid", "sharp", "sunny", "tidy", "vivid", "witty", "zesty", "amber", "azure", "coral", "ivory", "olive", "rusty"];
const ITEM_NOUNS = ["lamp", "kettle", "bench", "ladder", "basket", "clock", "drum", "anchor", "candle", "compass",
  "lantern", "mirror", "rocket", "saddle", "teapot", "wagon", "helmet", "blanket", "shovel", "easel", "pillow", "racket"];
const SHEET_TITLES = ["Budget plan", "Sales forecast", "Quarterly outlook", "Store dashboard", "Cost model",
  "Pricing sheet", "Revenue plan", "Inventory outlook", "Margin review", "Operating plan"];
const ITEMS_TITLES = ["Line items", "Order lines", "Stock lines", "Basket", "Products", "Catalogue"];

const QUALIFIERS = ["gross", "net", "total", "projected", "adjusted", "average", "peak", "base", "core", "weighted",
  "effective", "expected", "planned", "actual", "running", "annual", "monthly", "quarterly", "median", "target",
  "spare", "extra", "regional", "online", "retail", "bulk", "promo", "partner", "seasonal", "direct"];
const METRICS = ["revenue", "cost", "margin", "units", "orders", "fees", "tax", "share", "growth", "backlog", "spend",
  "payroll", "bonus", "refunds", "returns", "churn", "pipeline", "budget", "reserve", "capacity", "demand", "supply",
  "yield", "volume", "rebate", "freight", "duty", "stock", "credit", "debt", "income", "profit", "savings", "outlay"];
const NUM_INPUTS = ["headcount", "discount", "markupRate", "rate", "quota", "target", "threshold", "buffer", "fee",
  "deposit", "seats", "shifts", "hours", "visits", "leads", "budget", "cap", "floor", "limit", "uplift", "allowance",
  "staff", "stores", "trucks", "weeks", "days", "batches", "trials", "rounds", "slots"];
const PCT_INPUTS = ["taxRate", "vatRate", "commission", "discountRate", "growthRate", "churnRate", "royalty",
  "surcharge", "tipRate", "levy", "dutyRate", "fxSpread"];
const BOOL_INPUTS = ["includeTax", "useForecast", "roundUp", "showNet", "applyRebate", "peakSeason", "rushOrders",
  "freeShipping", "addReserve", "countReturns", "useBulk", "promoOn", "stretchGoal", "holdStock", "payBonus"];
const ENUM_INPUTS = ["scenario", "period", "plan", "tier", "mode", "channel", "region", "horizon", "basis", "stance",
  "cadence", "outlook"];
const CATEGORY_INPUTS = ["focusCategory", "spotlight", "segment", "aisle", "department", "featured", "promoCategory"];
const MODE_SETS = [["Monthly", "Quarterly", "Yearly"], ["Low", "Base", "High"], ["Cautious", "Normal", "Bold"],
  ["North", "South", "East", "West"], ["Retail", "Online", "Partner"], ["Draft", "Review", "Final"],
  ["Lean", "Standard", "Premium"], ["Spring", "Summer", "Autumn", "Winter"]];
const BOOL_WORDS = [["Yes", "No"], ["On track", "Behind"], ["Over", "Under"], ["OK", "Check"], ["High", "Low"],
  ["Above", "Below"], ["Ready", "Waiting"], ["Pass", "Fail"], ["Green", "Red"], ["Hit", "Miss"], ["Safe", "Risky"]];
const TEXT_WORDS = [["Gold", "Silver", "Bronze"], ["High", "Medium", "Low"], ["Hot", "Warm", "Cold"],
  ["Strong", "Fair", "Weak"], ["Ahead", "Even", "Behind"], ["Grow", "Hold", "Cut"], ["Buy", "Wait", "Sell"],
  ["Lead", "Match", "Lag"], ["Fast", "Steady", "Slow"], ["Wide", "Normal", "Tight"]];
const DISPLAY_TAGS = ["p", "span", "small", "strong", "em", "output", "div"];
const NOTE_WORDS = ["ok", "check", "recount", "reorder", "hold", "sale", "gift", "promo", "late", "fragile"];

// Message types that are not a sheet input's: the items section's and the external events.
export const ITEM_ROLES = ["load", "addItem", "markup", "qty", "active", "note", "remove"];
export const EXTERNAL = ["serverInputs", "serverItems", "snapshot"];
const RESERVED = new Set([...ITEM_ROLES, ...EXTERNAL, "sheet", "items", "item", "page", "unit"]);

const cap = (s) => s[0].toUpperCase() + s.slice(1);
const words = (name) => name.replace(/[A-Z]/g, (c) => " " + c.toLowerCase());
const labelOf = (name) => cap(words(name).replace(/(\D)(\d+)$/, "$1 $2"));

function tokenOf(r) {
  return Array.from({ length: 4 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[r.int(0, 35)]).join("");
}

// ---------------------------------------------------------------------------------------------
// Formatting: no locale APIs, so every language formats alike. Values are integers.

export const group = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

// `currency` values are cents; `pct` values are whole percents.
export function formatNumber(spec, format, v) {
  const sign = v < 0 ? "-" : "", a = Math.abs(v);
  switch (format) {
    case "plain": return String(v);
    case "grouped": return sign + group(a);
    case "currency": return `${sign}${spec.currency}${group(Math.floor(a / 100))}.${String(a % 100).padStart(2, "0")}`;
    case "pct": return `${v}%`;
  }
  throw new Error(`unknown number format ${format}`);
}

// ---------------------------------------------------------------------------------------------
// Expressions (README, "The formula vocabulary"). One evaluator serves the reference and the
// generator (which evaluates every new formula on a nominal state to choose its constants).
//
// `env.get(name)` is a cell's value, `env.items` the items, `item` the item in scope.

export function evaluate(e, env, item) {
  switch (e[0]) {
    case "k": return e[1];
    case "v": return env.get(e[1]);
    case "i": return item[e[1]];
    case "items": return env.items;
    case "+": { let s = 0; for (let k = 1; k < e.length; k++) s += evaluate(e[k], env, item); return s; }
    case "-": return evaluate(e[1], env, item) - evaluate(e[2], env, item);
    case "*": return evaluate(e[1], env, item) * evaluate(e[2], env, item);
    case "div": return Math.floor(evaluate(e[1], env, item) / evaluate(e[2], env, item));
    case "pct": return Math.floor((evaluate(e[1], env, item) * evaluate(e[2], env, item)) / 100);
    case "min": { let m = evaluate(e[1], env, item); for (let k = 2; k < e.length; k++) m = Math.min(m, evaluate(e[k], env, item)); return m; }
    case "max": { let m = evaluate(e[1], env, item); for (let k = 2; k < e.length; k++) m = Math.max(m, evaluate(e[k], env, item)); return m; }
    case "abs": return Math.abs(evaluate(e[1], env, item));
    case "if": return evaluate(e[1], env, item) ? evaluate(e[2], env, item) : evaluate(e[3], env, item);
    case "<": return evaluate(e[1], env, item) < evaluate(e[2], env, item);
    case "<=": return evaluate(e[1], env, item) <= evaluate(e[2], env, item);
    case ">": return evaluate(e[1], env, item) > evaluate(e[2], env, item);
    case ">=": return evaluate(e[1], env, item) >= evaluate(e[2], env, item);
    case "==": return evaluate(e[1], env, item) === evaluate(e[2], env, item);
    case "!=": return evaluate(e[1], env, item) !== evaluate(e[2], env, item);
    case "and": { for (let k = 1; k < e.length; k++) if (!evaluate(e[k], env, item)) return false; return true; }
    case "or": { for (let k = 1; k < e.length; k++) if (evaluate(e[k], env, item)) return true; return false; }
    case "not": return !evaluate(e[1], env, item);
    case "count": return evaluate(e[1], env, item).length;
    case "sum": { let s = 0; for (const it of evaluate(e[1], env, item)) s += evaluate(e[2], env, it); return s; }
    case "avg": {
      const list = evaluate(e[1], env, item);
      if (list.length === 0) return 0;
      let s = 0;
      for (const it of list) s += evaluate(e[2], env, it);
      return Math.floor(s / list.length);
    }
    case "maxOf": case "minOf": {
      const list = evaluate(e[1], env, item);
      if (list.length === 0) return 0;
      let m = evaluate(e[2], env, list[0]);
      for (let k = 1; k < list.length; k++) {
        const v = evaluate(e[2], env, list[k]);
        m = e[0] === "maxOf" ? Math.max(m, v) : Math.min(m, v);
      }
      return m;
    }
    case "filter": return evaluate(e[1], env, item).filter((it) => evaluate(e[2], env, it));
    case "top": {
      const sign = e[3] === "desc" ? -1 : 1;
      return evaluate(e[1], env, item)
        .map((it) => [evaluate(e[2], env, it), it])
        .sort((a, b) => (a[0] !== b[0] ? sign * (a[0] < b[0] ? -1 : 1) : a[1].id - b[1].id))
        .slice(0, e[4])
        .map((p) => p[1]);
    }
    case "groupSum": {
      const out = {};
      for (const c of env.categories) out[c] = 0;
      for (const it of evaluate(e[1], env, item)) out[it.category] += evaluate(e[2], env, it);
      return out;
    }
    case "at": return evaluate(e[1], env, item)[e[2]];
  }
  throw new Error(`unknown expression ${JSON.stringify(e)}`);
}

// The cells an expression reads (`["v", name]`), in first-read order, without repeats.
export function readsOf(e, out = []) {
  if (!Array.isArray(e)) return out;
  if (e[0] === "v") { if (!out.includes(e[1])) out.push(e[1]); return out; }
  if (e[0] === "k" || e[0] === "i") return out;
  for (let k = 1; k < e.length; k++) readsOf(e[k], out);
  return out;
}

export const readsItems = (e) => Array.isArray(e) && (e[0] === "items" || e.slice(1).some(readsItems));

// ---------------------------------------------------------------------------------------------
// Upper bounds of |value|, so every value stays an exact integer in a double (README, "Numbers").

const LIMIT = 2 ** 50;
const ITEM_BOUND = { qty: QTY_MAX, price: PRICE_MAX };

function itemBound(e, G) {
  switch (e[0]) {
    case "i": return ITEM_BOUND[e[1]];
    case "k": return Math.abs(e[1]);
    case "v": return G.byName.get(e[1]).bound;
    case "*": return itemBound(e[1], G) * itemBound(e[2], G);
    case "pct": return (itemBound(e[1], G) * itemBound(e[2], G)) / 100;
    case "if": return Math.max(itemBound(e[2], G), itemBound(e[3], G));
  }
  throw new Error(`no item bound for ${e[0]}`);
}

function bound(e, G) {
  switch (e[0]) {
    case "k": return typeof e[1] === "number" ? Math.abs(e[1]) : 0;
    case "v": return G.byName.get(e[1]).bound;
    case "+": case "-": return e.slice(1).reduce((s, x) => s + bound(x, G), 0);
    case "*": return bound(e[1], G) * bound(e[2], G);
    case "div": return bound(e[1], G);
    case "pct": return (bound(e[1], G) * bound(e[2], G)) / 100;
    case "min": case "max": return Math.max(...e.slice(1).map((x) => bound(x, G)));
    case "abs": return bound(e[1], G);
    case "if": return Math.max(bound(e[2], G), bound(e[3], G));
    case "count": return 2 * MAX_ROWS;
    case "sum": return 2 * MAX_ROWS * itemBound(e[2], G);
    case "avg": case "maxOf": case "minOf": return itemBound(e[2], G);
    case "at": return G.byName.get(e[1][1]).bound;
  }
  return 0;
}

// ---------------------------------------------------------------------------------------------
// Generation.

// What the first units always are (README, "The first units"), so the work and bench actions find
// the same targets, with the same downstream closures, at every size from 11 up.
export const FORCED = [
  "total: sum of qty × price over the items (a hub)",
  "hub input (a percent with raise, lower and a number input) and tax = pct(total, hub input) (a hub)",
  "chain input (closed) and chain1 over it and tax (closed)",
  "chain2 over chain1 and total (closed)",
  "chain3 over chain2 and chain1 (closed)",
  "cut-off input (closed) and a bool comparing it to a constant (closed)",
  "filter select over the categories (closed) and the items of that category (closed)",
  "toggle (closed) and a number over the filtered items and the cut-off bool (closed)",
  "threshold input (closed) and the top 5 items by price among those with qty >= threshold (closed)",
  "group sums of qty × price per category (a hub)",
  "count of the active items (a hub)",
];

export function generate(rawOptions) {
  const options = normalizeOptions(rawOptions);
  const { size, seed, rows, fanout } = options;
  const r0 = rng("sheet", seed);
  const spec = {
    scenario, options,
    token: tokenOf(r0),
    currency: r0.pick(["$", "€", "£"]),
    categories: r0.sample(CATEGORY_POOL, 5),
    itemWords: { adjectives: r0.sample(ITEM_ADJECTIVES, 10), nouns: r0.sample(ITEM_NOUNS, 10) },
    noteWords: r0.sample(NOTE_WORDS, 4),
    rng: r0.int(1, PRNG_MOD - 1),
    initialItems: 6,
    markup: { min: 0, max: 100, initial: r0.int(5, 40) },
  };
  spec.title = `${r0.pick(SHEET_TITLES)} ${spec.token}`;
  spec.itemsTitle = r0.pick(ITEMS_TITLES);
  spec.loadText = `Load ${group(rows)} items`;

  // The nominal state formulas' constants are chosen on: the initial inputs and 1,000 items from
  // a fixed stream (independent of --rows, so the code never depends on the data).
  const nominal = buildItems(spec, { rng: rng("nominal", seed).int(1, PRNG_MOD - 1), nextId: 1 }, 1000).items;
  const G = {
    spec, fanout: FANOUT[fanout], cells: [], byName: new Map(), names: new Set(RESERVED), tokens: new Set([spec.token]),
    formulaReaders: new Map(), displayReaders: new Map(), values: new Map(),
  };
  G.env = { items: nominal, categories: spec.categories, get: (n) => G.values.get(n) };

  spec.units = [];
  spec.forced = {};
  for (let i = 0; i < size; i++) spec.units.push(buildUnit(G, i, seed, fanout));

  const init = buildItems(spec, { rng: spec.rng, nextId: 1 }, spec.initialItems);
  const inputs = {};
  for (const c of inputCells(spec)) inputs[c.name] = c.initial;
  spec.initialState = { inputs, markup: spec.markup.initial, items: init.items, nextId: init.nextId, rng: init.rng };
  spec.script = makeScript(spec);
  return spec;
}

export const inputCells = (spec) => spec.units.flatMap((u) => u.inputs);
export const formulaCells = (spec) => spec.units.map((u) => u.cell);
export const cellOf = (spec, name) => spec.units.flatMap((u) => [...u.inputs, u.cell]).find((c) => c.name === name);
export const messageOf = (spec, name) => spec.units.flatMap((u) => u.messages).find((m) => m.name === name);

function uniqueName(G, base) {
  let n = base;
  for (let k = 2; G.names.has(n); k++) n = `${base}${k}`;
  G.names.add(n);
  return n;
}

function uniqueToken(G, r) {
  for (;;) {
    const t = tokenOf(r);
    if (!G.tokens.has(t)) { G.tokens.add(t); return t; }
  }
}

// Round to two significant digits (a readable constant), at least 1 in magnitude.
function roundish(v) {
  const a = Math.abs(v);
  if (a < 10) return Math.round(v);
  const p = 10 ** (Math.floor(Math.log10(a)) - 1);
  return Math.round(v / p) * p;
}
const near = (r, v) => roundish(v * r.pick([0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5]));

function addCell(G, c) {
  G.cells.push(c);
  G.byName.set(c.name, c);
  G.formulaReaders.set(c.name, 0);
  G.displayReaders.set(c.name, 0);
  G.values.set(c.name, c.kind === "input" ? c.initial : evaluate(c.expr, G.env));
  return c;
}

// --- Inputs ----------------------------------------------------------------------------------

function newInput(G, r, unit, type, opts = {}) {
  const c = { name: null, kind: "input", type, level: 0, unit, hub: !!opts.hub, closed: !!opts.closed };
  if (type === "num") {
    const pct = opts.pct ?? r.chance(0.3);
    c.name = uniqueName(G, opts.name || r.pick(pct ? PCT_INPUTS : NUM_INPUTS));
    c.format = pct ? "pct" : "plain";
    c.min = opts.min ?? (r.chance(0.8) ? 0 : -r.pick([10, 20, 50]));
    c.max = opts.max ?? (pct ? r.pick([30, 50, 100]) : r.pick([20, 50, 100, 250, 500, 1000]));
    c.initial = opts.initial ?? r.int(Math.max(c.min, 1), Math.max(2, Math.floor(c.max / 2)));
    c.bound = Math.max(Math.abs(c.min), Math.abs(c.max));
  } else if (type === "bool") {
    c.name = uniqueName(G, opts.name || r.pick(BOOL_INPUTS));
    c.initial = opts.initial ?? r.chance(0.5);
    c.words = r.pick(BOOL_WORDS);
  } else {
    const categories = opts.categories ?? r.chance(0.4);
    c.name = uniqueName(G, opts.name || r.pick(categories ? CATEGORY_INPUTS : ENUM_INPUTS));
    c.options = categories ? G.spec.categories.slice() : r.pick(MODE_SETS).slice();
    c.categories = categories;
    c.initial = opts.initial ?? r.pick(c.options);
  }
  c.label = labelOf(c.name);
  return addCell(G, c);
}

// The controls of an input and the messages they send (README, "Inputs").
function inputControls(G, r, c, opts = {}) {
  const C = cap(c.name), messages = [], view = [];
  if (c.type === "num") {
    const numberInput = opts.numberInput ?? r.chance(0.7);
    const buttons = opts.buttons ?? (numberInput ? r.int(0, 2) : r.int(1, 2));
    const step = opts.step ?? r.pick([1, 1, 2, 5, 10].filter((k) => k <= Math.floor((c.max - c.min) / 4)) .concat([1]));
    const nodes = [];
    if (numberInput) {
      messages.push({ name: `set${C}`, kind: "input", cell: c.name });
      nodes.push({ el: "input", msg: `set${C}`, label: c.label });
    }
    const btn = [];
    if (buttons >= 1) {
      messages.push({ name: `raise${C}`, kind: "add", cell: c.name, k: step });
      btn.push({ el: "button", msg: `raise${C}`, text: `+${step}` });
    }
    if (buttons >= 2) {
      messages.push({ name: `lower${C}`, kind: "add", cell: c.name, k: -step });
      btn.push({ el: "button", msg: `lower${C}`, text: `−${step}` });
    }
    if (!numberInput) nodes.push({ el: "text", tag: "span", parts: [`${c.label}: `, ["v", c.name]], control: true });
    view.push(...nodes, ...btn);
  } else if (c.type === "bool") {
    messages.push({ name: `toggle${C}`, kind: "check", cell: c.name });
    view.push({ el: "check", msg: `toggle${C}`, label: c.label });
  } else {
    messages.push({ name: `pick${C}`, kind: "select", cell: c.name });
    view.push({ el: "select", msg: `pick${C}`, label: c.label });
  }
  return { messages, view };
}

// --- Choosing what a formula reads ------------------------------------------------------------

const formulaCap = (c) => (c.hub ? FORMULA_HUB_CAP : FORMULA_CAP);
const displayCap = (G, c) => (c.hub ? G.fanout.hubCap : G.fanout.cap);

function eligible(G, c, types) {
  return !c.closed && c.level < MAX_LEVEL && G.formulaReaders.get(c.name) < formulaCap(c) && (!types || types.includes(c.type));
}

// Up to `k` distinct operands of the given types, from every earlier value (no locality window),
// weighted towards hubs and deeper values (README, "The graph").
function pickOperands(G, r, k, types, except = []) {
  const out = [];
  const typeWeight = { num: 3, bool: 1, enum: 1, text: 1, list: 1, top: 0.5, group: 0.7 };
  for (let n = 0; n < k; n++) {
    const pool = G.cells.filter((c) => eligible(G, c, types) && !out.includes(c) && !except.includes(c));
    if (pool.length === 0) break;
    out.push(r.weighted(pool.map((c) => [c, (c.hub ? 6 : 1) * (1 + c.level) * (typeWeight[c.type] ?? 1)])));
  }
  return out;
}

// Cells a scalar formula reads (before eligibility trims it): mean 3.8, 17% read 6 or more.
const FAN_IN = [[1, 10], [2, 25], [3, 25], [4, 15], [5, 8], [6, 6], [8, 5], [10, 3], [12, 3]];

// --- Building expressions -----------------------------------------------------------------------

const nominalOf = (G, e) => evaluate(e, G.env);

// A num term reading cell `c`.
function numTerm(G, r, c) {
  const v = ["v", c.name];
  switch (c.type) {
    case "num": {
      const b = c.bound;
      return r.weighted([
        [v, 50],
        [b * 9 < LIMIT / 64 ? ["*", v, ["k", r.int(2, 9)]] : v, 14],
        [["div", v, ["k", r.int(2, 10)]], 10],
        [["pct", v, ["k", r.pick([5, 10, 15, 20, 25, 40, 60, 75, 90, 110, 120, 150])]], 12],
        [["abs", v], 4],
        [["-", ["k", roundish(Math.abs(G.values.get(c.name)) + 10)], v], 10],
      ]);
    }
    case "bool": return ["if", v, ["k", r.int(1, 50)], ["k", r.int(0, 20)]];
    case "enum": case "text": {
      const opts = c.options || c.values;
      return ["if", ["==", v, ["k", r.pick(opts)]], ["k", r.int(1, 60)], ["k", r.int(0, 30)]];
    }
    case "list": case "top": return r.chance(0.6) ? ["count", v] : ["sum", v, itemNumExpr(G, r, [])];
    case "group": return ["at", v, r.pick(G.spec.categories)];
  }
  throw new Error(`no term for ${c.type}`);
}

// A bool clause reading cell `c`.
function boolClause(G, r, c) {
  const v = ["v", c.name];
  switch (c.type) {
    case "bool": return r.chance(0.7) ? v : ["not", v];
    case "enum": case "text": return [r.chance(0.75) ? "==" : "!=", v, ["k", r.pick(c.options || c.values)]];
    default: {
      const t = numTerm(G, r, c);
      return [r.pick([">", ">=", "<", "<="]), t, ["k", near(r, nominalOf(G, t))]];
    }
  }
}

function combineNum(G, r, terms) {
  if (terms.length === 1) {
    const t = terms[0];
    return r.weighted([[t, 3], [["+", t, ["k", r.int(1, 99)]], 3], [["max", t, ["k", near(r, nominalOf(G, t))]], 2], [["min", t, ["k", near(r, nominalOf(G, t))]], 2]]);
  }
  if (terms.length >= 5 && r.chance(0.6)) return ["+", ...terms];
  const list = terms.slice();
  while (list.length > 1) {
    const i = r.int(0, list.length - 2);
    const [a, b] = [list[i], list[i + 1]];
    const op = r.weighted([["+", 45], ["-", 20], ["max", 10], ["min", 10], ["pos", 15]]);
    const e = op === "pos" ? ["if", [">", a, b], ["-", a, b], ["k", 0]] : [op, a, b];
    list.splice(i, 2, e);
  }
  return list[0];
}

function combineBool(r, clauses) {
  const list = clauses.slice();
  while (list.length > 1) {
    const n = Math.min(list.length, r.int(2, 3));
    const i = r.int(0, list.length - n);
    list.splice(i, n, [r.chance(0.6) ? "and" : "or", ...list.slice(i, i + n)]);
  }
  return list[0];
}

// An item-level number, optionally reading a scalar percent cell from `scalars`.
function itemNumExpr(G, r, scalars) {
  const pctCell = scalars.find((c) => c.type === "num" && c.bound <= 1000);
  const opts = [
    [["i", "qty"], 3], [["i", "price"], 3], [["*", ["i", "qty"], ["i", "price"]], 4],
    [["if", ["i", "active"], ["i", "qty"], ["k", 0]], 1],
  ];
  if (pctCell) return ["pct", r.chance(0.5) ? ["i", "price"] : ["*", ["i", "qty"], ["i", "price"]], ["v", pctCell.name]];
  return r.weighted(opts);
}

const itemFormat = (e) => {
  const s = JSON.stringify(e);
  return s.includes('"price"') ? "currency" : "grouped";
};

// An item-level bool, from item fields alone or reading scalar cells.
function itemClause(G, r, c) {
  if (!c) {
    return r.weighted([
      [["i", "active"], 3], [["not", ["i", "active"]], 1],
      [["==", ["i", "category"], ["k", r.pick(G.spec.categories)]], 3],
      [[r.pick([">", ">=", "<"]), ["i", "qty"], ["k", r.int(10, 90)]], 2],
      [[r.pick([">", "<="]), ["i", "price"], ["k", roundish(r.int(PRICE_MIN, PRICE_MAX))]], 2],
    ]);
  }
  const v = ["v", c.name];
  switch (c.type) {
    case "num": {
      const field = Math.abs(G.values.get(c.name)) <= 120 ? "qty" : "price";
      return [r.pick([">", ">=", "<", "<="]), ["i", field], v];
    }
    case "bool": return ["or", ["not", v], ["i", "active"]];
    case "enum": return c.categories ? ["==", ["i", "category"], v] : ["or", ["==", v, ["k", r.pick(c.options)]], ["i", "active"]];
    case "text": return ["or", ["==", v, ["k", r.pick(c.values)]], ["not", ["i", "active"]]];
  }
  throw new Error(`no item clause over ${c.type}`);
}

function itemPredicate(G, r, scalars) {
  const clauses = scalars.map((c) => itemClause(G, r, c));
  if (clauses.length === 0 || r.chance(0.4)) clauses.push(itemClause(G, r, null));
  return combineBool(r, clauses);
}

const SCALAR_TYPES = ["num", "bool", "enum", "text"];

// --- Units ------------------------------------------------------------------------------------

function buildUnit(G, i, seed, fanout) {
  const r = rng("unit", seed, i);
  const unit = { index: i, inputs: [], messages: [], view: [] };
  const f = G.spec.forced;
  const control = (c, opts) => {
    const k = inputControls(G, r, c, opts);
    unit.messages.push(...k.messages);
    unit.view.push(...k.view);
  };
  const input = (type, opts = {}, controls = {}) => {
    const c = newInput(G, r, i, type, opts);
    unit.inputs.push(c);
    control(c, controls);
    return c;
  };
  const forcedDisplays = [];
  let cell;
  const formula = (type, expr, extra = {}) => {
    const reads = readsOf(expr);
    const level = 1 + Math.max(0, ...reads.map((n) => G.byName.get(n).level));
    const name = uniqueName(G, extra.name || `${r.pick(QUALIFIERS)}${cap(r.pick(METRICS))}`);
    const c = { name, label: labelOf(name), token: uniqueToken(G, r), kind: "formula", type, expr, level, unit: i, hub: !!extra.hub, closed: !!extra.closed };
    if (type === "num") { c.format = extra.format; c.bound = bound(expr, G); }
    if (type === "bool") c.words = extra.words || r.pick(BOOL_WORDS);
    if (type === "text") c.values = extra.values;
    if (type === "group") { c.format = extra.format; c.bound = bound(["sum", ["items"], expr[2]], G); }
    if (type === "top") c.format = itemFormat(expr[2]);
    if (c.bound !== undefined && !(c.bound < LIMIT)) throw new Error(`unit ${i}: value bound ${c.bound} too large`);
    for (const n of reads) G.formulaReaders.set(n, G.formulaReaders.get(n) + 1);
    return addCell(G, c);
  };

  switch (i) {
    case 0:
      cell = formula("num", ["sum", ["items"], ["*", ["i", "qty"], ["i", "price"]]], { name: r.pick(["grossRevenue", "totalSales", "orderValue", "grossSales"]), format: "currency", hub: true });
      f.total = cell.name;
      break;
    case 1: {
      const h = input("num", { pct: true, hub: true, min: 0, max: 40, initial: r.int(5, 20), name: r.pick(PCT_INPUTS) }, { numberInput: true, buttons: 2, step: 1 });
      cell = formula("num", ["pct", ["v", f.total], ["v", h.name]], { name: r.pick(["taxDue", "levyDue", "dutyOwed", "taxAmount"]), format: "currency", hub: true });
      Object.assign(f, { hubInput: h.name, hubCell: cell.name });
      break;
    }
    case 2: {
      const l = input("num", { pct: false, closed: true, name: r.pick(["unitsPlanned", "crewSize", "baseOrders", "planUnits"]), min: 0, max: 500, initial: r.int(20, 200) }, { numberInput: true, buttons: 0 });
      cell = formula("num", ["+", ["*", ["v", l.name], ["k", r.int(50, 400)]], ["div", ["v", f.hubCell], ["k", r.int(2, 9)]]], { format: "currency", closed: true });
      Object.assign(f, { chainInput: l.name, chain: [cell.name] });
      forcedDisplays.push([cell], [cell]);
      break;
    }
    case 3:
      cell = formula("num", ["max", ["-", ["v", f.chain[0]], ["k", roundish(r.int(1000, 20000))]], ["div", ["v", f.total], ["k", r.int(20, 80)]]], { format: "currency", closed: true });
      f.chain.push(cell.name);
      forcedDisplays.push([cell]);
      break;
    case 4:
      cell = formula("num", ["+", ["v", f.chain[1]], ["*", ["v", f.chain[0]], ["k", r.int(2, 5)]]], { format: "currency", closed: true });
      f.chain.push(cell.name);
      forcedDisplays.push([cell], [cell, G.byName.get(f.chain[0])]);
      break;
    case 5: {
      const k = r.int(30, 60);
      const c = input("num", { pct: false, closed: true, name: r.pick(["confidence", "readiness", "healthScore", "riskScore"]), min: 0, max: 100, initial: k + r.int(10, 25) }, { numberInput: true, buttons: 0 });
      cell = formula("bool", [">=", ["v", c.name], ["k", k]], { closed: true });
      Object.assign(f, { cutoffInput: c.name, cutoffCell: cell.name, cutoffAt: k });
      forcedDisplays.push([cell], [cell], [cell]);
      break;
    }
    case 6: {
      const e = input("enum", { categories: true, closed: true, name: r.pick(["focusCategory", "spotlight", "showCategory"]), initial: G.spec.categories[1] });
      cell = formula("list", ["filter", ["items"], ["==", ["i", "category"], ["v", e.name]]], { closed: true });
      Object.assign(f, { filterInput: e.name, filterCell: cell.name });
      forcedDisplays.push([cell]);
      break;
    }
    case 7: {
      const t = input("bool", { closed: true, name: r.pick(["countUnits", "sumUnits", "byUnits"]), initial: true });
      cell = formula("num", ["if", ["v", f.cutoffCell], ["if", ["v", t.name], ["sum", ["v", f.filterCell], ["i", "qty"]], ["count", ["v", f.filterCell]]], ["k", 0]], { format: "grouped", closed: true });
      Object.assign(f, { toggleInput: t.name, toggleCell: cell.name });
      forcedDisplays.push([cell]);
      break;
    }
    case 8: {
      const k = input("num", { pct: false, closed: true, name: r.pick(["minQty", "qtyFloor", "bulkFrom"]), min: 0, max: 99, initial: r.int(40, 70) }, { numberInput: true, buttons: 0 });
      cell = formula("top", ["top", ["filter", ["items"], [">=", ["i", "qty"], ["v", k.name]]], ["i", "price"], "desc", 5], { closed: true, name: r.pick(["topPrices", "priciest", "bigTickets"]) });
      Object.assign(f, { thresholdInput: k.name, topCell: cell.name });
      break;
    }
    case 9:
      cell = formula("group", ["groupSum", ["items"], ["*", ["i", "qty"], ["i", "price"]]], { format: "currency", hub: true, name: r.pick(["salesByCategory", "categoryTotals", "byCategory"]) });
      f.groupCell = cell.name;
      break;
    case 10:
      cell = formula("num", ["count", ["filter", ["items"], ["i", "active"]]], { format: "plain", hub: true, name: r.pick(["activeLines", "liveItems", "activeCount"]) });
      f.activeCell = cell.name;
      break;
    default:
      cell = generatedFormula(G, r, i, input, formula);
  }
  unit.cell = cell;

  // The primary display, then the forced displays of closed cells, then the extra displays.
  unit.view.push(...primaryDisplay(G, r, cell));
  for (const reads of forcedDisplays) unit.view.push(displayNode(G, r, reads));
  for (const n of unit.view) countDisplayReads(G, n);
  const extras = extraDisplays(G, rng("display", seed, fanout, i));
  for (const n of extras) countDisplayReads(G, n);
  unit.view.push(...extras);
  for (const m of unit.messages) G.names.add(m.name);
  return unit;
}

function generatedFormula(G, r, i, input, formula) {
  // A new input in half the units; the formula then reads it.
  let own = null;
  if (r.chance(0.5)) {
    const type = r.weighted([["num", 6], ["bool", 2], ["enum", 2]]);
    own = input(type, { hub: r.chance(0.08) });
  }
  const hub = r.chance(0.1);
  const kind = r.weighted([["num", 42], ["bool", 12], ["text", 8], ["agg", 20], ["list", 8], ["top", 5], ["group", 5]]);

  if (kind === "num" || kind === "bool" || kind === "text") {
    const k = r.weighted(FAN_IN);
    let ops = own ? [own, ...pickOperands(G, r, k - 1, null, [own])] : pickOperands(G, r, k, null);
    if (ops.length === 0) ops = [input("num")];
    if (kind === "num") {
      let expr = combineNum(G, r, ops.map((c) => numTerm(G, r, c)));
      if (!(bound(expr, G) < LIMIT)) expr = ["max", ...ops.map((c) => ["v", c.name]).filter((x) => G.byName.get(x[1]).type === "num"), ["k", 0]];
      if (!(bound(expr, G) < LIMIT)) expr = ["count", ["items"]];
      // The format of the first number read (a percent input's becomes plain once combined).
      const firstNum = ops.find((c) => c.type === "num");
      return formula("num", expr, { format: !firstNum || firstNum.format === "pct" ? "plain" : firstNum.format, hub });
    }
    const clauses = ops.map((c) => boolClause(G, r, c));
    if (kind === "bool") return formula("bool", combineBool(r, clauses), { hub });
    const values = r.pick(TEXT_WORDS);
    const two = clauses.length >= 2 && r.chance(0.6);
    const split = two ? r.int(1, clauses.length - 1) : clauses.length;
    const c1 = combineBool(r, clauses.slice(0, split));
    const expr = two ? ["if", c1, ["k", values[0]], ["if", combineBool(r, clauses.slice(split)), ["k", values[1]], ["k", values[2]]]]
      : ["if", c1, ["k", values[0]], ["k", values[r.int(1, 2)]]];
    return formula("text", expr, { values: two ? values : [values[0], expr[3][1]], hub });
  }

  // Over the collection: the items, or an earlier list.
  const fromList = r.chance(0.3) ? pickOperands(G, r, 1, ["list"])[0] : null;
  const source = fromList ? ["v", fromList.name] : ["items"];
  const nScalars = own ? 0 : r.weighted([[0, 4], [1, 4], [2, 2]]);
  const scalars = (own ? [own] : []).concat(pickOperands(G, r, nScalars, SCALAR_TYPES, fromList ? [fromList] : []));
  // A percent input among the scalars may scale the item values instead of filtering.
  const pctCell = scalars.find((c) => c.type === "num" && c.bound <= 1000 && r.chance(0.4));
  const filterBy = scalars.filter((c) => c !== pctCell);
  const value = itemNumExpr(G, r, pctCell ? [pctCell] : []);
  const wantPred = filterBy.length > 0 || r.chance(fromList ? 0.3 : 0.6) || kind === "list";
  const src = wantPred ? ["filter", source, itemPredicate(G, r, filterBy)] : source;
  if (kind === "agg") {
    const agg = r.weighted([["sum", 35], ["count", 20], ["avg", 15], ["maxOf", 15], ["minOf", 15]]);
    const expr = agg === "count" ? (pctCell ? ["sum", src, value] : ["count", src]) : [agg, src, value];
    return formula("num", expr, { format: expr[0] === "count" ? "plain" : itemFormat(value), hub });
  }
  if (kind === "list") return formula("list", src, { hub });
  if (kind === "top") return formula("top", ["top", src, value, r.chance(0.7) ? "desc" : "asc", r.int(3, 6)], { hub });
  return formula("group", ["groupSum", src, value], { format: itemFormat(value), hub });
}

// --- Displays ---------------------------------------------------------------------------------

// A display part reading cell `c`: its value, a list's count, or one category of a group.
function readPart(G, r, c) {
  if (c.type === "list" || c.type === "top") return ["count", c.name];
  if (c.type === "group") return ["at", c.name, r.pick(G.spec.categories)];
  return ["v", c.name];
}

const partLabel = (G, c, part) =>
  part[0] === "count" ? `${c.label} count` : part[0] === "at" ? `${c.label} (${part[2]})` : c.label;

function displayNode(G, r, cells) {
  const parts = [];
  cells.forEach((c, k) => {
    const p = readPart(G, r, c);
    if (k > 0) parts.push(r.pick([" · ", " / ", "; ", " vs "]));
    parts.push(`${partLabel(G, c, p)}${r.pick([": ", " = ", " "])}`, p);
  });
  if (r.chance(0.2)) parts.push(r.pick([" so far", " now", " today", " (est.)", " in plan"]));
  return { el: "text", tag: r.pick(DISPLAY_TAGS), parts };
}

// The display of the unit's own formula, carrying the formula's token.
function primaryDisplay(G, r, c) {
  const head = `${c.label} ${c.token}`;
  if (c.type === "top") return [{ el: "text", tag: "p", parts: [head] }, { el: "top", cell: c.name, tag: r.pick(["ol", "ul"]) }];
  if (c.type === "group") return [{ el: "text", tag: "p", parts: [head] }, { el: "groups", cell: c.name }];
  if (c.type === "list") return [{ el: "text", tag: r.pick(DISPLAY_TAGS), parts: [`${head}: `, ["count", c.name], r.pick([" items", " lines", " matches"])] }];
  return [{ el: "text", tag: r.pick(DISPLAY_TAGS), parts: [`${head}: `, ["v", c.name]] }];
}

// The extra displays of a unit: `extra` reads of earlier values (or its own), packed 1-3 to a
// display, each value read by at most its display cap.
function extraDisplays(G, r) {
  const out = [];
  let left = G.fanout.extra;
  const used = new Map();
  while (left > 0) {
    const n = Math.min(left, r.weighted([[1, 5], [2, 3], [3, 2]]));
    const cells = [];
    for (let k = 0; k < n; k++) {
      const pool = G.cells.filter((c) => !c.closed && !cells.includes(c) && G.displayReaders.get(c.name) + (used.get(c.name) || 0) < displayCap(G, c));
      if (pool.length === 0) break;
      const c = r.weighted(pool.map((x) => [x, x.hub ? 8 : 1]));
      cells.push(c);
      used.set(c.name, (used.get(c.name) || 0) + 1);
    }
    left -= n;
    if (cells.length) out.push(displayNode(G, r, cells));
  }
  return out;
}

// Display reads count once per display node and value (a control's own value text included).
function countDisplayReads(G, n) {
  const names = new Set();
  if (n.el === "text") for (const p of n.parts) if (Array.isArray(p)) names.add(p[1]);
  if (n.el === "top" || n.el === "groups") names.add(n.cell);
  for (const name of names) G.displayReaders.set(name, G.displayReaders.get(name) + 1);
}

// ---------------------------------------------------------------------------------------------
// Graph statistics (README, "The graph"): readers per value, fan-in, depth.

export function graphStats(spec) {
  const inputs = inputCells(spec), cells = formulaCells(spec), all = [...inputs, ...cells];
  const fr = new Map(all.map((c) => [c.name, 0])), dr = new Map(all.map((c) => [c.name, 0]));
  for (const c of cells) for (const n of readsOf(c.expr)) fr.set(n, fr.get(n) + 1);
  for (const u of spec.units) for (const n of u.view) {
    const names = new Set();
    if (n.el === "text") for (const p of n.parts) if (Array.isArray(p)) names.add(p[1]);
    if (n.el === "top" || n.el === "groups") names.add(n.cell);
    for (const name of names) dr.set(name, dr.get(name) + 1);
  }
  const summary = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    return { mean: +(s.reduce((a, b) => a + b, 0) / (s.length || 1)).toFixed(2), median: s[Math.floor((s.length - 1) / 2)] ?? 0, max: s[s.length - 1] ?? 0 };
  };
  const total = all.map((c) => fr.get(c.name) + dr.get(c.name));
  const fanIn = cells.map((c) => readsOf(c.expr).length + (readsItems(c.expr) ? 1 : 0));
  const depth = {};
  for (const c of cells) depth[c.level] = (depth[c.level] || 0) + 1;
  const types = {};
  for (const c of cells) {
    const t = c.type === "num" && readsItems(c.expr) ? "aggregate" : c.type;
    types[t] = (types[t] || 0) + 1;
  }
  return {
    size: spec.options.size, fanout: spec.options.fanout, inputs: inputs.length, formulas: cells.length,
    displays: spec.units.reduce((s, u) => s + u.view.filter((n) => n.el === "text" || n.el === "top" || n.el === "groups").length, 0),
    hubs: all.filter((c) => c.hub).length, closed: all.filter((c) => c.closed).length,
    readers: { formula: summary(all.map((c) => fr.get(c.name))), display: summary(all.map((c) => dr.get(c.name))), total: summary(total) },
    readersOfHubs: summary(all.filter((c) => c.hub).map((c) => fr.get(c.name) + dr.get(c.name))),
    fanIn: { ...summary(fanIn), wide: fanIn.filter((x) => x >= 6).length },
    readItems: cells.filter((c) => readsItems(c.expr)).length,
    depth, types,
  };
}

// ---------------------------------------------------------------------------------------------
// Reference: update.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// A number input sends its message only while it holds an integer in [min, max]
// (README, "Number inputs"); the message carries the number.
export function validNumber(text, min, max) {
  if (!/^-?\d+$/.test(text.trim())) return null;
  const n = Number(text);
  return n >= min && n <= max ? n : null;
}

function setItem(state, id, fn) {
  const at = state.items.findIndex((it) => it.id === id);
  if (at < 0) throw new Error(`no item ${id}`);
  const items = state.items.slice();
  items[at] = fn(items[at]);
  return { ...state, items };
}

export function update(spec, state, msg) {
  switch (msg.type) {
    case "snapshot": return msg.state;
    case "serverInputs": {
      const inputs = { ...state.inputs };
      for (const [k, v] of Object.entries(msg.values)) if (k in inputs) inputs[k] = v;
      return { ...state, inputs };
    }
    case "serverItems": {
      const byId = new Map(msg.upsert.map((it) => [it.id, it]));
      const gone = new Set(msg.remove);
      const items = state.items.filter((it) => !gone.has(it.id)).map((it) => byId.get(it.id) || it);
      const known = new Set(state.items.map((it) => it.id));
      for (const it of msg.upsert) if (!known.has(it.id) && !gone.has(it.id)) items.push(it);
      const maxId = msg.upsert.reduce((m, it) => Math.max(m, it.id), 0);
      return { ...state, items, nextId: Math.max(state.nextId, maxId + 1) };
    }
    case "load": {
      const b = buildItems(spec, state, spec.options.rows);
      return { ...state, items: b.items, rng: b.rng, nextId: b.nextId };
    }
    case "addItem": {
      const b = buildItems(spec, state, 1);
      return { ...state, items: state.items.concat(b.items), rng: b.rng, nextId: b.nextId };
    }
    case "markup": return { ...state, markup: msg.value };
    case "qty": return setItem(state, msg.id, (it) => ({ ...it, qty: msg.value }));
    case "active": return setItem(state, msg.id, (it) => ({ ...it, active: !it.active }));
    case "note": return setItem(state, msg.id, (it) => ({ ...it, note: msg.value }));
    case "remove": return { ...state, items: state.items.filter((it) => it.id !== msg.id) };
  }
  const m = messageOf(spec, msg.type);
  if (!m) throw new Error(`no message ${msg.type}`);
  const c = cellOf(spec, m.cell);
  const cur = state.inputs[c.name];
  let v;
  switch (m.kind) {
    case "input": case "select": v = msg.value; break;
    case "add": v = clamp(cur + m.k, c.min, c.max); break;
    case "check": v = !cur; break;
    default: throw new Error(`unknown message kind ${m.kind}`);
  }
  return v === cur ? state : { ...state, inputs: { ...state.inputs, [c.name]: v } };
}

// ---------------------------------------------------------------------------------------------
// Reference: render. Returns a tree of { tag, attrs, props, children } and strings. `attrs` are
// HTML attributes; `props` are live DOM properties (input value, checked, select value).

export function h(tag, attrs, ...children) {
  const a = {};
  const props = {};
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if ((k === "value" && (tag === "input" || tag === "select")) || k === "checked") props[k] = v;
    else a[k] = v === true ? "" : String(v);
  }
  return { tag, attrs: a, props, children: children.flat(Infinity).filter((c) => c != null && c !== false).map((c) => (typeof c === "object" ? c : String(c))) };
}

// Every cell's value in `state`, in unit order (each formula evaluated once).
export function evaluateAll(spec, state) {
  const values = new Map(Object.entries(state.inputs));
  const env = { items: state.items, categories: spec.categories, get: (n) => values.get(n) };
  for (const u of spec.units) values.set(u.cell.name, evaluate(u.cell.expr, env));
  return { values, env };
}

export function render(spec, state) {
  const { values, env } = evaluateAll(spec, state);
  const cells = new Map(spec.units.flatMap((u) => [...u.inputs, u.cell]).map((c) => [c.name, c]));
  const show = (part) => {
    const c = cells.get(part[1]);
    const v = values.get(part[1]);
    if (part[0] === "count") return String(v.length);
    if (part[0] === "at") return formatNumber(spec, c.format, v[part[2]]);
    if (c.type === "num") return formatNumber(spec, c.format, v);
    if (c.type === "bool") return c.words[v ? 0 : 1];
    return v;
  };
  const node = (n) => {
    switch (n.el) {
      case "text": return h(n.tag, null, n.parts.map((p) => (typeof p === "string" ? p : show(p))).join(""));
      case "input": return h("label", null, n.label, h("input", { type: "number", "data-role": n.msg, value: String(values.get(messageOf(spec, n.msg).cell)) }));
      case "button": return h("button", { "data-role": n.msg }, n.text);
      case "check": return h("label", null, h("input", { type: "checkbox", "data-role": n.msg, checked: values.get(messageOf(spec, n.msg).cell) }), n.label);
      case "select": {
        const c = cells.get(messageOf(spec, n.msg).cell);
        return h("label", null, n.label, h("select", { "data-role": n.msg, value: values.get(c.name) }, c.options.map((o) => h("option", { value: o }, o))));
      }
      case "top": {
        const c = cells.get(n.cell);
        return h(n.tag, { "data-role": n.cell }, values.get(n.cell).map((it) =>
          h("li", { "data-key": it.id, "data-role": `${n.cell}Item` }, `${it.name}: ${formatNumber(spec, c.format, evaluate(c.expr[2], env, it))}`)));
      }
      case "groups": {
        const c = cells.get(n.cell), g = values.get(n.cell);
        return h("ul", { "data-role": n.cell }, spec.categories.map((cat) =>
          h("li", { "data-key": cat, "data-role": `${n.cell}Row` }, `${cat}: ${formatNumber(spec, c.format, g[cat])}`)));
      }
    }
    throw new Error(`unknown view node ${n.el}`);
  };
  return h("div", { "data-role": "page" },
    h("section", { "data-key": "sheet", "data-role": "sheet" }, h("h2", null, spec.title), spec.units.map((u) => h("div", null, u.view.map(node)))),
    renderItems(spec, state));
}

export const ITEM_HEADERS = ["Item", "Category", "Qty", "Price", "Line", "With markup", "Active", "Note", ""];

export function renderItems(spec, state) {
  return h("section", { "data-key": "items", "data-role": "items" },
    h("h2", null, spec.itemsTitle),
    h("div", null,
      h("button", { "data-role": "load" }, spec.loadText),
      h("button", { "data-role": "addItem" }, "Add item"),
      h("label", null, "Markup %", h("input", { type: "number", "data-role": "markup", value: String(state.markup) }))),
    h("table", null,
      h("thead", null, h("tr", null, ITEM_HEADERS.map((t) => h("th", null, t)))),
      h("tbody", null, state.items.map((it) => renderRow(spec, it, state.markup)))));
}

// A row's two computed cells: the line value and the line with the markup.
export const lineOf = (it) => it.qty * it.price;
export const withMarkup = (it, markup) => Math.floor((lineOf(it) * (100 + markup)) / 100);

export function renderRow(spec, it, markup) {
  const money = (v) => formatNumber(spec, "currency", v);
  return h("tr", { "data-key": it.id, "data-role": "item" },
    h("td", null, it.name),
    h("td", null, it.category),
    h("td", null, h("input", { type: "number", "data-role": "qty", value: String(it.qty) })),
    h("td", null, money(it.price)),
    h("td", null, money(lineOf(it))),
    h("td", null, money(withMarkup(it, markup))),
    h("td", null, h("input", { type: "checkbox", "data-role": "active", checked: it.active })),
    h("td", null, h("input", { type: "text", "data-role": "note", placeholder: "Note", value: it.note })),
    h("td", null, h("button", { "data-role": "remove" }, "×")));
}

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (s) => s.replace(/[&<>"]/g, (c) => ESC[c]);

// Serialize a reference tree as HTML (props shown as attributes, for reading).
export function toHTML(node) {
  if (typeof node === "string") return esc(node);
  const attrs = { ...node.attrs };
  if (node.props.checked) attrs.checked = "";
  if (node.props.value != null && node.tag === "input") attrs.value = String(node.props.value);
  const open = `<${node.tag}${Object.entries(attrs).map(([k, v]) => (v === "" ? ` ${k}` : ` ${k}="${esc(v)}"`)).join("")}>`;
  if (node.tag === "input") return open;
  return open + node.children.map(toHTML).join("") + `</${node.tag}>`;
}

// ---------------------------------------------------------------------------------------------
// External events. Each builder is a pure function of the spec, the current reference state and
// a salt, so the serve panel can produce fresh events and the script stays deterministic.

function otherValue(c, r, cur) {
  if (c.type === "bool") return !cur;
  if (c.type === "enum") return r.pick(c.options.filter((o) => o !== cur));
  let v = r.int(c.min, c.max);
  if (v === cur) v = cur < c.max ? cur + 1 : cur - 1;
  return v;
}

// "The server sent new input values": `names` (or 3 seeded inputs, the hub input among them), each
// with a new valid value.
export function serverInputsMsg(spec, state, salt, names = null) {
  const r = rng("serverInputs", spec.options.seed, salt);
  const all = inputCells(spec);
  let chosen = names ? names.map((n) => cellOf(spec, n)) : r.sample(all, Math.min(3, all.length));
  if (!names && spec.forced.hubInput && !chosen.some((c) => c.name === spec.forced.hubInput)) chosen = [cellOf(spec, spec.forced.hubInput), ...chosen.slice(0, 2)];
  const values = {};
  for (const c of chosen) values[c.name] = otherValue(c, r, state.inputs[c.name]);
  return { type: "serverInputs", values };
}

// One field of an item changed (price, qty, category or active), or `field` if given.
function editItem(spec, it, r, field = r.pick(["price", "qty", "category", "active"])) {
  switch (field) {
    case "price": { let p = r.int(PRICE_MIN, PRICE_MAX); if (p === it.price) p = it.price === PRICE_MAX ? p - 1 : p + 1; return { ...it, price: p }; }
    case "qty": { let q = r.int(1, 99); if (q === it.qty) q = it.qty === 99 ? 98 : it.qty + 1; return { ...it, qty: q }; }
    case "category": return { ...it, category: r.pick(spec.categories.filter((c) => c !== it.category)) };
    case "active": return { ...it, active: !it.active };
  }
  throw new Error(`no item field ${field}`);
}

function serverItem(spec, id, r) {
  return { id, name: `${r.pick(spec.itemWords.adjectives)} ${r.pick(spec.itemWords.nouns)}`, category: r.pick(spec.categories),
    qty: r.int(1, 99), price: r.int(PRICE_MIN, PRICE_MAX), active: r.chance(0.75), note: "" };
}

// "The server changed some items": `change` existing items each get one field changed (the first
// item among them), `add` new items are appended (ids from nextId, one skipped), `remove` items are
// deleted, plus an id that does not exist. `field` fixes the changed field.
export function serverItemsMsg(spec, state, salt, { change = 2, add = 1, remove = 1, field } = {}) {
  const r = rng("serverItems", spec.options.seed, salt);
  const items = state.items;
  const changed = items.length ? [items[0], ...r.sample(items.slice(1), Math.max(0, change - 1))].slice(0, change) : [];
  const upsert = changed.map((it) => editItem(spec, it, r, field));
  for (let k = 0; k < add; k++) upsert.push(serverItem(spec, state.nextId + k + (k === add - 1 ? 1 : 0), r));
  const ids = r.sample(items.filter((it) => !changed.includes(it)), remove).map((it) => it.id);
  if (remove > 0) ids.push(state.nextId + 1000);
  return { type: "serverItems", upsert, remove: ids };
}

// Reverse a slice of at least two items, so some keep their place and some move.
function partlyReorder(list, r) {
  if (list.length < 2) return list.slice();
  const a = r.int(0, list.length - 2);
  const b = r.int(a + 1, list.length - 1);
  return [...list.slice(0, a), ...list.slice(a, b + 1).reverse(), ...list.slice(b + 1)];
}

// "Here is the whole state": every input and the markup changed; items keep their ids but a slice
// is reversed, one item is gone, every third item has a field edited, one new item is inserted at
// a random place; rng and nextId are new.
export function snapshot(spec, state, salt) {
  const r = rng("snapshot", spec.options.seed, salt);
  const inputs = {};
  for (const c of inputCells(spec)) inputs[c.name] = otherValue(c, r, state.inputs[c.name]);
  let items = partlyReorder(state.items, r);
  if (items.length > 1) items.splice(r.int(0, items.length - 1), 1);
  items = items.map((it, k) => (k % 3 === 0 ? editItem(spec, it, r) : it));
  items.splice(r.int(0, items.length), 0, serverItem(spec, state.nextId, r));
  const markup = otherValue({ type: "num", min: spec.markup.min, max: spec.markup.max }, r, state.markup);
  return { inputs, markup, items, nextId: state.nextId + 1 + r.int(0, 3), rng: r.int(1, PRNG_MOD - 1) };
}

export function panelEvents(spec) {
  return [
    { name: "serverInputs", make: (state, _t, salt) => serverInputsMsg(spec, state, salt) },
    { name: "serverItems", make: (state, _t, salt) => serverItemsMsg(spec, state, salt) },
    { name: "snapshot", make: (state, _t, salt) => ({ type: "snapshot", state: snapshot(spec, state, salt) }) },
  ];
}

// ---------------------------------------------------------------------------------------------
// The interaction script: the same for every framework.
//
// Steps:
//   { do: "mount" } | { do: "dispose" }
//   { do: "click", target, msg }               click the element
//   { do: "type", target, value, msg? }        set an input's value and fire input (no msg: invalid)
//   { do: "select", target, value, msg }       choose an option
//   { do: "dispatch", msg }                    an external event through the contract
// A target is a CSS selector built from the stable data-key/data-role attributes. A step is only
// generated when its target is rendered in the reference at that moment.

// The selector of a sheet control (`section` "sheet"), an items toolbar control ("items", no row)
// or a row control (row = item id).
export function target(section, role, row) {
  return row != null ? `[data-key="${section}"] tr[data-key="${row}"] [data-role="${role}"]` : `[data-key="${section}"] [data-role="${role}"]`;
}

// The units the script exercises: every unit up to 32, else the 11 forced ones and 21 others.
export const SCRIPT_ALL = 32;

export function scriptUnits(spec) {
  if (spec.units.length <= SCRIPT_ALL) return spec.units;
  const rest = rng("sample", spec.options.seed).sample(spec.units.slice(FORCED.length), SCRIPT_ALL - FORCED.length);
  return spec.units.filter((u, i) => i < FORCED.length || rest.includes(u));
}

export function makeScript(spec) {
  const steps = [];
  let state = spec.initialState;
  const push = (step) => {
    steps.push(step);
    if (step.msg) state = update(spec, state, step.msg);
  };
  const seed = spec.options.seed;
  const sheetClick = (name) => push({ do: "click", label: `sheet ${name}`, target: target("sheet", name), msg: { type: name } });

  // A number input: in the first round two invalid values (above the max, not an integer) that
  // send no message and keep the typed text (`exemptValue`), then valid in-range integers: a digit
  // is appended while the result stays in range, otherwise the content is replaced by one digit
  // (number inputs have min <= 0 and max >= 20).
  const typeNumber = (label, sel, cur, min, max, makeMsg, r, first) => {
    if (first) {
      for (const value of [String(max + 1), "1.5"]) push({ do: "type", label: `${label} "${value}" (invalid: no message)`, target: sel, value, exemptValue: true });
    }
    for (let k = 0; k < (first ? 2 : 1); k++) {
      const c = String(cur());
      const d = String(r.int(1, 9));
      let value = c + d;
      if (c === "0" || c.startsWith("-") || Number(value) > max) value = d;
      if (Number(value) === Number(c)) value = String((Number(d) % 9) + 1);
      push({ do: "type", label: `${label} "${value}"`, target: sel, value, msg: makeMsg(Number(value)) });
    }
  };

  const exerciseInput = (unit, c, r, first) => {
    for (const m of unit.messages.filter((x) => x.cell === c.name)) {
      if (m.kind === "input") {
        typeNumber(`sheet ${m.name}`, target("sheet", m.name), () => state.inputs[c.name], c.min, c.max, (v) => ({ type: m.name, value: v }), r, first);
      } else if (m.kind === "add") sheetClick(m.name);
      else if (m.kind === "check") sheetClick(m.name);
      else if (m.kind === "select") {
        const cur = state.inputs[c.name];
        const i = c.options.indexOf(cur);
        const value = c.options[i + 1 < c.options.length ? i + 1 : i - 1];
        push({ do: "select", label: `sheet ${m.name} ${value}`, target: target("sheet", m.name), value, msg: { type: m.name, value } });
      }
    }
  };

  push({ do: "mount", label: "mount" });
  push({ do: "click", label: "items load", target: target("items", "load"), msg: { type: "load" } });

  // 1. Every input of the exercised units.
  const units = scriptUnits(spec);
  for (const u of units) for (const c of u.inputs) exerciseInput(u, c, rng("script", seed, u.index), true);

  // 2. The items: quantities, active flags, a note typed character by character, a remove, an
  // added item.
  const ri = rng("items", seed);
  const ids = () => state.items.map((it) => it.id);
  const rowAt = (k) => ids()[Math.min(k, state.items.length - 1)];
  const item = (id) => state.items.find((it) => it.id === id);
  const qty = (id, first) => typeNumber(`item ${id} qty`, target("items", "qty", id), () => item(id).qty, 0, QTY_MAX, (v) => ({ type: "qty", id, value: v }), ri, first);
  const [a, b, c, d] = [rowAt(0), rowAt(2), rowAt(3), rowAt(5)];
  qty(a, true);
  qty(b, false);
  for (const id of [a, c]) push({ do: "click", label: `item ${id} active`, target: target("items", "active", id), msg: { type: "active", id } });
  const typeNote = (id, text) => {
    for (let k = 1; k <= text.length; k++) {
      const value = text.slice(0, k);
      push({ do: "type", label: `item ${id} note "${value}"`, target: target("items", "note", id), value, msg: { type: "note", id, value } });
    }
  };
  typeNote(b, ri.pick(spec.noteWords));
  push({ do: "click", label: `item ${d} remove`, target: target("items", "remove", d), msg: { type: "remove", id: d } });
  push({ do: "click", label: "items addItem", target: target("items", "addItem"), msg: { type: "addItem" } });
  qty(ids()[ids().length - 1], false);
  typeNumber("items markup", target("items", "markup"), () => state.markup, spec.markup.min, spec.markup.max, (v) => ({ type: "markup", value: v }), ri, true);

  // 3. External events.
  push({ do: "dispatch", label: "serverInputs", msg: serverInputsMsg(spec, state, "script") });
  push({ do: "dispatch", label: "serverItems", msg: serverItemsMsg(spec, state, "script") });

  // 4. A reorder through a snapshot.
  push({ do: "dispatch", label: "snapshot", msg: { type: "snapshot", state: snapshot(spec, state, "script") } });

  // 5. A final round: the forced inputs once more, a note on another row, a remove.
  const rf = rng("final", seed);
  for (const u of spec.units.slice(0, FORCED.length)) for (const c2 of u.inputs) exerciseInput(u, c2, rf, false);
  if (state.items.length) {
    const id = rf.pick(ids());
    typeNote(id, rf.pick(spec.noteWords));
    push({ do: "click", label: `item ${id} remove`, target: target("items", "remove", id), msg: { type: "remove", id } });
  }
  push({ do: "dispose", label: "dispose" });
  return steps;
}
