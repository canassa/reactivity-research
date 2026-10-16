// The big-table scenario generator and its reference: a page of N data tables, each its own
// component, filled with hundreds or thousands of rows. Table 1 is js-framework-benchmark's
// app (their word lists, six buttons, select and remove links, row markup); tables 2 to N are
// generated, each with its own columns, cell formats, toolbar and row controls.
//
// This module is the single source of truth for the scenario (see README.md). It runs both in
// Node (the CLI generates specs with it) and in the browser (the serve panel imports it alone
// from /__rr/spec.js and uses the reference `update` and `render` and the external-event
// builders), so it imports nothing.
//
// `generate(options)` returns a plain-data app spec: the table descriptions, the initial state
// and the interaction script. The reference `update` and `render` are generic interpreters over
// the table descriptions; implementations must not be (README, "Each table is its own code").
//
// Prefix stability: for one seed (and one --rows), table i is the same at every size. Table i is
// drawn from its own random stream and only checked against earlier tables, so growing N only
// appends tables.
//
// Size is the number of tables. Rows are data: --rows sets the count of every create and append
// (table 1's runlots makes 10x) and the swap indices, and nothing else.

export const scenario = "big-table";

// From N = 4 every cell kind and every operation is present (tables 2 to 4 are forced), so
// baseline and slope are fitted over N >= 4; N = 1 is js-framework-benchmark's app alone.
export const steadyFrom = 4;

// The size ./rr check builds by default (and the locality check's smaller size), and the options
// it builds with: 40 rows, so the script's runlots compares 400 rows, not 10,000. The code is
// the same at every --rows.
export const quickCheckSize = 16;
export const quickCheckOptions = { rows: 40 };

// The scenario's own parameters (beyond --size and --seed), with their defaults.
export const params = {
  rows: { default: 1000, help: "rows of every create and append (table 1's runlots makes 10x): data, not size" },
};

export function normalizeOptions(raw = {}) {
  const size = int(raw.size ?? 16, "size");
  const seed = int(raw.seed ?? 1, "seed");
  if (size < 1) throw new Error("--size must be at least 1");
  const rows = int(raw.rows ?? 1000, "rows");
  if (rows < 4) throw new Error("--rows must be at least 4");
  return { size, seed, rows };
}

function int(v, name) {
  const n = Number(v);
  if (!Number.isInteger(n)) throw new Error(`--${name} must be an integer, got ${v}`);
  return n;
}

// ---------------------------------------------------------------------------------------------
// The app's own PRNG (README, "Labels, and every other random value"): a Park–Miller ("minstd")
// generator whose state each table carries in the app state. One draw advances the state, then
// uses it. Every product stays below 2^47, exact in a double.

export const PRNG_MOD = 2147483647;
export const next = (s) => (s * 48271) % PRNG_MOD;          // s in 1 … 2147483646
export const pick = (s, list) => list[s % list.length];     // after advancing
export const between = (s, min, max) => min + (s % (max - min + 1));

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
// Vocabularies. js-framework-benchmark's three word lists are verbatim (frameworks/keyed/
// vanillajs/src/Main.js, `brown` twice). Names (columns, operations, row controls) are lowercase
// words or camelCase, valid identifiers in every target language (no JS or Elm keywords).

export const JFB_ADJECTIVES = ["pretty", "large", "big", "small", "tall", "short", "long", "handsome", "plain", "quaint",
  "clean", "elegant", "easy", "angry", "crazy", "helpful", "mushy", "odd", "unsightly", "adorable", "important",
  "inexpensive", "cheap", "expensive", "fancy"];
export const JFB_COLOURS = ["red", "yellow", "blue", "green", "pink", "brown", "purple", "brown", "white", "black", "orange"];
export const JFB_NOUNS = ["table", "chair", "house", "bbq", "desk", "car", "pony", "cookie", "sandwich", "burger", "pizza",
  "mouse", "keyboard"];

const TITLES = ["Shipments", "Orders", "Invoices", "Tickets", "Customers", "Products", "Vendors", "Employees",
  "Projects", "Tasks", "Accounts", "Payments", "Bookings", "Deliveries", "Parcels", "Leads", "Contracts", "Assets",
  "Vehicles", "Rooms", "Courses", "Students", "Patients", "Devices", "Servers", "Incidents", "Releases", "Campaigns",
  "Listings", "Reviews", "Returns", "Refunds", "Subscriptions", "Members", "Flights", "Routes", "Stores",
  "Warehouses", "Suppliers", "Batches", "Licenses", "Shifts", "Claims", "Quotes", "Builds", "Recipes"];

// Master vocabularies: text columns draw their pool from one, label columns from two or three.
const VOCAB = {
  companies: ["Acme", "Birch", "Cobalt", "Dune", "Ember", "Fjord", "Granite", "Harbor", "Iris", "Juniper", "Kestrel",
    "Lumen", "Meridian", "Nimbus", "Orchid", "Pioneer", "Quarry", "Ridge", "Summit", "Tundra"],
  cities: ["Oslo", "Lima", "Porto", "Quito", "Riga", "Turin", "Lyon", "Perth", "Dakar", "Hanoi", "Cork", "Bern",
    "Malmo", "Leeds", "Split", "Graz", "Nice", "Kobe", "Accra", "Basel"],
  people: ["Ada", "Ben", "Cleo", "Dev", "Eli", "Faye", "Gus", "Hana", "Ivo", "Jade", "Kai", "Lena", "Milo", "Nia",
    "Omar", "Pia", "Quinn", "Rosa", "Sami", "Theo"],
  regions: ["North", "South", "East", "West", "Central", "Coastal", "Highland", "Metro", "Rural", "Islands"],
  teams: ["Alpha", "Bravo", "Core", "Delta", "Edge", "Falcon", "Growth", "Helix", "Ionic", "Jetty"],
  channels: ["Email", "Phone", "Chat", "Web", "Store", "Partner", "Social", "Referral", "Event", "Ads"],
  categories: ["Tools", "Garden", "Kitchen", "Office", "Sports", "Toys", "Books", "Audio", "Bath", "Outdoor"],
  adjectives: ["swift", "quiet", "bold", "bright", "calm", "eager", "gentle", "humble", "lucky", "noble", "proud",
    "rapid", "sharp", "sunny", "tidy", "vivid", "witty", "zesty"],
  colours: ["amber", "azure", "coral", "crimson", "ivory", "jade", "khaki", "lilac", "mint", "navy", "olive", "plum",
    "rust", "sand", "teal", "violet"],
  materials: ["oak", "steel", "glass", "linen", "brass", "cedar", "clay", "copper", "cotton", "denim", "marble",
    "nylon", "slate", "velvet", "wool", "bamboo"],
  animals: ["otter", "falcon", "badger", "heron", "lynx", "panda", "raven", "tiger", "walrus", "yak", "zebra",
    "beaver", "cobra", "gecko", "koala", "moose"],
  objects: ["lamp", "kettle", "bench", "ladder", "basket", "clock", "drum", "anchor", "candle", "compass", "lantern",
    "mirror", "rocket", "saddle", "teapot", "wagon"],
};
const LABEL_VOCABS = ["adjectives", "colours", "materials", "animals", "objects"];

