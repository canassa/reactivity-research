// The dashboard in Solid 1.
//
// Style (recorded in every generated app's rr.json):
// - One app store (`createStore`) holding every widget's state, created per mount and shared
//   through a context. Widgets read their slice and update it with path setters; the summaries
//   read other widgets' slices directly. External events go through the store's `receive`.
// - Lists render with `<For>`. Whole-state replacements (`serverSet`, `snapshot`) go through
//   `reconcile(…, { key: "id" })`, so keyed items keep their store proxies and their DOM nodes.
// - Conditional content with `<Show>`; derived values as plain functions, `createMemo` where a
//   derived list is read twice (the filter).
// - Events as JSX handlers: `onClick`/`onInput` (Solid delegates them), `onChange` for
//   checkboxes and selects.
// - One reusable component per widget kind, configured by props (function props for each
//   widget's own rules), which is how Solid's docs present components.

import { templateFiles } from "../../frameworks/solid/framework.js";
import { literal, jsxAttr, tplText, camelCase } from "../../frameworks/shared/jsx.js";

export const framework = "solid";

export const params = {};

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

// Component bodies, per kind. Each returns the solid-js imports it needs, its other imports,
// and the function body.
const TEMPLATES = {
  counter: () => ({
    body: `
  const [counter, set] = useWidget(props.id);
  return (
    <section data-key={props.id} data-role="widget-counter">
      <h2>{props.label}</h2>
      <output data-role="value">{counter.value}</output>
      <button data-role="dec" disabled={counter.value <= props.min} onClick={() => set("value", (value) => Math.max(props.min, value - props.step))}>
        -{props.step}
      </button>
      <button data-role="inc" disabled={counter.value >= props.max} onClick={() => set("value", (value) => Math.min(props.max, value + props.step))}>
        +{props.step}
      </button>
      <button data-role="reset" onClick={() => set("value", props.start)}>
        Reset
      </button>
    </section>
  );`,
  }),

  toggles: () => ({
    solid: ["For"],
    body: `
  const [toggles, set] = useWidget(props.id);
  const count = () => toggles.on.filter(Boolean).length;
  return (
    <section data-key={props.id} data-role="widget-toggles">
      <h2>{props.label}</h2>
      <ul>
        <For each={props.items}>
          {(name, i) => (
            <li>
              <label>
                <input type="checkbox" data-role="toggle" data-key={i()} checked={toggles.on[i()]} onChange={() => set("on", i(), (on) => !on)} />
                {name}
              </label>
            </li>
          )}
        </For>
      </ul>
      <p data-role="count">
        {count()} of {props.items.length} on
      </p>
    </section>
  );`,
  }),

  field: () => ({
    solid: ["Show"],
    body: `
  const [field, set] = useWidget(props.id);
  const error = () => props.validate(field.text);
  return (
    <section data-key={props.id} data-role="widget-field">
      <h2>{props.label}</h2>
      <input type="text" data-role="input" placeholder={props.placeholder} value={field.text} onInput={(e) => set("text", e.currentTarget.value)} />
      <Show when={error()}>{(message) => <p data-role="error">{message()}</p>}</Show>
    </section>
  );`,
  }),

  todo: () => ({
    solid: ["For"],
    body: `
  const [todo, set] = useWidget(props.id);
  const left = () => todo.items.filter((item) => !item.done).length;
  const add = () => {
    const text = todo.draft.trim();
    if (!text) return;
    const id = todo.items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
    set((todo) => ({ items: [...todo.items, { id, text, done: false }], draft: "" }));
  };
  return (
    <section data-key={props.id} data-role="widget-todo">
      <h2>{props.label}</h2>
      <input type="text" data-role="draft" placeholder={props.placeholder} value={todo.draft} onInput={(e) => set("draft", e.currentTarget.value)} />
      <button data-role="add" onClick={add}>
        {props.addText}
      </button>
      <ul>
        <For each={todo.items}>
          {(item) => (
            <li data-key={item.id}>
              <input type="checkbox" data-role="toggle" checked={item.done} onChange={() => set("items", (it) => it.id === item.id, "done", (done) => !done)} />
              <span>{item.text}</span>
              <button data-role="remove" onClick={() => set("items", (items) => items.filter((it) => it.id !== item.id))}>
                {props.removeText}
              </button>
            </li>
          )}
        </For>
      </ul>
      <p data-role="left">{left()} left</p>
    </section>
  );`,
  }),

  tabs: () => ({
    solid: ["For"],
    body: `
  const [selected, set] = useWidget(props.id);
  return (
    <section data-key={props.id} data-role="widget-tabs">
      <h2>{props.label}</h2>
      <div role="tablist">
        <For each={props.tabs}>
          {(tab, i) => (
            <button role="tab" data-role="tab" data-key={i()} aria-selected={selected.active === i() ? "true" : "false"} onClick={() => set("active", i())}>
              {tab.title}
            </button>
          )}
        </For>
      </div>
      <p role="tabpanel" data-role="tab-content">
        {props.tabs[selected.active].content}
      </p>
    </section>
  );`,
  }),

  panel: () => ({
    solid: ["Show"],
    body: `
  const [panel, set] = useWidget(props.id);
  return (
    <section data-key={props.id} data-role="widget-panel">
      <h2>{props.label}</h2>
      <button data-role="toggle" aria-expanded={panel.open ? "true" : "false"} onClick={() => set("open", (open) => !open)}>
        {panel.open ? props.hideText : props.showText}
      </button>
      <Show when={panel.open}>
        <p data-role="body">{props.body}</p>
      </Show>
    </section>
  );`,
  }),

  choice: () => ({
    solid: ["For", "Show"],
    body: `
  const [choice, set] = useWidget(props.id);
  return (
    <section data-key={props.id} data-role="widget-choice">
      <h2>{props.label}</h2>
      <select data-role="select" value={choice.option} onChange={(e) => set("option", e.currentTarget.value)}>
        <For each={props.options}>{(option) => <option value={option.value}>{option.label}</option>}</For>
      </select>
      <Show when={props.extraFor.includes(choice.option)}>
        <input type="text" data-role="extra" placeholder={props.extraPlaceholder} value={choice.extra} onInput={(e) => set("extra", e.currentTarget.value)} />
      </Show>
    </section>
  );`,
  }),

  amount: () => ({
    body: `
  const [amount, set] = useWidget(props.id);
  return (
    <section data-key={props.id} data-role="widget-amount">
      <h2>{props.label}</h2>
      <input
        type="number"
        data-role="input"
        value={amount.value}
        onInput={(e) => {
          const value = e.currentTarget.valueAsNumber;
          if (!Number.isNaN(value)) set("value", value);
        }}
      />
      <output data-role="formatted">{props.format(amount.value)}</output>
    </section>
  );`,
  }),

  filter: () => ({
    solid: ["For", "createMemo"],
    body: `
  const [filter, set] = useWidget(props.id);
  const shown = createMemo(() => {
    const query = filter.query.toLowerCase();
    return props.items.filter((item) => item.text.toLowerCase().includes(query));
  });
  return (
    <section data-key={props.id} data-role="widget-filter">
      <h2>{props.label}</h2>
      <input type="text" data-role="query" placeholder={props.placeholder} value={filter.query} onInput={(e) => set("query", e.currentTarget.value)} />
      <ul>
        <For each={shown()}>{(item) => <li data-key={item.id}>{item.text}</li>}</For>
      </ul>
      <p data-role="matches">{shown().length} matches</p>
    </section>
  );`,
  }),

  rating: () => ({
    solid: ["For"],
    body: `
  const [rating, set] = useWidget(props.id);
  const stars = Array.from({ length: props.stars }, (_, i) => i + 1);
  return (
    <section data-key={props.id} data-role="widget-rating">
      <h2>{props.label}</h2>
      <div>
        <For each={stars}>
          {(n) => (
            <button data-role="star" data-key={n} aria-pressed={n <= rating.stars ? "true" : "false"} onClick={() => set("stars", n)}>
              {n <= rating.stars ? "★" : "☆"}
            </button>
          )}
        </For>
      </div>
      <p data-role="rating-label">{props.labels[rating.stars]}</p>
    </section>
  );`,
  }),

  feed: () => ({
    solid: ["For", "Show"],
    body: `
  const [feed, set] = useWidget(props.id);
  return (
    <section data-key={props.id} data-role="widget-feed">
      <h2>{props.label}</h2>
      <ul>
        <For each={feed.entries}>
          {(entry) => (
            <li data-key={entry.id}>
              <span>{entry.text}</span>
              <button data-role="dismiss" onClick={() => set("entries", (entries) => entries.filter((e) => e.id !== entry.id))}>
                {props.dismissText}
              </button>
            </li>
          )}
        </For>
      </ul>
      <Show when={feed.entries.length === 0}>
        <p data-role="empty">{props.emptyText}</p>
      </Show>
    </section>
  );`,
  }),

  clock: () => ({
    imports: ['import { formatTime } from "../time";'],
    body: `
  const [clock, set] = useWidget(props.id);
  return (
    <section data-key={props.id} data-role="widget-clock">
      <h2>{props.label}</h2>
      <output data-role="time">{formatTime(clock.seconds)}</output>
      <button data-role="start" disabled={clock.running} onClick={() => set("running", true)}>
        {props.startText}
      </button>
      <button data-role="stop" disabled={!clock.running} onClick={() => set("running", false)}>
        {props.stopText}
      </button>
      <button data-role="reset" onClick={() => set({ seconds: 0, running: false })}>
        {props.resetText}
      </button>
    </section>
  );`,
  }),
};

