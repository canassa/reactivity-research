// The dashboard as tea-inline, a prototype strategy (see frameworks/tea-inline/README.md).
//
// The emitter plays the compiler of a TEA app: it writes what partial evaluation of the
// reducer would produce, with messages erased.
// - One factory per widget kind (src/widgets/<kind>.js), called with each widget's own
//   arguments (label, limits, items, rules, formats, summary sources). The factory builds the DOM once and
//   defines the kind's bindings, grouped by the model field they read.
// - Every `case` arm of the kind's `update` becomes an action: a DOM event calls it directly,
//   it writes the fields that arm changes and schedules exactly the bindings that read them,
//   plus the summaries reading that widget (`readers[id]`) when it writes a field they read.
// - The app is a table of rows (factory, initial state, label, the kind's arguments) in page
//   order, the arguments passed positionally; row N is widget wN, number N. The model is TEA's
//   model by widget number, `{ [N]: state }`, made on each mount from a copy of every row's
//   initial state (TEA's `init`, split per widget); each factory is handed its number and its
//   slice, and edits the slice in place (the compiler proved it unshared); a summary is handed
//   the model it reads and the numbers of its sources.
// - External events stay messages: `receive(msg)` is the part of `update` still reached by a
//   message (serverSet, tick, notify, snapshot), routed to the widget's own arms.

import { templateFiles } from "../../frameworks/tea-inline/framework.js";
import { literal, tplText, camelCase } from "../../frameworks/shared/jsx.js";

const str = JSON.stringify;

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
  // Tabs and options as [title, content] and [value, label] pairs.
  tabs: (w) => w.tabs.map((t) => [t.title, t.content]),
  options: (w) => w.options.map((o) => [o.value, o.label]),
};

// ---------------------------------------------------------------------------------------------
// Widget factories, one per kind: the runtime helpers each needs, and its body.