const TEXT_COLUMNS = [
  ["carrier", "companies"], ["vendor", "companies"], ["supplier", "companies"], ["brand", "companies"],
  ["city", "cities"], ["depot", "cities"], ["origin", "cities"], ["owner", "people"], ["agent", "people"],
  ["author", "people"], ["client", "people"], ["assignee", "people"], ["region", "regions"], ["zone", "regions"],
  ["team", "teams"], ["squad", "teams"], ["channel", "channels"], ["source", "channels"], ["category", "categories"],
  ["department", "categories"],
];
const LABEL_COLUMNS = ["name", "title", "product", "item", "headline", "alias", "codename", "model", "nickname", "motto"];
// [name, format, unit or currency symbols]
const NUMBER_COLUMNS = [
  ["weight", "unit", ["kg", "lb", "t"]], ["distance", "unit", ["km", "mi"]], ["volume", "unit", ["L", "gal"]],
  ["duration", "unit", ["min", "h"]], ["area", "unit", ["m2", "ft2"]],
  ["cost", "currency", ["$", "€", "£"]], ["price", "currency", ["$", "€", "£"]], ["budget", "currency", ["$", "€", "£"]],
  ["revenue", "currency", ["$", "€", "£"]], ["fee", "currency", ["$", "€", "£"]], ["deposit", "currency", ["$", "€", "£"]],
  ["margin", "percent"], ["discount", "percent"], ["share", "percent"], ["growth", "percent"], ["progress", "percent"],
  ["qty", "plain"], ["seats", "plain"], ["score", "plain"], ["calls", "plain"], ["retries", "plain"], ["age", "plain"],
  ["stock", "grouped"], ["views", "grouped"], ["visits", "grouped"], ["clicks", "grouped"], ["downloads", "grouped"],
  ["followers", "grouped"],
];
const DATE_COLUMNS = ["due", "shipped", "opened", "created", "renewed", "joined", "booked", "paid", "closed", "started"];
const DATE_FORMATS = ["mon-d", "d-mon", "mm-dd"];
const STATUS_COLUMNS = ["state", "stage", "phase", "priority", "health", "tier", "level", "mood"];
const STATUS_SETS = [
  ["Open", "Pending", "Closed", "Archived"], ["Draft", "Review", "Live", "Retired"], ["Low", "Medium", "High", "Urgent"],
  ["New", "Active", "Paused", "Done"], ["Ok", "Warn", "Down", "Unknown"], ["Unpaid", "Paid", "Refunded", "Void"],
  ["Bronze", "Silver", "Gold", "Platinum"], ["Queued", "Running", "Failed", "Passed"],
];
const STATUS_TAGS = ["b", "em", "mark", "strong"];
const FLAG_COLUMNS = ["late", "urgent", "starred", "archived", "verified", "flagged", "pinned", "locked", "fragile",
  "insured", "billable", "remote", "vip", "muted"];
const FLAG_VERBS = ["mark", "toggle", "flip", "check"];
const IF_TEXTS = [["heavy", "light"], ["over", "under"], ["high", "low"], ["yes", "no"], ["late", "on time"],
  ["hot", "cold"], ["big", "small"], ["done", "open"], ["urgent", "normal"], ["ok", "check"], ["top", "rest"]];
const COMPUTED_NAMES = {
  "*": ["total", "subtotal", "amount", "value", "extended", "gross"],
  "+": ["combined", "sum", "overall", "together", "pooled"],
  len: ["chars", "letters", "span", "width"],
  if: ["band", "verdict", "grade", "bucket", "signal", "summary", "outlook"],
};
const SUFFIXES = [" *", " !", " +", " (new)", " (upd)", " ✓", " ~"];

const cap = (s) => s[0].toUpperCase() + s.slice(1);
const ordinal = (k) => `${k}${k % 100 >= 11 && k % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" })[k % 10] || "th"}`;

// Message types that are not a table's own (external events): no operation or control is named so.
export const EXTERNAL = ["serverRows", "serverUpdate", "serverDelete", "snapshot"];
const RESERVED_ROLES = new Set(["row", "table", "page", ...EXTERNAL]);

// ---------------------------------------------------------------------------------------------
// Formatting (README, "Number formats"): no locale APIs, so every language formats alike.

export const group = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

