// The routed-app scenario generator and its reference: an app of N pages (routes) behind a shell,
// with global state read across pages, tabs and a modal whose content exists only while shown, and
// time-driven fields whose timers live only while their page or tab is mounted.
//
// This module is the single source of truth for the scenario (see README.md). It runs both in
// Node (the CLI generates specs with it) and in the browser (the serve panel uses the reference
// `update` and `render` and the external-event builders), so it imports nothing.
//
// `generate(options)` returns a plain-data app spec: the page descriptions, the initial state and
// the interaction script. The reference `update` and `render` are generic interpreters over the
// page descriptions; implementations must not be (README, "Each page is its own code").

export const scenario = "routed-app";

// The size ./rr check builds by default (and the locality check's smaller size, 16 → 256). The
// first five pages carry the capabilities the work actions need (FORCED); 16 adds variety.
export const quickCheckSize = 16;

// No parameters beyond --size and --seed.
export const params = {};

export function normalizeOptions(raw = {}) {
  const size = int(raw.size ?? 16, "size");
  const seed = int(raw.seed ?? 1, "seed");
  if (size < 1) throw new Error("--size must be at least 1");
  return { size, seed };
}

function int(v, name) {
  const n = Number(v);
  if (!Number.isInteger(n)) throw new Error(`--${name} must be an integer, got ${v}`);
  return n;
}

// ---------------------------------------------------------------------------------------------
// Seeded randomness (the same PRNG as unique-components)

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
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const r = {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    weighted: (pairs) => {
      const total = pairs.reduce((s, [, w]) => s + w, 0);
      let x = next() * total;
      for (const [v, w] of pairs) if ((x -= w) < 0) return v;
      return pairs[pairs.length - 1][0];
    },
    shuffle: (arr) => {
      const a2 = arr.slice();
      for (let i = a2.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [a2[i], a2[j]] = [a2[j], a2[i]];
      }
      return a2;
    },
    sample: (arr, n) => r.shuffle(arr).slice(0, n),
  };
  return r;
}

// ---------------------------------------------------------------------------------------------
// Global state: the same six fields in every app, read by the shell and by pages.

export const GLOBAL = [
  { name: "user", type: "text", initial: "Ada" },
  { name: "cart", type: "list", initial: [{ id: 1, text: "Desk lamp" }, { id: 2, text: "Notebook" }] },
  { name: "notices", type: "list", feed: true, initial: [{ id: 1, text: "Welcome back" }, { id: 2, text: "Invoice paid" }] },
  { name: "currency", type: "enum", options: ["EUR", "USD", "GBP", "JPY"], initial: "EUR" },
  { name: "balance", type: "int", min: 0, max: 9999, initial: 120 },
  { name: "online", type: "bool", initial: true },
];
const GLOBAL_BY_NAME = Object.fromEntries(GLOBAL.map((f) => [f.name, f]));
// What the shell reads; the other three are read only by pages.
export const SHELL_READS = ["user", "cart", "notices"];
// The global fields a serverSet may set (the lists change through notify and snapshot).
export const SERVER_FIELDS = ["user", "currency", "balance", "online"];
// The first PINNED pages have a link in the shell's nav bar; every page is in the "All pages" menu.
export const PINNED = 4;

// ---------------------------------------------------------------------------------------------
// Word pools. Field names are single lowercase English words that are valid identifiers in
// every target language (no JS strict-mode or Elm keywords) and never a global field's name.

const APPS = ["Northwind", "Bluebell", "Lighthouse", "Juniper", "Copperleaf", "Saltmarsh", "Redwood", "Kestrel"];
const ADJECTIVES = [
  "Daily", "Weekly", "Night", "Morning", "Team", "Office", "Garden", "Kitchen", "Studio",
  "Warehouse", "Lab", "Fleet", "Library", "Field", "Sales", "Support", "Billing", "Design",
  "Travel", "Event", "Harbor", "Clinic", "Campus", "Workshop", "Store", "Project", "Sprint",
  "Regional", "Personal", "Family", "Club", "Market", "Trail", "Bakery", "Gallery", "Depot",
];
const PAGE_TOPICS = ["settings", "orders", "reports", "inbox", "profile", "billing", "inventory", "calendar",
  "projects", "team", "invoices", "shipments", "analytics", "support", "catalog", "returns", "payroll",
  "contracts", "assets", "vendors", "overview", "planner", "archive", "requests"];
const CAPTIONS = ["Ref", "Board", "Unit", "Code", "Card", "Slot", "Tag", "Desk", "Batch", "File"];
const TAB_LABELS = ["Overview", "Details", "History", "Notes", "Activity", "Files", "People", "Billing", "Options", "Stats", "Schedule", "Tasks"];
const MODAL_WORDS = ["entry", "record", "request", "item", "booking", "draft", "change", "note"];

const NAMES = {
  int: ["visits", "orders", "tickets", "cups", "boxes", "laps", "pages", "calls", "seats", "score",
    "level", "volume", "speed", "retries", "guests", "points", "rounds", "floors", "miles", "crates",
    "pins", "votes", "bids", "stamps", "coins", "plates", "beds", "lanes", "hours", "degrees",
    "bottles", "sheets", "rides", "loaves", "bricks"],
  live: ["seconds", "elapsed", "uptime", "minutes", "ticks", "age", "countdown", "waited"],
  bool: ["open", "muted", "pinned", "locked", "urgent", "visible", "archived", "starred", "paused",
    "enabled", "expanded", "shared", "verified", "hidden", "flagged", "synced", "booked", "signed",
    "approved", "silent"],
  text: ["title", "nickname", "code", "note", "city", "tag", "email", "handle", "motto", "caption",
    "author", "street", "topic", "comment", "subject", "venue", "remark", "phrase", "greeting", "slogan"],
  draft: ["draft", "entry", "proposal", "sketch", "jot", "memo"],
  list: ["tasks", "notes", "errands", "links", "songs", "chores", "events", "books", "parcels",
    "ideas", "bugs", "stops", "dishes", "plants", "files", "contacts", "invites", "goals"],
  feed: ["news", "alerts", "messages", "updates", "inbox", "activity", "pings", "headlines"],
  enum: ["mode", "size", "priority", "theme", "region", "plan", "format", "tone", "status", "phase",
    "tier", "weather", "channel", "grade", "season", "speedup"],
};

const ITEM_VERBS = ["Call", "Email", "Book", "Order", "Review", "Fix", "Clean", "Plan", "Water", "Pay",
  "Print", "Update", "Pack", "Sort", "Check", "Send", "Draft", "Return", "Renew", "Test"];
const ITEM_OBJECTS = ["the supplier", "the plants", "the invoice", "the slides", "the report", "the car",
  "the tickets", "the budget", "the backups", "the windows", "the parcel", "the contract",
  "the agenda", "the printer", "the passport", "the roof", "the badges", "the schedule", "the venue", "the keys"];
const NEWS = ["Server restarted", "New member joined", "Backup finished", "Invoice paid",
  "Order shipped", "Build passed", "Comment added", "Meeting moved", "Report ready",
  "Price updated", "Ticket closed", "Stock low", "Payment failed", "Review requested"];
const QUICK = ["Coffee", "Call back", "Ping", "New lead", "Check-in", "Reminder", "Follow up", "Sample"];
const PRODUCTS = ["Desk lamp", "Notebook", "Stapler", "Headset", "Monitor arm", "Chair mat", "Pen set",
  "Whiteboard", "Webcam", "Cable kit", "Plant pot", "Mouse pad", "Label maker", "Bookend"];
const SENTENCES = [
  "Everything here updates as soon as you act.", "Changes are saved for the whole team.",
  "Numbers are refreshed every morning.", "Ask the front desk for the spare key.",
  "Deliveries arrive on Tuesdays and Fridays.", "The north entrance closes at six.",
  "Use the blue form for refunds.", "Quiet hours start after ten.",
  "Late returns are charged by the day.", "Meetings run for thirty minutes at most.",
  "Printing is free for members.", "Lunch is served from noon.",
];
const ENUM_SETS = [
  ["Basic", "Standard", "Premium", "Custom"], ["Pickup", "Courier", "Post", "Locker"],
  ["Email", "Phone", "Letter", "Chat"], ["Small", "Medium", "Large", "Huge"],
  ["PDF", "CSV", "Sheet"], ["Low", "Normal", "High", "Urgent"], ["North", "South", "East", "West"],
  ["Draft", "Review", "Final"], ["Sunny", "Cloudy", "Rainy", "Windy", "Snowy"],
  ["Calm", "Brisk", "Loud"], ["Bronze", "Silver", "Gold", "Platinum"], ["Spring", "Summer", "Autumn", "Winter"],
];
const TEXT_SAMPLES = ["maple", "Oslo", "me@home", "north 7", "Ada", "ok", "Blue one", "zip", "Harbor", "x9"];
const USERS = ["Grace", "Alan", "Edsger", "Barbara", "Ken", "Margaret", "Linus", "Radia", "Donald", "Frances"];

const cap = (s) => s[0].toUpperCase() + s.slice(1);
const numName = (n) => (n < 0 ? `Minus${-n}` : String(n));
const G = (name) => ["g", name];

// ---------------------------------------------------------------------------------------------
// The capabilities the first pages always have, so the work actions (harness/work/) find the same
// targets at every size. Each is added on top of the page's random composition.

export const FORCED = [
  "start",    // p1, the first route: an int with an "add k" button (never disabled) and a reset button,
              //   a text input, a display of the global balance; never reads or writes currency, no
              //   tabs, no modal, no time-driven field
  "cartFeed", // p2: an "add to cart" button (a global the shell reads) and a page feed list with dismiss
  "tabs",     // p3: tabs (2 to 4)
  "live",     // p4: a time-driven field in the page itself (its timer lives while p4 is shown)
  "modal",    // p5: a modal with a text input and a confirm button
];

// ---------------------------------------------------------------------------------------------
// Generation

export function generate(rawOptions) {
  const options = normalizeOptions(rawOptions);
  const { size, seed } = options;
  const pages = [];
  const sigs = new Set();
  const tokens = new Set();
  for (let i = 0; i < size; i++) {
    for (let attempt = 0; ; attempt++) {
      if (attempt > 200) throw new Error(`could not generate a unique page at position ${i + 1}`);
      const r = rng("page", seed, i, attempt);
      const p = buildPage(r, i, pages, FORCED[i]);
      const sig = signature(p);
      if (sigs.has(sig) || tokens.has(p.token)) continue;
      sigs.add(sig);
      tokens.add(p.token);
      pages.push(p);
      break;
    }
  }
  const app = rng("app", seed).pick(APPS);
  const spec = { scenario, options, app, global: GLOBAL, pinned: pages.slice(0, PINNED).map((p) => p.id), pages };
  spec.initialState = initialState(spec);
  spec.script = makeScript(spec);
  return spec;
}

