// A seeded generator of realistic JavaScript for ./rr parse: one big "back office" program
// (warehouse, orders, billing, scheduling) made of many DISTINCT modules.
//
//   generate({ bytes, seed }) → { source, modules }
//
// The program is one classic script: a tiny module registry, then `def("name", factory)` calls,
// then a boot function. Every module is drawn from one of ~20 shapes (entity classes, config
// tables, state machines, regex parsers, async clients, calculators, schedulers, caches, CSV
// readers, ...), and each instance draws its own words, field lists, constants, branch counts and
// optional members, so no two modules are alike. The program grows by adding modules, never by
// repeating one. The same (bytes, seed) always gives the same bytes; a smaller payload is a
// prefix of a larger one up to the footer, so the sizes are one program at different lengths.
//
// The top level only defines factories and registers them; a factory runs when its module is
// first required, and boot() requires two. So evaluating the script is dominated by parsing and
// compiling, not by running.
//
// Template conventions below: "§" stands for a backtick and "@{" for "${" of the GENERATED code (replaced at the end).

// ---- seeded random ---------------------------------------------------------------------------
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- vocabulary ------------------------------------------------------------------------------
const DOMAINS = {
  orders: ["order", "line", "cart", "customer", "address", "coupon", "return", "refund", "quote", "backorder", "basket", "checkout", "wishlist", "subscription"],
  warehouse: ["pallet", "bin", "aisle", "shelf", "sku", "lot", "carton", "dock", "forklift", "stocktake", "zone", "slot", "rack", "manifest", "consignment", "tote"],
  billing: ["invoice", "payment", "ledger", "tax", "credit", "charge", "statement", "discount", "remittance", "account", "voucher", "tariff", "receipt", "balance"],
  scheduling: ["shift", "appointment", "route", "driver", "vehicle", "window", "calendar", "task", "deadline", "roster", "booking", "trip", "leg", "assignment"],
};
const DOMAIN_NAMES = Object.keys(DOMAINS);
const ADJ = ["pending", "partial", "bulk", "express", "fragile", "frozen", "prepaid", "overdue", "recurring", "standard", "priority", "internal", "external", "primary", "backup", "weekly", "monthly", "regional", "manual", "automatic", "provisional", "final", "open", "closed", "cold", "hazardous", "consolidated", "split"];
const VERBS = ["validate", "compute", "allocate", "reserve", "release", "normalize", "format", "parse", "reconcile", "schedule", "dispatch", "audit", "merge", "split", "round", "resolve", "collect", "archive", "restore", "estimate", "apply", "verify", "assign", "expire", "refresh"];
const NOUN_EXTRA = ["total", "rate", "limit", "batch", "queue", "window", "summary", "index", "digest", "slice", "entry", "record", "request", "result", "profile", "rule", "policy", "plan", "event", "report"];
const FIELD_NAMES = ["name", "code", "qty", "weight", "volume", "price", "currency", "status", "createdAt", "updatedAt", "owner", "notes", "priority", "region", "carrier", "batch", "expiry", "reference", "label", "channel", "depth", "height", "width", "capacity", "margin", "discount", "deliverBy", "startsAt", "endsAt", "origin", "destination", "supplier", "contact", "phone", "email", "sequence", "revision", "barcode", "tag", "category"];
const CODE_PREFIXES = ["WH", "OR", "INV", "PAY", "SH", "RT", "LT", "BN", "PL", "DR", "TX", "CR", "AP", "BK"];
const STATUSES = ["draft", "pending", "confirmed", "picked", "packed", "shipped", "delivered", "cancelled", "on-hold", "paid", "failed", "refunded", "scheduled", "active", "completed", "expired", "disputed", "settled"];
const EVENTS = ["submit", "approve", "reject", "pick", "pack", "ship", "deliver", "cancel", "hold", "resume", "pay", "fail", "refund", "schedule", "start", "finish", "expire", "dispute", "settle", "reopen"];
const CURRENCIES = ["EUR", "USD", "GBP", "BRL", "CAD", "AUD", "JPY", "CHF", "SEK", "MXN"];
const REGIONS = ["north", "south", "east", "west", "central", "coastal", "island", "inland", "metro", "rural"];
const LOCALVARS = ["acc", "item", "entry", "row", "cur", "prev", "next", "bucket", "part", "slot", "cell", "node", "pair", "chunk", "hit", "opt"];
const COMMENT_PHRASES = [
  "keep this in sync with the pricing service", "legacy behaviour, see the migration notes", "rounding follows the finance team's rules",
  "must stay stable, the nightly job depends on it", "falls back to the default region when unknown", "callers pass a plain object, not an instance",
  "this is called once per batch, so clarity beats speed", "negative values are rejected earlier", "the warehouse uses local time, not UTC",
  "we cap this to keep the label printer happy", "order matters here: the first match wins", "an empty list means no restriction",
  "see the carrier contract for the surcharge table", "idempotent: safe to call twice", "values are copied, never shared",
];

// ---- the generator state ---------------------------------------------------------------------
function makeGen(seed) {
  const next = rng(seed);
  const g = {
    next,
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    chance: (p) => next() < p,
    pick: (xs) => xs[Math.floor(next() * xs.length)],
    sample(xs, n) {
      const pool = [...xs];
      const out = [];
      while (out.length < n && pool.length) out.push(pool.splice(Math.floor(next() * pool.length), 1)[0]);
      return out;
    },
    num: (a, b, d = 2) => +(a + next() * (b - a)).toFixed(d),
    used: new Set(),
    domain: "orders",
  };
  g.noun = () => g.pick(DOMAINS[g.domain]);
  g.anyNoun = () => g.pick(DOMAINS[g.pick(DOMAIN_NAMES)]);
  // A fresh identifier: unique over the whole program, so no two modules share a class or table name.
  g.unique = (make) => {
    for (let i = 0; ; i++) {
      const name = i < 4 ? make() : make() + g.int(2, 99);
      if (!g.used.has(name)) { g.used.add(name); return name; }
    }
  };
  g.local = () => g.pick(LOCALVARS);
  return g;
}

const cap = (s) => s[0].toUpperCase() + s.slice(1);
const camel = (...w) => w.map((x, i) => (i ? cap(x) : x)).join("");
const pascal = (...w) => w.map(cap).join("");
const kebab = (...w) => w.join("-");
const upper = (...w) => w.join("_").toUpperCase();
const q = (s) => JSON.stringify(s);

function sentence(g) {
  const forms = [
    () => cap(g.pick(VERBS)) + " the " + g.pick(ADJ) + " " + g.noun() + " for a given " + g.anyNoun() + ".",
    () => "Returns the " + g.pick(NOUN_EXTRA) + " of every " + g.pick(ADJ) + " " + g.noun() + ".",
    () => "Handles " + g.pick(ADJ) + " " + g.noun() + " records for the " + g.pick(REGIONS) + " region.",
    () => cap(g.noun()) + " " + g.pick(NOUN_EXTRA) + ": " + g.pick(COMMENT_PHRASES) + ".",
  ];
  return g.pick(forms)();
}
const doc = (g, ind, params = []) => {
  const lines = [sentence(g), ...(g.chance(0.4) ? ["", cap(g.pick(COMMENT_PHRASES)) + "."] : [])];
  const body = [...lines, ...params.map(([n, t]) => `@param {${t}} ${n} ${g.pick(ADJ)} ${g.noun()} ${g.pick(NOUN_EXTRA)}`)];
  return `${ind}/**\n${body.map((l) => `${ind} * ${l}`.trimEnd()).join("\n")}\n${ind} */\n`;
};
const note = (g, ind) => (g.chance(0.35) ? `${ind}// ${g.pick(COMMENT_PHRASES)}\n` : "");

