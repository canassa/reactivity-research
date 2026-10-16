// The big-table page (N data tables, each its own component) in Solid 1.
//
// Style (recorded in every generated app's rr.json):
// - One component per table (`T1`, `T2`, …), each in its own file, written from that table's
//   description alone: its row builder, its toolbar handlers, its row controls, its computed
//   cells and its formatting calls are the component's own code. Nothing is interpreted at
//   runtime: no column descriptors, no op codes. Table 1 is written the way
//   js-framework-benchmark's keyed/solid entry is: a `For` over the rows, `createSelector` for
//   the selected row, `batch` around multi-signal updates, `textContent` on elements whose only
//   child is a text, the row's id captured once, handlers in JSX.
// - State: one app store (`createStore`) holding every table's `{ rows, selected, nextId, rng }`
//   (the contract's state shape), created per mount and shared through a context. A table reads
//   its slice and updates it with path setters: an index path for one cell (`updateEvery`), a
//   row filter for a row control (`toggle`, `bump`), `produce` for the swap, a new array for
//   create, append, remove and sort. `rng` and `nextId` live in the slice, which the row builder
//   reads and advances.
// - Rows render with `<For>`, which keys by the row's store proxy; the selection marker is a
//   `createSelector` per table, so a select touches the two rows involved, written as
//   `classList` (class markers) or an `aria-selected` attribute.
// - External events: `store.receive(msg)`. `serverRows` and `snapshot` go through
//   `reconcile(…, { key: "id" })`, so keyed rows keep their store proxies and their DOM nodes;
//   `serverUpdate` is one path set per change, inside a `batch`.
// - Events: `onClick` (delegated) for buttons and links, `onChange` for the row checkboxes.

import { templateFiles } from "../../frameworks/solid/framework.js";
import { literal } from "../../frameworks/shared/jsx.js";

export const framework = "solid";

export const params = {};

const cap = (s) => s[0].toUpperCase() + s.slice(1);
const handlerName = (role) => `on${cap(role)}`;

// Text in a JSX child position.
function jsxText(s) {
  return /[{}<>&]/.test(s) ? `{${JSON.stringify(s)}}` : s;
}

const DATE_FORMATS = { "mon-d": "monD", "d-mon": "dMon", "mm-dd": "mmDd" };

// A number in its column's format, as an expression over the value expression `v`.
function formatted(c, v, needs) {
  switch (c.format) {
    case "plain": return v;
    case "grouped": needs.format.add("group"); return `group(${v})`;
    case "unit": needs.format.add("withUnit"); return `withUnit(${v}, ${JSON.stringify(c.unit)})`;
    case "currency": needs.format.add("currency"); return `currency(${v}, ${JSON.stringify(c.symbol)})`;
    case "percent": needs.format.add("percent"); return `percent(${v})`;
  }
  throw new Error(`unknown number format ${c.format}`);
}

// A computed cell's expression, over `row`.
function computed(c, needs) {
  const [op, a, b] = c.expr;
  switch (op) {
    case "*": return formatted(c, `row.${a} * row.${b}`, needs);
    case "+": return formatted(c, `row.${a} + row.${b}`, needs);
    case "len": return `row.${a}.length`;
    case "if": {
      const [cop, x, y] = a;
      const cond = cop === ">" ? `row.${x} > ${y}` : cop === "==" ? `row.${x} === ${JSON.stringify(y)}` : `row.${x}`;
      return `${cond} ? ${JSON.stringify(b)} : ${JSON.stringify(c.expr[3])}`;
    }
  }
  throw new Error(`unknown expression ${JSON.stringify(c.expr)}`);
}

// ---------------------------------------------------------------------------------------------
// The row builder: one draw per generated cell in column order (a label: one per pool), then
// the id.

function pools(t) {
  const out = [];
  for (const c of t.columns) {
    if (c.kind === "label") c.pools.forEach((p, k) => out.push(`const ${c.name}Pool${k} = ${literal(p)};`));
    if (c.kind === "text") out.push(`const ${c.name}Pool = ${literal(c.pool)};`);
  }
  return out;
}

