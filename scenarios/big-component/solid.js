// The big-component form (one big component plus a small companion) in Solid 1.
//
// Style (recorded in every generated app's rr.json):
// - The form is one component (`W1`: one function with a handler per message and the whole view
//   as one JSX tree), the companion another (`W2`), each in its own file, written from the
//   description alone: handlers, bindings and derived expressions are the component's own code.
//   Nothing is interpreted at runtime. The form is not split into sub-components: its bindings
//   cross groups, so a split would only pass the store slice down.
// - One app store (`createStore`) holding the form's model and the companion's, created per mount and shared
//   through a context. A widget reads its slice and updates it with path setters (`produce` for
//   click messages, which apply several ops to one draft). A reader reads other widgets' slices
//   directly. External events go through the store's `receive`; the `tick` rules of the
//   time-driven ints are written out there, one statement each.
// - Lists render with `<For>`. Whole-state replacements (`serverSet`, `snapshot`) go through
//   `reconcile(…, { key: "id" })`, so keyed items keep their store proxies and their DOM nodes.
// - Conditional sections and validation errors with `<Show>`; derived values are plain
//   expressions in the JSX, so each binding is its own fine-grained effect.
// - Controlled inputs with `onInput` (delegated), `onChange` for checkboxes and selects; a
//   number input sends its message only for an integer within the field's range.

import { templateFiles } from "../../frameworks/solid/framework.js";
import { literal, jsxAttr } from "../../frameworks/shared/jsx.js";

export const framework = "solid";

export const params = {};

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

function opStatements(w, op) {
  const [kind, name] = op;
  const f = w.fields.find((x) => x.name === name);
  switch (kind) {
    case "add": {
      const k = op[2];
      const sum = k < 0 ? `s.${name} - ${-k}` : `s.${name} + ${k}`;
      return [`s.${name} = Math.min(${f.max}, Math.max(${f.min}, ${sum}));`];
    }
    case "set": return [`s.${name} = ${JSON.stringify(op[2])};`];
    case "toggle": return [`s.${name} = !s.${name};`];
    case "reset": return [`s.${name} = ${literal(f.initial)};`];
    case "cycle": return [`s.${name} = ${name}Options[(${name}Options.indexOf(s.${name}) + 1) % ${f.options.length}];`];
    case "push": {
      const draft = op[2];
      return [
        `if (s.${draft}.trim()) {`,
        `  s.${name}.push({ id: nextId(s.${name}), text: s.${draft}.trim()${f.checkable ? ", done: false" : ""} });`,
        `  s.${draft} = "";`,
        `}`,
      ];
    }
    case "pushText":
      return [`s.${name}.push({ id: nextId(s.${name}), text: ${JSON.stringify(op[2])}${f.checkable ? ", done: false" : ""} });`];
    case "pop": return [`s.${name}.pop();`];
    case "shift": return [`s.${name}.shift();`];
    case "clear": return [`s.${name} = [];`];
    case "clearDone": return [`s.${name} = s.${name}.filter((item) => !item.done);`];
  }
  throw new Error(`unknown op ${kind}`);
}