// ---- fields (used by entity-like shapes) -----------------------------------------------------
const FIELD_TYPES = ["code", "text", "qty", "money", "flag", "date", "status", "ref"];
function makeFields(g, n) {
  const names = g.sample(FIELD_NAMES, n);
  return names.map((name) => {
    const type = g.pick(FIELD_TYPES);
    const f = { name, type, label: name.replace(/([A-Z])/g, " $1").toLowerCase() };
    if (type === "code") { f.prefix = g.pick(CODE_PREFIXES); f.digits = g.int(3, 7); }
    if (type === "text") f.max = g.pick([24, 40, 60, 80, 120, 200, 255]);
    if (type === "qty") f.max = g.pick([99, 500, 1000, 9999, 50000]);
    if (type === "money") f.max = g.pick([1000, 25000, 100000, 999999]);
    if (type === "status") f.values = g.sample(STATUSES, g.int(3, 6));
    return f;
  });
}
const fieldDefault = (f) => ({ code: '""', text: '""', qty: "0", money: "0", flag: "false", date: "null", status: q(f.values?.[0]), ref: "null" }[f.type]);
function fieldInit(f) {
  const n = f.name;
  switch (f.type) {
    case "date": return `init.${n} ? new Date(init.${n}) : null`;
    case "qty": return `Math.trunc(Number(init.${n} ?? 0))`;
    case "money": return `Number(init.${n} ?? 0)`;
    case "flag": return `Boolean(init.${n})`;
    case "status": return `init.${n} ?? ${q(f.values[0])}`;
    case "ref": return `init.${n} ?? null`;
    default: return `init.${n} ?? ""`;
  }
}
function fieldCheck(f, self = "this") {
  const v = `${self}.${f.name}`;
  switch (f.type) {
    case "code": return `if (!/^${f.prefix}-\\d{${f.digits}}$/.test(${v})) errors.push(§${f.label} "@{${v}}" does not look like ${f.prefix}-${"0".repeat(f.digits)}§);`;
    case "text": return `if (!${v} || ${v}.length > ${f.max}) errors.push(§${f.label} must be 1-${f.max} characters§);`;
    case "qty": return `if (!Number.isInteger(${v}) || ${v} < 0 || ${v} > ${f.max}) errors.push(§${f.label} out of range: @{${v}}§);`;
    case "money": return `if (!(${v} >= 0) || ${v} > ${f.max}) errors.push(§${f.label} must be between 0 and ${f.max}§);`;
    case "flag": return `if (typeof ${v} !== "boolean") errors.push("${f.label} must be true or false");`;
    case "date": return `if (${v} && Number.isNaN(${v}.getTime())) errors.push("${f.label} is not a valid date");`;
    case "status": return `if (!${camel(...f.name.split(/(?=[A-Z])/).map((s) => s.toLowerCase()), "values")}.includes(${v})) errors.push(§unknown ${f.label} "@{${v}}"§);`;
    default: return `if (${v} !== null && typeof ${v} !== "object" && typeof ${v} !== "string") errors.push("${f.label} must be a reference");`;
  }
}
const fieldJson = (f) => (f.type === "date" ? `this.${f.name} ? this.${f.name}.toISOString() : null` : `this.${f.name}`);
const statusConst = (f) => camel(...f.name.split(/(?=[A-Z])/).map((s) => s.toLowerCase()), "values");

// ---- module shapes ---------------------------------------------------------------------------
// Each shape returns the body of a factory (code between "function (use) {" and "}"), with the
// module's exports in a final `return`.

function entityClass(g) {
  const name = g.unique(() => pascal(g.pick(ADJ), g.noun()));
  const fields = makeFields(g, g.int(4, 9));
  const statuses = fields.filter((f) => f.type === "status");
  const money = fields.find((f) => f.type === "money"), qty = fields.find((f) => f.type === "qty");
  let s = "";
  for (const f of statuses) s += `const ${statusConst(f)} = ${q(f.values)};\n`;
  s += `\n${doc(g, "", [["init", "object"]])}class ${name} {\n  constructor(init = {}) {\n`;
  for (const f of fields) s += `    this.${f.name} = ${fieldInit(f)};\n`;
  s += `    this.updatedAt ??= Date.now();\n  }\n\n`;
  s += `  static from(json) {\n    const data = typeof json === "string" ? JSON.parse(json) : json;\n    return new ${name}(data);\n  }\n\n`;
  s += `${doc(g, "  ")}  validate() {\n    const errors = [];\n${fields.map((f) => "    " + fieldCheck(f)).join("\n")}\n    return errors;\n  }\n\n`;
  if (money && qty) s += `  get extended() {\n    return Math.round(this.${money.name} * this.${qty.name} * 100) / 100;\n  }\n\n`;
  else if (money) s += `  get cents() {\n    return Math.round(this.${money.name} * 100);\n  }\n\n`;
  if (statuses[0]) {
    const sf = statuses[0];
    s += `  advance() {\n    const at = ${statusConst(sf)}.indexOf(this.${sf.name});\n    if (at < 0 || at === ${statusConst(sf)}.length - 1) return false;\n    this.${sf.name} = ${statusConst(sf)}[at + 1];\n    return this.touch();\n  }\n\n`;
  }
  s += `  touch() {\n    this.updatedAt = Date.now();\n    return this;\n  }\n\n`;
  if (g.chance(0.5)) s += `  clone(overrides = {}) {\n    return new ${name}({ ...this.toJSON(), ...overrides });\n  }\n\n`;
  s += `  toJSON() {\n    return {\n${fields.map((f) => `      ${f.name}: ${fieldJson(f)},`).join("\n")}\n    };\n  }\n}\n\nreturn { ${name} };`;
  return s;
}

function configTable(g) {
  const table = g.unique(() => upper(g.noun(), g.pick(["rates", "limits", "tiers", "defaults", "surcharges", "codes"])));
  const keys = g.sample(REGIONS.concat(CURRENCIES.map((c) => c.toLowerCase())), g.int(4, 8));
  const cols = g.sample(["rate", "base", "min", "max", "step", "fee", "days", "factor"], g.int(2, 4));
  const fn = g.unique(() => camel(g.pick(["lookup", "resolve", "find", "get"]), g.noun(), g.pick(["rate", "entry", "config"])));
  let s = `${doc(g, "")}const ${table} = Object.freeze({\n`;
  for (const k of keys) s += `  ${/^[a-z]+$/.test(k) ? k : q(k)}: { ${cols.map((c) => `${c}: ${c === "days" ? g.int(1, 21) : c === "factor" ? g.num(0.5, 2.5, 3) : g.num(0, 120, g.chance(0.5) ? 0 : 2)}`).join(", ")} },\n`;
  s += `});\n\nconst fallbackKey = ${q(keys[0])};\n\n`;
  s += `function ${fn}(key, column = ${q(cols[0])}) {\n${note(g, "  ")}  const row = ${table}[String(key).toLowerCase()] ?? ${table}[fallbackKey];\n  if (!(column in row)) throw new RangeError(§no column "@{column}" in ${table}§);\n  return row[column];\n}\n\n`;
  const agg = g.pick(["Math.max", "Math.min"]);
  s += `function summarize() {\n  const out = {};\n  for (const [key, row] of Object.entries(${table})) {\n    out[key] = ${agg}(...Object.values(row));\n  }\n  return out;\n}\n\n`;
  if (g.chance(0.6)) s += `function describe(key) {\n  const row = ${table}[key];\n  return row ? Object.entries(row).map(([k, v]) => §@{k}=@{v}§).join(", ") : "n/a";\n}\n\n`;
  s += `return { ${table}, ${fn}, summarize${s.includes("function describe") ? ", describe" : ""} };`;
  return s;
}

