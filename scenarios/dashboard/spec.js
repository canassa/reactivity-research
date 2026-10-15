// The dashboard scenario generator and its reference.
//
// This module is the single source of truth for the scenario (see README.md). It runs both in
// Node (the CLI generates specs with it) and in the browser (the serve panel uses the reference
// `update` and `render` and the external-event builders), so it imports nothing.
//
// `generate(options)` returns a plain-data app spec: the widgets with their per-instance
// parameters, the initial state and the interaction script. Everything else here is a pure
// function of (spec, state, …): the reference `update` and `render`, and the builders of
// external events (`serverState`, `notifyEntry`, `snapshot`).

export const scenario = "dashboard";

export const KINDS = [
  "counter", "toggles", "field", "todo", "tabs", "panel", "choice",
  "amount", "filter", "rating", "feed", "clock", "summary",
];

// Kinds a summary can read: those with a natural number to report.
export const SUMMARY_SOURCES = ["counter", "amount", "toggles", "todo", "rating", "clock", "filter", "feed"];

// From this size on every widget kind is present (README), so growth is per instance only; the
// measurements also fit baseline and slope over these sizes alone.
export const steadyFrom = 16;
// The size ./rr check builds by default: the smallest one with every widget kind.
export const quickCheckSize = 16;

// The scenario's own parameters (beyond --size and --seed), with their defaults.
export const params = {
  kinds: { default: "all", help: "restrict the catalogue, e.g. counter,todo,summary" },
  summaries: { default: "auto", help: "number of summary widgets (auto: 1 per 8 widgets)" },
};