function handler(w, m, needs) {
  const f = m.field && w.fields.find((x) => x.name === m.field);
  switch (m.kind) {
    case "click": {
      needs.produce = true;
      const body = m.ops.flatMap((op) => opStatements(w, op));
      if (body.some((l) => l.includes("nextId("))) needs.nextId = true;
      return `  const ${m.name} = () =>\n    set(\n      produce((s) => {\n${body.map((l) => `        ${l}`).join("\n")}\n      }),\n    );`;
    }
    case "input":
      if (f.type === "int") {
        return `  const ${m.name} = (e) => {
    const value = e.currentTarget.valueAsNumber;
    if (Number.isInteger(value) && value >= ${f.min} && value <= ${f.max}) set("${m.field}", value);
  };`;
      }
      return `  const ${m.name} = (e) => set("${m.field}", e.currentTarget.value);`;
    case "check":
      return `  const ${m.name} = () => set("${m.field}", (on) => !on);`;
    case "select":
      return `  const ${m.name} = (e) => set("${m.field}", e.currentTarget.value);`;
    case "item":
      if (m.op === "remove") return `  const ${m.name} = (id) => set("${m.field}", (items) => items.filter((item) => item.id !== id));`;
      return `  const ${m.name} = (id) => set("${m.field}", (item) => item.id === id, "done", (done) => !done);`;
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

function view(w, n, ind, needs) {
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
        ? `type="number" data-role="${n.msg}" value={s.${f.name}} onInput={${n.msg}}`
        : `type="text" data-role="${n.msg}"${n.placeholder ? ` placeholder=${jsxAttr(n.placeholder)}` : ""} value={s.${f.name}} onInput={${n.msg}}`;
      const lines = [];
      if (n.label) lines.push(`${pad}<label>${jsxText(n.label)}<input ${attrs} /></label>`);
      else lines.push(`${pad}<input ${attrs} />`);
      if (n.invalid) {
        needs.Show = true;
        lines.push(`${pad}<Show when={${expr(n.invalid.when)}}>`);
        lines.push(`${pad}  <p data-role="${n.msg}Error">${jsxText(n.invalid.message)}</p>`);
        lines.push(`${pad}</Show>`);
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
      needs.For = true;
      const item = [`${pad}      <li data-key={item.id} data-role="${n.field}Item">`];
      if (n.check) item.push(`${pad}        <input type="checkbox" data-role="${n.check}" checked={item.done} onChange={() => ${n.check}(item.id)} />`);
      item.push(`${pad}        <span>{item.text}</span>`);
      if (n.remove) item.push(`${pad}        <button data-role="${n.remove}" onClick={() => ${n.remove}(item.id)}>${parts([n.removeText])}</button>`);
      item.push(`${pad}      </li>`);
      return [
        `${pad}<${n.tag}>`,
        `${pad}  <For each={s.${n.field}}>`,
        `${pad}    {(item) => (`,
        ...item,
        `${pad}    )}`,
        `${pad}  </For>`,
        `${pad}</${n.tag}>`,
      ];
    }
    case "when":
      needs.Show = true;
      return [
        `${pad}<Show when={${expr(n.cond)}}>`,
        `${pad}  <${n.tag}>`,
        ...n.children.flatMap((c) => view(w, c, ind + 2, needs)),
        `${pad}  </${n.tag}>`,
        `${pad}</Show>`,
      ];
    case "group":
      return [`${pad}<${n.tag}>`, ...n.children.flatMap((c) => view(w, c, ind + 1, needs)), `${pad}</${n.tag}>`];
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
  const body = w.view.flatMap((n) => view(w, n, 3, needs));
  const other = new Set();
  for (const n of w.view) readsOfView(n, other);

  const solid = ["For", "Show"].filter((x) => needs[x]);
  const imports = [];
  if (solid.length) imports.push(`import { ${solid.join(", ")} } from "solid-js";`);
  if (needs.produce) imports.push(`import { produce } from "solid-js/store";`);
  imports.push(`import { useWidget } from "../store";`);
  if (needs.nextId) imports.push(`import { nextId } from "../list";`);

  // Options of an enum, where a cycle message steps through them.
  const options = w.fields
    .filter((f) => f.type === "enum" && w.messages.some((m) => m.kind === "click" && m.ops.some((op) => op[0] === "cycle" && op[1] === f.name)))
    .map((f) => `  const ${f.name}Options = ${literal(f.options)};`);

  const setup = [`  const [s, set] = useWidget("${w.id}");`];
  for (const id of [...other].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))) setup.push(`  const [${id}] = useWidget("${id}");`);

  return `${imports.join("\n")}

export default function ${name}() {
${[...setup, ...options, ...handlers].join("\n")}
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

function storeFile(spec) {
  const timed = spec.widgets.flatMap((w) => w.fields.filter((f) => f.tick).map((f) => ({ w, f })));
  const hasFeed = spec.widgets.some((w) => w.fields.some((f) => f.feed));
  const cases = [
    `      case "serverSet":
        setState("widgets", msg.widget, reconcile(msg.state, { key: "id" }));
        break;`,
  ];
  if (timed.length) {
    cases.push(`      case "tick":
        batch(() => {
${timed.map(({ w, f }) => `          if (state.widgets.${w.id}.${f.tickWhen}) setState("widgets", "${w.id}", "${f.name}", (value) => Math.min(${f.max}, value + ${f.tick}));`).join("\n")}
        });
        break;`);
  }
  if (hasFeed) {
    cases.push(`      case "notify":
        setState("widgets", msg.widget, msg.field, (items) => [...items, msg.item]);
        break;`);
  }
  cases.push(`      case "snapshot":
        setState("widgets", reconcile(msg.state.widgets, { key: "id" }));
        break;`);
  return `import { ${timed.length ? "batch, " : ""}createContext, useContext } from "solid-js";
import { createStore, reconcile } from "solid-js/store";

export const AppContext = createContext();

// The whole page's state, one slice per widget. \`receive\` applies external events.
export function createAppStore() {
  const [state, setState] = createStore(${literal(spec.initialState, "  ")});

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
`;
}

const LIST_FILE = `// The id for a new list item: one more than the largest.
export function nextId(items) {
  return items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
}
`;

function appFile(spec) {
  const names = spec.widgets.map((w) => w.id.toUpperCase());
  return `import { AppContext } from "./store";
${names.map((n) => `import ${n} from "./widgets/${n}";`).join("\n")}

export default function App(props) {
  return (
    <AppContext.Provider value={props.store}>
      <div data-role="page">
${names.map((n) => `        <${n} />`).join("\n")}
      </div>
    </AppContext.Provider>
  );
}
`;
}

export function emit(spec) {
  const files = {
    ...templateFiles({ name: "big-component", title: "Settings form" }),
    "src/store.js": storeFile(spec),
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
      components: "the form is one component (W1) in one file, a handler per message and one JSX tree, plus the companion (W2); no sub-components, no field table",
      state: "one createStore for the whole page, shared through a context; widgets use path setters on their slice, produce for click messages; readers read other widgets' slices",
      externalEvents: "store.receive(msg); serverSet and snapshot through reconcile(…, { key: 'id' }); tick written out per time-driven int",
      lists: "<For>",
      conditionals: "<Show> for sections and validation errors",
      derived: "plain expressions in the JSX, one fine-grained binding each",
      events: "onClick/onInput (delegated), onChange for checkboxes and selects; number inputs send only integers within range",
      build: "Vite + vite-plugin-solid, production defaults, hidden source maps",
    },
  };
}