function stateMachine(g) {
  const noun = g.noun();
  const name = g.unique(() => pascal(noun, g.pick(["flow", "machine", "lifecycle", "tracker"])));
  const states = g.sample(STATUSES, g.int(4, 7));
  const events = g.sample(EVENTS, g.int(4, 7));
  const transitions = {};
  for (const st of states) {
    const m = {};
    for (const ev of g.sample(events, g.int(1, 3))) m[ev] = g.pick(states);
    transitions[st] = m;
  }
  let s = `const ${upper(noun, "states")} = ${q(states)};\n\n`;
  s += `const ${upper(noun, "transitions")} = {\n${states.map((st) => `  ${q(st)}: { ${Object.entries(transitions[st]).map(([e, t]) => `${q(e)}: ${q(t)}`).join(", ")} },`).join("\n")}\n};\n\n`;
  s += `${doc(g, "")}function step(state, event) {\n  switch (event) {\n`;
  for (const ev of g.sample(events, g.int(2, 4))) {
    const st = g.sample(states, 2);
    s += `    case ${q(ev)}:\n      if (state === ${q(st[0])}) return ${q(g.pick(states))};\n      if (state === ${q(st[1])}) return ${q(g.pick(states))};\n      break;\n`;
  }
  s += `    default:\n      break;\n  }\n  return ${upper(noun, "transitions")}[state]?.[event] ?? null;\n}\n\n`;
  s += `class ${name} {\n  constructor(initial = ${q(states[0])}) {\n    this.state = initial;\n    this.history = [{ state: initial, at: Date.now() }];\n    this.listeners = new Set();\n  }\n\n`;
  s += `  can(event) {\n    return step(this.state, event) !== null;\n  }\n\n`;
  s += `  send(event) {\n    const to = step(this.state, event);\n    if (to === null) {\n      throw new Error(§@{this.state} cannot handle ${noun} event "@{event}"§);\n    }\n    const from = this.state;\n    this.state = to;\n    this.history.push({ state: to, at: Date.now(), event });\n    for (const fn of this.listeners) fn({ from, to, event });\n    return this;\n  }\n\n`;
  s += `  onChange(fn) {\n    this.listeners.add(fn);\n    return () => this.listeners.delete(fn);\n  }\n\n`;
  if (g.chance(0.6)) s += `  get visited() {\n    return [...new Set(this.history.map((h) => h.state))];\n  }\n\n`;
  s += `  get done() {\n    return !Object.keys(${upper(noun, "transitions")}[this.state] ?? {}).length;\n  }\n}\n\nreturn { ${name}, step, ${upper(noun, "states")} };`;
  return s;
}

function regexParser(g) {
  const noun = g.noun();
  const name = g.unique(() => camel(g.pick(["parse", "read", "decode", "scan"]), cap(noun), g.pick(["label", "code", "ref", "tag", "line"])));
  const pre = g.pick(CODE_PREFIXES), n1 = g.int(2, 4), n2 = g.int(3, 6);
  const sep = g.pick(["-", "/", ":", "."]);
  const esc = sep === "." ? "\\." : sep === "/" ? "\\/" : sep;
  let s = `${doc(g, "", [["text", "string"]])}const ${upper(noun, "pattern")} = /^(?<prefix>[A-Z]{${n1}})${esc}(?<serial>\\d{${n2}})(?:${esc}(?<check>[0-9A-F]{2}))?$/;\n`;
  s += `const ${upper(noun, "words")} = /\\b(${g.sample(VERBS, 3).join("|")})\\b/gi;\n\n`;
  s += `function ${name}(text) {\n  const m = ${upper(noun, "pattern")}.exec(String(text).trim().toUpperCase());\n  if (!m) return null;\n  const { prefix, serial, check } = m.groups;\n  return {\n    prefix,\n    serial: Number(serial),\n    check: check ?? null,\n    known: ${q(g.sample(CODE_PREFIXES, 4))}.includes(prefix),\n  };\n}\n\n`;
  s += `function format${cap(noun)}(parts) {\n  const serial = String(parts.serial).padStart(${n2}, "0");\n  const base = §@{parts.prefix}${sep}@{serial}§;\n  return parts.check ? §@{base}${sep}@{parts.check}§ : base;\n}\n\n`;
  s += `function checksum(text) {\n  let sum = ${g.int(3, 29)};\n  for (let i = 0; i < text.length; i++) {\n    sum = (sum * ${g.pick([31, 33, 37, 41])} + text.charCodeAt(i)) % ${g.pick([251, 257, 509, 997])};\n  }\n  return sum.toString(16).toUpperCase().padStart(2, "0").slice(-2);\n}\n\n`;
  s += `function highlight(sentence) {\n  return sentence.replace(${upper(noun, "words")}, (word) => §[@{word.toLowerCase()}]§);\n}\n\n`;
  s += `function tokens(text) {\n  const out = [];\n  for (const m of text.matchAll(/([A-Za-z]+)|(\\d+(?:\\.\\d+)?)|(\\S)/g)) {\n    out.push(m[1] ? { type: "word", value: m[1] } : m[2] ? { type: "number", value: Number(m[2]) } : { type: "punct", value: m[3] });\n  }\n  return out;\n}\n\nreturn { ${name}, format${cap(noun)}, checksum, highlight, tokens };`;
  return s;
}

function asyncClient(g) {
  const noun = g.noun();
  const name = g.unique(() => pascal(noun, g.pick(["client", "gateway", "sync", "loader"])));
  const err = g.unique(() => pascal(noun, "request", "error"));
  const base = "/api/" + kebab(noun) + "s";
  let s = `class ${err} extends Error {\n  constructor(status, path, cause) {\n    super(§@{status} for @{path}§);\n    this.name = ${q(err)};\n    this.status = status;\n    this.fatal = status >= 400 && status < 500 && status !== 429;\n    if (cause) this.cause = cause;\n  }\n}\n\n`;
  s += `const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));\n\n`;
  s += `${doc(g, "", [["options", "object"]])}class ${name} {\n  constructor(options = {}) {\n    this.base = options.base ?? ${q(base)};\n    this.retries = options.retries ?? ${g.int(1, 5)};\n    this.backoff = options.backoff ?? ${g.pick([50, 100, 250, 500])};\n    this.transport = options.transport ?? ((path, init) => fetch(path, init));\n    this.inflight = new Map();\n  }\n\n`;
  s += `  async request(path, init = {}) {\n    let attempt = 0;\n    for (;;) {\n      try {\n        const res = await this.transport(this.base + path, init);\n        if (!res.ok) throw new ${err}(res.status, path);\n        return await res.json();\n      } catch (e) {\n        attempt += 1;\n        if (e.fatal || attempt > this.retries) throw e;\n        await delay(this.backoff * 2 ** attempt);\n      }\n    }\n  }\n\n`;
  s += `  async get(id) {\n    if (this.inflight.has(id)) return this.inflight.get(id);\n    const promise = this.request(§/@{encodeURIComponent(id)}§).finally(() => this.inflight.delete(id));\n    this.inflight.set(id, promise);\n    return promise;\n  }\n\n`;
  s += `  async list({ page = 1, size = ${g.pick([10, 20, 25, 50])}, ...filters } = {}) {\n    const query = new URLSearchParams({ page, size, ...filters });\n    const body = await this.request(§?@{query}§);\n    return { items: body.items ?? [], total: body.total ?? 0, page };\n  }\n\n`;
  s += `  async loadAll(ids) {\n    const settled = await Promise.allSettled(ids.map((id) => this.get(id)));\n    const ok = [], failed = [];\n    settled.forEach((r, i) => (r.status === "fulfilled" ? ok.push(r.value) : failed.push({ id: ids[i], reason: r.reason })));\n    return { ok, failed };\n  }\n`;
  if (g.chance(0.5)) s += `\n  async *pages(size = ${g.pick([10, 25, 50])}) {\n    for (let page = 1; ; page++) {\n      const { items, total } = await this.list({ page, size });\n      if (!items.length) return;\n      yield items;\n      if (page * size >= total) return;\n    }\n  }\n`;
  s += `}\n\nreturn { ${name}, ${err} };`;
  return s;
}