function builder(t, needs) {
  const draws = [];
  const draw = (line, ...helpers) => {
    helpers.forEach((h) => needs.prng.add(h));
    needs.prng.add("next");
    draws.push(`s = next(s);`, line);
  };
  for (const c of t.columns) {
    switch (c.kind) {
      case "label":
        c.pools.forEach((_, k) => draw(k === 0 ? `row.${c.name} = pick(s, ${c.name}Pool0);` : `row.${c.name} += " " + pick(s, ${c.name}Pool${k});`, "pick"));
        break;
      case "text": draw(`row.${c.name} = pick(s, ${c.name}Pool);`, "pick"); break;
      case "number": draw(`row.${c.name} = between(s, ${c.min}, ${c.max});`, "between"); break;
      case "date": draw(`row.${c.name} = between(s, 1, 365);`, "between"); break;
      case "status": draw(`row.${c.name} = pick(s, ${c.name}Options);`, "pick"); break;
      case "flag": draw(`row.${c.name} = s % 2 === 1;`); break;
    }
  }
  return `  // The next \`count\` rows, drawn from this table's PRNG.
  const build = (count) => {
    let s = t.rng;
    let id = t.nextId;
    const rows = [];
    for (let n = 0; n < count; n++) {
      const row = { id: id++ };
${draws.map((l) => `      ${l}`).join("\n")}
      rows.push(row);
    }
    batch(() => {
      set("rng", s);
      set("nextId", id);
    });
    return rows;
  };`;
}

// ---------------------------------------------------------------------------------------------
// Toolbar operations and row controls: each as that table's own handler.

function sortKey(c, v) {
  if (c.kind === "status") return `${c.name}Options.indexOf(${v}.${c.name})`;
  if (c.kind === "flag") return `Number(${v}.${c.name})`;
  return `${v}.${c.name}`;
}

function operation(t, o, needs) {
  const hasSelect = !!t.marker;
  const name = handlerName(o.name);
  switch (o.kind) {
    case "create":
      return `  const ${name} = () =>
    batch(() => {
      set("rows", build(${o.count}));${hasSelect ? `\n      set("selected", null);` : ""}
    });`;
    case "append":
      return `  const ${name} = () =>
    batch(() => {
      const more = build(${o.count});
      set("rows", (rows) => [...rows, ...more]);
    });`;
    case "clear":
      return `  const ${name} = () =>
    batch(() => {
      set("rows", []);${hasSelect ? `\n      set("selected", null);` : ""}
    });`;
    case "swap":
      needs.produce = true;
      return `  const ${name} = () => {
    if (t.rows.length > ${o.j}) {
      set(
        "rows",
        produce((rows) => {
          [rows[${o.i}], rows[${o.j}]] = [rows[${o.j}], rows[${o.i}]];
        }),
      );
    }
  };`;
    case "sort": {
      const c = o.column === "id" ? { kind: "id", name: "id" } : t.columns.find((x) => x.name === o.column);
      const a = sortKey(c, "a"), b = sortKey(c, "b");
      const cmp = `${a} < ${b} ? -1 : ${a} > ${b} ? 1 : 0`;
      return `  const ${name} = () =>
    set("rows", (rows) => rows.slice().sort((a, b) => ${o.dir === "desc" ? `-(${cmp})` : `(${cmp})`} || a.id - b.id));`;
    }
    case "removeChecked":
      return `  const ${name} = () =>
    batch(() => {
      set("rows", (rows) => rows.filter((row) => !row.${o.column}));${hasSelect ? `
      if (t.selected != null && !t.rows.some((row) => row.id === t.selected)) set("selected", null);` : ""}
    });`;
    case "updateEvery": {
      const col = t.columns.find((c) => c.name === o.column);
      let fn;
      switch (col.kind) {
        case "label": case "text": fn = `(value) => value + ${JSON.stringify(o.suffix)}`; break;
        case "number": fn = `(value) => value + ${o.delta}`; break;
        case "date": fn = `(day) => ((day - 1 + ${o.days}) % 365) + 1`; break;
        case "status": fn = `(value) => ${col.name}Options[(${col.name}Options.indexOf(value) + 1) % ${col.options.length}]`; break;
        case "flag": fn = `(on) => !on`; break;
      }
      return `  const ${name} = () =>
    batch(() => {
      for (let i = 0; i < t.rows.length; i += ${o.k}) set("rows", i, "${col.name}", ${fn});
    });`;
    }
  }
  throw new Error(`unknown operation ${o.kind}`);
}

function control(t, ctl) {
  const name = handlerName(ctl.role);
  switch (ctl.kind) {
    case "select": return `  const ${name} = (id) => set("selected", id);`;
    case "toggle": return `  const ${name} = (id) => set("rows", (row) => row.id === id, "${ctl.column}", (on) => !on);`;
    case "bump": return `  const ${name} = (id) => set("rows", (row) => row.id === id, "${ctl.column}", (value) => value + ${ctl.delta});`;
    case "remove":
      if (!t.marker) return `  const ${name} = (id) => set("rows", (rows) => rows.filter((row) => row.id !== id));`;
      return `  const ${name} = (id) =>
    batch(() => {
      set("rows", (rows) => rows.filter((row) => row.id !== id));
      if (t.selected === id) set("selected", null);
    });`;
  }
  throw new Error(`unknown control ${ctl.kind}`);
}

