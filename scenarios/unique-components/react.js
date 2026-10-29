// The unique-components dashboard in React 19.
//
// Style (recorded in every generated app's rr.json):
// - One function component per widget (`W1`, `W2`, …), each in its own file, written from its
//   description alone: its handlers, bindings and derived expressions are that component's own
//   code. Nothing is interpreted at runtime.
// - State lifted up: one `useState` in `App` holds every widget's state (readers read earlier
//   widgets, and external events reach any of them), shared through a context. A widget reads
//   its slice with a `useWidget(id)` hook and changes it with updater functions returning a new
//   slice (spreads, `map`, `filter`), so two events before a render both apply; a reader reads
//   other widgets' slices through the same hook. External events arrive through a subscription in
//   an effect and go through `receive`, a pure function of the state; the `tick` rules of the
//   time-driven ints are written out there, one statement each.
// - Lists with `.map` and `key={item.id}`. Conditional sections and validation errors with `&&`.
//   Derived values are plain expressions in the JSX, computed during render, no memoization (the
//   React Compiler, when on, adds it).
// - Controlled inputs with `onChange`. A number input sends its message only for an integer
//   within the field's range; otherwise the widget keeps the typed text as a draft, dropped when
//   its slice changes (the docs' "adjusting state when a prop changes").

import { templateFiles, params as frameworkParams } from "../../frameworks/react/framework.js";
import { literal, jsxAttr } from "../../frameworks/shared/jsx.js";

export const framework = "react";

export const params = { ...frameworkParams };

// ---------------------------------------------------------------------------------------------
// Expressions: the spec's typed arrays compiled to JavaScript over `s` (the widget's slice) and
// `wN` (another widget's slice).

const COMPARE = { "==": "===", "!=": "!==", "<": "<", "<=": "<=", ">": ">", ">=": ">=" };

// `top` is true when the result is used where no parentheses are needed.
function expr(e, top = true) {
  const wrap = (code) => (top ? code : `(${code})`);
  const sub = (x) => expr(x, false);
  switch (e[0]) {
    case "f": return `s.${e[1]}`;
    case "w": return `${e[1]}.${e[2]}`;
    case "k": return JSON.stringify(e[1]);
    case "+": return wrap(`${sub(e[1])} + ${sub(e[2])}`);
    case "-": return wrap(`${sub(e[1])} - ${sub(e[2])}`);
    case "count": case "len": return `${sub(e[1])}.length`;
    case "done": return `${sub(e[1])}.filter((item) => item.done).length`;
    case "left": return `${sub(e[1])}.filter((item) => !item.done).length`;
    case "has": return `${sub(e[1])}.includes(${JSON.stringify(e[2])})`;
    case "and": return wrap(`${sub(e[1])} && ${sub(e[2])}`);
    case "or": return wrap(`${sub(e[1])} || ${sub(e[2])}`);
    case "not": return `!${sub(e[1])}`;
    case "if": return wrap(`${sub(e[1])} ? ${sub(e[2])} : ${sub(e[3])}`);
  }
  if (COMPARE[e[0]]) return wrap(`${sub(e[1])} ${COMPARE[e[0]]} ${sub(e[2])}`);
  throw new Error(`unknown expression ${JSON.stringify(e)}`);
}

