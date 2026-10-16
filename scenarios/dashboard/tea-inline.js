// The dashboard as tea-inline, a prototype strategy (see frameworks/tea-inline/README.md).
//
// The emitter plays the compiler of a TEA app: it writes what partial evaluation of the
// reducer would produce, with messages erased.
// - One factory per widget kind (src/widgets/<kind>.js), configured per widget (label,
//   limits, items, rules, formats, summary sources). The factory builds the DOM once and
//   defines the kind's bindings, grouped by the model field they read.
// - Every `case` arm of the kind's `update` becomes an action: a DOM event calls it directly,
//   it writes the fields that arm changes and schedules exactly the bindings that read them,
//   plus the summaries reading that widget (`readers[id]`) when it writes a field they read.
// - The app is a table of (factory, config) in page order. The model is the TEA model,
//   `{ widgets: { [id]: state } }`, made by `init()` on each mount; each factory takes its slice
//   by id and edits it in place (the compiler proved it unshared).
// - External events stay messages: `receive(msg)` is the part of `update` still reached by a
//   message (serverSet, tick, notify, snapshot), routed to the widget's own arms.

import { templateFiles } from "../../frameworks/tea-inline/framework.js";
import { literal, tplText, camelCase } from "../../frameworks/shared/jsx.js";

export const framework = "tea-inline";

export const params = {};

// The config each kind takes, beyond id and label.
const PARAMS = {
  counter: ["step", "min", "max", "start"],
  toggles: ["items"],
  field: ["placeholder", "message", "invalid"],
  todo: ["placeholder", "addText", "removeText"],
  tabs: ["tabs"],
  panel: ["showText", "hideText", "body"],
  choice: ["options", "extraFor", "extraPlaceholder"],
  amount: ["format"],
  filter: ["items", "placeholder"],
  rating: ["stars", "labels"],
  feed: ["emptyText", "dismissText"],
  clock: ["startText", "stopText", "resetText"],
  summary: [],
};

// Config values that are code, specialized from the widget's rules.
const FUNCTIONS = {
  invalid(w) {
    if (w.rule.type === "required") return `(text) => text.trim() === ""`;
    if (w.rule.type === "minLength") return `(text) => text.length < ${w.rule.min}`;
    return `(text) => !/${w.rule.pattern}/.test(text)`;
  },
  format(w) {
    const f = w.format;
    const fixed = `value.toFixed(${f.decimals})`;
    if (f.type === "currency") return `(value) => ${JSON.stringify(f.symbol)} + ${fixed}`;
    if (f.type === "percent") return `(value) => ${fixed} + "%"`;
    return `(value) => ${fixed} + ${JSON.stringify(" " + f.unit)}`;
  },
};

const VALUES = {
  message: (w) => w.rule.message,
};

// ---------------------------------------------------------------------------------------------
// Widget factories, one per kind: the runtime helpers each needs, and its body.

