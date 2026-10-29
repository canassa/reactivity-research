// The dashboard in React 19.
//
// Style (recorded in every generated app's rr.json):
// - State lifted up: one `useState` in `App` holds every widget's state (the summaries read
//   several widgets, and external events reach any of them), shared through a context. Widgets
//   read their slice with a `useWidget(id)` hook and change it with updater functions, so two
//   events before a render both apply. External events arrive through a subscription in an
//   effect and go through `receive`, a pure function of the state.
// - One reusable component per widget kind, configured by props (function props for each
//   widget's own rules), as React's docs present components.
// - Lists with `.map` and `key` (item ids; the index for a widget's fixed lists of labels).
//   Conditional content with `&&`. Derived values computed during render, no memoization (the
//   React Compiler, when on, adds it).
// - Controlled inputs with `onChange`. The number input keeps a draft of text that is not a
//   number, dropped when its slice changes (the docs' "adjusting state when a prop changes").

import { templateFiles, params as frameworkParams } from "../../frameworks/react/framework.js";
import { literal, jsxAttr, tplText, camelCase } from "../../frameworks/shared/jsx.js";

export const framework = "react";

export const params = { ...frameworkParams };

const KIND_COMPONENT = {
  counter: "Counter", toggles: "Toggles", field: "Field", todo: "Todo", tabs: "Tabs", panel: "Panel",
  choice: "Choice", amount: "Amount", filter: "Filter", rating: "Rating", feed: "Feed", clock: "Clock",
  summary: "Summary",
};

// The props each kind takes, beyond id and label.
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
  summary: [],
};

// Parameters that are functions: their source, built from the widget's rules.
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

