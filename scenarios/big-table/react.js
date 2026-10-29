// The big-table page (N data tables, each its own component) in React 19.
//
// Style (recorded in every generated app's rr.json):
// - One component per table (`T1`, `T2`, …), each in its own file, written from that table's
//   description alone: its row builder, its toolbar handlers, its row controls, its computed
//   cells and its formatting calls are the component's own code. Nothing is interpreted at
//   runtime: no column descriptors, no op codes. Rows are rendered inline in the table's
//   `.map`, with `key={row.id}`.
// - State lifted up: one `useState` in `App` holds every table's `{ rows, selected, nextId, rng }`
//   (the contract's state shape), shared through a context. A table reads its slice with a
//   `useTable(id)` hook and changes it with updater functions, so two clicks before a render
//   both apply, and a control whose row is gone finds nothing to change. Updates are immutable:
//   a new array, new objects for the rows that change, every other row object kept. The row
//   builder is a pure function of the slice, returning the rows and the advanced `rng` and
//   `nextId`.
// - External events arrive through a subscription in an effect and go through `receive`, a pure
//   function of the state.
// - The selection marker is computed per row during render (`className` or `aria-selected`,
//   absent when unselected). No manual memoization (no `memo` on rows; the React Compiler, when
//   on, adds it).
// - Events: `onClick` for buttons and links, `onChange` for the row checkboxes (controlled).

import { templateFiles, params as frameworkParams } from "../../frameworks/react/framework.js";
import { literal } from "../../frameworks/shared/jsx.js";

export const framework = "react";

export const params = { ...frameworkParams };

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
  return `// The next \`count\` rows of the table \`t\`, drawn from its PRNG, with the PRNG state and the next
// id they leave.
function build(t, count) {
  let s = t.rng;
  let id = t.nextId;
  const rows = [];
  for (let n = 0; n < count; n++) {
    const row = { id: id++ };
${draws.map((l) => `    ${l}`).join("\n")}
    rows.push(row);
  }
  return { rows, rng: s, nextId: id };
}`;
}

// ---------------------------------------------------------------------------------------------
// Toolbar operations and row controls: each as that table's own handler.

function sortKey(c, v) {
  if (c.kind === "status") return `${c.name}Options.indexOf(${v}.${c.name})`;
  if (c.kind === "flag") return `Number(${v}.${c.name})`;
  return `${v}.${c.name}`;
}

function operation(t, o) {
  const hasSelect = !!t.marker;
  const name = handlerName(o.name);
  switch (o.kind) {
    case "create":
      return `  function ${name}() {
    update((t) => ({ ...t, ...build(t, ${o.count})${hasSelect ? ", selected: null" : ""} }));
  }`;
    case "append":
      return `  function ${name}() {
    update((t) => {
      const more = build(t, ${o.count});
      return { ...t, ...more, rows: [...t.rows, ...more.rows] };
    });
  }`;
    case "clear":
      return `  function ${name}() {
    update((t) => ({ ...t, rows: []${hasSelect ? ", selected: null" : ""} }));
  }`;
    case "swap":
      return `  function ${name}() {
    update((t) => {
      if (t.rows.length <= ${o.j}) return t;
      const rows = t.rows.slice();
      [rows[${o.i}], rows[${o.j}]] = [rows[${o.j}], rows[${o.i}]];
      return { ...t, rows };
    });
  }`;
    case "sort": {
      const c = o.column === "id" ? { kind: "id", name: "id" } : t.columns.find((x) => x.name === o.column);
      const a = sortKey(c, "a"), b = sortKey(c, "b");
      const cmp = `${a} < ${b} ? -1 : ${a} > ${b} ? 1 : 0`;
      return `  function ${name}() {
    update((t) => ({ ...t, rows: t.rows.toSorted((a, b) => ${o.dir === "desc" ? `-(${cmp})` : `(${cmp})`} || a.id - b.id) }));
  }`;
    }
    case "removeChecked":
      return `  function ${name}() {
    update((t) => {
      const rows = t.rows.filter((row) => !row.${o.column});
      return { ...t, rows${hasSelect ? ", selected: rows.some((row) => row.id === t.selected) ? t.selected : null" : ""} };
    });
  }`;
    case "updateEvery": {
      const col = t.columns.find((c) => c.name === o.column);
      const v = `row.${col.name}`;
      let expr;
      switch (col.kind) {
        case "label": case "text": expr = `${v} + ${JSON.stringify(o.suffix)}`; break;
        case "number": expr = `${v} + ${o.delta}`; break;
        case "date": expr = `((${v} - 1 + ${o.days}) % 365) + 1`; break;
        case "status": expr = `${col.name}Options[(${col.name}Options.indexOf(${v}) + 1) % ${col.options.length}]`; break;
        case "flag": expr = `!${v}`; break;
      }
      return `  function ${name}() {
    update((t) => ({ ...t, rows: t.rows.map((row, i) => (i % ${o.k} === 0 ? { ...row, ${col.name}: ${expr} } : row)) }));
  }`;
    }
  }
  throw new Error(`unknown operation ${o.kind}`);
}

