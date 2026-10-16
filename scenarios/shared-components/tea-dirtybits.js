// The dashboard as tea-dirtybits, a prototype strategy (see frameworks/tea-dirtybits/README.md).
//
// This emitter plays the compiler: it writes what an ideal TEA compiler would emit.
// Style (recorded in every generated app's rr.json):
// - One module per widget kind (src/widgets/<kind>.js), configured per widget by a plain
//   config object: its reducer `update(c, s, msg)`, whose arms mark dirty bits for the fields
//   they write, and its DOM factory `view(parent, c, s, send)`, which builds the DOM once and
//   returns a static `patch(s, dirty)` that runs only the bindings whose bits are set.
// - One app module (src/app.js): the per-widget configs, the initial model, the app reducer
//   (routes user messages and external events to the widgets' reducers and files their bits
//   per widget), and the top-level view, whose patch calls each dirty widget's patch and
//   recomputes a summary only when a bit it reads is set.
// - Events build a message and send it; patches are batched into one microtask.
// - Keyed lists patch changed rows and reconcile the order with Solid 2's reconcileArrays.

import { templateFiles } from "../../frameworks/tea-dirtybits/framework.js";
import { literal, tplText, camelCase } from "../../frameworks/shared/jsx.js";

export const framework = "tea-dirtybits";

export const params = {};