const FACTORIES = {
  counter: {
    uses: ["el", "text", "prop", "on", "schedule"],
    code: `export function counter(parent, model, c, readers) {
  const s = model[c.id];
  const root = section(parent, c, "counter");
  const value = el("output", root, { "data-role": "value" });
  const decButton = el("button", root, { "data-role": "dec" }, "-" + c.step);
  const incButton = el("button", root, { "data-role": "inc" }, "+" + c.step);
  const resetButton = el("button", root, { "data-role": "reset" }, "Reset");

  // The bindings reading \`value\`.
  const onValue = [
    () => text(value, s.value),
    () => prop(decButton, "disabled", s.value <= c.min),
    () => prop(incButton, "disabled", s.value >= c.max),
    readers[c.id],
  ];

  // The arms of update: dec, inc, reset.
  on(decButton, "click", () => {
    s.value = Math.max(c.min, s.value - c.step);
    schedule(onValue);
  });
  on(incButton, "click", () => {
    s.value = Math.min(c.max, s.value + c.step);
    schedule(onValue);
  });
  on(resetButton, "click", () => {
    s.value = c.start;
    schedule(onValue);
  });

  schedule(onValue);
  return { load: loader(s, onValue) };
}`,
  },

  toggles: {
    uses: ["el", "text", "prop", "on", "schedule"],
    code: `export function toggles(parent, model, c, readers) {
  const s = model[c.id];
  const root = section(parent, c, "toggles");
  const ul = el("ul", root);
  // One binding per checkbox, each reading its own \`on[i]\`.
  const boxes = c.items.map((name, i) => {
    const label = el("label", el("li", ul));
    const box = el("input", label, { type: "checkbox", "data-role": "toggle", "data-key": i });
    label.append(name);
    on(box, "change", () => toggle(i));
    return () => prop(box, "checked", s.on[i]);
  });
  const count = el("p", root, { "data-role": "count" });
  const onCount = [() => text(count, \`\${s.on.filter(Boolean).length} of \${c.items.length} on\`), readers[c.id]];

  // The arm of update: toggle(i) writes \`on[i]\`.
  const toggle = (i) => {
    s.on[i] = !s.on[i];
    schedule(boxes[i], onCount);
  };

  schedule(boxes, onCount);
  return { load: loader(s, [boxes, onCount]) };
}`,
  },

  field: {
    uses: ["el", "prop", "on", "when", "schedule"],
    code: `export function field(parent, model, c, readers) {
  const s = model[c.id];
  const root = section(parent, c, "field");
  const input = el("input", root, { type: "text", "data-role": "input", placeholder: c.placeholder });
  const error = when(root, () => el("p", null, { "data-role": "error" }, c.message));

  const onText = [() => prop(input, "value", s.text), () => error(c.invalid(s.text))];

  // The arm of update: edit(text).
  on(input, "input", () => {
    s.text = input.value;
    schedule(onText);
  });

  schedule(onText);
  return { load: loader(s, onText) };
}`,
  },

  todo: {
    uses: ["el", "text", "prop", "on", "list", "schedule"],
    code: `export function todo(parent, model, c, readers) {
  const s = model[c.id];
  const root = section(parent, c, "todo");
  const draft = el("input", root, { type: "text", "data-role": "draft", placeholder: c.placeholder });
  const addButton = el("button", root, { "data-role": "add" }, c.addText);
  const items = list(el("ul", root), () => s.items, (item) => item.id, (item) => {
    const node = el("li", null, { "data-key": item.id });
    const box = el("input", node, { type: "checkbox", "data-role": "toggle" });
    const label = el("span", node);
    on(box, "change", () => toggle(item.id));
    on(el("button", node, { "data-role": "remove" }, c.removeText), "click", () => remove(item.id));
    return {
      node,
      set(item) {
        prop(box, "checked", item.done);
        text(label, item.text);
      },
    };
  });
  const left = el("p", root, { "data-role": "left" });

  const onDraft = () => prop(draft, "value", s.draft);
  const onItems = [() => text(left, \`\${s.items.filter((item) => !item.done).length} left\`), readers[c.id]];

  // The arms of update: editDraft, add, toggle(id), remove(id). The list edits tell the list
  // which rows changed.
  on(draft, "input", () => {
    s.draft = draft.value;
    schedule(onDraft);
  });
  on(addButton, "click", () => {
    const title = s.draft.trim();
    if (!title) return;
    const item = { id: s.items.reduce((max, item) => Math.max(max, item.id), 0) + 1, text: title, done: false };
    s.items.push(item);
    s.draft = "";
    items.add(item);
    schedule(onDraft, onItems);
  });
  const toggle = (id) => {
    const item = s.items.find((item) => item.id === id);
    item.done = !item.done;
    items.patch(item);
    schedule(onItems);
  };
  const remove = (id) => {
    s.items.splice(s.items.findIndex((item) => item.id === id), 1);
    items.drop(id);
    schedule(onItems);
  };

  schedule(onDraft, items, onItems);
  return { load: loader(s, [onDraft, items, onItems]) };
}`,
  },

  tabs: {
    uses: ["el", "text", "attr", "on", "schedule"],
    code: `export function tabs(parent, model, c, readers) {
  const s = model[c.id];
  const root = section(parent, c, "tabs");
  const bar = el("div", root, { role: "tablist" });
  // Every tab button and the content read \`active\`.
  const onActive = c.tabs.map((tab, i) => {
    const button = el("button", bar, { role: "tab", "data-role": "tab", "data-key": i }, tab.title);
    // The arm of update: select(i).
    on(button, "click", () => {
      s.active = i;
      schedule(onActive);
    });
    return () => attr(button, "aria-selected", String(s.active === i));
  });
  const content = el("p", root, { role: "tabpanel", "data-role": "tab-content" });
  onActive.push(() => text(content, c.tabs[s.active].content));

  schedule(onActive);
  return { load: loader(s, onActive) };
}`,
  },

  panel: {
    uses: ["el", "text", "attr", "on", "when", "schedule"],
    code: `export function panel(parent, model, c, readers) {
  const s = model[c.id];
  const root = section(parent, c, "panel");
  const button = el("button", root, { "data-role": "toggle" });
  const body = when(root, () => el("p", null, { "data-role": "body" }, c.body));

  const onOpen = [
    () => {
      attr(button, "aria-expanded", String(s.open));
      text(button, s.open ? c.hideText : c.showText);
    },
    () => body(s.open),
  ];

  // The arm of update: toggle.
  on(button, "click", () => {
    s.open = !s.open;
    schedule(onOpen);
  });

  schedule(onOpen);
  return { load: loader(s, onOpen) };
}`,
  },

  choice: {
    uses: ["el", "prop", "on", "when", "schedule"],
    code: `export function choice(parent, model, c, readers) {
  const s = model[c.id];
  const root = section(parent, c, "choice");
  const select = el("select", root, { "data-role": "select" });
  for (const option of c.options) el("option", select, { value: option.value }, option.label);
  const extra = when(root, () => {
    const input = el("input", null, { type: "text", "data-role": "extra", placeholder: c.extraPlaceholder });
    // The arm of update: editExtra(text).
    on(input, "input", () => {
      s.extra = input.value;
      schedule(onExtra);
    });
    return input;
  });

  // The extra input reads \`option\` (whether it is shown) and \`extra\`.
  const onExtra = () => {
    const input = extra(c.extraFor.includes(s.option));
    if (input) prop(input, "value", s.extra);
  };
  const onOption = [() => prop(select, "value", s.option), onExtra];

  // The arm of update: choose(option).
  on(select, "change", () => {
    s.option = select.value;
    schedule(onOption);
  });

  schedule(onOption);
  return { load: loader(s, onOption) };
}`,
  },

  amount: {
    uses: ["el", "text", "prop", "on", "schedule"],
    code: `export function amount(parent, model, c, readers) {
  const s = model[c.id];
  const root = section(parent, c, "amount");
  const input = el("input", root, { type: "number", "data-role": "input" });
  const output = el("output", root, { "data-role": "formatted" });

  const onValue = [() => prop(input, "value", String(s.value)), () => text(output, c.format(s.value)), readers[c.id]];

  // The arm of update: set(n), sent only while the input holds a number.
  on(input, "input", () => {
    const value = input.valueAsNumber;
    if (Number.isNaN(value)) return;
    s.value = value;
    schedule(onValue);
  });

  schedule(onValue);
  return { load: loader(s, onValue) };
}`,
  },

  filter: {
    uses: ["el", "text", "prop", "on", "list", "schedule"],
    code: `export function filter(parent, model, c, readers) {
  const s = model[c.id];
  const root = section(parent, c, "filter");
  const query = el("input", root, { type: "text", "data-role": "query", placeholder: c.placeholder });
  const shown = () => {
    const q = s.query.toLowerCase();
    return c.items.filter((item) => item.text.toLowerCase().includes(q));
  };
  // A derived list: a new array on every change, so the list reconciles it by key.
  const items = list(el("ul", root), shown, (item) => item.id, (item) => ({
    node: el("li", null, { "data-key": item.id }, item.text),
    set() {},
  }));
  const matches = el("p", root, { "data-role": "matches" });

  const onQuery = [() => prop(query, "value", s.query), items, () => text(matches, \`\${shown().length} matches\`), readers[c.id]];

  // The arm of update: edit(query).
  on(query, "input", () => {
    s.query = query.value;
    schedule(onQuery);
  });

  schedule(onQuery);
  return { load: loader(s, onQuery) };
}`,
  },

  rating: {
    uses: ["el", "text", "attr", "on", "schedule"],
    code: `export function rating(parent, model, c, readers) {
  const s = model[c.id];
  const root = section(parent, c, "rating");
  const row = el("div", root);
  // Every star and the label read \`stars\`.
  const onStars = Array.from({ length: c.stars }, (_, i) => {
    const n = i + 1;
    const button = el("button", row, { "data-role": "star", "data-key": n });
    // The arm of update: rate(n).
    on(button, "click", () => {
      s.stars = n;
      schedule(onStars);
    });
    return () => {
      attr(button, "aria-pressed", String(n <= s.stars));
      text(button, n <= s.stars ? "★" : "☆");
    };
  });
  const label = el("p", root, { "data-role": "rating-label" });
  onStars.push(() => text(label, c.labels[s.stars]), readers[c.id]);

  schedule(onStars);
  return { load: loader(s, onStars) };
}`,
  },

  feed: {
    uses: ["el", "text", "on", "when", "list", "schedule"],
    code: `export function feed(parent, model, c, readers) {
  const s = model[c.id];
  const root = section(parent, c, "feed");
  const entries = list(el("ul", root), () => s.entries, (entry) => entry.id, (entry) => {
    const node = el("li", null, { "data-key": entry.id });
    const label = el("span", node);
    on(el("button", node, { "data-role": "dismiss" }, c.dismissText), "click", () => dismiss(entry.id));
    return { node, set: (entry) => text(label, entry.text) };
  });
  const empty = when(root, () => el("p", null, { "data-role": "empty" }, c.emptyText));

  const onEntries = [() => empty(s.entries.length === 0), readers[c.id]];

  // The arm of update: dismiss(id).
  const dismiss = (id) => {
    s.entries.splice(s.entries.findIndex((entry) => entry.id === id), 1);
    entries.drop(id);
    schedule(onEntries);
  };

  schedule(entries, onEntries);
  return {
    load: loader(s, [entries, onEntries]),
    // The external arm: notify(entry).
    notify(entry) {
      s.entries.push(entry);
      entries.add(entry);
      schedule(onEntries);
    },
  };
}`,
  },

  clock: {
    uses: ["el", "text", "prop", "on", "schedule"],
    code: `const formatTime = (seconds) => \`\${Math.floor(seconds / 60)}:\${String(seconds % 60).padStart(2, "0")}\`;

export function clock(parent, model, c, readers) {
  const s = model[c.id];
  const root = section(parent, c, "clock");
  const time = el("output", root, { "data-role": "time" });
  const startButton = el("button", root, { "data-role": "start" }, c.startText);
  const stopButton = el("button", root, { "data-role": "stop" }, c.stopText);
  const resetButton = el("button", root, { "data-role": "reset" }, c.resetText);

  const onSeconds = [() => text(time, formatTime(s.seconds)), readers[c.id]];
  const onRunning = [() => prop(startButton, "disabled", s.running), () => prop(stopButton, "disabled", !s.running)];

  // The arms of update: start, stop, reset.
  on(startButton, "click", () => {
    s.running = true;
    schedule(onRunning);
  });
  on(stopButton, "click", () => {
    s.running = false;
    schedule(onRunning);
  });
  on(resetButton, "click", () => {
    s.seconds = 0;
    s.running = false;
    schedule(onSeconds, onRunning);
  });

  schedule(onSeconds, onRunning);
  return {
    load: loader(s, [onSeconds, onRunning]),
    // The external arm: tick.
    tick() {
      if (!s.running) return;
      s.seconds++;
      schedule(onSeconds);
    },
  };
}`,
  },

  summary: {
    uses: ["el", "text", "schedule"],
    widget: ["section"],
    code: `// A derived line: \`c.text(model)\` reads other widgets' state. It adds itself to the
// \`readers\` of each source, which schedule it when they write a field it reads.
export function summary(parent, model, c, readers) {
  const root = section(parent, c, "summary");
  const line = el("p", root, { "data-role": "summary" });
  const show = () => text(line, c.text(model));
  for (const id of c.reads) readers[id].push(show);
  schedule(show);
}`,
  },
};

