// The big-component form (one big component plus a small companion) in React 19.
//
// Style (recorded in every generated app's rr.json):
// - The form is one component (`W1`: one function with a handler per message and the whole view
//   as one JSX tree), the companion another (`W2`), each in its own file, written from the
//   description alone: handlers, bindings and derived expressions are the component's own code.
//   Nothing is interpreted at runtime. The form is not split into sub-components: its bindings
//   cross units, so a split would only pass the whole slice down.
// - State lifted up: one `useState` in `App` holds both widgets' state (the companion reads the
//   form, and external events reach either), shared through a context. A widget reads its slice
//   with a `useWidget(id)` hook and changes it with updater functions returning a new slice, so
//   two events before a render both apply. The companion reads the form's slice the same way.
//   External events arrive through a subscription in an effect and go through `receive`, a pure
//   function of the state; the `tick` rules of the time-driven ints are written out there.
// - Lists with `.map` and `key={item.id}`. Conditional sections and validation errors with `&&`.
//   Derived values are plain expressions in the JSX, computed during render; no memoization (the
//   React Compiler, when on, adds it).
// - Controlled inputs with `onChange`; a number input sends its message only for an integer
//   within the field's range, and keeps a draft of any other text, dropped when the slice
//   changes (the docs' "adjusting some state when a prop changes").

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