// ---------------------------------------------------------------------------------------------
// View

function cell(c, needs) {
  switch (c.kind) {
    case "id": return `<td textContent={id} />`;
    case "label": case "text":
      if (c.select) return `<td><a data-role="${c.select}" onClick={() => ${handlerName(c.select)}(id)} textContent={row.${c.name}} /></td>`;
      return `<td textContent={row.${c.name}} />`;
    case "number": return `<td textContent={${formatted(c, `row.${c.name}`, needs)}} />`;
    case "date": needs.format.add(DATE_FORMATS[c.format]); return `<td textContent={${DATE_FORMATS[c.format]}(row.${c.name})} />`;
    case "status": return `<td><${c.tag} textContent={row.${c.name}} /></td>`;
    case "flag": return `<td><input type="checkbox" data-role="${c.toggle}" checked={row.${c.name}} onChange={() => ${handlerName(c.toggle)}(id)} /></td>`;
    case "computed": return `<td textContent={${computed(c, needs)}} />`;
    case "remove": {
      const inner = c.glyph ? `<span aria-hidden="true">${jsxText(c.text)}</span>` : jsxText(c.text);
      return `<td><${c.element} data-role="${c.role}" onClick={() => ${handlerName(c.role)}(id)}>${inner}</${c.element}></td>`;
    }
    case "bump": return `<td><button data-role="${c.role}" onClick={() => ${handlerName(c.role)}(id)}>${jsxText(c.text)}</button></td>`;
    case "spacer": return `<td />`;
  }
  throw new Error(`unknown column kind ${c.kind}`);
}

function marker(m) {
  if (m.attr === "class") return `\n                  classList={{ ${m.value}: isSelected(id) }}`;
  return `\n                  ${m.attr}={isSelected(id) ? ${JSON.stringify(m.value)} : undefined}`;
}

function tableComponent(t) {
  const needs = { solid: new Set(["For", "batch"]), format: new Set(), prng: new Set(), produce: false };
  const options = t.columns.filter((c) => c.kind === "status").map((c) => `const ${c.name}Options = ${literal(c.options)};`);
  const ops = t.ops.map((o) => operation(t, o, needs));
  const ctls = [];
  for (const c of t.columns) {
    if (c.select) ctls.push({ kind: "select", role: c.select });
    if (c.toggle) ctls.push({ kind: "toggle", role: c.toggle, column: c.name });
    if (c.kind === "remove") ctls.push({ kind: "remove", role: c.role });
    if (c.kind === "bump") ctls.push({ kind: "bump", role: c.role, column: c.column, delta: c.delta });
  }
  const controls = ctls.map((ctl) => control(t, ctl));
  const cells = t.columns.map((c) => `                  ${cell(c, needs)}`);
  const buttons = t.ops.map((o) => `        <button data-role="${o.name}" onClick={${handlerName(o.name)}}>${jsxText(o.text)}</button>`);
  const thead = t.thead
    ? `        <thead>
          <tr>
${t.columns.map((c) => (c.header ? `            <th>${jsxText(c.header)}</th>` : `            <th></th>`)).join("\n")}
          </tr>
        </thead>
`
    : "";
  const build = builder(t, needs);
  if (t.marker) needs.solid.add("createSelector");

  const imports = [`import { ${[...needs.solid].sort().join(", ")} } from "solid-js";`];
  if (needs.produce) imports.push(`import { produce } from "solid-js/store";`);
  imports.push(`import { useTable } from "../store";`);
  if (needs.prng.size) imports.push(`import { ${[...needs.prng].sort().join(", ")} } from "../prng";`);
  if (needs.format.size) imports.push(`import { ${[...needs.format].sort().join(", ")} } from "../format";`);

  return `${imports.join("\n")}

${[...pools(t), ...options].join("\n")}

export default function T${t.id.slice(1)}() {
  const [t, set] = useTable("${t.id}");${t.marker ? `\n  const isSelected = createSelector(() => t.selected);` : ""}

${build}

${[...ops, ...controls].join("\n")}

  return (
    <section data-key="${t.id}" data-role="table">
      <h2>${jsxText(t.title)}</h2>
      <div>
${buttons.join("\n")}
      </div>
      <table>
${thead}        <tbody>
          <For each={t.rows}>
            {(row) => {
              const id = row.id;
              return (
                <tr
                  data-key={id}
                  data-role="row"${t.marker ? marker(t.marker) : ""}
                >
${cells.join("\n")}
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

// ---------------------------------------------------------------------------------------------
// Files

const PRNG_FILE = `// The PRNG every table carries in its state: Park–Miller. One draw advances the state, then
// uses it.
export const next = (s) => (s * 48271) % 2147483647;
export const pick = (s, list) => list[s % list.length];
export const between = (s, min, max) => min + (s % (max - min + 1));
`;

const FORMAT_FILE = `// Number and date formatting: no locale APIs.
export const group = (n) => String(n).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ",");
export const withUnit = (n, unit) => \`\${group(n)} \${unit}\`;
export const currency = (cents, symbol) => \`\${symbol}\${group(Math.floor(cents / 100))}.\${String(cents % 100).padStart(2, "0")}\`;
export const percent = (tenths) => \`\${group(Math.floor(tenths / 10))}.\${tenths % 10}%\`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const pad = (n) => String(n).padStart(2, "0");

// Day of the year (1-365) as [month index, day of the month].
function split(day) {
  let m = 0;
  while (day > MONTH_DAYS[m]) day -= MONTH_DAYS[m++];
  return [m, day];
}

export const monD = (day) => {
  const [m, d] = split(day);
  return \`\${MONTHS[m]} \${d}\`;
};
export const dMon = (day) => {
  const [m, d] = split(day);
  return \`\${d} \${MONTHS[m]}\`;
};
export const mmDd = (day) => {
  const [m, d] = split(day);
  return \`\${pad(m + 1)}-\${pad(d)}\`;
};
`;

