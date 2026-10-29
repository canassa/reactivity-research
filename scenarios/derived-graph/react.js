// The derived-graph scenario in React 19: a planning sheet of formulas over inputs and a table of
// items, written the way React's documentation recommends.
//
// Style (recorded in every generated app's rr.json):
// - State: one `useReducer` in `App` (react.dev's "Extracting state logic into a reducer": many
//   event handlers and external events change one document). The state is `{ inputs, markup,
//   items, nextId, rng }`; the reducer (`src/state.js`) applies sheet controls (`input`, `step`
//   with its clamp), the item actions (`load` and `addItem` draw from the app's generator, so the
//   reducer stays pure), and the external events. Immutable updates with structural sharing: an
//   edited item is a new object in a new array. An action for an id that is gone is a no-op.
// - External events: a subscription in an effect, each message dispatched to the reducer.
// - Derived values: **computed during render, in dependency order, one `const` per formula** in
//   `Sheet`, each the formula's own expression:
//   `const dutyOwed = Math.floor((grossSales * inputs.taxRate) / 100);`. No `useMemo`: the docs'
//   default is to compute during render, and the React Compiler (compiler=on) memoizes the same
//   source by its dependencies. Every formula is computed once per render of the sheet, however
//   many displays show it.
// - Components: `Sheet` (every formula, then the units' displays), `Items` (toolbar and table),
//   `ItemRow` (one row), `NumberInput` (a number input that reports only integers in range).
//   Props, no context (one level deep).
// - Lists with `.map` and `key`: rows and top-k items by id, group rows by category.
// - Controlled inputs with `onChange`. `NumberInput` keeps the typed text while it is not an
//   integer in range (a draft in local state), dropped when the record it reads changes (the
//   docs' "adjusting some state when a prop changes"): the sheet's inputs, the row's item, the
//   state for the markup.
// - `src/util.js` (app code, shared with the other emitters): PRNG step, formatters and the
//   collection helpers formulas call (`sumBy`, `topBy`, `groupSum`, …) with the formula's own code.

import { templateFiles, params as frameworkParams } from "../../frameworks/react/framework.js";
import { literal } from "../../frameworks/shared/jsx.js";
import { formatted, jsExpr, partShown, readGraph, str, topShown, utilSource } from "./shared/graph.js";

export const framework = "react";

export const params = { ...frameworkParams };

// Text in a JSX child position.
const jsxText = (s) => (/[{}<>&]/.test(s) ? `{${str(s)}}` : s);

// Names the sheet's own code uses, which no formula may take.
const LOCALS = new Set(["state", "dispatch", "inputs", "items", "it", "category"]);

// ---------------------------------------------------------------------------------------------
// The state.

function stateFile(spec) {
  const s = spec.initialState;
  return `import { makeItems } from "./util";

export const initialState = ${literal(s)};

function setItem(state, id, change) {
  return { ...state, items: state.items.map((it) => (it.id === id ? change(it) : it)) };
}

// The state after a user action or an external event.
export function reducer(state, action) {
  switch (action.type) {
    case "input":
      if (state.inputs[action.name] === action.value) return state;
      return { ...state, inputs: { ...state.inputs, [action.name]: action.value } };
    case "step": {
      const value = Math.max(action.min, Math.min(action.max, state.inputs[action.name] + action.k));
      if (state.inputs[action.name] === value) return state;
      return { ...state, inputs: { ...state.inputs, [action.name]: value } };
    }
    case "load": {
      const made = makeItems(state.rng, state.nextId, ${spec.options.rows});
      return { ...state, items: made.items, rng: made.rng, nextId: made.nextId };
    }
    case "addItem": {
      const made = makeItems(state.rng, state.nextId, 1);
      return { ...state, items: [...state.items, ...made.items], rng: made.rng, nextId: made.nextId };
    }
    case "markup":
      return { ...state, markup: action.value };
    case "qty":
      return setItem(state, action.id, (it) => ({ ...it, qty: action.value }));
    case "active":
      return setItem(state, action.id, (it) => ({ ...it, active: !it.active }));
    case "note":
      return setItem(state, action.id, (it) => ({ ...it, note: action.value }));
    case "remove":
      return { ...state, items: state.items.filter((it) => it.id !== action.id) };
    case "serverInputs":
      return { ...state, inputs: { ...state.inputs, ...action.values } };
    case "serverItems": {
      // Listed ids are replaced in place, new ids appended, listed ids removed.
      const upserts = new Map(action.upsert.map((it) => [it.id, it]));
      const known = new Set(state.items.map((it) => it.id));
      const items = state.items.filter((it) => !action.remove.includes(it.id)).map((it) => upserts.get(it.id) ?? it);
      for (const it of action.upsert) if (!known.has(it.id) && !action.remove.includes(it.id)) items.push(it);
      const nextId = action.upsert.reduce((max, it) => Math.max(max, it.id + 1), state.nextId);
      return { ...state, items, nextId };
    }
    case "snapshot":
      return action.state;
  }
  throw new Error(\`unknown action \${action.type}\`);
}
`;
}