// A condition rendered with `&&` must be a boolean (React renders a 0 or a string).
function assertBoolean(w, e) {
  const ok = (x) => {
    if (x[0] === "f") return w.fields.find((f) => f.name === x[1]).type === "bool";
    if (x[0] === "and" || x[0] === "or") return ok(x[1]) && ok(x[2]);
    return x[0] === "not" || x[0] === "has" || COMPARE[x[0]] !== undefined;
  };
  if (!ok(e)) throw new Error(`a condition that is not a boolean: ${JSON.stringify(e)}`);
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

// The new value of the field an op writes, from the slice before the message.
function opValue(w, op, needs) {
  const [kind, name] = op;
  const f = w.fields.find((x) => x.name === name);
  const item = (text) => `{ id: nextId(s.${name}), text: ${text}${f.checkable ? ", done: false" : ""} }`;
  switch (kind) {
    case "add": {
      const k = op[2];
      const sum = k < 0 ? `s.${name} - ${-k}` : `s.${name} + ${k}`;
      return `Math.min(${f.max}, Math.max(${f.min}, ${sum}))`;
    }
    case "set": return JSON.stringify(op[2]);
    case "toggle": return `!s.${name}`;
    case "reset": return literal(f.initial);
    case "cycle": {
      needs.options.add(name);
      return `${name}Options[(${name}Options.indexOf(s.${name}) + 1) % ${f.options.length}]`;
    }
    case "pushText":
      needs.nextId = true;
      return `[...s.${name}, ${item(JSON.stringify(op[2]))}]`;
    case "pop": return `s.${name}.slice(0, -1)`;
    case "shift": return `s.${name}.slice(1)`;
    case "clear": return "[]";
    case "clearDone": return `s.${name}.filter((item) => !item.done)`;
  }
  throw new Error(`unknown op ${kind}`);
}

function clickHandler(w, m, needs) {
  const push = m.ops.find((op) => op[0] === "push");
  if (push) {
    if (m.ops.length > 1) throw new Error(`${m.name}: a push combined with another op`);
    needs.nextId = true;
    const [, name, draft] = push;
    const f = w.fields.find((x) => x.name === name);
    return `  function ${m.name}() {
    update((s) => {
      const text = s.${draft}.trim();
      if (!text) return s;
      return { ...s, ${name}: [...s.${name}, { id: nextId(s.${name}), text${f.checkable ? ", done: false" : ""} }], ${draft}: "" };
    });
  }`;
  }
  const fields = m.ops.map((op) => `${op[1]}: ${opValue(w, op, needs)}`);
  return `  function ${m.name}() {
    update((s) => ({ ...s, ${fields.join(", ")} }));
  }`;
}

function handler(w, m, needs) {
  const f = m.field && w.fields.find((x) => x.name === m.field);
  switch (m.kind) {
    case "click":
      return clickHandler(w, m, needs);
    case "input":
      if (f.type === "int") {
        needs.drafts = true;
        return `  function ${m.name}(e) {
    const value = e.target.valueAsNumber;
    if (Number.isInteger(value) && value >= ${f.min} && value <= ${f.max}) {
      update((s) => ({ ...s, ${m.field}: value }));
    } else {
      setDrafts((d) => ({ ...d, ${m.field}: e.target.value }));
    }
  }`;
      }
      return `  function ${m.name}(e) {
    update((s) => ({ ...s, ${m.field}: e.target.value }));
  }`;
    case "check":
      return `  function ${m.name}() {
    update((s) => ({ ...s, ${m.field}: !s.${m.field} }));
  }`;
    case "select":
      return `  function ${m.name}(e) {
    update((s) => ({ ...s, ${m.field}: e.target.value }));
  }`;
    case "item":
      if (m.op === "remove") {
        return `  function ${m.name}(id) {
    update((s) => ({ ...s, ${m.field}: s.${m.field}.filter((item) => item.id !== id) }));
  }`;
      }
      return `  function ${m.name}(id) {
    update((s) => ({ ...s, ${m.field}: s.${m.field}.map((item) => (item.id === id ? { ...item, done: !item.done } : item)) }));
  }`;
  }
  throw new Error(`unknown message kind ${m.kind}`);
}

// ---------------------------------------------------------------------------------------------
// View: the JSX of a widget.

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
        ? `type="number" data-role="${n.msg}" value={drafts.${f.name} ?? s.${f.name}} onChange={${n.msg}}`
        : `type="text" data-role="${n.msg}"${n.placeholder ? ` placeholder=${jsxAttr(n.placeholder)}` : ""} value={s.${f.name}} onChange={${n.msg}}`;
      const lines = [];
      if (n.label) lines.push(`${pad}<label>${jsxText(n.label)}<input ${attrs} /></label>`);
      else lines.push(`${pad}<input ${attrs} />`);
      if (n.invalid) {
        assertBoolean(w, n.invalid.when);
        lines.push(`${pad}{${expr(n.invalid.when, false)} && <p data-role="${n.msg}Error">${jsxText(n.invalid.message)}</p>}`);
      }
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
      assertBoolean(w, n.cond);
      return [
        `${pad}{${expr(n.cond, false)} && (`,
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
  const needs = { options: new Set() };
  const name = w.id.toUpperCase();
  const handlers = w.messages.map((m) => handler(w, m, needs));
  const body = w.view.flatMap((n) => view(w, n, 3));
  const other = new Set();
  for (const n of w.view) readsOfView(n, other);

  const imports = [];
  if (needs.drafts) imports.push(`import { useState } from "react";`);
  imports.push(`import { useWidget } from "../state";`);
  if (needs.nextId) imports.push(`import { nextId } from "../list";`);

  // Options of an enum, where a cycle message steps through them.
  const options = w.fields.filter((f) => needs.options.has(f.name))
    .map((f) => `const ${f.name}Options = ${literal(f.options)};`);

  const setup = [`  const [s, update] = useWidget("${w.id}");`];
  for (const id of [...other].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))) setup.push(`  const [${id}] = useWidget("${id}");`);
  if (needs.drafts) {
    setup.push(`  // What each number input shows while it holds no integer in range: kept until the slice
  // changes, so the text being typed is not replaced by the stored value.
  const [drafts, setDrafts] = useState({});
  const [shown, setShown] = useState(s);
  if (s !== shown) {
    setShown(s);
    setDrafts({});
  }`);
  }

  return `${imports.join("\n")}
${options.length ? "\n" + options.join("\n") + "\n" : ""}
export default function ${name}() {
${setup.join("\n")}

${handlers.join("\n\n")}

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
  const hasFeed = spec.widgets.some((w) => w.fields.some((f) => f.feed));
  const cases = [
    `    case "serverSet":
      return { ...widgets, [msg.widget]: msg.state };`,
  ];
  const timed = spec.widgets.map((w) => ({ w, fs: w.fields.filter((f) => f.tick) })).filter((x) => x.fs.length);
  if (timed.length) {
    const lines = [];
    for (const { w, fs } of timed) {
      lines.push(`      const ${w.id} = { ...widgets.${w.id} };`);
      for (const f of fs) lines.push(`      if (${w.id}.${f.tickWhen}) ${w.id}.${f.name} = Math.min(${f.max}, ${w.id}.${f.name} + ${f.tick});`);
    }
    cases.push(`    case "tick": {
${lines.join("\n")}
      return { ...widgets, ${timed.map(({ w }) => w.id).join(", ")} };
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
      <div data-role="page">
${names.map((n) => `        <${n} />`).join("\n")}
      </div>
    </WidgetsContext>
  );
}
`;
}

export function emit(spec, options = {}) {
  const files = {
    ...templateFiles({ name: "big-component", title: "Settings form" }, options),
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
      components: "the form is one function component (W1) in one file, a handler per message and one JSX tree, plus the companion (W2); no sub-components, no field table",
      state: "lifted up: one useState in App for the whole page, shared through a context; widgets use a useWidget(id) hook and updater functions returning a new slice; the companion reads the form's slice",
      externalEvents: "a subscription in a useEffect; receive(widgets, msg) is a pure function of the state; tick written out per time-driven int",
      lists: ".map with key={item.id}",
      conditionals: "&& in JSX for sections and validation errors",
      derived: "plain expressions in the JSX, computed during render, no manual memoization",
      inputs: "controlled, onChange; number inputs send only integers within range and keep a draft of other text until the slice changes",
      compiler: options.compiler === "on" ? "React Compiler (babel-plugin-react-compiler through @rolldown/plugin-babel)" : "none (create-vite's react template)",
      build: "Vite + @vitejs/plugin-react, production defaults, hidden source maps",
    },
  };
}