function calculator(g) {
  const noun = g.noun();
  const fnA = g.unique(() => camel(g.pick(VERBS), cap(noun), g.pick(["total", "cost", "fee", "charge"])));
  const fnB = g.unique(() => camel(g.pick(["apply", "pick", "choose"]), cap(g.pick(ADJ)), g.pick(["discount", "tier", "surcharge"])));
  const tiers = Array.from({ length: g.int(3, 6) }, () => g.int(1, 400)).sort((a, b) => a - b);
  const rate = () => g.num(0.01, 0.4, 3);
  let s = `const TIERS = [\n${tiers.map((t) => `  { upTo: ${t}, rate: ${rate()} },`).join("\n")}\n  { upTo: Infinity, rate: ${rate()} },\n];\n\n`;
  s += `const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;\n\n`;
  s += `${doc(g, "", [["lines", "Array<object>"]])}function ${fnA}(lines, options = {}) {\n  const { taxRate = ${g.num(0, 0.25, 2)}, currency = ${q(g.pick(CURRENCIES))} } = options;\n  const subtotal = lines\n    .filter((${"line"}) => ${g.pick(["line.qty > 0", "!line.void", "line.price != null"])})\n    .map((line) => line.qty * line.price * (1 - (line.discount ?? 0)))\n    .reduce((sum, amount) => sum + amount, 0);\n  const tax = round2(subtotal * taxRate);\n  return { subtotal: round2(subtotal), tax, total: round2(subtotal + tax), currency };\n}\n\n`;
  s += `function ${fnB}(amount, kind) {\n  switch (kind) {\n`;
  for (const k of g.sample(ADJ, g.int(3, 5))) s += `    case ${q(k)}:\n      return round2(amount * ${g.num(0.5, 0.99, 2)});\n`;
  s += `    case "tiered": {\n      let rest = amount, prev = 0, total = 0;\n      for (const tier of TIERS) {\n        const slice = Math.min(rest, tier.upTo - prev);\n        if (slice <= 0) break;\n        total += slice * (1 - tier.rate);\n        rest -= slice;\n        prev = tier.upTo;\n      }\n      return round2(total);\n    }\n    default:\n      return round2(amount);\n  }\n}\n\n`;
  s += `function distribute(total, weights) {\n  const sum = weights.reduce((a, b) => a + b, 0) || 1;\n  const parts = weights.map((w) => Math.floor((total * w * 100) / sum) / 100);\n  let remainder = Math.round((total - parts.reduce((a, b) => a + b, 0)) * 100);\n  for (let i = 0; remainder > 0; i = (i + 1) % parts.length, remainder--) parts[i] = round2(parts[i] + 0.01);\n  return parts;\n}\n\n`;
  s += `function stats(values) {\n  if (!values.length) return { min: 0, max: 0, mean: 0, median: 0 };\n  const sorted = [...values].sort((a, b) => a - b);\n  const mid = sorted.length >> 1;\n  return {\n    min: sorted[0],\n    max: sorted[sorted.length - 1],\n    mean: round2(values.reduce((a, b) => a + b, 0) / values.length),\n    median: sorted.length % 2 ? sorted[mid] : round2((sorted[mid - 1] + sorted[mid]) / 2),\n  };\n}\n\nreturn { ${fnA}, ${fnB}, distribute, stats, TIERS };`;
  return s;
}

function scheduler(g) {
  const noun = g.noun();
  const name = g.unique(() => pascal(noun, g.pick(["queue", "planner", "agenda", "dispatcher"])));
  const startH = g.int(5, 9), endH = g.int(16, 21);
  let s = `const DAY = 24 * 60 * 60 * 1000;\nconst WORK_START = ${startH};\nconst WORK_END = ${endH};\n\n`;
  s += `function addDays(date, days) {\n  return new Date(date.getTime() + days * DAY);\n}\n\n`;
  s += `function isWeekend(date) {\n  const day = date.getDay();\n  return day === 0 || day === ${g.pick([6, 6, 5])};\n}\n\n`;
  s += `${doc(g, "", [["from", "Date"], ["days", "number"]])}function nextBusinessDay(from, days = 1) {\n  let cursor = new Date(from);\n  let left = days;\n  while (left > 0) {\n    cursor = addDays(cursor, 1);\n    if (!isWeekend(cursor)) left--;\n  }\n  cursor.setHours(WORK_START, 0, 0, 0);\n  return cursor;\n}\n\n`;
  s += `function overlaps(a, b) {\n  return a.start < b.end && b.start < a.end;\n}\n\n`;
  s += `class ${name} {\n  constructor(compare = (a, b) => a.priority - b.priority || a.due - b.due) {\n    this.heap = [];\n    this.compare = compare;\n  }\n\n  get size() {\n    return this.heap.length;\n  }\n\n`;
  s += `  push(task) {\n    const heap = this.heap;\n    heap.push(task);\n    let i = heap.length - 1;\n    while (i > 0) {\n      const parent = (i - 1) >> 1;\n      if (this.compare(heap[i], heap[parent]) >= 0) break;\n      [heap[i], heap[parent]] = [heap[parent], heap[i]];\n      i = parent;\n    }\n    return this;\n  }\n\n`;
  s += `  pop() {\n    const heap = this.heap;\n    if (!heap.length) return undefined;\n    const top = heap[0];\n    const last = heap.pop();\n    if (heap.length) {\n      heap[0] = last;\n      let i = 0;\n      for (;;) {\n        const l = 2 * i + 1, r = l + 1;\n        let m = i;\n        if (l < heap.length && this.compare(heap[l], heap[m]) < 0) m = l;\n        if (r < heap.length && this.compare(heap[r], heap[m]) < 0) m = r;\n        if (m === i) break;\n        [heap[i], heap[m]] = [heap[m], heap[i]];\n        i = m;\n      }\n    }\n    return top;\n  }\n\n`;
  s += `  drain(limit = Infinity) {\n    const out = [];\n    while (this.size && out.length < limit) out.push(this.pop());\n    return out;\n  }\n}\n\n`;
  s += `function findGaps(slots, from, to) {\n  const sorted = [...slots].sort((a, b) => a.start - b.start);\n  const gaps = [];\n  let cursor = from;\n  for (const slot of sorted) {\n    if (slot.start > cursor) gaps.push({ start: cursor, end: Math.min(slot.start, to) });\n    cursor = Math.max(cursor, slot.end);\n    if (cursor >= to) break;\n  }\n  if (cursor < to) gaps.push({ start: cursor, end: to });\n  return gaps;\n}\n\nreturn { ${name}, nextBusinessDay, overlaps, findGaps, addDays };`;
  return s;
}