const WIDGET_FILE = `import { el, schedule } from "../runtime.js";

// The section every widget renders into: its key, its kind and its heading.
export function section(parent, c, kind) {
  const root = el("section", parent, { "data-key": c.id, "data-role": "widget-" + kind });
  el("h2", root, null, c.label);
  return root;
}

// serverSet and snapshot: replace the widget's state and run every binding it has.
export const loader = (s, all) => (next) => {
  Object.assign(s, next);
  schedule(all);
};
`;

function factoryFile(kind) {
  const f = FACTORIES[kind];
  return `import { ${f.uses.join(", ")} } from "../runtime.js";
import { ${(f.widget || ["section", "loader"]).join(", ")} } from "./widget.js";

${f.code}
`;
}

// ---------------------------------------------------------------------------------------------
// Summaries: a text function per summary widget, reading its sources' slices of the model.

function metricExpr(src, slice, itemsName) {
  switch (src.kind) {
    case "counter": case "amount": return `${slice}.value`;
    case "toggles": return `${slice}.on.filter(Boolean).length`;
    case "todo": return `${slice}.items.filter((item) => !item.done).length`;
    case "rating": return `${slice}.stars`;
    case "clock": return `${slice}.seconds`;
    case "filter": return `${itemsName}.filter((item) => item.text.toLowerCase().includes(${slice}.query.toLowerCase())).length`;
    case "feed": return `${slice}.entries.length`;
  }
  throw new Error(`a summary cannot read ${src.kind}`);
}