export function normalizeOptions(raw = {}) {
  const size = int(raw.size ?? 16, "size");
  const seed = int(raw.seed ?? 1, "seed");
  if (size < 1) throw new Error("--size must be at least 1");
  let kinds = raw.kinds ?? "all";
  if (Array.isArray(kinds)) kinds = kinds.join(",");
  if (kinds !== "all") {
    const list = kinds.split(",").map((k) => k.trim()).filter(Boolean);
    for (const k of list) if (!KINDS.includes(k)) throw new Error(`unknown widget kind: ${k}`);
    kinds = KINDS.filter((k) => list.includes(k)).join(",");
  }
  let summaries = raw.summaries ?? "auto";
  if (summaries !== "auto") summaries = int(summaries, "summaries");
  return { size, seed, kinds, summaries };
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
// Word pools

const ADJECTIVES = [
  "Daily", "Weekly", "Monthly", "Night", "Morning", "Team", "Office", "Garden", "Kitchen",
  "Studio", "Warehouse", "Lab", "Fleet", "Library", "Field", "Sales", "Support", "Billing",
  "Design", "Travel", "Event", "Harbor", "Clinic", "Campus", "Workshop", "Store", "Project",
  "Backlog", "Sprint", "Quarterly", "Regional", "Personal", "Family", "Club", "Market", "Trail",
];

const NOUNS = {
  counter: ["visitors", "orders", "tickets", "cups", "boxes", "laps", "pages", "calls", "bikes", "seats"],
  toggles: ["features", "alerts", "options", "channels", "switches", "filters", "lights", "modules"],
  field: ["name", "code", "handle", "reference", "email", "title", "tag", "nickname", "zip code"],
  todo: ["tasks", "chores", "errands", "to-dos", "checklist", "reminders", "steps", "actions"],
  tabs: ["overview", "sections", "notes", "views", "chapters", "topics", "pages", "guides"],
  panel: ["details", "notes", "advanced", "help", "history", "settings", "credits", "terms"],
  choice: ["plan", "shipping", "contact method", "size", "format", "priority", "region", "theme"],
  amount: ["budget", "discount", "weight", "distance", "deposit", "rate", "volume", "fee"],
  filter: ["directory", "catalog", "inventory", "roster", "index", "glossary", "list", "registry"],
  rating: ["feedback", "review", "score", "rating", "satisfaction", "opinion", "grade", "verdict"],
  feed: ["news", "updates", "alerts", "messages", "activity", "announcements", "log", "inbox"],
  clock: ["timer", "stopwatch", "session", "shift", "workout", "meeting", "break", "focus time"],
  summary: ["summary", "totals", "overview", "digest", "status", "snapshot", "report", "recap"],
};

const VERBS = ["Call", "Email", "Book", "Order", "Review", "Fix", "Clean", "Plan", "Water", "Pay",
  "Print", "Update", "Pack", "Sort", "Check", "Send", "Draft", "Return", "Renew", "Test"];
const OBJECTS = ["the supplier", "the plants", "the invoice", "the slides", "the report", "the car",
  "the tickets", "the budget", "the backups", "the windows", "the parcel", "the contract",
  "the agenda", "the printer", "the library books", "the passport", "the roof", "the badges",
  "the schedule", "the dentist", "the venue", "the keys"];

const FILTER_SETS = [
  ["Apple", "Apricot", "Banana", "Blueberry", "Cherry", "Grape", "Lemon", "Lime", "Mango", "Melon", "Peach", "Pear", "Plum"],
  ["Amsterdam", "Berlin", "Bogota", "Cairo", "Dublin", "Lima", "Lisbon", "Madrid", "Oslo", "Paris", "Porto", "Rome", "Tokyo"],
  ["Amber", "Azure", "Beige", "Coral", "Crimson", "Indigo", "Ivory", "Lilac", "Maroon", "Olive", "Salmon", "Teal"],
  ["Anvil", "Chisel", "Clamp", "Drill", "File", "Hammer", "Level", "Mallet", "Pliers", "Saw", "Wrench", "Vise"],
  ["Alder", "Ash", "Beech", "Birch", "Cedar", "Elm", "Fir", "Larch", "Maple", "Oak", "Pine", "Willow"],
  ["Bass", "Cello", "Drum", "Flute", "Guitar", "Harp", "Oboe", "Organ", "Piano", "Sitar", "Tuba", "Viola"],
  ["Ada", "Basil", "Clara", "Dmitri", "Elena", "Farid", "Grace", "Hugo", "Ines", "Jonas", "Kenji", "Lena"],
];

const TOGGLE_NAMES = ["Email", "SMS", "Push", "Sound", "Vibrate", "Dark mode", "Autosave", "Sync",
  "Beta", "Badges", "Previews", "Location", "Backups", "Digest", "Reminders", "Offline"];

const TAB_TITLES = ["Intro", "Usage", "Pricing", "FAQ", "Team", "Roadmap", "Specs", "Reviews",
  "Setup", "Billing", "Limits", "Support", "History", "Credits"];

const SENTENCES = [
  "Everything here updates as soon as you act.", "Changes are saved for the whole team.",
  "Numbers are refreshed every morning.", "Ask the front desk for the spare key.",
  "Deliveries arrive on Tuesdays and Fridays.", "The north entrance closes at six.",
  "Use the blue form for refunds.", "Bring a badge to the second floor.",
  "Quiet hours start after ten.", "Late returns are charged by the day.",
  "The garden is watered at dawn.", "Meetings run for thirty minutes at most.",
  "Printing is free for members.", "Parking is behind the old mill.",
  "Lunch is served from noon.", "Reports are due at the end of the month.",
  "The lab is closed on holidays.", "Visitors sign in at the gate.",
];

const NEWS = ["Server restarted", "New member joined", "Backup finished", "Invoice paid",
  "Order shipped", "Build passed", "Comment added", "Meeting moved", "Report ready",
  "Price updated", "Ticket closed", "Stock low", "Payment failed", "Review requested"];

const CHOICE_SETS = [
  ["Basic", "Standard", "Premium", "Custom"],
  ["Pickup", "Courier", "Post", "Locker", "Other"],
  ["Email", "Phone", "Letter", "Chat", "Other"],
  ["Small", "Medium", "Large", "Custom"],
  ["PDF", "CSV", "Spreadsheet", "Other"],
  ["Low", "Normal", "High", "Urgent"],
  ["North", "South", "East", "West", "Elsewhere"],
];

const RATING_WORDS = ["Poor", "Fair", "Okay", "Good", "Great", "Superb", "Perfect"];

const FIELD_RULES = [
  { type: "required", message: "This field is required" },
  { type: "required", message: "Please fill this in" },
  { type: "minLength", min: 3, message: "Use at least 3 characters" },
  { type: "minLength", min: 4, message: "Too short: 4 characters minimum" },
  { type: "minLength", min: 5, message: "Needs 5 or more characters" },
  { type: "pattern", pattern: "^[0-9]+$", message: "Digits only", sample: "2024", bad: "x" },
  { type: "pattern", pattern: "^[a-z]+$", message: "Lowercase letters only", sample: "maple", bad: "Q" },
  { type: "pattern", pattern: "^[A-Z]", message: "Start with a capital letter", sample: "Oslo", bad: null },
  { type: "pattern", pattern: "@", message: "Must contain an @", sample: "me@home", bad: null },
  { type: "pattern", pattern: "^\\S+$", message: "No spaces allowed", sample: "north", bad: " " },
];

const AMOUNT_FORMATS = [
  { type: "currency", symbol: "$", decimals: 2 },
  { type: "currency", symbol: "€", decimals: 2 },
  { type: "currency", symbol: "£", decimals: 0 },
  { type: "percent", decimals: 0 },
  { type: "percent", decimals: 1 },
  { type: "unit", unit: "kg", decimals: 1 },
  { type: "unit", unit: "km", decimals: 2 },
  { type: "unit", unit: "L", decimals: 0 },
  { type: "unit", unit: "h", decimals: 1 },
];

// ---------------------------------------------------------------------------------------------
// Generation

// The order of kinds: a seeded shuffle of the catalogue, reshuffled every cycle. Summaries are
// placed separately (see `layout`).
function kindSequence(seed, kinds, count) {
  const r = rng("kinds", seed, kinds.join(","));
  const out = [];
  while (out.length < count) out.push(...r.shuffle(kinds));
  return out.slice(0, count);
}

// Which positions (0-based) hold summaries. By default one at every 8th position, so a bigger
// app with the same seed extends a smaller one. A summary needs earlier widgets to read.
function summaryPositions(size, summaries) {
  if (summaries === "auto") {
    const out = [];
    for (let p = 7; p < size; p += 8) out.push(p);
    return out;
  }
  if (summaries > size - 1) throw new Error(`--summaries ${summaries} leaves no widget to summarize at size ${size}`);
  const out = [];
  for (let k = 1; k <= summaries; k++) out.push(Math.round((k * size) / summaries) - 1);
  return out;
}

export function generate(rawOptions) {
  const options = normalizeOptions(rawOptions);
  const { size, seed } = options;
  const allowed = options.kinds === "all" ? KINDS : options.kinds.split(",");
  const plain = allowed.filter((k) => k !== "summary");
  const wantSummaries = allowed.includes("summary");
  if (plain.length === 0) throw new Error("--kinds needs at least one kind other than summary");
  const sumPos = wantSummaries ? summaryPositions(size, options.summaries) : [];

  const sequence = kindSequence(seed, plain, size);
  const usedLabels = new Set();
  const widgets = [];
  let nextPlain = 0;
  for (let i = 0; i < size; i++) {
    const id = `w${i + 1}`;
    const kind = sumPos.includes(i) ? "summary" : sequence[nextPlain++];
    const r = rng("widget", seed, i, kind);
    let label;
    do label = `${r.pick(ADJECTIVES)} ${r.pick(NOUNS[kind])}`;
    while (usedLabels.has(label));
    usedLabels.add(label);
    const w = { id, kind, label, ...GEN[kind](r, widgets, label) };
    widgets.push(w);
  }

  const initialState = { widgets: {} };
  for (const w of widgets) if (w.kind !== "summary") initialState.widgets[w.id] = w.initial;
  for (const w of widgets) delete w.initial;

  const spec = { scenario, options, widgets, initialState };
  spec.script = makeScript(spec);
  return spec;
}

function capitalize(s) {
  return s[0].toUpperCase() + s.slice(1);
}

function todoText(r, used) {
  let t;
  do t = `${r.pick(VERBS)} ${r.pick(OBJECTS)}`;
  while (used.has(t));
  used.add(t);
  return t;
}

// Per-kind parameters. Each returns the widget's own parameters plus `initial`, its state.
const GEN = {
  counter(r) {
    const step = r.int(1, 5);
    const min = r.chance(0.5) ? 0 : -step * r.int(1, 4);
    const max = step * r.int(3, 12);
    const start = min + step * r.int(0, Math.floor((max - min) / step / 2));
    return { step, min, max, start, initial: { value: start } };
  },
  toggles(r) {
    const k = r.int(2, 6);
    const items = r.sample(TOGGLE_NAMES, k);
    return { items, initial: { on: items.map(() => r.chance(0.4)) } };
  },
  field(r, _w, label) {
    const rule = { ...r.pick(FIELD_RULES) };
    const placeholder = `Your ${label.split(" ").slice(1).join(" ")}`;
    const text = r.chance(0.3) ? (rule.sample ?? "abc") : "";
    return { rule, placeholder, initial: { text } };
  },
  todo(r) {
    const k = r.int(2, 6);
    const used = new Set();
    const items = [];
    for (let i = 1; i <= k; i++) items.push({ id: i, text: todoText(r, used), done: r.chance(0.3) });
    return {
      placeholder: r.pick(["What needs doing?", "New task", "Add an item", "Next step", "Write it down"]),
      addText: r.pick(["Add", "Add task", "Save", "Create", "Plus one"]),
      removeText: r.pick(["Remove", "Delete", "×", "Drop", "Done with it"]),
      initial: { items, draft: "" },
    };
  },
  tabs(r) {
    const k = r.int(2, 6);
    const titles = r.sample(TAB_TITLES, k);
    const tabs = titles.map((title) => ({ title, content: r.pick(SENTENCES) }));
    return { tabs, initial: { active: r.int(0, k - 1) } };
  },
  panel(r, _w, label) {
    const what = label.split(" ").slice(1).join(" ");
    return {
      showText: `Show ${what}`,
      hideText: `Hide ${what}`,
      body: `${r.pick(SENTENCES)} ${r.pick(SENTENCES)}`,
      initial: { open: r.chance(0.3) },
    };
  },
  choice(r) {
    const opts = r.pick(CHOICE_SETS);
    const k = r.int(3, opts.length);
    const labels = opts.slice(0, k);
    const options = labels.map((l) => ({ value: l.toLowerCase(), label: l }));
    // The last option always shows the extra input; one more at random sometimes does too.
    const extraFor = [options[k - 1].value];
    if (r.chance(0.5)) extraFor.unshift(options[r.int(0, k - 2)].value);
    return {
      options,
      extraFor,
      extraPlaceholder: r.pick(["Please specify", "Tell us more", "Details", "Which one?", "Describe it"]),
      initial: { option: options[0].value, extra: "" },
    };
  },
  amount(r) {
    const format = r.pick(AMOUNT_FORMATS);
    return { format, initial: { value: r.int(0, 200) } };
  },
  filter(r) {
    const set = r.pick(FILTER_SETS);
    const k = r.int(4, 8);
    const items = r.sample(set, k).sort().map((text, i) => ({ id: i + 1, text }));
    return {
      items,
      placeholder: r.pick(["Search…", "Filter", "Type to filter", "Find", "Look up"]),
      initial: { query: "" },
    };
  },
  rating(r) {
    const k = r.int(3, 6);
    const words = r.sample(RATING_WORDS, k).sort((a, b) => RATING_WORDS.indexOf(a) - RATING_WORDS.indexOf(b));
    return { stars: k, labels: [r.pick(["Not rated", "No rating yet", "Unrated"]), ...words], initial: { stars: 0 } };
  },
  feed(r) {
    const n = r.int(1, 3);
    const entries = [];
    for (let i = 1; i <= n; i++) entries.push({ id: i, text: r.pick(NEWS) });
    return {
      emptyText: r.pick(["No news", "Nothing new", "All caught up", "No updates yet", "Quiet for now"]),
      dismissText: r.pick(["Dismiss", "Hide", "OK", "Clear", "Got it"]),
      initial: { entries },
    };
  },
  clock(r) {
    return {
      startText: r.pick(["Start", "Go", "Run", "Begin"]),
      stopText: r.pick(["Stop", "Pause", "Halt", "Hold"]),
      resetText: r.pick(["Reset", "Clear", "Zero", "Restart"]),
      initial: { seconds: r.int(0, 90), running: false },
    };
  },
  summary(r, earlier) {
    const candidates = earlier.filter((w) => SUMMARY_SOURCES.includes(w.kind));
    if (candidates.length === 0) throw new Error("a summary needs an earlier widget it can read");
    const n = Math.min(candidates.length, r.int(2, 3));
    // Prefer recent widgets, but sometimes reach far back.
    const pool = candidates.length > 6 && r.chance(0.6) ? candidates.slice(-6) : candidates;
    const sources = r.sample(pool, Math.min(n, pool.length))
      .sort((a, b) => earlier.indexOf(a) - earlier.indexOf(b))
      .map((w) => w.id);
    const formula = r.pick(["sum", "list", "breakdown"]);
    const prefix = r.pick(["Total", "Combined", "Overall", "Grand total", "All together", "Sum"]);
    return { sources, formula, prefix, initial: null };
  },
};

// ---------------------------------------------------------------------------------------------
// Derived values (shared by update, render and the summaries)

export function fieldError(w, text) {
  const rule = w.rule;
  if (rule.type === "required") return text.trim() === "" ? rule.message : null;
  if (rule.type === "minLength") return text.length < rule.min ? rule.message : null;
  return new RegExp(rule.pattern).test(text) ? null : rule.message;
}

export function formatAmount(format, value) {
  const n = value.toFixed(format.decimals);
  if (format.type === "currency") return format.symbol + n;
  if (format.type === "percent") return n + "%";
  return n + " " + format.unit;
}

export function formatTime(seconds) {
  const s = seconds % 60;
  return Math.floor(seconds / 60) + ":" + (s < 10 ? "0" : "") + s;
}

export function matches(w, query) {
  const q = query.toLowerCase();
  return w.items.filter((it) => it.text.toLowerCase().includes(q));
}

// The number a summary reads from a widget, and the phrase it uses for it in a list.
export function metric(w, s) {
  switch (w.kind) {
    case "counter": return s.value;
    case "amount": return s.value;
    case "toggles": return s.on.filter(Boolean).length;
    case "todo": return s.items.filter((it) => !it.done).length;
    case "rating": return s.stars;
    case "clock": return s.seconds;
    case "filter": return matches(w, s.query).length;
    case "feed": return s.entries.length;
  }
  throw new Error(`no metric for ${w.kind}`);
}

const PHRASE = {
  counter: (n, w) => `${w.label}: ${n}`,
  amount: (n, w) => `${w.label}: ${n}`,
  toggles: (n, w) => `${n} on in ${w.label}`,
  todo: (n, w) => `${n} left in ${w.label}`,
  rating: (n, w) => `${n} stars for ${w.label}`,
  clock: (n, w) => `${n}s on ${w.label}`,
  filter: (n, w) => `${n} found in ${w.label}`,
  feed: (n, w) => `${n} in ${w.label}`,
};

export function num(n) {
  return String(Math.round(n * 100) / 100);
}

export function summaryText(spec, w, state) {
  const sources = w.sources.map((id) => byId(spec, id));
  const values = sources.map((src) => metric(src, state.widgets[src.id]));
  const total = values.reduce((a, b) => a + b, 0);
  if (w.formula === "sum") return `${w.prefix}: ${num(total)}`;
  if (w.formula === "breakdown") return `${w.prefix}: ${values.map(num).join(" + ")} = ${num(total)}`;
  return sources.map((src, i) => PHRASE[src.kind](num(values[i]), src)).join("; ");
}

export function byId(spec, id) {
  return spec.widgets.find((w) => w.id === id);
}

// ---------------------------------------------------------------------------------------------
// The reference update: pure and immutable, with structural sharing.

export function update(spec, state, msg) {
  switch (msg.type) {
    case "serverSet":
      return setWidget(state, msg.widget, msg.state);
    case "tick": {
      let next = state;
      for (const w of spec.widgets) {
        const s = state.widgets[w.id];
        if (w.kind === "clock" && s.running) next = setWidget(next, w.id, { ...s, seconds: s.seconds + 1 });
      }
      return next;
    }
    case "notify": {
      const s = state.widgets[msg.widget];
      return setWidget(state, msg.widget, { ...s, entries: [...s.entries, msg.entry] });
    }
    case "snapshot":
      return msg.state;
  }
  const w = byId(spec, msg.widget);
  const s = state.widgets[w.id];
  const next = updateWidget(w, s, msg);
  return next === s ? state : setWidget(state, w.id, next);
}

function setWidget(state, id, s) {
  return { ...state, widgets: { ...state.widgets, [id]: s } };
}

function updateWidget(w, s, msg) {
  switch (w.kind) {
    case "counter":
      if (msg.type === "inc") return { value: Math.min(w.max, s.value + w.step) };
      if (msg.type === "dec") return { value: Math.max(w.min, s.value - w.step) };
      if (msg.type === "reset") return { value: w.start };
      break;
    case "toggles":
      if (msg.type === "toggle") return { on: s.on.map((v, i) => (i === msg.index ? !v : v)) };
      break;
    case "field":
      if (msg.type === "edit") return { text: msg.text };
      break;
    case "todo":
      if (msg.type === "editDraft") return { ...s, draft: msg.text };
      if (msg.type === "add") {
        const text = s.draft.trim();
        if (text === "") return s;
        const id = s.items.reduce((m, it) => Math.max(m, it.id), 0) + 1;
        return { items: [...s.items, { id, text, done: false }], draft: "" };
      }
      if (msg.type === "toggle") return { ...s, items: s.items.map((it) => (it.id === msg.id ? { ...it, done: !it.done } : it)) };
      if (msg.type === "remove") return { ...s, items: s.items.filter((it) => it.id !== msg.id) };
      break;
    case "tabs":
      if (msg.type === "select") return { active: msg.index };
      break;
    case "panel":
      if (msg.type === "toggle") return { open: !s.open };
      break;
    case "choice":
      if (msg.type === "choose") return { ...s, option: msg.option };
      if (msg.type === "editExtra") return { ...s, extra: msg.text };
      break;
    case "amount":
      if (msg.type === "set") return { value: msg.value };
      break;
    case "filter":
      if (msg.type === "edit") return { query: msg.query };
      break;
    case "rating":
      if (msg.type === "rate") return { stars: msg.stars };
      break;
    case "feed":
      if (msg.type === "dismiss") return { entries: s.entries.filter((e) => e.id !== msg.id) };
      break;
    case "clock":
      if (msg.type === "start") return { ...s, running: true };
      if (msg.type === "stop") return { ...s, running: false };
      if (msg.type === "reset") return { seconds: 0, running: false };
      break;
  }
  throw new Error(`widget ${w.id} (${w.kind}) has no message ${msg.type}`);
}

// ---------------------------------------------------------------------------------------------
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

function renderWidget(spec, w, state) {
  const s = state.widgets[w.id];
  return h("section", { "data-key": w.id, "data-role": `widget-${w.kind}` }, h("h2", null, w.label), BODY[w.kind](w, s, spec, state));
}

const BODY = {
  counter: (w, s) => [
    h("output", { "data-role": "value" }, s.value),
    h("button", { "data-role": "dec", disabled: s.value <= w.min }, `-${w.step}`),
    h("button", { "data-role": "inc", disabled: s.value >= w.max }, `+${w.step}`),
    h("button", { "data-role": "reset" }, "Reset"),
  ],
  toggles: (w, s) => [
    h("ul", null, w.items.map((name, i) =>
      h("li", null, h("label", null, h("input", { type: "checkbox", "data-role": "toggle", "data-key": i, checked: s.on[i] }), name)))),
    h("p", { "data-role": "count" }, `${s.on.filter(Boolean).length} of ${w.items.length} on`),
  ],
  field: (w, s) => {
    const error = fieldError(w, s.text);
    return [
      h("input", { type: "text", "data-role": "input", placeholder: w.placeholder, value: s.text }),
      error && h("p", { "data-role": "error" }, error),
    ];
  },
  todo: (w, s) => [
    h("input", { type: "text", "data-role": "draft", placeholder: w.placeholder, value: s.draft }),
    h("button", { "data-role": "add" }, w.addText),
    h("ul", null, s.items.map((it) =>
      h("li", { "data-key": it.id },
        h("input", { type: "checkbox", "data-role": "toggle", checked: it.done }),
        h("span", null, it.text),
        h("button", { "data-role": "remove" }, w.removeText)))),
    h("p", { "data-role": "left" }, `${s.items.filter((it) => !it.done).length} left`),
  ],
  tabs: (w, s) => [
    h("div", { role: "tablist" }, w.tabs.map((t, i) =>
      h("button", { role: "tab", "data-role": "tab", "data-key": i, "aria-selected": i === s.active ? "true" : "false" }, t.title))),
    h("p", { role: "tabpanel", "data-role": "tab-content" }, w.tabs[s.active].content),
  ],
  panel: (w, s) => [
    h("button", { "data-role": "toggle", "aria-expanded": s.open ? "true" : "false" }, s.open ? w.hideText : w.showText),
    s.open && h("p", { "data-role": "body" }, w.body),
  ],
  choice: (w, s) => [
    h("select", { "data-role": "select", value: s.option }, w.options.map((o) => h("option", { value: o.value }, o.label))),
    w.extraFor.includes(s.option) && h("input", { type: "text", "data-role": "extra", placeholder: w.extraPlaceholder, value: s.extra }),
  ],
  amount: (w, s) => [
    h("input", { type: "number", "data-role": "input", value: String(s.value) }),
    h("output", { "data-role": "formatted" }, formatAmount(w.format, s.value)),
  ],
  filter: (w, s) => {
    const shown = matches(w, s.query);
    return [
      h("input", { type: "text", "data-role": "query", placeholder: w.placeholder, value: s.query }),
      h("ul", null, shown.map((it) => h("li", { "data-key": it.id }, it.text))),
      h("p", { "data-role": "matches" }, `${shown.length} matches`),
    ];
  },
  rating: (w, s) => [
    h("div", null, Array.from({ length: w.stars }, (_, i) =>
      h("button", { "data-role": "star", "data-key": i + 1, "aria-pressed": i < s.stars ? "true" : "false" }, i < s.stars ? "★" : "☆"))),
    h("p", { "data-role": "rating-label" }, w.labels[s.stars]),
  ],
  feed: (w, s) => [
    h("ul", null, s.entries.map((e) =>
      h("li", { "data-key": e.id }, h("span", null, e.text), h("button", { "data-role": "dismiss" }, w.dismissText)))),
    s.entries.length === 0 && h("p", { "data-role": "empty" }, w.emptyText),
  ],
  clock: (w, s) => [
    h("output", { "data-role": "time" }, formatTime(s.seconds)),
    h("button", { "data-role": "start", disabled: s.running }, w.startText),
    h("button", { "data-role": "stop", disabled: !s.running }, w.stopText),
    h("button", { "data-role": "reset" }, w.resetText),
  ],
  summary: (w, _s, spec, state) => [h("p", { "data-role": "summary" }, summaryText(spec, w, state))],
};

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
  return open + node.children.map(toHTML).join("") + `</${node.tag}>`;
}

