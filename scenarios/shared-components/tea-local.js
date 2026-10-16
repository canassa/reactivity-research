// The dashboard as tea-local, a prototype strategy (frameworks/tea-local/README.md): what an
// ideal compiler would emit from a TEA source of the dashboard, with local message routing.
//
// Style (recorded in every generated app's rr.json):
// - One module per widget kind: its message tags, its reducer `update(model, msg, config)` and
//   its factory `kind(parent, config, model)`, shared by every widget of that kind. Each widget
//   is one call of its kind's factory with its own config (label, limits, items, rules as
//   functions, formats, summary formula) and its initial model.
// - A factory builds the widget's DOM once (createElement calls), wires its DOM events to its
//   own instance's `send`, and declares one `patch` function: the binding list, where every
//   write is skipped when its value did not change.
// - `send` runs the kind's reducer on the instance's model (held in a closure) and schedules
//   that instance's patch in a microtask. No global dispatch, dirty bits or dependency graph.
// - Summaries watch the instances they read: a change to one schedules the summary's patch,
//   which recomputes its line from the sources' current models.
// - External events: `serverSet` and `snapshot` replace instance models (`set`); `tick` and
//   `notify` are messages to the clock and feed reducers, sent to the instances concerned. The
//   widget frame registers each instance by id for the events that name a widget.
// - Keyed lists through the runtime's `list` (patch changed rows, forward placement pass on any
//   change of order or membership). Conditional content is built once and attached while shown.

import { templateFiles } from "../../frameworks/tea-local/framework.js";
import { literal, tplText, camelCase } from "../../frameworks/shared/jsx.js";

export const framework = "tea-local";

export const params = {};

// The config fields each kind takes, beyond id and label.
const PARAMS = {
  counter: ["step", "min", "max", "start"],
  toggles: ["items"],
  field: ["placeholder", "validate"],
  todo: ["placeholder", "addText", "removeText"],
  tabs: ["tabs"],
  panel: ["showText", "hideText", "body"],
  choice: ["options", "extraFor", "extraPlaceholder"],
  amount: ["format"],
  filter: ["items", "placeholder"],
  rating: ["stars", "labels"],
  feed: ["emptyText", "dismissText"],
  clock: ["startText", "stopText", "resetText"],
  summary: ["text"],
};

// Config fields that are functions, built from the widget's rules.
const FUNCTIONS = {
  validate(w) {
    const msg = JSON.stringify(w.rule.message);
    if (w.rule.type === "required") return `(text) => (text.trim() === "" ? ${msg} : null)`;
    if (w.rule.type === "minLength") return `(text) => (text.length < ${w.rule.min} ? ${msg} : null)`;
    return `(text) => (/${w.rule.pattern}/.test(text) ? null : ${msg})`;
  },
  format(w) {
    const f = w.format;
    const fixed = `value.toFixed(${f.decimals})`;
    if (f.type === "currency") return `(value) => ${JSON.stringify(f.symbol)} + ${fixed}`;
    if (f.type === "percent") return `(value) => ${fixed} + "%"`;
    return `(value) => ${fixed} + ${JSON.stringify(" " + f.unit)}`;
  },
};

// ---------------------------------------------------------------------------------------------
// The kind modules: what the compiler emits once per widget kind.

const HEAD = (names) => `import { ${names.join(", ")} } from "../runtime.js";
import { widget } from "./widget.js";
`;