// The config fields each kind takes, beyond id and label.
const PARAMS = {
  counter: ["step", "min", "max", "start"],
  toggles: ["items"],
  field: ["placeholder", "valid", "message"],
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

// Config fields that are functions or derived from the widget's rules: their source.
const DERIVED = {
  valid(w) {
    if (w.rule.type === "required") return `(text) => text.trim() !== ""`;
    if (w.rule.type === "minLength") return `(text) => text.length >= ${w.rule.min}`;
    return `(text) => /${w.rule.pattern}/.test(text)`;
  },
  message(w) {
    return JSON.stringify(w.rule.message);
  },
  format(w) {
    const f = w.format;
    const fixed = `value.toFixed(${f.decimals})`;
    if (f.type === "currency") return `(value) => ${JSON.stringify(f.symbol)} + ${fixed}`;
    if (f.type === "percent") return `(value) => ${fixed} + "%"`;
    return `(value) => ${fixed} + ${JSON.stringify(" " + f.unit)}`;
  },
};

// The dirty bit a summary reads from each kind it can summarize.
const METRIC_BIT = {
  counter: "VALUE", amount: "VALUE", toggles: "ON", todo: "ITEMS", rating: "STARS",
  clock: "SECONDS", filter: "QUERY", feed: "ENTRIES",
};

// ---------------------------------------------------------------------------------------------
// The widget kinds: one module each, shared by every instance of the kind.

const WIDGET_FILE = `import { element, text } from "../runtime.js";

// A widget's <section> and its heading.
export function section(parent, c, kind) {
  const root = element(parent, "section", "widget-" + kind);
  root.setAttribute("data-key", c.id);
  text(element(root, "h2"), c.label);
  return root;
}
`;

const KINDS = {
  counter: `import { mark, element, text, setText, prop, on } from "../runtime.js";
import { section } from "./widget.js";

export const VALUE = 1;

export function update(c, s, msg) {
  switch (msg.type) {
    case "inc":
      mark(VALUE);
      return { value: Math.min(c.max, s.value + c.step) };
    case "dec":
      mark(VALUE);
      return { value: Math.max(c.min, s.value - c.step) };
    case "reset":
      mark(VALUE);
      return { value: c.start };
  }
  return s;
}

export function view(parent, c, s, send) {
  const root = section(parent, c, "counter");
  const value = text(element(root, "output", "value"), "");
  const dec = element(root, "button", "dec");
  text(dec, "-" + c.step);
  on(dec, "click", () => send({ widget: c.id, type: "dec" }));
  const inc = element(root, "button", "inc");
  text(inc, "+" + c.step);
  on(inc, "click", () => send({ widget: c.id, type: "inc" }));
  const reset = element(root, "button", "reset");
  text(reset, "Reset");
  on(reset, "click", () => send({ widget: c.id, type: "reset" }));

  const patch = (s, dirty) => {
    if (dirty & VALUE) {
      setText(value, s.value);
      prop(dec, "disabled", s.value <= c.min);
      prop(inc, "disabled", s.value >= c.max);
    }
  };
  patch(s, -1);
  return patch;
}
`,

  toggles: `import { mark, element, text, setText, prop, on } from "../runtime.js";
import { section } from "./widget.js";

export const ON = 1;

export function update(c, s, msg) {
  switch (msg.type) {
    case "toggle":
      mark(ON);
      return { on: s.on.map((on, i) => (i === msg.index ? !on : on)) };
  }
  return s;
}

export function view(parent, c, s, send) {
  const root = section(parent, c, "toggles");
  const list = element(root, "ul");
  const boxes = c.items.map((name, i) => {
    const label = element(element(list, "li"), "label");
    const box = element(label, "input", "toggle");
    box.setAttribute("type", "checkbox");
    box.setAttribute("data-key", i);
    on(box, "change", () => send({ widget: c.id, type: "toggle", index: i }));
    text(label, name);
    return box;
  });
  const count = element(root, "p", "count");
  const onCount = text(count, "");
  text(count, " of " + c.items.length + " on");

  const patch = (s, dirty) => {
    if (dirty & ON) {
      boxes.forEach((box, i) => prop(box, "checked", s.on[i]));
      setText(onCount, s.on.filter(Boolean).length);
    }
  };
  patch(s, -1);
  return patch;
}
`,

  field: `import { mark, element, text, prop, on, when } from "../runtime.js";
import { section } from "./widget.js";

export const TEXT = 1;

export function update(c, s, msg) {
  switch (msg.type) {
    case "edit":
      mark(TEXT);
      return { text: msg.text };
  }
  return s;
}

export function view(parent, c, s, send) {
  const root = section(parent, c, "field");
  const input = element(root, "input", "input");
  input.setAttribute("type", "text");
  input.setAttribute("placeholder", c.placeholder);
  on(input, "input", () => send({ widget: c.id, type: "edit", text: input.value }));
  const error = when(root, (parent) => {
    const p = element(parent, "p", "error");
    text(p, c.message);
    return p;
  });

  const patch = (s, dirty) => {
    if (dirty & TEXT) {
      prop(input, "value", s.text);
      error(!c.valid(s.text));
    }
  };
  patch(s, -1);
  return patch;
}
`,

  todo: `import { mark, element, text, setText, prop, on, list } from "../runtime.js";
import { section } from "./widget.js";

export const ITEMS = 1;
export const DRAFT = 2;

export function update(c, s, msg) {
  switch (msg.type) {
    case "editDraft":
      mark(DRAFT);
      return { ...s, draft: msg.text };
    case "add": {
      const text = s.draft.trim();
      if (text === "") return s;
      mark(ITEMS | DRAFT);
      const id = s.items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
      return { items: [...s.items, { id, text, done: false }], draft: "" };
    }
    case "toggle":
      mark(ITEMS);
      return { ...s, items: s.items.map((item) => (item.id === msg.id ? { ...item, done: !item.done } : item)) };
    case "remove":
      mark(ITEMS);
      return { ...s, items: s.items.filter((item) => item.id !== msg.id) };
  }
  return s;
}

export function view(parent, c, s, send) {
  const root = section(parent, c, "todo");
  const draft = element(root, "input", "draft");
  draft.setAttribute("type", "text");
  draft.setAttribute("placeholder", c.placeholder);
  on(draft, "input", () => send({ widget: c.id, type: "editDraft", text: draft.value }));
  const add = element(root, "button", "add");
  text(add, c.addText);
  on(add, "click", () => send({ widget: c.id, type: "add" }));
  const items = list(element(root, "ul"), (item) => {
    const li = element(null, "li");
    li.setAttribute("data-key", item.id);
    const box = element(li, "input", "toggle");
    box.setAttribute("type", "checkbox");
    on(box, "change", () => send({ widget: c.id, type: "toggle", id: item.id }));
    const label = text(element(li, "span"), "");
    const remove = element(li, "button", "remove");
    text(remove, c.removeText);
    on(remove, "click", () => send({ widget: c.id, type: "remove", id: item.id }));
    const patch = (item) => {
      prop(box, "checked", item.done);
      setText(label, item.text);
    };
    patch(item);
    return { node: li, patch };
  });
  const leftLine = element(root, "p", "left");
  const left = text(leftLine, "");
  text(leftLine, " left");

  const patch = (s, dirty) => {
    if (dirty & DRAFT) prop(draft, "value", s.draft);
    if (dirty & ITEMS) {
      items(s.items);
      setText(left, s.items.filter((item) => !item.done).length);
    }
  };
  patch(s, -1);
  return patch;
}
`,

  tabs: `import { mark, element, text, setText, attr, on } from "../runtime.js";
import { section } from "./widget.js";

export const ACTIVE = 1;

export function update(c, s, msg) {
  switch (msg.type) {
    case "select":
      mark(ACTIVE);
      return { active: msg.index };
  }
  return s;
}

export function view(parent, c, s, send) {
  const root = section(parent, c, "tabs");
  const tablist = element(root, "div");
  tablist.setAttribute("role", "tablist");
  const tabs = c.tabs.map((tab, i) => {
    const button = element(tablist, "button", "tab");
    button.setAttribute("role", "tab");
    button.setAttribute("data-key", i);
    text(button, tab.title);
    on(button, "click", () => send({ widget: c.id, type: "select", index: i }));
    return button;
  });
  const panel = element(root, "p", "tab-content");
  panel.setAttribute("role", "tabpanel");
  const content = text(panel, "");

  const patch = (s, dirty) => {
    if (dirty & ACTIVE) {
      tabs.forEach((tab, i) => attr(tab, "aria-selected", i === s.active ? "true" : "false"));
      setText(content, c.tabs[s.active].content);
    }
  };
  patch(s, -1);
  return patch;
}
`,

  panel: `import { mark, element, text, setText, attr, on, when } from "../runtime.js";
import { section } from "./widget.js";

export const OPEN = 1;

export function update(c, s, msg) {
  switch (msg.type) {
    case "toggle":
      mark(OPEN);
      return { open: !s.open };
  }
  return s;
}

export function view(parent, c, s, send) {
  const root = section(parent, c, "panel");
  const toggle = element(root, "button", "toggle");
  const label = text(toggle, "");
  on(toggle, "click", () => send({ widget: c.id, type: "toggle" }));
  const body = when(root, (parent) => {
    const p = element(parent, "p", "body");
    text(p, c.body);
    return p;
  });

  const patch = (s, dirty) => {
    if (dirty & OPEN) {
      attr(toggle, "aria-expanded", s.open ? "true" : "false");
      setText(label, s.open ? c.hideText : c.showText);
      body(s.open);
    }
  };
  patch(s, -1);
  return patch;
}
`,

  choice: `import { mark, element, text, prop, on, when } from "../runtime.js";
import { section } from "./widget.js";

export const OPTION = 1;
export const EXTRA = 2;

export function update(c, s, msg) {
  switch (msg.type) {
    case "choose":
      mark(OPTION);
      return { ...s, option: msg.option };
    case "editExtra":
      mark(EXTRA);
      return { ...s, extra: msg.text };
  }
  return s;
}

export function view(parent, c, s, send) {
  const root = section(parent, c, "choice");
  const select = element(root, "select", "select");
  for (const option of c.options) {
    const o = element(select, "option");
    o.setAttribute("value", option.value);
    text(o, option.label);
  }
  on(select, "change", () => send({ widget: c.id, type: "choose", option: select.value }));
  const extra = when(root, (parent) => {
    const input = element(parent, "input", "extra");
    input.setAttribute("type", "text");
    input.setAttribute("placeholder", c.extraPlaceholder);
    on(input, "input", () => send({ widget: c.id, type: "editExtra", text: input.value }));
    return input;
  });

  const patch = (s, dirty) => {
    if (dirty & OPTION) prop(select, "value", s.option);
    if (dirty & (OPTION | EXTRA)) {
      const input = extra(c.extraFor.includes(s.option));
      if (input) prop(input, "value", s.extra);
    }
  };
  patch(s, -1);
  return patch;
}
`,

  amount: `import { mark, element, text, setText, prop, on } from "../runtime.js";
import { section } from "./widget.js";

export const VALUE = 1;

export function update(c, s, msg) {
  switch (msg.type) {
    case "set":
      mark(VALUE);
      return { value: msg.value };
  }
  return s;
}

export function view(parent, c, s, send) {
  const root = section(parent, c, "amount");
  const input = element(root, "input", "input");
  input.setAttribute("type", "number");
  // Only a valid number becomes a message; anything else stays in the input as typed.
  on(input, "input", () => {
    const value = input.valueAsNumber;
    if (!Number.isNaN(value)) send({ widget: c.id, type: "set", value });
  });
  const formatted = text(element(root, "output", "formatted"), "");

  const patch = (s, dirty) => {
    if (dirty & VALUE) {
      prop(input, "value", String(s.value));
      setText(formatted, c.format(s.value));
    }
  };
  patch(s, -1);
  return patch;
}
`,

  filter: `import { mark, element, text, setText, prop, on, list } from "../runtime.js";
import { section } from "./widget.js";

export const QUERY = 1;

export function update(c, s, msg) {
  switch (msg.type) {
    case "edit":
      mark(QUERY);
      return { query: msg.query };
  }
  return s;
}

export function matches(c, query) {
  const q = query.toLowerCase();
  return c.items.filter((item) => item.text.toLowerCase().includes(q));
}

export function view(parent, c, s, send) {
  const root = section(parent, c, "filter");
  const input = element(root, "input", "query");
  input.setAttribute("type", "text");
  input.setAttribute("placeholder", c.placeholder);
  on(input, "input", () => send({ widget: c.id, type: "edit", query: input.value }));
  const items = list(element(root, "ul"), (item) => {
    const li = element(null, "li");
    li.setAttribute("data-key", item.id);
    const label = text(li, item.text);
    return { node: li, patch: (item) => setText(label, item.text) };
  });
  const count = element(root, "p", "matches");
  const found = text(count, "");
  text(count, " matches");

  const patch = (s, dirty) => {
    if (dirty & QUERY) {
      prop(input, "value", s.query);
      const shown = matches(c, s.query);
      items(shown);
      setText(found, shown.length);
    }
  };
  patch(s, -1);
  return patch;
}
`,

  rating: `import { mark, element, text, setText, attr, on } from "../runtime.js";
import { section } from "./widget.js";

export const STARS = 1;

export function update(c, s, msg) {
  switch (msg.type) {
    case "rate":
      mark(STARS);
      return { stars: msg.stars };
  }
  return s;
}

export function view(parent, c, s, send) {
  const root = section(parent, c, "rating");
  const row = element(root, "div");
  const stars = [];
  for (let n = 1; n <= c.stars; n++) {
    const button = element(row, "button", "star");
    button.setAttribute("data-key", n);
    on(button, "click", () => send({ widget: c.id, type: "rate", stars: n }));
    stars.push([button, text(button, "")]);
  }
  const label = text(element(root, "p", "rating-label"), "");

  const patch = (s, dirty) => {
    if (dirty & STARS) {
      stars.forEach(([button, star], i) => {
        attr(button, "aria-pressed", i < s.stars ? "true" : "false");
        setText(star, i < s.stars ? "★" : "☆");
      });
      setText(label, c.labels[s.stars]);
    }
  };
  patch(s, -1);
  return patch;
}
`,

  feed: `import { mark, element, text, setText, on, when, list } from "../runtime.js";
import { section } from "./widget.js";

export const ENTRIES = 1;

export function update(c, s, msg) {
  switch (msg.type) {
    case "dismiss":
      mark(ENTRIES);
      return { entries: s.entries.filter((entry) => entry.id !== msg.id) };
    case "notify":
      mark(ENTRIES);
      return { entries: [...s.entries, msg.entry] };
  }
  return s;
}

export function view(parent, c, s, send) {
  const root = section(parent, c, "feed");
  const entries = list(element(root, "ul"), (entry) => {
    const li = element(null, "li");
    li.setAttribute("data-key", entry.id);
    const label = text(element(li, "span"), entry.text);
    const dismiss = element(li, "button", "dismiss");
    text(dismiss, c.dismissText);
    on(dismiss, "click", () => send({ widget: c.id, type: "dismiss", id: entry.id }));
    return { node: li, patch: (entry) => setText(label, entry.text) };
  });
  const empty = when(root, (parent) => {
    const p = element(parent, "p", "empty");
    text(p, c.emptyText);
    return p;
  });

  const patch = (s, dirty) => {
    if (dirty & ENTRIES) {
      entries(s.entries);
      empty(s.entries.length === 0);
    }
  };
  patch(s, -1);
  return patch;
}
`,

  clock: `import { mark, element, text, setText, prop, on } from "../runtime.js";
import { section } from "./widget.js";

export const SECONDS = 1;
export const RUNNING = 2;

export function update(c, s, msg) {
  switch (msg.type) {
    case "start":
      mark(RUNNING);
      return { ...s, running: true };
    case "stop":
      mark(RUNNING);
      return { ...s, running: false };
    case "reset":
      mark(SECONDS | RUNNING);
      return { seconds: 0, running: false };
    case "tick":
      if (!s.running) return s;
      mark(SECONDS);
      return { ...s, seconds: s.seconds + 1 };
  }
  return s;
}

export function formatTime(seconds) {
  const s = seconds % 60;
  return Math.floor(seconds / 60) + ":" + (s < 10 ? "0" : "") + s;
}

export function view(parent, c, s, send) {
  const root = section(parent, c, "clock");
  const time = text(element(root, "output", "time"), "");
  const start = element(root, "button", "start");
  text(start, c.startText);
  on(start, "click", () => send({ widget: c.id, type: "start" }));
  const stop = element(root, "button", "stop");
  text(stop, c.stopText);
  on(stop, "click", () => send({ widget: c.id, type: "stop" }));
  const reset = element(root, "button", "reset");
  text(reset, c.resetText);
  on(reset, "click", () => send({ widget: c.id, type: "reset" }));

  const patch = (s, dirty) => {
    if (dirty & SECONDS) setText(time, formatTime(s.seconds));
    if (dirty & RUNNING) {
      prop(start, "disabled", s.running);
      prop(stop, "disabled", !s.running);
    }
  };
  patch(s, -1);
  return patch;
}
`,

  summary: `import { element, text, setText } from "../runtime.js";
import { section } from "./widget.js";

// A summary has no state of its own: \`c.text(widgets)\` derives its line from other widgets,
// and the app's patch calls it again only when a field it reads is dirty.
export function view(parent, c, widgets) {
  const root = section(parent, c, "summary");
  const line = text(element(root, "p", "summary"), "");
  const patch = (widgets) => setText(line, c.text(widgets));
  patch(widgets);
  return patch;
}

// Round to at most two decimals for display.
export function num(n) {
  return String(Math.round(n * 100) / 100);
}
`,
};

// ---------------------------------------------------------------------------------------------
// Summaries: per instance, the text function and the dirty bits that trigger it.

function metricExpr(src, slice, configName) {
  switch (src.kind) {
    case "counter": case "amount": return `${slice}.value`;
    case "toggles": return `${slice}.on.filter(Boolean).length`;
    case "todo": return `${slice}.items.filter((item) => !item.done).length`;
    case "rating": return `${slice}.stars`;
    case "clock": return `${slice}.seconds`;
    case "filter": return `filter.matches(${configName}, ${slice}.query).length`;
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

const configName = (w) => w.id.toUpperCase();

// The source of a summary's `text(widgets)` function.
function summaryText(spec, w, indent) {
  const sources = w.sources.map((id) => spec.widgets.find((x) => x.id === id));
  const names = [];
  const lines = sources.map((src) => {
    let name = camelCase(src.label);
    while (names.includes(name)) name += "2";
    names.push(name);
    return `const ${name} = ${metricExpr(src, `widgets.${src.id}`, configName(src))};`;
  });
  // Only amounts can hold fractions; their terms (and any total including them) are rounded.
  const decimal = sources.map((src) => src.kind === "amount");
  const show = (i) => (decimal[i] ? `\${summary.num(${names[i]})}` : `\${${names[i]}}`);
  const total = decimal.some(Boolean) ? `summary.num(${names.join(" + ")})` : names.join(" + ");
  let text;
  if (w.formula === "sum") text = `${tplText(w.prefix)}: \${${total}}`;
  else if (w.formula === "breakdown") text = `${tplText(w.prefix)}: ${names.map((_, i) => show(i)).join(" + ")} = \${${total}}`;
  else text = sources.map((src, i) => PHRASES[src.kind](show(i), src)).join("; ");
  const body = [...lines, `return \`${text}\`;`].map((l) => indent + "  " + l).join("\n");
  return `(widgets) => {\n${body}\n${indent}}`;
}

// The condition under which a summary's line can change: a bit it reads is dirty.
function summaryTrigger(spec, w) {
  return w.sources.map((id) => {
    const src = spec.widgets.find((x) => x.id === id);
    return `dirty.${id} & ${src.kind}.${METRIC_BIT[src.kind]}`;
  }).join(" || ");
}

// ---------------------------------------------------------------------------------------------
// The app module

// A widget's config object, written at `indent`.
function configLiteral(spec, w, indent) {
  const inner = indent + "  ";
  const fields = [`id: ${JSON.stringify(w.id)}`, `label: ${JSON.stringify(w.label)}`];
  for (const name of PARAMS[w.kind]) {
    const value = DERIVED[name] ? DERIVED[name](w) : literal(w[name], inner);
    fields.push(`${name}: ${value}`);
  }
  if (w.kind === "summary") fields.push(`text: ${summaryText(spec, w, inner)}`);
  const flat = `{ ${fields.join(", ")} }`;
  if (flat.length + indent.length <= 90 && !flat.includes("\n")) return flat;
  return `{\n${fields.map((f) => inner + f + ",").join("\n")}\n${indent}}`;
}

function appFile(spec) {
  const kinds = [...new Set(spec.widgets.map((w) => w.kind))].sort();
  const plain = spec.widgets.filter((w) => w.kind !== "summary");
  const summaries = spec.widgets.filter((w) => w.kind === "summary");
  const clocks = plain.filter((w) => w.kind === "clock");

  const imports = [
    `import { take, touch, element } from "./runtime.js";`,
    ...kinds.map((k) => `import * as ${k} from "./widgets/${k}.js";`),
  ];
  // Configs are written inline in the widget table, except filters a summary reads, which are
  // named so the summary can call `filter.matches` with them.
  const named = new Set(summaries.flatMap((w) => w.sources)
    .filter((id) => spec.widgets.find((x) => x.id === id).kind === "filter"));
  const configs = spec.widgets.filter((w) => named.has(w.id))
    .map((w) => `const ${configName(w)} = ${configLiteral(spec, w, "")};\n`);
  const table = spec.widgets.map((w) => `  [${w.kind}, ${named.has(w.id) ? configName(w) : configLiteral(spec, w, "  ")}],`);
  const tick = clocks.length
    ? `    case "tick":
      for (const id of ${literal(clocks.map((w) => w.id))}) model = route(model, id, msg);
      return model;`
    : `    case "tick":
      return model;`;
  const triggers = summaries.map((w) => `    if (${summaryTrigger(spec, w)}) patches.${w.id}(w);`);

  return `${imports.join("\n")}

${configs.length ? configs.join("\n") + "\n" : ""}// Every widget in page order: its kind and its config, the only per-widget code (the kinds'
// modules do the rest).
const WIDGETS = [
${table.join("\n")}
];
const BY_ID = {};
for (const entry of WIDGETS) BY_ID[entry[1].id] = entry;

// The initial model: one slice per widget with state.
export function init() {
  return ${literal(spec.initialState, "  ")};
}

// All bits: a widget whose whole state was replaced.
const ALL = -1;

function set(model, id, s, bits) {
  touch(id, bits);
  return { ...model, widgets: { ...model.widgets, [id]: s } };
}

// Run one widget's reducer and file the bits its arm marked under that widget.
function route(model, id, msg) {
  const [kind, c] = BY_ID[id];
  const s = model.widgets[id];
  const next = kind.update(c, s, msg);
  const bits = take();
  return next === s ? model : set(model, id, next, bits);
}

// The app reducer: user messages and most external events go to one widget's reducer.
export function update(model, msg) {
  switch (msg.type) {
    case "serverSet":
      return set(model, msg.widget, msg.state, ALL);
    case "snapshot":
      for (const id in msg.state.widgets) touch(id, ALL);
      return msg.state;
${tick}
  }
  return route(model, msg.widget, msg);
}

// Builds every widget once. The returned patch runs each dirty widget's patch, then the
// summaries whose sources have a dirty bit they read.
export function view(root, model, send) {
  const dash = element(root, "div", "dashboard");
  const w = model.widgets;
  const patches = {};
  // A summary's state is the whole model: it derives its line from other widgets.
  for (const [kind, c] of WIDGETS) patches[c.id] = kind.view(dash, c, c.text ? w : w[c.id], send);
  return (model, dirty) => {
    const w = model.widgets;
    for (const id in dirty) patches[id](w[id], dirty[id]);
${triggers.join("\n")}
  };
}
`;
}

export function emit(spec) {
  const files = {
    ...templateFiles({ name: "dashboard", title: "Dashboard" }),
    "src/app.js": appFile(spec),
    "src/widgets/widget.js": WIDGET_FILE,
  };
  const kinds = [...new Set(spec.widgets.map((w) => w.kind))];
  for (const kind of kinds) files[`src/widgets/${kind}.js`] = KINDS[kind];
  return {
    files,
    style: {
      components: "one module per widget kind (reducer + DOM factory), configured per widget by a plain object",
      state: "one immutable TEA model; the app reducer routes messages to the widgets' reducers",
      updates: "reducer arms mark compile-time dirty bits; a static patch per kind runs only the bindings whose bits are set, batched in a microtask",
      externalEvents: "through the same reducer (send); serverSet and snapshot mark every bit of the widgets they replace",
      lists: "keyed by id: changed rows patched, order reconciled with Solid 2's reconcileArrays",
      conditionals: "nodes built when shown, removed when hidden",
      derived: "summaries recomputed when a dirty bit they read is set (static dependencies)",
      events: "addEventListener on each element; the handler builds a message and sends it",
      build: "Vite with no framework plugin, production defaults, hidden source maps",
    },
  };
}