// ---------------------------------------------------------------------------------------------
// External events. Each builder is a pure function of the spec, the current reference state
// and a salt, so the serve panel can produce fresh events and the script stays deterministic.

export function serverState(spec, state, id, salt) {
  const w = byId(spec, id);
  const s = state.widgets[id];
  const r = rng("server", spec.options.seed, id, salt);
  return freshState(w, s, r, false);
}

export function notifyEntry(spec, state, id, salt) {
  const r = rng("notify", spec.options.seed, id, salt);
  const s = state.widgets[id];
  const nextId = s.entries.reduce((m, e) => Math.max(m, e.id), 0) + 1;
  return { id: nextId, text: r.pick(NEWS) };
}

// The external events the serve panel offers, each with the widgets it can target (if any) and
// a builder of its message from the current reference state.
export function panelEvents(spec) {
  const ids = (pred) => spec.widgets.filter(pred).map((w) => w.id);
  return [
    { name: "serverSet", targets: ids((w) => w.kind !== "summary"),
      make: (state, target, salt) => ({ type: "serverSet", widget: target, state: serverState(spec, state, target, salt) }) },
    { name: "tick", make: () => ({ type: "tick" }) },
    { name: "notify", targets: ids((w) => w.kind === "feed"),
      make: (state, target, salt) => ({ type: "notify", widget: target, entry: notifyEntry(spec, state, target, salt) }) },
    { name: "snapshot", make: (state, _target, salt) => ({ type: "snapshot", state: snapshot(spec, state, salt) }) },
  ];
}