function observableStore(g) {
  const noun = g.noun();
  const name = g.unique(() => camel("create", pascal(noun, g.pick(["store", "tracker", "registry", "board"]))));
  const keys = g.sample(FIELD_NAMES, g.int(3, 5));
  let s = `${doc(g, "", [["initial", "object"]])}function ${name}(initial = {}) {\n  let state = { ${keys.map((k) => `${k}: initial.${k} ?? ${g.pick(["0", '""', "null", "false"])}`).join(", ")} };\n  const subscribers = new Set();\n  let version = 0;\n  let batching = false;\n  let pending = null;\n\n`;
  s += `  function notify(prev) {\n    version += 1;\n    for (const fn of [...subscribers]) {\n      try {\n        fn(state, prev, version);\n      } catch (e) {\n        console.error("${noun} subscriber failed", e);\n      }\n    }\n  }\n\n`;
  s += `  function set(patch) {\n    const prev = state;\n    state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };\n    if (batching) {\n      pending ??= prev;\n      return state;\n    }\n    notify(prev);\n    return state;\n  }\n\n`;
  s += `  function batch(fn) {\n    batching = true;\n    try {\n      fn();\n    } finally {\n      batching = false;\n      if (pending) {\n        const prev = pending;\n        pending = null;\n        notify(prev);\n      }\n    }\n  }\n\n`;
  s += `  function subscribe(fn) {\n    subscribers.add(fn);\n    return () => subscribers.delete(fn);\n  }\n\n`;
  s += `  function select(pick, equals = Object.is) {\n    let last = pick(state);\n    return (fn) => subscribe((next) => {\n      const value = pick(next);\n      if (!equals(value, last)) {\n        last = value;\n        fn(value);\n      }\n    });\n  }\n\n`;
  s += `  return {\n    get: () => state,\n    set,\n    batch,\n    subscribe,\n    select,\n    reset: () => set(${q(Object.fromEntries(keys.map((k) => [k, null])))}),\n    get version() {\n      return version;\n    },\n  };\n}\n\nreturn { ${name} };`;
  return s;
}

function reportFormatter(g) {
  const noun = g.noun();
  const fn = g.unique(() => camel("render", pascal(g.pick(ADJ), noun, "report")));
  const cols = g.sample(FIELD_NAMES, g.int(3, 6));
  const widths = cols.map(() => g.int(6, 18));
  let s = `const COLUMNS = [\n${cols.map((c, i) => `  { key: ${q(c)}, title: ${q(c.toUpperCase())}, width: ${widths[i]}, align: ${q(g.pick(["left", "right"]))} },`).join("\n")}\n];\n\n`;
  s += `function pad(value, { width, align }) {\n  const text = String(value ?? "").slice(0, width);\n  return align === "right" ? text.padStart(width) : text.padEnd(width);\n}\n\n`;
  s += `${doc(g, "", [["rows", "Array<object>"]])}function ${fn}(rows, title = ${q(cap(g.pick(ADJ)) + " " + noun + " report")}) {\n  const header = COLUMNS.map((c) => pad(c.title, c)).join(" | ");\n  const rule = "-".repeat(header.length);\n  const body = rows.map((row) => COLUMNS.map((c) => pad(row[c.key], c)).join(" | "));\n  return [title, rule, header, rule, ...body, rule, §@{rows.length} ${noun}(s)§].join("\\n");\n}\n\n`;
  s += `function groupBy(rows, key) {\n  return rows.reduce((groups, row) => {\n    const k = typeof key === "function" ? key(row) : row[key];\n    (groups[k] ||= []).push(row);\n    return groups;\n  }, {});\n}\n\n`;
  s += `function totals(rows, field) {\n  return Object.entries(groupBy(rows, ${q(cols[0])}))\n    .map(([group, items]) => ({ group, count: items.length, sum: items.reduce((a, r) => a + (Number(r[field]) || 0), 0) }))\n    .sort((a, b) => b.sum - a.sum || a.group.localeCompare(b.group));\n}\n\n`;
  s += `function toCsvLine(values) {\n  return values.map((v) => {\n    const text = String(v ?? "");\n    return /[",\\n]/.test(text) ? §"@{text.replace(/"/g, '""')}"§ : text;\n  }).join(",");\n}\n\nreturn { ${fn}, groupBy, totals, toCsvLine };`;
  return s;
}

function repository(g) {
  const noun = g.noun();
  const name = g.unique(() => pascal(noun, g.pick(["repository", "catalog", "directory", "index"])));
  const idx = g.sample(FIELD_NAMES, g.int(2, 3));
  let s = `${doc(g, "")}class ${name} {\n  constructor(items = []) {\n    this.byId = new Map();\n${idx.map((k) => `    this.by${cap(k)} = new Map();`).join("\n")}\n    this.nextId = 1;\n    for (const item of items) this.add(item);\n  }\n\n`;
  s += `  add(item) {\n    const id = item.id ?? this.nextId++;\n    const record = { ...item, id };\n    this.byId.set(id, record);\n${idx.map((k) => `    this.index(this.by${cap(k)}, record.${k}, id);`).join("\n")}\n    return record;\n  }\n\n`;
  s += `  index(map, key, id) {\n    if (key === undefined) return;\n    const bucket = map.get(key) ?? new Set();\n    bucket.add(id);\n    map.set(key, bucket);\n  }\n\n`;
  s += `  get(id) {\n    return this.byId.get(id) ?? null;\n  }\n\n  remove(id) {\n    const record = this.byId.get(id);\n    if (!record) return false;\n    this.byId.delete(id);\n${idx.map((k) => `    this.by${cap(k)}.get(record.${k})?.delete(id);`).join("\n")}\n    return true;\n  }\n\n`;
  s += `  where(predicate) {\n    const out = [];\n    for (const record of this.byId.values()) if (predicate(record)) out.push(record);\n    return out;\n  }\n\n`;
  s += `  by(field, value) {\n    const map = this["by" + field[0].toUpperCase() + field.slice(1)];\n    if (!map) return this.where((r) => r[field] === value);\n    return [...(map.get(value) ?? [])].map((id) => this.byId.get(id));\n  }\n\n`;
  s += `  page(number, size = ${g.pick([10, 20, 25])}, sort = (a, b) => a.id - b.id) {\n    const all = [...this.byId.values()].sort(sort);\n    return { items: all.slice((number - 1) * size, number * size), pages: Math.ceil(all.length / size), total: all.length };\n  }\n\n`;
  s += `  *[Symbol.iterator]() {\n    yield* this.byId.values();\n  }\n\n  get size() {\n    return this.byId.size;\n  }\n}\n\nreturn { ${name} };`;
  return s;
}

