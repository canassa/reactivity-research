// The unique-components scenario generator and its reference: a dashboard of widgets where no two
// widgets share a structure. Every widget is composed from primitives (typed state fields,
// messages made of ops, a view tree of controls, texts, conditional sections and keyed lists),
// so every widget is its own component, used once.
//
// This module is the single source of truth for the scenario (see README.md). It runs both in
// Node (the CLI generates specs with it) and in the browser (the serve panel uses the reference
// `update` and `render` and the external-event builders), so it imports nothing.
//
// `generate(options)` returns a plain-data app spec: the widget descriptions, the initial state
// and the interaction script. The reference `update` and `render` are generic interpreters over
// the widget descriptions; implementations must not be (README, "Each widget is its own code").

export const scenario = "unique-components";

// No steadyFrom: there are no kinds to saturate, so every size adds new components.
// The size ./rr check builds by default (and the locality check's smaller size). The first 8
// widgets always carry the capabilities the work actions need (see FORCED); 16 adds variety.
export const quickCheckSize = 16;

// The scenario's own parameters (beyond --size and --seed), with their defaults.
export const params = {
  readerEvery: { default: 8, help: "every k-th widget is a reader of earlier widgets (0: none)" },
  lists: { default: "all", help: "all: keyed lists as drawn; none: no keyed list anywhere (w3 is a text input, w5 a bare enum control)" },
};

const LISTS = ["all", "none"];