export function snapshot(spec, state, salt) {
  const r = rng("snapshot", spec.options.seed, salt);
  const widgets = {};
  for (const w of spec.widgets) {
    if (w.kind === "summary") continue;
    widgets[w.id] = freshState(w, state.widgets[w.id], r, true);
  }
  return { widgets };
}

// Reorder part of a keyed list: reverse a slice of at least two items, so some keep their place
// and some move. Lists of fewer than two items are left as they are.
function partlyReorder(list, r) {
  if (list.length < 2) return list.slice();
  const a = r.int(0, list.length - 2);
  const b = r.int(a + 1, list.length - 1);
  return [...list.slice(0, a), ...list.slice(a, b + 1).reverse(), ...list.slice(b + 1)];
}

// A new state for one widget, as a server would send it. With `reorder`, keyed lists keep their
// items (ids) but are partly reordered; otherwise they are replaced in part.
function freshState(w, s, r, reorder) {
  switch (w.kind) {
    case "counter": {
      const steps = Math.floor((w.max - w.min) / w.step);
      let value = w.min + w.step * r.int(0, steps);
      if (value === s.value) value = value === w.max ? w.min : Math.min(w.max, value + w.step);
      return { value };
    }
    case "toggles": {
      const on = s.on.map((v) => (r.chance(0.5) ? !v : v));
      if (on.every((v, i) => v === s.on[i])) on[0] = !on[0];
      return { on };
    }
    case "field": {
      const pool = [w.rule.sample ?? "Hello", "x", "", "Server value", "ok", "abc123"];
      let text = r.pick(pool);
      if (text === s.text) text = text + "1";
      return { text };
    }
    case "todo": {
      const max = s.items.reduce((m, it) => Math.max(m, it.id), 0);
      const used = new Set(s.items.map((it) => it.text));
      let items = s.items.map((it) => (r.chance(0.3) ? { ...it, done: !it.done } : it));
      if (reorder) items = partlyReorder(items, r);
      else if (items.length > 2) items = items.filter((_, i) => i !== r.int(0, items.length - 1));
      items = [...items, { id: max + 1, text: todoText(r, used), done: false }];
      return { items, draft: "" };
    }
    case "tabs":
      return { active: (s.active + r.int(1, w.tabs.length - 1)) % w.tabs.length };
    case "panel":
      return { open: !s.open };
    case "choice": {
      const others = w.options.filter((o) => o.value !== s.option);
      const option = r.pick(others).value;
      return { option, extra: w.extraFor.includes(option) ? r.pick(["from the server", "as agreed", "see notes"]) : s.extra };
    }
    case "amount":
      return { value: (s.value + r.int(1, 500)) % 1000 };
    case "filter": {
      const it = r.pick(w.items);
      return { query: it.text.slice(0, r.int(1, 2)).toLowerCase() };
    }
    case "rating": {
      let stars = r.int(0, w.stars);
      if (stars === s.stars) stars = (stars + 1) % (w.stars + 1);
      return { stars };
    }
    case "feed": {
      const max = s.entries.reduce((m, e) => Math.max(m, e.id), 0);
      let entries = reorder ? partlyReorder(s.entries, r) : s.entries.slice(1);
      entries = [...entries, { id: max + 1, text: r.pick(NEWS) }];
      return { entries };
    }
    case "clock":
      return { seconds: r.int(0, 600), running: !s.running };
  }
  throw new Error(`no fresh state for ${w.kind}`);
}