function validatorSet(g) {
  const noun = g.noun();
  const fn = g.unique(() => camel("validate", pascal(g.pick(ADJ), noun)));
  const fields = makeFields(g, g.int(4, 8));
  let s = `const RULES = {\n`;
  for (const f of fields) {
    const rules = [];
    if (f.type === "code") rules.push(`(v) => /^${f.prefix}-\\d{${f.digits}}$/.test(v) || "expected ${f.prefix}-${"0".repeat(f.digits)}"`);
    else if (f.type === "text") rules.push(`(v) => typeof v === "string" || "must be text"`, `(v) => v.length <= ${f.max} || "at most ${f.max} characters"`);
    else if (f.type === "qty") rules.push(`(v) => Number.isInteger(v) || "whole numbers only"`, `(v) => v >= 0 && v <= ${f.max} || "between 0 and ${f.max}"`);
    else if (f.type === "money") rules.push(`(v) => Number.isFinite(v) || "must be a number"`, `(v) => v >= 0 || "cannot be negative"`);
    else if (f.type === "status") rules.push(`(v) => ${q(f.values)}.includes(v) || "unknown status"`);
    else if (f.type === "date") rules.push(`(v) => !Number.isNaN(Date.parse(v)) || "not a date"`);
    else rules.push(`(v) => v !== undefined || "required"`);
    s += `  ${f.name}: [\n${rules.map((r) => `    ${r},`).join("\n")}\n  ],\n`;
  }
  s += `};\n\n${doc(g, "", [["input", "object"]])}function ${fn}(input) {\n  const errors = {};\n  for (const [field, rules] of Object.entries(RULES)) {\n    for (const rule of rules) {\n      const outcome = rule(input?.[field]);\n      if (outcome !== true) {\n        (errors[field] ??= []).push(outcome);\n        break;\n      }\n    }\n  }\n  return { valid: !Object.keys(errors).length, errors };\n}\n\n`;
  s += `function summarize(result) {\n  return Object.entries(result.errors)\n    .map(([field, list]) => §@{field}: @{list.join("; ")}§)\n    .join("\\n");\n}\n\nreturn { ${fn}, summarize, RULES };`;
  return s;
}

function errorHierarchy(g) {
  const base = g.unique(() => pascal(g.noun(), "error"));
  const kids = Array.from({ length: g.int(2, 4) }, () => g.unique(() => pascal(g.pick(ADJ), g.noun(), "error")));
  let s = `class ${base} extends Error {\n  constructor(message, code = ${q(upper(g.noun(), g.pick(["failed", "invalid", "missing"])))}, details = {}) {\n    super(message);\n    this.name = new.target.name;\n    this.code = code;\n    this.details = details;\n  }\n\n  static is(error) {\n    return error instanceof ${base};\n  }\n\n  toJSON() {\n    return { name: this.name, code: this.code, message: this.message, details: this.details };\n  }\n}\n\n`;
  for (const k of kids) {
    s += `class ${k} extends ${base} {\n  constructor(${g.pick(["id", "key", "ref"])}, details) {\n    super(${q(cap(g.pick(VERBS)) + " failed for ")} + String(arguments[0]), ${q(upper(g.pick(NOUN_EXTRA), g.pick(["failed", "invalid", "missing"])))}, details);\n    this.retryable = ${g.pick(["true", "false"])};\n  }\n}\n\n`;
  }
  s += `function wrap(fn) {\n  return (...args) => {\n    try {\n      return fn(...args);\n    } catch (e) {\n      if (${base}.is(e)) throw e;\n      throw new ${base}(e?.message ?? String(e), "UNEXPECTED", { cause: e });\n    }\n  };\n}\n\nfunction classify(error) {\n${kids.map((k) => `  if (error instanceof ${k}) return ${q(k)};`).join("\n")}\n  return ${base}.is(error) ? "base" : "unknown";\n}\n\nreturn { ${base}, ${kids.join(", ")}, wrap, classify };`;
  return s;
}

function allocator(g) {
  const noun = g.noun();
  const fn = g.unique(() => camel(g.pick(["allocate", "reserve", "pack", "assign"]), cap(g.pick(ADJ)), noun, "s"));
  let s = `${doc(g, "", [["need", "number"], ["bins", "Array<object>"]])}function ${fn}(need, bins, { splitting = ${g.pick(["true", "false"])}, reserveRatio = ${g.num(0, 0.3, 2)} } = {}) {\n  const plan = [];\n  let remaining = need;\n  const ordered = [...bins]\n    .filter((bin) => bin.free > 0 && !bin.locked)\n    .sort((a, b) => (${g.pick(["a.distance - b.distance", "b.free - a.free", "a.age - b.age"])}) || a.id.localeCompare(b.id));\n  outer: for (const bin of ordered) {\n    const usable = Math.floor(bin.free * (1 - reserveRatio));\n    if (usable <= 0) continue;\n    if (!splitting && usable < remaining) continue;\n    const take = Math.min(usable, remaining);\n    plan.push({ bin: bin.id, take });\n    remaining -= take;\n    while (remaining > 0 && plan.length > ${g.int(4, 12)}) {\n      if (remaining < ${g.int(1, 5)}) break outer;\n      break;\n    }\n    if (remaining === 0) break;\n  }\n  return { plan, short: remaining, complete: remaining === 0 };\n}\n\n`;
  s += `function rebalance(bins, target = ${g.num(0.5, 0.9, 2)}) {\n  const moves = [];\n  const over = bins.filter((b) => b.used / b.capacity > target).sort((a, b) => b.used - a.used);\n  const under = bins.filter((b) => b.used / b.capacity < target / 2).sort((a, b) => a.used - b.used);\n  for (const from of over) {\n    for (const to of under) {\n      const excess = Math.ceil(from.used - from.capacity * target);\n      const room = Math.floor(to.capacity * target - to.used);\n      const amount = Math.min(excess, room);\n      if (amount > 0) {\n        moves.push({ from: from.id, to: to.id, amount });\n        from.used -= amount;\n        to.used += amount;\n      }\n    }\n  }\n  return moves;\n}\n\nreturn { ${fn}, rebalance };`;
  return s;
}

function pipelineModule(g) {
  const noun = g.noun();
  const fn = g.unique(() => camel("build", pascal(noun, "pipeline")));
  const steps = g.sample(["trim", "dedupe", "sort", "limit", "tag", "normalize", "enrich", "mask"], g.int(3, 5));
  const impl = {
    trim: `    trim: (items) => items.map((item) => (typeof item === "string" ? item.trim() : item)),`,
    dedupe: `    dedupe: (items, key = (x) => x) => [...new Map(items.map((item) => [key(item), item])).values()],`,
    sort: `    sort: (items, by = (a, b) => (a > b) - (a < b)) => [...items].sort(by),`,
    limit: `    limit: (items, n = ${g.int(5, 100)}) => items.slice(0, n),`,
    tag: `    tag: (items, label = ${q(g.pick(ADJ))}) => items.map((item) => ({ value: item, label })),`,
    normalize: `    normalize: (items) => items.map((item) => (typeof item === "string" ? item.normalize("NFKD").toLowerCase() : item)),`,
    enrich: `    enrich: (items, extra = {}) => items.map((item) => (typeof item === "object" ? { ...item, ...extra } : item)),`,
    mask: `    mask: (items, keep = ${g.int(2, 4)}) => items.map((item) => (typeof item === "string" ? item.slice(-keep).padStart(item.length, "*") : item)),`,
  };
  let s = `const STEPS = {\n${steps.map((k) => impl[k]).join("\n")}\n};\n\n`;
  s += `${doc(g, "", [["names", "string[]"]])}function ${fn}(...names) {\n  const chain = names.map((name) => {\n    const step = STEPS[name];\n    if (!step) throw new TypeError(§unknown ${noun} step "@{name}"§);\n    return step;\n  });\n  return (items, ...options) => chain.reduce((acc, step, i) => step(acc, options[i]), items);\n}\n\n`;
  s += `async function runMiddleware(stack, context) {\n  let index = -1;\n  async function dispatch(i) {\n    if (i <= index) throw new Error("next() called twice");\n    index = i;\n    const fn = stack[i];\n    if (!fn) return context;\n    return fn(context, () => dispatch(i + 1));\n  }\n  return dispatch(0);\n}\n\n`;
  s += `const compose = (...fns) => (input) => fns.reduceRight((acc, fn) => fn(acc), input);\n\nreturn { ${fn}, runMiddleware, compose, STEPS };`;
  return s;
}