const PHRASES = {
  counter: (v, w) => `${tplText(w.label)}: ${v}`,
  amount: (v, w) => `${tplText(w.label)}: ${v}`,
  toggles: (v, w) => `${v} on in ${tplText(w.label)}`,
  todo: (v, w) => `${v} left in ${tplText(w.label)}`,
  rating: (v, w) => `${v} stars for ${tplText(w.label)}`,
  clock: (v, w) => `${v}s on ${tplText(w.label)}`,
  filter: (v, w) => `${v} found in ${tplText(w.label)}`,
  feed: (v, w) => `${v} in ${tplText(w.label)}`,
};

const byId = (spec, id) => spec.widgets.find((x) => x.id === id);
const itemsName = (w) => `${camelCase(w.label)}Items`;

// The text function of a summary, as source, indented by `indent`.
function summaryText(spec, w, indent) {
  const sources = w.sources.map((id) => byId(spec, id));
  const names = [];
  const lines = sources.map((src) => {
    let name = camelCase(src.label);
    while (names.includes(name)) name += "2";
    names.push(name);
    return `const ${name} = ${metricExpr(src, `w.${src.id}`, itemsName(src))};`;
  });
  // Only amounts can hold fractions; their terms (and any total including them) are rounded.
  const decimal = sources.map((src) => src.kind === "amount");
  const show = (i) => (decimal[i] ? `\${formatNumber(${names[i]})}` : `\${${names[i]}}`);
  const total = decimal.some(Boolean) ? `formatNumber(${names.join(" + ")})` : names.join(" + ");
  let text;
  if (w.formula === "sum") text = `${tplText(w.prefix)}: \${${total}}`;
  else if (w.formula === "breakdown") text = `${tplText(w.prefix)}: ${names.map((_, i) => show(i)).join(" + ")} = \${${total}}`;
  else text = sources.map((src, i) => PHRASES[src.kind](show(i), src)).join("; ");
  const body = [...lines, `return \`${text}\`;`].map((l) => indent + "  " + l).join("\n");
  return `(w) => {\n${body}\n${indent}}`;
}