export function normalizeOptions(raw = {}) {
  const size = int(raw.size ?? 16, "size");
  const seed = int(raw.seed ?? 1, "seed");
  if (size < 1) throw new Error("--size must be at least 1");
  const readerEvery = int(raw.readerEvery ?? 8, "reader-every");
  if (readerEvery < 0 || readerEvery === 1) throw new Error("--reader-every must be 0 or at least 2");
  const lists = String(raw.lists ?? "all");
  if (!LISTS.includes(lists)) throw new Error(`--lists must be one of ${LISTS.join(", ")}`);
  return { size, seed, readerEvery, lists };
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
// Word pools. Field names are single lowercase English words that are valid identifiers in
// every target language (no JS strict-mode or Elm keywords).

const ADJECTIVES = [
  "Daily", "Weekly", "Night", "Morning", "Team", "Office", "Garden", "Kitchen", "Studio",
  "Warehouse", "Lab", "Fleet", "Library", "Field", "Sales", "Support", "Billing", "Design",
  "Travel", "Event", "Harbor", "Clinic", "Campus", "Workshop", "Store", "Project", "Sprint",
  "Regional", "Personal", "Family", "Club", "Market", "Trail", "Bakery", "Gallery", "Depot",
];
const TOPICS = ["board", "desk", "tracker", "panel", "corner", "planner", "station", "console",
  "hub", "notebook", "ledger", "monitor", "pad", "kit", "bench", "dock", "chart", "room", "log", "deck"];
const CAPTIONS = ["Ref", "Board", "Unit", "Code", "Card", "Slot", "Tag", "Desk", "Batch", "File"];

const NAMES = {
  int: ["visits", "orders", "tickets", "cups", "boxes", "laps", "pages", "calls", "seats", "score",
    "level", "volume", "speed", "retries", "guests", "points", "rounds", "floors", "miles", "crates",
    "pins", "votes", "bids", "stamps", "coins", "plates", "beds", "lanes", "hours", "degrees",
    "bottles", "sheets", "rides", "loaves", "bricks"],
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

// ---------------------------------------------------------------------------------------------
// The capabilities the first widgets always have, so the work actions (harness/work/) find the
// same targets at every size. Each is added on top of the widget's random composition.

export const FORCED = [
  "addButton",   // w1: an int field with an unconditional "add k" button
  "textInput",   // w2: a text field with an input
  "listPush",    // w3: a list fed from a draft text field (input + push button), with item remove
  "boolToggle",  // w4: a bool field with a toggle control (checkbox or toggle button)
  "enumFeed",    // w5: an enum field with a select or cycle button, and a feed list
  "numberInput", // w6: an int field with a number input
  "tick",        // w7: a time-driven int with its gate bool and a control for the gate
  "reader",      // w8: a reader whose first cross-widget read is w6's number-input field
];

// ---------------------------------------------------------------------------------------------
// Generation

export function generate(rawOptions) {
  const options = normalizeOptions(rawOptions);
  const { size, seed, readerEvery, lists } = options;
  const widgets = [];
  const sigs = new Set();
  const tokens = new Set();
  for (let i = 0; i < size; i++) {
    const reader = readerEvery > 0 && (i + 1) % readerEvery === 0;
    const forced = readerEvery === 8 || FORCED[i] !== "reader" ? FORCED[i] : undefined;
    for (let attempt = 0; ; attempt++) {
      if (attempt > 200) throw new Error(`could not generate a unique widget at position ${i + 1}`);
      const r = rng("widget", seed, i, attempt);
      const w = buildWidget(r, i, widgets, { reader: reader || forced === "reader", forced, lists });
      const sig = signature(w);
      if (sigs.has(sig) || tokens.has(w.token)) continue;
      sigs.add(sig);
      tokens.add(w.token);
      widgets.push(w);
      break;
    }
  }
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

// The widget builder. Fields are generated one by one; each contributes messages and view
// nodes (a "chunk"). Then come combined messages, derived texts, cross-widget reads, the token
// caption, conditional sections and nesting.
function buildWidget(r, i, earlier, { reader, forced, lists }) {
  const id = `w${i + 1}`;
  const token = Array.from({ length: 4 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[r.int(0, 35)]).join("");
  const label = `${r.pick(ADJECTIVES)} ${r.pick(TOPICS)} ${token}`;
  const b = makeBuilder(r);

  // The field types: forced ones first, then random ones up to 1-5 fields in all. With
  // `--lists none` the two forced list widgets keep their other capability (w3 a text input, w5
  // the enum control) and the random draw skips lists; the draws themselves are the same, so a
  // widget without a list is the same widget in both variants.
  const noLists = lists === "none";
  const want = [];
  if (forced === "addButton") want.push(["int", { addButton: true }]);
  if (forced === "textInput") want.push(["text", { required: true }]);
  if (forced === "listPush") want.push(noLists ? ["text", { required: true }] : ["list", { pushFromDraft: true, remove: true }]);
  if (forced === "boolToggle") want.push(["bool", { toggle: true }]);
  if (forced === "enumFeed") want.push(["enum", { control: true }], ...(noLists ? [] : [["list", { feed: true }]]));
  if (forced === "numberInput") want.push(["int", { numberInput: true }]);
  if (forced === "tick") want.push(["int", { tick: true }]);
  const total = reader ? r.int(1, 2) : r.weighted([[1, 10], [2, 25], [3, 30], [4, 20], [5, 15]]);
  while (want.length < total) {
    const t = r.weighted([["int", 30], ["bool", 20], ["text", 18], ["list", 14], ["enum", 15], ["tick", 3]]);
    if (t === "list" && (noLists || want.filter(([x]) => x === "list").length >= 2)) continue;
    if (t === "tick") want.push(["int", { tick: true }]);
    else want.push([t, {}]);
  }
  for (const [type, opts] of want) GEN[type](b, opts);

  // Messages touching two or more fields at once.
  const plain = b.fields.filter((f) => f.type !== "list" && !f.draftFor);
  if (plain.length >= 2 && r.chance(0.4)) combined(b, plain);

  // Derived texts over several fields.
  const nDerived = r.weighted([[0, 40], [1, 40], [2, 20]]);
  for (let k = 0; k < nDerived; k++) derived(b);

  // Cross-widget reads.
  const sources = earlier.filter((w) => w.fields.length > 0);
  if (sources.length > 0 && (reader || r.chance(0.12))) {
    crossReads(b, earlier, reader ? r.int(2, 3) : 1, forced === "reader" ? earlier[5] : null);
  }

  // The token caption, and sometimes a static sentence.
  b.chunk([{ el: "text", tag: "small", parts: [`${r.pick(CAPTIONS)} ${token}`] }], { required: true });
  if (r.chance(0.25)) b.chunk([{ el: "text", tag: "p", parts: [r.pick(SENTENCES)] }]);

  // Order: the chunks shuffled, the forced ones kept first.
  const req = b.chunks.filter((c) => c.required);
  const rest = r.shuffle(b.chunks.filter((c) => !c.required));
  let items = [...req, ...rest].flatMap((c) => c.items);

  // Conditional sections, then nesting.
  const nWhen = r.weighted([[0, 35], [1, 45], [2, 20]]);
  for (let k = 0; k < nWhen; k++) items = addWhen(b, items);
  if (r.chance(0.55)) items = nest(r, items, 0);

  // `kind` is only a display summary of the field types (the serve panel lists it); it is not a
  // component kind: every widget is its own component.
  const kind = b.fields.map((f) => f.type).join("+");
  return { id, kind, token, label, fields: b.fields.map(cleanField), messages: b.messages, view: items.map((it) => it.node) };
}

function cleanField(f) {
  const { draftFor, ...rest } = f;
  return rest;
}

// The builder: names, fields, messages and chunks of view items. An item is { node, writes
// (fields the node's controls write), required (a forced control: never hidden or moved into a
// conditional section) }.
function makeBuilder(r) {
  const used = new Set();
  const b = {
    r, fields: [], messages: [], chunks: [],
    name(pool) {
      const free = pool.filter((n) => !used.has(n));
      const n = free.length ? r.pick(free) : `${r.pick(pool)}${used.size}`;
      used.add(n);
      return n;
    },
    msgName(verbs, ...parts) {
      let base = r.pick(verbs) + parts.map((p) => cap(String(p))).join("");
      let n = base;
      for (let k = 2; used.has(n); k++) n = `${base}${k}`;
      used.add(n);
      return n;
    },
    field(f) { b.fields.push(f); return f; },
    message(m) { b.messages.push(m); return m.name; },
    chunk(nodes, { required = false } = {}) {
      b.chunks.push({ required, items: nodes.map((node) => ({ node, writes: writesOf(b, node), required })) });
    },
  };
  return b;
}

// The fields a node's controls write (recursively).
function writesOf(b, node) {
  const out = new Set();
  const visit = (n) => {
    const msgs = [n.msg, n.check, n.remove].filter(Boolean);
    for (const name of msgs) {
      const m = b.messages.find((x) => x.name === name);
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

// Per-type field generators. Each adds its field, its messages and its view chunk.
const GEN = {
  int(b, opts) {
    const r = b.r;
    if (opts.tick) return tickField(b);
    const name = b.name(NAMES.int);
    let min = r.pick([0, 0, 0, -5, -10, 1]);
    let max = min + r.int(5, 60);
    if (opts.numberInput || (!opts.addButton && r.chance(0.3))) {
      opts = { ...opts, numberInput: true };
      min = Math.min(min, 0);
      max = Math.max(max, 20);
    }
    const initial = r.int(min, min + Math.floor((max - min) / 2));
    const f = b.field({ name, type: "int", min, max, initial });
    const F = ["f", name];
    const nodes = [];
    const required = !!(opts.addButton || opts.numberInput);
    if (opts.numberInput) {
      const msg = b.message({ name: b.msgName(["enter", "set", "type", "input"], name), kind: "input", field: name });
      nodes.push({ el: "input", msg, ...(r.chance(0.6) ? { label: cap(name) } : {}) });
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
    if (!opts.numberInput || r.chance(0.5)) nodes.splice(r.int(0, nodes.length), 0, intText(r, name, F));
    b.chunk(nodes, { required });
    return f;
  },

  bool(b, opts) {
    const r = b.r;
    const name = b.name(NAMES.bool);
    const f = b.field({ name, type: "bool", initial: r.chance(0.4) });
    b.chunk(boolControl(b, name, opts.toggle ? r.pick(["check", "toggle"]) : r.weighted([["check", 45], ["toggle", 35], ["pair", 20]]), r.chance(0.5)), { required: !!opts.toggle });
    return f;
  },

  text(b, opts) {
    const r = b.r;
    const name = b.name(NAMES.text);
    const f = b.field({ name, type: "text", initial: r.chance(0.25) ? r.pick(TEXT_SAMPLES) : "" });
    const msg = b.message({ name: b.msgName(["edit", "type", "write", "change", "enter"], name), kind: "input", field: name });
    const node = { el: "input", msg };
    if (r.chance(0.5)) node.label = cap(name);
    if (r.chance(0.6)) node.placeholder = r.pick([`Your ${name}`, `Enter a ${name}`, `${cap(name)} here`, "Type here", "…"]);
    if (r.chance(0.45)) node.invalid = validation(r, name);
    const nodes = [node];
    if (r.chance(0.5)) {
      const T = ["f", name];
      nodes.push(r.pick([
        { el: "text", tag: "p", parts: [r.pick(["Hello, ", "Preview: ", "You typed ", `${cap(name)}: `]), T] },
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
        : [{ el: "text", tag: "p", parts: [["count", L], ` ${name}`] }, { el: "text", tag: "small", parts: ["Total: ", ["count", L]] }]));
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
    const set = r.pick(ENUM_SETS);
    const options = set.slice(0, r.int(3, set.length));
    const f = b.field({ name, type: "enum", options, initial: r.pick(options) });
    const F = ["f", name];
    const nodes = [];
    const select = r.chance(0.5);
    if (select) {
      const msg = b.message({ name: b.msgName(["pick", "choose", "select"], name), kind: "select", field: name });
      nodes.push({ el: "select", msg, ...(r.chance(0.6) ? { label: cap(name) } : {}) });
    } else {
      const msg = b.message({ name: b.msgName(["cycle", "next", "rotate"], name), kind: "click", ops: [["cycle", name]] });
      nodes.push({ el: "button", msg, text: r.chance(0.5) ? [r.pick(["Next", "Cycle", "Rotate", "Change"])] : [`${cap(name)}: `, F] });
    }
    if (!select || r.chance(0.6)) {
      nodes.push(r.pick([
        { el: "text", tag: "p", parts: [`${cap(name)}: `, F] },
        { el: "text", tag: "strong", parts: [F] },
        { el: "text", tag: "p", parts: [["if", ["==", F, ["k", options[0]]], ["k", "default"], ["k", "custom"]], ` ${name}`] },
      ]));
    }
    b.chunk(nodes, { required: !!opts.control });
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

// A bool control: a checkbox, a toggle button, or an on/off pair of buttons.
function boolControl(b, name, kind, display) {
  const r = b.r;
  const F = ["f", name];
  const nodes = [];
  if (kind === "check") {
    const msg = b.message({ name: b.msgName(["check", "tick", "flag"], name), kind: "check", field: name });
    nodes.push({ el: "check", msg, label: cap(name) });
  } else if (kind === "toggle") {
    const msg = b.message({ name: b.msgName(["toggle", "flip", "switch"], name), kind: "click", ops: [["toggle", name]] });
    const pair = r.pick([["Hide", "Show"], ["Unpin", "Pin"], ["Off", "On"], ["Pause", "Resume"], ["Unlock", "Lock"], ["Stop", "Start"]]);
    nodes.push({ el: "button", msg, text: r.chance(0.5) ? [r.pick(["Toggle", "Switch", "Flip"]) + ` ${name}`] : [["if", F, ["k", pair[0]], ["k", pair[1]]]] });
  } else {
    const [on, off] = r.pick([["mark", "unmark"], ["enable", "disable"], ["show", "hide"], ["start", "stop"], ["set", "unset"]]);
    const mOn = b.message({ name: b.msgName([on], name), kind: "click", ops: [["set", name, true]] });
    const mOff = b.message({ name: b.msgName([off], name), kind: "click", ops: [["set", name, false]] });
    nodes.push({ el: "button", msg: mOn, text: [cap(on)], ...(r.chance(0.5) ? { disabled: F } : {}) });
    nodes.push({ el: "button", msg: mOff, text: [cap(off)], ...(r.chance(0.5) ? { disabled: ["not", F] } : {}) });
  }
  if (display) {
    const words = r.pick([["yes", "no"], ["on", "off"], ["Active", "Inactive"], ["set", "not set"], ["done", "pending"]]);
    nodes.push({ el: "text", tag: r.pick(["p", "span", "em"]), parts: [`${cap(name)}: `, ["if", F, ["k", words[0]], ["k", words[1]]]] });
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
  const nodes = [intText(r, name, F)];
  nodes.push(...boolControl(b, gate, r.pick(["check", "toggle", "pair"]), r.chance(0.3)));
  if (r.chance(0.5)) {
    const msg = b.message({ name: b.msgName(["reset", "restart", "zero"], name), kind: "click", ops: [["reset", name], ["reset", gate]] });
    nodes.push({ el: "button", msg, text: [r.pick(["Reset", "Clear", "Zero"])] });
  }
  b.chunk(nodes, { required: true });
}

function validation(r, name) {
  const T = ["f", name];
  const n = r.int(2, 5);
  return r.pick([
    { when: ["==", ["len", T], ["k", 0]], message: r.pick(["This field is required", "Please fill this in", `A ${name} is required`]) },
    { when: ["<", ["len", T], ["k", n]], message: r.pick([`Use at least ${n} characters`, `Too short: ${n} characters minimum`]) },
    { when: [">", ["len", T], ["k", n + 4]], message: r.pick([`At most ${n + 4} characters`, `Too long: keep it under ${n + 5}`]) },
    { when: ["not", ["has", T, "@"]], message: "Must contain an @" },
    { when: ["has", T, " "], message: r.pick(["No spaces allowed", "Spaces are not allowed"]) },
  ]);
}

// A message touching two or three fields: a combined action or a reset of several fields.
function combined(b, plain) {
  const r = b.r;
  const fs = r.sample(plain, Math.min(plain.length, r.int(2, 3)));
  if (r.chance(0.4)) {
    const msg = b.message({ name: b.msgName(["resetAll", "clearForm", "startOver", "restoreAll"]), kind: "click", ops: fs.map((f) => ["reset", f.name]) });
    b.chunk([{ el: "button", msg, text: [r.pick(["Reset all", "Clear form", "Start over", "Restore"])] }]);
    return;
  }
  const opFor = (f) => {
    if (f.type === "int") return ["add", f.name, r.pick([1, 2, 5, -1, -3])];
    if (f.type === "bool") return r.chance(0.5) ? ["toggle", f.name] : ["set", f.name, r.chance(0.5)];
    if (f.type === "enum") return r.chance(0.6) ? ["cycle", f.name] : ["set", f.name, r.pick(f.options)];
    return r.chance(0.5) ? ["set", f.name, ""] : ["reset", f.name];
  };
  const ops = fs.slice(0, 2).map(opFor);
  const msg = b.message({ name: b.msgName(["apply", "commit", "prime", "kick", "sync"], fs[0].name, "and", fs[1].name), kind: "click", ops });
  b.chunk([{ el: "button", msg, text: [r.pick(["Go", "Apply", "Do both", "Commit", "Run"])] }]);
}

// An expression for a field, as an int, a bool or a text.
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

// A derived text over one or more of the widget's fields: a sum or difference, a comparison,
// a conjunction, an equality test.
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

// Texts reading fields of earlier widgets. `first` (a widget) forces the first read to its
// number-input field.
function crossReads(b, earlier, n, first) {
  const r = b.r;
  const parts = [];
  const seen = new Set();
  for (let k = 0; k < n; k++) {
    let src, f;
    if (k === 0 && first) {
      src = first;
      const inputs = first.messages.filter((m) => m.kind === "input").map((m) => m.field);
      f = first.fields.find((x) => x.type === "int" && inputs.includes(x.name));
    } else {
      // Distinct (widget, field) pairs; recent widgets preferred, sometimes far back.
      const all = earlier.flatMap((w, i) => w.fields.map((x) => ({ w, x, recent: i >= earlier.length - 6 }))).filter((c) => !seen.has(`${c.w.id}/${c.x.name}`));
      if (all.length === 0) break;
      const recent = all.filter((c) => c.recent);
      const c = r.pick(recent.length && r.chance(0.6) ? recent : all);
      src = c.w;
      f = c.x;
    }
    seen.add(`${src.id}/${f.name}`);
    const v = valueOf(r, f, (name) => ["w", src.id, name]);
    parts.push({ src, f, v });
  }
  const nodes = parts.map(({ src, f, v }) => ({ el: "text", tag: "p", parts: [`${cap(f.name)} in ${src.label}: `, asText(v, r)] }));
  // Sometimes also a sum over the int reads.
  const ints = parts.filter((p) => p.v.type === "int");
  if (ints.length >= 2 && r.chance(0.5)) nodes.push({ el: "text", tag: "strong", parts: [r.pick(["Overall: ", "Grand total: ", "Combined: "]), ints.slice(1).reduce((acc, p) => ["+", acc, p.v.expr], ints[0].v.expr)] });
  b.chunk(nodes, { required: !!first });
}

// A conditional section: a condition over the widget's own fields, wrapping a contiguous run of
// items that do not write the fields the condition reads (so typing or clicking inside never
// hides the control itself), plus sometimes a text of its own.
function addWhen(b, items) {
  const r = b.r;
  if (b.fields.length === 0) return items;
  const f = r.pick(b.fields);
  let cond = condFor(r, f);
  const reads = new Set([f.name]);
  if (b.fields.length > 1 && r.chance(0.2)) {
    const g = r.pick(b.fields.filter((x) => x !== f));
    cond = [r.pick(["and", "or"]), cond, condFor(r, g)];
    reads.add(g.name);
  }
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
  if (children.length === 0 || r.chance(0.3)) {
    const t = { node: { el: "text", tag: "p", parts: [r.pick(SENTENCES)] }, writes: new Set(), required: false };
    children.push(t);
  }
  const node = { el: "when", tag: r.pick(["div", "div", "section", "aside"]), cond, children: children.map((c) => c.node) };
  const writes = new Set(children.flatMap((c) => [...c.writes]));
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

// Wrap contiguous runs of items into groups, at most two levels deep.
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
      out.push({ node, writes: new Set(inner.flatMap((x) => [...x.writes])), required: inner.some((x) => x.required) });
      i += len;
    } else out.push(items[i++]);
  }
  return out;
}

// The structure of a widget with every text, number, initial value and name abstracted away
// (fields and messages become their index), used to guarantee that no two widgets of an app
// share a structure.
export function signature(w) {
  const fi = new Map(w.fields.map((f, i) => [f.name, i]));
  const mi = new Map(w.messages.map((m, i) => [m.name, i]));
  const expr = (e) => {
    if (!Array.isArray(e)) return typeof e;
    if (e[0] === "f") return ["f", fi.get(e[1])];
    if (e[0] === "w") return ["w"];
    if (e[0] === "k") return ["k", typeof e[1]];
    if (e[0] === "has") return ["has", expr(e[1])];
    return [e[0], ...e.slice(1).map(expr)];
  };
  const node = (n) => [n.el, n.msg != null ? mi.get(n.msg) : null, n.field != null ? fi.get(n.field) : null,
    n.check != null, n.remove != null, n.cond ? expr(n.cond) : null, n.disabled ? expr(n.disabled) : null,
    n.invalid ? expr(n.invalid.when) : null, !!n.label,
    (n.parts || []).map((p) => (typeof p === "string" ? "s" : expr(p))), (n.children || []).map(node)];
  return JSON.stringify([
    w.fields.map((f) => [f.type, !!f.tick, f.tickWhen != null ? fi.get(f.tickWhen) : null, !!f.feed, !!f.checkable]),
    w.messages.map((m) => [m.kind, m.field != null ? fi.get(m.field) : null, m.op ?? null,
      (m.ops || []).map((op) => [op[0], fi.get(op[1]), op[0] === "push" ? fi.get(op[2]) : null])]),
    w.view.map(node),
  ]);
}

// ---------------------------------------------------------------------------------------------
// The reference: expressions, update and render, as generic interpreters over the widget
// descriptions. Pure and deterministic.

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
  return h("div", { "data-role": "dashboard" }, spec.widgets.map((w) => renderWidget(spec, w, state)));
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

// Where a widget's controls sit: message name → { inWhen } for every control in its view
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

export function notifyMsg(spec, state, id, salt) {
  return { type: "notify", widget: id, field: feedField(byId(spec, id)).name, item: notifyEntry(spec, state, id, salt) };
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
  ctx.push({ do: "mount", label: "mount" });

  // 2. Every widget: its messages exercised.
  for (const w of spec.widgets) exercise(ctx, w, rng("script", spec.options.seed, w.id), "first");

  // 3. External events.
  const r = rng("external", spec.options.seed);
  const targets = r.sample(spec.widgets, Math.min(3, spec.widgets.length)).sort((a, b) => spec.widgets.indexOf(a) - spec.widgets.indexOf(b));
  for (const w of targets) {
    ctx.push({ do: "dispatch", label: `serverSet ${w.id}`, msg: { type: "serverSet", widget: w.id, state: serverState(spec, state, w.id, `script-${w.id}`) } });
  }
  // Start up to two stopped time-driven fields, so the ticks advance something.
  let started = 0;
  for (const w of spec.widgets) {
    for (const f of w.fields) {
      if (!f.tick || started >= 2) continue;
      if (state.widgets[w.id][f.tickWhen] || turnOn(ctx, w, f.tickWhen)) started++;
    }
  }
  for (let i = 0; i < 3; i++) ctx.push({ do: "dispatch", label: "tick", msg: { type: "tick" } });
  const feeds = spec.widgets.filter((w) => feedField(w));
  for (let i = 0; i < 2 && feeds.length; i++) {
    const f = feeds[i % feeds.length];
    ctx.push({ do: "dispatch", label: `notify ${f.id}`, msg: notifyMsg(spec, state, f.id, `script-${i}`) });
  }

  // 4. A reorder through a snapshot.
  ctx.push({ do: "dispatch", label: "snapshot", msg: { type: "snapshot", state: snapshot(spec, state, "script") } });

  // 5. A final round: every widget with a list, and three others.
  const lists = spec.widgets.filter((w) => w.fields.some((f) => f.type === "list"));
  const others = r.sample(spec.widgets.filter((w) => !lists.includes(w)), Math.min(3, spec.widgets.length - lists.length));
  for (const w of [...lists, ...others].sort((a, b) => spec.widgets.indexOf(a) - spec.widgets.indexOf(b))) {
    exercise(ctx, w, rng("final", spec.options.seed, w.id), "final");
  }

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

function exercise(ctx, w, r, round) {
  let msgs = w.messages.slice().sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  if (round === "final") {
    const listy = msgs.filter((m) => m.kind === "item" || (m.kind === "click" && m.ops.some((op) => fieldOf(w, op[1]).type === "list")) || (m.kind === "input" && w.messages.some((x) => x.kind === "click" && x.ops.some((op) => op[0] === "push" && op[2] === m.field))));
    const rest = r.sample(msgs.filter((m) => !listy.includes(m)), 2);
    msgs = msgs.filter((m) => listy.includes(m) || rest.includes(m));
  }
  // Two passes: a control hidden by a conditional section may appear after other actions.
  let pending = msgs;
  for (let pass = 0; pass < 2 && pending.length; pass++) pending = pending.filter((m) => !act(ctx, w, m, r, round));
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