const FACTORIES = {
  counter: {
    uses: ["el", "text", "prop", "on", "schedule"],
    code: `export function counter(parent, s, readers, id, heading, step, min, max, start) {
  const root = section(parent, id, heading, "counter");
  const value = el("output", root, { "data-role": "value" });
  const decButton = el("button", root, { "data-role": "dec" }, "-" + step);
  const incButton = el("button", root, { "data-role": "inc" }, "+" + step);
  const resetButton = el("button", root, { "data-role": "reset" }, "Reset");

  // The bindings reading \`value\`.
  const onValue = [
    () => text(value, s.value),
    () => prop(decButton, s.value <= min, "disabled"),
    () => prop(incButton, s.value >= max, "disabled"),
    readers[id],
  ];

  // The arms of update: dec, inc, reset.
  on(decButton, () => {
    s.value = Math.max(min, s.value - step);
    schedule(onValue);
  });
  on(incButton, () => {
    s.value = Math.min(max, s.value + step);
    schedule(onValue);
  });
  on(resetButton, () => {
    s.value = start;
    schedule(onValue);
  });

  return loader(s, onValue);
}`,
  },

  toggles: {
    uses: ["el", "text", "prop", "on", "schedule"],
    code: `export function toggles(parent, s, readers, id, heading, items) {
  const root = section(parent, id, heading, "toggles");
  const ul = el("ul", root);
  // One binding per checkbox, each reading its own \`on[i]\`.
  const boxes = items.map((name, i) => {
    const label = el("label", el("li", ul));
    const box = el("input", label, { type: "checkbox", "data-role": "toggle", "data-key": i });
    label.append(name);
    // The arm of update: toggle(i) writes \`on[i]\`.
    on(box, () => {
      s.on[i] = !s.on[i];
      schedule(boxes[i], onCount);
    });
    return () => prop(box, s.on[i], "checked");
  });
  const count = el("p", root, { "data-role": "count" });
  const onCount = [() => text(count, \`\${s.on.filter(Boolean).length} of \${items.length} on\`), readers[id]];

  return loader(s, [boxes, onCount]);
}`,
  },

  field: {
    uses: ["el", "prop", "on", "when", "schedule"],
    code: `export function field(parent, s, readers, id, heading, placeholder, message, invalid) {
  const root = section(parent, id, heading, "field");
  const input = el("input", root, { type: "text", "data-role": "input", placeholder: placeholder });
  const error = el("p", root, { "data-role": "error" }, message);

  const onText = [() => prop(input, s.text), () => when(error, invalid(s.text))];

  // The arm of update: edit(text).
  on(input, () => {
    s.text = input.value;
    schedule(onText);
  }, "input");

  return loader(s, onText);
}`,
  },

  todo: {
    uses: ["el", "text", "prop", "on", "list", "schedule"],
    code: `export function todo(parent, s, readers, id, heading, placeholder, addText, removeText) {
  const root = section(parent, id, heading, "todo");
  const draft = el("input", root, { type: "text", "data-role": "draft", placeholder: placeholder });
  const addButton = el("button", root, { "data-role": "add" }, addText);
  const items = list(el("ul", root), () => s.items, (item) => {
    const node = el("li", null, { "data-key": item.id });
    const box = el("input", node, { type: "checkbox", "data-role": "toggle" });
    const label = el("span", node);
    // The row's binding: the list hands it the item of its id, so the row keeps its item current.
    const set = (next = item) => {
      prop(box, (item = next).done, "checked");
      text(label, item.text);
    };
    // The arms of update for this row's item: toggle(id), which schedules the row's binding,
    // and remove(id).
    on(box, () => {
      item.done = !item.done;
      schedule(set, onItems);
    });
    on(el("button", node, { "data-role": "remove" }, removeText), () => {
      s.items.splice(s.items.indexOf(item), 1);
      items.drop(item.id);
      schedule(onItems);
    });
    return [node, set];
  });
  const left = el("p", root, { "data-role": "left" });

  const onDraft = () => prop(draft, s.draft);
  const onItems = [() => text(left, \`\${s.items.filter((item) => !item.done).length} left\`), readers[id]];

  // The arms of update: editDraft, add. The list edits (here and in the rows) tell the list
  // which rows changed.
  on(draft, () => {
    s.draft = draft.value;
    schedule(onDraft);
  }, "input");
  on(addButton, () => {
    const title = s.draft.trim();
    if (!title) return;
    const item = { id: s.items.reduce((max, item) => Math.max(max, item.id), 0) + 1, text: title, done: false };
    s.items.push(item);
    s.draft = "";
    items.add(item);
    schedule(onDraft, onItems);
  });

  return loader(s, [onDraft, items, onItems]);
}`,
  },

  tabs: {
    uses: ["el", "text", "prop", "on", "schedule"],
    code: `export function tabs(parent, s, readers, id, heading, tabs) {
  const root = section(parent, id, heading, "tabs");
  const bar = el("div", root, { role: "tablist" });
  // Every tab button and the content read \`active\`.
  const onActive = tabs.map(([title], i) => {
    const button = el("button", bar, { role: "tab", "data-role": "tab", "data-key": i }, title);
    // The arm of update: select(i).
    on(button, () => {
      s.active = i;
      schedule(onActive);
    });
    return () => prop(button, String(s.active === i), "ariaSelected");
  });
  const content = el("p", root, { role: "tabpanel", "data-role": "tab-content" });
  onActive.push(() => text(content, tabs[s.active][1]));

  return loader(s, onActive);
}`,
  },

  panel: {
    uses: ["el", "text", "prop", "on", "when", "schedule"],
    code: `export function panel(parent, s, readers, id, heading, showText, hideText, bodyText) {
  const root = section(parent, id, heading, "panel");
  const button = el("button", root, { "data-role": "toggle" });
  const body = el("p", root, { "data-role": "body" }, bodyText);

  const onOpen = [
    () => {
      prop(button, String(s.open), "ariaExpanded");
      text(button, s.open ? hideText : showText);
    },
    () => when(body, s.open),
  ];

  // The arm of update: toggle.
  on(button, () => {
    s.open = !s.open;
    schedule(onOpen);
  });

  return loader(s, onOpen);
}`,
  },

  choice: {
    uses: ["el", "prop", "on", "when", "schedule"],
    code: `export function choice(parent, s, readers, id, heading, options, extraFor, extraPlaceholder) {
  const root = section(parent, id, heading, "choice");
  const select = el("select", root, { "data-role": "select" });
  for (const [value, label] of options) el("option", select, { value }, label);
  const input = el("input", root, { type: "text", "data-role": "extra", placeholder: extraPlaceholder });
  // The arm of update: editExtra(text).
  on(input, () => {
    s.extra = input.value;
    schedule(onExtra);
  }, "input");

  // The extra input reads \`option\` (whether it is shown) and \`extra\`.
  const onExtra = () => {
    const shown = extraFor.includes(s.option);
    when(input, shown);
    if (shown) prop(input, s.extra);
  };
  const onOption = [() => prop(select, s.option), onExtra];

  // The arm of update: choose(option).
  on(select, () => {
    s.option = select.value;
    schedule(onOption);
  }, "input");

  return loader(s, onOption);
}`,
  },

  amount: {
    uses: ["el", "text", "prop", "on", "schedule"],
    code: `export function amount(parent, s, readers, id, heading, format) {
  const root = section(parent, id, heading, "amount");
  const input = el("input", root, { type: "number", "data-role": "input" });
  const output = el("output", root, { "data-role": "formatted" });

  const onValue = [() => prop(input, String(s.value)), () => text(output, format(s.value)), readers[id]];

  // The arm of update: set(n), sent only while the input holds a number.
  on(input, () => {
    const value = input.valueAsNumber;
    if (Number.isNaN(value)) return;
    s.value = value;
    schedule(onValue);
  }, "input");

  return loader(s, onValue);
}`,
  },

  filter: {
    uses: ["el", "text", "prop", "on", "list", "schedule"],
    code: `export function filter(parent, s, readers, id, heading, texts, placeholder) {
  const root = section(parent, id, heading, "filter");
  // The pool's items, numbered 1, 2, … in order.
  const pool = texts.map((text, i) => ({ id: i + 1, text }));
  const query = el("input", root, { type: "text", "data-role": "query", placeholder: placeholder });
  const shown = () => {
    const q = s.query.toLowerCase();
    return pool.filter((item) => item.text.toLowerCase().includes(q));
  };
  // A derived list: a new array on every change, so the list reconciles it by key.
  const items = list(el("ul", root), shown, (item) => [el("li", null, { "data-key": item.id }, item.text), () => {}]);
  const matches = el("p", root, { "data-role": "matches" });

  const onQuery = [() => prop(query, s.query), items, () => text(matches, \`\${shown().length} matches\`), readers[id]];

  // The arm of update: edit(query).
  on(query, () => {
    s.query = query.value;
    schedule(onQuery);
  }, "input");

  return loader(s, onQuery);
}`,
  },

  rating: {
    uses: ["el", "text", "prop", "on", "schedule"],
    code: `export function rating(parent, s, readers, id, heading, stars, labels) {
  const root = section(parent, id, heading, "rating");
  const row = el("div", root);
  // Every star and the label read \`stars\`.
  const onStars = Array.from({ length: stars }, (_, i) => {
    const n = i + 1;
    const button = el("button", row, { "data-role": "star", "data-key": n });
    // The arm of update: rate(n).
    on(button, () => {
      s.stars = n;
      schedule(onStars);
    });
    return () => {
      prop(button, String(n <= s.stars), "ariaPressed");
      text(button, n <= s.stars ? "★" : "☆");
    };
  });
  const label = el("p", root, { "data-role": "rating-label" });
  onStars.push(() => text(label, labels[s.stars]), readers[id]);

  return loader(s, onStars);
}`,
  },

  feed: {
    uses: ["el", "text", "on", "when", "list", "schedule"],
    code: `export function feed(parent, s, readers, id, heading, emptyText, dismissText) {
  const root = section(parent, id, heading, "feed");
  const entries = list(el("ul", root), () => s.entries, (entry) => {
    const node = el("li", null, { "data-key": entry.id });
    const label = el("span", node);
    // The arm of update for this row's entry: dismiss(id). The row keeps its entry current.
    on(el("button", node, { "data-role": "dismiss" }, dismissText), () => {
      s.entries.splice(s.entries.indexOf(entry), 1);
      entries.drop(entry.id);
      schedule(onEntries);
    });
    return [node, (next) => {
      entry = next;
      text(label, entry.text);
    }];
  });
  const empty = el("p", root, { "data-role": "empty" }, emptyText);

  const onEntries = [() => when(empty, s.entries.length === 0), readers[id]];

  return loader(s, [entries, onEntries], {
    // The external arm: notify(entry).
    notify(entry) {
      s.entries.push(entry);
      entries.add(entry);
      schedule(onEntries);
    },
  });
}`,
  },

  clock: {
    uses: ["el", "text", "prop", "on", "schedule"],
    code: `const formatTime = (seconds) => \`\${Math.floor(seconds / 60)}:\${String(seconds % 60).padStart(2, "0")}\`;

export function clock(parent, s, readers, id, heading, startText, stopText, resetText) {
  const root = section(parent, id, heading, "clock");
  const time = el("output", root, { "data-role": "time" });
  const startButton = el("button", root, { "data-role": "start" }, startText);
  const stopButton = el("button", root, { "data-role": "stop" }, stopText);
  const resetButton = el("button", root, { "data-role": "reset" }, resetText);

  const onSeconds = [() => text(time, formatTime(s.seconds)), readers[id]];
  const onRunning = [() => prop(startButton, s.running, "disabled"), () => prop(stopButton, !s.running, "disabled")];

  // The arms of update: start, stop, reset.
  on(startButton, () => {
    s.running = true;
    schedule(onRunning);
  });
  on(stopButton, () => {
    s.running = false;
    schedule(onRunning);
  });
  on(resetButton, () => {
    s.seconds = 0;
    s.running = false;
    schedule(onSeconds, onRunning);
  });

  return loader(s, [onSeconds, onRunning], {
    // The external arm: tick.
    tick() {
      if (!s.running) return;
      s.seconds++;
      schedule(onSeconds);
    },
  });
}`,
  },

  summary: {
    uses: ["el", "text", "schedule"],
    widget: ["section"],
    code: `// A derived line: \`describe(model)\` reads other widgets' state. It adds itself to the
// \`readers\` of each source, which schedule it when they write a field it reads.
export function summary(parent, model, readers, id, heading, reads, describe) {
  const root = section(parent, id, heading, "summary");
  const line = el("p", root, { "data-role": "summary" });
  const show = () => text(line, describe(model));
  for (const source of reads) readers[source].push(show);
  schedule(show);
}`,
  },
};