// ---------------------------------------------------------------------------------------------
// Summaries: a derived function reading other widgets' slices.

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

// The statements of a function computing a summary's text from `state`.
function summaryBody(spec, w, itemsName, indent) {
  const sources = w.sources.map((id) => spec.widgets.find((x) => x.id === id));
  const names = [];
  const lines = sources.map((src) => {
    let name = camelCase(src.label);
    while (names.includes(name)) name += "2";
    names.push(name);
    return `const ${name} = ${metricExpr(src, `state.widgets.${src.id}`, () => itemsName(src))};`;
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

function storeFile(spec) {
  const widgets = spec.widgets.filter((w) => w.kind !== "summary");
  const clocks = widgets.filter((w) => w.kind === "clock").map((w) => w.id);
  const hasFeed = widgets.some((w) => w.kind === "feed");
  const cases = [
    `      case "serverSet":
        setState("widgets", msg.widget, reconcile(msg.state, { key: "id" }));
        break;`,
  ];
  if (clocks.length) {
    cases.push(`      case "tick":
        batch(() => {
          for (const id of ${literal(clocks)}) {
            if (state.widgets[id].running) setState("widgets", id, "seconds", (seconds) => seconds + 1);
          }
        });
        break;`);
  }
  if (hasFeed) {
    cases.push(`      case "notify":
        setState("widgets", msg.widget, "entries", (entries) => [...entries, msg.entry]);
        break;`);
  }
  cases.push(`      case "snapshot":
        setState("widgets", reconcile(msg.state.widgets, { key: "id" }));
        break;`);
  const initial = literal(spec.initialState, "  ");
  return `import { ${clocks.length ? "batch, " : ""}createContext, useContext } from "solid-js";
import { createStore, reconcile } from "solid-js/store";

export const AppContext = createContext();

// The whole dashboard's state, one slice per widget. \`receive\` applies external events.
export function createAppStore() {
  const [state, setState] = createStore(${initial});

  function receive(msg) {
    switch (msg.type) {
${cases.join("\n")}
    }
  }

  return { state, setState, receive };
}

// A widget's slice of the store and a setter scoped to it.
export function useWidget(id) {
  const { state, setState } = useContext(AppContext);
  return [state.widgets[id], (...path) => setState("widgets", id, ...path)];
}
${spec.widgets.some((w) => w.kind === "summary") ? `
export function useAppState() {
  return useContext(AppContext).state;
}
` : ""}`;
}

function component(name, kind) {
  const t = TEMPLATES[kind]();
  const solid = t.solid || [];
  const imports = [];
  if (solid.length) imports.push(`import { ${solid.join(", ")} } from "solid-js";`);
  imports.push(`import { useWidget } from "../store";`);
  imports.push(...(t.imports || []));
  return `${imports.join("\n")}

export default function ${name}(props) {${t.body}
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

const SUMMARY_KIND_FILE = `export default function Summary(props) {
  return (
    <section data-key={props.id} data-role="widget-summary">
      <h2>{props.label}</h2>
      <p data-role="summary">{props.text}</p>
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
    .map((w) => `  const ${camelCase(w.label)} = () => {\n${summaryBody(spec, w, itemsName, "    ")}\n  };`);

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
    `import { AppContext } from "./store";`,
    ...kinds.map((k) => `import ${KIND_COMPONENT[k]} from "./widgets/${KIND_COMPONENT[k]}";`),
  ];
  if (needsFormatNumber(spec)) imports.push(`import { formatNumber } from "./number";`);
  files["src/App.jsx"] = `${imports.join("\n")}
${consts.length ? "\n" + consts.join("\n\n") + "\n" : ""}
export default function App(props) {
${summaries.length ? "  const state = props.store.state;\n" + summaries.join("\n\n") + "\n\n" : ""}  return (
    <AppContext.Provider value={props.store}>
      <div data-role="dashboard">
${elements.join("\n")}
      </div>
    </AppContext.Provider>
  );
}
`;
  return files;
}

export function emit(spec) {
  const files = {
    ...templateFiles({ name: "dashboard", title: "Dashboard" }),
    "src/store.js": storeFile(spec),
    ...emitComponents(spec),
  };
  if (spec.widgets.some((w) => w.kind === "clock")) files["src/time.js"] = TIME_FILE;
  if (needsFormatNumber(spec)) files["src/number.js"] = NUMBER_FILE;
  return {
    files,
    style: {
      components: "one reusable component per widget kind, configured by props",
      state: "one createStore for the whole dashboard, shared through a context; widgets use path setters on their slice",
      externalEvents: "store.receive(msg); serverSet and snapshot through reconcile(…, { key: 'id' })",
      lists: "<For>",
      conditionals: "<Show>",
      derived: "plain functions; createMemo for the filtered list",
      events: "onClick/onInput (delegated), onChange for checkboxes and selects",
      build: "Vite + vite-plugin-solid, production defaults, hidden source maps",
    },
  };
}