function control(t, ctl) {
  const name = handlerName(ctl.role);
  switch (ctl.kind) {
    case "select": return `  function ${name}(id) {
    // A row removed before this click rendered is not selected.
    update((t) => (t.rows.some((row) => row.id === id) ? { ...t, selected: id } : t));
  }`;
    case "toggle": return `  function ${name}(id) {
    update((t) => ({ ...t, rows: t.rows.map((row) => (row.id === id ? { ...row, ${ctl.column}: !row.${ctl.column} } : row)) }));
  }`;
    case "bump": return `  function ${name}(id) {
    update((t) => ({ ...t, rows: t.rows.map((row) => (row.id === id ? { ...row, ${ctl.column}: row.${ctl.column} + ${ctl.delta} } : row)) }));
  }`;
    case "remove": return `  function ${name}(id) {
    update((t) => ({ ...t, rows: t.rows.filter((row) => row.id !== id)${t.marker ? ", selected: t.selected === id ? null : t.selected" : ""} }));
  }`;
  }
  throw new Error(`unknown control ${ctl.kind}`);
}

// ---------------------------------------------------------------------------------------------
// View

function cell(c, needs) {
  const text = (tag, expr, attrs = "") => `<${tag}${attrs}>{${expr}}</${tag}>`;
  switch (c.kind) {
    case "id": return text("td", "row.id");
    case "label": case "text":
      if (c.select) return `<td>${text("a", `row.${c.name}`, ` data-role="${c.select}" onClick={() => ${handlerName(c.select)}(row.id)}`)}</td>`;
      return text("td", `row.${c.name}`);
    case "number": return text("td", formatted(c, `row.${c.name}`, needs));
    case "date": needs.format.add(DATE_FORMATS[c.format]); return text("td", `${DATE_FORMATS[c.format]}(row.${c.name})`);
    case "status": return `<td>${text(c.tag, `row.${c.name}`)}</td>`;
    case "flag": return `<td><input type="checkbox" data-role="${c.toggle}" checked={row.${c.name}} onChange={() => ${handlerName(c.toggle)}(row.id)} /></td>`;
    case "computed": return text("td", computed(c, needs));
    case "remove": {
      const inner = c.glyph ? `<span aria-hidden="true">${jsxText(c.text)}</span>` : jsxText(c.text);
      return `<td><${c.element} data-role="${c.role}" onClick={() => ${handlerName(c.role)}(row.id)}>${inner}</${c.element}></td>`;
    }
    case "bump": return `<td><button data-role="${c.role}" onClick={() => ${handlerName(c.role)}(row.id)}>${jsxText(c.text)}</button></td>`;
    case "spacer": return `<td />`;
  }
  throw new Error(`unknown column kind ${c.kind}`);
}

function marker(m) {
  const attr = m.attr === "class" ? "className" : m.attr;
  return ` ${attr}={row.id === t.selected ? ${JSON.stringify(m.value)} : undefined}`;
}

