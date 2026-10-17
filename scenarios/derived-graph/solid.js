// The derived-graph scenario in Solid 1: a planning sheet of formulas over inputs and a table of
// items, written the way Solid's documentation recommends.
//
// Style (recorded in every generated app's rr.json):
// - State: three stores created by `createAppStore()` and shared through a context: `inputs`
//   (`createStore`, one property per input cell), `items` (a store array of item records) and
//   `meta` (`markup`, `nextId`, `rng`). Edits are path setters: `setInputs("taxRate", 20)`,
//   `setItems((it) => it.id === id, "qty", 5)` (a missing id is a no-op), a filtered array for
//   remove, `reconcile(…, { key: "id" })` for a snapshot, which keeps the store proxy of every
//   id that stays. Messages are read, never adopted: items from a message are copied.
// - Derived values: **`createMemo` per formula**, created in dependency order in the `Sheet`
//   component (inside the render root, so `dispose()` cleans them), each the formula's own
//   expression: `const dutyOwed = createMemo(() => Math.floor((grossSales() * inputs.taxRate) / 100))`.
//   An aggregate over the items is a memo that reads `items` through the store proxy, so it
//   subscribes to the fields it reads (not to a note) and runs once per change however many
//   displays show it. Memos compare with `===`, so an unchanged value stops the wave; lists and
//   group sums are new objects and always propagate.
// - Displays: JSX text children reading the memo accessors, a `<For>` over the memo of a top-k
//   list (keyed by the item's proxy) and over the categories for a group sum. Nothing is
//   interpreted: each formula and display is that cell's own code.
// - Components: `Sheet` (the units, in order: every memo, then their displays) and `Items` (the
//   toolbar and the table, a `<For>` over the items store, row controls reading and writing the
//   store). A display never recomputes: it reads memos.
// - Events: `onInput` (delegated) for number and text inputs, which write the store only while
//   a number input holds an integer in range; `onClick` for buttons; `onChange` for checkboxes
//   and selects.
// - `src/util.js` (app code): PRNG step, formatters and the collection helpers formulas call
//   (`sumBy`, `topBy`, `groupSum`, …) with the formula's own code as the function.

import { templateFiles } from "../../frameworks/solid/framework.js";
import { literal } from "../../frameworks/shared/jsx.js";
import { formatted, jsExpr, partShown, readGraph, str, topShown, utilSource } from "./shared/graph.js";

export const framework = "solid";

export const params = {};

// Text in a JSX child position.
const jsxText = (s) => (/[{}<>&]/.test(s) ? `{${str(s)}}` : s);

// ---------------------------------------------------------------------------------------------
// The store.

function storeFile(spec) {
  const s = spec.initialState;
  return `import { batch, createContext, createSignal, useContext } from "solid-js";
import { createStore, reconcile } from "solid-js/store";

export const AppContext = createContext();
export const useApp = () => useContext(AppContext);

// The page's state: the inputs, the items and the items' generator. \`receive\` applies external
// events.
export function createAppStore() {
  const [inputs, setInputs] = createStore(${literal(s.inputs, "  ")});
  const [items, setItems] = createStore(${literal(s.items, "  ")});
  const [meta, setMeta] = createStore({ markup: ${s.markup}, nextId: ${s.nextId}, rng: ${s.rng} });
  // Bumped by every write that may leave a store value as it was (an external event, a step at a
  // limit): a number input binds it, so a text typed into the input that was never sent (and so
  // never reached the store) is replaced by the value, as the reference render does.
  const [epoch, bump] = createSignal(undefined, { equals: false });

  function receive(msg) {
    switch (msg.type) {
      case "serverInputs":
        batch(() => {
          setInputs(msg.values);
          bump();
        });
        break;
      case "serverItems": {
        // Listed ids are replaced in place, new ids appended, listed ids removed.
        const known = new Set(items.map((it) => it.id));
        const fresh = msg.upsert.filter((r) => !known.has(r.id) && !msg.remove.includes(r.id));
        batch(() => {
          for (const r of msg.upsert) setItems((it) => it.id === r.id, { ...r });
          setItems((list) => list.filter((it) => !msg.remove.includes(it.id)).concat(fresh.map((r) => ({ ...r }))));
          setMeta("nextId", (id) => msg.upsert.reduce((max, r) => Math.max(max, r.id + 1), id));
          bump();
        });
        break;
      }
      case "snapshot":
        batch(() => {
          setInputs(reconcile(msg.state.inputs));
          setItems(reconcile(msg.state.items.map((it) => ({ ...it })), { key: "id" }));
          setMeta({ markup: msg.state.markup, nextId: msg.state.nextId, rng: msg.state.rng });
          bump();
        });
        break;
    }
  }

  return { inputs, setInputs, items, setItems, meta, setMeta, epoch, bump, receive };
}
`;
}