export function formatNumber(col, v) {
  switch (col.format) {
    case "plain": return String(v);
    case "grouped": return group(v);
    case "unit": return `${group(v)} ${col.unit}`;
    case "currency": return `${col.symbol}${group(Math.floor(v / 100))}.${String(v % 100).padStart(2, "0")}`;
    case "percent": return `${group(Math.floor(v / 10))}.${v % 10}%`;
  }
  throw new Error(`unknown number format ${col.format}`);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// Day of the year (1-365, no leap years) as text.
export function formatDate(format, day) {
  let m = 0, d = day;
  while (d > MONTH_DAYS[m]) d -= MONTH_DAYS[m++];
  if (format === "mon-d") return `${MONTHS[m]} ${d}`;
  if (format === "d-mon") return `${d} ${MONTHS[m]}`;
  if (format === "mm-dd") return `${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  throw new Error(`unknown date format ${format}`);
}

// ---------------------------------------------------------------------------------------------
// Table 1: js-framework-benchmark's table.

function table1(seed, rows) {
  const r = rng("table", seed, 0);
  const token = tokenOf(r);
  return {
    id: "t1", token, title: `Rows ${token}`, thead: false,
    rng: r.int(1, PRNG_MOD - 1), initialRows: 0,
    marker: { attr: "class", value: "danger" },
    columns: [
      { kind: "id", name: "id", header: "" },
      { kind: "label", name: "label", header: "", pools: [JFB_ADJECTIVES, JFB_COLOURS, JFB_NOUNS], select: "select" },
      { kind: "remove", role: "remove", header: "", element: "a", text: "×", glyph: true },
      { kind: "spacer", header: "" },
    ],
    ops: [
      { kind: "create", name: "run", count: rows, text: `Create ${group(rows)} rows` },
      { kind: "create", name: "runlots", count: 10 * rows, text: `Create ${group(10 * rows)} rows` },
      { kind: "append", name: "add", count: rows, text: `Append ${group(rows)} rows` },
      { kind: "updateEvery", name: "update", k: 10, column: "label", suffix: " !!!", text: "Update every 10th row" },
      { kind: "clear", name: "clear", text: "Clear" },
      { kind: "swap", name: "swaprows", i: 1, j: rows - 2, text: "Swap Rows" },
    ],
  };
}

function tokenOf(r) {
  return Array.from({ length: 4 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[r.int(0, 35)]).join("");
}

// ---------------------------------------------------------------------------------------------
// Tables 2 to N.

// What the first generated tables always have, on top of their random composition, so every
// cell kind and operation is present from N = 4 and the work and bench actions find the same
// targets at every size (README, "The first tables").
export const FORCED = {
  t2: "a flag column with toggle, removeChecked, a text column sorted ascending, a date column sorted descending, remove",
  t3: "a label column with select, a number column with bump and updateEvery, a currency product of two number columns, append, swap",
  t4: "a status column with updateEvery, a computed if over the status, select (marker not danger), clear",
};

export function generate(rawOptions) {
  const options = normalizeOptions(rawOptions);
  const { size, seed, rows } = options;
  const tables = [table1(seed, rows)];
  const sigs = new Set([signature(tables[0])]);
  const tokens = new Set([tables[0].token]);
  for (let i = 1; i < size; i++) {
    for (let attempt = 0; ; attempt++) {
      if (attempt > 200) throw new Error(`could not generate a unique table at position ${i + 1}`);
      const t = buildTable(rng("table", seed, i, attempt), i, rows);
      const sig = signature(t);
      if (sigs.has(sig) || tokens.has(t.token)) continue;
      sigs.add(sig);
      tokens.add(t.token);
      tables.push(t);
      break;
    }
  }
  const initialState = { tables: {} };
  for (const t of tables) {
    const built = buildRows(t, { rng: t.rng, nextId: 1 }, t.initialRows);
    initialState.tables[t.id] = { rows: built.rows, selected: null, nextId: built.nextId, rng: built.rng };
  }
  const spec = { scenario, options, tables, initialState };
  spec.script = makeScript(spec);
  return spec;
}

function buildTable(r, i, rows) {
  const id = `t${i + 1}`;
  const token = tokenOf(r);
  const noun = r.pick(TITLES);
  const plural = noun.toLowerCase();
  const names = new Set(["id"]);
  const roles = new Set(RESERVED_ROLES);
  const name = (base) => {
    let n = base;
    for (let k = 2; names.has(n); k++) n = `${base}${k}`;
    names.add(n);
    return n;
  };
  const role = (base) => {
    let n = base;
    for (let k = 2; roles.has(n); k++) n = `${base}${k}`;
    roles.add(n);
    return n;
  };
  const freeName = (pool) => {
    const free = pool.filter((n) => !names.has(Array.isArray(n) ? n[0] : n));
    return r.pick(free.length ? free : pool);
  };

  // Data columns: the forced ones first, then random ones, 2 to 5 in all.
  const gen = {
    label() {
      const vocabs = r.sample(LABEL_VOCABS, r.int(2, 3));
      return { kind: "label", name: name(freeName(LABEL_COLUMNS)), pools: vocabs.map((v) => r.sample(VOCAB[v], r.int(5, 10))) };
    },
    text() {
      const [n, vocab] = freeName(TEXT_COLUMNS);
      return { kind: "text", name: name(n), pool: r.sample(VOCAB[vocab], r.int(5, 10)) };
    },
    number(format) {
      const pool = format ? NUMBER_COLUMNS.filter((c) => (Array.isArray(format) ? format : [format]).includes(c[1])) : NUMBER_COLUMNS;
      const [n, f, units] = freeName(pool);
      const c = { kind: "number", name: name(n), format: f };
      if (f === "unit") c.unit = r.pick(units);
      if (f === "currency") c.symbol = r.pick(units);
      const [lo, hi] = {
        plain: [[0, 10], [20, 999]], grouped: [[0, 1000], [10000, 999999]], unit: [[0, 5], [50, 5000]],
        currency: [[50, 1000], [2000, 500000]], percent: [[0, 100], [500, 1000]],
      }[f];
      c.min = r.int(...lo);
      c.max = Math.max(c.min + 10, r.int(...hi));
      return c;
    },
    date() {
      return { kind: "date", name: name(freeName(DATE_COLUMNS)), format: r.pick(DATE_FORMATS) };
    },
    status() {
      const set = r.pick(STATUS_SETS);
      return { kind: "status", name: name(freeName(STATUS_COLUMNS)), options: set.slice(0, r.int(2, 4)), tag: r.pick(STATUS_TAGS) };
    },
    flag() {
      const n = name(freeName(FLAG_COLUMNS));
      return { kind: "flag", name: n, toggle: role(`${r.pick(FLAG_VERBS)}${cap(n)}`) };
    },
  };
  const data = [];
  const want = (c) => { data.push(c); return c; };
  let forced = {};
  if (id === "t2") forced = { flag: want(gen.flag()), text: want(gen.text()), date: want(gen.date()) };
  if (id === "t3") forced = { label: want(gen.label()), num: want(gen.number(["plain", "grouped", "unit"])), cur: want(gen.number("currency")) };
  if (id === "t4") forced = { status: want(gen.status()), shown: want(r.chance(0.5) ? gen.label() : gen.text()) };
  const nData = Math.max(data.length, r.weighted([[2, 25], [3, 35], [4, 25], [5, 15]]));
  while (data.length < nData) {
    const kind = r.weighted([["label", 12], ["text", 22], ["number", 30], ["date", 12], ["status", 13], ["flag", 11]]);
    want(gen[kind]());
  }
  for (const c of data) c.header = cap(c.name);

  // Computed columns: 0 to 2 (t3 and t4 have their forced one).
  const numbers = data.filter((c) => c.kind === "number");
  const computed = [];
  const addComputed = (expr, extra = {}) => {
    const op = expr[0];
    const c = { kind: "computed", name: name(freeName(COMPUTED_NAMES[op])), expr, ...extra };
    c.header = cap(c.name.replace(/\d+$/, ""));
    computed.push(c);
  };
  const ifTexts = () => r.pick(IF_TEXTS);
  const computedChoices = () => {
    const out = [];
    const cur = numbers.filter((c) => c.format === "currency");
    const qty = numbers.filter((c) => c.format !== "currency" && c.format !== "percent");
    if (cur.length && qty.length) out.push(() => { const a = r.pick(qty), b = r.pick(cur); addComputed(["*", a.name, b.name], { format: "currency", symbol: b.symbol }); });
    for (const a of numbers) {
      const twin = numbers.find((b) => b !== a && b.format === a.format && b.unit === a.unit && b.symbol === a.symbol);
      if (twin) { out.push(() => addComputed(["+", a.name, twin.name], { format: a.format, ...(a.unit ? { unit: a.unit } : {}), ...(a.symbol ? { symbol: a.symbol } : {}) })); break; }
    }
    const texts = data.filter((c) => c.kind === "text" || c.kind === "label");
    if (texts.length) out.push(() => addComputed(["len", r.pick(texts).name], { format: "plain" }));
    if (numbers.length) out.push(() => { const a = r.pick(numbers); const [y, n] = ifTexts(); addComputed(["if", [">", a.name, r.int(a.min, Math.floor((a.min + a.max) / 2))], y, n]); });
    const statuses = data.filter((c) => c.kind === "status");
    if (statuses.length) out.push(() => { const a = r.pick(statuses); const [y, n] = ifTexts(); addComputed(["if", ["==", a.name, r.pick(a.options)], y, n]); });
    const flags = data.filter((c) => c.kind === "flag");
    if (flags.length) out.push(() => { const [y, n] = ifTexts(); addComputed(["if", ["f", r.pick(flags).name], y, n]); });
    return out;
  };
  if (id === "t3") addComputed(["*", forced.num.name, forced.cur.name], { format: "currency", symbol: forced.cur.symbol });
  if (id === "t4") { const [y, n] = ifTexts(); addComputed(["if", ["==", forced.status.name, r.pick(forced.status.options)], y, n]); }
  const nComputed = r.weighted([[0, 55], [1, 35], [2, 10]]);
  while (computed.length < nComputed) {
    const choices = computedChoices();
    if (!choices.length) break;
    r.pick(choices)();
  }

  // Row controls.
  const shownTexts = data.filter((c) => c.kind === "label" || c.kind === "text");
  let marker = null;
  if (id === "t3" || id === "t4" || (shownTexts.length && r.chance(0.5))) {
    const on = id === "t3" ? forced.label : id === "t4" ? forced.shown : r.pick(shownTexts);
    on.select = role(r.pick(["select", "pick", "choose", "highlight", "focus", "open"]));
    marker = r.pick([{ attr: "class", value: "selected" }, { attr: "class", value: "active" }, { attr: "aria-selected", value: "true" }]);
  }
  const controls = [];
  if (id === "t2" || r.chance(0.7)) {
    const element = r.pick(["a", "button"]);
    controls.push({ kind: "remove", role: role(r.pick(["remove", "drop", "discard", "dismiss", "erase", "trash"])), header: "", element, text: r.pick(["Remove", "Delete", "×", "Drop", "✕", "Discard"]) });
  }
  let bumped = null;
  if (id === "t3" || (numbers.length && r.chance(0.4))) {
    bumped = id === "t3" ? forced.num : r.pick(numbers);
    const delta = bumpDelta(r, bumped);
    controls.push({ kind: "bump", role: role(`${r.pick(["bump", "raise", "add", "boost"])}${cap(bumped.name)}`), header: "", column: bumped.name, delta, text: `+${formatNumber(bumped, delta)}` });
  }

  // Operations: create first, then the others in a random order.
  const n = group(rows);
  const ops = [];
  const createVerb = r.pick(["load", "fetch", "refill", "populate", "generate", "pull", "reload"]);
  ops.push({ kind: "create", name: role(createVerb), count: rows, text: `${cap(createVerb)} ${n} ${plural}` });
  const more = [];
  if (id === "t3" || r.chance(0.4)) {
    more.push({ kind: "append", name: role(r.pick(["append", "loadMore", "addMore", "extend", "topUp"])), count: rows,
      text: r.pick([`Add ${n} more`, `Append ${n} ${plural}`, `Load ${n} more`]) });
  }
  const updatable = data;
  if (id === "t3" || id === "t4" || r.chance(0.6)) {
    const col = id === "t3" ? forced.num : id === "t4" ? forced.status : r.pick(updatable);
    const k = r.int(2, 12);
    const verb = r.pick({ number: ["raise", "boost", "grow"], label: ["mark", "tag", "stamp"], text: ["mark", "tag", "stamp"],
      date: ["postpone", "delay", "defer"], status: ["advance", "promote", "cycle"], flag: ["flip", "invert"] }[col.kind]);
    const op = { kind: "updateEvery", name: role(`${verb}Every${k}`), k, column: col.name, text: `${cap(verb)} every ${ordinal(k)}` };
    if (col.kind === "number") op.delta = bumpDelta(r, col);
    if (col.kind === "label" || col.kind === "text") op.suffix = r.pick(SUFFIXES);
    if (col.kind === "date") op.days = r.int(1, 30);
    more.push(op);
  }
  if (id === "t4" || r.chance(0.5)) {
    more.push({ kind: "clear", name: role(r.pick(["clear", "empty", "wipe", "purge", "reset"])), text: r.pick(["Clear", "Clear all", "Empty", `Remove all ${plural}`, "Wipe"]) });
  }
  if (id === "t3" || r.chance(0.4)) {
    let i = r.int(0, 2), j = rows - 1 - r.int(0, 2);
    if (j <= i) { i = 0; j = rows - 1; }
    more.push({ kind: "swap", name: role(r.pick(["swap", "swapRows", "exchange", "trade"])), i, j, text: r.pick(["Swap rows", "Swap", "Exchange rows", `Swap ${plural}`]) });
  }
  const sortable = [...data.filter((c) => c.kind !== "flag" || r.chance(0.3))];
  const sorts = [];
  if (id === "t2") {
    sorts.push([forced.text, "asc"], [forced.date, "desc"]);
  } else if (r.chance(0.35) && sortable.length) {
    for (const c of r.sample(sortable, r.int(1, 2))) sorts.push([c, r.pick(["asc", "desc"])]);
  }
  for (const [c, dir] of sorts) {
    const arrow = dir === "asc" ? "↑" : "↓";
    more.push({ kind: "sort", name: role(`sortBy${cap(c.name)}`), column: c.name, dir,
      text: r.pick([`Sort by ${c.header} ${arrow}`, `${c.header} ${dir === "asc" ? "ascending" : "descending"}`, `By ${c.header.toLowerCase()} ${arrow}`]) });
  }
  const flags = data.filter((c) => c.kind === "flag");
  if (id === "t2" || (flags.length && r.chance(0.5))) {
    const f = id === "t2" ? forced.flag : r.pick(flags);
    const verb = r.pick(["drop", "purge", "remove"]);
    more.push({ kind: "removeChecked", name: role(`${verb}${cap(f.name)}`), column: f.name, text: `${cap(verb)} ${f.name}` });
  }
  ops.push(...r.shuffle(more));

  // Column order: the id first (60%), the data and computed columns shuffled, the controls last.
  const hasId = r.chance(0.6) || data.length + computed.length + controls.length < 3;
  const columns = [
    ...(hasId ? [{ kind: "id", name: "id", header: r.pick(["#", "ID", "No.", "Ref"]) }] : []),
    ...r.shuffle([...data, ...computed]),
    ...r.shuffle(controls),
  ];
  // The rows' own PRNG state, and how many rows the table starts with.
  return { id, token, title: `${noun} ${token}`, thead: true, rng: r.int(1, PRNG_MOD - 1), initialRows: r.int(3, 5), marker, columns, ops };
}

// A positive delta for a number column, in its own units (cents for currency, tenths for percent).
function bumpDelta(r, col) {
  return r.pick({ plain: [1, 2, 5], grouped: [10, 100, 250], unit: [1, 5, 10], currency: [100, 250, 500, 1000], percent: [5, 10, 25] }[col.format]);
}

// The structure of a table with every text, number and name abstracted away (columns become
// their index), used to guarantee that no two tables of an app share a structure.
export function signature(t) {
  const ci = new Map(t.columns.filter((c) => c.name).map((c, i) => [c.name, i]));
  const expr = (e) => (Array.isArray(e) ? [e[0], ...e.slice(1).map(expr)] : typeof e === "string" && ci.has(e) ? ["c", ci.get(e)] : typeof e);
  return JSON.stringify([
    t.thead, t.marker ? t.marker.attr : null,
    t.columns.map((c) => [c.kind, c.format ?? null, c.tag ?? null, c.element ?? null, c.pools ? c.pools.length : null,
      c.options ? c.options.length : null, !!c.select, !!c.toggle, !!c.glyph, c.expr ? expr(c.expr) : null,
      c.column != null ? ci.get(c.column) : null]),
    t.ops.map((o) => [o.kind, o.column != null ? ci.get(o.column) : null, o.dir ?? null]),
  ]);
}

// ---------------------------------------------------------------------------------------------
// The row builder (README, "Labels, and every other random value"): for each row, one draw per
// generated cell in column order (a label: one per pool), then id = nextId++.

export function buildRows(t, ts, count) {
  let s = ts.rng, id = ts.nextId;
  const rows = new Array(count);
  for (let n = 0; n < count; n++) {
    const row = { id: id++ };
    for (const c of t.columns) {
      switch (c.kind) {
        case "label": {
          const words = [];
          for (const pool of c.pools) { s = next(s); words.push(pick(s, pool)); }
          row[c.name] = words.join(" ");
          break;
        }
        case "text": s = next(s); row[c.name] = pick(s, c.pool); break;
        case "number": s = next(s); row[c.name] = between(s, c.min, c.max); break;
        case "date": s = next(s); row[c.name] = between(s, 1, 365); break;
        case "status": s = next(s); row[c.name] = pick(s, c.options); break;
        case "flag": s = next(s); row[c.name] = s % 2 === 1; break;
      }
    }
    rows[n] = row;
  }
  return { rows, rng: s, nextId: id };
}

// The data columns (generated cells, stored in the row).
export const DATA_KINDS = ["label", "text", "number", "date", "status", "flag"];
export const dataColumns = (t) => t.columns.filter((c) => DATA_KINDS.includes(c.kind));

// ---------------------------------------------------------------------------------------------
// The reference: update and render, as generic interpreters over the table descriptions.

export function byId(spec, id) {
  return spec.tables.find((t) => t.id === id);
}

export function columnOf(t, name) {
  return t.columns.find((c) => c.name === name);
}

export function opOf(t, name) {
  return t.ops.find((o) => o.name === name);
}

// A table's row controls, from its columns: { kind: "select" | "toggle" | "remove" | "bump", role, column? }.
export function rowControls(t) {
  const out = [];
  for (const c of t.columns) {
    if (c.select) out.push({ kind: "select", role: c.select, column: c.name });
    if (c.toggle) out.push({ kind: "toggle", role: c.toggle, column: c.name });
    if (c.kind === "remove") out.push({ kind: "remove", role: c.role });
    if (c.kind === "bump") out.push({ kind: "bump", role: c.role, column: c.column, delta: c.delta });
  }
  return out;
}

export function evaluate(e, row) {
  switch (e[0]) {
    case "*": return row[e[1]] * row[e[2]];
    case "+": return row[e[1]] + row[e[2]];
    case "len": return row[e[1]].length;
    case ">": return row[e[1]] > e[2];
    case "==": return row[e[1]] === e[2];
    case "f": return row[e[1]];
    case "if": return evaluate(e[1], row) ? e[2] : e[3];
  }
  throw new Error(`unknown expression ${JSON.stringify(e)}`);
}

export function computedText(c, row) {
  const v = evaluate(c.expr, row);
  return c.expr[0] === "if" ? v : formatNumber(c, v);
}

// The updateEvery effect on one cell.
function effect(t, op, row) {
  const c = columnOf(t, op.column);
  const v = row[c.name];
  let nv;
  switch (c.kind) {
    case "label": case "text": nv = v + op.suffix; break;
    case "number": nv = v + op.delta; break;
    case "date": nv = ((v - 1 + op.days) % 365) + 1; break;
    case "status": nv = c.options[(c.options.indexOf(v) + 1) % c.options.length]; break;
    case "flag": nv = !v; break;
    default: throw new Error(`updateEvery on a ${c.kind} column`);
  }
  return { ...row, [c.name]: nv };
}

// Sort order: numbers, dates and ids numerically, texts and labels by UTF-16 code units, statuses
// by option index, flags false before true; ties by id ascending.
export function compareRows(t, column, dir) {
  const c = column === "id" ? { kind: "id", name: "id" } : columnOf(t, column);
  const key = c.kind === "status" ? (row) => c.options.indexOf(row[c.name]) : c.kind === "flag" ? (row) => (row[c.name] ? 1 : 0) : (row) => row[c.name];
  const sign = dir === "desc" ? -1 : 1;
  return (a, b) => {
    const x = key(a), y = key(b);
    const d = x < y ? -1 : x > y ? 1 : 0;
    return d !== 0 ? sign * d : a.id - b.id;
  };
}

function setTable(state, id, ts) {
  return { ...state, tables: { ...state.tables, [id]: ts } };
}

const without = (ts, keep) => {
  const rows = ts.rows.filter(keep);
  if (rows.length === ts.rows.length) return ts;
  const selected = ts.selected != null && !rows.some((r) => r.id === ts.selected) ? null : ts.selected;
  return { ...ts, rows, selected };
};

function applyOp(t, ts, op) {
  switch (op.kind) {
    case "create": {
      const b = buildRows(t, ts, op.count);
      return { ...ts, rows: b.rows, selected: null, nextId: b.nextId, rng: b.rng };
    }
    case "append": {
      const b = buildRows(t, ts, op.count);
      return { ...ts, rows: ts.rows.concat(b.rows), nextId: b.nextId, rng: b.rng };
    }
    case "updateEvery": {
      if (ts.rows.length === 0) return ts;
      const rows = ts.rows.slice();
      for (let i = 0; i < rows.length; i += op.k) rows[i] = effect(t, op, rows[i]);
      return { ...ts, rows };
    }
    case "clear":
      return ts.rows.length === 0 && ts.selected == null ? ts : { ...ts, rows: [], selected: null };
    case "swap": {
      if (ts.rows.length <= op.j) return ts;
      const rows = ts.rows.slice();
      [rows[op.i], rows[op.j]] = [rows[op.j], rows[op.i]];
      return { ...ts, rows };
    }
    case "sort": {
      const rows = ts.rows.slice().sort(compareRows(t, op.column, op.dir));
      return rows.every((r, i) => r === ts.rows[i]) ? ts : { ...ts, rows };
    }
    case "removeChecked":
      return without(ts, (r) => !r[op.column]);
  }
  throw new Error(`unknown operation ${op.kind}`);
}

function applyControl(t, ts, ctl, id) {
  const at = ts.rows.findIndex((r) => r.id === id);
  if (at < 0) throw new Error(`table ${t.id} has no row ${id}`);
  switch (ctl.kind) {
    case "select": return ts.selected === id ? ts : { ...ts, selected: id };
    case "remove": return without(ts, (r) => r.id !== id);
    case "toggle": case "bump": {
      const row = ts.rows[at];
      const rows = ts.rows.slice();
      rows[at] = { ...row, [ctl.column]: ctl.kind === "toggle" ? !row[ctl.column] : row[ctl.column] + ctl.delta };
      return { ...ts, rows };
    }
  }
  throw new Error(`unknown row control ${ctl.kind}`);
}

export function update(spec, state, msg) {
  switch (msg.type) {
    case "snapshot":
      return msg.state;
    case "serverRows": {
      const ts = state.tables[msg.table];
      const maxId = msg.rows.reduce((m, r) => Math.max(m, r.id), 0);
      const selected = ts.selected != null && msg.rows.some((r) => r.id === ts.selected) ? ts.selected : null;
      return setTable(state, msg.table, { ...ts, rows: msg.rows, selected, nextId: Math.max(ts.nextId, maxId + 1) });
    }
    case "serverUpdate": {
      const ts = state.tables[msg.table];
      const values = new Map(msg.changes.map((c) => [c.id, c.value]));
      let changed = false;
      const rows = ts.rows.map((r) => {
        if (!values.has(r.id) || r[msg.column] === values.get(r.id)) return r;
        changed = true;
        return { ...r, [msg.column]: values.get(r.id) };
      });
      return changed ? setTable(state, msg.table, { ...ts, rows }) : state;
    }
    case "serverDelete": {
      const ts = state.tables[msg.table];
      const ids = new Set(msg.ids);
      const next = without(ts, (r) => !ids.has(r.id));
      return next === ts ? state : setTable(state, msg.table, next);
    }
  }
  const t = byId(spec, msg.table);
  if (!t) throw new Error(`no table ${msg.table}`);
  const ts = state.tables[t.id];
  const op = opOf(t, msg.type);
  let next;
  if (op) next = applyOp(t, ts, op);
  else {
    const ctl = rowControls(t).find((c) => c.role === msg.type);
    if (!ctl) throw new Error(`table ${t.id} has no operation or row control ${msg.type}`);
    next = applyControl(t, ts, ctl, msg.id);
  }
  return next === ts ? state : setTable(state, t.id, next);
}

// The reference render. Returns a tree of { tag, attrs, props, children } and strings.
// `attrs` are HTML attributes; `props` are live DOM properties (a checkbox's checked) that have
// no attribute in the page.

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

export function render(spec, state) {
  return h("div", { "data-role": "page" }, spec.tables.map((t) => renderTable(t, state.tables[t.id])));
}

export function renderTable(t, ts) {
  return h("section", { "data-key": t.id, "data-role": "table" },
    h("h2", null, t.title),
    h("div", null, t.ops.map((o) => h("button", { "data-role": o.name }, o.text))),
    h("table", null,
      t.thead ? h("thead", null, h("tr", null, t.columns.map((c) => h("th", null, c.header)))) : null,
      h("tbody", null, ts.rows.map((row) => renderRow(t, row, row.id === ts.selected)))));
}

export function renderRow(t, row, selected) {
  const attrs = { "data-key": row.id, "data-role": "row" };
  if (selected && t.marker) attrs[t.marker.attr] = t.marker.value;
  return h("tr", attrs, t.columns.map((c) => renderCell(c, row)));
}

function renderCell(c, row) {
  switch (c.kind) {
    case "id": return h("td", null, String(row.id));
    case "label": case "text": return h("td", null, c.select ? h("a", { "data-role": c.select }, row[c.name]) : row[c.name]);
    case "number": return h("td", null, formatNumber(c, row[c.name]));
    case "date": return h("td", null, formatDate(c.format, row[c.name]));
    case "status": return h("td", null, h(c.tag, null, row[c.name]));
    case "flag": return h("td", null, h("input", { type: "checkbox", "data-role": c.toggle, checked: row[c.name] }));
    case "computed": return h("td", null, computedText(c, row));
    case "remove": return h("td", null, h(c.element, { "data-role": c.role }, c.glyph ? h("span", { "aria-hidden": "true" }, c.text) : c.text));
    case "bump": return h("td", null, h("button", { "data-role": c.role }, c.text));
    case "spacer": return h("td", null);
  }
  throw new Error(`unknown column kind ${c.kind}`);
}

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (s) => s.replace(/[&<>"]/g, (c) => ESC[c]);

// Serialize a reference tree as HTML (props shown as attributes, for reading).
export function toHTML(node) {
  if (typeof node === "string") return esc(node);
  const attrs = { ...node.attrs };
  if (node.props.checked) attrs.checked = "";
  const open = `<${node.tag}${Object.entries(attrs).map(([k, v]) => (v === "" ? ` ${k}` : ` ${k}="${esc(v)}"`)).join("")}>`;
  if (node.tag === "input") return open;
  return open + node.children.map(toHTML).join("") + `</${node.tag}>`;
}

// ---------------------------------------------------------------------------------------------
// External events. Each builder is a pure function of the spec, the current reference state
// and a salt, so the serve panel can produce fresh events and the script stays deterministic.
// Server values are drawn with the generator's randomness, never with a table's own PRNG.

// A random value for a data column, different from `old` when one is given.
function serverValue(c, r, old) {
  const draw = () => {
    switch (c.kind) {
      case "label": return c.pools.map((p) => r.pick(p)).join(" ");
      case "text": return r.pick(c.pool);
      case "number": return r.int(c.min, c.max);
      case "date": return r.int(1, 365);
      case "status": return r.pick(c.options);
      case "flag": return r.chance(0.5);
    }
    throw new Error(`no server value for a ${c.kind} column`);
  };
  let v = draw();
  for (let k = 0; old !== undefined && v === old && k < 8; k++) v = draw();
  if (old !== undefined && v === old) {
    v = c.kind === "flag" ? !old : c.kind === "status" ? c.options[(c.options.indexOf(old) + 1) % c.options.length]
      : typeof old === "number" ? (c.kind === "date" ? (old % 365) + 1 : old + 1) : `${old} 2`;
  }
  return v;
}

function serverRow(t, id, r) {
  const row = { id };
  for (const c of dataColumns(t)) row[c.name] = serverValue(c, r);
  return row;
}

// One data cell of a row changed.
function editRow(t, row, r) {
  const c = r.pick(dataColumns(t));
  return { ...row, [c.name]: serverValue(c, r, row[c.name]) };
}

// Reverse a slice of at least two rows, so some keep their place and some move.
function partlyReorder(list, r) {
  if (list.length < 2) return list.slice();
  const a = r.int(0, list.length - 2);
  const b = r.int(a + 1, list.length - 1);
  return [...list.slice(0, a), ...list.slice(a, b + 1).reverse(), ...list.slice(b + 1)];
}

// "The server sent this page of rows": most current rows (about 1 in 10 dropped, 1 in 5 edited,
// a slice reversed), then two or three new rows with ids from nextId up (one id skipped).
export function serverRowsMsg(spec, state, table, salt) {
  const r = rng("serverRows", spec.options.seed, table, salt);
  const t = byId(spec, table), ts = state.tables[table];
  let rows = ts.rows.filter(() => !r.chance(0.1)).map((row) => (r.chance(0.2) ? editRow(t, row, r) : row));
  rows = partlyReorder(rows, r);
  const n = r.int(2, 3);
  for (let k = 0; k < n; k++) rows.push(serverRow(t, ts.nextId + k + (k === n - 1 ? 1 : 0), r));
  return { type: "serverRows", table, rows };
}

// The data column a serverUpdate changes: one a computed cell reads, where there is one.
export function serverColumn(t) {
  const read = new Set();
  const visit = (e) => { if (Array.isArray(e)) e.slice(1).forEach(visit); else if (typeof e === "string") read.add(e); };
  for (const c of t.columns) if (c.expr) visit(c.expr);
  const data = dataColumns(t);
  return data.find((c) => read.has(c.name)) || data[0];
}

// "These rows' prices (or statuses…) changed": `count` existing rows (the first row among them)
// get a new value in one column; one more change names an id that does not exist.
export function serverUpdateMsg(spec, state, table, salt, count = 3) {
  const r = rng("serverUpdate", spec.options.seed, table, salt);
  const t = byId(spec, table), ts = state.tables[table];
  const c = serverColumn(t);
  const picked = ts.rows.length ? [ts.rows[0], ...r.sample(ts.rows.slice(1), count - 1)] : [];
  const changes = picked.map((row) => ({ id: row.id, value: serverValue(c, r, row[c.name]) }));
  changes.push({ id: ts.nextId + 1000, value: serverValue(c, r) });
  return { type: "serverUpdate", table, column: c.name, changes };
}

// "These rows were deleted elsewhere": the selected row (if any) and others, `count` in all, plus
// an id that does not exist.
export function serverDeleteMsg(spec, state, table, salt, count = 2) {
  const r = rng("serverDelete", spec.options.seed, table, salt);
  const ts = state.tables[table];
  const ids = [];
  if (ts.selected != null) ids.push(ts.selected);
  for (const row of r.sample(ts.rows.filter((x) => x.id !== ts.selected), Math.max(0, count - ids.length))) ids.push(row.id);
  ids.push(ts.nextId + 1000);
  return { type: "serverDelete", table, ids };
}

// "Here is the whole state": every table replaced. Rows keep their ids, but a slice is reversed,
// one row is gone, one new row is inserted, every third row has a cell edited, the selection
// moves (in tables with select), and rng and nextId are new.
export function snapshot(spec, state, salt) {
  const r = rng("snapshot", spec.options.seed, salt);
  const tables = {};
  for (const t of spec.tables) {
    const ts = state.tables[t.id];
    let rows = partlyReorder(ts.rows, r);
    if (rows.length > 1) rows.splice(r.int(0, rows.length - 1), 1);
    rows = rows.map((row, i) => (i % 3 === 0 ? editRow(t, row, r) : row));
    rows.splice(r.int(0, rows.length), 0, serverRow(t, ts.nextId, r));
    const others = rows.filter((x) => x.id !== ts.selected);
    const selected = t.marker && others.length ? r.pick(others).id : null;
    tables[t.id] = { rows, selected, nextId: ts.nextId + 1 + r.int(0, 3), rng: r.int(1, PRNG_MOD - 1) };
  }
  return { tables };
}

// The external events the serve panel offers.
export function panelEvents(spec) {
  const ids = spec.tables.map((t) => t.id);
  return [
    { name: "serverRows", targets: ids, make: (state, target, salt) => serverRowsMsg(spec, state, target, salt) },
    { name: "serverUpdate", targets: ids, make: (state, target, salt) => serverUpdateMsg(spec, state, target, salt) },
    { name: "serverDelete", targets: ids, make: (state, target, salt) => serverDeleteMsg(spec, state, target, salt) },
    { name: "snapshot", make: (state, _target, salt) => ({ type: "snapshot", state: snapshot(spec, state, salt) }) },
  ];
}

// ---------------------------------------------------------------------------------------------
// The interaction script: the same for every framework.
//
// Steps:
//   { do: "mount" } | { do: "dispose" }
//   { do: "click", target, msg }               click the element
//   { do: "dispatch", msg }                    an external event through the contract
// A target is a CSS selector built from the stable data-key/data-role attributes. `msg` is the
// reference message the step stands for. A step is only generated when its target is rendered
// in the reference at that moment.

// The tables the script exercises: all of them up to 16, else the first 4 and 12 others.
export const SCRIPT_ALL = 16;

export function scriptTables(spec) {
  if (spec.tables.length <= SCRIPT_ALL) return spec.tables;
  const rest = rng("sample", spec.options.seed).sample(spec.tables.slice(4), SCRIPT_ALL - 4);
  return spec.tables.filter((t, i) => i < 4 || rest.includes(t));
}

// The selector of a toolbar button (`row` null) or of a row control in the row with id `row`.
export function target(table, role, row) {
  return row != null ? `[data-key="${table}"] tr[data-key="${row}"] [data-role="${role}"]` : `[data-key="${table}"] [data-role="${role}"]`;
}

export function makeScript(spec) {
  const steps = [];
  let state = spec.initialState;
  const push = (step) => {
    steps.push(step);
    if (step.msg) state = update(spec, state, step.msg);
  };
  const seed = spec.options.seed;
  const rows = (t) => state.tables[t.id].rows;
  const op = (t, name) => push({ do: "click", label: `${t.id} ${name}`, target: target(t.id, name), msg: { table: t.id, type: name } });
  const control = (t, role, id) => push({ do: "click", label: `${t.id} ${role} row ${id}`, target: target(t.id, role, id), msg: { table: t.id, type: role, id } });
  const dispatch = (label, msg) => push({ do: "dispatch", label, msg });

  push({ do: "mount", label: "mount" });

  // 2. Table 1, in js-framework-benchmark's spirit.
  const t1 = spec.tables[0];
  const r1 = rng("script", seed, t1.id);
  const at = (i) => rows(t1)[Math.min(i, rows(t1).length - 1)].id;
  op(t1, "run");
  control(t1, "select", at(4));
  op(t1, "update");
  op(t1, "swaprows");
  control(t1, "remove", at(2));
  if (state.tables.t1.selected != null) control(t1, "remove", state.tables.t1.selected);
  op(t1, "add");
  control(t1, "select", at(r1.int(0, rows(t1).length - 1)));
  op(t1, "runlots");
  op(t1, "swaprows");
  op(t1, "swaprows");
  op(t1, "clear");
  op(t1, "run");

  // 3. Every other exercised table: create; select two rows; toggle and bump on 2 rows (the
  // selected row among them); each other operation once; remove the selected row (or another);
  // clear, followed by a new create.
  const tables = scriptTables(spec);
  for (const t of tables.slice(1)) exercise(t, rng("script", seed, t.id));

  function exercise(t, r) {
    const ctls = rowControls(t);
    const create = t.ops.find((o) => o.kind === "create");
    const someRow = (except) => {
      const rs = rows(t).filter((x) => x.id !== except);
      return rs.length ? r.pick(rs).id : null;
    };
    op(t, create.name);
    const select = ctls.find((c) => c.kind === "select");
    if (select) {
      control(t, select.role, someRow());
      control(t, select.role, someRow(state.tables[t.id].selected));
    }
    for (const c of ctls.filter((x) => x.kind === "toggle" || x.kind === "bump")) {
      const sel = state.tables[t.id].selected;
      const ids = sel != null ? [sel, someRow(sel)] : [someRow(), null];
      if (ids[1] == null) ids[1] = someRow(ids[0]);
      for (const id of ids) if (id != null) control(t, c.role, id);
    }
    for (const o of t.ops) {
      if (o.kind === "create" || o.kind === "clear") continue;
      op(t, o.name);
    }
    const remove = ctls.find((c) => c.kind === "remove");
    const gone = state.tables[t.id].selected ?? someRow();
    if (remove && gone != null) control(t, remove.role, gone);
    const clear = t.ops.find((o) => o.kind === "clear");
    if (clear) {
      op(t, clear.name);
      op(t, create.name);
    }
  }

  // 4. External events.
  const re = rng("external", seed);
  const others = tables.slice(1);
  dispatch("serverRows t1", serverRowsMsg(spec, state, "t1", "script"));
  const filled = others.filter((t) => rows(t).length > 0);
  if (filled.length) {
    const t = re.pick(filled);
    dispatch(`serverRows ${t.id}`, serverRowsMsg(spec, state, t.id, "script"));
  }
  const readers = others.filter((t) => t.columns.some((c) => c.kind === "computed"));
  const pickN = (pool, n) => re.sample(pool, Math.min(n, pool.length)).sort((a, b) => spec.tables.indexOf(a) - spec.tables.indexOf(b));
  let updated = pickN(readers, 2);
  if (updated.length < 2) updated = [...updated, ...pickN(others.filter((t) => !updated.includes(t)), 2 - updated.length)];
  if (updated.length < 2) updated.push(t1);
  for (const t of updated) dispatch(`serverUpdate ${t.id}`, serverUpdateMsg(spec, state, t.id, "script"));
  // serverDelete on a table with select, with its selected row among the ids.
  const selectable = tables.filter((t) => rowControls(t).some((c) => c.kind === "select") && rows(t).length > 2);
  const del = selectable.length > 1 ? re.pick(selectable.slice(1)) : selectable[0];
  if (del) {
    if (state.tables[del.id].selected == null) {
      const select = rowControls(del).find((c) => c.kind === "select");
      control(del, select.role, re.pick(rows(del)).id);
    }
    dispatch(`serverDelete ${del.id}`, serverDeleteMsg(spec, state, del.id, "script"));
  }

  // 5. A reorder through a snapshot.
  dispatch("snapshot", { type: "snapshot", state: snapshot(spec, state, "script") });

  // 6. A final round: select, swap and remove in t1; one row control in every other exercised
  // table with rows.
  const rf = rng("final", seed);
  control(t1, "select", rf.pick(rows(t1)).id);
  op(t1, "swaprows");
  control(t1, "remove", rf.pick(rows(t1)).id);
  for (const t of others) {
    const ctls = rowControls(t);
    if (!ctls.length || rows(t).length === 0) continue;
    control(t, rf.pick(ctls).role, rf.pick(rows(t)).id);
  }

  push({ do: "dispose", label: "dispose" });
  return steps;
}
