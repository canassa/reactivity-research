// The dashboard in Marko 6 (the Tags API).
//
// Style (recorded in every generated app's rr.json):
// - One reusable tag per widget kind (`src/tags/<kind>-widget.marko`, auto-discovered), configured
//   by attributes; every instance is a use of its kind's tag. The `-widget` suffix keeps the names
//   clear of native elements (`<summary>` is one).
// - State, by the `state` parameter; both are patterns of Marko's cheat sheet:
//   - `root` (not the default: the root cannot clear a number input's pending edit inside a tag,
//     so a same-value write leaves stale text): each kind tag declares its state as controllable `<let>`s
//     (`<let/value:=input.value>`), for state a parent may own. The root template, app.marko,
//     owns every widget's state as `<let>`s and binds them down with `:=`
//     (`<counter-widget value:=w1Value …/>`): the summaries read other widgets' state and the
//     external events replace it, and Marko has no context API, so the state is lifted to the
//     common parent.
//   - `local`: each kind tag owns its `<let>`s, seeded from its attributes
//     (`<let/value=input.value>`), and `<return>`s its state with an API (`set`, and `tick` or
//     `notify` where the kind has them). The root names each widget with a tag variable
//     (`<counter-widget/w1 …/>`), builds the summaries from `w1.value`, and routes external
//     events through `w1.set(state)`.
// - Derived values with `<const>` (field errors, filtered lists, summary texts and their terms).
// - Lists with `<for … by="id">` for keyed items, `<for>` (by index) for fixed lists, and
//   `<for from to>` for the stars. Immutable updates (`concat`, `toSpliced`), as Marko requires.
// - Conditional content with `<if>`.
// - Events as handlers in markup (`onClick() { … }`); inputs, checkboxes and selects are
//   controlled with `value:=`, `checked`/`checkedChange` and `<select value:=…>`. The number
//   input keeps an invalid edit in a local `pending` `<let>` (the cheat sheet's pattern for
//   uncommitted edits) and commits only valid numbers; the edit remembers the value it was made
//   over, so a new value from outside (serverSet, snapshot) replaces it.
// - Per-instance rules (a field's validation, an amount's format) are functions passed as
//   attributes.
// - External events: app.marko `<return>`s one function, the root's tag variable, which the
//   adapter calls with each message; it assigns the widgets' `<let>`s (root) or calls their
//   APIs (local).

import { templateFiles } from "../../frameworks/marko/framework.js";
import { attrs, literal, tplText, camelCase, pascal } from "../../frameworks/marko/source.js";

export const framework = "marko";

export const params = {
  state: {
    default: "local",
    choices: ["local", "root"],
    help: "where widget state lives: lifted into the root template and bound down with :=, or in each widget's tag, which <return>s its state and an API",
  },
};

const tagName = (kind) => `${kind}-widget`;

// The state fields of each kind: also the names of the tag's controllable attributes.
const FIELDS = {
  counter: ["value"], toggles: ["on"], field: ["text"], todo: ["items", "draft"], tabs: ["active"],
  panel: ["open"], choice: ["option", "extra"], amount: ["value"], filter: ["query"],
  rating: ["stars"], feed: ["entries"], clock: ["seconds", "running"], summary: [],
};

// The plain-data attributes each kind takes beyond id and label, from the widget's parameters.
const PARAMS = {
  counter: (w) => ({ step: w.step, min: w.min, max: w.max, start: w.start }),
  toggles: (w) => ({ items: w.items }),
  field: (w) => ({ placeholder: w.placeholder }),
  todo: (w) => ({ placeholder: w.placeholder, addText: w.addText, removeText: w.removeText }),
  tabs: (w) => ({ tabs: w.tabs }),
  panel: (w) => ({ showText: w.showText, hideText: w.hideText, body: w.body }),
  choice: (w) => ({ options: w.options, extraFor: w.extraFor, extraPlaceholder: w.extraPlaceholder }),
  amount: () => ({}),
  filter: (w) => ({ placeholder: w.placeholder }),
  rating: (w) => ({ count: w.stars, labels: w.labels }),
  feed: (w) => ({ emptyText: w.emptyText, dismissText: w.dismissText }),
  clock: (w) => ({ startText: w.startText, stopText: w.stopText, resetText: w.resetText }),
  summary: () => ({}),
};