// Component bodies, per kind: the react imports each needs, its other imports, and the body of
// the function, which takes the destructured props given in `props`.
const TEMPLATES = {
  counter: () => ({
    props: "id, label, step, min, max, start",
    body: `
  const [counter, update] = useWidget(id);
  return (
    <section data-key={id} data-role="widget-counter">
      <h2>{label}</h2>
      <output data-role="value">{counter.value}</output>
      <button data-role="dec" disabled={counter.value <= min} onClick={() => update((c) => ({ value: Math.max(min, c.value - step) }))}>
        -{step}
      </button>
      <button data-role="inc" disabled={counter.value >= max} onClick={() => update((c) => ({ value: Math.min(max, c.value + step) }))}>
        +{step}
      </button>
      <button data-role="reset" onClick={() => update(() => ({ value: start }))}>
        Reset
      </button>
    </section>
  );`,
  }),

  toggles: () => ({
    props: "id, label, items",
    body: `
  const [toggles, update] = useWidget(id);
  const count = toggles.on.filter(Boolean).length;
  return (
    <section data-key={id} data-role="widget-toggles">
      <h2>{label}</h2>
      <ul>
        {items.map((name, i) => (
          <li key={i}>
            <label>
              <input type="checkbox" data-role="toggle" data-key={i} checked={toggles.on[i]} onChange={() => update((t) => ({ on: t.on.map((on, j) => (j === i ? !on : on)) }))} />
              {name}
            </label>
          </li>
        ))}
      </ul>
      <p data-role="count">
        {count} of {items.length} on
      </p>
    </section>
  );`,
  }),

  field: () => ({
    props: "id, label, placeholder, validate",
    body: `
  const [field, update] = useWidget(id);
  const error = validate(field.text);
  return (
    <section data-key={id} data-role="widget-field">
      <h2>{label}</h2>
      <input type="text" data-role="input" placeholder={placeholder} value={field.text} onChange={(e) => update(() => ({ text: e.target.value }))} />
      {error && <p data-role="error">{error}</p>}
    </section>
  );`,
  }),

  todo: () => ({
    props: "id, label, placeholder, addText, removeText",
    body: `
  const [todo, update] = useWidget(id);
  const left = todo.items.filter((item) => !item.done).length;
  function add() {
    update((t) => {
      const text = t.draft.trim();
      if (!text) return t;
      const next = t.items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
      return { items: [...t.items, { id: next, text, done: false }], draft: "" };
    });
  }
  return (
    <section data-key={id} data-role="widget-todo">
      <h2>{label}</h2>
      <input type="text" data-role="draft" placeholder={placeholder} value={todo.draft} onChange={(e) => update((t) => ({ ...t, draft: e.target.value }))} />
      <button data-role="add" onClick={add}>
        {addText}
      </button>
      <ul>
        {todo.items.map((item) => (
          <li key={item.id} data-key={item.id}>
            <input type="checkbox" data-role="toggle" checked={item.done} onChange={() => update((t) => ({ ...t, items: t.items.map((it) => (it.id === item.id ? { ...it, done: !it.done } : it)) }))} />
            <span>{item.text}</span>
            <button data-role="remove" onClick={() => update((t) => ({ ...t, items: t.items.filter((it) => it.id !== item.id) }))}>
              {removeText}
            </button>
          </li>
        ))}
      </ul>
      <p data-role="left">{left} left</p>
    </section>
  );`,
  }),

  tabs: () => ({
    props: "id, label, tabs",
    body: `
  const [selected, update] = useWidget(id);
  return (
    <section data-key={id} data-role="widget-tabs">
      <h2>{label}</h2>
      <div role="tablist">
        {tabs.map((tab, i) => (
          <button key={i} role="tab" data-role="tab" data-key={i} aria-selected={selected.active === i} onClick={() => update(() => ({ active: i }))}>
            {tab.title}
          </button>
        ))}
      </div>
      <p role="tabpanel" data-role="tab-content">
        {tabs[selected.active].content}
      </p>
    </section>
  );`,
  }),

  panel: () => ({
    props: "id, label, showText, hideText, body",
    body: `
  const [panel, update] = useWidget(id);
  return (
    <section data-key={id} data-role="widget-panel">
      <h2>{label}</h2>
      <button data-role="toggle" aria-expanded={panel.open} onClick={() => update((p) => ({ open: !p.open }))}>
        {panel.open ? hideText : showText}
      </button>
      {panel.open && <p data-role="body">{body}</p>}
    </section>
  );`,
  }),

  choice: () => ({
    props: "id, label, options, extraFor, extraPlaceholder",
    body: `
  const [choice, update] = useWidget(id);
  return (
    <section data-key={id} data-role="widget-choice">
      <h2>{label}</h2>
      <select data-role="select" value={choice.option} onChange={(e) => update((c) => ({ ...c, option: e.target.value }))}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {extraFor.includes(choice.option) && (
        <input type="text" data-role="extra" placeholder={extraPlaceholder} value={choice.extra} onChange={(e) => update((c) => ({ ...c, extra: e.target.value }))} />
      )}
    </section>
  );`,
  }),

  amount: () => ({
    react: ["useState"],
    props: "id, label, format",
    body: `
  const [amount, update] = useWidget(id);
  // What the input shows while it holds no number (empty, a lone "-"): kept until the amount
  // changes, so the text being typed is not replaced by the stored value.
  const [draft, setDraft] = useState(null);
  const [shown, setShown] = useState(amount);
  if (amount !== shown) {
    setShown(amount);
    setDraft(null);
  }
  function change(e) {
    const value = e.target.valueAsNumber;
    if (Number.isNaN(value)) {
      setDraft(e.target.value);
    } else {
      setDraft(null);
      update(() => ({ value }));
    }
  }
  return (
    <section data-key={id} data-role="widget-amount">
      <h2>{label}</h2>
      <input type="number" data-role="input" value={draft ?? amount.value} onChange={change} />
      <output data-role="formatted">{format(amount.value)}</output>
    </section>
  );`,
  }),

  filter: () => ({
    props: "id, label, items, placeholder",
    body: `
  const [filter, update] = useWidget(id);
  const query = filter.query.toLowerCase();
  const shown = items.filter((item) => item.text.toLowerCase().includes(query));
  return (
    <section data-key={id} data-role="widget-filter">
      <h2>{label}</h2>
      <input type="text" data-role="query" placeholder={placeholder} value={filter.query} onChange={(e) => update(() => ({ query: e.target.value }))} />
      <ul>
        {shown.map((item) => (
          <li key={item.id} data-key={item.id}>
            {item.text}
          </li>
        ))}
      </ul>
      <p data-role="matches">{shown.length} matches</p>
    </section>
  );`,
  }),

  rating: () => ({
    props: "id, label, stars, labels",
    body: `
  const [rating, update] = useWidget(id);
  const numbers = Array.from({ length: stars }, (_, i) => i + 1);
  return (
    <section data-key={id} data-role="widget-rating">
      <h2>{label}</h2>
      <div>
        {numbers.map((n) => (
          <button key={n} data-role="star" data-key={n} aria-pressed={n <= rating.stars} onClick={() => update(() => ({ stars: n }))}>
            {n <= rating.stars ? "★" : "☆"}
          </button>
        ))}
      </div>
      <p data-role="rating-label">{labels[rating.stars]}</p>
    </section>
  );`,
  }),

  feed: () => ({
    props: "id, label, emptyText, dismissText",
    body: `
  const [feed, update] = useWidget(id);
  return (
    <section data-key={id} data-role="widget-feed">
      <h2>{label}</h2>
      <ul>
        {feed.entries.map((entry) => (
          <li key={entry.id} data-key={entry.id}>
            <span>{entry.text}</span>
            <button data-role="dismiss" onClick={() => update((f) => ({ entries: f.entries.filter((e) => e.id !== entry.id) }))}>
              {dismissText}
            </button>
          </li>
        ))}
      </ul>
      {feed.entries.length === 0 && <p data-role="empty">{emptyText}</p>}
    </section>
  );`,
  }),

  clock: () => ({
    imports: ['import { formatTime } from "../time";'],
    props: "id, label, startText, stopText, resetText",
    body: `
  const [clock, update] = useWidget(id);
  return (
    <section data-key={id} data-role="widget-clock">
      <h2>{label}</h2>
      <output data-role="time">{formatTime(clock.seconds)}</output>
      <button data-role="start" disabled={clock.running} onClick={() => update((c) => ({ ...c, running: true }))}>
        {startText}
      </button>
      <button data-role="stop" disabled={!clock.running} onClick={() => update((c) => ({ ...c, running: false }))}>
        {stopText}
      </button>
      <button data-role="reset" onClick={() => update(() => ({ seconds: 0, running: false }))}>
        {resetText}
      </button>
    </section>
  );`,
  }),
};