function storeFile(spec) {
  return `import { batch, createContext, useContext } from "solid-js";
import { createStore, reconcile } from "solid-js/store";

export const AppContext = createContext();

// The whole page's state, one slice per table. \`receive\` applies external events.
export function createAppStore() {
  const [state, setState] = createStore(${literal(spec.initialState, "  ")});

  function receive(msg) {
    switch (msg.type) {
      case "serverRows": {
        const ts = state.tables[msg.table];
        batch(() => {
          setState("tables", msg.table, "rows", reconcile(msg.rows, { key: "id" }));
          if (ts.selected != null && !msg.rows.some((row) => row.id === ts.selected)) setState("tables", msg.table, "selected", null);
          setState("tables", msg.table, "nextId", (id) => msg.rows.reduce((max, row) => Math.max(max, row.id + 1), id));
        });
        break;
      }
      case "serverUpdate":
        batch(() => {
          for (const { id, value } of msg.changes) setState("tables", msg.table, "rows", (row) => row.id === id, msg.column, value);
        });
        break;
      case "serverDelete":
        batch(() => {
          setState("tables", msg.table, "rows", (rows) => rows.filter((row) => !msg.ids.includes(row.id)));
          if (msg.ids.includes(state.tables[msg.table].selected)) setState("tables", msg.table, "selected", null);
        });
        break;
      case "snapshot":
        setState(reconcile(msg.state, { key: "id" }));
        break;
    }
  }

  return { state, setState, receive };
}

// A table's slice of the store and a setter scoped to it.
export function useTable(id) {
  const { state, setState } = useContext(AppContext);
  return [state.tables[id], (...path) => setState("tables", id, ...path)];
}
`;
}

function appFile(spec) {
  const names = spec.tables.map((t) => `T${t.id.slice(1)}`);
  return `import { AppContext } from "./store";
${names.map((n) => `import ${n} from "./tables/${n}";`).join("\n")}

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
    ...templateFiles({ name: "big-table", title: "Data tables" }),
    "src/store.js": storeFile(spec),
    "src/App.jsx": appFile(spec),
    "src/prng.js": PRNG_FILE,
    "src/format.js": FORMAT_FILE,
  };
  for (const t of spec.tables) files[`src/tables/T${t.id.slice(1)}.jsx`] = tableComponent(t);
  return {
    files,
    style: {
      components: "one component per table, in its own file, written from the table's description; row builder, handlers, computed cells and formatting calls are its own code; no column descriptors",
      state: "one createStore for the page holding every table's { rows, selected, nextId, rng }, shared through a context; tables use path setters on their slice (index path for updateEvery, row filter for toggle and bump, produce for swap, new arrays for create, append, remove, sort)",
      externalEvents: "store.receive(msg); serverRows and snapshot through reconcile(…, { key: 'id' }); serverUpdate one path set per change in a batch",
      lists: "<For> over the rows store array, as js-framework-benchmark's keyed/solid",
      selection: "createSelector per table with select; classList or aria-selected for the marker",
      cells: "textContent on elements whose only child is the text, as js-framework-benchmark's entry; the row id captured once",
      events: "onClick (delegated) for buttons and links, onChange for checkboxes",
      build: "Vite + vite-plugin-solid, production defaults, hidden source maps",
    },
  };
}