// Attributes that are functions: their source, built from the widget's rules.
const FUNCTIONS = {
  field: (w) => {
    const msg = JSON.stringify(w.rule.message);
    if (w.rule.type === "required") return { validate: `(text) => (text.trim() === "" ? ${msg} : null)` };
    if (w.rule.type === "minLength") return { validate: `(text) => (text.length < ${w.rule.min} ? ${msg} : null)` };
    return { validate: `(text) => (/${w.rule.pattern}/.test(text) ? null : ${msg})` };
  },
  amount: (w) => {
    const f = w.format;
    const fixed = `value.toFixed(${f.decimals})`;
    if (f.type === "currency") return { format: `(value) => ${JSON.stringify(f.symbol)} + ${fixed}` };
    if (f.type === "percent") return { format: `(value) => ${fixed} + "%"` };
    return { format: `(value) => ${fixed} + ${JSON.stringify(" " + f.unit)}` };
  },
};

// The kind tags. Each is the whole .marko file.
const TAGS = {
  counter: `<let/value:=input.value>

<section data-key=input.id data-role="widget-counter">
  <h2>\${input.label}</h2>
  <output data-role="value">\${value}</output>
  <button data-role="dec" disabled=(value <= input.min) onClick() { value = Math.max(input.min, value - input.step) }>
    -\${input.step}
  </button>
  <button data-role="inc" disabled=(value >= input.max) onClick() { value = Math.min(input.max, value + input.step) }>
    +\${input.step}
  </button>
  <button data-role="reset" onClick() { value = input.start }>Reset</button>
</section>
`,

  toggles: `<let/on:=input.on>

<section data-key=input.id data-role="widget-toggles">
  <h2>\${input.label}</h2>
  <ul>
    <for|name, i| of=input.items>
      <li>
        <label>
          <input type="checkbox" data-role="toggle" data-key=i checked=on[i] checkedChange(checked) { on = on.toSpliced(i, 1, checked) }>
          \${name}
        </label>
      </li>
    </for>
  </ul>
  <p data-role="count">\${on.filter(Boolean).length} of \${input.items.length} on</p>
</section>
`,

  field: `<let/text:=input.text>
<const/error=input.validate(text)>

<section data-key=input.id data-role="widget-field">
  <h2>\${input.label}</h2>
  <input type="text" data-role="input" placeholder=input.placeholder value:=text>
  <if=error>
    <p data-role="error">\${error}</p>
  </if>
</section>
`,

  todo: `<let/items:=input.items>
<let/draft:=input.draft>

<section data-key=input.id data-role="widget-todo">
  <h2>\${input.label}</h2>
  <input type="text" data-role="draft" placeholder=input.placeholder value:=draft>
  <button data-role="add" onClick() {
    const text = draft.trim();
    if (text) {
      const id = items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
      items = items.concat({ id, text, done: false });
      draft = "";
    }
  }>
    \${input.addText}
  </button>
  <ul>
    <for|item, i| of=items by="id">
      <li data-key=item.id>
        <input type="checkbox" data-role="toggle" checked=item.done checkedChange(done) { items = items.toSpliced(i, 1, { ...item, done }) }>
        <span>\${item.text}</span>
        <button data-role="remove" onClick() { items = items.toSpliced(i, 1) }>\${input.removeText}</button>
      </li>
    </for>
  </ul>
  <p data-role="left">\${items.filter((item) => !item.done).length} left</p>
</section>
`,

  tabs: `<let/active:=input.active>

<section data-key=input.id data-role="widget-tabs">
  <h2>\${input.label}</h2>
  <div role="tablist">
    <for|tab, i| of=input.tabs>
      <button role="tab" data-role="tab" data-key=i aria-selected=(i === active ? "true" : "false") onClick() { active = i }>
        \${tab.title}
      </button>
    </for>
  </div>
  <p role="tabpanel" data-role="tab-content">\${input.tabs[active].content}</p>
</section>
`,

  panel: `<let/open:=input.open>

<section data-key=input.id data-role="widget-panel">
  <h2>\${input.label}</h2>
  <button data-role="toggle" aria-expanded=(open ? "true" : "false") onClick() { open = !open }>
    \${open ? input.hideText : input.showText}
  </button>
  <if=open>
    <p data-role="body">\${input.body}</p>
  </if>
</section>
`,

  choice: `<let/option:=input.option>
<let/extra:=input.extra>

<section data-key=input.id data-role="widget-choice">
  <h2>\${input.label}</h2>
  <select data-role="select" value:=option>
    <for|choice| of=input.options>
      <option value=choice.value>\${choice.label}</option>
    </for>
  </select>
  <if=input.extraFor.includes(option)>
    <input type="text" data-role="extra" placeholder=input.extraPlaceholder value:=extra>
  </if>
</section>
`,

  amount: `<let/value:=input.value>
// An edit that is not a number yet (empty, a lone "-") stays in the input, uncommitted. It is
// remembered with the value it was made over, so a new value from outside replaces it.
<let/pending=null>
<const/draft=(pending?.over === value ? pending.text : value)>

<section data-key=input.id data-role="widget-amount">
  <h2>\${input.label}</h2>
  <input type="number" data-role="input" value=draft valueChange(text) {
    if (text === "") {
      pending = { over: value, text };
    } else {
      value = +text;
      pending = null;
    }
  }>
  <output data-role="formatted">\${input.format(value)}</output>
</section>
`,

  filter: `<let/query:=input.query>
<const/shown=input.items.filter((item) => item.text.toLowerCase().includes(query.toLowerCase()))>

<section data-key=input.id data-role="widget-filter">
  <h2>\${input.label}</h2>
  <input type="text" data-role="query" placeholder=input.placeholder value:=query>
  <ul>
    <for|item| of=shown by="id">
      <li data-key=item.id>\${item.text}</li>
    </for>
  </ul>
  <p data-role="matches">\${shown.length} matches</p>
</section>
`,

  rating: `<let/stars:=input.stars>

<section data-key=input.id data-role="widget-rating">
  <h2>\${input.label}</h2>
  <div>
    <for|n| from=1 to=input.count>
      <button data-role="star" data-key=n aria-pressed=(n <= stars ? "true" : "false") onClick() { stars = n }>
        \${n <= stars ? "★" : "☆"}
      </button>
    </for>
  </div>
  <p data-role="rating-label">\${input.labels[stars]}</p>
</section>
`,

  feed: `<let/entries:=input.entries>

<section data-key=input.id data-role="widget-feed">
  <h2>\${input.label}</h2>
  <ul>
    <for|entry, i| of=entries by="id">
      <li data-key=entry.id>
        <span>\${entry.text}</span>
        <button data-role="dismiss" onClick() { entries = entries.toSpliced(i, 1) }>\${input.dismissText}</button>
      </li>
    </for>
  </ul>
  <if=entries.length === 0>
    <p data-role="empty">\${input.emptyText}</p>
  </if>
</section>
`,

  clock: `static function formatTime(seconds) {
  return \`\${Math.floor(seconds / 60)}:\${String(seconds % 60).padStart(2, "0")}\`;
}

<let/seconds:=input.seconds>
<let/running:=input.running>

<section data-key=input.id data-role="widget-clock">
  <h2>\${input.label}</h2>
  <output data-role="time">\${formatTime(seconds)}</output>
  <button data-role="start" disabled=running onClick() { running = true }>\${input.startText}</button>
  <button data-role="stop" disabled=!running onClick() { running = false }>\${input.stopText}</button>
  <button data-role="reset" onClick() {
    seconds = 0;
    running = false;
  }>
    \${input.resetText}
  </button>
</section>
`,

  summary: `<section data-key=input.id data-role="widget-summary">
  <h2>\${input.label}</h2>
  <p data-role="summary">\${input.text}</p>
</section>
`,
};

