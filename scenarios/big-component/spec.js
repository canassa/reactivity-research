// The big-component scenario generator and its reference: one large settings form, a single
// component with one model, that grows by adding fields (with their controls, displays and the
// derived values, conditions, validations and disabled states over them), plus one small
// companion widget that stays the same at every size.
//
// This module is the single source of truth for the scenario (see README.md). It runs both in
// Node (the CLI generates specs with it) and in the browser (the serve panel imports it alone
// from /__rr/spec.js and uses the reference `update` and `render` and the external-event
// builders), so it imports nothing. The component vocabulary (fields, messages, ops,
// expressions, view nodes) is the one of unique-components, copied here for that reason.
//
// `generate(options)` returns a plain-data app spec: the widget descriptions (w1, the big
// component, and w2, its companion), the initial state and the interaction script. The
// reference `update` and `render` are generic interpreters over the descriptions;
// implementations must not be (README, "The component is its own code").
//
// The form is one flat sequence of field units, with no sections, fieldsets or other groups
// around them, so nothing in the spec marks a boundary an update strategy could stop at.
//
// Prefix stability: for one seed, field unit i (its fields, messages and view nodes) is the same
// at every size. Unit i is drawn from its own random stream and may only look back at earlier
// units; a node that reads several units belongs to the latest of them, so growing N only
// appends.

export const scenario = "big-component";

// The size ./rr check builds by default (and the locality check's smaller size). The first 9
// units always carry the capabilities the work actions need (see FORCED); 16 adds variety.
export const quickCheckSize = 16;

// The scenario's own parameters (beyond --size and --seed): none.
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
// Seeded randomness

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
// Word pools. A field's name is its unit's noun followed by a word (`billingOrders`): camelCase
// identifiers valid in every target language, unique in the component.

const ADJECTIVES = ["Team", "Office", "Studio", "Warehouse", "Fleet", "Library", "Clinic", "Campus",
  "Workshop", "Store", "Project", "Regional", "Family", "Club", "Market", "Bakery", "Gallery", "Depot"];
const PAGES = ["settings", "preferences", "setup", "configuration", "options", "profile"];

const NOUNS = ["billing", "shipping", "contact", "profile", "account", "privacy", "alerts",
  "display", "audio", "network", "storage", "backup", "payment", "invoice", "team", "project",
  "calendar", "travel", "booking", "delivery", "support", "security", "reports", "sync",
  "theme", "language", "keyboard", "printer", "camera", "garden", "kitchen", "office",
  "studio", "fleet", "depot", "harbor", "clinic", "pantry", "lobby", "archive"];