const KINDS = {
  counter: `${HEAD(["element", "on", "setText", "setProp", "instance"])}
// type Msg = Inc | Dec | Reset
const Inc = [0];
const Dec = [1];
const Reset = [2];

function update(model, msg, c) {
  switch (msg[0]) {
    case 0: return { value: Math.min(c.max, model.value + c.step) };
    case 1: return { value: Math.max(c.min, model.value - c.step) };
    case 2: return { value: c.start };
  }
}

export function counter(parent, c, model) {
  const self = instance(model, update, patch, c);
  const root = widget(parent, c, "counter", self);
  const value = element(root, "output", { "data-role": "value" }, " ");
  const dec = element(root, "button", { "data-role": "dec" }, "-" + c.step);
  const inc = element(root, "button", { "data-role": "inc" }, "+" + c.step);
  const reset = element(root, "button", { "data-role": "reset" }, "Reset");
  on(dec, "click", () => self.send(Dec));
  on(inc, "click", () => self.send(Inc));
  on(reset, "click", () => self.send(Reset));

  function patch() {
    const m = self.m;
    setText(value, m.value);
    setProp(dec, "disabled", m.value <= c.min);
    setProp(inc, "disabled", m.value >= c.max);
  }
  patch();
  return self;
}
`,

  toggles: `${HEAD(["element", "on", "setText", "setProp", "instance"])}
// type Msg = Toggle Int
function update(model, msg) {
  return { on: model.on.map((on, i) => (i === msg[1] ? !on : on)) };
}

export function toggles(parent, c, model) {
  const self = instance(model, update, patch);
  const root = widget(parent, c, "toggles", self);
  const ul = element(root, "ul");
  const boxes = c.items.map((name, i) => {
    const label = element(element(ul, "li"), "label");
    const box = element(label, "input", { type: "checkbox", "data-role": "toggle", "data-key": i });
    label.append(name);
    on(box, "change", () => self.send([0, i]));
    return box;
  });
  const count = element(root, "p", { "data-role": "count" }, " ");

  function patch() {
    const m = self.m;
    boxes.forEach((box, i) => setProp(box, "checked", m.on[i]));
    setText(count, \`\${m.on.filter(Boolean).length} of \${c.items.length} on\`);
  }
  patch();
  return self;
}
`,

  field: `${HEAD(["element", "on", "setText", "setProp", "show", "instance"])}
// type Msg = Edit String
function update(model, msg) {
  return { text: msg[1] };
}

export function field(parent, c, model) {
  const self = instance(model, update, patch);
  const root = widget(parent, c, "field", self);
  const input = element(root, "input", { type: "text", "data-role": "input", placeholder: c.placeholder });
  on(input, "input", () => self.send([0, input.value]));
  const error = element(null, "p", { "data-role": "error" }, " ");

  function patch() {
    const m = self.m;
    const problem = c.validate(m.text);
    setProp(input, "value", m.text);
    if (problem) setText(error, problem);
    show(root, error, problem);
  }
  patch();
  return self;
}
`,

  todo: `${HEAD(["element", "on", "setText", "setProp", "instance", "list"])}
// type Msg = EditDraft String | Add | Toggle Int | Remove Int
function update(model, msg) {
  switch (msg[0]) {
    case 0: return { ...model, draft: msg[1] };
    case 1: {
      const text = model.draft.trim();
      if (text === "") return model;
      const id = model.items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
      return { items: [...model.items, { id, text, done: false }], draft: "" };
    }
    case 2: return { ...model, items: model.items.map((item) => (item.id === msg[1] ? { ...item, done: !item.done } : item)) };
    case 3: return { ...model, items: model.items.filter((item) => item.id !== msg[1]) };
  }
}

export function todo(parent, c, model) {
  const self = instance(model, update, patch);
  const root = widget(parent, c, "todo", self);
  const draft = element(root, "input", { type: "text", "data-role": "draft", placeholder: c.placeholder });
  on(draft, "input", () => self.send([0, draft.value]));
  on(element(root, "button", { "data-role": "add" }, c.addText), "click", () => self.send([1]));
  const items = list(element(root, "ul"), (item) => {
    const li = element(null, "li");
    const box = element(li, "input", { type: "checkbox", "data-role": "toggle" });
    const label = element(li, "span", null, " ");
    const remove = element(li, "button", { "data-role": "remove" }, c.removeText);
    on(box, "change", () => self.send([2, item.id]));
    on(remove, "click", () => self.send([3, item.id]));
    return {
      node: li,
      patch(next) {
        item = next;
        setProp(box, "checked", item.done);
        setText(label, item.text);
      },
    };
  });
  const left = element(root, "p", { "data-role": "left" }, " ");

  function patch() {
    const m = self.m;
    setProp(draft, "value", m.draft);
    items(m.items);
    setText(left, \`\${m.items.filter((item) => !item.done).length} left\`);
  }
  patch();
  return self;
}
`,

  tabs: `${HEAD(["element", "on", "setText", "setAttr", "instance"])}
// type Msg = Select Int
function update(model, msg) {
  return { active: msg[1] };
}

export function tabs(parent, c, model) {
  const self = instance(model, update, patch);
  const root = widget(parent, c, "tabs", self);
  const tablist = element(root, "div", { role: "tablist" });
  const buttons = c.tabs.map((tab, i) => {
    const button = element(tablist, "button", { role: "tab", "data-role": "tab", "data-key": i }, tab.title);
    on(button, "click", () => self.send([0, i]));
    return button;
  });
  const content = element(root, "p", { role: "tabpanel", "data-role": "tab-content" }, " ");

  function patch() {
    const m = self.m;
    buttons.forEach((button, i) => setAttr(button, "aria-selected", i === m.active ? "true" : "false"));
    setText(content, c.tabs[m.active].content);
  }
  patch();
  return self;
}
`,

  panel: `${HEAD(["element", "on", "setText", "setAttr", "show", "instance"])}
// type Msg = Toggle
function update(model) {
  return { open: !model.open };
}

export function panel(parent, c, model) {
  const self = instance(model, update, patch);
  const root = widget(parent, c, "panel", self);
  const toggle = element(root, "button", { "data-role": "toggle" }, " ");
  on(toggle, "click", () => self.send([0]));
  const body = element(null, "p", { "data-role": "body" }, c.body);

  function patch() {
    const m = self.m;
    setAttr(toggle, "aria-expanded", m.open ? "true" : "false");
    setText(toggle, m.open ? c.hideText : c.showText);
    show(root, body, m.open);
  }
  patch();
  return self;
}
`,

  choice: `${HEAD(["element", "on", "setProp", "show", "instance"])}
// type Msg = Choose String | EditExtra String
function update(model, msg) {
  switch (msg[0]) {
    case 0: return { ...model, option: msg[1] };
    case 1: return { ...model, extra: msg[1] };
  }
}

export function choice(parent, c, model) {
  const self = instance(model, update, patch);
  const root = widget(parent, c, "choice", self);
  const select = element(root, "select", { "data-role": "select" });
  for (const option of c.options) element(select, "option", { value: option.value }, option.label);
  on(select, "change", () => self.send([0, select.value]));
  const extra = element(null, "input", { type: "text", "data-role": "extra", placeholder: c.extraPlaceholder });
  on(extra, "input", () => self.send([1, extra.value]));

  function patch() {
    const m = self.m;
    setProp(select, "value", m.option);
    setProp(extra, "value", m.extra);
    show(root, extra, c.extraFor.includes(m.option));
  }
  patch();
  return self;
}
`,

  amount: `${HEAD(["element", "on", "setText", "instance"])}
// type Msg = Set Float
function update(model, msg) {
  return { value: msg[1] };
}

export function amount(parent, c, model) {
  const self = instance(model, update, patch);
  const root = widget(parent, c, "amount", self);
  const input = element(root, "input", { type: "number", "data-role": "input" });
  // Only a valid number is a message; anything else stays in the input, unsent.
  on(input, "input", () => {
    const value = input.valueAsNumber;
    if (!Number.isNaN(value)) self.send([0, value]);
  });
  const formatted = element(root, "output", { "data-role": "formatted" }, " ");

  function patch() {
    const m = self.m;
    if (input.valueAsNumber !== m.value) input.value = m.value;
    setText(formatted, c.format(m.value));
  }
  patch();
  return self;
}
`,

  filter: `${HEAD(["element", "on", "setText", "setProp", "instance", "list"])}
// type Msg = Edit String
function update(model, msg) {
  return { query: msg[1] };
}

export function filter(parent, c, model) {
  const self = instance(model, update, patch);
  const root = widget(parent, c, "filter", self);
  const input = element(root, "input", { type: "text", "data-role": "query", placeholder: c.placeholder });
  on(input, "input", () => self.send([0, input.value]));
  // The items are fixed per widget, so a row never changes once built.
  const shown = list(element(root, "ul"), (item) => ({
    node: element(null, "li", null, item.text),
    patch() {},
  }));
  const count = element(root, "p", { "data-role": "matches" }, " ");

  function patch() {
    const m = self.m;
    const query = m.query.toLowerCase();
    const matches = c.items.filter((item) => item.text.toLowerCase().includes(query));
    setProp(input, "value", m.query);
    shown(matches);
    setText(count, \`\${matches.length} matches\`);
  }
  patch();
  return self;
}
`,

  rating: `${HEAD(["element", "on", "setText", "setAttr", "instance"])}
// type Msg = Rate Int
function update(model, msg) {
  return { stars: msg[1] };
}

export function rating(parent, c, model) {
  const self = instance(model, update, patch);
  const root = widget(parent, c, "rating", self);
  const row = element(root, "div");
  const stars = [];
  for (let n = 1; n <= c.stars; n++) {
    const button = element(row, "button", { "data-role": "star", "data-key": n }, " ");
    stars.push(button);
    on(button, "click", () => self.send([0, n]));
  }
  const label = element(root, "p", { "data-role": "rating-label" }, " ");

  function patch() {
    const m = self.m;
    stars.forEach((button, i) => {
      setAttr(button, "aria-pressed", i < m.stars ? "true" : "false");
      setText(button, i < m.stars ? "★" : "☆");
    });
    setText(label, c.labels[m.stars]);
  }
  patch();
  return self;
}
`,

  feed: `${HEAD(["element", "on", "setText", "show", "instance", "list"])}
// type Msg = Dismiss Int | Notify Entry
export const notify = (entry) => [1, entry];

function update(model, msg) {
  switch (msg[0]) {
    case 0: return { entries: model.entries.filter((entry) => entry.id !== msg[1]) };
    case 1: return { entries: [...model.entries, msg[1]] };
  }
}

export function feed(parent, c, model) {
  const self = instance(model, update, patch);
  const root = widget(parent, c, "feed", self);
  const entries = list(element(root, "ul"), (entry) => {
    const li = element(null, "li");
    const label = element(li, "span", null, " ");
    on(element(li, "button", { "data-role": "dismiss" }, c.dismissText), "click", () => self.send([0, entry.id]));
    return { node: li, patch: (next) => setText(label, next.text) };
  });
  const empty = element(null, "p", { "data-role": "empty" }, c.emptyText);

  function patch() {
    const m = self.m;
    entries(m.entries);
    show(root, empty, m.entries.length === 0);
  }
  patch();
  return self;
}
`,

  clock: `${HEAD(["element", "on", "setText", "setProp", "instance"])}
// type Msg = Start | Stop | Reset | Tick
export const tick = [3];

function update(model, msg) {
  switch (msg[0]) {
    case 0: return { ...model, running: true };
    case 1: return { ...model, running: false };
    case 2: return { seconds: 0, running: false };
    case 3: return model.running ? { ...model, seconds: model.seconds + 1 } : model;
  }
}

function formatTime(seconds) {
  return \`\${Math.floor(seconds / 60)}:\${String(seconds % 60).padStart(2, "0")}\`;
}

export function clock(parent, c, model) {
  const self = instance(model, update, patch);
  const root = widget(parent, c, "clock", self);
  const time = element(root, "output", { "data-role": "time" }, " ");
  const start = element(root, "button", { "data-role": "start" }, c.startText);
  const stop = element(root, "button", { "data-role": "stop" }, c.stopText);
  const reset = element(root, "button", { "data-role": "reset" }, c.resetText);
  on(start, "click", () => self.send([0]));
  on(stop, "click", () => self.send([1]));
  on(reset, "click", () => self.send([2]));

  function patch() {
    const m = self.m;
    setText(time, formatTime(m.seconds));
    setProp(start, "disabled", m.running);
    setProp(stop, "disabled", !m.running);
  }
  patch();
  return self;
}
`,

  summary: `${HEAD(["element", "setText"])}
// No model and no messages: the line is derived from the instances it reads. Each of them
// schedules this patch when its model changes.
export function summary(parent, c, sources) {
  const root = widget(parent, c, "summary");
  const line = element(root, "p", { "data-role": "summary" }, " ");

  function patch() {
    setText(line, c.text(...sources.map((source) => source.m)));
  }
  for (const source of sources) source.watch(patch);
  patch();
}
`,
};