// Widgets (other than this one) an expression reads.
function reads(e, out = new Set()) {
  if (!Array.isArray(e)) return out;
  if (e[0] === "w") out.add(e[1]);
  else if (e[0] !== "k") for (const x of e.slice(1)) reads(x, out);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Messages: each as that widget's own handler.

const upper = (s) => s[0].toUpperCase() + s.slice(1);

// One op as the fields it changes, over the slice `v`: { field: expression }. A push applies
// only when the draft holds text, so it is written as a condition instead (`guard`).
function opChange(w, op, v) {
  const [kind, name] = op;
  const f = w.fields.find((x) => x.name === name);
  const item = (text) => `{ id: nextId(${v}.${name}), text: ${text}${f.checkable ? ", done: false" : ""} }`;
  switch (kind) {
    case "add": {
      const k = op[2];
      const sum = k < 0 ? `${v}.${name} - ${-k}` : `${v}.${name} + ${k}`;
      return { set: { [name]: `Math.min(${f.max}, Math.max(${f.min}, ${sum}))` } };
    }
    case "set": return { set: { [name]: JSON.stringify(op[2]) } };
    case "toggle": return { set: { [name]: `!${v}.${name}` } };
    case "reset": return { set: { [name]: literal(f.initial) } };
    case "cycle": return { set: { [name]: `${name}Options[(${name}Options.indexOf(${v}.${name}) + 1) % ${f.options.length}]` } };
    case "push": {
      const draft = op[2];
      return { guard: `${v}.${draft}.trim()`, set: { [name]: `[...${v}.${name}, ${item(`${v}.${draft}.trim()`)}]`, [draft]: `""` } };
    }
    case "pushText": return { set: { [name]: `[...${v}.${name}, ${item(JSON.stringify(op[2]))}]` } };
    case "pop": return { set: { [name]: `${v}.${name}.slice(0, -1)` } };
    case "shift": return { set: { [name]: `${v}.${name}.slice(1)` } };
    case "clear": return { set: { [name]: "[]" } };
    case "clearDone": return { set: { [name]: `${v}.${name}.filter((item) => !item.done)` } };
  }
  throw new Error(`unknown op ${kind}`);
}

const spread = (v, set) => `{ ...${v}, ${Object.entries(set).map(([k, x]) => `${k}: ${x}`).join(", ")} }`;

// A click message's updater. Ops apply in order, each to the result of the previous; consecutive
// ops that do not read a field an earlier one set are merged into one spread. One step is one
// expression; several (or a push's condition) are statements over `next`.
function clickUpdater(w, m) {
  const steps = [];
  for (const op of m.ops) {
    const c = opChange(w, op, "\0");
    const last = steps[steps.length - 1];
    const readsSet = last && Object.keys(last.set).some((f) => Object.values(c.set).some((x) => x.includes(`\0.${f}`)) || Object.hasOwn(c.set, f));
    if (!last || c.guard || last.guard || readsSet) steps.push({ guard: c.guard, set: { ...c.set } });
    else Object.assign(last.set, c.set);
  }
  const over = (v, x) => x.replaceAll("\0", v);
  if (steps.length === 1) {
    const [c] = steps;
    const value = over("s", spread("s", c.set));
    return c.guard ? `(s) => (${over("s", c.guard)} ? ${value} : s)` : `(s) => (${value})`;
  }
  const lines = ["let next = s;"];
  for (const c of steps) {
    const value = over("next", spread("next", c.set));
    lines.push(c.guard ? `if (${over("next", c.guard)}) next = ${value};` : `next = ${value};`);
  }
  lines.push("return next;");
  return `(s) => {\n${lines.map((l) => `    ${l}`).join("\n")}\n  }`;
}

const intInputs = (w) => w.messages.filter((m) => m.kind === "input" && w.fields.find((x) => x.name === m.field).type === "int");

function handler(w, m, needs) {
  const f = m.field && w.fields.find((x) => x.name === m.field);
  switch (m.kind) {
    case "click": {
      const updater = clickUpdater(w, m);
      if (updater.includes("nextId(")) needs.nextId = true;
      return `  const ${m.name} = () => update(${updater});`;
    }
    case "input":
      if (f.type === "int") {
        return `  const ${m.name} = (e) => {
    const value = e.target.valueAsNumber;
    if (Number.isInteger(value) && value >= ${f.min} && value <= ${f.max}) {
      set${upper(f.name)}Draft(null);
      update((s) => ({ ...s, ${f.name}: value }));
    } else {
      set${upper(f.name)}Draft(e.target.value);
    }
  };`;
      }
      return `  const ${m.name} = (e) => {
    const value = e.target.value;
    update((s) => ({ ...s, ${f.name}: value }));
  };`;
    case "check":
      return `  const ${m.name} = () => update((s) => ({ ...s, ${f.name}: !s.${f.name} }));`;
    case "select":
      return `  const ${m.name} = (e) => {
    const value = e.target.value;
    update((s) => ({ ...s, ${f.name}: value }));
  };`;
    case "item":
      if (m.op === "remove") return `  const ${m.name} = (id) => update((s) => ({ ...s, ${f.name}: s.${f.name}.filter((item) => item.id !== id) }));`;
      return `  const ${m.name} = (id) => update((s) => ({ ...s, ${f.name}: s.${f.name}.map((item) => (item.id === id ? { ...item, done: !item.done } : item)) }));`;
  }
  throw new Error(`unknown message kind ${m.kind}`);
}

// ---------------------------------------------------------------------------------------------
// View: the JSX of a widget.

// A condition before `&&`: parenthesised only where `&&` would bind tighter.
const cond = (e) => expr(e, !["or", "if"].includes(e[0]));

// Text in a JSX child position.
function jsxText(s) {
  return /[{}<>&]/.test(s) ? `{${JSON.stringify(s)}}` : s;
}

function parts(ps) {
  return ps.map((p) => (typeof p === "string" ? jsxText(p) : `{${expr(p)}}`)).join("");
}

function view(w, n, ind) {
  const pad = "  ".repeat(ind);
  const msg = (name) => w.messages.find((m) => m.name === name);
  const field = (name) => w.fields.find((f) => f.name === name);
  switch (n.el) {
    case "text":
      return [`${pad}<${n.tag}>${parts(n.parts)}</${n.tag}>`];
    case "button": {
      const disabled = n.disabled ? ` disabled={${expr(n.disabled)}}` : "";
      return [`${pad}<button data-role="${n.msg}"${disabled} onClick={${n.msg}}>${parts(n.text)}</button>`];
    }
    case "input": {
      const f = field(msg(n.msg).field);
      const attrs = f.type === "int"
        ? `type="number" data-role="${n.msg}" value={${f.name}Draft ?? s.${f.name}} onChange={${n.msg}}`
        : `type="text" data-role="${n.msg}"${n.placeholder ? ` placeholder=${jsxAttr(n.placeholder)}` : ""} value={s.${f.name}} onChange={${n.msg}}`;
      const lines = [];
      if (n.label) lines.push(`${pad}<label>${jsxText(n.label)}<input ${attrs} /></label>`);
      else lines.push(`${pad}<input ${attrs} />`);
      if (n.invalid) lines.push(`${pad}{${cond(n.invalid.when)} && <p data-role="${n.msg}Error">${jsxText(n.invalid.message)}</p>}`);
      return lines;
    }
    case "check": {
      const m = msg(n.msg);
      return [`${pad}<label><input type="checkbox" data-role="${n.msg}" checked={s.${m.field}} onChange={${n.msg}} />${jsxText(n.label)}</label>`];
    }
    case "select": {
      const m = msg(n.msg);
      const f = field(m.field);
      const options = f.options.map((o) => `${pad}  <option value=${jsxAttr(o)}>${jsxText(o)}</option>`);
      const select = [`${pad}<select data-role="${n.msg}" value={s.${f.name}} onChange={${n.msg}}>`, ...options, `${pad}</select>`];
      if (!n.label) return select;
      return [`${pad}<label>`, `${pad}  ${jsxText(n.label)}`, ...select.map((l) => "  " + l), `${pad}</label>`];
    }
    case "list": {
      const item = [`${pad}    <li key={item.id} data-key={item.id} data-role="${n.field}Item">`];
      if (n.check) item.push(`${pad}      <input type="checkbox" data-role="${n.check}" checked={item.done} onChange={() => ${n.check}(item.id)} />`);
      item.push(`${pad}      <span>{item.text}</span>`);
      if (n.remove) item.push(`${pad}      <button data-role="${n.remove}" onClick={() => ${n.remove}(item.id)}>${parts([n.removeText])}</button>`);
      item.push(`${pad}    </li>`);
      return [
        `${pad}<${n.tag}>`,
        `${pad}  {s.${n.field}.map((item) => (`,
        ...item,
        `${pad}  ))}`,
        `${pad}</${n.tag}>`,
      ];
    }
    case "when":
      return [
        `${pad}{${cond(n.cond)} && (`,
        `${pad}  <${n.tag}>`,
        ...n.children.flatMap((c) => view(w, c, ind + 2)),
        `${pad}  </${n.tag}>`,
        `${pad})}`,
      ];
    case "group":
      return [`${pad}<${n.tag}>`, ...n.children.flatMap((c) => view(w, c, ind + 1)), `${pad}</${n.tag}>`];
  }
  throw new Error(`unknown view node ${n.el}`);
}

// Widgets read by any expression in a node.
function readsOfView(n, out) {
  for (const k of ["disabled", "cond"]) if (n[k]) reads(n[k], out);
  if (n.invalid) reads(n.invalid.when, out);
  for (const p of [...(n.parts || []), ...(n.text || [])]) if (typeof p !== "string") reads(p, out);
  for (const c of n.children || []) readsOfView(c, out);
}

// ---------------------------------------------------------------------------------------------
// One widget's component file.

function component(w) {
  const needs = {};
  const name = w.id.toUpperCase();
  const handlers = w.messages.map((m) => handler(w, m, needs));
  const body = w.view.flatMap((n) => view(w, n, 3));
  const other = new Set();
  for (const n of w.view) readsOfView(n, other);
  const ints = intInputs(w).map((m) => m.field);

  const imports = [];
  if (ints.length) imports.push(`import { useState } from "react";`);
  imports.push(`import { useWidget } from "../state";`);
  if (needs.nextId) imports.push(`import { nextId } from "../list";`);

  // Options of an enum, where a cycle message steps through them.
  const options = w.fields
    .filter((f) => f.type === "enum" && w.messages.some((m) => m.kind === "click" && m.ops.some((op) => op[0] === "cycle" && op[1] === f.name)))
    .map((f) => `const ${f.name}Options = ${literal(f.options)};`);

  const setup = [`  const [s, update] = useWidget("${w.id}");`];
  for (const id of [...other].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))) setup.push(`  const [${id}] = useWidget("${id}");`);
  if (ints.length) {
    setup.push(`  // What a number input shows while it holds no valid value: kept until the slice changes, so`);
    setup.push(`  // the text being typed is not replaced by the stored value.`);
    for (const f of ints) setup.push(`  const [${f}Draft, set${upper(f)}Draft] = useState(null);`);
    setup.push(`  const [shown, setShown] = useState(s);`);
    setup.push(`  if (s !== shown) {`);
    setup.push(`    setShown(s);`);
    for (const f of ints) setup.push(`    set${upper(f)}Draft(null);`);
    setup.push(`  }`);
  }

  return `${imports.join("\n")}
${options.length ? "\n" + options.join("\n") + "\n" : ""}
export default function ${name}() {
${[...setup, ...handlers].join("\n")}
  return (
    <section data-key="${w.id}" data-role="widget">
      <h2>${jsxText(w.label)}</h2>
${body.join("\n")}
    </section>
  );
}
`;
}