// ---------------------------------------------------------------------------------------------
// Widget-local state (`--state local`): the kind tag owns its `<let>`s, seeded from its
// attributes, and `<return>`s its state and an API, the pattern of Marko's cheat sheet
// (`<return=api>` in the child, `<Child/api>` then `api.x()` in the parent).
const METHODS = {
  clock: `tick() {
    if (running) seconds++;
  }`,
  feed: `notify(entry) {
    entries = entries.concat(entry);
  }`,
};

function localTag(kind) {
  const fields = FIELDS[kind];
  if (fields.length === 0) return TAGS[kind];
  const src = TAGS[kind].replace(/<let\/(\w+):=input\.\1>/g, "<let/$1=input.$1>");
  const set = `set(state) {\n${fields.map((f) => `    ${f} = state.${f};`).join("\n")}${kind === "amount" ? "\n    pending = null;" : ""}\n  }`;
  const members = [...fields, set, ...(METHODS[kind] ? [METHODS[kind]] : [])];
  return `${src}
// The widget's state, for the dashboard's summaries, and its API for external events.
<return={
${members.map((m) => `  ${m},`).join("\n")}
}>
`;
}

// ---------------------------------------------------------------------------------------------
// The root template

// Where a widget's state field lives, read from the root: its own `<let>` in the root (w3Items),
// or the widget's returned value (w3.items).
const stateName = (w, field) => `${w.id}${pascal(field)}`;