const WIDGET_FILE = `import { element } from "../runtime.js";

// The instances by widget id, for the external events that name a widget.
export const widgets = {};

// The frame every widget shares: its keyed section and its heading. A widget with a model
// registers its instance.
export function widget(parent, c, kind, self) {
  if (self) widgets[c.id] = self;
  const section = element(parent, "section", { "data-key": c.id, "data-role": "widget-" + kind });
  element(section, "h2", null, c.label);
  return section;
}
`;

const NUMBER_FILE = `// Round to at most two decimals for display.
export function formatNumber(n) {
  return String(Math.round(n * 100) / 100);
}
`;

// ---------------------------------------------------------------------------------------------
// Summaries: a function of the models they read, in the order of \`sources\`.

function metricExpr(src, model, itemsName) {
  switch (src.kind) {
    case "counter": case "amount": return `${model}.value`;
    case "toggles": return `${model}.on.filter(Boolean).length`;
    case "todo": return `${model}.items.filter((item) => !item.done).length`;
    case "rating": return `${model}.stars`;
    case "clock": return `${model}.seconds`;
    case "filter": return `${itemsName}.filter((item) => item.text.toLowerCase().includes(${model}.query.toLowerCase())).length`;
    case "feed": return `${model}.entries.length`;
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

// The source of a summary's `text` function: its parameters are the source models, named by
// the source widget's id (m3 for w3).
function summaryText(spec, w, indent) {
  const sources = w.sources.map((id) => byId(spec, id));
  const params = sources.map((src) => "m" + src.id.slice(1));
  const names = [];
  const lines = sources.map((src, i) => {
    let name = camelCase(src.label);
    while (names.includes(name)) name += "2";
    names.push(name);
    return `const ${name} = ${metricExpr(src, params[i], itemsName(src))};`;
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
  return `(${params.join(", ")}) => {\n${body}\n${indent}}`;
}

function needsFormatNumber(spec) {
  return spec.widgets.some((w) => w.kind === "summary" && w.sources.some((id) => byId(spec, id).kind === "amount"));
}

// ---------------------------------------------------------------------------------------------
// The app: one config and one factory call per widget, and the routing of external events.

function config(spec, w, readFilters) {
  const entries = [`id: "${w.id}"`, `label: ${JSON.stringify(w.label)}`];
  for (const name of PARAMS[w.kind]) {
    let code;
    if (name === "text") code = summaryText(spec, w, "    ");
    else if (FUNCTIONS[name]) code = FUNCTIONS[name](w);
    else if (w.kind === "filter" && name === "items" && readFilters.has(w.id)) code = itemsName(w);
    else code = literal(w[name], "    ");
    entries.push(`${name}: ${code}`);
  }
  const flat = `{ ${entries.join(", ")} }`;
  if (flat.length <= 80 && !flat.includes("\n")) return flat;
  return `{\n${entries.map((e) => "    " + e + ",").join("\n")}\n  }`;
}

function appFile(spec) {
  const kinds = [...new Set(spec.widgets.map((w) => w.kind))];
  const plain = spec.widgets.filter((w) => w.kind !== "summary");
  const clocks = plain.filter((w) => w.kind === "clock");
  const hasFeed = plain.some((w) => w.kind === "feed");

  // Filters read by a summary share their items through a constant.
  const readFilters = new Set(spec.widgets.filter((w) => w.kind === "summary")
    .flatMap((w) => w.sources).filter((id) => byId(spec, id).kind === "filter"));
  const consts = spec.widgets.filter((w) => readFilters.has(w.id))
    .map((w) => `const ${itemsName(w)} = ${literal(w.items)};`);

  const imports = [`import { element } from "./runtime.js";`, `import { widgets } from "./widgets/widget.js";`];
  for (const k of kinds) {
    const names = [k];
    if (k === "clock" && clocks.length) names.push("tick");
    if (k === "feed") names.push("notify");
    imports.push(`import { ${names.join(", ")} } from "./widgets/${k}.js";`);
  }
  if (needsFormatNumber(spec)) imports.push(`import { formatNumber } from "./number.js";`);

  // Only the widgets the app refers to (summary sources, clocks) need a name.
  const named = new Set([...spec.widgets.flatMap((w) => w.sources ?? []), ...clocks.map((w) => w.id)]);
  const calls = spec.widgets.map((w) => {
    const c = config(spec, w, readFilters);
    if (w.kind === "summary") return `  ${w.kind}(main, ${c}, [${w.sources.join(", ")}]);`;
    const call = `${w.kind}(main, ${c}, ${literal(spec.initialState.widgets[w.id], "  ")});`;
    return named.has(w.id) ? `  const ${w.id} = ${call}` : `  ${call}`;
  });

  const cases = [`      case "serverSet":
        widgets[msg.widget].set(msg.state);
        break;`];
  if (clocks.length) {
    cases.push(`      case "tick":
        for (const clock of [${clocks.map((w) => w.id).join(", ")}]) clock.send(tick);
        break;`);
  }
  if (hasFeed) {
    cases.push(`      case "notify":
        widgets[msg.widget].send(notify(msg.entry));
        break;`);
  }
  cases.push(`      case "snapshot":
        for (const id in msg.state.widgets) widgets[id].set(msg.state.widgets[id]);
        break;`);

  return `${imports.join("\n")}
${consts.length ? "\n" + consts.join("\n\n") + "\n" : ""}
export function App(root) {
  const main = element(root, "div", { "data-role": "dashboard" });
${calls.join("\n")}

  return {
    // External events, routed to the instances they concern.
    receive(msg) {
      switch (msg.type) {
${cases.join("\n")}
      }
    },
    dispose() {
      main.remove();
      for (const id in widgets) delete widgets[id];
    },
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
  for (const kind of new Set(spec.widgets.map((w) => w.kind))) files[`src/widgets/${kind}.js`] = KINDS[kind];
  if (needsFormatNumber(spec)) files["src/number.js"] = NUMBER_FILE;
  return {
    files,
    style: {
      components: "one module per widget kind (message tags, reducer, DOM factory), configured per widget",
      state: "each instance's model in its own closure; send(msg) runs the kind's reducer and schedules that instance's binding list",
      updates: "one patch function per instance, every DOM write skipped when unchanged; batched in a microtask",
      crossWidget: "summaries watch the instances they read and recompute when one changes",
      externalEvents: "serverSet/snapshot replace instance models; tick and notify are messages to clock and feed instances",
      lists: "runtime keyed list by item.id: patch changed rows, one forward placement pass when order or membership changes",
      conditionals: "node built once, attached while shown",
      events: "addEventListener per element: click, input, change for checkboxes and selects",
      build: "Vite production build, no framework plugin, hidden source maps",
    },
  };
}