// ---------------------------------------------------------------------------------------------
// The interaction script: the same for every framework.
//
// Steps:
//   { do: "mount" } | { do: "dispose" }
//   { do: "click", target, msg }               click the element
//   { do: "type", target, value, msg }         set an input's value to `value` (one character
//                                              more than before) and fire `input`
//   { do: "select", target, value, msg }       choose an option and fire `input` and `change`
//   { do: "dispatch", msg }                    an external event through the contract
// A target is a CSS selector built from the stable data-key/data-role attributes, so the serve
// panel can drive any scenario. `msg` is the reference message the step stands for.

export function makeScript(spec) {
  const steps = [];
  let state = spec.initialState;
  const push = (step) => {
    steps.push(step);
    if (step.msg) state = update(spec, state, step.msg);
  };
  const ctx = {
    get state() { return state; },
    push,
  };
  push({ do: "mount", label: "mount" });

  // 2. Every widget, 2–4 user actions.
  for (const w of spec.widgets) {
    if (w.kind === "summary") continue;
    const r = rng("script", spec.options.seed, w.id);
    ACT[w.kind](w, ctx, r, "first");
  }

  // 3. External events.
  const r = rng("external", spec.options.seed);
  const plain = spec.widgets.filter((w) => w.kind !== "summary");
  const targets = r.sample(plain, Math.min(3, plain.length));
  targets.sort((a, b) => spec.widgets.indexOf(a) - spec.widgets.indexOf(b));
  for (const w of targets) {
    push({ do: "dispatch", label: `serverSet ${w.id}`, msg: { type: "serverSet", widget: w.id, state: serverState(spec, state, w.id, `script-${w.id}`) } });
  }
  for (let i = 0; i < 3; i++) push({ do: "dispatch", label: "tick", msg: { type: "tick" } });
  const feeds = spec.widgets.filter((w) => w.kind === "feed");
  for (let i = 0; i < 2 && feeds.length; i++) {
    const f = feeds[i % feeds.length];
    push({ do: "dispatch", label: `notify ${f.id}`, msg: { type: "notify", widget: f.id, entry: notifyEntry(spec, state, f.id, `script-${i}`) } });
  }

  // 4. A reorder through a snapshot.
  push({ do: "dispatch", label: "snapshot", msg: { type: "snapshot", state: snapshot(spec, state, "script") } });

  // 5. A final round on widgets the snapshot changed (all of them): the list widgets first,
  // then a few others.
  const lists = plain.filter((w) => ["todo", "feed", "filter"].includes(w.kind));
  const others = r.sample(plain.filter((w) => !lists.includes(w)), Math.min(3, plain.length - lists.length));
  for (const w of [...lists, ...others].sort((a, b) => spec.widgets.indexOf(a) - spec.widgets.indexOf(b))) {
    ACT[w.kind](w, ctx, rng("final", spec.options.seed, w.id), "final");
  }

  push({ do: "dispose", label: "dispose" });
  return steps;
}