function tableComponent(t) {
  const needs = { format: new Set(), prng: new Set() };
  const options = t.columns.filter((c) => c.kind === "status").map((c) => `const ${c.name}Options = ${literal(c.options)};`);
  const build = builder(t, needs);
  const ops = t.ops.map((o) => operation(t, o));
  const ctls = [];
  for (const c of t.columns) {
    if (c.select) ctls.push({ kind: "select", role: c.select });
    if (c.toggle) ctls.push({ kind: "toggle", role: c.toggle, column: c.name });
    if (c.kind === "remove") ctls.push({ kind: "remove", role: c.role });
    if (c.kind === "bump") ctls.push({ kind: "bump", role: c.role, column: c.column, delta: c.delta });
  }
  const controls = ctls.map((ctl) => control(t, ctl));
  const cells = t.columns.map((c) => `              ${cell(c, needs)}`);
  const buttons = t.ops.map((o) => `        <button data-role="${o.name}" onClick={${handlerName(o.name)}}>${jsxText(o.text)}</button>`);
  const thead = t.thead
    ? `        <thead>
          <tr>
${t.columns.map((c) => (c.header ? `            <th>${jsxText(c.header)}</th>` : `            <th></th>`)).join("\n")}
          </tr>
        </thead>
`
    : "";

  const imports = [`import { useTable } from "../state";`];
  if (needs.prng.size) imports.push(`import { ${[...needs.prng].sort().join(", ")} } from "../prng";`);
  if (needs.format.size) imports.push(`import { ${[...needs.format].sort().join(", ")} } from "../format";`);

  return `${imports.join("\n")}

${[...pools(t), ...options].join("\n")}

${build}

export default function T${t.id.slice(1)}() {
  const [t, update] = useTable("${t.id}");

${[...ops, ...controls].join("\n\n")}

  return (
    <section data-key="${t.id}" data-role="table">
      <h2>${jsxText(t.title)}</h2>
      <div>
${buttons.join("\n")}
      </div>
      <table>
${thead}        <tbody>
          {t.rows.map((row) => (
            <tr key={row.id} data-key={row.id} data-role="row"${t.marker ? marker(t.marker) : ""}>
${cells.join("\n")}
            </tr>
          ))}
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

function stateFile(spec) {
  return `import { createContext, useContext } from "react";

export const initialTables = ${literal(spec.initialState.tables)};

// Every table's state and its setter, provided by App.
export const TablesContext = createContext(null);

// A table's slice of the state, and a function applying an updater to it.
export function useTable(id) {
  const { tables, setTables } = useContext(TablesContext);
  return [tables[id], (fn) => setTables((all) => ({ ...all, [id]: fn(all[id]) }))];
}

// The state after an external event.
export function receive(tables, msg) {
  const t = tables[msg.table];
  switch (msg.type) {
    case "serverRows": {
      const selected = msg.rows.some((row) => row.id === t.selected) ? t.selected : null;
      const nextId = msg.rows.reduce((max, row) => Math.max(max, row.id + 1), t.nextId);
      return { ...tables, [msg.table]: { ...t, rows: msg.rows, selected, nextId } };
    }
    case "serverUpdate": {
      const values = new Map(msg.changes.map((change) => [change.id, change.value]));
      const rows = t.rows.map((row) => (values.has(row.id) ? { ...row, [msg.column]: values.get(row.id) } : row));
      return { ...tables, [msg.table]: { ...t, rows } };
    }
    case "serverDelete": {
      const rows = t.rows.filter((row) => !msg.ids.includes(row.id));
      const selected = msg.ids.includes(t.selected) ? null : t.selected;
      return { ...tables, [msg.table]: { ...t, rows, selected } };
    }
    case "snapshot":
      return msg.state.tables;
  }
  return tables;
}
`;
}

function appFile(spec) {
  const names = spec.tables.map((t) => `T${t.id.slice(1)}`);
  return `import { useEffect, useState } from "react";
import { initialTables, receive, TablesContext } from "./state";
${names.map((n) => `import ${n} from "./tables/${n}";`).join("\n")}

export default function App({ events }) {
  const [tables, setTables] = useState(initialTables);

  useEffect(() => events.subscribe((msg) => setTables((tables) => receive(tables, msg))), [events]);

  return (
    <TablesContext value={{ tables, setTables }}>
      <div data-role="page">
${names.map((n) => `        <${n} />`).join("\n")}
      </div>
    </TablesContext>
  );
}
`;
}

export function emit(spec, options = {}) {
  const files = {
    ...templateFiles({ name: "big-table", title: "Data tables" }, options),
    "src/state.js": stateFile(spec),
    "src/App.jsx": appFile(spec),
    "src/prng.js": PRNG_FILE,
    "src/format.js": FORMAT_FILE,
  };
  for (const t of spec.tables) files[`src/tables/T${t.id.slice(1)}.jsx`] = tableComponent(t);
  return {
    files,
    style: {
      components: "one component per table, in its own file, written from the table's description; row builder, handlers, computed cells and formatting calls are its own code; no column descriptors; rows inline in the table's .map",
      state: "lifted up: one useState in App holding every table's { rows, selected, nextId, rng }, shared through a context; tables use a useTable(id) hook and updater functions on their slice; immutable updates keep unchanged row objects; the row builder is a pure function returning rows, rng and nextId",
      externalEvents: "a subscription in a useEffect; receive(tables, msg) is a pure function of the state",
      lists: ".map over the rows with key={row.id}",
      selection: "computed per row during render: className or aria-selected, undefined when unselected",
      derived: "computed during render, no manual memoization (no memo on rows)",
      events: "onClick for buttons and links, onChange for the controlled row checkboxes",
      compiler: options.compiler === "on" ? "React Compiler (babel-plugin-react-compiler through @rolldown/plugin-babel)" : "none (create-vite's react template)",
      build: "Vite + @vitejs/plugin-react, production defaults, hidden source maps",
    },
  };
}