const NUMBER_INPUT_FILE = `import { useState } from "react";
import { isInt } from "./util";

// A number input for an integer in [min, max]. \`onValue\` is called only while the input holds
// one; until then the input keeps the text typed (a draft), dropped when \`record\`, the object the
// value is read from, changes, so the input shows the stored value again.
export default function NumberInput({ value, min, max, record, onValue, ...props }) {
  const [draft, setDraft] = useState(null);
  const [seen, setSeen] = useState(record);
  if (record !== seen) {
    setSeen(record);
    setDraft(null);
  }
  function change(e) {
    const text = e.target.value;
    if (isInt(text, min, max)) {
      setDraft(null);
      onValue(+text);
    } else {
      setDraft(text);
    }
  }
  return <input type="number" {...props} value={draft ?? value} onChange={change} />;
}
`;

// ---------------------------------------------------------------------------------------------
// The sheet.

function sheetFile(spec, g) {
  for (const f of g.formulas) if (LOCALS.has(f.name)) throw new Error(`formula name ${f.name} clashes with the sheet's own names`);
  const used = new Set();
  const o = { ref: (name) => (g.cells.get(name).kind === "input" ? `inputs.${name}` : name), items: "items", used };

  // The text children of a text node.
  const children = (node) => node.parts.map((p) => {
    if (typeof p === "string") return jsxText(p);
    const s = partShown(g, p, o);
    return `{${s.expr}}${s.suffix}`;
  }).join("");

  const consts = g.formulas.map((f) => `const ${f.name} = ${jsExpr(f.expr, o)};`);

  let typed = false;
  const unit = (u) => u.view.map((n) => {
    switch (n.el) {
      case "text": return `<${n.tag}>${children(n)}</${n.tag}>`;
      case "input": {
        const c = g.cells.get(g.messages.get(n.msg).cell);
        typed = true;
        return `<label>
  ${jsxText(n.label)}
  <NumberInput data-role="${n.msg}" value={inputs.${c.name}} min={${c.min}} max={${c.max}} record={inputs} onValue={(value) => dispatch({ type: "input", name: "${c.name}", value })} />
</label>`;
      }
      case "button": {
        const m = g.messages.get(n.msg), c = g.cells.get(m.cell);
        return `<button data-role="${n.msg}" onClick={() => dispatch({ type: "step", name: "${c.name}", k: ${m.k}, min: ${c.min}, max: ${c.max} })}>
  ${jsxText(n.text)}
</button>`;
      }
      case "check": {
        const c = g.cells.get(g.messages.get(n.msg).cell);
        return `<label>
  <input type="checkbox" data-role="${n.msg}" checked={inputs.${c.name}} onChange={(e) => dispatch({ type: "input", name: "${c.name}", value: e.target.checked })} />
  ${jsxText(n.label)}
</label>`;
      }
      case "select": {
        const c = g.cells.get(g.messages.get(n.msg).cell);
        return `<label>
  ${jsxText(n.label)}
  <select data-role="${n.msg}" value={inputs.${c.name}} onChange={(e) => dispatch({ type: "input", name: "${c.name}", value: e.target.value })}>
${c.options.map((opt) => `    <option value=${str(opt)}>${jsxText(opt)}</option>`).join("\n")}
  </select>
</label>`;
      }
      case "top": {
        const c = g.cells.get(n.cell), t = topShown(c, o);
        return `<${n.tag} data-role="${n.cell}">
  {${n.cell}.map((it) => (
    <li key={it.id} data-key={it.id} data-role="${n.cell}Item">
      {it.name}: {${t.expr}}${t.suffix}
    </li>
  ))}
</${n.tag}>`;
      }
      case "groups": {
        used.add("CATEGORIES");
        const c = g.cells.get(n.cell), t = formatted(c.format, `${n.cell}[category]`, used);
        return `<ul data-role="${n.cell}">
  {CATEGORIES.map((category) => (
    <li key={category} data-key={category} data-role="${n.cell}Row">
      {category}: {${t.expr}}${t.suffix}
    </li>
  ))}
</ul>`;
      }
    }
    throw new Error(`unknown view node ${n.el}`);
  });

  const pad = (code, n) => code.split("\n").map((l) => (l ? " ".repeat(n) + l : l)).join("\n");
  const units = spec.units.map((u) => `<div>\n${pad(unit(u).join("\n"), 2)}\n</div>`);
  const imports = [];
  if (typed) imports.push(`import NumberInput from "./NumberInput";`);
  if (used.size) imports.push(`import { ${[...used].sort().join(", ")} } from "./util";`);

  return `${imports.join("\n")}

export default function Sheet({ state, dispatch }) {
  const { inputs, items } = state;
${pad(consts.join("\n"), 2)}

  return (
    <section data-key="sheet" data-role="sheet">
      <h2>${jsxText(spec.title)}</h2>
${pad(units.join("\n"), 6)}
    </section>
  );
}
`;
}