// ---------------------------------------------------------------------------------------------
// The sheet.

function sheetFile(spec, g) {
  const used = new Set();
  const solid = new Set(["createMemo"]);
  const o = { ref: (name) => (g.cells.get(name).kind === "input" ? `inputs.${name}` : `${name}()`), items: "items", used };

  // The text children of a text node.
  const children = (node) => node.parts.map((p) => {
    if (typeof p === "string") return jsxText(p);
    const s = partShown(g, p, o);
    return `{${s.expr}}${s.suffix}`;
  }).join("");

  const memos = g.formulas.map((f) => `const ${f.name} = createMemo(() => ${jsExpr(f.expr, o)});`);

  // Controls.
  let typed = false, steps = false;
  const unit = (u) => u.view.map((n) => {
    switch (n.el) {
      case "text": return `<${n.tag}>${children(n)}</${n.tag}>`;
      case "input": {
        const m = g.messages.get(n.msg), c = g.cells.get(m.cell);
        typed = true;
        return `<label>
  ${jsxText(n.label)}
  <input type="number" data-role="${n.msg}" value={(epoch(), inputs.${c.name})} onInput={typed("${c.name}", ${c.min}, ${c.max})} />
</label>`;
      }
      case "button": {
        const m = g.messages.get(n.msg), c = g.cells.get(m.cell);
        used.add("clamp");
        steps = true;
        return `<button data-role="${n.msg}" onClick={step("${c.name}", ${m.k}, ${c.min}, ${c.max})}>${jsxText(n.text)}</button>`;
      }
      case "check": {
        const c = g.cells.get(g.messages.get(n.msg).cell);
        return `<label>
  <input type="checkbox" data-role="${n.msg}" checked={inputs.${c.name}} onChange={(e) => setInputs("${c.name}", e.currentTarget.checked)} />
  ${jsxText(n.label)}
</label>`;
      }
      case "select": {
        const c = g.cells.get(g.messages.get(n.msg).cell);
        return `<label>
  ${jsxText(n.label)}
  <select data-role="${n.msg}" value={inputs.${c.name}} onChange={(e) => setInputs("${c.name}", e.currentTarget.value)}>
${c.options.map((opt) => `    <option value=${str(opt)}>${jsxText(opt)}</option>`).join("\n")}
  </select>
</label>`;
      }
      case "top": {
        solid.add("For");
        const c = g.cells.get(n.cell), t = topShown(c, o);
        return `<${n.tag} data-role="${n.cell}">
  <For each={${n.cell}()}>
    {(it) => (
      <li data-key={it.id} data-role="${n.cell}Item">
        {it.name}: {${t.expr}}${t.suffix}
      </li>
    )}
  </For>
</${n.tag}>`;
      }
      case "groups": {
        solid.add("For");
        used.add("CATEGORIES");
        const c = g.cells.get(n.cell), t = formatted(c.format, `${n.cell}()[category]`, used);
        return `<ul data-role="${n.cell}">
  <For each={CATEGORIES}>
    {(category) => (
      <li data-key={category} data-role="${n.cell}Row">
        {category}: {${t.expr}}${t.suffix}
      </li>
    )}
  </For>
</ul>`;
      }
    }
    throw new Error(`unknown view node ${n.el}`);
  });

  const pad = (code, n) => code.split("\n").map((l) => " ".repeat(n) + l).join("\n");
  const units = spec.units.map((u) => `<div>\n${pad(unit(u).join("\n"), 2)}\n</div>`);
  if (typed) used.add("isInt");
  const hasInputs = g.inputs.length > 0;

  return `import { ${[...solid].sort().join(", ")} } from "solid-js";
import { useApp } from "./store";
import { ${[...used].sort().join(", ")} } from "./util";

export default function Sheet() {
  const { ${hasInputs ? "inputs, setInputs, " : ""}items${typed ? ", epoch" : ""}${steps ? ", bump" : ""} } = useApp();
${steps ? `
  // A step button moves an input by k within its range; at a limit the store does not change, so
  // the controls are re-asserted by hand.
  const step = (name, k, min, max) => () => {
    const v = clamp(inputs[name] + k, min, max);
    if (v === inputs[name]) bump();
    else setInputs(name, v);
  };
` : ""}${typed ? `
  // A number input writes the store only while it holds an integer in range.
  const typed = (name, min, max) => (e) => {
    if (isInt(e.currentTarget.value, min, max)) setInputs(name, +e.currentTarget.value);
  };
` : ""}
${pad(memos.join("\n"), 2)}

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
  return `import { batch, For } from "solid-js";
import { useApp } from "./store";
import { isInt, makeItems, money } from "./util";

export default function Items() {
  const { items, setItems, meta, setMeta, epoch } = useApp();

  // \`count\` new items from the app's generator.
  const build = (count) => {
    const made = makeItems(meta.rng, meta.nextId, count);
    setMeta({ rng: made.rng, nextId: made.nextId });
    return made.items;
  };

  const load = () =>
    batch(() => {
      setItems(build(${spec.options.rows}));
    });
  const addItem = () =>
    batch(() => {
      setItems(items.length, build(1)[0]);
    });
  const onMarkup = (e) => {
    if (isInt(e.currentTarget.value, 0, 100)) setMeta("markup", +e.currentTarget.value);
  };

  return (
    <section data-key="items" data-role="items">
      <h2>${spec.itemsTitle}</h2>
      <div>
        <button data-role="load" onClick={load}>
          ${spec.loadText}
        </button>
        <button data-role="addItem" onClick={addItem}>
          Add item
        </button>
        <label>
          Markup %
          <input type="number" data-role="markup" value={(epoch(), meta.markup)} onInput={onMarkup} />
        </label>
      </div>
      <table>
        <thead>
          <tr>
${headers.map((h) => (h ? `            <th>${h}</th>` : "            <th />")).join("\n")}
          </tr>
        </thead>
        <tbody>
          <For each={items}>
            {(it) => {
              const id = it.id;
              const setItem = (...path) => setItems((x) => x.id === id, ...path);
              return (
                <tr data-key={id} data-role="item">
                  <td>{it.name}</td>
                  <td>{it.category}</td>
                  <td>
                    <input
                      type="number"
                      data-role="qty"
                      value={(epoch(), it.qty)}
                      onInput={(e) => isInt(e.currentTarget.value, 0, 999) && setItem("qty", +e.currentTarget.value)}
                    />
                  </td>
                  <td>{money(it.price)}</td>
                  <td>{money(it.qty * it.price)}</td>
                  <td>{money(Math.floor((it.qty * it.price * (100 + meta.markup)) / 100))}</td>
                  <td>
                    <input type="checkbox" data-role="active" checked={it.active} onChange={(e) => setItem("active", e.currentTarget.checked)} />
                  </td>
                  <td>
                    <input type="text" data-role="note" placeholder="Note" value={it.note} onInput={(e) => setItem("note", e.currentTarget.value)} />
                  </td>
                  <td>
                    <button data-role="remove" onClick={() => setItems((list) => list.filter((x) => x.id !== id))}>
                      ×
                    </button>
                  </td>
                </tr>
              );
            }}
          </For>
        </tbody>
      </table>
    </section>
  );
}
`;
}

function appFile() {
  return `import { AppContext } from "./store";
import Sheet from "./Sheet";
import Items from "./Items";

export default function App(props) {
  return (
    <AppContext.Provider value={props.store}>
      <div data-role="page">
        <Sheet />
        <Items />
      </div>
    </AppContext.Provider>
  );
}
`;
}

export function emit(spec) {
  const g = readGraph(spec);
  const files = {
    ...templateFiles({ name: "derived-graph", title: spec.title }),
    "src/store.js": storeFile(spec),
    "src/App.jsx": appFile(),
    "src/Sheet.jsx": sheetFile(spec, g),
    "src/Items.jsx": itemsFile(spec),
    "src/util.js": utilSource(spec),
  };
  return {
    files,
    style: {
      components: "Sheet (every formula's memo, then the units' displays) and Items (toolbar and table); no formula descriptors, nothing interpreted",
      state: "three createStore stores in a context: inputs (one property per input), items (an array of records) and meta (markup, nextId, rng); path setters, a filter for remove, reconcile(…, { key: 'id' }) for a snapshot; message data copied, never adopted",
      derived: "createMemo per formula in dependency order, inside the render root; aggregates over the items are memos reading the store (field-level subscriptions); memos compare with ===",
      lists: "<For> over the items store, over a top-k memo (keyed by the proxy) and over the categories for group sums",
      displays: "JSX text children reading memo accessors; formatters from src/util.js",
      events: "onInput (delegated) for number and text inputs (a number input writes only while valid), onClick for buttons, onChange for checkboxes and selects",
      externalEvents: "store.receive(msg): serverInputs merged into inputs; serverItems one path set per upsert and a filter for removes; snapshot through reconcile",
      helpers: "src/util.js (app code): PRNG step, formatters, sumBy/avgBy/maxBy/minBy/topBy/groupSum taking the formula's own code as a function",
      build: "Vite + vite-plugin-solid, production defaults, hidden source maps",
    },
  };
}