const NAMES = {
  int: ["visits", "orders", "tickets", "cups", "boxes", "laps", "pages", "calls", "seats", "score",
    "level", "volume", "speed", "retries", "guests", "points", "rounds", "floors", "miles", "crates",
    "pins", "votes", "bids", "stamps", "coins", "plates", "beds", "lanes", "hours", "degrees"],
  tick: ["seconds", "elapsed", "uptime", "minutes", "ticks", "age", "countdown", "waited"],
  bool: ["open", "muted", "pinned", "locked", "urgent", "visible", "archived", "starred", "paused",
    "enabled", "expanded", "shared", "verified", "hidden", "flagged", "synced", "booked", "signed",
    "approved", "silent"],
  gate: ["running", "ticking", "live", "active", "started", "counting"],
  text: ["title", "nickname", "code", "note", "city", "tag", "email", "handle", "motto", "caption",
    "author", "street", "topic", "comment", "subject", "venue", "remark", "phrase", "greeting", "slogan"],
  draft: ["draft", "entry", "proposal", "sketch", "jot", "memo"],
  list: ["tasks", "notes", "errands", "links", "songs", "chores", "events", "books", "parcels",
    "ideas", "bugs", "stops", "dishes", "plants", "files", "contacts", "invites", "goals"],
  feed: ["news", "alerts", "messages", "updates", "inbox", "activity", "notices", "pings"],
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
const SERVER_TEXTS = ["from the server", "Server value", "synced", "Lisbon", "abc123", "", "ops@site"];

const cap = (s) => s[0].toUpperCase() + s.slice(1);
const numName = (n) => (n < 0 ? `Minus${-n}` : String(n));
const token4 = (r) => Array.from({ length: 4 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[r.int(0, 35)]).join("");

// ---------------------------------------------------------------------------------------------
// The capabilities the first units always have, so the work actions (harness/work/) find the
// same targets at every size from 9 up. None of them is ever inside a conditional section.

export const FORCED = [
  "addButton",   // unit 0: an int with an "add k" button that is never disabled
  "textInput",   // unit 1: a text with an input
  "listPush",    // unit 2: a list fed from a draft (input + push button), with an item remove control
  "boolToggle",  // unit 3: a bool with a checkbox or a toggle button
  "enumControl", // unit 4: an enum with a select or a cycle button
  "feed",        // unit 5: a feed list (the target of notify)
  "numberInput", // unit 6: an int with a number input
  "tick",        // unit 7: a time-driven int with its gate bool and a control for the gate
  "dependent",   // unit 8: an int with a derived text reading unit 6's field, and a conditional
                 //         section over unit 3's bool
];

// Which earlier fields a unit's cross-field bindings may read or write: mostly those of the last
// few units (RECENT), plus a few drawn from anywhere before (FAR), skipping any field that the
// bindings of later units already read READ_CAP times. The cap, not a distance, bounds the number
// of bindings reading one field, whatever N; a dependency may reach back to the first unit.
const RECENT = 6;
const FAR = 4;
const READ_CAP = 3;

// ---------------------------------------------------------------------------------------------
// Generation

export function generate(rawOptions) {
  const options = normalizeOptions(rawOptions);
  const { size, seed } = options;

  // The component: its fields, messages and units, built unit by unit. `reads` counts, per
  // field, the binding sites of later units that read it.
  const W = { fields: [], messages: [], used: new Set(), words: new Map(), unitOf: new Map(), reads: new Map(), units: [] };
  for (let i = 0; i < size; i++) W.units.push(buildUnit(W, rng("unit", seed, i), i, FORCED[i] ?? null));

  const rh = rng("component", seed);
  const token = token4(rh);
  const big = {
    id: "w1", kind: "form", token, label: `${rh.pick(ADJECTIVES)} ${rh.pick(PAGES)} ${token}`,
    fields: W.fields.map(cleanField), messages: W.messages, view: W.units.flatMap((u) => u.items.map((it) => it.node)),
  };
  const companion = buildCompanion(rng("companion", seed), W, big);
  const widgets = [big, companion];
  const initialState = { widgets: {} };
  for (const w of widgets) initialState.widgets[w.id] = initialOf(w);
  const spec = { scenario, options, widgets, initialState };
  spec.script = makeScript(spec);
  return spec;
}

export function initialOf(w) {
  const s = {};
  for (const f of w.fields) s[f.name] = structuredCloneish(f.initial);
  return s;
}

const structuredCloneish = (v) => (Array.isArray(v) ? v.map((x) => ({ ...x })) : v);

function cleanField(f) {
  const { draftFor, ...rest } = f;
  return rest;
}

// The unit builder: names, fields, messages and chunks of view items for unit i. An item is
// { node, writes (fields the node's controls write), required (a forced control: never hidden) }.
function makeBuilder(W, r, i, prefix) {
  const b = {
    r, chunks: [],
    name(pool) {
      const full = (w) => prefix + cap(w);
      const free = pool.filter((w) => !W.used.has(full(w)));
      const word = free.length ? r.pick(free) : r.pick(pool);
      let n = full(word);
      for (let k = 2; W.used.has(n); k++) n = `${full(word)}${k}`;
      W.used.add(n);
      W.words.set(n, word);
      return n;
    },
    msgName(verbs, ...parts) {
      const base = r.pick(verbs) + parts.map((p) => cap(String(p))).join("");
      let n = base;
      for (let k = 2; W.used.has(n); k++) n = `${base}${k}`;
      W.used.add(n);
      return n;
    },
    word: (name) => W.words.get(name),
    label: (name) => cap(W.words.get(name)),
    field(f) { W.fields.push(f); W.unitOf.set(f.name, i); return f; },
    message(m) { W.messages.push(m); return m.name; },
    chunk(nodes, { required = false } = {}) {
      b.chunks.push(nodes.map((node) => ({ node, writes: writesOf(W, node), required })));
    },
  };
  return b;
}

// The fields a node's controls write (recursively).
function writesOf(W, node) {
  const out = new Set();
  const visit = (n) => {
    for (const name of [n.msg, n.check, n.remove].filter(Boolean)) {
      const m = W.messages.find((x) => x.name === name);
      if (m) for (const f of messageWrites(m)) out.add(f);
    }
    for (const c of n.children || []) visit(c);
  };
  visit(node);
  return out;
}

export function messageWrites(m) {
  if (m.kind === "click") {
    const out = [];
    for (const op of m.ops) {
      out.push(op[1]);
      if (op[0] === "push") out.push(op[2]);
    }
    return out;
  }
  return [m.field];
}

// One unit: its main field (and the draft of a list or the gate of a time-driven int), its
// controls and displays, then the bindings that tie it to earlier units: a combined message, a
// disabled state or a validation reading an earlier field, a derived text, a conditional section.
function buildUnit(W, r, i, role) {
  const b = makeBuilder(W, r, i, r.pick(NOUNS));
  const forced = !!role;
  const before = W.fields.length;

  switch (role) {
    case "addButton": GEN.int(b, { addButton: true }); break;
    case "textInput": GEN.text(b, { required: true }); break;
    case "listPush": GEN.list(b, { pushFromDraft: true, remove: true }); break;
    case "boolToggle": GEN.bool(b, { toggle: true }); break;
    case "enumControl": GEN.enum(b, { control: true }); break;
    case "feed": GEN.list(b, { feed: true }); break;
    case "numberInput": GEN.int(b, { numberInput: true }); break;
    case "tick": tickField(b); break;
    case "dependent": GEN.int(b, { required: true }); break;
    default: {
      const t = r.weighted([["int", 30], ["bool", 20], ["text", 20], ["enum", 15], ["list", 6], ["tick", 2]]);
      if (t === "tick") tickField(b);
      else GEN[t](b, {});
    }
  }
  const main = W.fields[before];
  const own = new Set(W.fields.slice(before).map((f) => f.name));

  // Earlier fields this unit's bindings may read or write (see RECENT, FAR, READ_CAP).
  const open = W.fields.slice(0, before).filter((f) => (W.reads.get(f.name) ?? 0) < READ_CAP);
  const recent = open.filter((f) => W.unitOf.get(f.name) >= i - RECENT);
  const far = new Set(r.sample(open.filter((f) => W.unitOf.get(f.name) < i - RECENT), FAR));
  const earlier = open.filter((f) => far.has(f) || recent.includes(f));

  if (role === "dependent") dependent(b, W, main);
  if (!forced) {
    if (r.chance(0.12)) combined(b, main, earlier.filter(isPlain));
    if (r.chance(0.15)) crossDisabled(b, earlier);
    if (main.type === "text" && r.chance(0.4)) crossValidation(b, main, earlier);
  }
  if (r.chance(0.5)) derived(b, main, earlier);

  // Order: the forced chunks first, the others shuffled.
  const req = b.chunks.filter((c) => c[0]?.required);
  let items = [...req, ...r.shuffle(b.chunks.filter((c) => !c[0]?.required))].flat();
  if (!forced && r.chance(0.2)) items = unitWhen(b, items, earlier);
  // Sometimes the unit's own nodes sit in a wrapper of their own (it never holds another unit).
  if (items.length >= 2 && r.chance(0.25)) {
    items = [{ node: { el: "group", tag: r.pick(["div", "div", "header", "footer"]), children: items.map((it) => it.node) },
      writes: new Set(items.flatMap((it) => [...it.writes])), required: items.some((it) => it.required) }];
  }
  for (const it of items) {
    for (const name of readSites(it.node)) if (!own.has(name)) W.reads.set(name, (W.reads.get(name) ?? 0) + 1);
  }
  return { main, items };
}

// The fields read by each binding site of a node, once per site (recursively): text parts and
// button texts, disabled states, conditions and validations.
function readSites(node) {
  const out = [];
  const site = (e) => out.push(...exprFields(e));
  const visit = (n) => {
    for (const p of [...(n.parts || []), ...(n.text || [])]) if (typeof p !== "string") site(p);
    if (n.disabled) site(n.disabled);
    if (n.cond) site(n.cond);
    if (n.invalid) site(n.invalid.when);
    for (const c of n.children || []) visit(c);
  };
  visit(node);
  return out;
}

function exprFields(e, out = new Set()) {
  if (e[0] === "f") out.add(e[1]);
  else if (e[0] !== "k" && e[0] !== "w") for (const x of e.slice(1)) if (Array.isArray(x)) exprFields(x, out);
  return out;
}

const isPlain = (f) => f.type !== "list" && !f.draftFor;

// Per-type field generators. Each adds its field, its messages and its view chunk.
const GEN = {
  int(b, opts) {
    const r = b.r;
    const name = b.name(NAMES.int);
    let min = r.pick([0, 0, 0, -5, -10, 1]);
    let max = min + r.int(5, 60);
    if (opts.numberInput || (!opts.addButton && !opts.required && r.chance(0.3))) {
      opts = { ...opts, numberInput: true };
      min = Math.min(min, 0);
      max = Math.max(max, 20);
    }
    const initial = r.int(min, min + Math.floor((max - min) / 2));
    const f = b.field({ name, type: "int", min, max, initial });
    const F = ["f", name];
    const nodes = [];
    const required = !!(opts.addButton || opts.numberInput || opts.required);
    if (opts.numberInput) {
      const msg = b.message({ name: b.msgName(["enter", "set", "type", "input"], name), kind: "input", field: name });
      nodes.push({ el: "input", msg, ...(r.chance(0.6) ? { label: b.label(name) } : {}) });
    }
    const nButtons = opts.addButton ? r.int(1, 3) : opts.numberInput ? r.int(0, 1) : r.int(1, 3);
    const kinds = r.shuffle(["inc", "dec", "set", "reset"]).slice(0, nButtons);
    if (opts.addButton) {
      const at = kinds.indexOf("inc");
      if (at >= 0) kinds.splice(at, 1);
      else kinds.pop();
      kinds.unshift("inc");
    }
    for (const kind of kinds) {
      const k = r.pick([1, 1, 2, 3, 5, 10]);
      if (kind === "inc") {
        const msg = b.message({ name: b.msgName(["bump", "raise", "add", "grow", "boost", "lift"], name), kind: "click", ops: [["add", name, k]] });
        const node = { el: "button", msg, text: [r.pick([`+${k}`, `Add ${k}`, `${k} more`, `Up ${k}`])] };
        if (!opts.addButton && r.chance(0.4)) node.disabled = [">=", F, ["k", max]];
        nodes.push(node);
      } else if (kind === "dec") {
        const msg = b.message({ name: b.msgName(["drop", "lower", "cut", "shrink", "ease"], name), kind: "click", ops: [["add", name, -k]] });
        const node = { el: "button", msg, text: [r.pick([`-${k}`, `Remove ${k}`, `${k} less`, `Down ${k}`])] };
        if (r.chance(0.4)) node.disabled = ["<=", F, ["k", min]];
        nodes.push(node);
      } else if (kind === "set") {
        const c = r.int(min, max);
        const msg = b.message({ name: b.msgName(["set"], name, "to", numName(c)), kind: "click", ops: [["set", name, c]] });
        nodes.push({ el: "button", msg, text: [r.pick([`Set to ${c}`, `Make it ${c}`, `= ${c}`])] });
      } else {
        const msg = b.message({ name: b.msgName(["reset", "restore", "zero"], name), kind: "click", ops: [["reset", name]] });
        nodes.push({ el: "button", msg, text: [r.pick(["Reset", "Restore", "Start over", "Undo all"])] });
      }
    }
    if (!opts.numberInput || r.chance(0.5)) nodes.splice(r.int(0, nodes.length), 0, intText(b, name, F));
    b.chunk(nodes, { required });
    return f;
  },

  bool(b, opts) {
    const r = b.r;
    const name = b.name(NAMES.bool);
    const f = b.field({ name, type: "bool", initial: r.chance(0.4) });
    const kind = opts.toggle ? r.pick(["check", "toggle"]) : r.weighted([["check", 45], ["toggle", 35], ["pair", 20]]);
    b.chunk(boolControl(b, name, kind, r.chance(0.5)), { required: !!opts.toggle });
    return f;
  },

  text(b, opts) {
    const r = b.r;
    const name = b.name(NAMES.text);
    const word = b.word(name);
    const f = b.field({ name, type: "text", initial: r.chance(0.25) ? r.pick(TEXT_SAMPLES) : "" });
    const msg = b.message({ name: b.msgName(["edit", "type", "write", "change", "enter"], name), kind: "input", field: name });
    const node = { el: "input", msg };
    if (r.chance(0.5)) node.label = b.label(name);
    if (r.chance(0.6)) node.placeholder = r.pick([`Your ${word}`, `Enter a ${word}`, `${cap(word)} here`, "Type here", "…"]);
    if (r.chance(0.45)) node.invalid = validation(r, name, word);
    const nodes = [node];
    if (r.chance(0.5)) {
      const T = ["f", name];
      nodes.push(r.pick([
        { el: "text", tag: "p", parts: [r.pick(["Hello, ", "Preview: ", "You typed ", `${cap(word)}: `]), T] },
        { el: "text", tag: "small", parts: [["len", T], r.pick([" characters", " chars", " letters typed"])] },
        { el: "text", tag: "output", parts: [T] },
      ]));
    }
    b.chunk(nodes, { required: !!opts.required });
    return f;
  },

  list(b, opts) {
    const r = b.r;
    const feed = !!opts.feed;
    const name = b.name(feed ? NAMES.feed : NAMES.list);
    const word = b.word(name);
    const checkable = !feed && r.chance(0.5);
    const n = opts.remove ? r.int(2, 4) : r.int(feed ? 1 : 0, 4);
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
    const listNode = { el: "list", field: name, tag: r.pick(["ul", "ul", "ol"]) };
    if (checkable && r.chance(0.85)) listNode.check = b.message({ name: b.msgName(["toggle", "check", "mark"], "in", name), kind: "item", field: name, op: "toggle" });
    if (feed || opts.remove || r.chance(0.75)) {
      listNode.remove = b.message({ name: b.msgName(feed ? ["dismiss", "hide", "clear"] : ["remove", "delete", "discard"], "from", name), kind: "item", field: name, op: "remove" });
      listNode.removeText = feed ? r.pick(["Dismiss", "Hide", "OK", "Got it"]) : r.pick(["Remove", "Delete", "×", "Drop"]);
    }
    let draftNodes = [];
    if (!feed) {
      // How items are added: from a draft text field, or a constant text.
      if (opts.pushFromDraft || r.chance(0.6)) {
        const draft = b.name(NAMES.draft);
        b.field({ name: draft, type: "text", initial: "", draftFor: name });
        const edit = b.message({ name: b.msgName(["edit", "type", "write"], draft), kind: "input", field: draft });
        const push = b.message({ name: b.msgName(["addTo", "appendTo", "saveTo", "pushTo"], name), kind: "click", ops: [["push", name, draft]] });
        const input = { el: "input", msg: edit, placeholder: r.pick(["What needs doing?", "New item", "Add an item", "Next step", "Write it down"]) };
        const button = { el: "button", msg: push, text: [r.pick(["Add", "Save", "Append", "Keep"])] };
        if (!opts.pushFromDraft && r.chance(0.3)) button.disabled = ["==", ["len", ["f", draft]], ["k", 0]];
        draftNodes = [input, button];
      } else {
        const text = r.pick(QUICK);
        const push = b.message({ name: b.msgName(["quickAdd", "stamp", "log"], name), kind: "click", ops: [["pushText", name, text]] });
        draftNodes = [{ el: "button", msg: push, text: [`+ ${text}`] }];
      }
      // Sometimes a list-wide button.
      if (r.chance(0.35)) {
        const kind = r.pick(checkable ? ["pop", "shift", "clear", "clearDone"] : ["pop", "shift", "clear"]);
        const verbs = { pop: ["dropLast"], shift: ["dropFirst"], clear: ["clear", "empty"], clearDone: ["clearDone", "purgeDone"] }[kind];
        const msg = b.message({ name: b.msgName(verbs, name), kind: "click", ops: [[kind, name]] });
        const node = { el: "button", msg, text: [{ pop: "Drop last", shift: "Drop first", clear: "Clear all", clearDone: "Clear done" }[kind]] };
        if (kind !== "clearDone" && r.chance(0.5)) node.disabled = ["==", ["count", L], ["k", 0]];
        draftNodes.push(node);
      }
    }
    nodes.push(...(r.chance(0.5) ? [...draftNodes, listNode] : [listNode, ...draftNodes]));
    if (r.chance(0.6)) {
      nodes.push(r.pick(checkable
        ? [{ el: "text", tag: "p", parts: [["left", L], " left"] }, { el: "text", tag: "p", parts: [["done", L], " of ", ["count", L], " done"] }]
        : [{ el: "text", tag: "p", parts: [["count", L], ` ${word}`] }, { el: "text", tag: "small", parts: ["Total: ", ["count", L]] }]));
    }
    b.chunk(nodes, { required: !!(opts.pushFromDraft || opts.feed) });
    if (r.chance(0.35)) {
      b.chunk([{ el: "when", tag: "div", cond: ["==", ["count", L], ["k", 0]], children: [{ el: "text", tag: "p", parts: [r.pick(["Nothing here yet", "All clear", "No news", "Empty for now", "Quiet for now"])] }] }]);
    }
    return f;
  },

  enum(b, opts) {
    const r = b.r;
    const name = b.name(NAMES.enum);
    const word = b.word(name);
    const set = r.pick(ENUM_SETS);
    const options = set.slice(0, r.int(3, set.length));
    const f = b.field({ name, type: "enum", options, initial: r.pick(options) });
    const F = ["f", name];
    const nodes = [];
    const select = r.chance(0.5);
    if (select) {
      const msg = b.message({ name: b.msgName(["pick", "choose", "select"], name), kind: "select", field: name });
      nodes.push({ el: "select", msg, ...(r.chance(0.6) ? { label: cap(word) } : {}) });
    } else {
      const msg = b.message({ name: b.msgName(["cycle", "next", "rotate"], name), kind: "click", ops: [["cycle", name]] });
      nodes.push({ el: "button", msg, text: r.chance(0.5) ? [r.pick(["Next", "Cycle", "Rotate", "Change"])] : [`${cap(word)}: `, F] });
    }
    if (!select || r.chance(0.6)) {
      nodes.push(r.pick([
        { el: "text", tag: "p", parts: [`${cap(word)}: `, F] },
        { el: "text", tag: "strong", parts: [F] },
        { el: "text", tag: "p", parts: [["if", ["==", F, ["k", options[0]]], ["k", "default"], ["k", "custom"]], ` ${word}`] },
      ]));
    }
    b.chunk(nodes, { required: !!opts.control });
    return f;
  },
};

function intText(b, name, F) {
  const word = b.word(name);
  return b.r.pick([
    { el: "text", tag: "output", parts: [F] },
    { el: "text", tag: "p", parts: [`${cap(word)}: `, F] },
    { el: "text", tag: "span", parts: [F, ` ${word}`] },
    { el: "text", tag: "strong", parts: [`${cap(word)} = `, F] },
  ]);
}

// A bool control: a checkbox, a toggle button, or an on/off pair of buttons.
function boolControl(b, name, kind, display) {
  const r = b.r;
  const F = ["f", name];
  const nodes = [];
  if (kind === "check") {
    const msg = b.message({ name: b.msgName(["check", "tick", "flag"], name), kind: "check", field: name });
    nodes.push({ el: "check", msg, label: b.label(name) });
  } else if (kind === "toggle") {
    const msg = b.message({ name: b.msgName(["toggle", "flip", "switch"], name), kind: "click", ops: [["toggle", name]] });
    const pair = r.pick([["Hide", "Show"], ["Unpin", "Pin"], ["Off", "On"], ["Pause", "Resume"], ["Unlock", "Lock"], ["Stop", "Start"]]);
    nodes.push({ el: "button", msg, text: r.chance(0.5) ? [r.pick(["Toggle", "Switch", "Flip"]) + ` ${b.word(name)}`] : [["if", F, ["k", pair[0]], ["k", pair[1]]]] });
  } else {
    const [on, off] = r.pick([["mark", "unmark"], ["enable", "disable"], ["show", "hide"], ["start", "stop"], ["set", "unset"]]);
    const mOn = b.message({ name: b.msgName([on], name), kind: "click", ops: [["set", name, true]] });
    const mOff = b.message({ name: b.msgName([off], name), kind: "click", ops: [["set", name, false]] });
    nodes.push({ el: "button", msg: mOn, text: [cap(on)], ...(r.chance(0.5) ? { disabled: F } : {}) });
    nodes.push({ el: "button", msg: mOff, text: [cap(off)], ...(r.chance(0.5) ? { disabled: ["not", F] } : {}) });
  }
  if (display) {
    const words = r.pick([["yes", "no"], ["on", "off"], ["Active", "Inactive"], ["set", "not set"], ["done", "pending"]]);
    nodes.push({ el: "text", tag: r.pick(["p", "span", "em"]), parts: [`${b.label(name)}: `, ["if", F, ["k", words[0]], ["k", words[1]]]] });
  }
  return nodes;
}

// A time-driven int: advanced by `tick` while its gate bool is on; the gate has a control.
function tickField(b) {
  const r = b.r;
  const name = b.name(NAMES.tick);
  const gate = b.name(NAMES.gate);
  const k = r.pick([1, 1, 2, 5]);
  const max = r.int(60, 600);
  b.field({ name, type: "int", min: 0, max, initial: r.int(0, 30), tick: k, tickWhen: gate });
  b.field({ name: gate, type: "bool", initial: false });
  const F = ["f", name];
  const nodes = [intText(b, name, F)];
  nodes.push(...boolControl(b, gate, r.pick(["check", "toggle", "pair"]), r.chance(0.3)));
  if (r.chance(0.5)) {
    const msg = b.message({ name: b.msgName(["reset", "restart", "zero"], name), kind: "click", ops: [["reset", name], ["reset", gate]] });
    nodes.push({ el: "button", msg, text: [r.pick(["Reset", "Clear", "Zero"])] });
  }
  b.chunk(nodes, { required: true });
}

function validation(r, name, word) {
  const T = ["f", name];
  const n = r.int(2, 5);
  return r.pick([
    { when: ["==", ["len", T], ["k", 0]], message: r.pick(["This field is required", "Please fill this in", `A ${word} is required`]) },
    { when: ["<", ["len", T], ["k", n]], message: r.pick([`Use at least ${n} characters`, `Too short: ${n} characters minimum`]) },
    { when: [">", ["len", T], ["k", n + 4]], message: r.pick([`At most ${n + 4} characters`, `Too long: keep it under ${n + 5}`]) },
    { when: ["not", ["has", T, "@"]], message: "Must contain an @" },
    { when: ["has", T, " "], message: r.pick(["No spaces allowed", "Spaces are not allowed"]) },
  ]);
}

// The forced dependent unit: a derived text over its own int and unit 6's number-input field,
// always shown, and a conditional section over unit 3's bool (its controls stay outside it).
function dependent(b, W, main) {
  const r = b.r;
  const number = W.units[6].main, flag = W.units[3].main;
  b.chunk([{ el: "text", tag: "p", parts: [r.pick(["Total: ", "Sum: ", "Together: "]), ["+", ["f", main.name], ["f", number.name]]] }], { required: true });
  b.chunk([{ el: "when", tag: r.pick(["div", "div", "aside"]), cond: r.chance(0.5) ? ["f", flag.name] : ["not", ["f", flag.name]],
    children: [{ el: "text", tag: "p", parts: [r.pick(SENTENCES)] }, intText(b, main.name, ["f", main.name])] }]);
}

// A message writing this unit's field and an earlier one.
function combined(b, main, candidates) {
  const r = b.r;
  if (!isPlain(main) || main.tick || candidates.length === 0) return;
  const other = r.pick(candidates);
  const opFor = (f) => {
    if (f.type === "int") return ["add", f.name, r.pick([1, 2, 5, -1, -3])];
    if (f.type === "bool") return r.chance(0.5) ? ["toggle", f.name] : ["set", f.name, r.chance(0.5)];
    if (f.type === "enum") return r.chance(0.6) ? ["cycle", f.name] : ["set", f.name, r.pick(f.options)];
    return r.chance(0.5) ? ["set", f.name, ""] : ["reset", f.name];
  };
  const msg = b.message({ name: b.msgName(["apply", "commit", "prime", "kick", "sync"], b.word(main.name), "and", b.word(other.name)), kind: "click", ops: [opFor(main), opFor(other)] });
  b.chunk([{ el: "button", msg, text: [r.pick(["Go", "Apply", "Do both", "Commit", "Run"])] }]);
}

// A condition over an earlier field, for a disabled state.
function crossDisabled(b, earlier) {
  const r = b.r;
  const buttons = b.chunks.flat().filter((it) => it.node.el === "button" && !it.required);
  const sources = earlier.filter((f) => f.type === "bool" || f.type === "enum" || (f.type === "int" && !f.tick));
  if (!buttons.length || !sources.length) return;
  const node = r.pick(buttons).node;
  const f = r.pick(sources);
  const F = ["f", f.name];
  const cond = f.type === "bool" ? (r.chance(0.5) ? F : ["not", F])
    : f.type === "enum" ? ["==", F, ["k", r.pick(f.options)]]
    : ["<", F, ["k", r.int(f.min, Math.min(f.max, f.min + 5))]];
  node.disabled = node.disabled ? ["or", node.disabled, cond] : cond;
}

// A validation of this unit's text that depends on an earlier field as well.
function crossValidation(b, main, earlier) {
  const r = b.r;
  const input = b.chunks.flat().find((it) => it.node.el === "input")?.node;
  const sources = earlier.filter((f) => f.type === "bool" || f.type === "enum" || (f.type === "int" && !f.tick));
  if (!input || !sources.length) return;
  const f = r.pick(sources);
  const T = ["f", main.name], F = ["f", f.name];
  const n = r.int(2, 4);
  if (f.type === "bool") input.invalid = { when: ["and", F, ["==", ["len", T], ["k", 0]]], message: `Required while ${b.word(f.name)} is on` };
  else if (f.type === "enum") {
    const o = r.pick(f.options);
    input.invalid = { when: ["and", ["==", F, ["k", o]], ["<", ["len", T], ["k", n]]], message: `${o} needs at least ${n} characters` };
  } else {
    const c = r.int(f.min, Math.min(f.max, f.min + 8));
    input.invalid = { when: ["and", [">", F, ["k", c]], ["==", ["len", T], ["k", 0]]], message: `Required when ${b.word(f.name)} is above ${c}` };
  }
}

// An expression for a field, as an int, a bool or a text.
function valueOf(r, f) {
  const F = ["f", f.name];
  switch (f.type) {
    case "int": return { type: "int", expr: F };
    case "bool": return { type: "bool", expr: F };
    case "enum": return { type: "text", expr: F, f };
    case "text": return r.chance(0.6) ? { type: "int", expr: ["len", F] } : { type: "text", expr: F };
    case "list": return { type: "int", expr: f.checkable && r.chance(0.5) ? [r.pick(["left", "done"]), F] : ["count", F] };
  }
}

// A derived text over this unit's field and (usually) one or two earlier ones: a sum or
// difference, a comparison, a conjunction, an equality test.
function derived(b, main, earlier) {
  const r = b.r;
  const x = valueOf(r, main);
  const others = earlier.map((f) => valueOf(r, f));
  const ints = others.filter((v) => v.type === "int"), bools = others.filter((v) => v.type === "bool");
  const choices = [];
  if (x.type === "int" && ints.length) {
    const y = r.pick(ints);
    choices.push(() => ({ el: "text", tag: "p", parts: [r.pick(["Total: ", "Sum: ", "Together: "]), ["+", x.expr, y.expr]] }));
    choices.push(() => ({ el: "text", tag: "p", parts: [r.pick(["Gap: ", "Difference: "]), ["-", x.expr, y.expr]] }));
    choices.push(() => ({ el: "text", tag: "em", parts: [["if", [r.pick([">", ">=", "<"]), x.expr, y.expr], ["k", r.pick(["ahead", "more", "over"])], ["k", r.pick(["behind", "fewer", "under"])]]] }));
    if (ints.length >= 2) {
      const [y1, y2] = r.sample(ints, 2);
      choices.push(() => ({ el: "text", tag: "strong", parts: [r.pick(["Overall: ", "Grand total: ", "Combined: "]), ["+", ["+", x.expr, y1.expr], y2.expr]] }));
    }
  }
  if (x.type === "int") {
    const c = r.int(1, 12);
    choices.push(() => ({ el: "text", tag: "small", parts: [["if", [r.pick([">", ">=", "<", "=="]), x.expr, ["k", c]], ["k", r.pick(["High", "Plenty", "Many"])], ["k", r.pick(["Low", "Few", "Some"])]]] }));
  }
  if (x.type === "bool" && bools.length) {
    const y = r.pick(bools);
    choices.push(() => ({ el: "text", tag: "p", parts: [["if", [r.pick(["and", "or"]), x.expr, y.expr], ["k", "All set"], ["k", "Not yet"]]] }));
  }
  if (x.type === "bool" && ints.length) {
    const y = r.pick(ints);
    choices.push(() => ({ el: "text", tag: "p", parts: [["if", ["and", x.expr, [">", y.expr, ["k", 0]]], ["k", "Go"], ["k", "Wait"]]] }));
  }
  if (x.type === "int" && bools.length) {
    const y = r.pick(bools);
    choices.push(() => ({ el: "text", tag: "p", parts: [["if", ["and", y.expr, [">", x.expr, ["k", 0]]], ["k", "Ready"], ["k", "Hold"]]] }));
  }
  if (x.f) {
    const o = r.pick(x.f.options);
    choices.push(() => ({ el: "text", tag: "span", parts: [["if", ["!=", x.expr, ["k", o]], ["k", "changed"], ["k", "as planned"]]] }));
    if (bools.length) {
      const y = r.pick(bools);
      choices.push(() => ({ el: "text", tag: "p", parts: [["if", ["or", y.expr, ["==", x.expr, ["k", o]]], ["k", "Covered"], ["k", "Open"]]] }));
    }
  }
  if (choices.length === 0) return;
  b.chunk([r.pick(choices)()]);
}

// A conditional section over an earlier field (sometimes two), wrapping a contiguous run of the
// unit's items that do not write the fields the condition reads, plus sometimes a sentence.
function unitWhen(b, items, earlier) {
  const r = b.r;
  const sources = earlier.filter((f) => !f.draftFor);
  if (!sources.length) return items;
  const f = r.pick(sources);
  let cond = condFor(r, f);
  const reads = new Set([f.name]);
  if (sources.length > 1 && r.chance(0.2)) {
    const g = r.pick(sources.filter((x) => x !== f));
    cond = [r.pick(["and", "or"]), cond, condFor(r, g)];
    reads.add(g.name);
  }
  const ok = (it) => !it.required && ![...it.writes].some((w) => reads.has(w));
  const starts = items.map((_, i) => i).filter((i) => ok(items[i]));
  if (!starts.length) return items;
  const start = r.pick(starts);
  const max = r.int(1, 3);
  let len = 0;
  while (len < max && start + len < items.length && ok(items[start + len])) len++;
  const children = items.slice(start, start + len).map((it) => it.node);
  if (r.chance(0.3)) children.push({ el: "text", tag: "p", parts: [r.pick(SENTENCES)] });
  const node = { el: "when", tag: r.pick(["div", "div", "div", "aside"]), cond, children };
  const writes = new Set(items.slice(start, start + len).flatMap((it) => [...it.writes]));
  return [...items.slice(0, start), { node, writes, required: false }, ...items.slice(start + len)];
}

function condFor(r, f) {
  const F = ["f", f.name];
  switch (f.type) {
    case "bool": return r.chance(0.7) ? F : ["not", F];
    case "int": {
      const c = r.int(f.min, Math.max(f.min, Math.min(f.max - 1, f.min + 10)));
      return [r.pick([">", ">=", "<=", "<"]), F, ["k", c]];
    }
    case "enum": return [r.pick(["==", "!="]), F, ["k", r.pick(f.options)]];
    case "list": return r.chance(0.7) ? [">", ["count", F], ["k", 0]] : [">=", ["count", F], ["k", 2]];
    case "text": return r.chance(0.7) ? [">=", ["len", F], ["k", r.int(1, 4)]] : ["has", F, r.pick(["@", "a", " "])];
  }
}

// The companion: a small widget, the same at every size (from N = 7 on, when the fields it
// reads exist), with two fields of its own and texts reading three early fields of w1.
function buildCompanion(r, W, big) {
  const token = token4(r);
  const label = `${r.pick(["Review", "Summary", "Overview", "Status"])} ${token}`;
  const fields = [{ name: "pinned", type: "bool", initial: false }, { name: "reviewer", type: "text", initial: "" }];
  const messages = [
    { name: "checkPinned", kind: "check", field: "pinned" },
    { name: "editReviewer", kind: "input", field: "reviewer" },
  ];
  const view = [
    { el: "check", msg: "checkPinned", label: "Pinned" },
    { el: "input", msg: "editReviewer", label: "Reviewer", invalid: { when: ["==", ["len", ["f", "reviewer"]], ["k", 0]], message: "Name a reviewer" } },
  ];
  const reads = [0, 3, 6].filter((i) => i < W.units.length).map((i) => W.units[i].main);
  for (const f of reads) {
    const E = ["w", big.id, f.name];
    view.push({ el: "text", tag: "p", parts: [`${cap(W.words.get(f.name))}: `, f.type === "bool" ? ["if", E, ["k", "yes"], ["k", "no"]] : E] });
  }
  const ints = reads.filter((f) => f.type === "int");
  if (ints.length >= 2) view.push({ el: "text", tag: "strong", parts: ["Combined: ", ["+", ["w", big.id, ints[0].name], ["w", big.id, ints[1].name]]] });
  view.push({ el: "when", tag: "aside", cond: ["f", "pinned"], children: [{ el: "text", tag: "small", parts: [`Pinned for review ${token}`] }] });
  return { id: "w2", kind: "companion", token, label, fields, messages, view };
}

// ---------------------------------------------------------------------------------------------
// The reference: expressions, update and render, as generic interpreters over the widget
// descriptions. Pure and deterministic. (The same as unique-components'.)

export function byId(spec, id) {
  return spec.widgets.find((w) => w.id === id);
}

export function fieldOf(w, name) {
  return w.fields.find((f) => f.name === name);
}

export function messageOf(w, name) {
  return w.messages.find((m) => m.name === name);
}

// Evaluate an expression against a widget's state `s` and the whole state (for cross reads).
export function evaluate(e, s, state) {
  switch (e[0]) {
    case "f": return s[e[1]];
    case "w": return state.widgets[e[1]][e[2]];
    case "k": return e[1];
    case "+": return evaluate(e[1], s, state) + evaluate(e[2], s, state);
    case "-": return evaluate(e[1], s, state) - evaluate(e[2], s, state);
    case "count": return evaluate(e[1], s, state).length;
    case "done": return evaluate(e[1], s, state).filter((it) => it.done).length;
    case "left": return evaluate(e[1], s, state).filter((it) => !it.done).length;
    case "len": return evaluate(e[1], s, state).length;
    case "has": return evaluate(e[1], s, state).includes(e[2]);
    case "==": return evaluate(e[1], s, state) === evaluate(e[2], s, state);
    case "!=": return evaluate(e[1], s, state) !== evaluate(e[2], s, state);
    case "<": return evaluate(e[1], s, state) < evaluate(e[2], s, state);
    case "<=": return evaluate(e[1], s, state) <= evaluate(e[2], s, state);
    case ">": return evaluate(e[1], s, state) > evaluate(e[2], s, state);
    case ">=": return evaluate(e[1], s, state) >= evaluate(e[2], s, state);
    case "and": return evaluate(e[1], s, state) && evaluate(e[2], s, state);
    case "or": return evaluate(e[1], s, state) || evaluate(e[2], s, state);
    case "not": return !evaluate(e[1], s, state);
    case "if": return evaluate(e[1], s, state) ? evaluate(e[2], s, state) : evaluate(e[3], s, state);
  }
  throw new Error(`unknown expression ${JSON.stringify(e)}`);
}

const nextId = (items) => items.reduce((m, it) => Math.max(m, it.id), 0) + 1;
const clamp = (v, f) => Math.max(f.min, Math.min(f.max, v));

// Apply one op to a widget state, returning a new state.
function applyOp(w, s, op) {
  const [kind, name] = op;
  const f = fieldOf(w, name);
  const set = (v) => ({ ...s, [name]: v });
  switch (kind) {
    case "add": return set(clamp(s[name] + op[2], f));
    case "set": return set(op[2]);
    case "toggle": return set(!s[name]);
    case "reset": return set(f.initial);
    case "cycle": return set(f.options[(f.options.indexOf(s[name]) + 1) % f.options.length]);
    case "push": {
      const text = s[op[2]].trim();
      if (text === "") return s;
      const item = f.checkable ? { id: nextId(s[name]), text, done: false } : { id: nextId(s[name]), text };
      return { ...s, [name]: [...s[name], item], [op[2]]: "" };
    }
    case "pushText": {
      const item = f.checkable ? { id: nextId(s[name]), text: op[2], done: false } : { id: nextId(s[name]), text: op[2] };
      return set([...s[name], item]);
    }
    case "pop": return s[name].length ? set(s[name].slice(0, -1)) : s;
    case "shift": return s[name].length ? set(s[name].slice(1)) : s;
    case "clear": return s[name].length ? set([]) : s;
    case "clearDone": return s[name].some((it) => it.done) ? set(s[name].filter((it) => !it.done)) : s;
  }
  throw new Error(`unknown op ${kind}`);
}

export function update(spec, state, msg) {
  switch (msg.type) {
    case "serverSet":
      return setWidget(state, msg.widget, msg.state);
    case "tick": {
      let next = state;
      for (const w of spec.widgets) {
        for (const f of w.fields) {
          if (!f.tick) continue;
          const s = next.widgets[w.id];
          if (!s[f.tickWhen]) continue;
          const v = Math.min(f.max, s[f.name] + f.tick);
          if (v !== s[f.name]) next = setWidget(next, w.id, { ...s, [f.name]: v });
        }
      }
      return next;
    }
    case "notify": {
      const s = state.widgets[msg.widget];
      return setWidget(state, msg.widget, { ...s, [msg.field]: [...s[msg.field], msg.item] });
    }
    case "snapshot":
      return msg.state;
  }
  const w = byId(spec, msg.widget);
  const m = w && messageOf(w, msg.type);
  if (!m) throw new Error(`widget ${msg.widget} has no message ${msg.type}`);
  const s = state.widgets[w.id];
  let next;
  switch (m.kind) {
    case "click": next = m.ops.reduce((acc, op) => applyOp(w, acc, op), s); break;
    case "input": next = { ...s, [m.field]: msg.value }; break;
    case "check": next = { ...s, [m.field]: !s[m.field] }; break;
    case "select": next = { ...s, [m.field]: msg.value }; break;
    case "item": {
      const items = s[m.field];
      next = { ...s, [m.field]: m.op === "remove" ? items.filter((it) => it.id !== msg.id) : items.map((it) => (it.id === msg.id ? { ...it, done: !it.done } : it)) };
      break;
    }
    default: throw new Error(`unknown message kind ${m.kind}`);
  }
  return next === s ? state : setWidget(state, w.id, next);
}

function setWidget(state, id, s) {
  return { ...state, widgets: { ...state.widgets, [id]: s } };
}

// The reference render. Returns a tree of { tag, attrs, props, children } and strings.
// `attrs` are HTML attributes; `props` are live DOM properties (input value, checked, select
// value) that have no attribute in the page.

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
  return h("div", { "data-role": "page" }, spec.widgets.map((w) => renderWidget(spec, w, state)));
}

export function renderWidget(spec, w, state) {
  const s = state.widgets[w.id];
  const ctx = { w, s, state };
  return h("section", { "data-key": w.id, "data-role": "widget" }, h("h2", null, w.label), w.view.map((n) => renderNode(n, ctx)));
}

const textOf = (parts, ctx) => parts.map((p) => (typeof p === "string" ? p : String(evaluate(p, ctx.s, ctx.state)))).join("");

function renderNode(n, ctx) {
  const { w, s } = ctx;
  switch (n.el) {
    case "text":
      return h(n.tag, null, textOf(n.parts, ctx));
    case "button":
      return h("button", { "data-role": n.msg, disabled: n.disabled ? !!evaluate(n.disabled, s, ctx.state) : false }, textOf(n.text, ctx));
    case "input": {
      const m = messageOf(w, n.msg);
      const f = fieldOf(w, m.field);
      const input = f.type === "int"
        ? h("input", { type: "number", "data-role": n.msg, value: String(s[f.name]) })
        : h("input", { type: "text", "data-role": n.msg, placeholder: n.placeholder, value: s[f.name] });
      const error = n.invalid && evaluate(n.invalid.when, s, ctx.state) ? h("p", { "data-role": `${n.msg}Error` }, n.invalid.message) : null;
      return [n.label ? h("label", null, n.label, input) : input, error];
    }
    case "check": {
      const m = messageOf(w, n.msg);
      return h("label", null, h("input", { type: "checkbox", "data-role": n.msg, checked: s[m.field] }), n.label);
    }
    case "select": {
      const m = messageOf(w, n.msg);
      const f = fieldOf(w, m.field);
      const select = h("select", { "data-role": n.msg, value: s[f.name] }, f.options.map((o) => h("option", { value: o }, o)));
      return n.label ? h("label", null, n.label, select) : select;
    }
    case "list":
      return h(n.tag, null, s[n.field].map((it) =>
        h("li", { "data-key": it.id, "data-role": `${n.field}Item` },
          n.check ? h("input", { type: "checkbox", "data-role": n.check, checked: it.done }) : null,
          h("span", null, it.text),
          n.remove ? h("button", { "data-role": n.remove }, n.removeText) : null)));
    case "when":
      return evaluate(n.cond, s, ctx.state) ? h(n.tag, null, n.children.map((c) => renderNode(c, ctx))) : null;
    case "group":
      return h(n.tag, null, n.children.map((c) => renderNode(c, ctx)));
  }
  throw new Error(`unknown view node ${n.el}`);
}

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (s) => s.replace(/[&<>"]/g, (c) => ESC[c]);

// Serialize a reference tree as HTML (props shown as attributes, for reading).
export function toHTML(node) {
  if (typeof node === "string") return esc(node);
  const attrs = { ...node.attrs };
  if ("value" in node.props) attrs.value = String(node.props.value);
  if (node.props.checked) attrs.checked = "";
  const open = `<${node.tag}${Object.entries(attrs).map(([k, v]) => (v === "" ? ` ${k}` : ` ${k}="${esc(v)}"`)).join("")}>`;
  if (node.tag === "input") return open;
  // A select shows its value through the selected option.
  if (node.tag === "select" && "value" in node.props) {
    return open + node.children.map((c) => (typeof c !== "string" && c.attrs.value === node.props.value ? toHTML({ ...c, attrs: { ...c.attrs, selected: "" } }) : toHTML(c))).join("") + `</${node.tag}>`;
  }
  return open + node.children.map(toHTML).join("") + `</${node.tag}>`;
}

// Where a widget's controls sit: message name → { inWhen, node } for every control in its view
// (item controls under their list). Used by the script and the work actions to pick controls
// that are always rendered.
export function controls(w) {
  const out = new Map();
  const visit = (n, inWhen) => {
    for (const k of ["msg", "check", "remove"]) if (n[k]) out.set(n[k], { inWhen, node: n });
    for (const c of n.children || []) visit(c, inWhen || n.el === "when");
  };
  for (const n of w.view) visit(n, false);
  return out;
}

// The field units of a widget, in order: each main field with its auxiliary fields (the draft
// of a list fed from a draft, the gate of a time-driven int). [{ main, names }]
export function units(w) {
  const auxOf = new Map();
  for (const m of w.messages) if (m.kind === "click") for (const op of m.ops) if (op[0] === "push") auxOf.set(op[2], op[1]);
  for (const f of w.fields) if (f.tickWhen) auxOf.set(f.tickWhen, f.name);
  const out = [];
  const byMain = new Map();
  for (const f of w.fields) {
    const main = auxOf.get(f.name) ?? f.name;
    if (!byMain.has(main)) {
      byMain.set(main, []);
      out.push({ main, names: byMain.get(main) });
    }
    byMain.get(main).push(f.name);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// External events. Each builder is a pure function of the spec, the current reference state
// and a salt, so the serve panel can produce fresh events and the script stays deterministic.

export function serverState(spec, state, id, salt) {
  const r = rng("server", spec.options.seed, id, salt);
  return freshState(byId(spec, id), state.widgets[id], r, false);
}

export function feedField(w) {
  return w.fields.find((f) => f.feed);
}

export function notifyEntry(spec, state, id, salt) {
  const r = rng("notify", spec.options.seed, id, salt);
  const f = feedField(byId(spec, id));
  return { id: nextId(state.widgets[id][f.name]), text: r.pick(NEWS) };
}

export function notifyMsg(spec, state, id, salt) {
  return { type: "notify", widget: id, field: feedField(byId(spec, id)).name, item: notifyEntry(spec, state, id, salt) };
}

export function snapshot(spec, state, salt) {
  const r = rng("snapshot", spec.options.seed, salt);
  const widgets = {};
  for (const w of spec.widgets) widgets[w.id] = freshState(w, state.widgets[w.id], r, true);
  return { widgets };
}

// The external events the serve panel offers.
export function panelEvents(spec) {
  const ids = (pred) => spec.widgets.filter(pred).map((w) => w.id);
  return [
    { name: "serverSet", targets: ids(() => true),
      make: (state, target, salt) => ({ type: "serverSet", widget: target, state: serverState(spec, state, target, salt) }) },
    { name: "tick", make: () => ({ type: "tick" }) },
    { name: "notify", targets: ids((w) => !!feedField(w)),
      make: (state, target, salt) => notifyMsg(spec, state, target, salt) },
    { name: "snapshot", make: (state, _target, salt) => ({ type: "snapshot", state: snapshot(spec, state, salt) }) },
  ];
}

// Reverse a slice of at least two items, so some keep their place and some move.
function partlyReorder(list, r) {
  if (list.length < 2) return list.slice();
  const a = r.int(0, list.length - 2);
  const b = r.int(a + 1, list.length - 1);
  return [...list.slice(0, a), ...list.slice(a, b + 1).reverse(), ...list.slice(b + 1)];
}

// A new state for one widget, as a server would send it: every field changes except bools,
// which flip at random (at least one field always changes). With `reorder`, keyed lists keep
// their items (ids) but are partly reordered; otherwise one item is dropped. Either way a new
// item is appended, with an id above every id the list had.
function freshState(w, s, r, reorder) {
  const out = {};
  let changed = false;
  for (const f of w.fields) {
    const v = s[f.name];
    let nv;
    switch (f.type) {
      case "int": nv = r.int(f.min, f.max); if (nv === v) nv = v === f.max ? f.min : v + 1; break;
      case "bool": nv = r.chance(0.5) ? !v : v; break;
      case "text": nv = r.pick(SERVER_TEXTS); if (nv === v) nv = v + "1"; break;
      case "enum": nv = r.pick(f.options.filter((o) => o !== v)); break;
      case "list": {
        const max = nextId(v);
        let items = v.map((it) => (f.checkable && r.chance(0.3) ? { ...it, done: !it.done } : it));
        if (reorder) items = partlyReorder(items, r);
        else if (items.length > 2) { const drop = r.int(0, items.length - 1); items = items.filter((_, i) => i !== drop); }
        const text = f.feed ? r.pick(NEWS) : `${r.pick(ITEM_VERBS)} ${r.pick(ITEM_OBJECTS)}`;
        nv = [...items, f.checkable ? { id: max, text, done: false } : { id: max, text }];
        break;
      }
    }
    if (nv !== v) changed = true;
    out[f.name] = nv;
  }
  if (!changed) out[w.fields[0].name] = !out[w.fields[0].name];
  return out;
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
// A target is a CSS selector built from the stable data-key/data-role attributes. `msg` is the
// reference message the step stands for. A step is only generated when its target is rendered
// (and, for a button, enabled) in the reference at that moment.

// The units the script exercises: all of them up to 32, else the first 12 and 20 others.
export const SCRIPT_ALL = 32;

export function scriptUnits(spec) {
  const all = units(spec.widgets[0]);
  if (all.length <= SCRIPT_ALL) return all;
  const rest = rng("sample", spec.options.seed).sample(all.slice(12), 20);
  return all.filter((u, i) => i < 12 || rest.includes(u));
}

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
  const [big, companion] = spec.widgets;
  const seed = spec.options.seed;
  ctx.push({ do: "mount", label: "mount" });

  // 2. A sample of the component's units, then the companion.
  const sample = scriptUnits(spec);
  exercise(ctx, big, sample, "first");
  exercise(ctx, companion, units(companion), "first");

  // 3. External events.
  ctx.push({ do: "dispatch", label: `serverSet ${companion.id}`, msg: { type: "serverSet", widget: companion.id, state: serverState(spec, state, companion.id, "script") } });
  ctx.push({ do: "dispatch", label: `serverSet ${big.id} (the whole component)`, msg: { type: "serverSet", widget: big.id, state: serverState(spec, state, big.id, "script") } });
  // Start up to two stopped time-driven fields, so the ticks advance something.
  let started = 0;
  for (const f of big.fields) {
    if (!f.tick || started >= 2) continue;
    if (state.widgets[big.id][f.tickWhen] || turnOn(ctx, big, f.tickWhen)) started++;
  }
  for (let i = 0; i < 3; i++) ctx.push({ do: "dispatch", label: "tick", msg: { type: "tick" } });
  if (feedField(big)) {
    for (let i = 0; i < 2; i++) ctx.push({ do: "dispatch", label: `notify ${big.id}`, msg: notifyMsg(spec, state, big.id, `script-${i}`) });
  }

  // 4. A reorder through a snapshot.
  ctx.push({ do: "dispatch", label: "snapshot", msg: { type: "snapshot", state: snapshot(spec, state, "script") } });

  // 5. A final round: every sampled unit with a list, three other sampled units, the companion.
  const isList = (u) => fieldOf(big, u.main).type === "list";
  const others = rng("final", seed).sample(sample.filter((u) => !isList(u)), 3);
  exercise(ctx, big, sample.filter((u) => isList(u) || others.includes(u)), "final");
  exercise(ctx, companion, units(companion), "final");

  ctx.push({ do: "dispose", label: "dispose" });
  return steps;
}

// The selector of [data-role=role] inside a widget's section, optionally inside a keyed list
// item (`item`).
export function target(widget, role, item) {
  return `[data-key="${widget}"] ${item != null ? `[data-key="${item}"] ` : ""}[data-role="${role}"]`;
}

// Find the rendered element with data-role `role` in a widget's reference tree (inside the list
// item with data-key `item` if given).
export function findRole(tree, role, item) {
  let found = null;
  const visit = (n, inItem) => {
    if (found || typeof n === "string") return;
    const here = inItem || (item != null && n.attrs["data-key"] === String(item) && n.tag === "li");
    if (n.attrs["data-role"] === role && (item == null || here)) { found = n; return; }
    for (const c of n.children) visit(c, here);
  };
  visit(tree, false);
  return found;
}

// The order messages are exercised in: inputs first (so a draft is typed before its push
// button is clicked), then selects and checkboxes, then buttons, then item controls.
const KIND_ORDER = { input: 0, select: 1, check: 2, click: 3, item: 4 };

// Exercise the messages writing the given units' fields, unit by unit; a second pass retries
// the controls a conditional section hid. In the final round, a unit with a list gets every
// message touching it, another unit one of its messages.
function exercise(ctx, w, list, round) {
  const seen = new Set();
  const pending = [];
  for (const u of list) {
    const r = rng(round === "first" ? "script" : "final", ctx.spec.options.seed, w.id, u.main);
    let msgs = w.messages.filter((m) => !seen.has(m.name) && messageWrites(m).some((f) => u.names.includes(f)))
      .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
    if (round === "final" && fieldOf(w, u.main).type !== "list") msgs = r.sample(msgs, 1);
    for (const m of msgs) {
      seen.add(m.name);
      if (!act(ctx, w, m, r, round)) pending.push([m, r]);
    }
  }
  for (const [m, r] of pending) act(ctx, w, m, r, round);
}

const tree = (ctx, w) => renderWidget(ctx.spec, w, ctx.state);

// Perform one message's control (1-2 times). Returns false if its control is not available.
function act(ctx, w, m, r, round) {
  const s = () => ctx.state.widgets[w.id];
  const here = (role, item) => findRole(tree(ctx, w), role, item);
  switch (m.kind) {
    case "click": {
      const times = round === "first" ? r.int(1, 2) : 1;
      let done = 0;
      for (let k = 0; k < times; k++) {
        const b = here(m.name);
        if (!b || "disabled" in b.attrs) break;
        ctx.push({ do: "click", label: `${w.id} ${m.name}`, target: target(w.id, m.name), msg: { widget: w.id, type: m.name } });
        done++;
      }
      return done > 0;
    }
    case "check": {
      if (!here(m.name)) return false;
      const times = round === "first" ? r.int(1, 2) : 1;
      for (let k = 0; k < times && here(m.name); k++) ctx.push({ do: "click", label: `${w.id} ${m.name}`, target: target(w.id, m.name), msg: { widget: w.id, type: m.name } });
      return true;
    }
    case "select": {
      if (!here(m.name)) return false;
      const f = fieldOf(w, m.field);
      const value = r.pick(f.options.filter((o) => o !== s()[f.name]));
      ctx.push({ do: "select", label: `${w.id} ${m.name} ${value}`, target: target(w.id, m.name), value, msg: { widget: w.id, type: m.name, value } });
      return true;
    }
    case "input": {
      if (!here(m.name)) return false;
      const f = fieldOf(w, m.field);
      const sel = target(w.id, m.name);
      if (f.type === "int") {
        typeNumber(ctx, w, m, f, sel, r, round);
      } else {
        const from = s()[f.name];
        let to = round === "first" ? r.pick(TEXT_SAMPLES) : from + r.pick(["!", "s", " 2", "a"]);
        if (to === from) to = from + "z";
        typeInto(ctx, w, sel, from, to, (value) => ({ widget: w.id, type: m.name, value }));
      }
      return true;
    }
    case "item": {
      const items = s()[m.field];
      if (items.length === 0) return false;
      const it = r.pick(items);
      if (!here(m.name, it.id)) return false;
      ctx.push({ do: "click", label: `${w.id} ${m.name} ${it.id}`, target: target(w.id, m.name, it.id), msg: { widget: w.id, type: m.name, id: it.id } });
      return true;
    }
  }
  throw new Error(`unknown message kind ${m.kind}`);
}

// Turn a bool on through one of the widget's controls (a checkbox, a toggle, a "set true"
// button). Returns whether it could.
function turnOn(ctx, w, name) {
  for (const m of w.messages) {
    const ok = (m.kind === "check" && m.field === name) ||
      (m.kind === "click" && m.ops.length === 1 && m.ops[0][1] === name && (m.ops[0][0] === "toggle" || (m.ops[0][0] === "set" && m.ops[0][2] === true)));
    if (!ok) continue;
    const el = findRole(tree(ctx, w), m.name);
    if (!el || "disabled" in el.attrs) continue;
    ctx.push({ do: "click", label: `${w.id} ${m.name}`, target: target(w.id, m.name), msg: { widget: w.id, type: m.name } });
    return true;
  }
  return false;
}

// Type `to` character by character, starting from the current value `from`: if `to` does not
// extend `from`, the input is first cleared (one input event), like selecting all and typing.
function typeInto(ctx, w, sel, from, to, makeMsg) {
  let current = from;
  if (!to.startsWith(from)) {
    current = "";
    if (from !== "") ctx.push({ do: "type", label: `${w.id} clear the input`, target: sel, value: "", msg: makeMsg("") });
  }
  for (let i = current.length; i < to.length; i++) {
    const value = to.slice(0, i + 1);
    ctx.push({ do: "type", label: `${w.id} type "${value}"`, target: sel, value, msg: makeMsg(value) });
  }
}

// In the first round, a number input first gets two invalid values, which must send no message
// and keep the typed text (`exemptValue`: the input's displayed value is not compared on those
// steps): one above the field's max, and one that is not an integer. Then valid in-range
// integers: a digit is appended while the result stays in range; otherwise the content is
// replaced by a single digit (in range: number-input fields have min <= 0 and max >= 20).
function typeNumber(ctx, w, m, f, sel, r, round) {
  if (round === "first") {
    for (const value of [String(f.max + 1), "1.5"]) {
      ctx.push({ do: "type", label: `${w.id} type "${value}" (invalid: no message)`, target: sel, value, exemptValue: true });
    }
  }
  const n = round === "first" ? 2 : 1;
  for (let k = 0; k < n; k++) {
    const cur = String(ctx.state.widgets[w.id][f.name]);
    const d = String(r.int(1, 9));
    let value = cur + d;
    if (cur === "0" || cur.startsWith("-") || Number(value) > f.max) value = d;
    if (Number(value) === Number(cur)) value = String((Number(d) % 9) + 1);
    ctx.push({ do: "type", label: `${w.id} type "${value}"`, target: sel, value, msg: { widget: w.id, type: m.name, value: Number(value) } });
  }
}