// ---------------------------------------------------------------------------------------------
// The items.

function itemsFile(spec) {
  const headers = ["Item", "Category", "Qty", "Price", "Line", "With markup", "Active", "Note", ""];
  return `import NumberInput from "./NumberInput";
import { money } from "./util";

function ItemRow({ item, markup, dispatch }) {
  const id = item.id;
  return (
    <tr data-key={id} data-role="item">
      <td>{item.name}</td>
      <td>{item.category}</td>
      <td>
        <NumberInput data-role="qty" value={item.qty} min={0} max={999} record={item} onValue={(value) => dispatch({ type: "qty", id, value })} />
      </td>
      <td>{money(item.price)}</td>
      <td>{money(item.qty * item.price)}</td>
      <td>{money(Math.floor((item.qty * item.price * (100 + markup)) / 100))}</td>
      <td>
        <input type="checkbox" data-role="active" checked={item.active} onChange={() => dispatch({ type: "active", id })} />
      </td>
      <td>
        <input type="text" data-role="note" placeholder="Note" value={item.note} onChange={(e) => dispatch({ type: "note", id, value: e.target.value })} />
      </td>
      <td>
        <button data-role="remove" onClick={() => dispatch({ type: "remove", id })}>
          ×
        </button>
      </td>
    </tr>
  );
}

export default function Items({ state, dispatch }) {
  return (
    <section data-key="items" data-role="items">
      <h2>${jsxText(spec.itemsTitle)}</h2>
      <div>
        <button data-role="load" onClick={() => dispatch({ type: "load" })}>
          ${jsxText(spec.loadText)}
        </button>
        <button data-role="addItem" onClick={() => dispatch({ type: "addItem" })}>
          Add item
        </button>
        <label>
          Markup %
          <NumberInput data-role="markup" value={state.markup} min={0} max={100} record={state} onValue={(value) => dispatch({ type: "markup", value })} />
        </label>
      </div>
      <table>
        <thead>
          <tr>
${headers.map((h) => (h ? `            <th>${h}</th>` : "            <th />")).join("\n")}
          </tr>
        </thead>
        <tbody>
          {state.items.map((item) => (
            <ItemRow key={item.id} item={item} markup={state.markup} dispatch={dispatch} />
          ))}
        </tbody>
      </table>
    </section>
  );
}
`;
}

const APP_FILE = `import { useEffect, useReducer } from "react";
import { initialState, reducer } from "./state";
import Sheet from "./Sheet";
import Items from "./Items";

export default function App({ events }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => events.subscribe(dispatch), [events]);

  return (
    <div data-role="page">
      <Sheet state={state} dispatch={dispatch} />
      <Items state={state} dispatch={dispatch} />
    </div>
  );
}
`;

export function emit(spec, options = {}) {
  const g = readGraph(spec);
  const files = {
    ...templateFiles({ name: "derived-graph", title: spec.title }, options),
    "src/state.js": stateFile(spec),
    "src/App.jsx": APP_FILE,
    "src/Sheet.jsx": sheetFile(spec, g),
    "src/Items.jsx": itemsFile(spec),
    "src/NumberInput.jsx": NUMBER_INPUT_FILE,
    "src/util.js": utilSource(spec),
  };
  return {
    files,
    style: {
      components: "Sheet (every formula, then the units' displays), Items (toolbar and table), ItemRow, NumberInput; props, no context; no formula descriptors, nothing interpreted",
      state: "one useReducer in App over { inputs, markup, items, nextId, rng }; immutable updates with structural sharing; load and addItem draw from the app's generator inside the reducer",
      derived: "computed during render in Sheet, one const per formula in dependency order; no useMemo (the compiler variant memoizes the same source)",
      lists: ".map with key: rows and top-k items by id, group rows by category",
      displays: "JSX text children reading the formulas' consts; formatters from src/util.js",
      inputs: "controlled, onChange; NumberInput reports only integers in range and keeps a draft of other text until the record it reads changes",
      externalEvents: "a subscription in a useEffect dispatching each message to the reducer",
      helpers: "src/util.js (app code): PRNG step, formatters, sumBy/avgBy/maxBy/minBy/topBy/groupSum taking the formula's own code as a function",
      compiler: options.compiler === "on" ? "React Compiler (babel-plugin-react-compiler through @rolldown/plugin-babel)" : "none (create-vite's react template)",
      build: "Vite + @vitejs/plugin-react, production defaults, hidden source maps",
    },
  };
}