// The selector of [data-role=role] inside widget's section, optionally with its own data-key
// (`key`) or inside a keyed list item (`item`).
function T(widget, role, { key, item } = {}) {
  const own = `[data-role="${role}"]${key != null ? `[data-key="${key}"]` : ""}`;
  return `[data-key="${widget}"] ${item != null ? `[data-key="${item}"] ` : ""}${own}`;
}

function typeInto(ctx, w, target, from, to, makeMsg) {
  // Type `to` character by character, starting from the current value `from`: if `to` does
  // not extend `from`, the field is first cleared (as one input event), like selecting all and
  // typing over it.
  let current = from;
  if (!to.startsWith(from)) {
    current = "";
    if (from !== "") ctx.push({ do: "type", label: `${w.id} clear the input`, target, value: "", msg: makeMsg("") });
  }
  for (let i = current.length; i < to.length; i++) {
    const value = to.slice(0, i + 1);
    ctx.push({ do: "type", label: `${w.id} type "${value}"`, target, value, msg: makeMsg(value) });
  }
}

const ACT = {
  counter(w, ctx, r, round) {
    const s = () => ctx.state.widgets[w.id];
    const click = (role) => ctx.push({ do: "click", label: `${w.id} ${role}`, target: T(w.id, role), msg: { widget: w.id, type: role } });
    if (round === "first") {
      const n = r.int(2, 3);
      for (let i = 0; i < n; i++) click(s().value < w.max ? "inc" : "dec");
      click("dec");
      if (r.chance(0.5)) click("reset");
    } else {
      click(s().value > w.min ? "dec" : "inc");
    }
  },
  toggles(w, ctx, r, round) {
    const n = round === "first" ? r.int(2, 3) : 1;
    for (let k = 0; k < n; k++) {
      const i = r.int(0, w.items.length - 1);
      ctx.push({ do: "click", label: `${w.id} toggle ${w.items[i]}`, target: T(w.id, "toggle", { key: String(i) }), msg: { widget: w.id, type: "toggle", index: i } });
    }
  },
  field(w, ctx, r, round) {
    const s = ctx.state.widgets[w.id];
    let to;
    const rule = w.rule;
    if (rule.type === "required") to = round === "first" ? (s.text === "" ? "ok" : "") : s.text === "" ? "yes" : "";
    else if (rule.type === "minLength") to = "abcdefgh".slice(0, rule.min + 1);
    else to = rule.bad ? rule.sample + rule.bad : rule.sample;
    if (to === s.text) to = s.text + "z";
    typeInto(ctx, w, T(w.id, "input"), s.text, to, (text) => ({ widget: w.id, type: "edit", text }));
  },
  todo(w, ctx, r, round) {
    const s = () => ctx.state.widgets[w.id];
    if (round === "first") {
      const text = r.pick(["Buy milk", "Ship it", "Call Ana", "Read docs", "Plan trip", "Fix bike"]);
      typeInto(ctx, w, T(w.id, "draft"), s().draft, text, (t) => ({ widget: w.id, type: "editDraft", text: t }));
      ctx.push({ do: "click", label: `${w.id} add`, target: T(w.id, "add"), msg: { widget: w.id, type: "add" } });
    }
    const items = s().items;
    const a = r.pick(items);
    ctx.push({ do: "click", label: `${w.id} toggle item ${a.id}`, target: T(w.id, "toggle", { item: String(a.id) }), msg: { widget: w.id, type: "toggle", id: a.id } });
    const b = r.pick(s().items);
    ctx.push({ do: "click", label: `${w.id} remove item ${b.id}`, target: T(w.id, "remove", { item: String(b.id) }), msg: { widget: w.id, type: "remove", id: b.id } });
  },
  tabs(w, ctx, r) {
    for (let k = 0; k < 2; k++) {
      const cur = ctx.state.widgets[w.id].active;
      const i = (cur + r.int(1, w.tabs.length - 1)) % w.tabs.length;
      ctx.push({ do: "click", label: `${w.id} select tab ${w.tabs[i].title}`, target: T(w.id, "tab", { key: String(i) }), msg: { widget: w.id, type: "select", index: i } });
    }
  },
  panel(w, ctx, r, round) {
    const n = round === "first" ? r.int(2, 3) : 1;
    for (let k = 0; k < n; k++) ctx.push({ do: "click", label: `${w.id} toggle panel`, target: T(w.id, "toggle"), msg: { widget: w.id, type: "toggle" } });
  },
  choice(w, ctx, r, round) {
    const choose = (option) => ctx.push({ do: "select", label: `${w.id} choose ${option}`, target: T(w.id, "select"), value: option, msg: { widget: w.id, type: "choose", option } });
    const withExtra = w.extraFor[w.extraFor.length - 1];
    if (ctx.state.widgets[w.id].option !== withExtra) choose(withExtra);
    const s = ctx.state.widgets[w.id];
    const text = round === "first" ? r.pick(["Gift wrap", "By noon", "Ring twice", "Blue one"]) : s.extra + "!";
    typeInto(ctx, w, T(w.id, "extra"), s.extra, text, (t) => ({ widget: w.id, type: "editExtra", text: t }));
    if (round === "first") choose(w.options.find((o) => !w.extraFor.includes(o.value)).value);
  },
  amount(w, ctx, r, round) {
    // Append digits to the current value, so the number input never goes through "".
    const from = String(ctx.state.widgets[w.id].value);
    const to = from + String(r.int(0, 9)) + (round === "first" ? String(r.int(0, 9)) : "");
    typeInto(ctx, w, T(w.id, "input"), from, to, (t) => ({ widget: w.id, type: "set", value: Number(t) }));
  },
  filter(w, ctx, r) {
    const s = ctx.state.widgets[w.id];
    const it = r.pick(w.items);
    const to = it.text.slice(0, r.int(2, 3)).toLowerCase();
    typeInto(ctx, w, T(w.id, "query"), s.query, to, (query) => ({ widget: w.id, type: "edit", query }));
  },
  rating(w, ctx, r, round) {
    const n = round === "first" ? 2 : 1;
    for (let k = 0; k < n; k++) {
      let stars = r.int(1, w.stars);
      if (stars === ctx.state.widgets[w.id].stars) stars = stars === 1 ? 2 : stars - 1;
      ctx.push({ do: "click", label: `${w.id} rate ${stars}`, target: T(w.id, "star", { key: String(stars) }), msg: { widget: w.id, type: "rate", stars } });
    }
  },
  feed(w, ctx, r, round) {
    const n = round === "first" ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const entries = ctx.state.widgets[w.id].entries;
      if (entries.length === 0) return;
      const e = r.pick(entries);
      ctx.push({ do: "click", label: `${w.id} dismiss ${e.id}`, target: T(w.id, "dismiss", { item: String(e.id) }), msg: { widget: w.id, type: "dismiss", id: e.id } });
    }
  },
  clock(w, ctx, r, round) {
    const click = (role) => ctx.push({ do: "click", label: `${w.id} ${role}`, target: T(w.id, role), msg: { widget: w.id, type: role } });
    const running = () => ctx.state.widgets[w.id].running;
    if (round === "first") {
      if (r.chance(0.5)) click("reset");
      click("start");
    } else {
      click(running() ? "stop" : "start");
      click("reset");
    }
  },
};