// ---------------------------------------------------------------------------------------------
// Files

function stateFile(spec) {
  const timed = spec.widgets.flatMap((w) => w.fields.filter((f) => f.tick).map((f) => ({ w, f })));
  const hasFeed = spec.widgets.some((w) => w.fields.some((f) => f.feed));
  const cases = [
    `    case "serverSet":
      return { ...widgets, [msg.widget]: msg.state };`,
  ];
  if (timed.length) {
    cases.push(`    case "tick": {
      const next = { ...widgets };
${timed.map(({ w, f }) => `      if (next.${w.id}.${f.tickWhen}) next.${w.id} = { ...next.${w.id}, ${f.name}: Math.min(${f.max}, next.${w.id}.${f.name} + ${f.tick}) };`).join("\n")}
      return next;
    }`);
  }
  if (hasFeed) {
    cases.push(`    case "notify": {
      const widget = widgets[msg.widget];
      return { ...widgets, [msg.widget]: { ...widget, [msg.field]: [...widget[msg.field], msg.item] } };
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

const LIST_FILE = `// The id for a new list item: one more than the largest.
export function nextId(items) {
  return items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
}
`;

function appFile(spec) {
  const names = spec.widgets.map((w) => w.id.toUpperCase());
  return `import { useEffect, useState } from "react";
import { initialWidgets, receive, WidgetsContext } from "./state";
${names.map((n) => `import ${n} from "./widgets/${n}";`).join("\n")}

export default function App({ events }) {
  const [widgets, setWidgets] = useState(initialWidgets);

  useEffect(() => events.subscribe((msg) => setWidgets((widgets) => receive(widgets, msg))), [events]);

  return (
    <WidgetsContext value={{ widgets, setWidgets }}>
      <div data-role="dashboard">
${names.map((n) => `        <${n} />`).join("\n")}
      </div>
    </WidgetsContext>
  );
}
`;
}

export function emit(spec, options = {}) {
  const files = {
    ...templateFiles({ name: "unique-components", title: "Dashboard" }, options),
    "src/state.js": stateFile(spec),
    "src/App.jsx": appFile(spec),
  };
  let usesNextId = false;
  for (const w of spec.widgets) {
    const source = component(w);
    files[`src/widgets/${w.id.toUpperCase()}.jsx`] = source;
    usesNextId ||= source.includes("nextId");
  }
  if (usesNextId) files["src/list.js"] = LIST_FILE;
  return {
    files,
    style: {
      components: "one function component per widget, in its own file, written from the widget's description; no shared kinds",
      state: "lifted up: one useState in App for the whole dashboard, shared through a context; widgets use a useWidget(id) hook and updater functions returning a new slice; readers read other widgets' slices through the same hook",
      externalEvents: "a subscription in a useEffect; receive(widgets, msg) is a pure function of the state; tick written out per time-driven int",
      lists: ".map with key={item.id}",
      conditionals: "&& in JSX for sections and validation errors",
      derived: "plain expressions in the JSX, computed during render, no manual memoization",
      inputs: "controlled, onChange; number inputs send only integers within range and keep a draft of any other text",
      compiler: options.compiler === "on" ? "React Compiler (babel-plugin-react-compiler through @rolldown/plugin-babel)" : "none (create-vite's react template)",
      build: "Vite + @vitejs/plugin-react, production defaults, hidden source maps",
    },
  };
}