// ---------------------------------------------------------------------------------------------
// Summaries: a derived value computed in App's render from other widgets' slices.

function metricExpr(src, slice, itemsName) {
  switch (src.kind) {
    case "counter": case "amount": return `${slice}.value`;
    case "toggles": return `${slice}.on.filter(Boolean).length`;
    case "todo": return `${slice}.items.filter((item) => !item.done).length`;
    case "rating": return `${slice}.stars`;
    case "clock": return `${slice}.seconds`;
    case "filter": return `${itemsName()}.filter((item) => item.text.toLowerCase().includes(${slice}.query.toLowerCase())).length`;
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

// The statements of a function computing a summary's text from `widgets`.
function summaryBody(spec, w, itemsName, indent) {
  const sources = w.sources.map((id) => spec.widgets.find((x) => x.id === id));
  const names = [];
  const lines = sources.map((src) => {
    let name = camelCase(src.label);
    while (names.includes(name)) name += "2";
    names.push(name);
    return `const ${name} = ${metricExpr(src, `widgets.${src.id}`, () => itemsName(src))};`;
  });
  // Only amounts can hold fractions; their terms (and any total including them) are rounded.
  const decimal = sources.map((src) => src.kind === "amount");
  const show = (i) => (decimal[i] ? `\${formatNumber(${names[i]})}` : `\${${names[i]}}`);
  const total = decimal.some(Boolean) ? `formatNumber(${names.join(" + ")})` : names.join(" + ");
  let text;
  if (w.formula === "sum") text = `${tplText(w.prefix)}: \${${total}}`;
  else if (w.formula === "breakdown") text = `${tplText(w.prefix)}: ${names.map((_, i) => show(i)).join(" + ")} = \${${total}}`;
  else text = sources.map((src, i) => PHRASES[src.kind](show(i), src)).join("; ");
  return [...lines, `return \`${text}\`;`].map((l) => indent + l).join("\n");
}

function needsFormatNumber(spec) {
  return spec.widgets.some((w) => w.kind === "summary" && w.sources.some((id) => spec.widgets.find((x) => x.id === id).kind === "amount"));
}

// ---------------------------------------------------------------------------------------------
// Files

function stateFile(spec) {
  const widgets = spec.widgets.filter((w) => w.kind !== "summary");
  const clocks = widgets.filter((w) => w.kind === "clock").map((w) => w.id);
  const hasFeed = widgets.some((w) => w.kind === "feed");
  const cases = [
    `    case "serverSet":
      return { ...widgets, [msg.widget]: msg.state };`,
  ];
  if (clocks.length) {
    cases.push(`    case "tick": {
      const next = { ...widgets };
      for (const id of ${literal(clocks)}) {
        if (widgets[id].running) next[id] = { ...widgets[id], seconds: widgets[id].seconds + 1 };
      }
      return next;
    }`);
  }
  if (hasFeed) {
    cases.push(`    case "notify": {
      const feed = widgets[msg.widget];
      return { ...widgets, [msg.widget]: { ...feed, entries: [...feed.entries, msg.entry] } };
    }`);
  }
  cases.push(`    case "snapshot":
      return msg.state.widgets;`);
  return `import { createContext, useContext } from "react";

export const initialWidgets = ${literal(spec.initialState.widgets)};

// Every widget's state and its setter, provided by App.
export const WidgetsContext = createContext(null);

// A widget's slice of the state, and a function applying an updater to it.
export function useWidget(id) {
  const { widgets, setWidgets } = useContext(WidgetsContext);
  return [widgets[id], (fn) => setWidgets((all) => ({ ...all, [id]: fn(all[id]) }))];
}

// The state after an external event.
export function receive(widgets, msg) {
  switch (msg.type) {
${cases.join("\n")}
  }
  return widgets;
}
`;
}

function component(name, kind) {
  const t = TEMPLATES[kind]();
  const imports = [];
  if (t.react) imports.push(`import { ${t.react.join(", ")} } from "react";`);
  imports.push(`import { useWidget } from "../state";`);
  imports.push(...(t.imports || []));
  return `${imports.join("\n")}

export default function ${name}({ ${t.props} }) {${t.body}
}
`;
}

const TIME_FILE = `export function formatTime(seconds) {
  return \`\${Math.floor(seconds / 60)}:\${String(seconds % 60).padStart(2, "0")}\`;
}
`;

const NUMBER_FILE = `// Round to at most two decimals for display.
export function formatNumber(n) {
  return String(Math.round(n * 100) / 100);
}
`;

const SUMMARY_KIND_FILE = `export default function Summary({ id, label, text }) {
  return (
    <section data-key={id} data-role="widget-summary">
      <h2>{label}</h2>
      <p data-role="summary">{text}</p>
    </section>
  );
}
`;

function emitComponents(spec) {
  const files = {};
  const kinds = [...new Set(spec.widgets.map((w) => w.kind))];
  for (const kind of kinds) {
    const name = KIND_COMPONENT[kind];
    files[`src/widgets/${name}.jsx`] = kind === "summary" ? SUMMARY_KIND_FILE : component(name, kind);
  }

  // Filters read by a summary share their items through a constant.
  const readFilters = new Set(spec.widgets.filter((w) => w.kind === "summary")
    .flatMap((w) => w.sources).filter((id) => spec.widgets.find((x) => x.id === id).kind === "filter"));
  const itemsName = (w) => `${camelCase(w.label)}Items`;
  const consts = spec.widgets.filter((w) => readFilters.has(w.id))
    .map((w) => `const ${itemsName(w)} = ${literal(w.items)};`);
  const summaries = spec.widgets.filter((w) => w.kind === "summary")
    .map((w) => `  function ${camelCase(w.label)}() {\n${summaryBody(spec, w, itemsName, "    ")}\n  }`);

  const elements = spec.widgets.map((w) => {
    const props = [`id="${w.id}"`, `label=${jsxAttr(w.label)}`];
    for (const name of PARAMS[w.kind]) {
      if (FUNCTIONS[name]) props.push(`${name}={${FUNCTIONS[name](w)}}`);
      else if (w.kind === "filter" && name === "items" && readFilters.has(w.id)) props.push(`items={${itemsName(w)}}`);
      else props.push(`${name}=${jsxAttr(w[name], "        ")}`);
    }
    if (w.kind === "summary") props.push(`text={${camelCase(w.label)}()}`);
    return `        <${KIND_COMPONENT[w.kind]} ${props.join(" ")} />`;
  });

  const imports = [
    `import { useEffect, useState } from "react";`,
    `import { initialWidgets, receive, WidgetsContext } from "./state";`,
    ...kinds.map((k) => `import ${KIND_COMPONENT[k]} from "./widgets/${KIND_COMPONENT[k]}";`),
  ];
  if (needsFormatNumber(spec)) imports.push(`import { formatNumber } from "./number";`);
  files["src/App.jsx"] = `${imports.join("\n")}
${consts.length ? "\n" + consts.join("\n\n") + "\n" : ""}
export default function App({ events }) {
  const [widgets, setWidgets] = useState(initialWidgets);

  useEffect(() => events.subscribe((msg) => setWidgets((widgets) => receive(widgets, msg))), [events]);
${summaries.length ? "\n" + summaries.join("\n\n") + "\n" : ""}
  return (
    <WidgetsContext value={{ widgets, setWidgets }}>
      <div data-role="dashboard">
${elements.join("\n")}
      </div>
    </WidgetsContext>
  );
}
`;
  return files;
}

export function emit(spec, options = {}) {
  const files = {
    ...templateFiles({ name: "dashboard", title: "Dashboard" }, options),
    "src/state.js": stateFile(spec),
    ...emitComponents(spec),
  };
  if (spec.widgets.some((w) => w.kind === "clock")) files["src/time.js"] = TIME_FILE;
  if (needsFormatNumber(spec)) files["src/number.js"] = NUMBER_FILE;
  return {
    files,
    style: {
      components: "one reusable function component per widget kind, configured by props",
      state: "lifted up: one useState in App for the whole dashboard, shared through a context; widgets use a useWidget(id) hook and updater functions on their slice",
      externalEvents: "a subscription in a useEffect; receive(widgets, msg) is a pure function of the state",
      lists: ".map with key (item ids; the index for fixed lists of labels)",
      conditionals: "&& in JSX",
      derived: "computed during render, no manual memoization",
      inputs: "controlled, onChange; the number input keeps a draft while its text is not a number",
      compiler: options.compiler === "on" ? "React Compiler (babel-plugin-react-compiler through @rolldown/plugin-babel)" : "none (create-vite's react template)",
      build: "Vite + @vitejs/plugin-react, production defaults, hidden source maps",
    },
  };
}