function messageTable(g) {
  const noun = g.noun();
  const fn = g.unique(() => camel("say", pascal(noun)));
  const keys = g.sample(EVENTS.concat(VERBS), g.int(5, 9));
  let s = `const MESSAGES = {\n${keys.map((k) => `  ${k}: ${g.pick(["§", "§"])}${cap(k)} ${g.pick(ADJ)} ${noun} {id}${g.chance(0.5) ? " in {region}" : ""}${g.chance(0.4) ? " ({count} items)" : ""}§,`).join("\n")}\n};\n\n`;
  s += `${doc(g, "", [["key", "string"], ["vars", "object"]])}function ${fn}(key, vars = {}) {\n  const template = MESSAGES[key];\n  if (!template) return key;\n  return template.replace(/\\{(\\w+)\\}/g, (match, name) => (name in vars ? String(vars[name]) : match));\n}\n\n`;
  s += `function plural(count, one, many = one + "s") {\n  return §@{count} @{count === 1 ? one : many}§;\n}\n\nfunction listFormat(items, conjunction = "and") {\n  if (items.length < 2) return items.join("");\n  return §@{items.slice(0, -1).join(", ")} @{conjunction} @{items[items.length - 1]}§;\n}\n\nreturn { ${fn}, plural, listFormat, MESSAGES };`;
  return s;
}

function lruCache(g) {
  const noun = g.noun();
  const name = g.unique(() => pascal(noun, g.pick(["cache", "memo", "pool"])));
  let s = `${doc(g, "")}class ${name} {\n  constructor(limit = ${g.pick([32, 64, 100, 256])}, ttl = ${g.pick([1000, 5000, 60000])}) {\n    this.limit = limit;\n    this.ttl = ttl;\n    this.map = new Map();\n    this.hits = 0;\n    this.misses = 0;\n  }\n\n`;
  s += `  get(key, now = Date.now()) {\n    const entry = this.map.get(key);\n    if (!entry || entry.expires < now) {\n      if (entry) this.map.delete(key);\n      this.misses++;\n      return undefined;\n    }\n    this.map.delete(key);\n    this.map.set(key, entry);\n    this.hits++;\n    return entry.value;\n  }\n\n`;
  s += `  set(key, value, now = Date.now()) {\n    this.map.delete(key);\n    this.map.set(key, { value, expires: now + this.ttl });\n    while (this.map.size > this.limit) {\n      this.map.delete(this.map.keys().next().value);\n    }\n    return this;\n  }\n\n`;
  s += `  memo(fn, keyOf = (...args) => JSON.stringify(args)) {\n    return (...args) => {\n      const key = keyOf(...args);\n      let value = this.get(key);\n      if (value === undefined) {\n        value = fn(...args);\n        this.set(key, value);\n      }\n      return value;\n    };\n  }\n\n`;
  s += `  get ratio() {\n    const total = this.hits + this.misses;\n    return total ? this.hits / total : 0;\n  }\n}\n\nconst owners = new WeakMap();\n\nfunction own(target, owner) {\n  owners.set(target, owner);\n  return target;\n}\n\nfunction ownerOf(target) {\n  return owners.get(target) ?? null;\n}\n\nreturn { ${name}, own, ownerOf };`;
  return s;
}

function csvReader(g) {
  const noun = g.noun();
  const name = g.unique(() => camel("read", pascal(noun, g.pick(["csv", "sheet", "feed"]))));
  const delim = g.pick([",", ";", "\\t"]);
  const cols = g.sample(FIELD_NAMES, g.int(3, 6));
  let s = `const HEADER = ${q(cols)};\nconst DELIMITER = "${delim}";\n\n`;
  s += `${doc(g, "", [["text", "string"]])}function ${name}(text) {\n  const rows = [];\n  let row = [], field = "", quoted = false;\n  for (let i = 0; i < text.length; i++) {\n    const ch = text[i];\n    if (quoted) {\n      if (ch === '"') {\n        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;\n      } else field += ch;\n      continue;\n    }\n    switch (ch) {\n      case '"':\n        quoted = true;\n        break;\n      case DELIMITER:\n        row.push(field);\n        field = "";\n        break;\n      case "\\r":\n        break;\n      case "\\n":\n        row.push(field);\n        rows.push(row);\n        row = [];\n        field = "";\n        break;\n      default:\n        field += ch;\n    }\n  }\n  if (field || row.length) { row.push(field); rows.push(row); }\n  return rows;\n}\n\n`;
  s += `function toObjects(rows) {\n  const [head = HEADER, ...rest] = rows;\n  return rest.filter((r) => r.some(Boolean)).map((r) => Object.fromEntries(head.map((h, i) => [h, ${g.pick(["r[i]?.trim()", "r[i] ?? \"\"", "isNaN(r[i]) || r[i] === \"\" ? r[i] : Number(r[i])"])}])));\n}\n\n`;
  s += `function serialize(objects, columns = HEADER) {\n  const esc = (v) => (/["${delim}\\n]/.test(String(v ?? "")) ? §"@{String(v).replaceAll('"', '""')}"§ : String(v ?? ""));\n  return [columns.join(DELIMITER), ...objects.map((o) => columns.map((c) => esc(o[c])).join(DELIMITER))].join("\\n");\n}\n\nreturn { ${name}, toObjects, serialize, HEADER };`;
  return s;
}

function iterTools(g) {
  const noun = g.noun();
  const a = g.unique(() => camel("chunk", cap(noun), "s"));
  const b = g.unique(() => camel("window", cap(noun), "s"));
  let s = `${doc(g, "", [["items", "Iterable"], ["size", "number"]])}function* ${a}(items, size = ${g.int(2, 50)}) {\n  let buffer = [];\n  for (const item of items) {\n    buffer.push(item);\n    if (buffer.length === size) {\n      yield buffer;\n      buffer = [];\n    }\n  }\n  if (buffer.length) yield buffer;\n}\n\n`;
  s += `function* ${b}(items, width = ${g.int(2, 6)}) {\n  const ring = [];\n  for (const item of items) {\n    ring.push(item);\n    if (ring.length > width) ring.shift();\n    if (ring.length === width) yield [...ring];\n  }\n}\n\n`;
  s += `function zip(...lists) {\n  const length = Math.min(...lists.map((l) => l.length));\n  return Array.from({ length }, (_, i) => lists.map((l) => l[i]));\n}\n\nfunction partition(items, predicate) {\n  const yes = [], no = [];\n  for (const item of items) (predicate(item) ? yes : no).push(item);\n  return [yes, no];\n}\n\nfunction range(from, to, step = 1) {\n  const out = [];\n  for (let i = from; step > 0 ? i < to : i > to; i += step) out.push(i);\n  return out;\n}\n\nreturn { ${a}, ${b}, zip, partition, range };`;
  return s;
}