// ---------------------------------------------------------------------------------------------
// The app: init, the widgets with their config, and the external arms of update.

function appFile(spec) {
  const kinds = [...new Set(spec.widgets.map((w) => w.kind))];
  const summaries = spec.widgets.filter((w) => w.kind === "summary");
  const read = new Set(summaries.flatMap((w) => w.sources));
  const readFilters = spec.widgets.filter((w) => read.has(w.id) && w.kind === "filter");
  const needsFormat = summaries.some((w) => w.sources.some((id) => byId(spec, id).kind === "amount"));

  const consts = readFilters.map((w) => `const ${itemsName(w)} = ${literal(w.items)};`);
  if (needsFormat) {
    consts.push(`// Round to at most two decimals for display.
function formatNumber(n) {
  return String(Math.round(n * 100) / 100);
}`);
  }

  const table = spec.widgets.map((w) => {
    const ind = "    ";
    const config = [`id: "${w.id}"`, `label: ${JSON.stringify(w.label)}`];
    for (const name of PARAMS[w.kind]) {
      if (FUNCTIONS[name]) config.push(`${name}: ${FUNCTIONS[name](w)}`);
      else if (VALUES[name]) config.push(`${name}: ${literal(VALUES[name](w), ind)}`);
      else if (w.kind === "filter" && name === "items" && read.has(w.id)) config.push(`items: ${itemsName(w)}`);
      else config.push(`${name}: ${literal(w[name], ind)}`);
    }
    if (w.kind === "summary") {
      config.push(`reads: ${literal(w.sources)}`);
      config.push(`text: ${summaryText(spec, w, ind)}`);
    }
    return `  [${w.kind}, {\n${config.map((c) => ind + c + ",").join("\n")}\n  }],`;
  });

  const clocks = spec.widgets.filter((w) => w.kind === "clock");
  const cases = [`      case "serverSet":
        views[msg.widget].load(msg.state);
        break;`];
  if (clocks.length) {
    cases.push(`      case "tick":
${clocks.map((w) => `        views.${w.id}.tick();`).join("\n")}
        break;`);
  }
  if (spec.widgets.some((w) => w.kind === "feed")) {
    cases.push(`      case "notify":
        views[msg.widget].notify(msg.entry);
        break;`);
  }
  cases.push(`      case "snapshot":
        for (const id in msg.state.widgets) views[id].load(msg.state.widgets[id]);
        break;`);

  const imports = [`import { el, flush, cancel } from "./runtime.js";`,
    ...kinds.map((k) => `import { ${k} } from "./widgets/${k}.js";`)];
  const readers = Object.fromEntries(spec.widgets.filter((w) => read.has(w.id)).map((w) => [w.id, []]));

  return `${imports.join("\n")}
${consts.length ? "\n" + consts.join("\n\n") + "\n" : ""}
// The initial model (TEA's \`init\`), fresh for every mount.
function init() {
  return ${literal(spec.initialState, "  ")};
}

// The page: every widget in order, as its kind's factory and the widget's own config.
const WIDGETS = [
${table.join("\n")}
];

export function start(root) {
  const model = init().widgets;
  const board = el("div", root, { "data-role": "dashboard" });
  // For each widget a summary reads, the summaries' bindings: the widget schedules them when it
  // writes a field they read.
  const readers = ${literal(readers, "  ")};
  // Each widget's handle: \`load\` for serverSet and snapshot, and its external arms.
  const views = {};
  for (const [factory, c] of WIDGETS) views[c.id] = factory(board, model, c, readers);
  flush();

  // The arms of update still reached by a message: external events.
  function receive(msg) {
    switch (msg.type) {
${cases.join("\n")}
    }
  }

  function stop() {
    cancel();
    board.remove();
  }

  return { receive, stop };
}
`;
}

export function emit(spec) {
  const files = {
    ...templateFiles({ name: "dashboard", title: "Dashboard" }),
    "src/app.js": appFile(spec),
    "src/widgets/widget.js": WIDGET_FILE,
  };
  for (const kind of new Set(spec.widgets.map((w) => w.kind))) files[`src/widgets/${kind}.js`] = factoryFile(kind);
  return {
    files,
    style: {
      track: "prototype: no framework implements this strategy",
      components: "one factory per widget kind, configured per widget; DOM built once with createElement",
      messages: "erased for DOM events: each update arm is an action that writes model fields in place",
      updates: "each action schedules the bindings that read the fields it writes (known at compile time); one microtask flush",
      derived: "summaries subscribe once to their sources' readers; sources schedule them when they write a field a summary reads",
      lists: "keyed: in-place edits patch only their rows; replaced or derived arrays reconcile by key with Solid 2's reconcileArrays",
      externalEvents: "receive(msg): serverSet and snapshot replace a widget's state and run all its bindings; tick and notify call the widget's external arms",
      build: "Vite with no framework plugin, production defaults, hidden source maps",
    },
  };
}