export function initialState(spec) {
  const global = {};
  for (const f of GLOBAL) global[f.name] = cloneValue(f.initial);
  return { route: spec.pages[0].id, menu: false, global, page: initPage(spec.pages[0]) };
}

// The local state of a page when it mounts: its own fields, the first tab (and its panel's fields)
// if it has tabs, and no modal open. Page-local state never outlives the page (README, "Lifetime").
export function initPage(page) {
  return {
    fields: initialOf(page),
    tab: page.tabs ? page.tabs[0].id : null,
    panel: page.tabs ? initialOf(page.tabs[0]) : null,
    modal: null,
  };
}

export function initialOf(comp) {
  const s = {};
  for (const f of comp.fields) s[f.name] = cloneValue(f.initial);
  return s;
}

const cloneValue = (v) => (Array.isArray(v) ? v.map((x) => ({ ...x })) : v);

// A page: its own component (fields, messages, view) plus, optionally, tabs (each its own
// component) and a modal (its own component).
function buildPage(r, i, earlier, forced) {
  const id = `p${i + 1}`;
  const token = Array.from({ length: 4 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[r.int(0, 35)]).join("");
  const title = `${r.pick(ADJECTIVES)} ${r.pick(PAGE_TOPICS)} ${token}`;
  const used = new Set(GLOBAL.map((f) => f.name));
  const b = makeBuilder(r, used, "page");
  const start = forced === "start";

  // The page's own fields: forced ones first, then random ones up to 1-4 in all.
  const want = [];
  if (start) want.push(["int", { addButton: true, resetButton: true }], ["text", { required: true }]);
  if (forced === "cartFeed") want.push(["list", { feed: true }]);
  if (forced === "live") want.push(["live", {}]);
  const total = Math.max(want.length, r.weighted([[1, 15], [2, 35], [3, 30], [4, 20]]));
  while (want.length < total) {
    const t = r.weighted([["int", 28], ["bool", 20], ["text", 18], ["list", 14], ["enum", 14], ["live", 3], ["feed", 3]]);
    if ((t === "live" || t === "feed") && (start || want.some(([x, o]) => x === t || (t === "feed" && o.feed)))) continue;
    if (t === "list" && want.filter(([x]) => x === "list").length >= 2) continue;
    if (t === "feed") want.push(["list", { feed: true }]);
    else want.push([t, {}]);
  }
  for (const [type, opts] of want) GEN[type](b, opts);

  const plain = b.fields.filter((f) => f.type !== "list" && !f.draftFor && !f.every);
  if (plain.length >= 2 && r.chance(0.35)) combined(b, plain);
  const nDerived = r.weighted([[0, 45], [1, 40], [2, 15]]);
  for (let k = 0; k < nDerived; k++) derived(b);

  // Global reads (and sometimes writes): every page reads 1 to 3 global fields.
  const globals = GLOBAL.map((f) => f.name).filter((n) => !(start && n === "currency"));
  const forcedGlobals = start ? ["balance"] : forced === "cartFeed" ? ["cart"] : [];
  globalChunk(b, globals, r.int(1, 3), { forced: forcedGlobals, cartPush: forced === "cartFeed", noWrite: start ? ["currency"] : [] });

  // Links to earlier pages (backward only, so a page is the same at every N).
  if (earlier.length > 0 && r.chance(0.6)) {
    const to = r.sample(earlier, Math.min(earlier.length, r.int(1, 2)));
    const links = to.map((p) => ({ el: "link", to: p.id, text: r.pick([`Go to ${p.title}`, `Open ${p.title}`, `See ${p.title}`, `Back to ${p.title}`]) }));
    b.chunk(links.length > 1 && r.chance(0.5) ? [{ el: "group", tag: "footer", children: links }] : links, { required: true });
  }

  // The token caption, and sometimes a static sentence.
  b.chunk([{ el: "text", tag: "small", parts: [`${r.pick(CAPTIONS)} ${token}`] }], { required: true });
  if (r.chance(0.3)) b.chunk([{ el: "text", tag: "p", parts: [r.pick(SENTENCES)] }]);

  // Tabs and the modal: their place in the page's view, then their own components.
  let tabs = null, modal = null;
  if (forced === "tabs" || (!start && forced !== "live" && r.chance(0.3))) {
    tabs = [];
    const n = r.int(2, 4);
    const labels = r.sample(TAB_LABELS, n);
    for (let k = 0; k < n; k++) tabs.push(buildTab(r, used, b, `t${k + 1}`, labels[k], globals));
    b.chunk([{ el: "tabs" }], { required: true });
  }
  if (forced === "modal" || (!start && r.chance(0.35))) {
    modal = buildModal(r, used, b, globals, forced === "modal");
  }

  const req = b.chunks.filter((c) => c.required);
  const rest = r.shuffle(b.chunks.filter((c) => !c.required));
  let items = r.shuffle([...req, ...rest]).flatMap((c) => c.items);
  // The forced capabilities first (so they sit at the top of the page), then the rest.
  if (forced) items = [...items.filter((it) => it.forced), ...items.filter((it) => !it.forced)];
  const nWhen = r.weighted([[0, 35], [1, 45], [2, 20]]);
  for (let k = 0; k < nWhen; k++) items = addWhen(b, items, globals);
  if (r.chance(0.5)) items = nest(r, items, 0);

  return {
    id, token, title,
    fields: b.fields.map(cleanField), messages: b.messages, view: items.map((it) => it.node),
    ...(tabs ? { tabs } : {}), ...(modal ? { modal } : {}),
  };
}

function buildTab(r, used, page, id, label, globals) {
  const b = makeBuilder(r, used, "tab");
  const total = r.weighted([[1, 40], [2, 40], [3, 20]]);
  for (let k = 0; k < total; k++) {
    const t = r.weighted([["int", 28], ["bool", 18], ["text", 18], ["list", 18], ["enum", 14], ["live", 6]]);
    if (t === "live" && b.fields.some((f) => f.every)) { k--; continue; }
    GEN[t](b, {});
  }
  if (r.chance(0.4)) derived(b);
  // Sometimes a display of a page field (a prop) or of a global field.
  const pageFields = page.fields.filter((f) => !f.draftFor);
  if (pageFields.length && r.chance(0.4)) {
    const f = r.pick(pageFields);
    const v = valueOf(r, f, (n) => ["p", n]);
    b.chunk([{ el: "text", tag: "p", parts: [`${cap(f.name)} on this page: `, asText(v, r)] }]);
  }
  if (r.chance(0.3)) globalChunk(b, globals, 1, {});
  let items = r.shuffle(b.chunks).flatMap((c) => c.items);
  if (r.chance(0.4)) items = addWhen(b, items, globals);
  if (r.chance(0.4)) items = nest(r, items, 1);
  return { id, label, fields: b.fields.map(cleanField), messages: b.messages, view: items.map((it) => it.node) };
}

// A modal: a small form (a text field, sometimes a bool or an enum), a confirm button whose ops
// write the page's fields or global state from the form, and a close button. It is opened by a
// button in the page (an "open" message) and its state starts fresh on every open.
function buildModal(r, used, page, globals, forced) {
  const word = r.pick(MODAL_WORDS);
  const b = makeBuilder(r, used, "modal");
  const title = r.pick([`New ${word}`, `Edit ${word}`, `Add a ${word}`, `Confirm ${word}`]);
  const open = page.message({ name: page.msgName(["open", "show", "start"], word), kind: "open" });
  page.chunk([{ el: "open", msg: open, text: r.pick([`New ${word}`, `Edit ${word}…`, `Add ${word}`, `Open ${word}`]) }], { required: true, forced });

  // The form: a text field (always when forced), maybe one more field.
  const text = forced || r.chance(0.8) ? GEN.text(b, { required: true }) : null;
  if (!text || r.chance(0.4)) GEN[r.pick(["bool", "enum", "int"])](b, {});
  if (r.chance(0.3)) globalChunk(b, globals, 1, { readOnly: true });

  // The confirm ops: from the form into the page (push into a page list, copy into a page field of
  // the same type) or into global state.
  const ops = [];
  const pageList = page.fields.find((f) => f.type === "list" && !f.feed);
  const pageText = page.fields.find((f) => f.type === "text" && !f.draftFor);
  const pageBool = page.fields.find((f) => f.type === "bool");
  const formBool = b.fields.find((f) => f.type === "bool");
  if (text && pageList && r.chance(0.6)) ops.push(["push", ["p", pageList.name], ["f", text.name]]);
  else if (text && pageText && r.chance(0.7)) ops.push(["copy", ["p", pageText.name], ["f", text.name]]);
  if (formBool && pageBool && r.chance(0.6)) ops.push(["copy", ["p", pageBool.name], ["f", formBool.name]]);
  if (ops.length === 0 || r.chance(0.3)) {
    const k = r.pick([5, 10, 20]);
    ops.push(r.pick([["add", G("balance"), -k], ["pushText", G("cart"), r.pick(PRODUCTS)], ["add", G("balance"), k]]));
  }
  const confirm = b.message({ name: b.msgName(["save", "confirm", "apply", "submit"], word), kind: "confirm", ops });
  const close = b.message({ name: b.msgName(["close", "cancel", "dismiss"], word), kind: "close" });
  const confirmNode = { el: "button", msg: confirm, text: [r.pick(["Save", "Confirm", "Apply", "Submit"])] };
  if (text && r.chance(0.4)) confirmNode.disabled = ["==", ["len", ["f", text.name]], ["k", 0]];
  const spend = ops.find((op) => op[0] === "add" && op[1][0] === "g" && op[2] < 0);
  if (spend && !confirmNode.disabled) confirmNode.disabled = ["<", G("balance"), ["k", -spend[2]]];
  const closeNode = { el: "button", msg: close, text: [r.pick(["Cancel", "Close", "Not now"])] };
  let items = b.chunks.flatMap((c) => c.items);
  if (r.chance(0.3)) items = addWhen(b, items, []);
  const view = [...items.map((it) => it.node), { el: "group", tag: "footer", children: r.chance(0.5) ? [confirmNode, closeNode] : [closeNode, confirmNode] }];
  return { title, fields: b.fields.map(cleanField), messages: b.messages, view };
}

function cleanField(f) {
  const { draftFor, ...rest } = f;
  return rest;
}

// The builder: names (unique within the page, across its tabs and modal), fields, messages and
// chunks of view items. An item is { node, writes (ref keys its controls write), required (never
// inside a conditional section), forced (a FORCED capability, kept first) }.
function makeBuilder(r, used, scope) {
  const b = {
    r, scope, fields: [], messages: [], chunks: [],
    name(pool) {
      const free = pool.filter((n) => !used.has(n));
      const n = free.length ? r.pick(free) : `${r.pick(pool)}${used.size}`;
      used.add(n);
      return n;
    },
    msgName(verbs, ...parts) {
      const base = r.pick(verbs) + parts.map((p) => cap(String(p))).join("");
      let n = base;
      for (let k = 2; used.has(n); k++) n = `${base}${k}`;
      used.add(n);
      return n;
    },
    field(f) { b.fields.push(f); return f; },
    message(m) { b.messages.push(m); return m.name; },
    chunk(nodes, { required = false, forced = false } = {}) {
      b.chunks.push({ required, items: nodes.map((node) => ({ node, writes: writesOf(b, node), required, forced })) });
    },
  };
  return b;
}

export const refKey = (ref) => `${ref[0]}:${ref[1]}`;

// The ref keys a node's controls write (recursively).
function writesOf(b, node) {
  const out = new Set();
  const visit = (n) => {
    for (const name of [n.msg, n.check, n.remove].filter(Boolean)) {
      const m = b.messages.find((x) => x.name === name);
      if (m) for (const ref of messageWrites(m)) out.add(refKey(ref));
    }
    for (const c of n.children || []) visit(c);
  };
  visit(node);
  return out;
}

// The refs a message writes.
export function messageWrites(m) {
  if (m.kind === "click" || m.kind === "confirm") {
    const out = [];
    for (const op of m.ops) {
      out.push(op[1]);
      if (op[0] === "push") out.push(op[2]);
    }
    return out;
  }
  if (m.kind === "open" || m.kind === "close") return [];
  return [m.field];
}

// The refs an expression reads.
export function exprReads(e, out = new Set()) {
  if (!Array.isArray(e)) return out;
  if (e[0] === "f" || e[0] === "p" || e[0] === "g") { out.add(refKey(e)); return out; }
  if (e[0] === "k") return out;
  for (const x of e.slice(1)) exprReads(x, out);
  return out;
}

// Per-type field generators. Each adds its field, its messages and its view chunk, and returns
// the field.
const GEN = {
  int(b, opts) {
    const r = b.r;
    const name = b.name(NAMES.int);
    let min = r.pick([0, 0, 0, -5, -10, 1]);
    let max = min + r.int(5, 60);
    if (!opts.addButton && r.chance(0.3)) {
      opts = { ...opts, numberInput: true };
      min = Math.min(min, 0);
      max = Math.max(max, 20);
    }
    const initial = r.int(min, min + Math.floor((max - min) / 2));
    const f = b.field({ name, type: "int", min, max, initial });
    const F = ["f", name];
    const nodes = [];
    if (opts.numberInput) {
      const msg = b.message({ name: b.msgName(["enter", "set", "type", "input"], name), kind: "input", field: F });
      nodes.push({ el: "input", msg, ...(r.chance(0.6) ? { label: cap(name) } : {}) });
    }
    const nButtons = opts.addButton ? r.int(1, 3) : opts.numberInput ? r.int(0, 1) : r.int(1, 3);
    let kinds = r.shuffle(["inc", "dec", "set", "reset"]).slice(0, nButtons);
    if (opts.addButton) kinds = ["inc", ...kinds.filter((k) => k !== "inc")].slice(0, Math.max(1, nButtons));
    if (opts.resetButton && !kinds.includes("reset")) kinds.push("reset");
    for (const kind of kinds) {
      const k = r.pick([1, 1, 2, 3, 5, 10]);
      if (kind === "inc") {
        const msg = b.message({ name: b.msgName(["bump", "raise", "add", "grow", "boost", "lift"], name), kind: "click", ops: [["add", F, k]] });
        const node = { el: "button", msg, text: [r.pick([`+${k}`, `Add ${k}`, `${k} more`, `Up ${k}`])] };
        if (!opts.addButton && r.chance(0.4)) node.disabled = [">=", F, ["k", max]];
        nodes.push(node);
      } else if (kind === "dec") {
        const msg = b.message({ name: b.msgName(["drop", "lower", "cut", "shrink", "ease"], name), kind: "click", ops: [["add", F, -k]] });
        const node = { el: "button", msg, text: [r.pick([`-${k}`, `Remove ${k}`, `${k} less`, `Down ${k}`])] };
        if (r.chance(0.4)) node.disabled = ["<=", F, ["k", min]];
        nodes.push(node);
      } else if (kind === "set") {
        const c = r.int(min, max);
        const msg = b.message({ name: b.msgName(["set"], name, "to", numName(c)), kind: "click", ops: [["set", F, c]] });
        nodes.push({ el: "button", msg, text: [r.pick([`Set to ${c}`, `Make it ${c}`, `= ${c}`])] });
      } else {
        const msg = b.message({ name: b.msgName(["reset", "restore", "zero"], name), kind: "click", ops: [["reset", F]] });
        nodes.push({ el: "button", msg, text: [r.pick(["Reset", "Restore", "Start over", "Undo all"])] });
      }
    }
    if (!opts.numberInput || r.chance(0.5)) nodes.splice(r.int(0, nodes.length), 0, intText(r, name, F));
    const required = !!(opts.addButton || opts.numberInput);
    b.chunk(nodes, { required, forced: !!opts.addButton });
    return f;
  },

  // A time-driven int: while its component is mounted, one timer (setInterval, `every` ms)
  // advances it by `by`, up to `max`.
  live(b) {
    const r = b.r;
    const name = b.name(NAMES.live);
    const by = r.pick([1, 1, 2, 5]);
    const max = r.int(60, 600);
    const every = r.pick([1000, 1000, 2000, 5000]);
    const f = b.field({ name, type: "int", min: 0, max, initial: r.int(0, 30), every, by });
    const F = ["f", name];
    const nodes = [intText(r, name, F)];
    if (r.chance(0.5)) {
      const msg = b.message({ name: b.msgName(["reset", "restart", "zero"], name), kind: "click", ops: [["reset", F]] });
      nodes.push({ el: "button", msg, text: [r.pick(["Reset", "Clear", "Zero"])] });
    }
    if (r.chance(0.4)) nodes.push({ el: "text", tag: "small", parts: [["if", [">=", F, ["k", r.int(35, 59)]], ["k", r.pick(["Over a minute", "Running long", "Late"])], ["k", r.pick(["Just started", "On time", "Fresh"])]]] });
    b.chunk(nodes, { required: true, forced: b.scope === "page" });
    return f;
  },

  bool(b) {
    const r = b.r;
    const name = b.name(NAMES.bool);
    const f = b.field({ name, type: "bool", initial: r.chance(0.4) });
    b.chunk(boolControl(b, name, r.weighted([["check", 45], ["toggle", 35], ["pair", 20]]), r.chance(0.5)));
    return f;
  },

  text(b, opts) {
    const r = b.r;
    const name = b.name(NAMES.text);
    const f = b.field({ name, type: "text", initial: b.scope !== "modal" && r.chance(0.25) ? r.pick(TEXT_SAMPLES) : "" });
    const F = ["f", name];
    const msg = b.message({ name: b.msgName(["edit", "type", "write", "change", "enter"], name), kind: "input", field: F });
    const node = { el: "input", msg };
    if (r.chance(0.5)) node.label = cap(name);
    if (r.chance(0.6)) node.placeholder = r.pick([`Your ${name}`, `Enter a ${name}`, `${cap(name)} here`, "Type here", "…"]);
    if (r.chance(0.4)) node.invalid = validation(r, name, F);
    const nodes = [node];
    if (r.chance(0.5)) {
      nodes.push(r.pick([
        { el: "text", tag: "p", parts: [r.pick(["Hello, ", "Preview: ", "You typed ", `${cap(name)}: `]), F] },
        { el: "text", tag: "small", parts: [["len", F], r.pick([" characters", " chars", " letters typed"])] },
        { el: "text", tag: "output", parts: [F] },
      ]));
    }
    b.chunk(nodes, { required: !!opts.required, forced: !!opts.required && b.scope === "page" });
    return f;
  },

  list(b, opts) {
    const r = b.r;
    const feed = !!opts.feed;
    const name = b.name(feed ? NAMES.feed : NAMES.list);
    const checkable = !feed && r.chance(0.5);
    const n = r.int(feed ? 1 : 0, 4);
    const items = [];
    const usedText = new Set();
    for (let k = 1; k <= n; k++) {
      let text;
      do text = feed ? r.pick(NEWS) : `${r.pick(ITEM_VERBS)} ${r.pick(ITEM_OBJECTS)}`;
      while (!feed && usedText.has(text));
      usedText.add(text);
      items.push(checkable ? { id: k, text, done: r.chance(0.3) } : { id: k, text });
    }
    const f = b.field({ name, type: "list", checkable, ...(feed ? { feed: true } : {}), initial: items });
    const L = ["f", name];
    const nodes = [];
    const listNode = { el: "list", field: L, tag: r.pick(["ul", "ul", "ol"]) };
    if (checkable && r.chance(0.85)) listNode.check = b.message({ name: b.msgName(["toggle", "check", "mark"], "in", name), kind: "item", field: L, op: "toggle" });
    if (feed || r.chance(0.75)) {
      listNode.remove = b.message({ name: b.msgName(feed ? ["dismiss", "hide", "clear"] : ["remove", "delete", "discard"], "from", name), kind: "item", field: L, op: "remove" });
      listNode.removeText = feed ? r.pick(["Dismiss", "Hide", "OK", "Got it"]) : r.pick(["Remove", "Delete", "×", "Drop"]);
    }
    let draftNodes = [];
    if (!feed) {
      if (r.chance(0.6)) {
        const draft = b.name(NAMES.draft);
        b.field({ name: draft, type: "text", initial: "", draftFor: name });
        const D = ["f", draft];
        const edit = b.message({ name: b.msgName(["edit", "type", "write"], draft), kind: "input", field: D });
        const push = b.message({ name: b.msgName(["addTo", "appendTo", "saveTo", "pushTo"], name), kind: "click", ops: [["push", L, D]] });
        const input = { el: "input", msg: edit, placeholder: r.pick(["What needs doing?", "New item", "Add an item", "Next step", "Write it down"]) };
        const button = { el: "button", msg: push, text: [r.pick(["Add", "Save", "Append", "Keep"])] };
        if (r.chance(0.3)) button.disabled = ["==", ["len", D], ["k", 0]];
        draftNodes = [input, button];
      } else {
        const text = r.pick(QUICK);
        const push = b.message({ name: b.msgName(["quickAdd", "stamp", "log"], name), kind: "click", ops: [["pushText", L, text]] });
        draftNodes = [{ el: "button", msg: push, text: [`+ ${text}`] }];
      }
      if (r.chance(0.35)) {
        const kind = r.pick(checkable ? ["pop", "shift", "clear", "clearDone"] : ["pop", "shift", "clear"]);
        const verbs = { pop: ["dropLast"], shift: ["dropFirst"], clear: ["clear", "empty"], clearDone: ["clearDone", "purgeDone"] }[kind];
        const msg = b.message({ name: b.msgName(verbs, name), kind: "click", ops: [[kind, L]] });
        const node = { el: "button", msg, text: [{ pop: "Drop last", shift: "Drop first", clear: "Clear all", clearDone: "Clear done" }[kind]] };
        if (kind !== "clearDone" && r.chance(0.5)) node.disabled = ["==", ["count", L], ["k", 0]];
        draftNodes.push(node);
      }
    }
    nodes.push(...(r.chance(0.5) ? [...draftNodes, listNode] : [listNode, ...draftNodes]));
    if (r.chance(0.6)) {
      nodes.push(r.pick(checkable
        ? [{ el: "text", tag: "p", parts: [["left", L], " left"] }, { el: "text", tag: "p", parts: [["done", L], " of ", ["count", L], " done"] }]
        : [{ el: "text", tag: "p", parts: [["count", L], ` ${name}`] }, { el: "text", tag: "small", parts: ["Total: ", ["count", L]] }]));
    }
    b.chunk(nodes, { required: feed, forced: feed && b.scope === "page" });
    if (r.chance(0.3)) {
      b.chunk([{ el: "when", tag: "div", cond: ["==", ["count", L], ["k", 0]], children: [{ el: "text", tag: "p", parts: [r.pick(["Nothing here yet", "All clear", "No news", "Empty for now", "Quiet for now"])] }] }]);
    }
    return f;
  },

  enum(b) {
    const r = b.r;
    const name = b.name(NAMES.enum);
    const set = r.pick(ENUM_SETS);
    const options = set.slice(0, r.int(3, set.length));
    const f = b.field({ name, type: "enum", options, initial: r.pick(options) });
    const F = ["f", name];
    const nodes = [];
    const select = r.chance(0.5);
    if (select) {
      const msg = b.message({ name: b.msgName(["pick", "choose", "select"], name), kind: "select", field: F });
      nodes.push({ el: "select", msg, ...(r.chance(0.6) ? { label: cap(name) } : {}) });
    } else {
      const msg = b.message({ name: b.msgName(["cycle", "next", "rotate"], name), kind: "click", ops: [["cycle", F]] });
      nodes.push({ el: "button", msg, text: r.chance(0.5) ? [r.pick(["Next", "Cycle", "Rotate", "Change"])] : [`${cap(name)}: `, F] });
    }
    if (!select || r.chance(0.6)) {
      nodes.push(r.pick([
        { el: "text", tag: "p", parts: [`${cap(name)}: `, F] },
        { el: "text", tag: "strong", parts: [F] },
        { el: "text", tag: "p", parts: [["if", ["==", F, ["k", options[0]]], ["k", "default"], ["k", "custom"]], ` ${name}`] },
      ]));
    }
    b.chunk(nodes);
    return f;
  },
};

function intText(r, name, F) {
  return r.pick([
    { el: "text", tag: "output", parts: [F] },
    { el: "text", tag: "p", parts: [`${cap(name)}: `, F] },
    { el: "text", tag: "span", parts: [F, ` ${name}`] },
    { el: "text", tag: "strong", parts: [`${cap(name)} = `, F] },
  ]);
}

function boolControl(b, name, kind, display) {
  const r = b.r;
  const F = ["f", name];
  const nodes = [];
  if (kind === "check") {
    const msg = b.message({ name: b.msgName(["check", "tick", "flag"], name), kind: "check", field: F });
    nodes.push({ el: "check", msg, label: cap(name) });
  } else if (kind === "toggle") {
    const msg = b.message({ name: b.msgName(["toggle", "flip", "switch"], name), kind: "click", ops: [["toggle", F]] });
    const pair = r.pick([["Hide", "Show"], ["Unpin", "Pin"], ["Off", "On"], ["Pause", "Resume"], ["Unlock", "Lock"], ["Stop", "Start"]]);
    nodes.push({ el: "button", msg, text: r.chance(0.5) ? [r.pick(["Toggle", "Switch", "Flip"]) + ` ${name}`] : [["if", F, ["k", pair[0]], ["k", pair[1]]]] });
  } else {
    const [on, off] = r.pick([["mark", "unmark"], ["enable", "disable"], ["show", "hide"], ["start", "stop"], ["set", "unset"]]);
    const mOn = b.message({ name: b.msgName([on], name), kind: "click", ops: [["set", F, true]] });
    const mOff = b.message({ name: b.msgName([off], name), kind: "click", ops: [["set", F, false]] });
    nodes.push({ el: "button", msg: mOn, text: [cap(on)], ...(r.chance(0.5) ? { disabled: F } : {}) });
    nodes.push({ el: "button", msg: mOff, text: [cap(off)], ...(r.chance(0.5) ? { disabled: ["not", F] } : {}) });
  }
  if (display) {
    const words = r.pick([["yes", "no"], ["on", "off"], ["Active", "Inactive"], ["set", "not set"], ["done", "pending"]]);
    nodes.push({ el: "text", tag: r.pick(["p", "span", "em"]), parts: [`${cap(name)}: `, ["if", F, ["k", words[0]], ["k", words[1]]]] });
  }
  return nodes;
}

function validation(r, name, T) {
  const n = r.int(2, 5);
  return r.pick([
    { when: ["==", ["len", T], ["k", 0]], message: r.pick(["This field is required", "Please fill this in", `A ${name} is required`]) },
    { when: ["<", ["len", T], ["k", n]], message: r.pick([`Use at least ${n} characters`, `Too short: ${n} characters minimum`]) },
    { when: [">", ["len", T], ["k", n + 4]], message: r.pick([`At most ${n + 4} characters`, `Too long: keep it under ${n + 5}`]) },
    { when: ["not", ["has", T, "@"]], message: "Must contain an @" },
    { when: ["has", T, " "], message: r.pick(["No spaces allowed", "Spaces are not allowed"]) },
  ]);
}

function combined(b, plain) {
  const r = b.r;
  const fs = r.sample(plain, Math.min(plain.length, r.int(2, 3)));
  if (r.chance(0.4)) {
    const msg = b.message({ name: b.msgName(["resetAll", "clearForm", "startOver", "restoreAll"]), kind: "click", ops: fs.map((f) => ["reset", ["f", f.name]]) });
    b.chunk([{ el: "button", msg, text: [r.pick(["Reset all", "Clear form", "Start over", "Restore"])] }]);
    return;
  }
  const opFor = (f) => {
    const F = ["f", f.name];
    if (f.type === "int") return ["add", F, r.pick([1, 2, 5, -1, -3])];
    if (f.type === "bool") return r.chance(0.5) ? ["toggle", F] : ["set", F, r.chance(0.5)];
    if (f.type === "enum") return r.chance(0.6) ? ["cycle", F] : ["set", F, r.pick(f.options)];
    return r.chance(0.5) ? ["set", F, ""] : ["reset", F];
  };
  const ops = fs.slice(0, 2).map(opFor);
  const msg = b.message({ name: b.msgName(["apply", "commit", "prime", "kick", "sync"], fs[0].name, "and", fs[1].name), kind: "click", ops });
  b.chunk([{ el: "button", msg, text: [r.pick(["Go", "Apply", "Do both", "Commit", "Run"])] }]);
}

// An expression for a field, as an int, a bool or a text. `ref` builds the field's reference.
function valueOf(r, f, ref = (n) => ["f", n]) {
  const F = ref(f.name);
  switch (f.type) {
    case "int": return { type: "int", expr: F };
    case "bool": return { type: "bool", expr: F };
    case "enum": return { type: "text", expr: F };
    case "text": return r.chance(0.6) ? { type: "int", expr: ["len", F] } : { type: "text", expr: F };
    case "list": return { type: "int", expr: f.checkable && r.chance(0.5) ? [r.pick(["left", "done"]), F] : ["count", F] };
  }
}

const asText = (v, r) => (v.type === "bool" ? ["if", v.expr, ["k", r.pick(["yes", "on", "ready"])], ["k", r.pick(["no", "off", "waiting"])]] : v.expr);

function derived(b) {
  const r = b.r;
  if (b.fields.length === 0) return;
  const vals = b.fields.map((f) => valueOf(r, f));
  const ints = vals.filter((v) => v.type === "int");
  const bools = vals.filter((v) => v.type === "bool");
  const choices = [];
  if (ints.length >= 2) {
    const [x, y] = r.sample(ints, 2);
    choices.push(() => ({ el: "text", tag: "p", parts: [r.pick(["Total: ", "Sum: ", "Together: "]), ["+", x.expr, y.expr]] }));
    choices.push(() => ({ el: "text", tag: "p", parts: [r.pick(["Gap: ", "Difference: "]), ["-", x.expr, y.expr]] }));
    choices.push(() => ({ el: "text", tag: "em", parts: [["if", [r.pick([">", ">=", "<"]), x.expr, y.expr], ["k", r.pick(["ahead", "more", "over"])], ["k", r.pick(["behind", "fewer", "under"])]]] }));
  }
  if (ints.length >= 1) {
    const x = r.pick(ints);
    const c = r.int(1, 12);
    choices.push(() => ({ el: "text", tag: "small", parts: [["if", [r.pick([">", ">=", "<", "=="]), x.expr, ["k", c]], ["k", r.pick(["High", "Plenty", "Many"])], ["k", r.pick(["Low", "Few", "Some"])]]] }));
    choices.push(() => ({ el: "text", tag: "p", parts: [r.pick(["Next: ", "Plus one: "]), ["+", x.expr, ["k", 1]]] }));
  }
  if (bools.length >= 2) {
    const [x, y] = r.sample(bools, 2);
    choices.push(() => ({ el: "text", tag: "p", parts: [["if", [r.pick(["and", "or"]), x.expr, y.expr], ["k", "All set"], ["k", "Not yet"]]] }));
  }
  if (bools.length >= 1 && ints.length >= 1) {
    const x = r.pick(bools), y = r.pick(ints);
    choices.push(() => ({ el: "text", tag: "p", parts: [["if", ["and", x.expr, [">", y.expr, ["k", 0]]], ["k", "Go"], ["k", "Wait"]]] }));
  }
  const enums = b.fields.filter((f) => f.type === "enum");
  if (enums.length) {
    const e = r.pick(enums);
    choices.push(() => ({ el: "text", tag: "span", parts: [["if", ["!=", ["f", e.name], ["k", r.pick(e.options)]], ["k", "changed"], ["k", "as planned"]]] }));
  }
  if (choices.length === 0) return;
  b.chunk([r.pick(choices)()]);
}

// Reads of global state, as displays, and (unless `readOnly`) sometimes a control that writes it.
// `pool`: the global fields this component may touch; `forced`: fields always read; `cartPush`:
// always an "add to cart" button; `noWrite`: fields never written here.
function globalChunk(b, pool, n, { forced = [], cartPush = false, readOnly = false, noWrite = [] } = {}) {
  const r = b.r;
  const names = [...forced, ...r.shuffle(pool.filter((x) => !forced.includes(x)))].slice(0, Math.max(n, forced.length));
  const intField = b.fields.find((f) => f.type === "int" && !f.every);
  for (const name of names) {
    const g = G(name);
    const nodes = [];
    const write = !readOnly && !noWrite.includes(name) && (r.chance(0.45) || (cartPush && name === "cart"));
    let isForced = forced.includes(name);
    switch (name) {
      case "user":
        nodes.push(r.pick([
          { el: "text", tag: "p", parts: [r.pick(["Hello, ", "Welcome, ", "Logged in as "]), g] },
          { el: "text", tag: "em", parts: [g, r.pick(["'s workspace", "'s view", " is here"])] },
          { el: "text", tag: "small", parts: [["len", g], " letters in your name"] },
        ]));
        if (write) {
          if (r.chance(0.6)) {
            const msg = b.message({ name: b.msgName(["rename", "editName", "changeName"]), kind: "input", field: g });
            const node = { el: "input", msg, label: r.pick(["Display name", "Your name", "Name"]) };
            if (r.chance(0.5)) node.invalid = { when: ["==", ["len", g], ["k", 0]], message: r.pick(["A name is required", "Please enter a name"]) };
            nodes.push(node);
          } else {
            const who = r.pick(["Guest", "Visitor", "Anonymous"]);
            const msg = b.message({ name: b.msgName(["signInAs", "browseAs"], who), kind: "click", ops: [["set", g, who]] });
            nodes.push({ el: "button", msg, text: [`Browse as ${who}`] });
          }
        }
        break;
      case "cart":
        nodes.push(r.pick([
          { el: "text", tag: "p", parts: [["count", g], r.pick([" items in your cart", " in the cart", " cart items"])] },
          { el: "text", tag: "small", parts: ["Cart: ", ["count", g]] },
        ]));
        if (!readOnly && r.chance(0.3)) {
          const msg = b.message({ name: b.msgName(["removeFrom", "dropFrom"], "cart"), kind: "item", field: g, op: "remove" });
          nodes.push({ el: "list", field: g, tag: "ul", remove: msg, removeText: r.pick(["Remove", "×", "Drop"]) });
        }
        if (write) {
          if (cartPush || r.chance(0.7)) {
            const product = r.pick(PRODUCTS);
            const msg = b.message({ name: b.msgName(["buy", "addToCart", "order"], product.split(" ")[0]), kind: "click", ops: [["pushText", g, product]] });
            nodes.push({ el: "button", msg, text: [`Add ${product}`] });
            if (cartPush) isForced = true;
          } else {
            const msg = b.message({ name: b.msgName(["emptyCart", "clearCart"]), kind: "click", ops: [["clear", g]] });
            nodes.push({ el: "button", msg, text: ["Empty the cart"], ...(r.chance(0.5) ? { disabled: ["==", ["count", g], ["k", 0]] } : {}) });
          }
        }
        break;
      case "notices":
        nodes.push({ el: "text", tag: r.pick(["p", "small"]), parts: [["count", g], r.pick([" notices", " unread", " new notices"])] });
        if (!readOnly && r.chance(0.35)) {
          const msg = b.message({ name: b.msgName(["dismiss", "markRead"], "notice"), kind: "item", field: g, op: "remove" });
          nodes.push({ el: "list", field: g, tag: "ol", remove: msg, removeText: r.pick(["Dismiss", "OK", "Read"]) });
        }
        if (write) {
          const msg = b.message({ name: b.msgName(["markAllRead", "clearNotices"]), kind: "click", ops: [["clear", g]] });
          nodes.push({ el: "button", msg, text: ["Mark all read"], ...(r.chance(0.5) ? { disabled: ["==", ["count", g], ["k", 0]] } : {}) });
        }
        break;
      case "currency":
        nodes.push(r.pick([
          { el: "text", tag: "p", parts: ["Prices in ", g] },
          { el: "text", tag: "small", parts: [["if", ["==", g, ["k", "EUR"]], ["k", "Euro prices"], ["k", "Converted prices"]]] },
          ...(intField ? [{ el: "text", tag: "p", parts: [r.pick(["Fee: ", "Price: ", "Cost: "]), ["f", intField.name], " ", g] }] : []),
        ]));
        if (write) {
          if (r.chance(0.5)) {
            const msg = b.message({ name: b.msgName(["pickCurrency", "chooseCurrency"]), kind: "select", field: g });
            nodes.push({ el: "select", msg, label: "Currency" });
          } else {
            const msg = b.message({ name: b.msgName(["nextCurrency", "cycleCurrency"]), kind: "click", ops: [["cycle", g]] });
            nodes.push({ el: "button", msg, text: ["Switch currency"] });
          }
        }
        break;
      case "balance": {
        const k = r.pick([5, 10, 25, 50]);
        nodes.push(r.pick([
          { el: "text", tag: "p", parts: ["Balance: ", g] },
          { el: "text", tag: "strong", parts: [g, " credits"] },
          { el: "text", tag: "small", parts: [["if", ["<", g, ["k", 50]], ["k", "Low balance"], ["k", "Balance OK"]]] },
        ]));
        if (write) {
          const spend = r.chance(0.5);
          const msg = b.message({ name: b.msgName(spend ? ["spend", "pay"] : ["earn", "topUp"], k), kind: "click", ops: [["add", g, spend ? -k : k]] });
          nodes.push({ el: "button", msg, text: [spend ? `Spend ${k}` : `Top up ${k}`], disabled: spend ? ["<", g, ["k", k]] : [">", g, ["k", 9999 - k]] });
        }
        break;
      }
      case "online":
        nodes.push(r.pick([
          { el: "text", tag: "small", parts: [["if", g, ["k", "Online"], ["k", "Offline"]]] },
          { el: "when", tag: "aside", cond: ["not", g], children: [{ el: "text", tag: "p", parts: [r.pick(["You are offline. Changes will sync later.", "Offline: showing saved data.", "No connection right now."])] }] },
        ]));
        break;
    }
    b.chunk(nodes, { required: isForced, forced: isForced });
  }
}

// A conditional section: a condition over the component's own fields (or, sometimes, a global
// field it may read), wrapping a contiguous run of items that do not write what the condition
// reads, plus sometimes a text of its own.
function addWhen(b, items, globals) {
  const r = b.r;
  const own = b.fields.filter((f) => !f.every);
  if (own.length === 0 && globals.length === 0) return items;
  let cond;
  if (own.length === 0 || (globals.length && r.chance(0.2))) {
    const name = r.pick(globals.filter((n) => n !== "user"));
    cond = condFor(r, GLOBAL_BY_NAME[name], G(name));
  } else {
    const f = r.pick(own);
    cond = condFor(r, f, ["f", f.name]);
    if (own.length > 1 && r.chance(0.2)) {
      const g = r.pick(own.filter((x) => x !== f));
      cond = [r.pick(["and", "or"]), cond, condFor(r, g, ["f", g.name])];
    }
  }
  const reads = exprReads(cond);
  const ok = (it) => !it.required && ![...it.writes].some((w) => reads.has(w));
  const starts = items.map((_, i) => i).filter((i) => ok(items[i]));
  const children = [];
  let start = items.length, len = 0;
  if (starts.length && r.chance(0.85)) {
    start = r.pick(starts);
    const max = r.int(1, 3);
    while (len < max && start + len < items.length && ok(items[start + len])) len++;
    children.push(...items.slice(start, start + len));
  }
  if (children.length === 0 || r.chance(0.3)) children.push({ node: { el: "text", tag: "p", parts: [r.pick(SENTENCES)] }, writes: new Set(), required: false });
  const node = { el: "when", tag: r.pick(["div", "div", "section", "aside"]), cond, children: children.map((c) => c.node) };
  const writes = new Set(children.flatMap((c) => [...c.writes]));
  return [...items.slice(0, start), { node, writes, required: false }, ...items.slice(start + len)];
}

function condFor(r, f, F) {
  switch (f.type) {
    case "bool": return r.chance(0.7) ? F : ["not", F];
    case "int": {
      const lo = f.name === "balance" ? 50 : f.min, hi = f.name === "balance" ? 150 : Math.max(f.min, Math.min(f.max - 1, f.min + 10));
      return [r.pick([">", ">=", "<=", "<"]), F, ["k", r.int(lo, hi)]];
    }
    case "enum": return [r.pick(["==", "!="]), F, ["k", r.pick(f.options)]];
    case "list": return r.chance(0.7) ? [">", ["count", F], ["k", 0]] : [">=", ["count", F], ["k", 2]];
    case "text": return r.chance(0.7) ? [">=", ["len", F], ["k", r.int(1, 4)]] : ["has", F, r.pick(["@", "a", " "])];
  }
}

function nest(r, items, depth) {
  if (items.length < 2 || depth >= 2) return items;
  const out = [];
  let i = 0;
  while (i < items.length) {
    if (items.length - i >= 2 && r.chance(0.35)) {
      const len = r.int(2, Math.min(4, items.length - i));
      let inner = items.slice(i, i + len);
      if (r.chance(0.3)) inner = nest(r, inner, depth + 1);
      const node = { el: "group", tag: r.pick(["div", "div", "footer", "header", "fieldset"]), children: inner.map((x) => x.node) };
      out.push({ node, writes: new Set(inner.flatMap((x) => [...x.writes])), required: inner.some((x) => x.required), forced: inner.some((x) => x.forced) });
      i += len;
    } else out.push(items[i++]);
  }
  return out;
}

// The structure of a page with every text, number, initial value and name abstracted away, used
// to guarantee that no two pages of an app share a structure.
export function signature(p) {
  const comp = (c) => {
    const fi = new Map(c.fields.map((f, i) => [f.name, i]));
    const mi = new Map(c.messages.map((m, i) => [m.name, i]));
    const ref = (e) => (e[0] === "f" ? ["f", fi.get(e[1])] : e[0] === "p" ? ["p"] : ["g", e[1]]);
    const expr = (e) => {
      if (!Array.isArray(e)) return typeof e;
      if (e[0] === "f" || e[0] === "p" || e[0] === "g") return ref(e);
      if (e[0] === "k") return ["k", typeof e[1]];
      if (e[0] === "has") return ["has", expr(e[1])];
      return [e[0], ...e.slice(1).map(expr)];
    };
    const node = (n) => [n.el, n.msg != null ? mi.get(n.msg) : null, n.field ? ref(n.field) : null,
      n.check != null, n.remove != null, n.cond ? expr(n.cond) : null, n.disabled ? expr(n.disabled) : null,
      n.invalid ? expr(n.invalid.when) : null, !!n.label,
      (n.parts || []).map((x) => (typeof x === "string" ? "s" : expr(x))), (n.children || []).map(node)];
    return [
      c.fields.map((f) => [f.type, !!f.every, !!f.feed, !!f.checkable]),
      c.messages.map((m) => [m.kind, m.field ? ref(m.field) : null, m.op ?? null, (m.ops || []).map((op) => [op[0], ref(op[1]), op[0] === "push" || op[0] === "copy" ? ref(op[2]) : null])]),
      c.view.map(node),
    ];
  };
  return JSON.stringify([comp(p), (p.tabs || []).map(comp), p.modal ? comp(p.modal) : null]);
}

// ---------------------------------------------------------------------------------------------
// Lookups

export function byId(spec, id) {
  return spec.pages.find((p) => p.id === id);
}

export function fieldOf(comp, name) {
  return comp.fields.find((f) => f.name === name);
}

// The component of a page (the page itself, a tab or the modal) that owns message `name`.
export function ownerOf(page, name) {
  if (page.messages.some((m) => m.name === name)) return page;
  for (const t of page.tabs || []) if (t.messages.some((m) => m.name === name)) return t;
  if (page.modal && page.modal.messages.some((m) => m.name === name)) return page.modal;
  return null;
}

export function messageOf(comp, name) {
  return comp.messages.find((m) => m.name === name);
}

// The field description a ref names, seen from component `comp` of `page`.
export function fieldDesc(ref, comp, page) {
  if (ref[0] === "g") return GLOBAL_BY_NAME[ref[1]];
  if (ref[0] === "p") return fieldOf(page, ref[1]);
  return fieldOf(comp, ref[1]);
}

// The state of a mounted component: the page's fields, the active panel's or the open modal's.
export function compState(state, page, comp) {
  if (comp === page) return state.page.fields;
  if (comp === page.modal) return state.page.modal;
  return state.page.tab === comp.id ? state.page.panel : null;
}

// The time-driven fields mounted in a state: the current page's own and the active tab's.
export function liveFields(spec, state) {
  const page = byId(spec, state.route);
  const out = page.fields.filter((f) => f.every).map((f) => ({ comp: page, f }));
  const tab = page.tabs && page.tabs.find((t) => t.id === state.page.tab);
  if (tab) for (const f of tab.fields.filter((x) => x.every)) out.push({ comp: tab, f });
  return out;
}

// The most intervals that may be running in a state: one per mounted time-driven field (an
// implementation may share one timer between several). The serve panel checks it after every
// step, so a timer left behind by an unmounted page or tab is caught.
export function maxIntervals(spec, state) {
  return state ? liveFields(spec, state).length : 0;
}

// ---------------------------------------------------------------------------------------------
// The reference: expressions, update and render, as generic interpreters over the page
// descriptions. Pure and deterministic.

// Evaluate an expression in a component context { s (own state), p (page fields), g (global) }.
export function evaluate(e, c) {
  switch (e[0]) {
    case "f": return c.s[e[1]];
    case "p": return c.p[e[1]];
    case "g": return c.g[e[1]];
    case "k": return e[1];
    case "+": return evaluate(e[1], c) + evaluate(e[2], c);
    case "-": return evaluate(e[1], c) - evaluate(e[2], c);
    case "count": return evaluate(e[1], c).length;
    case "done": return evaluate(e[1], c).filter((it) => it.done).length;
    case "left": return evaluate(e[1], c).filter((it) => !it.done).length;
    case "len": return evaluate(e[1], c).length;
    case "has": return evaluate(e[1], c).includes(e[2]);
    case "==": return evaluate(e[1], c) === evaluate(e[2], c);
    case "!=": return evaluate(e[1], c) !== evaluate(e[2], c);
    case "<": return evaluate(e[1], c) < evaluate(e[2], c);
    case "<=": return evaluate(e[1], c) <= evaluate(e[2], c);
    case ">": return evaluate(e[1], c) > evaluate(e[2], c);
    case ">=": return evaluate(e[1], c) >= evaluate(e[2], c);
    case "and": return evaluate(e[1], c) && evaluate(e[2], c);
    case "or": return evaluate(e[1], c) || evaluate(e[2], c);
    case "not": return !evaluate(e[1], c);
    case "if": return evaluate(e[1], c) ? evaluate(e[2], c) : evaluate(e[3], c);
  }
  throw new Error(`unknown expression ${JSON.stringify(e)}`);
}

export const nextId = (items) => items.reduce((m, it) => Math.max(m, it.id), 0) + 1;
const clamp = (v, f) => Math.max(f.min, Math.min(f.max, v));

// Ops work on a record { f, p, g } of the three states a component sees; each returns a new
// record, sharing what did not change.
const get = (w, ref) => w[ref[0]][ref[1]];
const put = (w, ref, v) => (w[ref[0]][ref[1]] === v ? w : { ...w, [ref[0]]: { ...w[ref[0]], [ref[1]]: v } });

function applyOp(w, op, comp, page) {
  const [kind, ref] = op;
  const f = fieldDesc(ref, comp, page);
  const cur = get(w, ref);
  const item = (list, text) => (f.checkable ? { id: nextId(list), text, done: false } : { id: nextId(list), text });
  switch (kind) {
    case "add": return put(w, ref, clamp(cur + op[2], f));
    case "set": return put(w, ref, op[2]);
    case "toggle": return put(w, ref, !cur);
    case "reset": return put(w, ref, f.initial);
    case "cycle": return put(w, ref, f.options[(f.options.indexOf(cur) + 1) % f.options.length]);
    case "copy": return put(w, ref, get(w, op[2]));
    case "push": {
      const text = get(w, op[2]).trim();
      if (text === "") return w;
      return put(put(w, ref, [...cur, item(cur, text)]), op[2], "");
    }
    case "pushText": return put(w, ref, [...cur, item(cur, op[2])]);
    case "pop": return cur.length ? put(w, ref, cur.slice(0, -1)) : w;
    case "shift": return cur.length ? put(w, ref, cur.slice(1)) : w;
    case "clear": return cur.length ? put(w, ref, []) : w;
    case "clearDone": return cur.some((it) => it.done) ? put(w, ref, cur.filter((it) => !it.done)) : w;
  }
  throw new Error(`unknown op ${kind}`);
}

function navigate(spec, state, route) {
  if (!byId(spec, route)) throw new Error(`no page ${route}`);
  if (route === state.route) return state.menu ? { ...state, menu: false } : state;
  return { ...state, route, menu: false, page: initPage(byId(spec, route)) };
}

const setGlobal = (state, name, v) => (state.global[name] === v ? state : { ...state, global: { ...state.global, [name]: v } });

export function update(spec, state, msg) {
  switch (msg.type) {
    case "navigate":
    case "deepLink":
      return navigate(spec, state, msg.route);
    case "menu":
      return { ...state, menu: !state.menu };
    case "serverSet":
      if (!SERVER_FIELDS.includes(msg.field)) throw new Error(`serverSet: not a server field: ${msg.field}`);
      return setGlobal(state, msg.field, msg.value);
    case "notify":
      return setGlobal(state, "notices", [...state.global.notices, msg.item]);
    case "snapshot":
      return { ...state, global: msg.global };
    case "pagePush": {
      if (msg.page !== state.route) return state;
      const page = byId(spec, msg.page);
      const f = page.fields.find((x) => x.feed);
      const fields = state.page.fields;
      return { ...state, page: { ...state.page, fields: { ...fields, [f.name]: [...fields[f.name], msg.item] } } };
    }
    case "clock": {
      let next = state;
      for (const { comp, f } of liveFields(spec, state)) {
        const page = byId(spec, state.route);
        const key = comp === page ? "fields" : "panel";
        const s = next.page[key];
        const v = Math.min(f.max, s[f.name] + f.by);
        if (v !== s[f.name]) next = { ...next, page: { ...next.page, [key]: { ...s, [f.name]: v } } };
      }
      return next;
    }
  }
  // A page's own message: { page, type, ... }.
  if (msg.page !== state.route) throw new Error(`message for ${msg.page} while ${state.route} is shown`);
  const page = byId(spec, msg.page);
  if (msg.type === "tab") {
    const t = page.tabs && page.tabs.find((x) => x.id === msg.tab);
    if (!t) throw new Error(`${page.id} has no tab ${msg.tab}`);
    if (state.page.tab === t.id) return state;
    return { ...state, page: { ...state.page, tab: t.id, panel: initialOf(t) } };
  }
  const comp = ownerOf(page, msg.type);
  const m = comp && messageOf(comp, msg.type);
  if (!m) throw new Error(`page ${page.id} has no message ${msg.type}`);
  const own = compState(state, page, comp);
  if (own == null) throw new Error(`${msg.type}: its component is not mounted`);
  if (m.kind === "open") return { ...state, page: { ...state.page, modal: initialOf(page.modal) } };
  if (m.kind === "close") return { ...state, page: { ...state.page, modal: null } };
  let w = { f: own, p: state.page.fields, g: state.global };
  switch (m.kind) {
    case "click":
    case "confirm": for (const op of m.ops) w = applyOp(w, op, comp, page); break;
    case "input":
    case "select": w = put(w, m.field, msg.value); break;
    case "check": w = put(w, m.field, !get(w, m.field)); break;
    case "item": {
      const items = get(w, m.field);
      w = put(w, m.field, m.op === "remove" ? items.filter((it) => it.id !== msg.id) : items.map((it) => (it.id === msg.id ? { ...it, done: !it.done } : it)));
      break;
    }
    default: throw new Error(`unknown message kind ${m.kind}`);
  }
  // Write the three states back. The page component's own state is the page's fields.
  let pageState = state.page;
  if (comp === page) {
    if (w.f !== pageState.fields) pageState = { ...pageState, fields: w.f };
  } else {
    if (w.p !== pageState.fields) pageState = { ...pageState, fields: w.p };
    if (comp === page.modal) {
      if (m.kind === "confirm") pageState = { ...pageState, modal: null };
      else if (w.f !== pageState.modal) pageState = { ...pageState, modal: w.f };
    } else if (w.f !== pageState.panel) pageState = { ...pageState, panel: w.f };
  }
  if (pageState === state.page && w.g === state.global) return state;
  return { ...state, page: pageState, global: w.g };
}

// The reference render. Returns a tree of { tag, attrs, props, children } and strings. `attrs` are
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

export function render(spec, state) {
  return h("div", { "data-role": "app" },
    renderShell(spec, state),
    state.menu ? h("nav", { "data-role": "menuList" }, spec.pages.map((p) => h("button", { "data-key": p.id, "data-role": "menuLink" }, p.title))) : null,
    renderPage(spec, state));
}

export function renderShell(spec, state) {
  const g = state.global;
  return h("header", { "data-key": "shell", "data-role": "shell" },
    h("strong", null, spec.app),
    h("nav", { "data-role": "nav" },
      spec.pinned.map((id) => h("button", { "data-key": id, "data-role": "navLink", "aria-current": state.route === id ? "page" : null }, byId(spec, id).title)),
      h("button", { "data-role": "menu", "aria-expanded": String(state.menu) }, "All pages")),
    h("p", null,
      h("span", { "data-role": "user" }, "Signed in as ", g.user), " · ",
      h("span", { "data-role": "cartCount" }, "Cart: ", g.cart.length), " · ",
      h("span", { "data-role": "noticeCount" }, g.notices.length, " notices")));
}

export function renderPage(spec, state) {
  const page = byId(spec, state.route);
  const ps = state.page;
  const c = { spec, page, comp: page, s: ps.fields, p: ps.fields, g: state.global, state };
  const modal = ps.modal
    ? h("aside", { "data-key": "modal", "data-role": "dialog" }, h("h2", null, page.modal.title),
      page.modal.view.map((n) => renderNode(n, { ...c, comp: page.modal, s: ps.modal })))
    : null;
  return h("main", { "data-key": page.id, "data-role": "page" }, h("h1", null, page.title), page.view.map((n) => renderNode(n, c)), modal);
}

const textOf = (parts, c) => parts.map((x) => (typeof x === "string" ? x : String(evaluate(x, c)))).join("");
const roleOfList = (ref) => `${ref[1]}Item`;

function renderNode(n, c) {
  const { page, comp } = c;
  switch (n.el) {
    case "text":
      return h(n.tag, null, textOf(n.parts, c));
    case "button":
      return h("button", { "data-role": n.msg, disabled: n.disabled ? !!evaluate(n.disabled, c) : false }, textOf(n.text, c));
    case "input": {
      const m = messageOf(comp, n.msg);
      const f = fieldDesc(m.field, comp, page);
      const v = evaluate(m.field, c);
      const input = f.type === "int"
        ? h("input", { type: "number", "data-role": n.msg, value: String(v) })
        : h("input", { type: "text", "data-role": n.msg, placeholder: n.placeholder, value: v });
      const error = n.invalid && evaluate(n.invalid.when, c) ? h("p", { "data-role": `${n.msg}Error` }, n.invalid.message) : null;
      return [n.label ? h("label", null, n.label, input) : input, error];
    }
    case "check": {
      const m = messageOf(comp, n.msg);
      return h("label", null, h("input", { type: "checkbox", "data-role": n.msg, checked: evaluate(m.field, c) }), n.label);
    }
    case "select": {
      const m = messageOf(comp, n.msg);
      const f = fieldDesc(m.field, comp, page);
      const select = h("select", { "data-role": n.msg, value: evaluate(m.field, c) }, f.options.map((o) => h("option", { value: o }, o)));
      return n.label ? h("label", null, n.label, select) : select;
    }
    case "list":
      return h(n.tag, null, evaluate(n.field, c).map((it) =>
        h("li", { "data-key": it.id, "data-role": roleOfList(n.field) },
          n.check ? h("input", { type: "checkbox", "data-role": n.check, checked: it.done }) : null,
          h("span", null, it.text),
          n.remove ? h("button", { "data-role": n.remove }, n.removeText) : null)));
    case "when":
      return evaluate(n.cond, c) ? h(n.tag, null, n.children.map((x) => renderNode(x, c))) : null;
    case "group":
      return h(n.tag, null, n.children.map((x) => renderNode(x, c)));
    case "link":
      return h("button", { "data-key": n.to, "data-role": "pageLink" }, n.text);
    case "open":
      return h("button", { "data-role": n.msg }, n.text);
    case "tabs": {
      const active = page.tabs.find((t) => t.id === c.state.page.tab);
      return [
        h("nav", { "data-role": "tabs" }, page.tabs.map((t) => h("button", { "data-key": t.id, "data-role": "tab", "aria-selected": String(t === active) }, t.label))),
        h("section", { "data-key": active.id, "data-role": "panel" }, active.view.map((x) => renderNode(x, { ...c, comp: active, s: c.state.page.panel }))),
      ];
    }
  }
  throw new Error(`unknown view node ${n.el}`);
}

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (s) => s.replace(/[&<>"]/g, (ch) => ESC[ch]);

// Serialize a reference tree as HTML (props shown as attributes, for reading).
export function toHTML(node) {
  if (typeof node === "string") return esc(node);
  const attrs = { ...node.attrs };
  if ("value" in node.props) attrs.value = String(node.props.value);
  if (node.props.checked) attrs.checked = "";
  const open = `<${node.tag}${Object.entries(attrs).map(([k, v]) => (v === "" ? ` ${k}` : ` ${k}="${esc(v)}"`)).join("")}>`;
  if (node.tag === "input") return open;
  if (node.tag === "select" && "value" in node.props) {
    return open + node.children.map((ch) => (typeof ch !== "string" && ch.attrs.value === node.props.value ? toHTML({ ...ch, attrs: { ...ch.attrs, selected: "" } }) : toHTML(ch))).join("") + `</${node.tag}>`;
  }
  return open + node.children.map(toHTML).join("") + `</${node.tag}>`;
}

// Where a component's controls sit: message name → { inWhen, node } for every control in its
// view (item controls under their list). Used by the script and the work actions to pick controls
// that are always rendered.
export function controls(comp) {
  const out = new Map();
  const visit = (n, inWhen) => {
    for (const k of ["msg", "check", "remove"]) if (n[k]) out.set(n[k], { inWhen, node: n });
    for (const ch of n.children || []) visit(ch, inWhen || n.el === "when");
  };
  for (const n of comp.view) visit(n, false);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Selectors

// [data-role=role] inside the page's <main>, optionally inside a keyed list item (`item`).
export function target(page, role, item) {
  return `[data-key="${page}"][data-role="page"] ${item != null ? `[data-key="${item}"] ` : ""}[data-role="${role}"]`;
}
export const navTarget = (route) => `[data-role="navLink"][data-key="${route}"]`;
export const menuTarget = (route) => `[data-role="menuLink"][data-key="${route}"]`;
export const MENU_BUTTON = `[data-role="menu"]`;
export const linkTarget = (page, route) => `[data-key="${page}"][data-role="page"] [data-role="pageLink"][data-key="${route}"]`;
export const tabTarget = (page, tab) => `[data-key="${page}"][data-role="page"] [data-role="tab"][data-key="${tab}"]`;

// ---------------------------------------------------------------------------------------------
// External events. Each builder is a pure function of the spec, the current reference state and a
// salt, so the serve panel can produce fresh events and the script stays deterministic.

export function serverSetMsg(spec, state, field, salt) {
  const r = rng("server", spec.options.seed, field, salt);
  const v = state.global[field];
  let value;
  switch (field) {
    case "user": value = r.pick(USERS.filter((u) => u !== v)); break;
    case "currency": value = r.pick(GLOBAL_BY_NAME.currency.options.filter((o) => o !== v)); break;
    case "balance": value = r.int(0, 400); if (value === v) value = v + 1; break;
    case "online": value = !v; break;
    default: throw new Error(`serverSet: not a server field: ${field}`);
  }
  return { type: "serverSet", field, value };
}

export function notifyMsg(spec, state, salt) {
  const r = rng("notify", spec.options.seed, salt);
  return { type: "notify", item: { id: nextId(state.global.notices), text: r.pick(NEWS) } };
}

export function feedField(page) {
  return page.fields.find((f) => f.feed);
}

// A push to one page's feed. It reaches the page only while the page is shown; the id continues
// the list the page shows (or would show if it mounted now).
export function pagePushMsg(spec, state, pageId, salt) {
  const page = byId(spec, pageId);
  const f = feedField(page);
  const list = state.route === pageId ? state.page.fields[f.name] : f.initial;
  const r = rng("push", spec.options.seed, pageId, salt);
  return { type: "pagePush", page: pageId, item: { id: nextId(list), text: r.pick(NEWS) } };
}

// A whole new global state, as a server would send it on a re-sync: every scalar changes (the
// online flag flips at random), keyed lists keep their ids but are partly reordered, each with
// one new item.
export function snapshot(spec, state, salt) {
  const r = rng("snapshot", spec.options.seed, salt);
  const g = state.global;
  const user = r.pick(USERS.filter((u) => u !== g.user));
  const currency = r.pick(GLOBAL_BY_NAME.currency.options.filter((o) => o !== g.currency));
  let balance = r.int(0, 400);
  if (balance === g.balance) balance++;
  const list = (items, pool) => [...partlyReorder(items, r), { id: nextId(items), text: r.pick(pool) }];
  return { user, cart: list(g.cart, PRODUCTS), notices: list(g.notices, NEWS), currency, balance, online: r.chance(0.5) ? !g.online : g.online };
}

function partlyReorder(list, r) {
  if (list.length < 2) return list.slice();
  const a = r.int(0, list.length - 2);
  const b = r.int(a + 1, list.length - 1);
  return [...list.slice(0, a), ...list.slice(a, b + 1).reverse(), ...list.slice(b + 1)];
}

// The external events the serve panel offers. `clock: true` marks the virtual clock: the panel
// fires every running interval once instead of dispatching (README, "Time").
export function panelEvents(spec) {
  const feeds = spec.pages.filter((p) => feedField(p)).map((p) => p.id);
  return [
    { name: "deepLink", targets: spec.pages.map((p) => p.id), make: (state, target) => ({ type: "deepLink", route: target }) },
    { name: "serverSet", targets: SERVER_FIELDS, make: (state, target, salt) => serverSetMsg(spec, state, target, salt) },
    { name: "notify", make: (state, _target, salt) => notifyMsg(spec, state, salt) },
    { name: "pagePush", targets: feeds, make: (state, target, salt) => pagePushMsg(spec, state, target, salt) },
    { name: "snapshot", make: (state, _target, salt) => ({ type: "snapshot", global: snapshot(spec, state, salt) }) },
    { name: "clock", clock: true, make: () => ({ type: "clock" }) },
  ];
}

// ---------------------------------------------------------------------------------------------
// The interaction script: the same for every framework.
//
// Steps:
//   { do: "mount" } | { do: "dispose" }
//   { do: "click", target, msg }               click the element
//   { do: "type", target, value, msg }         set an input's value to `value` and fire `input`
//   { do: "select", target, value, msg }       choose an option and fire `input` and `change`
//   { do: "dispatch", msg }                    an external event through the contract
//   { do: "clock", msg }                       fire every running interval once (the virtual clock)
// A target is a CSS selector built from the stable data-key/data-role attributes. `msg` is the
// reference message the step stands for. A step is only generated when its target is rendered
// (and, for a button, enabled) in the reference at that moment.

export function makeScript(spec) {
  const steps = [];
  let state = spec.initialState;
  const ctx = {
    spec,
    get state() { return state; },
    push(step) {
      steps.push(step);
      if (step.msg) state = update(spec, state, step.msg);
    },
  };
  const clock = (why) => ctx.push({ do: "clock", label: `clock${why ? " " + why : ""}`, msg: { type: "clock" } });
  ctx.push({ do: "mount", label: "mount" });
  clock("(nothing running)");

  const feeds = spec.pages.filter((p) => feedField(p));
  for (const [i, page] of spec.pages.entries()) {
    const r = rng("script", spec.options.seed, page.id);
    if (i > 0) navigateTo(ctx, page, r);

    // The page, its tabs (each mounted in turn, then the first again: fresh state), its modal.
    exercise(ctx, page, page, r, "first");
    if (page.fields.some((f) => f.every)) { clock(); clock(); }
    if (page.tabs) {
      for (const t of page.tabs) {
        if (state.page.tab !== t.id) selectTab(ctx, page, t);
        exercise(ctx, page, t, r, "first");
        if (t.fields.some((f) => f.every)) { clock(); clock(); }
      }
      selectTab(ctx, page, page.tabs[0]);
    }
    if (page.modal) {
      const open = page.messages.find((m) => m.kind === "open");
      const close = page.modal.messages.find((m) => m.kind === "close");
      const confirm = page.modal.messages.find((m) => m.kind === "confirm");
      click(ctx, page, open.name);
      exercise(ctx, page, page.modal, r, "first");
      const ok = findRole(renderPage(spec, state), confirm.name);
      click(ctx, page, ok && !("disabled" in ok.attrs) ? confirm.name : close.name);
      click(ctx, page, open.name);
      click(ctx, page, close.name);
    }

    // External events while this page is shown.
    const rx = rng("external", spec.options.seed, page.id);
    if (rx.chance(0.4)) {
      const field = rx.pick(SERVER_FIELDS);
      ctx.push({ do: "dispatch", label: `serverSet ${field}`, msg: serverSetMsg(spec, state, field, `script-${page.id}`) });
    }
    if (rx.chance(0.25)) ctx.push({ do: "dispatch", label: "notify", msg: notifyMsg(spec, state, `script-${page.id}`) });
    if (feedField(page)) ctx.push({ do: "dispatch", label: `pagePush ${page.id} (shown)`, msg: pagePushMsg(spec, state, page.id, `script-${page.id}`) });
    const hidden = feeds.filter((p) => p !== page);
    if (hidden.length && rx.chance(0.3)) {
      const p = rx.pick(hidden);
      ctx.push({ do: "dispatch", label: `pagePush ${p.id} (not shown)`, msg: pagePushMsg(spec, state, p.id, `script-${page.id}`) });
    }
    if (rx.chance(0.06)) {
      ctx.push({ do: "click", label: "open the menu", target: MENU_BUTTON, msg: { type: "menu" } });
      ctx.push({ do: "click", label: "close the menu", target: MENU_BUTTON, msg: { type: "menu" } });
    }
    // Sometimes back to an earlier page through one of its links: it shows its initial state.
    const links = page.view.flatMap(function all(n) { return n.el === "link" ? [n] : (n.children || []).flatMap(all); });
    if (links.length && rx.chance(0.3)) {
      const l = rx.pick(links);
      ctx.push({ do: "click", label: `link ${page.id} → ${l.to}`, target: linkTarget(page.id, l.to), msg: { type: "navigate", route: l.to } });
    }
  }

  // A re-sync of the global state, then a final round on the first page.
  ctx.push({ do: "dispatch", label: "snapshot", msg: { type: "snapshot", global: snapshot(spec, state, "script") } });
  const first = spec.pages[0];
  if (state.route !== first.id) ctx.push({ do: "click", label: `nav ${first.id}`, target: navTarget(first.id), msg: { type: "navigate", route: first.id } });
  exercise(ctx, first, first, rng("final", spec.options.seed, first.id), "final");

  // A time-driven page: its timer runs while it is shown and stops when it is left.
  const live = spec.pages.find((p) => p.fields.some((f) => f.every));
  if (live) {
    ctx.push({ do: "dispatch", label: `deepLink ${live.id}`, msg: { type: "deepLink", route: live.id } });
    clock();
    ctx.push({ do: "click", label: `nav ${first.id}`, target: navTarget(first.id), msg: { type: "navigate", route: first.id } });
    clock("(the time-driven page was left)");
  }

  ctx.push({ do: "dispose", label: "dispose" });
  return steps;
}

// Navigate to `page` by one of the ways the app offers: the nav bar (pinned pages), a link in the
// current page, the "All pages" menu, or a deep link.
function navigateTo(ctx, page, r) {
  const { spec, state } = ctx;
  const nav = { type: "navigate", route: page.id };
  const ways = [["deep", 30], ["menu", 20]];
  if (spec.pinned.includes(page.id)) ways.push(["nav", 60]);
  if (findLink(renderPage(spec, state), page.id)) ways.push(["link", 80]);
  const way = r.weighted(ways);
  if (way === "nav") ctx.push({ do: "click", label: `nav ${page.id}`, target: navTarget(page.id), msg: nav });
  else if (way === "link") ctx.push({ do: "click", label: `link ${state.route} → ${page.id}`, target: linkTarget(state.route, page.id), msg: nav });
  else if (way === "menu") {
    ctx.push({ do: "click", label: "open the menu", target: MENU_BUTTON, msg: { type: "menu" } });
    ctx.push({ do: "click", label: `menu ${page.id}`, target: menuTarget(page.id), msg: nav });
  } else ctx.push({ do: "dispatch", label: `deepLink ${page.id}`, msg: { type: "deepLink", route: page.id } });
}

function findLink(tree, route) {
  let found = false;
  const visit = (n) => {
    if (found || typeof n === "string") return;
    if (n.attrs["data-role"] === "pageLink" && n.attrs["data-key"] === route) { found = true; return; }
    n.children.forEach(visit);
  };
  visit(tree);
  return found;
}

function selectTab(ctx, page, t) {
  ctx.push({ do: "click", label: `${page.id} tab ${t.id}`, target: tabTarget(page.id, t.id), msg: { page: page.id, type: "tab", tab: t.id } });
}

function click(ctx, page, name) {
  ctx.push({ do: "click", label: `${page.id} ${name}`, target: target(page.id, name), msg: { page: page.id, type: name } });
}

// Find the rendered element with data-role `role` in a reference tree (inside the list item with
// data-key `item` if given).
export function findRole(tree, role, item) {
  let found = null;
  const visit = (n, inItem) => {
    if (found || typeof n === "string") return;
    const here = inItem || (item != null && n.attrs["data-key"] === String(item) && n.tag === "li");
    if (n.attrs["data-role"] === role && (item == null || here)) { found = n; return; }
    for (const ch of n.children) visit(ch, here);
  };
  visit(tree, false);
  return found;
}

const KIND_ORDER = { input: 0, select: 1, check: 2, click: 3, item: 4 };

// Exercise a mounted component's messages (not open, close or confirm, which the caller drives).
function exercise(ctx, page, comp, r, round) {
  let msgs = comp.messages.filter((m) => m.kind in KIND_ORDER).sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  if (round === "final") {
    const listy = (m) => m.kind === "item" || (m.kind === "click" && m.ops.some((op) => fieldDesc(op[1], comp, page).type === "list"));
    const rest = r.sample(msgs.filter((m) => !listy(m)), 2);
    msgs = msgs.filter((m) => listy(m) || rest.includes(m));
  }
  let pending = msgs;
  for (let pass = 0; pass < 2 && pending.length; pass++) pending = pending.filter((m) => !act(ctx, page, comp, m, r, round));
}

// Perform one message's control (1-2 times). Returns false if its control is not available.
function act(ctx, page, comp, m, r, round) {
  const { spec } = ctx;
  const value = (ref) => evaluate(ref, { s: compState(ctx.state, page, comp), p: ctx.state.page.fields, g: ctx.state.global });
  const here = (role, item) => findRole(renderPage(spec, ctx.state), role, item);
  const msg = (extra) => ({ page: page.id, type: m.name, ...extra });
  const sel = target(page.id, m.name);
  switch (m.kind) {
    case "click": {
      const times = round === "first" ? r.int(1, 2) : 1;
      let done = 0;
      for (let k = 0; k < times; k++) {
        const b = here(m.name);
        if (!b || "disabled" in b.attrs) break;
        ctx.push({ do: "click", label: `${page.id} ${m.name}`, target: sel, msg: msg() });
        done++;
      }
      return done > 0;
    }
    case "check": {
      if (!here(m.name)) return false;
      const times = round === "first" ? r.int(1, 2) : 1;
      for (let k = 0; k < times && here(m.name); k++) ctx.push({ do: "click", label: `${page.id} ${m.name}`, target: sel, msg: msg() });
      return true;
    }
    case "select": {
      if (!here(m.name)) return false;
      const f = fieldDesc(m.field, comp, page);
      const v = r.pick(f.options.filter((o) => o !== value(m.field)));
      ctx.push({ do: "select", label: `${page.id} ${m.name} ${v}`, target: sel, value: v, msg: msg({ value: v }) });
      return true;
    }
    case "input": {
      if (!here(m.name)) return false;
      const f = fieldDesc(m.field, comp, page);
      if (f.type === "int") typeNumber(ctx, page, m, f, sel, r, round, () => value(m.field));
      else {
        const from = value(m.field);
        let to = round === "first" ? r.pick(TEXT_SAMPLES) : from + r.pick(["!", "s", " 2", "a"]);
        if (to === from) to = from + "z";
        typeInto(ctx, page, sel, from, to, (v) => msg({ value: v }));
      }
      return true;
    }
    case "item": {
      const items = value(m.field);
      if (items.length === 0) return false;
      const it = r.pick(items);
      if (!here(m.name, it.id)) return false;
      ctx.push({ do: "click", label: `${page.id} ${m.name} ${it.id}`, target: target(page.id, m.name, it.id), msg: msg({ id: it.id }) });
      return true;
    }
  }
  throw new Error(`unknown message kind ${m.kind}`);
}

function typeInto(ctx, page, sel, from, to, makeMsg) {
  let current = from;
  if (!to.startsWith(from)) {
    current = "";
    if (from !== "") ctx.push({ do: "type", label: `${page.id} clear the input`, target: sel, value: "", msg: makeMsg("") });
  }
  for (let i = current.length; i < to.length; i++) {
    const value = to.slice(0, i + 1);
    ctx.push({ do: "type", label: `${page.id} type "${value}"`, target: sel, value, msg: makeMsg(value) });
  }
}

// As in unique-components: two invalid values first (no message; the typed text is kept), then
// valid in-range integers.
function typeNumber(ctx, page, m, f, sel, r, round, current) {
  if (round === "first") {
    for (const value of [String(f.max + 1), "1.5"]) {
      ctx.push({ do: "type", label: `${page.id} type "${value}" (invalid: no message)`, target: sel, value, exemptValue: true });
    }
  }
  const n = round === "first" ? 2 : 1;
  for (let k = 0; k < n; k++) {
    const cur = String(current());
    const d = String(r.int(1, 9));
    let value = cur + d;
    if (cur === "0" || cur.startsWith("-") || Number(value) > f.max) value = d;
    if (Number(value) === Number(cur)) value = String((Number(d) % 9) + 1);
    ctx.push({ do: "type", label: `${page.id} type "${value}"`, target: sel, value, msg: { page: page.id, type: m.name, value: Number(value) } });
  }
}