function labelPrinter(g) {
  const noun = g.noun();
  const fn = g.unique(() => camel("print", pascal(noun, "label")));
  const w = g.int(40, 80), h = g.int(20, 40);
  let s = `const LABEL = { width: ${w}, height: ${h}, margin: ${g.int(1, 4)}, dpi: ${g.pick([203, 300, 600])} };\n\n`;
  s += `function mm(value) {\n  return Math.round((value / 25.4) * LABEL.dpi);\n}\n\n`;
  s += `${doc(g, "", [["item", "object"]])}function ${fn}(item) {\n  const lines = [];\n  lines.push("^XA", §^PW@{mm(LABEL.width)}§, §^LL@{mm(LABEL.height)}§);\n  lines.push(§^FO@{mm(LABEL.margin)},@{mm(LABEL.margin)}^A0N,${g.int(24, 48)},${g.int(20, 40)}^FD@{item.name ?? "${noun}"}^FS§);\n  if (item.code) lines.push(§^FO@{mm(LABEL.margin)},@{mm(${g.int(8, 14)})}^BCN,${g.int(40, 80)},Y,N,N^FD@{item.code}^FS§);\n  ${g.chance(0.5) ? `if (item.weight) lines.push(§^FO@{mm(${g.int(20, 40)})},@{mm(LABEL.margin)}^A0N,24,20^FD@{item.weight.toFixed(1)} kg^FS§);` : `if (item.region) lines.push(§^FO@{mm(${g.int(20, 40)})},@{mm(LABEL.margin)}^A0N,24,20^FD@{String(item.region).toUpperCase()}^FS§);`}\n  lines.push("^XZ");\n  return lines.join("\\n");\n}\n\n`;
  s += `function estimate(items) {\n  return items.reduce((total, item) => total + ${fn}(item).length, 0);\n}\n\nreturn { ${fn}, estimate, mm };`;
  return s;
}

function geoRouting(g) {
  const noun = g.noun();
  const fn = g.unique(() => camel("plan", pascal(g.pick(ADJ), "route")));
  const R = g.pick([6371, 6371.0088, 6378.137]);
  let s = `const EARTH_RADIUS_KM = ${R};\nconst toRad = (deg) => (deg * Math.PI) / 180;\n\n`;
  s += `function distance(a, b) {\n  const dLat = toRad(b.lat - a.lat);\n  const dLon = toRad(b.lon - a.lon);\n  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;\n  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));\n}\n\n`;
  s += `${doc(g, "", [["depot", "object"], ["stops", "Array<object>"]])}function ${fn}(depot, stops, { speed = ${g.int(30, 70)}, serviceMinutes = ${g.int(3, 20)} } = {}) {\n  const remaining = [...stops];\n  const order = [];\n  let here = depot, km = 0;\n  while (remaining.length) {\n    let best = 0, bestKm = Infinity;\n    remaining.forEach((stop, i) => {\n      const d = distance(here, stop);\n      if (d < bestKm) { best = i; bestKm = d; }\n    });\n    const [stop] = remaining.splice(best, 1);\n    order.push(stop);\n    km += bestKm;\n    here = stop;\n  }\n  km += distance(here, depot);\n  const minutes = Math.round((km / speed) * 60 + order.length * serviceMinutes);\n  return { order, km: Math.round(km * 10) / 10, minutes };\n}\n\n`;
  s += `function bounds(points) {\n  return points.reduce((box, p) => ({\n    north: Math.max(box.north, p.lat),\n    south: Math.min(box.south, p.lat),\n    east: Math.max(box.east, p.lon),\n    west: Math.min(box.west, p.lon),\n  }), { north: -90, south: 90, east: -180, west: 180 });\n}\n\nreturn { distance, ${fn}, bounds };`;
  return s;
}

function eventLog(g) {
  const noun = g.noun();
  const name = g.unique(() => pascal(noun, g.pick(["journal", "audit", "log", "trail"])));
  const levels = g.sample(["debug", "info", "notice", "warn", "error", "fatal"], g.int(3, 5));
  let s = `const LEVELS = ${q(levels)};\n\n${doc(g, "")}class ${name} {\n  constructor(sink = console, level = ${q(levels[1] ?? levels[0])}) {\n    this.sink = sink;\n    this.threshold = LEVELS.indexOf(level);\n    this.entries = [];\n    this.max = ${g.pick([100, 500, 1000])};\n  }\n\n`;
  s += `  record(level, message, data) {\n    const rank = LEVELS.indexOf(level);\n    if (rank < this.threshold) return null;\n    const entry = { at: new Date().toISOString(), level, message, data };\n    this.entries.push(entry);\n    if (this.entries.length > this.max) this.entries.splice(0, this.entries.length - this.max);\n    const method = rank >= LEVELS.length - 2 ? "error" : rank === ${Math.min(2, levels.length - 1)} ? "warn" : "log";\n    this.sink[method]?.(§[@{level}] @{message}§, data ?? "");\n    return entry;\n  }\n\n`;
  s += levels.map((l) => `  ${l}(message, data) {\n    return this.record(${q(l)}, message, data);\n  }\n`).join("\n");
  s += `\n  since(time) {\n    return this.entries.filter((e) => e.at >= time);\n  }\n\n  summary() {\n    const counts = Object.fromEntries(LEVELS.map((l) => [l, 0]));\n    for (const e of this.entries) counts[e.level]++;\n    return counts;\n  }\n}\n\nreturn { ${name}, LEVELS };`;
  return s;
}

const SHAPES = [
  [entityClass, 4], [configTable, 2], [stateMachine, 2], [regexParser, 2], [asyncClient, 2], [calculator, 3], [scheduler, 1],
  [observableStore, 2], [reportFormatter, 2], [repository, 2], [validatorSet, 2], [errorHierarchy, 1], [allocator, 2], [pipelineModule, 2],
  [messageTable, 1], [lruCache, 1], [csvReader, 1], [iterTools, 1], [labelPrinter, 1], [geoRouting, 1], [eventLog, 1],
];
const WEIGHTED = SHAPES.flatMap(([fn, w]) => Array(w).fill(fn));

// ---- the program -----------------------------------------------------------------------------
const indent = (code) => code.split("\n").map((l) => (l ? "  " + l : l)).join("\n");
const finish = (code) => code.replaceAll("§", "`").replaceAll("@{", "${");

const HEAD = `/*!
 * Backoffice suite: warehouse, orders, billing and scheduling modules.
 * Generated for the parse-time benchmark. Do not edit.
 */
(function () {
  "use strict";

  const registry = Object.create(null);
  const cache = Object.create(null);

  // Register a module factory under a name. Factories run on first use only.
  function def(name, factory) {
    if (registry[name]) throw new Error("module defined twice: " + name);
    registry[name] = factory;
  }

  // Load a module by name, running its factory once.
  function use(name) {
    if (name in cache) return cache[name];
    const factory = registry[name];
    if (!factory) throw new Error("unknown module: " + name);
    return (cache[name] = factory(use));
  }

`;

export function generate({ bytes, seed = 1 }) {
  const g = makeGen(seed);
  const names = [];
  const parts = [HEAD];
  let length = HEAD.length;
  for (let i = 0; length < bytes; i++) {
    g.domain = DOMAIN_NAMES[i % DOMAIN_NAMES.length];
    const shape = g.pick(WEIGHTED);
    const base = kebab(g.domain, g.noun(), String(i + 1));
    names.push(base);
    const body = shape(g);
    const text = finish(`  // ---- ${base}\n${indent(doc(g, ""))}  def(${q(base)}, function (use) {\n${indent(indent(body))}\n  });\n\n`);
    parts.push(text);
    length += text.length;
  }
  const tail = `  function boot() {
    const first = use(${q(names[0])});
    const last = use(${q(names[names.length - 1])});
    return { first: Object.keys(first), last: Object.keys(last), count: ${names.length} };
  }

  const app = { boot, use, modules: () => Object.keys(registry) };
  if (typeof window !== "undefined") window.Backoffice = app;
  else globalThis.Backoffice = app;
  app.booted = boot();
})();
`;
  parts.push(tail);
  return { source: parts.join(""), modules: names.length };
}