// A summary's term for one source widget, over that state.
function metricExpr(src, itemsName, s) {
  switch (src.kind) {
    case "counter": case "amount": return s("value");
    case "toggles": return `${s("on")}.filter(Boolean).length`;
    case "todo": return `${s("items")}.filter((item) => !item.done).length`;
    case "rating": return s("stars");
    case "clock": return s("seconds");
    case "filter": return `${itemsName(src)}.filter((item) => item.text.toLowerCase().includes(${s("query")}.toLowerCase())).length`;
    case "feed": return `${s("entries")}.length`;
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

// The suffix naming a source's term: counterValue → "dailyVisitors", todo → "kitchenTasksLeft".
const TERM_SUFFIX = { toggles: "On", todo: "Left", filter: "Found", feed: "Count" };

function appFile(spec, local) {
  const byId = (id) => spec.widgets.find((x) => x.id === id);
  const widgets = spec.widgets.filter((w) => w.kind !== "summary");
  const summaries = spec.widgets.filter((w) => w.kind === "summary");
  const sourceIds = [...new Set(summaries.flatMap((w) => w.sources))];
  const needsFormatNumber = summaries.some((w) => w.sources.some((id) => byId(id).kind === "amount"));
  const initial = (w, f) => spec.initialState.widgets[w.id][f];

  // Filters read by a summary share their items through a module constant.
  const itemsName = (w) => `${camelCase(w.label)}Items`;
  const statics = sourceIds.map(byId).filter((w) => w.kind === "filter")
    .map((w) => `static const ${itemsName(w)} = ${literal(w.items)};`);
  if (needsFormatNumber) {
    statics.push(`// Round to at most two decimals for display.
static function formatNumber(n) {
  return String(Math.round(n * 100) / 100);
}`);
  }

  // Root-lifted state: one <let> per field of every widget.
  const lets = local ? [] : widgets.flatMap((w) => FIELDS[w.kind].map((f) => `<let/${stateName(w, f)}=${literal(initial(w, f))}>`));

  // Derived: per summary, a <const> for each term that is more than a plain read (once, where it
  // is first needed), then the summary's text. With root state they sit at the top with the
  // <let>s; with local state they sit just before their summary, after the widgets whose tag
  // variables they read (a tag variable read before its tag is a hoisted getter, not a value).
  const termName = {};
  const used = new Set();
  const textName = (w) => `${camelCase(w.label)}Text`;
  const before = {};
  for (const w of summaries) {
    const own = (before[w.id] = []);
    for (const id of w.sources) {
      if (termName[id]) continue;
      const src = byId(id);
      const expr = metricExpr(src, itemsName, (f) => (local ? `${src.id}.${f}` : stateName(src, f)));
      if (/^[\w.]+$/.test(expr)) {
        termName[id] = expr;
        continue;
      }
      let name = camelCase(src.label) + (TERM_SUFFIX[src.kind] ?? "");
      while (used.has(name)) name += "2";
      used.add(name);
      termName[id] = name;
      own.push(`<const/${name}=${expr}>`);
    }
    const sources = w.sources.map(byId);
    const names = w.sources.map((id) => termName[id]);
    // Only amounts can hold fractions; their terms (and any total including them) are rounded.
    const decimal = sources.map((src) => src.kind === "amount");
    const show = (i) => (decimal[i] ? `\${formatNumber(${names[i]})}` : `\${${names[i]}}`);
    const total = decimal.some(Boolean) ? `formatNumber(${names.join(" + ")})` : names.join(" + ");
    let text;
    if (w.formula === "sum") text = `${tplText(w.prefix)}: \${${total}}`;
    else if (w.formula === "breakdown") text = `${tplText(w.prefix)}: ${names.map((_, i) => show(i)).join(" + ")} = \${${total}}`;
    else text = sources.map((src, i) => PHRASES[src.kind](show(i), src)).join("; ");
    own.push(`<const/${textName(w)}=\`${text}\`>`);
  }
  const consts = local ? [] : summaries.flatMap((w) => before[w.id]);

  // The widgets: bound to the root's <let>s, or seeded and named by a tag variable.
  const elements = spec.widgets.map((w) => {
    let a = attrs({ id: w.id, label: w.label, ...PARAMS[w.kind](w) }, "    ");
    if (w.kind === "filter") a += ` items=${sourceIds.includes(w.id) ? itemsName(w) : literal(w.items, "    ")}`;
    for (const [k, src] of Object.entries(FUNCTIONS[w.kind]?.(w) ?? {})) a += ` ${k}=${src}`;
    for (const f of FIELDS[w.kind]) a += local ? ` ${f}=${literal(initial(w, f), "    ")}` : ` ${f}:=${stateName(w, f)}`;
    if (w.kind === "summary") a += ` text=${textName(w)}`;
    const tagVar = local && w.kind !== "summary" ? `/${w.id}` : "";
    const element = `  <${tagName(w.kind)}${tagVar}${a}/>`;
    return local && w.kind === "summary" ? [...before[w.id].map((c) => "  " + c), element].join("\n") : element;
  });

  const head = [statics.join("\n\n"), [...lets, ...consts].join("\n")].filter(Boolean);
  return `${head.map((h) => h + "\n\n").join("")}<div data-role="dashboard">
${elements.join("\n")}
${local ? `  // External events, through the widgets' APIs. Declared beside the widgets: a function at the
  // root would read their tag variables through hoisted getters, which Marko 6.4.6 compiles
  // without the scope they need (see frameworks/marko/README.md).
${localReceive(widgets)}
` : ""}</div>

// External events: the root's tag variable, which the adapter calls with each message.
${local ? "<return=receive>\n" : rootReceive(widgets)}`;
}

// Root-lifted state: the function assigns the root's <let>s.
function rootReceive(widgets) {
  const setCases = widgets.map((w) => `      case "${w.id}":\n${FIELDS[w.kind].map((f) => `        ${stateName(w, f)} = state.${f};\n`).join("")}        break;`);
  const clocks = widgets.filter((w) => w.kind === "clock");
  const feeds = widgets.filter((w) => w.kind === "feed");
  const cases = [`    case "serverSet":
      setWidget(msg.widget, msg.state);
      break;`];
  if (clocks.length) {
    cases.push(`    case "tick":
${clocks.map((w) => `      if (${stateName(w, "running")}) ${stateName(w, "seconds")}++;\n`).join("")}      break;`);
  }
  if (feeds.length) {
    cases.push(`    case "notify":
      switch (msg.widget) {
${feeds.map((w) => `        case "${w.id}":\n          ${stateName(w, "entries")} = ${stateName(w, "entries")}.concat(msg.entry);\n          break;`).join("\n")}
      }
      break;`);
  }
  cases.push(`    case "snapshot":
      for (const [id, state] of Object.entries(msg.state.widgets)) setWidget(id, state);
      break;`);
  return `<return=(msg) => {
  function setWidget(id, state) {
    switch (id) {
${setCases.join("\n")}
    }
  }
  switch (msg.type) {
${cases.join("\n")}
  }
}>
`;
}

// Widget-local state: the function calls the widgets' returned APIs.
function localReceive(widgets) {
  const clocks = widgets.filter((w) => w.kind === "clock");
  const hasFeed = widgets.some((w) => w.kind === "feed");
  const cases = [`    case "serverSet":
      widgets[msg.widget].set(msg.state);
      break;`];
  if (clocks.length) {
    cases.push(`    case "tick":
${clocks.map((w) => `      ${w.id}.tick();\n`).join("")}      break;`);
  }
  if (hasFeed) {
    cases.push(`    case "notify":
      widgets[msg.widget].notify(msg.entry);
      break;`);
  }
  cases.push(`    case "snapshot":
      for (const [id, state] of Object.entries(msg.state.widgets)) widgets[id].set(state);
      break;`);
  const ids = widgets.map((w) => w.id);
  const list = `{ ${ids.join(", ")} }`;
  const widgetsLine = list.length <= 80 ? `  const widgets = ${list};` : `  const widgets = {\n${ids.map((id) => `    ${id},`).join("\n")}\n  };`;
  const receive = `<const/receive=(msg) => {
${widgetsLine}
  switch (msg.type) {
${cases.join("\n")}
  }
}>`;
  return receive.replace(/^(?=.)/gm, "  ");
}

export function emit(spec, options = {}) {
  const local = (options.state ?? "local") === "local";
  const files = {
    ...templateFiles({ name: "dashboard", title: "Dashboard" }),
    "src/app.marko": appFile(spec, local),
  };
  for (const kind of [...new Set(spec.widgets.map((w) => w.kind))]) {
    files[`src/tags/${tagName(kind)}.marko`] = local ? localTag(kind) : TAGS[kind];
  }
  return {
    files,
    style: {
      components: "one reusable tag per widget kind (src/tags/<kind>-widget.marko), configured by attributes",
      state: local
        ? "each widget's state as <let>s in its own tag, seeded from attributes; the tag <return>s its state and an API (set, tick, notify), read by the root through tag variables"
        : "every widget's state as <let>s in the root template, bound down with := to controllable <let>s in the kind tags",
      externalEvents: local
        ? "app.marko <return>s a function (the root's tag variable) that calls the widgets' returned APIs"
        : "app.marko <return>s a function (the root's tag variable) that assigns the widgets' <let>s",
      lists: "<for by=\"id\"> for keyed items, <for> by index for fixed lists, <for from to> for stars; immutable updates",
      conditionals: "<if>",
      derived: "<const> (field errors, filtered lists, summary terms and texts)",
      events: "handlers in markup (onClick); value:=, checked/checkedChange and <select value:=> for inputs; the number input commits only valid numbers, keeping an invalid edit in a local pending <let> until the value changes",
      build: "Vite + @marko/vite (linked: false), production mode, client-only mount, hidden source maps",
    },
  };
}