const WIDGET_FILE = `import { el, schedule } from "../runtime.js";

// The section every widget renders into: its key, its kind and its heading.
export function section(parent, id, label, kind) {
  const root = el("section", parent, { "data-key": "w" + id, "data-role": "widget-" + kind });
  el("h2", root, null, label);
  return root;
}

// Schedule every binding of a widget for its first render, and return its handle: its load for
// serverSet and snapshot (replace the widget's state and run every binding again), carrying its
// external arms.
export const loader = (s, all, arms) => (
  schedule(all),
  Object.assign((next) => {
    Object.assign(s, next);
    schedule(all);
  }, arms)
);
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
    case "filter": return `${itemsName}.filter((text) => text.toLowerCase().includes(${slice}.query.toLowerCase())).length`;
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

// A filter's pool as its texts: its items are numbered 1, 2, … in order (checked), so the factory
// numbers them again.
function filterTexts(w) {
  if (w.items.some((item, i) => item.id !== i + 1)) throw new Error(`${w.id}: filter items are not numbered 1, 2, … in order`);
  return w.items.map((item) => item.text);
}
const itemsName = (w) => `${camelCase(w.label)}Items`;

// The text function of a summary, as source, indented by `indent`.
function summaryText(spec, w, indent) {
  const sources = w.sources.map((id) => byId(spec, id));
  // A breakdown shows each term and their total: its terms are named; any other text uses each
  // term once, inline.
  if (w.formula !== "breakdown") {
    const terms = sources.map((src) => metricExpr(src, `w[${src.id.slice(1)}]`, itemsName(src)));
    const decimal = sources.map((src) => src.kind === "amount");
    const total = decimal.some(Boolean) ? `formatNumber(${terms.join(" + ")})` : terms.join(" + ");
    const text = w.formula === "sum" ? `${tplText(w.prefix)}: \${${total}}`
      : sources.map((src, i) => PHRASES[src.kind](decimal[i] ? `\${formatNumber(${terms[i]})}` : `\${${terms[i]}}`, src)).join("; ");
    return `(w) => \`${text}\``;
  }
  const names = [];
  const lines = sources.map((src) => {
    let name = camelCase(src.label);
    while (names.includes(name)) name += "2";
    names.push(name);
    return `const ${name} = ${metricExpr(src, `w[${src.id.slice(1)}]`, itemsName(src))};`;
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

  const consts = readFilters.map((w) => `const ${itemsName(w)} = ${literal(filterTexts(w))};`);
  if (needsFormat) {
    consts.push(`// Round to at most two decimals for display.
function formatNumber(n) {
  return String(Math.round(n * 100) / 100);
}`);
  }

  const table = spec.widgets.map((w) => {
    const ind = "    ";
    const config = [w.kind, w.kind === "summary" ? "null" : literal(spec.initialState.widgets[w.id], ind), str(w.label)];
    for (const name of PARAMS[w.kind]) {
      if (FUNCTIONS[name]) config.push(FUNCTIONS[name](w));
      else if (VALUES[name]) config.push(literal(VALUES[name](w), ind));
      else if (w.kind === "filter" && name === "items") config.push(read.has(w.id) ? itemsName(w) : literal(filterTexts(w), ind));
      else config.push(literal(w[name], ind));
    }
    if (w.kind === "summary") config.push(literal(w.sources.map((id) => Number(id.slice(1)))), summaryText(spec, w, ind));
    const flat = `  [${config.join(", ")}],`;
    return flat.length <= 100 && !flat.includes("\n") ? flat : `  [\n${config.map((c) => ind + c + ",").join("\n")}\n  ],`;
  });

  const clocks = spec.widgets.filter((w) => w.kind === "clock");
  const cases = [`      case "serverSet":
        views[msg.widget](msg.state);
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
        for (const id in msg.state.widgets) views[id](msg.state.widgets[id]);
        break;`);

  const imports = [`import { el, flush, cancel } from "./runtime.js";`,
    ...kinds.map((k) => `import { ${k} } from "./widgets/${k}.js";`)];
  const readers = Object.fromEntries(spec.widgets.filter((w) => read.has(w.id)).map((w) => [w.id.slice(1), []]));

  return `${imports.join("\n")}
${consts.length ? "\n" + consts.join("\n\n") + "\n" : ""}
// The page, made fresh on every mount: every widget in order (row N is widget \`wN\`), as its kind's
// factory, its initial state (its slice of TEA's \`init\`; none for a summary), its label, and
// the arguments of its kind (limits, items, rules, formats, summary sources).
const page = () => [
${table.join("\n")}
];

export function start(root) {
  const model = {};
  const board = el("div", root, { "data-role": "dashboard" });
  // For each widget a summary reads, the summaries' bindings: the widget schedules them when it
  // writes a field they read.
  const readers = ${literal(readers, "  ")};
  // Each widget's handle: its load for serverSet and snapshot, carrying its external arms.
  const views = {};
  let n = 0;
  for (const [factory, init, ...config] of page()) {
    // Widget wN is number N: its state slice is \`model[N]\`, its initial state (a summary gets the
    // model), and its readers \`readers[N]\`.
    views["w" + ++n] = factory(board, init ? (model[n] = init) : model, readers, n, ...config);
  }
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
  // Widgets are numbered in page order (their ids are w1, w2, …): the app derives ids from rows.
  if (spec.widgets.some((w, i) => w.id !== `w${i + 1}`)) throw new Error("widget ids are not w1, w2, … in order");
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
      components: "one factory per widget kind, called with each widget's arguments positionally; DOM built once with createElement",
      messages: "erased for DOM events: each update arm is an action that writes model fields in place",
      updates: "each action schedules the bindings that read the fields it writes (known at compile time); one microtask flush",
      derived: "summaries subscribe once to their sources' readers; sources schedule them when they write a field a summary reads",
      lists: "keyed: in-place edits patch only their rows; replaced or derived arrays reconcile by id in one forward pass",
      externalEvents: "receive(msg): serverSet and snapshot replace a widget's state and run all its bindings; tick and notify call the widget's external arms",
      build: "Vite with no framework plugin, production defaults, hidden source maps",
    },
  };
}
